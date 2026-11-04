import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as ExcelJS from 'exceljs'
import { exportLineUpWorkbook } from '../exports'
import { buildWorkbook, type WorkbookSpec } from '../exportWorkbook'
import type { LineUpRow } from '../lineup'

const { writeWorkbook } = vi.hoisted(() => ({ writeWorkbook: vi.fn<(spec: unknown) => Promise<void>>(async () => {}) }))

vi.mock('../exportWorkbook', async (importOriginal) => ({ ...(await importOriginal<typeof import('../exportWorkbook')>()), writeWorkbook }))

describe('exportLineUpWorkbook - injeção de fórmula', () => {
  beforeEach(() => { writeWorkbook.mockClear() })
  it('neutraliza valores de célula iniciados por metacaractere de fórmula até a célula gravada', async () => {
    const rows = [{ vesselName: '=cmd|calc', voyageNumber: '001', pod: 'SSZ', vin: 1, car: 0, cg: 0, total: 1, mty: 0 }] as unknown as LineUpRow[]
    await exportLineUpWorkbook(rows)
    const spec = writeWorkbook.mock.calls[0][0] as unknown as WorkbookSpec
    const sheet = buildWorkbook(ExcelJS, spec).getWorksheet('Line-Up')!
    const headerRow = (sheet.views[0] as { ySplit?: number }).ySplit!
    const navio = sheet.getRow(headerRow + 1).getCell(1)
    expect(navio.value).toBe("'=cmd|calc")
    expect(navio.type).toBe(ExcelJS.ValueType.String)
  })
})
