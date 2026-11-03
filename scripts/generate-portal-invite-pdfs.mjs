#!/usr/bin/env node
// Copia os PDFs do material do Cliente (artifacts/portal-onboarding-cliente/)
// para um módulo da Edge, em base64. O convite do Portal os anexa a partir
// dele: código e PDFs sobem juntos em qualquer deploy, sem download nem
// arquivo estático. Rode depois de gerar os PDFs de novo; o teste
// portalInviteAttachments.test.ts recusa módulo diferente dos PDFs.
//
//   Uso: node scripts/generate-portal-invite-pdfs.mjs
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCES = [
  ['PORTAL_TUTORIAL_PDF_BASE64', 'artifacts/portal-onboarding-cliente/Tutorial_Portal_Fwlog.pdf'],
  ['PORTAL_QUICK_GUIDE_PDF_BASE64', 'artifacts/portal-onboarding-cliente/guia-rapido-portal-fwlog.pdf'],
]
// O mesmo teto dos anexos de Comunicado, somando os dois.
const MAX_TOTAL_BYTES = 10 * 1024 * 1024
const OUTPUT = 'supabase/functions/_shared/portalInvitePdfs.generated.ts'

let total = 0
const lines = [
  '// Gerado por scripts/generate-portal-invite-pdfs.mjs. Não edite à mão: gere os',
  '// PDFs de novo em artifacts/portal-onboarding-cliente/ e rode o script.',
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
if (total > MAX_TOTAL_BYTES) throw new Error(`Os PDFs somam ${total} bytes, acima de 10 MB`)
writeFileSync(path.join(root, OUTPUT), `${lines.join('\n')}\n`)
console.log(`${OUTPUT}: ${SOURCES.length} PDFs, ${total} bytes`)
