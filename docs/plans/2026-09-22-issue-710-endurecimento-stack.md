# Issue 710 — Endurecimento da stack (observabilidade, segurança e resiliência)

> **Estado:** plano vivo em execução; o documento não é prova de produção. As configurações remotas e PRs abaixo foram registradas separadamente, com runtime ainda pendente onde indicado.
>
> **Para execução pelo Codex:** usar `executing-plans`, manter a checklist deste arquivo atualizada e operar os painéis dos provedores pelo navegador com sessões autenticadas. Login, MFA, CAPTCHA e qualquer confirmação de ação externa permanecem sob controle do usuário; credenciais, tokens, códigos de recuperação e OTPs não entram em prompts, terminal, commits, screenshots ou evidências.

**Origem:** [Issue #710](https://github.com/luccafwlog/vela/issues/710), lida no GitHub autenticado em 2026-09-22.

**Objetivo:** reduzir o tempo de detecção e recuperação de falhas, endurecer as fronteiras de autenticação e supply chain e provar restauração de dados, preservando GitHub, Vercel, Supabase, Resend, Sentry e Registro.br como núcleo da stack e mantendo os novos serviços no free tier enquanto o volume permitir. A primeira entrega não inclui MFA; essa frente fica adiada até nova decisão explícita.

**Resultado observável:** o Vela e o Portal continuam com as mesmas URLs e fluxos, passam a bloquear abuso antes do Auth, gerar alertas internos acionáveis para falhas de frontend/backend/cron e recuperar dados por procedimento ensaiado. Não haverá página pública de status nem link público no Portal: o owner não quer expor disponibilidade/histórico a terceiros. MFA interno fica fora da primeira entrega; o captcha/Turnstile permanece uma decisão operacional separada. Os processos financeiros continuam utilizando o fluxo estável de emissão estática e conciliação manual existente.

### Atualização de execução — 2026-09-22

- Decisões do owner registradas: sem GitHub Team, Dependabot semanal, Better Stack, PostHog Cloud EU, R2 como reserva, backup diário e MFA adiado; alertas destinados somente a `lucca.juliatti@fwlog.com.br`.
- PRs [#720](https://github.com/luccafwlog/vela/pull/720), [#725](https://github.com/luccafwlog/vela/pull/725), [#726](https://github.com/luccafwlog/vela/pull/726), [#727](https://github.com/luccafwlog/vela/pull/727) e [#728](https://github.com/luccafwlog/vela/pull/728) foram incorporadas à `main`; [#718](https://github.com/luccafwlog/vela/pull/718) também foi incorporada como remediação relacionada.
- Estado remoto que não equivale à conclusão da Issue: zonas Cloudflare aguardando cutover; R2 ativado; painel em 2026-09-23 mostra bucket privado `vela-database-backups` com 0 objetos/0 B, token `Vela R2 Backup` ativo e restrito a Object Read & Write nesse bucket, uso faturável atual de US$ 0,00 (51 operações A e 19 B exibidas); projeto PostHog EU criado, ainda sem eventos; Upstash Free configurado para o rate limit; migration `076_portal_activation_rate_limit` aplicada e três secrets do rate limit gravados no Supabase. Better Stack tem dois monitores HTTP privados ativos para Vela e Portal; não há heartbeats provisionados. Em 2026-09-23, a tela de criação de heartbeat marcou os itens adicionais como faturáveis e pediu upgrade; não foi criado nenhum monitor nem contratado upgrade para preservar o limite de custo zero. Nenhuma página pública de status será criada, conforme decisão do owner.
- Decisões atualizadas do owner: manter custo adicional em zero; não habilitar Supabase Log Drains nem retenção/dashboards externos pagos. Não expor status operacional publicamente. O alias de entrada e o destino foram confirmados; falta ativar a zona Cloudflare e verificar o endereço de destino antes de configurar Email Routing. A matriz de emails transacionais ainda exige decisão.
- No ImprovMX autenticado, a lista mostrou “No domains found”; não há domínio legado para apagar nessa conta neste momento. No Registro.br autenticado, `portalfwlog.com.br` e `vela.app.br` estão publicados e continuam delegados ao DNS do Registro.br; as zonas avançadas de ambos contêm somente um A no apex para `216.198.79.1`, sem outras entradas (MX/TXT/CNAME/AAAA/CAA). A consulta DNS pública confirmou NS Registro.br e A do apex; nenhuma resposta MX/TXT no apex. A Cloudflare segue Pending e mostra o mesmo A proxied. A inspeção read-only dos projetos Vercel em 2026-09-23 listou `portalfwlog.com.br` e `fwlog-portal.vercel.app` no `fwlog-portal` (ambos `Valid Configuration`) e `vela.app.br`, `transhippingdesk.com.br`, `portal.transhippingdesk.com.br` e `transhippingdesk.vercel.app` no projeto `vela`; os detalhes/uso dos três domínios legados ainda precisam de verificação. Não remover nem alterar esses aliases sem confirmar destinos e dependências. Inventário dos subdomínios/remetentes e de todos os alvos Vercel/DNS permanece necessário antes de adicionar registros Resend ou trocar NS.
- PR #734 contém a implementação de M2/M4/M7/M10; #735 contém M9; #736 adiciona eventos agregados de ciclo de vida M3. As três estão abertas como draft, sem merge/deploy, e os checks dos heads consultados estão verdes em 2026-09-23. Verificações locais desta continuação: `docs:check`, `lint`, `build`, `size-limit` (Vela 218,35 KiB e Portal 186,49 KiB gzip, abaixo de 250 KiB), suíte Vitest completa (3.533 passaram, 135 ignorados em 680 arquivos) e `git diff --check`; `backup:r2:test` tem 15 testes passando na execução registrada anteriormente. Não houve credencial real nem upload de backup nesta etapa. Deno não está instalado localmente; Supabase Preview/CI passou para #736, mas nenhum check prova evento Sentry em runtime.
- Decisões recentes: PostHog somente eventos agregados sem identificadores; remover `customer_id` estável do contexto Sentry do Portal; MFA permanece adiado. O owner confirmou o agendador de backup diário às 09:00 (horário local), após login no Windows, com segredos no Credential Manager e uma segunda cópia da chave de criptografia no gerenciador de senhas existente. A execução perdida deve iniciar quando a máquina voltar; isso não recria cópias dos dias em que ficou desligada. Executor e testes locais estão implementados, mas ainda não publicados/instalados nem executados com credenciais reais. A leitura local em 2026-09-23 confirmou ausência dos quatro alvos `VelaBackup/*` no Credential Manager e da tarefa agendada; `pg_dump`, `pg_restore` e AWS CLI não estão instalados/no PATH, então ainda não é possível realizar backup nesta máquina. Falta identificar o gerenciador de senhas e confirmar se o Secret Access Key do token ativo foi preservado. Para email de entrada, o owner confirmou `suporte@portalfwlog.com.br` encaminhado a `importacao@fwlog.com.br`; o destino pode ser verificado pelo owner. O encaminhamento depende da zona Cloudflare estar ativa e da verificação do destino. Pendente também: inventário dos subdomínios/alvos Vercel; remetente `From`, `Reply-To` e relatórios DMARC; decisão Turnstile (separada de MFA); heartbeats M2, indisponíveis sem upgrade nesta conta; restore isolado.
- O recurso de malware alerts do Dependabot foi ativado; alerts e security updates já estavam ativos. Não foi contratado upgrade do GitHub: CodeQL, Dependency Review, secret scanning, push protection e ruleset/branch protection não estão disponíveis para este repositório privado no plano atual. Decisão do owner: registrar a limitação e seguir com os checks atuais, sem upgrade nem tornar o repositório público.
- A camada de telemetria Edge está na PR #736; não há novo deploy desta frente. O runtime Sentry para Edge, cutover de nameservers, envios de email, agendamento do backup e restore seguem pendentes. Nenhum gate de runtime é fechado por build ou CI verde.
- Diretriz reafirmada pelo owner em 2026-09-22: o sistema ainda não tem usuários reais e os dados atualmente em produção são fixtures/testes, sem necessidade de preservação para este trabalho; isso dá flexibilidade para ajustar ou recriar esses dados durante a implementação. A diretriz não substitui confirmação do alvo nem autoriza por si só custos, credenciais, DNS/cutover, comunicação externa ou publicação.
- PRs [#734](https://github.com/luccafwlog/vela/pull/734) (M7/M2/M4/M10), [#735](https://github.com/luccafwlog/vela/pull/735) (M9) e [#736](https://github.com/luccafwlog/vela/pull/736) (M3) permanecem abertas como draft e sem merge. A consulta em 2026-09-23 confirmou checks e previews verdes nos heads atuais; ainda não há validação de runtime de produção.

## 1. Limites, restrições e fontes de verdade

### Incluído

- Medidas M1 a M4 e M6 a M11 da Issue 710, inclusive código, migrations novas, configuração autenticada dos provedores, documentação viva, rollout, observação e rollback.
- Ambientes Preview/homologação antes de produção e provas de runtime separadas das provas estáticas.
- Atualização de `WORKFLOW.md`, `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md`, módulos e runbooks afetados.
- Registro de custo, cota gratuita, owner, canal de alerta e procedimento de saída de cada serviço novo.

### Fora de escopo

- Migrar as SPAs para VPS/EC2, trocar Resend ou Registro.br, habilitar Supabase Storage sem caso de uso, ou adicionar biblioteca de PDF.
- Self-host de PostHog/observabilidade na primeira entrega; só reavaliar após medir volume, custo ou exigência de residência de dados.
- Integração de PIX automático / PIX Itaú (M5 da Issue 710) neste ciclo: mantida a emissão estável de QR Code PIX estático existente e a conciliação manual de extrato na Reconciliação.
- Desativar ou alterar a conciliação manual de extrato financeiro.
- Transformar CI verde em prova de DNS, RLS, email, webhook, alerta, backup ou restore em produção.

### Fontes de verdade e invariantes atuais

- Autorização continua no banco por RLS/RPC; WAF, UI, Turnstile e route guards são camadas adicionais, não fronteira de autorização (`docs/operations/seguranca.md`, ADRs 0001 e 0004).
- Clientes internos e do Portal permanecem separados (`src/services/supabase.ts`, `src/hooks/useAuth.tsx`, `src/hooks/usePortalAuth.tsx`).
- O login do Portal envia CNPJ e senha a `portal-login`; a identidade técnica não vai ao browser. O rate limit persistido atual (`portal_login_attempts`, `portal_login_resolution_attempts`, `portal_rate_limits`) permanece como defesa e auditoria de origem.
- `src/lib/telemetry.ts` é o dono da sanitização frontend; `sendDefaultPii:false`, remoção de query strings e redação de CNPJ/CPF/email/token são invariantes. O Portal não associa um identificador estável de cliente ao Sentry, por decisão do owner; o Vela interno mantém sua identidade técnica atual, fora dessa decisão.
- Migrations existentes não são reescritas. Migrations novas preservam default-deny, grants explícitos e seguem `WORKFLOW.md` §11. `src/types/database.ts` e `src/lib/pix.ts` são protegidos; qualquer alteração exige autorização expressa.
- Jobs continuam autenticados por segredo de Edge Function espelhado no Vault e despachados por `ops.dispatch_edge_job`; heartbeat não pode expor segredo nem tornar o monitor condição de sucesso do job.
- O projeto de produção Supabase é `fgmkhbzhaeebrsizwccx`; operações de produção exigem alvo exibido e conferido antes da ação.

## 2. Decisões que bloqueiam somente a frente correspondente

Registrar as decisões em comentário da Issue 710 e, quando alterarem arquitetura ou contrato, em nova ADR. As demais frentes podem prosseguir enquanto uma decisão está aberta.

| Gate | Decisão / autorização | Padrão proposto | Bloqueia |
|---|---|---|---|
| G1 | Autorização concedida para Cloudflare; janela e troca efetiva de NS ainda exigem confirmação no momento do cutover | `vela.app.br` primeiro; `portalfwlog.com.br` após 24 h verde | M1 produção e M11 DNS |
| G2 | Better Stack escolhido; destinatário único `lucca.juliatti@fwlog.com.br`; dois monitores HTTP privados verificados ativos; owner recusou status page pública | Better Stack para uptime e heartbeat privados; sem link/status público | M2 |
| G3 | Projetos Sentry e variáveis DSN de frontend configurados; Replay desligado. Owner decidiu não enviar `customer_id` do Portal como identidade Sentry; Vela interno não alterado. Presença das variáveis não prova deploy/roteamento; `SENTRY_DSN` de Edge Functions ausente na verificação registrada | confirmar roteamento dos eventos dos dois frontends e Edge em Preview após PR; manter a separação Portal sem ID de cliente | M3 |
| G4 | Dependabot escolhido; GitHub Team não será contratado; regras indisponíveis no plano devem ser registradas | Dependabot semanal; preservar checks disponíveis | M6 |
| G5 | Upstash aprovado em São Paulo; limiar final aprovado | 10 erros por IP+CNPJ, bloqueio de 5 min, fail-closed somente para abuso confirmado | M7 |
| G6 | MFA explicitamente adiado pelo owner | fora da primeira entrega; reabrir somente por decisão explícita | M8 MFA |
| G7 | PostHog Cloud EU aprovado; owner decidiu eventos exclusivamente agregados, sem IDs de cliente/viagem; sem autocapture/replay e sem PII | propriedades allowlisted de superfície/tipo/estado; nenhuma correlação por identificador | M9 |
| G8 | R2 aprovado e ativado; backup diário às 09:00 local; Task Scheduler após login; segredos no Credential Manager e cópia secundária da chave no gerenciador de senhas; custo zero exclui add-on PITR | dump criptografado diário com chave fora do bucket; backups físicos diários Supabase seguem como primeira cópia; tarefa atrasada roda quando possível, mas não cria snapshots dos dias perdidos | M10 |
| G9 | Owner confirmou `suporte@portalfwlog.com.br` → `importacao@fwlog.com.br`; destino pode ser verificado pelo owner. A zona `portalfwlog.com.br` está Pending no Cloudflare e não recebe email por ele enquanto estiver inativa. | ativar a zona/cutover autorizado, verificar destino no Cloudflare e então configurar Email Routing; isso só encaminha mensagens recebidas, não hospeda caixa nem configura envio | M11 |

## 3. Contrato de execução pelo navegador autenticado

Antes de editar código, o Codex abre e registra um inventário **read-only** nos painéis autenticados de GitHub, Vercel, Supabase, Sentry, Registro.br e Resend. Cloudflare, Better Stack/Checkly, Axiom, Upstash, PostHog e Postmark DMARC entram quando o gate correspondente for aprovado e a conta existir.

- Reutilizar sessões autenticadas já abertas. Se houver login, MFA, CAPTCHA ou aceite de convite, pausar para o usuário concluir; não pedir nem manipular a credencial.
- Para cada painel, registrar em relatório histórico: conta/organização, projeto/domínio, ambiente, estado anterior, mudança pretendida, timestamp e evidência sem segredo. Não copiar payloads com PII.
- Toda mudança remota deve ter preflight, alvo visível, diff/configuração esperada e rollback escrito. DNS, proteção de branch, secrets, integrações, alertas, retenção, backups e flags exigem verificação após salvar.
- Mudanças de painel com efeito externo são feitas somente na etapa de rollout da frente e com a autorização correspondente. O Codex não envia mensagem real, altera DNS ou dispara email produtivo como efeito colateral de uma inspeção.
- Usar Preview/branch Supabase e contas `@example.test` nos testes autenticados. Produção só recebe smoke tests não destrutivos, salvo cenário controlado aprovado (por exemplo, alerta sintético ou restore em branch descartável).
- Screenshots devem recortar identificadores e omitir tokens, endereços, destinatários e conteúdo de cliente. Quando isso não for possível, registrar evidência textual sanitizada.
- Ao final de cada frente, comparar painel e repositório para impedir drift e anotar o custo/cota efetivamente mostrados, sem assumir preços da Issue como atuais.

### Inventário autenticado inicial

- [ ] GitHub: Actions, Advanced Security disponível, Dependabot, rulesets/branch protection, secret scanning/push protection e integrações instaladas.
- [ ] Vercel: projetos `vela` e `fwlog-portal`, domínios, branch de produção, env vars por ambiente, Analytics/Speed Insights, deploys e integração Supabase.
- [ ] Supabase: plano/add-ons, PITR/backups, Auth MFA/CAPTCHA/rate limits, Edge Functions/secrets, logs/log drains, Vault, cron, branches e integrações.
- [ ] Sentry: organização, projetos, DSNs, environments, releases, alert rules, integrations, quotas, Replay e retenção.
- [ ] Registro.br/Cloudflare: zonas e todos os registros DNS, TTL, DNSSEC, MX/SPF/DKIM/DMARC, CAA e registros de verificação.
- [ ] Resend: domínios, SPF/DKIM, webhook, eventos e remetentes; nenhum envio real durante inventário.
- [ ] Fornecedores escolhidos: região, plano/cota, DPA/residência, owners, integrações, tokens existentes e rotação.

## 4. Estratégia de branches, PRs e dependências

Este plano foi produzido sobre `main` local em 2026-09-22 e conferido contra os três commits então presentes em `origin/main` (até `726248dc`). Antes da primeira implementação e de cada PR subsequente, atualizar a base por fast-forward/rebase seguro, revisar conflitos com o plano e remapear linhas/owners alterados; não executar `npm run sync:hard`.

Não executar as medidas em uma PR única. Usar uma issue/PR por unidade abaixo, encadeadas pelos contratos e gates:

1. **Fundação e inventário:** decisões de gates, threat model/dados, runbooks e matriz de custos; sem mutação de produção.
2. **Supply chain (M6):** independente e primeiro, para proteger as PRs seguintes.
3. **Observabilidade (M3 → M2 → M4):** primeiro biblioteca/contrato de eventos, depois monitores/heartbeats/status, então retenção/dashboards.
4. **Perímetro e autenticação (M1 → M8 → M7):** Cloudflare e Turnstile antes do captcha; Redis depois de fixar a semântica do bloqueio.
5. **Entregabilidade e produto (M11 e M9):** M11 após inventário DNS; M9 após política de dados e eventos.
6. **Recuperação (M10):** backup e restore podem avançar após estabilização das frentes de infraestrutura.

Cada PR inclui testes, documentação viva e rollback da sua própria frente. Mudança que depende de configuração ainda não aplicada usa flag/default seguro; configuração remota não deve deixar `main` dependente de segredo ausente.

## 5. Plano detalhado por medida

### M6 — Blindar o GitHub

**Comportamento operacional pretendido:** vulnerabilidade crítica/segredo bloqueia merge e `main` exige revisão e checks. **Limite vigente:** sem upgrade, o GitHub não oferece esses bloqueios a este repositório privado; Dependabot alerta e abre PRs, mas a regra de bloqueio automático continua não atendida.

- [x] Adicionar `.github/dependabot.yml` para npm/GitHub Actions (PR #720 incorporada) e Deno (`supabase/functions/deno.json`).
- [ ] CodeQL para JavaScript/TypeScript não está disponível como code scanning neste repositório privado/plano atual; não fazer upgrade. Manter o item registrado como lacuna, sem afirmar que o CI atual substitui essa cobertura.
- [ ] Dependency Review não está disponível no plano atual; não fazer upgrade. Manter o item registrado como lacuna, sem bloqueio de severidade crítica no PR.
- [x] No GitHub autenticado, confirmar Dependabot alerts/security updates e habilitar malware alerts. Secret scanning/push protection não estão disponíveis no plano atual; decisão do owner: não fazer upgrade, manter CI atual e registrar a limitação.
- [ ] Criar/atualizar ruleset de `main`: recurso indisponível no plano atual do repositório privado; não fazer upgrade. PRs continuam usando os checks existentes, sem proteção remota obrigatória de branch.
- [x] Registrar limites do plano e preservar checks atuais em `WORKFLOW.md`/documentação de segurança. PRs abertas #729–#733 foram verificadas; checks aplicáveis estão verdes. Nas #731 e #733, CI apontou incompatibilidades que foram corrigidas nas próprias branches: TypeScript/Vitest 7/5 foram mantidos no major compatível atual, e a asserção da versão Sentry deixou de fixar um patch. Supabase Preview foi `skipping` nas #731/#733. Nenhuma PR foi mesclada; esta conclusão não autoriza merge automático.
- [ ] Testar em branch descartável com pacote vulnerável de fixture e token sintético reconhecido pelo GitHub; sem segredo real. A disponibilidade de alertas/bloqueios para esse cenário segue sem prova.

### M3 — Sentry frontend, Edge Functions, cron e Replay

**Comportamento operacional:** erro no Vela, Portal ou Edge Function aparece no projeto correto com `release`, `environment`, `surface`, `modulo`, `tela`, `tarefa` e `categoria_falha`; Preview não acorda a equipe; produção respeita rate limit; nenhum evento amostrado contém PII/segredo.

- [x] Extrair `src/lib/telemetryContract.ts` com sanitização compartilhável sem acoplar Deno ao SDK React. Os DSNs públicos separados do browser permanecem vinculados às entradas internas e do Portal.
- [x] Criar `supabase/functions/_shared/telemetry.ts` com inicialização lazy, scrub e flush limitado; aplicar somente a exceções não tratadas e HTTP 5xx em dez Edge Functions prioritárias. Dependência e `import_map` compartilhados estão configurados. Implementação local nesta PR; runtime/Preview e DSN permanecem pendentes.
- [ ] Instrumentar métricas Sentry de início/fim dos quatro runners autorizados, duração, contagem agregada com `count_kind` explícito e resultado de baixa cardinalidade, sem IDs nem payload. Implementação em validação nesta PR; o wrapper só observa invocações autenticadas. Métricas usam a API Application Metrics disponível no SDK 10.73.0; cota/consumo da organização ainda precisam ser conferidos no painel e monitorados para manter custo adicional zero. Isso não prova ingestão/runtime.
- [x] Manter Replay desligado na primeira entrega, conforme decisão registrada; não habilitar profiling sem avaliar custo, privacidade e compatibilidade.
- [ ] Atualizar `vite.config.ts`/build somente se sourcemap upload autenticado for adotado; nunca publicar token Sentry no bundle. Manter artifact `hidden` e release ligado ao commit.
- [ ] No Sentry autenticado, conferir projetos/alertas `environment=production`, integração de canal e limitação `>5/h`; variáveis DSN frontend estão presentes em Vercel Production, mas falta comprovar roteamento por projeto e deploy. `SENTRY_DSN` Edge e Previews também precisam validação antes da produção.
- [x] Testar sanitização compartilhada, query opaca, resposta 5xx preservada e falha do provider; adicionar teste Deno/assert e verificação da configuração. Runtime: erro sintético em Preview/produção controlada, roteamento e inspeção de eventos continuam pendentes.
- [x] Atualizar runbook de observabilidade, workflow e deploy com o comportamento e rollback do helper. Configuração remota de DSN/alertas e prova de runtime continuam pendentes; código de negócio não depende do Sentry.

### M2 — Uptime e heartbeats privados

**Comportamento operacional:** queda do Portal alerta em menos de 6 minutos; ausência do `demurrage-dunning` alerta em menos de 70 minutos. Monitores e notificações são internos; sem página pública de status ou link no Portal (decisão do owner).

- [ ] Definir probes autenticados sem PII: login interno e leitura de fatura fixture em homologação, com contas QA dedicadas e permissões mínimas. Guardar credenciais exclusivamente no secret store do monitor. A opção `portal_ship_schedule()` permanece sem contrato de asserção/ambiente.
- [ ] Manter dois probes HTTP públicos sem autenticação para disponibilidade do shell (Vela e Portal), com alertas privados para o destinatário aprovado; não são testes de login/faturamento. Monitores vistos up a cada 3 min em 2026-09-22.
- [x] Criar helper best-effort com ping de sucesso e endpoint `/fail`, timeout curto e URL secreta por env; a API documentada não oferece `/start`. Ligar aos quatro jobs ativos: `demurrage-dunning`, `alerts-detector`, `customer-communication-auto-runner` e `portal-daily-digest`. Respostas 2xx com contador `failed`, `partial` ou `releaseFailures` positivo são falha; o digest diário propaga falhas de consulta como HTTP 500 e falhas parciais de envio como contador. Alterações locais ainda precisam de PR/CI/deploy.
- [x] Conferir via consulta read-only os oito `cron.job` ativos em produção. Os quatro dispatchers Edge elegíveis são `demurrage-dunning` (a cada hora), `alerts-detector` por `alerts-foundation-detectors` (a cada 15 min), `customer-communication-auto-runner` (a cada 15 min) e `portal-daily-digest` (11:00 UTC); os quatro jobs SQL de manutenção não recebem heartbeat HTTP.
- [x] Adicionar teste de contrato que fixa a correspondência entre essas quatro agendas, `ops.dispatch_edge_job()` e os entrypoints. Teste Vitest focal passou; isso valida o contrato no repositório, não a agenda futura do Supabase.
- Não instrumentar `portal-email-events-runner`, `import-effects-runner` ou `recalc-demurrage-ptax`: não estavam ativos no cron de produção observado; rever se a agenda mudar.
- [ ] Após PR/deploy, criar os quatro heartbeats privados e gravar as URLs-secretas nos secrets de Edge Functions sem mostrá-las em chat, terminal ou screenshots; depois provar um ping e uma falha controlada não destrutiva. A autorização do owner já existe, mas a conta informa que heartbeats adicionais exigem upgrade. Não contratar plano; reavaliar alternativa que preserve custo zero ou pedir nova decisão de custo.
- [x] Não criar status page pública nem adicionar link de status ao Portal, por decisão expressa do owner.
- [ ] Validar em Preview um heartbeat perdido e tempos de alerta sem pausar cron produtivo.
- [ ] Registrar owner, manutenção, ack/escalation e resposta a alerta no runbook `docs/operations/observabilidade.md`. Helper permanece no-op sem configuração.

### M4 — Retenção e consulta de logs

**Comportamento operacional desejado, adiado pelo custo:** logs sanitizados pesquisáveis por 30 dias. O owner escolheu custo zero adicional; o Log Drain do Supabase e qualquer retenção/dashboards pagos ficam desativados. A retenção nativa disponível não cumpre o alvo de 30 dias.

- [ ] Definir schema de log estruturado: `timestamp`, `environment`, `release`, `surface`, `function_name`, `job_name`, `status`, `duration_ms`, `correlation_id` aleatório, `customer_ref` hash quando estritamente necessário e códigos de erro de baixa cardinalidade. Para a primeira entrega sem serviço pago, o logger local adota somente `function`, `job`, `status` e `error_code`; timestamp/ambiente/function também são metadados do runtime Supabase. Release, duração e correlação permanecem pendentes; nenhum ID de cliente será necessário para este escopo.
- [x] Substituir logs soltos de falha em `admin-users`, `alerts-detector`, `customer-communication-auto-runner`, `demurrage-dunning`, `import-effects-runner`, `portal-email-webhook`, `portal-invite-activate`, `portal-invite-send`, `portal-login`, `portal-password-recovery`, `portal-recovery-email-change`, `recalc-demurrage-ptax`, `send-customer-communication` e `portal-email-events-runner` por logger allowlisted sem headers, bearer, body, CNPJ, email, objetos de erro ou IDs brutos. Helpers compartilhados `rateLimit.ts` e `email.ts` agora não registram mensagem de provedor, destinatário ou ID de tentativa. Outros módulos Edge e logs de sucesso ainda não foram migrados.
- [x] Criar `supabase/functions/_shared/logger.ts` para o processamento de eventos de email e emitir apenas `function`, `job`, `status` e `error_code`; dois testes Vitest passaram. Não adiciona transmissão externa.
- [x] Avaliar disponibilidade/custo de Log Drains; o custo adicional foi recusado. Não habilitar drain nem configurar destino pago.
- [x] Implementar logger allowlisted localmente para os fluxos críticos listados, sem custo nem transmissão externa; dashboards, exportação e retenção longa ficam adiados.
- [x] Não criar dashboards/destino pago: fora da decisão de custo zero. Alertas operacionais ficam nos monitores privados M2/M3.
- [x] Expandir scrub/testes para os fluxos críticos listados e helpers compartilhados; o teste inclui rejeição runtime de valores fora da allowlist. A cobertura de outras Edge Functions e logs de sucesso permanece pendente. Não enviar eventos para serviço externo nem alegar retenção de 10/30 dias; a retenção nativa permanece a disponível no plano.
- [x] Atualizar arquitetura, segurança e runbook para o logger sem destino externo. Não há drain/token para reverter; o rollback é restaurar os `console.*` anteriores somente se uma regressão exigir, mantendo os logs nativos e seu scrub.

### M1 — Cloudflare DNS, WAF, Turnstile e cache

**Comportamento operacional:** os dois domínios continuam servindo Vela/Portal pela Vercel, com DNSSEC; abuso de fluxos públicos é barrado na borda e assets versionados são cacheados sem cachear HTML, Auth ou Edge Functions.

- [x] Inventariar as zonas avançadas no Registro.br autenticado: os dois domínios estão publicados e usam DNS do Registro.br; cada zona contém somente um A no apex (`216.198.79.1`), sem MX/TXT/CNAME/AAAA/CAA. Consulta pública confirma NS Registro.br e A; sem MX/TXT no apex. Cloudflare permanece Pending com um A proxied correspondente. ImprovMX legado do transhippingdesk foi declarado sem uso e não deve ser recriado.
- [ ] Inventariar o restante do DNS/Resend e confirmar alvos Vercel (www/outros subdomínios, SPF/DKIM/DMARC, verificação e remetentes). O painel Vercel lista `portalfwlog.com.br` e `fwlog-portal.vercel.app` no projeto Portal, e `vela.app.br`, `transhippingdesk.com.br`, `portal.transhippingdesk.com.br` e `transhippingdesk.vercel.app` no projeto Vela; falta inspecionar o destino/estado dos domínios legados. Não alterar DNS/Resend nem fazer cutover até enumerar e aprovar todos os registros e dependências.
- [ ] Confirmar no Vercel autenticado os alvos atuais com `vercel domains inspect` e no painel; não inventar A/CNAME. Manter Vercel como origin e “Full (strict)” no SSL/TLS.
- [ ] Configurar proxy somente nos hosts web. Manter registros de email DNS-only. Ativar DNSSEC na Cloudflare e publicar DS no Registro.br na ordem documentada pelo provedor.
- [ ] Criar WAF/rate limits nos paths efetivos `/portal/login`, `/portal/ativar`, `/portal/esqueci-senha`, `/portal/recuperar-senha` e URL da Edge Function `portal-login`. Como a Edge Function pode ser chamada diretamente no domínio Supabase, a regra Cloudflare no domínio web não é suficiente: introduzir proxy/gateway same-origin ou manter rate limit server-side/Redis e registrar esse limite arquitetural.
- [ ] Criar Turnstile para os fluxos públicos. Tokens devem ser verificados server-side nas funções correspondentes, com hostname/action/expiração e uso único conforme o fornecedor.
- [ ] Criar cache rule apenas para `/assets/*` e `/branding/*` quando os headers forem compatíveis; bypass de HTML, `/portal/*`, APIs, Supabase, cookies e respostas autenticadas.
- [ ] Fazer cutover noturno de `vela.app.br`, executar checklist completo e observar 24 h antes de `portalfwlog.com.br`: DNS/DS, SSL, rotas profundas, login/logout/refresh nas duas fronteiras, Realtime, PTAX, Sentry, CSP, assets, Edge Functions, email e Preview aliases.
- [ ] Testar rate-limit com tráfego sintético autorizado e baixo volume; não usar força bruta real. Rollback: desativar proxy/regra isolada ou restaurar NS/DS a partir do inventário; não trocar o segundo domínio com o primeiro instável.
- [ ] Atualizar `docs/setup/deploy.md`, arquitetura, segurança e runbook DNS.

### M8 — Captcha no Portal; MFA interno adiado

**Comportamento operacional da primeira entrega:** os fluxos públicos do Portal podem exigir Turnstile válido, com erro recuperável para humanos e recusa antes do trabalho caro do Auth. MFA interno não será imposto nesta entrega; os itens de enrolamento, AAL2, recovery codes e enforcement permanecem adiados.

- [x] **Adiado por decisão do owner:** modelar enrolamento/garantia MFA, AAL2, recovery codes e enforcement server-side somente após nova autorização explícita.
- [ ] Integrar widget Turnstile em `src/pages/PortalLogin.tsx`, `PortalAtivacao.tsx`, `PortalForgotPassword.tsx`/reset conforme ameaça. Encaminhar apenas token efêmero às Edge Functions; validar com secret server-side antes de resolver conta/chamar Auth.
- [ ] Alinhar `supabase/config.toml` ao estado remoto suportado sem commitar secret. Confirmar se Supabase Auth CAPTCHA cobre chamadas feitas dentro de `portal-login`; se não, manter verificação explícita na Edge Function.
- [ ] Testes de UI/Edge Functions para Turnstile; validar recusa e recuperação em Preview com chaves próprias de teste, sem alterar a política MFA adiada.
- [ ] Atualizar segurança, auth, deploy e suporte para a decisão de escopo. Rollback: remover a verificação Turnstile e revogar o segredo se exposto; não há enforcement MFA para suspender nesta entrega.

### M7 — Upstash Redis para bloqueio distribuído e idempotência

**Comportamento operacional:** 10 erros do mesmo IP+CNPJ bloqueiam aquele par por 5 minutos sem bloquear outro IP; indisponibilidade do Redis não remove o rate limit persistido atual.

- [x] Criar `supabase/functions/_shared/rateLimit.ts` com hash/HMAC de IP+CNPJ e TTL; nunca usar CNPJ puro como chave.
- [x] Integrar à `portal-login`, ativação e recuperação; manter tabelas/RPCs persistidas como defesa e auditoria.
- [x] Definir fallback ao rate limit persistido quando Redis estiver indisponível; esta alteração local também impede que Redis `allowed` anule bloqueio persistido.
- [x] Provisionar database Upstash Free e gravar os três secrets autorizados nas Edge Functions de produção. Configuração existe, mas não prova comportamento runtime.
- [ ] Confirmar no Preview se o gateway sobrescreve `CF-Connecting-IP` e testar duas origens controladas, concorrência, TTL e fallback. Os testes adicionados nesta execução são estáticos, não prova de runtime.
- [x] Atualizar o runbook de rate limit e endurecer a identidade de IP para não confiar em `X-Forwarded-For`/`X-Real-IP` do cliente.
- [ ] A identidade Redis ainda usa `CF-Connecting-IP`; antes de tratar o limite distribuído como defesa efetiva, comprovar em Preview que o gateway Supabase sobrescreve/remove o valor enviado pelo cliente. Se não houver prova ou o cabeçalho for controlável, não promover essa camada a produção; o limitador persistido por CNPJ continua sendo a defesa existente.

### M11 — Monitor de entregabilidade e DMARC

**Comportamento operacional:** autenticar e monitorar somente o domínio realmente usado pelos remetentes aprovados. O novo domínio, endereços e categorias de mensagens ainda não foram decididos; não configurar relatórios nem DNS de email antes de mapear o que é enviado. Os registros antigos do ImprovMX não são mais usados e não serão preservados/recriados.

**Mapa do código (From/Reply-To são env vars, não valores confirmados):**

| Categoria enviada | Gatilho/destinatário | Cabeçalhos atuais | Decisão pendente |
|---|---|---|---|
| Convite/reenvio, recuperação de senha e troca do e-mail de recuperação | ação de operador ou pedido do cliente; endereço do cliente atual/novo/anterior conforme o fluxo | `PORTAL_FROM_EMAIL` + `PORTAL_REPLY_TO` | endereços aprovados de remetente e suporte; se todos os fluxos compartilham a identidade |
| Resumo diário operacional | diariamente, se houver atividade; usuários internos ativos nos papéis admin/administrativo/documentação | `PORTAL_FROM_EMAIL` + `PORTAL_REPLY_TO` | confirmar que resumo interno deve usar a identidade transacional do Portal |
| Aviso a contato alternativo após bounce | evento Resend e cascata de bounce; contato alternativo do mesmo cliente | `PORTAL_FROM_EMAIL` + `PORTAL_REPLY_TO` | endereço de resposta; execução segue sem comprovação pois runner não constava agendado |
| Comunicados operacionais/documentais e institucionais/livres | automático ou disparo interno; contatos elegíveis conforme caixas, preferências e supressões | `PORTAL_FROM_EMAIL` + `COMMUNICATIONS_REPLY_TO` | endereços de envio/resposta para comunicados |
| Cobrança de demurrage | régua automática; contatos ativos das caixas financeiro/demurrage | `PORTAL_FROM_EMAIL` + `COMMUNICATIONS_REPLY_TO` | endereço de resposta financeira |

`PORTAL_SUPPORT_EMAIL` é texto de contato dentro dos templates, não cabeçalho
From/Reply-To. O alias sugerido `suporte@portalfwlog.com.br` fica no domínio
raiz (não é, tecnicamente, um subdomínio); Cloudflare Email Routing encaminha
para um destino verificado, mas não hospeda uma caixa postal. Os endereços
exatos continuam pendentes; os valores atuais desses secrets não foram lidos.
Alertas Better Stack são separados de email transacional e continuam
destinados apenas ao owner já aprovado.

- [x] Reautenticar no Registro.br e inventariar zonas raiz junto com Resend: os dois domínios web estão no DNS Registro.br com um A cada e sem registros de email; Resend tem somente `transhippingdesk.com.br` como Verified. Ainda faltam inventariar subdomínios/origens legítimas e confirmar remetentes, Reply-To, tipos de mensagem e destinatários antes de escolher novo domínio.
- [x] Levantar, por inspeção de código, categorias de mensagens, gatilhos, classes de destinatários e owners de `From`/`Reply-To` (tabela acima); isso não revela os valores atuais nem comprova entrega.
- [ ] Configurar `suporte@portalfwlog.com.br` → `importacao@fwlog.com.br`, após a zona Cloudflare estar ativa e o destino ser verificado. O owner confirmou os endereços e pode concluir a verificação; encaminhamento de entrada não configura envio/respostas pelo sistema.
- [ ] Só depois da matriz de mensagens, definir quais domínios exigem SPF/DKIM/DMARC e quem recebe relatórios; não supor que Vela e Portal ambos enviem email.
- [ ] Manter política vigente durante o cutover; observar 14 dias. Avançar de `none/quarantine` para `reject` em percentuais controlados apenas se fontes legítimas estiverem alinhadas.
- [ ] Simular falha em subdomínio/selector de teste ou usar validação do fornecedor; não quebrar DKIM produtivo para testar alerta.
- [ ] Atualizar deploy/email e criar runbook de entregabilidade. Rollback: voltar a política/percentual anterior e restaurar registros do inventário.

### M9 — PostHog sem PII e feature flags

**Comportamento operacional desejado:** funil agregado sem dados identificáveis. Não enviar IDs de cliente/viagem nem correlacionar usuários até que o contrato de dados seja confirmado. A flag de Comunicados só pode restringir envios; `app_settings.communications_enabled` permanece bloqueio mestre no servidor.

- [x] Decidir contrato de privacidade: somente eventos agregados allowlisted, sem IDs brutos nem hashes de cliente/viagem. O adapter aceita só superfície e tipo de fatura; `cookieless_mode: always` e `person_profiles: never` evitam persistir identidade no browser. A opção PostHog “Discard client IP data” está ligada; hashing server-side de visitantes únicos não foi validado e não deve ser ativado sem nova decisão.
- [x] Desabilitar autocapture, pageviews, session recording, eventos de exceção e coleta automática de URL/query. Sem cookies nem armazenamento local de identificador no modo cookieless. Não há eventos de produto instrumentados nem runtime validado nesta PR.
- [ ] Instrumentar os pontos de confirmação do servidor para `invoice_paid`; evento de browser sozinho não prova pagamento. `invoice_viewed`/`dispute_opened` partem dos owners de Portal com deduplicação.
- [ ] Criar enforcement server-side se a flag remota for mantida; a flag cliente `COMMUNICATIONS_ENABLED` atual não bloqueia os envios. O bloqueio mestre `app_settings.communications_enabled` deve continuar prevalecendo e PostHog nunca pode ativar envios por conta própria.
- [x] Confirmar projeto PostHog EU `281503`, token/host configurados como variáveis Vercel de Production nos dois projetos, painel ainda sem eventos e opção “Discard client IP data” ligada. Não houve criação de funil/flag nem envio de evento de fixture.
- [ ] Revisar retenção/acesso e definir política de feature flags; o modo cookieless server hash não foi validado nem ativado. Atualizar CSP `connect-src` somente para host necessário quando eventos forem instrumentados.
- [ ] Testes de schema/PII e runtime com fixtures. Inspecionar payload na rede e dez eventos no painel.
- [ ] Atualizar privacidade, arquitetura, CSP e operação. Rollback: default da flag local, remover key/script e manter chave global atual.

### M10 — PITR, dump diário em R2 e restore ensaiado

**Comportamento operacional:** a equipe conhece RPO/RTO reais, recebe alerta quando o backup diário falha e consegue restaurar Viagem, B/Ls e faturas até o ponto aprovado em ambiente descartável.

- [x] Confirmar backups físicos diários no Supabase; PITR está desligado e tem custo adicional. Decisão do owner: manter custo zero, portanto não habilitar PITR/add-on.
- [x] Definir runner diário às 09:00 local, por Task Scheduler após login, com `StartWhenAvailable`, rede obrigatória, três tentativas espaçadas e limite de execução; segredos serão obtidos do Windows Credential Manager e a chave terá cópia secundária no gerenciador de senhas existente. Se o PC ficar desligado, o backup atrasa e uma execução posterior não cria snapshots retroativos dos dias perdidos. A cópia privada é apagada após 90 dias; isso não é versionamento.
- [x] Implementar executor confiável local: allowlist de ambiente (sem herdar segredos/processo), sem credenciais em argumentos, wrapper PowerShell que lê do Credential Manager, limpa variáveis ao terminar, log sanitizado e política de tarefa limitada ao usuário interativo. Após upload do dump e manifesto e validação do objeto remoto, remove os dois arquivos locais; em falha preserva os arquivos completos cifrados e apaga só `.part` incompleto. Testes locais cobrem sucesso/falha e round-trip sintético do Credential Manager; ainda precisa seguir por PR/CI/deploy à `main`.
- [ ] No Cloudflare R2, o painel lista o token `Vela R2 Backup` como ativo, limitado ao bucket `vela-database-backups` com leitura/gravação de objetos (observação read-only em 2026-09-23). Ainda não foi verificado se a chave secreta de uso único foi preservada com segurança nem se Access Key ID/Secret Access Key estão no Credential Manager. Não criar outro token antes de conferir com o owner; se a chave de uso único se perdeu, revogar o token atual e recriá-lo somente depois de preparar o armazenamento local seguro.
- [ ] Criar/confirmar a cópia secundária da chave de criptografia no gerenciador de senhas antes de gerar credenciais reais ou executar backup. Não guardar a chave somente no PC.
- [x] Confirmar bucket privado R2 `vela-database-backups` com lifecycle de 90 dias; bucket ainda está vazio. Lifecycle apaga objetos e não equivale a versionamento/restore.
- [x] Manter o script `scripts/backup-r2.mjs` e runbook `docs/operations/backup-r2.md`; o script valida o dump com `pg_restore --list` e, após upload, baixa o objeto cifrado e compara tamanho/SHA-256 antes de enviar o manifesto. `npm run backup:r2:test` passou em 15 testes locais; em sucesso limpa o cache local, em falha preserva artefatos completos cifrados. Não houve upload real nem tarefa agendada registrada.
- [ ] Conectar alertas privados/heartbeat M2 ao resultado da execução diária depois que o runner e suas credenciais aprovadas estiverem configurados.
- [ ] Trimestralmente criar branch/projeto descartável, restaurar backup/PITR, aplicar `supabase/tests/seed_catalog.sql` conforme o procedimento e conferir amostra relacionada de Viagem → B/Ls → invoices/ledger. Nunca restaurar sobre produção.
- [ ] Registrar tempo, ponto alcançado e limitações como relatório histórico. Rollback operacional: desabilitar workflow e revogar credenciais; não apagar backups existentes sem autorização destrutiva específica.

## 6. Arquivos e contratos previstos

| Área | Donos existentes / novos previstos |
|---|---|
| Auth/MFA/captcha | `src/hooks/useAuth.tsx`, `src/hooks/usePortalAuth.tsx`, páginas públicas do Portal, `supabase/functions/portal-login/`, `portal-invite-activate/`, `portal-password-recovery/`, `_shared/cors.ts`, `_shared/passwordPolicy.ts`, migration nova |
| Observabilidade | `src/lib/telemetry.ts`, `src/lib/telemetryContext.ts`, `supabase/functions/_shared/telemetry.ts`, `_shared/logger.ts`, runners e funções prioritárias |
| Uptime privado | runners ativos listados em M2, helper de heartbeat, runbook de observabilidade (sem status page ou link público) |
| Analytics/flags | novo `src/lib/productAnalytics.ts`, Portal Billing/Disputes, `send-customer-communication`, CSP e env vars |
| CI/supply chain | `.github/dependabot.yml`, `.github/workflows/codeql.yml`, `.github/workflows/ci.yml` e GitHub ruleset |
| Infra/ops | `vercel.json`, `supabase/config.toml`, `docs/setup/deploy.md`, `docs/operations/*`, `WORKFLOW.md`, `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md` |

Interfaces novas devem ser pequenas e substituíveis: `TelemetrySink`, `HeartbeatSink`, `RateLimiter`, `IdempotencyStore`, `ProductAnalytics` e `FeatureFlagProvider`. Adapters externos não atravessam páginas/componentes diretamente.

## 7. Verificação e critérios de conclusão

### Gates locais por PR

- Mudança documental/configuração apenas: `npm run docs:check` e `git diff --check`, além de inspeção semântica.
- Aplicação/configuração contratual: `npm run docs:check`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run size-limit` quando o bundle mudar.
- Migration/RPC: todos os anteriores aplicáveis + `npm run migrations:check`, `npm run rpc:check`, replay Postgres local e suites `*.local-pg.test.ts` afetadas.
- Edge Functions: testes/asserts do handler/helper, Deno check/test quando disponível e runtime em branch Supabase; assert textual não prova execução.

### Matriz de prova remota

| Frente | Preview/homologação | Produção controlada | Evidência mínima |
|---|---|---|---|
| M1/M8/M7 | login/ativação/recovery, Turnstile e limites | smoke das duas autenticações e 20 tentativas sintéticas autorizadas | HTTP/status, painel WAF, sessão/refresh, sem PII |
| M2/M3/M4 | erro, heartbeat perdido, log sintético | alerta privado em produção sem status público | timestamps, regra acionada, evento sanitizado |
| M6 | PR/branch descartável | ruleset de `main` | checks e bloqueios visíveis |
| M9 | projeto dev/Preview | evento de fixture | payload de rede + painel sem PII |
| M10 | branch/projeto descartável | confirmação de backup diário e, após aprovação/secrets, objeto R2 validado | ponto de recuperação, checksum, restore e duração; PITR permanece desligado por custo |
| M11 | subdomínio/validador | 14 dias de relatórios reais | alinhamento e alerta sem quebrar DKIM |

### Aceite global

- [ ] Todos os critérios aplicáveis da Issue 710 ligados a uma evidência de Código, Teste ou Runtime; nenhum checkbox fechado só por configuração planejada.
- [ ] Medidas ativas possuem owner, custo/cota real, alerta de consumo, runbook, rollback e data da última prova.
- [ ] Os sites autenticados foram usados para conferir o estado final e o ambiente/alvo; drift entre painel e repositório foi eliminado ou registrado.
- [ ] Nenhum segredo/PII aparece em Git, CI, Sentry, logs, analytics, screenshots ou documentos.
- [ ] Login interno/Portal, refresh, rotas profundas, emails, Realtime, PTAX, CSP e Edge Functions permanecem funcionais.
- [ ] A conciliação manual e a emissão estática de PIX permanecem operacionais e sem alteração.
- [ ] Documentação viva e CHANGELOG refletem o entregue. Este plano é arquivado somente quando todo o escopo aplicável terminar; decisões adiadas viram novas issues vinculadas antes do arquivamento.

## 8. Riscos e rollback coordenado

| Risco | Contenção | Rollback |
|---|---|---|
| DNS/SSL/email indisponível | um domínio por vez, inventário e TTL reduzido, preservar registros mail | restaurar proxy/NS/DS e registros exportados |
| Bloqueio de usuários legítimos | Preview, coorte MFA, chaves Turnstile de teste, limites compostos | desligar enforcement/regra específica, manter fator e auditoria |
| Observabilidade vaza dados ou aumenta latência | allowlist, scrub, sampling, timeout e inspeção de eventos | zerar sampling/desligar DSN/drain e revogar token |
| Dependência externa cai | adapters, timeout/circuit breaker e defaults documentados | caminho Supabase/manual existente; serviço externo no-op |
| Backup não restaura | checksum/listagem e ensaio trimestral | manter backups nativos/PITR; corrigir pipeline antes de confiar nele |
| Free tier estoura | métricas de consumo e gate de custo | reduzir sampling/retenção/monitores ou obter aprovação de gasto |

## 9. Entrega e encerramento

Cada PR informa efeito visível, código/configuração alterados, painel e ambiente exercitados, comandos, resultados, skips e limitações. Depois de abrir PR, acompanhar somente o CI do commit enviado conforme `AGENTS.md`, salvo pedido explícito de monitoramento até merge.

Ao concluir a última frente: revisar a Issue 710 item por item, anexar relatório histórico consolidado em `docs/archive/reports/`, mover este arquivo para `docs/archive/plans/`, retirar sua entrada de `docs/plans/README.md` e atualizar `CHANGELOG.md`.
