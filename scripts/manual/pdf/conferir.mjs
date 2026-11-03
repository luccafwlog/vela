// Confere o texto do Manual do Operador (docs/manual/texto) e dos guias
// rápidos (docs/manual/guias):
// - linguagem: nenhum termo técnico proibido no texto impresso, nenhuma marca
//   "[confirmar]" e nenhuma imagem sem captura definida;
// - citações: regra citada num comentário (`<!-- regras: … -->`) existe na
//   matriz. O texto não precisa citar todas (padrão enxuto, 2026-10-29).
//
// Uso: npm run manual:check
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, lerManual, lerGuia, nomesDosGuias, semComentarios, citacoes } from './fonte.mjs'
import { CAPTURAS } from './capturas.mjs'

const PROIBIDOS = [
  { re: /\btabelas?\b(?![- ]de[- ](cobrança|taxas|Taxas Locais))/gi, nome: 'tabela (fora de "tabela de cobrança/taxas")', foraDeNegrito: true },
  { re: /\bbanco\b/gi, nome: 'banco' },
  { re: /\bRPCs?\b/g, nome: 'RPC' },
  { re: /\bmigrations?\b/gi, nome: 'migration' },
  { re: /\bquer(y|ies)\b/gi, nome: 'query' },
  { re: /\btriggers?\b/gi, nome: 'trigger' },
  { re: /\bedge functions?\b/gi, nome: 'Edge Function' },
  { re: /\bendpoints?\b/gi, nome: 'endpoint' },
  { re: /\bcron\b/gi, nome: 'cron' },
  { re: /\bJSON\b/g, nome: 'JSON' },
  { re: /\bpayload\b/gi, nome: 'payload' },
  { re: /\bID técnico\b/gi, nome: 'ID técnico' },
  { re: /\[confirmar\]/gi, nome: '[confirmar]' },
  { re: /\bTODO\b/g, nome: 'TODO' },
]

function regrasDaMatriz() {
  const dir = path.join(ROOT, 'docs/manual/cobertura')
  const regras = new Map()
  for (const arquivo of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    for (const linha of fs.readFileSync(path.join(dir, arquivo), 'utf8').split('\n')) {
      const m = linha.match(/^\| ([A-Z]{2,4}-\d{3}) \|[^|]*\| ([^|]*) \|/)
      if (m) regras.set(m[1], { destinos: m[2].split(/[;,]/).map((d) => d.trim()), arquivo })
    }
  }
  return regras
}

const erros = []
const manual = lerManual()
// Os guias rápidos seguem as mesmas regras de linguagem e capturas.
const guias = nomesDosGuias().flatMap((nome) => lerGuia(nome).areas.map((a) => ({ ...a, arquivo: `guias/${nome}/${a.arquivo}` })))
const capitulos = [...manual.partes.flatMap((p) => p.capitulos), ...(manual.apendices || []).filter((a) => a.fonte), ...guias]
const ids = new Set(CAPTURAS.map((c) => c.id))
const escritas = new Map()
const adiadas = new Map()

for (const cap of capitulos) {
  const impresso = semComentarios(cap.fonte)
  impresso.split('\n').forEach((linha, i) => {
    for (const { re, nome, foraDeNegrito } of PROIBIDOS) {
      // O nome exato de botão ou tela, em negrito, vale como está ("**Nova tabela**").
      const alvo = foraDeNegrito ? linha.replace(/\*\*[^*]+\*\*/g, '') : linha
      for (const m of alvo.matchAll(re)) erros.push(`${cap.arquivo}:${i + 1}: termo proibido "${m[0]}" (${nome})`)
    }
    const tela = linha.match(/^:::\s*tela\b\s*(.*)$/)
    if (tela && !ids.has(tela[1].trim())) erros.push(`${cap.arquivo}:${i + 1}: captura "${tela[1].trim()}" não está em capturas.mjs`)
    if (/!\[[^\]]*\]\(/.test(linha)) erros.push(`${cap.arquivo}:${i + 1}: imagem fora de "::: tela"`)
  })
  const c = citacoes(cap.fonte)
  for (const id of c.escritas) escritas.set(id, cap.numero)
  for (const [id, destino] of c.adiadas) adiadas.set(id, destino)
}

// Desde 2026-10-29 o manual é enxuto (plano, "Padrão enxuto"): a matriz é a
// referência interna completa e o texto não precisa escrever cada regra.
// Citação que sobrar no texto ainda tem de existir na matriz.
const matriz = regrasDaMatriz()
for (const id of [...escritas.keys(), ...adiadas.keys()]) {
  if (!matriz.has(id)) erros.push(`regra citada não existe na matriz: ${id}`)
}
if (erros.length) {
  console.error(erros.join('\n'))
  process.exit(1)
}
console.log(`Texto do manual conferido: linguagem e capturas${guias.length ? ', com os guias rápidos' : ''}.`)
