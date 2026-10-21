import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEPARTMENTS,
  PERMISSION_GROUPS,
  PERMISSION_MATRIX,
  allowedDepartments,
  capabilitiesFor,
  isSharedByAll,
  rowsByGroup,
  type Department,
} from '../permissionMatrix'

// O catálogo da tela fica preso à bateria por perfil: cada linha cita casos que
// existem nela, e a exceção citada permite exatamente os setores da linha. A
// bateria (local-pg) confere os mesmos casos no Postgres.
const battery = readFileSync(resolve(process.cwd(), 'src/integration/permissoesPorPerfil.local-pg.test.ts'), 'utf8')

function section(name: string): string {
  const start = battery.indexOf(`const ${name}`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  return battery.slice(start, battery.indexOf('\n  ]\n', start))
}

const constants: Record<string, Department[]> = Object.fromEntries(
  [...battery.matchAll(/const (\w+): Profile\[\] = \[([^\]]*)\]/g)].map(([, name, list]) => [name, parseList(list)]),
)

function parseList(list: string): Department[] {
  return [...list.matchAll(/'(\w+)'/g)].map(([, value]) => value as Department)
}

const exceptions = new Map(
  [...section('MATRIX_EXCEPTIONS').matchAll(/\{ row: '([^']+)', allowed: (\w+|\[[^\]]*\])/g)].map(([, row, allowed]) => [
    row,
    allowed.startsWith('[') ? parseList(allowed) : constants[allowed],
  ]),
)
const globals = new Set([...section('MATRIX_GLOBAL').matchAll(/\{ row: '([^']+)', statement:/g)].map(([, row]) => row))
const titles = [...battery.matchAll(/\bit(?:\.each\([^)]*\))?\(\s*'([^']+)'/g)].map(([, title]) => title)

describe('catálogo "O que cada setor pode"', () => {
  it('tem as 39 linhas da página aprovada, nos nove assuntos, com os cinco setores', () => {
    expect(PERMISSION_MATRIX).toHaveLength(39)
    expect(rowsByGroup().map(({ group }) => group.label)).toEqual(PERMISSION_GROUPS.map((group) => group.label))
    expect(new Set(PERMISSION_MATRIX.map((row) => row.id)).size).toBe(PERMISSION_MATRIX.length)
    for (const row of PERMISSION_MATRIX) {
      expect(Object.keys(row.can).sort(), row.id).toEqual([...DEPARTMENTS].sort())
      expect(PERMISSION_GROUPS.some((group) => group.id === row.group), row.id).toBe(true)
    }
  })

  it('a bateria tem as tabelas de exceção e de ações de todos', () => {
    expect(exceptions.size).toBeGreaterThan(30)
    expect(globals.size).toBeGreaterThan(10)
    expect(titles.length).toBeGreaterThan(30)
  })

  it.each(PERMISSION_MATRIX.map((row) => [row.id, row] as const))('%s cita ao menos um caso da bateria, e cada caso existe', (_id, row) => {
    expect(row.proof.length).toBeGreaterThan(0)
    for (const proof of row.proof) {
      if (proof.startsWith('exceção: ')) {
        const allowed = exceptions.get(proof.slice('exceção: '.length))
        expect(allowed, proof).toBeDefined()
        expect([...(allowed ?? [])].sort(), proof).toEqual([...allowedDepartments(row)].sort())
      } else if (proof.startsWith('todos: ')) {
        expect(globals.has(proof.slice('todos: '.length)), proof).toBe(true)
        expect(isSharedByAll(row), proof).toBe(true)
      } else if (proof.startsWith('caso: ')) {
        const prefix = proof.slice('caso: '.length)
        expect(titles.some((title) => title.startsWith(prefix)), proof).toBe(true)
      } else {
        throw new Error(`Referência sem tipo: ${proof}`)
      }
    }
  })

  it('não mostra o papel extinto nem a palavra técnica do envio de alertas', () => {
    const text = JSON.stringify(PERMISSION_MATRIX)
    expect(text).not.toMatch(/Administrador\b|fallback/i)
  })
})

describe('capabilitiesFor (lista da janela de usuário)', () => {
  it('Documentação provisiona o Portal e gere o Desbloqueio, mas não registra pagamento nem cancela fatura', () => {
    const doc = capabilitiesFor('documentacao')
    expect(doc.can).toContain('Provisionar o Portal: convite (enviar e cancelar), conta, e-mail de recuperação, reabrir análise')
    expect(doc.can).toContain('Gerir pedidos, documentos, exportação para a ZPT e conciliação')
    expect(doc.can).toContain('Assinar e observar a seção do ADR de Saída: só a própria seção')
    expect(doc.can).toContain('Recebe os alertas do próprio setor: 37 tipos')
    expect(doc.cannot).toContain('Registrar pagamento (baixa manual) e confirmar Restituição')
    expect(doc.cannot).toContain('Cancelar fatura, cancelar baixa e preparar cancelamento financeiro de B/L')
  })

  it('o Administrativo pode todas as exclusivas, menos desativar o último Administrativo', () => {
    expect(capabilitiesFor('administrativo').cannot).toEqual(['Desativar ou rebaixar o último Administrativo ativo'])
  })

  it('cada ação exclusiva aparece uma vez, em "pode" ou em "não pode", para todo setor', () => {
    const exclusive = PERMISSION_MATRIX.filter((row) => !isSharedByAll(row)).length
    for (const department of DEPARTMENTS) {
      const { can, cannot } = capabilitiesFor(department)
      expect(can.length + cannot.length, department).toBe(exclusive)
    }
  })
})
