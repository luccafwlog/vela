# 0027 — Agency Departure Report: agregado por escala, exibição derivada e fechamento com snapshot

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** ADR usa identidade por terminal da escala; seis seções, três sign-offs departamentais, observações por seção e terminal resolvido por B/L. O agregado legado continua legível.
> Rastreabilidade: [ADR 0029](./0029-adr-signoff-departamental-fases-ciclo.md), [ADR 0030](./0030-adr-observacoes-por-secao-substitui-ocorrencias.md), [ADR 0035](./0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md), [ADR 0036](./0036-adr-embarque-vazios-secao-unica-escala-fora-das-fases.md), [ADR 0068](./0068-terminal-do-bl-herdado-da-frente-com-excecao-individual.md); [migration ativa 059](../../supabase/migrations/059_pr698_integrity_hardening.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-19

## Contexto

A empresa chama de ADR (Agency Departure Report) o relatório completo de uma
escala do navio — datas confirmadas, carga descarregada/carregada, vazios,
granito, carga solta, veículos, depot, overtime e ocorrências. É a fonte que o
Financeiro usa para aprovar pagamentos de faturas. O sistema precisa
materializá-lo, mas três tensões estruturais aparecem:

1. **A escala não é entidade de primeira classe.** Datas, número de escala,
   omissão e soft-delete são reconstruídos de `audit_logs`
   (`entity_type='voyage_pod_schedule'`, chave `${voyageId}::${POD}`) em
   `src/services/voyageRouteSchedules.ts`. Não há PK de escala para FK.
2. **Quase todo o conteúdo já existe** em módulos donos (B/Ls, Baplie, granito,
   veículos, vazios). Duplicá-lo no ADR criaria duas verdades.
3. **O Financeiro precisa de um registro estável**, mas os módulos de origem
   são vivos (reimports de Baplie, correções de B/L) — um relatório calculado
   na hora poderia mudar depois de lido.

Alternativas consideradas para a âncora: (a) tabela própria do ADR com chave
natural `(voyage_id, port)`; (b) promover a escala a tabela `port_calls`
migrando a projeção de audit_logs; (c) ADR sem tabela, só visão calculada.

## Decisão

**Âncora (a):** criar o agregado `agency_departure_reports` com chave natural
`(voyage_id, port)` — a mesma identidade `${voyageId}::${POD}` já usada pelo
sistema — sem promover a escala a entidade. Um ADR por escala brasileira (POD);
POLs estrangeiros não geram ADR. A promoção da escala a tabela permanece como
evolução futura; a opção (b) foi rejeitada agora por exigir migração de dados
vivos tocando line-up, viagens, omissão e status, muito além do escopo. A opção
(c) foi rejeitada porque o ADR tem dados próprios (ocorrências, sign-offs,
snapshot) e precisa de registro estável.

Em código e schema o nome é sempre `agency_departure_report` — nunca `adr`,
que neste repositório significa Architecture Decision Record.

**Exibição derivada, não redigitação:** o ADR agrega e exibe dados dos módulos
donos (datas da projeção de escala; carga dos B/Ls/Baplie; granito; veículos;
vazios). Dados que faltavam no sistema nascem nos módulos donos, não no ADR:
porto de embarque, depot e overtime (handling/transporte) por container entram
no módulo de Vazios de Exportação. Apenas dois conteúdos nascem no ADR:
ocorrências (lançamentos livres append-only com autor/departamento/timestamp)
e os sign-offs de seção.

**Sign-off por seção com dono departamental:** cada seção tem um departamento
dono e estado explícito Pendente → Confirmado ou Nada a declarar, porque
ausência de dado não distingue "ninguém preencheu" de "não houve". Donos:
Operações — datas confirmadas e ocorrências; Equipamentos (novo perfil RBAC,
com escrita em VAZIOS EXP e Veículos) — vazios embarcados e veículos;
Documentação — carga descarregada, carga carregada e vazios descarregados.
Pendências só alertam após o ATD da escala e são direcionadas ao departamento
dono via alertas internos.

**Fechamento com snapshot:** ação explícita, permitida quando todas as seções
têm sign-off, congela um snapshot dos dados derivados + próprios. O Financeiro
consome o snapshot (sem ato próprio de aprovação — consulta apenas, preservando
seu escopo atual). Reabertura exige justificativa auditada e novo fechamento.
Mudanças na origem após o fechamento não alteram o relatório silenciosamente.
O ADR fechado é imprimível pelo padrão existente de documentos React +
`window.print()`.

## Consequências

- A UI vive como aba no detalhe da Viagem (`/viagens/:voyageId`), com seletor
  de escala e deep-link; não há rota top-level nova nesta fase.
- `vazios_bookings` ganha porto de embarque, depot, material, bundle,
  transporte, hand-in/hand-out e flags de overtime por container/booking,
  alimentados por colunas novas na planilha modelo e edição inline na tela —
  o modelo existente é estendido, não recriado. A operação de vazios da
  escala (OS, % de overtime por depot) e os serviços extra de reorganização
  (qty × tarifa configurável) ganham tabelas próprias no módulo de vazios.
  O detalhamento vive na spec
  `docs/archive/specs/2026-07-19-agency-departure-report-design.md` (arquivada
  após a execução do plano derivado; caminho original `docs/spec/`), validada
  contra o modelo real de ADR da empresa.
- Novo papel `Equipamentos` em `user_profiles`, com RLS/RPCs próprios; o mapa
  de escopos em CONTEXT.md ganha o Escopo de Equipamentos.
- O snapshot duplica dados por design no fechamento — é o custo aceito para a
  estabilidade exigida pelo Financeiro; antes do fechamento nada é duplicado.
- O conteúdo interno do snapshot continua sendo derivado no cliente no momento
  do fechamento. A RPC valida a forma, as chaves canônicas e um limite de
  tamanho, mas não reconstitui cada métrica a partir das tabelas de origem;
  esse risco residual de integridade é editorialmente aceito enquanto a UI
  permanecer a única autora do fechamento e o registro for imutável depois.
- Se a escala um dia virar entidade própria, `agency_departure_reports` migra
  de chave natural para FK — mudança contida numa tabela e seus consumidores.
