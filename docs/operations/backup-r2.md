# Backup lógico cifrado em Cloudflare R2 — M10 R2

Este procedimento implementa o runner local do plano M10 da Issue 710. O
comando gera um dump lógico do schema `public`, cifra o arquivo antes de
qualquer upload e envia o resultado para um bucket R2 privado. A integração
Windows busca segredos no Credential Manager e pode instalar uma tarefa diária
às 09:00 locais, com recuperação de execução perdida. Ela não cria recursos
Cloudflare, não habilita PITR nem executa restore.

## Contrato de segurança

- O padrão do comando é `--dry-run`; ele não executa `pg_dump`, não cria arquivo
  e não acessa R2.
- A URL do Postgres, a chave AES e as credenciais R2 entram somente por
  variáveis de ambiente injetadas no processo. O script nunca imprime esses
  valores, nunca os grava no manifesto e remove a URL bruta antes de iniciar o
  cliente PostgreSQL.
- O dump é cifrado localmente com AES-256-GCM em streaming. O arquivo plaintext
  não é persistido pelo script. O `.dump.enc` é validado com
  `pg_restore --list` antes do upload. O processo-filho `pg_restore` recebe
  somente `PATH` (e variáveis de sistema/temporárias necessárias no Windows);
  não herda URL/credenciais PostgreSQL, chave AES, credenciais R2 ou opções de
  inicialização Node.
- O upload usa a API S3-compatible do R2, mas não há `wrangler`, criação de
  bucket, alteração de ACL ou exclusão de objeto no repositório.
- Após enviar o arquivo cifrado, o script baixa o objeto privado para um
  diretório temporário e compara tamanho e SHA-256 com o artefato local antes
  de enviar o manifesto. O arquivo temporário é removido ao final; esta
  verificação ainda não foi exercitada contra o bucket de produção.
- Depois que dump e manifesto forem enviados, com o dump remoto validado por
  tamanho e SHA-256, o executor remove os dois artefatos locais para não deixar
  cópias diárias acumulando no disco. Se uma etapa do upload ou da verificação
  falhar, os arquivos completos cifrados são preservados para recuperação
  operacional; somente o `.part` incompleto é removido. Revise e resolva a
  falha antes de apagar qualquer artefato preservado.
- `--environment production` é bloqueado, a menos que o operador forneça
  simultaneamente `--allow-production` e `BACKUP_ALLOW_PRODUCTION=YES` após a
  aprovação operacional. Essa combinação não foi usada nesta entrega.
- `scripts/backup-r2-task.ps1` usa a API nativa do Windows Credential Manager.
  Os segredos entram por prompts ocultos ou são lidos para o ambiente somente
  durante a execução. A CLI Node repassa um ambiente allowlisted; valores
  secretos não entram nos argumentos do processo nem nos logs.
- A tarefa agendada usa o usuário Windows atual com logon interativo, exige
  rede e só executa depois que esse usuário entra no Windows. Não salva a senha
  do Windows. `StartWhenAvailable` recupera uma execução perdida após o login;
  não cria snapshots para cada dia em que o computador ficou desligado.

O dump é deliberadamente limitado ao schema `public`, que contém as entidades
de negócio do Vela. Schemas gerenciados pelo Supabase, usuários do Auth e bytes
do Storage não são tratados por este artefato; PITR/Supabase e o procedimento
de restore para um projeto descartável continuam sendo camadas separadas.

## Pré-requisitos locais

Instale Node 24, os binários de cliente PostgreSQL da mesma versão major do
projeto Supabase (atualmente PostgreSQL 17) e AWS CLI v2. Para o agendador
Windows, `pg_dump` e `pg_restore` ficam em
`%LOCALAPPDATA%\Programs\VelaBackup\PostgreSQL\17\bin`; o wrapper exige
major 17 e usa caminhos explícitos. A AWS CLI é usada apenas como cliente S3 e
também é chamada pelo caminho da instalação. Não é necessário instalar nem
executar um servidor PostgreSQL local. Nenhuma credencial deve ser colocada em
`.env`, no repositório ou na linha de comando.

```powershell
& "$env:LOCALAPPDATA\Programs\VelaBackup\PostgreSQL\17\bin\pg_dump.exe" --version
& "$env:LOCALAPPDATA\Programs\VelaBackup\PostgreSQL\17\bin\pg_restore.exe" --version
& "$env:ProgramFiles\Amazon\AWSCLIV2\aws.exe" --version
```

O ponto de entrada é `scripts/backup-r2.mjs`:

```powershell
npm run backup:r2:test
```

Os testes incluem um round-trip de credencial **sintética** pelo Credential
Manager no Windows; o item temporário é apagado ao final. Nenhuma credencial
real é criada ou lida pelos testes.

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

## Configuração restante e instalação

Estado confirmado: o projeto Supabase tem backup físico diário; PITR continua
desligado por custo. O bucket `vela-database-backups` está privado e sua
lifecycle expira objetos após 90 dias. O painel R2 mostrou 0 objetos/0 B e
US$ 0,00 de uso faturável no período atual em 2026-09-23. O token
`Vela R2 Backup` aparece ativo e limitado a esse bucket; não foi verificado se
o Secret Access Key foi preservado ou se as credenciais estão no Credential
Manager. Nenhum dump foi enviado e nenhum restore foi executado.

Na máquina Windows inspecionada em 2026-09-23, os quatro alvos `VelaBackup/*`
do Credential Manager e a tarefa `Vela-R2-Database-Backup-Daily` não existem;
`pg_dump`, `pg_restore` e AWS CLI também não estão instalados/no `PATH`.
Portanto, o runner ainda não está pronto para produzir um backup real.

1. Obtenha em `Connect` no Supabase uma URL PostgreSQL com SSL adequada à rede
   desta máquina. Não a cole no chat, em arquivo, issue ou linha de comando.
2. O painel Cloudflare R2 lista o token `Vela R2 Backup` ativo, com permissão
   `Object Read & Write` restrita ao bucket `vela-database-backups` (verificado
   em 2026-09-23). Antes de criar outro, confirme se o Secret Access Key de uso
   único foi guardado e se as duas chaves constam no Credential Manager. Se a
   chave secreta se perdeu, revogue a credencial antiga e crie outra somente
   quando o prompt oculto de armazenamento estiver pronto; não exponha o valor
   em chat, terminal com eco ou screenshot.
3. Mantenha a chave AES-256 fora do R2 **e também fora deste computador** em um
   segundo cofre recuperável. O Credential Manager local, sozinho, não é
   recuperação suficiente se o PC for perdido. A execução agendada depende de
   uma cópia local da mesma chave; não gere nem use a chave produtiva até existir
   a cópia externa aprovada.
4. Depois do merge desta implementação em `main`, no checkout canônico do Vela,
   salve as quatro credenciais com prompts ocultos:

   ```powershell
   powershell.exe -NoProfile -File .\scripts\backup-r2-task.ps1 -StoreCredentials
   ```

   O script nunca imprime os valores. Os alvos do Credential Manager são
   `VelaBackup/SupabaseDbUrl`, `VelaBackup/EncryptionKeyHex`,
   `VelaBackup/R2AccessKeyId` e `VelaBackup/R2SecretAccessKey`.
5. Confirme que os pré-requisitos existem, rode `npm run backup:r2:test` e
   execute um dry-run para `production`. Em seguida, instale a tarefa diária:

   ```powershell
   powershell.exe -NoProfile -File .\scripts\backup-r2-task.ps1 -InstallTask
   ```

   A instalação só aceita `main`, os arquivos do executor sem alterações locais,
   as quatro credenciais presentes e não substitui uma tarefa de mesmo nome.
   O Agendador exige rede, tenta novamente até três vezes com intervalo de 30
   minutos e ignora uma segunda instância se a primeira ainda estiver ativa.
   `StartWhenAvailable` pode atrasar o disparo cerca de 10 minutos por padrão;
   depois de vários dias desligado, ocorre uma execução atrasada, não uma por
   dia perdido. A tarefa usa logon interativo: ela espera o usuário entrar no
   Windows e não roda antes da tela de login. A opção foi escolhida para não
   armazenar a senha do Windows e para usar o Credential Manager já desbloqueado.
   Veja a referência da Microsoft para
   [`StartWhenAvailable`](https://learn.microsoft.com/en-us/windows/win32/taskschd/tasksettings-startwhenavailable).
6. Faça um dry-run, depois inicie manualmente a tarefa uma vez pelo Agendador de
   Tarefas. Confira o manifesto e a igualdade de tamanho/SHA-256 do dump cifrado
   local e remoto. O log sanitizado fica em
   `%LOCALAPPDATA%\Vela\backup-logs`; ele não deve conter URL, chave ou token.
7. Para o ensaio trimestral de restore, crie uma branch/projeto Supabase
   descartável, valide o dump com `--verify` e só então siga o runbook oficial
   de restore. O restore é destrutivo no alvo escolhido; nunca execute em
   produção.

Este repositório não adiciona workflow GitHub para evitar acoplar credenciais de
banco e R2 ao CI.

Os rótulos do Dashboard podem mudar. A validação remota deve registrar o
ambiente, a data, o projeto e os objetos encontrados, mas nunca valores de
segredo. As referências técnicas atuais são a documentação de backup lógico da
Supabase e a API S3-compatible do R2.
