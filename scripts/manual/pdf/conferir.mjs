// Confere o texto do Manual do Operador (docs/manual/texto):
// - linguagem: nenhum termo técnico proibido no texto impresso, nenhuma marca
//   "[confirmar]" e nenhuma imagem sem captura definida;
// - cobertura: toda regra da matriz destinada aos capítulos do manifesto está
//   citada no texto (`<!-- regras: … -->`) ou adiada para outro capítulo
//   (`<!-- adiado: … → capítulo N -->`), e toda citação existe na matriz.
//
// Uso: npm run manual:check
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, lerManual, semComentarios, citacoes } from './fonte.mjs'
import { CAPTURAS } from './capturas.mjs'

const PROIBIDOS = [
  { re: /\btabelas?\b(?! de (cobrança|taxas|Taxas Locais))/gi, nome: 'tabela (fora de "tabela de cobrança/taxas")' },
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
const capitulos = manual.partes.flatMap((p) => p.capitulos)
const ids = new Set(CAPTURAS.map((c) => c.id))
const escritas = new Map()
const adiadas = new Map()

for (const cap of capitulos) {
  const impresso = semComentarios(cap.fonte)
  impresso.split('\n').forEach((linha, i) => {
    for (const { re, nome } of PROIBIDOS) {
      for (const m of linha.matchAll(re)) erros.push(`${cap.arquivo}:${i + 1}: termo proibido "${m[0]}" (${nome})`)
    }
    for (const m of linha.matchAll(/\]\(captura\/([\w-]+)\)/g)) {
      if (!ids.has(m[1])) erros.push(`${cap.arquivo}:${i + 1}: captura "${m[1]}" não está em capturas.mjs`)
    }
    if (/!\[[^\]]*\]\(\s*\)/.test(linha)) erros.push(`${cap.arquivo}:${i + 1}: imagem sem captura`)
  })
  const c = citacoes(cap.fonte)
  for (const id of c.escritas) escritas.set(id, cap.numero)
  for (const [id, destino] of c.adiadas) adiadas.set(id, destino)
}

const matriz = regrasDaMatriz()
const destinos = new Set(capitulos.flatMap((c) => c.matriz || []))
for (const id of [...escritas.keys(), ...adiadas.keys()]) {
  if (!matriz.has(id)) erros.push(`regra citada não existe na matriz: ${id}`)
}
const devidas = [...matriz].filter(([, r]) => r.destinos.some((d) => destinos.has(d)))
const semLugar = devidas.filter(([id]) => !escritas.has(id) && !adiadas.has(id)).map(([id]) => id)
if (semLugar.length) erros.push(`${semLugar.length} regras de ${[...destinos].join(', ')} sem lugar no texto: ${semLugar.join(' ')}`)

const escritasDevidas = devidas.filter(([id]) => escritas.has(id)).length
const adiadasDevidas = devidas.filter(([id]) => adiadas.has(id)).length
console.log(`Regras de ${[...destinos].join(', ') || 'nenhum destino'}: ${devidas.length}; escritas ${escritasDevidas}; adiadas para outro capítulo ${adiadasDevidas}.`)
if (erros.length) {
  console.error(erros.join('\n'))
  process.exit(1)
}
console.log('Texto do manual conferido: linguagem, capturas e regras.')
