# ADR 0047 — Grants de função fechados por padrão em `public`

> **Situação atual (2026-10-13).** Decisão vigente e implementada. As migrations `078`, `088`, `093`, `152`, `182`, `257`, `296` e `297` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062; `078`, `088`, `093`, `152` e `182` também existem na cadeia ativa, com outro conteúdo. Na cadeia ativa, o default fechado está nas migrations `001` e `006` e a varredura do resíduo na `003`.
> Regra vigente em [Segurança](../operations/seguranca.md), seção "RLS-first" (item "Default-deny em funções").

Status: aceito — 2026-08-14

Estende a [ADR 0011](./0011-revogacao-anon-security-definer-default-deny.md), que
estabeleceu o default-deny como *disciplina de autor*, e encerra formalmente a
exceção `anon` da [ADR 0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md),
já revogada na prática pela migration `182`.

## Contexto

O Supabase mantém, no schema `public`, um `ALTER DEFAULT PRIVILEGES` que concede
`EXECUTE` a `anon` e `authenticated` em toda função criada. Somado ao default
embutido do PostgreSQL (`EXECUTE` a `PUBLIC`), isso faz **cada função nascer
aberta**.

A ADR 0011 respondeu a isso com uma regra de processo: toda migration que criar
função deve incluir o `REVOKE` no mesmo arquivo. A regra é correta, mas o modo de
falha é o problema — **esquecer falha aberto**, e em silêncio. O histórico mostra
a regra sendo furada de forma recorrente: as migrations `078`, `088`, `093`, `152`
e `257` são cinco correções da mesma causa, e a `152` varreu apenas funções
`SECURITY DEFINER`, deixando as demais fora.

Levantamento em produção (`fgmkhbzhaeebrsizwccx`, 2026-08-14), na auditoria das
cinco falhas clássicas de IA (achado A-06):

| Métrica | Valor |
|---|---|
| Funções de `public` pertencentes ao projeto (`postgres`) | 252 |
| Executáveis por `anon` | 51 |
| Com grant a `PUBLIC` | 38 |
| Migrations que apagam e recriam função (`DROP FUNCTION`) | 23 |

Entre as 51 estavam as RPCs vivas do Portal (`portal_list_invoices`,
`portal_invoice_details`, `portal_get_profile`), os geradores de PIX
(`build_transshipping_pix_payload`, `pix_tlv`, `pix_crc16_ccitt`) e escritas como
`mark_bl_ready_and_create_invoice`.

**Nenhuma vazava dado.** As funções do Portal resolvem o cliente por
`current_portal_customer_id()`, que é `NULL` para `anon`; as demais caem na RLS.
O problema é superfície acumulada — a mesma classe do achado A-03 (migration
`296`), quatro vezes maior — e o fato de ela voltar a crescer a cada função nova.

As 23 migrations com `DROP FUNCTION` são o vetor que mantém o problema vivo:
`CREATE OR REPLACE` preserva o ACL, mas apagar e recriar devolve o grant do
default.

## Decisão

1. **O default passa a revogar.** A migration `297` aplica
   `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON
   FUNCTIONS FROM PUBLIC, anon, authenticated`. Função nova nasce sem `EXECUTE`
   para essas três roles.

   `PUBLIC` é parte indispensável da revogação: sem ela a inversão seria
   decorativa, porque `anon` e `authenticated` herdam o `EXECUTE` concedido a
   `PUBLIC` pelo default embutido do PostgreSQL.

2. **O acesso passa a ser concedido caso a caso**, na própria migration que cria a
   função — `GRANT EXECUTE ON FUNCTION public.<fn>(<args>) TO authenticated;`.
   Esquecer o grant agora quebra **fechado**: a chamada falha com erro de
   permissão, visível em teste, em vez de abrir acesso em silêncio.

3. **O resíduo é varrido.** A `297` revoga `PUBLIC` e `anon` de todas as funções
   de `public` pertencentes a `postgres`, e `authenticated` das funções de trigger
   (que rodam com o privilégio do owner e nunca são chamadas por RPC — mesma
   disciplina da `152`).

   `authenticated` é preservado nas demais: é o caminho normal do app. Verificado
   no levantamento que **nenhuma** função depende de `PUBLIC` ou `anon` para o
   acesso do usuário logado — as 38 com `PUBLIC` e as 51 com `anon` têm o grant de
   `authenticated` concedido à parte.

4. **Uma única exceção pré-autenticação viva:** `portal_ship_schedule()`, vitrine
   pública da programação de navios por decisão de projeto (achado A-02). A `297`
   a carve-out da varredura e reafirma o grant explicitamente.

5. **A exceção `anon` da ADR 0013 está encerrada.** A migration `182` revogou
   `anon` de `portal_resolve_login(text)` quando o login passou a ser resolvido
   pela Edge Function `portal-login` com `service_role`. O wrapper
   `portalResolveLogin` em `src/services/portalBilling.ts` é código morto, sem
   chamador de produção. Nenhuma migration deve reconceder esse grant.

## Escopo

As 219 funções de `public` pertencentes a `supabase_admin` são das extensões
`btree_gist` e `pg_trgm`. Não são do projeto e ficam intocadas — o default
invertido vale para `postgres`, o role que cria as funções do Transhipping Desk.

## Consequências

- **Novo requisito para toda migration que cria função destinada ao cliente:** o
  `GRANT EXECUTE ... TO authenticated` explícito. Sem ele, a função existe mas não
  é chamável pelo front-end.
- **Migrations com `DROP FUNCTION` + recriação passam a exigir o grant de volta.**
  São 23 arquivos históricos; o padrão vale daqui para frente.
- O modo de falha inverte: de "abriu sem ninguém perceber" para "quebrou no teste".
- A regra de processo da ADR 0011 (decisão 3) continua válida e correta, mas deixa
  de ser a única linha de defesa.
- Advisor de segurança: nenhum achado novo esperado; a superfície `anon` cai de 51
  funções para 1.

## Verificação

Contrato travado em `src/services/__tests__/defaultDenyFunctionGrantsMigration.test.ts`
(inversão do default, varredura, guarda anti-no-op, preservação de `authenticated`,
carve-out da vitrine e proibição de reconceder `portal_resolve_login`), com a
aplicação real provada em branch descartável do Supabase.
