# 0093 — Tabela vinculada ao B/L e coerência financeira (revisão de 2026-10-21)

> **Situação atual (2026-10-21).** Implementada na PR luccafwlog/vela#1019,
> migrations `354` a `377`, pelo
> [plano de correções da frente financeira](../archive/plans/2026-10-21-correcoes-frente-financeira.md)
> (arquivado). As regras vigentes estão em [Taxas Locais](../modules/taxas-locais.md),
> [Faturamento](../modules/faturamento.md),
> [Reconciliação PIX](../modules/reconciliacao-pix.md),
> [Portal do Cliente](../modules/portal-cliente.md) e
> [Demurrage](../modules/demurrage.md).
>
> **Supersedida parcialmente pela [ADR 0094](./0094-preco-fixo-na-importacao.md)
> (2026-10-21, migrations `378` a `383`).** O preço das Taxas Locais (tabela,
> Condição, data de referência e câmbio) fica fixo no primeiro cálculo, na
> importação, e não mais no CE: não valem a frase final da decisão 2 (Condição
> nova recalculando B/L sem CE), a decisão 3 no que diz do "dia do CE" e a
> decisão 5 no que diz da ETA como data de referência e do recálculo do
> provisório pela ETA. A decisão 16 vale só para Pix sem TXID nenhum; o de
> TXID de outro sistema na mesma chave segue ignorado. A decisão 21 mantém
> quatro dígitos e o número inteiro a partir de 10.000.
>
> **Supersedida na decisão 16 pela [ADR 0100](./0100-todo-pix-recebido-fica-gravado.md)
> (2026-10-23, migrations `442` e `443`).** O Pix sem TXID não vai mais para
> análise nem abre `pix_unreconciled`: como todo Pix que não é de cobrança do
> Vela, fica gravado como recebido, sem Alerta, na aba Pix recebidos da
> Conciliação, onde o Financeiro pode dar a baixa numa fatura se quiser.
>
> **Nota editorial — 2026-10-22 (decisão do responsável na
> [revisão da PR 1021](../archive/audits/2026-10-22-revisao-pr-1021.md), R-05).**
> O "só o Administrativo edita item de tabela" da decisão 2 vale para tabela
> **já usada** (vínculo com B/L, cálculo ou fatura), cuja correção reemite as
> faturas. Incluir e corrigir item de tabela ainda sem uso fica com todos os
> setores, como o gatilho `guard_tariff_correction_admin` da migration `354` já
> fazia; a tela de Taxas Locais passou a seguir o banco pela migration `407`.
> Editar Condição de Cliente continua só do Administrativo. Regra em
> [Taxas Locais](../modules/taxas-locais.md) e na
> [matriz de permissões](../operations/seguranca.md#taxas-locais-e-faturamento).

Status: supersedida parcialmente — 2026-10-21 (aceita no mesmo dia, decisões do dono respondidas pergunta a pergunta); preço fixo na importação pela ADR 0094

Supersede parcialmente as ADRs
[0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md) (decisão 2),
[0070](./0070-portal-trava-toda-emissao-e-liberacao-por-cliente.md) (nota
"Taxas do dia do CE"),
[0077](./0077-fatura-emitida-nao-muda-de-valor.md) (item 5 e a cotação da
correção) e [0085](./0085-modelo-de-permissoes-por-perfil.md) (D6, para a
Tabela de Taxas Locais e a Condição de Cliente). Estende a
[0002](./0002-portal-self-service-reconsolidation.md) (consolidada
substituída) e a [0075](./0075-fatura-avulsa-flexivel.md) (avulsa no saldo
interno).

## Contexto

A revisão da frente financeira de 2026-10-21 (Vela e Portal; `main` em
`806d2b5`, conferida contra a `staging` em `99e783c`) seguiu o fluxo do cálculo
à restituição e reproduziu os cenários num Postgres 16 local descartável. O
motor de preço, a trava de emissão em dobro, a idempotência do Pix e o
isolamento do Portal estão corretos. Os defeitos estão em quando o cálculo é
reaproveitado, nas projeções que só a fatura paga atualiza e nos caminhos de
exceção. A evidência de cada achado (F-01 a F-56) está no
[plano](../archive/plans/2026-10-21-correcoes-frente-financeira.md).

Parte dos defeitos não tinha regra escrita que dissesse o certo. As perguntas
foram respondidas pelo dono no mesmo dia; esta ADR registra as respostas.

## Decisão

### Tabela de taxas e preço

**1. O B/L fica vinculado à tabela.** A tabela ativa no primeiro cálculo do
B/L (normalmente na importação) fica vinculada a ele, e todo recálculo usa essa
tabela. Desativar a tabela só impede que B/Ls novos a usem; os vinculados
continuam com ela. Reajuste de preço se faz criando uma tabela nova (ou uma
Condição de Cliente nova, com vigência nova); a tabela nova só vale para os
B/Ls que surgirem depois. O B/L misto tem uma tabela de container e uma de
carga solta. Mudança de modo de carga ou de POD vincula o B/L à tabela ativa
do escopo novo naquele momento. "A ativa de vigência mais recente vence"
(ADR 0040, decisão 2) passa a valer só para escolher a tabela no primeiro
cálculo.

**2. Editar um item de tabela ou uma Condição de Cliente é correção de
erro.** A edição:

- recalcula os B/Ls não faturados vinculados àquele item ou Condição,
  inclusive os que já têm CE (exceção à decisão 3);
- cancela e reemite, com número novo, aviso no Portal e QR novo, as faturas
  emitidas com o valor errado e sem nenhum pagamento;
- abre "Fatura desatualizada" nas pagas ou parcialmente pagas, que seguem a
  ADR 0077 (valor menor abate e restitui; valor maior pede avulsa da
  diferença).

Só o Administrativo edita item de tabela e Condição de Cliente. A tela avisa
que a edição corrige as faturas emitidas com o valor e que reajuste pede
tabela nova. Criar ou ativar uma Condição nova recalcula os B/Ls não faturados
e ainda sem CE do Cliente.

**3. No dia do CE fica congelado só o preço.** Ficam fixas a tabela, a
Condição de Cliente e a data de referência. A base do B/L (containers e
rateio, Movement To, POD, peso, veículos) é a atual no momento da emissão,
também na fatura retida pelo gate, no Retomar do lote, no efeito
`local_billing` e no Emitir. Substitui a parte "o reprocessamento não
recalcula" da nota "Taxas do dia do CE" da ADR 0070: o preço não é
recalculado; a base é.

**4. A correção de B/L faturado usa os preços da fatura original.** Só a
mudança da base altera o valor (ADR 0077, itens 2 e 5). A cotação da correção
deixa de usar a tabela e a Condição de hoje.

**5. A ETA alterada depois da emissão não muda a fatura.** A data de
referência fica congelada com o preço.

### Consolidada

**6. Pagamento parcial atualiza a outra fatura.** Pagamento parcial de uma
individual que está numa consolidada aberta atualiza a consolidada para o
saldo restante, com QR novo e o mesmo número. No sentido inverso, pagamento
parcial da consolidada faz cada individual mostrar o saldo restante do seu
B/L, com QR novo; a individual com o B/L quitado passa a "Coberta" e perde o
QR.

**7. Pagar uma individual inteira reemite a consolidada sem ela.** Os QRs das
individuais continuam pagáveis enquanto a consolidada está aberta.

**8. A consolidada substituída continua visível no Portal**, no filtro
"Cancelada", com o status "Substituída" e o aviso "Substituída pela
INV-xxxx"; o detalhe abre, sem QR. O Cliente é avisado por notificação no
Portal, sem e-mail. O QR antigo pago depois da substituição quita a sucessora,
e o que sobra vira restituição pendente.

**9. A consolidada interna pode incluir B/L ainda sem individual**, mas conta
como faturamento dele: o B/L passa a "faturado", nenhuma individual sai por
cima enquanto a consolidada estiver aberta, e a consolidada exige as mesmas
checagens do Emitir (Revisão concluída, CE e gate).

### Saldo

**10. O saldo do Vela separa o faturado do que falta faturar.** Continua
contando por recebível, como decidido em 2026-10-20 ("B/L ainda não faturado
não entra no saldo do Portal; a tela interna, por recebível, continua
contando"), e passa a mostrar:

| Linha | Soma |
|---|---|
| Faturado em aberto | Faturas emitidas e não quitadas, pelo saldo restante, com a mesma regra do Portal: cada B/L uma vez, a consolidada aberta no lugar das individuais dela, a avulsa e a Demurrage emitida ou vencida |
| A faturar | Recebíveis de B/L calculado e ainda sem fatura |
| Saldo pendente total | A soma das duas |

A lista de Clientes mostra o total, com o detalhe ao passar o mouse; a ficha
mostra as três linhas. O que já foi pago não compõe nenhuma delas. O saldo do
Portal não muda: só fatura emitida e não quitada.

**11. A avulsa aberta entra no saldo do Vela**, pelo saldo restante, numa
linha própria ao lado de Taxas Locais e Demurrage.

### Cancelamento, vínculo e troca de Cliente

**12. Cancelar a fatura solta o B/L.** Depois de cancelar a fatura, o B/L pode
ser cancelado, e a nova fatura só sai quando alguém clicar em Emitir — nunca
sozinha pela Liberação, pela ativação do Portal ou pelo CE. No Vela, o
recebível continua no saldo como "A faturar"; no Portal, não entra.

**13. Desvincular o Cliente.** Em B/L não faturado, o recebível é anulado e
nasce de novo, com a Condição certa, quando outro Cliente for vinculado. Em
B/L faturado, desvincular é recusado, e a tela orienta a usar Trocar Cliente.

**14. Cancelar a Viagem** é recusado enquanto houver fatura viva ou baixa em
algum B/L dela; o Administrativo resolve cada B/L antes. Ao cancelar, os
recebíveis sem fatura são anulados.

**15. Na troca de CNPJ**, a Invoice de Demurrage e a avulsa em aberto do B/L,
sem pagamento, são canceladas e reemitidas para o novo Cliente, com número
novo e o mesmo valor.

### Pix, restituição e Desbloqueio de CE

**16. Pix sem TXID do Vela** é gravado como "Pix recebido sem baixa" e abre
`pix_unreconciled` para o Financeiro, que dá a baixa manual na fatura certa ou
marca como "não é do Vela".

**17. Pix em análise.** Só fecha sozinho quando a baixa for daquele Pix (mesmo
endToEndId na referência bancária). Com Pix em análise ligado a Invoice de
Demurrage, a Régua de Cobrança pausa e não se cria QR novo; o valor continua no
saldo até a decisão do Financeiro.

**18. Pix em duplicidade em fatura de Taxas Locais já paga, coberta ou
cancelada** vira "recebimento sem fatura aberta", ligado à fatura de origem,
com restituição pendente; o Pix sai da análise quando a restituição é
registrada.

**19. "Cancelamento com devolução integral" de avulsa** suspende a cobrança na
autorização (o Pix é cancelado e a fatura não aceita baixa); a fatura só é
cancelada quando a devolução for confirmada. A confirmação pelo Financeiro
continua fechando o processo (ADR 0085, D2).

**20. Desbloqueio de CE** fica bloqueado enquanto houver "Fatura desatualizada"
ativa com valor maior no B/L, com o motivo "Diferença de valor a faturar", como
já acontece com o COD.

### Numeração e rateio

**21. O ano do número da fatura** segue o horário de Brasília.

**22. Container dividido com B/L isento** fica como está: a fração do isento
não é cobrada de ninguém.

## Consequências

- O vínculo do B/L à tabela troca a escolha da tabela a cada recálculo por uma
  referência gravada. Os B/Ls existentes recebem o vínculo pela tabela do último
  cálculo; sem cálculo, no próximo. Pelo "Data status" do AGENTS.md, os dados
  atuais são de teste.
- A edição de item passa a ter efeito em faturas de vários Clientes; por isso
  fica com o Administrativo e pede aviso na tela.
- A consolidada deixa de ter um só gatilho de reemissão (correção do B/L) e
  passa a reagir também a pagamento da individual; as projeções
  (`invoices.balance_brl`, status, QR) passam a ser recalculadas para todas as
  faturas ligadas ao recebível alterado, não só para a que recebeu o pagamento.
- O saldo do Vela ganha uma divisão que o Portal não tem; "Faturado em aberto"
  é o número que deve bater com o Portal.

## Alternativas consideradas

- **Recalcular tudo na emissão** (sem preço do dia do CE): rejeitada; o dono
  mantém o preço do dia do CE e corrige só a base.
- **Reemitir faturas a cada mudança de tabela, distinguindo erro de reajuste
  na tela**: rejeitada em favor de "editar é corrigir; reajustar é tabela
  nova", que não depende de o operador classificar a edição.
- **Recusar pagamento parcial de individual em consolidada aberta** e
  **suspender os QRs das individuais**: rejeitadas; o Cliente continua podendo
  pagar qualquer documento, e o sistema mantém os dois coerentes.
- **Saldo do Vela só com fatura emitida**: considerada e descartada no mesmo
  dia; o Vela continua mostrando o que falta faturar, agora separado.
- **Cobrar do pagante o container inteiro quando o irmão é isento**: rejeitada
  (decisão comercial).
