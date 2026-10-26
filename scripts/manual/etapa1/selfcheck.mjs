// Uso: node selfcheck.mjs <area>  — lista os itens da área sem citação no arquivo de cobertura.
import fs from 'node:fs'
import path from 'node:path'
const S = path.dirname(new URL(import.meta.url).pathname)
const area = process.argv[2]
const items = JSON.parse(fs.readFileSync(`${S}/areas/${area}.json`, 'utf8'))
const file = `/home/user/vela/docs/manual/cobertura/${area}.md`
const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
const cited = new Set([...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]))
const missing = items.filter((item) => !(cited.has(item.id) || (item.kind === 'mensagem' && cited.has(item.name))))
console.log(`${area}: ${items.length - missing.length}/${items.length} itens citados`)
for (const item of missing) console.log(`  falta ${item.kind === 'mensagem' ? item.name : item.id}`)
