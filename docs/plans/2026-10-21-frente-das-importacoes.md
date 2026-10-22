# Plano — frente das importações (revisão de 2026-10-21)

Executa a [ADR 0095](../adr/0095-importacoes-regras-da-revisao.md).
Achados F-xx da [revisão](../archive/audits/2026-10-21-revisao-importacoes.md).
Base `staging` depois da PR luccafwlog/vela#1019; migrations a partir da `387`.
Cada lote entrega migration (quando banco), suíte local-pg ou vitest que falha
antes e passa depois, e o módulo dono atualizado.

## Já entregue

- **Lote 0 — leitura de arquivo e mensagens** (PR luccafwlog/vela#1020, só tela):
  decisões 1, 2, 4, 12 (leitor), 13 (tela) e 16; F-31.
- **Lote 1 — trava e Baplie no servidor** (PR luccafwlog/vela#1023, migrations
  `387` a `390`): decisões 6, 11 e 13 (servidor); F-04, F-11, F-16, F-20,
  F-21, F-22 e F-26. Staging, marcas e vazios do Baplie numa transação só (sem
  efeito enfileirado); a gravação confere a versão do staging e o manifesto de
  vazios do Baplie lidos na prévia e recusa porto marcado sem container
  (`390`). Prova: `importacoesTravaEBaplie.local-pg.test.ts`.
- **Lote 2 — arquivo de B/L** (migration `392`): decisões 5, 8, 9, 10, 26 e
  27; F-05, F-15, F-27 e F-50 (aba VIN e `container_load_type`). B/L de outra
  Viagem recusa o arquivo; B/L cancelado fica de fora com aviso; Cliente pelo
  CNPJ no servidor; confirmação de faturamento só com fatura emitida,
  conferida no servidor, e sem ela containers, peso, cubagem, POD e Place of
  Delivery ficam; aceite de refixar o preço por B/L na prévia
  (`bl_file_import_preview`) levado ao servidor; aba VIN ignorada e fim de
  `vela.vin_reissue`; FCL/LCL do Type of Movement gravado e respeitado pelo
  "FCL não se divide". Prova: `arquivoDeBlRegras.local-pg.test.ts` e
  `blFreightImport.test.ts`.
- **Lote 3 — portos** (migration `391`): decisão 12 (banco e tela); F-08.
  `normalize_port_code` e `_baplie_port_key` separam Navegantes de Itajaí e
  Recife de Suape e são uma régua só com `normalizeStoredPortCode`; dados
  gravados com a forma juntada passam para o porto certo só com prova (o que
  ficou está no cabeçalho da `391`). F-33b já estava resolvido pela PR
  luccafwlog/vela#1019: a Data de Referência da Tarifa não lê mais o POD nem a
  ETA e usa o dia de Brasília (ADR 0094). Prova:
  `portosSeparados.local-pg.test.ts`.
- **Lote 4 — exclusão e efeitos** (migration `394`): decisões 7, 18 e 25;
  F-13, F-14, F-33a, F-42 (em parte) e F-43; suíte de F-10. Excluir B/L ou
  Viagem encerra os efeitos pendentes como "descartado: registro excluído", sem
  Alerta; excluir a Viagem apaga os vazios de importação e o manifesto de
  vazios, e o diálogo conta os vazios; B/L em Revisão ou sem tabela é espera
  (`awaiting_review`, `awaiting_charge_table`), sem Alerta, que conclui
  sozinha; Reprocessar no Alerta, com justificativa; iniciador desativado roda
  como a conta de sistema; o produtor direto substitui o pendente (INF-14); a
  saúde da fila conta a lease vencida. F-34 já estava resolvido pela B3
  (`379`/`381`: excluir ou mover veículo com o recálculo falhando é recusado),
  agora com teste. Prova: `exclusaoEEfeitosImportacao.local-pg.test.ts` e
  `Alertas.reprocessar.test.tsx`.
- **Lote 5 — CE e Manifesto Mercante** (migrations `396` e `397`): decisões 19 e 20;
  F-49, F-53, F-17 (recusa da planilha de CE testada) e F-18 (tempo da planilha
  de CE). Remover o CE ou cancelar o B/L tira do Manifesto, com Histórico;
  reativar recoloca; mudar de rota com CE abre "CE fora do Manifesto da rota"
  (normal, Documentação); espelho por rota só por RPC; lote não guarda Nº
  recusado; Informar × planilha sem 23505; sobrecarga de 5 argumentos removida;
  falha de cálculo da planilha de CE no formato da B3; `statement_timeout` de
  60 s. Prova: `ceEManifestoMercante.local-pg.test.ts` e
  `ceForaDoManifestoAlerta.test.ts`.
- **Lote 6 — Vazios** (migrations `398` a `400`): decisões 21 e 22; F-32. Um vazio de
  importação por Viagem (índice único `voyage_id` + `container_key`, repetidos
  reduzidos a uma linha); a planilha vale sobre o Baplie e o tira do container
  que traz; o Baplie cadastra só o que nenhuma planilha trouxe e devolve
  `planilha`; container de outra planilha em outra rota recusado com o
  container e a rota; prévia da planilha e `/baplie` mostram a diferença. ADR
  de Saída fechado: incluir e editar unidade recusados nas RPCs e o gatilho
  `guard_vazios_export_adr_lock` recusa a escrita direta, inclusive criar o
  Embarque (`399`), com o porto comparado pela régua de porto (`400`); a
  planilha que substitui o vazio do Baplie fica com a natureza dele (`400`);
  a tela tira as ações
  (`vazios_export_adr_locked`). Prova: `vaziosUmaVezPorViagem.local-pg.test.ts`,
  `vaziosImportacaoImport.test.ts`, `baplieVaziosPending.test.ts` e
  `EmbarqueVazios.flow.test.tsx`.
- **Lote 7 — ATD do POL** (migration `401`): decisão 23; F-48. ATD do POL
  gravado à mão (Rotas e Manifestos → **Editar**, que grava o Histórico
  `voyage_pol_schedule`) marca o POL em `voyage_pol_atd_manual` (quem e quando,
  pelo gatilho `voyage_pol_atd_manual_mark`); a importação de B/L e o
  cancelamento não recalculam o POL marcado e a prévia avisa a divergência do
  Laden on Board; apagar o ATD à mão desfaz a marca e volta ao cálculo. O ATD
  calculado (`_recompute_voyage_pol_atd`) conta só B/Ls ativos; cancelar e
  reativar recalculam. Correções manuais anteriores marcadas na migration.
  Prova: `atdDoPolManual.local-pg.test.ts` e `ws1FunctionalSmoke.test.ts`.
- **Lote 10 — hash e desova** (migrations `420` e `421`, números provisórios):
  decisões 3 e 26; F-50 (desova). Toda importação por arquivo que grava lote
  (arquivo de B/L, Manifesto BB e B/L avulso, Granito, Embarque de Vazios e
  Vazios de Importação) guarda nome, SHA-256 do arquivo (calculado no
  navegador, formato conferido no servidor), quem e quando; o índice único que
  recusaria o reenvio virou índice comum e a prévia avisa "Este arquivo já foi
  importado em <data> por <pessoa>" (`import_file_previous_upload`). Um local de
  desova por container físico: gravar num B/L grava em todos os B/Ls ativos da
  Viagem com o mesmo container (gatilho em `bl_containers`), B/L novo herda, e
  `/veiculos` pede confirmação para trocar um local já gravado. Prova:
  `hashEDesova.local-pg.test.ts`, `importFileReceipt.test.ts`,
  `Veiculos.unpackingCache.test.tsx`, `vaziosNatureza.test.ts`.
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
| 1 Trava e Baplie no servidor (entregue, ver acima) | 6, 11, 13 | F-04, F-11, F-16, F-20, F-21, F-22, F-26 | trava `import_voyage:<id>` em toda RPC de Viagem; índice único no staging do Baplie; Baplie substitui só os PODs do pedido; Viagem, escalas e duplicatas no servidor; `expected` (contagem) na gravação; staging, marcas e vazios do Baplie numa transação só (ou o passo seguinte enfileirado como efeito); `_set_import_context` de volta nos vazios do Baplie | duas sessões concorrentes; filtro de POD preserva o resto; falha no meio não deixa staging com marca e B/L sem |
| 2 Arquivo de B/L (entregue, ver acima) | 5, 8, 9, 10, 26, 27 | F-05, F-15, F-27, F-50 | B/L de outra Viagem recusado; aviso de B/L cancelado; aceite de refixar levado ao servidor; confirmação só com fatura emitida e conferida no servidor; totais não mudam sem containers; aba VIN ignorada e fim de `vela.vin_reissue`; `container_load_type` gravado (coluna a confirmar no arquivo real) | local-pg por regra |
| 3 Portos (entregue, ver acima) | 12 | F-08, F-33b | `normalize_port_code` sem BRNVT→BRITJ e BRREC→BRSUA; aliases do front; dados gravados | B/L de Navegantes não casa escala de Itajaí |
| 4 Exclusão e efeitos (entregue, ver acima) | 7, 18, 25 | F-10 (só a suíte), F-13, F-14, F-33a, F-34, F-42, F-43 | exclusão encerra efeitos e apaga vazios da Viagem; espera de negócio não é bloqueio; reprocessar no alerta; ator de sistema; excluir/mover veículo enfileira o efeito; `import_effects_queue_health` passa a contar `blocked` e `running` com lease vencida | efeito órfão some; alerta fecha; saúde da fila acusa bloqueado e lease vencida; excluir o irmão de container compartilhado faturado |
| 5 CE e Manifesto Mercante (entregue, ver acima) | 19, 20 | F-49, F-53 | remover CE e cancelar tiram do Manifesto; alerta "CE fora do Manifesto da rota"; planilha de CE com recusa de cálculo testada e mensagem no formato da ADR 0094 | local-pg |
| 6 Vazios (entregue, ver acima) | 21, 22 | F-32 | unicidade por Viagem, planilha vence; ADR de Saída fechado trava | local-pg |
| 7 ATD (entregue, ver acima) | 23 | F-48 | ATD manual marcado e preservado; só B/Ls ativos | local-pg |
| 8 Histórico | 24 | F-23, F-24, F-46 | `bl_timeline` lê `bls`, `vehicles` e `bl_containers`; origem Base de Clientes; `audit_logs` sem INSERT direto | local-pg + vitest |
| 9 Baplie: armador e transbordo | 14, 15 | — | códigos do armador no cadastro; transbordo marcado | vitest + local-pg |
| 10 Hash e desova (entregue, ver acima) | 3, 26 | F-50 | `import_batches` com hash e aviso de reenvio; desova por container físico | local-pg |

## Pendências

- Do Lote 4 (F-42): o erro que escapa do `import-effects-runner` (57014, rede)
  ainda chega ao efeito como `lease_expired` depois de cinco leases, sem a
  causa; gravar a causa exige mudar a Edge Function (`drain.ts`) e uma RPC de
  registro. `granite_billing` com consumidor no-op e `physical_flags` sem
  produtor continuam como estão.

- Do Lote 5: a reconciliação do "CE Mercante pendente" continua rodando por B/L
  dentro da planilha de CE (F-18, custo quadrático); o teto passou a 60 s
  (`statement_timeout`), sem nova medição de volume, e a reconciliação uma vez
  por Viagem e a mensagem própria de 57014 ficaram de fora. O 23505 de chassi (F-39) não é
  deste lote.

- Do Lote 10: Veículos, planilha de CE, datas de container, Programação, Base
  de Clientes e Baplie não gravam lote e ficaram sem hash nem aviso de
  reenvio. A confirmação da troca de desova na planilha de Veículos continua
  olhando o container do B/L da linha; container que já tinha dois locais
  diferentes antes da `421` só se unifica na próxima gravação.

- Nenhuma do Lote 2: a modalidade FCL/LCL é lida do Type of Movement
  ("LCL/LCL" e "CFS-CFS" no B/L LCL real da COSCO).
