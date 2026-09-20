# Auditoria forense do núcleo de Operação Marítima

Data: 2026-09-19  
Escopo: Viagens, Escalas, Atracações, Line-Up, omissões, transbordo e COD  
Base revisada: branch `main`, sem diff local no início da inspeção  
Modo: revisão rigorosa da skill canônica `vela-code-review`

> Este documento é um snapshot histórico da inspeção estática realizada na
> data acima. Não comprova comportamento em produção e não substitui
> `CONTEXT.md`, ADRs ou documentação viva de módulos.

## Veredito

O núcleo foi **reprovado para operação crítica** no escopo revisado. Foram
identificados **1 achado P0, 5 achados P1 e 1 achado P3**. Os riscos de maior
impacto são a repetição não idempotente de COD, invariantes protegidas somente
pela interface, ATD documental impossível de corrigir para uma data posterior
e Viagem cancelada ainda mutável.

Alguns caminhos informados no roteiro original haviam sido renomeados. A
inspeção seguiu os proprietários atuais, em especial
`src/components/voyages/VoyageVisaoTab.tsx`,
`src/components/bl/BlTransshipmentCard.tsx` e
`src/components/billing/CodAdjustmentsPanel.tsx`.

## Fontes de decisão

- Regras contratuais fornecidas para esta auditoria.
- [`CONTEXT.md`](../../../CONTEXT.md), incluindo a divergência conhecida do
  estado entre Atracações.
- [ADR 0024](../../adr/0024-cancelamento-viagem-estado-retido-exclusao-hard-delete.md):
  cancelamento retido e hard delete controlado.
- [ADR 0025](../../adr/0025-bl-fonte-documental-unica-container-atd-pol.md):
  `Laden on Board` como fonte do ATD canônico do POL.
- [ADR 0035](../../adr/0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md):
  Escala unificada e datas terminalizadas por sentido.
- [ADR 0051](../../adr/0051-cod-reprecifica-no-destino-final.md): COD,
  reprecificação e preservação do snapshot financeiro.
- [ADR 0052](../../adr/0052-escala-omitida-visivel-na-programacao.md):
  exposição de `OMIT` sem justificativa interna no Portal.

## Achados priorizados

### [P0] Repetir COD pode criar outro Ajuste Financeiro pendente

- **Localização exata:**
  `supabase/migrations/060_pr698_claude_review_followup.sql:688-745`,
  `supabase/migrations/002_business_logic_and_security.sql:1959-2058` e
  `supabase/migrations/001_initial_schema.sql:1192-1215`.
- **Regra violada:** COD é uma transição individual deliberada que deve
  produzir um único efeito financeiro auditável.
- **Evidência no código:** `set_bl_cod` não verifica se a disposição já é
  `cod`. Uma nova chamada executa novamente `apply_cod_financial_effect`. Para
  fatura sem pagamento, o ramo `v_paid_amount = 0` cria
  `cancel_and_reissue` mesmo quando a diferença recalculada é zero.
  `cod_adjustments` não possui unicidade que impeça outra pendência para a
  mesma transição.
- **Cenário de falha:** a resposta da primeira chamada se perde depois do
  commit e o operador tenta novamente. A segunda execução mantém o mesmo POD,
  mas cria outro ajuste pendente, outro audit log e outra notificação. O
  Financeiro pode receber duas ordens de cancelar e reemitir a mesma fatura.
- **Correção recomendada:** tornar `set_bl_cod` idempotente sob lock. Se a
  disposição já for `cod` e o POD já for o destino da omissão, retornar sem
  efeitos. Adicionar chave de idempotência ou unicidade parcial para a
  pendência da mesma transição. O helper deve retornar quando
  `v_difference = 0` antes de selecionar `cancel_and_reissue`.

### [P1] Estado permanece `Atracada` entre duas Atracações

- **Localização exata:** `src/lib/escalaState.ts:10-14` e
  `CONTEXT.md:233-242`.
- **Regra violada:** o estado da Escala deve representar o ciclo operacional
  atual, não qualquer ATB histórico.
- **Evidência no código:** depois de descartar “todas com ATD”, a função usa
  `atracacoes.some((atracacao) => atracacao.atb)`. Um ATB pertencente a terminal
  já concluído mantém toda a Escala como `atracada`.
- **Cenário de falha:** o navio encerra TVV com ATB e ATD e ainda não atracou
  em VBR. Durante o deslocamento, a Escala continua exibida como atracada.
- **Correção recomendada:** derivar `atracada` apenas quando existir Atracação
  com ATB e sem ATD. Se as anteriores terminaram e a próxima ainda não possui
  ATB, retornar estado nulo. Adicionar regressão multi-terminal.

### [P1] Remoção de exportação com carga é protegida somente pela interface

- **Localização exata:**
  `src/components/voyages/VoyageVisaoTab.tsx:105-166`,
  `src/components/shared/VoyageScheduleModals.tsx:798-844`,
  `supabase/migrations/002_business_logic_and_security.sql:19230-19242` e
  `src/services/voyageExportSchedules.ts:111-162`.
- **Regra violada:** desligar exportação é proibido enquanto houver granito ou
  Embarque de Vazios vinculado àquela Viagem e porto.
- **Evidência no código:** a tela calcula `exportLocked`, mas a RPC valida
  apenas contradições dentro do payload. Ela não consulta
  `granite_manifests` nem `vazios_export_operations`. A escrita direta na
  tabela também não repete essa validação.
- **Cenário de falha:** entre a leitura da tela e o salvamento entra um
  manifesto de granito; ou a RPC é chamada diretamente com
  `tem_exportacao=false`. A declaração é removida apesar da carga existente.
- **Correção recomendada:** sob o lock da Viagem, a RPC deve consultar as
  fontes canônicas por `(voyage_id, port)` e rejeitar a retirada. A tabela deve
  ser escrita apenas pelo proprietário transacional da operação.

### [P1] ATD do POL fica preso à menor data histórica e é aplicado pós-commit

- **Localização exata:** `src/services/ladenOnBoardAtd.ts:12-55`,
  `src/services/blFreightImport.ts:529-588` e
  `src/components/shared/BlImportModal.tsx:128-145`.
- **Regra violada:** a ADR 0025 exige recalcular a menor data
  `Laden on Board` entre os B/Ls atuais da mesma Viagem e POL.
- **Evidência no código:** o cálculo faz o mínimo entre `currentAtd` e apenas
  as datas do lote. `Laden on Board` não é persistido como fato próprio do B/L;
  é usado também como fallback de `bl_emission_date`. O ATD é aplicado em uma
  segunda operação pós-commit cuja falha vira somente aviso.
- **Cenário de falha:** o B/L A informa 08/07 por engano e o B/L B informa
  10/07. Depois de corrigir A para 12/07, o mínimo real deveria ser 10/07, mas o
  ATD permanece 08/07. Em outra execução, os B/Ls podem ser persistidos e a
  atualização do ATD falhar.
- **Correção recomendada:** persistir `laden_on_board` separadamente e
  recalcular `MIN(laden_on_board)` sobre todos os B/Ls da Viagem e POL após
  inclusão, correção ou remoção. Importação e atualização canônica devem
  pertencer à mesma transação.

O teste `src/services/__tests__/ladenOnBoardAtd.test.ts:24-25,67-81` fixa o
comportamento monotônico atual; ele deverá ser substituído por uma regressão
que permita ao mínimo canônico avançar após a correção do B/L mais antigo.

### [P1] Line-Up ignora a prioridade ATB → ATA → ETA

- **Localização exata:** `src/services/lineup.ts:411-419` e
  `src/services/__tests__/lineupSort.test.ts:9-44`.
- **Regra violada:** navios operando no berço devem vir primeiro, seguidos dos
  fundeados e depois dos esperados por ETA cronológico.
- **Evidência no código:** o comparador ordena diretamente por `eta`, depois
  `etb`, nome, viagem e porto. `atb` e `ata` não participam da classificação.
- **Cenário de falha:** um navio com ATB e ETA de amanhã aparece abaixo de um
  navio ainda esperado cuja ETA era hoje, ocultando a operação corrente na TV.
- **Correção recomendada:** criar comparador canônico por classes:
  `ATB sem ATD`, `ATA sem ATB` e pendentes por ETA. Definir explicitamente a
  posição de concluídas e omitidas e manter as duas linhas do mesmo
  `(viagem, porto)` adjacentes.

### [P1] Cancelamento não sela a Viagem e o motivo não é transacional

- **Localização exata:** `src/services/voyages.ts:69-105`,
  `src/pages/Viagens.tsx:75-93`,
  `src/components/voyages/VoyageCard.tsx:349-380`,
  `src/components/voyages/VoyageVisaoTab.tsx:213-221,297-352` e
  `supabase/migrations/002_business_logic_and_security.sql:18964-18969`.
- **Regra violada:** Viagem cancelada deve permanecer consultável, bloquear
  novas mutações operacionais e conservar o motivo auditável.
- **Evidência no código:** a interface desabilita apenas o botão de cancelar;
  edição de Viagem, Escalas e Atracações permanece disponível. A RPC trava a
  linha, mas não rejeita `status='cancelled'`. Separadamente, `cancelVoyage`
  atualiza o status e só depois, em outra requisição, insere o audit log.
- **Cenário de falha:** depois do cancelamento, um operador adiciona uma
  Atracação. Em outro caso, o update do status confirma e o insert do log falha;
  a Viagem fica cancelada sem motivo, embora a tela reporte falha.
- **Correção recomendada:** criar RPC transacional para status e auditoria.
  Todas as mutações operacionais devem rejeitar Viagem cancelada na camada de
  dados, e a interface deve refletir a mesma regra.

### [P3] Serviço exportado permite alterar destino fora da RPC de COD

- **Localização exata:**
  `src/services/blChangeOfDestinationService.ts:35-83` e
  `src/test/services/codManifestoHandling.test.ts:47-73`.
- **Regra violada:** COD nasce de uma omissão individual e exige justificativa,
  auditoria e efeito financeiro atômico.
- **Evidência no código:** sem `omissionId`, `applyChangeOfDestination` executa
  `UPDATE bls` diretamente. Não cria disposição COD, ajuste financeiro, audit
  log ou notificação. A busca estática não encontrou caller de produção, mas o
  caminho continua exportado e é legitimado por teste.
- **Cenário de falha:** um novo caller usa a API sem `omissionId` e produz um
  B/L cujo POD mudou, sem evento COD nem reprecificação.
- **Correção recomendada:** remover o caminho direto e tornar `omissionId`
  obrigatório. Uma correção cadastral de POD, se necessária, deve ser uma
  operação separada, autorizada e auditada.

## Controles conformes na inspeção estática

- TBC com ATB ou ETB participa da ordem cronológica; sem data vai ao final.
- Próxima Escala seleciona a menor ETA pendente, inclusive vencida, e ignora
  Escalas omitidas.
- A Linha do Tempo limita as fontes a fatos operacionais e importações.
- Omissão duplicada é serializada e retorna erro explícito para a constraint
  esperada.
- O caminho principal de COD preserva o CE Mercante, limpa
  `manifesto_mercante_id` e calcula o valor original sobre snapshot da invoice.
- A reversão da omissão é bloqueada quando existe B/L em COD.
- O Portal exibe `OMIT` sem motivo interno.
- FKs de `bls.voyage_id` e `bl_receivables.voyage_id` bloqueiam a exclusão da
  Viagem quando esses vínculos existem.

## Decisões pendentes por conflito documental

### Datas das linhas de Importação e Exportação

O requisito fornecido para a auditoria pede as mesmas datas em ambas as linhas.
A nota vigente da ADR 0035 determina ETA e ATA compartilhados, mas ETB e ATB
próprios da primeira Atracação que hospeda cada sentido. O código implementa a
ADR vigente: usa IDs de apresentação distintos e conserva a identidade comum
da Escala como `(voyageId, pod)`.

Exemplo: se a descarga ocorrer em TVV e o embarque em VBR, forçar datas iguais
faria a linha de exportação mostrar o berço de TVV. A substituição da ADR precisa
ser confirmada antes de isso ser classificado como defeito.

### Proibição absoluta de hard delete de Viagem

O requisito fornecido proíbe qualquer hard delete. A ADR 0024 aceita hard
delete controlado quando não existem dependências. O serviço atual segue essa
decisão e a camada de dados bloqueia B/Ls e recebíveis por FK.

Exemplo: uma Viagem de teste criada sem B/L, importação, manifesto ou recebível
pode ser removida hoje por administrador. Proibir essa ação é mudança de
contrato, não correção inequívoca da implementação vigente.

Pergunta de decisão: **é intenção superseder formalmente as ADRs 0035 e 0024
nesses dois pontos?**

## Evidência e limitações

- **Código:** inspeção estática dos componentes, serviços, migrations,
  constraints, policies e testes citados.
- **Teste existente:** os arquivos de teste foram lidos para avaliar cobertura;
  a existência do teste não foi tratada isoladamente como prova do fluxo.
- **Teste executado:** após instalar as dependências do checkout com `npm ci`,
  `npm test` concluiu com 624 arquivos aprovados, 27 ignorados, 3.369 testes
  aprovados e 130 ignorados. A suíte verde não reproduz os cenários adversos
  descritos nos achados; em alguns casos, ela fixa o comportamento questionado.
- **Gate documental:** `npm run docs:check` aprovou 154 arquivos Markdown, 55
  rotas e a cobertura do índice de ADRs; `git diff --check` também concluiu sem
  erro.
- **Runtime:** não verificado. Não houve acesso nem mutação de banco local ou
  remoto.
- Nenhum achado deste snapshot prova rollout em produção. As migrations foram
  avaliadas como definições locais versionadas.
