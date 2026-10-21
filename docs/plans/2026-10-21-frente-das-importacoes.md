# Plano — frente das importações (revisão de 2026-10-21)

Executa a [ADR 0095](../adr/0095-importacoes-regras-da-revisao.md).
Achados F-xx da [revisão](../archive/audits/2026-10-21-revisao-importacoes.md).
Base `staging` depois da PR luccafwlog/vela#1019; migrations a partir da `387`.
Cada lote entrega migration (quando banco), suíte local-pg ou vitest que falha
antes e passa depois, e o módulo dono atualizado.

## Já entregue

- **Lote 0 — leitura de arquivo e mensagens** (PR luccafwlog/vela#1020, só tela):
  decisões 1, 2, 4, 12 (leitor), 13 (tela) e 16; F-31.
- **Pela PR luccafwlog/vela#1019** (ADR 0094), não refazer: escrita direta
  fechada (F-03), RPCs antigas revogadas (F-19), B/L cancelado somente leitura
  e datas só nos B/Ls ativos (F-12), carga solta faturada com confirmação no
  servidor (F-06), FCL entre Clientes em todo vínculo (F-07), falha de cálculo
  recusa (F-17, F-56), reativar reabre efeitos (F-14 em parte), exclusão do B/L
  irmão de container compartilhado faturado corrige o vizinho (F-10, migration
  `357`; o lote 4 só acrescenta a suíte desse caminho de exclusão).

## Lotes

| Lote | Decisões | Achados | O que muda | Prova |
|---|---|---|---|---|
| 1 Trava e Baplie no servidor | 6, 11, 13 | F-04, F-11, F-16, F-20, F-21, F-22, F-26 | trava `import_voyage:<id>` em toda RPC de Viagem; índice único no staging do Baplie; Baplie substitui só os PODs do pedido; Viagem, escalas e duplicatas no servidor; `expected` (contagem) na gravação; staging, marcas e vazios do Baplie numa transação só (ou o passo seguinte enfileirado como efeito); `_set_import_context` de volta nos vazios do Baplie | duas sessões concorrentes; filtro de POD preserva o resto; falha no meio não deixa staging com marca e B/L sem |
| 2 Arquivo de B/L | 5, 8, 9, 10, 26, 27 | F-05, F-15, F-27, F-50 | B/L de outra Viagem recusado; aviso de B/L cancelado; aceite de refixar levado ao servidor; confirmação só com fatura emitida e conferida no servidor; totais não mudam sem containers; aba VIN ignorada e fim de `vela.vin_reissue`; `container_load_type` gravado (coluna a confirmar no arquivo real) | local-pg por regra |
| 3 Portos | 12 | F-08, F-33b | `normalize_port_code` sem BRNVT→BRITJ e BRREC→BRSUA; aliases do front; dados gravados | B/L de Navegantes não casa escala de Itajaí |
| 4 Exclusão e efeitos | 7, 18, 25 | F-10 (só a suíte), F-13, F-14, F-33a, F-34, F-42, F-43 | exclusão encerra efeitos e apaga vazios da Viagem; espera de negócio não é bloqueio; reprocessar no alerta; ator de sistema; excluir/mover veículo enfileira o efeito; `import_effects_queue_health` passa a contar `blocked` e `running` com lease vencida | efeito órfão some; alerta fecha; saúde da fila acusa bloqueado e lease vencida; excluir o irmão de container compartilhado faturado |
| 5 CE e Manifesto Mercante | 19, 20 | F-49, F-53 | remover CE e cancelar tiram do Manifesto; alerta "CE fora do Manifesto da rota"; planilha de CE com recusa de cálculo testada e mensagem no formato da ADR 0094 | local-pg |
| 6 Vazios | 21, 22 | F-32 | unicidade por Viagem, planilha vence; ADR de Saída fechado trava | local-pg |
| 7 ATD | 23 | F-48 | ATD manual marcado e preservado; só B/Ls ativos | local-pg |
| 8 Histórico | 24 | F-23, F-24, F-46 | `bl_timeline` lê `bls`, `vehicles` e `bl_containers`; origem Base de Clientes; `audit_logs` sem INSERT direto | local-pg + vitest |
| 9 Baplie: armador e transbordo | 14, 15 | — | códigos do armador no cadastro; transbordo marcado | vitest + local-pg |
| 10 Hash e desova | 3, 26 | F-50 | `import_batches` com hash e aviso de reenvio; desova por container físico | local-pg |

## Pendências

- Decisão 27: identificar a coluna da modalidade FCL/LCL no arquivo real da
  COSCO (pedir ao responsável um arquivo com B/L LCL).
