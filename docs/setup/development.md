# Desenvolvimento local

> Como rodar o Vela e o Portal Fwlog na sua máquina. Para deploy ver [deploy.md](deploy.md); para testes ver [testing.md](testing.md).

## Pré-requisitos

- **Node.js 24.x**
- Projeto **Supabase** com as migrations aplicadas (ver abaixo)

## 1. Dependências

O repositório usa peer deps que exigem `--legacy-peer-deps`:

```bash
npm ci --legacy-peer-deps
```

## 2. Variáveis de ambiente

```bash
cp .env.example .env
```

Preencha no `.env` (mínimo para o app subir):

```env
VITE_SUPABASE_URL=https://<projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_TURNSTILE_SITE_KEY=<sitekey de teste>
```

No Vercel, `main` usa as credenciais públicas de produção. Nos Previews, a
integração de branching do Supabase sincroniza essas mesmas variáveis com a
branch Supabase automática correspondente à PR; não cadastre um valor global
fixo para Preview. Como todo `VITE_*` chega ao bundle do navegador, não coloque
segredos server-side nelas.

Sem `VITE_SUPABASE_*` a aplicação loga erro e o cliente Supabase fica vazio. As demais variáveis (`SUPABASE_*`) são usadas apenas nos [testes de integração](testing.md).

No Supabase local, use somente as chaves de teste documentadas pelo Cloudflare
e configure `TURNSTILE_SECRET_KEY` e `TURNSTILE_ALLOWED_HOSTNAMES=localhost`
no ambiente local das Edge Functions. Não use o secret de produção na máquina.

## 3. Banco de dados

Aplique **todas** as migrations em ordem, no **SQL Editor** do Supabase:

```
supabase/migrations/001_*.sql  →  último arquivo numerado em `supabase/migrations/`
```

> As migrations são numeradas sequencialmente (schema + RLS + RPCs); ver ADR 0016. O CI e a Vercel **não** aplicam migrations no Supabase — ver [deploy.md](deploy.md); o job `migration-replay` do CI aplica as migrations do zero num PostgreSQL 16 descartável só para travar invariantes, sem tocar em nenhum projeto. Para criar uma nova migration, siga a seção de migrations do `WORKFLOW.md` e derive o próximo número do repositório com `ls supabase/migrations/ | sort | tail -1`.

## 4. Usuário interno

No **Supabase Auth**, crie o usuário e insira o perfil:

```sql
INSERT INTO public.user_profiles (id, role, active)
VALUES ('<auth-user-uuid>', 'administrativo', true);
```

Roles disponíveis: `administrativo` · `financeiro` · `operacoes` · `documentacao` (ver [Admin Usuários](../modules/operacao-suporte.md#admin-usuários) e [Segurança](../operations/seguranca.md)).

## 5. Edge Functions (opcional no dev local)

Variáveis necessárias nas Edge Functions do Supabase:

| Variável | Descrição |
|---|---|
| `RESEND_API_KEY` | Chave Resend (envio de email de invoice) |
| `FROM_EMAIL` | Remetente (ex: `Transhipping <noreply@…>`) |
| `PORTAL_URL` | URL base do portal do cliente |
| `APP_URL` | URL do app usada pelas Edge Functions do Portal |
| `VERCEL_PREVIEW_ORIGINS` | Opcional; URLs HTTPS exatas de Preview, separadas por vírgula, para CORS sem wildcard |
| `PORTAL_LOGIN_DUMMY_AUTH_USER_ID` | UUID de identidade técnica confirmada, sem vínculo em `customer_portal_accounts`, usada para equalizar o custo de logins com CNPJ inexistente |

## 6. Rodar

```bash
npm run dev          # http://localhost:5173
```

## Scripts disponíveis

```bash
npm run dev          # servidor de desenvolvimento (Vite)
npm run build        # build de produção (tsc -b + vite build)
npm run lint         # ESLint (flat config)
npm test             # testes unitários (Vitest)
npm run test:integration  # testes de integração com Supabase real (opt-in)
npm run sync         # git fetch + pull --ff-only
```

O mesmo servidor local atende as duas superfícies: use `/login` para o sistema
interno e `/portal/login` para o Portal Fwlog. O middleware de desenvolvimento
seleciona o HTML correto (`index.html` ou `portal.html`) sem alterar a URL da
rota no navegador.

## Reset de dados de teste

Para zerar dados operacionais entre rodadas, ver [operations/reset-ambiente.md](../operations/reset-ambiente.md).
