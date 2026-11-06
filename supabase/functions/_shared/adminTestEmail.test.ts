// E-mail de teste da Administração › Sistema (migration 605). Roda no passo
// Deno do CI (`deno test --config supabase/functions/deno.json`).
import { adminTestEmailTemplate, decideAdminTestEmail } from './adminTestEmail.ts'

function assertEquals(actual: unknown, expected: unknown, message = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n esperado: ${e}\n recebido: ${a}`)
}

Deno.test('só a conta Dev pede o teste, e ele vai ao próprio e-mail', () => {
  assertEquals(decideAdminTestEmail({ isDev: false, email: 'dono@fwlog.com.br' }), { ok: false, status: 403, error: 'Só a conta Dev envia o e-mail de teste.' })
  assertEquals(decideAdminTestEmail({ isDev: true, email: ' Dono@FWLOG.com.br ' }), { ok: true, to: 'dono@fwlog.com.br' })
  assertEquals(decideAdminTestEmail({ isDev: true, email: null }).ok, false)
})

Deno.test('o texto diz a hora de Brasília e o estado da chave, sem HTML do nome', () => {
  const template = adminTestEmailTemplate({ name: 'Ana <b>', sentAt: new Date('2026-11-06T13:00:05Z'), communicationsEnabled: false })
  assertEquals(template.subject, 'Teste de envio do Vela')
  if (!template.text.includes('06/11/2026, 10:00:05') && !template.text.includes('06/11/2026 10:00:05')) throw new Error(template.text)
  if (!template.text.includes('Envio real desligado')) throw new Error(template.text)
  if (template.html.includes('<b>')) throw new Error(template.html)
})
