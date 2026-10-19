# Correção dos e-mails do sistema

Data: 2026-10-17. Origem: revisão de todos os e-mails gerados pelo Vela e pelo
Portal (Comunicados, régua automática, Cobrança de Demurrage, Portal,
Desbloqueio de CE, e-mails internos e retorno do provedor), feita depois do
loop de 422 do CE e Taxas corrigido no PR #971. A revisão leu o código, rodou
testes, reproduziu os casos no banco local e consultou a produção apenas para
leitura. Cada achado grave passou por uma verificação independente que tentou
refutá-lo.

## Estado

- **Fase 0 concluída em 2026-10-18:** PR #971 em `main`. A migration `297` foi
  aplicada em produção e as Edges foram republicadas pela integração.
- **Fases 1 a 5 implementadas em 2026-10-18 no PR #973** (branch
  `claude/emails-1a-envio-comum`), por decisão do responsável de fazer o plano
  inteiro num PR só. Migrations `302` a `312`, renumeradas depois do merge do
  PR #972, que ocupou da `298` à `301`; as correções da revisão do PR vieram
  nas `313` a `315` e na `318`. Verificado localmente:
  typecheck, lint, testes unitários, as 101 suítes local-pg num banco recriado
  com todas as migrations, `rpc:check`, `migrations:check`, `design:check`,
  `a11y:contrast`, build e `deno check` das 11 Edges de e-mail. Nada disso foi
  verificado em produção.
- **Diferenças em relação ao texto dos itens:**
  - 2.7: em vez de um tipo novo, o alerta `nob_sem_destinatario` passou a cobrir
    todos os Comunicados ("Comunicado sem destinatário") e ficou com
    Documentação, como os demais alertas de Comunicado.
  - 3.1: o reenvio do CE e Taxas fica no Histórico de `/clientes/comunicacao`.
    O alerta `comunicado_ce_reenvio_pendente` passou a apontar para lá.
  - 1E.3 (D7): não havia status de isento; a fatura com 100% de desconto vira
    `paid` com valor zero e registro em `audit_logs`.
  - 3.7: ficou parcial. A Cobertura só carrega na aba dela e o modo carga
    filtra os B/Ls no servidor, mas o modo institucional ainda lê todos os
    B/Ls ativos (ver o comentário `ponytail:` de `fetchCommunicationBlRows`
    em `src/services/customerCommunications.ts`). O envio do anexo uma vez só
    ficou para depois, como o item previa.
- **Correções da revisão da Régua de Cobrança (2026-10-18, migration `313`):**
  recusa definitiva resolvível com justificativa em `/alertas`; fatura pausada
  sai do Comunicado do grupo; Invoice incompleta sai do grupo sem derrubar as
  demais; varredura não solta a claim recusada; coluna Régua com o motivo do
  servidor; isentas anteriores à `306` quitadas e cancelamento da baixa sem
  aviso de "Nova fatura"; e-mail agrupado sem soma.
- **Correções da revisão do núcleo dos Comunicados (2026-10-18, migration
  `315`):** a produtora e o detector deixaram de olhar o status do Comunicado;
  o alvo é feito quando todo destinatário automático que já era contato
  elegível no primeiro envio tem tentativa entregue ou devolvida
  (`customer_communication_target_done`). A escala é lida por grafia exata
  antes de agregar o porto; o CE e Taxas grava `anchor_port` nulo (D3 sem o
  porto na identidade); Comunicado `pendente` sem tentativa nova há 15 min é
  recalculado e vira `falha` no detector; a claim só fica em
  `comunicado_recusado` enquanto o alvo está devido. Regra em
  [Clientes](../modules/clientes.md#régua-automática-de-comunicados).
- **Correções da revisão rigorosa do núcleo dos Comunicados (2026-10-19,
  migration `318`):** o alvo leva só os destinatários que faltam, e ligar a
  chave não manda e-mail real a quem recebeu a simulação nem ao contato
  cadastrado depois (D1); a Escala excluída segue a grafia gravada por último,
  na régua, na tela da Viagem e na conferência, que também compara o porto
  normalizado; a âncora manual grava o porto normalizado; a claim fica em
  `comunicado_recusado` até o envio sair (D18). Regra em
  [Clientes](../modules/clientes.md#régua-automática-de-comunicados).
- **Correções da revisão do monitoramento (2026-10-18, migration `314`):**
  "Provedor de e-mail sem retorno" mede o silêncio do webhook (3 tentativas
  depois do último evento) e fecha com qualquer evento; alerta de evento de
  e-mail abre `/alertas`, não um Cliente; grants das tabelas da Régua;
  `customer_cnpj` nos alertas sem destinatário; runner de eventos responde
  200 com `failed` quando o evento volta para nova tentativa; chave legada do
  Resumo diário.
- **Correções da revisão do Portal e da tela de Comunicados:** parcial por
  contato suprimido no Desbloqueio de CE não deixa o heartbeat vermelho;
  salvar o mesmo e-mail devolvido em Editar acesso libera a supressão; aviso
  de senha alterada em segundo plano; reenvio do CE segue depois de uma
  recusa; reconferência antes de disparar de novo; recusas definitivas fora
  de "Repetir só as falhas"; mês do Histórico em Brasília.
- **Pendente:**
  - **Depois do merge:** confirmar a aplicação das migrations e a publicação
    das Edges em produção.
  - **Configuração externa:** cadastrar no Better Stack os heartbeats
    `BETTERSTACK_HEARTBEAT_CE_UNLOCK_NOTIFY_URL` e
    `BETTERSTACK_HEARTBEAT_PORTAL_EMAIL_EVENTS_URL` e gravar os secrets.
  - **Ação imediata:** corrigir o e-mail do usuário do Administrativo suprimido
    desde 08/10 (o alerta `usuario_email_devolvido` vai apontá-lo).
  - **Fase 6:** ligar a chave de envio real é decisão do responsável.

  O plano fica vivo até a Fase 6.

## Resultado pretendido

Quando a chave **Canal de envio real** (`app_settings.communications_enabled`)
for ligada, todo e-mail que o sistema decidir mandar:

- sai uma vez, para os destinatários certos, com o conteúdo certo;
- quando não sai, fica registrado como falha (nunca como "simulado" ou
  "enviado") com o motivo legível na tela;
- quando falha de um jeito que tentar de novo não resolve, para de ser tentado
  e abre um alerta na fila `/alertas` dizendo o que corrigir;
- quando a falha é passageira, volta a ser tentado com intervalo crescente, sem
  repetir indefinidamente a cada rodada;
- deixa rastro suficiente para saber, depois, quem recebeu o quê.

E nenhuma falha de envio, de job ou de retorno do provedor passa despercebida:
cada uma deixa o heartbeat vermelho, abre alerta ou chega ao Sentry.

## Fora de escopo

- Trocar de provedor de e-mail ou mudar DNS, SPF, DKIM ou DMARC.
- Criar tipos novos de Comunicado.
- Redesenhar a tela de Comunicados além do que os itens abaixo pedem. A
  aparência segue o [plano da identidade visual](2026-10-13-identidade-visual-tela-a-tela.md).
- Ligar a chave de envio real. A Fase 6 só lista o que precisa estar pronto; a
  decisão de ligar é do responsável.

## Estado de partida

- **Dados de produção:** são todos de teste ("Data status" do AGENTS.md). Há 2
  Clientes, 3 contatos ativos e 2 faturas de Demurrage (rascunho e paga). A
  chave está desligada: todo envio de Comunicado, Cobrança e Desbloqueio de CE
  é simulado ou descartado.
- **Envio real:** desde 14/10 15:13 nenhum e-mail real saiu. Os últimos foram
  convites, recuperação de senha e o Resumo diário interno, todos entregues pela
  MillionSend, que substituiu a Resend em 14/10.
- **PR #971 (não deployado):**
  - corrige o loop de 422 do CE e Taxas;
  - adiciona a recusa definitiva (`permanent: true`), a rejeição de claim
    (migration `297`) e o alerta `comunicado_recusado`;
  - adiciona o log das recusas e `failed` no runner.

  Este plano parte dele: as migrations novas começam na `302`.
- **O que foi conferido e está certo** (não entra no plano):
  - o Resumo diário só sai quando há ocorrência de provisionamento, então a
    falta de envio desde 15/10 é esperada;
  - o webhook da MillionSend aceitou a assinatura e o formato do evento de
    14/10;
  - convite, recuperação e troca do Email de Recuperação do Portal estão bem
    feitos (tokens com hash, uso único, sem enumeração de contas, revogação de
    sessões);
  - o escape de HTML dos modelos está correto;
  - o isolamento entre Clientes está correto;
  - a supressão por bounce e reclamação funciona para os contatos do Portal.

## Fontes de verdade

- Regras de negócio:
  - [Clientes › Comunicados](../modules/clientes.md);
  - [Demurrage › Régua de Cobrança](../modules/demurrage.md);
  - [Portal do Cliente](../modules/portal-cliente.md);
  - [Desbloqueio de CE](../modules/desbloqueio-ce.md);
  - [regras de negócio](../operations/regras-de-negocio.md).
- Decisões: [ADR 0059](../adr/0059-chave-global-de-envio-desligada-por-padrao.md) (simulação com a chave desligada),
  [ADR 0067](../adr/0067-nob-automatico-ancorado-na-frente-de-operacao.md),
  [ADR 0068](../adr/0068-terminal-do-bl-herdado-da-frente-com-excecao-individual.md)
  e [ADR 0072](../adr/0072-toda-escrita-confirmada-com-consequencia.md) (confirmação de ação).
- Operação: [serviços externos › E-mail](../operations/servicos-externos.md),
  [observabilidade](../operations/observabilidade.md) e
  [segredos do cron](../operations/segredos-cron.md).
- **Código e funções que roda em produção hoje:**
  - a produtora é a da migration `244`;
  - as funções da Régua de Cobrança são as da `256`;
  - as Edges são as do `main`.

  Conferido por md5 de `pg_get_functiondef` e pelas versões publicadas.

## Como ler os itens

Cada item traz:
- o identificador do achado, para rastrear a evidência;
- a severidade depois da verificação;
- o que muda para quem usa, onde mexer e o critério de aceite.

O tipo de evidência vem entre colchetes: **[Produção]** dado real, **[Teste]**
reproduzido no banco local ou em script, **[Código]** leitura.

As decisões do responsável estão em
[Decisões tomadas](#decisões-tomadas-em-2026-10-18). Um item que depende de uma
decisão diz qual, e o texto do item já segue o que foi decidido.

---

## Fase 0 — Pré-requisito

**0.1 Fazer merge e deploy do PR #971.**
- Aplicar a migration `297` e publicar `send-customer-communication` e
  `customer-communication-auto-runner`.
- **Aceite:** na rodada seguinte, o CE e Taxas dos Clientes 1 (viagem 1) e 2
  (viagem 5) fica `simulado` e as claims param de ser retomadas.

---

## Fase 1 — Envio confiável (bloqueia ligar a chave)

Sem esta fase, ligar a chave produz cobranças dadas como feitas sem e-mail,
avisos que nunca saem e recusas repetidas sem fim.

### 1A. Envio comum (`_shared/email.ts`)

Todos os e-mails passam por aqui. Por isso esta parte vem primeiro.

1. **Tempo limite na chamada ao provedor** (INF-04, POR-11, CLI-04 · média)
   **[Teste]**
   - Hoje o `fetch` à MillionSend não tem tempo limite. Uma conexão pendurada
     segura a Edge até ela ser derrubada.
   - **Mudança:** usar `AbortSignal.timeout(10–15 s)` e tratar o estouro como
     `falha_transitoria`, com o motivo gravado.
2. **Exceção de rede vira falha transitória registrada** (DEM-01 caminho 1,
   CLI-04 · alta) **[Teste]**
   - Hoje a exceção sobe sem atualizar a tentativa, e ela fica `aceito` sem id
     do provedor.
   - **Mudança:** capturar a exceção, gravar `falha_transitoria` com o motivo e
     devolver `ok:false`.
3. **Erro de configuração do provedor não pode virar falha eterna** (INF-03 ·
   média) **[Teste]**
   - Hoje 401, 403 e 408 viram `falha_permanente`. Depois de corrigir a chave,
     a mesma tentativa nunca é refeita.
   - **Mudança:** tratar 401, 403 e 408 como falha de configuração, que pode
     ser retentada, e abrir alerta (ver 2.1).
   - Respeitar `Retry-After` no 429, com teto de cerca de 10 s.
   - Manter 400, 409 e 422 como permanentes.
4. **E-mail aceito pelo provedor não pode virar falha local** (CLI-04 · média)
   **[Teste]**
   - **Mudança:** se gravar o id do provedor falhar depois de um 200, registrar
     no log e devolver `ok:true`. Hoje a Edge marca o Comunicado como `falha`,
     e o operador reenvia em duplicidade.
5. **Erro ao consultar supressão não libera o envio** (INF-13 · baixa)
   **[Código]**
   - Hoje `_shared/portalEmail.ts` ignora o erro e trata o endereço como não
     suprimido.
   - **Mudança:** lançar o erro, para virar nova tentativa.

**Aceite:** testes em `src/services/__tests__/emailShared.test.ts` cobrindo:
- tempo esgotado → `falha_transitoria`;
- exceção de rede → `falha_transitoria`;
- 401 seguido de 200 com a mesma chave → reenvia;
- 429 com `Retry-After`;
- 200 seguido de falha ao gravar → `ok:true`;
- erro na consulta de supressão → exceção.

Antes de alterar, conferir todos os chamadores de `sendEmail` e
`sendPortalEmail`.

### 1B. Status do Comunicado com a chave ligada

**Problema** (DEM-01, CLI-04, CLI-09 · alta) **[Teste]**
- O Comunicado nasce `simulado` (`create_customer_communication_atomic_legacy_070`).
- `refresh_customer_communication_status` devolve o status atual quando não
  consegue decidir.
- As duas Edges usam `refreshedStatus ?? fallbackStatus`:
  - `send-customer-communication/index.ts:774`;
  - `demurrage-dunning/index.ts:586`;
  - `demurrage-dunning/index.ts:697`.
- Com a chave ligada, uma falha de rede, a falta de remetente ou a queda da
  Edge depois de registrar deixam o Comunicado `simulado`. A régua automática e
  a Régua de Cobrança tratam isso como enviado e nunca refazem.
- Na corrida de criação (dois envios simultâneos), a perdedora responde
  `simulado` sem enviar (`send-customer-communication/index.ts:642`).

**Mudança:**
1. Novo status `pendente` (rótulo "Em envio"), usado na criação. É a migration
   `302`; amplia o CHECK (D14).
2. O refresh passa a projetar:
   - `parcial` quando há sucesso junto de pendente;
   - `pendente` quando só há pendente.
3. Nas duas Edges, com a chave ligada, nunca aceitar `simulado` do refresh: sem
   decisão, o status é `falha`.
4. A conferência de remetente e reply-to sai do envio e passa para antes de
   criar o Comunicado.
5. Na violação de unicidade (23505), reler o Comunicado existente e seguir o
   envio, em vez de responder `simulado`.
6. A produtora (`evaluate_and_dispatch_automatic_communications`), o scanner de
   claims órfãs da Régua de Cobrança (migration `256`) e os detectores não
   tratam `pendente` como enviado.

**Aceite:**
- Teste local-pg do refresh: pendente sozinho dá `pendente`; pendente com
  sucesso dá `parcial`.
- Teste das duas Edges (orquestrador extraído, ver 1E.5): com a chave ligada e
  `fetch` lançando erro, o resultado é `falha`, a claim é liberada e
  `failed > 0`.
- A tela mostra "Em envio" no Histórico.

### 1C. Escala única para NOA, NOR e NOB e âncora do CE e Taxas

1. **NOA e NOR automáticos nunca saíram** (AUT-01 · alta) **[Produção]**
   - **Causa:** a produtora lê ETA, ATA, apagada e omitida de `audit_logs`; a
     Edge e `create_customer_communication_atomic` leem
     `voyages.pod_schedule_snapshot`.
   - **Situação em produção:** o snapshot não tem `eta` em nenhuma viagem. O
     gatilho antigo da migration `002` não criava a chave do porto; foi
     corrigido depois, sem refazer os dados antigos.
   - **Efeito:** o NOA da viagem 5 foi recusado a cada 15 min durante toda a
     janela de 5 dias, e nenhum Comunicado foi registrado.
   - **Gatilhos latentes da mesma divergência:**
     - a Edge trata `deleted: "false"` (texto) como verdadeiro;
     - a Edge compara o porto sem normalizar (BRVIT ≠ BRVIX), o que afeta as
       viagens 2, 3, 4, 27 e 36.
   - **Mudança (D2):**
     - criar uma função SQL única de leitura da escala vigente (último
       `audit_logs` por campo, booleano normalizado, porto por
       `normalize_port_code`);
     - a função preserva a hora: desde a migration `291`, ETA, ATA e ATB são
       registrados com data e hora. O NOA, o NOR e o NOB mostram data e hora no
       fuso de Brasília, no e-mail e no alerta. ETA antigo só com data é lido
       no fuso de Brasília e mostrado só com a data (item 4.5);
     - usá-la na produtora, no detector (ver 2.6), na Edge (via RPC) e em
       `create_customer_communication_atomic`;
     - normalizar o porto na Edge em todas as comparações de âncora, NOB
       inclusive.
   - O snapshot deixa de ser lido pelos Comunicados. Ele não é apagado neste
     plano, porque outras telas podem lê-lo; conferir os leitores antes de
     qualquer limpeza.
2. **CE e Taxas de Cliente com B/Ls em mais de um POD entra em loop sem fim**
   (AUT-03 · alta) **[Teste]**
   - A claim é por Cliente × Viagem e a produtora manda `port = min(pod)`. A
     Edge e a RPC exigem POD único e recusam com 422 não-permanente. O CE não
     tem janela de tempo, então a recusa se repete a cada 15 min, para sempre.
   - **Caso latente em produção:** viagem 5 × Cliente 1, com POD vazio, BRSSZ e
     BRVIX.
   - **Mudança (D3, um por Cliente × Viagem):**
     - para `ce_mercante_taxas`, a Edge e a RPC validam só Cliente e Viagem;
     - o porto vira informativo e determinístico, igual na produtora e no
       payload.
3. **B/L cancelado entra no NOA, NOR e NOB** (AUT-05, CLI-03 · média)
   **[Código]**
   - `cancel_bl` grava `cancelled_at`, mas a produtora, a Edge e a RPC filtram
     só `financial_status`.
   - **Mudança:** filtrar `cancelled_at IS NULL` na produtora (três blocos), na
     Edge, na RPC e na conferência manual.
4. **Cliente desativado vira candidato e é recusado em loop** (AUT-04 parte 1,
   CLI-03 · média) **[Código]**
   - **Mudança:** filtrar `customers.deactivated_at IS NULL` na produtora (três
     blocos), no `nob_sem_destinatario` e na conferência manual.

**Aceite (teste local-pg):**
- **Escala:** com ETA só em `audit_logs`, snapshot vazio, escala reincluída
  (`deleted = 'false'`) e B/L BRVIT numa escala BRVIX, a produtora gera o
  candidato e a RPC aceita.
- **Âncora do CE:** um Cliente pronto com B/Ls em dois PODs tem o CE registrado
  e não volta como candidato.
- **Filtros:** B/L cancelado e Cliente desativado não viram candidatos.

### 1D. Régua automática: recusas que não são definitivas

**Problema** (AUT-04 · média) **[Código]**
- Depois do PR #971, ainda são tentados a cada 15 min, sem prazo e sem alerta:
  - Prontidão bloqueada;
  - "Contato desativado para esta caixa";
  - "Dados operacionais incompletos";
  - falha do provedor.

**Mudança:**
1. Colunas `attempts`, `last_error` e `next_attempt_at` em
   `customer_communication_automation_claims`.
2. Intervalo crescente para recusas não-permanentes: 15 min, 1 h e depois a
   cada 6 h (D18).
3. Alerta `comunicado_recusado`, com o motivo (D18):
   - **recusa por dado** (Prontidão bloqueada, contato desativado ou fora da
     caixa, Cliente desativado, escala ou Atracação indisponível, dados
     operacionais incompletos): abre na **primeira** recusa, porque só uma
     pessoa resolve;
   - **falha do provedor** (tempo esgotado, rede, 5xx, 429): abre na
     **terceira** falha seguida;
   - a régua segue tentando nos intervalos acima, e o alerta fecha sozinho
     quando o Comunicado sai.
4. A Edge marca `permanent: true` quando o provedor devolve
   `falha_permanente`; o runner rejeita a claim.
5. Corrigir `docs/modules/clientes.md`, que descreve o reciclo sem fim como
   intencional.

**Aceite:**
- Testes do runner com fetch falso:
  - 502 com `falha_permanente` rejeita a claim;
  - 422 de prontidão respeita `next_attempt_at` e abre o alerta na 1ª recusa;
  - falha do provedor abre o alerta só na 3ª seguida;
  - envio bem-sucedido depois de recusas fecha o alerta.
- Teste local-pg do intervalo.

### 1E. Régua de Cobrança de Demurrage (`demurrage-dunning`)

1. **Recusa definitiva do provedor trava a fatura para sempre** (DEM-02 · alta)
   **[Teste]**
   - **Hoje:** a mesma claim, o mesmo Comunicado e a mesma chave voltam a cada
     hora; `sendEmail` devolve `ok:false` sem chamar o provedor, e a claim é
     liberada de novo. Depois de corrigir uma chave errada, nada volta a ser
     tentado.
   - **Mudança (D6):**
     - em `falha_permanente`, não liberar a claim;
     - gravar `dunning_suspended_reason`;
     - abrir alerta de cobrança recusada para o Administrativo (D21), para a
       operação corrigir o contato e retomar;
     - a falha de configuração (1A.3) volta a ser tentada.
2. **Grupo de cobrança que muda depois de uma falha trava o Cliente** (DEM-03 ·
   alta) **[Teste]**
   - **Hoje:** o índice único (fatura, tentativa) em
     `customer_communication_dunning_invoices` colide com o grupo que falhou.
     A rodada dá `duplicate key` a cada hora.
   - **Gatilhos:**
     - nova fatura emitida;
     - fatura paga ou em disputa, quando sobram duas ou mais no grupo;
     - pausa no meio do envio.
   - **Mudança:** em `create_customer_dunning_group_atomic`, antes do INSERT,
     remover a participação da fatura em grupos da mesma tentativa cujo
     Comunicado está `falha` ou sem tentativa aceita.
3. **Fatura com 100% de desconto entra em loop de "Dados incompletos"** (DEM-04
   · média) **[Código]**
   - **Mudança:** excluir valor líquido ≤ 0 de
     `claim_demurrage_dunning_candidates` e de
     `demurrage_dunning_candidate_sendable`.
   - **D7:** ao aplicar 100% de desconto, a fatura passa a quitada/isenta e
     sai também das pendências do Cliente no Vela e no Portal. Conferir em
     `apply_demurrage_discount` e no módulo Demurrage qual status usar.
4. **Pausa no meio de um envio agrupado reenvia a quem já recebeu** (DEM-11 ·
   baixa) **[Código]**
   - **Mudança:** pular a fatura que deixou de ser cobrável em vez de abortar o
     grupo, e manter as claims das demais.
5. **Orquestrador testável** (DEM-13) **[Teste]**
   - **Mudança:** extrair a decisão de status e de claim para
     `supabase/functions/_shared/`, no mesmo padrão do runner do PR #971, e
     testar com cliente e fetch falsos. Hoje os testes da Edge só conferem o
     texto do código; por isso DEM-01 a DEM-03 passaram.
6. **Critério de destinatário único** (DEM-10 · baixa) **[Código]**
   - **Mudança:** usar `customer_communication_recipient_allowed` também na
     seleção e na revalidação, em vez das caixas `financeiro` e `demurrage`
     fixas no código.

**Aceite:**
- Testes do orquestrador:
  - recusa definitiva do provedor (ex.: 422) suspende a fatura e abre alerta;
    403 é falha de configuração e volta a ser tentado (1A.3);
  - rede caída gera `falha` e libera a claim.
- Testes local-pg:
  - um grupo {B,D} que falhou seguido de {A,B,D} cria o grupo novo;
  - fatura com 100% de desconto não vira candidata.

### 1F. Avisos do Desbloqueio de CE (`ce-unlock-notify-email`)

1. **Falha ao ler a chave descarta a fila** (POR-02 · média) **[Código]**
   - **Hoje:** um erro passageiro ao ler `app_settings` vira "Comunicados
     desligados", e até 20 avisos viram `skipped` para sempre, mesmo com a chave
     ligada.
   - **Mudança:** erro de leitura → responder 500 sem consumir a fila.
2. **Aviso gerado com a chave desligada é descartado sem registro** (POR-01 ·
   média) **[Produção]**
   - As 5 linhas de produção estão `skipped`, sem lista de quem receberia.
   - **Mudança (D11, registra simulado e não envia depois):** resolver os destinatários, chamar `sendPortalEmail` em
     modo simulado e fechar a linha como `simulated` (migration para o CHECK).
   - Corrigir `desbloqueio-ce.md`, que diz que sempre registra a tentativa.
3. **Exceção numa linha trava a fila** (INF-07, POR-11 · média) **[Código]**
   - **Mudança:** try/catch por linha, chamando `finish('pending', motivo)` para
     contar a tentativa e seguir para a próxima.
4. **Contato suprimido no Portal deixa a linha `failed`** (POR-05 · baixa)
   **[Teste]**
   - Isso acontece mesmo com os outros contatos atendidos.
   - **Mudança:** excluir da lista os contatos com supressão do Portal, ou
     tratar "suprimido" como destinatário resolvido. Considerar o estado
     `partial`.

**Aceite:** em `src/services/__tests__/ceUnlockNotifyEmail.test.ts`:
- erro ao ler a chave → a linha continua `pending`;
- chave desligada → `simulated`, com envio simulado aos contatos da caixa;
- exceção na 1ª linha → a 2ª é processada;
- destinatário suprimido → a linha fecha na primeira rodada.

---

## Fase 2 — Ninguém fica sem saber

1. **Silêncio do provedor** (INF-01 · média) **[Código]**
   - Se o webhook da MillionSend parar, os e-mails ficam "aceito" para sempre e
     bounces deixam de suprimir endereços.
   - **Mudança:** detector no `alerts-detector` que abre um alerta novo (tipo
     `email_retorno_provedor_silencioso`, Administrativo, D21) quando há tentativa
     `aceito` com id do provedor há mais de 2 h sem evento. Vale para as duas
     tabelas de tentativas.
   - **Revisão (migration `314`):** o detector mede o silêncio do webhook, não
     o evento de cada tentativa: abre com ao menos 3 tentativas aceitas há mais
     de 2 h e depois do último evento recebido, e fecha quando chega qualquer
     evento novo. Uma tentativa sozinha podia ser só um e-mail adiado.
   - Documentar em `servicos-externos.md` como trocar o segredo do webhook.
2. **Sentry das Edges** (INF-02 · baixa) **[Código]**
   - `scope.setFingerprint(['edge', functionName, status])` em
     `_shared/telemetry.ts`.
   - Instrumentar as Edges que mandam e-mail e ainda não estão no Sentry:
     - `ce-unlock-notify-email`;
     - `portal-password-recovery`;
     - `portal-recovery-email-change`;
     - `portal-invite-send`.
   - Atualizar a lista em `observabilidade.md`.
3. **Heartbeats que faltam** (POR-04, INF-07, INF-08 · média) **[Código]**
   - **Novos:** `ce-unlock-notify-email` e `portal-email-events-runner`, com o
     secret registrado em `servicos-externos.md`.
   - **Alerta do Desbloqueio de CE** (POR-04): abrir alerta para o
     Administrativo (D21) quando um aviso fica sem destinatário na caixa ou
     termina `failed`.
   - **Resposta com `failed`:** o Resumo diário (POR-03, INF-09) passa a
     devolver 500 quando uma consulta falha e `{ sent, failed, suppressed }`
     reais; hoje conta como enviado quem não recebeu.
4. **Processamento de eventos** (INF-08 · média) **[Código]**
   - **Escalar para investigação:** `complete_portal_email_event` passa a
     `investigate`, com alerta `portal_reprocessamento_falhou`, a partir da 6ª
     conclusão com `retry_wait`.
   - **Evento ambíguo:** passa a abrir alerta (`ambiguous_provider_message_id`).
5. **Falhas da Régua de Cobrança** (DEM-06 · média) **[Código]**
   - Hoje `pausado` e `sent.ok=false` não deixam log.
   - **Mudança:**
     - logar motivo, fatura, Cliente e tentativa em todo ramo de pausa e de
       falha, com e-mail mascarado;
     - abrir alerta para falha repetida ou recusa (o mesmo da 1E.1).
6. **Alerta de NOA, NOR e NOB pendente com a mesma regra da produtora**
   (AUT-02 · média) **[Produção]**
   - Hoje há 3 alertas impossíveis de atender (escalas 6, 7 e 8 BRVIX, sem
     B/L).
   - **Mudança (D4, `simulado` fecha o alerta):**
     - extrair da produtora a seleção Cliente × escala elegível, sem gravar
       claim, e usá-la no detector;
     - escala sem alvo não abre item;
     - a mensagem lista os Clientes pendentes.
7. **Cliente sem contato some do NOA, NOR e CE sem aviso** (AUT-06 · média)
   **[Código]**
   - **Mudança:**
     - trocar o JOIN interno com contatos por LEFT JOIN nos blocos NOA/NOR e
       CE, como já é no NOB;
     - generalizar `nob_sem_destinatario` para `comunicado_sem_destinatario`
       (tipo e âncora), que também fecha quando a janela vence.
8. **Usuário interno com bounce fica suprimido em silêncio** (INF-05, POR-08 ·
   média) **[Produção]**
   - Um usuário do Administrativo está suprimido desde 08/10.
   - **Mudança (D19, alerta ao Administrativo):**
     - abrir alerta quando o e-mail suprimido é de `user_profiles` ativo;
     - mostrar "e-mail devolvido" em Admin › Usuários;
     - a troca do e-mail em Editar acesso libera a supressão antiga.
   - **Ação imediata, sem código:** corrigir o e-mail desse usuário em Editar
     acesso.
9. **Respostas não-2xx dos jobs** (INF-12 · baixa) **[Produção]**
   - O cron marca `succeeded` só por ter enfileirado, e `net._http_response`
     guarda cerca de 6 h.
   - **Mudança:** job SQL que lê `net._http_response` com status diferente de
     2xx e abre alerta, como já sugerido em `segredos-cron.md`.
   - Registrar em `observabilidade.md` que a ausência de log não prova a
     ausência de chamada.

**Aceite:** testes local-pg para cada detector novo (abre e fecha) e testes dos
handlers com heartbeat (`failed > 0` faz o heartbeat chamar `/fail`).

---

## Fase 3 — Operação na tela `/clientes/comunicacao`

1. **Reenvio manual do CE e Taxas** (CLI-02 · alta) **[Código]**
   - O botão foi removido em 14/10 (commit `03a2d79`). Hoje um CE que falhou
     ou foi simulado não tem como sair, e o alerta
     `comunicado_ce_reenvio_pendente` só fecha com esse reenvio.
   - **Mudança (D5, restaurar):** pôr "Reenviar CE e Taxas" na
     tela, reaproveitando `dispatchCeMercanteTaxasCommunication({ forceRetry: true })`,
     que já existe sem chamador.
   - Corrigir:
     - `clientes.md:140`;
     - `taxas-locais.md:198`;
     - a linha do [plano da identidade visual](2026-10-13-identidade-visual-tela-a-tela.md)
       que diz que o comunicado já está em Comunicação.
2. **Disparo em lote** (CLI-01 · média) **[Código]**
   - Hoje o lote para no primeiro erro, perde a contagem de quem recebeu,
     relê a conferência a cada destinatário (o que reseta a seleção), e repetir
     duplica e-mails.
   - **Mudança:**
     - manter o mesmo `dispatchId` enquanto a conferência não mudar;
     - continuar depois de um erro e mostrar o resumo (enviados, simulados,
       falhas, com motivo);
     - invalidar o cache uma vez, no fim;
     - "Repetir só as falhas" com o mesmo Comunicado.
   - Marcar como bloqueado na conferência o NOB de terminal sem sigla.
3. **Motivo da falha visível** (CLI-05 · média) **[Código]**
   - O Histórico já busca destinatário mascarado, status e `last_error`, mas
     não mostra.
   - **Mudança:** listar por tentativa: destinatário mascarado, real ou
     simulado, status e motivo traduzido.
4. **Elegibilidade igual à da régua** (CLI-03 · média) **[Código]**
   - **Mudança:** a conferência exclui Cliente desativado, B/L cancelado e
     Viagem cancelada (junto com 1C.3 e 1C.4).
5. **Filtros que não funcionam** (CLI-11 · baixa) **[Código]**
   - O Mês da Cobertura é ignorado.
   - O filtro de modelo do Histórico não lista CE e Taxas nem Cobrança de
     Demurrage.
6. **Anexos** (CLI-12 · baixa) **[Código]**
   - **Mudança:**
     - avisar "anexo enviado a N Clientes";
     - limpar os anexos depois do disparo;
     - rodapé do Comunicado com `importacao@fwlog.com.br`, o mesmo endereço
       da resposta (D20).
7. **Desempenho do disparo** (CLI-07 · baixa) **[Código]**
   - **Mudança:**
     - carregar a Cobertura só na aba Cobertura;
     - filtrar os B/Ls no servidor;
     - mais adiante, subir o anexo uma vez só, com upload assinado.
8. **Comunicado livre** (CLI-06 · média) **[Teste]**
   - A tela promete "dados da carga de cada cliente", mas o e-mail não os leva.
   - **Mudança (D15):** acrescentar o bloco Navio / Viagem / B/Ls, com escape,
     agrupando por Cliente × Viagem: Cliente com carga em viagens diferentes
     recebe um e-mail por Viagem.
9. **Confirmação antes de Disparar** (CLI-10 item 4) **[Código]**
   - **Mudança (D16):** ao clicar Disparar, abrir confirmação: "Enviar de
     verdade" ou "Registrar em simulação", conforme a chave, para X
     destinatários de Y Clientes, com Confirmar e Cancelar.

**Aceite:** testes de componente:
- lote com falha no 2º de 3: os 3 são chamados, o resumo aparece e a seleção é
  mantida;
- repetir as falhas envia só o que falhou, com o mesmo `dispatchId`;
- o Histórico mostra o motivo;
- o botão de reenvio do CE chama o serviço com `forceRetry`.

Teste local-pg: o reenvio enviado fecha `comunicado_ce_reenvio_pendente`.

---

## Fase 4 — Conteúdo e regras

1. **Cobrança agrupada** (DEM-05 · média) **[Código]**
   - Hoje o e-mail de cobrança agrupada sai sem o layout, sem o ROE com data e
     sem a observação de recálculo, e com o navio da primeira fatura.
   - **Mudança:** novo `renderDemurrageGroupTemplate` no módulo de modelos.
   - **D8:** continua um e-mail por Cliente e etapa da régua. O assunto passa a
     ser geral (ex.: "Cobrança de Demurrage — 3 faturas") e cada linha mostra
     seu navio e viagem.
2. **Horário da Régua de Cobrança** (DEM-07 · baixa) **[Código]**
   - **Hoje** (migration `256`): a 1ª cobrança sai na rodada seguinte à
     emissão, a qualquer hora. As seguintes passam a contar à 00:00 de Brasília
     do dia em que completam o intervalo desde o último envio e saem às 00:07,
     inclusive em fim de semana e feriado. A fatura em si não vence nesse
     horário.
   - **Mudança (D9):** toda cobrança, inclusive a 1ª, só sai em dia útil, a
     partir das 9h de Brasília. A que cair fora da janela sai no próximo dia
     útil às 9h. Reaproveitar o calendário de feriados já usado no Itaú PIX.
     A contagem do intervalo continua a partir do último envio.
3. **Data do ROE** (DEM-08 · baixa) **[Produção]**
   - Hoje o e-mail usa `updated_at` como data de referência do ROE.
   - **Mudança:** usar a data da cotação em `demurrage_invoice_history`.
4. **Fatura que o Cliente vê no Portal** (DEM-09 · baixa) **[Código]**
   - **Mudança (D10):** cobrar só fatura visível no Portal (B/L com CE) e de
     Cliente ativo, na seleção e na revalidação antes de cada envio.
5. **Janela do NOA com ETA só com data** (AUT-07 · baixa) **[Produção]**
   - Hoje a janela fecha às 21:00 da véspera e o alerta mostra a hora errada.
   - **Mudança:** em `customer_communication_safe_timestamptz`, interpretar a
     data pura no fuso de Brasília e marcar a função como STABLE.
6. **Aviso de bounce ao Cliente** (POR-06 · baixa) **[Teste]**
   - Hoje o aviso mostra `<strong>` literal.
   - **Mudança:** corrigir em `portalEmailTemplates.ts:249`.
7. **Convite e Cliente desativado** (POR-09 · baixa) **[Código]**
   - Hoje um convite pendente ainda ativa a conta de um Cliente desativado.
   - **Mudança:** recusar a ativação, ou cancelar os convites na desativação.
8. **Avisos de segurança do Portal** (POR-10 · baixa) **[Código]**
   - **Mudança (D12):** enviar "sua senha foi alterada; se não foi você, fale
     com o suporte" ao Email de Recuperação ao concluir a recuperação ou a
     troca de senha. Suspensão e reativação **não** avisam o Cliente por
     e-mail. Novo kind em `portal_email_attempts` (amplia o CHECK).
9. **Troca de e-mail em Meu perfil** (INF-06 · média) **[Código]**
   - A confirmação nunca chega: o Auth usa o SMTP padrão, que só entrega aos
     membros do Team.
   - **Mudança (D13):** tirar a troca de e-mail de Meu perfil e orientar a
     pedir ao Administrativo, que troca em Admin › Usuários › Editar acesso
     (já funciona sem e-mail). Atualizar `Profile.confirmation.test.tsx` e a
     seção E-mail de `servicos-externos.md`.

---

## Fase 5 — Privacidade, testes e documentação

1. **E-mail em claro onde deveria estar mascarado** (CLI-08, POR-07, INF-10 ·
   baixa) **[Produção]**
   - **Chaves de tentativa:** em `customer_communication_attempts` e no
     `resumo_diario`, usar o hash do destinatário (`recipientKey`), mantendo a
     compatibilidade na busca.
   - **Log da Régua de Cobrança:** usar `maskEmail` (`demurrage-dunning/index.ts:574`
     e `:685`).
2. **Retenção dos eventos do provedor** (INF-15 · baixa) **[Produção]**
   - **Já existe em parte:** `run_retention` (migration `094`) já apaga
     `portal_email_event_attempts` com mais de 1 ano, mas não toca em
     `portal_email_events`, que guarda o endereço no payload, nem nas
     tentativas.
   - **Mudança (D17, 1 ano):** em `run_retention`, apagar os eventos de
     `portal_email_events` com mais de 1 ano e mascarar o endereço guardado nas
     tentativas (`portal_email_attempts` e `customer_communication_attempts`)
     com mais de 1 ano. O Histórico do Comunicado continua, sem o e-mail
     completo.
3. **Grants** (CLI-13 · baixa) **[Produção]**
   - **Mudança:** `REVOKE TRUNCATE, TRIGGER, REFERENCES` de `authenticated` nas
     tabelas de Comunicado. Preferencialmente global; alinhar com a revisão de
     segurança.
4. **CI das Edges** (INF-11 · baixa) **[Teste]**
   - **`deno check` no CI:** rodar nas Edges de e-mail, corrigindo os erros que
     já existem (7 em `send-customer-communication` e `telemetry`, mais os do
     webhook e do `portalEmail`).
   - **Teste do webhook:** testar o handler com assinatura Svix gerada e o
     payload real do evento de 14/10.
5. **Teto declarado do runner** (AUT-08 · baixa) **[Código]**
   - Comentário `ponytail:` com o limite de destinatários por rodada e o
     caminho de melhoria.
6. **Documentação viva** (CLI-10, POR-12, DEM-12, INF-14) **[Código]**
   - Corrigir junto com cada lote:
     - `clientes.md`: público do CE inclui o Financeiro; não existe status
       "bloqueado"; reenvio do CE;
     - `demurrage.md`: retoma no mesmo discriminador; horário; conteúdo do
       agrupado;
     - `desbloqueio-ce.md`;
     - `portal-cliente.md`: o Resumo diário é interno e de provisionamento;
     - `servicos-externos.md`: remetentes, a chave desligada não simula o
       Desbloqueio de CE, segredo do webhook, SMTP do Auth;
     - `observabilidade.md`: heartbeats e Edges com Sentry.

---

## Fase 6 — Antes de ligar a chave de envio real

Ligar só quando:

1. As Fases 0 e 1 estiverem em produção, e os itens 2.1, 2.3, 2.5 e 3.1 também.
2. Um envio de teste real de cada tipo tiver chegado a um endereço controlado:
   - NOA, NOR, NOB, CE e Taxas, institucional, livre com anexo;
   - Cobrança de Demurrage unitária e agrupada;
   - aviso do Desbloqueio de CE.

   Para cada um, o evento "entregue" tem de voltar pelo webhook. Um bounce
   provocado tem de suprimir o endereço e abrir o alerta.
3. A D1 (o que fazer com o que ficou simulado) estiver decidida e aplicada. Com
   os dados de teste atuais, o caminho previsto é
   `supabase/scripts/limpar_dados_teste.sql`, seguindo
   `docs/operations/reset-ambiente.md`.
4. Os heartbeats do Better Stack dos jobs de e-mail estiverem configurados e
   verdes, e um `/fail` provocado tiver chegado.

---

## Ordem de execução e dependências

- **Fase 0** antes de tudo.
- **1A** antes de **1B**, **1D** e **1E**, porque eles dependem da
  classificação de falha.
- **1B** antes de **1D** e **1E.5**.
- **1C** e **1F** independentes entre si; podem andar em paralelo com 1A.
- **2.6** depois de **1C.1**, porque usa a mesma função de escala e a mesma
  seleção de alvos.
- **3.4** junto com **1C.3** e **1C.4**.
- **Fase 3** em paralelo com a 2.
- **Fases 4 e 5** em qualquer ordem depois da 1.
- **Fase 6** por último.

**PRs:** um por lote (1A, 1B, 1C, 1D, 1E, 1F, Fase 2, Fase 3...), pequenos e
com teste de comportamento. Cada migration nova segue a numeração da cadeia
ativa a partir da `302`. A que reescreve linhas declara no cabeçalho que se
apoia no "Data status".

## Checks por lote

**Sempre:** `npm run docs:check`, `typecheck`, `lint`, `test` e `build`.

**Com migration ou RPC:**
- `npm run migrations:check` e `npm run rpc:check`;
- as suítes local-pg afetadas, em série, com a suíte nova registrada em
  `scripts/local-pg-suites.txt`.

**Com tela:** `npm run design:check` e `npm run a11y:contrast`.

**Depois do deploy:** conferir em produção, por SELECT:
- as respostas das Edges em `net._http_response`;
- os status em `customer_communications`;
- as claims.

## Riscos e rollback

- **Status `pendente` (1B):** muda o que a tela, os filtros e a produtora leem.
  - Fazer num PR só, cobrindo todos os leitores.
  - **Rollback:** a migration seguinte volta o default para `simulado`. O
    refresh sozinho não resolve linha `pendente` sem tentativa (ele devolve o
    status atual): quem a resolve é a varredura
    `settle_stale_pending_customer_communications` do detector (migration
    `315`), que recalcula e grava `falha` no que continuar `pendente`.
- **Escala única (1C.1):** muda quem recebe NOA, NOR e NOB.
  - Validar contra os dados de produção antes, comparando os candidatos da
    produtora atual com os da nova numa consulta de leitura.
  - **Rollback:** voltar a Edge à leitura do snapshot, que continua existindo.
- **Retentativa de falha de configuração (1A.3):**
  - **Risco:** reenviar em massa o que ficou preso.
  - **Mitigação:** só reenvia o que voltar a ser candidato; o restante segue
    pela D6 e pela D18.
- **Mudanças nos detectores (Fase 2):** podem abrir muitos alertas de uma vez.
  Rodar primeiro em consulta de leitura em produção e conferir o volume.

---

## Decisões tomadas em 2026-10-18

Decididas pelo responsável em conversa, item a item.

| # | Decisão | Escolha | Afeta |
| --- | --- | --- | --- |
| D1 | O que fazer, ao ligar a chave, com o que ficou `simulado` | Nada sai de novo. Os dados de teste são limpos antes de ligar | Fase 6 |
| D2 | Fonte da escala para os Comunicados | Histórico da Viagem (`audit_logs`), por uma função única, **com data e hora** | 1C.1, 2.6 |
| D3 | CE e Taxas por Viagem ou por porto | Um por Cliente × Viagem, com todos os B/Ls dele | 1C.2 |
| D4 | `simulado` fecha o alerta de NOA, NOR e NOB pendente | Sim, como na produtora | 2.6 |
| D5 | Reenvio manual do CE e Taxas | Restaurar o reenvio | 3.1 |
| D6 | Cobrança recusada em definitivo pelo provedor | Suspende a fatura e abre alerta | 1E.1 |
| D7 | Fatura com 100% de desconto | Sai da régua e vira quitada/isenta | 1E.3 |
| D8 | Cobrança agrupada de faturas de navios diferentes | Um e-mail por Cliente e etapa, com assunto geral e navio por linha | 4.1 |
| D9 | Horário da Régua de Cobrança | Toda cobrança, inclusive a 1ª, só em dia útil, a partir das 9h de Brasília | 4.2 |
| D10 | Cobrar só fatura visível no Portal e de Cliente ativo | Sim | 4.4 |
| D11 | Aviso do Desbloqueio de CE com a chave desligada | Registra `simulado` e não envia depois | 1F.2 |
| D12 | Avisos de segurança do Portal | Só "senha alterada"; suspensão e reativação não avisam | 4.8 |
| D13 | Troca de e-mail em Meu perfil | Sai de Meu perfil; o Administrativo troca em Editar acesso | 4.9 |
| D14 | Estado do Comunicado enquanto o e-mail sai | "Em envio" (`pendente`). Com a chave ligada, `simulado` não aparece mais | 1B |
| D15 | Comunicado livre | Leva Navio, Viagem e B/Ls; um e-mail por Cliente × Viagem | 3.8 |
| D16 | Confirmação antes de Disparar | Sim, com real ou simulado e o número de destinatários e Clientes | 3.9 |
| D17 | Retenção dos eventos e tentativas de e-mail | 1 ano | 5.2 |
| D18 | Recusas que não são definitivas | Intervalo 15 min → 1 h → 6 h. Alerta na 1ª recusa por dado e na 3ª falha seguida do provedor; fecha sozinho quando o envio sai | 1D |
| D19 | Alerta de bounce de usuário interno | Sim, para o Administrativo | 2.8 |
| D20 | Rodapé dos Comunicados | `importacao@fwlog.com.br` | 3.6 |
| D21 | Setor dos alertas novos (provedor sem retorno, Desbloqueio de CE sem destinatário, cobrança recusada) | Todos para o Administrativo | 1E.1, 2.1, 2.3 |
