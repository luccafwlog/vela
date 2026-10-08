#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Encontra a branch Supabase de uma PR a partir do JSON de
// `supabase branches list -o json`. O nome da branch Supabase só aceita
// letras, números, `-` e `_`, então uma branch criada à mão para
// `claude/x` não pode ter o mesmo nome da branch Git; o vínculo fica em
// `git_branch` ("Sync with Git branch"). O nome exato continua aceito para
// branches criadas pelo Automatic Branching. Imprime o id, que o
// `branches get` aceita no lugar do nome.
export function resolveSupabaseBranch(listing, gitRef) {
  const branches = Array.isArray(listing) ? listing : (listing?.branches ?? [])
  const match =
    branches.find((branch) => branch?.git_branch === gitRef) ??
    branches.find((branch) => branch?.name === gitRef)
  return match?.id ?? null
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const gitRef = process.argv[2]
  if (!gitRef) {
    console.error('Uso: supabase branches list -o json | node scripts/resolve-supabase-branch.mjs <branch-git>')
    process.exit(2)
  }
  const id = resolveSupabaseBranch(JSON.parse(readFileSync(0, 'utf8') || '[]'), gitRef)
  if (!id) {
    console.error(`Nenhuma branch Supabase vinculada à branch Git '${gitRef}'.`)
    process.exit(1)
  }
  process.stdout.write(id)
}
