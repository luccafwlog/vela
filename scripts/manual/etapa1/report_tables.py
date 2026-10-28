"""Gera as tabelas do relatório a partir dos arquivos de cobertura (fonte única)."""
import collections
import glob
import json
import re
import sys

ROOT = '/home/user/vela/docs/manual/cobertura'
NAMES = {
    '01-acesso-admin': 'Entrada, navegação, usuários e permissões',
    '02-viagens-adr': 'Viagens e ADR de Saída',
    '03-bl-revisao': 'B/L e Revisão',
    '04-ce-baplie': 'CE Mercante e Baplie',
    '05-equipamentos': 'Equipamentos',
    '06-clientes-comunicacao': 'Clientes e Comunicados',
    '07-portal': 'Portal',
    '08-desbloqueio-ce': 'Desbloqueio de CE',
    '09a-taxas-locais': 'Taxas Locais',
    '09b-faturamento': 'Faturamento',
    '10-recebimento': 'Recebimento',
    '11-demurrage': 'Demurrage',
    '12-alertas-rotinas': 'Alertas e rotinas',
}


def parse(path):
    current, rows, headers = None, collections.defaultdict(list), {}
    for line in open(path, encoding='utf-8').read().split('\n'):
        if line.startswith('## '):
            current = line[3:].strip()
            continue
        if current and line.startswith('|') and not re.match(r'^\|\s*:?-', line):
            cells = [c.strip() for c in line.split('|')[1:-1]]
            if current not in headers:
                headers[current] = cells
            else:
                rows[current].append(dict(zip(headers[current], cells)))
    return rows


def klass(row):
    m = re.search(r'\b([abc])\b', row.get('Classe', ''))
    return m.group(1) if m else '?'


out = []
counts = {}
dest = collections.Counter()
for path in sorted(glob.glob(f'{ROOT}/*.md')):
    area = path.split('/')[-1][:-3]
    rows = parse(path)
    regras = [r for r in rows['Regras'] if re.match(r'^[A-Z]{3}-\d', r.get('Nº', ''))]
    for r in regras:
        for d in r.get('Destino', '').split(';'):
            dest[d.strip()] += 1
    divs = rows['Divergências']
    counts[area] = {
        'regras': len(regras),
        'mensagens': len(rows['Mensagens']),
        'sem_efeito': len(rows['Itens sem efeito na operação']),
        'capturas': len(rows['Capturas']),
        'a': sum(klass(r) == 'a' for r in divs),
        'b': sum(klass(r) == 'b' for r in divs),
        'c': sum(klass(r) == 'c' for r in divs),
    }
    bc = [r for r in divs if klass(r) in 'bc']
    if not bc:
        continue
    out.append(f"### {NAMES[area]}\n")
    out.append(f"Arquivo: [`{area}.md`](../../manual/cobertura/{area}.md).\n")
    out.append('| Nº | Classe | Caso e o que o sistema faz | Recomendação |')
    out.append('|---|---|---|---|')
    for r in bc:
        caso = r.get('Caso prático', '').rstrip('.')
        codigo = r.get('O que o código faz', '')
        out.append(f"| {r.get('Nº')} | {klass(r)} | {caso}. {codigo} | {r.get('Recomendação', '')} |")
    out.append('')

open(sys.argv[1], 'w', encoding='utf-8').write('\n'.join(out))
json.dump({'counts': counts, 'dest': dest}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
tot = {k: sum(c[k] for c in counts.values()) for k in ['regras', 'mensagens', 'sem_efeito', 'capturas', 'a', 'b', 'c']}
print(tot)
for a, c in counts.items():
    print(a, c)
print(sorted(dest.items(), key=lambda x: -x[1]))
