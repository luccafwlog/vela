# Correções e validação do fluxo financeiro — 2026-10-04

## Resultado e estado da entrega

As correções foram implementadas no checkout local e verificadas em testes de
componentes, serviços e PostgreSQL descartável. O [manual financeiro](../../operations/manual-financeiro.md)
descreve os procedimentos resultantes, com a condição de aplicação conjunta de
banco e telas.

**O usuário autorizou explicitamente a criação da nova migration em 2026-10-04.**
O [SQL completo da migration 148](../../../supabase/migrations/148_controles_financeiros.sql)
foi incluído na pasta de migrations e executado em banco local. Não foram editadas
migrations existentes, tipos gerados nem o gerador Pix protegido. Não houve
publicação, aplicação remota ou transferência bancária.

A proteção vem de `AGENTS.md`: “do not bypass the guard without explicit
authorization”. O hook `.claude/hooks/protect-files.sh` protege toda a pasta
`supabase/migrations`, incluindo arquivos novos. A inclusão ocorreu somente
após a resposta explícita “Autorizo” à solicitação específica.

## Achados tratados

| Achado da revisão inicial | Implementação e evidência |
|---|---|
| F01 — recibo confundia total emitido e recebimento | Recibo separa bruto, abatimento, devolvido, pendente e líquido. Individual coberta recebe data e valores atribuídos aos seus B/Ls. Testes de documento e resumo financeiro em banco. |
| F02 — tentativa técnica instável | Serviço deixa data opcional nula; tela congela chave, data, valor, método e referência após erro. Retry recupera a mesma operação. Testes de serviço, tela e banco. A tela já exigia data; não foi comprovado envio de data vazia pela interface. |
| F03 — excedentes, restituição excepcional e cancelamento incompletos | Pagamento local/avulsa acima do saldo registra bruto e restituição do excedente. Administrativo autoriza restituição excepcional de avulsa/Demurrage, com limite pelo recebido disponível. Cancelamento financeiro de B/L abate saldo e prepara devolução, inclusive em consolidada. Devolução integral excepcional cancela a fatura preservando o recebimento. Testes de componentes e banco. |
| F04 — regra de CNPJ pendente | Regra aprovada pelo usuário: devolver ao Cliente original e cobrar o novo. Cobrança nova aguarda devolução confirmada; documentos e pagamentos anteriores permanecem. Falha de emissão conserva pendência recuperável. Testes de pagamento parcial, consolidada, gate de reemissão e rotina de relink usada pelo importador. |
| F05 — ação e comprovação de restituição | Capacidade controla a ação; confirmação exige referência bancária, favorecido, data e confirmação explícita. Banco restringe escrita e protege devoluções confirmadas. Testes de permissão, evidência, replay e escrita direta. |
| F06 — seleção de baixa antiga | Detalhe permite escolher a baixa por identificação, data, valor e método antes de confirmar seu cancelamento. Teste de seleção e cancelamento. |
| F07 — mesmo comprovante com outra chave | Referência bancária obrigatória na tela e unicidade no novo caminho verificado; nova chave não duplica a referência. Tentativa cancelada não reaparece como sucesso. Testes de banco. |

O estresse revelou também que cancelar a baixa de uma avulsa reabria a fatura
com saldo zero. O recálculo foi corrigido e testado. Baixa falsa que gerou
excedente automático ainda não devolvido pode ser cancelada com auditoria;
restituição confirmada e ajustes independentes continuam protegidos.

A prévia de importação e a rotina de relink passaram a respeitar a mesma regra
de CNPJ. Recebimento de avulsa ou Demurrage ainda retido bloqueia a mudança até
a devolução confirmada. O importador não transfere pagamentos históricos ao
novo Cliente.

## Evidência final executada

| Verificação | Resultado |
|---|---|
| `npm test` | 687 arquivos e 3.848 testes passaram; 51 arquivos e 321 testes opt-in ficaram desabilitados nesta execução padrão. |
| Replay limpo das migrations ativas | 132 migrations ativas aplicadas com `ON_ERROR_STOP=1` em PostgreSQL local descartável. |
| `financialBattery.local-pg.test.ts`, isolado após replay | 3 testes passaram. |
| Suíte financeira adicional, sequencial | 13 arquivos e 108 testes passaram, incluindo 44 casos de `invoicePostBillingSafety.local-pg.test.ts`. |
| `npm run typecheck`, `npm run lint`, `npm run build` | Passaram. |
| `npm run rpc:check`, com `psql` local no PATH | 207 nomes de RPC de produção encontrados no catálogo local, incluindo a migration 148. |
| `npm run migrations:check` | Passou para as 132 migrations ativas, incluindo a 134. |
| `python scripts/security/verificar_guardas.py --ci` | Passou. A RPC legada, que recusa devoluções sem comprovante, também declara a guarda de Financeiro/Administrativo. |
| `auditMigration` aplicado diretamente ao SQL da 134 | Nenhum comando de reescrita destrutiva de dados existentes na aplicação da migration. |
| `npm run docs:check`, `git diff --check` | Passaram após a inclusão deste relatório. |

Os 13 arquivos de banco foram: `invoicePostBillingSafety`, `invoiceCorrection`,
`invoiceBasisCorrection`, `invoiceAutoReissue`, `invoiceReissue`,
`localBillingIntegrity`, `manualInvoice`, `demurrageMoney`, `demurrageAuthority`,
`exchangeRateIntegrity`, `pixBrCode`, `portalBillingRelease` e
`portalInspectionParity`, todos com sufixo `.local-pg.test.ts`.

Os erros de autorização e de valores inválidos impressos por esses testes
correspondem às recusas provocadas e verificadas, não a falhas da suíte.

## Limites e próxima ação

- PostgreSQL local usa os shims do repositório; não comprova Auth/API,
  concorrência distribuída de produção ou integração PSP/banco.
- Não houve execução ponta a ponta em navegador autenticado remoto. O caminho
  de importação foi verificado por testes de prévia e da rotina financeira de
  relink, não por uma importação financeira completa em produção.
- As APIs antigas de pagamento permanecem compatíveis. A referência obrigatória
  e sua unicidade são garantidas no novo caminho usado pela tela; não se presume
  identidade bancária apenas por igualdade de valor/data/notas em APIs antigas.
- Devolução confirmada por engano, divergência de valor/identidade de PIX e
  recebimento parcial ou excedente em Demurrage seguem os procedimentos
  assistidos do manual. Não se apaga evidência nem se fabrica baixa para resolver
  esses casos. O sistema não executa transferências bancárias.
- A inclusão autorizada da migration e a reconciliação documental foram
  concluídas. Publicação e validação bancária real são etapas distintas desta
  entrega local.

A [revisão inicial](../audits/2026-10-04-revisao-fluxo-financeiro.md) permanece
como registro histórico do diagnóstico anterior às correções; não representa
o comportamento final implementado neste relatório.
