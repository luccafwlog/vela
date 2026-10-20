# Guia de Configuração e Uso do Sentry no Vela e no Portal Fwlog

Este documento orienta a equipe sobre a integração do **Sentry** com o Vela e
com o Portal Fwlog, explicando como os erros são capturados, classificados e
como configurar o painel web para receber alertas didáticos e objetivos. O
contrato de DSNs distintos, ambientes Preview/Production e o runbook Better
Stack estão em [`observabilidade.md`](observabilidade.md).

---

## 1. Visão Geral da Observabilidade

O sistema captura falhas em três camadas principais:
1. **Consultas e Ações de Dados (TanStack Query):** Toda busca (`query`) ou gravação (`mutation`) que falha é interceptada e enriquecida com o nome da tela, módulo e tarefa em português.
2. **Erros de Renderização da Tela (React Error Boundary):** Se uma página quebrar ou travar, o Sentry registra o nome da tela e a rota afetada.
3. **Falhas em Segundo Plano (Best-Effort):** Notificações, logs de auditoria e emissões auxiliares que falham sem travar a navegação do usuário.

### Proteção de Dados (LGPD e Privacidade)
Antes do envio para o Sentry, todo payload passa por sanitização automática em [`src/lib/telemetry.ts`](../../src/lib/telemetry.ts):
* Padrões de **CNPJ**, **CPF** e **e-mails** são redigidos.
* Tokens de recuperação e autenticação contidos em URLs são removidos.
* O usuário é identificado apenas por seu ID interno e papel (`user_role`, ex: `administrativo`, `financeiro`).

### Eventos descartados no navegador
* `Invalid Refresh Token` / `invalid_grant`: sessão expirada, sem ação possível (VELA-5).
* Erro de banco de permissão (`42501`) ou de sessão expirada (`PGRST301`) que chega **depois do logout**: a consulta já estava na fila quando a sessão acabou (logout manual, inatividade de 8 h, outra aba) e saiu com a chave anônima. O usuário já está no login; reportar viraria uma issue por consulta montada (VELA-1Q a VELA-1Z). Vale para o Vela e para o Portal: cada um sinaliza o fim da própria sessão (`setTelemetrySessionEnded`), porque o Portal fica logado com usuário anônimo no Sentry. Com sessão ativa, o mesmo erro continua indo ao Sentry. No logout do Vela, o `user_role` também sai do escopo.

---

## 2. Ajustes Recomendados no Painel Web do Sentry

Para que as notificações por e-mail e canais de alerta reflitam a identidade do sistema:

### A. Separar os projetos do Vela e do Portal

O alvo repository-side é um projeto para a aplicação interna (`vela`, que
também recebe os erros das Edge Functions) e outro para o Portal (`portal`),
ambos na organização `fwlog`. A seleção ocorre
no build por `VITE_SENTRY_DSN_INTERNAL` e `VITE_SENTRY_DSN_PORTAL`; não copie um
DSN de um projeto para o outro. O procedimento de configuração e a evidência
necessária estão em [`observabilidade.md`](observabilidade.md) e dependem de
autorização no provedor.

### B. Configurar Regras de Alerta Inteligentes (Evitar Spam em Testes)
No Sentry, alertas disparados para todo e qualquer erro durante homologação podem sobrecarregar a caixa de entrada. Recomendamos criar uma regra de alerta focada:
1. No menu lateral, acesse **Alerts** > **Create Alert**.
2. Escolha **Issues** (alerta de novas falhas).
3. Em **Set Conditions**:
   * **When:** *A new issue is created* (quando surgir um novo tipo de erro).
   * **If:** *The issue's environment matches `production`* (apenas erros em ambiente produtivo).
   * **And (opcional):** *The event's tags `modulo` is not empty*.
4. Em **Set Actions**:
   * Enviar e-mail para a equipe técnica ou notificação em canal integrado (Slack / Microsoft Teams).
5. Defina um limite de frequência (ex: *Send a notification if an issue occurs more than 5 times in 1 hour* para problemas intermitentes).

---

## 3. Estrutura das Novas Tags Didáticas

A partir desta atualização, todo erro reportado pelo Vela inclui tags padronizadas que aparecem tanto no resumo do e-mail quanto no painel do Sentry:

| Tag | Exemplo | Descrição |
|---|---|---|
| `modulo` | `Financeiro`, `Faturamento`, `Operações`, `Viagens`, `Demurrage` | Área do sistema onde ocorreu o problema |
| `tela` | `Conciliação PIX`, `Faturas Locais`, `Painel de BLs` | Nome humanizado da tela em uso |
| `tarefa` | `Listar pendências PIX`, `Listar faturas`, `Buscar candidatos` | Ação ou consulta exata que estava em andamento |
| `categoria_falha` | `Banco de Dados / Regra de Negócio`, `Conectividade / Rede`, `Erro de Código / Runtime` | Natureza técnica simplificada da falha |
| `diagnostico` | Mensagem amigável traduzida (ex: *"Sem permissão para esta ação"*) | Explicação didática do motivo do erro |
| `user_role` | `administrativo`, `financeiro`, `operacoes` | Papel operacional do usuário que disparou a ação |
| `rota` | `/reconciliacao`, `/invoices` | Endereço URL no navegador |
| `codigo_erro` | `22023`, `42501`, `PGRST202` | Código do erro de banco, nunca a mensagem. No app, vem da classificação do erro da consulta ou ação; em evento de Edge Function, é o SQLSTATE ou código PostgREST da RPC que falhou |
| `rpc` | `run_alert_detectors`, `evaluate_and_dispatch_automatic_communications` | Só em evento de Edge Function: RPC que falhou, se estiver na allowlist de `src/lib/telemetryContract.ts` |

---

## 4. Como Ler um Alerta Após a Atualização

### Exemplo Comparativo:

#### Como chegava antes:
* **Título:** `JAVASCRIPT-REACT-12 - TypeError: Cannot read properties of undefined (reading 'rest')`
* **Tags:** `context: TanStack Query`, `browser: Chrome`
* **Usuário:** *(vazio)*
* **Dificuldade:** Não era possível saber qual tela, qual ação e qual usuário sofreu a falha sem abrir o código minificado.

#### Como chega agora:
* **Tags em Destaque:**
  * `modulo = Financeiro`
  * `tela = Conciliação PIX`
  * `tarefa = Listar pendências PIX`
  * `categoria_falha = Erro de Código / Runtime`
  * `user_role = administrativo`
* **Resumo Didático no evento:** *"Falha ao executar 'Listar pendências PIX' na tela 'Conciliação PIX' (Financeiro)."*
* **Títulos legíveis para erros de banco:** em vez do objeto cru ou do nome minificado (`qi`, `Gi`), a issue abre com `[Sessão expirada] PGRST301`, `[Sem permissão] 42501` etc., com agrupamento estável por categoria, código e mensagem de negócio (dígitos normalizados, para "viagem 38" e "viagem 39" ficarem juntas) e seção estruturada `database` (tipo, código, mensagem, detalhes) na página da issue.
* **Agrupamento por módulo e tarefa:** quando o evento traz `modulo` e `tarefa`, o fingerprint vira `[modulo, tarefa, …fingerprint do erro]` — o par refina o agrupamento, não o substitui. Antes de 2026-10-09 o par sozinho era o fingerprint, e toda mutation sem `mutationKey` ("Operações / Operação de dados") caía numa issue só, como a VELA-15, que misturava anexo de comunicado, escala omitida, fatura avulsa e um TypeError já corrigido. Erros que não são de banco usam `{{ default }}` do Sentry após o par.
* **Rastreabilidade de Código:** o Vite gera sourcemaps (`sourcemap: 'hidden'`), mas eles ainda não são enviados ao Sentry — por isso os stacks continuam minificados (`at Ki (featureFlags-*.js:7:7109)`). O upload de sourcemaps é o follow-up recomendado (ver §6).

---

## 6. Upload de Sourcemaps (follow-up recomendado)

Hoje os stacks chegam minificados (`at Ki (featureFlags-*.js:7:7109)`) porque,
embora o Vite gere os sourcemaps (`sourcemap: 'hidden'`), nada os envia ao
Sentry. O caminho recomendado:

1. `npm install --save-dev @sentry/vite-plugin` e registrar o plugin no
   `vite.config.ts` com `org: 'fwlog'`, `project: ['vela', 'portal']` e
   `release.name` igual ao `VITE_APP_COMMIT_SHA` (12 caracteres), ativado
   apenas quando `SENTRY_AUTH_TOKEN` existir no ambiente.
2. Criar um **User Auth Token** em [sentry.io/settings/account/api/auth-tokens](https://sentry.io/settings/account/api/auth-tokens/) com o escopo `project:releases`.
3. No GitHub, em **Settings → Secrets and variables → Actions**, criar o
   secret `SENTRY_AUTH_TOKEN` e expô-lo como env no step de build dos
   workflows `cloudflare-pages-production.yml` e `cloudflare-pages-preview.yml`.
4. No próximo deploy, conferir em **Sentry → projeto → Settings → Source Maps**
   que o artefato do release aparece como *"uploaded"*.

Referência de código: `humanizeDatabaseError` em [`src/lib/telemetry.ts`](../../src/lib/telemetry.ts) (títulos legíveis e contexto `database`).
