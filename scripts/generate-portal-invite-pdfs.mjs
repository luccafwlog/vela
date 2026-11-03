#!/usr/bin/env node
// Copia o tutorial do Portal (artifacts/portal-onboarding-cliente/) para um
// módulo da Edge, em base64. O convite do Portal o anexa a partir
// dele: código e PDF sobem juntos em qualquer deploy, sem download nem
// arquivo estático. Rode depois de gerar o PDF de novo; o teste
// portalInviteAttachments.test.ts recusa módulo diferente do PDF.
//
//   Uso: node scripts/generate-portal-invite-pdfs.mjs
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = [
  ['PORTAL_TUTORIAL_PDF_BASE64', 'artifacts/portal-onboarding-cliente/Tutorial_Portal_Fwlog.pdf'],
]
// O mesmo teto dos anexos de Comunicado.
const MAX_TOTAL_BYTES = 10 * 1024 * 1024
const OUTPUT = 'supabase/functions/_shared/portalInvitePdfs.generated.ts'

let total = 0
const lines = [
  '// Gerado por scripts/generate-portal-invite-pdfs.mjs. Não edite à mão: gere o',
  '// PDF de novo em artifacts/portal-onboarding-cliente/ e rode o script.',
]
for (const [name, source] of SOURCES) {
  const bytes = readFileSync(path.join(root, source))
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`${source} não é um PDF`)
  total += bytes.length
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  lines.push('', `// ${source} · ${bytes.length} bytes · sha256 ${sha256}`)
  // `: string` evita que o TypeScript carregue o literal inteiro como tipo.
  lines.push(`export const ${name}: string = '${bytes.toString('base64')}'`)
}
if (total > MAX_TOTAL_BYTES) throw new Error(`O PDF tem ${total} bytes, acima de 10 MB`)
writeFileSync(path.join(root, OUTPUT), `${lines.join('\n')}\n`)
console.log(`${OUTPUT}: ${total} bytes`)
