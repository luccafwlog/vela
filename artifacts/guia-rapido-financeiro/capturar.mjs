// Capturas do Guia rápido do Financeiro, no Vela local com o cenário de
// demonstração do Manual do Operador (dados fictícios; nada toca produção).
//
// Antes: o ambiente do manual de pé, com o cenário recém-preparado e as
// capturas do manual já rodadas (elas criam a Viagem, os B/Ls, o CE e a
// INV-2026-0001). Ver scripts/manual/pdf/README.md, "Como gerar".
//
//   npm run manual:cenario   # e reinicie o sb-shim
//   npm run manual:capture
//   node artifacts/guia-rapido-financeiro/capturar.mjs
//   node artifacts/guia-rapido-financeiro/gerar.mjs
//
// O script prepara o estado financeiro e tira as fotos, nesta ordem:
// 1. no banco manual_demo: uma pessoa do Financeiro (as telas são vistas por
//    ela), a conta de integração "API ITAÚ" do Financeiro, autora da baixa
//    automática como na produção, e a cobrança pelo Itaú ligada;
// 2. pela tela: Liberação de faturamento da MAQUINAS HORIZONTE (sai a
//    INV-2026-0002), duas avulsas (INV-2026-0003 e INV-2026-0004), as datas
//    dos containers do CSC45810A01K00 e a Invoice de Demurrage DEM-2026-0001;
// 3. no banco: o Itaú "paga" dois Pix pela mesma função da Edge Function
//    itau-pix (um com o valor exato, que dá baixa sozinho, e um com R$ 50,00 a
//    menos, que fica em análise);
// 4. as fotos, em telas/<id>.png, com telas/<id>.json (a caixa de cada
//    elemento marcado). A posição dos números fica em telas/posicoes.json,
//    escolhida à mão: se uma tela mudar, confira esse arquivo.
//
// Se o Chromium da versão do Playwright do projeto não estiver baixado,
// aponte outro com MANUAL_BROWSER_EXECUTABLE_PATH (como no manual).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(DIR, 'telas')
const BASE = process.env.VELA_URL || 'http://127.0.0.1:5173'
const SENHA = 'audit-local'
const ADMIN = 'auditor@local.test' // seed_audit.sql
const FINANCEIRO = 'financeiro@local.test' // criado abaixo
// --so id1,id2: refaz só essas fotos, sem preparar o estado de novo.
const SO = (() => { const i = process.argv.indexOf('--so'); return i === -1 ? null : new Set(process.argv[i + 1].split(',')) })()

function banco(sql) {
  return execFileSync('psql', ['-h', process.env.PGHOST || '127.0.0.1', '-U', process.env.PGUSER || 'postgres',
    '-d', process.env.MANUAL_DB || 'manual_demo', '-v', 'ON_ERROR_STOP=1', '-qAtc', sql],
  { env: { PGPASSWORD: 'postgres', ...process.env } }).toString().trim()
}

// O Itaú "paga" um Pix: a mesma função que a Edge Function itau-pix chama,
// com a identidade de serviço dela.
function pixDoItau(endToEnd, fatura, valor, horaUtc) {
  return banco(`begin;
    select set_config('request.jwt.claim.role', 'service_role', true);
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select public.itau_pix_settle('${endToEnd}', (select pix_txid from public.invoices where invoice_number = '${fatura}'),
      ${valor}, date_trunc('day', now()) + interval '${horaUtc}');
    commit;`)
}

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const diasAtras = (n) => {
  const d = new Date(Date.now() - n * 86400000)
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(d)
}

// ---------- marcações ----------
async function caixa(l, clip) {
  const b = await l.boundingBox()
  if (!b) throw new Error(`Elemento sem posição na tela: ${l}`)
  return { x: b.x - clip.x, y: b.y - clip.y, w: b.width, h: b.height }
}
async function marca(n, l, clip, extra = {}) { return { n, ...(await caixa(l, clip)), ...extra } }
async function recorte(page, ls, folga = 12) {
  const bs = []
  for (const l of ls) {
    const b = await l.boundingBox()
    if (!b) throw new Error(`Elemento sem posição na tela: ${l}`)
    bs.push(b)
  }
  const x = Math.max(0, Math.min(...bs.map((b) => b.x)) - folga)
  const y = Math.max(0, Math.min(...bs.map((b) => b.y)) - folga)
  const x2 = Math.min(page.viewportSize().width, Math.max(...bs.map((b) => b.x + b.width)) + folga)
  const y2 = Math.max(...bs.map((b) => b.y + b.height)) + folga
  return { x, y, width: x2 - x, height: y2 - y }
}
// Bloco da tela pelo título; o título se procura a partir da página (regra do `has`).
const bloco = (scope, titulo) => {
  const raiz = typeof scope.page === 'function' ? scope.page() : scope
  return scope.locator('.app-block').filter({ has: raiz.getByRole('heading', { name: titulo, exact: true }) }).first()
}

// ---------- sessão ----------
const browser = await chromium.launch({
  executablePath: process.env.MANUAL_BROWSER_EXECUTABLE_PATH || undefined,
  args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' },
})
async function entrar(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 2000 }, deviceScaleFactor: 2, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type=email]').fill(email)
  await page.locator('input[type=password]').fill(SENHA)
  await page.keyboard.press('Enter')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 })
  const ir = async (rota) => { await page.goto(`${BASE}${rota}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(900) }
  return { page, ir }
}
async function abrirFatura(page, ir, numero) {
  await ir('/taxas-locais')
  await page.getByRole('link', { name: numero }).or(page.getByRole('button', { name: numero })).first().click()
  const d = page.getByRole('dialog')
  await d.getByText('Itens da fatura').waitFor()
  await page.waitForTimeout(700)
  return d
}

// ---------- 1. banco: pessoas e cobrança pelo Itaú ----------
if (!SO) banco(`
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-0000000000f1', 'authenticated', 'authenticated', '${FINANCEIRO}',
          extensions.crypt('${SENHA}', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
         ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'api-itau@local.test',
          extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  on conflict do nothing;
  insert into public.user_profiles (id, full_name, role, active, account_kind) values
    ('a0000000-0000-4000-8000-0000000000f1', 'Marta Financeiro', 'financeiro', true, 'pessoa'),
    ('a0000000-0000-4000-8000-0000000000a1', 'API ITAÚ', 'financeiro', true, 'integracao')
  on conflict do nothing;
  update public.app_settings set pix_provider = 'itau', itau_pix_settlement_actor = 'a0000000-0000-4000-8000-0000000000a1',
    itau_pix_polled_until = now() - interval '1 minute';
`)

// ---------- 2. tela: faturas e Invoice de Demurrage ----------
if (!SO) {
  const { page, ir } = await entrar(ADMIN)
  await ir('/clientes')
  await page.getByRole('link', { name: 'MAQUINAS HORIZONTE LTDA' }).first().click()
  await page.getByRole('tab', { name: 'Financeiro' }).click()
  await page.getByRole('button', { name: 'Conceder liberação' }).click()
  await page.getByLabel(/Justificativa/).fill('Cliente ainda sem acesso ao Portal; faturamento liberado para o guia.')
  const revisao = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10)
  await page.getByLabel(/Data de revisão/).fill(revisao)
  await page.getByRole('button', { name: 'Liberar faturamento' }).click()
  await page.getByRole('button', { name: 'Liberar e emitir' }).click()
  await page.waitForTimeout(2500)

  // Containers do CSC45810A01K00: descarga há 24 dias, devolução há 3 (Demurrage).
  const csv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guia-fin-')), 'datas.csv')
  fs.writeFileSync(csv, ['"B/L","Container","Descarga","Devolução"',
    `"CSC45810A01K00","CSNU2401018","${diasAtras(24)}","${diasAtras(3)}"`,
    `"CSC45810A01K00","CSNU2401023","${diasAtras(24)}","${diasAtras(3)}"`].join('\n'))
  await ir('/containers')
  await page.getByRole('button', { name: 'Importar datas' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.locator('input[type=file]').setInputFiles(csv)
  await dlg.getByText('Prévia pronta. Nada foi gravado ainda.').waitFor({ timeout: 60000 })
  await dlg.getByRole('button', { name: /^Importar \d+ containers?$/ }).click()
  await page.waitForTimeout(3000)
  await page.context().close()
}
if (!SO) {
  const { page, ir } = await entrar(FINANCEIRO)
  for (const [cliente, item, valor, descricao] of [
    ['ATLANTICO IMPORTADORA', 'Armazenagem adicional', '850,00', 'Armazenagem adicional do container CSNU2401018'],
    ['MAQUINAS HORIZONTE', 'Taxa de inspeção', '1180,00', 'Taxa de inspeção da carga do B/L CSC45810B01K00'],
  ]) {
    await ir('/taxas-locais')
    await page.getByRole('button', { name: 'Gerar fatura avulsa' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Cliente').fill(cliente)
    await page.getByRole('option', { name: new RegExp(cliente) }).first().click()
    await d.getByRole('radio', { name: 'Outra' }).or(d.getByRole('button', { name: 'Outra' })).first().click()
    await d.getByLabel(/Nome do item/).fill(item)
    await d.getByLabel(/Quantidade/).fill('1')
    await d.getByLabel(/Valor unitário/).fill(valor)
    await d.getByLabel(/Descrição da cobrança/).fill(descricao)
    await d.getByLabel(/Motivo \(interno\)/).fill('Serviço extra acertado com o Cliente por e-mail.')
    await d.getByRole('button', { name: 'Emitir fatura avulsa' }).click()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /Emitir|Confirmar/ }).last().click()
    await page.waitForTimeout(2500)
  }
  await ir('/demurrage?divisao=a_emitir')
  await page.getByRole('button', { name: /Gerar Invoice/ }).first().click() // emite direto, sem confirmação
  await page.waitForTimeout(3000)
  if (banco("select count(*) from public.demurrage_invoices where status = 'issued'") === '0') {
    throw new Error('A Invoice de Demurrage não foi emitida.')
  }
  await page.context().close()
}

// ---------- 3. banco: o Itaú paga dois Pix ----------
// As cobranças nascem "pending_create" (o QR seria pedido ao Itaú): aqui
// passam a ativas, com o identificador gravado também na fatura.
if (!SO) banco(`
  update public.itau_pix_charges set status = 'active', bank_created_at = now() - interval '3 hours' where status = 'pending_create';
  update public.invoices i set pix_txid = c.txid from public.itau_pix_charges c where c.invoice_id = i.id and i.invoice_number like 'INV-%';
  insert into public.local_pix_charge_versions (invoice_id, txid, amount_brl, payload)
  select c.invoice_id, c.txid, c.amount_brl, 'demo' from public.itau_pix_charges c
  join public.invoices i on i.id = c.invoice_id where i.invoice_number in ('INV-2026-0002', 'INV-2026-0003')
  on conflict do nothing;
  delete from public.itau_pix_receipts where txid = 'INV20260099';
  update public.itau_pix_receipts set raw = jsonb_build_object('infoPagador', 'Maquinas Horizonte - taxa de inspecao')
  where end_to_end_id = 'E60701190202611031105MANUALDEMO02';
`)
const total = (n) => banco(`select balance_brl from public.invoices where invoice_number = '${n}'`)
if (!SO) pixDoItau('E60701190202611051212ITAUDEMO0001', 'INV-2026-0002', total('INV-2026-0002'), '12 hours 12 minutes')
if (!SO) pixDoItau('E60701190202611051421ITAUDEMO0002', 'INV-2026-0003', Number(total('INV-2026-0003')) - 50, '14 hours 21 minutes')
banco("update public.app_settings set itau_pix_polled_until = now() - interval '1 minute'")

// ---------- 4. fotos ----------
const { page, ir } = await entrar(FINANCEIRO)
const CAPTURAS = [
  { id: 'pix-recebidos-topo', async fazer() {
    await ir('/reconciliacao?tab=recebidos')
    const itau = bloco(page, 'Cobrança Pix Itaú'); await itau.getByText('Baixa automática ligada').waitFor()
    const analise = bloco(page, 'Pix em análise')
    const cards = page.getByRole('group', { name: 'Totais dos Pix recebidos no recorte' })
    const clip = await recorte(page, [page.getByRole('heading', { name: 'Conciliação PIX', level: 1 }), itau, analise, cards])
    return { clip, marks: [await marca(1, itau.getByText('Baixa automática ligada'), clip), await marca(2, analise.getByRole('heading', { name: 'Pix em análise' }), clip), await marca(3, cards, clip)] }
  } },
  { id: 'pix-sem-baixa', async fazer() {
    await ir('/reconciliacao?tab=recebidos')
    const tabela = bloco(page, 'Pix recebidos').getByRole('table'); await tabela.waitFor()
    const linha = tabela.locator('tbody tr').filter({ hasText: 'Sem identificador' }).first()
    await linha.waitFor({ timeout: 60000 }); await page.waitForTimeout(800)
    await linha.getByRole('button').first().click()
    const texto = page.getByText('Baixar numa fatura (opcional).'); await texto.waitFor(); await page.waitForTimeout(1200)
    const baixar = page.getByRole('button', { name: /Baixar o Pix na fatura INV-2026-0004/ }); await baixar.waitFor({ timeout: 60000 })
    const clip = await recorte(page, [linha, baixar, texto])
    return { clip, marks: [await marca(1, linha.getByRole('button').first(), clip), await marca(2, texto, clip), await marca(3, baixar, clip, { destaque: true })],
      depois: async () => { await baixar.click(); await page.waitForTimeout(2500) } }
  } },
  { id: 'pix-lista', async fazer() {
    await ir('/reconciliacao?tab=recebidos')
    const lista = bloco(page, 'Pix recebidos'); const tabela = lista.getByRole('table'); await tabela.waitFor()
    const de = page.getByLabel('Recebido de')
    const clip = await recorte(page, [page.getByText('Recebido de', { exact: true }).first(), de, lista])
    return { clip, marks: [await marca(1, de, clip), await marca(2, tabela.getByRole('columnheader', { name: 'Origem' }), clip), await marca(3, tabela.getByRole('columnheader', { name: 'Situação' }), clip)] }
  } },
  { id: 'registrar-pagamento', async fazer() {
    const d = await abrirFatura(page, ir, 'INV-2026-0001')
    const form = d.getByRole('group', { name: 'Registrar pagamento' })
    const botao = form.getByRole('button', { name: 'Registrar pagamento' })
    // A fatura se recarrega sozinha e pode fechar o formulário depois da foto:
    // o passo seguinte preenche de novo antes de gravar.
    const preencher = async () => {
      await d.getByRole('button', { name: 'Registrar pagamento' }).first().click()
      await form.getByLabel('Valor recebido (R$)').fill('4440,00')
      await form.getByLabel('Recebido em').fill(hoje())
      await form.getByLabel('Método').selectOption('ted')
      await form.getByLabel('Referência bancária').fill('TED 000418 - Itaú')
      await page.waitForTimeout(400)
    }
    await preencher()
    const pag = bloco(d, 'Pagamentos'); await pag.scrollIntoViewIfNeeded()
    const clip = await recorte(page, [pag], 0)
    return { clip, marks: [await marca(1, form.getByLabel('Valor recebido (R$)'), clip), await marca(2, form.getByLabel('Recebido em'), clip),
      await marca(3, form.getByLabel('Método'), clip), await marca(4, form.getByLabel('Referência bancária'), clip), await marca(5, botao, clip, { destaque: true })],
    depois: async () => {
      if (!(await botao.isVisible())) await preencher()
      await botao.click(); await page.waitForTimeout(800)
    } }
  } },
  { id: 'confirmar-pagamento', async fazer() {
    const botao = page.getByRole('button', { name: 'Confirmar pagamento recebido' }); await botao.waitFor()
    const janela = page.getByRole('alertdialog').or(page.getByRole('dialog').filter({ has: botao })).last()
    const clip = await recorte(page, [janela], 0)
    return { clip, marks: [await marca(1, botao, clip, { destaque: true })], depois: async () => { await botao.click(); await page.waitForTimeout(2500) } }
  } },
  { id: 'pagamentos-restituicao', async fazer() {
    const d = await abrirFatura(page, ir, 'INV-2026-0001')
    const pag = bloco(d, 'Pagamentos'); const rest = bloco(d, 'Restituições ao Cliente')
    await rest.getByText('A devolver').waitFor(); await page.waitForTimeout(600); await pag.scrollIntoViewIfNeeded()
    const clip = await recorte(page, [pag, rest], 0)
    return { clip, marks: [await marca(1, pag.getByRole('button', { name: /^Cancelar baixa de/ }).first(), clip), await marca(2, rest.getByText('A devolver').first(), clip),
      await marca(3, rest.getByRole('button', { name: /Confirmar devolução/ }).first(), clip, { destaque: true })] }
  } },
  { id: 'confirmar-devolucao', async fazer() {
    const d = await abrirFatura(page, ir, 'INV-2026-0001')
    const rest = bloco(d, 'Restituições ao Cliente')
    await rest.getByRole('button', { name: /Confirmar devolução/ }).first().click(); await page.waitForTimeout(600)
    const comp = rest.getByLabel(/comprovante bancário/).first(); await comp.fill('PIX devolução E607011902026110516')
    const fav = rest.getByLabel(/Favorecido/).first(); await fav.fill('ATLANTICO IMPORTADORA LTDA / 41.823.657/0001-36')
    const data = rest.getByLabel(/Data da devolução/).first(); await data.fill(hoje()); await data.evaluate((el) => el.blur())
    await page.waitForTimeout(400)
    const clip = await recorte(page, [rest], 0)
    return { clip, marks: [await marca(1, comp, clip), await marca(2, fav, clip), await marca(3, data, clip),
      await marca(4, rest.getByRole('button', { name: 'Confirmar devolução realizada' }), clip, { destaque: true })], depois: () => page.keyboard.press('Escape') }
  } },
  { id: 'cancelar-baixa', async fazer() {
    const d = await abrirFatura(page, ir, 'INV-2026-0004')
    const pag = bloco(d, 'Pagamentos')
    await pag.getByRole('button', { name: /^Cancelar baixa de/ }).first().click(); await page.waitForTimeout(500)
    const form = d.getByRole('group', { name: 'Cancelar baixa' })
    await form.getByLabel('Justificativa').fill('Pix era de outra fatura do Cliente; baixa lançada na fatura errada.')
    await page.waitForTimeout(300); await pag.scrollIntoViewIfNeeded()
    const clip = await recorte(page, [pag, form], 0)
    return { clip, marks: [await marca(1, pag.getByRole('button', { name: /^Cancelar baixa de/ }).first(), clip), await marca(2, form.getByLabel('Justificativa'), clip),
      await marca(3, form.getByRole('button', { name: 'Cancelar baixa' }), clip, { destaque: true })], depois: () => page.keyboard.press('Escape') }
  } },
  { id: 'cancelamento-financeiro', async fazer() {
    const d = await abrirFatura(page, ir, 'INV-2026-0002')
    const ajustes = d.locator('.app-block').filter({ has: page.getByRole('heading', { name: /Ajustes pela correção do B\/L/ }) }).first()
    await ajustes.scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
    const bl = ajustes.getByLabel('B/L para cancelamento financeiro'); await bl.selectOption({ index: 1 })
    const motivo = ajustes.getByLabel('Motivo do cancelamento financeiro')
    await motivo.fill('Administrativo vai cancelar o B/L: carga não descarregada em Vitória.')
    await page.waitForTimeout(300)
    const clip = await recorte(page, [ajustes], 0)
    return { clip, marks: [await marca(1, bl, clip), await marca(2, motivo, clip),
      await marca(3, ajustes.getByRole('button', { name: /Preparar cancelamento financeiro/ }), clip, { destaque: true })], depois: () => page.keyboard.press('Escape') }
  } },
  { id: 'historico', async fazer() {
    await ir('/reconciliacao')
    const cards = page.getByRole('group', { name: 'Totais das baixas no recorte' })
    const baixas = bloco(page, 'Baixas'); const tabela = baixas.getByRole('table'); await tabela.locator('tbody tr').first().waitFor(); await page.waitForTimeout(600)
    const clip = await recorte(page, [page.getByRole('tab', { name: 'Histórico de baixas' }), cards, baixas])
    return { clip, marks: [await marca(1, cards, clip), await marca(2, page.getByLabel('Pago de'), clip),
      await marca(3, tabela.getByRole('columnheader', { name: /Pago em/ }), clip), await marca(4, tabela.getByRole('columnheader', { name: /Forma da baixa/ }), clip)] }
  } },
  { id: 'taxas-faturas', async fazer() {
    await ir('/taxas-locais')
    const cards = page.getByRole('group', { name: 'Totais das faturas no recorte' })
    const faturas = bloco(page, 'Faturas'); const tabela = faturas.getByRole('table'); await tabela.locator('tbody tr').first().waitFor(); await page.waitForTimeout(600)
    const inv = tabela.getByRole('link', { name: 'INV-2026-0001' }).or(tabela.getByRole('button', { name: 'INV-2026-0001' })).first()
    const clip = await recorte(page, [page.getByRole('heading', { name: 'Taxas Locais', level: 1 }), cards, faturas])
    const marks = [await marca(1, page.getByText(/alertas? financeiros? em aberto/).first(), clip), await marca(2, cards, clip),
      await marca(3, faturas.getByLabel('Situação'), clip), await marca(4, inv, clip)]
    clip.height = marks[3].y + marks[3].h + 14 // até a linha da INV-2026-0001
    return { clip, marks }
  } },
  { id: 'demurrage-faturas', async fazer() {
    await ir('/demurrage?tab=faturas')
    const tabela = page.getByRole('table').first(); await tabela.locator('tbody tr').first().waitFor(); await page.waitForTimeout(800)
    const clip = await recorte(page, [page.getByRole('heading', { name: 'Demurrage', level: 1 }), page.getByRole('button', { name: 'Importar datas' }), tabela])
    return { clip, marks: [await marca(1, page.getByText(/PTAX venda/).first(), clip), await marca(2, page.getByRole('button', { name: 'Informar PTAX' }).first(), clip),
      await marca(3, page.getByRole('tab', { name: 'Faturas' }), clip), await marca(4, tabela.getByRole('columnheader', { name: /Régua/ }), clip)] }
  } },
  { id: 'demurrage-detalhe', async fazer() {
    await ir('/demurrage?tab=faturas')
    await page.getByRole('button', { name: 'DEM-2026-0001' }).or(page.getByRole('link', { name: 'DEM-2026-0001' })).first().click()
    const d = page.getByRole('dialog'); await d.getByText('BRL hoje').waitFor(); await page.waitForTimeout(800)
    const clip = await recorte(page, [d], 0)
    clip.height = Math.min(clip.height, 700) // sem o bloco da restituição excepcional
    return { clip, marks: [await marca(1, d.getByText('BRL hoje').first(), clip), await marca(2, d.getByRole('button', { name: 'Registrar pagamento' }), clip, { destaque: true })],
      depois: () => page.keyboard.press('Escape') }
  } },
  { id: 'sino', async fazer() {
    await ir('/painel')
    const sino = page.getByRole('button', { name: /^Notificações internas/ }).first()
    await sino.click(); await page.waitForTimeout(800)
    const p = await page.getByRole('region', { name: 'Notificações internas' }).boundingBox(); const b = await sino.boundingBox()
    const x = p.x - 8; const y = b.y - 8
    const clip = { x, y, width: Math.min(1280 - x, p.width + 16), height: p.y + p.height + 8 - y }
    return { clip, marks: [await marca(1, sino, clip)], depois: () => page.keyboard.press('Escape') }
  } },
  { id: 'menu', async fazer() {
    await ir('/taxas-locais')
    const botao = page.locator('button[aria-expanded]').filter({ hasText: 'Financeiro' }).first()
    await botao.click(); await page.waitForTimeout(500)
    const menu = await page.locator('#app-nav-financeiro').boundingBox()
    const clip = { x: 0, y: 0, width: Math.min(1280, menu.x + menu.width + 260), height: menu.y + menu.height + 14 }
    return { clip, marks: [], depois: () => page.keyboard.press('Escape') }
  } },
]

// As fotos ficam na memória e só vão para telas/ no fim: o Vite de
// desenvolvimento vigia o repositório, e gravar um arquivo no meio das
// capturas recarrega a página aberta (o formulário se perde).
const prontas = []
const falhas = []
for (const c of CAPTURAS) {
  if (SO && !SO.has(c.id)) continue
  try {
    const { clip, marks, depois } = await c.fazer()
    const png = await page.screenshot({ clip, fullPage: true })
    prontas.push({ id: c.id, png, json: `${JSON.stringify({ id: c.id, width: clip.width, height: clip.height, marks }, null, 1)}\n` })
    if (depois) await depois()
    console.log(`ok  ${c.id}`)
  } catch (error) {
    falhas.push(c.id)
    console.error(`ERRO ${c.id}: ${process.env.MANUAL_DEBUG ? error.message : error.message.split('\n')[0]}`)
    const foto = path.join(os.tmpdir(), `guia-financeiro-${c.id}.erro.png`)
    await page.screenshot({ path: foto }).catch(() => {})
    console.error(`     tela no momento do erro: ${foto}`)
    await page.keyboard.press('Escape').catch(() => {})
  }
}
await browser.close()
fs.mkdirSync(OUT, { recursive: true })
for (const f of prontas) {
  fs.writeFileSync(path.join(OUT, `${f.id}.png`), f.png)
  fs.writeFileSync(path.join(OUT, `${f.id}.json`), f.json)
}
if (falhas.length) {
  console.error(`${falhas.length} capturas falharam: a tela mudou ou o cenário não está preparado.`)
  process.exit(1)
}
