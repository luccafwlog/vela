// Um gate que nunca reprovou não é um gate. Este teste exercita os dois lados:
// o que deve passar e o que deve falhar.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditMigration, stripFunctionBodies } from './check-destructive-migrations.mjs'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

const DECLARACAO = `-- 099: exemplo
--
-- ATENCAO -- esta migration APAGA dados existentes. Ela depende da afirmacao
-- "Data status" da secao Gotchas do AGENTS.md.
`

// 1. Destrutiva sem declaracao -> reprovada.
const semDeclaracao = auditMigration(`-- 099: exemplo sem declaracao\nUPDATE public.bls SET pod = NULL;\n`)
assert.equal(semDeclaracao.destructive, true)
assert.equal(semDeclaracao.declared, false)
assert.deepEqual(semDeclaracao.statements, ['UPDATE'])

// 2. A mesma migration com a declaracao -> aprovada.
const comDeclaracao = auditMigration(`${DECLARACAO}UPDATE public.bls SET pod = NULL;\n`)
assert.equal(comDeclaracao.destructive, true)
assert.equal(comDeclaracao.declared, true)

// 3. Declaracao fora do cabecalho nao vale: tem de estar antes do primeiro
//    statement, onde quem abre o arquivo a encontra.
const depoisDoSql = auditMigration(`-- 099\nUPDATE public.bls SET pod = NULL;\n-- Data status do CLAUDE.md\n`)
assert.equal(depoisDoSql.declared, false)

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
const blocoDo = auditMigration(`-- 099\nDO $$ BEGIN UPDATE public.bls SET pod = NULL; END $$;\n`)
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
  { legacy: true },
)
assert.equal(real.destructive, true, 'a 061 faz um backfill; deveria ser detectada como destrutiva')
assert.equal(real.declared, true, 'a 061 declara a dependencia no cabecalho')

// Canonical declaration passes; the old spelling is accepted only when the
// caller identifies a migration already applied before rule 061.
assert.equal(auditMigration(`${DECLARACAO.replace('CLAUDE.md', 'AGENTS.md')}DELETE FROM public.bls;`).declared, true)
assert.equal(auditMigration('-- Data status do CLAUDE.md\nDELETE FROM public.bls;').declared, false)
assert.equal(auditMigration('-- Data status do CLAUDE.md\nDELETE FROM public.bls;', { legacy: true }).declared, true, 'legacy mode accepts the historical spelling')
// 11. TRUNCATE como comando apaga dados; REVOKE TRUNCATE só retira privilégio.
assert.equal(auditMigration('-- 099\nTRUNCATE public.bls;\n').destructive, true)
assert.equal(auditMigration('-- 099\nSELECT 1; TRUNCATE TABLE public.bls;\n').destructive, true)
assert.equal(auditMigration('-- 099: TRUNCATE sai de anon\nREVOKE TRUNCATE ON TABLE public.bls FROM anon;\n').destructive, false)
assert.equal(auditMigration('-- 099\nBEGIN; TRUNCATE public.bls; COMMIT;\n').destructive, true, 'TRUNCATE depois de BEGIN')
assert.equal(auditMigration('-- 099\nGRANT SELECT, TRUNCATE ON TABLE public.bls TO service_role;\n').destructive, false)
assert.equal(auditMigration('-- 099\n-- aqui não se faz TRUNCATE public.bls\nSELECT 1;\n').destructive, false, 'comentário não conta')
console.log('check-destructive-migrations: 16 cenários passaram (AGENTS.md e compatibilidade histórica).')
