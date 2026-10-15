# 0010 — Validação, testes e gates de deploy

> **Situação atual (2026-10-15).** Estendida pela [ADR 0086](./0086-ci-confere-na-medida-da-mudanca.md): o CI roda só em PR e confere na medida do que ela muda (suítes SQL só quando o diff toca o banco, ordem invertida semanal); a produção publica no push em `main` depois do check do Supabase.

> **Situação atual (2026-10-13).** Continuam valendo os testes, o lint, o build e a validação manual registrada, ampliados com `docs:check`, `migrations:check` e o replay das migrations no CI.
> Não vale mais a publicação pela integração GitHub/Vercel: o GitHub Actions publica as duas SPAs no Cloudflare Pages depois do CI, e a Vercel fica só para rollback manual ([ADR 0076](./0076-cloudflare-pages-como-hosting.md); a [ADR 0066](./0066-transicao-marca-vela.md) já tinha trocado o Firebase Hosting pela Vercel).
> As migrations são aplicadas no merge pela integração GitHub do Supabase ([ADR 0056](./0056-branching-automatico-supabase-vercel.md)); o Automatic branching por PR foi desligado pelo dono em 2026-10-07, ainda sem ADR, e a branch de Preview do banco é criada à mão. A [ADR 0016](./0016-migrations-nomenclatura-numerada-sequencial.md), a [ADR 0023](./0023-distribuicao-skills-fonte-unica-instalador-node.md) e a [ADR 0062](./0062-consolidacao-migrations-schema-1-0.md) também estendem esta decisão.
> Regra vigente em [WORKFLOW.md](../../WORKFLOW.md), seções "11. Testes e validação" e "12. CI e deploy", e em [Deploy](../setup/deploy.md).

> **Nota editorial — 2026-09-18 · estendida.** Os gates originais permanecem; a entrega passou a cobrir duas SPAs. O CI valida/reproduz migrations em banco descartável; a aplicação remota é da integração de branching Supabase, conforme WORKFLOW.
> Rastreabilidade: [ADR 0056](./0056-branching-automatico-supabase-vercel.md), [ADR 0066](./0066-transicao-marca-vela.md); [migration ativa 003](../../supabase/migrations/003_pos_squash_objetos_fora_do_dump.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-06-09

## Contexto

O Transhipping Desk está em produção e combina SPA, Supabase, migrations, Edge Functions, parsers de arquivos, documentos financeiros e fluxos com dinheiro real. Um erro pode afetar operação portuária, cobrança ou acesso do cliente.

Nem todo fluxo é testável localmente sem Supabase real, mas mudanças precisam ter um critério consistente de pronto.

## Decisão

Usar uma combinação de testes automatizados, validação manual documentada e build/deploy automatizado.

- `npm test` roda Vitest para services, helpers, componentes, páginas testáveis, parsers, fixtures reais e testes de migrations por leitura de SQL.
- `npm run build` é gate obrigatório de TypeScript + Vite.
- `npm run lint` deve permanecer verde antes de PR quando a mudança toca código.
- `src/integration/supabase.integration.test.ts` é opt-in e só roda com variáveis `SUPABASE_*` e `SUPABASE_RUN_INTEGRATION=1`.
- `docs/operations/validacao.md` é o roteiro manual para fluxos que exigem Supabase real, autenticação, RLS, dados persistidos, portal ou smoke operacional.
- GitHub Actions valida o código; a integração GitHub/Vercel faz os dois builds e publica os projetos Vela e Portal em PRs e em push para `main`.
- Migrations Supabase não são aplicadas automaticamente pelo CI; precisam ser aplicadas no projeto Supabase antes do deploy de código dependente.
- `src/types/database.ts` é gerado e não deve ser editado manualmente.

## Consequências

- **Positivas**: regressões comuns entram na suíte rápida; migrations críticas podem ter testes textuais; deploy da SPA é repetível; validação manual deixa evidência quando o ambiente real é necessário.
- **Negativas / custos**: ainda há lacunas em E2E de portal, auth e fluxos financeiros completos; aplicar migrations continua sendo uma etapa operacional fora do CI.
- **Regra prática**: mudança funcional só está pronta quando passou pelos comandos aplicáveis e, quando depender de Supabase real, tem validação manual registrada ou uma justificativa clara de por que não foi executada neste ambiente.
