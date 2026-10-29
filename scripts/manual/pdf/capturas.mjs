// Telas do Manual do Operador. Cada captura executa o procedimento como o
// operador faria, no Vela local com o cenário de demonstração, e devolve o
// recorte e as marcações (número do passo, posição do elemento na tela e,
// quando é o botão a clicar, o destaque). Ver README desta pasta.
//
// Posição da marcação: canto do elemento (padrão); `campo` (dentro do campo, à
// direita, sem cobrir rótulo nem valor); `esquerda`; `direita`.

// Caixa de um elemento relativa ao recorte, em pixels CSS.
export async function caixa(locator, clip) {
  const b = await locator.boundingBox()
  if (!b) throw new Error(`Elemento sem posição na tela: ${locator}`)
  return { x: b.x - clip.x, y: b.y - clip.y, w: b.width, h: b.height }
}

export async function marca(n, locator, clip, extra = {}) {
  return { n, ...(await caixa(locator, clip)), ...extra }
}

// Recorte que envolve os elementos, com folga.
export async function recorteDe(page, locators, folga = 16) {
  const caixas = []
  for (const l of locators) {
    const b = await l.boundingBox()
    if (!b) throw new Error(`Elemento sem posição na tela: ${l}`)
    caixas.push(b)
  }
  const vp = page.viewportSize()
  const x = Math.max(0, Math.min(...caixas.map((b) => b.x)) - folga)
  const y = Math.max(0, Math.min(...caixas.map((b) => b.y)) - folga)
  const x2 = Math.min(vp.width, Math.max(...caixas.map((b) => b.x + b.width)) + folga)
  const y2 = Math.max(...caixas.map((b) => b.y + b.height)) + folga
  return { x, y, width: x2 - x, height: y2 - y }
}

export async function recorteDoElemento(locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error(`Elemento sem posição na tela: ${locator}`)
  return { x: b.x, y: b.y, width: b.width, height: b.height }
}

async function abrir(page, base, rota) {
  await page.goto(`${base}${rota}`, { waitUntil: 'networkidle' })
}

// Abre a ficha da Viagem do cenário pela lista, como o operador faria.
async function abrirViagem(page, base, cenario, aba) {
  await abrir(page, base, '/viagens')
  const nome = `${cenario.novaViagem.navio} / ${cenario.novaViagem.numero}`
  await page.getByRole('link', { name: nome, exact: true }).first().click()
  await page.getByRole('heading', { name: nome, level: 2 }).waitFor()
  if (aba) await page.getByRole('tab', { name: aba, exact: true }).click()
  await page.waitForLoadState('networkidle')
}

// Bloco da tela (faixa azulada com título).
function bloco(page, titulo) {
  return page.locator('.app-block').filter({ has: page.getByRole('heading', { name: titulo, exact: true }) }).last()
}

// Escolhe a Viagem do cenário no campo de busca "Navio / Viagem" das janelas
// de importação (a lista de opções abre fora da janela).
async function escolherViagem(page, campo, cenario) {
  await campo.fill(cenario.novaViagem.navio.split(' ').pop())
  await page.getByRole('option', { name: new RegExp(`${cenario.novaViagem.navio} / ${cenario.novaViagem.numero}`) }).click()
}

// Seção da tela pelo título (bloco ou seção com cabeçalho próprio).
function secao(page, titulo) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: titulo, exact: true }) }).last()
}

const iso = (dias) => {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

export const CAPTURAS = [
  {
    id: 'viagens-topo',
    capitulo: 4,
    async fazer({ page, base }) {
      await abrir(page, base, '/viagens')
      const nav = page.locator('header').getByRole('link', { name: 'Viagens', exact: true })
      const nova = page.getByRole('button', { name: 'Nova Viagem' })
      await nova.waitFor()
      const barra = await page.locator('header.app-header').boundingBox()
      const b = await nova.boundingBox()
      const clip = { x: 0, y: barra.y, width: page.viewportSize().width, height: b.y + b.height + 18 - barra.y }
      return { clip, marks: [await marca(1, nav, clip, { destaque: true }), await marca(2, nova, clip, { destaque: true })] }
    },
  },
  {
    id: 'nova-viagem',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      await abrir(page, base, '/viagens')
      await page.getByRole('button', { name: 'Nova Viagem' }).click()
      const dlg = page.getByRole('dialog')
      await dlg.waitFor()
      await dlg.getByLabel('Navio').fill(cenario.novaViagem.navio)
      await dlg.getByLabel('IMO').fill(cenario.novaViagem.imo)
      await dlg.getByLabel('Numero da viagem').fill(cenario.novaViagem.numero)
      const chave = dlg.getByRole('switch')
      await chave.click()
      await dlg.getByLabel('Navio').blur()
      await page.waitForTimeout(300)
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Navio'), clip, { posicao: 'campo' }),
          await marca(3, chave, clip, { posicao: 'esquerda' }),
          await marca(4, dlg.getByRole('button', { name: 'Cadastrar viagem' }), clip, { destaque: true }),
        ],
        async depois() {
          await dlg.getByRole('button', { name: 'Cadastrar viagem' }).click()
          await page.getByText('Viagem cadastrada com sucesso.').waitFor()
        },
      }
    },
  },
  {
    id: 'viagem-planejamento-vazio',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      await abrirViagem(page, base, cenario)
      const b = bloco(page, 'Planejamento por escala')
      const clip = await recorteDoElemento(b)
      return { clip, marks: [await marca(1, b.getByRole('button', { name: 'Adicionar escala' }), clip, { destaque: true })] }
    },
  },
  {
    id: 'adicionar-escala',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      const [primeira, ...outras] = cenario.escalas
      const preencher = async (dlg, e) => {
        await dlg.getByLabel('Porto da escala').fill(e.porto)
        await dlg.getByLabel('ETA', { exact: true }).fill(iso(e.etaDias))
        await dlg.getByLabel('ETA Hora').fill(e.hora)
      }
      await abrirViagem(page, base, cenario)
      await page.getByRole('button', { name: 'Adicionar escala' }).click()
      const dlg = page.getByRole('dialog')
      await preencher(dlg, primeira)
      await dlg.getByLabel('ETA Hora').blur()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Porto da escala'), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByLabel('ETA', { exact: true }), clip, { posicao: 'campo' }),
          await marca(4, dlg.getByRole('button', { name: /Somente importação/ }), clip),
          await marca(5, dlg.getByRole('button', { name: 'Adicionar escala' }), clip, { destaque: true }),
        ],
        async depois() {
          await dlg.getByRole('button', { name: 'Adicionar escala' }).click()
          await dlg.waitFor({ state: 'detached' })
          for (const e of outras) {
            await page.getByRole('button', { name: 'Adicionar escala' }).click()
            const d = page.getByRole('dialog')
            await preencher(d, e)
            await d.getByRole('button', { name: 'Adicionar escala' }).click()
            await d.waitFor({ state: 'detached' })
          }
        },
      }
    },
  },
  {
    id: 'escala-terminais',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      const e = cenario.escalas.find((x) => x.terminal)
      await abrirViagem(page, base, cenario)
      await page.getByRole('button', { name: `Editar planejamento da escala ${e.porto}` }).click()
      const dlg = page.getByRole('dialog')
      const secao = dlg.getByRole('heading', { name: 'Terminais e atracações' })
      await secao.waitFor()
      const terminal = dlg.getByLabel(/Terminal da operação Importação Carga cheia/)
      await terminal.selectOption({ label: e.terminal })
      await dlg.getByLabel(`ETB ${e.terminal}`, { exact: true }).fill(iso(e.etaDias))
      await dlg.getByLabel(`ETB ${e.terminal} Hora`).fill('18:00')
      await dlg.getByLabel(`ETD ${e.terminal}`, { exact: true }).fill(iso(e.etaDias + 2))
      await dlg.getByLabel(`ETD ${e.terminal} Hora`).fill('06:00')
      await dlg.getByLabel(`ETD ${e.terminal} Hora`).blur()
      const area = dlg.locator('section.app-escala-section').filter({ has: page.getByRole('heading', { name: 'Terminais e atracações' }) })
      const salvar = dlg.getByRole('button', { name: 'Salvar escala' })
      const clip = await recorteDe(page, [area, salvar], 12)
      return {
        clip,
        marks: [
          await marca(2, terminal, clip, { posicao: 'campo' }),
          await marca(3, dlg.getByLabel(`ETB ${e.terminal}`, { exact: true }), clip, { posicao: 'campo' }),
          await marca(4, salvar, clip, { destaque: true }),
        ],
        async depois() {
          await salvar.click()
          await dlg.waitFor({ state: 'detached' })
        },
      }
    },
  },
  {
    id: 'viagem-planejamento',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      await abrirViagem(page, base, cenario)
      const e = cenario.escalas.find((x) => x.terminal)
      await page.getByRole('button', { name: `Expandir atracações de ${e.porto}` }).click()
      const b = bloco(page, 'Planejamento por escala')
      await page.waitForTimeout(400)
      const clip = await recorteDoElemento(b)
      return {
        clip,
        marks: [
          await marca(1, page.getByRole('button', { name: `Recolher atracações de ${e.porto}` }), clip, { posicao: 'esquerda' }),
          await marca(2, page.getByRole('button', { name: `Editar planejamento da escala ${e.porto}` }), clip, { posicao: 'direita' }),
        ],
      }
    },
  },
  {
    id: 'importar-programacao',
    capitulo: 5,
    async fazer({ page, base, arquivos }) {
      await abrir(page, base, '/chegadas-saidas')
      await page.getByRole('button', { name: 'Importar programação' }).click()
      const dlg = page.getByRole('dialog')
      await dlg.locator('input[type=file]').setInputFiles(`${arquivos}/programacao-navios.csv`)
      const importar = dlg.getByRole('button', { name: /^Importar \d+ viagens?$/ })
      await importar.waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByText('Trocar arquivo', { exact: true }), clip, { posicao: 'esquerda' }),
          await marca(3, dlg.getByRole('heading', { name: 'Prévia' }), clip, { posicao: 'esquerda' }),
          await marca(4, importar, clip, { destaque: true }),
        ],
        async depois() {
          await importar.click()
          await dlg.getByText('Programação gravada.').waitFor()
          await dlg.getByRole('button', { name: 'Concluir' }).click()
        },
      }
    },
  },
  {
    id: 'chegadas-saidas',
    capitulo: 5,
    async fazer({ page, base, cenario }) {
      await abrir(page, base, '/chegadas-saidas')
      const nome = `${cenario.novaViagem.navio} / ${cenario.novaViagem.numero}`
      const quadro = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Programação publicada no Portal' }) }).last()
      const clip = await recorteDe(page, [page.getByRole('heading', { name: 'Chegadas e Saídas', level: 1 }), quadro], 12)
      return {
        clip,
        marks: [
          await marca(1, page.getByRole('button', { name: 'Adicionar navio' }), clip),
          await marca(2, page.getByRole('button', { name: `Confirmar saída de ${nome} em ${cenario.pol}` }), clip, { destaque: true }),
          await marca(3, page.getByRole('button', { name: `Editar programação de ${nome}` }), clip, { posicao: 'direita' }),
        ],
      }
    },
  },
  {
    id: 'confirmar-saida',
    capitulo: 5,
    async fazer({ page, base, cenario }) {
      await abrir(page, base, '/chegadas-saidas')
      const nome = `${cenario.novaViagem.navio} / ${cenario.novaViagem.numero}`
      await page.getByRole('button', { name: `Confirmar saída de ${nome} em ${cenario.pol}` }).click()
      const dlg = page.getByRole('dialog')
      await dlg.getByLabel('Data da saída').waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Data da saída'), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByRole('button', { name: 'Confirmar saída' }), clip, { destaque: true }),
        ],
        async depois() {
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'editar-programacao',
    capitulo: 5,
    async fazer({ page, base, cenario }) {
      await abrir(page, base, '/chegadas-saidas')
      const nome = `${cenario.novaViagem.navio} / ${cenario.novaViagem.numero}`
      await page.getByRole('button', { name: `Editar programação de ${nome}` }).click()
      const dlg = page.getByRole('dialog')
      await dlg.getByLabel('Salvador · ETA').waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Salvador · ETA'), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByRole('button', { name: 'Salvar alterações' }), clip, { destaque: true }),
        ],
        async depois() {
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'adicionar-navio',
    capitulo: 5,
    async fazer({ page, base }) {
      await abrir(page, base, '/chegadas-saidas')
      await page.getByRole('button', { name: 'Adicionar navio' }).click()
      const dlg = page.getByRole('dialog')
      await dlg.getByLabel('Nome do Navio *').waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Nome do Navio *'), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByLabel('Salvador · ETA'), clip, { posicao: 'campo' }),
          await marca(4, dlg.getByRole('button', { name: 'Adicionar e publicar' }), clip, { destaque: true }),
        ],
        async depois() {
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'locais',
    capitulo: 5,
    async fazer({ page, base }) {
      await abrir(page, base, '/embarquevazios/depots')
      await page.waitForTimeout(500)
      const main = page.locator('main')
      const clip = await recorteDoElemento(main)
      clip.height = Math.min(clip.height, 900)
      return { clip, marks: [] }
    },
  },
  {
    id: 'bls-importar-menu',
    capitulo: 6,
    async fazer({ page, base }) {
      await abrir(page, base, '/bls')
      const botao = page.getByRole('button', { name: 'Importar', exact: true })
      await botao.click()
      const menu = page.getByRole('menu')
      await menu.waitFor()
      const clip = await recorteDe(page, [botao, menu], 14)
      clip.x = Math.max(0, clip.x - 260)
      clip.width += 260
      return {
        clip,
        marks: [await marca(1, botao, clip, { destaque: true }), await marca(2, page.getByRole('menuitem', { name: /B\/L de contêiner/ }), clip, { posicao: 'esquerda' })],
        async depois() {
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'importar-bl-previa',
    capitulo: 6,
    async fazer({ page, base, cenario, arquivos }) {
      await abrir(page, base, '/bls')
      await page.getByRole('button', { name: 'Importar', exact: true }).click()
      await page.getByRole('menuitem', { name: /B\/L de contêiner/ }).click()
      const dlg = page.getByRole('dialog')
      await escolherViagem(page, dlg.getByLabel('Navio / Viagem'), cenario)
      await dlg.locator('input[type=file]').setInputFiles(cenario.bls.map((b) => `${arquivos}/bl-${b.numero}.xlsx`))
      const importar = dlg.getByRole('button', { name: /^Importar \d+ B\/Ls?$/ })
      await importar.waitFor()
      await page.waitForTimeout(400)
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Navio / Viagem'), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByText('Trocar arquivo', { exact: true }), clip, { posicao: 'esquerda' }),
          await marca(4, dlg.getByRole('heading', { name: 'Prévia' }), clip, { posicao: 'esquerda' }),
          await marca(5, importar, clip, { destaque: true }),
        ],
        async depois() {
          await importar.click()
          await dlg.getByText(/Importação concluída/).first().waitFor({ timeout: 60000 })
        },
      }
    },
  },
  {
    id: 'importar-bl-resultado',
    capitulo: 6,
    async fazer({ page }) {
      const dlg = page.getByRole('dialog')
      await page.waitForTimeout(500)
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [await marca(7, dlg.getByRole('button', { name: 'Concluir' }), clip, { destaque: true })],
        async depois() {
          await dlg.getByRole('button', { name: 'Concluir' }).click()
        },
      }
    },
  },
  {
    id: 'manifesto-bb-previa',
    capitulo: 6,
    async fazer({ page, base, cenario, arquivos }) {
      await abrir(page, base, '/bls')
      await page.getByRole('button', { name: 'Importar', exact: true }).click()
      await page.getByRole('menuitem', { name: /Manifesto de carga solta/ }).click()
      const dlg = page.getByRole('dialog')
      await escolherViagem(page, dlg.getByLabel('Viagem de destino'), cenario)
      await dlg.locator('input[type=file]').setInputFiles(`${arquivos}/manifesto-bb.csv`)
      const importar = dlg.getByRole('button', { name: /^Importar \d+ B\/Ls?$/ })
      await dlg.getByText('Prévia pronta. Nada foi gravado ainda.').waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Viagem de destino'), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByLabel('Formato numérico do arquivo'), clip, { posicao: 'campo' }),
          await marca(4, dlg.getByText('Trocar arquivo', { exact: true }), clip, { posicao: 'esquerda' }),
          await marca(5, importar, clip, { destaque: true }),
        ],
        async depois() {
          await importar.click()
          await dlg.getByRole('button', { name: 'Concluir' }).waitFor({ timeout: 60000 })
        },
      }
    },
  },
  {
    id: 'manifesto-bb-resultado',
    capitulo: 6,
    async fazer({ page }) {
      const dlg = page.getByRole('dialog')
      await page.waitForTimeout(500)
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [],
        async depois() {
          await dlg.getByRole('button', { name: 'Concluir' }).click()
        },
      }
    },
  },
  {
    id: 'ce-previa',
    capitulo: 6,
    async fazer({ page, base, cenario, arquivos }) {
      await abrir(page, base, '/bls')
      await page.getByRole('button', { name: 'Importar', exact: true }).click()
      await page.getByRole('menuitem', { name: /CE Mercante/ }).click()
      const dlg = page.getByRole('dialog')
      await dlg.getByLabel('Nº de Manifesto Mercante *').fill(cenario.manifestoVitoria)
      await dlg.locator('input[type=file]').setInputFiles(`${arquivos}/ce-mercante-vitoria.csv`)
      const importar = dlg.getByRole('button', { name: /^Importar \d+ CEs?$/ })
      await importar.waitFor()
      await page.waitForTimeout(400)
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel('Nº de Manifesto Mercante *'), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByText('Trocar arquivo', { exact: true }), clip, { posicao: 'esquerda' }),
          await marca(4, importar, clip, { destaque: true }),
        ],
        async depois() {
          await importar.click()
          await dlg.getByRole('button', { name: 'Concluir' }).waitFor({ timeout: 90000 })
        },
      }
    },
  },
  {
    id: 'ce-resultado',
    capitulo: 6,
    async fazer({ page }) {
      const dlg = page.getByRole('dialog')
      await page.waitForTimeout(800)
      const clip = await recorteDoElemento(dlg)
      const concluir = dlg.getByRole('button', { name: 'Concluir' })
      return {
        clip,
        marks: [await marca(6, concluir, clip, { destaque: true })],
        async depois() {
          await concluir.click()
        },
      }
    },
  },
  {
    id: 'baplie-previa',
    capitulo: 6,
    async fazer({ page, base, cenario, arquivos }) {
      await abrir(page, base, '/baplie')
      await page.getByRole('button', { name: new RegExp(`${cenario.novaViagem.navio} / ${cenario.novaViagem.numero}`) }).first().click()
      const abrirImportacao = page.getByRole('button', { name: /Importar Baplie EDI/ }).first()
      await abrirImportacao.click()
      const dlg = page.getByRole('dialog')
      await dlg.locator('input[type=file]').setInputFiles(`${arquivos}/baplie-sereia.edi`)
      const importar = dlg.getByRole('button', { name: /^Importar \d+ containers?$/ })
      await importar.waitFor({ timeout: 60000 })
      await page.waitForTimeout(400)
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(3, dlg.getByLabel('Viagem de destino'), clip, { posicao: 'campo' }),
          await marca(4, dlg.getByLabel('BRSSA'), clip, { posicao: 'esquerda' }),
          await marca(5, importar, clip, { destaque: true }),
        ],
        async depois() {
          await importar.click()
          await dlg.waitFor({ state: 'detached', timeout: 60000 }).catch(async () => {
            await dlg.getByRole('button', { name: /Concluir|Substituir/ }).first().click()
          })
        },
      }
    },
  },
  {
    id: 'baplie-conciliacao',
    capitulo: 6,
    async fazer({ page, base, cenario }) {
      await abrir(page, base, '/baplie')
      await page.getByRole('button', { name: new RegExp(`${cenario.novaViagem.navio} / ${cenario.novaViagem.numero}`) }).first().click()
      const conc = secao(page, 'Conciliação Baplie × B/L')
      await conc.waitFor()
      await page.waitForTimeout(800)
      const grupo = page.locator('section').filter({ has: page.getByRole('heading', { name: /^No Baplie, sem B\/L/ }) }).last()
      const clip = await recorteDe(page, [secao(page, 'Carga física no Baplie'), conc, grupo], 8)
      // Imagem de leitura (sem passo): a seção 6.8 explica os grupos em texto.
      return { clip, marks: [] }
    },
  },
  {
    id: 'baplie-vazios',
    capitulo: 6,
    async fazer({ page }) {
      const bloco = secao(page, 'Vazios de importação')
      const cadastrar = bloco.getByRole('button', { name: /^Cadastrar \d+ vazios?$/ })
      const clip = await recorteDoElemento(bloco)
      return {
        clip,
        marks: [await marca(1, cadastrar, clip, { destaque: true })],
        async depois() {
          await cadastrar.click()
          await page.waitForLoadState('networkidle')
          await page.waitForTimeout(1500)
        },
      }
    },
  },
  {
    id: 'viagem-importacao-rapida',
    capitulo: 6,
    async fazer({ page, base, cenario }) {
      await abrirViagem(page, base, cenario, 'Importação')
      const rapida = page.getByRole('heading', { name: 'Importação rápida' })
      await rapida.waitFor()
      const clip = await recorteDoElemento(rapida.locator('xpath=ancestor::section[1]'))
      return { clip, marks: [] }
    },
  },
  {
    id: 'rotas-manifestos',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      await abrirViagem(page, base, cenario, 'Rotas e Manifestos')
      const bloco = secao(page, 'Rotas da viagem')
      await bloco.waitFor()
      await page.waitForTimeout(600)
      const clip = await recorteDoElemento(bloco)
      const informar = bloco.getByRole('button', { name: /Informar Nº de Manifesto Mercante/ }).first()
      return {
        clip,
        marks: [
          await marca(1, bloco.getByRole('button', { name: /Editar ETD previsto/ }).first(), clip, { posicao: 'direita' }),
          await marca(1, informar, clip, { posicao: 'direita' }),
        ],
      }
    },
  },
  {
    id: 'editar-rota',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      await abrirViagem(page, base, cenario, 'Rotas e Manifestos')
      const bloco = secao(page, 'Rotas da viagem')
      await bloco.getByRole('button', { name: /Editar ETD previsto/ }).first().click()
      const dlg = page.getByRole('dialog')
      await dlg.getByLabel(/ATD/).first().waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, dlg.getByLabel(/ATD/).first(), clip, { posicao: 'campo' }),
          await marca(3, dlg.getByRole('button', { name: 'Salvar' }), clip, { destaque: true }),
        ],
        async depois() {
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'omitir-escala',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      const omitida = cenario.escalas[0]
      const destino = cenario.escalas.find((e) => e.porto !== omitida.porto)
      await abrirViagem(page, base, cenario)
      await page.getByRole('button', { name: `Editar planejamento da escala ${omitida.porto}` }).click()
      const escala = page.getByRole('dialog')
      await escala.getByRole('button', { name: 'Omitir escala' }).click()
      const dlg = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: new RegExp(`Omitir escala de ${omitida.porto}`) }) })
      await dlg.waitFor()
      const transbordo = dlg.getByLabel(/Porto de Transbordo/)
      await transbordo.selectOption({ label: new RegExp(destino.porto) }).catch(async () => {
        await transbordo.selectOption(destino.porto)
      })
      await dlg.getByLabel(/Motivo/).fill('Armador antecipou a descarga de Salvador em Vitória por congestionamento no porto.')
      await page.waitForTimeout(300)
      const clip = await recorteDoElemento(dlg)
      const botao = dlg.getByRole('button', { name: 'Omitir escala' })
      return {
        clip,
        marks: [
          await marca(2, transbordo, clip, { posicao: 'campo' }),
          await marca(3, dlg.getByLabel(/Navio de Transbordo/), clip, { posicao: 'campo' }),
          await marca(4, botao, clip, { destaque: true }),
        ],
        async depois() {
          await botao.click()
        },
      }
    },
  },
  {
    id: 'omitir-confirmar',
    capitulo: 4,
    async fazer({ page }) {
      const dlg = page.getByRole('dialog').last()
      const confirmar = dlg.getByRole('button', { name: 'Confirmar omissão' })
      await confirmar.waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [await marca(4, confirmar, clip, { destaque: true })],
        async depois() {
          await confirmar.click()
          await page.waitForLoadState('networkidle')
          await page.waitForTimeout(1500)
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'bl-transbordo',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      const bl = cenario.bls.find((b) => b.pod === cenario.escalas[0].porto)
      await abrir(page, base, `/bls/${bl.numero}`)
      const marcar = page.getByRole('button', { name: 'Marcar COD' })
      await marcar.waitFor()
      const cartao = page.locator('section, div').filter({ has: marcar }).filter({ hasText: 'Transbordo' }).last()
      const clip = await recorteDoElemento(cartao)
      return { clip, marks: [await marca(1, marcar, clip, { destaque: true })] }
    },
  },
  {
    id: 'marcar-cod',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      const bl = cenario.bls.find((b) => b.pod === cenario.escalas[0].porto)
      await abrir(page, base, `/bls/${bl.numero}`)
      await page.getByRole('button', { name: 'Marcar COD' }).click()
      const dlg = page.getByRole('dialog')
      const just = dlg.getByRole('textbox').first()
      await just.fill('O Cliente vai retirar a carga em Vitória; não segue em transbordo para Salvador.')
      const confirmar = dlg.getByRole('button', { name: 'Confirmar COD' })
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [await marca(2, just, clip, { posicao: 'campo' }), await marca(3, confirmar, clip, { destaque: true })],
        async depois() {
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'cancelar-viagem',
    capitulo: 4,
    async fazer({ page, base, cenario }) {
      await abrirViagem(page, base, cenario)
      await page.getByRole('button', { name: 'Cancelar viagem' }).click()
      const dlg = page.getByRole('dialog')
      await dlg.getByRole('heading', { name: 'Cancelar viagem' }).waitFor()
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [await marca(1, dlg.getByRole('textbox').first(), clip, { posicao: 'campo' }), await marca(2, dlg.getByRole('button', { name: 'Cancelar viagem' }), clip)],
        async depois() {
          await page.keyboard.press('Escape')
        },
      }
    },
  },
  {
    id: 'painel-lineup',
    capitulo: 5,
    async fazer({ page, base }) {
      await abrir(page, base, '/painel')
      const bloco = secao(page, 'Line Up')
      await bloco.waitFor()
      await page.waitForTimeout(1000)
      const clip = await recorteDe(page, [page.getByRole('heading', { name: 'Painel', level: 1 }), bloco], 8)
      clip.height = Math.min(clip.height, 1100)
      return {
        clip,
        marks: [
          await marca(1, page.getByRole('link', { name: /Tela TV/ }), clip),
          await marca(2, page.getByRole('button', { name: 'Exportar' }), clip),
          await marca(3, page.getByLabel('Escalas'), clip, { posicao: 'campo' }),
        ],
      }
    },
  },
  {
    id: 'tela-tv',
    capitulo: 5,
    async fazer({ page, base }) {
      await abrir(page, base, '/line-up-tv/display')
      await page.waitForTimeout(2500)
      const vp = page.viewportSize()
      return { clip: { x: 0, y: 0, width: vp.width, height: 760 }, marks: [] }
    },
  },
  // Parte I (capítulos 1 e 2): telas só de leitura, no fim da lista para não
  // mexer no estado que as capturas anteriores usam.
  {
    id: 'entrada',
    capitulo: 1,
    async fazer({ base, semSessao }) {
      const tela = await semSessao()
      await tela.goto(`${base}/login`, { waitUntil: 'networkidle' })
      const titulo = tela.getByRole('heading', { name: 'Acesso interno' })
      await titulo.waitFor()
      const cartao = tela.locator('form').filter({ has: tela.locator('input[type=password]') }).first()
      const clip = await recorteDe(tela, [titulo, cartao], 24)
      return { clip, marks: [], tela }
    },
  },
  {
    id: 'painel-topo',
    capitulo: 1,
    async fazer({ page, base }) {
      await abrir(page, base, '/')
      const semSetor = page.getByRole('button', { name: /Sem setor|Administrativo (Nenhum|\d)/ }).last()
      await semSetor.waitFor()
      await page.waitForTimeout(800)
      const clip = await recorteDe(page, [page.locator('header').first(), semSetor], 8)
      return { clip, marks: [] }
    },
  },
  {
    id: 'menu-conta',
    capitulo: 1,
    async fazer({ page, base }) {
      // Entre 1101 e 1279 px o botão da conta mostra só o ícone; o texto cita o nome.
      const anterior = page.viewportSize()
      await page.setViewportSize({ width: 1320, height: anterior.height })
      await abrir(page, base, '/')
      const conta = page.getByRole('button', { name: /Ana Ribeiro/ })
      await conta.click()
      const menu = page.locator('#app-user-dropdown')
      await menu.waitFor()
      await page.waitForTimeout(300)
      const clip = await recorteDe(page, [conta, menu], 12)
      return {
        clip,
        marks: [],
        async depois() {
          await page.keyboard.press('Escape')
          await page.setViewportSize(anterior)
        },
      }
    },
  },
  {
    id: 'relatorios',
    capitulo: 1,
    async fazer({ page, base }) {
      await abrir(page, base, '/relatorios')
      const titulo = page.getByRole('heading', { name: 'Relatórios', exact: true })
      const tabela = page.getByRole('heading', { name: 'B/Ls', exact: true })
      await tabela.waitFor()
      await page.waitForTimeout(800)
      const clip = await recorteDe(page, [titulo, page.getByRole('tab', { name: 'Demurrage' }), tabela], 12)
      return { clip, marks: [] }
    },
  },
  {
    id: 'matriz-setores',
    capitulo: 2,
    async fazer({ page, base }) {
      await abrir(page, base, '/admin')
      const bloco = secao(page, 'O que cada setor pode')
      await bloco.waitFor()
      await page.waitForTimeout(800)
      // Só o começo da matriz: o capítulo explica as linhas em texto.
      const caixa = await bloco.boundingBox()
      const clip = { x: caixa.x - 8, y: caixa.y - 8, width: caixa.width + 16, height: Math.min(caixa.height + 16, 760) }
      return { clip, marks: [] }
    },
  },
  // Capítulos 7 e 8: telas só de leitura (ou que voltam ao estado anterior),
  // depois dos B/Ls importados pelas capturas do capítulo 6.
  {
    id: 'bl-ficha',
    capitulo: 7,
    async fazer({ page, base, cenario }) {
      const numero = cenario.bls[0].numero
      await abrir(page, base, `/bls/${numero}`)
      const abas = page.getByRole('tablist', { name: 'Seções do B/L' })
      await abas.waitFor()
      const situacao = page.getByRole('region', { name: 'Situação do B/L' })
      await situacao.getByRole('heading', { name: 'Documental', exact: true }).waitFor()
      await page.waitForTimeout(1200)
      const identidade = page.locator('header.app-identity').first()
      const proxima = page.getByRole('region', { name: 'Próxima ação' })
      const temProxima = (await proxima.count()) > 0
      const clip = await recorteDe(page, [identidade, situacao, abas], 12)
      return {
        clip,
        marks: [
          await marca(1, identidade.getByRole('heading', { name: numero }), clip, { posicao: 'direita' }),
          ...(temProxima ? [await marca(2, proxima.getByText('Próxima ação', { exact: true }), clip, { posicao: 'esquerda' })] : []),
          await marca(3, situacao.getByRole('heading', { name: 'Operacional', exact: true }), clip, { posicao: 'direita' }),
          await marca(4, situacao.getByRole('heading', { name: 'Documental', exact: true }), clip, { posicao: 'direita' }),
          await marca(5, abas, clip, { posicao: 'esquerda' }),
        ],
      }
    },
  },
  {
    id: 'bl-corrigir-container',
    capitulo: 7,
    async fazer({ page, base, cenario }) {
      const bl = cenario.bls[0]
      const container = bl.containers[0][0]
      await abrir(page, base, `/bls/${bl.numero}?tab=carga`)
      await page.getByRole('button', { name: `Corrigir container ${container}` }).click()
      const dlg = page.getByRole('dialog')
      const lacre = dlg.getByLabel('Lacre')
      await lacre.waitFor()
      await lacre.fill('CS4581077')
      const just = dlg.getByLabel(/^Justificativa/)
      await just.fill('Lacre conferido no terminal: o B/L trazia o número de outro container.')
      const salvar = dlg.getByRole('button', { name: 'Salvar correção' })
      await page.waitForTimeout(300)
      const clip = await recorteDoElemento(dlg)
      return {
        clip,
        marks: [
          await marca(2, lacre, clip, { posicao: 'campo' }),
          await marca(3, just, clip, { posicao: 'campo' }),
          await marca(4, salvar, clip, { destaque: true }),
        ],
        async depois() {
          // Só a foto: a janela fecha sem gravar.
          await dlg.getByRole('button', { name: 'Voltar' }).click()
        },
      }
    },
  },
  {
    id: 'revisao-fila',
    capitulo: 8,
    async fazer({ page, base }) {
      await abrir(page, base, '/revisao')
      const fila = page.getByRole('region', { name: 'Fila de revisão' })
      const cartoes = page.getByRole('group', { name: 'Filtrar por causa' })
      await fila.getByRole('table').waitFor()
      await page.waitForTimeout(800)
      const clip = await recorteDe(page, [page.getByRole('heading', { name: 'Revisão', level: 1 }), cartoes, fila], 12)
      return {
        clip,
        marks: [
          await marca(1, cartoes, clip, { posicao: 'esquerda' }),
          await marca(2, fila.getByLabel('Buscar'), clip, { posicao: 'campo' }),
          await marca(3, fila.getByRole('button', { name: /^Abrir / }).first(), clip, { posicao: 'esquerda' }),
        ],
      }
    },
  },
  {
    id: 'revisao-cadastrar',
    capitulo: 8,
    async fazer({ page, base, cenario }) {
      const nome = cenario.clientes.novaRota.nome
      await abrir(page, base, '/revisao')
      const fila = page.getByRole('region', { name: 'Fila de revisão' })
      const abrirGrupo = fila.getByRole('button', { name: `Abrir ${nome}` })
      await abrirGrupo.click()
      const bloco = fila.locator('.app-block').filter({ has: page.getByRole('heading', { name: 'Cadastrar o cliente', exact: true }) }).first()
      await bloco.waitFor()
      const portal = bloco.getByRole('group', { name: 'Portal do Cliente' })
      await portal.getByText('Deixar para depois').click()
      await page.waitForTimeout(400)
      const linha = fila.locator('tr', { has: page.getByRole('button', { name: `Recolher ${nome}` }) })
      const clip = await recorteDe(page, [linha, bloco], 8)
      return {
        clip,
        marks: [
          await marca(1, page.getByRole('button', { name: `Recolher ${nome}` }), clip, { posicao: 'esquerda' }),
          await marca(2, bloco.getByRole('radiogroup', { name: 'Cadastrar ou vincular o cliente' }), clip, { posicao: 'esquerda' }),
          await marca(3, bloco.locator('input[type=email]'), clip, { posicao: 'campo' }),
          await marca(3, portal, clip, { posicao: 'esquerda' }),
          await marca(4, bloco.getByRole('button', { name: 'Cadastrar e vincular' }), clip, { destaque: true }),
        ],
        async depois() {
          // Só a foto: o grupo fecha sem gravar.
          await page.getByRole('button', { name: `Recolher ${nome}` }).click()
        },
      }
    },
  },
  {
    id: 'portal-fila',
    capitulo: 14,
    async fazer({ page, base }) {
      await abrir(page, base, '/clientes/portal?filtro=todos')
      const tabela = page.getByRole('table', { name: 'Fila de acesso ao Portal por Cliente' })
      await tabela.waitFor()
      await page.waitForTimeout(600)
      const aba = page.getByRole('tab', { name: /^Provisionamento do Portal/ })
      const cartoes = page.getByRole('group', { name: 'Filtros de provisionamento' })
      const linhas = tabela.locator('tbody tr')
      const quarta = linhas.nth(Math.min(3, (await linhas.count()) - 1))
      const clip = await recorteDe(page, [aba, cartoes, quarta], 12)
      return {
        clip,
        marks: [
          await marca(1, aba, clip),
          await marca(2, cartoes, clip, { posicao: 'esquerda' }),
          await marca(3, page.getByRole('searchbox', { name: 'Busca' }), clip, { posicao: 'campo' }),
          await marca(4, linhas.nth(1).getByRole('button', { name: 'Escolher e-mail' }), clip, { posicao: 'esquerda' }),
        ],
      }
    },
  },
  {
    id: 'portal-inspecao',
    capitulo: 15,
    async fazer({ page, base }) {
      await abrir(page, base, '/clientes/portal/inspecao/9001?origem=ficha')
      const resumo = page.getByRole('group', { name: 'Resumo' })
      await resumo.waitFor()
      await page.waitForTimeout(600)
      const faixa = page.getByText('Modo Inspeção', { exact: true }).first()
      const voltar = page.getByRole('button', { name: 'Voltar à ficha do Cliente' }).or(page.getByRole('link', { name: 'Voltar à ficha do Cliente' })).first()
      const barra = page.getByRole('link', { name: 'Faturas', exact: true }).first()
      const clip = await recorteDe(page, [faixa, voltar, resumo], 0)
      clip.x = 0
      clip.width = page.viewportSize().width
      return {
        clip,
        marks: [
          await marca(2, faixa, clip, { posicao: 'direita' }),
          await marca(3, barra, clip),
          await marca(4, voltar, clip, { posicao: 'esquerda' }),
        ],
      }
    },
  },
  {
    id: 'portal-faturas',
    capitulo: 15,
    async fazer({ page, base }) {
      await abrir(page, base, '/clientes/portal/inspecao/9001/billing?origem=ficha')
      const titulo = page.getByRole('heading', { name: 'Faturas', level: 1 })
      await titulo.waitFor()
      await page.waitForTimeout(800)
      const linha = page.getByRole('row').filter({ hasText: 'CSC45810A01K00' }).last()
      await linha.waitFor()
      const clip = await recorteDe(page, [titulo, page.getByRole('button', { name: /Gerar fatura consolidada/ }), linha], 12)
      return { clip, marks: [] }
    },
  },
  {
    id: 'cliente-quem-recebe',
    capitulo: 13,
    async fazer({ page, base }) {
      await abrir(page, base, '/clientes/41823657000136?tab=cadastro')
      const quadro = bloco(page, 'Quem recebe os Comunicados')
      await quadro.waitFor()
      await page.waitForTimeout(400)
      const clip = await recorteDoElemento(quadro)
      return { clip, marks: [] }
    },
  },
  {
    id: 'comunicacao-cobertura',
    capitulo: 16,
    async fazer({ page, base }) {
      await abrir(page, base, '/clientes/comunicacao')
      const aba = page.getByRole('tab', { name: 'Comunicação', exact: true })
      const tabela = page.getByRole('table').first()
      await tabela.waitFor()
      await page.waitForTimeout(600)
      const linhas = tabela.locator('tbody tr')
      const seta = linhas.first().getByRole('button').first()
      const clip = await recorteDe(page, [aba, linhas.nth(1)], 12)
      return {
        clip,
        marks: [
          await marca(1, aba, clip),
          await marca(2, page.getByRole('textbox', { name: 'Navio' }).first(), clip, { posicao: 'campo' }),
          await marca(3, seta, clip, { posicao: 'esquerda' }),
        ],
      }
    },
  },
  {
    id: 'clientes-lista',
    capitulo: 13,
    async fazer({ page, base }) {
      await abrir(page, base, '/clientes')
      const tabela = page.getByRole('table', { name: 'Clientes filtrados' })
      await tabela.waitFor()
      await page.waitForTimeout(600)
      const linhas = tabela.locator('tbody tr')
      const clip = await recorteDe(page, [page.getByRole('heading', { name: 'Clientes', level: 1 }), page.getByRole('button', { name: 'Novo cliente' }), linhas.nth(2)], 12)
      return {
        clip,
        marks: [
          await marca(1, page.getByRole('searchbox', { name: 'Buscar cliente' }), clip, { posicao: 'campo' }),
          await marca(2, page.getByRole('combobox', { name: 'B/Ls vinculados' }), clip, { posicao: 'campo' }),
          await marca(3, page.getByRole('link', { name: 'ATLANTICO IMPORTADORA LTDA' }), clip, { posicao: 'direita' }),
        ],
      }
    },
  },
]
