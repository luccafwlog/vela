# Correção dos achados da PR 839

Estado: implementação concluída e plano encerrado como registro da validação
local em 2026-10-02. Este snapshot antecede o commit/push; publicação e CI do
item 6 são registrados na PR 839 e no resultado da tarefa, não inferidos daqui.

Objetivo: corrigir F1–F6 da revisão de 2026-10-02 na própria PR, incluindo os limites de rateio e recuperação identificados no relatório. A integração bancária Itaú continua futura; este trabalho corrige os contratos financeiros locais que ela deverá consumir.

Arquitetura: nova migration 130, sem editar migrations existentes nem tipos gerados/Pix protegido. Documento emitido mantém total/itens; apresentação Pix usa saldo pagável e guarda versões anteriores. A conciliação resolve versões históricas somente para uma obrigação do mesmo Cliente e mesma composição. Correções distribuem restituições por recebimentos do recebível. COD delega o efeito monetário à mesma correção. Cache financeiro é um efeito compartilhado.

## Restrições

- Nenhuma mutation de produção, deploy, merge ou implementação de credenciais/webhook Itaú.
- Commit e push na branch `feat/fatura-emitida-imutavel` estão autorizados pelo pedido de atualizar a PR.
- Replay/testes SQL somente no Postgres 16 descartável; fonte dos casos: relatório da revisão e reproduções preservadas.
- Planos vivem em docs/plans e são arquivados após execução; auditoria original preservada como histórico.

## Tarefas

1. [x] Converter os casos em `invoicePostBillingSafety.local-pg.test.ts`: saldo 400/QR 400; split 600+600 e refund 700; QR antigo 600/sucessora 500 com refund 100 e repetição idempotente; COD 100 uma vez; alerta encerrado após correção; rateio entre vizinhos. Rodar e observar falhas antes de implementar.
2. [x] Criar `130_correcao_faturamento_pix_e_cod.sql`: sincronização e histórico do Pix, resolução autoritativa de TXIDs e pagamentos tardios, devolução distribuída, coordenação COD e reconciliação de alertas. Acrescentar testes de Cliente/composição divergentes, valor divergente, documento já pago, cancelamento sem sucessora e reprocessamento.
3. [x] Corrigir `reconciliacao.ts`, apresentação de Pix interna/Portal e `cacheEffects.ts`/chamadores. Testar matching de cobrança histórica, propagação de erros de RPC e invalidação no salvar B/L.
4. [x] Cobrir vizinhos de container compartilhado e recuperação financeira durável, com testes de transação e erro/retry.
5. [x] Atualizar documentação viva e ADR 0077/spec Itaú sobre contrato local. Replay limpo, suítes SQL CI, seed, todos os testes, typecheck/lint/build/docs/migrations/rpc. Revisão independente conforme skill executing-plans; corrigir achados dessa revisão.
6. [ ] Arquivar este plano, commitar, atualizar a PR e acompanhar somente o CI do commit publicado até terminar.

## Foco da revisão final

Corrida recebimento/cancelamento; duplicidade webhook futuro/extrato; QR histórico com Cliente ou composição alterados; disponibilidade de refund após devoluções anteriores; correção de um vizinho sem alteração no próprio snapshot; COD parcialmente pago; rollback e recuperação com erro financeiro.

## Evidência local final

- F1–F6 e quatro combinações adicionais da revisão independente corrigidas.
- Quinze cenários novos: Pix corrente/histórico, sucessora e consolidada,
  repetição/valor divergente/Cliente incompatível, restituições repartidas,
  estorno por recebível, COD integral/parcial/retry, alertas, rateio de vizinho
  e de viagem de destino, falha financeira persistida e recuperada.
- Replay limpo de 128 migrations + asserções pré-seed; 38 suítes SQL de CI,
  201 testes passaram; seed e asserções pós-seed passaram.
- Suíte geral: 3.808 passaram, 284 ignorados por condições de ambiente. Casos
  SQL novos foram executados com LOCAL_PG_INTEGRATION=1, não só coletados.
- Typecheck, lint, build, limite de bundle, docs, migrations, catálogo RPC e
  git diff --check passaram. Migrations anteriores e tipos/Pix protegidos
  permaneceram intactos.
- PostgreSQL 16 descartável com shims Supabase e adaptador psql via cliente pg.
  Um timeout do teste de catálogo durante execução simultânea desapareceu na
  reexecução completa sem disputa: 38/38 passaram, sem aumentar timeout.
- Revisão independente concluiu quatro achados concretos, reproduzidos antes
  do fix e cobertos na suíte verde. O primeiro modelo ficou indisponível por
  cota; o revisor alternativo concluiu. Sem itens menores adiados.
- Não observados localmente: navegador, Auth/API Supabase remota, Itaú sandbox
  ou produção. A API Itaú, cancelamento bancário, outbox e webhook seguem
  futuros. QR estático antigo não é invalidado no PSP; sem sucessora
  compatível/já quitado, o extrato conserva exceção para revisão financeira.
