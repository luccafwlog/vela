"""Tabela "fora do manual" para aprovação: itens sem efeito e mensagens Fora, por área."""
import glob, sys
sys.path.insert(0, '/tmp/claude-0/-home-user-vela/28856e0b-50c8-5c55-815e-161f0b349494/scratchpad/manual')
from covlib import parse, NAMES, ROOT  # noqa: E402

out = []
total_items = total_msgs = 0
summary = ['| Área | Itens sem efeito (linhas) | Mensagens com destino Fora |', '|---|---|---|']
for path in sorted(glob.glob(f'{ROOT}/*.md')):
    area = path.split('/')[-1][:-3]
    rows = parse(path)
    items = rows['Itens sem efeito na operação']
    fora = [m for m in rows['Mensagens'] if m.get('Destino', '').strip().startswith('Fora')]
    total_items += len(items)
    total_msgs += len(fora)
    summary.append(f"| [{NAMES[area]}](../../manual/cobertura/{area}.md#itens-sem-efeito-na-operação) | {len(items)} | {len(fora)} |")
    if items:
        out.append(f"#### {NAMES[area]}\n")
        out.append('| Item | Motivo |')
        out.append('|---|---|')
        for r in items:
            out.append(f"| {r.get('Item', '')} | {r.get('Motivo', '')} |")
        out.append('')
summary.append(f'| **Total** | **{total_items}** | **{total_msgs}** |')
open(sys.argv[1], 'w', encoding='utf-8').write('\n'.join(summary) + '\n\n' + '\n'.join(out))
print(total_items, total_msgs)
