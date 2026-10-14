# Desempenho das telas com volume de dois anos

> **Relatório histórico.** Medições locais de 2026-10-14, na branch
> `perf/startup-screens-scroll`. Para o estado atual, meça de novo com
> `npm run perf:screens` ([scripts/perf/README.md](../../../scripts/perf/README.md)).

## Como foi medido

**Evidência: Runtime local.** A medição usou um build de produção (`vite preview`)
contra o stack local (Postgres 16 + emulador `sb-shim`), com o volume sintético
de `scripts/perf/seed-volume.sql`: 200 viagens, 12 mil B/Ls, 28 mil contêineres,
14 mil veículos, 400 clientes e 4 mil faturas. O navegador foi o Chrome com
80 ms de latência, 20 Mbps e CPU 2× mais lenta. Cada número é a mediana de 3
rodadas. "Pronto" quer dizer rede ao Supabase parada, nenhum `aria-busy` e
nenhum "Carregando" no `<main>` por 600 ms. "Linhas" é o tempo até a primeira
linha da lista trocar depois de "Próxima".

Cada correção foi medida contra o estado imediatamente anterior, num worktree
em que as mudanças entraram uma a uma. Tempos contra o emulador não são tempos
de produção (que hoje tem ~135 B/Ls); a comparação antes/depois no mesmo stack
vale.

## Achado principal

A lentidão crescia com o histórico por duas causas no banco, não no bundle:

1. **Helper de RLS por linha.** 187 das 270 policies chamavam o helper nu
   (`is_active_read_user()`). Na forma nua o Postgres executa a função
   `SECURITY DEFINER` em cada linha lida. Somado ao erro de estimativa das RPCs
   de lista (os filtros opcionais `p IS NULL OR col = p` levam o planner a
   prever 1 linha e a escolher laço aninhado), a página 1 de B/Ls fazia 4,9
   milhões de chamadas e levava 72 s.
2. **Trabalho proporcional ao histórico inteiro a cada abertura.** A lista de
   contêineres montava o JSON das 28 mil linhas para mostrar 20. Os filtros
   baixavam todos os B/Ls e contêineres para achar uma dúzia de valores. O
   Line Up pedia o marco de alteração em uma requisição por 100 B/Ls.

## Correções e medições

| # | Correção | Tela | Antes | Depois |
|---|---|---|---|---|
| 1 | Migration `230`: helper de policy como `(select helper())` | Página 1 de B/Ls na RPC (psql) | 72,6 s | 0,27 s |
| | | B/Ls (abrir) | >30 s | 1,86 s |
| | | Contêineres (abrir / próxima) | 23,5 s / 16,6 s | 7,3 s / 6,9 s |
| | | Viagens | 14,9 s | 5,1 s |
| | | Veículos | 7,1 s | 1,5 s |
| | | Taxas locais | 8,5 s, 263 req. | 0,72 s, 8 req. |
| 2 | Line Up: marco de alteração por viagem e lotes de viagens em paralelo; exportação carregada no clique | Abertura fria até o Painel | 4,3 s, 108 req. | 2,46 s, 42 req. |
| | | Painel "Carregar mais viagens" | 5,6 s, 189 req. | 2,8 s, 53 req. |
| | | JS da abertura fria | 294 kB | 248 kB |
| 3 | Fontes variáveis: um arquivo por subset em vez de um por peso | Fontes baixadas na abertura fria | 218 kB | 95 kB (tempo de "pronto" igual) |
| 4 | Migration `231`: página escolhe os ids antes de montar o JSON | RPC de contêineres (psql, sessão nova) | 3,1 s | 0,87 s |
| | | Contêineres (abrir / próxima) | 7,3 s / 6,9 s | 3,3 s / 1,9 s |
| 5 | `usePagedQuery`: mantém a página na tela e pré-carrega a seguinte (B/Ls, Contêineres) | B/Ls "Próxima" (linhas) | 724 ms | 113 ms |
| | | Contêineres "Próxima" (linhas) | 1.904 ms | 79 ms |
| 6 | Migration `232`: opções de POL/POD/tipo numa RPC | B/Ls (abrir) | 2,7 s, 17 req. | 1,8 s, 5 req. |
| | | Contêineres (requisições) | 31 | 2 |
| 7 | Veículos: página e filtros de contêiner/B/L/desova recortados do cache; chassi e lacre com debounce; estatísticas em páginas paralelas | Veículos de uma viagem, "Próxima" (linhas) | 375 ms, 1 req. | 195 ms, 0 req. |
| | | Viagens | 5,3 s | 3,8 s |
| 8 | Lotes de viagens em paralelo nas agendas (`voyageRouteSchedules`) | Faixa de Veículos | 1,64 s | 0,96 s |
| 9 | Agendas de POL/POD em lotes de 50 ids | Viagens | erro HTTP 431 e retry; datas de POL ausentes | 0 erros; 4,1 s com todas as datas |
| 10 | Relatórios paginados no navegador (50 por página) | Relatórios | 1,28 s, 508 ms de thread travada, 36,9 mil nós | 0,89 s, 0 ms, 1,2 mil nós |

Rodada final (todas as correções, 3 rodadas): abertura fria 4,4 s → 2,5 s;
B/Ls >30 s → 2,3 s; Contêineres 23,5 s → 6,2 s (4,2 s medido isolado; na
rodada completa a Demurrage da rodada anterior ainda ocupava o banco);
Viagens 14,9 s → 4,2 s; Veículos 7,1 s → 1,0 s; Taxas locais 8,5 s → 0,7 s;
Relatórios 1,8 s → 0,76 s.

## O que não mudou

- **Demurrage** continua acima de 30 s com este volume. A tela lê todo
  contêiner em atraso ou devolvido, para sempre: ~19 mil caixas, em 22 páginas
  em série, ~12,7 MB. Reduzir exige decidir quais devolvidos ainda pertencem à
  lista, o que é decisão de negócio.
- **Rolagem** não era gargalo: as listas grandes são paginadas no servidor
  (20 a 100 linhas) e o p95 do quadro ficou em ~17–18 ms. A exceção era
  Relatórios (correção 10).
- **Viagens** ainda monta a faixa com as 204 viagens (7,3 mil nós, ~0,5 s de
  thread) e baixa todos os veículos do histórico (~1,8 MB) para os indicadores
  da faixa. Uma RPC de agregação resolveria.
- O CSS de 291 kB (45 kB gzip) e o Sentry no chunk de entrada seguem como estão.

## Verificação

**Teste:** `npm test` (só `graniteParse` e `importCore` falham, também na
`main` neste Windows), `typecheck`, `lint`, `build`, `size-limit` (entrada
225 KiB de 250), `docs:check`, `design:check`, `migrations:check`. Suítes
local-pg `operationalLists` e `auditSecurityBoundaries` verdes num replay novo
com `230`–`232`. A bateria local-pg completa no Windows falha igual na `main`
e na branch quando cada suíte roda isolada (codificação e caminhos); a prova
definitiva é o job de CI no Linux. `rpc:check` acusa `detect_overdue_invoices`
igual na `main` (falso positivo do script no Windows).

**Não verificado:** produção e Preview. As migrations não foram aplicadas no
Supabase.
