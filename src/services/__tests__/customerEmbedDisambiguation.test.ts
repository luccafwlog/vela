import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const files = [
  'src/hooks/useBls.ts',
  'src/hooks/useReview.ts',
  'src/services/charges/chargeOperationsService.ts',
  'src/services/graniteCargo.ts',
]

it('qualifica os embeds de customer nas tabelas com segunda FK', () => {
  for (const file of files) {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(source).not.toMatch(/customer:customers\([^!]/)
  }
})
