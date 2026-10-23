# 0097 — Data efetiva confirmada em Chegadas e Saídas e aparição na Programação controlada pela Viagem

Status: aceito — 2026-10-22 (decisões do responsável na revisão manual de
viagens, Chegadas e Saídas e importações). Implementada nas migrations `413`
(viagem duplicada) e `414` (confirmação), e nas telas Viagens e Chegadas e
Saídas.

Supersede o item 12 da [ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md)
(a viagem volta a poder sair da Programação antes do último ATD) e estende a
decisão 23 da [ADR 0095](./0095-importacoes-regras-da-revisao.md) (a correção
manual do ATD do POL continua vencendo; a confirmação é outra coisa).

## Contexto

Na Programação, a previsão já passada sem data efetiva fica em âmbar. A saída
efetiva (ATD do POL) só chega com o Laden on Board do B/L, uma a três semanas
depois, e o operador não tinha como confirmar a data antes. O âmbar também
aparecia no Portal, onde não tem utilidade para o cliente. E a aparição da
viagem na Programação só era ligada por Chegadas e Saídas; a tela Viagens não
a controlava, e nada a desligava antes do último ATD.

## Decisão

1. **O âmbar é só do operador.** No Portal existem só dois estados de data:
   previsão e data efetiva. O cliente não vê o mecanismo de confirmação.
2. **O operador confirma a data efetiva em Chegadas e Saídas**, pela célula
   vencida: a chegada grava o ATA da escala (com hora, como o modal da
   Escala); a saída grava o ATD do POL (só a data, como o Laden on Board).
3. **Duas regras para o ATD do POL.** A saída confirmada em Chegadas e Saídas
   é provisória: se o B/L trouxer depois um Laden on Board diferente, a data do
   B/L substitui a confirmada, com as duas datas na linha do tempo; com a mesma
   data, a confirmação só deixa de valer. A correção feita em Viagens → Rotas e
   Manifestos → Editar continua vencendo o B/L (ADR 0095, decisão 23) e tira a
   confirmação.
4. **A Viagem controla a aparição na Programação.** O cadastro em Viagens
   oferece "Aparece em Chegadas e Saídas", e a edição liga ou desliga. Desligar
   tira a viagem da Programação do Vela e do Portal antes do último ATD,
   registrado no Histórico ("Aparece em Chegadas e Saídas: Sim → Não"); vale
   para qualquer usuário interno ativo.
5. **Navio e número de viagem não se repetem** (inclusive Viagem Cancelada),
   na tela e no banco.

## Consequências

- `voyage_pol_atd_confirmed` guarda a saída confirmada; `confirm_schedule_effective_date`
  grava a confirmação; `_recompute_voyage_pol_atd` faz o B/L substituí-la.
- "Chegadas e Saídas nunca grava ATA/ATD" deixa de valer: grava pela
  confirmação, só na célula sem data efetiva.
- O "Remover do Portal" volta como chave da Viagem, não como ação da tela
  Chegadas e Saídas.
