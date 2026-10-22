# 0079 — Decisões pendentes da revisão da PR 929

> **Situação atual (2026-10-22).** A decisão 6 (referência de "outro operador"
> no Baplie pelos containers dos B/Ls da Viagem) foi substituída pela
> [ADR 0095](./0095-importacoes-regras-da-revisao.md), decisão 14 (migration
> `402`): "outro armador" é decidido pelos códigos do armador da Viagem, sem
> depender dos B/Ls. As demais decisões continuam valendo.

Status: aceito — 2026-10-11 (decisões do dono). Implementado nas migrations
`203` a `206` e no frontend, em produção desde o merge da PR 929 em 2026-10-12
(ver "Evidência").

Supersede parcialmente a
[ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)
nos itens 19 (reemissão de Invoice de Demurrage com desconto ou disputa), 21
(referência de "outro operador" no Baplie) e 25 (reimportação de Granito na
Viagem inteira). Estende a [ADR 0077](./0077-fatura-emitida-nao-muda-de-valor.md)
à correção manual de Part Lot com B/L faturado.

## Contexto

A [revisão da PR 929](../archive/audits/2026-10-11-revisao-pr-929-importacoes.md)
corrigiu os achados técnicos e deixou nove pontos para o dono (seção "Decisões
pendentes"; o item 2 foi corrigido na própria revisão). O dono decidiu os outros
oito em 2026-10-11, a partir de casos práticos. A numeração abaixo é a da
rodada de decisões; entre parênteses, o item do relatório.

## Decisão

1. **Invoice de Demurrage com desconto ou disputa (item 1).** Quando as datas
   de container mudam, a Invoice emitida com desconto ou com disputa aberta não
   é reemitida sozinha: é tratada como a paga. A Régua de Cobrança suspende a
   cobrança e o alerta `demurrage_invoice_dates_changed` abre para o
   Administrativo, que cancela, gera de novo e refaz o desconto ou responde a
   disputa. Exemplo: Invoice de USD 1.000 com 20% de desconto comercial; a
   devolução é corrigida e o valor vai a USD 1.200. Reemitir sozinho perderia o
   desconto e cobraria USD 1.200 sem aviso. A suspensão sai quando os itens
   voltam a bater com as datas.
2. **Estorno da baixa de Invoice suspensa (item 3).** Continua automático: se as
   datas ainda diferem, o estorno reemite (ou mantém suspensa a Invoice com
   desconto ou disputa, pela decisão 1). A confirmação do estorno avisa isso
   antes de o usuário confirmar.
3. **B/L com CE vinculado depois (item 4).** Sem mudança de código. Ligar o
   `import-effects-runner` (Etapa 13 do plano) é pré-requisito antes de dados
   reais; até lá, a fatura desse B/L sai pela emissão manual em Taxas Locais.
4. **Emissão pelo CE sem tabela ou sem valor (item 5).** B/L sem tabela de
   cobrança ativa para o POD e a modalidade fica "Aguardando tabela de
   cobrança", com um alerta `billing_charge_table_missing` por POD e modalidade
   listando os B/Ls; o alerta fecha quando as faturas saem, e a emissão em lotes
   recalcula quando a tabela passa a existir. B/L calculado com todas as taxas
   zeradas fica "Nada a faturar", sem alerta. Nenhum dos dois abre
   `billing_auto_issue_failed`.
5. **Correção manual no Part Lot com B/L faturado (item 6).** A correção de
   perfil (IMO/OOG) ou de SOC/COC feita pelo B/L sem fatura vale para todos os
   B/Ls ativos do container. O B/L sem fatura é recalculado; o faturado segue a
   ADR 0077 pela base alterada (reemissão sem pagamento; com pagamento,
   restituição ou Fatura desatualizada). A correção que parte do próprio B/L
   faturado continua recusada, como desde a migration `115`, e a mensagem
   aponta o B/L sem fatura do mesmo container; a que parte de B/L cancelado
   também.
6. **Baplie "outro operador" (item 7).** A referência é o operador (NAD+CA) dos
   containers do arquivo que estão nos B/Ls ativos da Viagem; esses containers
   nunca são ignorados por operador. Sem nenhum deles no arquivo, vale o
   operador do cabeçalho (TDT ou o NAD+CA mais frequente), com aviso para
   conferir. Exemplo: navio de parceiro com TDT `MSC` e containers COSCO nos
   B/Ls da Viagem: os COSCO ficam, os MSC são ignorados com aviso.
7. **Granito (item 8).** Planilha sem nenhum B/L em comum com os já gravados na
   Viagem é manifesto novo e não pergunta pelos outros. Com B/L em comum é
   reimportação, restrita aos manifestos que ela toca: os ausentes desses
   manifestos só saem com confirmação; os outros manifestos da Viagem não são
   tocados.
8. **Escopo da PR (item 9).** Uma PR só para as Etapas 0 a 14 e as correções da
   revisão, com ensaio em Preview antes da produção. A regra "uma PR por etapa"
   do plano fica dispensada para esta entrega.

## Consequências

- Invoice de Demurrage negociada nunca é substituída sem uma pessoa refazer a
  negociação; a paga e a negociada saem pelo mesmo alerta.
- A emissão em lotes do CE deixa de tratar ausência de tabela e B/L sem valor
  como falha técnica; o alerta de tabela é por POD e modalidade, não por B/L.
- O Part Lot deixa de travar quando um irmão já foi faturado; a regra antiga
  continua para o B/L faturado aberto na tela.
- O contexto do Baplie lê os containers dos B/Ls da Viagem; o cache dele é
  invalidado com a carga.
- Duas planilhas COSCO legítimas da mesma Viagem convivem como manifestos
  separados. Teto: uma planilha corrigida que troque todos os números de B/L
  vira manifesto novo; a anterior sai pela confirmação de uma reimportação dela.

## Evidência

Testes de contrato no PostgreSQL 16 local com replay das migrations
(`auditoriaFaturasDemurrageComunicado`, `ceImportacaoContrato`,
`containerProfile`, `granitoReimportacao`) e testes de unidade do Baplie, do
Granito, do estorno de Demurrage e da importação de CE. Cada teste novo falhou
antes da mudança e passou depois. Até a decisão, nada foi verificado em
navegador nem em Supabase real.

**Deploy (conferido em 2026-10-13, em leitura):** o registro de migrations do
projeto Supabase de produção lista `203` a `206`, dentro da cadeia `174`–`219`; a
aplicação está registrada em
[servicos-externos.md](../operations/servicos-externos.md) ("Execução
(2026-10-12, produção)"). O registro prova que as migrations foram aplicadas,
não o comportamento em produção nem o fluxo em navegador.
