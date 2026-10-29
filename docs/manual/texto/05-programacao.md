A programação é o que o Vela mostra das datas dos navios. Para o Cliente, ela aparece em Chegadas e Saídas e no Portal; para as equipes, no Line Up do Painel e na Tela TV. Nenhum desses quadros tem datas próprias: todos leem as Viagens e as escalas do capítulo 4. Este capítulo mostra como publicar e manter a programação, acompanhar o Line Up e cuidar dos cadastros de apoio (navios, armadores, portos e terminais).

::: aprende
- ler a programação que o Cliente vê e publicar nela um navio novo;
- corrigir as datas de um navio e confirmar a saída ou a chegada que já aconteceu;
- atualizar vários navios de uma vez por planilha;
- tirar um navio da programação;
- acompanhar o Line Up do Painel e deixar a Tela TV num monitor;
- saber onde ficam navios, armadores, portos e terminais.
:::

## 5.1 Acompanhar a programação em Chegadas e Saídas

<!-- regras: VIA-103 VIA-104 VIA-115 -->

**Chegadas e Saídas** mostra a "Programação publicada no Portal": para cada navio publicado, quando ele sai da origem e quando chega a cada porto brasileiro. Não é um cadastro à parte: cada linha é uma Viagem, e cada data vem dessa Viagem.

::: ficha
- **Quando usar:** Para ver o que o Cliente está vendo, achar as datas que venceram e abrir a programação de um navio.
- **Quem faz:** {{Todas as equipes}}
- **Antes de começar:** Abra pelo atalho **Chegadas e Saídas** ("programação por porto"), no alto do **Painel** ou de **Viagens**.
:::

### Como o quadro é montado

- Uma linha por Viagem publicada e **Ativa**. Publicada é a Viagem com a chave **Aparece em Chegadas e Saídas** ligada ([4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)).
- A Viagem só entra com ao menos uma previsão: o ETA de uma escala ou o ETD de um porto de origem. Viagem publicada sem nenhuma data não aparece.
- As colunas são fixas. Primeiro as de saída na origem, com o ETD (a previsão de saída): "Qingdao ETD", "Shanghai ETD", "Taicang ETD", "Ningbo ETD" e "Nansha ETD". Depois as de chegada no Brasil, com o ETA (a previsão de chegada): "Salvador ETA", "Vitória ETA" e "Pecém ETA".
- Escala em outro porto não aparece no quadro. A Viagem que só tem datas em portos fora do quadro aparece com "—" em todas as colunas.
- A ordem é pela menor ETA: o navio que chega primeiro fica no alto.
- Porto sem data em nenhum navio sai do quadro, e uma nota abaixo diz quantos ("5 portos sem data em nenhum navio não aparecem.").

Cada célula diz uma coisa:

| Na célula | Quer dizer |
|---|---|
| Data com ✓ verde | Data efetiva: a saída registrada (ATD) no porto de origem ou a chegada registrada (ATA) no porto brasileiro. |
| Data sem marca | Previsão. |
| Data em âmbar | Previsão que já passou e ainda não tem data efetiva. O âmbar aparece **só no Vela**. |
| **Omitida**, em cinza | O armador omitiu a escala ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)). |
| "—" | Porto sem data. |

::: passos
1. **Adicionar navio** publica um navio que ainda não está na programação ([5.2](#52-publicar-um-navio-na-programação)).
2. A data em âmbar tem ao lado o botão de confirmar a data efetiva. Use-o quando a saída ou a chegada já aconteceu ([5.4](#54-confirmar-a-saída-ou-a-chegada-que-já-aconteceu)).
3. O lápis ("Editar programação de NAVIO / VOY") abre a programação do navio para corrigir as datas ([5.3](#53-corrigir-as-datas-de-um-navio)). Ao lado dele, **Ver no mapa** abre a posição do navio pelo IMO. Navio sem IMO não tem esse botão.
:::

::: tela chegadas-saidas
Chegadas e Saídas no exemplo: a saída de Shanghai da COSCO SHIPPING SEREIA já passou e aparece em âmbar, com o botão de confirmar.
:::

Abaixo do quadro fica o bloco "Atualizar várias viagens por planilha", com **Importar programação** ([5.5](#55-atualizar-vários-navios-por-planilha)).

### O que o Cliente vê no Portal

No Portal, o Cliente vê o mesmo quadro no bloco **Chegadas e saídas** do Painel dele, e só depois de entrar com a sessão do Portal. Ele vê a previsão e a data efetiva, nunca o âmbar: a data que venceu aparece para ele como uma previsão comum. As datas que você grava em Viagens ou em Chegadas e Saídas aparecem para o Cliente na próxima leitura do Portal.

::: aconteceu "Nenhum navio publicado no Portal"
- **O que o sistema faz:** Mostra o quadro vazio porque nenhuma Viagem Ativa está publicada.
- **O que você faz:** Publique um navio em **Adicionar navio** ([5.2](#52-publicar-um-navio-na-programação)) ou envie a planilha ([5.5](#55-atualizar-vários-navios-por-planilha)).
:::

::: aconteceu "Não foi possível carregar a programação publicada."
- **O que o sistema faz:** Não conseguiu ler o quadro. Nada foi alterado.
- **O que você faz:** Clique em **Tentar novamente**.
:::

::: aconteceu "O navio não aparece em Chegadas e Saídas nem no Portal"
- **O que o sistema faz:** Mostra só Viagens publicadas e **Ativas**, com ao menos uma data, e só os oito portos do quadro.
- **Por quê:** A programação mostra ao Cliente só o que a equipe publicou e ainda está valendo.
- **O que você faz:** Em **Viagens**, abra a Viagem e confira se a chave **Aparece em Chegadas e Saídas** está ligada e se a Viagem não está **Concluída** ou **Cancelada** ([5.6](#56-tirar-um-navio-da-programação)). Confira também se ela tem ao menos uma previsão (ETA de uma escala ou ETD de um porto de origem). Se a Viagem nem existe, publique o navio ([5.2](#52-publicar-um-navio-na-programação)). Escala num porto fora do quadro não entra.
:::

::: aconteceu "A data aparece em âmbar"
- **O que o sistema faz:** Marca a previsão que já passou sem data efetiva. Só no Vela; no Portal ela continua como previsão comum.
- **O que você faz:** Se o navio já saiu ou chegou, confirme a data efetiva na própria célula ([5.4](#54-confirmar-a-saída-ou-a-chegada-que-já-aconteceu)). Se não, atualize a previsão em **Editar** ([5.3](#53-corrigir-as-datas-de-um-navio)).
:::

::: porque
A programação é a própria Viagem vista pelo Cliente. Assim, a data existe num lugar só: a mesma que você vê na ficha da Viagem aparece em Chegadas e Saídas, no Line Up e no Portal.
:::

## 5.2 Publicar um navio na programação

<!-- regras: VIA-105 VIA-106 VIA-107 -->

::: ficha
- **Quando usar:** O armador mandou a programação de um navio que ainda não aparece em Chegadas e Saídas.
- **Quem faz:** {{Qualquer equipe}}. Todo usuário ativo publica.
- **Antes de começar:** Tenha o nome do navio, o número da viagem (VOY), o IMO (os 7 dígitos do navio) e a data prevista em cada porto. Se a Viagem já existe em Viagens, o Vela a encontra e grava nela; leia antes o quadro de atenção abaixo.
:::

Em **Chegadas e Saídas**, clique em **Adicionar navio**. Abre a janela **Adicionar navio à programação**, com todos os portos marcados como **Não escala**.

::: lado
1. Em **Nome do Navio**, digite o nome do navio. No exemplo, COSCO SHIPPING SEREIA.
2. Em **Viagem (VOY)**, digite o número da viagem. No exemplo, 024E.
3. Em **Número IMO**, digite os 7 dígitos do navio. No exemplo, 9900019. O IMO não é obrigatório, mas é ele que garante achar o navio certo.
4. Em cada porto que o navio faz, desmarque **Não escala**. O campo já vem com a data de hoje: troque pela data prevista. No exemplo, **Shanghai · ETD**, **Salvador · ETA** e **Vitória · ETA**.
5. Clique em **Adicionar e publicar**. A confirmação "Publicar programação da viagem" avisa que a programação vai ficar visível no Portal. Clique em **Publicar viagem**. Aparece "Viagem cadastrada e publicada no Portal.".

::: tela adicionar-navio
A janela Adicionar navio à programação, com todos os portos ainda em Não escala.
:::
:::

Nome do navio e número da viagem são obrigatórios. Pelo menos um porto de **Chegada no Brasil (ETA)** precisa ter data; os portos de origem são opcionais.

::: sozinho
- Procura a Viagem pelo número da viagem e pelo IMO. O IMO exato vale mais que a grafia do nome; com IMO diferente, nunca junta duas Viagens.
- Sem IMO, procura pelo nome padronizado do navio, o mesmo de Nova Viagem ([4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)).
- Achou a Viagem: grava nela só os portos com data e a publica no Portal. Porto deixado em **Não escala** não perde nada: para tirar uma data, use **Editar** ([5.3](#53-corrigir-as-datas-de-um-navio)). É o caso da COSCO SHIPPING SEREIA / 024E do exemplo, já cadastrada em Viagens ([4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)): o Vela a acha pelo IMO 9900019 e não cria outra.
- Não achou: cria a Viagem já publicada, com o armador padrão (Cosco Shipping Specialized Carriers, SCAC CSSC). A **Linha do tempo** da Viagem mostra "Viagem criada · Origem: Chegadas e Saídas".
- Se o navio já está cadastrado com outro armador, o armador dele passa a ser o padrão em todas as suas Viagens.
- Grava só o ETD dos portos de origem e o ETA dos portos de chegada, e só a data, sem hora. A data no mesmo dia da que já está gravada não muda nada, nem a hora.
- Não muda o tipo da escala: a escala só de exportação continua só de exportação.
- Não toca em ATA, ATD, Restow, **BLs e CEs**, **Vinculada** nem **Nº Escala** das escalas.
- O ETA gravado aqui é o mesmo ETA da escala na ficha da Viagem: não existe uma data "do Portal" separada.
:::

::: conferir
O navio aparece no quadro de Chegadas e Saídas, na posição da sua menor ETA. Em **Viagens**, a ficha da Viagem mostra o mesmo ETA nas escalas de Salvador e Vitória. Se a Viagem foi criada aqui, confira o armador na ficha e corrija na edição da Viagem, se precisar.
:::

::: aconteceu "Informe navio e número da viagem."
- **O que o sistema faz:** Não grava sem **Nome do Navio** e **Viagem (VOY)**.
- **O que você faz:** Preencha os dois campos e clique de novo em **Adicionar e publicar**.
:::

::: aconteceu "Informe ao menos um porto de descarga com data."
- **O que o sistema faz:** Não grava com todos os portos de chegada em **Não escala**.
- **O que você faz:** Desmarque **Não escala** em pelo menos um porto de **Chegada no Brasil (ETA)** e informe a data.
:::

::: aconteceu "Viagem … ambígua: N candidatas. Informe o IMO."
- **O que o sistema faz:** Não grava nada quando o nome do navio, sem IMO, casa com mais de uma Viagem. O mesmo vale para o navio já cadastrado com outro IMO ("Navio … com IMO conflitante (… vs …). Corrija antes de importar."). O Vela não junta nem cria nada. Sem motivo legível, o aviso é "Falha ao cadastrar a viagem.".
- **Por quê:** Escolher uma das Viagens por conta própria poderia gravar as datas no navio errado.
- **O que você faz:** Digite o IMO de 7 dígitos e clique de novo em **Adicionar e publicar**. Se continuar, confira o IMO do navio com o armador e na edição da Viagem, em **Viagens** ([5.9](#59-cadastros-de-apoio-navios-armadores-portos-e-terminais)).
:::

::: aconteceu "Viagem … cancelada: operação selada e somente leitura."
- **O que o sistema faz:** O Vela achou a Viagem, mas ela está cancelada, e recusa a gravação. O aviso também pode ser "Viagem … cancelada: escala somente leitura.".
- **O que você faz:** Confira o número da viagem. Se a Viagem deve voltar, peça ao {{Administrativo}} para reativá-la ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)).
:::

::: porque
A programação não tem cadastro próprio: publicar um navio é gravar as datas na Viagem dele. Por isso o Vela procura a Viagem antes de criar, e o IMO decide qual é: o mesmo navio escrito de dois jeitos não vira duas Viagens.
:::

## 5.3 Corrigir as datas de um navio

<!-- regras: VIA-108 VIA-107 -->

::: ficha
- **Quando usar:** O armador mudou a previsão de saída ou de chegada de um navio que já está na programação, ou o navio não vai mais a um porto.
- **Quem faz:** {{Qualquer equipe}}. Ao marcar **Não escala**, só o {{Administrativo}} tira a escala da Viagem; para as outras equipes, só a data sai.
- **Antes de começar:** Aqui só se mudam datas. Nome do navio, viagem e IMO se corrigem na edição da Viagem, em **Viagens**.
:::

Em **Chegadas e Saídas**, na linha do navio, clique no lápis ("Editar programação de NAVIO / VOY"). Abre a janela "Editar programação · COSCO SHIPPING SEREIA / 024E".

::: lado
1. No porto que mudou, troque a data. Por exemplo, se o armador adiou a chegada em Salvador, digite a nova data em **Salvador · ETA**. Para tirar a data de um porto, marque **Não escala** nele (veja abaixo).
2. Clique em **Salvar alterações**. Na confirmação "Salvar programação da viagem", clique de novo em **Salvar alterações**. Aparece "Programação atualizada no Portal.".

::: tela editar-programacao
A janela Editar programação: navio, viagem e IMO aparecem apagados; só as datas mudam.
:::
:::

**Nome do Navio**, **Viagem (VOY)** e **Número IMO** aparecem, mas não mudam aqui. A janela avisa: "Navio, viagem e IMO se corrigem em Viagens. Aqui só as datas.". A data de chegada que você salva é o próprio ETA da escala na ficha da Viagem. Tudo é gravado só com a data, sem hora.

### Quando você marca "Não escala"

- **Num porto de origem:** só o ETD daquele porto sai.
- **Num porto de chegada que tinha data:** a confirmação fica em vermelho e diz o que vai acontecer, conforme quem marca e o que a escala já tem:

| Quem marca | Escala sem nada ligado a ela | Escala com B/L descarregando no porto, ATA, ATD, **Vinculada** Sim, ou já salva alguma vez na janela da escala em Viagens |
|---|---|---|
| {{Administrativo}} | A escala sai da Viagem e do Line Up. | Só a data sai. |
| Demais equipes | Só a data sai. A escala continua na Viagem, mas, sem B/L, datas ou exportação, deixa de aparecer no Line Up. | Só a data sai. |

Ao salvar, o {{Administrativo}} também tira escalas que já estavam sem data e sem nada ligado, nos portos marcados **Não escala**, mesmo sem ter mexido nelas.

Quando a escala está travada (por exemplo, ADR de Saída fechado no porto), o Vela recusa com "Escala … travada: …." e não grava nada da janela: nem a retirada, nem as outras datas.

::: sozinho
- Grava as datas só com o dia, sem hora: o ETD dos portos de origem e o ETA dos portos de chegada.
- Atualiza o quadro de Chegadas e Saídas e a ficha da Viagem no seu computador; o Portal mostra as datas novas na próxima leitura.
:::

::: conferir
Na linha do navio, em Chegadas e Saídas. Na ficha da Viagem, em **Viagens**, o ETA da escala é o mesmo que você salvou.
:::

::: aconteceu "Nenhuma alteração para salvar."
- **O que o sistema faz:** Não grava porque nenhuma data mudou.
- **O que você faz:** Confira se trocou a data no porto certo. Se não há o que mudar, clique em **Voltar**.
:::

::: aconteceu "Preciso corrigir o nome do navio, a viagem ou o IMO"
- **O que o sistema faz:** A janela da programação muda só datas ("Navio, viagem e IMO se corrigem em Viagens. Aqui só as datas.").
- **O que você faz:** Em **Viagens**, abra a Viagem e clique em **Editar** (capítulo 4).
:::

::: aconteceu "Marquei Não escala num porto que tinha data"
- **O que o sistema faz:** Pediu confirmação. Para o {{Administrativo}}, a escala sem nada ligado saiu da Viagem; com B/L descarregando, ATA, ATD, **Vinculada** Sim ou já salva na janela da escala, só a data saiu. Para as outras equipes, só a data saiu; a escala sem B/L, datas ou exportação deixa de aparecer no Line Up, mas continua na Viagem.
- **O que você faz:** Se o navio não vai mais àquele porto e já tem carga para ele, registre a omissão na Viagem ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)): a escala fica como **Omitida** e a carga segue para o porto de transbordo.
:::

::: aconteceu "Escala … travada: …."
- **O que o sistema faz:** Recusa tirar da Viagem a escala travada (por exemplo, ADR de Saída fechado no porto) e não grava nada da janela. A escala continua com a data, e as outras datas ficam como estavam.
- **O que você faz:** Se o navio não vai mais ao porto, registre a omissão ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)). Se a data só mudou, informe a nova data em vez de marcar **Não escala**.
:::

::: porque
Navio, viagem e IMO identificam a Viagem; corrigidos num lugar só, em Viagens, valem para tudo o que depende dela. E tirar uma escala da Viagem muda o planejamento: por isso só o Administrativo faz, e só quando nada ainda depende da escala.
:::

## 5.4 Confirmar a saída ou a chegada que já aconteceu

<!-- regras: VIA-104 VIA-109 VIA-110 VIA-128 -->

::: ficha
- **Quando usar:** A data está em âmbar em Chegadas e Saídas: a previsão passou e ninguém registrou a data efetiva.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Saiba a data em que o navio saiu da origem, ou a data e a hora em que ele chegou ao porto brasileiro. Só a célula em âmbar tem o botão de confirmar.
:::

### Confirmar a saída na origem

Em **Chegadas e Saídas**, clique no botão ao lado da data de saída em âmbar ([5.1](#51-acompanhar-a-programação-em-chegadas-e-saídas)). Abre a janela "Confirmar saída · COSCO SHIPPING SEREIA / 024E", que lembra a previsão do porto.

::: lado
1. Em **Data da saída**, confira a data. Ela já vem com a previsão; troque pela data em que o navio saiu. Só a data, sem hora.
2. Clique em **Confirmar saída**. Aparece "Data efetiva confirmada." e a célula passa a mostrar a data com ✓ verde.

::: tela confirmar-saida
A janela Confirmar saída, com a data sugerida pela previsão de Shanghai.
:::
:::

### Confirmar a chegada no Brasil

Na célula de chegada em âmbar, o botão abre a janela "Confirmar chegada · NAVIO / VOY". Ela pede **Data da chegada** e **Hora da chegada**; sem as duas, avisa "Informe a data e a hora da chegada.". Preencha e clique em **Confirmar chegada**. Aparece "Data efetiva confirmada.".

::: sozinho
- **Na saída:** a data passa a ser a saída efetiva (ATD) do porto de embarque (POL) da Viagem, mas provisória.
- O primeiro B/L com **Laden on Board** (a data de embarque que vem no B/L) diferente substitui a data confirmada. As duas datas vão para a **Linha do tempo** da Viagem.
- Se o **Laden on Board** for do mesmo dia, a data confirmada fica e deixa de ser provisória.
- A correção feita em **Viagens › Rotas e Manifestos**, no lápis de editar, vale mais que as duas ([4.6](04-viagens-escalas.md#46-rotas-e-manifestos)).
- **Na chegada:** grava o ATA da escala, com tudo o que um ATA faz ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)): a escala deixa de ser a Próxima escala, o Line Up mostra o ATA com ✓ na coluna ETA e passa a linha para "chegado", o alerta de ETA sem ATA fecha (e abre "ATA registrada; falta o ETB." se nenhuma atracação tem ETB), o Aviso de Chegada (NOR) fica devido e o ADR mostra o ATA na seção Escala.
- No Portal, o Cliente vê só a data efetiva com ✓.
:::

::: conferir
A célula mostra a data com ✓ verde. Na ficha da Viagem, a chegada aparece no ATA da escala. Se a Viagem já tem B/L desse porto de origem, a saída aparece em **Rotas e Manifestos**, na coluna **ATD no POL**.
:::

::: aconteceu "A data de saída confirmada não pode ser futura."
- **O que o sistema faz:** Recusa data depois de hoje, na saída e na chegada ("A data de chegada confirmada não pode ser futura.").
- **Por quê:** Data efetiva é o que já aconteceu.
- **O que você faz:** Se o navio ainda não saiu ou chegou, corrija a previsão em **Editar** ([5.3](#53-corrigir-as-datas-de-um-navio)).
:::

::: aconteceu "A saída de … já está registrada; corrija em Viagens → Rotas e Manifestos."
- **O que o sistema faz:** Recusa porque o porto de embarque já tem saída efetiva, registrada por outra pessoa ou vinda do B/L. Na chegada, o aviso é "A chegada em … já está registrada; corrija na escala, em Viagens.".
- **O que você faz:** Para corrigir a saída, use **Viagens › Rotas e Manifestos** ([4.6](04-viagens-escalas.md#46-rotas-e-manifestos)). Para corrigir a chegada, edite a escala na ficha da Viagem ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)).
:::

::: aconteceu "O porto … não tem saída programada nesta viagem."
- **O que o sistema faz:** Recusa confirmar num porto sem previsão. Na chegada, os avisos são "O porto … não tem chegada programada nesta viagem." e, para escala excluída ou omitida, "A escala de … foi removida ou omitida.".
- **O que você faz:** Reabra Chegadas e Saídas: outra pessoa pode ter mudado a programação. Se o porto deve ter data, informe a previsão em **Editar** ([5.3](#53-corrigir-as-datas-de-um-navio)); se a escala foi omitida, não há chegada a confirmar.
:::

::: aconteceu "Viagem cancelada é somente leitura."
- **O que o sistema faz:** Recusa confirmar a saída ou a chegada numa Viagem cancelada. Isso acontece quando outra pessoa cancelou a Viagem depois que você abriu a tela.
- **O que você faz:** Se a Viagem deve voltar, peça ao {{Administrativo}} para reativá-la ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)).
:::

::: porque
A saída efetiva da origem vem do B/L, pelo **Laden on Board**. A confirmação cobre o intervalo até o B/L chegar, e por isso é provisória. A chegada, ao contrário, é o próprio ATA da escala: confirmada aqui ou na ficha da Viagem, é a mesma data.
:::

## 5.5 Atualizar vários navios por planilha

<!-- regras: VIA-111 VIA-112 VIA-113 VIA-107 -->

::: ficha
- **Quando usar:** O armador mandou a programação de vários navios de uma vez.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Monte a planilha no modelo. Baixe **Modelo .xlsx** ou **Modelo .csv** na própria janela de importação. Uma linha por viagem. **VESSEL NAME** e **VOY** são obrigatórios; **IMO** e uma coluna por porto são opcionais (por exemplo, QINGDAO ETD e SALVADOR ETA). Datas em DD/MM/AAAA ou AAAA-MM-DD. O arquivo pode ser XLSX, XLS ou CSV, com até 10 MB.
:::

::: passos
1. Em **Chegadas e Saídas**, abaixo do quadro, no bloco "Atualizar várias viagens por planilha", clique em **Importar programação**. Abre a janela "Importar programação de navios".
:::

::: passos
2. Em **Planilha de programação**, clique em **Escolher arquivo** (ou arraste o arquivo para a área) e escolha a planilha. O Vela só lê o arquivo e monta a prévia: nada é gravado. Com um arquivo escolhido, o botão passa a ser **Trocar arquivo**.
3. Confira a **Prévia**: uma linha por viagem, com a **Situação** e as datas que mudam, no formato "PORTO ETA: antes → depois". No alto, a contagem de viagens novas, atualizadas, sem alteração e linhas com erro.
4. Clique em **Importar N viagens** (no exemplo, **Importar 2 viagens**). A etapa **Resultado** mostra **Viagens criadas** e **Viagens atualizadas**. Clique em **Concluir**.
:::

::: tela importar-programacao
A prévia do exemplo: a COSCO SHIPPING SEREIA será atualizada e a COSCO SHIPPING CORAL, criada.
:::

A **Situação** de cada viagem diz o que a gravação vai fazer:

| Situação | O que acontece ao importar |
|---|---|
| **Cria** | A Viagem não existe: o Vela cria e publica. |
| **Publica no Portal** | A Viagem existe, mas estava fora da programação: passa a aparecer. |
| **Atualiza** | As datas mostradas mudam. |
| **Sem alteração** | Nada muda nessa viagem. |
| **Erro** | A linha tem um problema, e nenhuma linha da planilha é importada. |

Como o Vela lê cada célula:

- Célula vazia ou com "X" deixa o porto como está. A planilha nunca cancela escala.
- O IMO só identifica o navio com 7 dígitos. "TBA" e parecidos são ignorados: a prévia avisa, e a viagem é procurada pelo nome do navio.
- A linha de exemplo do modelo, "EXEMPLO NAVIO", é ignorada.

::: sozinho
- Procura cada Viagem como em [5.2](#52-publicar-um-navio-na-programação): pelo número da viagem e pelo IMO; sem IMO, pelo nome do navio.
- Grava a planilha inteira numa só operação: ou tudo, ou nada.
- Cria cada Viagem nova uma vez só.
- Publica no Portal toda Viagem da planilha, inclusive a que estava fora da programação.
- O navio sem IMO, achado pelo nome, recebe o IMO que veio no arquivo.
- Um porto que tinha sido tirado da Viagem volta ao planejamento.
- Grava só o ETD e o ETA, e só a data, sem hora. A data no mesmo dia da que já está gravada não muda nada, nem a hora.
- Não muda o tipo da escala: a escala só de exportação continua só de exportação.
:::

::: conferir
No quadro de Chegadas e Saídas, logo depois de importar. Para cada Viagem criada, abra a ficha em **Viagens** e confira o armador e as escalas.
:::

A planilha traz só a data. Se a escala já tem o ETA com hora no mesmo dia, nada muda e a hora fica: no exemplo, Salvador e Vitória já têm o ETA com hora, a planilha traz os mesmos dias, e a prévia mostra só a mudança do ETD de Shanghai. Dia diferente grava a data nova, sem hora; confira a hora em **Viagens** depois de importar.

::: aconteceu "Com erro na planilha, nada é importado."
- **O que o sistema faz:** Lista os problemas abaixo da prévia, sob "N linhas com erro impedem a importação", e não deixa importar nenhuma linha. A data ilegível aparece só nessa lista ("…: data ilegível em SALVADOR ETA."); os outros erros também marcam **Erro** na coluna **Situação**. São erro: data ilegível; Viagem ambígua ("Viagem … ambígua: N candidatas. Informe o IMO."); Viagem cancelada ("Viagem … cancelada: a programação dela não muda. Retire a linha da planilha."); navio com dois cadastros ("Navio … ambíguo: mais de um cadastro. Corrija antes de importar."); IMO conflitante ("Navio … com IMO conflitante (… vs …). Corrija antes de importar."); o mesmo navio novo com IMOs diferentes no arquivo; a mesma Viagem e o mesmo porto em linhas com datas diferentes.
- **Por quê:** A planilha entra inteira ou não entra; assim a programação nunca fica pela metade.
- **O que você faz:** Corrija as linhas apontadas e escolha o arquivo de novo em **Trocar arquivo**.
:::

::: aconteceu "Não foi possível ler a planilha"
- **O que o sistema faz:** Recusa a planilha antes da prévia e não grava nada. Não lê a planilha que tem coluna repetida no cabeçalho, nem a que tem uma linha com dados mas sem **VESSEL NAME** ou **VOY**; nesse caso, o aviso diz o número da linha.
- **O que você faz:** Corrija o cabeçalho ou a linha e escolha o arquivo de novo.
:::

::: aconteceu "A programação da Viagem … mudou depois da prévia: … Confira a prévia de novo antes de gravar."
- **O que o sistema faz:** Outra pessoa mudou uma data da Viagem depois que a prévia foi montada. O Vela recusa a planilha inteira e não grava nada.
- **O que você faz:** Escolha o arquivo de novo para refazer a prévia, confira as datas e importe.
:::

::: aconteceu "Nada foi gravado: …"
- **O que o sistema faz:** A gravação falhou no meio, e o Vela desfez o arquivo inteiro. A prévia continua na janela.
- **O que você faz:** Leia o motivo depois de "Nada foi gravado:", resolva e clique de novo em **Importar N viagens**.
:::

::: aconteceu "A planilha não apagou a data de um porto"
- **O que o sistema faz:** Célula vazia ou "X" deixa o porto como está; a planilha nunca cancela escala.
- **O que você faz:** Para tirar a data de um porto, use **Editar** e marque **Não escala** ([5.3](#53-corrigir-as-datas-de-um-navio)).
:::

::: porque
Tudo ou nada evita a programação pela metade, com parte dos navios atualizada e parte não. E a planilha não cancela escala porque tirar um porto tem consequências (Line Up, B/Ls, CE Mercante); isso se decide porto a porto, com confirmação, em **Editar**.
:::

## 5.6 Tirar um navio da programação

<!-- regras: VIA-114 VIA-017 -->

Chegadas e Saídas não tem botão para tirar uma linha do quadro. A Viagem sai da programação, no Vela e no Portal, de um destes jeitos:

- Sozinha, quando a Viagem fica **Concluída**, no último ATD ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)).
- Antes disso, pela chave **Aparece em Chegadas e Saídas**, desligada na edição da Viagem (passos abaixo).
- Com **Cancelar viagem** ou **Excluir**, em **Viagens** ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)).

::: ficha
- **Quando usar:** O navio não deve mais aparecer para o Cliente, mas a Viagem continua valendo no Vela.
- **Quem faz:** {{Qualquer equipe}} desliga a chave. Cancelar e excluir a Viagem são do {{Administrativo}}.
- **Antes de começar:** Se o navio só deixou de ir a um porto, não tire a Viagem: marque **Não escala** naquele porto ([5.3](#53-corrigir-as-datas-de-um-navio)) ou registre a omissão ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)).
:::

::: passos
1. No menu, clique em **Viagens** e abra a Viagem.
2. Clique em **Editar**. Abre a janela "Editar Viagem".
3. Desligue a chave **Aparece em Chegadas e Saídas**.
4. Clique em **Salvar viagem**.
:::

::: sozinho
- Tira a Viagem do quadro de Chegadas e Saídas e do bloco **Chegadas e saídas** do Portal.
- Registra a mudança no Histórico da Viagem.
- A Viagem continua no Line Up do Painel, que não depende da chave ([5.7](#57-acompanhar-o-line-up-do-painel)).
:::

::: conferir
A linha some do quadro de Chegadas e Saídas. Para publicar de novo, ligue a chave na mesma janela.
:::

::: nao-faca
Não marque **Não escala** em todos os portos para "tirar" o navio. **Não escala** trata um porto por vez, e pelo menos um porto de chegada precisa de data ("Informe ao menos um porto de descarga com data.").
:::

::: porque
A programação é a própria Viagem. Ela sai quando a Viagem termina ou deixa de valer, ou quando alguém decide que o Cliente não deve vê-la.
:::

## 5.7 Acompanhar o Line Up do Painel

<!-- regras: ACE-031 VIA-116 VIA-117 VIA-118 VIA-119 VIA-120 VIA-121 VIA-122 VIA-126 -->

O **Line Up** é o quadro de trabalho das escalas: que navios estão atracados, quais chegam e quanta carga cada porto tem. Fica no **Painel**, abaixo dos cartões de alertas por setor. Diferente de Chegadas e Saídas, é só das equipes.

::: ficha
- **Quando usar:** Todo dia, para ver a situação dos navios e da carga por porto.
- **Quem faz:** {{Todas as equipes}}
- **Antes de começar:** No menu, clique em **Painel**. No alto ficam **Chegadas e Saídas** ("programação por porto"), **Tela TV** ("abre em outra janela") e **Exportar**; abaixo, os cartões de alertas por setor, os filtros e o bloco **Line Up**.
:::

::: passos
1. Para deixar o quadro num monitor, clique em **Tela TV**. Ele abre em outra janela ([5.8](#58-deixar-a-tela-tv-no-monitor)).
:::

::: passos
2. Para levar o quadro para uma planilha, clique em **Exportar**. A planilha traz as escalas que o Line Up está mostrando, com os filtros escolhidos (passo 3). Sem nenhuma linha, o botão fica desligado.
3. Para recortar o quadro, use os filtros. Em **Escalas**, escolha **Ativas** (o padrão), **Concluídas** ou **Todas**. Há também **Busca** (navio ou viagem), **Período** (**Qualquer** ou **Entre datas**, pelo ETA), **CEs** e, em **Mais filtros**, **Veículos**, **BB**, **MTY**, **RTW** e **Vinculada** (com ou sem). **Limpar filtros** volta ao padrão.
:::

::: tela painel-lineup
O Painel do exemplo: a COSCO SHIPPING ARIES atracada em Vitória (faixa verde), uma linha de exportação e Salvador Omitida no fim.
:::

### As colunas

| Coluna | O que mostra |
|---|---|
| **Navio**, **Viagem**, **POD** | O navio, o número da viagem e o porto da escala (POD, porto de descarga). |
| **Terminal** | As siglas dos terminais, na ordem das atracações. **TBC** é frente de operação ainda sem terminal. |
| **ETA** | A previsão de chegada. Com o ATA registrado, mostra o ATA com ✓. |
| **ETB** | A previsão de atracação. Com o ATB (a atracação efetiva), mostra o ATB com ✓. |
| **VIN**, **VIN CNTR**, **CG**, **Total** | Veículos, containers com veículos, carga geral e o total. |
| **MTY** | Vazios de importação da Viagem naquele porto. |
| **RTW** | Restow: containers descarregados e reembarcados no berço. |
| **BB** | Carga solta: máquinas / packages. |
| **CEs** | A situação de BLs e CEs da escala (por exemplo, **Aguardando**, **Lançando**, **Recebido**). Fica em âmbar em **Aguardando**. |
| **Vinculada** | Se o manifesto está vinculado à escala. Fica em âmbar em **Não**. |

- O âmbar aparece só em **CEs** Aguardando e **Vinculada** Não.
- A linha do navio atracado tem uma faixa verde à esquerda.
- Na linha de exportação, as colunas de carga aparecem em cinza, num texto só ("Exportação · Granito · N containers · N movimentos").
- Cada número abre a lista correspondente, já filtrada.
- Os números contam os contêineres pelo número, uma vez cada, e leem todos os B/Ls da Viagem.
- Numa tela estreita (abaixo de 640 px, como a de um celular), o quadro vira um cartão por escala.

### Quais escalas entram

- O Line Up lê as escalas das 60 Viagens cadastradas por último, ativas e concluídas. Viagem cancelada nunca entra.
- A faixa do alto mostra "N de M escalas". Os dois números contam linhas: a escala com importação e exportação conta duas. Com mais Viagens do que as carregadas, ela acrescenta " · X de Y viagens carregadas", e **Carregar mais viagens** amplia de 60 em 60, até 500.
- Há uma linha por escala e sentido. A escala que descarrega e embarca tem uma linha de importação e uma de exportação. As duas dividem o ETA e o ATA; ETB, ATB, ATD, terminal e Restow vêm das atracações das frentes de cada sentido. Sem terminal atribuído, o ATD é o da escala.
- Entram o porto de descarga dos B/Ls da Viagem e toda escala que já tem alguma coisa: uma data (ETA, ETB, ATA, ATB, ETD ou ATD), exportação declarada, **Vinculada** Sim ou **BLs e CEs** além de Aguardando.
- Escala só de exportação tem só a linha de exportação.

### Em que ordem

1. Navios atracados (com ATB e sem ATD), pelo ATB.
2. Navios que chegaram e ainda não atracaram (com ATA e sem ATB).
3. Navios previstos, pelo ETA.
4. Navios que já saíram, pelo ATD.
5. Por último, as escalas omitidas.

### Como os filtros funcionam

- **Escalas** filtra pelo status da Viagem, não da escala. Uma escala com ATD de uma Viagem ainda **Ativa** continua em **Ativas**.
- As linhas de exportação nunca somem pelos filtros.

::: sozinho
- Relê o Line Up a cada 90 segundos. Não há botão de atualizar.
- Não guarda nada: o Line Up, o Painel e a Tela TV só leem as Viagens, as escalas, as atracações, os B/Ls, os contêineres, os veículos e os vazios.
- Tira do Line Up e da Tela TV a Viagem cancelada; se ela for reativada, volta. O quadro muda na próxima leitura. Não há filtro de canceladas.
- Conta em **MTY** os vazios de importação da Viagem no próprio porto da linha. Vazio cujo porto não tem linha, ou sem porto, não vai para outro porto: aparece abaixo do quadro.
:::

::: conferir
Na faixa do alto do bloco, a contagem "N de M escalas" diz quantas linhas os filtros estão mostrando.
:::

::: aconteceu "A Viagem não aparece no Line Up"
- **O que o sistema faz:** Lê só as escalas das 60 Viagens cadastradas por último e começa no filtro **Ativas**. Viagem cancelada nunca entra.
- **O que você faz:** Use **Carregar mais viagens** (até 500 Viagens), ou mude **Escalas** para **Concluídas** ou **Todas**. Confira também a **Busca** e o **Período**, ou use **Limpar filtros**.
:::

::: aconteceu "N vazios de importação sem escala no Line Up"
- **O que o sistema faz:** O vazio de um porto que não tem linha no Line Up, ou sem porto, não é contado em outro porto. Ele aparece abaixo do quadro, com o navio, a viagem e o porto, e um link para **Vazios IMP**.
- **O que você faz:** Abra o link e confira o porto do vazio. Se o porto está certo, confira a escala desse porto na Viagem ([4.2](04-viagens-escalas.md#42-planejar-as-escalas)).
:::

::: aconteceu "Nenhuma escala encontrada."
- **O que o sistema faz:** Nenhuma escala passa pelos filtros ("Ajuste os filtros ou aguarde o próximo ciclo de atualização.").
- **O que você faz:** Clique em **Limpar filtros**.
:::

::: aconteceu "Erro ao carregar o Line Up."
- **O que o sistema faz:** Não conseguiu ler o quadro. Nada foi alterado.
- **O que você faz:** Espere a próxima leitura, a cada 90 segundos.
:::

::: aconteceu "Falha ao exportar o Line Up."
- **O que o sistema faz:** Não conseguiu gerar a planilha. O quadro continua na tela.
- **O que você faz:** Clique em **Exportar** de novo.
:::

::: porque
O Line Up não tem dados próprios: é a leitura das Viagens. Por isso não há o que gravar nele, e o que você corrige na Viagem aparece no quadro na leitura seguinte.
:::

## 5.8 Deixar a Tela TV no monitor

<!-- regras: VIA-123 VIA-124 VIA-125 -->

A **Tela TV** é o Line Up feito para um monitor da sala: letras grandes, sem filtros, e o quadro anda sozinho.

::: ficha
- **Quando usar:** Para deixar as escalas à vista de todos num monitor.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** O monitor precisa de um computador com o Vela aberto por um usuário interno. A Tela TV não está no menu: ela abre pelo **Painel**.
:::

::: passos
1. No computador do monitor, entre no Vela e abra o **Painel**.
2. Clique em **Tela TV**. O quadro abre em outra janela e tenta ocupar a tela cheia.
:::

::: tela tela-tv
A Tela TV: no alto, Início do ciclo, Última alteração e Atualizado às; a COSCO SHIPPING ARIES, atracada, abre o ciclo.
:::

### O que a TV mostra

- As escalas que ainda não têm ATD. As omitidas continuam visíveis.
- As colunas do Line Up, em inglês: Vessel, Voy, POD, Terminal, ETA, ETB, VIN, VIN CNTR, CG, Total, MTY, RTW, BB (MAQ, PACK e TOTAL), CEs e Linked (a **Vinculada**).
- Na TV, a coluna ETB mostra a previsão de atracação, não o ATB. A coluna ETA mostra o ATA em verde, sem ✓.
- Com mais de oito linhas, o quadro desliza uma linha a cada 3 segundos. Com menos, completa com linhas vazias.
- Numa tela de até 1.024 px de largura, o quadro vira cartões fixos.
- Uma borda separa a última escala da primeira, que é o início do ciclo. A borda acompanha o quadro enquanto ele desliza.
- No cabeçalho: **Início do ciclo** (o ATA, ou o ETA, da primeira escala), **Última alteração** (a mais recente entre as informações que a TV lê) e **Atualizado às** (a hora em que a TV recebeu o quadro com alguma mudança; sem mudança, a hora fica parada, e isso não é falha).

::: sozinho
- Relê o quadro a cada 30 segundos. Só busca tudo de novo quando algo mudou, e aí a hora de **Atualizado às** pisca em verde.
- Usa a sessão de quem a abriu. Pela regra de inatividade do Vela, depois de 8 horas sem ninguém mexer no mouse ou no teclado, a sessão termina e a TV volta à tela de login, antes do limite de 12 horas da sessão.
- Se uma leitura falha com o quadro na tela, mantém o último quadro e troca **Atualizado às** por **Sem atualização desde**.
:::

::: conferir
No cabeçalho, se aparecer **Sem atualização desde** no lugar de **Atualizado às**, a TV parou de se atualizar.
:::

::: aconteceu "A Tela TV voltou à tela de login"
- **O que o sistema faz:** Encerrou a sessão depois de 8 horas sem ninguém mexer no mouse ou no teclado.
- **Por quê:** É a regra de inatividade do Vela, que vale também para a TV.
- **O que você faz:** Entre de novo com o usuário da TV e abra **Tela TV** pelo **Painel**.
:::

::: aconteceu "Sem atualização desde"
- **O que o sistema faz:** A última leitura falhou. A TV mantém o quadro que tinha e mostra desde quando ele não se atualiza.
- **O que você faz:** Espere a próxima leitura. Se o aviso continuar, confira a conexão do computador da TV.
:::

::: aconteceu "Falha ao carregar o quadro da TV."
- **O que o sistema faz:** Não conseguiu montar o quadro na primeira leitura e tenta de novo sozinho.
- **O que você faz:** Espere a nova tentativa.
:::

::: aconteceu "Página não encontrada"
- **O que o sistema faz:** O endereço da TV termina em "/display". Sem esse final, o Vela mostra "Página não encontrada".
- **O que você faz:** Abra a TV pelo botão **Tela TV** do **Painel**.
:::

::: porque
A TV é o mesmo Line Up, sem filtros e só com as escalas que ainda não terminaram (sem ATD): é o quadro do que a equipe ainda tem pela frente. Como ela usa a sessão de uma pessoa, segue a mesma regra de inatividade de qualquer sessão do Vela.
:::

## 5.9 Cadastros de apoio: navios, armadores, portos e terminais

<!-- regras: ACE-094 VIA-135 VIA-136 VIA-137 VIA-138 EQU-099 EQU-100 EQU-102 -->

Navios, armadores, portos e terminais são cadastros de apoio: as Viagens dependem deles, mas só os terminais têm tela própria.

::: ficha
- **Quando usar:** Um nome de navio, armador, porto ou terminal está errado, ou falta um terminal para escolher na escala.
- **Quem faz:** {{Qualquer equipe}} cria e edita navio, armador, porto, Local e serviço. Só o {{Administrativo}} desativa ou reativa um Local, terminal ou serviço.
- **Antes de começar:** Saiba em qual Viagem o nome aparece errado; é por ela que navio e armador se corrigem.
:::

### Navios e armadores

Navios e armadores não têm tela nem exclusão. Eles nascem e mudam pela **Nova Viagem** e pelo **Editar** da Viagem ([4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)), por Chegadas e Saídas ([5.2](#52-publicar-um-navio-na-programação)) e pela planilha de programação ([5.5](#55-atualizar-vários-navios-por-planilha)). Qualquer usuário ativo faz isso.

- O cadastro é único. O armador corrigido numa Viagem vale para todas as Viagens do mesmo navio.
- O nome cadastrado do navio não muda pela edição de uma Viagem. O navio achado pelo IMO mantém o nome que já tinha.

### Portos

Portos não têm tela nem exclusão.

- O porto brasileiro nasce sozinho na primeira escala salva com o código dele. O nome fica igual ao código. Os portos conhecidos já têm nome.
- O Vela lê grafias e nomes diferentes do mesmo porto como um porto só: Vitória como BRVIT ou BRVIX; Sepetiba e Itaguaí como BRIGI; Ningbo e Zhoushan; Guangzhou em Nansha.
- Portos vizinhos com código próprio continuam separados: Navegantes e Itajaí, Recife e Suape.

### Terminais e depots: a tela Locais

Os terminais são os Locais do tipo **Terminal portuário**, sempre ligados a um porto. Eles ficam na mesma tela dos depots.

::: passos
1. No menu, em **Exportação**, clique em **Vazios EXP**. Abre o **Embarque de vazios**.
2. Clique em **Locais (depots e terminais)**.
:::

::: tela locais
A tela Locais: à esquerda, a lista dos locais; à direita, o Cadastro do local aberto e os Serviços do catálogo.
:::

- À esquerda, a lista dos locais, com quantos estão ativos. **Mostrar os inativos (N)** mostra também os inativos, em cinza.
- À direita, o bloco **Cadastro** do local aberto: nome, tipo e situação, **Código**, o **Porto** (no terminal) ou os free times (no depot) e **Serviços ativos**. Abaixo, os **Serviços do catálogo**.
- O endereço da página guarda o local aberto.
- **Voltar ao Embarque** volta à lista de embarques.

Os dois tipos de local:

| | **Depot** | **Terminal portuário** |
|---|---|---|
| Para que serve | Armazena o vazio antes do embarque. | É o terminal da escala (por exemplo, TVV). |
| Porto | Não tem. | Exige **Porto brasileiro**. |
| Free time | **Free time vazio** e **Free time com material**, em dias, nunca negativos. | Não tem. |
| Armazenagem | Gera. | Não gera, mas cobra serviços. |

Onde os terminais aparecem:

- Os terminais deste cadastro são os terminais das escalas, dos B/Ls e dos ADRs de Saída.
- O terminal escolhido tem de ser do porto daquela escala, ou do POD do B/L.
- Terminal desativado não é oferecido para operação nova, mas continua visível onde já está, com "(inativo · histórico)". Ele continua no histórico das escalas, mas não recebe nova atribuição.

### Feriados

Feriados não têm tela. O calendário de feriados de Vitória/ES é cadastrado pela equipe técnica e só serve aos prazos das cobranças Pix Itaú da Demurrage. A partir de 1º de novembro, sem os feriados do ano seguinte cadastrados, aparece o alerta "Calendário de feriados pendente"; avise a equipe técnica. O prazo do ADR de Saída não usa feriado: são 72 horas corridas.

::: conferir
Na escala da Viagem ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)), o terminal ativo do porto aparece para escolher. Em Locais, o terminal mostra o **Porto** no bloco **Cadastro**.
:::

::: aconteceu "Não acho a tela de navios, armadores ou portos"
- **O que o sistema faz:** Não há tela própria nem exclusão. Navio e armador nascem e mudam pela Viagem, por Chegadas e Saídas e pela planilha; o porto brasileiro nasce na primeira escala, com o código como nome.
- **O que você faz:** Corrija pela edição da Viagem, em **Viagens** ([4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)).
:::

::: aconteceu "O terminal não aparece para escolher na escala"
- **O que o sistema faz:** A escala só oferece os terminais portuários ativos do porto dela.
- **O que você faz:** Em **Locais (depots e terminais)**, confira se o local é **Terminal portuário**, se o **Porto** é o da escala e se ele está ativo (ligue **Mostrar os inativos (N)** para ver os desativados). Se precisa reativar, peça ao {{Administrativo}}.
:::

::: aconteceu "Há N terminais antigos sem porto brasileiro: … Escolha o porto de cada um em Editar."
- **O que o sistema faz:** Avisa os terminais antigos ainda sem porto. Sem porto, eles não servem a nenhuma escala.
- **O que você faz:** Abra cada terminal da lista, clique em **Editar** e escolha o **Porto brasileiro**.
:::

::: aconteceu "Somente o Administrativo desativa ou reativa o cadastro."
- **O que o sistema faz:** Recusa quando outra equipe tenta desativar ou reativar um Local, terminal ou serviço. Cadastrar um já desativado também é só do Administrativo ("Somente o Administrativo cadastra o cadastro desativado.").
- **O que você faz:** Peça ao {{Administrativo}}.
:::

::: aconteceu "O local deste endereço não existe mais (excluído ou link antigo)."
- **O que o sistema faz:** O endereço aponta para um local que foi excluído.
- **O que você faz:** Escolha o local na lista da esquerda.
:::

::: porque
Cadastro único evita o mesmo navio, armador ou porto com dois nomes, e cada um aparece igual em todas as Viagens. O terminal desativado continua no histórico porque as escalas antigas precisam continuar dizendo onde o navio atracou.
:::

## 5.10 Situações comuns

<!-- regras: VIA-116 VIA-123 VIA-028 VIA-107 VIA-122 -->

::: aconteceu "Gravei e o Line Up (ou a Tela TV) ainda não mudou"
- **O que o sistema faz:** O Painel relê o Line Up a cada 90 segundos, e a Tela TV, a cada 30. As telas não se sincronizam entre pessoas: a gravação atualiza a tela de quem gravou; nas outras, a tela se atualiza quando é reaberta.
- **O que você faz:** Espere a próxima leitura. Em outra tela aberta, reabra a página.
:::

::: aconteceu "Mudei a data numa tela; preciso mudar nas outras?"
- **O que o sistema faz:** Não há datas separadas. O ETA gravado em Chegadas e Saídas é o mesmo da escala na ficha da Viagem, e o Line Up, a Tela TV e o Portal só leem essa data.
- **O que você faz:** Nada. Grave a data uma vez, em Viagens ou em Chegadas e Saídas, e confira as outras telas na próxima leitura.
:::
