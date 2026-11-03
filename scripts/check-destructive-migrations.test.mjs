// Um gate que nunca reprovou não é um gate. Este teste exercita os dois lados:
// o que deve passar e o que deve falhar.
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_STATUS_UNTIL, auditMigration, ruleFor, stripFunctionBodies } from './check-destructive-migrations.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const DECLARACAO = `-- 099: exemplo
--
-- ATENCAO -- esta migration APAGA dados existentes. Ela depende da afirmacao
-- "Data status" da secao Gotchas do AGENTS.md.
`

const DATA_STATUS = { rule: 'data-status' }

const PLANO = `-- 575: exemplo
--
-- Plano de preservação: copia as linhas afetadas de public.bls (id, pod) para
-- public.bls_pod_antes_575 antes do UPDATE; confere que a contagem da copia
-- bate com a do filtro; desfaz com UPDATE ... FROM bls_pod_antes_575.
`

// 1. Destrutiva sem declaracao -> reprovada.
const semDeclaracao = auditMigration(`-- 099: exemplo sem declaracao\nUPDATE public.bls SET pod = NULL;\n`, DATA_STATUS)
assert.equal(semDeclaracao.destructive, true)
assert.equal(semDeclaracao.declared, false)
assert.deepEqual(semDeclaracao.statements, ['UPDATE'])

// 2. A mesma migration com a declaracao, na epoca sem dados reais -> aprovada.
const comDeclaracao = auditMigration(`${DECLARACAO}UPDATE public.bls SET pod = NULL;\n`, DATA_STATUS)
assert.equal(comDeclaracao.destructive, true)
assert.equal(comDeclaracao.declared, true)

// 3. Declaracao fora do cabecalho nao vale: tem de estar antes do primeiro
//    statement, onde quem abre o arquivo a encontra.
const depoisDoSql = auditMigration(`-- 099\nUPDATE public.bls SET pod = NULL;\n-- Data status do CLAUDE.md\n`, DATA_STATUS)
assert.equal(depoisDoSql.declared, false)

// Dados reais desde 2026-11-03: a epoca de cada migration decide a regra.
assert.equal(ruleFor(61), 'historica')
assert.equal(ruleFor(62), 'data-status')
assert.equal(ruleFor(DATA_STATUS_UNTIL), 'data-status')
assert.equal(ruleFor(DATA_STATUS_UNTIL + 1), 'plano')

// 3a. Depois da 574, declarar o "Data status" nao basta mais.
const soDeclaracao = auditMigration(`${DECLARACAO}UPDATE public.bls SET pod = NULL;\n`, { rule: 'plano' })
assert.equal(soDeclaracao.declared, false, 'a afirmacao antiga foi revogada')
assert.equal(soDeclaracao.citesDataStatus, true)
// 3b. Sem regra explicita, vale a de hoje (plano).
assert.equal(auditMigration(`${DECLARACAO}UPDATE public.bls SET pod = NULL;\n`).declared, false)
// 3c. Com plano de preservacao no cabecalho -> aprovada.
assert.equal(auditMigration(`${PLANO}UPDATE public.bls SET pod = NULL;\n`).declared, true)
// 3d. Marcador sem corpo nao e plano.
assert.equal(auditMigration('-- 575\n-- Plano de preservação: nenhum.\nDELETE FROM public.bls;\n').declared, false)
// 3e. Plano escrito depois do primeiro statement nao conta.
assert.equal(auditMigration(`-- 575\nDELETE FROM public.bls;\n${PLANO}`).declared, false)
// 3f. Migration aditiva continua sem exigencia.
assert.equal(auditMigration('-- 575\nALTER TABLE public.bls ADD COLUMN x text;\n').destructive, false)

// 4. UPDATE dentro de corpo de funcao e codigo que roda depois, nao reescrita
//    no momento do deploy. Nao exige declaracao.
const dentroDeFuncao = auditMigration(`-- 099
CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  UPDATE public.bls SET pod = NULL;
  DELETE FROM public.bl_containers WHERE bl_id IS NULL;
END;
$function$;
`)
assert.equal(dentroDeFuncao.destructive, false)

// 5. Bloco DO executa durante o deploy: continua exigindo declaracao.
const blocoDo = auditMigration(`-- 099\nDO $$ BEGIN UPDATE public.bls SET pod = NULL; END $$;\n`, DATA_STATUS)
assert.equal(blocoDo.destructive, true)
assert.equal(blocoDo.declared, false)

// 6. Migration aditiva nao e destrutiva.
const aditiva = auditMigration(`-- 099\nALTER TABLE public.bls ADD COLUMN x text;\nINSERT INTO public.bls (id) VALUES ('a');\n`)
assert.equal(aditiva.destructive, false)

// 7. stripFunctionBodies preserva o que esta fora dos corpos.
const stripped = stripFunctionBodies(`A $$ oculto $$ B`)
assert.match(stripped, /A/)
assert.match(stripped, /B/)

// 8. A 061 real, do repositorio, passa -- e o exemplo citado na mensagem de erro.
const real = auditMigration(
  fs.readFileSync(path.join(root, 'supabase/migrations/061_bl_weight_semantics_and_triggers.sql'), 'utf8'),
  { rule: ruleFor(61) },
)
assert.equal(real.destructive, true, 'a 061 faz um backfill; deveria ser detectada como destrutiva')
assert.equal(real.declared, true, 'a 061 declara a dependencia no cabecalho')

// Canonical declaration passes; the old spelling is accepted only when the
// caller identifies a migration already applied before rule 061.
assert.equal(auditMigration(`${DECLARACAO.replace('CLAUDE.md', 'AGENTS.md')}DELETE FROM public.bls;`, DATA_STATUS).declared, true)
assert.equal(auditMigration('-- Data status do CLAUDE.md\nDELETE FROM public.bls;', DATA_STATUS).declared, false)
assert.equal(auditMigration('-- Data status do CLAUDE.md\nDELETE FROM public.bls;', { rule: 'historica' }).declared, true, 'legacy mode accepts the historical spelling')
// 11. TRUNCATE como comando apaga dados; REVOKE TRUNCATE só retira privilégio.
assert.equal(auditMigration('-- 099\nTRUNCATE public.bls;\n').destructive, true)
assert.equal(auditMigration('-- 099\nSELECT 1; TRUNCATE TABLE public.bls;\n').destructive, true)
assert.equal(auditMigration('-- 099: TRUNCATE sai de anon\nREVOKE TRUNCATE ON TABLE public.bls FROM anon;\n').destructive, false)
assert.equal(auditMigration('-- 099\nBEGIN; TRUNCATE public.bls; COMMIT;\n').destructive, true, 'TRUNCATE depois de BEGIN')
assert.equal(auditMigration('-- 099\nGRANT SELECT, TRUNCATE ON TABLE public.bls TO service_role;\n').destructive, false)
assert.equal(auditMigration('-- 099\n-- aqui não se faz TRUNCATE public.bls\nSELECT 1;\n').destructive, false, 'comentário não conta')
const cliOutput = execFileSync(process.execPath, [path.join(root, 'scripts/check-destructive-migrations.mjs')], { encoding: 'utf8' })
assert.match(cliOutput, /Destructive migration check passed:/, 'CLI precisa executar o gate também no Windows')

// Diferentes nomes não podem compartilhar a versão usada pelo Supabase.
const temporaryRoot = fs.mkdtempSync(path.join(tmpdir(), 'vela-migration-versions-'))
try {
  fs.mkdirSync(path.join(temporaryRoot, 'scripts'))
  fs.mkdirSync(path.join(temporaryRoot, 'supabase/migrations'), { recursive: true })
  fs.copyFileSync(path.join(root, 'scripts/check-destructive-migrations.mjs'), path.join(temporaryRoot, 'scripts/check-destructive-migrations.mjs'))
  for (const name of ['134_financial.sql', '134_ce.sql']) fs.writeFileSync(path.join(temporaryRoot, 'supabase/migrations', name), 'SELECT 1;')
  let failure
  try { execFileSync(process.execPath, [path.join(temporaryRoot, 'scripts/check-destructive-migrations.mjs')], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { failure = error }
  assert.equal(failure?.status, 1, 'gate deve recusar versão 134 duplicada mesmo em migrations aditivas')
  assert.match(String(failure.stderr), /134_financial\.sql/)
  assert.match(String(failure.stderr), /134_ce\.sql/)
  fs.renameSync(path.join(temporaryRoot, 'supabase/migrations/134_ce.sql'), path.join(temporaryRoot, 'supabase/migrations/135_ce.sql'))
  assert.match(execFileSync(process.execPath, [path.join(temporaryRoot, 'scripts/check-destructive-migrations.mjs')], { encoding: 'utf8' }), /check passed/)

  // Migration nova (depois da 574) que só declara o "Data status" é recusada
  // pela CLI; com plano de preservação, passa.
  const nova = path.join(temporaryRoot, `supabase/migrations/${DATA_STATUS_UNTIL + 1}_apaga.sql`)
  fs.writeFileSync(nova, `${DECLARACAO}DELETE FROM public.bls;\n`)
  failure = undefined
  try { execFileSync(process.execPath, [path.join(temporaryRoot, 'scripts/check-destructive-migrations.mjs')], { encoding: 'utf8', stdio: 'pipe' }) } catch (error) { failure = error }
  assert.equal(failure?.status, 1, 'gate deve recusar migration nova que só declara o Data status revogado')
  assert.match(String(failure.stderr), /_apaga\.sql .*"Data status" revogado/)
  fs.writeFileSync(nova, `${PLANO}DELETE FROM public.bls;\n`)
  assert.match(execFileSync(process.execPath, [path.join(temporaryRoot, 'scripts/check-destructive-migrations.mjs')], { encoding: 'utf8' }), /check passed/)
} finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }) }

console.log('check-destructive-migrations: cenários passaram (Data status até a 574, plano de preservação depois, versões únicas e CLI).')
