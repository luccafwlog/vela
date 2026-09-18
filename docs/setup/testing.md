# Testes

> Framework: **Vitest** + Testing Library. Build com `tsc -b` faz a verificação de tipos.

## Comandos

```bash
npm test                    # Vitest (unitários) — rápido, sem rede
npm run test:integration    # Integração contra Supabase REAL (opt-in)
npm run docs:check          # Consistência da documentação
npm run typecheck           # TypeScript sem emitir bundle
npm run lint                # ESLint (flat config)
npm run build               # tsc -b + vite build (tipos + bundle)
npm run size-limit          # Orçamento de JS (após o build)
```

## Unitários

Ficam em `src/**/__tests__/*.test.ts` e `src/pages/__tests__/`. Cobrem, entre outros:

- **Parsers de import:** `blParser`, `breakbulkImport`, `baplieParser` e fixtures reais (`*Fixtures.real.test.ts`).
- **Financeiro:** `localCharges`, `Faturamento`, `TaxasLocais`, `reconciliacao`.
- **Demurrage:** `src/services/demurrage/__tests__/calculateDemurrage.test.ts`.
- **B/L status / review:** `blRails`, `useBlCockpit`, `blPortalStatus`.
- **Migrations/ledger:** testes que validam o efeito de migrations específicas (ex.: `portalResolveLoginHardeningMigration`).

Fixtures de regressão de parser ficam junto aos testes em `src/services/__tests__/`. Ao adicionar um parser novo, adicione fixtures e siga a seção de importações do `WORKFLOW.md`.

## Integração (opt-in)

`src/integration/supabase.integration.test.ts` só roda com `SUPABASE_RUN_INTEGRATION=1` e credenciais extras no `.env`:

```env
SUPABASE_RUN_INTEGRATION=1
SUPABASE_URL=…
SUPABASE_ANON_KEY=…
SUPABASE_INTEGRATION_EMAIL=…
SUPABASE_INTEGRATION_PASSWORD=…
# IDs de teste: SUPABASE_TEST_VOYAGE_ID, SUPABASE_TEST_BL_ID, SUPABASE_TEST_BILLING_BL_IDS …
```

> **Nunca** rodar a suíte de integração em CI compartilhado ou contra produção — ela exige um ambiente Supabase isolado de validação.

## Orçamento de carga das rotas (performance)

`scripts/perf/measure-page-load.mjs` mede o custo de "page load" por rota e por
superfície — a quantidade de JS que o navegador precisa baixar e fazer
parse/compile para renderizar a rota numa visita fria (rede e dados ficam fora
por decisão, ver o cabeçalho do script). Ele usa `index.html` +
`src/AppInterno.tsx` para o sistema interno e `portal.html` + `src/AppPortal.tsx`
para o Portal Fwlog. Cada rota deve ficar abaixo de **50 ms** de
parse/compile (mediana de 7 execuções).

```bash
npx vite build                                                   # gera dist/.vite/manifest.json
node --experimental-vm-modules scripts/perf/measure-page-load.mjs
```

O harness depende de `build.manifest` habilitado em `vite.config.ts` para
resolver o grafo de chunks de cada rota. Não roda no CI; é uma verificação
manual para mudanças que afetem o peso do bundle (ex.: importar uma biblioteca
pesada como `@e965/xlsx` deve usar `await import(...)` lazy, não import estático).

## Critério de "verde" antes de PR

Antes de um PR, `npm run docs:check`, `npm run lint`, `npm test`, `npm run build` e `npm run size-limit` devem passar. O workflow `ci.yml` executa documentação + lint, build + orçamento de bundle e a suíte de testes em três shards; o job `checks` agrega esses resultados — ver [deploy.md](deploy.md).

## Validação manual

Fluxos que dependem de Auth/RLS/RPC/Edge Functions têm roteiro manual em [operations/validacao.md](../operations/validacao.md).
