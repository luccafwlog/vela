// @vitest-environment jsdom
// Página de decisões do dono (docs/manual/decisoes/pagina-modelo.html): o fluxo
// de escolha com gravação otimista, reversão e aceitação em lote, exercitado
// com um registro de decisões falso no lugar de `claude.use('db')`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Write = { id: string; escolha: string | null; nota: string }

const CARDS = [
  { key: '01-a:A1', area: '01-a', areaNome: 'Área A', num: 'A1', titulo: 'Ficha um', caso: 'c', hoje: 'h', impacto: 'alto', classe: 'b', recomendada: 'A', porque: 'p', codigoTexto: 't', opcoes: [{ id: 'A', texto: 'Opção A', efeito: 'e' }, { id: 'B', texto: 'Opção B', efeito: 'e' }] },
  { key: '01-a:A2', area: '01-a', areaNome: 'Área A', num: 'A2', titulo: 'Ficha dois', caso: 'c', hoje: 'h', impacto: 'alto', classe: 'b', recomendada: 'A', porque: 'p', codigoTexto: 't', opcoes: [{ id: 'A', texto: 'Opção A', efeito: 'e' }, { id: 'B', texto: 'Opção B', efeito: 'e' }] },
  { key: '02-b:B1', area: '02-b', areaNome: 'Área B', num: 'B1', titulo: 'Ficha três', caso: 'c', hoje: 'h', impacto: 'medio', classe: 'b', recomendada: 'B', porque: 'p', codigoTexto: 't', opcoes: [{ id: 'A', texto: 'Opção A', efeito: 'e' }, { id: 'B', texto: 'Opção B', efeito: 'e' }] },
]

/** Registro falso: cada `set` espera `release` (ou falha com `fail`). */
function fakeDb() {
  const writes: Write[] = []
  const queue: Array<{ resolve: () => void; reject: (e: unknown) => void }> = []
  let snapshot: ((snap: { docs: Array<{ id: string; data: () => unknown }> }) => void) | null = null
  let auto = true
  const db = {
    collection: () => ({
      doc: (id: string) => ({
        set: (v: { escolha: string | null; nota: string }) => new Promise<void>((res, rej) => {
          const done = () => { writes.push({ id, escolha: v.escolha, nota: v.nota }); res() }
          if (auto) done(); else queue.push({ resolve: done, reject: rej })
        }),
      }),
      onSnapshot: (cb: typeof snapshot) => { snapshot = cb },
    }),
  }
  return {
    db, writes,
    hold() { auto = false },
    release() { queue.shift()?.resolve() },
    fail(code = 'permission_denied') { queue.shift()?.reject({ code }) },
    emit(docs: Record<string, { escolha: string | null; nota?: string }> = {}) {
      snapshot?.({ docs: Object.entries(docs).map(([id, v]) => ({ id, data: () => v })) })
    },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function mount(fake: ReturnType<typeof fakeDb> | null) {
  const html = readFileSync(resolve(process.cwd(), 'docs/manual/decisoes/pagina-modelo.html'), 'utf8')
  const scriptStart = html.lastIndexOf('<script>')
  const script = html.slice(scriptStart + '<script>'.length, html.lastIndexOf('</script>'))
  const markup = html.slice(0, scriptStart).replace('__DATA__', JSON.stringify(CARDS))
  document.body.innerHTML = markup.replace(/<style>[\s\S]*?<\/style>/, '')
  ;(window as unknown as { claude: unknown }).claude = { use: () => Promise.resolve(fake?.db ?? null) }
  new Function(script)()
}

const byId = (id: string) => document.getElementById(id) as HTMLElement
const option = (titulo: string, opcao: string) => {
  const card = [...document.querySelectorAll('article')].find((a) => a.querySelector('h2')?.textContent === titulo) as HTMLElement
  return [...card.querySelectorAll('button.opt')].find((b) => b.querySelector('.l')?.textContent === opcao) as HTMLButtonElement
}
const note = (key: string) => byId('nota-' + key.replace(/[^A-Za-z0-9_-]/g, '_')) as HTMLTextAreaElement

beforeEach(() => { localStorage.clear() })
afterEach(() => { document.body.innerHTML = '' })

describe('página de decisões do dono', () => {
  it('não grava nada antes de ler as escolhas guardadas', async () => {
    const fake = fakeDb()
    mount(fake)
    await flush()
    expect(option('Ficha um', 'A').disabled).toBe(true)
    expect((byId('bulkOpen') as HTMLButtonElement).disabled).toBe(true)
    fake.emit({ '01-a_A1': { escolha: 'B' } })
    // Decidida, a Ficha um sai das pendentes; as outras ficam liberadas.
    expect(byId('count').textContent).toBe('1 de 3 decididas')
    expect(option('Ficha dois', 'A').disabled).toBe(false)
  })

  it('a confirmação em lote começa escondida', async () => {
    mount(fakeDb())
    expect(byId('bulk').hidden).toBe(true)
    expect(document.querySelector('style')).toBeNull()
    const css = readFileSync(resolve(process.cwd(), 'docs/manual/decisoes/pagina-modelo.html'), 'utf8')
    expect(css).toContain('.bulk[hidden] { display: none }')
  })

  it('escolher logo depois de digitar a observação guarda a observação junto', async () => {
    const fake = fakeDb()
    mount(fake); await flush(); fake.emit()
    note('01-a:A1').value = 'Combinar com o diretor'
    option('Ficha um', 'B').click()
    await flush()
    expect(fake.writes).toEqual([{ id: '01-a_A1', escolha: 'B', nota: 'Combinar com o diretor' }])
  })

  it('duas escolhas que falham voltam ao último estado guardado', async () => {
    const fake = fakeDb()
    mount(fake); await flush(); fake.emit(); fake.hold()
    option('Ficha um', 'A').click()
    option('Ficha um', 'B').click()
    fake.fail(); await flush()
    fake.fail(); await flush()
    expect(byId('count').textContent).toBe('0 de 3 decididas')
  })

  it('o lote aceita só as fichas confirmadas, conta só o que foi guardado e não sobrescreve escolha feita no meio', async () => {
    const fake = fakeDb()
    mount(fake); await flush(); fake.emit()
    ;(byId('fArea') as HTMLSelectElement).value = '01-a'
    byId('fArea').dispatchEvent(new Event('change'))
    byId('bulkOpen').click()
    expect(byId('bulkText').textContent).toContain('2 fichas')
    fake.hold()
    byId('bulkYes').click()
    // Durante o lote as escolhas individuais ficam travadas.
    expect(option('Ficha dois', 'B').disabled).toBe(true)
    fake.release(); await flush()
    fake.fail(); await flush()
    expect(fake.writes).toEqual([{ id: '01-a_A1', escolha: 'A', nota: '' }])
    expect(byId('status').textContent).toBe('1 recomendações aceitas; 1 não foram guardadas.')
    // A Área B não entrou no lote.
    expect(fake.writes.some((w) => w.id === '02-b_B1')).toBe(false)
  })

  it('trocar o filtro fecha a confirmação em lote', async () => {
    const fake = fakeDb()
    mount(fake); await flush(); fake.emit()
    byId('bulkOpen').click()
    expect(byId('bulk').hidden).toBe(false)
    ;(byId('fImp') as HTMLSelectElement).value = 'alto'
    byId('fImp').dispatchEvent(new Event('change'))
    expect(byId('bulk').hidden).toBe(true)
  })

  it('observação em edição sobrevive à reconstrução da lista durante o lote', async () => {
    const fake = fakeDb()
    mount(fake); await flush(); fake.emit(); fake.hold()
    ;(byId('fArea') as HTMLSelectElement).value = '01-a'
    byId('fArea').dispatchEvent(new Event('change'))
    byId('bulkOpen').click()
    byId('bulkYes').click()
    note('01-a:A2').value = 'rascunho'
    fake.release(); await flush()
    expect(note('01-a:A2').value).toBe('rascunho')
    fake.release(); await flush()
    expect(fake.writes.at(-1)).toEqual({ id: '01-a_A2', escolha: 'A', nota: 'rascunho' })
  })

  it('sem registro, a escolha não fica marcada na tela', async () => {
    const fake = fakeDb()
    mount(fake); await flush(); fake.emit()
    ;(fake.db as { collection: unknown }).collection = () => ({ doc: () => ({ set: () => Promise.reject({ code: 'x' }) }) })
    option('Ficha um', 'A').click()
    await flush()
    expect(byId('count').textContent).toBe('0 de 3 decididas')
  })
})
