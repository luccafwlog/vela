# Issue 710 — Endurecimento da stack (observabilidade, segurança e resiliência)

> **Estado:** plano vivo em execução; o documento não é prova de produção. As configurações remotas e PRs abaixo foram registradas separadamente, com runtime ainda pendente onde indicado.
>
> **Para execução pelo Codex:** usar `executing-plans`, manter a checklist deste arquivo atualizada e operar os painéis dos provedores pelo navegador com sessões autenticadas. Login, MFA, CAPTCHA e qualquer confirmação de ação externa permanecem sob controle do usuário; credenciais, tokens, códigos de recuperação e OTPs não entram em prompts, terminal, commits, screenshots ou evidências.

**Origem:** [Issue #710](https://github.com/luccafwlog/vela/issues/710), lida no GitHub autenticado em 2026-09-22.

**Objetivo:** reduzir o tempo de detecção e recuperação de falhas, endurecer as fronteiras de autenticação e supply chain e provar restauração de dados, preservando GitHub, Vercel, Supabase, Resend, Sentry e Registro.br como núcleo da stack e mantendo os novos serviços no free tier enquanto o volume permitir. A primeira entrega não inclui MFA; essa frente fica adiada até nova decisão explícita.

**Resultado observável:** o Vela e o Portal continuam com as mesmas URLs e fluxos, passam a bloquear abuso antes do Auth, expor estado operacional público, gerar alertas acionáveis para falhas de frontend/backend/cron e recuperar dados por procedimento ensaiado. MFA interno fica fora da primeira entrega; o captcha/Turnstile permanece uma decisão operacional separada. No Portal, o cliente vê o status do serviço no rodapé e conclui desafios anti-bot quando essa frente for habilitada; os processos financeiros continuam utilizando o fluxo estável de emissão estática e conciliação manual existente.

### Atualização de execução — 2026-09-22

- Decisões do owner registradas: sem GitHub Team, Dependabot semanal, Better Stack, PostHog Cloud EU, R2 como reserva, backup diário e MFA adiado; alertas destinados somente a `lucca.juliatti@fwlog.com.br`.
- Recursos remotos já criados, mas ainda não equivalem a entrega: zonas Cloudflare aguardando troca de nameservers, bucket R2 privado com lifecycle, projeto PostHog EU sem eventos, Redis Upstash Free em São Paulo, dois monitores HTTP Better Stack e DSNs/variáveis públicas de Sentry/PostHog na Vercel.
- PRs de execução abertas: [#720](https://github.com/luccafwlog/vela/pull/720), [#725](https://github.com/luccafwlog/vela/pull/725), [#726](https://github.com/luccafwlog/vela/pull/726), [#727](https://github.com/luccafwlog/vela/pull/727) e [#728](https://github.com/luccafwlog/vela/pull/728). A [PR #718](https://github.com/luccafwlog/vela/pull/718) foi incorporada à `main` como remediação relacionada, não como encerramento desta Issue.
- O runtime de produção, a troca de nameservers, a configuração de secrets, os envios de email, o agendamento do backup e os testes de restore continuam pendentes. Nenhum desses gates é fechado por build ou CI verde.

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
- `src/lib/telemetry.ts` é o dono da sanitização frontend; `sendDefaultPii:false`, remoção de query strings e redação de CNPJ/CPF/email/token são invariantes.
- Migrations existentes não são reescritas. Migrations novas preservam default-deny, grants explícitos e seguem `WORKFLOW.md` §11. `src/types/database.ts` e `src/lib/pix.ts` são protegidos; qualquer alteração exige autorização expressa.
- Jobs continuam autenticados por segredo de Edge Function espelhado no Vault e despachados por `ops.dispatch_edge_job`; heartbeat não pode expor segredo nem tornar o monitor condição de sucesso do job.
- O projeto de produção Supabase é `fgmkhbzhaeebrsizwccx`; operações de produção exigem alvo exibido e conferido antes da ação.

## 2. Decisões que bloqueiam somente a frente correspondente

Registrar as decisões em comentário da Issue 710 e, quando alterarem arquitetura ou contrato, em nova ADR. As demais frentes podem prosseguir enquanto uma decisão está aberta.

| Gate | Decisão / autorização | Padrão proposto | Bloqueia |
|---|---|---|---|
| G1 | Autorização concedida para Cloudflare; janela e troca efetiva de NS ainda exigem confirmação no momento do cutover | `vela.app.br` primeiro; `portalfwlog.com.br` após 24 h verde | M1 produção e M11 DNS |
| G2 | Better Stack escolhido; destinatário único `lucca.juliatti@fwlog.com.br`; escalonamento/status ainda pendentes | Better Stack para uptime, heartbeat, status e logs | M2 e M4 |
| G3 | Sentry autenticado; dois projetos e DSNs criados; Replay permanece desligado até validação | dois projetos (`vela-interno`, `portal`), sem Replay na primeira entrega | M3 |
| G4 | Dependabot escolhido; GitHub Team não será contratado; regras indisponíveis no plano devem ser registradas | Dependabot semanal; preservar checks disponíveis | M6 |
| G5 | Upstash aprovado em São Paulo; limiar final aprovado | 10 erros por IP+CNPJ, bloqueio de 5 min, fail-closed somente para abuso confirmado | M7 |
| G6 | MFA explicitamente adiado pelo owner | fora da primeira entrega; reabrir somente por decisão explícita | M8 MFA |
| G7 | PostHog Cloud EU aprovado; sem autocapture/replay e sem PII | Cloud EU, IDs pseudônimos, sem autocapture/replay | M9 |
| G8 | R2 aprovado e ativado; backup diário escolhido; PITR ainda depende de custo/benefício | dump criptografado diário com chave fora do bucket | M10 |
| G9 | Destinatário e domínios ainda não definidos para o novo fluxo de email | só avançar após baseline DNS/Resend e definição do remetente | M11 |

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

**Comportamento operacional:** PR com dependência crítica vulnerável ou segredo reconhecível não chega ao merge; `main` aceita somente mudanças revisadas com o gate `checks` verde.

- [ ] Adicionar `.github/dependabot.yml` para `npm` e GitHub Actions, semanal, grupos de updates e limite de PRs. Verificar no inventário se os imports Deno são cobertos; se não forem, adicionar workflow específico com `deno task outdated`/scanner suportado ou documentar Renovate como decisão alternativa.
- [ ] Adicionar `.github/workflows/codeql.yml` para JavaScript/TypeScript com permissões mínimas e gatilhos PR/push/schedule.
- [ ] Adicionar Dependency Review ao PR, bloqueando severidade crítica; fixar actions por SHA quando a política escolhida exigir.
- [ ] No GitHub autenticado, habilitar Dependabot alerts/security updates, secret scanning e push protection se disponíveis no plano; registrar indisponibilidade real em vez de prometer o recurso.
- [ ] Criar/atualizar ruleset de `main`: PR obrigatório, 1 approval, conversa resolvida, branch atualizada se decidido, `checks` obrigatório, bloquear force-push e delete, preservar bypass mínimo auditável.
- [ ] Testar em branch descartável com pacote vulnerável de fixture e token sintético reconhecido pelo GitHub; não usar segredo real. Fechar a branch/PR após capturar o resultado.
- [ ] Atualizar `WORKFLOW.md` §12 e documentação de segurança. Rollback: desabilitar apenas o novo check que estiver bloqueando por falso positivo, preservando `checks` e review.

### M3 — Sentry frontend, Edge Functions, cron e Replay

**Comportamento operacional:** erro no Vela, Portal ou Edge Function aparece no projeto correto com `release`, `environment`, `surface`, `modulo`, `tela`, `tarefa` e `categoria_falha`; Preview não acorda a equipe; produção respeita rate limit; nenhum evento amostrado contém PII/segredo.

- [ ] Extrair de `src/lib/telemetry.ts` o contrato compartilhável de nomes/tags/sanitização sem acoplar Deno ao SDK React. Manter DSNs separados por entrada (`src/main.tsx`, `src/portal-main.tsx`) por env vars públicas específicas.
- [ ] Criar `supabase/functions/_shared/telemetry.ts` com inicialização lazy, `captureException`, flush com timeout curto e scrub recursivo. Instrumentar primeiro `portal-invite-send`, `send-customer-communication`, `portal-email-webhook`, `demurrage-dunning` e os runners; expandir às demais Edge Functions após validar custo e latência.
- [ ] Instrumentar início/fim/falha dos runners com `monitor_slug`, duração, quantidade processada e resultado, sem IDs de cliente/message payload. Heartbeat de M2 continua independente do Sentry.
- [ ] Habilitar Replay apenas no browser, com `replaysSessionSampleRate=0.1`, `replaysOnErrorSampleRate` decidido no G3, mask de texto/input/media e denylist de rotas de ativação/reset. Avaliar profiling compatível com a versão do SDK antes de configurar; não declarar ativo sem bundle e evento observados.
- [ ] Atualizar `vite.config.ts`/build somente se sourcemap upload autenticado for adotado; nunca publicar token Sentry no bundle. Manter artifact `hidden` e release ligado ao commit.
- [ ] No Sentry autenticado, criar/renomear projetos sem perder histórico inadvertidamente, cadastrar DSNs por ambiente, alertas `environment=production`, integração de canal e limitação `>5/h`; restringir Replay por equipe.
- [ ] Testes: ampliar `src/lib/__tests__/telemetry.test.ts`; criar testes Deno/assert para scrub, tags, timeout e falha do próprio Sentry. Runtime: forçar erro sintético sanitizado em Preview e produção controlada, confirmar roteamento e inspecionar cinco eventos de cada superfície por vazamento.
- [ ] Atualizar `docs/operations/sentry-configuracao.md`, arquitetura, segurança e deploy. Rollback: zerar sampling/alert rule, remover DSN da superfície afetada e manter logging local; código de negócio não pode depender do Sentry.

### M2 — Uptime, heartbeats e status público

**Comportamento operacional:** queda do Portal alerta em menos de 6 minutos; ausência do `demurrage-dunning` alerta em menos de 70 minutos; a página “Portal Fwlog operacional” reflete monitores automaticamente e é acessível no rodapé.

- [ ] Definir três probes sem PII: `portal_ship_schedule()` público; login interno de Preview/produção com conta QA dedicada e permissão mínima; leitura de fatura fixture no Portal de homologação. Probes autenticados guardam credenciais exclusivamente no secret store do monitor.
- [ ] Criar helper best-effort compartilhado de heartbeat nas Edge Functions, com eventos `start`, `success` e `failure`, timeout curto e URL secreta em env. Instrumentar `demurrage-dunning`, `alerts-detector`, `customer-communication-auto-runner`, `portal-email-events-runner`, `import-effects-runner`, `recalc-demurrage-ptax` e `portal-daily-digest` sem mudar resultado do job.
- [ ] Provisionar monitores, escalonamento e status page no painel autenticado do fornecedor escolhido. PTAX inativo deve aparecer como manutenção/desabilitado, não incidente permanente.
- [ ] Adicionar link externo “Status do serviço” ao rodapé de `src/components/layout/PortalLayout.tsx`, com teste do destino/configuração e CSP se necessário.
- [ ] Criar teste de contrato para todos os jobs esperados terem heartbeat e alerta coerente com sua frequência. No runtime, pausar monitor de teste/endpoint sintético, nunca o cron produtivo, e provar os dois tempos de aceite.
- [ ] Documentar owner, manutenção planejada, ack/escalation e resposta a alerta em novo runbook `docs/operations/monitoramento-disponibilidade.md`. Rollback: remover link/monitores e env vars; helper permanece no-op sem configuração.

### M4 — Retenção e consulta de logs

**Comportamento operacional:** a equipe pesquisa falha de Edge Function, cron ou email por campos de correlação sem entrar no banco, com 30 dias de retenção e sem armazenar corpo, token, email ou documento.

- [ ] Definir schema de log estruturado: `timestamp`, `environment`, `release`, `surface`, `function_name`, `job_name`, `status`, `duration_ms`, `correlation_id` aleatório, `customer_ref` hash quando estritamente necessário e códigos de erro de baixa cardinalidade.
- [ ] Substituir logs soltos das Edge Functions prioritárias por helper em `supabase/functions/_shared/logger.ts`; nunca logar headers, bearer, body, CNPJ, email, `message_id` bruto se ele for dado pessoal. Definir hash/chave de correlação e política de acesso.
- [ ] No Supabase autenticado, confirmar se Log Drains está disponível no plano e quais fontes/campos entrega. Configurar destino Better Stack/Axiom, filtros `healthcheck`/`OPTIONS`, região e retenção; se o recurso exigir plano pago, parar no gate de custo e usar export suportado/documentado em vez de scraping.
- [ ] Criar dashboards de emails, Edge Functions e cron; alertas operacionais permanecem em M2/M3 para evitar duplicação.
- [ ] Testar scrub unitário e enviar eventos sintéticos. O aceite de “10 dias” só fecha após envelhecimento real ou teste de retenção suportado pelo fornecedor; presença imediata não prova retenção.
- [ ] Atualizar arquitetura, segurança e runbook. Rollback: desligar drain/token e revogar credencial no destino; preservar logs nativos.

### M1 — Cloudflare DNS, WAF, Turnstile e cache

**Comportamento operacional:** os dois domínios continuam servindo Vela/Portal pela Vercel, com DNSSEC; abuso de fluxos públicos é barrado na borda e assets versionados são cacheados sem cachear HTML, Auth ou Edge Functions.

- [ ] Exportar/inventariar todos os registros de cada zona no Registro.br e provedores de email. Reduzir TTL com antecedência; criar zona Cloudflare e importar/comparar A/AAAA/CNAME, MX, SPF, DKIM, DMARC, CAA e verificações.
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

- [ ] Criar `supabase/functions/_shared/rateLimit.ts` e port de idempotência atrás de interface, mantendo hash/HMAC de IP+CNPJ e TTL; nunca usar CNPJ puro como chave.
- [ ] Integrar a `portal-login`, ativação e recuperação. Distinguir erro de credencial, limite local e indisponibilidade do provedor sem criar oráculo de conta. Manter `check_portal_rate_limit`/tabelas como defesa e auditoria.
- [ ] Definir degradação: timeout curto, circuit breaker e limite local/Supabase ainda ativo. Falha do Redis não pode liberar tentativas ilimitadas nem derrubar todos os logins por período indefinido.
- [ ] Provisionar database/token de menor privilégio na região aprovada; secret apenas nas Edge Functions. Configurar métricas de comando/erro/custo.
- [ ] Testes concorrentes por chave/IP, TTL, provedor indisponível, hash e ausência de PII. Runtime em Preview com duas origens controladas.
- [ ] Atualizar segurança e runbook. Rollback: remover env/token e retornar ao caminho Supabase; revogar token Upstash.

### M11 — Monitor de entregabilidade e DMARC

**Comportamento operacional:** os dois domínios têm SPF/DKIM/DMARC preservados no cutover, relatório agregado semanal e alerta de quebra em menos de 24 h; `p=reject` só entra após evidência estável.

- [ ] Capturar baseline autenticado de Registro.br/Cloudflare e Resend, incluindo alinhamento, selectors DKIM, SPF includes e remetentes; não duplicar SPF.
- [ ] Cadastrar os domínios no Postmark DMARC e publicar somente os registros fornecidos, via Cloudflare autenticada após M1. Definir mailbox/owner e retenção dos relatórios agregados.
- [ ] Manter política vigente durante o cutover; observar 14 dias. Avançar de `none/quarantine` para `reject` em percentuais controlados apenas se fontes legítimas estiverem alinhadas.
- [ ] Simular falha em subdomínio/selector de teste ou usar validação do fornecedor; não quebrar DKIM produtivo para testar alerta.
- [ ] Atualizar deploy/email e criar runbook de entregabilidade. Rollback: voltar a política/percentual anterior e restaurar registros do inventário.

### M9 — PostHog sem PII e feature flags

**Comportamento operacional:** a equipe enxerga o funil “fatura vista → paga” com dimensões não identificáveis e pode desligar Comunicados sem deploy; nenhum evento contém CNPJ, email, B/L, invoice ID bruto ou texto digitado.

- [ ] Definir contrato versionado de eventos em novo `src/lib/productAnalytics.ts`: `invoice_viewed`, `invoice_paid`, `dispute_opened`; propriedades allowlisted (ambiente, superfície, tipo, faixa/estado e identificadores HMAC quando necessário).
- [ ] Desabilitar autocapture, session recording e coleta automática de URL/query. Reaproveitar regras de rota/scrub de `src/lib/telemetry.ts` sem criar duas políticas divergentes.
- [ ] Instrumentar os pontos de confirmação do servidor para `invoice_paid`; evento de browser sozinho não prova pagamento. `invoice_viewed`/`dispute_opened` partem dos owners de Portal com deduplicação.
- [ ] Criar feature flag com adapter e default fail-safe. Antes de substituir `COMMUNICATIONS_ENABLED`, manter dupla leitura e precedência documentada; desligar comunicação deve ser efetivo server-side em `send-customer-communication`, não apenas ocultar UI.
- [ ] Provisionar projeto EU, chaves por ambiente, retention e acesso no painel autenticado; criar funil e flag. Atualizar CSP `connect-src` somente para host necessário.
- [ ] Testes de schema/PII e runtime com fixtures. Inspecionar payload na rede e dez eventos no painel.
- [ ] Atualizar privacidade, arquitetura, CSP e operação. Rollback: default da flag local, remover key/script e manter chave global atual.

### M10 — PITR, dump diário em R2 e restore ensaiado

**Comportamento operacional:** a equipe conhece RPO/RTO reais, recebe alerta quando o backup diário falha e consegue restaurar Viagem, B/Ls e faturas até o ponto aprovado em ambiente descartável.

- [ ] No Supabase autenticado, confirmar plano, frequência/retenção de backups e disponibilidade/preço do PITR; não ativar upgrade sem G8. Registrar RPO/RTO contratual mostrado no painel.
- [ ] Definir pipeline de `pg_dump` diário a partir de credencial read-only/backup apropriada, criptografia client-side, upload versionado no R2, checksum, `pg_restore --list`, retenção 90 dias e lifecycle. Não colocar connection string ou chave no GitHub log/artifact.
- [ ] Escolher executor confiável (GitHub Actions com environment protegido ou serviço de backup) e proteção contra exfiltração em PR. Workflow de PR nunca recebe credenciais produtivas.
- [ ] Provisionar bucket privado, versioning/Object Lock quando disponível, lifecycle, chave e alertas pelo navegador autenticado. Separar capacidade de gravar backup de capacidade de apagar versões.
- [ ] Criar `scripts/backup/` e runbook `docs/operations/backup-restore.md`; validar checksum e listar conteúdo a cada execução. Heartbeat em M2 para sucesso/falha.
- [ ] Trimestralmente criar branch/projeto descartável, restaurar backup/PITR, aplicar `supabase/tests/seed_catalog.sql` conforme o procedimento e conferir amostra relacionada de Viagem → B/Ls → invoices/ledger. Nunca restaurar sobre produção.
- [ ] Registrar tempo, ponto alcançado e limitações como relatório histórico. Rollback operacional: desabilitar workflow e revogar credenciais; não apagar backups existentes sem autorização destrutiva específica.

## 6. Arquivos e contratos previstos

| Área | Donos existentes / novos previstos |
|---|---|
| Auth/MFA/captcha | `src/hooks/useAuth.tsx`, `src/hooks/usePortalAuth.tsx`, páginas públicas do Portal, `supabase/functions/portal-login/`, `portal-invite-activate/`, `portal-password-recovery/`, `_shared/cors.ts`, `_shared/passwordPolicy.ts`, migration nova |
| Observabilidade | `src/lib/telemetry.ts`, `src/lib/telemetryContext.ts`, `supabase/functions/_shared/telemetry.ts`, `_shared/logger.ts`, runners e funções prioritárias |
| Uptime/status | runners listados em M2, helper de heartbeat, `src/components/layout/PortalLayout.tsx`, novo runbook |
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
| M2/M3/M4 | erro, heartbeat perdido, log sintético | alerta production e status sem incidente falso | timestamps, regra acionada, evento sanitizado |
| M6 | PR/branch descartável | ruleset de `main` | checks e bloqueios visíveis |
| M9 | projeto dev/Preview | evento de fixture | payload de rede + painel sem PII |
| M10 | branch/projeto descartável | confirmação de PITR/backups no painel | RPO/RTO, checksum, restore e duração |
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
