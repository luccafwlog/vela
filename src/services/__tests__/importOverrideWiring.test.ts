import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(process.cwd(), 'src')

// Regra de 2026-10-19 (ADR 0091): importação com qualquer erro é recusada
// inteira. Nenhum importador operacional oferece "forçar a importação" que
// grave só as linhas válidas; o aceite que sobra é o dos avisos.
describe('importadores operacionais sem override de erro', () => {
  it.each([
    'components/shared/VoyageImportActions.tsx',
    'components/shared/BreakbulkManifestImportModal.tsx',
    'components/shared/GraniteImportModal.tsx',
    'components/shared/VaziosImportacaoImportModal.tsx',
    'components/shared/VehicleImportModal.tsx',
    'components/shared/BlDocumentImportModal.tsx',
    'services/breakbulkImport.ts',
    'services/graniteImport.ts',
    'services/vaziosImportacaoImport.ts',
    'services/blDocumentImport.ts',
  ])('%s não tem aceite que deixe passar linha com erro', (relativePath) => {
    const source = readFileSync(resolve(sourceRoot, relativePath), 'utf8')
    expect(source).not.toContain('allowRowErrors')
    expect(source).not.toMatch(/forçar a importação/i)
  })

  it('não usa a confirmação de avisos para descartar B/Ls sem cliente', () => {
    const source = readFileSync(resolve(sourceRoot, 'components/shared/GraniteImportModal.tsx'), 'utf8')
    expect(source).not.toContain('allowPending')
  })
})
