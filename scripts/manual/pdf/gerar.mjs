// Gera o PDF do Manual do Operador a partir de docs/manual/texto.
//
// Uso: npm run manual:build [-- --saida artifacts/manual/manual-do-operador.pdf]
// Precisa das capturas de `npm run manual:capture` (artifacts/manual/imagens).
//
// Duas passadas: a primeira imprime com marcas invisíveis nos títulos e lê
// do PDF em que página cada um caiu; a segunda preenche o sumário e as
// listas "Quero fazer…" com esses números.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, lerManual, capituloHtml, apendiceHtml, escapar, chip } from './fonte.mjs'
import { fontes, telas, alvo, pagina, imprimirComPaginas } from './impressao.mjs'

const arg = (nome) => {
  const i = process.argv.indexOf(nome)
  return i === -1 ? null : process.argv[i + 1]
}
const SAIDA = path.resolve(ROOT, arg('--saida') || 'artifacts/manual/manual-do-operador.pdf')

function capa(m) {
  return `<section class="pagina pagina--escura pagina-fixa" style="page: capa">
  <div class="capa">
    <div class="marca-vela">
      <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M34 8 L34 48 L56 48 Z" fill="#ffffff"/><path d="M29 21 L29 48 L11 48 Z" fill="#d4882e"/><rect x="6" y="53" width="52" height="3.4" rx="1.7" fill="#ffffff"/></svg>
      <span>Vela</span>
    </div>
    <div class="titulo">
      <div class="sobre">${escapar(m.sobre)}</div>
      <h1>${escapar(m.titulo)}</h1>
      <p>${escapar(m.subtitulo)}</p>
    </div>
    <div class="pe">
      <div>
        <div class="rotulo" style="color:#c9d2e0;margin-bottom:2mm">Cada equipe tem sua cor nas aberturas, nos quadros "Quem faz" e no guia de bolso</div>
        <div class="trilhas">
          <div style="--cor:var(--team-doc)">Documentação</div>
          <div style="--cor:var(--team-ope)">Operações</div>
          <div style="--cor:var(--team-equ)">Equipamentos</div>
          <div style="--cor:var(--team-fin)">Financeiro</div>
          <div style="--cor:var(--team-adm)">Administrativo</div>
        </div>
      </div>
      <div class="versao">
        <span><b>Versão ${escapar(m.versao)}</b> · ${escapar(m.situacao)}</span>
        <span>Descreve o Vela em <b>${escapar(m.descreve)}</b></span>
      </div>
    </div>
  </div>
</section>`
}

function sumario(m, caps) {
  const linhas = []
  for (const parte of m.partes) {
    linhas.push(`<li class="sum-parte"><a href="#parte-${parte.numero}"><span>Parte ${parte.romano} · ${escapar(parte.titulo)}</span>${pagina(`parte-${parte.numero}`)}</a></li>`)
    for (const cap of parte.capitulos) {
      const { secoes } = caps.get(cap.numero)
      linhas.push(`<li class="sum-cap"><a href="#cap-${cap.numero}"><span><b>${cap.numero}</b> ${escapar(cap.titulo)}</span>${pagina(`cap-${cap.numero}`)}</a></li>`)
      for (const s of secoes) {
        linhas.push(`<li class="sum-sec"><a href="#${s.id}"><span><b>${s.num}</b> ${s.titulo}</span>${pagina(s.id)}</a></li>`)
      }
    }
  }
  if (m.apendices?.length) {
    linhas.push(`<li class="sum-parte"><a href="#apendices"><span>Apêndices</span>${pagina('apendices')}</a></li>`)
    for (const ap of m.apendices) {
      linhas.push(`<li class="sum-cap"><a href="#ap-${ap.letra}"><span><b>${ap.letra}</b> ${escapar(ap.titulo)}</span>${pagina(`ap-${ap.letra}`)}</a></li>`)
    }
  }
  return `<section class="sumario" id="sumario">${alvo('sumario')}<h1>Sumário</h1><ol class="sum">${linhas.join('')}</ol></section>`
}

function aberturaParte(parte) {
  const caps = parte.capitulos
    .map(
      (c) =>
        `<a href="#cap-${c.numero}"><span class="n">${c.numero}</span><span class="nome">${escapar(c.titulo)}${c.resumo ? `<small>${escapar(c.resumo)}</small>` : ''}</span><span class="equipes">${(c.equipesParte || c.equipes).map(chip).join(' ')}</span></a>`,
    )
    .join('')
  return `<section class="pagina pagina-fixa" style="page: parte" id="parte-${parte.numero}">${alvo(`parte-${parte.numero}`)}
  <div class="abertura-parte">
    <div class="texto">
      <div class="sobre">Parte ${parte.romano}</div>
      <h1>${escapar(parte.titulo)}</h1>
      <p class="lead">${escapar(parte.texto)}</p>
      <nav class="lista-capitulos">${caps}</nav>
    </div>
    <div class="lateral"><span>${parte.romano}</span></div>
  </div>
</section>`
}

function capitulo(cap, { introducao, corpo, secoes }) {
  const algumas = (cap.algumas || [])
    .map((a) => `<div>${escapar(a.texto)}: ${a.equipes.map(chip).join(' ')}</div>`)
    .join('')
  const quero = secoes
    .map((s) => `<tr><td class="sec"><a href="#${s.id}">${s.num}</a></td><td><a href="#${s.id}">${s.titulo}</a></td><td class="pag">${pagina(s.id)}</td></tr>`)
    .join('')
  return `<section class="capitulo" id="cap-${cap.numero}">
  <div class="abertura" style="page: ab${cap.numero}">${alvo(`cap-${cap.numero}`)}
    <div class="abertura-cap">
      <div class="numero">${cap.numero}</div>
      <div style="display:grid;gap:2mm"><div class="sobre">Capítulo ${cap.numero}</div><h1>${escapar(cap.titulo)}</h1></div>
    </div>
    <div class="intro">${introducao.replace(/<div class="bloco bloco--aprende">[\s\S]*$/, '')}</div>
    <div class="ficha-cap">
      <div class="fato"><span class="rotulo">Quem usa</span><div class="equipes" style="margin-top:1mm">${cap.equipes.map(chip).join(' ')}</div></div>
      <div class="fato"><span class="rotulo">Só algumas equipes</span><div class="valor">${algumas || '—'}</div></div>
      <div class="fato"><span class="rotulo">Tempo de leitura</span><div class="valor"><b>${escapar(cap.leitura)}</b>${cap.antes ? `<br><span class="rotulo">${escapar(cap.antes)}</span>` : ''}</div></div>
    </div>
    ${(introducao.match(/<div class="bloco bloco--aprende">[\s\S]*$/) || [''])[0]}
    <div class="bloco bloco--quero">
      <div class="faixa">Quero fazer… <span class="aside">clique para ir à seção</span></div>
      <div class="conteudo"><table class="quero">${quero}</table></div>
    </div>
  </div>
  <div class="texto-corrido" style="page: cap${cap.numero}">${corpo.replace(/(<h2 class="secao-titulo" id="([^"]+)">)/g, (_, h, id) => `${h}${alvo(id)}`)}</div>
</section>`
}

function aberturaApendices(m) {
  const itens = m.apendices
    .map((ap) => `<a href="#ap-${ap.letra}"><span class="n">${ap.letra}</span><span class="nome">${escapar(ap.titulo)}</span><span class="equipes"></span></a>`)
    .join('')
  return `<section class="pagina pagina-fixa" style="page: parte" id="apendices">${alvo('apendices')}
  <div class="abertura-parte">
    <div class="texto">
      <div class="sobre">Apêndices</div>
      <h1>Para consultar</h1>
      <p class="lead">Os termos do Vela, as mensagens que pedem explicação, as cores de cada situação e, por objetivo, onde cada assunto está no manual.</p>
      <nav class="lista-capitulos">${itens}</nav>
    </div>
    <div class="lateral"><span>A–${m.apendices.at(-1).letra}</span></div>
  </div>
</section>`
}

function apendice(ap, { introducao, corpo }) {
  return `<section class="capitulo apendice" id="ap-${ap.letra}">
  <div class="texto-corrido" style="page: ap${ap.letra}">
    <div class="abertura-cap abertura-apendice">${alvo(`ap-${ap.letra}`)}
      <div class="numero">${ap.letra}</div>
      <div style="display:grid;gap:2mm"><div class="sobre">Apêndice ${ap.letra}</div><h1>${escapar(ap.titulo)}</h1></div>
    </div>
    ${introducao}
    ${corpo}
  </div>
</section>`
}

// Apêndice D: todas as seções do manual, em ordem alfabética do objetivo.
function indiceDeObjetivos(m, caps) {
  const semAcento = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const itens = []
  for (const parte of m.partes) {
    for (const cap of parte.capitulos) {
      // O artigo do começo não conta na ordem: "Os B/Ls e os containers" fica no B.
      for (const s of caps.get(cap.numero).secoes) {
        itens.push({ ...s, texto: s.titulo.replace(/<[^>]+>/g, '').replace(/^(o|a|os|as|um|uma) /i, '') })
      }
    }
  }
  itens.sort((a, b) => semAcento(a.texto).localeCompare(semAcento(b.texto), 'pt-BR'))
  let letra = ''
  const linhas = []
  for (const it of itens) {
    const inicial = semAcento(it.texto)[0].toUpperCase()
    if (inicial !== letra) {
      letra = inicial
      linhas.push(`<div class="letra">${letra}</div>`)
    }
    linhas.push(`<a class="item" href="#${it.id}"><span class="nome">${it.titulo}</span><span class="sec">${it.num}</span>${pagina(it.id)}</a>`)
  }
  const introducao = '<p>Todas as seções do manual, em ordem alfabética do que você quer fazer. O número em dourado é a seção; o da direita, a página.</p>'
  return { introducao, corpo: `<div class="indice-objetivos">${linhas.join('')}</div>` }
}

function paginasCss(m) {
  const regras = []
  m.partes.forEach((parte) => {
    for (const cap of parte.capitulos) {
      // A abertura do capítulo (ab) não tem cabeçalho; o texto (cap) tem.
      const aba = `@right-top { content: "PARTE ${parte.romano}"; margin-top: ${13 + (Number(parte.numero) - 1) * 26}mm; }`
      regras.push(`@page ab${cap.numero} { ${aba} }
@page cap${cap.numero} {
  @top-left { content: "Parte ${parte.romano} · ${parte.titulo}"; }
  @top-right { content: "Capítulo ${cap.numero} · ${cap.titulo}"; }
  ${aba}
}`)
    }
  })
  for (const ap of m.apendices || []) {
    regras.push(`@page ap${ap.letra} {
  @top-left { content: "Apêndices"; }
  @top-right { content: "Apêndice ${ap.letra} · ${ap.titulo}"; }
  @right-top { content: "APÊNDICES"; margin-top: ${13 + m.partes.length * 26}mm; }
}`)
  }
  return regras.join('\n')
}

;(async () => {
  const m = lerManual()
  const caps = new Map()
  for (const parte of m.partes) for (const cap of parte.capitulos) caps.set(cap.numero, capituloHtml(cap))

  let corpo = capa(m) + sumario(m, caps)
  for (const parte of m.partes) {
    corpo += aberturaParte(parte)
    for (const cap of parte.capitulos) corpo += capitulo(cap, caps.get(cap.numero))
  }
  if (m.apendices?.length) {
    corpo += aberturaApendices(m)
    for (const ap of m.apendices) {
      const conteudo = ap.gerado === 'objetivos' ? indiceDeObjetivos(m, caps) : apendiceHtml(ap)
      corpo += apendice(ap, conteudo)
    }
  }
  corpo = telas(corpo)
  const head = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(m.titulo)}</title>
<style>${fontes()}</style>
<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, 'scripts/manual/pdf/manual.css')).href}">
<style>
@page { @bottom-left { content: "${m.titulo} do Vela · versão ${m.versao}"; } }
${paginasCss(m)}
</style></head><body class="livro">`
  const html1 = `${head}${corpo}</body></html>`

  const total = await imprimirComPaginas(html1, SAIDA)
  console.log(`${total} páginas: ${path.relative(ROOT, SAIDA)}`)
})().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
