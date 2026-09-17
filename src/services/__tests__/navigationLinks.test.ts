import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd(), 'src')

function getFiles(dir: string): string[] {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry)
    if (entry === '__tests__' || entry === 'test' || entry === 'node_modules') continue
    const stat = statSync(full)
    if (stat.isDirectory()) {
      files.push(...getFiles(full))
    } else if (/\.(tsx?)$/.test(entry)) {
      files.push(full)
    }
  }
  return files
}

describe('Guarda contra links mortos /manifestos e /carga-solta', () => {
  it('nenhum arquivo de código em src aponta para rotas obsoletas /manifestos ou /carga-solta', () => {
    const files = getFiles(root)
    const deadLinks: { file: string; line: number; text: string }[] = []

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n')
      lines.forEach((line, idx) => {
        // Ignora comentários, imports e downloads de templates
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return
        if (trimmed.startsWith('import ') || trimmed.includes(' from \'') || trimmed.includes(' from "')) return
        if (line.includes('download="carga-solta-modelo') || line.includes('carga-solta-modelo.')) return
        if (/(?:\/manifestos|\/carga-solta)(?=[/'"`?#]|$)/.test(line)) {
          deadLinks.push({ file: file.replace(process.cwd() + '/', ''), line: idx + 1, text: line.trim() })
        }
      })
    }

    expect(
      deadLinks,
      `Encontrados links para rotas obsoletas:\n${deadLinks.map((d) => `  ${d.file}:${d.line} -> ${d.text}`).join('\n')}`,
    ).toEqual([])
  })
})
