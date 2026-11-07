# 0134 — Mapa dos alertas na tela Regras de alertas

Status: aceito — 2026-11-07 (decisões do dono). Implementada na tela
`/alertas/regras`, em `src/services/alertRulesMap.ts` e na migration `622`.

## Contexto

A tela Regras de alertas explicava cada alerta sozinho, numa lista por assunto
([ADR 0130](./0130-gravidade-do-alerta-pela-tela.md)). Os alertas, porém,
chegam em fila: a Declaração de veículos sem resposta vira Planilha de Veículos
ausente, que segura o CE Mercante, que trava a Demurrage, a fatura e o
Desbloqueio de CE. Quem lê um alerta sozinho não vê por que um Normal do D−7
importa na retirada da carga. O dono pediu uma tela mais didática, em forma de
organograma ou linha do tempo, onde um clique mostrasse os impactos e os
alertas que surgem de outro. Um protótipo com os alertas vivos foi aprovado
antes da construção.

## Decisão

1. **O mapa abre primeiro.** A tela abre num mapa em doze momentos: D−7, D−5,
   ETA e ATA, ATB, ATD e ATD + 72 h (a viagem); Pagamento, Retirada e Depois
   da descarga; Portal do Cliente, Comunicados e contatos e Bastidores (a
   qualquer momento). A lista de hoje fica na aba **Lista**, com os mesmos
   filtros. O alerta que não abre mais (Veículos alterados na reimportação do
   B/L) fica só na lista.
2. **Cada cartão mostra quantos a pessoa vê na fila**, e o número abre a fila
   já filtrada no tipo (`/alertas?tipo=`). A contagem é a da fila de quem
   pergunta: o alerta técnico conta só para a conta Dev
   ([ADR 0133](./0133-alertas-tecnicos-so-para-a-conta-dev.md)); migration
   `622`, `count_alert_queue_by_type()`.
3. **Os avisos que não são alertas entram como marcos discretos**: Novo
   pagamento, Novo pagamento de Demurrage, Nova solicitação de desbloqueio de
   CE e Novo documento anual VIP (sino), e ADR fechado (e-mail). Têm ficha e
   cadeia, sem gravidade nem fila.
4. **"E se ninguém agir?" fica na ficha de todo alerta, para todos.** Mostra a
   cascata passo a passo no mapa, seguindo só o que vira, o que segura e o que
   atrapalha sem aparecer, e termina no que fica parado.
5. **As ligações foram revisadas pelo dono.** São cinco tipos: vira, segura,
   atrapalha, depois (em seguida, pode abrir) e mesma causa. Das ligações do
   protótipo, as lidas do texto das regras e as oito deduzidas foram
   confirmadas, e entraram três que faltavam: Taxa alterada à mão mudou →
   Fatura desatualizada, CE trocado depois do Desbloqueio → B/L divergente na
   ZPT e Container sem descarga → Datas mudaram em Invoice emitida.

A ficha ganha o bloco **Cadeia deste alerta** no topo (vem antes, se ninguém
agir, em seguida, mesma causa e o que fica parado), também na aba Lista. **O
que fica parado** reúne nove coisas que importam ao Cliente e ao caixa (CE
Mercante, fatura, avisos, Portal, Pix, Desbloqueio de CE, ADR de Saída,
cobrança de Demurrage e os próprios alertas); escolher uma lista os alertas
que podem segurá-la. O filtro **Setor avisado** ganha **Conta Dev**, e o
alerta só da conta Dev deixa de contar para o Administrativo.

## Consequências

- Nada muda em quem recebe, na gravidade nem no reforço por tempo: a tela só
  explica. A troca de gravidade e o reforço continuam no fim da ficha, só para
  o Administrativo.
- Alerta novo precisa de lugar no mapa e da lista do que fica parado:
  `alertRulesMap.test.ts` falha sem eles, e confere a conta Dev contra as
  migrations `605`, `620` e `621`. Ligação nova pede a mesma revisão do dono.
- O filtro `?tipo=` da fila vale, como os outros filtros dela, na página
  carregada (100 alertas por página).
