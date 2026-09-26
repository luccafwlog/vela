type Box = { left: number; right: number }

type StripLike = {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
  getBoundingClientRect(): Box
}

type TabLike = {
  parentElement: StripLike | null
  getBoundingClientRect(): Box
}

/**
 * Traz a aba para dentro da faixa de abas rolável, mexendo só no scrollLeft
 * da faixa. scrollIntoView também rolaria a página na vertical quando a faixa
 * está abaixo da dobra.
 */
export function revealInTabStrip(tab: TabLike) {
  const strip = tab.parentElement
  if (!strip || strip.scrollWidth <= strip.clientWidth) return
  const stripBox = strip.getBoundingClientRect()
  const tabBox = tab.getBoundingClientRect()
  const start = tabBox.left - stripBox.left + strip.scrollLeft
  const end = tabBox.right - stripBox.left + strip.scrollLeft
  if (start < strip.scrollLeft) strip.scrollLeft = start
  else if (end > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = end - strip.clientWidth
}
