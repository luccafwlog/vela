# Issue 710 — Conciliação e execução serviço a serviço

> **Estado (última conferência: 2026-09-23):** Zero Trust Free ativo; projetos Pages `vela-internal` e `vela-portal` existentes sem deployment; ambos têm Access obrigatório em Preview e política que só permite `luccafwlog@gmail.com`. O owner escolheu e configurou manualmente o IdP Cloudflare nos dois apps (conta Cloudflare acessada via Google); MFA permanece desativado. A autenticação/consentimento inicial foi confirmada pelo owner. Ainda falta provar acesso autorizado e negado em deployment Preview real. O owner escolheu Cloudflare Pages como hospedagem final antes do GO-LIVE, mantendo Supabase como backend e Vercel temporária durante validação. DNS/cutover e desligamento dependem de evidência e confirmação operacional.
>
> **Regra de execução:** concluir e aceitar uma frente antes de começar a seguinte. Manter no máximo uma PR de implementação de serviço em andamento; abrir exceção somente para dependência técnica demonstrada e registrar por quê. Revisar o estado remoto novamente no início de cada etapa.

**Origem:** Issue [#710](https://github.com/luccafwlog/vela/issues/710), plano anterior [arquivado como superado](../archive/plans/2026-09-22-issue-710-endurecimento-stack.md) e inventário das PRs #717–#737 consultado em 2026-09-23.

**Objetivo:** reconciliar o que já foi mesclado, o que está apenas em PR, o que existe nos painéis e o que falta provar; então concluir os serviços em sequência, com escopo, custo, critérios de aceite e rollback claros.

**Fora deste plano:** tornar público o status operacional; habilitar MFA; automação de PIX; contratar GitHub Team, PITR ou Log Drains; e remover do Resend o domínio antigo sem decisão específica. A preferência atual é não adicionar custos. Nenhum plano gratuito deve ser presumido adequado para uso comercial sem confirmar os termos vigentes.

## Registro de execução — 2026-09-23

- **Snapshot Cloudflare Pages antes da seleção do IdP (2026-09-23):** o GitHub secret `CLOUDFLARE_PAGES_API_TOKEN` existia e seu valor não foi lido. Os projetos vazios `vela-internal` e `vela-portal` existiam sem implantação. `Restringir pré-visualizações` estava ativo em ambos, com política herdada `Allow Members - Cloudflare Pages`, regra `Include Emails luccafwlog@gmail.com`, MFA desativado e One-time PIN selecionado. O PIN não foi enviado. Estado de login foi atualizado no registro abaixo após a escolha do owner.
- **Provisionamento CI (snapshot anterior, 2026-09-23):** naquele momento faltavam a variável `CLOUDFLARE_ACCOUNT_ID` e o workflow/script ainda estava apenas no worktree; não era possível despachá-lo da `main`. Depois, a variável foi criada. Como os dois projetos já existem, o workflow idempotente os reconhece e deixa inalterados.
- **Acesso Cloudflare (2026-09-23):** por decisão do owner, `Cloudflare` substituiu One-time PIN em ambos os Access apps. Leitura autenticada confirma os destinos `*.vela-internal.pages.dev` e `*.vela-portal.pages.dev`, política herdada `Allow Members - Cloudflare Pages`, include somente `luccafwlog@gmail.com`, MFA da organização desativado e sessão de 24 h. O preview vazio inicialmente levou ao consentimento OAuth; o owner confirmou que concluiu autenticação em ambos os apps. A configuração e o consentimento estão concluídos. Ainda falta validar autorização e negação em deployment real; manter `CLOUDFLARE_PAGES_ACCESS_CONFIGURED` ausente até esse teste controlado.

- **Checkout:** branch local `codex/issue-710-consolidation`, em `69ec749468371135fd69fa9469a5cdd4fd425b9a`, igual a `origin/main`; as únicas mudanças preexistentes neste checkout são a documentação de conciliação iniciada no turno anterior. Nenhum commit ou push foi feito nesta execução.
- **PRs #717–#737:** inventário GitHub atualizado em modo leitura. #717–#718 e #720, #725–#728 e #732 estão mescladas; #721–#724 estão fechadas; #719 permanece aberta e independente; #729–#731 e #733 estão abertas; #734–#737 são drafts empilhadas.
- **Checks do snapshot:** checks principais das #729–#731 e #733 aparecem verdes, mas Supabase Preview foi ignorado em #731 e #733. #734–#736 aparecem com checks principais verdes; Supabase Preview da #737 foi cancelado. Um check ignorado/cancelado não é prova verde.
- **Empilhamento:** #734 tem base atual em `main`; #735 parte de #734; #737 parte de #735. #736 está defasada em dois commits da base #734. O auditor de diffs encontrou sobreposição incremental (não equivalência) com #725–#728 e #732; nenhum draft deve ser mesclado em bloco.
- **Refresh da fila remota (2026-09-23, gh CLI autenticado; nenhuma escrita):** #719 segue PR independente, base `main`, com CI, Supabase Preview e dois previews Vercel verdes; `REVIEW_REQUIRED`, sem aprovação formal. #729 e #730 têm base `main` e CI completo verde, sem review; #731 também está verde exceto `Supabase Preview` ignorado. #733 (Sentry Deno) está verde exceto `Supabase Preview` ignorado. #734 continua draft sobre `main`, CI/Supabase verdes mas Vercel `vela` falha. #735 depende do head atual de #734 e tem o mesmo padrão (Vercel `vela` falha); #736 parte de SHA anterior do #734, Supabase verde e Vercel Portal falha; #737 depende de #735, CI e Vercel verdes, mas Supabase Preview cancelado por limite de branches simultâneas. Nenhuma tem review formal; `mergeable` não significa merge checks prontos. Não abrir novas PRs nem mudar/fechar/rebasear essas branches enquanto Fase 0.5 não definir impacto dos previews e houver conciliação explícita; não mesclar Dependabot sem instrução/revisão conforme plano.
- **Refresh remoto adicional (2026-09-23, gh CLI autenticado, leitura apenas):** #719 permanece independente em `main`, sem review formal; checks CI, Supabase Preview e Vercel estão verdes. #729/#730 mantêm base `main`, CI e ambos Vercel verdes; #731 CI/Vercel verdes, Supabase Preview `SKIPPED`; #733 CI/Vercel verdes, Supabase Preview `SKIPPED`. #734 permanece draft em `main`, `REVIEW_REQUIRED`, CI/Supabase verdes, Vercel `vela` falha. #735 continua empilhada em #734, CI/Supabase verdes, Vercel `vela` falha; #736 parte de base antiga do #734, CI/Supabase verdes, Vercel Portal falha. #737 continua empilhada em #735, CI/Vercel verdes, Supabase Preview `CANCELLED`. O snapshot da lista inclui #738, mas ela pertence à cadeia de apresentação (#719) e fica fora da Issue 710. Não houve comentário, merge, close, rebase ou push. Supabase skipped/cancelled e falhas Vercel impedem declarar previews integralmente validados.
- **Estado dos checks de Dependabot (2026-09-23, gh CLI, leitura):** consulta atual mostra CI e ambos previews Vercel de #729/#730 verdes; #731/#733 também têm CI/Vercel verdes, mas Supabase Preview `SKIPPING`. Isto não prova que a quota esteja recuperada para novas PRs; atualizar o estado antes de publicar.
- **Decisão operacional pendente:** o owner ainda não respondeu se autoriza abrir a PR da migração Cloudflare agora, aceitando um possível check Vercel `rate limited`, ou se prefere esperar. A resposta não autoriza automaticamente promover/deployar em produção. Enquanto aguarda, não fazer push nem criar PR de implementação que acione previews; continuar apenas validação local independente.
- **Triagem estática de dependências (2026-09-23):** #729 atualiza Actions (`checkout`, `setup-node`, `setup-python` v4/v5→v7; Supabase CLI setup v1→v3); CI e previews Vercel atuais estão verdes, mas toca no mesmo workflow `provision-preview-admin.yml` que a branch local Pages modifica, exigindo reconciliar/rebasear essa alteração antes de abrir uma PR única. #730 agrupa 10 dependências de produção e inclui `pdfjs-dist` 4.10→6.3 (major); o código usa `legacy/build/pdf.mjs` e os testes unitários mockam o pacote, portanto CI/build verdes não substituem um teste com PDF real no Preview protegido. #731 agrupa 18 dependências de desenvolvimento (inclui `size-limit` 12→14, `jsdom` 29→30 e upgrades Vite/ESLint); CI e previews Vercel verdes, Supabase Preview foi `SKIPPED`. #733 muda só `@sentry/deno` 10.73→10.75 e transforma o teste de versão exata em validação genérica semver; CI/Vercel verdes, Supabase Preview `SKIPPED`. Nenhuma tem review formal; não houve merge nem alteração remota. Encaminhamento: #729 conciliar com workflow Pages; #730 exigir smoke do PDF no cutover; #731 avaliar em lote após previews Pages; #733 tratar dentro da fase Sentry, sem permitir check Supabase ignorado como evidência de deploy.
- **Limites de deploy observados nas conversas das PRs:** comentários Vercel em #734 e #735 registram `api-deployments-free-per-day` (>100 deploys/dia) para projetos; #736 também teve falha Vercel no Portal. A #737 tem status Vercel verde, mas o comentário Supabase informa Preview ignorada por limite de branches simultâneas do projeto. Portanto, `mergeable=true` não significa Preview funcional nem custo/termos resolvidos.
- **Registro histórico do gate de hospedagem (2026-09-23):** os termos da Vercel Hobby limitam o uso pessoal/não comercial; o owner escolheu migrar para Cloudflare Pages antes do GO-LIVE, mantendo Vercel temporariamente como fallback. Essa decisão escolhe o destino, mas não resolve sozinha os limites atuais de Preview nem autoriza novo custo. Ver o gate operacional atual registrado acima; não reutilizar esta fotografia de preço como cotação vigente.
- **Achados para as fases de segurança:** `usePortalAuth` ainda define identidade Sentry com `customer_id`; os quatro handlers públicos de login/recuperação/ativação/troca de email não aparecem no contrato atual de instrumentação Edge. O helper do Upstash aceita cabeçalhos de IP sem prova de proxy confiável, e um `allowed` do Redis pode prevalecer sobre bloqueio persistido no Supabase. O script de backup entrega ao processo AWS CLI o ambiente completo, incluindo segredos não necessários ao upload; também não há `pg_dump`/`pg_restore` no PATH observado nem tarefa agendada configurada.
- **Achados para backup:** credenciais R2 expostas ainda exigem rotação antes de uso; a recuperação da chave AES no gerenciador de senhas não foi confirmada. O arquivo exportado contém somente o schema `public`, não os schemas gerenciados Auth nem os objetos do Supabase Storage; não representa sozinho um backup completo do projeto.
- **Decisão de hospedagem (owner, 2026-09-23):** migrar Vela e Portal para Cloudflare Pages antes do GO-LIVE; manter Supabase e suas branches por PR. A Vercel não será a hospedagem final. Seu uso Hobby continua sujeito à restrição de uso pessoal/não comercial; Cloudflare DNS/proxy diante da Vercel não resolve essa restrição. Não criar novo deploy Vercel de produção como parte da migração.
- **Estratégia de migração aprovada:** validar builds/Previews Pages conectados ao Supabase isolado por PR, incluindo autenticação, roteamento das duas SPAs, headers/CSP, CORS, PostHog e observabilidade. Preservar produção e DNS atuais até a validação. Depois preparar DNS Cloudflare completo e, em janela separada, fazer cutover de um domínio por vez diretamente para Pages, sem empilhar Cloudflare Proxy sobre Vercel como solução final. Não mover o backend Supabase nem assumir Workers pagos; qualquer função de servidor nova exige reavaliar custo.
- **Política de acesso observada nos projetos Vercel (2026-09-23):** em `vela` e `fwlog-portal`, `Require Log In` está habilitado em Deployment Protection (Standard Protection). O owner pediu manter o comportamento existente; portanto previews Pages devem ser privados. O registro anterior de que o owner escolheu previews públicos foi inferência equivocada e foi removido. Cloudflare Pages oferece proteção Access nativa para Preview deployments. No painel autenticado, Workers & Pages continua sem projetos e mostra US$ 0,00 de uso faturável no período `Sep 22–Oct 22`; o onboarding oferece Free, US$ 0/licença/mês até 50 licenças, e Standard a US$ 7/licença/mês. O owner autorizou Zero Trust Free e autenticação pela identidade da conta Cloudflare usada no login Google. A documentação atual da Cloudflare informa que organizações Zero Trust novas recebem Cloudflare como IdP padrão, restrito aos membros da conta; não exige OAuth Google separado. O owner autorizou aceitar os termos e ativar Free sem overage. A tentativa inicial falhou com validação inconsistente, mas após recarregar e clicar novamente o painel confirmou `Plano Zero Trust Free`; o controle separado de overage estava desmarcado no checkout antes do envio. O painel Zero Trust mostra IdP Cloudflare com `Restringir a membros da conta` ativado. Isso resolve o gate de assinatura/IdP, não a configuração ou prova de Access nos projetos Pages.
- **Automação Pages implementada apenas localmente:** worktree `C:\Users\Lucca\Downloads\Vela-cloudflare-pages-migration`, branch `codex/cloudflare-pages-migration`; empacotamento das duas SPAs, workflow de preview `workflow_run` aguardando Supabase Preview e job isolado de publicação Pages. A publicação exige `vars.CLOUDFLARE_PAGES_ACCESS_CONFIGURED == 'true'`; a variável ainda não existe e só poderá ser criada após os testes de Access em ambos projetos. Token Cloudflare fica somente nos jobs confiáveis de publicação/limpeza. Validações posteriores no worktree: 15 testes específicos, lint, typecheck, build, build+staging Pages, suíte serial completa (649 arquivos aprovados, 28 ignorados; 3.512 testes aprovados, 135 ignorados), `docs:check` e `git diff --check` passaram. Workflows ainda precisam de validação pelo GitHub Actions; nenhum deployment, domínio ou DNS foi alterado.
- **Limpeza de previews e hardening de workflows (2026-09-23):** Cloudflare Pages não permite excluir o deployment mais recente de uma branch, mesmo com `force`; então a automação retém o mais recente em cada projeto e apaga apenas históricos anteriores. O URL hash retido pode continuar respondendo; não se promete invalidação completa. `PR_HEAD_REF` é validado por padrão estrito antes das chamadas Supabase autenticadas nos dois workflows confiáveis; publish e cleanup compartilham concorrência por PR para serializar deploy/fechamento. Teste novo cobre retenção do deployment único; testes/YAML/docs desta correção ainda não foram executados. `git diff --check` passou; nenhuma publicação ocorreu. Fonte: [Cloudflare — excluir previews](https://developers.cloudflare.com/pages/configuration/preview-deployments/#delete-preview-deployments).
- **Revisão estática posterior (2026-09-23):** encontrou e corrigiu em `scripts/cloudflare-pages-cleanup.mjs` o escopo inválido de `newestDeploymentFirst`, que estava dentro do laço de paginação e não estaria acessível no ponto de ordenação. A correção é local no worktree de migração; testes/scripts não foram executados nesta máquina, portanto runtime continua não comprovado. Repetir `git diff --check` após a correção e executar os testes contratuais somente no CI isolado antes de publicar.
- **Previews multi-SPA (2026-09-23):** a revisão encontrou que `/portal` no artefato de Preview Vela redirecionaria para o Portal de produção. O staging agora aceita somente `portalfwlog.com.br` ou origem `*.vela-portal.pages.dev`; o workflow publica ambos os projetos no alias `pr-<número>` ([aliases Cloudflare](https://developers.cloudflare.com/pages/configuration/preview-deployments/#preview-aliases)), usa a origem do Portal da mesma PR e a limpeza filtra esse alias. Adicionado contrato para rota correspondente e rejeição de origem não autorizada sem apagar saída anterior; o ID Cloudflare real foi removido dos fixtures. `node --check` passou nos helpers/testes e `git diff --check` passou nos arquivos rastreados; a suíte de testes e validação YAML não foram executadas. Não foi criada publicação real; o `pages.dev` e Access ainda precisam de configuração/prova.
- **Ações externas observadas nesta atualização:** inspeção autenticada dos settings de Deployment Protection dos dois projetos Vercel e do painel Cloudflare; o owner ativou manualmente Zero Trust Free depois de recarregar o checkout. Ambos os projetos Vercel estão com `Require Log In` habilitado; Cloudflare segue sem projetos Pages. Nenhuma zona DNS, projeto Pages, Access, token Cloudflare Pages ou secret GitHub foi criado/alterado. Configuração, deploys e PRs aguardam seus gates próprios.
- **Tentativa de ativar Zero Trust Free (2026-09-23):** o owner autorizou aceitar os Termos e ativar exclusivamente o plano Free, sem overage. No checkout, o plano era exibido como US$ 0/mês; a caixa dos Termos foi marcada e a autorização separada de cobrança acima dos limites permaneceu desmarcada. O botão `Ativar` repetiu a validação “Você precisa concordar com os termos acima para continuar” mesmo com a caixa visualmente marcada. Nenhuma ativação foi confirmada; não foi autorizado overage e não houve alteração de pagamento. Não contornar a validação: Zero Trust/Access e qualquer Preview protegido ficam pendentes até resolver essa falha no painel.
- **Ativação Zero Trust confirmada pelo owner e painel (2026-09-23):** após recarregar e clicar em `Ativar`, a página de visão geral passou a mostrar `Plano Zero Trust Free`. No checkout, antes do envio, a autorização de cobrança por excedente estava desmarcada. O painel Zero Trust agora mostra um IdP `Cloudflare`; na tela de edição, `Restringir a membros da conta` aparece `Ativado`, coerente com o login pela conta Cloudflare já acessada via Google. No Workers & Pages, não há projetos e o uso faturável mostra US$ 0,00 no período visível. Isto resolve o gate de assinatura/IdP, não a configuração ou prova de Access dos projetos Pages.
- **Gate Pages — token CI (2026-09-23):** para a automação provisionar os dois projetos Pages sem publicar placeholder, falta criar e salvar como GitHub Actions repository secret `CLOUDFLARE_PAGES_API_TOKEN` um token Cloudflare Account API com somente `Cloudflare Pages: Edit` na conta correta. Na interface autenticada, a configuração foi preenchida e revisada: nome `Vela Pages CI/CD`, conta `Luccafwlog@gmail.com's Account`, política `Pages Write` (permissão de edição Pages), expiração em 23/09/2027 (1 ano), IP filtering deixado em todos os endereços para suportar runners dinâmicos GitHub. A tela está em `Revisar token`; o owner deve clicar `Criar token` e copiar o segredo diretamente para GitHub. O segredo não foi gerado nem transmitido aqui. Esse escopo permite gerenciar/criar e excluir recursos Pages da conta, mas não concede DNS, R2, Workers, Access ou billing. Só iniciar provisioning após confirmar que o secret foi salvo e verificar que as opções de política Access estão disponíveis para ambos projetos.
- **Refresh da fila remota (2026-09-23, gh CLI autenticado, leitura apenas):** #719 e #729–#730 têm todos os checks reportados verdes, mas seguem `REVIEW_REQUIRED`; #731 e #733 também têm seus demais checks verdes, porém `Supabase Preview` está `SKIPPED`. #734–#736 ainda falham nos previews Vercel (Vela em #734/#735; Portal em #736); #737 tem `Supabase Preview` `CANCELLED`. #734–#737 continuam drafts empilhadas; #734 requer review formal. #738 (base `codex/apresentacao-vela`) não pertence à Issue 710, e tem `Supabase Preview` `CANCELLED`; permanece fora do escopo. Nenhuma escrita remota foi feita. Não tratar skipped/cancelled como sucesso nem avançar Dependabot antes da conciliação planejada.

## 1. Regras para reduzir confusão e risco

1. O código mesclado, configuração no provedor e comportamento observado em runtime são três estados distintos. Fechar um só quando houver evidência própria.
2. Antes de cada frente, conferir diff, comentários, base, checks e estado atual da PR/painel; os inventários abaixo são um retrato de 2026-09-23 e podem envelhecer.
3. Não mesclar PR empilhada com base obsoleta como se fosse unidade pronta. Extrair somente o escopo aceito, recriá-lo a partir da main atual e preservar a PR original até reconciliar todos os arquivos.
4. Preferir uma PR por serviço/fatia, com checklist e evidência numa descrição curta. Agrupar atualizações de dependências compatíveis numa janela de manutenção; não misturar serviço, DNS e deploy na mesma revisão.
5. Um CI verde prova os checks executados, não configuração de painel, deploy de Edge Function, uso real, entrega de e-mail, backup ou restauração.
6. A afirmação de que a produção não contém dados reais permite flexibilidade na evolução do banco; não elimina risco de custo, exposição de credenciais, indisponibilidade, privacidade ou perda de capacidade de restauração.
7. Não colocar segredos, chaves, tokens, endereços privados desnecessários ou payloads de clientes em PR, documentação, comandos, screenshots ou evidências.

## 2. Inventário consolidado

Estado observado nos painéis e no GitHub até 2026-09-23. Antes de executar cada linha, atualizar números, plano, cota, checks e configuração diretamente na fonte.

| Frente | O que existe | Custo / limite conhecido | O que ainda não está comprovado |
|---|---|---|---|
| GitHub | Plano Free; Dependabot semanal e CI atual. PR #720 mesclada. | Sem upgrade aprovado; vários controles avançados de segurança não estão disponíveis neste repositório privado no plano atual. | Não há CodeQL, Dependency Review, secret scanning, push protection ou ruleset de branch. Registrar limite, não prometer cobertura equivalente. |
| Vercel | Vela e Portal hospedados em Hobby. | US$ 0 observado; termos do Hobby descrevem uso pessoal/não comercial. Pro aparecia a US$ 20/mês no momento da consulta; preço e elegibilidade devem ser confirmados antes de qualquer decisão. [Preços](https://vercel.com/pricing) · [termos](https://vercel.com/legal/terms) | Compatibilidade do plano com o uso comercial do produto; previews também tiveram limites/rate limit. É um gate para deploy de produção, não algo a contornar. |
| Supabase | Projeto existente no plano Pro; backup diário nativo com retenção de 7 dias observada. PRs #728/#732 mescladas; migration 076 e secrets de rate limit foram reportados como configurados. | Última fatura observada: US$ 25; não é previsão garantida da próxima fatura. PITR: cerca de US$ 100/mês; Log Drains: cerca de US$ 60/projeto/mês, ambos fora da preferência de custo zero. [Preços](https://supabase.com/pricing) | Confirmar fatura/uso atual; deploy das Edge Functions; comportamento integrado das funções e rate limit; retenção efetiva dos logs. Não contratar PITR/Log Drains neste roteiro. |
| Registro.br | Continua sendo o registrador e o painel de titularidade/renovação dos domínios .br. | Custo e vencimentos atuais não foram conferidos neste inventário; manter as renovações em dia. | Acesso do titular/contato administrativo ou técnico será necessário para delegar os servidores DNS à Cloudflare. Cloudflare assumir o DNS não transfere registro, titularidade nem renovação. [Ajuda oficial](https://www.registro.br/ajuda/tutoriais-administrativos/) |
| Cloudflare DNS | Zonas vela.app.br e portalfwlog.com.br pendentes; nameservers ainda não cortados. | DNS/conta Free observados; custo e elegibilidade devem ser confirmados no painel. | Inventário completo de A/AAAA/CNAME, TXT, MX, SPF, DKIM e DMARC antes do cutover; nenhum domínio deve ser trocado às cegas. |
| Cloudflare R2 | Bucket privado vela-database-backups criado, lifecycle de 90 dias, sem objetos no último snapshot. | US$ 0 observado com bucket vazio; armazenamento e operações são medidos. [Preços](https://developers.cloudflare.com/r2/pricing/) | Credenciais apareceram em saída anterior e devem ser tratadas como comprometidas; não usar até rotação/revogação. O script exporta somente o schema public, não Auth/Storage. Backup local, upload, alerta, integridade e restauração ainda não foram provados. |
| Upstash | Banco isolado vela-rate-limit no Free; PR #728 mesclada. | 29/500 mil comandos observados no snapshot; Free pode limitar/falhar ao atingir cota. Token padrão tem privilégios amplos dentro do banco isolado, conforme decisão anterior para manter custo zero. [Preços](https://upstash.com/pricing/redis) | Confirmar runtime: limiar, janela, TTL, concorrência, origem confiável do IP, fallback e comportamento ao esgotar quota. |
| Sentry | Plano Developer; dois projetos. PRs #726 e #732 mescladas. | US$ 0 observado dentro da cota vigente. [Preços](https://sentry.io/pricing/) | Remover o customer_id estável do contexto do Portal; revisar eventos/identidade, alertas e telemetria Edge. #734 tem trabalho candidato; #733 atualiza @sentry/deno. Nenhuma PR substitui prova de runtime. |
| PostHog | Projeto EU criado; base de feature flags mesclada em #727; flag de comunicações em 0%. | Free no snapshot, sem eventos recebidos; quotas mudam. [Preços](https://posthog.com/pricing) | #735 candidata a eventos de fatura e enforcement server-side; definir allowlist sem PII e provar ingestão e flag antes de rollout. |
| Better Stack | Conta Free; painel mostrou zero monitores e heartbeats; sem status page pública. | US$ 0 observado; página Free é apresentada para projetos pessoais, portanto confirmar adequação comercial e limites antes de depender dela. [Preços](https://betterstack.com/pricing) | Criar monitores/heartbeats privados, validar URL-secretas e alertas para o único destinatário aprovado. Não publicar status page. |
| Resend / e-mail | Conta Free; domínio antigo transhippingdesk.com.br aparecia verificado, sem envios no snapshot. | US$ 0 observado e limites de envio sujeitos ao plano. [Preços](https://resend.com/pricing) | Separar recebimento de suporte e envio transacional. Não apagar o domínio antigo do Resend sem decisão; limpeza de domínios antigos no ImprovMX foi autorizada, mas sua conclusão não foi provada. |
| Windows → R2 | Requisito aprovado: backup diário às 09:00, após login; se o PC estava desligado, executar quando voltar a iniciar sessão. | Sem serviço adicional pretendido; R2 pode gerar cobrança por uso. | Credential Manager, chave de criptografia com cópia no gerenciador de senhas existente, agendador, execução real, alertas, retenção e teste de restore ainda pendentes. Se o PC ficar desligado vários dias, o agendador não recria cópias diárias retroativas. |
| Cloudflare Turnstile | Código candidato somente na PR #737; sem sitekey/secret comprovados. | Turnstile oferece plano Free; confirmar condições e limites atuais. [Planos](https://developers.cloudflare.com/turnstile/plans/) | Configuração por domínio, secrets, testes de desafio e rollout seguro. MFA continua fora do escopo. |

## 3. Reconciliação das PRs existentes

Não executar merges, closes, rebase ou exclusão de branches nesta fase de planejamento. Na primeira tarefa de execução, refazer o inventário usando estado atual da GitHub API/UI, incluindo reviews, conversas, commits, checks, base e relações entre branches.

| PR(s) | Estado no snapshot | Tratamento proposto |
|---|---|---|
| #717 | Mesclada; continha o plano amplo anterior. | Manter como histórico. O plano anterior foi movido para o arquivo com nota editorial; este documento passa a ser o plano vivo canônico. |
| #718 | Mesclada; remediação da fronteira Portal relacionada. | Preservar. Não reabrir escopo já entregue; validar apenas dependências que o roadmap exigir. |
| #719 | Aberta; deck/apresentação. | Não pertence à execução serviço a serviço da Issue 710. Manter isolada até decisão de destino; não misturar com PR de serviço. |
| #720 | Mesclada; Dependabot. | Preservar. A manutenção futura não deve duplicar configuração que já está em main. |
| #721–#724 | Fechadas sem merge; atualizações de dependências anteriores. | Manter fechadas como histórico. Não ressuscitar branches. |
| #725–#728 | Mescladas; exportação R2, Sentry, base PostHog e rate limit Upstash. | Preservar. Isso é fundação/código, não prova de backup, telemetria, analytics ou rate limit em funcionamento. |
| #729–#731 | Abertas; atualizações de dependências. | Fazer uma única triagem conjunta de compatibilidade e checks. Agrupar atualizações compatíveis num lote de manutenção; separar qualquer bump com impacto de runtime. Não abrir PR duplicada para a mesma atualização. |
| #732 | Mesclada; telemetria Edge com privacidade. | Preservar e verificar o deploy de Supabase separadamente do deploy Vercel. |
| #733 | Aberta; atualização @sentry/deno. | Revisar junto da fatia Sentry/Edge, sem assumir que esteja incorporada por #732. Decidir se entra no lote de dependências ou na única PR Sentry, conforme compatibilidade real. |
| #734 | Draft amplo: Sentry/privacidade, logs, heartbeats, Upstash, runner Windows. | Não mesclar nem simplesmente rebasear o pacote. Usar o diff como fonte para mapa de arquivos e separar material nas fatias Sentry, Upstash, Better Stack e backup. |
| #735 | Draft PostHog; baseado em #734. | Extrair apenas eventos/flags para uma PR PostHog nova baseada na main atual, depois do gate de privacidade. |
| #736 | Draft de telemetria cron; branch baseado em #734 e defasado no snapshot. | Reconciliar arquivos com #734 e #732; incorporar o que for necessário na fatia do serviço dono, sem PR paralela de telemetria. |
| #737 | Draft Turnstile; empilhada em #735. | Extrair Turnstile como fatia independente baseada na main atual. Não carregar alterações PostHog da base por acidente. |

### Procedimento para aposentar os drafts empilhados

1. Gerar inventário de arquivos/commits de #734–#737 contra a main atual e etiquetar cada mudança com um único serviço dono.
2. Comparar sobreposição entre branches e alterações já mescladas em #725–#728 e #732; descartar duplicações somente depois de confirmar o equivalente em main.
3. Abrir/atualizar apenas a PR da primeira fatia aprovada. Não iniciar simultaneamente as outras fatias.
4. Quando todo o conteúdo útil de uma draft estiver incorporado ou explicitamente rejeitado, apresentar a conciliação e pedir confirmação antes de fechá-la. Não apagar branches/commits como limpeza automática.
5. Conservar links entre PR antiga, PR substituta e critérios de aceite no corpo/registro da PR substituta.

## 4. Ordem do roadmap e critérios de saída

Uma fase só avança quando os critérios da fase anterior forem atendidos, ou quando o owner aceitar explicitamente um bloqueio/risco residual. Mudanças que acionem deploy de produção aguardam o gate Vercel da Fase 0.

### Fase 0 — Governança, baseline e PR desk

- Congelar novas frentes paralelas e adotar este roteiro como fila única.
- Refazer o estado das PRs #717–#737, comentários, checks, deploy previews, commits-base e quais mudanças de #734–#737 já existem em main.
- Fechar reconciliação documental: plano antigo arquivado como superado, este como vivo; vincular PRs fonte/destino sem modificar as PRs.
- Verificar compatibilidade comercial do Vercel Hobby com o produto. Opções: comprovar elegibilidade pelos termos atuais, aprovar plano apropriado com custo, ou escolher hospedagem compatível. Sem decisão, não promover novas mudanças à produção.
- Confirmar plano e limites comerciais do Better Stack Free antes de depender dele.
- Atualizar um registro por serviço com responsável, custo observado, limite, nome/localização do segredo (nunca seu valor), ambiente, estado de código/configuração/runtime e decisão pendente.

**Saída:** nenhum PR draft é tratado como entrega; as PRs existentes estão classificadas; gates de custo/termos e deploy estão claros. Este plano não autoriza fechar PRs nem contratar/alterar planos.

### Fase 0.5 — Cloudflare Pages como hospedagem final

**Atualização de configuração remota (2026-09-23):** dois projetos vazios
(`vela-internal`, `vela-portal`) existem no Cloudflare, sem deployment, domínio
customizado ou integração Git. A restrição de Preview está ativa em ambos.
As duas apps Access herdam regra `Allow Members - Cloudflare Pages` que inclui
apenas `luccafwlog@gmail.com`; MFA está desativado, e Cloudflare é o único IdP
selecionado em ambos após decisão explícita do owner. O owner informa ter
concluído a autenticação/consentimento nos dois apps. Falta provar em deployment
real tanto o acesso permitido quanto a negação de identidade não autorizada. O GitHub
secret `CLOUDFLARE_PAGES_API_TOKEN` foi confirmado existente sem ler seu valor,
e `CLOUDFLARE_ACCOUNT_ID` está criada como Actions Variable. A variável-gate
`CLOUDFLARE_PAGES_ACCESS_CONFIGURED` continua ausente até o teste após deployment
controlado. O workflow de provisionamento local reconhecerá os dois projetos e
não os modificará.

**Andamento (2026-09-23):** em worktree isolado, estão implementados o
empacotamento reproduzível dos dois SPAs, redirects/fallback, headers de
segurança/cache e contrato de cópia dos arquivos públicos sem
sourcemaps/manifesto interno. O CI foi atualizado para buildar os dois artefatos
e executar os testes contratuais. A automação `workflow_run` foi implementada no
worktree: aguarda Supabase Preview verde, rejeita produção, fornece ao build
da PR somente URL/chave pública da branch e separa o job de publicação (token
Pages não é entregue ao código da PR). A publicação fica bloqueada por padrão e
exige Access validado antes de liberar o job. Nenhum deployment, domínio, DNS ou
tráfego de produção foi criado/alterado nesta atualização; os projetos vazios e
Access foram configurados conforme o registro acima. Neste checkout isolado,
15 testes específicos de provisionamento/staging/ambiente/limpeza, lint,
typecheck, build, build+staging Pages, `docs:check` e `git diff --check`
passaram. A suíte integral também passou em modo serial: 649 arquivos aprovados,
28 ignorados; 3.512 testes aprovados e 135 ignorados. Não há validação GitHub
Actions nem runtime com artefato e login em preview implantado ainda não foi
validado. Portanto, a fase não está aceita.

- Esta fase foi priorizada pelo owner antes de novas frentes que gerariam Preview na Vercel Hobby. Manter a produção/domínios sem mudança enquanto a alternativa é testada em URLs temporárias.
- Inspecionar o build executável e escolher uma configuração reproduzível para duas superfícies no mesmo repositório: Vela interno e Portal. Preservar roteamento por host, refresh em rotas React Router, páginas raiz, assets, headers de segurança, CSP e política de cache. Não presumir que `vercel.json` funciona no Pages.
- Configurar CI/Pages sem publicar domínio de produção: Node 24, `npm ci --legacy-peer-deps`, build e saída estática. Medir limites do Free (inclusive builds concorrentes/mensais) e confirmar que a solução não introduz Workers pagos ou cobrança inesperada.
- Construir automação GitHub para cada Preview aguardar a branch Supabase daquela PR ficar pronta, obter somente URL e chave pública correspondentes, publicar Preview protegido, informar URL/check na PR e limpar/invalidar publicação quando PR fechar. Segredos de administração do Supabase nunca entram no bundle. A integração atual Supabase↔Vercel não é presumida compatível com Pages; investigar APIs/CLI oficiais e tratar corrida, reexecução, PR obsoleta, cancelamento, forks sem secrets e falha de provisionamento.
- A configuração do IdP e da política Access foi concluída manualmente pelo owner nos dois projetos. Após uma publicação controlada, testar sessão autorizada e não autorizada nos previews. Só depois definir `CLOUDFLARE_PAGES_ACCESS_CONFIGURED=true`. A política protege deployment previews; o hostname principal `*.pages.dev` e domínios customizados exigem proteção própria, conforme [Customize preview deployments access](https://developers.cloudflare.com/pages/configuration/preview-deployments/) e [Enable Access on `*.pages.dev`](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-pagesdev-domain). Não publicar previews antes de configuração e teste.
- Testar login interno e Portal, redirects/links do Supabase Auth, Edge Functions/CORS, refresh de sessão, Realtime, rotas profundas, Sentry, PostHog, CSP, Web Vitals/analytics alternativos e fallback/rollback. Atualizar allowlists de origens só com padrões restritos e somente após confirmar os hosts reais dos Previews.
- Manter Vercel como fallback temporário apenas pelo tempo necessário à validação/cutover, registrando a exposição residual do plano Hobby; não promover mudanças de produção nela. Remover integração/deploy Vercel e SDKs/telemetria específicos somente depois de comprovar equivalência operacional e aprovar o corte final.

**Aceite:** dois builds Pages reproduzíveis; Preview protegido por PR conectado à branch Supabase correta; fluxo funcional completo de ambas as SPAs; métricas/telemetria revisadas; limites/custo Free confirmados; rollback documentado. Sem alteração de DNS ou tráfego de produção nesta fase.

### Fase 1 — GitHub e dependências

- Inspecionar #729–#731 e #733, incluindo notas de versão, arquivos de dependências, alterações transitivas, compatibilidade Deno/navegador e verificações atuais.
- Consolidar atualizações compatíveis em um único lote revisável quando a ferramenta permitir sem reescrever ou fabricar o trabalho gerado pelo Dependabot; se isso não for seguro, revisar os PRs originais numa única janela curta, mantendo cada alteração restrita.
- Manter a configuração Dependabot atual; registrar explicitamente lacunas do plano Free, sem ativar Team nem tornar o repositório público.
- Corrigir previews bloqueados/rate-limited apenas se houver caminho suportado sem upgrade; nunca interpretar check ignorado/cancelado como verde.

**Aceite:** um conjunto de atualizações aprovado e verificável em CI; sem bump duplicado; lista de limites de segurança documentada. Não mesclar sem autorização existente/específica para merge.

### Fase 2 — Sentry e privacidade

- Usar #734/#736 como fontes para a única fatia Sentry e avaliar #733.
- Remover do contexto Sentry do Portal o customer_id estável, evitando substituí-lo por outro identificador persistente equivalente. Confirmar se o estado atual em main ainda envia essa identidade.
- Revisar contextos, breadcrumbs e payloads de Vela/Portal/Edge para PII; assegurar separação dos projetos e ambientes.
- Instrumentar os handlers públicos de login, recuperação, ativação e troca de email que faltam no contrato Edge, se a revisão confirmar que não há instrumentação equivalente. Confirmar DSNs/secrets e deploy Edge no Supabase separadamente de Vercel. Testar um evento sintético sem dado de cliente e confirmar alerta privado acionável.

**Aceite:** inspeção do evento recebido sem customer_id/PII proibida; eventos aparecem no projeto/ambiente certo; alerta roteado ao destinatário aprovado; deploy/runtime Edge provado. Sem publicar dados de cliente em eventos de teste.

### Fase 3 — Upstash rate limit

- Auditar a implementação mesclada #728 e o percurso de secrets/configuração Supabase; nenhuma chave deve aparecer nos artefatos.
- Em Preview controlado, provar bloqueio ao atingir 10 erros para mesma origem confiável + CNPJ por 5 minutos, separação de baldes, janela/TTL, concorrência e reset.
- Antes de alterar a política, decidir e documentar se Supabase e Redis devem ambos permitir a tentativa ou se Redis substitui a decisão persistida quando saudável. A implementação atual permite que Redis `allowed` prevaleça sobre bloqueio do Supabase; não corrigir essa semântica silenciosamente.
- Testar falha do Redis, indisponibilidade/quota, entrada inválida e fallback. Validar que o IP vem de proxy confiável no caminho real; não confiar cegamente em header que o cliente possa forjar. Testar também se a checagem distribuída ocorre antes de trabalho custoso de lookup do convite.
- Documentar o trade-off confirmado: Free evita assinatura, mas tem cota e token com privilégio amplo no banco isolado; não elevar escopo do token.

**Aceite:** testes funcionais no Preview e observação de runtime aprovados; plano de comportamento ao esgotar quota compreendido. Produção só após critérios e gate de deploy aprovados; rollback documentado.

### Fase 4 — PostHog EU

- Depois de fechar a revisão de privacidade Sentry, extrair #735 para uma PR PostHog limpa.
- Definir allowlist mínima de eventos, começar por evento agregado de fatura visualizada; excluir nome, e-mail, CNPJ, customer_id, invoice IDs, conteúdo financeiro, gravação de sessão e autocapture não necessário.
- Provar comportamento da flag de comunicações no servidor e no cliente, default desligado e falha fechada; 0% de rollout até nova decisão.
- Verificar residência do projeto na UE, quota e evento sintético com dados inventados.

**Aceite:** apenas eventos autorizados chegam ao projeto EU; nenhuma identidade ou atributo de cliente proibido; flag não habilita comunicação por acidente; custo/limites permanecem no esperado.

### Fase 5 — Better Stack privado

- Usar a fatia de #734 para criar monitores privados do Vela e Portal e os quatro heartbeats previamente aprovados: portal-daily-digest, alerts-detector, demurrage-dunning e customer-communication-auto-runner.
- Não criar status page pública. Um serviço de monitoramento não garante que o job rode; heartbeat confirma que recebeu ping no contrato/frequência especificados.
- Verificar endpoints, intervalo, timeout, alertas de falta/falha, URL-secretas e destinatário único sem expor as URLs. Não enviar teste real a clientes.
- Validar se Free pode ser usado pelo produto comercial; se não, parar e apresentar opções de custo antes de configurar dependência operacional.

**Aceite:** checks internos detectam indisponibilidade e ausência de heartbeat; teste de alerta chega ao destinatário autorizado; nenhuma página pública; limite/plano registrado.

### Fase 6 — Backup diário criptografado PC → R2

- Primeiro rotacionar/revogar as credenciais Cloudflare/R2 expostas em saída anterior e verificar escopo restrito ao bucket privado; manter segredos fora do relatório. Não reutilizar os valores que o usuário havia salvo.
- Confirmar que a chave de criptografia é recuperável pelo gerenciador de senhas existente além do Credential Manager; definir identificação/versão e procedimento de restore antes do primeiro backup. Se a chave anterior não puder ser recuperada, não prometer restauração de arquivos cifrados antigos; começar uma cadeia com nova chave e registrar isso.
- Ajustar o script para o processo AWS receber apenas as variáveis de que precisa para acessar R2, nunca a URL do banco ou a chave AES. Atualizar o README que ainda descreve o dry-run como semanal para refletir a cadência diária aprovada.
- Localizar/instalar os clientes PostgreSQL compatíveis (`pg_dump`/`pg_restore`) e validar a carga segura de segredos para o Task Scheduler sem argumentos, arquivos do repositório ou logs com valores secretos.
- Implementar Task Scheduler às 09:00, após login, com execução ao iniciar sessão se o horário foi perdido. Não guardar senha do Windows. Se a máquina ficou desligada, executar uma cópia na volta, não simular cópias dos dias ausentes.
- Fazer uma primeira cópia criptografada de produção sem imprimir payload/segredos; confirmar upload, tamanho, checksum, data, permissões privadas e regra de retenção de 90 dias. Registrar claramente que esse artefato cobre `public`; Auth e arquivos do Storage permanecem cobertos por outros procedimentos/limites, não por esse dump R2.
- Restaurar em destino descartável, verificar legibilidade/consistência e registrar tempo/procedimento. O bucket vazio não é ainda um backup.
- Só então ligar heartbeat privado para sucesso/falha/ausência de execução; custos de R2 continuam variáveis pelo uso.

**Aceite:** uma execução automática observada, objeto privado e criptografado confirmado, restauração independente bem-sucedida, alertas testados e credenciais rotacionadas. Nunca apagar backups para liberar espaço sem confirmar política e restore.

### Fase 7 — Cloudflare DNS e cutover para Pages, um domínio por janela

- Pré-requisito: aceite completo da Fase 0.5, inventário DNS atual e restore R2 provado. No Registro.br, confirmar titularidade, acesso do contato administrativo/técnico, vencimento/renovação, nameservers atuais e eventual DNSSEC/registro DS. O Registro.br permanece responsável pelo registro .br e renovação; Cloudflare será DNS autoritativo e hosting de borda após delegação/cutover. [O contato administrativo pode alterar os servidores DNS](https://www.registro.br/ajuda/tutoriais-administrativos/).
- Registrar/exportar a zona atual e todos os registros necessários nos provedores, inclusive A/AAAA/CNAME, TXT, MX, SPF, DKIM e DMARC; preencher e conferir primeiro a zona Cloudflare completa.
- Preparar e revisar a zona completa antes do cutover. Conferir destinos Cloudflare Pages, verificação dos domínios, Supabase/CORS e todos os registros; não copiar apenas o A do apex. Manter email e serviços não-web DNS-only. Após a migração, não manter proxy Cloudflare empilhado diante da Vercel como arquitetura final.
- Com a zona pronta e Pages validado, usar o painel do Registro.br para delegar primeiro vela.app.br aos nameservers exatos fornecidos pela Cloudflare; tratar DNSSEC/DS corretamente se estiver ativo. Observar resolução, TLS, login, APIs, assets, e-mail e logs por pelo menos 24 horas. Não usar cache no Portal/APIs/auth sem teste explícito.
- Só depois de aceite do primeiro domínio e nova confirmação operacional, repetir a preparação e delegação pelo Registro.br para portalfwlog.com.br separadamente. Preservar opção de rollback para nameservers e registros anteriores.
- WAF não substitui controles no endpoint Supabase nem Turnstile.

**Aceite:** cada domínio responde com certificados e fluxos de login/API válidos; e-mail segue funcionando; registros comparados com baseline; rollback testável. Nenhum cutover em lote dos dois domínios.

### Fase 8 — Recebimento de e-mail de suporte

- Após a zona portalfwlog.com.br estar autoritativa e estável, desenhar alias suporte@portalfwlog.com.br encaminhado a importacao@fwlog.com.br, verificando o endereço de destino e fluxo real de recebimento.
- Confirmar MX e comportamento com os provedores existentes antes de ativar Cloudflare Email Routing; não substituir registros de saída Resend inadvertidamente.
- Executar a remoção autorizada dos domínios antigos no ImprovMX somente depois de confirmar que ainda estão lá e que não há uso. A autorização não abrange apagar domínio antigo no Resend.
- Definir em decisão separada quais endereços de envio, From/Reply-To, conteúdo, destinatários, SPF/DKIM/DMARC e processamento de respostas serão usados. Não enviar campanhas ou e-mails a clientes neste roteiro.

**Aceite:** mensagem externa de teste chega ao destino interno e resposta/erro é entendida; nenhum envio transacional foi habilitado sem política aprovada; DNS anterior preservado para rollback.

### Fase 9 — Turnstile e perímetro de login

- Extrair #737 como PR independente baseada na main atual, sem mudanças PostHog vindas da base empilhada.
- Criar sitekeys por ambiente/domínio permitido; armazenar secrets no provedor correto; validar token no servidor/Edge, não apenas no navegador.
- Testar aprovação, reprovação, token expirado/reutilizado, timeout, indisponibilidade, Preview e usuários legítimos; definir o comportamento de falha antes do rollout para não bloquear todos nem ignorar abuso silenciosamente.
- Ativar inicialmente em Preview; rollout de produção exige critérios de aceite e domínio já sob Cloudflare, sem depender de um novo deploy Vercel Hobby.

**Aceite:** desafio não pode ser ignorado por chamada direta à API; autenticação continua acessível a usuário legítimo; telemetria de falhas sem dados pessoais excessivos. MFA permanece excluído.

### Fase 10 — Logs de retenção longa e fechamento

- Manter Log Drains/PITR fora enquanto a decisão é custo zero; documentar retenção nativa observada e lacuna de 30 dias sem sugerir que alerta externo substitui retenção.
- Reavaliar apenas com estimativa e aprovação de custo; nenhuma assinatura é ativada automaticamente.
- Atualizar procedimentos operacionais e o registro por serviço com configuração final, custo real da fatura, responsáveis, limites, restauração/rollback e evidência de runtime.
- Reconciliar/fechar drafts antigos somente após provar que cada arquivo útil foi incorporado ou rejeitado e obter confirmação de fechamento.
- Mover este plano para o arquivo apenas quando todo escopo aprovado estiver concluído ou quando o owner encerrar/superar formalmente o plano; registrar resultado e atualizar índice.

**Aceite final:** nenhuma PR relevante fica sem destino; cada serviço tem estado código/configuração/runtime distinto; custos e limites confirmados; nenhum gate de produção ou decisão comercial é inferido.

## 5. Gates que podem pausar o roadmap

- Vercel Hobby continua sem adequação confirmada para uso comercial enquanto qualquer aplicação empresarial depender dela. DNS/proxy Cloudflare na frente da Vercel não remove a restrição. Concluir a Fase 0.5 antes de novos deploys Vercel de produção; fallback é temporário, com risco explicitamente aceito e critério de remoção registrados.
- Credenciais Cloudflare/R2 expostas sem rotação: não executar nem agendar backup.
- Plano gratuito de Better Stack inadequado a produto comercial ou cota insuficiente: não depender de heartbeat/alertas sem opção aprovada.
- Registro DNS ou serviço de e-mail não inventariado: não alterar nameservers/MX.
- Evento/telemetria incluir identificador estável ou dado de cliente não aprovado: bloquear ingestão/rollout e corrigir.
- Custo novo, pagamento, plano pago ou mudança de destinatário: parar para decisão explícita, apesar da autorização geral anterior para implementar.
- Check de Preview ignorado, cancelado ou bloqueado por quota: registrar como inconclusivo e criar caminho de prova; não chamar de verde.

## 6. Fontes e manutenção

- Estado de PRs: [Issue #710](https://github.com/luccafwlog/vela/issues/710) e [lista de PRs](https://github.com/luccafwlog/vela/pulls?q=is%3Apr+is%3Aall+717..737). Conferir os diffs/checks individuais no momento de execução.
- Custo e condições são variáveis; confirmar em cada fonte oficial ligada na tabela, no painel da conta e na fatura. Os números desta versão descrevem snapshots, não promessa de preço futuro.
- Procedimentos vivos de segurança, ambiente, deploy, backups e e-mail devem ser atualizados na mesma PR que entregar cada serviço.
- Revisar este plano após cada fase concluída: marcar decisão, PR, commit/deploy, evidência e saldo de pendências; não marcar uma fase como feita só porque sua PR foi mesclada.
