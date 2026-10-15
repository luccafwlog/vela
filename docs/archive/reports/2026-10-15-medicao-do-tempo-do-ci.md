# 2026-10-15 — Medição do tempo do CI

Relatório de medição. Nasce histórico: registra o tempo do CI observado nesta
data e de onde ele vem. As mudanças decorrentes estão no
[plano de compactação do CI](../../plans/2026-10-15-compactacao-do-ci.md).

## 1. Fontes e ambiente

- **GitHub Actions (Runtime):** execuções do workflow `CI` em push na `main`,
  lidas pela API de runs e jobs. Run de referência:
  [38602622464](https://github.com/luccafwlog/vela/actions/runs/38602622464)
  (merge da luccafwlog/vela#952, `2763f99b`, 2026-10-14), runners
  `ubuntu-latest` de 2 vCPU.
- **Contêiner desta sessão (Runtime):** Linux com 4 vCPU, PostgreSQL 16 local
  administrado por `scripts/setup-local-pg.sh`, `main` em `2763f99b`. Os
  tempos absolutos diferem do GitHub; as proporções são o que se compara.
- **Histórico de `.github/workflows/ci.yml`:** `git log` da `main`.

## 2. Evolução do tempo de espera

Duração do run de CI em push na `main` (do início ao fim do run):

| Data | Duração | Suítes `local-pg` no CI | Mudança |
| --- | ---: | ---: | --- |
| 2026-09-01 | ~1 min 15 s | 0 | Docs, lint, build, testes em 3 shards, guardas de segurança |
| 2026-09-02 a 09-09 | — | 12 | Replay real das migrations (squash da PR 651) e primeiras suítes SQL |
| 2026-09-29 | ~1 min 30 s | 30 | |
| 2026-10-08 | ~2 min 45 s | 46 | |
| 2026-10-12 | ~4 a 5 min 30 s | 73 | `d19d78fb`: todas as suítes `local-pg` no CI (Etapa 12 do plano das importações) |
| 2026-10-13 | ~7 min | 81 | `3f7bf731` e `1f69ce48`: segunda passada, em ordem invertida, num banco recriado |
| 2026-10-14 | ~11 min | 81 | |

A passada invertida nasceu como critério de aceite da Etapa 12 do
[plano arquivado das importações](../plans/2026-10-09-correcao-importacoes-ce-mercante.md)
e ficou como passo permanente do CI.

## 3. Composição de um run (2026-10-14)

| Job | Duração | Minutos cobrados |
| --- | ---: | ---: |
| Migration replay (Postgres real) | 9 min 52 s | 10 |
| ↳ suítes `local-pg`, ordem natural | 4 min 28 s | |
| ↳ suítes `local-pg`, ordem invertida | 4 min 26 s | |
| ↳ dois replays do schema (`setup-local-pg.sh --reset`) | 31 s | |
| Test (1/3, 2/3, 3/3) | 1 min 39 s / 56 s / 2 min 54 s | 2 + 1 + 3 |
| Docs + Lint | 1 min 03 s | 2 |
| Build + Bundle size | 55 s | 1 |
| Security guard replay | 10 s | 1 |
| `checks` | 3 s | 1 |
| **Total** | **~11 min de espera** | **~21** |

O trabalho real somado é ~17,5 min; a diferença para 21 vem do arredondamento
por job. Cada job repete checkout, `setup-node` e `npm ci` (7 a 18 s). Os
shards de teste estão desequilibrados: o passo `Test` levou 38 s, 74 s e
140 s.

Depois do merge, `Cloudflare Pages Production` espera o CI da `main` e leva
~1 min 30 s: do merge à produção, ~13 min.

`Cloudflare Pages Preview` roda depois de todo CI verde de PR e termina em
falha ou pulado, porque o Automatic Branching do Supabase está desligado
(811 runs até 2026-10-15). `Provision Preview Admin` espera a mesma branch.

## 4. Suítes `local-pg` por dentro (contêiner)

Uma passada em ordem natural: 81 arquivos, 660 testes, 274 s somados.

| Arquivo | Duração | Testes | Acumulado |
| --- | ---: | ---: | ---: |
| `invoicePostBillingSafety` | 49,8 s | 50 | 18% |
| `auditoriaImportacaoBlContainer` | 21,8 s | 22 | 26% |
| `ceUnlock` | 16,1 s | 33 | 32% |
| `ceImportacaoContrato` | 15,5 s | 23 | 38% |
| `auditoriaFaturasDemurrageComunicado` | 12,6 s | 28 | 42% |
| `itauPixCharges` | 12,2 s | 28 | 47% |

Mediana por arquivo: 1,2 s. Seis arquivos fazem quase metade do tempo.

Cada consulta abre um processo `psql` e uma conexão nova (`execFileSync('psql',
…)` ou `spawnSync('psql', …)`, com uma cópia própria do helper em cada
arquivo; 1.464 chamadas no código):

- **4.042 conexões** numa passada (contagem por um `psql` instrumentado no
  `PATH`).
- `select 1` em 50 conexões seguidas: 2,2 s, ou ~45 ms só para abrir processo
  e conexão (autenticação `scram-sha-256` em `127.0.0.1`; SSL desligado não
  mudou o tempo).
- Estimativa: 4.042 × ~45 ms ≈ 3 min dos ~4,5 min da passada. **Suspeita**
  até medir com uma conexão reaproveitada.

`invoicePostBillingSafety` faz a limpeza completa (≈50 `DELETE`) em
`beforeEach` e em `afterEach`: 100 limpezas para 50 testes, 684 conexões no
arquivo, média de 78 ms por chamada.

## 5. Testes comuns (contêiner)

`npx vitest run` sem `LOCAL_PG_INTEGRATION`: 836 arquivos (82 pulados, as
suítes `local-pg`), 4.683 testes, 3 min 17 s de parede em 4 vCPU. Divisão
informada pelo Vitest: testes 40%, ambiente 32%, import 15%, setup 7%.

| Grupo | Arquivos | Tempo de teste somado |
| --- | ---: | ---: |
| Telas (`.tsx`, jsdom) | 181 | 167 s |
| Demais `.ts` | 350 | 16 s |
| Testes de texto de migration | 223 | 2 s |

Os testes de tela respondem por 90% do tempo de teste.

## 6. Limites

- Os tempos do contêiner não são os do GitHub; servem para proporção.
- O ganho de uma conexão reaproveitada é estimativa até o piloto do Lote 2.
- A contagem de execuções e cancelamentos por PR vem da descrição da
  luccafwlog/vela#953 (janela 2026-09-30 a 10-14), não foi refeita aqui.
