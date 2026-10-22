import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnPsql } from './localPsql'
import { afterAll, expect, it } from 'vitest'
import { describeWithProbe } from './localTestData'

// Migration 408 (auditoria run-3, achados C2, C3 e C4): depois da troca de
// Cliente do B/L, o Portal do Cliente anterior não lê o que o novo Cliente fez
// com ele. Os cenários são os roteiros dos verificadores da auditoria
// (src/integration/fixtures), rodados numa transação desfeita no fim.
const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'
const workDir = mkdtempSync(join(tmpdir(), 'vela-408-'))

function migration408Applied(): boolean {
  if (!enabled) return false
  const result = spawnPsql(['-X', '-At', '-d', databaseUrl, '-c',
    `SELECT pg_get_functiondef('public._portal_list_invoices_core(bigint)'::regprocedure) LIKE '%br.customer_id = i.customer_id%';`],
  { encoding: 'utf8' })
  return result.stdout.trim() === 't'
}

// Os blocos BEGIN/COMMIT/ROLLBACK do roteiro viram savepoints; o fim de cada
// bloco dispara os gatilhos adiados, como o COMMIT faria (a reemissão para o
// novo Cliente é um deles). Erro esperado não aborta o resto
// (ON_ERROR_ROLLBACK), e nada fica gravado.
function runScenario(fixture: string): string[] {
  const body = readFileSync(join('src/integration/fixtures', fixture), 'utf8')
    .replace(/\bBEGIN;/g, 'SAVEPOINT bloco;')
    .replace(/\bCOMMIT;/g, 'SET CONSTRAINTS ALL IMMEDIATE; RELEASE SAVEPOINT bloco; RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role; RESET request.jwt.claims;')
    .replace(/\bROLLBACK;/g, 'ROLLBACK TO SAVEPOINT bloco; RELEASE SAVEPOINT bloco; RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role; RESET request.jwt.claims;')
  const file = join(workDir, fixture)
  writeFileSync(file, `\\set ON_ERROR_ROLLBACK on\nBEGIN;\n${body}\nROLLBACK;\n`)
  const result = spawnPsql(['-X', '-d', databaseUrl, '-f', file], { encoding: 'utf8' })
  return `${result.stdout}`.split('\n')
}

function row(lines: string[], label: string): string[] {
  const line = lines.find((l) => l.trim().startsWith(label))
  expect(line, label).toBeDefined()
  return line!.split('|').map((cell) => cell.trim())
}

const describeLocal = describeWithProbe(migration408Applied, 'migration408Applied (Portal sem dado do novo dono do B/L)')

describeLocal('408 — o antigo Cliente do B/L não lê o que o novo fez', () => {
  afterAll(() => rmSync(workDir, { recursive: true, force: true }))

  it('C3: detalhe da fatura antiga sem contêineres nem situação viva do B/L movido', () => {
    const out = runScenario('portalDadoVivoDoBl.sql')
    const detail = row(out, 'A detail X (after move)')
    expect(detail.at(-1)).toBe('[]')
    expect(detail[3]).toBe('')
    expect(out.filter((l) => l.trim().startsWith('A detail')).join('\n')).not.toContain('SEAL-B-NEW')
    // O novo Cliente continua vendo os contêineres do próprio B/L.
    expect(out.filter((l) => l.trim().startsWith('B own detail')).join('\n')).toContain('SEAL-B-NEW')
  })

  it('C2: fatura cancelada do antigo Cliente sem correção nem abatimento do novo; o novo vê os dele', () => {
    const out = runScenario('portalRecebivelReaproveitado.sql')
    const own = row(out, 'S5_A_details_own_cancelled')
    expect(own.at(-2)).toBe('[]')
    expect(own.at(-1)).toBe('0')
    expect(row(out, 'S3_A_list_cancelled').at(-1)).not.toBe('270.00')
    expect(row(out, 'S5_B_details_own').at(-1)).toBe('270.00')
  })

  it('C4: Minhas solicitações do antigo Cliente sem prazo derivado da baixa do novo', { timeout: 60_000 }, () => {
    const out = runScenario('desbloqueioPrazoDoClienteAtual.sql')
    const after = row(out, 'S5_A_list_after_B_pays')
    expect(after[3]).toBe('')
    expect(row(out, 'S2_A_list_before_move')[3]).not.toBe('')
    // Migration 415: o novo Cliente não vê os motivos dos documentos e da
    // entrega da solicitação do anterior; só que o Cliente do B/L mudou.
    const reasons = row(out, 'S6_B_bl_item').at(-1)
    expect(reasons).toContain('Cliente do B/L alterado')
    expect(reasons).not.toContain('Termo')
    expect(reasons).not.toContain('Procuração')
    expect(reasons).not.toContain('B/L físico')
  })
})
