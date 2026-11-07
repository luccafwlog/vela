# 0133 — Alertas técnicos só para a conta Dev

Status: aceito — 2026-11-07 (decisões do dono). Implementada na migration `620`.

## Contexto

Vários alertas avisam de problemas que só o suporte técnico resolve: rotina
parada, provedor de e-mail sem retorno, integração com o Itaú parada. Eles iam a
todo o Administrativo (ou ao Financeiro), que não tem as ferramentas para agir. O
único com as ferramentas é o dono, que é a conta Dev do Administrativo
([ADR 0104](./0104-marca-dev-e-chave-de-envio-pelo-suporte.md)).

## Decisão

1. **Só a conta Dev** recebe no sino e vê na fila e nas contagens: Fila de
   efeitos de importação parada, Provedor de e-mail sem retorno, Rotina agendada
   com resposta de erro, Rotina interna sem rodar, Consulta de Pix do Itaú
   parada (antes do Financeiro) e Retorno do provedor de e-mail não aplicado.
2. **A equipe e a conta Dev**: Faturamento automático falhou, Revisão de B/L —
   fatura retida não saiu e Passo da importação bloqueado. A equipe tem uma ação
   na tela; a conta Dev corrige a causa técnica.
3. **Pela causa**: no Aviso do Desbloqueio de CE não enviado, na Cobrança de
   Demurrage recusada e no Comunicado recusado, recusa por contato do Cliente
   fica com a equipe; falha do provedor de e-mail vai só à conta Dev.

## Consequências

- Sem nenhuma conta Dev ativa, o alerta crítico cai no desvio de sempre, para
  todo o Administrativo.
- Muda a [ADR 0131](./0131-decisoes-da-revisao-dos-alertas.md) (D7) e a
  migration `587` no ponto da Consulta Itaú, que era do Financeiro.
