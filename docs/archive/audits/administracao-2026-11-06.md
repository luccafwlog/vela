# Diagnóstico: tela Administração — 2026-11-06

Auditoria pontual, nascida histórica. O trabalho decidido a partir dela está no
[plano da Administração revisada](../plans/2026-11-06-administracao-revisada.md), executado e arquivado no mesmo dia;
a regra vigente de cada aba fica em
[Operação e suporte § `/admin`](../../modules/operacao-suporte.md#admin).

Pedido do dono: revisar as abas Falhas de entrega de alertas, Histórico de
ações e Sistema; levar o Prazo do ADR para Relatórios; levar a chave do envio
real para a Administração; entender por que o Histórico de ações mostra
registros repetidos, termos técnicos, horário sem segundos e "de 10.000" quando
há mais de 10 mil linhas.

Evidência: **Runtime** — contagens agregadas no banco de produção
(`fgmkhbzhaeebrsizwccx`), só leitura (`SELECT`), em 2026-11-06, sem ler dado de
pessoa nem alterar linha; **Código** — branch `staging` em `e4445691`.

## Histórico de ações

`audit_logs` tinha **21.000 linhas** de 29/10 a 06/11/2026, mais 320 das trilhas
próprias (Desbloqueio de CE 121, Portal 169, Comunicados 30). Agrupadas pelo par
(`changed_at`, `changed_by`), são **729 ações**: 230 com uma linha, 347 com 2 a 5,
110 com 6 a 50 e 42 com mais de 50. A maior, a importação de B/L da GREEN
SEPETIBA 8 em 04/11 às 14:55:11, gravou 2.539 linhas.

| Origem das linhas | Linhas | Parte |
|---|---:|---:|
| Mudanças que interessam (quem mudou o quê, com motivo) | 5.178 | 24,7% |
| Itens criados junto com a ação (veículos, containers, itens e vínculos de fatura, recebíveis) | 6.686 | 31,8% |
| Colunas técnicas (`updated_at`, `charges_calculated_at`, `batch_id`, `ownership_source`, `pix_payload`, `*_snapshot`, `email_normalized`) | 4.496 | 21,4% |
| Taxas apagadas e refeitas pelo recálculo (`charge_calculations` `excluido`) | 2.087 | 9,9% |
| SOC/COC gravado logo depois de criar o container | 1.808 | 8,6% |
| A mesma mudança gravada duas vezes (linha da função + linha do gatilho) | ≈ 745 | 3,5% |

Causas (**Código**):

1. O gatilho genérico `audit_row_changes` (definição vigente na migration `559`)
   grava uma linha por coluna alterada, sem lista de colunas ignoradas. Campo sem
   rótulo na tela virava "B/L alterado", "Container alterado".
2. Funções gravam a linha "semântica" com `entity_type` no singular (`bl`,
   `invoice`, `voyage`, `customer`) e o gatilho da tabela grava a mesma mudança no
   plural (`bls`, `invoices`…), com o mesmo campo e o mesmo instante. Em tela, duas
   linhas iguais com motivos diferentes.
3. O mesmo campo muda duas vezes na mesma transação: retenção do faturamento
   posta e retirada (114 ações), e-mail do contato (33), retrato das escalas (26).
4. `changed_at` é o `now()` da transação: todas as linhas de uma ação têm o
   mesmo instante, até o microssegundo. Segundos na tela separam ações, não as
   linhas de dentro de uma ação.
5. A contagem de `admin_action_history` para em 10.001 (migration `561`), e o
   rodapé usava o teto como total: "Exibindo 1–50 de 10.000 · Página 1 de 200",
   com o título dizendo "Mais de 10.000 registros". Da página 201 em diante,
   nada era alcançável sem filtro.
6. Textos técnicos no Motivo, gravados pelo banco ou pela tela: "Gate canonico
   aplicado apos importacao" (183), "Onboarding transacional de cliente pela
   revisão manual." (133), "Marcado como pronto para faturar no modulo de Taxas
   Locais" (119), "Emissao de invoice por B/L" (113), "Atualizacao manual de ETD
   por POL" (84), "Gate canonico reaplicado apos e-mail importado" (70),
   "Reprocesso automático das faturas retidas (portal_activation) pela conta de
   sistema" (40), "Atualizacao manual de linked por POD" (18). A coluna Situação
   mostrava o código cru em vários assuntos ("ready_for_billing", 519 linhas).

## Outras abas

- **Falhas de entrega de alertas:** `alert_notification_failures` com 0 linhas
  desde o início da produção.
- **Sistema:** mostra versão, ambiente, última Viagem criada e última fatura
  emitida. As 21 rotinas de `cron.job` não aparecem em tela; todas com a última
  execução `succeeded` e 0 falhas em 7 dias. `app_settings.system_billing_actor`
  vazio (as rotinas usam a conta ativa mais antiga do Administrativo). Feriados
  em `business_holidays` até 25/12/2027.
- **Envio real:** bloco Canal de envio em Clientes › Comunicação, só para a conta
  Dev (ADR 0104). Estado: ligado.
- **Prazo do ADR:** medição por departamento, hoje só do Administrativo, numa
  tela que é de cuidar de pessoas e do sistema.
