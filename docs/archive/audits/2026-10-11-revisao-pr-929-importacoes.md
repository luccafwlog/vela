# Revisão da PR 929 (correção das importações e do CE Mercante) — 2026-10-11

## Escopo

Revisão extensiva da PR 929 (`claude/correcao-importacoes-ce-mercante`, head
`36a993d`, base `main` em `b5785db`). A PR executa o
[plano de correção das importações](../plans/2026-10-09-correcao-importacoes-ce-mercante.md)
(Etapas 0–14) com as migrations `174`–`189`, cerca de 196 arquivos e 17 mil
linhas.

A revisão foi feita por nove revisores independentes, um por etapa e um
transversal (CI, testes e documentação). Cada achado foi confirmado no código
e, quando possível, reproduzido no Postgres 16 local com o replay das
migrations. Também entraram os três achados P1 da revisão automática (Codex)
publicados na PR.

O critério de comparação foi a
[ADR 0078](../../adr/0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
a [ADR 0077](../../adr/0077-fatura-emitida-nao-muda-de-valor.md) e o
`CONTEXT.md`.

## Conclusão

A PR não regrediu nenhuma função por partir de uma definição antiga. Conferimos
todas as redefinições contra a definição efetiva anterior, inclusive a `173` da
`main` e a renumeração `173–188 → 174–189`.

O CI estava vermelho no "Security guard replay", e as regras novas tinham
furos fora do caminho feliz. Os mais graves:

- **Segurança.** Quatro funções SECURITY DEFINER sem guarda estavam abertas a
  `authenticated`. Um usuário do Portal conseguia ler containers e o rateio de
  B/L de outro Cliente, os B/Ls do grupo de Demurrage dele e as métricas da
  fila.
- **Manifesto BB em XLSX.** Peso e cubagem digitados como número eram
  multiplicados por mil sem aviso: 135,263 t virava 135.263 t e ia para a taxa
  por tonelada. O próprio modelo `.xlsx` da tela era recusado.
- **Baplie.** A conferência de navio, viagem e escalas nunca rodava, porque a
  RPC das escalas não tinha GRANT para usuários. Um Baplie de outra viagem
  substituía as marcas e podia reemitir fatura.
- **Alerta de fila parada.** O job do pg_cron falhava toda hora sem JWT, e o
  Alerta nunca abria.
- **Viagem Cancelada.** A fatura de Granito (e a de B/L) da Viagem Cancelada
  não podia ser cancelada. Os Comunicados automáticos dessa Viagem falhavam a
  cada ciclo.
- **Datas, Demurrage e container compartilhado.**
  - A planilha de datas recusava o segundo B/L que divide o container.
  - Um irmão com fatura paga bloqueava para sempre a emissão do B/L que chega
    depois.
  - O B/L cancelado ancorava o grupo de Demurrage, e a mesma caixa era cobrada
    duas vezes.
  - Mudar o grupo depois da Invoice travava a baixa.
  - O recebível sem fatura travava a exclusão do B/L.
  - Qualquer UPDATE em itens de carga solta falhava.
- **Base de Clientes e Vazios.**
  - A Base de Clientes vinculava o B/L mas não o tirava da Revisão.
  - A importação de Vazios com POD BRNVT ou BRREC apagava o Manifesto Mercante
    recém-criado.
- **CE Mercante.**
  - A emissão em lotes abria Alerta crítico para B/L que só estava aguardando,
    e esse Alerta nunca fechava.
  - Corrigir o CE pela ficha não abria o alerta de Desbloqueio.
  - `apply_ce_mercante_update` continuava aberta como porta paralela, sem
    confirmação e sem motivo.

## Correções aplicadas

Todas foram aplicadas na mesma PR, em migrations novas. As `174`–`189` não
foram editadas.

| Migration | Tema |
|---|---|
| `190` | Segurança (REVOKE das quatro funções), `list_voyage_eligible_pods`, contexto do Histórico, fila parada no cron e por `next_attempt_at`, planilha de datas com container compartilhado, modalidade de carga, Viagem Cancelada (cancelar fatura, consolidada/avulsa, Comunicados automáticos), executor da fila, ATA sem preencher descarga |
| `191` | Demurrage e container compartilhado (irmão pago, recebível sem fatura, grupo, B/L cancelado, linhas antigas, estorno, descarga após devolução) |
| `192` | Base de Clientes (Revisão e fila), Granito (ausente com Invoice), Vazios (porto normalizado, Nº canônico, espelho), Histórico do Transbordo, carga solta (fila, Consignee, retenção) |
| `193` | Programação por planilha (Portal, IMO, Viagem Cancelada, linhas repetidas) e Veículos (Histórico do Mover, travas) |
| `194` | B/L de container (mensagens, VIN, chassi em cancelado, CNPJ alfanumérico) e Baplie no banco (SOC/COC com perfil manual, origem "bl", "Vale o B/L", Part Lot, corrida) |
| `195` | CE Mercante (esperas na emissão, alerta de Desbloqueio pela ficha, porta paralela, consolidada, Granito na prévia, INSERT com CE, rastro, portos normalizados) |
| `196` | Granito: totais de todos os manifestos da Viagem (achado da revisão automática) |
| `197` | Demurrage: status `overdue` gravado a cada gravação de datas e por job diário (achado da revisão automática) |
| `198` | Granito: sugestão de Cliente na detecção de mudança da reimportação (achado da revisão automática) |
| `199` | Programação por planilha: trava da Viagem nova pelo nome e pelo IMO, para arquivos simultâneos com e sem IMO (achado da revisão automática) |
| `200` | Demurrage: container de B/L ou de Viagem Cancelados sai do atraso, no cancelamento e no job diário (achado da revisão automática) |
| `201` | Planilha de datas confere a prévia que viu a descarga vazia; Programação pega as travas antes da primeira linha, em ordem fixa, sem deadlock (achados da revisão automática) |
| `202` | Mover veículos recusa veículo de Viagem Cancelada; Programação grava o IMO no navio sem IMO achado pelo nome (achados da revisão automática) |

No front:

- leitor de planilhas: Embarque de Vazios com o seletor comum e confirmação de
  linhas ocultas; CSV Windows-1252; colunas repetidas por campo; sistema de
  datas 1904; máscaras; avisos de linhas ocultas;
- Baplie: POD desconhecido, TDT, LQ, OOG, reemissões, conciliação;
- prévias da importação de B/L e do Manifesto BB;
- prévia da Programação: a mesma Viagem nova com e sem IMO entra na
  conferência de datas repetidas, e o mesmo navio novo com dois IMOs recusa as
  linhas;
- Base de Clientes: o aceite da troca de razão social vale para o nome de antes
  que a prévia mostrou;
- aceite por lote no B/L avulso; o aceite da troca de Cliente e a confirmação
  de faturamento da carga solta guardam as transições mostradas e são
  conferidos de novo na gravação (trocar arquivo ou Viagem desmarca);
- CE Mercante: esperas, "Ver B/Ls" com portos normalizados, prévia refeita;
  a troca confirmada é conferida de novo antes da gravação e, se mudou depois
  da prévia, a tela mostra a troca nova em vez de gravar com o motivo antigo;
- relatório da escala com o perfil manual;
- Histórico, onde o contexto da importação aparece como "Origem";
- catálogo de Alertas.

Cada correção não trivial tem caso de regressão. Os casos foram rodados contra
o código anterior: falham sem a correção e passam com ela.

## Evidência

Local, Postgres 16 descartável:

- replay limpo das migrations `001`–`202` com as checagens de invariantes do
  CI;
- as 76 suítes `local-pg` na ordem do CI: 593 + 3 testes;
- 4.415 testes unitários;
- `typecheck`, `lint`, `build`, `docs:check`, `migrations:check`, `rpc:check`
  e `verificar_guardas.py` verdes.

Os casos novos das `196`–`202` falham sem a migration e passam com ela. No
caso da `199`, sem a migration, dois arquivos simultâneos criaram dois navios
(um com IMO e outro sem). No caso da `200`, o container seguia em atraso
depois de cancelar o B/L. No caso da `201`, dois arquivos com as mesmas Viagens
em ordens diferentes davam "deadlock detected".

O que vale como evidência final é o CI do último commit da PR.

Nada foi verificado em navegador nem em ambiente Supabase real. Nenhuma
migration foi aplicada em produção.

## Decisões pendentes (não decididas pela revisão)

> **Nota editorial — 2026-10-11.** O dono decidiu os itens 1 e 3 a 9 depois desta revisão; as decisões estão na [ADR 0079](../../adr/0079-decisoes-pendentes-da-revisao-da-pr-929.md) e a implementação nas migrations `203` a `206`. O texto abaixo é o registro da revisão.

1. **Demurrage reemitida por mudança de datas** (ADR 0078, item 19): a fatura
   nova nasce sem o desconto e sem a disputa da anterior. Opções: levar desconto
   e disputa para a nova, ou tratar Invoice com desconto ou disputa como o caso
   pago (Alerta, sem reemitir).
2. **`overdue` não é mais gravado** desde a `179`. O selo de alertas, o KPI de
   containers em atraso, a ficha do Cliente e o filtro da página Demurrage
   leem esse status e ficam zerados. *Corrigido depois, na mesma revisão, pela
   migration `197` (achado P1 da revisão automática): status gravado a cada
   gravação de datas e por job diário.*
3. **Estorno da baixa de Invoice de Demurrage suspensa** (`191`): reemite
   automaticamente quando as datas ainda diferem. Isso segue a leitura do item
   19, mas é ação automática disparada por estorno.
4. **B/L com CE vinculado pela Base de Clientes ou pela Revisão**: a fatura só
   sai quando a fila de efeitos processar, e a fila está desligada até a
   Etapa 13.
5. **Emissão pelo CE**:
   - as esperas ficam com status `blocked` e `waiting: true`, e não "retida";
   - "B/L sem linhas faturáveis" e "Tabela incompleta" ainda abrem
     `billing_auto_issue_failed`.
6. **Correção manual de perfil ou SOC/COC no Part Lot** (`194`): um irmão
   faturado recusa a correção inteira, e a correção que parte de B/L cancelado
   é recusada.
7. **Baplie "outro operador"**: o NAD+CA é comparado com o elemento do TDT. Em
   navio de parceiro (VSA, slot charter), containers do armador da Viagem podem
   ser ignorados. A referência poderia ser o SCAC do armador.
8. **Granito**: duas planilhas COSCO legítimas da mesma Viagem passam a ser
   tratadas como reimportação.
9. **Escopo da PR**: o plano prevê uma PR por etapa, e esta traz as Etapas
   0–14 mais as correções desta revisão.

## Limitações conhecidas não corrigidas (baixo impacto)

- Separador de CSV escolhido pelo SheetJS quando há empate entre `;` e `,`.
- Modelo `ce-mercante-modelo.xlsx`: coluna CE como texto só em B2:B3, e CEs de
  exemplo com 9 dígitos.
- ~~As telas de PIX e ZPT não mostram o aviso de linhas ocultas.~~ Corrigido
  depois, na mesma revisão (achado da revisão automática): o PIX mostra o aviso
  no resultado, antes de Confirmar, e a ZPT o lista na confirmação. No Importar
  B/L, que lê o arquivo pela posição das células, o aviso diz que as linhas e
  abas ocultas são lidas.
- A prévia de carga solta não avisa B/L novo em porto omitido.
- O documento congelado da fatura não cobre a consolidada no Vela nem o
  Granito.
- `import_vehicle_rows_transactional` e dois B/Ls do mesmo arquivo com o mesmo
  chassi ainda podem dar 23505 cru.
- Desempenho da prévia e do gatilho de unicidade do CE com volume real: a
  medição não incluiu faturas nem Granito.
- Baplie: o POD fora da lista fixa de portos (`portCode.ts`) é ignorado antes
  da conferência com as escalas da Viagem. Hoje isso não descarta container de
  escala válida, porque toda escala é gravada pela mesma lista: porto fora dela
  vira `-`. Se a lista passar a vir do cadastro de portos, as duas pontas mudam
  juntas (achado da revisão automática, não corrigido).
