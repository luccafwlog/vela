Todo dinheiro que entra vira uma **baixa** na fatura: ela quita ou reduz o saldo. Com a cobrança pelo Itaú ligada, o Pix pago pelo QR do Vela dá baixa sozinho em cerca de um minuto. O {{Financeiro}} cuida do resto: o Pix que o Vela não pôde baixar com segurança, o pagamento que chega por outro caminho e o dinheiro que precisa voltar ao Cliente, a **restituição**. A fatura está no capítulo 22; o pagamento da Invoice de Demurrage, no capítulo 23.

::: aprende
- saber quando o Pix dá baixa sozinho e onde conferir;
- tratar um Pix em análise;
- baixar pelo extrato do Itaú quando a baixa automática para;
- registrar um pagamento à mão;
- cancelar uma baixa lançada por engano;
- devolver dinheiro ao Cliente e confirmar a devolução;
- concluir um ajuste de COD;
- imprimir o recibo.
:::

## 24.1 Acompanhar a baixa automática do Pix

**Quem faz:** o Vela, sozinho · acompanha: {{Financeiro}}

Com a cobrança pelo Itaú ligada, cada fatura em aberto, de Taxas Locais ou de Demurrage, tem um QR do Itaú, e o Vela dá sozinho a baixa do Pix pago por ele ([19.6](19-rotinas-por-horario.md#196-o-pix-do-itaú)). Na fatura de Taxas Locais o Pix precisa ter o valor exato; na Invoice de Demurrage, o de uma das duas últimas cotações ([23.1](23-demurrage-no-financeiro.md#231-ler-a-invoice-de-demurrage)). O que não é seguro baixar sozinho não é baixado: o Pix vai para **Pix em análise** ([24.2](#242-tratar-um-pix-em-análise)).

Tudo isso se acompanha em **Conciliação PIX**, no menu **Financeiro**. Qualquer equipe lê; só o {{Financeiro}} e o {{Administrativo}} tratam e baixam.

| Aba | Para que serve |
|---|---|
| **Histórico de baixas** | As faturas pagas, parcialmente pagas e cobertas, e as Invoices de Demurrage pagas, pela data da baixa. |
| **Pix recebidos** | Todo Pix que entrou na conta e a situação de cada um. |
| **Pendências** | Só o que pede decisão; o número na aba conta essas linhas. |
| **Conciliar extrato** | O plano B, pelo extrato do Itaú ([24.3](#243-baixar-pelo-extrato-quando-a-baixa-automática-para)). |

Se o bloco **Cobrança Pix Itaú**, no alto de **Pendências**, mostra **Consulta parada há N min**, os Pix pagos depois daquela hora não deram baixa: avise o suporte técnico e baixe pelo extrato ([24.3](#243-baixar-pelo-extrato-quando-a-baixa-automática-para)).

### Quando o Cliente diz que pagou e a fatura continua em aberto

Procure o Pix em **Pix recebidos**, pelo **Valor** e pelas datas em **Recebido de** e **Recebido até**:

- **Em análise**: o Pix não deu baixa sozinho. Trate em **Pendências** ([24.2](#242-tratar-um-pix-em-análise)).
- **Sem baixa**: o Pix não veio do QR do Vela (o Cliente digitou a chave, por exemplo) e não abre alerta. Dê a baixa pela linha dele ([24.4](#244-registrar-um-pagamento-à-mão)).
- Nenhum Pix: confira se a consulta parou. Se não parou, peça o comprovante ao Cliente.

## 24.2 Tratar um Pix em análise

**Quem faz:** {{Financeiro}} e {{Administrativo}}. As outras equipes leem.

O Pix em análise é um Pix pago pelo QR do Vela que não deu baixa sozinho. Ele abre o alerta **PIX sem conciliação segura** ([20.10](20-alertas.md#2010-pix-e-pagamento)), que leva a **Conciliação PIX** › **Pendências**, bloco **Pix em análise**. Para saber de qual fatura era o QR, procure o mesmo Pix em **Pix recebidos**: a coluna **Fatura** abre o detalhe.

| Caso | O que fazer |
|---|---|
| Valor diferente da cobrança ("Valor recebido difere…") | Confira o valor no extrato. Se o Pix paga a fatura, registre o pagamento nela com o **Identificador do Pix** em **Referência bancária** ([24.4](#244-registrar-um-pagamento-à-mão)). Quando a fatura fica **Paga**, o Pix sai da lista sozinho. |
| Pix em duplicidade ("Pix em duplicidade…" ou "Pix sem fatura aberta…") | A fatura já estava paga, coberta ou cancelada, ou não podia mais receber, e o Vela já registrou a restituição nela. Devolva o valor e confirme ([24.6](#246-devolver-dinheiro-ao-cliente)): o Pix sai da lista sozinho. |
| Baixa cancelada ("Baixa cancelada: …") | Alguém cancelou a baixa deste Pix ([24.5](#245-cancelar-uma-baixa)). Dê a baixa na fatura certa, com o **Identificador do Pix** na **Referência bancária**, ou devolva o dinheiro; se o Pix continuar na lista, marque-o como tratado. |
| Pix de uma Invoice de Demurrage | Se a Invoice está em aberto e o Pix paga o valor dela, registre o pagamento com a data do Pix ([23.7](23-demurrage-no-financeiro.md#237-registrar-o-pagamento-e-imprimir-o-recibo)); se o valor é outro, fale antes com o Cliente. Se ela já estava paga, devolva o Pix ao Cliente. Nos dois casos, depois, marque o Pix como tratado. |

Marcar como tratado é registrar o que foi feito fora de uma baixa com o identificador do Pix:

1. Resolva o caso primeiro: a baixa, a devolução ou a conversa com o Cliente.
2. Na linha do Pix, clique em **Marcar como tratado**, escreva o motivo e confirme.

O Pix sai da lista e o alerta fecha. A ação não baixa nem devolve nada.

::: atencao
- Baixa parcial, baixa em outra fatura ou fatura quitada por outro pagamento não tiram o Pix da lista: depois de resolver, marque como tratado.
:::

## 24.3 Baixar pelo extrato quando a baixa automática para

**Quem faz:** {{Financeiro}} e {{Administrativo}}

**Conciliar extrato** é o plano B, não a rotina. Use quando a consulta do Itaú para (o alerta **Consulta de Pix do Itaú parada**, [20.10](20-alertas.md#2010-pix-e-pagamento)) ou quando a cobrança pelo Itaú está desligada e as faturas usam o QR estático. O Vela lê o relatório "QR Codes recebidos" do Itaú e acha a fatura só pelo identificador de cada linha: o CNPJ e o valor não acham fatura, só conferem.

1. No Itaú, baixe o relatório "QR Codes recebidos", em .xlsx ou .xls.
2. Em **Conciliação PIX** › **Conciliar extrato**, escolha o arquivo. A leitura não baixa nada.
3. Confira a **Conferência do extrato**. **Prontas para baixa** são as linhas com uma fatura só e o valor certo.
4. Clique em **Confirmar N baixas**. O lote é tudo ou nada: se uma linha é recusada, nenhuma entra.

O mesmo Pix nunca é baixado duas vezes, mesmo que você leia o arquivo de novo.

### As exceções do extrato

Cada exceção fica em **Pendências** › **Exceções do extrato**, com o motivo, e abre o alerta **PIX sem conciliação segura**. Ela só se encerra pela própria linha:

- **Tentar de novo** procura a fatura outra vez e, achando uma segura, dá a baixa e encerra a exceção;
- a seta da linha mostra as faturas que aceitam aquele identificador, e **Baixar nesta fatura** dá a baixa na escolhida e encerra.

::: atencao
- Não baixe por outro caminho uma fatura que tem exceção do extrato. A exceção perde a fatura candidata e fica em **Pendências**, com o alerta aberto, sem botão que a feche.
:::

## 24.4 Registrar um pagamento à mão

**Quem faz:** {{Financeiro}} e {{Administrativo}}

Registre à mão o dinheiro que entrou sem o QR do Itaú (TED, DOC, boleto) e o Pix em análise. Confira antes no extrato. Este é o caminho das faturas de Taxas Locais, individual, consolidada e avulsa; a Invoice de Demurrage tem o dela ([23.7](23-demurrage-no-financeiro.md#237-registrar-o-pagamento-e-imprimir-o-recibo)).

1. Em **Taxas Locais**, aba **Faturas**, abra a fatura.
2. No bloco **Pagamentos**, clique em **Registrar pagamento**.
3. Preencha **Valor recebido (R$)**, **Recebido em**, **Método** e **Referência bancária**, que é o número do extrato ou do comprovante. Para um Pix, use o **Identificador do Pix**.
4. Clique em **Registrar pagamento** e, conferidos o valor e o saldo, em **Confirmar pagamento recebido**.

O pagamento pode ser parcial: a fatura fica **Parcialmente paga** e o QR passa a cobrar o saldo. O que passa do saldo vira restituição **A devolver** ([24.6](#246-devolver-dinheiro-ao-cliente)), e a confirmação avisa antes.

### Pix que não veio do QR do Vela

Em **Pix recebidos**, abra a linha do Pix **Sem baixa**; vale para fatura de Taxas Locais e para Invoice de Demurrage. Em **Baixar numa fatura (opcional)**, o Vela sugere as faturas abertas com o mesmo valor; **Procurar** acha a fatura pelo número. **Baixar nesta fatura** grava a baixa com o valor, o horário e o identificador do Pix. A **Mensagem do pagador**, quando o Cliente escreve uma, ajuda a achar a fatura.

::: atencao
- O Vela aceita data futura em **Recebido em** e não barra a mesma **Referência bancária** em duas baixas: confira os dois. A referência só se repete quando um mesmo Pix ou TED pagou mais de uma fatura.
:::

## 24.5 Cancelar uma baixa

**Quem faz:** {{Administrativo}}

Cancelar a baixa desfaz um pagamento lançado por engano: o recebimento que não existiu, ou que foi posto na fatura errada. Ele não devolve dinheiro ao Cliente. Se o dinheiro entrou de verdade e precisa voltar, é restituição ([24.6](#246-devolver-dinheiro-ao-cliente)).

1. No detalhe da fatura, em **Taxas Locais**, clique no ícone **Cancelar baixa** da linha do pagamento. Aberto pelo **Histórico de baixas** da **Conciliação PIX**, o detalhe já vem com o formulário e a baixa mais recente marcada.
2. Confira a **Baixa a cancelar** e escreva a **Justificativa**.
3. Clique em **Cancelar baixa** e confirme.

O saldo volta, a fatura volta a **Emitida** ou **Parcialmente paga** e o QR passa a cobrar o saldo. O excedente dessa baixa ainda não devolvido é cancelado junto. Se a baixa era de um Pix do Itaú, o Pix volta para **Pix em análise**, com o alerta, para ser baixado na fatura certa ([24.2](#242-tratar-um-pix-em-análise)). A baixa da Invoice de Demurrage se cancela no detalhe dela ([23.8](23-demurrage-no-financeiro.md#238-cancelar-a-baixa-de-uma-invoice)).

::: atencao
- O Vela recusa cancelar a baixa cujo excedente já foi devolvido, ou a que sustenta uma restituição da correção do B/L, do COD ou autorizada: sem ela, a restituição ficaria sem o dinheiro que a justifica.
:::

## 24.6 Devolver dinheiro ao Cliente

**Quem faz:** {{Financeiro}} e {{Administrativo}}

A **restituição** é dinheiro recebido que volta ao Cliente. O Vela a registra como **A devolver** e abre o alerta **Restituição pendente** ([20.10](20-alertas.md#2010-pix-e-pagamento)). A transferência é feita fora do Vela e confirmada aqui depois.

| O que aconteceu | De onde vem a restituição |
|---|---|
| O Cliente pagou a mais | Sozinha, do excedente da baixa ([24.4](#244-registrar-um-pagamento-à-mão)). |
| O Cliente pagou de novo uma fatura de Taxas Locais já paga, coberta ou cancelada | Sozinha, do Pix em duplicidade ([24.2](#242-tratar-um-pix-em-análise)); na Invoice de Demurrage e na avulsa cancelada não há restituição: o Pix fica em análise. |
| Uma correção do B/L ou de uma taxa reduziu uma fatura paga além do saldo | Sozinha, no bloco **Ajustes pela correção do B/L** ([18.6](18-o-que-muda-sozinho.md#186-corrigir-um-bl)). |
| O B/L trocou de Cliente depois do pagamento | Sozinha; a fatura do novo Cliente só sai depois da devolução ao Cliente original ([7.4](07-ficha-do-bl.md#74-vincular-ou-trocar-o-cliente-do-bl)). |
| A cobrança de um B/L pago deve sair, para cancelar o B/L ou a Viagem | Do **Preparar cancelamento financeiro**, que o {{Administrativo}} faz no detalhe da fatura (capítulo 22). |
| Um COD baixou o valor de um B/L pago | Do ajuste de COD ([24.8](#248-concluir-um-ajuste-de-cod)). |
| Uma avulsa ou uma Invoice de Demurrage paga deve devolver dinheiro, inclusive antes de trocar o Cliente do B/L | Da restituição excepcional ([24.7](#247-autorizar-uma-restituição-excepcional)). |

### Confirmar a devolução

1. Transfira o valor ao Cliente original e guarde o comprovante.
2. No detalhe da fatura, em **Taxas Locais**, bloco **Restituições ao Cliente**, clique no ícone **Confirmar devolução** da linha **A devolver**. Na Invoice de Demurrage, o botão é **Registrar devolução**, no bloco **Restituição excepcional**.
3. Preencha o comprovante, o favorecido e a data, clique em **Confirmar devolução realizada** e confirme.

A linha passa a **Devolvida**, com a data, e o valor entra no recibo como devolvido ao Cliente. O alerta fecha quando não sobra nada a devolver. Na troca de Cliente, a confirmação libera a fatura do novo Cliente; no Pix em duplicidade, tira o Pix da análise.

::: atencao
- O botão não transfere dinheiro: ele registra uma transferência já feita. Confirme só depois dela.
- A devolução confirmada não se altera nem se apaga. Devolução para a conta errada se resolve com o {{Administrativo}}, guardando os dois comprovantes.
:::

## 24.7 Autorizar uma restituição excepcional

**Quem faz:** autorizar, {{Qualquer equipe}} · devolver e confirmar, {{Financeiro}} e {{Administrativo}}

A avulsa e a Invoice de Demurrage não se corrigem sozinhas depois do pagamento. Quando parte do que foi pago deve voltar, ou tudo, alguém autoriza a devolução no bloco **Restituição excepcional** do detalhe (em **Taxas Locais** ou em **Demurrage**), que mostra o recebido, o devolvido e o disponível.

1. Em **Valor da restituição BRL**, digite o valor, até o disponível.
2. Em **Finalidade da restituição**, escolha **Devolução por ajuste**, para uma parte, ou **Cancelamento com devolução integral**, para tudo o que está disponível.
3. Escreva a **Justificativa da restituição**, com pelo menos 10 caracteres.
4. Clique em **Autorizar restituição** e confirme.

A restituição nasce **A devolver** e segue a confirmação de [24.6](#246-devolver-dinheiro-ao-cliente). No **Cancelamento com devolução integral**, a avulsa ou a Invoice é cancelada quando a devolução de tudo é confirmada; a avulsa perde o QR já na autorização e deixa de aceitar pagamento.

Se a autorização foi um engano e o dinheiro ainda não voltou, **Cancelar autorização**, na linha **A devolver**, desfaz a reserva, com motivo de pelo menos 10 caracteres.

::: atencao
- Depois do cancelamento com devolução integral de uma Invoice de Demurrage, os containers dela voltam a **A faturar** na aba **Containers**. Só gere outra Invoice se a cobrança deve continuar, como na troca de Cliente.
:::

## 24.8 Concluir um ajuste de COD

**Quem faz:** {{Financeiro}} e {{Administrativo}}. As outras equipes leem.

O COD muda o destino de um B/L ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)). Quando o B/L já foi faturado, ou ainda não foi mas tem taxa lançada à mão, a diferença de Taxa Local vira um **ajuste de COD**, que aparece no quadro **Ajustes de COD**, no alto de **Taxas Locais**, com o valor anterior, o do destino e a diferença. A coluna **Ação** diz o que fazer:

| Ação | Quando | O que fazer |
|---|---|---|
| **Reemissão automática** | Fatura sem pagamento | Nada: a fatura é reemitida e o ajuste se conclui com ela. |
| **Abater saldo aberto** | Valor menor, que cabe no saldo | Clique em **Aplicar abatimento** e confirme em **Liquidar ajuste**. |
| **Restituição por excedente** | Valor menor, que passa do saldo | Clique em **Registrar restituição** e confirme. A restituição nasce **A devolver** ([24.6](#246-devolver-dinheiro-ao-cliente)). |
| **Fatura complementar** | Valor maior, com pagamento | Emita a fatura avulsa da diferença (capítulo 22), digite o **Nº interno** dela e clique em **Vincular e concluir**. |
| **Revisão manual de cobrança** | B/L ainda sem fatura, com taxa lançada à mão | Confira a cobrança, emita a fatura (avulsa, se for complemento) e vincule-a como na linha acima. |

O **Nº interno** não é o número INV-…: é o número que aparece no endereço da página, depois de "invoice=", quando a fatura está aberta em **Taxas Locais**.

## 24.9 Imprimir o recibo

**Quem faz:** {{Todas as equipes}}

O recibo não vai por e-mail: no Portal, o Cliente imprime o recibo da fatura **Paga** ([15.5](15-portal-o-que-o-cliente-ve.md#155-as-faturas-e-o-pix)). Quando ele pede o recibo a você, imprima pelo Vela.

1. Em **Taxas Locais**, abra a fatura **Paga**, **Coberta** ou **Cancelada** que recebeu dinheiro.
2. Clique em **Imprimir recibo** e depois em **Imprimir**.

O recibo mostra o **Total da fatura emitida**, o **Valor recebido**, o **Abatido do saldo**, o **Devolvido ao Cliente**, a **Restituição pendente** e, em destaque, o **Valor líquido recebido**: o recebido menos o devolvido. O recibo da Invoice de Demurrage sai em **Ver recibo**, no detalhe dela ([23.7](23-demurrage-no-financeiro.md#237-registrar-o-pagamento-e-imprimir-o-recibo)).

::: atencao
- Fatura parcialmente paga não tem recibo.
- O recibo sai sempre com os valores de agora. Se uma baixa foi cancelada depois, o recibo já entregue ficou desatualizado: mande o novo.
:::
