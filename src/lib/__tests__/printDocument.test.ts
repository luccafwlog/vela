// @vitest-environment jsdom

import { afterEach, expect, it, vi } from 'vitest'
import { printDocumentElement } from '../printDocument'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('imprime o clone do documento numa folha A4 com margem em toda página e numeração', () => {
  vi.useFakeTimers()
  const popup = { document: document.implementation.createHTMLDocument(''), focus: vi.fn(), print: vi.fn(), close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(popup as never)
  const source = document.createElement('div')
  source.innerHTML = '<p>Fatura FAT-1</p>'
  printDocumentElement(source, 'FAT-1 - FATURA')

  expect(popup.document.title).toBe('FAT-1 - FATURA')
  // Antes: @page com margem zero e padding só no início — a página 2 começava
  // colada na borda do papel.
  const style = popup.document.head.textContent ?? ''
  expect(style).toContain('@page{size:A4;margin:10mm 0 12mm;')
  expect(style).toContain('counter(pages)')
  expect(popup.document.body.querySelector('.invoice-print-content')?.textContent).toContain('Fatura FAT-1')
  vi.advanceTimersByTime(300)
  expect(popup.print).toHaveBeenCalledTimes(1)
})
