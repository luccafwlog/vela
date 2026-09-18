# Caixa de ferramentas (`scripts/`)

Esta pasta guarda **comandos auxiliares** do projeto — pequenos programas que
automatizam tarefas chatas (sincronizar o Git, montar um banco de dados de
teste, conferir a documentação, etc.). Pense neles como os botões de uma
maquininha: cada um faz uma coisa específica.

> **Como rodar um comando?** Abra o **terminal** na pasta do projeto e cole a
> linha indicada.
> - **Windows:** abra o **PowerShell** (menu Iniciar → digite "PowerShell").
> - **macOS:** abra o **Terminal** (Launchpad → digite "Terminal").
>
> Antes, entre na pasta do projeto (uma vez por terminal):
> - Windows: `cd C:\Users\Lucca\Downloads\transhipping-desk2`
> - macOS: `cd ~/Downloads/transhipping-desk2` *(ajuste para onde o projeto estiver)*

> **Por que sempre dois comandos?** Windows e macOS falam "línguas" diferentes
> no terminal. Programas terminados em `.ps1` são de Windows; os terminados em
> `.sh` são de macOS/Linux. Os terminados em `.mjs`/`.cjs` são feitos em **Node**
> e funcionam igual nos dois — nesses casos o comando muda só a barra do caminho
> (`\` no Windows, `/` no macOS).

---

## 1. Sincronizar com o repositório (`sync-git`)

**O que faz:** puxa as novidades do projeto que estão no servidor (GitHub),
atualiza a sua cópia e limpa referências de branches que já não existem mais.
É o "baixar as últimas alterações" do dia a dia.

**Quando usar:** ao começar a trabalhar, para garantir que está com a versão
mais recente.

```powershell
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\sync-git.ps1
```
```bash
# macOS (Terminal)
bash scripts/sync-git.sh
```
> Atalho que funciona igual nos dois: `npm run sync`

---

## 2. Conferir a documentação (`check-docs`)

**O que faz:** varre a documentação do projeto procurando problemas — como links
que apontam para arquivos que não existem mais. É um "corretor" dos documentos.

**Quando usar:** depois de mexer em textos, rotas, ADRs ou playbooks (o próprio
projeto pede isso no `CLAUDE.md`).

```powershell
# Windows (PowerShell)
node scripts\check-docs.mjs
```
```bash
# macOS (Terminal)
node scripts/check-docs.mjs
```
> Atalho igual nos dois: `npm run docs:check`

---

## 3. Ambiente de testes local — banco + site na sua máquina (`design-audit/win/local-stack`)

**O que faz:** monta um **banco de dados de mentira dentro do seu computador**,
com dados de teste, para você abrir o site e ver as telas funcionando **sem
mexer no sistema real dos clientes**. Ele instala/liga o banco, coloca os dados
e liga o "tradutor" que faz o site conversar com esse banco.

**Quando usar:** quando quiser conferir visualmente uma mudança de tela (por
exemplo, revisar as melhorias da tela Viagens).

```powershell
# Windows (PowerShell) — PRIMEIRA VEZ (ou para zerar os dados de teste):
powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1 -Rebuild

# Windows (PowerShell) — no dia a dia (só religa o tradutor):
powershell -ExecutionPolicy Bypass -File scripts\design-audit\win\local-stack.ps1
```
```bash
# macOS (Terminal) — AINDA NÃO EMPACOTADO NUM COMANDO ÚNICO.
# O equivalente para Mac/Linux é montar o banco com o script abaixo (item 4)
# e depois ligar o "tradutor" à mão:
bash scripts/setup-local-pg.sh
node scripts/design-audit/sb-shim.cjs
```
Depois, em **outro** terminal, abra o site com `npm run dev` e acesse
<http://localhost:5173> (login de teste: `auditor@local.test` / `audit-local`).

> Detalhes e observações: veja [`design-audit/win/README.md`](design-audit/win/README.md).
> O "tradutor" é o arquivo `design-audit/sb-shim.cjs`; os arquivos `.sql`,
> `pg_cron.control` e `pg_cron--1.0.sql` são peças de apoio usadas pelo script —
> você não roda nenhum deles diretamente.

---

## 4. Banco de dados descartável para testar migrations (`setup-local-pg`)

**O que faz:** cria um banco de dados **temporário e descartável** com a
estrutura completa do sistema, para testar alterações de banco ("migrations")
sem tocar na produção. É uma bancada de laboratório.

**Quando usar:** ao criar ou revisar mudanças na estrutura do banco de dados.

> ⚠️ Este script foi feito para **Linux/macOS** (terminal `.sh`). No macOS ele
> exige um PostgreSQL instalado (por exemplo via Homebrew). **Não há versão
> Windows**; no Windows, use o item 3 acima, que cumpre o mesmo papel.

```powershell
# Windows (PowerShell) — não disponível; use o item 3 (local-stack.ps1 -Rebuild).
```
```bash
# macOS (Terminal)
bash scripts/setup-local-pg.sh
# para apagar e recriar do zero:
bash scripts/setup-local-pg.sh --reset
# valida a RPC/RLS da leitura do nome do closer (usuário ativo/inativo/anon):
LOCAL_PG_INTEGRATION=1 \
  LOCAL_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/vela_test \
  npx vitest run src/integration/agencyReportCloserName.local-pg.test.ts
```

---

## 5. Medir a "leveza" das páginas (`perf/measure-page-load`)

**O que faz:** calcula quanto "peso" (código) cada tela precisa carregar para
abrir. Serve para garantir que o site continua rápido.

**Quando usar:** ao investigar ou controlar a performance de carregamento.

```powershell
# Windows (PowerShell)
node --experimental-vm-modules scripts\perf\measure-page-load.mjs
```
```bash
# macOS (Terminal)
node --experimental-vm-modules scripts/perf/measure-page-load.mjs
```

---

## 6. Gerar a planilha da especificação (`build-behavioral-spec`)

**O que faz:** transforma a lista de comportamentos esperados do sistema (um
arquivo de texto/CSV) numa **planilha Excel** organizada, mais fácil de ler.

**Quando usar:** depois de atualizar a especificação de comportamento em
`docs/spec/`.

```powershell
# Windows (PowerShell)
node scripts\build-behavioral-spec.mjs
```
```bash
# macOS (Terminal)
node scripts/build-behavioral-spec.mjs
```

---

## 7. Sincronizar as "skills" do projeto (`skills:sync`)

**O que faz:** copia a árvore completa das skills versionadas para os destinos
locais do Vela (agentes compartilhados, Claude Code, Codex e os dois stores
pessoais encontrados no Antigravity), registrando ownership em
`~/.vela/skill-sync/`. Skills de sistema, plugins e o store builtin do
Antigravity ficam fora desse ownership.

**Quando usar:** revise primeiro com `--dry-run`; aplique depois do `git pull`.
O hook do Claude e o antigo instalador continuam funcionando como wrappers.
Na primeira instalação limpa, use `skills:reset`: ele cria um backup dos stores
pessoais, valida a árvore das skills e instala somente as 14 skills ativas.
Depois disso, `skills:sync` mantém as cópias atualizadas de forma incremental.
O ledger histórico contém as 37 remoções aprovadas e serve para auditoria e
migrações antigas; ele não substitui o reset total.

```powershell
# Windows (PowerShell) — simular
npm run skills:sync -- --dry-run
# Aplicar
npm run skills:sync
```

Para reconstruir os stores pessoais depois de uma limpeza planejada, simule
primeiro e aplique somente após conferir a lista:

```bash
npm run skills:reset
npm run skills:reset -- --apply
```

O reset cria backups em `~/.vela/skill-sync/backups/`. Ele não apaga as
configurações gerais dos aplicativos, históricos de conversas, credenciais, o
store `.system` do Codex, plugins ou o store builtin do Antigravity.
```bash
# macOS/Linux (Terminal) — simular
npm run skills:sync -- --dry-run
# Aplicar
npm run skills:sync
```

---

## 8. Baixar as fontes do site (`download-fonts`)

**O que faz:** baixa do Google Fonts as fontes usadas pelo site (IBM Plex Mono,
Syne e DM Sans) e as salva em `public/fonts/`, para o site servi-las localmente
sem depender do Google.

**Quando usar:** raramente — só se as fontes mudarem ou os arquivos em
`public/fonts/` forem perdidos. Rode a partir da pasta raiz do projeto.

```powershell
# Windows (PowerShell)
node scripts\download-fonts.mjs
```
```bash
# macOS (Terminal)
node scripts/download-fonts.mjs
```

---

## 9. Ensaio da migração do Demurrage Manager (`migracao-demurrage/dry-run`)

**O que faz:** lê os dados do **sistema antigo** (Demurrage Manager) junto com
duas planilhas exportadas dele, aplica todas as regras combinadas da migração e
imprime um **relatório de conferência**: quantos clientes, viagens, containers e
faturas atravessariam, e o que ainda está impedindo.

**Ele não muda nada.** Só lê e escreve na tela — não grava no sistema antigo,
não grava no Vela, não cria arquivo. É um ensaio.

**Quando usar:** antes da migração de verdade, e de novo no dia da virada (os
números mudam enquanto o sistema antigo continua em uso).

**O que você precisa ter em mãos:**

1. O **relatório** do sistema antigo (botão "Relatório", arquivo `.xlsx`);
2. A planilha de **reconciliação** (`.xlsx`), que traz o valor efetivamente pago;
3. E **uma das duas** formas de ler o sistema antigo:
   - o arquivo **JSON** exportado pelo próprio sistema (mais simples), ou
   - o endereço e a senha de acesso ao banco dele.

```powershell
# Windows (PowerShell) — usando o export em JSON
node scripts\migracao-demurrage\dry-run.mjs `
  --origem-json C:\caminho\export.json `
  --relatorio C:\caminho\relatorio.xlsx `
  --reconciliacao C:\caminho\reconciliacao.xlsx
```
```bash
# macOS (Terminal) — usando o export em JSON
node scripts/migracao-demurrage/dry-run.mjs \
  --origem-json ~/caminho/export.json \
  --relatorio ~/caminho/relatorio.xlsx \
  --reconciliacao ~/caminho/reconciliacao.xlsx
```

Para ler o banco do sistema antigo em vez do JSON, troque `--origem-json` por
estas variáveis (o acesso do sistema antigo exige login — sem ele a leitura
volta **vazia**, e o ensaio recusa rodar em vez de fingir que deu certo):

```bash
DEMURRAGE_LEGADO_URL=https://....supabase.co \
DEMURRAGE_LEGADO_KEY=chave \
DEMURRAGE_LEGADO_EMAIL=usuario@empresa.com \
DEMURRAGE_LEGADO_SENHA=senha \
node scripts/migracao-demurrage/dry-run.mjs --relatorio ... --reconciliacao ...
```

**Como ler o resultado:** no fim ele mostra **avisos** (coisas para olhar) e
**bloqueios** (coisas que impedem a carga). Com qualquer bloqueio, o comando
termina com erro de propósito — serve como portão antes da migração real.

> As regras ficam separadas em `migracao-demurrage/regras.mjs`. Para conferir se
> elas continuam corretas depois de qualquer mexida:
> `node scripts/migracao-demurrage/regras.check.mjs`

---

## 10. Usuário admin da Preview (`provision-preview-admin`)

**O que faz:** cria ou atualiza o usuário `qa-admin@example.test` usando a Auth
Admin API e garante o perfil interno `admin` na branch Supabase indicada pelas
variáveis `SUPABASE_URL` e `SUPABASE_SECRET_KEY` (ou a chave legada
`SUPABASE_SERVICE_ROLE_KEY`).

O uso normal é automático pelo workflow
`.github/workflows/provision-preview-admin.yml`, depois que a branch Preview
está saudável. A senha vem de `PREVIEW_ADMIN_PASSWORD` e nunca deve ser
colocada em `VITE_*` ou no repositório.

O upsert de `user_profiles` usa `service_role` server-side e depende da
migration `042_preview_admin_service_role_grant.sql`, que concede somente
`SELECT`, `INSERT` e `UPDATE` nessa tabela. Em um rerun, se a política atual do
Auth rejeitar a senha que já existe, o script preserva a senha e repara o
restante do fixture sem expor ou substituir a credencial silenciosamente.

> O step `Load branch credentials` do workflow não anexa a saída do CLI
> direto ao `$GITHUB_ENV`: o `supabase branches get -o env` emite formato
> dotenv (`KEY="valor"`) e o `$GITHUB_ENV` espera valor cru — sem decodificar,
> cada credencial chegava com aspas literais e o provisionamento quebrava em
> `Invalid supabaseUrl`. A decodificação mora em `load-branch-env.mjs`
> (com regressão em `load-branch-env.test.mjs`, via `node --test`).

---

## 11. Reconstruir o schema consolidado v1.0 (`build-squash-migrations`)

**O que faz:** recorta um `pg_dump` do schema `public` em
`supabase/migrations/001_initial_schema.sql` (estrutura) e
`supabase/migrations/002_business_logic_and_security.sql` (lógica e segurança).
É o script que gerou o squash descrito na ADR 0062 — está aqui para tornar a
regeneração auditável, não para uso rotineiro.

**Como rodar:** o script espera um arquivo `dump_public_with_privs.sql` na pasta
onde você o executa, e escreve o resultado em `supabase/test_001_*.sql` e
`supabase/test_002_*.sql` para conferência antes de qualquer substituição.

```
node scripts/build-squash-migrations.mjs
```

Check runnable (sem dump, <1s, roda no CI): trava as invariantes que já
quebraram o squash uma vez — `pg_trgm` em `public`, seeds manuais do catálogo
de alertas e das baselines, e ausência de referências do 001 para funções
definidas só no 002, além do revoke global de defaults de funções:

```
node scripts/build-squash-migrations.mjs --self-check
```

> **Atenção — o que o dump não carrega.** O recorte é do schema `public`. Três
> classes de objeto vivem fora dele e **não voltam** numa regeneração: os
> defaults de privilégio (`pg_default_acl`, ADR 0047), os agendamentos
> `pg_cron` (schema `cron`) e os buckets e policies de Storage (schema
> `storage`). Regenerar sem reaplicar essa camada derruba, em silêncio, toda a
> automação agendada e os anexos. Veja o item 5 da ADR 0062.

Após a regeneração, preserve e valide também as migrations pós-squash
`003`–`006`; a `006` é o contrato de convergência para bancos já provisionados
e não deve ser substituída pelo dump.

---

### Resumo rápido

| Ferramenta | Para quê serve |
|---|---|
| `sync-git` | Baixar as últimas alterações do projeto |
| `check-docs` | Conferir a documentação (links quebrados) |
| `design-audit/win/local-stack` | Subir banco + site de teste na sua máquina (Windows) |
| `setup-local-pg` | Banco descartável para testar migrations (macOS/Linux) |
| `perf/measure-page-load` | Medir a leveza/velocidade das telas |
| `build-behavioral-spec` | Gerar a planilha Excel da especificação |
| `skills:report` | Inventariar as 14 skills nos stores pessoais |
| `skills:usage` | Medir sinais observáveis de uso por aplicativo |
| `skills:reset` | Simular ou reconstruir os stores pessoais com backup |
| `skills:sync` | Sincronizar skills Vela com ownership e dry-run |
| `download-fonts` | Rebaixar as fontes do site para `public/fonts/` |
| `migracao-demurrage/dry-run` | Ensaiar a migração do Demurrage Manager (só lê) |
| `provision-preview-admin` | Provisionar o usuário admin da branch Preview |
| `load-branch-env` | Decodificar o `-o env` do CLI para o `$GITHUB_ENV` (usado pelo provisionamento) |
| `build-squash-migrations` | Reconstruir o schema consolidado v1.0 a partir de um dump |
