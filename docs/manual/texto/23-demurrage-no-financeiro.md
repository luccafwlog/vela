A Invoice de Demurrage é cobrada em dólar e paga em reais. O dólar fica travado no dia da emissão; os reais acompanham o câmbio de cada dia útil até o pagamento, e o Pix acompanha os reais. Este capítulo é o lado do dinheiro da Invoice: o câmbio, o desconto, a Régua de Cobrança, o pagamento e o cancelamento. Quando a Invoice sai, o que a segura e como se responde à Disputa do Cliente estão no capítulo 9 ([9.4](09-containers-e-demurrage.md#94-ler-a-situação-de-demurrage) a [9.9](09-containers-e-demurrage.md#99-decidir-a-disputa)).

::: aprende
- ler a Invoice: o dólar, os reais, a PTAX e o ROE;
- achar as Invoices em aberto, pagas e canceladas, e o total de cada Cliente;
- informar a PTAX quando a do dia não chega e usar um câmbio combinado;
- dar um desconto;
- acompanhar a Régua de Cobrança e saber por que ela pausou;
- registrar o pagamento, cancelar a baixa e imprimir o recibo;
- cancelar uma Invoice e gerar outra.
:::

## 23.1 Ler a Invoice de Demurrage

**Quem faz:** {{Todas as equipes}}

Na página **Demurrage**, o número da Invoice abre o detalhe. No alto fica o dólar a cobrar, já sem o desconto; ao lado, os reais e o câmbio.

**BRL hoje** é o dólar a cobrar vezes o **ROE**, o câmbio da Invoice: a PTAX de venda, a cotação oficial do dólar, vezes 1,065, o acréscimo fixo do armador. Todo dia útil, às 14h, os reais e o Pix das Invoices em aberto seguem a PTAX nova ([19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio)); o pagamento os congela, e o detalhe passa a mostrar **BRL pago** e **ROE (congelado no pagamento)**. A faixa do alto mostra a PTAX mais recente do BCB; as Invoices só passam a ela no recálculo das 14h, e o câmbio que vale é o do detalhe.

Ao lado do ROE vem a origem: PTAX do BCB, PTAX informada ([23.3](#233-informar-a-ptax)) ou ROE manual ([23.4](#234-usar-um-câmbio-combinado-roe-manual)).

Um exemplo: a Invoice do CSC45810A01K00 cobra US$ 450,00. Com a PTAX de 5,40, o ROE é 5,7510 e o **BRL hoje**, R$ 2.587,95. No dia útil seguinte, com a PTAX de 5,46, o ROE passa a 5,8149 e o valor, a R$ 2.616,71.

Abaixo ficam a **Situação**, os containers cobrados e as ações da sua equipe. **Ver fatura** abre o documento, com o Pix enquanto a Invoice está em aberto.

::: atencao
- O Pix com o valor da cotação anterior também quita: a Invoice aceita o valor de qualquer uma das duas últimas cotações. Um valor mais antigo não dá baixa sozinho ([24.2](24-pagamento-e-restituicao.md#242-tratar-um-pix-em-análise)).
- Se o Cliente pede o valor para pagar daqui a alguns dias, avise que os reais mudam com a PTAX até o pagamento; o que não muda é o dólar.
:::

## 23.2 Achar as Invoices em aberto, pagas e canceladas

**Quem faz:** {{Todas as equipes}}

A página **Demurrage**, no menu **Financeiro**, separa as Invoices pela situação:

| Aba | Mostra |
|---|---|
| **Faturas** | As Invoices emitidas e não pagas, com o **BRL hoje** e a coluna **Régua de cobrança** ([23.6](#236-acompanhar-a-régua-de-cobrança)). O cartão **Aguardando pagamento (BRL hoje)** soma o que está aqui. |
| **Pagas** | As pagas, com a data do **Pagamento** e o **BRL pago**. |
| **Canceladas** | As canceladas, em cinza, com os reais do dia do cancelamento. |
| **Por Cliente** | O que cada Cliente tem em aberto, do maior valor em dólar para o menor. O clique no Cliente mostra as Invoices dele. |

O dólar de cada linha já vem sem o desconto; passe o mouse sobre ele para ver o desconto.

Em **Por Cliente**, **Imprimir relatório** gera o relatório de Demurrage em aberto por Cliente. As Invoices de um Cliente também aparecem na ficha dele, aba **Financeiro** ([13.7](13-cadastro-do-cliente.md#137-as-faturas-e-as-condições-negociadas)).

## 23.3 Informar a PTAX

**Quem faz:** {{Financeiro}}, {{Equipamentos}} e {{Administrativo}}

Quando a PTAX do dia não chega, o último câmbio continua valendo e as Invoices em aberto ficam com os reais da véspera. Depois das 14h, a página **Demurrage** avisa "PTAX de hoje não obtida do BCB"; se a atualização automática falhou, abre também um alerta ([20.9](20-alertas.md#209-demurrage)).

1. Consulte a PTAX de venda do dia no site do BCB.
2. Em **Demurrage**, clique em **Informar PTAX**, no alto da página ou no aviso.
3. Digite a cotação em **PTAX (cotação de venda)**, com vírgula, por exemplo 5,4321.
4. Clique em **Recalcular Invoices**.

Todas as Invoices emitidas e não pagas passam a esse câmbio, menos as de ROE manual, e a mensagem diz quantas foram recalculadas. A PTAX informada vale também para as Invoices que saírem depois, até a próxima PTAX automática. Se você digitou errado, informe de novo a cotação certa: as Invoices são recalculadas outra vez.

::: atencao
- Digite a PTAX, não o ROE: o Vela aplica o 1,065 sozinho.
- Corrigir a PTAX no mesmo dia tira da baixa automática o valor da véspera: um Pix com ele vai para análise.
- Em feriado não há PTAX nova, e o aviso aparece mesmo assim. Vale a última cotação divulgada: não há o que informar.
:::

## 23.4 Usar um câmbio combinado (ROE manual)

**Quem faz:** {{Financeiro}}, {{Equipamentos}} e {{Administrativo}}

O ROE manual é um câmbio fixo, combinado para um B/L, no lugar da PTAX do dia. Ele é posto no B/L e vale para a próxima Invoice que o B/L emitir. A Invoice emitida com ele não muda com a PTAX até o pagamento.

1. Na ficha do B/L, aba **Faturamento**, bloco **Condições de Demurrage deste B/L**, clique em **Definir ROE manual…**.
2. Digite o **ROE manual (R$ por US$)** e o **Motivo do ROE manual**, com pelo menos 10 caracteres.
3. Clique em **Definir ROE manual** e confirme.

No mesmo bloco, **Trocar ROE manual…** e **Tirar ROE manual…** mudam o câmbio das próximas Invoices. A Invoice já emitida segue com o câmbio dela.

Para devolver ao câmbio do dia uma Invoice já emitida com ROE manual, use **Tirar ROE manual…** no detalhe dela, com motivo.

::: atencao
- Quando B/Ls do mesmo Cliente na mesma Viagem dividem containers, a Invoice sai pelo B/L de menor número ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)) e só o ROE manual dele vale. Na ficha dos outros B/Ls do grupo, **Definir** e **Trocar ROE manual…** não aparecem: o bloco diz qual B/L emite a Invoice, com o link para ele. Ponha o câmbio lá.
- Para uma Invoice já emitida, o ROE manual do B/L só entra se ela for cancelada e gerada de novo ([23.9](#239-cancelar-uma-invoice-e-gerar-outra)).
:::

## 23.5 Dar um desconto

**Quem faz:** {{Qualquer equipe}}

O desconto sai do dólar, antes da conversão: a Invoice continua mostrando o total dos containers, e o que se cobra é o total menos o desconto. Ele se dá na Invoice emitida e ainda não paga.

1. No detalhe da Invoice, clique em **Aplicar desconto**, ou em **Alterar desconto** se ela já tem um.
2. Escolha **Percentual (%)** ou **Valor fixo (USD)**, digite o desconto e escreva a **Justificativa**, sempre obrigatória; **Tipo de desconto** e **Aprovador** são opcionais.
3. Clique em **Salvar desconto**.

Os reais e o Pix mudam na hora, e o Cliente vê o valor novo no Portal. No exemplo de [23.1](#231-ler-a-invoice-de-demurrage), 10% de desconto levam a Invoice a US$ 405,00 e, com o ROE de 5,7510, a R$ 2.329,16. Para tirar o desconto, apague o valor em **Alterar desconto**.

O desconto que zera a Invoice a quita na hora: ela vira **Pago** sem pagamento, sai da Régua e das pendências do Cliente. Para desfazer, o {{Administrativo}} cancela a baixa ([23.8](#238-cancelar-a-baixa-de-uma-invoice)) e alguém altera o desconto.

### Desconto, acordo, condição ou câmbio

O desconto é a única negociação que mexe numa Invoice já emitida. As outras valem para as Invoices que ainda vão sair:

| Negociação | Vale para | Onde |
|---|---|---|
| Acordo do Cliente | Os containers do Cliente descarregados na vigência do acordo | [9.7](09-containers-e-demurrage.md#97-cadastrar-tarifas-e-acordos-de-demurrage) |
| Condição do B/L | Os containers de um B/L só | [9.7](09-containers-e-demurrage.md#97-cadastrar-tarifas-e-acordos-de-demurrage) |
| ROE manual | O câmbio da próxima Invoice de um B/L | [23.4](#234-usar-um-câmbio-combinado-roe-manual) |
| Desconto | Uma Invoice emitida e não paga | Aqui |

::: atencao
- Depois de mudar o desconto, só o valor novo quita a Invoice. Um Pix com o valor de antes não dá baixa sozinho e fica em análise para o {{Financeiro}} ([24.2](24-pagamento-e-restituicao.md#242-tratar-um-pix-em-análise)).
:::

## 23.6 Acompanhar a Régua de Cobrança

**Quem faz:** {{Todas as equipes}} · mudar o intervalo: {{Administrativo}}

A Régua de Cobrança é o e-mail que o Vela manda sozinho ao Cliente enquanto a Invoice está emitida e não paga, às caixas **Financeiro** e **Demurrage** ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)), com o dólar, os reais do dia e o link do Portal. Os horários estão em [19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio).

Na aba **Faturas**, a coluna **Régua de cobrança** diz onde cada Invoice está: "2ª cobrança, próxima em 12/11/2026" (passe o mouse para ver o último envio) ou "Pausada: …" com o motivo. Resolvida a causa da pausa, a Régua volta de onde parou.

| A coluna diz "Pausada: …" | O que fazer |
|---|---|
| disputa aberta | Responder e decidir a Disputa ([9.8](09-containers-e-demurrage.md#98-responder-a-uma-disputa) e [9.9](09-containers-e-demurrage.md#99-decidir-a-disputa)). |
| Pix em análise | O {{Financeiro}} ou o {{Administrativo}} decide o Pix na **Conciliação PIX** ([24.2](24-pagamento-e-restituicao.md#242-tratar-um-pix-em-análise)). |
| cliente sem contatos válidos, ou Cliente sem contato autorizado para a cobrança | Ligar um contato com e-mail à caixa **Financeiro** ou **Demurrage** ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). |
| e-mail recusado pelo provedor… | Corrigir o contato ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe)) e resolver o alerta **Cobrança de Demurrage recusada** ([20.9](20-alertas.md#209-demurrage)). |
| datas alteradas, aguarda tratamento | Tratar a Invoice cujas datas mudaram ([23.9](#239-cancelar-uma-invoice-e-gerar-outra)). |

O intervalo padrão é de 7 dias. Para mudar:

1. Em **Demurrage**, clique em **Régua de cobrança**.
2. Em **Intervalo entre cobranças, em dias**, digite de 1 a 365.
3. Clique em **Salvar intervalo** e confirme.

O intervalo novo vale para todas as Invoices em aberto.

::: atencao
- A data de "próxima em" não pula fim de semana nem feriado: a cobrança sai na primeira rodada de dia útil a partir dela.
:::

## 23.7 Registrar o pagamento e imprimir o recibo

**Quem faz:** registrar, {{Financeiro}} e {{Administrativo}} · imprimir, {{Todas as equipes}}

Com a cobrança pelo Itaú ligada, o Pix da Invoice dá baixa sozinho: ela fica **Pago** na data do Pix e sai da Régua ([24.1](24-pagamento-e-restituicao.md#241-acompanhar-a-baixa-automática-do-pix)). Registre à mão só o pagamento que chegou por outro caminho, depois de conferir o extrato; o Pix feito sem o QR do Vela se baixa pela linha dele em **Pix recebidos** ([24.4](24-pagamento-e-restituicao.md#244-registrar-um-pagamento-à-mão)), que confere o valor e guarda o Pix.

1. No detalhe da Invoice, clique em **Registrar pagamento**.
2. Em **Data do pagamento**, informe o dia em que o dinheiro entrou, entre a emissão e hoje.
3. Clique em **Registrar pagamento**.

A baixa não tem campo de valor: o Vela grava os reais e o ROE da cotação que valia na data informada. Com uma data passada, o valor pode ser diferente do **BRL hoje**. A Invoice vai para **Pagas**, sai da Régua e aparece paga no Portal.

**Ver recibo**, no detalhe da Invoice paga, abre o recibo ([24.9](24-pagamento-e-restituicao.md#249-imprimir-o-recibo)).

::: atencao
- Não registre por aqui um pagamento parcial ou de outro valor: a Invoice ficaria paga pelo valor cheio da cotação. Confira antes o extrato e fale com o Cliente.
- Se o pagamento era um Pix em análise, a baixa por esta tela não o tira da lista: depois dela, marque o Pix como tratado na **Conciliação PIX** ([24.2](24-pagamento-e-restituicao.md#242-tratar-um-pix-em-análise)).
:::

## 23.8 Cancelar a baixa de uma Invoice

**Quem faz:** {{Administrativo}}

Cancelar a baixa desfaz um pagamento lançado por engano e não devolve dinheiro ([24.5](24-pagamento-e-restituicao.md#245-cancelar-uma-baixa)); para devolver, use a restituição excepcional ([24.7](24-pagamento-e-restituicao.md#247-autorizar-uma-restituição-excepcional)).

1. No detalhe da Invoice paga, clique em **Cancelar baixa…**.
2. Escreva a **Justificativa para cancelar a baixa**.
3. Clique em **Cancelar baixa**.

A Invoice volta a **Faturado**, sem data de pagamento, e volta ao recálculo diário e à Régua. Até o recálculo das 14h, ela fica com os reais da baixa; para ter o valor do dia antes disso, use **Informar PTAX**. Se a baixa veio de um Pix do Itaú, o Pix volta para **Pix em análise**, com alerta, para o {{Financeiro}} decidir onde ele entra.

::: atencao
- Invoice com restituição, a devolver ou já devolvida, não aceita cancelar a baixa: o Vela recusa com "Recebimento financia restituição". Se a restituição foi autorizada por engano e o dinheiro ainda não voltou, cancele antes a autorização ([24.7](24-pagamento-e-restituicao.md#247-autorizar-uma-restituição-excepcional)).
:::

## 23.9 Cancelar uma Invoice e gerar outra

**Quem faz:** cancelar, {{Administrativo}} · gerar de novo, {{Qualquer equipe}}

A Invoice emitida não se edita. Quando ela cobra errado e o Vela não corrige sozinho, cancela-se e gera-se outra. Mudar as datas de um container numa Invoice sem pagamento, sem desconto e sem Disputa aberta já cancela e reemite sozinho ([18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container)); a nova diz "Substitui a Invoice …".

1. No detalhe, clique em **Cancelar Invoice…**, escreva o motivo e confirme. Invoice paga precisa antes ter a baixa cancelada ([23.8](#238-cancelar-a-baixa-de-uma-invoice)); com Disputa aberta, encerre a pendência antes, porque o cancelamento não a encerra e o Cliente não escreve mais nela.
2. Em **Demurrage**, aba **Containers**, o B/L volta a **A faturar**. Clique em **Gerar Invoice** no fim da linha ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)).
3. Se havia desconto, aplique-o de novo na Invoice nova ([23.5](#235-dar-um-desconto)).

A cancelada sai da Régua e do Portal; a nova sai com número novo e o câmbio do dia.

### Quando as datas mudam depois da Invoice

Se as datas mudam numa Invoice paga, com desconto ou com Disputa aberta, ela não é reemitida: sai da Régua e abre **Datas mudaram em Invoice de Demurrage emitida** ([20.9](20-alertas.md#209-demurrage)). Com desconto ou Disputa, encerre a Disputa ([9.9](09-containers-e-demurrage.md#99-decidir-a-disputa)), cancele, gere de novo e refaça o desconto. Paga, ela fica como está: devolva a diferença pela restituição excepcional ([24.7](24-pagamento-e-restituicao.md#247-autorizar-uma-restituição-excepcional)) ou cobre-a por fatura avulsa (capítulo 22).
