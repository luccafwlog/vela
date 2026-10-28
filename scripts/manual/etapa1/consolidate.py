"""Consolida os arquivos de cobertura: números, divergências por classe, itens fora."""
import collections
import glob
import json
import re
import sys

ROOT = '/home/user/vela/docs/manual/cobertura'
OUT = sys.argv[1]


def sections(text):
    current = None
    rows = collections.defaultdict(list)
    headers = {}
    for line in text.split('\n'):
        if line.startswith('## '):
            current = line[3:].strip()
            continue
        if current and line.startswith('|') and not re.match(r'^\|\s*:?-', line):
            cells = [c.strip() for c in line.split('|')[1:-1]]
            if current not in headers:
                headers[current] = cells
            else:
                rows[current].append(cells)
    return headers, rows


areas = {}
destinations = collections.Counter()
divergences = []
outside = []
for path in sorted(glob.glob(f'{ROOT}/*.md')):
    area = path.split('/')[-1][:-3]
    headers, rows = sections(open(path, encoding='utf-8').read())
    rules = [r for r in rows.get('Regras', []) if re.match(r'^[A-Z]{3}-\d', r[0])]
    for r in rules:
        for d in r[2].split(';'):
            destinations[d.strip()] += 1
    msgs = rows.get('Mensagens', [])
    msg_fora = [m for m in msgs if len(m) > 2 and m[2].strip().startswith('Fora')]
    div_header = headers.get('Divergências', [])
    for r in rows.get('Divergências', []):
        record = dict(zip(div_header, r))
        record['_area'] = area
        record['_cells'] = r
        divergences.append(record)
    for r in rows.get('Itens sem efeito na operação', []):
        outside.append({'area': area, 'item': r[0], 'motivo': r[1] if len(r) > 1 else ''})
    areas[area] = {
        'regras': len(rules),
        'mensagens': len(msgs),
        'mensagens_fora': len(msg_fora),
        'sem_efeito': len(rows.get('Itens sem efeito na operação', [])),
        'divergencias': len(rows.get('Divergências', [])),
        'capturas': len(rows.get('Capturas', [])),
        'div_header': div_header,
    }


def klass(record):
    for key, value in record.items():
        if key.lower().startswith('classe'):
            m = re.search(r'\b([abc])\b', value)
            if m:
                return m.group(1)
    for cell in record['_cells']:
        m = re.fullmatch(r'\(?([abc])\)?', cell.strip())
        if m:
            return m.group(1)
    return '?'


by_class = collections.Counter(klass(d) for d in divergences)
json.dump({
    'areas': areas,
    'destinations': destinations,
    'by_class': by_class,
    'divergences': [{**{k: v for k, v in d.items() if k != '_cells'}, '_classe': klass(d)} for d in divergences],
    'outside': outside,
}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps({a: {k: v for k, v in x.items() if k != 'div_header'} for a, x in areas.items()}, ensure_ascii=False, indent=0))
print('classes', dict(by_class))
print('totais', {k: sum(a[k] for a in areas.values()) for k in ['regras', 'mensagens', 'mensagens_fora', 'sem_efeito', 'divergencias', 'capturas']})
print('div headers', {a: x['div_header'] for a, x in areas.items()})
