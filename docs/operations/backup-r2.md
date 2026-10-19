# Backup lógico cifrado em Cloudflare R2 — M10 R2

O script `scripts/backup-r2.mjs` (plano M10 da Issue 710) gera um dump lógico
do schema `public`, cifra o arquivo antes de qualquer upload e envia o
resultado para um bucket R2 privado. Em produção ele roda diariamente numa
tarefa agendada desde 2026-09-24; onde roda, bucket, retenção e token estão no
[manual de serviços externos](servicos-externos.md#backup), e a restauração foi
testada em 2026-10-05 ([estado operacional](#estado-operacional-conferido-em-2026-10-05)).
O script em si não cria recursos Cloudflare, não habilita PITR, não se agenda e
não executa restore.

## Contrato de segurança

- O padrão do comando é `--dry-run`; ele não executa `pg_dump`, não cria arquivo
  e não acessa R2.
- A URL do Postgres, a chave AES e as credenciais R2 entram somente por
  variáveis de ambiente injetadas no processo. O script nunca imprime esses
  valores, nunca os grava no manifesto e remove a URL bruta antes de iniciar o
  cliente PostgreSQL.
- O dump é cifrado localmente com AES-256-GCM em streaming. O arquivo plaintext
  não é persistido pelo script. O `.dump.enc` é validado com
  `pg_restore --list` antes do upload.
- O upload usa a API S3-compatible do R2, mas não há `wrangler`, criação de
  bucket, alteração de ACL ou exclusão de objeto no repositório.
- `--environment production` é bloqueado, a menos que o operador forneça
  simultaneamente `--allow-production` e `BACKUP_ALLOW_PRODUCTION=YES` após a
  aprovação operacional. É a combinação usada pela tarefa diária de produção.

O dump é deliberadamente limitado ao schema `public`, que contém as entidades
de negócio do Vela. Schemas gerenciados pelo Supabase, usuários do Auth e bytes
do Storage não são tratados por este artefato; PITR/Supabase e o procedimento
de restore para um projeto descartável continuam sendo camadas separadas.

## Pré-requisitos locais

Instale Node 24, os binários de cliente PostgreSQL (`pg_dump` e `pg_restore`) e
AWS CLI v2. A AWS CLI é usada apenas como cliente S3; nenhuma credencial deve
ser colocada em `.env`, no repositório ou na linha de comando.

```powershell
pg_dump --version
pg_restore --version
aws --version
```

O ponto de entrada é `scripts/backup-r2.mjs`:

```powershell
npm run backup:r2:test
```

## Dry-run

O ensaio não precisa de credenciais:

```powershell
npm run backup:r2 -- --dry-run --environment staging --project-ref <PROJECT_REF>
```

O resultado lista o plano, o destino local e os efeitos esperados, ocultando
valores de conexão, chave de cifragem e credenciais R2.

## Execução autorizada

Carregue as variáveis por um gerenciador de segredos, sessão protegida ou
secret store do runner. Os nomes esperados são:

| Variável | Conteúdo | Persistência permitida |
|---|---|---|
| `SUPABASE_DB_URL` ou `DATABASE_URL` | URL de conexão PostgreSQL com SSL | somente no ambiente do processo |
| `BACKUP_ENCRYPTION_KEY_HEX` | 64 dígitos hexadecimais, 32 bytes | password manager separado do R2 |
| `R2_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` | configuração não secreta do runner |
| `R2_BUCKET` | bucket privado já criado | configuração não secreta do runner |
| `R2_PREFIX` | opcional; padrão `vela/database` | configuração não secreta do runner |
| `R2_ACCESS_KEY_ID` | Access Key do token R2 | secret store |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key do token R2 | secret store |
| `SUPABASE_PROJECT_REF` | referência não secreta do projeto | configuração não secreta do runner |
| `BETTERSTACK_HEARTBEAT_BACKUP_URL` | opcional; URL do heartbeat do backup no Better Stack | variável do usuário no runner; não imprimir |

Depois de carregar os valores, repita o dry-run e só então execute:

```powershell
npm run backup:r2 -- --execute --environment staging --project-ref <PROJECT_REF>
```

Para produção, a proteção adicional é intencional:

```powershell
$env:BACKUP_ALLOW_PRODUCTION = 'YES'
npm run backup:r2 -- --execute --allow-production --environment production --project-ref <PROJECT_REF>
```

O comando falha fechado quando o destino local já contém o mesmo nome. O
manifesto ao lado do dump registra somente metadados não secretos, incluindo
SHA-256, tamanho, ambiente, projeto, retenção pretendida e o resultado de
`pg_restore --list`. A retenção de 90 dias deve ser aplicada por lifecycle rule
no R2; o script não apaga objetos.

Para validar um artefato já baixado, sem restaurar nada:

```powershell
$env:BACKUP_ENCRYPTION_KEY_HEX = '<64_HEX_CHARS_FROM_PASSWORD_MANAGER>'
npm run backup:r2 -- --verify C:\caminho\<arquivo>.dump.enc
```

## Heartbeat do backup

Com `BETTERSTACK_HEARTBEAT_BACKUP_URL` definida, cada `--execute` avisa o Better
Stack no fim: a URL quando o backup sobe ao R2, a URL com `/fail` quando falha
([ADR 0083](../adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 6).
Se a tarefa não roda (computador desligado, tarefa desabilitada), o aviso não
chega e o heartbeat fica **Down** depois do prazo. Dry-run e `--verify` não
avisam. Uma falha ao avisar não muda o resultado do backup e não imprime a URL.

Cada `--execute` também acrescenta uma linha ao arquivo `backup-r2.log`, na
pasta dos dumps (`%TEMP%\vela-r2-backups` no computador do backup, ou o
`--output-dir` usado): `ok: <objeto enviado>` ou `falha: <motivo>`. A tarefa
agendada descarta o que o script imprime, então esse arquivo é o único lugar
onde fica o motivo da falha. O motivo traz o fim da mensagem de erro do
`pg_dump`, do `pg_restore` ou da AWS CLI, que não contêm senha, chave nem
credencial. O arquivo não é enviado ao R2 nem apagado pelo script.

Para ligar:

1. No Better Stack, em `Uptime > Heartbeats > Create heartbeat`, crie
   `backup-r2-diario` com período de 1 dia e tolerância de 6 horas (a tarefa
   roda às 09:00 ou quando o computador liga). Copie a URL.
2. No computador da tarefa, crie a variável do usuário
   `BETTERSTACK_HEARTBEAT_BACKUP_URL` com essa URL, como as outras variáveis do
   backup, e atualize a cópia local do repositório para a versão com o
   heartbeat.
3. Rode a tarefa `Backup Diario Vela R2` à mão uma vez e confira o heartbeat
   **Up** no Better Stack.

Quando o heartbeat acusa **falha** (`Reported failure`), no computador do
backup:

1. Leia o motivo nas últimas linhas do registro:
   `Get-Content "$env:TEMP\vela-r2-backups\backup-r2.log" -Tail 5`.
2. Confira se a pasta da tarefa está na `main` (`git status -sb` em
   `C:\Users\Lucca\Downloads\Vela` deve mostrar `## main...origin/main`); se
   não estiver, `git switch main` e `git pull`.
3. Corrija a causa e rode a tarefa `Backup Diario Vela R2` à mão; o heartbeat
   volta a **Up** com o aviso de sucesso.

## Montar o backup em outro ambiente

Passos usados para montar o backup de produção (estado atual no
[manual de serviços externos](servicos-externos.md#backup)) e para repeti-lo em
outro projeto ou computador. Exigem conta autenticada:

1. No Supabase Dashboard, abra o projeto `fgmkhbzhaeebrsizwccx`, entre em
   `Database > Backups` e confirme a cobertura de backup diário e o custo/limite
   do plano atual. A ADR 0074 decidiu não contratar PITR; este procedimento
   não o habilita. Não use a tela de restore para testar a montagem.
2. Em `Connect`, obtenha a string de conexão adequada para o runner (Session
   pooler por padrão; conexão direta se a rede tiver IPv4/add-on). Injete-a no
   ambiente do processo, sem colá-la em arquivo, log, issue ou comando salvo.
3. No Cloudflare Dashboard, abra `R2 > Overview > Create bucket`, crie o bucket
   de backup com acesso público desabilitado e sem domínio público. Configure
   uma lifecycle rule para expirar objetos após 90 dias, validando a regra com
   um objeto de teste não sensível.
4. Em `R2 > Overview > Manage R2 API Tokens`, crie um token com `Object Read &
   Write` restrito exclusivamente ao bucket de backup. Copie o Access Key ID e
   o Secret Access Key uma única vez para o secret store do runner; nunca os
   registre no GitHub, neste repositório ou em logs.
5. Registre no secret store o endpoint S3 do R2, a região `auto`, o bucket e o
   prefixo. Não habilite acesso anônimo, presigned URL público ou uma policy de
   leitura ampla.
6. Em um runner autenticado e controlado (Task Scheduler, cron ou outro
   executor operacional), agende o comando diário. O primeiro ciclo deve ser
   dry-run, seguido de uma execução autorizada e da conferência do manifesto,
   SHA-256 e presença dos dois objetos privados. Este repositório não adiciona
   workflow GitHub para evitar acoplar credenciais de banco e R2 ao CI.
7. Para o ensaio trimestral de restore, crie/selecionе uma branch ou projeto
   Supabase descartável no Dashboard, baixe um dump cifrado, valide-o com
   `--verify` e só depois siga o runbook de restore da Supabase. O restore é
   destrutivo no alvo escolhido e não é feito pelo script; não o execute em
   produção.

Os rótulos do Dashboard podem mudar. A validação remota deve registrar o
ambiente, a data, o projeto e os objetos encontrados, mas nunca valores de
segredo. As referências técnicas atuais são a documentação de backup lógico da
Supabase e a API S3-compatible do R2.

## Estado operacional conferido em 2026-10-05

O [manual de serviços externos](servicos-externos.md#backup) registra o
agendamento e a primeira execução em 2026-09-24. A tarefa Windows
`Backup Diario Vela R2` foi encontrada nesta máquina, com próxima execução
em 2026-10-06 às 09:00. A execução agendada de 2026-10-05 às 09:00:01
retornou `LastTaskResult = 2`, o código genérico de falha do script. A causa
foi o fechamento antecipado de `pg_restore --list` (`EPIPE`) na verificação,
corrigido em `consumeArchive`. Com a correção, uma execução manual no mesmo
dia cifrou, verificou e enviou o dump ao R2, e ele foi restaurado no banco
local descartável `vela_restore_20261005` (nota de encerramento da ADR 0074).

A tarefa executa o script da cópia local do repositório, que precisa conter a
correção. A primeira execução agendada que a comprova é a de 2026-10-06; se
ela retornar código diferente de 0, diagnostique antes de considerar o backup
diário ativo. `--verify` executa somente `pg_restore --list`; não restaura o
banco e não substitui o teste de restauração em alvo descartável.

Conferência no R2 em 2026-10-08: há par `.dump.enc` + `.manifest.json` às
12:00:01 UTC (09:00 de Brasília) em 2026-10-06, 2026-10-07 e 2026-10-08. O
manifesto só sobe depois de cifrar e verificar o dump, então a execução
agendada está concluindo desde a correção. Não há backups de 2026-10-01 a
2026-10-04; com a tarefa dependente de um computador ligado, ausência de
arquivo num dia é o primeiro sinal a procurar.
