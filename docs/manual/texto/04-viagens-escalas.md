Tudo no Vela começa pela Viagem: a passagem de um navio pelos portos brasileiros. Os B/Ls, o CE Mercante, a cobrança e os avisos ao Cliente se penduram nela. Neste capítulo você cadastra a Viagem, diz por quais portos ela passa, acompanha a chegada e a saída do navio e registra o que muda no caminho, como uma escala que o armador cancelou.

::: aprende
- cadastrar uma Viagem e planejar as escalas dela;
- atribuir os terminais e registrar a chegada, a atracação e a saída do navio;
- ler a lista e a ficha da Viagem;
- registrar a omissão de uma escala e a mudança de destino (COD);
- concluir, cancelar ou excluir uma Viagem.
:::

## 4.1 Cadastrar uma Viagem

**Quem faz:** {{Qualquer equipe}}

Antes de cadastrar, procure a viagem em **Viagens**: ela pode já existir, criada pela programação de navios (capítulo 5). O Vela não aceita a mesma viagem duas vezes.

::: lado
1. Em **Viagens**, clique em **Nova Viagem**.
2. Preencha **Navio**, **IMO** e **Numero da viagem**. O armador já vem como Cosco Shipping Specialized Carriers (CSSC); troque só se a viagem for de outro armador.
3. Se os Clientes devem ver a viagem na programação do Portal, ligue **Aparece em Chegadas e Saídas**.
4. Clique em **Cadastrar viagem**.

::: tela nova-viagem
A janela Nova Viagem preenchida.
:::
:::

A Viagem nasce **Ativa** e sem datas. As datas não são da Viagem, e sim de cada porto por onde ela passa: é o que você planeja em seguida.

::: atencao
- O **IMO** identifica o navio, mais do que o nome. Confira com o armador: com o IMO certo, "CS SEREIA" e "COSCO SHIPPING SEREIA" são o mesmo navio.
- Navio e armador não têm tela própria. Corrigir o armador numa Viagem corrige em todas as Viagens do mesmo navio.
:::

## 4.2 Planejar as escalas

**Quem faz:** {{Qualquer equipe}}

A **escala** é a passagem da Viagem por um porto brasileiro. Um porto, uma escala, seja para descarregar, embarcar ou as duas coisas. A escala guarda a chegada do navio ao porto: o **ETA**, a chegada prevista, e depois o **ATA**, a chegada que aconteceu. Portos estrangeiros, como Shanghai, não são escala: eles aparecem na rota dos B/Ls.

::: lado
1. Na ficha da Viagem, aba **Visão geral**, no bloco **Planejamento por escala**, clique em **Adicionar escala**.
2. Em **Porto da escala**, digite o código do porto, como BRSSA (Salvador) ou BRVIX (Vitória).
3. Informe o **ETA**, com data e hora.
4. Em **Operação da escala**, escolha se o navio descarrega, embarca ou faz as duas coisas.
5. Clique em **Adicionar escala**.

::: tela adicionar-escala
A janela Adicionar escala com o porto de Salvador.
:::
:::

Repita para cada porto. Nem sempre você precisa: a escala também nasce sozinha quando um arquivo de B/L traz carga para aquele porto ou quando a programação de navios informa a chegada.

Quando a escala tem exportação, a janela pede o que vai ser embarcado: **Granito**, **Embarque de vazios** ou os dois. Você declara a exportação antes de saber a quantidade, para o terminal e o Line Up já se prepararem.

::: atencao
A declaração de exportação só sai depois que a carga deixar de existir. Com Granito importado no porto ou um Embarque de vazios aberto na escala, ela fica travada (capítulo 10).
:::

Na mesma janela ficam três informações do Mercante, que você preenche quando souber:

- **BLs e CEs** diz em que pé está a documentação da escala, de **Aguardando** a **Aprovado**. O Vela atualiza sozinho a cada importação; mudar à mão pede justificativa.
- **Vinculada** confirma que os manifestos foram vinculados à escala no Mercante.
- **Nº escala** é o número da escala no Mercante.

## 4.3 Atribuir os terminais

**Quem faz:** {{Qualquer equipe}} · remover uma atracação: {{Operações}} e {{Administrativo}}

Um porto pode ter vários terminais, e cada operação da escala acontece num deles. Por isso a escala se divide em **frentes de operação**: carga cheia, carga solta, vazios e veículos na importação; Granito e vazios na exportação. Cada frente recebe o seu terminal.

Cada terminal escolhido vira uma **Atracação**, a passagem do navio por aquele terminal, com as datas do berço: **ETB** e **ATB** (atracação prevista e realizada) e **ETD** e **ATD** (desatracação prevista e realizada).

::: lado
1. No **Planejamento por escala**, clique no lápis da escala.
2. Em **Terminais e atracações**, escolha o terminal de cada frente.
3. No cartão de cada terminal, informe o **ETB** e o **ETD**. Quando o navio atracar e sair, volte aqui e informe o **ATB** e o **ATD**.
4. Clique em **Salvar escala**.

::: tela escala-terminais
A frente de carga cheia no terminal TVV, com as previsões do berço.
:::
:::

A frente ainda sem terminal fica como **TBC** ("terminal a confirmar"). Pode ficar assim enquanto o navio não chegou; depois do ATA, toda frente precisa de terminal.

::: atencao
- Depois que a escala foi salva, mudar o que já aconteceu (terminal de uma frente, ATB, ATD) pede uma justificativa. Ela fica no histórico.
- Se o terminal já tem o ADR de Saída fechado, o Vela não deixa mudar a atracação. Reabra o ADR antes (capítulo 11).
- Se outra pessoa salvou a mesma escala enquanto você editava, o Vela não grava e avisa. Abra a escala de novo e refaça.
:::

## 4.4 Manter as datas do navio em dia

**Quem faz:** {{Qualquer equipe}}

As datas mudam o tempo todo: o armador atrasa o navio, o navio chega, atraca, sai. Cada data fica no seu lugar: chegada ao porto na escala, berço no cartão do terminal.

1. No **Planejamento por escala**, clique no lápis da escala.
2. Mude o **ETA** ou, quando o navio chegar, informe o **ATA**. Atracação e saída vão no cartão do terminal ([4.3](#43-atribuir-os-terminais)).
3. Clique em **Salvar escala**.

Você não precisa avisar ninguém: a data nova chega sozinha ao Line Up, a Chegadas e Saídas, ao Portal do Cliente (se a Viagem está publicada) e aos avisos de chegada e atracação que o Vela manda ao Cliente. E o Vela cobra o que falta: quando o ETA passa sem o ATA registrado, ou o ETB passa sem o ATB, abre um alerta para a equipe.

A **Próxima escala**, no alto da ficha, é a escala de menor ETA que ainda não teve chegada. Ela só passa a vez quando você registra o ATA: um ETA vencido continua ali, marcado "· vencido", para lembrar que falta registrar a chegada.

Os prazos de documentação da Viagem (os alertas de B/L e de CE que abrem 7 e 5 dias antes da chegada) contam do primeiro ETA no Brasil. Se o navio passa antes por um porto que não é escala de importação, indique esse porto na edição da Viagem, em **1º Porto Brasileiro**.

::: atencao
As datas do navio não mudam a cobrança. As Taxas Locais usam a data da importação do B/L, e a Demurrage corre pela descarga de cada container.
:::

## 4.5 Acompanhar a Viagem

**Quem faz:** {{Qualquer equipe}}

A lista de **Viagens** mostra os navios na ordem em que chegam: o menor ETA primeiro. Use os filtros de período e de status para ver só o que interessa, como as Viagens que chegam nos próximos 7 dias.

Cada Viagem traz um sinal de **Conciliação**, que resume o que falta de documento, com o mesmo nome e a mesma cor nos cartões, na lista e na ficha:

| Sinal | Quer dizer |
|---|---|
| **Conciliada** | Nada falta. Nos cartões das Viagens, com o ponto verde. |
| **Pendente** (âmbar) | Falta CE Mercante em algum B/L. |
| **Divergente** (vermelho) | O Baplie e os B/Ls não batem (capítulo 6). |

Enquanto o Vela ainda confere as divergências do Baplie, o sinal mostra **Verificando**.

Clique na Viagem para abrir a ficha. No alto, cinco blocos resumem a Viagem: contêineres, carga solta, exportação, próxima escala e conciliação. Abaixo ficam as abas: **Visão geral** (escalas e Linha do tempo), **Importação** e **Exportação** (a carga e os atalhos de importação), **Rotas e Manifestos** e **ADR**.

A **Linha do tempo** conta a história do navio: quando a Viagem foi criada, cada arquivo importado, cada data alterada, com quem fez e a justificativa.

Para corrigir navio, IMO ou número, clique em **Editar** na ficha.

## 4.6 Rotas e Manifestos

**Quem faz:** {{Qualquer equipe}}

A aba **Rotas e Manifestos** organiza os B/Ls da Viagem por rota, do porto de embarque (POL) ao de descarga (POD). Cada rota tem duas informações que não estão na escala:

- o **ATD do POL**, a data em que o navio saiu do porto de embarque. O Vela calcula sozinho pela data de embarque dos B/Ls;
- o **Nº de Manifesto Mercante**, os 13 caracteres do manifesto daquela rota. Enquanto falta, a rota mostra "A informar".

::: tela rotas-manifestos
Cada rota com o lápis (rota com número) ou Informar Nº de Manifesto Mercante (rota sem número).
:::

1. Na rota, clique no lápis, ou em **Informar Nº de Manifesto Mercante** se a rota ainda não tem número.
2. Corrija o **ATD** ou digite o **Nº do manifesto**.
3. Clique em **Salvar**.

O ATD que você digita vale mais que o calculado, e nenhuma importação o muda depois. Para voltar ao calculado, apague a data.

Para tirar B/Ls de um manifesto ou passá-los para outro, use **Ver B/Ls** na rota: marque os B/Ls, escolha **Mover** ou **Desvincular** e escreva o motivo.

## 4.7 Quando o armador omite uma escala

**Quem faz:** {{Qualquer equipe}}

Às vezes o armador não faz uma escala prevista e descarrega a carga daquele porto em outro porto da mesma Viagem, o **Porto de Transbordo**. Dali, a carga segue de duas formas:

- em **transbordo**: segue em outro navio até o destino original. Nada muda na cobrança;
- em **COD** (mudança de destino): o Cliente retira a carga no Porto de Transbordo. O destino do B/L muda e a Taxa Local é recalculada no novo porto.

Omitir não é excluir: a escala continua na Viagem, marcada **Omitida**, para registrar o que aconteceu.

### Registrar a omissão

O Porto de Transbordo precisa ser outra escala da Viagem. Se ainda não está no planejamento, adicione-o antes ([4.2](#42-planejar-as-escalas)).

::: lado
1. Abra a escala omitida pelo lápis e clique em **Omitir escala**.
2. Em **Porto de Transbordo**, escolha onde a carga foi descarregada.
3. Preencha o que já souber do navio de transbordo. O resto pode ser completado depois, em **Complementar**.
4. Clique em **Omitir escala**, confira os B/Ls afetados e clique em **Confirmar omissão**.

::: tela omitir-escala
A omissão de Salvador, com Vitória como Porto de Transbordo.
:::
:::

Todos os B/Ls daquele porto passam a **Transbordo**, e cada Cliente vê no Portal que a escala foi omitida e para onde a carga foi. Se você omitiu por engano, use **Reverter omissão** no cartão **Informações de Transbordo**; os Clientes recebem a correção.

### Mudar o destino de um B/L (COD)

O COD é decidido B/L a B/L, porque cada Cliente pode escolher um caminho.

::: lado
1. Na ficha do B/L afetado, no cartão **Transbordo**, clique em **Marcar COD**.
2. Escreva a **Justificativa**.
3. Clique em **Confirmar COD**.

::: tela marcar-cod
A janela Marcar COD.
:::
:::

O destino do B/L passa a ser o Porto de Transbordo e a Taxa Local é recalculada. Se o B/L já foi faturado, a diferença vira um ajuste para o {{Financeiro}} (capítulo 24). Para desfazer, use **Reverter para transbordo** no mesmo cartão.

::: atencao
- Reverter o COD devolve o destino, mas não devolve o B/L ao Manifesto Mercante, que o COD tirou. Depois de reverter, mova o B/L de volta em **Rotas e Manifestos** › **Ver B/Ls** ([4.6](#46-rotas-e-manifestos)).
- Para reverter a omissão, reverta antes o COD de cada B/L que o tiver.
:::

## 4.8 Encerrar, cancelar ou excluir

**Concluir.** Você normalmente não conclui a Viagem: o Vela conclui sozinho quando o navio sai do último terminal, isto é, quando toda escala tem atracação e todas as atracações têm ATD. A Viagem concluída sai da programação e do Portal. Se o registro do porto não vai chegar, conclua à mão em **Editar**, no campo **Status**.

As outras três ações são do {{Administrativo}}:

| Ação | Quando usar | O que acontece |
|---|---|---|
| **Cancelar viagem** | O armador não vai realizar a viagem. | A Viagem fica no Vela, somente leitura, com tudo o que tinha, e sai do Line Up e do Portal. Pede motivo. |
| **Reativar viagem** | O cancelamento foi engano. | A Viagem volta a ativa. Pede motivo. |
| **Excluir** | A Viagem foi criada por engano. | Apaga a Viagem e tudo o que é dela. O Vela mostra antes o que vai junto. |

::: atencao
- Para cancelar, nenhum B/L da Viagem pode ter fatura ou pagamento. O {{Financeiro}} resolve B/L a B/L antes (capítulos 22 a 24).
- Para excluir, a Viagem não pode ter nada oficial: CE Mercante, fatura, ADR fechado ou Comunicado enviado. Nesse caso, cancele.
- Para tirar uma escala cadastrada por engano, o Administrativo usa **Excluir escala**, na janela da escala. Se o navio só deixou de ir ao porto, registre a omissão ([4.7](#47-quando-o-armador-omite-uma-escala)).
:::
