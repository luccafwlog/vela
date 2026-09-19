// Verificação executável das regras da migração (AGENTS.md: "uma checagem
// runnable"). Sem framework, sem fixture — `node` e `assert`.
//
//   node scripts/migracao-demurrage/regras.check.mjs
//
// Os casos aqui são os que erraram na análise real, não exemplos inventados.

import assert from 'node:assert/strict'
import {
  chaveNavio,
  estadoDaFatura,
  extrairRazaoSocial,
  interpretarViagem,
  normalizarPorto,
  razaoSocialDoCliente,
  resolverBrlRecebido,
  resolverDocnums,
  separarEmails,
  TARIFAS,
} from './regras.mjs'

// --- Viagem: o `V` é abreviação de viagem, e aparece em duas grafias --------
assert.deepEqual(interpretarViagem('GREEN RIO GRANDE V13'), {
  navio: 'GREEN RIO GRANDE',
  viagem: '13',
  reconhecido: true,
})
assert.deepEqual(interpretarViagem('CS GLORY V.20'), {
  navio: 'CS GLORY',
  viagem: '20',
  reconhecido: true,
})
// Navio com número no nome não pode perder o número para a viagem.
assert.equal(interpretarViagem('GREEN PENGO BO V.11').navio, 'GREEN PENGO BO')
// String fora do padrão é sinalizada, nunca adivinhada.
assert.equal(interpretarViagem('GREEN SANTOS').reconhecido, false)

// --- Navio: acento e apelido são o mesmo casco -----------------------------
// GREEN ITAJAÍ V8 e GREEN ITAJAI V9 convivem na origem.
assert.equal(chaveNavio('GREEN ITAJAÍ'), chaveNavio('GREEN ITAJAI'))
// O destino já tem COSCO SHIPPING XING WANG; a origem chama de CS XING WANG.
assert.equal(chaveNavio('CS XING WANG'), 'COSCO SHIPPING XING WANG')
assert.equal(chaveNavio('ZYHY JIN QU'), 'ZHONG YUAN HAI YUN JIN QU')
// `CSPC` começa com CS mas não é apelido: `\b` impede a troca.
assert.equal(chaveNavio('CSPC MERCURY'), 'CSPC MERCURY')

// --- Razão social ----------------------------------------------------------
assert.equal(
  extrairRazaoSocial('SAVINO DEL BENE DO BRASIL LTDA\r\nCNPJ: 03.029.134/0001-23\r\nRUA ALVORADA'),
  'SAVINO DEL BENE DO BRASIL LTDA',
)
// Artefato do Excel: sem tratar, o nome sairia com `_x000D_` grudado.
assert.equal(
  extrairRazaoSocial('GLOBAL SOLUCOES EM LOGISTICA EIRELI_x000D_AV. SENADOR'),
  'GLOBAL SOLUCOES EM LOGISTICA EIRELI',
)
// Endereço colado sem fronteira de palavra: a regex não casa e o extrator
// devolve a linha inteira. É por isso que existem os 5 overrides.
assert.match(extrairRazaoSocial('TFA CARGO LOGISTICS LTDACNPJ: 14.706.880/0001-20'), /LTDACNPJ/)
assert.equal(razaoSocialDoCliente('14.706.880/0001-20', 'TFA CARGO LOGISTICS LTDACNPJ: ...'),
  'TFA CARGO LOGISTICS LTDA')

// --- Portos ----------------------------------------------------------------
assert.equal(normalizarPorto('VITÓRIA'), 'BRVIX')
assert.equal(normalizarPorto('vitoria'), 'BRVIX')
assert.equal(normalizarPorto('NANSHA'), 'CNNSA')
// Porto desconhecido não vira palpite: devolve null para o relatório apontar.
assert.equal(normalizarPorto('PORTO INVENTADO'), null)

// --- E-mails ---------------------------------------------------------------
assert.deepEqual(
  separarEmails('A@X.COM.BR; b@y.com , lixo-sem-arroba'),
  ['a@x.com.br', 'b@y.com'],
)
assert.deepEqual(separarEmails(''), [])

// --- Tarifas ---------------------------------------------------------------
assert.equal(TARIFAS.length, 20)
{
  const g45 = TARIFAS.find((t) => t.container_type === '45G1')
  // Dias contados DESDE A DESCARGA: free 21 → P1 [22,30], P2 a partir de 31.
  assert.deepEqual(
    { f: g45.free_days, de: g45.p1_day_from, ate: g45.p1_day_to, p2: g45.p2_day_from },
    { f: 21, de: 22, ate: 30, p2: 31 },
  )
  assert.equal(g45.p1_usd, 60)
  assert.equal(g45.p2_usd, 80)
  // Reefer não entra: sem código ISO mapeado, tarifa seria invenção.
  assert.equal(TARIFAS.some((t) => /RF|RQ/.test(t.container_type)), false)
  // Sem tipo repetido — duas linhas vigentes para o mesmo tipo fazem a segunda
  // ser silenciosamente ignorada pelo cálculo do destino.
  assert.equal(new Set(TARIFAS.map((t) => t.container_type)).size, TARIFAS.length)
}

// --- doc_number: pago mantém o número, aberto é regerado -------------------
{
  const r = resolverDocnums([
    { bl: 'BL-B', docnum: 'DEM-1', pago: false, billedAt: '2026-04-06' },
    { bl: 'BL-A', docnum: 'DEM-1', pago: true, billedAt: '2026-04-06' },
    { bl: 'BL-C', docnum: 'DEM-2', pago: true, billedAt: '2026-04-06' },
  ])
  // Pago tem prioridade para ficar com o número original, mesmo com B/L maior.
  assert.deepEqual(r.get('BL-A'), { doc_number: 'DEM-1', acao: 'mantido' })
  assert.deepEqual(r.get('BL-B'), { doc_number: null, acao: 'regerar' })
  // Sem colisão, nada muda.
  assert.deepEqual(r.get('BL-C'), { doc_number: 'DEM-2', acao: 'mantido' })
}
{
  // Dois pagos: o segundo é sufixado, não regerado.
  const r = resolverDocnums([
    { bl: 'BL-Y', docnum: 'DEM-9', pago: true, billedAt: '2026-04-10' },
    { bl: 'BL-X', docnum: 'DEM-9', pago: true, billedAt: '2026-04-06' },
  ])
  assert.deepEqual(r.get('BL-X'), { doc_number: 'DEM-9', acao: 'mantido' })
  assert.deepEqual(r.get('BL-Y'), { doc_number: 'DEM-9-2', acao: 'sufixado' })
}

// --- BRL recebido ----------------------------------------------------------
assert.deepEqual(resolverBrlRecebido(3853.85, [1, 2]), { valor: 3853.85, fonte: 'frozenTotal' })
assert.deepEqual(resolverBrlRecebido(null, [100.5, 200.25]), {
  valor: 300.75,
  fonte: 'reconciliacao',
})
// Zero é valor legítimo (desconto comercial de 100%), não ausência.
assert.deepEqual(resolverBrlRecebido(0, []), { valor: 0, fonte: 'frozenTotal' })
assert.deepEqual(resolverBrlRecebido(null, []), { valor: null, fonte: 'ausente' })

// --- Estado da fatura ------------------------------------------------------
assert.equal(estadoDaFatura({ billed: 'true', paid: 'true' }), 'paga')
// billed:true + paid:false é fatura em aberto normal, não anomalia.
assert.equal(estadoDaFatura({ billed: 'true', paid: 'false' }), 'em_aberto')
assert.equal(estadoDaFatura({ billed: 'true', paid: undefined }), 'em_aberto')
// As 9 anomalias de #442: pagas sem marca de faturamento.
assert.equal(estadoDaFatura({ billed: undefined, paid: 'true' }), 'paga_sem_marca_de_faturamento')
assert.equal(estadoDaFatura({ billed: 'false', paid: 'true' }), 'paga_sem_marca_de_faturamento')
assert.equal(estadoDaFatura({ billed: undefined, paid: undefined }), 'nao_faturada')

console.log('OK — regras da migração conferidas')
