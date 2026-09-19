# 0034 — Notificação Interna é conceito separado do Alerta: o sino entrega, `/alertas` trata

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** Ler notificação não fecha alerta; encerramento é pela origem, com dispensa temporária justificada no lugar de acknowledge/fechamento manual.
> Rastreabilidade: [ADR 0053](./0053-ciclo-de-vida-alerta-dispensa-temporaria.md); [migration ativa 029](../../supabase/migrations/029_alert_item_upsert_idempotence.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-24

## Contexto

Uma sessão de grilling sobre o sistema de notificações e alertas (2026-07-24)
partiu do pedido de acrescentar um "sino" com notificações globais ao sistema
interno e expôs uma colisão de modelo que não aparece na descrição do pedido:

1. **`alerts` é uma fila coletiva, não uma caixa pessoal.** A tabela existe
   desde a migration `001` com `status` (`open` → `acknowledged` → `closed`)
   **global**: quando um usuário reconhece, a pendência muda de estado para
   toda a equipe. Um sino, por definição, precisa de estado de leitura **por
   usuário**. As colunas `assigned_to` e `notified_at` existem desde `001` e
   nunca foram usadas.
2. **Há cerca de vinte produtores de alerta em SQL.** Faturas vencidas,
   pendências e exceções do Portal, convite expirado, abuso de login, disputas
   e seções pendentes do ADR inserem em `alerts` a partir de RPCs e triggers.
   Qualquer modelo que exija o produtor conhecer a audiência multiplica a regra
   de roteamento por vinte pontos de manutenção.
3. **O padrão pessoal já existe no Portal do Cliente.** `portal_notifications`
   (migration `116`) grava um registro por destinatário com `read_at`, `title`,
   `message` e `link`, servido por RPCs próprias e consumido pelo
   `NotificationBell`. É o modelo de caixa de entrada — e é justamente o que
   `alerts` não é.
4. **O cabeçalho já exibe dois avisos que não são alertas.** Demurrage vencido
   e Granito pendente são contagens derivadas por `COUNT` em
   `useOperationalAlerts`, sem instante de ocorrência nem estado de leitura.
5. **O glossário reservava o termo ao Portal.** `CONTEXT.md` definia
   "Notificação In-App" como mensagem exibida **no Portal**, deixando o aviso
   pessoal interno sem nome.

Servir sino e fila com a mesma linha obriga a escolher entre dois defeitos: ou
a leitura de um usuário apaga a pendência dos demais, ou o estado pessoal é
duplicado dentro de uma entidade cujo ciclo de vida é coletivo.

## Decisão

### 1. Dois conceitos, não um

`Alerta` e `Notificação Interna` são entidades distintas, com ciclos, donos e
políticas de retenção próprios:

- **Alerta** — pendência operacional compartilhada. Existe uma vez, tem ciclo
  de vida (`aberto` → `reconhecido` → `fechado`) e é tratada uma vez pela
  equipe. Responde "o que ainda precisa ser feito".
- **Notificação Interna** — entrega pessoal, um registro por destinatário, com
  estado de leitura próprio. Responde "o que aconteceu e eu preciso saber".

Um Alerta origina Notificações Internas para vários destinatários; nem toda
Notificação Interna nasce de um Alerta.

### 2. A Notificação Interna é cópia congelada do evento

A Notificação Interna descreve o **Evento Notificável como ele ocorreu**, não o
estado atual da entidade. Reconhecer ou fechar o Alerta **não** apaga nem
oculta as notificações já entregues. É esse invariante que preserva o rastro de
"eu fui avisado", que some quando a notificação é um ponteiro para o estado
corrente.

Consequência direta: a retenção diverge. A Notificação Interna pode expirar; o
Alerta persiste por auditoria.

### 3. Audiência é regra declarada, não responsabilidade do produtor

Cada tipo de Evento Notificável declara, em um único lugar, quais papéis
internos recebem (`administrativo`, `financeiro`, `operacoes`, `documentacao`,
`equipamentos`). O fan-out para destinatários acontece nesse ponto único; os
RPCs que registram alertas continuam apenas registrando alertas.

`assigned_to` permanece sem uso: atribuição individual não é introduzida
enquanto não houver demanda operacional para ela.

### 4. Ler e reconhecer são ações desacopladas, com eco para a equipe

Ler é pessoal, vale só para quem leu e **nunca** altera o Alerta. Reconhecer e
fechar são atos da equipe sobre o Alerta e valem para todos. Reconhecer ou
fechar emite um **Eco de Tratamento** — Notificação Interna aos demais
destinatários — para que duas pessoas não trabalhem a mesma pendência sem
saber.

### 5. `/alertas` sobrevive como central de trabalho

O sino é **canal de entrega**; a página continua sendo onde se filtra,
reconhece, fecha e consulta o histórico das pendências. A página não é
substituída pelo painel do sino.

### 6. Fontes de evento são uma lista fechada

Alimentam o sino os produtores de `alerts` já existentes mais um conjunto
**pequeno, explícito e revisado antes da implementação** de eventos que hoje
não geram pendência. Instrumentação ampla do sistema fica fora de escopo.

Os **Indicadores Operacionais** do cabeçalho (demurrage vencido, Granito
pendente) **não** entram no sino: sem instante de ocorrência e sem estado de
leitura, entrariam apenas como eventos sintéticos. Permanecem como indicadores.

### 7. Canal único nesta rodada: in-app

Sino e página apenas. Os emails de alerta crítico e o `portal-daily-digest` do
Portal permanecem intocados; email interno não entra nesta decisão.

### 8. Persistência separada da do Portal

`portal_notifications` (destinatário `customer_id`, sessão do Portal) e a
Notificação Interna (destinatário usuário interno, `is_active_user()`) usam
tabelas e RPCs distintas. Destinatário, autenticação e RLS são diferentes;
unificar exigiria destinatário polimórfico e RLS condicional, que é onde
vazamento entre audiências acontece. O reaproveitamento admissível é o de
componente de UI, se couber sem virar abstração genérica.

### 9. O destino da navegação é derivado no cliente, em função compartilhada

`alerts` não tem `title` nem `link`; a rota da entidade é hoje derivada em
`alertEntityLink()` dentro de `src/pages/Alertas.tsx`, com regras por
`entity_type` e `entity_id` — incluindo o formato composto
`voyageId::porto::departamento` do ADR (migration `225`).

Essa derivação é extraída para um módulo compartilhado, importado pelo sino e
pela página. O link **não** é congelado em coluna no fan-out: duplicar em
PL/pgSQL o mapa de rotas que vive em TypeScript transformaria qualquer mudança
de rota em migration. O custo aceito é que uma notificação antiga passa a
apontar para a rota nova quando a rota muda — comportamento preferível à
divergência entre duas cópias da mesma regra.

### 10. Sem backfill

O sino passa a receber eventos a partir do deploy e nasce vazio. Alertas
abertos anteriores continuam visíveis em `/alertas`, que é onde pertencem.
Gerar notificações retroativas entregaria dezenas de não-lidas a cada usuário
no primeiro dia, cuja reação previsível é marcar todas como lidas e nunca mais
abrir o painel.

## Consequências

- **Schema:** tabela nova de notificação interna com destinatário (usuário),
  tipo, título, mensagem, referência à entidade, estado de leitura e origem do
  evento; ponto único de fan-out por Regra de Destinatários; política de
  retenção própria. Segue a numeração sequencial de migrations (ADR 0016).
- **RLS:** cada usuário lê e marca como lida **apenas** as próprias
  notificações — diferente da política vigente de `alerts` na `010`, em que
  todo usuário ativo lê e escreve todas as linhas. A política de `alerts`
  permanece inalterada.
- **Produtores existentes:** os RPCs que inserem em `alerts` não mudam de
  assinatura nem passam a conhecer audiência; o fan-out é acoplado ao registro
  do alerta, não a cada chamador.
- **Frontend:** `alertEntityLink()` sai de `src/pages/Alertas.tsx` para módulo
  compartilhado; `/alertas` mantém suas ações; o cabeçalho ganha o sino ao lado
  da zona de usuário, sem alterar os Indicadores Operacionais existentes.
- **Realtime:** `useOperationalCounts` já assina `postgres_changes` em
  `alerts`; a contagem de não lidas do sino é decisão de implementação
  (realtime ou polling, como o Portal faz a 30s) e não é fixada aqui.
- **Nota editorial (2026-08-12):** a assinatura existia no cliente, mas `alerts`
  nunca entrou na publication `supabase_realtime`; ela foi removida na PR #526.
- **Glossário:** `CONTEXT.md` ganha a seção "Alertas e notificações"; o termo
  "Notificação In-App" passa a "Notificação In-App do Portal" para não competir
  com a Notificação Interna.
- **Documentação viva:** `docs/ARCHITECTURE.md` e `docs/RASTREABILIDADE.md`
  precisam refletir a rota, o componente e as RPCs novas quando a
  implementação ocorrer.

## Alternativas consideradas

- **Sino como view de `alerts` mais tabela auxiliar de "quem já viu".**
  Rejeitada: mantém estado coletivo e pessoal na mesma entidade, e obriga a
  política de retenção do alerta a valer também para a caixa de entrada.
- **Fundir tudo em notificação, removendo `/alertas`.** Rejeitada: descarta o
  ciclo de vida compartilhado que cerca de vinte RPCs alimentam, e com ele a
  noção de pendência tratada uma única vez pela equipe.
- **Todos os usuários recebem todos os tipos.** Rejeitada: mantém o
  comportamento atual de `alerts` e produz volume que leva ao silenciamento do
  canal.
- **Tabela única polimórfica servindo Portal e interno.** Rejeitada: RLS
  condicional separando audiências externa e interna é superfície de vazamento
  desproporcional à duplicação de schema que evita.
- **Congelar o `link` em coluna no fan-out, como `portal_notifications`.**
  Rejeitada: duplicaria em PL/pgSQL o mapa de rotas mantido em TypeScript.
- **Backfill dos alertas abertos.** Rejeitada pelo efeito de estreia descrito
  no item 10.
- **Email interno para tipos críticos nesta rodada.** Adiada: entregabilidade,
  preferências, opt-out e bounce dobram a superfície de teste de uma mudança
  que ainda não tem uso comprovado in-app.

## Relação com outras ADRs

- **Estende a 0004** (RLS/RPC como fronteira de segurança): a Notificação
  Interna introduz política por destinatário, mais restrita que a política por
  papel de `alerts`.
- **Estende a 0003** (camadas página–hook–service): sino e página consomem a
  mesma derivação de destino, extraída para módulo compartilhado.
- **Não supersede a 0029/0030** quanto aos alertas de seção pendente do ADR:
  aqueles continuam sendo Alertas, e passam a originar também Notificações
  Internas.
