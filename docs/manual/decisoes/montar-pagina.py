"""Monta a página de decisões: python3 docs/manual/decisoes/montar-pagina.py saida.html"""
import json, pathlib, sys
here = pathlib.Path(__file__).parent
data = json.dumps(json.loads((here / 'fichas.json').read_text(encoding='utf-8')), ensure_ascii=False).replace('</', '<\\/')
page = (here / 'pagina-modelo.html').read_text(encoding='utf-8').replace('__DATA__', data)
pathlib.Path(sys.argv[1]).write_text(page, encoding='utf-8')
