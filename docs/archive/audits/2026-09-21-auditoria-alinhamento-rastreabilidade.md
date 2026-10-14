# Auditoria de alinhamento — documentação viva × fontes executáveis

- **Data do checkout:** 2026-09-21
- **Commit base:** `e59c6bc14684b8f53614b4341e8bdbd21f9dbf9e` (`main`, 2026-09-20)
- **Alvo:** `docs/RASTREABILIDADE.md` (tabelas de contratos, tabelas diretas,
  triggers e histórico) contra `supabase/migrations/001…071` e `src/`.
- **Método:**
  1. extração das linhas de tabela de `docs/RASTREABILIDADE.md`;
  2. leitura das migrations da cadeia ativa, resolvendo a definição vigente pela
     última migration aplicável por assinatura (regra de `docs/CONVENCOES.md`);
  3. varredura de `.rpc('…')`/`callPortalRpc(…)` em `src/` fora de `__tests__`;
  4. **runtime local:** as migrações ativas aplicadas em um Postgres 16
     descartável por `scripts/setup-local-pg.sh`, com consulta direta a
     `pg_proc`, `has_function_privilege('anon'|'authenticated', …)` e
     `pg_policies`.
- **Limite de prova:** o runtime local reproduz a **cadeia ativa aplicada
  limpa**, não o banco remoto. Ele prova o que as migrations produzem; não prova
  o estado do projeto Supabase remoto (drift de ACL aplicado fora de migration),
  nem isolamento por cliente sob RLS — este exige sessão com identidade/papel
  correspondente. Itens dessa natureza ficam como **Runtime remoto pendente**.
- **Escopo editorial:** relatório histórico confrontado criticamente com a base de código.

## Estado dos gates automatizados

| Gate | Comando | Resultado |
|---|---|---|
| Documentação | `node scripts/check-docs.mjs` | **passa** — 154 arquivos Markdown, 55 rotas e cobertura do índice de ADR verificados |
| Catálogo de RPC | `node scripts/check-rpc-catalog.mjs` | **passa** — 174 nomes de RPC de produção resolvem em `public.pg_proc` (exigiu provisionar o Postgres local; sem banco, o script sai com código 2 sem verificar nada) |

Os dois gates passam **com todas as divergências abaixo presentes**: nenhum
deles compara assinatura, `SECURITY DEFINER/INVOKER`, grant efetivo ou existência
do chamador citado. É exatamente a lacuna que esta auditoria mede.

## A. Divergências confirmadas

Severidade:
- **crítica** = regressão de autorização no código ou brecha de segurança explorável;
- **alta** = a documentação descreve a superfície de segurança de forma substancialmente mais fechada do que o schema aplicado;
- **média** = contrato (assinatura/privilégio) documentado não é o vigente ou chamador divergente;
- **baixa** = referência de navegação obsoleta ou função fantasma em doc.

| # | Item | O que a doc afirma | O que a fonte executável mostra | Evidência | Sev. |
|---|---|---|---|---|---|
| A-01 | `ensure_customer_contact_email` (L276) | `PUBLIC`, `anon` **e `authenticated` revogados** | `authenticated` **tem** `EXECUTE` (concedido intencionalmente em `043`); a função possui guard fail-closed `IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN RAISE ... 42501`, barrando portal e anônimos. Divergência puramente documental | `043_security_and_indexes_hardening.sql:25`; `has_function_privilege('authenticated', …) = true` | média |
| A-02 | `relink_bl_customer` (L240) | `PUBLIC`/`anon`/`authenticated` revogados; "só executa dentro da RPC de importação" | `authenticated` **recebeu** `EXECUTE` indevidamente em `070_customer_review_communication_remediations.sql` ao criar o wrapper de advisory lock (em `357` era revogado de `authenticated`). A função é `SECURITY DEFINER` e **não tem check de `is_active_user()`**, permitindo que qualquer usuário autenticado alterasse o cliente de um B/L. **Regressão de código remediada na migration 071** | `070_…:124`; `071_revoke_relink_bl_customer_authenticated.sql` | crítica |
| A-03 | `apply_ce_mercante_update` (L221) | `012_transactional_rpcs.sql`: `SECURITY INVOKER`, "RLS do chamador" | Redefinida em `016_import_metadata_and_omission_conflicts.sql` como `SECURITY DEFINER` com guard `auth.uid()` + `is_active_user()` + `p_changed_by = auth.uid()` | `016_…:229`; `prosecdef = true` | média |
| A-04 | `apply_ce_mercante_manifest` (L220) | `087_apply_ce_mercante_manifest.sql`: `SECURITY INVOKER` | Redefinida em `016_…:282` como `SECURITY DEFINER`, `search_path=public,pg_temp` | idem | média |
| A-05 | `ensure_customer_contact_email` (L276) | assinatura `(bigint,text,text,text)` | vigente `(bigint,text,text,text,text)` — `p_related_bl_id` acrescentado em `008`/`043` | `043_…:18` | média |
| A-06 | `create_invoice_from_granite_bls` (L230) | overload `(uuid[],bigint,date,text,uuid)`; "grants de overloads a `authenticated`" | vigente `(uuid[],bigint,text,boolean,uuid)` — sem `date`, com `p_issue_now`; **nenhum** overload é executável por `authenticated` no schema aplicado | `002_…:4980`; `has_function_privilege('authenticated', …) = false` | média |
| A-07 | `create_local_consolidated_invoice` (L232) | `(bigint,bigint[],date,text,uuid)` | vigente `(bigint,bigint[],text,uuid)` | `002_…:4995` | média |
| A-08 | `mark_bl_ready_and_create_invoice` (L249) | `(text[],bigint,text,uuid)`, chamada por `src/services/billing.ts` | A doc misturou o nome da singular com a assinatura da plural: a singular `mark_bl_ready_and_create_invoice` recebe `(text,bigint,text,uuid)` (chamada em `BlCobrancasTab.tsx` e `reviewBillingAutomation.ts`); a plural **`mark_bls_ready_and_create_invoice`** recebe `(text[],bigint,text,uuid)` (chamada por `localBatchBillingWorkflow.ts`). **Ambas são chamadas por `billing.ts`** | `002_…:10739`; `src/services/billing.ts:780,799` | média |
| A-09 | `complete_review_customer_group` (L275) | `(text[],bigint,text,text,text,text,uuid)` — 7 argumentos | vigente com 6: `(text[],bigint,text,text,text,uuid)` | `002_…:3783` | média |
| A-10 | `register_ledger_invoice_payment` (L271) | "8 argumentos" | além do overload de 8, existe um de 9 (`…, p_request_id uuid`) criado em `066` e mantido em `070`; ambos com grant a `authenticated` | `066_…`, `070_…`; `pg_proc` | baixa |
| A-11 | `portal_resolve_login` (L267) | grants `anon` **e** `authenticated`; exceção pré-auth viva da ADR 0013 | na cadeia ativa há apenas `REVOKE … FROM PUBLIC`: **nem `anon` nem `authenticated`** podem executar. É server-only via Edge Function `portal-login` (`service_role`) — como já registram a nota editorial da ADR 0011/0013, a ADR 0047 e `docs/operations/seguranca.md`. O wrapper `portalResolveLogin` em `src/services/portalBilling.ts:264` é código morto | `002_…:29238`; `has_function_privilege` = false para ambos; `portalBilling.ts:264` | média |
| A-12 | Fronteira de execução (L176-177) | "a ADR 0013 permite como exceção pré-auth apenas `portal_resolve_login(text)`" | a exceção `anon` da ADR 0013 foi **encerrada** (ADR 0047 §4, `docs/operations/seguranca.md`); a única exceção viva é `portal_ship_schedule()` — que é, no schema aplicado, a **única** função de `public` executável por `anon` | ADR 0047; `002_…:29273`; consulta de ACL (§C) | média |
| A-13 | Tabela de RPCs (L215-281) | `calculateAndIssueGraniteInvoice` aparece como linha da tabela "RPCs e funções chamadas pelo cliente" | **Não existe em `pg_proc` nem em lugar algum de `src/`** (inclusive ausente em `src/services/graniteBillingWorkflow.ts`). Trata-se de função fantasma herdada de planos arquivados | `pg_proc`; `src/services/graniteBillingWorkflow.ts` | baixa |
| A-14 | Chamadores citados de RPC | 6 RPCs documentadas com chamador TypeScript nomeado | não há chamada em `src/` (fora de `__tests__` e de `src/types/database.ts` gerado): `apply_bl_review_gate_after_import` (só `PERFORM` dentro de SQL), `count_distinct_containers` (doc: `src/pages/Painel.tsx`), `create_invoice_from_granite_bls`, `get_customer_portal_account`, `set_customer_portal_account_active`, `upsert_customer_portal_account` (doc: `src/services/customers.ts`/`billing.ts`) | varredura de `src/` | baixa |
| A-15 | Coluna "Chamadores" das tabelas diretas (L283-342) | páginas listadas como chamadoras diretas de tabelas | `src/pages/Painel.tsx` e `src/pages/Admin.tsx` não contêm nenhum `.from(`/`.rpc(`; o acesso é por hooks/serviços. 35 de 175 pares (tabela, caminho) citados não mencionam a tabela no arquivo | varredura de `src/` | baixa |
| A-16 | Coluna "Definição vigente" (tabela de RPCs) | cita 95 arquivos de migration nominalmente | **86 deles não existem na cadeia ativa** — só em `supabase/migrations_archive/` (ex.: `108`, `123`, `129`, `151`, `262`, `322`, `357`). Apenas 9 citações apontam para arquivos de `supabase/migrations/` | `ls supabase/migrations{,_archive}` | média (sistêmica) |
| A-17 | Histórico supersedido (L412) | "Migrations `20260615220000` voltam a conceder `anon` a seis leituras" | na cadeia ativa nenhuma dessas seis leituras é executável por `anon`; o texto descreve um estado pré-squash | consulta de ACL (§C) | baixa |

## B. Suspeitas rebaixáveis

Todos os itens abaixo estavam rotulados **Suspeita** em `docs/RASTREABILIDADE.md`
e **não se sustentam** contra a cadeia ativa. A afirmação factual ("tem grant
`anon`", "não tem checagem interna") é falsa; o rótulo de risco pode cair, mas a
**coluna de ACL/definição precisa ser corrigida junto** — é ela que está errada
(ver §A).

| Linha | Item | Suspeita registrada | Verificação | Rebaixar para |
|---|---|---|---|---|
| 242 | `list_bl_local_charge_lines` | "definer permite leitura a usuário autenticado inativo" | corpo vigente abre com `IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN RAISE … 42501` | **Código** (runtime inativo pendente conforme §E) |
| 244 | `list_customer_reconciliation_queue` | "sessão autenticada inativa pode contornar a policy via definer" | mesmo guard `42501` | **Código** (runtime inativo pendente conforme §E) |
| 247 | `list_manual_charge_items_for_bl` | "definer sem `is_active_user()`" | mesmo guard `42501`, também na redefinição de `059_pr698_integrity_hardening.sql` | **Código** (runtime inativo pendente conforme §E) |
| 252 | `portal_get_demurrage_invoice_detail` | "grant `anon` contradiz a allowlist da ADR 0013" | não executável por `anon`; só `authenticated` | **Código** + **Runtime local** |
| 255 | `portal_invoice_details` | "`anon` reaberto após default-deny" | idem | **Código** + **Runtime local** |
| 256 | `portal_list_consolidatable_receivables` | "grant `anon` diverge da ADR 0013" | idem | **Código** + **Runtime local** |
| 257 | `portal_list_demurrage_invoices` | "grant `anon`" | idem | **Código** + **Runtime local** |
| 258 | `portal_list_invoices` | "`anon` reaberto após default-deny" | idem | **Código** + **Runtime local** |
| 261 | `portal_list_operation_bls` | "grant `anon` contradiz ADR, apesar do guard interno" | idem | **Código** + **Runtime local** |
| 184 | "as reaberturas de `anon` do Portal estão marcadas como **Suspeita**" | premissa da seção | não há reabertura de `anon` na cadeia ativa | remover a premissa |
| 483-488 | "Suspeitas reavaliadas" (runtime 2026-06-26) | afirma que as suspeitas não se reproduzem | **confere** com o schema aplicado hoje; a contradição é entre esse parágrafo e as linhas 242-261, que continuam rotuladas **Suspeita** | consolidar |

`ended_vessels` (L314, "Suspeita encerrada") também confere: no schema aplicado,
`SELECT` exige `is_active_read_user()`, `INSERT` exige usuário ativo, `DELETE`
exige `is_admin()` e não há policy de `UPDATE`.

## C. Allowlist `anon` real

Consulta no schema aplicado (migrations ativas, Postgres 16 descartável):

```sql
SELECT p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
-- portal_ship_schedule()
```

- **Funções de `public` executáveis por `anon`: exatamente 1** —
  `portal_ship_schedule()`.
- **Funções executáveis por `PUBLIC`: nenhuma.**
- Isso **coincide** com a norma vigente (ADR 0011 nota editorial de 2026-09-18,
  ADR 0047 item 4 e `docs/operations/seguranca.md`), e **contradiz**
  `docs/RASTREABILIDADE.md`, que descreve a allowlist como
  `portal_resolve_login` e marca seis leituras do Portal como tendo grant `anon`.
- **Nenhuma RPC viola a allowlist.** A violação registrada na documentação não
  existe na cadeia ativa. O que falta é o inverso: `portal_ship_schedule` — a
  única exceção pré-autenticação viva — **não tem linha própria na tabela de
  contratos** de `RASTREABILIDADE.md`, aparece apenas como RPC citada em duas
  linhas de rota (L85, L140), sem coluna de autorização.

## D. Cobertura: RPCs em uso × RPCs documentadas

| Métrica | Valor |
|---|---|
| RPCs distintas chamadas em `src/` (fora de `__tests__`) | 154 |
| Dessas, existentes no schema aplicado | 154 (nenhuma chamada órfã) |
| Dessas, **não citadas em `docs/RASTREABILIDADE.md`** | **70** |
| Linhas da tabela "RPCs e funções chamadas pelo cliente" | 65 (uma delas não é RPC — A-13) |
| RPCs documentadas sem chamador TypeScript real | 8 (6 com chamador citado que não existe — A-14; 2 já declaradas sem consumidor: `approve_customer_reconciliation`, `reject_customer_reconciliation`) |

Das 70 não documentadas, 65 são `SECURITY DEFINER` — ou seja, a maior parte da
superfície privilegiada em uso não está mapeada. Blocos inteiros ficam de fora:
alertas e notificações internas (`list_alert_queue_page`, `upsert_billing_alert`,
`summarize_alert_queue_by_department`, `mark_internal_notification_read`, …),
efeitos de importação (`enqueue_import_effect`, `claim_import_effects`,
`retry_import_effect`, …), demurrage (`create_demurrage_invoice_authoritative`,
`register_demurrage_payment`, `apply_demurrage_discount`,
`reopen_demurrage_invoice`, …), listas operacionais (`operational_list_bls`,
`operational_list_containers`, `operational_list_bl_summary`) e nove RPCs do
Portal (`portal_list_disputes`, `portal_add_dispute_message`,
`portal_get_contact_configuration`, `portal_save_contact_configuration`,
`portal_request_dispute_reopen`, `portal_get_current_roe`,
`portal_admin_change_cnpj`, `portal_assisted_email_change`,
`portal_list_provisioning_events`).

Lista completa reproduzível com a varredura de `.rpc('…')`/`callPortalRpc(…)`
descrita no método.

## E. Itens indeterminados (exigem validação remota)

| Item | Por que não fecha estaticamente |
|---|---|
| ACL efetiva no Supabase remoto | O runtime local prova o que a cadeia ativa produz aplicada limpa. Grants alterados fora de migration no projeto remoto não aparecem aqui. A própria ADR 0047 documenta um levantamento remoto (2026-08-14) em que 51 funções eram executáveis por `anon` — divergência histórica entre migrations e banco. **Runtime remoto pendente.** |
| Isolamento por cliente no Portal | `current_portal_customer_id()` rejeita `auth.uid()` nulo com `28000` (leitura de código confirmada), mas o escopo por cliente sob RLS exige sessão autenticada real de dois clientes distintos. Sucesso como superusuário local não prova isolamento. **Runtime remoto pendente.** |
| Guards `is_active_user()`/`is_active_read_user()` em usuário inativo | O guard existe no corpo aplicado (**Teste de contrato SQL** + estrutura confirmada em runtime local), mas a rejeição `42501` de uma sessão autenticada-e-inativa depende de `auth.uid()` populado, indisponível no shim local. **Runtime remoto pendente.** |
| Afirmações ancoradas em migrations arquivadas (A-16) | Cada uma exigiria reconciliar o texto com a definição consolidada em `001…071`. Foram verificadas as da amostra desta auditoria; as demais permanecem não verificadas. |

## F. Observações de contagem

- `docs/RASTREABILIDADE.md` no commit auditado contém **22** ocorrências
  literais de "Suspeita" (não 27): 1 na legenda, 1 na fronteira de execução
  (L184), 9 em linhas de contrato (L242-261), 1 em linha de tabela já encerrada
  (L314), 1 no histórico supersedido (L412) e o restante no parágrafo de
  suspeitas reavaliadas (L483-488).
- O cabeçalho do documento diz "Revisado estaticamente contra o checkout em
  2026-09-19; sem revalidação remota" — consistente com o quadro encontrado:
  as afirmações de ACL descrevem o estado **pré-consolidação** (ADR 0062,
  migrations arquivadas 100-380), não a cadeia `001…071`.
