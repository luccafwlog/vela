// Gera os arquivos de importação do cenário de demonstração (cenario.json):
// um arquivo de B/L por B/L no layout da COSCO (a partir do modelo do Vela),
// o Manifesto BB, a planilha de CE Mercante, o Baplie, as datas dos
// containers e a planilha de programação. Datas relativas ao dia de hoje.
//
// Saída: artifacts/manual/cenario/
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const XLSX = require('@e965/xlsx')
const AQUI = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(AQUI, '../../..')
const OUT = path.join(ROOT, 'artifacts/manual/cenario')
const c = JSON.parse(fs.readFileSync(path.join(AQUI, 'cenario.json'), 'utf8'))

const dia = (d) => {
  const x = new Date()
  x.setHours(12, 0, 0, 0)
  x.setDate(x.getDate() + d)
  return x
}
const p2 = (n) => String(n).padStart(2, '0')
const ddmmyyyy = (d, sep = '/') => `${p2(d.getDate())}${sep}${p2(d.getMonth() + 1)}${sep}${d.getFullYear()}`
const yymmdd = (d) => `${String(d.getFullYear()).slice(2)}${p2(d.getMonth() + 1)}${p2(d.getDate())}`

// Dígito verificador ISO 6346 do container.
function container(base) {
  const valores = {}
  let v = 10
  for (const letra of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (v % 11 === 0) v += 1
    valores[letra] = v
    v += 1
  }
  const soma = [...base].reduce((s, ch, i) => s + (/\d/.test(ch) ? Number(ch) : valores[ch]) * 2 ** i, 0)
  return `${base}${(soma % 11) % 10}`
}
const iso = { '40HC': '45G1', '20GP': '22G1' }

function arquivoBl(bl) {
  const wb = XLSX.readFile(path.join(ROOT, 'public/templates/bl-container-modelo.xlsx'))
  const ws = wb.Sheets['Page 1']
  const cliente = c.clientes[bl.cliente]
  const set = (ref, valor) => {
    ws[ref] = { t: 's', v: valor }
  }
  set('AC6', bl.numero)
  set('A6', 'SHANGHAI EASTERN AUTO PARTS CO., LTD.\nNO. 88 HUAJING ROAD, SHANGHAI')
  set('A10', `${cliente.nome}\nCNPJ: ${cliente.cnpj}\nE-MAIL: ${cliente.email}\nAV. NOSSA SENHORA DA PENHA, 1200 - VITORIA/ES`)
  set('A14', cliente.nome)
  set('T14', 'DESPACHANTE MODELO LTDA')
  set('G16', 'SHANGHAI')
  set('A18', `${c.novaViagem.navio} ${c.novaViagem.numero}`)
  set('G18', c.pol)
  set('A20', bl.pod)
  set('G20', bl.pod === 'BRVIX' ? 'VITORIA' : 'SALVADOR')
  const embarque = dia(c.embarqueDias)
  set('AB35', ddmmyyyy(embarque, ' '))
  set('A38', `Date of Issue ${ddmmyyyy(dia(c.embarqueDias + 1), ' ')}`)
  set('J44', bl.descricao)
  set('C46', `${bl.containers.length} CNTR`)
  // Linhas dos containers a partir da 47.
  bl.containers.forEach(([base, tipo, peso, cbm], i) => {
    set(`A${47 + i}`, `${container(base)} / SL${base.slice(-4)} / 3900 / COC / 1 PKG / ${tipo} / ${peso} KGS / ${cbm}.000 CBM`)
  })
  ws['!ref'] = `A1:AC${46 + bl.containers.length}`
  delete wb.Sheets.VIN
  wb.SheetNames = ['Page 1']
  XLSX.writeFile(wb, path.join(OUT, `bl-${bl.numero}.xlsx`))
}

function csv(nome, linhas) {
  const texto = linhas.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  fs.writeFileSync(path.join(OUT, nome), `${texto}\n`)
}

function manifestoBb() {
  const linhas = [['BL', 'MAQUINAS', 'PACKAGES', 'PACKAGES TOTAL', 'WEIGHT (TON)', 'CBM (M3)', 'SHIPPER', 'CONSIGNEE', 'NOTIFY', 'CNPJ', 'POL', 'POD']]
  for (const b of c.cargaSolta) {
    const cliente = c.clientes[b.cliente]
    linhas.push([b.numero, b.maquinas, b.packages, b.maquinas + b.packages, b.toneladas, b.cbm, 'EASTWIND HEAVY MACHINERY EXPORT CO.', cliente.nome, cliente.nome, cliente.cnpj.replace(/\D/g, ''), c.pol, b.pod])
  }
  csv('manifesto-bb.csv', linhas)
}

function planilhaCe() {
  const linhas = [['BL', 'CE MERCANTE']]
  for (const [bl, ce] of Object.entries(c.ces)) linhas.push([bl, ce])
  csv('ce-mercante-vitoria.csv', linhas)
}

function baplie() {
  const navio = c.novaViagem
  const seg = []
  seg.push('UNH+1+BAPLIE:D:95B:UN:SMDG20', 'BGM++1+9', `TDT+20+${navio.numero}+++${navio.imo}:103::${navio.navio}`, `LOC+5+${c.pol}`, 'LOC+61+BRSSA', `DTM+137:${yymmdd(dia(c.embarqueDias)).replace(/^/, '20')}0900:203`)
  let slot = 10202
  const cheio = (numero, tipo, peso, pod, bl, extra = []) => {
    seg.push(`LOC+147+00${slot}:9711:5`, `MEA+WT++KGM:${peso}`, `LOC+6+${c.pol}:139:6`, `LOC+12+${pod}:139:6`)
    if (bl) seg.push(`RFF+BM:${bl}`)
    seg.push(`EQD+CN+${numero}+${iso[tipo]}++2+5`, ...extra)
    slot += 2
  }
  for (const bl of c.bls) {
    for (const [base, tipo, peso] of bl.containers) {
      const extra = /CLASS 9 UN 3171/.test(bl.descricao) ? ['DGS+IMD+9+3171'] : []
      cheio(container(base), tipo, peso, bl.pod, bl.numero, extra)
    }
  }
  for (const [base, tipo, peso, pod] of c.baplieExtras.semBl) cheio(container(base), tipo, peso, pod, null)
  for (const [base, tipo, pod] of c.baplieExtras.vazios) {
    seg.push(`LOC+147+00${slot}:9711:5`, 'MEA+WT++KGM:2200', `LOC+6+${c.pol}:139:6`, `LOC+12+${pod}:139:6`, `EQD+CN+${container(base)}+${iso[tipo]}++2+4`)
    slot += 2
  }
  seg.push(`UNT+${seg.length + 1}+1`)
  const texto = [`UNB+UNOA:2+COSCO+FWLOG+${yymmdd(dia(c.embarqueDias))}:0900+1`, ...seg, 'UNZ+1+1'].join("'\n") + "'\n"
  fs.writeFileSync(path.join(OUT, 'baplie-sereia.edi'), texto)
}

// Datas de descarga dos containers de Vitória, como o terminal manda depois
// da descarga (um dia depois do ETA); a devolução ainda não veio.
function datasContainers() {
  const vitoria = c.escalas.find((e) => e.porto === 'BRVIX')
  const linhas = [['B/L', 'Container', 'Descarga', 'Devolução']]
  for (const bl of c.bls.filter((b) => b.pod === 'BRVIX')) {
    for (const [base] of bl.containers) linhas.push([bl.numero, container(base), ddmmyyyy(dia(vitoria.etaDias + 1)), ''])
  }
  csv('datas-containers.csv', linhas)
}

function programacao() {
  const linhas = [['VESSEL NAME', 'VOY', 'IMO', 'QINGDAO ETD', 'SHANGHAI ETD', 'TAICANG ETD', 'NINGBO ETD', 'NANSHA ETD', 'SALVADOR ETA', 'VITÓRIA ETA', 'PECÉM ETA']]
  for (const p of c.programacao) {
    linhas.push([p.navio, p.voy, p.imo, '', ddmmyyyy(dia(p.shanghaiEtd)), '', '', '', ddmmyyyy(dia(p.salvadorEta)), ddmmyyyy(dia(p.vitoriaEta)), ''])
  }
  csv('programacao-navios.csv', linhas)
}

fs.mkdirSync(OUT, { recursive: true })
for (const bl of c.bls) arquivoBl(bl)
manifestoBb()
planilhaCe()
baplie()
datasContainers()
programacao()
console.log(`Arquivos do cenário em ${path.relative(ROOT, OUT)}: ${fs.readdirSync(OUT).join(', ')}`)
