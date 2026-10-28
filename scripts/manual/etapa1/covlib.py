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


