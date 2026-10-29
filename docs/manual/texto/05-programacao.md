A programação é o que o Vela mostra das datas dos navios. O Cliente a vê em Chegadas e Saídas, no Portal; as equipes, no Line Up do Painel e na Tela TV. Nenhum desses quadros tem datas próprias: todos leem as Viagens do capítulo 4. Por isso a regra deste capítulo é simples: a data é uma só, e mudá-la em qualquer lugar muda em todos.

::: aprende
- ler a programação que o Cliente vê e publicar nela um navio;
- corrigir as datas e confirmar a saída ou a chegada que já aconteceu;
- atualizar vários navios de uma vez por planilha;
- acompanhar o Line Up e deixar a Tela TV num monitor;
- saber onde ficam navios, armadores, portos e terminais.
:::

## 5.1 Ler a programação em Chegadas e Saídas

**Quem faz:** {{Todas as equipes}}

**Chegadas e Saídas** (atalho no alto do **Painel** e de **Viagens**) é a programação publicada no Portal: para cada navio, quando ele sai da origem e quando chega a cada porto brasileiro. Cada linha é uma Viagem com a chave **Aparece em Chegadas e Saídas** ligada, e o navio que chega primeiro fica no alto.

::: tela chegadas-saidas
Chegadas e Saídas: a saída de Shanghai já passou e aparece em âmbar, com o botão de confirmar.
:::

1. **Adicionar navio** publica um navio novo ([5.2](#52-publicar-um-navio)).
2. Ao lado da data em âmbar, o botão confirma a saída ou a chegada que já aconteceu ([5.4](#54-confirmar-a-saída-ou-a-chegada)).
3. O lápis abre as datas do navio para corrigir ([5.3](#53-corrigir-as-datas-de-um-navio)).

| Na célula | Quer dizer |
|---|---|
| Data com ✓ verde | A saída ou a chegada aconteceu. |
| Data sem marca | Previsão. |
| Data em âmbar | A previsão passou e ninguém confirmou. O âmbar aparece só no Vela; o Cliente vê uma previsão comum. |
| **Omitida** | O armador omitiu a escala ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)). |

O quadro mostra só oito portos: Qingdao, Shanghai, Taicang, Ningbo e Nansha na origem, e Salvador, Vitória e Pecém no Brasil.

::: atencao
Se um navio não aparece, confira na Viagem se a chave **Aparece em Chegadas e Saídas** está ligada, se ela está **Ativa** e se tem pelo menos uma data num desses oito portos.
:::

## 5.2 Publicar um navio

**Quem faz:** {{Qualquer equipe}}

Quando o armador manda a programação de um navio que ainda não está no quadro:

::: lado
1. Em **Chegadas e Saídas**, clique em **Adicionar navio**.
2. Preencha o nome do navio, a viagem (VOY) e o **IMO**.
3. Em cada porto que o navio faz, desmarque **Não escala** e informe a data prevista.
4. Clique em **Adicionar e publicar** e confirme em **Publicar viagem**.

::: tela adicionar-navio
A janela Adicionar navio à programação.
:::
:::

O Vela procura primeiro a Viagem pelo número e pelo IMO. Se ela já existe em **Viagens**, grava as datas nela e a publica; se não existe, cria a Viagem já publicada. Por isso o IMO importa: sem ele, o Vela procura pelo nome do navio, e um nome que casa com mais de uma Viagem é recusado.

## 5.3 Corrigir as datas de um navio

**Quem faz:** {{Qualquer equipe}}

::: lado
1. Na linha do navio, clique no lápis.
2. Troque a data do porto que mudou.
3. Clique em **Salvar alterações** e confirme.

::: tela editar-programacao
A janela de edição: só as datas mudam aqui.
:::
:::

A data que você salva aqui é a mesma da escala na ficha da Viagem. Nome do navio, viagem e IMO não mudam aqui: corrija em **Viagens** › **Editar**.

Para dizer que o navio não vai mais a um porto, marque **Não escala** nele. Para a maioria das equipes, só a data sai. O {{Administrativo}} vai além: se a escala ainda não tem nada ligado a ela (B/L para aquele porto, chegada ou saída registrada, manifesto vinculado, terminais salvos), ela sai da Viagem. A confirmação diz qual dos dois casos vai acontecer.

::: atencao
- Se o navio deixou de ir ao porto e já tem carga para ele, não marque **Não escala**: registre a omissão da escala ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)).
- Se a escala está travada (por exemplo, com o ADR de Saída fechado), o Vela recusa e não grava nada da janela.
:::

## 5.4 Confirmar a saída ou a chegada

**Quem faz:** {{Qualquer equipe}}

A data em âmbar quer dizer que a previsão passou e ninguém registrou o que aconteceu. Você confirma na própria célula.

::: lado
1. Clique no botão ao lado da data em âmbar.
2. Confira a data. Na chegada, informe também a hora.
3. Clique em **Confirmar saída** (ou **Confirmar chegada**).

::: tela confirmar-saida
A confirmação da saída de Shanghai.
:::
:::

A **chegada** confirmada é o próprio ATA da escala: é a mesma coisa que registrá-lo na ficha da Viagem ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)).

A **saída** confirmada é provisória. A data real de saída vem do B/L, pela data de embarque (Laden on Board): quando o primeiro B/L chega com outra data, ela substitui a sua. A confirmação cobre o intervalo até o B/L chegar.

## 5.5 Atualizar vários navios por planilha

**Quem faz:** {{Qualquer equipe}}

Quando o armador manda a programação de vários navios de uma vez, use a planilha. Baixe o modelo na própria janela: uma linha por viagem, com **VESSEL NAME**, **VOY**, **IMO** e uma coluna por porto.

::: passos
1. Em **Chegadas e Saídas**, abaixo do quadro, clique em **Importar programação**.
2. Escolha a planilha. O Vela lê e monta a prévia; nada é gravado ainda.
3. Confira a **Prévia**: cada viagem aparece como **Cria**, **Atualiza** ou **Sem alteração**, com as datas que mudam.
4. Clique em **Importar N viagens**.
:::

::: tela importar-programacao
A prévia: a COSCO SHIPPING SEREIA será atualizada e a COSCO SHIPPING CORAL, criada.
:::

A planilha entra inteira ou não entra: uma linha com erro bloqueia todas, para a programação nunca ficar pela metade.

::: atencao
- Célula vazia deixa o porto como está: a planilha nunca apaga uma data nem tira uma escala. Para isso, use o lápis ([5.3](#53-corrigir-as-datas-de-um-navio)).
- A planilha traz só o dia. Se ele é o mesmo já gravado, a hora fica; se muda, confira a hora na Viagem depois.
:::

## 5.6 Tirar um navio da programação

**Quem faz:** {{Qualquer equipe}}

O navio sai do quadro sozinho quando a Viagem é concluída, no último ATD. Para tirá-lo antes, sem mexer na Viagem:

1. Em **Viagens**, abra a Viagem e clique em **Editar**.
2. Desligue **Aparece em Chegadas e Saídas** e clique em **Salvar viagem**.

O navio some de Chegadas e Saídas e do Portal, mas continua no Line Up, que é das equipes. Para publicar de novo, ligue a chave.

## 5.7 Acompanhar o Line Up e a Tela TV

**Quem faz:** {{Todas as equipes}}

O **Line Up**, no **Painel**, é o quadro de trabalho das equipes: os navios atracados, os que estão chegando e a carga de cada porto. Ele também não guarda nada: é a leitura das Viagens, e se atualiza sozinho a cada 90 segundos.

::: tela painel-lineup
O Line Up: o navio atracado em Vitória com a faixa verde, uma linha de exportação e a escala omitida no fim.
:::

1. **Tela TV** abre o quadro em outra janela, para um monitor da sala.
2. **Exportar** leva para uma planilha as linhas que estão na tela.
3. Os filtros recortam o quadro. **Escalas** começa em **Ativas**.

Como ler o quadro:

- Há uma linha por escala; a escala que descarrega e embarca tem duas, uma de importação e outra de exportação.
- A ordem é a do porto: primeiro os navios atracados, depois os que chegaram, os previstos, os que já saíram e, no fim, as escalas omitidas.
- A faixa verde marca o navio atracado. O ✓ marca a data que já aconteceu.
- O âmbar pede ação da documentação: **CEs** em **Aguardando** ou **Vinculada** em **Não**.
- Cada número abre a lista correspondente, já filtrada.

A **Tela TV** mostra as escalas que ainda não terminaram, em letras grandes, e desliza sozinha quando há mais de oito linhas.

::: atencao
A Tela TV usa a sessão de quem a abriu. Depois de 8 horas sem ninguém mexer no computador, a sessão termina e a TV volta ao login: entre de novo e abra **Tela TV** pelo **Painel**.
:::

## 5.8 Navios, armadores, portos e terminais

**Quem faz:** {{Qualquer equipe}} · desativar e reativar um terminal ou Local: {{Administrativo}}

Esses são os cadastros de apoio das Viagens. Só os terminais têm tela própria:

- **Navios e armadores** nascem e mudam pelas Viagens, em **Nova Viagem** e **Editar** (capítulo 4), por Chegadas e Saídas e pela planilha. O armador corrigido numa Viagem vale para todas as Viagens do mesmo navio.
- **Portos** nascem sozinhos na primeira escala com o código deles. O Vela entende grafias diferentes do mesmo porto, como BRVIT e BRVIX para Vitória.
- **Terminais** ficam na tela de Locais, junto com os depots: no menu, em **Exportação**, clique em **Vazios EXP** e depois em **Locais (depots e terminais)**. O terminal precisa estar ligado ao porto para aparecer na escala.

::: atencao
Se o terminal não aparece para escolher na escala, confira em Locais se ele é **Terminal portuário**, se o **Porto** é o da escala e se está ativo. Para reativar, peça ao {{Administrativo}}.
:::
