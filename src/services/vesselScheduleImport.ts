import { assertUploadFile } from '../lib/fileGuard'
import { readSheet } from './importCore'

export async function parseVesselScheduleFile(file: File): Promise<Record<string, unknown>[]> {
  assertUploadFile(file, ['xlsx', 'xls', 'csv'])
  const buffer = await file.arrayBuffer()
  const { rows } = await readSheet(buffer)
  return rows
}
