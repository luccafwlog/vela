# Plano de remediação da auditoria do Portal e da superfície F12

> **Estado:** em execução na PR #718 (Fases 0 a 4 implementadas; Fase 5 de validação de runtime em staging aguardando deploy).
>
> **Origem:** revisão estática de segurança do Portal do Cliente concluída em
> 2026-09-22. A revisão percorreu a SPA do Portal, autenticação, Edge Functions,
> RPCs, RLS, Storage, headers/CSP, sinks do navegador, build e dependências.

## 1. Resultado pretendido

O cliente deve conseguir usar o Portal e sair dele sem deixar uma sessão ativa
por falha de rede; o fluxo de Dispute deve aceitar anexos somente para mensagens
do próprio cliente, com objeto existente, metadados conferidos, limite por conta
e limpeza de falhas; a recuperação de senha deve ter tempo de resposta sem
diferença explorável entre CNPJ existente e inexistente; e o build produtivo deve
falhar se artefatos de depuração forem deixados na saída.

O resultado observável esperado no Portal é:

- clicar em **Sair** remove a sessão local mesmo quando a revogação global não
  consegue alcançar o servidor; a tela não promete uma revogação que não foi
  confirmada;
- enviar uma mensagem com anexo registra somente um arquivo pertencente àquela
  mensagem e ao cliente autenticado; a falha do registro não deixa um objeto
  permanente sem dono;
- repetir chamadas pelo DevTools não permite ultrapassar quota/rate limit nem
  inventar nome, MIME, tamanho ou caminho de arquivo;
- **Esqueci minha senha** mantém resposta genérica e não oferece uma diferença
  de latência útil para descobrir contas;
- um deploy não publica `.map` ou manifesto confidencial por causa de erro na
  etapa de limpeza.

## 2. Escopo e limites

### Incluído

- Achado confirmado de logout local persistente após erro de rede:
  `src/hooks/usePortalAuth.tsx`, `src/services/supabaseAuth.ts`, layout do
  Portal e testes do cliente Supabase.
- Achado confirmado de upload direto e ilimitado no bucket
  `demurrage-disputes`, incluindo objetos órfãos:
  `src/services/portalBilling.ts`, policies de
  `supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql` e a cadeia de
  Dispute.
- Achado confirmado de integridade da RPC
  `add_demurrage_dispute_attachment`: autoria da mensagem e existência/metadata
  do objeto não são revalidadas:
  `supabase/migrations/002_business_logic_and_security.sql`.
- Indício de canal lateral temporal em
  `supabase/functions/portal-password-recovery/index.ts`, com medição controlada
  em staging para decidir se há exploração prática.
- Hardening do build em `scripts/vercel-build.mjs` e atualização das
  dependências de desenvolvimento apontadas por `npm audit`.
- Testes de contrato SQL, unitários, integração local e prova de runtime somente
  após autorização explícita do ambiente e das contas fixture.

### Fora de escopo

- Pentest ativo em produção, força bruta, carga, exfiltração, persistência ou
  alteração de dados de clientes sem autorização específica.
- Troca completa da autenticação Supabase por BFF/cookies HttpOnly. O token no
  storage do navegador continua visível ao próprio navegador, extensões e código
  da mesma origem; esta limitação deve permanecer documentada.
- Implantar antivírus/DLP ou disponibilizar download/preview de anexos. A
  entrega atual não renderiza anexos no Portal; qualquer download futuro precisa
  de uma decisão própria sobre `Content-Disposition`, sandbox e varredura.
- Alterar o rate limit de login chaveado por CNPJ. O risco de lockout por CNPJ
  está aceito na [ADR 0049](../adr/0049-rate-limit-do-portal-chaveado-somente-por-cnpj.md)
  e não é um novo achado desta revisão.
- Corrigir os quatro advisories de dev dependencies na mesma migration ou no
  mesmo fluxo de Storage; eles devem ser uma entrega de supply chain separada,
  ainda que possam compartilhar a PR de execução se o diff permanecer pequeno.

## 3. Evidência e fontes de verdade

### Achados que iniciam o plano

| ID | Classificação | Evidência atual | Dono inicial |
|---|---|---|---|
| PAF-01 | Médio, confirmado no código e reproduzido localmente | `clearSession()` limpa somente estado React; `auth.signOut()` pode retornar erro antes de `_removeSession()`. Um transporte simulado deixou `td-portal-auth` persistido. | `usePortalAuth` + `supabaseAuth` |
| PAF-02 | Médio, confirmado no contrato de Storage | `INSERT` aceita qualquer nome no prefixo do cliente, com 10 MB por objeto e sem quota/contagem. A função Portal faz upload antes da RPC de metadata. | Storage + serviço de Dispute |
| PAF-03 | Médio, confirmado no contrato SQL | A RPC valida a Dispute do cliente, mas aceita `message_id`, caminho, MIME, nome e tamanho fornecidos pelo chamador sem verificar autoria nem objeto real. | RPC/migration |
| PAF-04 | Suspeita de médio, ainda sem TTFB de runtime | Caminhos de CNPJ inexistente, inativo, convite vivo e convite novo fazem quantidades diferentes de consultas/escritas antes da mesma resposta `{ accepted: true }`. | Edge Function de recovery |
| PAF-05 | Baixo, hardening condicionado a falha de build | `cleanProductionArtifacts` captura erro de remoção de `.map` e continua o deploy. O build normal atual remove os mapas. | Script de build |
| PAF-06 | Médio contextual de supply chain, não runtime do Portal | `npm audit` encontrou quatro advisories somente em dev/build (`@vitest/mocker`, `baseline-browser-mapping`, `browserslist`); `npm audit --omit=dev` está limpo. | `package-lock.json`/CI |

As fontes de segurança e domínio continuam sendo
[operations/seguranca.md](../operations/seguranca.md),
[modules/portal-cliente.md](../modules/portal-cliente.md),
[CONTEXT.md](../../CONTEXT.md), as policies/RPCs nas migrations vigentes e os
contratos de query/cache existentes. RLS/RPC permanece a fronteira de
autorização; UI, CSP, CORS e route guards são camadas auxiliares.

## 4. Decisões pendentes antes das migrations

As decisões abaixo mudam contrato ou custo. O plano pode avançar em testes e
refatoração isolada, mas a migration de quota e o rollout de Storage aguardam a
decisão do responsável.

| Gate | Pergunta | Recomendação inicial | Bloqueia |
|---|---|---|---|
| G-PAF1 | Qual quota de anexos por cliente e janela de rate limit? | 100 MB armazenados por cliente, 20 uploads/dia e 10 MB por arquivo; alertar a 80% e permitir ajuste sem migration destrutiva. | Policy/RPC e monitor de custo |
| G-PAF2 | Upload será recebido pela Edge Function ou usará signed upload URL de curta duração? | Edge Function valida a mensagem, grava o arquivo e registra metadata; signed URL é alternativa se o limite de payload da função for insuficiente. | Contrato do serviço e Storage policy |
| G-PAF3 | Logout deve tratar revogação global falha como erro visível? | Remover sessão local sempre; informar que o logout local foi concluído e que a revogação remota será tentada novamente, sem bloquear a saída. | Texto/UI e contrato de `signOutSupabaseClient` |
| G-PAF4 | Recovery pode ser assíncrono após resposta aceita? | Sim, desde que a tarefa seja durável, observável e idempotente; se não, equalizar trabalho síncrono sem confiar somente em `sleep`. | Modelo de fila e critério de aceite de latência |

Se o responsável escolher valores diferentes, registrar a decisão na PR de
execução e, se alterar a arquitetura ou a política de dados, criar ADR nova.

## 5. Ordem de execução

### Fase 0 — Preparação e contrato de segurança

1. Rebasear a branch de execução em `main` atual e remapear linhas dos achados.
2. Registrar threat model curto: cliente autenticado controla DevTools, headers,
   body, IDs, nomes de arquivo e ordem das chamadas; não controla `auth.uid()`
   nem a policy/RPC do servidor.
3. Fixar fixtures de staging: dois clientes, duas Disputes, mensagem do cliente,
   mensagem de Equipamentos, arquivo válido e arquivo com metadata divergente.
4. Registrar G-PAF1 a G-PAF4 antes de aplicar qualquer migration ou mudança
   remota. Nenhum teste de carga ou objeto de produção entra nesta fase.

### Fase 1 — Logout local fail-closed (PAF-01)

**Arquivos e contrato:**

- `src/services/supabaseAuth.ts`: ampliar o tipo mínimo do cliente para aceitar
  escopo local e garantir que, após erro de revogação global, a sessão local
  seja removida em uma etapa separada; preservar deduplicação de chamadas.
- `src/hooks/usePortalAuth.tsx`: manter limpeza de queries/telemetria, tratar o
  erro após a limpeza local e expor estado de logout ao layout.
- `src/components/layout/PortalLayout.tsx`: impedir duplo clique, não descartar
  silenciosamente falha e manter usuário na tela pública após limpeza local.
- `src/services/__tests__/supabaseAuth.test.ts` e testes do hook/layout: cobrir
  sucesso, erro de rede, lock roubado, chamadas concorrentes e storage vazio.

**Critérios de aceite:**

- com `auth.signOut()` retornando erro, `td-portal-auth` não contém sessão ao
  final da Promise;
- recarregar a página após erro não reabre o Portal;
- erro de revogação global é observável, mas não impede a saída local;
- o cliente interno mantém o contrato atual e seus testes passam.

**Rollback:** reverter somente o helper/UI se a API de escopo local divergir da
versão Supabase instalada; não reintroduzir sessão persistida como condição para
mostrar a tela pública.

### Fase 2 — Upload e metadata de Dispute por operação autorizada (PAF-02/03)

#### 2.1 Fechar o contrato de autoria

Alterar `add_demurrage_dispute_attachment` para derivar o cliente da sessão e
exigir simultaneamente:

- Dispute pertencente ao `current_portal_customer_id()`;
- mensagem pertencente à Dispute e com `author_type = 'cliente'`;
- `author_id = auth.uid()` para chamada do Portal;
- caminho gerado pelo servidor, com bucket fixo, cliente e Dispute coerentes;
- objeto existente em `storage.objects`, não sobrescrito, dentro do prefixo
  autorizado;
- `size_bytes`, MIME e nome consistentes com o objeto persistido;
- uma quota/rate limit consultável antes de aceitar o arquivo.

O caminho não deve mais depender de `customerId` aceito da UI. O serviço deriva
essa informação da sessão ou recebe somente um identificador de mensagem; o
servidor cria o prefixo e o nome aleatório.

#### 2.2 Remover o caminho de upload irrestrito

Escolher uma das duas implementações de G-PAF2:

- **Edge Function recomendada:** recebe arquivo/metadados, valida sessão,
  mensagem e quota, grava com service role no bucket privado e registra a RPC;
  em erro, remove o objeto recém-criado;
- **Signed upload URL:** uma RPC/Edge Function autoriza uma única tentativa e
  devolve URL curta; a finalização verifica objeto e metadata, invalida a
  autorização e remove uploads sem finalização.

Em ambos os casos:

- retirar o `INSERT` amplo do Portal em `storage.objects`;
- manter leitura limitada ao cliente ativo e ao bucket correto;
- não permitir `upsert` nem path fornecido pelo browser;
- criar limpeza de objetos órfãos por idade e monitorar quota/custo;
- usar uma action de rate limit distinta, sem confundir quota de bytes com
  bloqueio de login.

#### 2.3 Testes e aceite

- teste SQL de contrato para policy default-deny, grants e guards da RPC;
- teste de serviço para cliente diferente, mensagem de Equipamentos, mensagem
  de outro cliente, objeto inexistente, MIME/tamanho divergente, path traversal,
  duplicação e quota excedida;
- teste de falha entre upload e metadata, provando limpeza;
- teste de integração em Postgres/Storage descartável com identidades Portal e
  interna distintas;
- prova autorizada de F12 em staging: repetir REST upload e RPC diretamente
  deve falhar sem criar objeto ou linha de metadata;
- nenhuma mudança de UI para download entra nesta fase.

**Rollback:** manter o bucket privado, desabilitar a nova entrada de upload e
reabrir temporariamente somente o fluxo server-side anterior com quota explícita;
nunca reativar policy global de `INSERT` como rollback automático.

### Fase 3 — Fechar o canal lateral de recovery (PAF-04)

1. Extrair o trabalho de `portal-password-recovery` para uma operação idempotente
   que receba CNPJ normalizado e nunca devolva estado de conta.
2. Preferir registro em fila/tabela de pedidos e worker observável; a resposta
   pública faz somente validação de formato, rate limit e registro de pedido.
3. Processar em segundo plano consulta de conta, supressão, convite vivo,
   invalidação, criação de token e envio. O pedido precisa ser durável, ter
   idempotency key e permitir retry sem email duplicado.
4. Se a decisão for manter processamento síncrono, fazer todos os caminhos
   elegíveis executarem o mesmo conjunto de operações sem usar atraso artificial
   como única defesa.
5. Adicionar métricas sanitizadas de duração por resultado interno somente no
   servidor; não registrar CNPJ, email, token ou corpo.

**Aceite:** resposta e corpo continuam indistinguíveis; staging com CNPJs
fixture existentes/inexistentes, cinco repetições por janela e ruído normalizado
não produz separação estatística operacionalmente útil. Runtime de produção não
é requisito para fechar a migration; deve ficar como prova posterior autorizada.

**Rollback:** manter handler genérico e desabilitar apenas o worker novo; não
voltar a expor `account_found`, `email_sent` ou qualquer código de estado.

### Fase 4 — Build e supply chain (PAF-05/06)

- Fazer `cleanProductionArtifacts` falhar quando não conseguir remover mapas;
  adicionar verificação final de que `dist` não contém `.map` ou manifesto
  sensível.
- Adicionar teste unitário do script com saída temporária: mapa removível passa;
  remoção recusada falha o build; nenhum arquivo do workspace real é removido.
- Atualizar `@vitest/mocker`, `baseline-browser-mapping` e `browserslist` por
  lockfile, revisar changelog/breaking changes e rodar auditoria completa.
- Reexecutar `npm audit --omit=dev` para garantir que o bundle de produção
  continua limpo; advisories restantes devem ficar registrados com versão,
  alcance e mitigação.

### Fase 5 — Prova de runtime e encerramento

Só iniciar após autorização explícita de ambiente, janela, owner, contas fixture,
dados permitidos, limite de carga e limpeza. Produção fica fora por padrão.

- Browser: logout com transporte interrompido, reload e isolamento entre sessão
  interna e Portal.
- Storage/RPC: upload normal (incluindo teste com arquivo de 9,9 MB para validar overhead de multipart no gateway Supabase), validação de preflight CORS (`OPTIONS`), leitura efetiva de `storage.objects` pela RPC, upload repetido por REST, metadata adulterada, mensagem de Equipamentos, outro cliente, objeto órfão, pré-checagem de elegibilidade e quota.
- Recovery: distribuição de TTFB e ausência de enumeração por corpo/status; confirmação do comportamento assíncrono best-effort.
- Build/deploy: verificar que `.map` não é servido e headers/CSP continuam
  presentes no ambiente identificado.
- Registrar evidência como **Runtime**, sem converter teste de contrato SQL em
  prova de RLS aplicado no ambiente remoto.

## 6. Arquivos e contratos previstos

| Área | Donos existentes / novos previstos |
|---|---|
| Logout | `src/services/supabaseAuth.ts`, `src/hooks/usePortalAuth.tsx`, `src/components/layout/PortalLayout.tsx`, testes de auth/hook |
| Upload | `src/services/portalBilling.ts`, `src/components/portal/PortalDisputeConversation.tsx`, Edge Function nova ou contrato de signed upload |
| Banco/Storage | migration nova, `add_demurrage_dispute_attachment`, policies de `storage.objects`, quota/rate limit e job de limpeza |
| Recovery | `supabase/functions/portal-password-recovery/index.ts`, helper de fila/worker, tabelas/RPCs novas se a decisão assíncrona for aprovada |
| Build | `scripts/vercel-build.mjs`, teste do script e `package-lock.json` |
| Documentação | `docs/operations/seguranca.md`, `docs/modules/portal-cliente.md`, `docs/setup/testing.md`, ADR nova se G-PAF alterar contrato |

Migrations novas devem preservar default-deny, grants explícitos, `search_path`
seguro e guards NULL-safe. Se alguma migration reescrever ou remover linhas,
deve declarar no cabeçalho a premissa de dados descartáveis exigida por
`AGENTS.md`; não reescrever migrations existentes.

## 7. Gates e critérios de conclusão

### Gates locais

Para a execução de aplicação/configuração:

```bash
npm run docs:check
npm run typecheck
npm run lint
npm test
npm run build
npm run migrations:check
npm run rpc:check
git diff --check
```

Para migrations/Storage, acrescentar o verificador de guards e o Postgres local
descartável com identidades correspondentes. `rpc:check` sem banco ativo deve ser
marcado como bloqueado, não como aprovado.

### Critérios de conclusão do plano

- [x] PAF-01 possui teste de erro de rede e comportamento local fail-closed (`src/services/__tests__/supabaseAuth.test.ts`, `src/hooks/__tests__/usePortalAuth.test.tsx`, `src/components/layout/__tests__/PortalLayout.test.tsx`).
- [x] PAF-02/03 não têm `INSERT` amplo do Portal, validam autoria/objeto e têm
      quota, rate limit e limpeza definidos (migration `074`, Edge Function `portal-dispute-attachment`, `portalUploadDisputeAttachment`).
- [x] PAF-04 elimina canal lateral temporal desacoplando busca/envio em segundo plano via `EdgeRuntime.waitUntil`, mantendo resposta `{ accepted: true }` uniforme sem enumeração por corpo/status.
- [x] PAF-05 não permite deploy silencioso com mapa residual (`scripts/vercel-build.mjs` com `cleanProductionArtifacts` fail-closed e `assertNoForbiddenArtifacts`).
- [x] PAF-06 atualizado via lockfile (`npm update vitest browserslist baseline-browser-mapping`, 0 vulnerabilidades em `npm audit`).
- [x] Documentação viva atualizada (`docs/operations/seguranca.md`, `docs/modules/portal-cliente.md`).
- [ ] Provas remotas de runtime (Fase 5) a serem executadas em staging após autorização de ambiente e contas fixture.

## 8. Rollout, observabilidade e rollback

Cada entrega deve ser independente e atrás de flag/configuração segura quando
houver dependência remota. Monitorar:

- quantidade e bytes de upload por cliente, rejeições de quota e órfãos;
- falhas de logout global versus logout local;
- latência e taxa de processamento de recovery, sem dimensões identificáveis;
- falhas de limpeza de build e presença de artefatos proibidos;
- custo/limite de Storage e advisories do lockfile.

Rollback deve retirar somente a frente afetada, preservar auditoria e não apagar
ledger, mensagens ou dados de clientes. Remoção de objetos órfãos é reversível
somente dentro da janela definida; qualquer limpeza material exige inventário,
critério e confirmação do owner.

Quando todas as fases executáveis e provas requeridas terminarem, mover este
plano para `docs/archive/plans/`, retirar sua linha do índice vivo e registrar a
entrega no changelog, conforme [CONVENCOES.md](../CONVENCOES.md).
