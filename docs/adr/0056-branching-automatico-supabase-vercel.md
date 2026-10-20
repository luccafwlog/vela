# ADR 0056 — Branching automático entre Supabase, GitHub e Vercel

> **Situação atual (2026-10-14).** A parte Vercel não vale mais: desde a [ADR 0076](./0076-cloudflare-pages-como-hosting.md), GitHub Actions publica os dois SPAs no Cloudflare Pages e os projetos Vercel ficam só para rollback manual. O Automatic branching do Supabase também não vale: o dono decidiu em 2026-10-07 mantê-lo desligado ([plano arquivado](../archive/plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md)), decisão registrada na [ADR 0084](./0084-registro-de-decisoes-ja-em-producao.md) (item 2); a branch de Preview só existe quando criada à mão no painel e vinculada à branch da PR por "Sync with Git branch", com custo por hora e remoção após o teste. Continuam o Preview isolado por PR e o Deploy to production só a partir de `main`.
> As migrations `351`–`356` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> A branch persistente `staging` criada em 2026-10-19 não reabre a rejeição de `stagingtdesk` abaixo: as PRs continuam com Preview próprio e destino `main`; `staging` é um ambiente fixo de QA e treino, atualizado por push na git branch `staging` ([Deploy](../setup/deploy.md#staging-persistente)).
> Regra vigente em [Deploy](../setup/deploy.md), seção "Workflows", e em [Serviços externos](../operations/servicos-externos.md), seção "Supabase".

Status: supersedida parcialmente — 2026-08-27

- **Decide:** usar uma branch automática do Supabase para cada branch/PR do
  GitHub e ligar cada Preview do Vercel à branch correspondente.

## Contexto

O projeto precisa de um `main` de produção e de ambientes de Preview isolados
para validar schema, Auth, Storage, Edge Functions e frontend juntos. Uma
branch persistente compartilhada mistura alterações de PRs e exige coordenação
manual. Uma variável Preview fixa também não pode apontar para o project ref
aleatório de todas as branches automáticas.

## Decisão

O Automatic branching permanece habilitado na integração GitHub do Supabase,
com diretório de trabalho na raiz (`.`) e sincronização para o repositório
`luccafwlog/vela`. Cada branch do GitHub usada em uma PR recebe uma branch
Supabase efêmera correspondente; as migrations de `supabase/migrations/` e os
demais artefatos declarados são executados pelo branch action do Supabase.

Os projetos Vercel `vela` e `fwlog-portal` permanecem ligados ao mesmo
repositório pelo GitHub Integration. A integração de branching Supabase com
Vercel também fica instalada e conectada aos dois projetos. Ao abrir a PR, ela
atualiza as variáveis de ambiente do Preview de cada projeto com a URL e a
chave pública da branch Supabase correspondente e reimplanta o Preview se
necessário por causa da ordem das operações.

As variáveis consumidas pelo Vite continuam sendo `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY`; seus valores de Preview são gerenciados pela
integração, não versionados nem definidos como um valor global fixo. `main`
usa as credenciais do projeto Supabase de produção. A opção **Deploy to
production** do Supabase permanece habilitada somente para o fluxo de `main`.

## Consequências

- Cada PR testa seu próprio schema e não recebe dados de produção.
- Não existe branch Supabase compartilhada nem secret PostgreSQL no Vercel.
- A criação da branch Supabase e a atualização das variáveis de Preview são
  assíncronas; o primeiro Preview pode ser reimplantado automaticamente.
  <!-- Nota editorial (2026-08-28): enquanto as variáveis não chegam, o primeiro
  deploy falhava no guard de `vite.config.ts` e aparecia como erro em toda PR.
  `scripts/vercel-build.mjs` passou a publicar apenas uma página de espera nesse
  caso; a decisão desta ADR não muda. Ver `docs/setup/deploy.md`. -->
- Branches de Preview são efêmeras e devem ser usadas para validação da PR,
  não como ambiente de dados persistente.
- A política de CORS aceita os aliases gerados pelo projeto Vercel e URLs
  exatas configuradas manualmente, mas não aceita wildcard de qualquer projeto
  `vercel.app`.

## Histórico de migrations já aplicadas

As migrations `351`–`356` foram aplicadas em `main` e corrigiram drift de schema
e de identidade no histórico remoto. Elas não podem ser apagadas ou editadas
sem quebrar o histórico dos ambientes; a remoção da branch persistente não
exige uma migration de reversão. Seus efeitos são idempotentes e compatíveis
com a produção e com novas branches automáticas.

## Rejeitadas

- Branch persistente `stagingtdesk` como destino de todas as PRs: mistura
  estados e não representa o Preview isolado da PR.
- Workflow próprio que aplica migrations de PR em um banco compartilhado:
  duplica a responsabilidade da integração Supabase e cria drift entre o
  branch action e o histórico de produção.
- `VITE_SUPABASE_URL` ou `VITE_SUPABASE_ANON_KEY` global de Preview apontando
  para uma branch fixa.
