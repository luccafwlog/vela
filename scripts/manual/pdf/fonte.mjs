// Lê o texto do Manual do Operador (docs/manual/texto) e monta o HTML que o
// Chromium imprime. O formato do texto está em docs/manual/texto/README.md.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import GithubSlugger from 'github-slugger'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const TEXTO = path.join(ROOT, 'docs/manual/texto')

export const EQUIPES = {
  Documentação: 'doc',
  Operações: 'ope',
  Equipamentos: 'equ',
  Financeiro: 'fin',
  Administrativo: 'adm',
  'Todas as equipes': 'todas',
  'Qualquer equipe': 'todas',
}

const QUADROS = {
  sozinho: 'O sistema faz sozinho',
  atencao: 'Atenção',
  'nao-faca': 'Não faça',
  porque: 'Por que é assim',
}

export function lerManual() {
  const manifesto = JSON.parse(fs.readFileSync(path.join(TEXTO, 'manual.json'), 'utf8'))
  for (const parte of manifesto.partes) {
    for (const cap of parte.capitulos) {
      cap.parte = parte
      cap.fonte = fs.readFileSync(path.join(TEXTO, cap.arquivo), 'utf8')
    }
  }
  // Apêndice escrito (`arquivo`) ou gerado do próprio manual (`gerado`).
  for (const ap of manifesto.apendices || []) {
    if (ap.arquivo) ap.fonte = fs.readFileSync(path.join(TEXTO, ap.arquivo), 'utf8')
  }
  return manifesto
}

// Guia rápido (docs/manual/guias/<nome>): guia.json e um Markdown por área,
// no mesmo formato do texto do manual. As áreas fazem o papel de capítulo.
export const GUIAS = path.join(ROOT, 'docs/manual/guias')

export function lerGuia(nome) {
  const dir = path.join(GUIAS, nome)
  const guia = JSON.parse(fs.readFileSync(path.join(dir, 'guia.json'), 'utf8'))
  for (const area of guia.areas) area.fonte = fs.readFileSync(path.join(dir, area.arquivo), 'utf8')
  return guia
}

export function nomesDosGuias() {
  if (!fs.existsSync(GUIAS)) return []
  return fs.readdirSync(GUIAS).filter((n) => fs.existsSync(path.join(GUIAS, n, 'guia.json')))
}

export function escapar(texto) {
  return String(texto).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

export function chip(nome) {
  const codigo = EQUIPES[nome]
  if (!codigo) throw new Error(`Equipe desconhecida: {{${nome}}}`)
  return `<span class="equipe equipe--${codigo}">${escapar(nome)}</span>`
}

// Texto impresso sem os comentários (citação de regras e adiamentos).
export function semComentarios(fonte) {
  return fonte.replace(/<!--[\s\S]*?-->/g, '')
}

// `::: tipo resto` abre um bloco e `:::` fecha o último aberto; cada bloco
// sabe o próprio fechamento.
function blocos(fonte, arquivo) {
  const pilha = []
  const saida = []
  fonte.split('\n').forEach((linha, i) => {
    const onde = `${arquivo}:${i + 1}`
    const abre = linha.match(/^:::\s*([\w-]+)\s*(.*)$/)
    if (abre) {
      const bloco = abrirBloco(abre[1], abre[2].trim(), onde)
      pilha.push({ ...bloco, tipo: abre[1] })
      saida.push('', bloco.abre, '')
      return
    }
    if (/^:::\s*$/.test(linha)) {
      const bloco = pilha.pop()
      if (!bloco) throw new Error(`${onde}: ":::" sem bloco aberto`)
      saida.push('', bloco.fecha, '')
      return
    }
    saida.push(linha)
  })
  if (pilha.length) throw new Error(`${arquivo}: bloco "${pilha.at(-1).tipo}" sem ":::" de fechamento`)
  return saida.join('\n')
}

function abrirBloco(tipo, resto, onde) {
  if (QUADROS[tipo]) {
    return {
      abre: `<div class="quadro quadro--${tipo}"><div class="titulo"><span class="icone icone--${tipo}"></span>${escapar(resto || QUADROS[tipo])}</div>`,
      fecha: '</div>',
    }
  }
  const comFaixa = (classe, faixa) => ({
    abre: `<div class="bloco ${classe}"><div class="faixa">${faixa}</div><div class="conteudo">`,
    fecha: '</div></div>',
  })
  switch (tipo) {
    case 'aprende':
      return comFaixa('bloco--aprende', 'Neste capítulo você aprende a')
    case 'conferir':
      return comFaixa('bloco--conferir', 'Onde conferir')
    case 'ficha':
      return { abre: '<div class="bloco ficha"><div class="conteudo">', fecha: '</div></div>' }
    case 'passos':
      return { abre: '<div class="passos-bloco">', fecha: '</div>' }
    case 'lado':
      return { abre: '<div class="colunas-passos">', fecha: '</div>' }
    case 'tela':
      if (!/^[\w-]+$/.test(resto)) throw new Error(`${onde}: "tela" sem o id da captura`)
      return {
        abre: `<figure class="tela"><div class="tela__quadro" data-captura="${resto}"></div><figcaption>`,
        fecha: '</figcaption></figure>',
      }
    case 'aconteceu':
      if (!resto) throw new Error(`${onde}: "aconteceu" sem título`)
      return {
        abre: `<article class="aconteceu"><div class="faixa"><span class="tag">Aconteceu…</span><h3>${inline(resto)}</h3></div><div class="corpo-card">`,
        fecha: '</div></article>',
      }
    case 'mensagem':
      if (!resto) throw new Error(`${onde}: "mensagem" sem texto`)
      return {
        abre: `<article class="mensagem"><div class="texto"><span class="icone icone--erro"></span><span>${escapar(resto)}</span></div><div class="corpo-card">`,
        fecha: '</div></article>',
      }
    default:
      throw new Error(`${onde}: bloco desconhecido "${tipo}"`)
  }
}

function inline(texto) {
  return micromark(texto, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }).replace(/^<p>|<\/p>\n?$/g, '')
}

export function slug(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Markdown de um capítulo → { introducao, corpo, secoes }.
export function capituloHtml(cap) {
  let fonte = semComentarios(cap.fonte)
  fonte = fonte.replace(/\{\{([^}]+)\}\}/g, (_, nome) => chip(nome.trim()))
  fonte = blocos(fonte, cap.arquivo)
  let html = micromark(fonte, {
    allowDangerousHtml: true,
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()],
  })

  // A âncora da seção é a do GitHub (o título), para o mesmo link servir no
  // repositório, no docs:check e no PDF.
  const ancoras = ancorasDasSecoes(cap.fonte)
  const secoes = []
  html = html.replace(/<h2>(\d+\.\d+)\s+(.+?)<\/h2>/g, (_, num, titulo) => {
    const id = ancoras.get(num)
    secoes.push({ id, num, titulo })
    return `<h2 class="secao-titulo" id="${id}"><span class="num">${num}</span><span>${titulo}</span></h2>`
  })
  html = linksInternos(html)
  html = html.replace(/<h3>(.+?)<\/h3>/g, (_, titulo) => `<h3 class="sub" id="${cap.numero}-${slug(titulo)}">${titulo}</h3>`)

  // A legenda do `::: tela` é um parágrafo; sem legenda, sem figcaption.
  html = html
    .replace(/<figcaption>\s*<p>([\s\S]*?)<\/p>\s*<\/figcaption>/g, '<figcaption>$1</figcaption>')
    .replace(/<figcaption>\s*<\/figcaption>/g, '')

  const corte = html.indexOf('<h2 ')
  const introducao = corte === -1 ? html : html.slice(0, corte)
  const corpo = corte === -1 ? '' : html.slice(corte)
  return { introducao, corpo, secoes }
}

// Link para outro capítulo (`06-importacao.md#62-…`, ou só `19-….md`) ou
// apêndice (`ap-b-mensagens.md#viagens`, ou só `ap-b-….md`) vira link
// interno do PDF.
function linksInternos(html) {
  return html
    .replace(/href="\d{2}-[\w-]+\.md#/g, 'href="#')
    .replace(/href="(\d{2})-[\w-]+\.md"/g, (_, n) => `href="#cap-${Number(n)}"`)
    .replace(/href="ap-([a-z])-[\w-]+\.md#/g, (_, letra) => `href="#ap${letra.toUpperCase()}-`)
    .replace(/href="ap-([a-z])-[\w-]+\.md"/g, (_, letra) => `href="#ap-${letra.toUpperCase()}"`)
}

// Markdown de um apêndice → { introducao, corpo }. Os títulos `## Assunto`
// não têm número; a âncora é a do GitHub com o prefixo do apêndice.
export function apendiceHtml(ap) {
  let fonte = semComentarios(ap.fonte)
  fonte = fonte.replace(/\{\{([^}]+)\}\}/g, (_, nome) => chip(nome.trim()))
  fonte = blocos(fonte, ap.arquivo)
  let html = micromark(fonte, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] })
  const slugger = new GithubSlugger()
  html = html.replace(/<h2>(.+?)<\/h2>/g, (_, titulo) => {
    const id = `ap${ap.letra}-${slugger.slug(titulo.replace(/<[^>]+>/g, '').trim())}`
    return `<h2 class="secao-titulo" id="${id}"><span>${titulo}</span></h2>`
  })
  html = linksInternos(html)
  const corte = html.indexOf('<h2 ')
  return { introducao: corte === -1 ? html : html.slice(0, corte), corpo: corte === -1 ? '' : html.slice(corte) }
}

// Âncora de cada `## N.M Título` do capítulo, pelo algoritmo do GitHub.
export function ancorasDasSecoes(fonte) {
  const slugger = new GithubSlugger()
  const mapa = new Map()
  for (const m of semComentarios(fonte).matchAll(/^##\s+(.+)$/gm)) {
    const slug = slugger.slug(m[1].replace(/[*_`]/g, '').trim())
    const num = m[1].match(/^(\d+\.\d+)\s/)
    if (num) mapa.set(num[1], slug)
  }
  return mapa
}

// Citações de regras no texto: `<!-- regras: VIA-011 VIA-012 -->` e
// `<!-- adiado: EQU-049 → capítulo 10 -->`.
export function citacoes(fonte) {
  const escritas = new Set()
  const adiadas = new Map()
  for (const m of fonte.matchAll(/<!--\s*regras:([\s\S]*?)-->/g)) {
    for (const id of m[1].match(/[A-Z]{2,4}-\d{3}/g) || []) escritas.add(id)
  }
  for (const m of fonte.matchAll(/<!--\s*adiado:([\s\S]*?)-->/g)) {
    const [ids, destino] = m[1].split('→')
    if (!destino) throw new Error(`Adiamento sem destino: ${m[0]}`)
    for (const id of ids.match(/[A-Z]{2,4}-\d{3}/g) || []) adiadas.set(id, destino.trim())
  }
  return { escritas, adiadas }
}
