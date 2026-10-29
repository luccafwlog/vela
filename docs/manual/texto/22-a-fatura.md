A fatura de Taxas Locais é o documento que cobra do Cliente as taxas de um B/L. Ela sai sozinha quando o CE Mercante é gravado e nada mais a segura, chega ao Portal com o Pix e, depois de emitida, não é mais editada: quando o B/L muda, o Vela corrige a cobrança por reemissão, abatimento ou restituição. Neste capítulo você vê o que segura a fatura e como ela sai, emite a fatura avulsa e a consolidada, imprime, acompanha a correção da fatura emitida e, se é do Administrativo, cancela uma fatura.

::: aprende
- o que segura a fatura e como ela sai, sozinha ou pelo **Emitir**;
- encontrar e ler uma fatura;
- emitir a fatura avulsa e a consolidada;
- imprimir a fatura;
- o que acontece quando o B/L muda depois da fatura e como resolver uma Fatura desatualizada;
- cancelar uma fatura e o que acontece depois.
:::

## 22.1 O que segura a fatura

**Quem acompanha:** {{Todas as equipes}}

A fatura de um B/L só sai quando tudo abaixo está em ordem. Cada requisito tem o seu lugar de resolver, e o primeiro que falta aparece como **Motivo** na **Validação** ([21.3](21-taxas-locais.md#213-ler-a-validação)):

| Precisa | Onde se resolve |
|---|---|
| Cliente vinculado e conferido | Revisão ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)) |
| Revisão sem pendência, como o peso da carga solta | Revisão (capítulo 8) |
| Cálculo fechado: tabela de cobrança ativa para o POD e o tipo de carga, nenhuma taxa em revisão e algum valor a cobrar | [21.4](21-taxas-locais.md#214-resolver-uma-taxa-em-revisão) |
| CE Mercante gravado | Planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)) |
| Portal do Cliente pronto, ou Liberação de faturamento sem Portal | [14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar) e [13.8](13-cadastro-do-cliente.md#138-liberar-o-faturamento-sem-portal) |

Seguram também, sem motivo próprio na Validação:

- o terminal de descarga do B/L sem frente de operação de importação no POD ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais) e [7.7](07-ficha-do-bl.md#77-mudar-o-terminal-de-descarga-de-um-bl));
- a falta de câmbio para uma taxa em dólar ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação));
- outro B/L com o mesmo container, já faturado com o rateio antigo e sem pagamento: a fatura dele precisa sair de novo antes ([22.7](#227-quando-o-bl-muda-depois-da-fatura));
- a troca de Cliente que espera a devolução do dinheiro ao Cliente anterior (capítulo 24);
- a última fatura do B/L cancelada por uma pessoa: daí em diante, nada fatura o B/L sozinho, nem o CE, nem o Portal, nem a Liberação, e a nova fatura sai só pelo **Emitir** ([22.2](#222-como-a-fatura-sai)).

Nada disso impede o cálculo, só a fatura. A fatura avulsa não passa por nenhum desses requisitos ([22.4](#224-emitir-uma-fatura-avulsa)).

No exemplo, a fatura do CSC45810B01K00 espera o Portal da MAQUINAS HORIZONTE LTDA, e a do CSC45810A03K00 espera o Cliente.

::: atencao
O motivo da Validação é uma leitura da tela. Quem decide é o Vela, na hora de emitir: ele confere tudo de novo e, se algo barra, diz o quê.
:::

## 22.2 Como a fatura sai

**Quem faz:** o Vela, sozinho; emitir à mão, {{Qualquer equipe}}.

Na rotina, ninguém emite fatura de Taxas Locais: o Vela emite quando o último requisito se cumpre.

- **Ao gravar o CE.** A própria janela da planilha de CE emite as faturas logo depois de gravar ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)).
- **Quando o B/L com CE sai da Revisão ou ganha o Cliente** ([8.6](08-revisao.md#86-o-que-acontece-quando-o-bl-sai-da-revisão)).
- **Quando o Portal do Cliente fica pronto ou o {{Administrativo}} concede a Liberação:** as faturas retidas saem na hora ([14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)).

Em todos os casos, a fatura sai com o preço fixado na importação e a base de hoje ([21.1](21-taxas-locais.md#211-como-o-vela-calcula-as-taxas-locais)).

A emissão à mão cobre o que o automático não fez: a falha técnica (alerta **Falha de emissão automática**, [20.8](20-alertas.md#208-faturamento-e-taxas-locais)), a reemissão que travou e a fatura cancelada por uma pessoa.

::: passos
1. Na **Validação**, no B/L em **Pronto para emitir**, clique em **Emitir**. Ou, na ficha do B/L, aba **Faturamento**, clique em **Emitir fatura**.
2. Confira na confirmação o Cliente, o total e as linhas. Se o B/L tem taxa alterada à mão, a confirmação avisa que a fatura sai com o valor alterado.
3. Clique em **Emitir fatura**. A fatura sai na hora e o B/L passa a faturado.
:::

A fatura traz um item por taxa com valor ("BL … - nome da taxa"); a taxa de container dividido mostra a fração. O número é INV-ano-sequência, como INV-2026-0042, numa sequência só para individuais, consolidadas e avulsas. Na emissão, o Vela guarda uma cópia da razão social, do CNPJ e do endereço do Cliente, do navio e da rota: corrigir o cadastro depois não muda a fatura emitida. A taxa em dólar sai em reais, pelo câmbio fixado na importação.

O que a emissão muda para o Cliente (aviso no Portal, Pix, Comunicado de CE e Taxas) está em [18.9](18-o-que-muda-sozinho.md#189-emitir-ou-cancelar-uma-fatura). O pagamento está no capítulo 24.

::: atencao
- A fatura de Taxas Locais não tem vencimento: fica em aberto enquanto tem saldo.
- O B/L tem no máximo uma fatura individual viva, e o Vela recusa emitir outra por cima. Para mudar a cobrança, corrija o B/L ([22.7](#227-quando-o-bl-muda-depois-da-fatura)).
:::

## 22.3 Encontrar e ler uma fatura

**Quem faz:** {{Todas as equipes}}

A aba **Faturas**, em **Financeiro** › **Taxas Locais**, lista as faturas da mais nova para a mais antiga: individuais, consolidadas (com o ícone de pilha) e avulsas. **Buscar fatura ou B/L** acha a fatura pelo número dela ou de qualquer B/L dela. A faixa do bloco diz quantas faturas há no recorte e quanto está em aberto, e **Exportar** baixa a planilha do recorte.

| Situação | Quer dizer |
|---|---|
| **Emitida** | Em aberto, sem pagamento. |
| **Parcialmente paga** | Recebeu uma parte; o saldo segue em aberto. |
| **Paga** | Quitada. |
| **Coberta** | Fatura individual cujo B/L foi pago por uma consolidada. |
| **Cancelada** | Não é mais cobrada. Inclui a consolidada substituída por outra. |

O número abre o detalhe da fatura:

1. O bloco **Saldo** diz o que falta receber, em âmbar, ou **Paga**, **Coberta** ou **Cancelada**. Logo abaixo, o Cliente, o CNPJ, o navio e, com um B/L só, o **B/L** e o **Trecho**.
2. Na fatura corrigida, uma linha diz qual fatura ela substitui ou por qual foi substituída ([22.7](#227-quando-o-bl-muda-depois-da-fatura)).
3. **Itens da fatura** traz as taxas com os valores congelados na emissão; a taxa em dólar mostra o valor em US$ e o câmbio.
4. **Pagamentos** lista o que foi recebido. Registrar pagamento à mão está no capítulo 24.

No alto de **Taxas Locais**, acima das abas, ficam os alertas financeiros em aberto, com o atalho de onde se resolvem, e os quadros **Reemissão pendente** ([22.7](#227-quando-o-bl-muda-depois-da-fatura)) e **Ajustes de COD** (capítulo 24).

::: atencao
A consolidada aberta e as individuais dos mesmos B/Ls cobram a mesma dívida. Não some as duas ([22.5](#225-juntar-bls-numa-fatura-consolidada)).
:::

## 22.4 Emitir uma fatura avulsa

**Quem faz:** {{Qualquer equipe}}

A fatura avulsa cobra o que não está nas Taxas Locais do B/L: um serviço adicional ou a diferença a maior de uma fatura já paga ([22.8](#228-resolver-uma-fatura-desatualizada)). Ela sai na hora, não depende de CE nem de Portal, não muda as Taxas Locais do B/L e aparece no Portal com Pix. Não a use para contornar o que segura uma fatura de Taxas Locais.

1. Em **Taxas Locais**, clique em **Gerar fatura avulsa** e escolha o **Cliente**.
2. Em **Tipo de cobrança**, escolha o item da tabela de cobrança do B/L ou **Outra**. O item exige o B/L, e a quantidade e o valor vêm da tabela de cobrança, com a Condição de Cliente. Em **Outra**, você preenche **Nome do item**, **Quantidade** e **Valor unitário (R$)**; o B/L e a Viagem são opcionais.
3. Escreva a **Descrição da cobrança**, que o Cliente vê na fatura e no Portal, e o **Motivo (interno)**, que ele não vê.
4. Confira o **Total a emitir**, clique em **Emitir fatura avulsa** e confirme.

Só os itens **Só manual** da tabela de cobrança do B/L aparecem. O item em dólar é convertido pelo câmbio do dia da emissão.

::: atencao
- A avulsa sem pagamento só o {{Administrativo}} cancela ([22.9](#229-cancelar-uma-fatura)). Confira antes de emitir.
- O Cliente desativado não recebe avulsa: reative-o antes ([13.10](13-cadastro-do-cliente.md#1310-desativar-ou-reativar-um-cliente)).
:::

## 22.5 Juntar B/Ls numa fatura consolidada

**Quem faz:** {{Qualquer equipe}}. O Cliente também, pelo Portal ([15.5](15-portal-o-que-o-cliente-ve.md#155-as-faturas-e-o-pix)).

A consolidada junta o saldo em aberto de vários B/Ls do mesmo Cliente numa fatura só, para ele pagar com um Pix. Ela não substitui as individuais: as duas convivem, cobrando a mesma dívida, e enquanto a consolidada está aberta nenhuma individual nova sai por cima.

1. Em **Taxas Locais**, clique em **Gerar fatura consolidada**.
2. Escolha o **Cliente**. Se quiser, filtre por **Viagem** ou **Buscar B/L**.
3. Marque os B/Ls. A coluna **Pode consolidar** diz por que um B/L não entra: já pago, sem saldo ou já em outra consolidada aberta.
4. Clique em **Emitir consolidada** e confirme.

O total é a soma dos saldos em aberto, não dos valores originais. O B/L ainda sem fatura também pode entrar: ele passa pelas mesmas conferências do **Emitir** e fica faturado.

O pagamento decide o que acontece depois:

- paga a consolidada, as individuais dos B/Ls dela ficam **Coberta**;
- quitado um B/L pela individual, a consolidada é substituída por outra só com os B/Ls que ainda devem, e o Cliente é avisado no Portal.

::: atencao
- A faixa da aba **Faturas** e o Portal contam cada B/L uma vez. Ao somar à mão, não conte a consolidada e as individuais juntas.
- Para cancelar uma individual cujo B/L está numa consolidada aberta, cancele antes a consolidada ([22.9](#229-cancelar-uma-fatura)).
:::

## 22.6 Imprimir a fatura

**Quem faz:** {{Qualquer equipe}}

O documento impresso é a fatura como foi congelada na emissão: o Cliente, os B/Ls, o navio, as taxas e o **TOTAL**. O título diz o tipo: **FATURA DE TAXAS LOCAIS** (um B/L), **FATURA CONSOLIDADA DE TAXAS LOCAIS** (dois ou mais) ou **FATURA** (avulsa). Na consolidada, cada B/L tem a sua faixa, com o subtotal.

1. Abra a fatura pelo número.
2. Clique em **Imprimir fatura** e confira o documento.
3. Clique em **Imprimir**. **Voltar ao detalhe** volta sem imprimir.

A fatura em aberto sai com o QR do Pix e o Copia e Cola; a paga, a coberta e a cancelada saem sem Pix. A janela de impressão abre em A4; com o pop-up bloqueado, o Vela imprime a própria página. **Imprimir recibo** aparece na fatura paga, na coberta e na cancelada que recebeu dinheiro (capítulo 24).

::: atencao
- "QR Code em preparação" quer dizer que o Pix ainda não voltou do Itaú. Gere o documento de novo em alguns minutos.
- O impresso sai sempre da emissão, com o saldo e o Pix do momento. Para mudar o que a fatura cobra, corrija o B/L ([22.7](#227-quando-o-bl-muda-depois-da-fatura)).
:::

## 22.7 Quando o B/L muda depois da fatura

**Quem faz:** corrigir o B/L, {{Qualquer equipe}}; acompanhar a fatura, {{Administrativo}} e {{Financeiro}}.

A fatura emitida nunca é editada. Quando uma correção muda o valor ou o Cliente de um B/L faturado (peso, containers, veículos, POD, taxa alterada à mão, preço corrigido na tabela de cobrança), o Vela compara o B/L com a fatura no fim da gravação e corrige a cobrança sozinho. Você corrige o B/L, e a fatura acompanha. O que o Vela faz com e sem pagamento está em [18.6](18-o-que-muda-sozinho.md#186-corrigir-um-bl); aqui você lê o resultado no detalhe da fatura. O B/L faturado cuja carga mudou também volta à Revisão e sai dela sozinho quando a fatura é corrigida ([8.5](08-revisao.md#85-quando-a-pendência-não-é-uma-das-três)).

- **Reemitida.** A fatura nova diz "Substitui a fatura …, cancelada para correção."; a antiga, "Substituída pela fatura …". O Cliente recebe o aviso no Portal e o Pix novo.
- **Abatida.** O bloco **Ajustes pela correção do B/L** mostra cada redução, "B/L … · redução de R$ …", com quanto saiu do saldo e quanto virou Restituição. A Restituição nasce **A devolver** e abre **Restituição pendente**; devolver e confirmar está no capítulo 24.
- **Correção pendente.** Quando a correção não conclui, o mesmo bloco traz **Tentar aplicar correção**, e abre **Fatura desatualizada** ([22.8](#228-resolver-uma-fatura-desatualizada)).

O quadro **Reemissão pendente**, no alto de **Taxas Locais**, lista as faturas canceladas pela correção cuja nova emissão travou. Resolva o motivo do alerta da fatura e use **Emitir fatura** na ficha do B/L. A consolidada volta sozinha quando as individuais saem; **Tentar reemitir**, no quadro, refaz a consolidada com os mesmos B/Ls.

A troca de Cliente segue o mesmo caminho: sem pagamento, a fatura é reemitida para o novo Cliente; com pagamento, o dinheiro volta ao Cliente anterior antes da nova cobrança (capítulo 24). O COD de um B/L faturado também aparece no quadro **Ajustes de COD**, que o {{Financeiro}} ou o {{Administrativo}} conclui (capítulo 24).

::: atencao
- Na reimportação, a mudança que afeta a fatura só entra se você marcar a confirmação do bloco **Faturamento** da prévia ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)).
- Mudar as datas do navio ou dos containers não corrige a fatura de Taxas Locais.
:::

## 22.8 Resolver uma Fatura desatualizada

**Quem faz:** {{Administrativo}} e {{Financeiro}}, que recebem o alerta. Tentar de novo e resolver, {{Qualquer equipe}}.

**Fatura desatualizada** quer dizer que uma correção do B/L mudou a cobrança e o Vela não pôde acertá-la sozinho. A fatura continua valendo como está. O alerta ([20.8](20-alertas.md#208-faturamento-e-taxas-locais)) leva ao detalhe da fatura, onde o bloco **Fatura desatualizada** diz qual dos dois casos é.

### Diferença a tratar

A fatura tem pagamento e o valor do B/L subiu. A diferença se cobra à parte:

1. Emita uma fatura avulsa com a diferença, para o mesmo Cliente e B/L ([22.4](#224-emitir-uma-fatura-avulsa)).
2. No detalhe da fatura original, em **Como a diferença foi tratada**, escreva qual avulsa saiu, ou por que a diferença não será cobrada, com ao menos 15 caracteres.
3. Clique em **Resolver com justificativa** e confirme.

**Resolver com justificativa** só fecha o alerta: não emite a avulsa nem muda a fatura.

### Reemissão travada

A nova fatura não pôde sair, e a antiga não foi cancelada. O motivo está no alerta: o Portal do Cliente sem Liberação, uma taxa em revisão no valor novo, a falta de tabela de cobrança ou de câmbio, ou terminais em conflito no B/L misto.

1. Resolva o motivo.
2. No detalhe da fatura, bloco **Ajustes pela correção do B/L**, clique em **Tentar aplicar correção**.

Se travar de novo, a pendência continua, e nada se perde.

::: atencao
- O valor menor numa fatura paga não abre este alerta: é abatido sozinho ([22.7](#227-quando-o-bl-muda-depois-da-fatura)).
- Na troca de Cliente com pagamento, se a nova cobrança trava depois da devolução, o botão é **Tentar emitir para o novo Cliente**, no mesmo bloco.
:::

## 22.9 Cancelar uma fatura

**Quem faz:** {{Administrativo}}. As outras equipes pedem a ele.

Cancelar tira a fatura de cobrança de vez: ela continua no Vela, com o motivo, mas o saldo e o Pix deixam de valer. Para corrigir o valor ou o Cliente, não cancele: corrija o B/L ([22.7](#227-quando-o-bl-muda-depois-da-fatura)). Cancele quando a cobrança não deve existir, por exemplo antes de cancelar o B/L, remover o CE ou cancelar a Viagem ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl), [6.6](06-importacao.md#66-corrigir-o-ce-ou-o-manifesto-de-um-bl) e [4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)).

1. Abra a fatura em **Taxas Locais**. Aberta pela **Conciliação PIX**, ela não mostra o cancelamento.
2. No bloco **Cancelar fatura**, escreva o **Motivo**.
3. Clique em **Cancelar fatura** e confirme.

O efeito está em [18.9](18-o-que-muda-sozinho.md#189-emitir-ou-cancelar-uma-fatura): no Portal, a fatura só aparece entre as canceladas, e o B/L volta para a **Validação**. A nova fatura desse B/L sai só pelo **Emitir** ([22.2](#222-como-a-fatura-sai)). Cancelar a fatura não cancela o B/L nem devolve dinheiro. Na consolidada cancelada, as individuais dos mesmos B/Ls continuam valendo. A avulsa se cancela do mesmo jeito e não mexe no B/L.

Para cancelar a Viagem, resolva assim, B/L a B/L, cada fatura ou pagamento dela; a Invoice de Demurrage em aberto também segura (capítulo 23).

| A fatura | Antes, faça |
|---|---|
| Tem pagamento lançado por engano | O {{Administrativo}} cancela a baixa (capítulo 24) e depois cancela a fatura. |
| Tem pagamento verdadeiro, e a cobrança deve sair | Veja abaixo. A avulsa paga sai pela restituição excepcional (capítulo 24). |
| É individual de um B/L numa consolidada aberta | Cancele antes a consolidada. |
| É individual de um B/L pago em outro documento | Cancele a baixa naquele documento. |
| Está **Coberta** ou já teve correção registrada | Não se cancela. A diferença, se houver, vai em avulsa. |

### Fatura com pagamento verdadeiro

Quando o Cliente pagou e a cobrança do B/L não deve existir (o B/L vai ser cancelado), o dinheiro volta antes:

1. O {{Administrativo}}, no bloco **Ajustes pela correção do B/L**, escolhe o **B/L para cancelamento financeiro**, escreve o motivo e clica em **Preparar cancelamento financeiro**. O saldo do B/L é abatido e o recebido vira Restituição; os outros B/Ls de uma consolidada continuam cobrados.
2. O {{Financeiro}} devolve o dinheiro e confirma a Restituição (capítulo 24).
3. O {{Administrativo}} cancela o B/L na ficha ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)).

::: atencao
- Fatura cancelada não volta. Uma nova cobrança é sempre uma nova emissão.
- **Preparar cancelamento financeiro** não cancela o B/L: depois da devolução confirmada, falta o passo 3.
:::
