"""Monta o relatório da Etapa 1 a partir do modelo e dos arquivos de cobertura."""
import collections, glob, json, re, sys
S = '/tmp/claude-0/-home-user-vela/28856e0b-50c8-5c55-815e-161f0b349494/scratchpad/manual'
sys.path.insert(0, S)
from covlib import parse, NAMES, ROOT  # noqa: E402

CONF = {  # conferência independente: regras corrigidas, regras novas (dos relatórios de cada área)
    '01-acesso-admin': (18, 5), '02-viagens-adr': (21, 2), '03-bl-revisao': (13, 2), '04-ce-baplie': (26, 2),
    '05-equipamentos': (27, 5), '06-clientes-comunicacao': (9, 5), '07-portal': (21, 1), '08-desbloqueio-ce': (19, 4),
    '09a-taxas-locais': (26, 2), '09b-faturamento': (23, 2), '10-recebimento': (17, 2), '11-demurrage': (15, 3),
    '12-alertas-rotinas': (15, 3),
}

def klass(row):
    m = re.search(r'\b([abc])\b', row.get('Classe', ''))
    return m.group(1) if m else '?'

rows_area, dest, tot = [], collections.Counter(), collections.Counter()
bc_out = []
for path in sorted(glob.glob(f'{ROOT}/*.md')):
    area = path.split('/')[-1][:-3]
    r = parse(path)
    regras = [x for x in r['Regras'] if re.match(r'^[A-Z]{3}-\d', x.get('Nº', ''))]
    for x in regras:
        for d in x.get('Destino', '').split(';'):
            dest[d.strip()] += 1
    divs = r['Divergências']
    c = collections.Counter(klass(x) for x in divs)
    corr, new = CONF[area]
    rows_area.append(f"| [{NAMES[area]}](../../manual/cobertura/{area}.md) | {len(regras)} | {len(r['Mensagens'])} | {len(r['Capturas'])} | {corr} / {new} | {c['a']} / {c['b']} / {c['c']} |")
    tot.update({'regras': len(regras), 'mensagens': len(r['Mensagens']), 'capturas': len(r['Capturas']), 'corr': corr, 'new': new, 'a': c['a'], 'b': c['b'], 'c': c['c']})
    bc = [x for x in divs if klass(x) in 'bc']
    if bc:
        bc_out.append(f"#### {NAMES[area]}\n")
        bc_out.append(f"Arquivo: [`{area}.md`](../../manual/cobertura/{area}.md#divergências).\n")
        bc_out.append('| Nº | Classe | Caso e o que o sistema faz | Recomendação |')
        bc_out.append('|---|---|---|---|')
        for x in bc:
            caso = x.get('Caso prático', '').rstrip('. ')
            bc_out.append(f"| {x.get('Nº')} | {klass(x)} | {caso}. {x.get('O que o código faz', '')} | {x.get('Recomendação', '')} |")
        bc_out.append('')

fmt = lambda n: f'{n:,}'.replace(',', '.')
area_table = '\n'.join(['| Área | Regras | Mensagens | Imagens | Conferência: corrigidas / novas | Divergências a / b / c |', '|---|---|---|---|---|---|'] + rows_area +
                       [f"| **Total** | **{fmt(tot['regras'])}** | **{fmt(tot['mensagens'])}** | **{tot['capturas']}** | **{tot['corr']} / {tot['new']}** | **{tot['a']} / {tot['b']} / {tot['c']}** |"])
order = [f'Op {i}' for i in range(1, 18)] + ['Ap. A', 'Ap. B', 'Ap. C', 'Ap. D', 'Fin', 'Adm', 'Fora']
dest_rows = '\n'.join(f'| `{d}` | {dest[d]} |' for d in order if dest[d])

# Correções da classe a, pelo registro das frentes de correção.
ledger = [l.split('|') for l in open(f'{S}/docfix-ledger.txt', encoding='utf-8').read().splitlines() if l.strip()]
final = {}
for area, num, status, where in ledger:
    final[(area, num)] = (status, where)
docs = collections.Counter()
for (area, num), (status, where) in final.items():
    if status == 'corrigida':
        for d in dict.fromkeys(re.findall(r'[\w.-]+\.md', where.split(' (')[0])):
            docs[d] += 1
nc = [f"- {NAMES[a]} {n}: {w}" for (a, n), (st, w) in sorted(final.items()) if st == 'nao-corrigida']
docfix = ['| Documento | Divergências corrigidas |', '|---|---|'] + [f'| `{d}` | {c} |' for d, c in docs.most_common()]
n_fixed = sum(1 for st, _ in final.values() if st == 'corrigida')
docfix_text = (f'{n_fixed} divergências da classe a foram corrigidas: cada uma reconferida no código antes '
               'de o documento mudar, sem tocar ADR nem o arquivo histórico. Uma divergência pode ter '
               'mudado mais de um documento. Nos arquivos de área, a linha da divergência traz '
               '"Corrigida no documento em 2026-10-26".\n\n' + '\n'.join(docfix) +
               ('\n\nReclassificadas de a para b, porque o texto defasado está no próprio código e não num documento (estão na seção 6.2):\n\n' + '\n'.join(nc) if nc else ''))

t = open(f'{S}/relatorio-template.md.tmpl', encoding='utf-8').read()
rep = {
    '{{REGRAS}}': fmt(tot['regras']), '{{MENSAGENS}}': fmt(tot['mensagens']), '{{CAPTURAS}}': str(tot['capturas']),
    '{{DIV_TOTAL}}': str(tot['a'] + tot['b'] + tot['c']), '{{DIV_A}}': str(tot['a']), '{{DIV_BC}}': str(tot['b'] + tot['c']),
    '{{TABELA_AREAS}}': area_table, '{{DESTINOS}}': dest_rows, '{{TABELA_BC}}': '\n'.join(bc_out).rstrip(),
    '{{TABELA_FORA}}': open(f'{S}/fora.md', encoding='utf-8').read().rstrip(), '{{DOCFIX}}': docfix_text,
}
for k, v in rep.items():
    t = t.replace(k, v)
assert '{{' not in t, re.findall(r'\{\{\w+\}\}', t)
open(sys.argv[1], 'w', encoding='utf-8').write(t)
print(dict(tot))
