// Contrato da consulta de CNPJ (ADR 0127) contra uma BrasilAPI falsa: sem
// rede. Roda no passo Deno do CI (`deno test --config supabase/functions/deno.json`).
import { BRASILAPI_CNPJ_URL, handleCnpjLookup, normalizeLookupCnpj, type CnpjLookupDeps } from './cnpjLookup.ts'

function assert(condition: unknown, message = 'falhou'): asserts condition {
  if (!condition) throw new Error(message)
}
function assertEquals(actual: unknown, expected: unknown, message = '') {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${message}\n esperado: ${e}\n recebido: ${a}`)
}

const RECEITA = {
  cnpj: '19131243000197',
  razao_social: 'OPEN KNOWLEDGE BRASIL',
  nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
  descricao_tipo_de_logradouro: 'AVENIDA',
  logradouro: 'PAULISTA',
  numero: '37',
  complemento: 'ANDAR 4',
  bairro: 'BELA VISTA',
  municipio: 'SAO PAULO',
  uf: 'SP',
  cep: '01311902',
  descricao_situacao_cadastral: 'ATIVA',
  email: 'socio@example.com',
  ddd_telefone_1: '1123851939',
  qsa: [{ nome_socio: 'PESSOA FISICA' }],
}

function harness(options: { role?: string | null; upstream?: () => Promise<Response> } = {}) {
  const calls: string[] = []
  const logs: Array<{ message: string; details?: Record<string, unknown> }> = []
  const deps: CnpjLookupDeps = {
    resolveRole: () => Promise.resolve(options.role === undefined ? 'documentacao' : options.role),
    fetcher: (input) => {
      calls.push(input)
      return options.upstream ? options.upstream() : Promise.resolve(Response.json(RECEITA))
    },
    log: (message, details) => logs.push({ message, details }),
  }
  return { deps, calls, logs }
}

const request = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer token' }) =>
  new Request('https://edge.example/cnpj-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

Deno.test('devolve só a lista positiva do cadastro, sem sócios, telefone ou e-mail', async () => {
  const h = harness()
  const response = await handleCnpjLookup(request({ cnpj: '19.131.243/0001-97' }), h.deps)
  assertEquals(response.status, 200)
  assertEquals(h.calls, [`${BRASILAPI_CNPJ_URL}19131243000197`])
  assertEquals(await response.json(), {
    status: 'encontrado',
    data: {
      cnpj: '19131243000197',
      razao_social: 'OPEN KNOWLEDGE BRASIL',
      nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
      cep: '01311902',
      endereco: 'AVENIDA PAULISTA, 37 - ANDAR 4 - BELA VISTA',
      cidade: 'SAO PAULO',
      uf: 'SP',
      situacao: 'ATIVA',
    },
  })
})

Deno.test('sem perfil interno (conta do Portal, sessão anônima) recusa sem chamar a BrasilAPI', async () => {
  const portal = harness({ role: null })
  assertEquals((await handleCnpjLookup(request({ cnpj: '19131243000197' }), portal.deps)).status, 403)
  const anonymous = harness()
  assertEquals((await handleCnpjLookup(request({ cnpj: '19131243000197' }, {}), anonymous.deps)).status, 403)
  assertEquals([...portal.calls, ...anonymous.calls], [])
})

Deno.test('CNPJ fora do formato é recusado antes da BrasilAPI; o alfanumérico passa', async () => {
  const h = harness()
  assertEquals((await handleCnpjLookup(request({ cnpj: '1234' }), h.deps)).status, 422)
  assertEquals(h.calls, [])
  assertEquals(normalizeLookupCnpj('12.abc.345/01de-35'), '12ABC34501DE35')
  assertEquals(normalizeLookupCnpj('12ABC34501DEXX'), null)
})

Deno.test('404 da Receita vira nao_encontrado', async () => {
  const h = harness({ upstream: () => Promise.resolve(Response.json({ type: 'not_found' }, { status: 404 })) })
  assertEquals(await (await handleCnpjLookup(request({ cnpj: '19131243000197' }), h.deps)).json(), { status: 'nao_encontrado' })
})

Deno.test('queda, limite ou resposta estranha viram indisponivel com 200, e o log não leva o CNPJ', async () => {
  const cases: Array<() => Promise<Response>> = [
    () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
    () => Promise.resolve(new Response('busy', { status: 429 })),
    () => Promise.resolve(new Response('<html>', { status: 200 })),
  ]
  for (const upstream of cases) {
    const h = harness({ upstream })
    const response = await handleCnpjLookup(request({ cnpj: '19131243000197' }), h.deps)
    assertEquals(response.status, 200)
    assertEquals(await response.json(), { status: 'indisponivel' })
    assert(h.logs.length === 1, 'registra o motivo')
    assert(!JSON.stringify(h.logs).includes('19131243000197'), 'log sem o CNPJ')
  }
})
