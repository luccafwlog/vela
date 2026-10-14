// Folha A4 da janela de impressão, igual à regra @media print de index.css.
// A margem vertical é da página (antes era padding do documento e a página 2
// começava colada na borda do papel); a numeração ocupa a margem inferior.
const PRINT_STYLE = [
  '@page{size:A4;margin:10mm 0 12mm;@bottom-right{content:"Página " counter(page) " de " counter(pages);font:9pt Arial,Helvetica,sans-serif;color:#4b5563;margin-right:8mm}}',
  'html,body{margin:0;background:#fff}',
  'body{font-family:Arial,Helvetica,sans-serif}',
  '.invoice-print-content{width:198mm;margin:0 auto;padding:0 8mm;box-sizing:border-box;background:#fff}',
  '*{print-color-adjust:exact;-webkit-print-color-adjust:exact}',
].join('')

export function printDocumentElement(element: HTMLElement, title: string) {
  const printWindow = window.open('', '_blank', 'width=900,height=1100')
  if (!printWindow) {
    window.print()
    return
  }

  const printDocument = printWindow.document
  printDocument.title = title

  const style = printDocument.createElement('style')
  style.textContent = PRINT_STYLE
  printDocument.head.appendChild(style)

  const wrapper = printDocument.createElement('div')
  wrapper.className = 'invoice-print-content'
  const clone = element.cloneNode(true) as HTMLElement
  while (clone.firstChild) wrapper.appendChild(clone.firstChild)
  printDocument.body.replaceChildren(wrapper)

  printWindow.focus()
  window.setTimeout(() => { printWindow.print(); printWindow.close() }, 250)
}
