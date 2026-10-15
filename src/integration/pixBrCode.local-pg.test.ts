import { execPsql } from './localPsql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeStaticPixPayload } from '../lib/pixDecoder'

const enabled = process.env.LOCAL_PG_INTEGRATION === '1'
const describeLocal = enabled ? describe : describe.skip
const databaseUrl = process.env.LOCAL_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/vela_test'

function psql(sql: string): string {
  return execPsql([
    '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-d', databaseUrl,
    '-c', `SET request.jwt.claim.role = 'service_role'; ${sql}`,
  ], { encoding: 'utf8' }).trim()
}

describeLocal('S08-C — BR Code Pix estático', () => {
  beforeAll(() => {
    psql('SELECT 1;')
  })

  afterAll(() => undefined)

  it('faz o builder SQL passar pelo decoder independente e reproduz o CRC oficial', () => {
    const payload = psql("SELECT public.build_transshipping_pix_payload(123.45, 'TESTTXID');")
    const decoded = decodeStaticPixPayload(payload)

    expect(decoded.merchantAccount.gui).toBe('br.gov.bcb.pix')
    expect(decoded.merchantAccount.pixKey).toBe('06352972000121')
    expect(decoded.amount).toBe('123.45')
    expect(decoded.txid).toBe('TESTTXID')
    expect(decoded.fields.find((field) => field.id === '26')?.children?.map((field) => field.id)).toEqual(['00', '01'])
    expect(psql("SELECT public.pix_crc16_ccitt('00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304');")).toBe('1D3D')
  })

  it('limita o txid e o valor aos contratos do BR Code', () => {
    const payload = psql("SELECT public.build_transshipping_pix_payload(1500, repeat('A', 50));")
    expect(decodeStaticPixPayload(payload).txid).toBe('A'.repeat(25))
    expect(() => psql("SELECT public.build_transshipping_pix_payload(10000000000, 'TXID');")).toThrow(/Valor PIX|13 caracteres|22023/)
  })
})
