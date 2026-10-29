Cada container cheio descarregado no Brasil tem duas datas que importam: a **descarga**, quando ele sai do navio no terminal, e a **devolução**, quando o Cliente entrega o container vazio de volta ao armador. Entre as duas corre o **free time**, os dias que o Cliente tem sem pagar nada. Passou disso, cada dia a mais é **Demurrage**, cobrada do Cliente em dólar numa Invoice de Demurrage. {{Equipamentos}} grava as datas; o Vela conta os dias, emite a Invoice e cobra. O câmbio, o desconto, o pagamento e a Régua de Cobrança estão no capítulo 23.

::: aprende
- achar um container na lista **Containers**;
- gravar a descarga e a devolução, uma a uma ou por planilha;
- ler a situação de Demurrage de cada container;
- saber quando a Invoice de Demurrage sai e o que a segura;
- cadastrar a tarifa, o acordo do Cliente e a condição de um B/L;
- responder e decidir a Disputa do Cliente.
:::

## 9.1 Encontrar um container

**Quem faz:** {{Todas as equipes}} · excluir container: {{Administrativo}}

**Containers**, no menu **Importação**, lista os containers de todos os B/Ls importados, um por linha e por B/L, do mais recente para o mais antigo.

1. Escolha a Viagem na faixa do alto ou no filtro **Viagem**.
2. Em **Buscar**, digite o container, o lacre, o B/L, o Cliente ou o navio. **Mais filtros** separa por perfil (IMO, OOG), veículos, Revisão e situação financeira do B/L.
3. Clique no B/L da linha para abrir a ficha.

::: tela containers-lista
A lista Containers, com os containers da COSCO SHIPPING SEREIA / 024E no alto.
:::

Os cartões do alto contam o recorte: **Containers**, **B/Ls**, **IMO** e **OOG**. O container que está em dois B/Ls da mesma Viagem (o Part Lot, [7.3](07-ficha-do-bl.md#73-corrigir-um-container)) aparece nas duas linhas e conta uma vez.

A coluna **SOC/COC** diz de quem é o container: **SOC** é do Cliente, **COC** é do armador. Sem a informação, o container é tratado como COC.

O {{Administrativo}} exclui o container importado por engano: marca a caixa da linha e usa **Excluir selecionados**, com motivo. Os veículos dentro dele saem junto.

::: atencao
- A planilha que **Exportar** baixa não traz as datas de descarga e devolução. Para conferir datas, use a lista ou a página **Demurrage**.
:::

## 9.2 Gravar a descarga e a devolução

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

A descarga vem do terminal, e nada a preenche sozinho: nem a chegada do navio, nem o Baplie, nem o arquivo do B/L. Enquanto falta a descarga, a Demurrage não corre; enquanto falta a devolução, ela corre até hoje.

A data é do container físico: gravada num B/L, ela vale para todos os B/Ls ativos da Viagem que dividem o container. Há quatro caminhos, e todos chegam ao mesmo lugar:

| Caminho | Use para |
|---|---|
| **Importar datas**, em **Containers** ou em **Demurrage** | Muitos containers de uma vez, pela planilha do terminal ([9.3](#93-importar-as-datas-por-planilha)). |
| Ficha do B/L, aba **Faturamento**, bloco **Demurrage** | A devolução de um container: digite a data na coluna **Devolução** e clique no ícone de salvar ao lado. |
| Ficha do B/L, aba **Carga**, **Corrigir** | Descarga e devolução de um container, com justificativa ([7.3](07-ficha-do-bl.md#73-corrigir-um-container)). |
| **Demurrage**, aba **Containers**, **Editar datas** | Container que já está em atraso, devolvido com Demurrage ou numa Invoice ([9.5](#95-acompanhar-a-demurrage-dos-containers)). |

A devolução não pode ser anterior à descarga, e não se grava devolução sem descarga. A data nova chega ao Portal e pode emitir ou reemitir a Invoice ([18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container)).

::: atencao
- Para trocar ou apagar uma data gravada, veja [7.3](07-ficha-do-bl.md#73-corrigir-um-container).
- Para o container que entra depois num B/L da Viagem, veja [18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container).
- Na ficha de um B/L cancelado, as datas do container ficam só para leitura. Para corrigi-las, use um B/L ativo que divide o container.
:::

## 9.3 Importar as datas por planilha

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

1. Em **Containers** ou em **Demurrage**, clique em **Importar datas**.
2. Escolha o arquivo (.xlsx, .xls ou .csv) com as colunas **B/L**, **Container**, **Descarga** e, se houver, **Devolução**. O modelo está na janela.
3. Confira a prévia. Cada linha diz **Grava** (data onde não havia), **Atualiza** (troca uma data gravada, em âmbar) ou **Sem alteração**.
4. Clique em **Importar N containers**.

As datas vão em DD/MM/AAAA ou AAAA-MM-DD. Devolução em branco mantém a data gravada: a planilha nunca apaga data.

A planilha grava tudo ou nada. Um erro na prévia impede a importação inteira: baixe a lista de erros, corrija o arquivo e escolha-o de novo.

## 9.4 Ler a situação de Demurrage

**Quem faz:** {{Todas as equipes}}

O free time conta em dias a partir da descarga. Ele sai, nesta ordem, da condição do B/L, do acordo do Cliente vigente na data da descarga ou da tarifa do tipo de container ([9.7](#97-cadastrar-tarifas-e-acordos-de-demurrage)). Passado o free time, a Demurrage cobra uma diária em dólar, que sobe a partir de certo dia: são o 1º e o 2º período da tarifa.

Cada container tem uma situação, que aparece na coluna **Demurrage** da aba **Carga** da ficha do B/L:

| Situação | Quer dizer |
|---|---|
| **No free time** | Descarregado e dentro do prazo. Sem descarga, a coluna mostra um traço. |
| **Em atraso** (âmbar) | Sem devolução e com mais dias desde a descarga do que o free time. A Demurrage está correndo. |
| **Devolvido** | Tem devolução. A conta do container fechou. |
| **Não se aplica (SOC)** | Container do Cliente: não volta ao armador e não tem Demurrage. |

Um exemplo: com free time de 21 dias, um container descarregado em 1º de outubro fica **Em atraso** a partir de 23 de outubro. Devolvido em 25 de outubro, ele ficou 24 dias fora e paga 3 dias de Demurrage.

Gravar uma data refaz a situação na hora; a virada do dia fica com a rotina da madrugada ([19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio)). Quando há containers em atraso, a faixa do alto de todas as telas mostra **N containers em atraso**, e o clique abre a página **Demurrage** nesse recorte.

Na aba **Faturamento** da ficha, o bloco **Demurrage** mostra o valor de cada container; passe o mouse no valor para ver cada período.

::: atencao
- Mudar a tarifa, o acordo ou a condição do B/L não muda na hora a marca **Em atraso** dos containers ainda fora: ela se acerta na rotina da madrugada. Os valores previstos já saem com a condição nova.
- Tipo de container sem tarifa não tem Demurrage calculada e segura a Invoice do grupo inteiro: o bloco **Demurrage** da ficha diz "Demurrage não calculada" e mostra na linha que o tipo está sem tarifa. Cadastre a tarifa ([9.7](#97-cadastrar-tarifas-e-acordos-de-demurrage)).
:::

## 9.5 Acompanhar a Demurrage dos containers

**Quem faz:** {{Equipamentos}}

A página **Demurrage**, no menu **Financeiro**, é onde você acompanha os containers até a cobrança. A aba **Containers** mostra só o que interessa à cobrança: containers em atraso, devolvidos com Demurrage e já cobrados numa Invoice. O container devolvido dentro do free time não aparece.

1. Clique no cartão **Containers em atraso** ou escolha o recorte **Em atraso**. A busca aceita container, B/L, Cliente ou número da Invoice.
2. Cada linha é um B/L. Leia a **Situação**: "Aguarda devolução de N containers", **A faturar**, a Invoice que já cobra o B/L ou "Nada a cobrar".
3. Clique na seta da linha para ver os containers.
4. Para corrigir a data de um container, clique no ícone de calendário, **Editar datas**, na linha dele.

O valor em US$ da lista é uma previsão refeita hoje. No container já cobrado aparece "cobrada em DEM-…", e o que vale é o valor da Invoice. O B/L que paga junto com outro mostra "Cobrança junto com o B/L …" ([9.6](#96-saber-quando-a-invoice-de-demurrage-sai)).

## 9.6 Saber quando a Invoice de Demurrage sai

**Quem faz:** o Vela, sozinho · **Gerar Invoice**: {{Qualquer equipe}}

A Invoice de Demurrage cobra de uma vez um **grupo**: os B/Ls ativos da mesma Viagem e do mesmo Cliente que dividem algum container. O B/L que não divide container com nenhum outro é um grupo sozinho. A Invoice sai pelo B/L de menor número do grupo.

Ela sai quando três coisas se juntam:

- todos os containers do grupo, menos os SOC, foram devolvidos;
- algum deles passou do free time;
- o B/L tem CE Mercante e o Portal do Cliente está pronto para faturar, ou o Cliente tem a Liberação de faturamento sem Portal (capítulos 13 e 14).

Com isso, a Invoice sai sozinha logo depois da última devolução gravada ([18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container)). Ela nasce emitida, em dólar, com o valor em reais pelo câmbio do dia (ou pelo ROE manual do B/L); o Cliente a vê no Portal e a Régua de Cobrança começa (capítulo 23). O container devolvido no free time entra nela com valor zero.

Por exemplo, o CSC45810A01K00 tem dois containers, CSNU2401018 e CSNU2401023. Se o primeiro voltou em atraso e o segundo ainda está fora, a linha do B/L diz "Aguarda devolução de 1 container" e nada é cobrado até o segundo voltar.

Se o B/L fica em **A faturar** e a Invoice não aparece, clique no ícone **Gerar Invoice** no fim da linha dele: ou a Invoice sai, ou a recusa diz o que falta, em geral o CE Mercante ou o Portal do Cliente. A recusa fica na linha até você editar as datas ou sair da página.

Cada container é cobrado uma vez. Se um container novo entra no grupo depois da Invoice, ele vai numa **Invoice complementar**, só com ele (o ícone passa a ser **Gerar Invoice complementar**).

::: atencao
- Uma devolução que falta segura a Invoice do grupo inteiro, inclusive dos containers que já voltaram em atraso. Cobre do Cliente a devolução que falta, ou grave a data se ela já aconteceu.
- B/L sem Cliente, B/L cancelado e Viagem cancelada não recebem Invoice de Demurrage.
:::

## 9.7 Cadastrar tarifas e acordos de Demurrage

**Quem faz:** {{Qualquer equipe}} · desativar, reativar e excluir tarifa e acordo: {{Administrativo}}

O free time e as diárias vêm de três lugares, e vale o primeiro que existir para o container:

| De onde | Vale para | Onde se cadastra |
|---|---|---|
| Condição do B/L | Os containers de um B/L só | Ficha do B/L, aba **Faturamento**, **Definir condição do B/L** |
| Acordo do Cliente | Os containers do Cliente descarregados dentro da vigência | **Demurrage** › **Tarifas e acordos** › **Acordos de Clientes** |
| Tarifa do tipo de container | Todos os outros | **Demurrage** › **Tarifas e acordos**, primeira aba, **Nova tarifa** |

### O acordo do Cliente

1. Em **Demurrage**, clique em **Tarifas e acordos** e abra **Acordos de Clientes**.
2. Clique em **Novo acordo** e escolha o Cliente.
3. Preencha **Free Time (dias)** e **Vigência de**. **Tarifa P1** e **Tarifa P2** são as diárias em dólar dos dois períodos; em branco, valem as da tarifa.
4. Clique em **Cadastrar acordo** e confirme.

O acordo vale pela data de descarga: mesmo encerrado, ele continua valendo para os containers descarregados dentro da vigência dele. O Cliente não pode ter dois acordos ativos com vigências que se cruzam: para trocar as condições, preencha a **Vigência até** do acordo atual antes de cadastrar o novo.

### A condição de um B/L

Use quando uma negociação vale só para um B/L. Na ficha, aba **Faturamento**, bloco **Condições de Demurrage deste B/L**, **Definir condição do B/L** abre **Free time (dias)**, **Tarifa P1 (USD/dia)** e **Tarifa P2 (USD/dia)**; o campo em branco volta ao acordo ou à tarifa. O B/L cancelado não oferece **Definir condição do B/L**.

### A tarifa

**Nova tarifa** cadastra, para um tipo de container, o free time, os dias de cada período, as duas diárias e a vigência. Tipos equivalentes usam a mesma tarifa: 40HC e 45G1 usam a do 40GP, por exemplo. Com duas tarifas do mesmo tipo vigentes no mesmo dia, vale a de vigência mais recente. A tarifa que vale é a vigente no dia do cálculo, não na descarga: uma tarifa nova alcança todos os containers ainda sem Invoice.

::: atencao
- Tarifa, acordo e condição valem para as Invoices novas. A Invoice já emitida não muda.
- Para parar de usar uma tarifa ou um acordo que já entrou em vigor, peça ao {{Administrativo}} que o desative. Só se exclui o que ainda não entrou em vigor.
:::

## 9.8 Responder a uma Disputa

**Quem faz:** {{Equipamentos}} e {{Administrativo}} · ler: {{Todas as equipes}}

A **Disputa** é a contestação de uma Invoice de Demurrage pelo Cliente. Só o Cliente a abre, pelo Portal ([15.6](15-portal-o-que-o-cliente-ve.md#156-a-demurrage-e-a-disputa)). Aberta, ela abre um alerta para {{Equipamentos}} (capítulo 20), a Invoice passa a **Em disputa** e a Régua de Cobrança daquela Invoice para.

1. Em **Demurrage**, clique no cartão **Disputas aguardando resposta** ou abra a aba **Disputas**. As que esperam por você vêm primeiro, marcadas "Aguarda a nossa resposta".
2. Leia a conversa. O número da Invoice abre o detalhe dela.
3. Escreva a **Resposta ao Cliente** e, se precisar, anexe um arquivo (PDF, JPG, PNG ou TXT, até 10 MB).
4. Em **Depois de enviar**, escolha **Aguardar Cliente** só se espera resposta dele: enquanto a vez é do Cliente, o Vela não aceita outra resposta sua e você não consegue encerrar a Disputa. **Encerrar pendência (Ninguém)** resolve a Disputa ([9.9](#99-decidir-a-disputa)).
5. Clique em **Enviar resposta** e confirme.

## 9.9 Decidir a Disputa

**Quem faz:** {{Equipamentos}} e {{Administrativo}} · cancelar a Invoice: {{Administrativo}}

Decidir é responder ao Cliente com a conclusão e escolher **Encerrar pendência (Ninguém)**. A Disputa fica **Resolvida** e a Régua de Cobrança volta a cobrar a Invoice em aberto. O que fazer antes depende do que o Cliente contesta:

| O Cliente tem razão em | O que fazer |
|---|---|
| Nada: a cobrança está certa | Responda explicando a conta e encerre a pendência. |
| Uma data de descarga ou de devolução | Encerre a Disputa primeiro e corrija a data depois (abaixo). |
| O valor, por um acerto comercial | O desconto é dado no detalhe da Invoice (capítulo 23). Depois, responda e encerre. |

### Quando a data estava errada

Com a Disputa aberta, corrigir a data não reemite a Invoice: ela sai da Régua e abre um alerta para o {{Administrativo}}. Por isso a ordem importa:

1. Responda ao Cliente que a data será corrigida e escolha **Encerrar pendência (Ninguém)**.
2. Corrija a data ([9.2](#92-gravar-a-descarga-e-a-devolução)).
3. Sem pagamento nem desconto, o Vela cancela e reemite a Invoice ([18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container)).

Se a data já foi corrigida com a Disputa aberta, o detalhe da Invoice diz "Fora da Régua". Aí o {{Administrativo}} cancela a Invoice e alguém clica em **Gerar Invoice** na aba **Containers**.

### Reabrir

Se o Cliente pede a reabertura pelo Portal, o pedido chega como mensagem na conversa, com um alerta. Para atender, escreva a **Justificativa da reabertura** e clique em **Reabrir Disputa**: a Disputa volta aberta, esperando a nossa resposta, e a Régua pausa de novo. A justificativa também aparece para o Cliente.

::: atencao
Cancelar a Invoice não encerra a Disputa, e o Cliente não escreve mais nela: encerre a pendência antes de cancelar.
:::
