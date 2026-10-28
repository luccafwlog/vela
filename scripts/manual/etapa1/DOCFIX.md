# Correção de documentação defasada (divergências da classe a)

O mapeamento do Manual do Operador (plano
`/home/user/vela/docs/plans/2026-10-26-manual-do-operador.md`, Etapa 1)
achou divergências entre o código e a documentação viva. As da **classe a**
são "documento defasado; código coerente com a decisão": o plano manda
corrigir o documento na mesma entrega
(`docs/CONVENCOES.md`, "Divergência entre documento e código").

Você recebe uma lista de divergências (arquivo de cobertura + número) e os
documentos que são seus. Para cada divergência:

1. Leia a linha da divergência no arquivo de cobertura indicado
   (`/home/user/vela/docs/manual/cobertura/<area>.md`, seção "## Divergências")
   e a regra que ela cita.
2. Confira rapidamente no código o fato (telas em `src/`, funções de servidor
   em `supabase/functions/`, definição vigente no banco local, só leitura:
   `PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d vela_test -At -c "select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='NOME'"`).
3. Corrija **só os documentos que são seus**, com a menor edição que deixa o
   texto fiel ao código: rótulo de tela errado, comportamento descrito de
   outro jeito, regra que mudou. Não reescreva seções inteiras nem mude o
   estilo.

## Limites

- **Só documentos vivos**: `CONTEXT.md`, `docs/modules/*.md`,
  `docs/operations/*.md`, `docs/ARCHITECTURE.md`, `docs/RASTREABILIDADE.md`.
  Nunca edite ADR (`docs/adr/`), nada em `docs/archive/`, nem planos. Se a
  divergência só puder ser resolvida numa ADR, não mexa: relate.
- **Cada fato tem um dono** (`docs/CONVENCOES.md`, "Responsabilidade de cada
  documento"): a regra fica no módulo; o glossário define o termo em poucas
  linhas e aponta para o módulo. Não copie regra para outro documento.
- Se, ao conferir, você achar que **não é classe a** (o código é que parece
  errado, ou os documentos se contradizem sem o código resolver), **não
  corrija**: relate como "não corrigida, parece classe b/c" com o motivo.
- Preserve os rótulos de evidência e o formato das tabelas existentes.
  Português do Brasil, com acentos.
- Não edite `docs/manual/cobertura/*.md`, não faça commit, não grave no banco.
  Outras pessoas corrigem outros documentos em paralelo: edite só os seus.
- Ao terminar, rode `cd /home/user/vela && node scripts/check-docs.mjs` e
  `git diff --check` e corrija o que quebrar nos seus documentos.

## Ao terminar

Responda com uma lista: `<area> <nº>` → "corrigida em `<documento>` (§ seção)"
ou "não corrigida: <motivo>". Depois, o resultado do `check-docs` e do
`git diff --check`.
