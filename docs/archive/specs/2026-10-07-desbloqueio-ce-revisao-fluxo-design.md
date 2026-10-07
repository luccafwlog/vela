# Desbloqueio de CE Mercante — revisão do fluxo operacional

Estado: aprovada pelo responsável pelo Vela em 2026-10-07, após entrevista
estruturada; implementada localmente no mesmo dia (arquivada). Publicação e aceite da
planilha pela ZPT pendentes. Revisa a
[spec de 2026-10-04](../../spec/2026-10-04-desbloqueio-ce-mercante-design.md) nos pontos
abaixo; o que não é citado aqui continua valendo.
Plano derivado: [implementação](../plans/2026-10-07-desbloqueio-ce-revisao-fluxo.md).

## Contexto

A ZPT ("Desbloqueio de Frete :: Cargas") é o sistema que efetivamente desbloqueia
o CE Mercante: quando as quatro colunas de uma carga (Financeiro, Termo de
devolução, Procuração, BL de Entrega) estão marcadas, ela desbloqueia sozinha.
O Vela substitui o controle manual dessas colunas: a agência controla os
requisitos no Vela e sobe na ZPT uma planilha exportada dele.

Evidência analisada: dois arquivos reais do "Exportar Tela" da ZPT (38 cargas
desbloqueadas e 2.039 bloqueadas, 07/10/2026). Todo bloqueado tem pelo menos uma
coluna "Não"; nenhum tem as quatro marcadas. O modelo de **importação** da aba
"Planilha desbloqueio" da ZPT ainda não foi fornecido.

## Decisões

### Documentos e VIP

1. O documento de termo passa a se chamar **Termo de devolução** no Portal e no
   Vela.
2. VIP continua como implementado: termo e procuração anuais aprovados por CNPJ,
   solicitação pelo Portal sem anexos por pedido. A solicitação VIP **não passa**
   pela aba Solicitações; seus BLs entram direto no Controle ZPT com termo e
   procuração atendidos pela cobertura anual.

### Portal

3. Seleção de BLs com CE e taxas locais pagas; anexos separados de termo de
   devolução e procuração; envio da solicitação (sem mudança).
4. O cliente pode **cancelar** a solicitação enquanto estiver em `draft` ou
   `changes_requested`. Depois disso, só a agência cancela, com motivo.
5. O Portal mostra os quatro requisitos por BL e o **prazo do SLA**. Não menciona
   ZPT, exportação, envio nem desbloqueio confirmado. Com os quatro requisitos
   atendidos: "Documentação validada. Prazo para desbloqueio até {prazo}.
   Consulte o Mercante para verificar o desbloqueio."
6. Notificações ao cliente, no sino do Portal e por e-mail para a caixa de
   recebimento **Documentação e Operação** (`documentacao_operacao`):
   - recusa de termo e/ou procuração, com o motivo;
   - documentação validada (os quatro requisitos atendidos), com o prazo.

### Vela — aba Solicitações

7. Uma linha por solicitação `source='request'` aguardando análise
   (`submitted`, `in_review`, `changes_requested`), com os BLs do pedido.
8. Termo de devolução e procuração são aprovados ou recusados **separadamente**,
   valendo para **todos os BLs do pedido**. Some a seleção de BLs na análise.
9. Recusa exige motivo, exibido ao cliente; o pedido vai a `changes_requested`.
   Recusar um documento não desfaz a aprovação do outro.
10. Com os dois documentos aprovados, a solicitação sai da aba Solicitações.

### Vela — aba Controle ZPT

11. Uma linha por BL com CE, com ou sem solicitação. Filtro padrão:
    **Aptos — não exportados**.
12. Colunas de requisito como caixas: T. de Devolução, Procuração e Financeiro
    somente leitura; **BL de Entrega** clicável, inclusive sem solicitação.
    Marcar pede confirmação curta; desmarcar exige motivo.
13. Coluna **Prazo** com o SLA, destacando vencidos e os que vencem hoje.
14. A solicitação fica **Concluída** quando todos os seus BLs têm os quatro
    requisitos atendidos. A conclusão não depende de exportação.

### SLA

15. Início: envio da solicitação pelo Portal.
16. Janelas, em America/Sao_Paulo e só em dias úteis (segunda a sexta, sem
    calendário de feriados):
    - início antes das 12:00 (inclusive antes das 08:30) vence às **17:00** do
      mesmo dia útil;
    - início a partir das 12:00 vence às **12:30 do próximo dia útil**;
    - início em sábado/domingo é tratado como se ocorresse antes das 08:00 de
      segunda-feira, isto é, na janela da manhã desse dia (confirmar com o
      responsável se o prazo desse caso é 17:00 ou 12:00; ver nota abaixo).
17. O prazo **recomeça** quando o cliente resolve uma pendência sua: reenvio de
    documento recusado, registro da entrega do BL original ou nova liquidação
    após perda da aptidão financeira. O início vigente é o mais recente desses
    fatos.
18. Cumprimento do SLA é medido pela **data da exportação** do BL.
19. Prazo visível no Vela e no Portal.

### Envio à ZPT

20. Exportação só de BLs com os quatro requisitos atendidos, até 100 por lote.
21. Cabeçalho idêntico ao do arquivo da ZPT: `BL`, `Financeiro`,
    `Term. Devolucao`, `Procuracao`, `BL Entrega`; valores `Sim`/`Não`.
    Layout novo `zpt-5-v2`; lotes antigos permanecem com seu layout.
22. **Exportar é o registro do envio**: o BL passa a "Exportado em {data} por
    {usuário}" e sai da fila padrão. Removem-se "Registrar envio à ZPT",
    "Confirmar desbloqueio" por BL com referência externa e a seção
    "Confirmações externas". "Reconferir CE" permanece.
23. "Reexportar" continua disponível para BLs já exportados (divergentes ou não).

### Conciliação com a ZPT

24. A agência importa no Vela o `.xls` do "Exportar Tela" da ZPT (aba
    `Worksheet`; colunas Manifesto, BL, CE, Consignatário, Status, Descrição,
    Nome Usuario, Data da Ação, Data Atualização, Financeiro, Term. Devolucao,
    Procuracao, BL Entrega). Casamento por **CE**, tratado como texto.
25. Resultado, visível só no Vela:
    - `Desbloqueado` → "Desbloqueio conferido em {Data Atualização}", inclusive
      para CE nunca exportado pelo Vela (com a observação "sem exportação pelo
      Vela");
    - exportado pelo Vela e ainda `Bloqueado` (ou outro status) → **Divergente**,
      com Status, Descrição e as colunas que a ZPT ainda tem como "Não", e
      ação "Reexportar";
    - bloqueado e não exportado pelo Vela → ignorado;
    - CE inexistente no Vela → apenas contado no resumo da importação.
26. Guarda por CE: Status, Descrição, Data Atualização e as colunas em "Não",
    além de quem importou e quando. **Não** guarda "Nome Usuario" (CPF e nome do
    operador da ZPT) nem os horários dos checks.
27. A conciliação não altera o SLA (decisão 18) nem o que o Portal mostra.

## Fora do escopo

- Integração por API com ZPT/Mercante.
- Calendário de feriados.
- Homologação do arquivo de importação da ZPT: até o primeiro upload real
  aceito, a ponte de envio não está comprovada.
