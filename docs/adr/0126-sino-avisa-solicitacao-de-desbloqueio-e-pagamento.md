# 0126 — O sino avisa a solicitação de Desbloqueio de CE e cada novo pagamento; o menu conta clientes na Revisão

Status: aceito — 2026-11-05 (decisão do dono). Implementada na migration `595`
(sino) e em `useOperationalCounts` (números do menu).

Estende a [ADR 0034](./0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md),
item 6 (fontes de evento numa lista fechada, a definir antes da
implementação), e convive com a [ADR 0107](./0107-sino-so-do-setor-responsavel.md)
(sino só do setor responsável), que continua valendo para a notificação de
Alerta.

## Contexto

O item **Revisão** do menu contava B/Ls em revisão (49 em produção em
2026-11-05), mas a fila se resolve por Cliente: a tela agrupa os B/Ls por
Cliente (cerca de 17 na mesma data) e resolver o Cliente resolve todos os
B/Ls dele. O número parecia maior do que o trabalho.

A solicitação de Desbloqueio de CE nasce no Portal. A Documentação só sabia
dela abrindo a aba Solicitações: o item **Desbloqueio de CE** do menu não
tinha número e o sino não avisava. O pagamento (baixa automática do Itaú,
conciliação pelo extrato ou registro no detalhe) também não chegava ao
Financeiro nem ao Administrativo.

Até aqui toda Notificação Interna nascia de um item de Alerta e saía do sino
quando o item fechava. Solicitação recebida e pagamento recebido são
acontecimentos, não pendências: um Alerta de "pagamento recebido" não tem
condição de origem que feche, e encheria a fila `/alertas`.

## Decisão

1. **Revisão conta clientes.** O número do item Revisão é a quantidade de
   grupos que a tela mostra (mesma regra, `groupReviewItems`: CNPJ válido;
   sem ele, o nome), não a de B/Ls.
2. **Desbloqueio de CE tem número.** O item mostra as solicitações à espera da
   análise dos documentos (as da aba Solicitações), relido a cada 60 s, como o
   de Alertas. O grupo Importação soma os dois.
3. **Aviso de acontecimento.** Notificação Interna sem Alerta
   (`internal_notifications` sem `alert_id`, com `event_key`), sobre um fato da
   lista fechada abaixo. Fica no sino e conta no número até a pessoa ler; ler é
   pessoal, como na notificação de Alerta. Não tem fallback: sem destinatário
   ativo no setor, ninguém recebe e nada vai a **Falhas de entrega de
   alertas**, porque não há pendência a perder.
4. **Lista fechada (2026-11-05):**
   - **Nova solicitação de desbloqueio de CE**, para a Documentação, quando o
     Cliente envia a solicitação comum (não a VIP, que usa os documentos
     anuais já aprovados); no envio depois da correção, "Solicitação de
     desbloqueio de CE reenviada". O clique abre a solicitação.
   - **Novo pagamento**, para o Financeiro e o Administrativo, a cada
     pagamento de fatura de Taxas Locais ou avulsa, qualquer que seja o
     caminho (todos gravam `payments`); o clique abre a fatura.
   - **Novo pagamento de Demurrage**, para os mesmos setores, quando a Invoice
     passa a paga com valor em R$; a quitação pelo desconto integral
     (isenção, R$ 0) não avisa. O clique abre a Invoice.
5. Acrescentar um acontecimento à lista pede decisão do dono e uma linha
   nesta ADR (ou numa nova).

## Consequências

- O sino passa a ter dois tipos de aviso; a notificação de Alerta segue as
  ADRs 0034, 0107 e 0108 sem mudança.
- Cada pagamento gera um aviso por usuário ativo do Financeiro e do
  Administrativo. Com volume alto, o caminho é agrupar por janela de tempo
  ("N pagamentos novos"), anotado como `ponytail` na migration.
- O aviso é gravado na mesma transação do envio ou do pagamento: uma falha na
  entrega desfaz a operação, como o fan-out dos alertas. A entrega só insere
  linhas e não chama serviço externo.
- O número da Revisão lê, em vez de uma contagem, as colunas de agrupamento
  dos B/Ls em revisão (em páginas de 500), como a própria tela.

Regra vigente: [Operação e Suporte § Notificação Interna e Regra de Destinatários](../modules/operacao-suporte.md#notificação-interna-e-regra-de-destinatários)
e [Desbloqueio de CE § Avisos ao cliente](../modules/desbloqueio-ce.md#avisos-ao-cliente).
