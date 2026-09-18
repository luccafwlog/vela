import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(process.cwd(), 'src')

describe('contrato de override dos importadores operacionais', () => {
  it.each([
    ['components/shared/VoyageImportActions.tsx', 'allowRowErrors: Boolean(override)'],
    ['pages/Bls.tsx', 'allowRowErrors: Boolean(override)'],
    ['pages/VaziosImportacao.tsx', 'allowRowErrors: Boolean(override)'],
    ['components/shared/BlDocumentImportModal.tsx', 'allowRowErrors: Boolean(allowOverride)'],
  ])('%s encaminha confirmação explícita ao serviço', (relativePath, expected) => {
    const source = readFileSync(resolve(sourceRoot, relativePath), 'utf8')
    expect(source).toContain(expected)
  })

  it('não usa a confirmação de erros para descartar B/Ls sem cliente', () => {
    const source = readFileSync(resolve(sourceRoot, 'components/shared/VoyageImportActions.tsx'), 'utf8')
    expect(source).not.toContain('allowPending: Boolean(override)')
  })
})
