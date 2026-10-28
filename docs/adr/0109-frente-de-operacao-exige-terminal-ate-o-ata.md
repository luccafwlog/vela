# 0109 — Frente de operação exige terminal até o ATA

Status: aceito — 2026-10-27 (decisão do dono sobre `02-viagens-adr:13`,
resposta "outra": TBC não é terminal; lote 9 do
[plano de correções](../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md)).
Implementada nas migrations `477` e `482`.

Supersede parcialmente a [ADR 0035](./0035-escala-unificada-ancora-do-adr-fontes-da-descarga-e-relatorio-sem-zeros.md)
(nota de 2026-08-24, item 1: a Atracação "pode existir sem terminal (TBC)").
Mantém a [ADR 0068](./0068-terminal-do-bl-herdado-da-frente-com-excecao-individual.md)
(item 8: a exceção de terminal do B/L vence a frente em TBC enquanto ela
existir).

## Contexto

A primeira gravação de uma escala com frente em **TBC** criava uma Atracação
TBC sem datas. Ela não saía quando todas as frentes recebiam terminal, a
janela não deixava preencher o ATD dela e ela contava como Atracação sem ATD:
a escala ficava "Aguardando o ATD de TBC." e a Viagem nunca passava sozinha a
Concluída. Não havia prazo para a frente ganhar terminal.

## Decisão

1. **TBC não é terminal.** É só a falta de terminal de uma frente durante o
   planejamento.
2. **O ATA é o prazo.** Com o ATA da escala registrado, toda frente de
   operação precisa de terminal. Salvar com alguma frente em TBC é recusado na
   janela **Editar escala** e no banco
   (`save_voyage_escala_terminal_state_v2`): "Com o ATA registrado, toda
   frente de operação precisa de terminal: TBC não é terminal. Escolha o
   terminal de cada frente."
3. A Atracação TBC vazia sai assim que nenhuma frente fica em TBC; ela não
   segura a conclusão da escala nem da Viagem. As existentes foram apagadas
   pela migration `477` (afirmação "Data status" do `AGENTS.md`).
4. **A Atracação TBC não tem datas** (decisões do dono de 2026-10-27 e
   2026-10-28, revisão da PR #1070; migrations `482` e `490`). TBC é só
   "terminal a confirmar": o banco recusa ETB, ETD, ATB, ATD e Restow numa
   Atracação sem terminal, antes ou depois do ATA ("TBC não é terminal: ETB,
   ETD, ATB, ATD e Restow só na atracação de um terminal. Escolha o terminal
   antes de informar as datas."). A `482` recusou as datas realizadas e o
   Restow; a `490`, também a previsão. As TBC que tinham esses campos os
   perderam nessas migrations.
5. A Atracação TBC não tem documento próprio: sai sem a trava de CE, fatura
   ou ADR fechado do porto. A regra do ATA e a saída da TBC valem também na
   gravação v1 (`save_voyage_escala_terminal_state`, usada pela declaração de
   exportação), desde a `482`.

## Consequências

- Antes do ATA, a frente pode continuar em TBC, mas a Atracação TBC não
  guarda data nenhuma: a previsão de berço (ETB e ETD) entra quando a frente
  ganha terminal.
- A conclusão da Viagem depende só das Atracações com terminal.
- Remover a Atracação TBC na gravação da escala vale para todos os setores e
  não passa pela trava; remover Atracação com terminal continua com Operações
  e o Administrativo e com a trava por CE, ADR e B/L.

Regra vigente: [Viagens](../modules/viagens.md).
