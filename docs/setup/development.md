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
```

Em `main`, o Cloudflare Pages usa as credenciais públicas de produção. Nos
Previews, o workflow usa as credenciais públicas da branch Supabase de Preview
vinculada à PR, criada à mão no painel (o Automatic branching está desligado;
ver [deploy.md](deploy.md#workflows)); não cadastre um valor global fixo para
Preview. Como todo
`VITE_*` chega ao bundle do navegador, não coloque segredos server-side nelas.

Sem `VITE_SUPABASE_*` a aplicação loga erro e o cliente Supabase fica vazio. As demais variáveis (`SUPABASE_*`) são usadas apenas nos [testes de integração](testing.md).

## 3. Banco de dados

Aplique **todas** as migrations em ordem, no **SQL Editor** do Supabase:

```
supabase/migrations/001_*.sql  →  último arquivo numerado em `supabase/migrations/`
```

> As migrations são numeradas sequencialmente (schema + RLS + RPCs); ver ADR 0016. O CI e o Cloudflare Pages **não** aplicam migrations no Supabase — ver [deploy.md](deploy.md); o job `migration-replay` do CI aplica as migrations do zero num PostgreSQL 16 descartável só para travar invariantes, sem tocar em nenhum projeto. Para criar uma nova migration, siga a seção de migrations do `WORKFLOW.md` e derive o próximo número do repositório com `ls supabase/migrations/ | sort | tail -1`.

## 4. Usuário interno

No **Supabase Auth**, crie o usuário e insira o perfil:

```sql
INSERT INTO public.user_profiles (id, role, active)
VALUES ('<auth-user-uuid>', 'administrativo', true);
```

Os setores aceitos no `role` e o que cada um pode estão em
[Segurança § Roles internas](../operations/seguranca.md#roles-internas); a tela
que os gerencia é a [Administração](../modules/operacao-suporte.md#admin).

## 5. Edge Functions (opcional no dev local)

Os nomes dos segredos das Edge Functions têm um único dono: a tabela
[Secrets das Edge Functions](../operations/servicos-externos.md#secrets-das-edge-functions)
do manual de serviços externos. Para o Portal funcionar, o mínimo é
`PORTAL_PASSWORD_PEPPER` (antes de publicar as funções de login e senha),
`PORTAL_LOGIN_DUMMY_AUTH_USER_ID` (UUID de uma identidade técnica confirmada,
sem vínculo em `customer_portal_accounts`, que equaliza o custo do login com
CNPJ inexistente), `PORTAL_FROM_EMAIL`, `PORTAL_REPLY_TO` e `RESEND_API_KEY`;
a MillionSend envia convites, recuperação de senha, resumo diário, Comunicados e
Cobrança de Demurrage.

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
