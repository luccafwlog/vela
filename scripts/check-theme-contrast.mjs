// Gate automatizado dos pares de tokens de texto, links, status e cabeçalhos
// usados pelos dois temas reais. O script não tenta inferir contraste de toda
// combinação arbitrária de CSS: ele verifica o contrato explícito de tokens.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve('src/index.css'), 'utf8')
const themes = ['light', 'dark']
const minimum = 4.5

function themeBlock(theme) {
  const marker = `:root[data-visual-theme='${theme}']`
  const markerStart = css.indexOf(marker)
  if (markerStart < 0) throw new Error(`Tema ausente: ${theme}`)
  const open = css.indexOf('{', markerStart)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error(`Bloco CSS incompleto para o tema: ${theme}`)
}

function readTokens(theme) {
  return Object.fromEntries(
    [...themeBlock(theme).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  )
}

function resolveToken(value, tokens, stack = []) {
  const resolved = String(value).replace(/var\((--[\w-]+)\)/g, (_match, name) => {
    if (stack.includes(name)) throw new Error(`Referência circular de token: ${stack.join(' → ')} → ${name}`)
    if (!(name in tokens)) throw new Error(`Token não encontrado: ${name}`)
    return resolveToken(tokens[name], tokens, [...stack, name])
  })
  return resolved.trim()
}

function parseColor(value) {
  const text = value.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (text.startsWith('#')) {
    const hex = text.slice(1)
    if (![3, 4, 6, 8].includes(hex.length)) throw new Error(`Hex inválido: ${value}`)
    const expanded = hex.length <= 4 ? [...hex].map((part) => part + part).join('') : hex
    const channel = (start) => Number.parseInt(expanded.slice(start, start + 2), 16)
    return { r: channel(0), g: channel(2), b: channel(4), a: expanded.length === 8 ? channel(6) / 255 : 1 }
  }
  const match = text.match(/^rgba?\(([^)]+)\)$/)
  if (!match) throw new Error(`Cor não suportada no token: ${value}`)
  const parts = match[1].replaceAll('/', ',').split(',').map((part) => part.trim())
  const channel = (part) => part.endsWith('%') ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part)
  return {
    r: channel(parts[0]),
    g: channel(parts[1]),
    b: channel(parts[2]),
    a: parts[3] == null ? 1 : (parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3])),
  }
}

function over(foreground, background) {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
    g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
    b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
    a: alpha,
  }
}

function opaque(color, under) {
  return color.a >= 1 ? color : over(color, under)
}

function luminance(color) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

const checks = [
  ['body text on background', '--app-text', '--app-bg'],
  ['body text on surface', '--app-text', '--app-surface-strong'],
  ['strong text on surface', '--app-text-strong', '--app-surface-strong'],
  ['muted text on surface', '--app-muted', '--app-surface-strong'],
  ['soft muted text on surface', '--app-muted-soft', '--app-surface-strong'],
  ['link on surface', '--app-link', '--app-surface-strong'],
  ['gold status on gold surface', '--app-gold-strong', '--app-gold-soft'],
  ['green status on green surface', '--app-green', '--app-green-soft'],
  ['red status on red surface', '--app-red', '--app-red-soft'],
  ['navigation badge text on badge', '--app-navy', '--app-gold'],
  ['table heading text on table heading', '--app-thead-text', '--app-thead-bg'],
]

const rows = []
for (const theme of themes) {
  const tokens = readTokens(theme)
  const under = parseColor(resolveToken(tokens['--app-surface-strong'], tokens))
  for (const [label, foregroundToken, backgroundToken] of checks) {
    const foreground = opaque(parseColor(resolveToken(tokens[foregroundToken], tokens)), under)
    const background = opaque(parseColor(resolveToken(tokens[backgroundToken], tokens)), under)
    const ratio = contrast(foreground, background)
    rows.push({ theme, label, foregroundToken, backgroundToken, ratio: Number(ratio.toFixed(2)), minimum, pass: ratio >= minimum })
  }
}

console.log(JSON.stringify({ minimum, rows }, null, 2))
const failures = rows.filter((row) => !row.pass)
if (failures.length) {
  console.error(`Contraste insuficiente em ${failures.length} par(es) de token.`)
  process.exitCode = 1
}
