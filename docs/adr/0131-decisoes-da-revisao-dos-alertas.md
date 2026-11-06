# 0131 — Decisões do dono sobre a revisão de cobertura dos alertas

> **Situação atual (2026-11-06).** Correção do dono à D1: o alerta do prazo do desbloqueio não fecha com a exportação para a ZPT; fecha quando a conciliação da ZPT traz o B/L como desbloqueado no CE atual (migration `612`). O resto da D1 continua valendo.

Status: aceito — 2026-11-06 (decisões do dono). Implementação em lotes no
[plano](../archive/plans/2026-11-06-decisoes-da-revisao-dos-alertas.md).

## Contexto

A [revisão de cobertura dos alertas](../archive/audits/2026-11-06-cobertura-dos-alertas-no-fluxo-de-trabalho.md)
achou 26 brechas e levou oito perguntas ao dono. As respostas vieram em
2026-11-06, pela página de decisões, com quatro complementos na mesma conversa.

## Decisão

1. **D1 — Desbloqueio de CE.** A solicitação enviada pelo Cliente avisa no sino
   a Documentação e o Administrativo. Solicitação sem resposta em 2 horas úteis
   (contadas só entre 8h e 17h de Brasília, em dia útil) abre alerta **Crítico**.
   Validada a documentação, o prazo do desbloqueio corre sem alerta; 2 horas
   depois do início abre alerta **Normal**, que vira **Crítico** 2 horas antes do
   vencimento. A Documentação e o Administrativo recebem.
2. **D2 — Descarga.** Por atracação: alerta Normal no ATB do terminal quando
   algum container dos B/Ls daquele terminal está sem data de descarga, e
   Crítico 24 horas depois. Equipamentos recebe.
3. **D3 — Datas do navio.** ATA e ATD não registrados 16 horas depois do ETA e
   do ETD: o alerta Normal de hoje vira Crítico e avisa de novo.
4. **D4 — CE antes da hora.** Não se vincula CE a B/L de container sem o Baplie
   conciliado nem sem a informação de veículos (planilha importada ou
   declaração de que não há veículos). A Viagem sem Baplie se declara, com
   motivo. A prévia do CE mostra as divergências da rota e pede confirmação.
5. **D5 — Exportação.** O alerta de exportação pendente pós-ATD passa a
   Equipamentos, e o ADR de Saída recusa **Nada a declarar** e **Fechar ADR**
   com a exportação declarada e não lançada.
6. **D6 — Fechar o ADR.** O ADR fecha sozinho com as três assinaturas e manda
   e-mail com o resumo e o link do ADR a todos os usuários internos ativos.
7. **D7 — Quem recebe.** Falha na PTAX: Equipamentos. Calendário de feriados:
   Administrativo com a marca Dev. Tabela de cobrança faltando, Cálculo
   bloqueado e Portal não provisionado: a Documentação continua avisada e o
   Administrativo também.
8. **D8 — Alerta esquecido.** Ajuste geral na tela **Regras de alertas**:
   "vira Crítico depois de N horas aberto", com novo aviso no sino.

## Consequências

- A gravidade deixa de ser só do tipo: um alerta aberto pode ficar Crítico por
  tempo ou por marco (D1, D2, D3, D8). A troca de gravidade da tela
  ([ADR 0130](./0130-gravidade-do-alerta-pela-tela.md)) muda o tipo e os
  abertos sem rebaixar os que escalaram.
- D4 estende a trava da [ADR 0128](./0128-ce-mercante-travado-ate-resposta-de-veiculos.md)
  ao Baplie.
- D6 muda a [ADR 0039](./0039-prazo-de-conclusao-do-adr-medido-por-departamento.md)
  no ponto em que o fechamento era "ato sem dono".
- Cada lote registra no plano a migration e a prova.
