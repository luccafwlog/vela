# Revisão do fluxo financeiro — 2026-10-04

## Escopo e conclusão

Revisão do Vela/Portal Fwlog no checkout
`2edd24ffce45b133342f6f58c376d981f9d203aa`, com testes adicionais desta revisão.
Abrange emissão individual/consolidada/avulsa, pagamento, baixa, recibo,
conciliação, restituição, correção do B/L e valores, mudança de Cliente/CNPJ,
cancelamento/reativação e diferenças de Demurrage.

As transições centrais exercitadas conservam saldo e dinheiro recebido,
preservam a fatura emitida e impedem dupla conciliação do mesmo TXID local.
Há lacunas de produto e procedimento: recibo após abatimento, restituição fora
do fluxo automático, troca de devedor após pagamento e recuperação de tentativa
manual sem data. Portanto, testes verdes não significam que toda exceção já
possua uma solução completa na interface.

O [manual operacional](../../operations/manual-financeiro.md) define a ação do
usuário para cada situação e identifica quando o encaminhamento assistido é
necessário. Esta revisão não implementou correções de produto ou migrations.

## Método e limites

- **Código:** telas, serviços, hooks, definições finais das migrations e ADR
  0077. Funções com sobrecargas foram conferidas no catálogo do banco local.
- **Teste:** PostgreSQL 16.13 descartável em `127.0.0.1`, banco `vela_test`,
  com replay das 131 migrations e shims do script de setup do repositório.
  Cliente `psql` 17.11; autenticação simulada com claims e `SET ROLE` nos casos
  correspondentes. Binários provisórios em `/tmp`, sem dependência adicionada.
- **Teste:** Vitest/Testing Library para interface e serviços, incluindo mocks
  de Supabase. Mocks não comprovam integração Auth/PostgREST.
- **Sem Runtime remoto:** não houve escrita em Supabase publicado, transferência
  bancária, envio de comunicação ou acesso a dados reais. Não foi observado o
  fluxo completo em navegador autenticado contra um backend publicado.
- O teste concorrente cria oito sessões para o mesmo PIX. Não mede capacidade
  de carga, latência sob grande volume, deadlocks entre domínios ou SLA bancário.
- Banco local não executa PSP/Itaú, Edge Functions reais, scheduler/Vault reais,
  entrega de e-mail ou todas as identidades/sessões do Portal.

## Evidência executada

| Bateria | Resultado | O que comprova |
|---|---|---|
| 13 arquivos de integração financeira | 95 testes passaram | Correções, reemissão, Pix histórico, recibíveis, CNPJ com pagamento, Demurrage, câmbio, gates e Portal simulado |
| `financialBattery.local-pg.test.ts`, isolada após replay limpo | 3 testes passaram | Consolidação/cobertura/baixa desfeita, disputa/recálculo, múltiplos parciais e excedente manual no banco |
| 30 arquivos de componentes/serviços selecionados | 234 testes passaram antes do teste adicional de recibo | Fluxos de tela, documentos, avulsa, filtros, conciliação e invalidações |
| Documento local, após acrescentar caracterização do recibo | 9 testes passaram | Confirma a impressão do total original mesmo com recebimento menor |
| Suíte geral sem opt-in remoto/local | 3.841 testes passaram; 306 ignorados; 686 arquivos aprovados | Regressão geral; os testes ignorados não contam como validação |

Também passaram `npm run typecheck`, `npm run lint`, `npm run build`,
`npm run docs:check` e `git diff --check`. O teste de recibo acrescentado durante
a verificação foi executado novamente de forma focada. A revisão alterou
somente documentação e testes; o produto mantém as lacunas descritas abaixo.

Total financeiro em PostgreSQL: **98 testes distintos**, incluindo **14 novos
casos** no arquivo `invoicePostBillingSafety.local-pg.test.ts`. A execução
ampliada desse arquivo passou em 29 testes.

A primeira execução conjunta de 14 arquivos terminou com 84 casos aprovados e
uma falha no `afterAll` da bateria financeira: ele exigia zero versões tarifárias
no banco inteiro, mas outro arquivo deixou uma versão de fixture. Em banco
recriado, a bateria isolada passou; os outros 13 arquivos passaram juntos.
Não foi alterado nem relaxado o teste original. Esse resultado limita a
composição das suítes e não demonstra perda de dinheiro pelo produto.

Uma hipótese de incompatibilidade de `p_request_id` foi descartada por teste:
existe sobrecarga de nove argumentos nas migrations 066/070 e ela aceita a
chamada da tela. A sobrecarga de oito argumentos continua existindo. Ausência
do parâmetro em uma das definições não é evidência de falha da API completa.

## Matriz de provocação

| Cenário exercitado | Resultado observado | Evidência |
|---|---|---|
| 8 confirmações concorrentes do mesmo PIX de R$ 600 | Uma baixa, um settlement com TXID e saldo zero | Novo teste de concorrência em `invoicePostBillingSafety.local-pg.test.ts` |
| Repetição manual com mesma chave/conteúdo | Uma baixa de R$ 200 | Novo teste da sobrecarga de nove argumentos |
| Mesma chave com data diferente em um segundo | Rejeita outro payload; preserva uma baixa | Novo teste da sobrecarga de nove argumentos |
| Mesmo comprovante com duas chaves distintas | Dois lançamentos de R$ 200; saldo cai para R$ 200 | Novo teste de caracterização; exige controle operacional de comprovantes |
| Lote: primeiro PIX válido e segundo R$ 599 para QR de R$ 600 | Comando falha e nenhuma das duas baixas persiste | Novo teste de rollback do lote |
| Redução R$ 600 → R$ 500 com 9 valores recebidos | Saldo = máximo(500 − recebido, 0); restituição = máximo(recebido − 500, 0); original permanece R$ 600 | Novos casos: 1; 99,99; 100; 200; 499,99; 500; 550; 600; 650 |
| Cliente muda após pagamento de R$ 200 | Fatura/dinheiro continuam no Cliente original; sem sucessora; alerta ativo | Novo teste de troca de Cliente |
| Centavo residual | R$ 0,01 continua aberto, em vez de quitado | `localBillingIntegrity.local-pg.test.ts` |
| Individual paga pela consolidada | Individual coberta; saldo compartilhado quitado | `financialBattery.local-pg.test.ts` |
| Individual quitada invalida consolidada | Estados e vínculos recompostos pelo fluxo financeiro | Bateria financeira e correções de consolidação |
| Correção sem pagamento, inclusive dois B/Ls juntos | Cancela/reemite; consolidada recriada uma vez; histórico liga sucessora | `invoiceBasisCorrection.local-pg.test.ts`, `invoiceAutoReissue.local-pg.test.ts` |
| Reimportação idêntica | Não reemite desnecessariamente | `invoiceAutoReissue.local-pg.test.ts` |
| Correção paga com aumento | Não muda fatura; alerta pede tratamento por avulsa | `invoiceBasisCorrection.local-pg.test.ts` |
| QR anterior da sucessora com excedente | Quita até saldo atual e gera restituição | `invoicePostBillingSafety.local-pg.test.ts` |
| QR anterior com valor incorreto ou já quitado | Recusa baixa e encaminha revisão | Mesmo arquivo |
| QR anterior após troca de Cliente/cancelamento sem sucessora | Não baixa outro Cliente nem documento cancelado | Mesmo arquivo |
| Baixa sustenta restituição | Bloqueia cancelamento que retiraria lastro | Mesmo arquivo e `invoiceCorrection.local-pg.test.ts` |
| Consolidada com dois B/Ls | Pagamento de outro B/L não financia restituição indevida | Mesmo arquivo |
| Falha forçada no registro de restituição | Preserva pendência; retry aplica ajuste sem reeditar B/L | Mesmo arquivo |
| Container compartilhado: cancelar vizinho ou mover viagem | Recalcula B/Ls vizinhos, inclusive destino | Mesmo arquivo |
| Correção associada a COD e retry | Não repete abatimento/restituição | Mesmo arquivo, três casos existentes |
| Troca de Cliente sem pagamento | Individual para novo Cliente; consolidada incompatível encerrada | `invoiceBasisCorrection.local-pg.test.ts` |
| Cancelar B/L com obrigação aberta | Bloqueia; cancelado fica em leitura; reativação auditada | `blCancel.local-pg.test.ts` |
| Apagar CE com fatura | Bloqueia; permite correção documental pelo fluxo próprio | Mesmo arquivo |
| Avulsa sem B/L ou com viagem/B/L | Emite contexto válido; pagamento não altera ledger do B/L | `manualInvoice.local-pg.test.ts` |
| Gate Portal/CE sem autorização | Retém/recusa; liberação autorizada reprocessa | `portalBillingRelease.local-pg.test.ts`, `blDocumentalGates.local-pg.test.ts` |
| Demurrage: Pix repetido, valor antigo, desconto integral | Idempotência, janela de valores e zero sem QR | `demurrageMoney.local-pg.test.ts` |
| Demurrage: valor forjado pelo navegador | Motor do banco prevalece; DML financeiro direto recusado | `demurrageAuthority.local-pg.test.ts` |
| PTAX inválida ou falha de job | Validação e fila de recuperação preservadas | `exchangeRateIntegrity.local-pg.test.ts` |

## Achados e ação requerida

### F01 — P1: recibo local pode sugerir recebimento maior que o real

**Código e Teste de componente.** `InvoiceDocumentLocal` troca o título para
recibo, mas imprime `invoice.total_brl`. O botão aparece em `paid`/`covered`.
Após abatimento, total R$ 600 e pagamentos R$ 500 podem resultar em saldo zero
e recibo com total R$ 600, sem demonstrar abatimento. Restituições não aparecem
nesse documento; individuais cobertas podem não ter data porque os pagamentos
estão na consolidada.

Teste de caracterização acrescentado em
`src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx`.
Procedimento imediato: seção 6 do manual, demonstrativo/comprovantes
complementares e tratamento assistido quando o recibo for enganoso.
Correção recomendada: separar total emitido, recebido, abatimento, devolvido e
líquido; identificar cobertura e data do pagamento na consolidada. Validar
documento com Administrativo/Financeiro antes da adoção como prova isolada.

### F02 — P1: tentativa manual sem data pode perder a recuperação idempotente

**Código e Teste de banco.** O modal preserva `ledgerPaymentRequestId` após
erro, mas, sem data digitada, o serviço gera `new Date().toISOString()` a cada
envio. O hash do banco inclui `paid_at`; mesma chave com outra data é recusada
por `outro payload`. Assim, após timeout, repetir a tentativa pode falhar em vez
de recuperar seu resultado. O caso completo de timeout no navegador permanece
**Suspeita**; o conflito temporal foi executado em banco real local.

Procedimento: consultar histórico antes de repetir e encaminhar conflito ao
suporte. Correção recomendada: congelar o conteúdo integral da tentativa,
inclusive data, até conclusão; renovar chave somente para uma nova operação
de negócio. Avulsa usa o ramo genérico sem esse identificador no serviço.

### F03 — P1: restituições fora do ajuste automático não têm caminho universal

**Código.** A RPC liquida uma restituição já cadastrada; o painel de correção
não permite digitar novo valor, conforme ADR 0077. A interface também bloqueia
recebimento manual acima do saldo, embora o banco do ledger aceite e gere refund.
Logo, suporte a excedente no banco não prova que o usuário consegue registrar
esse caso pela tela. Erro de preço, devolução integral por cancelamento, estorno
marcado por engano e reembolso de Demurrage não têm um procedimento completo
validado na mesma experiência.

Procedimento: encaminhamento assistido com comprovantes; nunca desfazer baixa
verdadeira como substituto de devolução. Correção recomendada: fluxo autorizado
para registrar motivo/lastro/favorecido e comprovação da devolução, incluindo
correção de uma liquidação registrada por engano. Não usar chamadas SQL diretas
como instrução para o usuário final.

### F04 — P1 de processo: troca de devedor após pagamento exige decisão humana

**Teste de banco e Código.** O sistema preserva a fatura e dinheiro no Cliente
original e abre Fatura desatualizada; não migra automaticamente o recebimento
ao novo CNPJ. Isso é a regra atual, não um erro que deva ser corrigido
transferindo dinheiro silenciosamente.

Procedimento: Administrativo/Financeiro/Documentação definem se houve pagamento
por terceiro, cobrança de novo devedor com devolução ao original ou outra
regularização aprovada. Registrar vínculos e comprovantes antes de cobrar de
novo. A política final de compensação/transferência entre Clientes é **decisão
de negócio pendente**, não foi inventada nesta revisão.

### F05 — P2: confirmação de restituição e permissões da tela divergem

**Código.** `canSettleRefund` controla o rótulo do status, mas o botão
Marcar estornado é montado para qualquer refund pendente. A RPC restringe
Financeiro/Administrativo. O handler marca `settled` sem capturar comprovante
bancário nem abrir a confirmação explícita prevista pelo contrato do sistema.
Isso não comprova bypass de autorização: o banco tem a proteção.

Procedimento: usuário sem permissão encaminha; autorizado só marca após
devolver e guardar comprovação. Correção recomendada: aplicar capacidade ao
botão e exigir confirmação com valor, favorecido e evidência da transferência.

### F06 — P2: histórico não oferece escolha evidente de qualquer baixa

**Código.** `listReconciliationHistory` escolhe a baixa mais recente da fatura;
o modal recebe um `paymentId`. O detalhe lista os pagamentos, mas o fluxo
examinado não oferece seletor para cancelar uma baixa antiga específica.

Procedimento: conferir identidade da baixa; se a selecionada não for a errada,
encaminhar. Correção recomendada: ação por pagamento, com valor/data/referência
e impacto previsto na confirmação.

### F07 — P2: novo lançamento pode repetir o mesmo comprovante manual

**Teste.** Duas chaves distintas para o mesmo conteúdo geram dois pagamentos.
A idempotência protege a repetição da tentativa técnica; não identifica a
duplicação do fato bancário quando criado como outra operação.

Procedimento: conferir comprovante/referência/histórico antes de registrar;
cancelar somente a baixa duplicada, com motivo. Correção recomendada: referência
de transação obrigatória quando disponível e detecção assistida de duplicatas.

## Casos ainda não comprovados

| Pendência de validação | Como verificar em ambiente controlado | Critério de aceitação |
|---|---|---|
| Mesmo TXID entre taxas locais e Demurrage | Criar colisão e tentar confirmar nos dois domínios por chamada direta e UI | Uma transação não quita duas obrigações; regra garantida no banco |
| Cancelar baixa e repetir mesma chave manual | Executar pagamento, cancelamento e retry do request original | Retorno e estado correspondem ao ledger atual; sem resultado antigo enganoso |
| Alterar identidade/número do B/L faturado | Executar fluxo documental autorizado, com individual/consolidada/Portal | Vínculos íntegros e histórico da substituição; sem documento órfão |
| CNPJ do pagador diferente do devedor | Validar cenários de representante/pagamento por terceiro com negócio | Procedimento de identificação aprovado; não inferir troca do devedor |
| Todas as identidades e RLS reais | Testar cada papel e dois Clientes contra Auth/PostgREST isolado | Leitura e mutações limitadas ao escopo autorizado |
| Queda de rede no instante do commit | Cortar resposta da API após confirmação do banco | Recuperação idempotente com conteúdo preservado |
| Pagamento e correção/cancelamento simultâneos | Duas sessões concorrentes com barreira nos locks | Sem dupla cobrança, devolução indevida ou deadlock sem recuperação |
| Banco/PSP e QR cancelado | Validar Pix estático e futura COB Itaú com sandbox do PSP | Cancelamento bancário real distinguido do estado do aplicativo |
| Restituição errada, total ou de Demurrage | Homologar fluxo assistido e aprovar política de devolução | Dinheiro, documentação e registros reconciliados |
| Volume grande e arquivos defeituosos | Extratos grandes, datas inválidas, linhas duplicadas e interrupção de upload | Sem omissões silenciosas; desempenho medido e exceções rastreáveis |

Essas linhas são roteiro de homologação, não cenários alegadamente executados.
O manual já indica encaminhamento para que a falta de automação não seja
confundida com permissão para alterar saldos ou vínculos diretamente.

## Reproduzir a evidência local

Na raiz do repositório, com PostgreSQL 16 local preparado conforme
`scripts/setup-local-pg.sh` e ferramentas do PostgreSQL no `PATH`:

```bash
LOCAL_PG_INTEGRATION=1 LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vela_test \
  npm test -- --no-file-parallelism src/integration/invoicePostBillingSafety.local-pg.test.ts
npm test -- src/components/billing/__tests__/InvoiceDocumentLocal.behavior.test.tsx
npm run docs:check
git diff --check
```

Os dados e a senha acima são exclusivos do banco descartável local. A bateria
financeira global deve ser executada em replay limpo, separada de suítes que
deixem versões tarifárias. Integração Supabase real exige ambiente isolado e
segue [Testes](../../setup/testing.md).

## Nota editorial — implementação posterior em 2026-10-04

O relatório acima preserva a revisão inicial. Após autorização para corrigir, as telas e serviços passaram a incorporar os controles descritos na [decisões implementadas](../specs/2026-10-04-controles-financeiros-design.md). O [manual](../../operations/manual-financeiro.md) passou a descrever a edição corrigida. Após autorização explícita, a migration 134 foi incluída e validada na cadeia local; isso não comprova implantação.

A investigação de F02 confirmou a instabilidade do serviço ao preencher uma data opcional com o instante de cada chamada. A hipótese de enviar data em branco pela tela foi descartada: `paymentFormSchema` já exige a data. O teste da tela usa data preenchida e verifica preservação de chave, data, valor e referência após timeout. Não se deve interpretar o diagnóstico inicial como prova de que a tela aceitava data vazia.

O usuário definiu para F04: devolver o recebido ao Cliente original e emitir para o novo Cliente. Os testes posteriores também revelaram o saldo de avulsa não recomposto após cancelar baixa; essa correção adicional e o caminho do importador passaram a integrar a implementação proposta.
