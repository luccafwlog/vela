#!/usr/bin/env python3
"""Verifica invariantes de autorização das migrations sem tocar no banco.

O replay modela o estado final de tabelas, RLS, policies, funções e ACLs. Ele
entende DROP FUNCTION, renomeações, sobrecargas, grants agrupados e o EXECUTE
herdado de PUBLIC. Ainda é uma análise estática: grants dinâmicos precisam de
teste SQL/runtime ou de uma exceção explícita.

Uso:
    python scripts/security/verificar_guardas.py
    python scripts/security/verificar_guardas.py --ci
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = os.path.join(RAIZ, 'supabase', 'migrations')

# Cache de leitura: estado_final() e o check [4] varrem os mesmos arquivos.
_CONTEUDO: dict[str, str] = {}

SQL_IDENTIFIER = r'(?:"(?:[^"]|"")+"|[A-Za-z_]\w*)'
QUALIFIED_TABLE = rf'(?:({SQL_IDENTIFIER})\s*\.\s*)?({SQL_IDENTIFIER})(?![\w.])'


def table_key(match: re.Match) -> str:
    def identifier(value: str) -> str:
        return value[1:-1].replace('""', '"') if value.startswith('"') else value.lower()
    schema, table = match.groups()
    return f'{identifier(schema or "public")}.{identifier(table)}'


def ler(caminho: str) -> str:
    if caminho not in _CONTEUDO:
        with open(caminho, encoding='utf-8', errors='replace') as fh:
            _CONTEUDO[caminho] = fh.read()
    return _CONTEUDO[caminho]

# Varredura dinâmica da 297: revoga PUBLIC/anon de toda função de `public` e
# `authenticated` das funções de trigger. É dynamic SQL, então o replay estático
# não consegue expandi-la; reconhecê-la pelo texto é o que autoriza o atalho.
VARREDURA_DEFAULT_DENY = re.compile(
    r"REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+%s\s+FROM\s+PUBLIC,\s*anon", re.I)

# S01 (#659.2): helper de trigger sem GRANT explícito herda EXECUTE no
# catálogo real — os defaults da plataforma não aparecem no replay estático.
# Exigir o REVOKE explícito que fecha PUBLIC/anon/authenticated.
FECHAMENTO_TRIGGER_HELPER = re.compile(
    r'REVOKE\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION\s+'
    r'public\.upsert_portal_invoice_exception\s*\(\s*bigint\s*,\s*text\s*\)\s+FROM\s+([^;]+);',
    re.I)

# ADR 0047: o Supabase concede EXECUTE a anon/authenticated em toda função nova
# de `public` por ALTER DEFAULT PRIVILEGES próprio. Sem inverter esse default, um
# banco novo nasce aberto e nenhum REVOKE pontual no arquivo corrige isso — os
# defaults vivem em pg_default_acl, fora do schema, e não saem em pg_dump.
FECHAMENTO_DEFAULT = re.compile(
    r"ALTER\s+DEFAULT\s+PRIVILEGES[^;]*?REVOKE\s+EXECUTE\s+ON\s+FUNCTIONS\s+FROM\s+[^;]*"
    r"PUBLIC[^;]*\banon\b[^;]*;", re.I | re.S)

GUARDAS = [
    'is_active_read_user', 'is_admin(', 'is_active_user', 'current_portal_customer_id',
    '_portal_actor_role', 'portal_current_role', 'current_user_role', '_portal_inspect_guard',
    'is_financeiro_user', 'has_department', 'is_equipamentos', '42501', '28000',
]

EXCECOES = {
    'resolve_customer_portal_session': '093 (revoga anon em todas as DEFINER)',
    'portal_get_session_overview': '093 — guardada pelo segredo do token de sessão',
    'portal_list_pending_bls': '093 — guardada pelo segredo do token de sessão',
    'portal_logout': '093 — guardada pelo segredo do token de sessão',
    'portal_login': '093 — recebe a senha, verificada no corpo',
    'can_edit_customers': 'predicado de RBAC usado dentro de policies (215)',
    'can_edit_voyages': 'predicado de RBAC usado dentro de policies (215)',
    'can_edit_local_charges': 'predicado de RBAC usado dentro de policies (291)',
    'is_active_non_equipamentos_user': 'predicado de RBAC usado dentro de policies (211)',
    'current_actor_role': 'resolve o papel do próprio chamador (294)',
    'audit_row_changes': 'função de trigger; roda como owner (294)',
    'save_granite_bl_review': 'delega à função legada guardada (286)',
    'set_voyage_route_ce_master': 'sobrecarga guardada delegada (350)',
    'portal_ship_schedule': 'vitrine pública; exceção explícita da ADR 0013/297',
}


def arquivos():
    return sorted(glob.glob(os.path.join(MIGRATIONS, '*.sql')),
                  key=lambda p: int(os.path.basename(p).split('_')[0]))


def sem_comentarios(sql: str) -> str:
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    return re.sub(r'^\s*--.*$', '', sql, flags=re.M)


def separar_top(texto: str) -> list[str]:
    partes, inicio, profundidade = [], 0, 0
    aspas = False
    for i, char in enumerate(texto):
        if char == "'":
            aspas = not aspas
        elif not aspas and char == '(':
            profundidade += 1
        elif not aspas and char == ')':
            profundidade -= 1
        elif not aspas and char == ',' and profundidade == 0:
            partes.append(texto[inicio:i].strip())
            inicio = i + 1
    partes.append(texto[inicio:].strip())
    return [p for p in partes if p]


def tipos_de_argumentos(args: str) -> str:
    tipos = []
    for arg in separar_top(args):
        arg = re.sub(r'\s+(?:DEFAULT|=)\s+.*$', '', arg, flags=re.I).strip()
        arg = re.sub(r'^(?:INOUT|IN|OUT|VARIADIC)\s+', '', arg, flags=re.I)
        partes = arg.split()
        tipos.append(' '.join(partes[1:] if len(partes) > 1 else partes).lower())
    return ','.join(tipos)


def assinatura(nome: str, args: str) -> str:
    return f'{nome.lower()}({tipos_de_argumentos(args)})'


def referencias_de_funcoes(texto: str) -> list[str]:
    refs = []
    for item in separar_top(texto):
        match = re.search(r'(?:public\.)?"?(\w+)"?\s*\((.*)\)\s*$', item.strip(), re.S)
        if match:
            refs.append(assinatura(match.group(1), match.group(2)))
    return refs


def expandir_do(bloco: str) -> str:
    saida, arrays = [], {}
    for m in re.finditer(r"(\w+)\s+TEXT\[\]\s*:=\s*ARRAY\s*\[(.*?)\]\s*;", bloco, re.S | re.I):
        arrays[m.group(1)] = re.findall(r"'([^']+)'", m.group(2))
    padrao = r'FOREACH\s+(\w+)\s+IN\s+ARRAY\s+(?:ARRAY\s*\[(.*?)\]|(\w+))\s*LOOP(.*?)END\s+LOOP\s*;'
    for m in re.finditer(padrao, bloco, re.S | re.I):
        var, inline, nomeado, corpo = m.groups()
        valores = re.findall(r"'([^']+)'", inline) if inline else arrays.get(nomeado, [])
        for valor in valores:
            body = corpo

            def resolver_format(match, _valor=valor, _var=var):
                template, args = match.group(1), match.group(2)
                partes = [a.strip() for a in re.split(r',(?![^()]*\))', args)] if args else []
                resolved = []
                for arg in partes:
                    arg = re.sub(r'\b%s\b' % re.escape(_var), "'%s'" % _valor, arg.strip())
                    arg = re.sub(r"'\s*\|\|\s*'", '', arg)
                    resolved.append(re.sub(r"^'|'$", '', arg))
                out = template
                for item in resolved:
                    out = re.sub(r'%[IsL]', item, out, count=1)
                return out

            body = re.sub(r"format\(\s*'((?:[^']|'')*)'\s*(?:,(.*?))?\)", resolver_format, body, flags=re.S)
            body = re.sub(r'\b%s\b' % re.escape(var), valor, body)
            saida.append(body)
    return '\n'.join(saida)


def estado_final():
    tabelas, rls, policies = {}, set(), {}
    fns, grants = {}, {}
    # PostgreSQL grants EXECUTE to PUBLIC by default. `anon` and
    # `authenticated` inherit that privilege; they are not independent ACL
    # entries unless a migration grants them explicitly.
    defaults = {'public'}

    def dividir_funcoes(sql):
        pattern = re.compile(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\(', re.I)
        for match in pattern.finditer(sql):
            ini, nome = match.start(), match.group(1)
            abre = sql.find('(', match.start())
            profundidade, aspas, fecha = 1, False, None
            for pos in range(abre + 1, len(sql)):
                char = sql[pos]
                if char == "'":
                    aspas = not aspas
                elif not aspas and char == '(':
                    profundidade += 1
                elif not aspas and char == ')':
                    profundidade -= 1
                    if profundidade == 0:
                        fecha = pos
                        break
            if fecha is None:
                continue
            args = sql[abre + 1:fecha]
            tag = re.search(r'AS\s+(\$\w*\$)', sql[ini:ini + 6000], re.I)
            if not tag:
                fim = sql.find(';', fecha)
                if fim > 0:
                    yield assinatura(nome, args), nome.lower(), sql[ini:fim]
                continue
            marcador = tag.group(1)
            inicio_corpo = ini + tag.end()
            fim_corpo = sql.find(marcador, inicio_corpo)
            if fim_corpo < 0:
                continue
            yield assinatura(nome, args), nome.lower(), sql[ini:fim_corpo + len(marcador)]

    def aplicar_acl(comando, adicionar):
        match = re.search(
            r'(?:GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+(.+?)\s+(?:TO|FROM)\s+([^;]+);',
            comando, re.I | re.S)
        if not match:
            return
        roles = [r.strip().lower() for r in match.group(2).split(',')]
        for ref in referencias_de_funcoes(match.group(1)):
            alvo = grants.setdefault(ref, set(defaults))
            for role in roles:
                if adicionar:
                    alvo.add(role)
                else:
                    alvo.discard(role)

    for caminho in arquivos():
        bruto = ler(caminho)
        base = os.path.basename(caminho)
        sql = sem_comentarios(bruto)
        exp = sql
        for dm in re.finditer(r'DO\s*\$\$(.*?)\$\$\s*;', sql, re.S | re.I):
            exp += '\n' + expandir_do(dm.group(1))

        for m in re.finditer(r'ALTER\s+DEFAULT\s+PRIVILEGES.*?(REVOKE|GRANT)\s+EXECUTE\s+ON\s+FUNCTIONS?\s+(?:FROM|TO)\s+([^;]+);', sql, re.I | re.S):
            for role in m.group(2).split(','):
                (defaults.discard if m.group(1).upper() == 'REVOKE' else defaults.add)(role.strip().lower())

        for m in re.finditer(r'DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(.+?);', exp, re.I | re.S):
            refs = referencias_de_funcoes(m.group(1))
            for ref in refs:
                fns.pop(ref, None)
                grants.pop(ref, None)
            if not refs:
                nome = re.search(r'(?:public\.)?"?(\w+)"?', m.group(1))
                if nome:
                    for sig in [s for s, v in fns.items() if v['nome'] == nome.group(1).lower()]:
                        fns.pop(sig, None)
                        grants.pop(sig, None)

        for sig, nome, corpo in dividir_funcoes(exp):
            fns[sig] = {
                'nome': nome,
                'corpo': corpo,
                'arquivo': base,
                'secdef': bool(re.search(r'SECURITY\s+DEFINER', corpo, re.I)),
                'trigger': bool(re.search(r'RETURNS\s+TRIGGER', corpo, re.I)),
            }
            grants.setdefault(sig, set(defaults))

        # Migration 297 also closes existing functions dynamically. The
        # static replay cannot inspect pg_trigger, but RETURNS TRIGGER is the
        # same invariant used by that migration to identify trigger helpers.
        # Only assume the sweep for a file that really carries it -- assuming it
        # for a file without the loop would fabricate revokes that no database
        # ever applies.
        if VARREDURA_DEFAULT_DENY.search(sql):
            for sig, valor in fns.items():
                if valor['nome'] != 'portal_ship_schedule':
                    grants.setdefault(sig, set(defaults)).discard('public')
                    grants[sig].discard('anon')
                    if valor.get('trigger'):
                        grants[sig].discard('authenticated')

        for m in re.finditer(r'ALTER\s+FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([^)]*\)\s+RENAME\s+TO\s+"?(\w+)"?', exp, re.I):
            antigo, novo = m.group(1).lower(), m.group(2).lower()
            for sig in [s for s, v in fns.items() if v['nome'] == antigo]:
                novo_sig = novo + sig[sig.find('('):]
                fns[novo_sig] = {**fns.pop(sig), 'nome': novo}
                grants[novo_sig] = grants.pop(sig, set(defaults))

        for m in re.finditer(
                r'(?:GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+FUNCTION\s+.+?;', sql, re.I | re.S):
            aplicar_acl(m.group(0), m.group(0).upper().startswith('GRANT'))

        # Filtros de tags de event triggers (WHEN TAG/command_tag IN (...))
        # não são DDL: sem isso, CREATE TABLE AS vira a tabela fantasma
        # 'as', sem RLS, e o check [1] falha à toa.
        exp_sem_tags = re.sub(
            r'(?:WHEN\s+TAG|command_tag)\s+IN\s*\(.*?\)',
            'DDL_TAG_FILTER()',
            exp,
            flags=re.I | re.S,
        )
        for m in re.finditer(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?' + QUALIFIED_TABLE, exp_sem_tags, re.I):
            tabelas.setdefault(table_key(m), base)
        for m in re.finditer(r'DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?' + QUALIFIED_TABLE, exp, re.I):
            tabelas.pop(table_key(m), None)
            rls.discard(table_key(m))
        for m in re.finditer(r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?' + QUALIFIED_TABLE + r'\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY', exp, re.I):
            rls.add(table_key(m))
        for m in re.finditer(r'DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+(?:(public|storage)\.)?"?(\w+)"?', exp, re.I):
            policies.pop(((m.group(2) or 'public').lower(), m.group(3), m.group(1)), None)
        for m in re.finditer(r'CREATE\s+POLICY\s+"?(\w+)"?\s+ON\s+(?:(public|storage)\.)?"?(\w+)"?(.*?)(?=;)', exp, re.S | re.I):
            schema = (m.group(2) or 'public').lower()
            tabela = m.group(3)
            policies[(schema, tabela, m.group(1))] = {'corpo': ' '.join(m.group(4).split()), 'arquivo': base}
        for m in re.finditer(r'ALTER\s+POLICY\s+"?(\w+)"?\s+ON\s+(?:(public|storage)\.)?"?(\w+)"?(.*?)(?=;)', exp, re.S | re.I):
            schema = (m.group(2) or 'public').lower()
            tabela = m.group(3)
            if (schema, tabela, m.group(1)) in policies:
                policies[(schema, tabela, m.group(1))] = {'corpo': ' '.join(m.group(4).split()), 'arquivo': base}

    return tabelas, rls, policies, fns, grants


def tem_guarda(sig, fns, prof=0, vistos=None):
    vistos = vistos if vistos is not None else set()
    if sig in vistos or prof > 4:
        return None
    vistos.add(sig)
    v = fns.get(sig)
    if not v:
        return None
    baixo = sem_comentarios(v['corpo']).lower()
    for guarda in GUARDAS:
        if guarda in baixo:
            return f'{v["nome"]} -> {guarda}'
    for chamada in re.finditer(r'public\.(\w+)\s*\(', baixo, re.I):
        alvo = chamada.group(1).lower()
        for candidato, valor in fns.items():
            if valor['nome'] == alvo:
                resultado = tem_guarda(candidato, fns, prof + 1, vistos)
                if resultado:
                    return f'{v["nome"]} -> {resultado}'
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ci', action='store_true', help='sai com código 1 se houver falha')
    args = ap.parse_args()
    caminhos = arquivos()
    if not caminhos:
        print(f'Nenhuma migration encontrada em {MIGRATIONS}.', file=sys.stderr)
        print('O gate não tem o que verificar; isso é falha, não aprovação.', file=sys.stderr)
        sys.exit(1)

    tabelas, rls, policies, fns, grants = estado_final()
    falhas = []

    print(f'Migrations analisadas : {len(caminhos)}')
    print(f'Tabelas               : {len(tabelas)}')
    n_public = sum(1 for (s, _t, _n) in policies if s == 'public')
    n_storage = sum(1 for (s, _t, _n) in policies if s == 'storage')
    print(f'Policies vivas        : {len(policies)} (public: {n_public}, storage: {n_storage})')
    print(f'Funções               : {len(fns)}')
    print()

    sem_rls = sorted(t for t in tabelas if t not in rls)
    print(f'[1] RLS habilitada em todas as tabelas .......... {"OK" if not sem_rls else f"FALHA ({len(sem_rls)})"}')
    for tabela in sem_rls:
        falhas.append(f'tabela sem RLS: {tabela} ({tabelas[tabela]})')

    permissivas = []
    for (schema, tabela, nome), valor in sorted(policies.items()):
        corpo = valor['corpo'].lower()
        if (re.search(r'using\s*\(\s*true\s*\)', corpo)
                or re.search(r'with\s+check\s*\(\s*true\s*\)', corpo)
                or re.search(r"auth\.role\(\)\s*\)?\s*=\s*'authenticated'", corpo)):
            permissivas.append((schema, tabela, nome, valor))
    print(f'[2] Nenhuma policy permissiva viva ............. {"OK" if not permissivas else f"FALHA ({len(permissivas)})"}')
    for schema, tabela, nome, valor in permissivas:
        falhas.append(f'policy permissiva: {schema}.{tabela}.{nome} ({valor["arquivo"]})')

    expostas = []
    for sig, valor in sorted(fns.items()):
        acl = grants.get(sig, set())
        if not valor['secdef'] or not ({'authenticated', 'public'} & acl):
            continue
        if tem_guarda(sig, fns) or valor['nome'] in EXCECOES:
            continue
        expostas.append((sig, valor))
    print(f'[3] Toda SECURITY DEFINER exposta tem guarda .... {"OK" if not expostas else f"FALHA ({len(expostas)})"}')
    for sig, valor in expostas:
        falhas.append(f'DEFINER sem guarda concedida a authenticated: {sig} ({valor["arquivo"]})')
        print(f'      - {sig} ({valor["arquivo"]})')

    fecha_default = any(
        FECHAMENTO_DEFAULT.search(sem_comentarios(ler(c)))
        for c in caminhos
    )
    print(f'[4] Defaults de EXECUTE fechados (ADR 0047) .... {"OK" if fecha_default else "FALHA"}')
    if not fecha_default:
        falhas.append(
            'nenhuma migration inverte o ALTER DEFAULT PRIVILEGES de FUNCTIONS em public: '
            'toda função nova nasceria executável por anon/PUBLIC')

    fecha_helper = None
    for caminho in caminhos:
        for match in FECHAMENTO_TRIGGER_HELPER.finditer(sem_comentarios(ler(caminho))):
            papeis = {p.strip().lower() for p in match.group(1).split(',')}
            if {'public', 'anon', 'authenticated'} <= papeis:
                fecha_helper = os.path.basename(caminho)
    print(f'[5] Helper de trigger sem EXECUTE externo ..... {"OK" if fecha_helper else "FALHA"}')
    if not fecha_helper:
        falhas.append(
            'nenhuma migration revoga EXECUTE de public.upsert_portal_invoice_exception(bigint,text) '
            'de PUBLIC, anon e authenticated: no catálogo real o helper herdaria EXECUTE (#659.2)')

    print()
    if falhas:
        print(f'{len(falhas)} verificação(ões) falharam.')
        if args.ci:
            sys.exit(1)
    else:
        print('Todas as verificações passaram.')


if __name__ == '__main__':
    main()
