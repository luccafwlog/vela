# 0028 — Sign-off do ADR com histórico auditável e justificativa de reversão

> **Situação atual (2026-10-13).** Decisão vigente e implementada (definição atual de `set_agency_report_signoff` na migration `002`). Estendida pela [ADR 0029](./0029-adr-signoff-departamental-fases-ciclo.md) (justificativa também ao reabrir o sign-off departamental) e pela [ADR 0030](./0030-adr-observacoes-por-secao-substitui-ocorrencias.md) (a Observação fica fora do histórico).
> No ADR por terminal o histórico grava `entity_id = {report_id}::{section}`; o formato `{voyageId}::{PORT}::{section}` vale só para o ADR legado.
> As migrations `213`, `218`, `220` e `221` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente: [Viagens](../modules/viagens.md), regras do Agency Departure Report.

Status: estendida — 2026-07-21

## Contexto

A ADR 0027 definiu o sign-off de seção do Agency Departure Report como um
estado explícito (Pendente → Confirmado ou Nada a declarar), mas a primeira
implementação (migration 213) tratava toda transição da mesma forma: um
`UPSERT` que sobrescrevia o estado sem registrar quem mudou o quê nem por quê,
e sem distinguir a primeira decisão de uma reversão. Na prática, qualquer
usuário do departamento dono podia alternar livremente entre os três estados
sem deixar rastro, o que é inaceitável para um relatório que o Financeiro usa
como base de aprovação de faturas.

A revisão de UI/UX da aba ADR (auditoria de 2026-07-21) expôs esse problema:
a interface mostrava um badge de estado e dois botões de ação com a mesma
aparência, sem deixar claro que trocar uma decisão já tomada é uma ação com
peso diferente de tomar a primeira decisão.

Alternativas consideradas para o histórico: (a) reutilizar `audit_logs`
(tabela genérica já usada por `reopen_agency_departure_report`, migration 218,
e por outros módulos como `customer_ficha`); (b) criar uma tabela dedicada
`agency_departure_report_signoff_events`.

## Decisão

**Duas categorias de transição, não uma:** sair de "pending" pela primeira vez
é a primeira decisão da seção e só exige confirmação explícita na UI (um
diálogo de "tem certeza", sem campo de texto). Alterar uma decisão já
registrada — voltar a "pending" ou trocar entre "confirmed" e
"nothing_to_declare" — exige justificativa em texto, validada no servidor
(`set_agency_report_signoff`, migration 221), não apenas na UI.

**Histórico reaproveita `audit_logs` (opção a):** rejeitamos a tabela dedicada
porque `audit_logs` já tem exatamente as colunas necessárias (entidade, campo,
valor antigo/novo, autor, justificativa, timestamp) e já é o padrão do
`reopen_agency_departure_report` para o mesmo relatório. Cada transição grava
uma linha com `entity_type='agency_departure_report_signoff'` e
`entity_id='{voyageId}::{PORT}::{section}'`. Transições sem mudança de estado
(clicar no estado já ativo) não gravam evento — idempotente.

`get_agency_report_actor_names` (migration 220) foi estendida para também
resolver os autores de eventos históricos, não só dos sign-offs correntes,
porque um autor pode ter sido sobrescrito pela transição seguinte e ainda
assim precisa aparecer no histórico.

**Exposição na UI:** cada seção mantém a linha-resumo atual (estado + autor +
data) sempre visível; o histórico completo fica atrás de um ícone "ver
histórico", carregado sob demanda — evita poluir a leitura do dia a dia
enquanto mantém a auditoria a um clique.

## Consequências

- Nenhuma tabela nova; `set_agency_report_signoff` ganha um quinto parâmetro
  opcional (`p_justification`), quebrando a assinatura de 4 argumentos — único
  consumidor é `src/services/agencyDepartureReport.ts`.
- O histórico de sign-off de um ADR fica misturado, em `audit_logs`, com o
  histórico de reabertura do mesmo relatório (mesmo padrão de entidade
  prefixado por `voyageId::PORT`) — consistente, não uma duplicação de
  conceito.
- Se o volume de eventos por seção crescer a ponto de `audit_logs` genérica
  não escalar para esse caso de uso, a extração para tabela dedicada é uma
  migração contida (copiar linhas filtradas por `entity_type`), sem mudar o
  contrato do RPC.
