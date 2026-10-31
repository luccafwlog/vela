Cada container cheio descarregado no Brasil tem duas datas que importam: a **descarga**, quando ele sai do navio no terminal, e a **devolução**, quando o Cliente entrega o container vazio de volta ao armador. Entre as duas corre o **free time**, os dias que o Cliente tem sem pagar nada. Passou disso, cada dia a mais é **Demurrage**, cobrada do Cliente em dólar numa Invoice de Demurrage. {{Equipamentos}} grava as datas; o Vela conta os dias, emite a Invoice e cobra. O câmbio, o desconto, o pagamento e a Régua de Cobrança estão no capítulo 23.

::: aprende
- achar um container na lista **Containers**;
- gravar a descarga e a devolução, uma a uma ou por planilha;
- ler a situação de Demurrage de cada container e as divisões da página **Demurrage**;
- saber quando a Invoice de Demurrage sai e o que a segura;
- cadastrar a tarifa, o acordo do Cliente, a condição de um B/L e um tipo de container;
- responder e decidir a Disputa do Cliente;
- dispensar a cobrança de um container.
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
| **Demurrage**, aba **Containers**, **Editar datas** | Os containers de um grupo com Demurrage ainda sem Invoice ([9.5](#95-acompanhar-a-demurrage-dos-containers)). |

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

O free time conta em dias a partir da descarga. Ele sai, nesta ordem, da condição do B/L, do acordo do Cliente vigente na data da descarga ou da tarifa do grupo do tipo de container ([9.7](#97-cadastrar-tarifas-e-acordos-de-demurrage)). Passado o free time, a Demurrage cobra uma diária em dólar, que sobe a partir de certo dia: são o 1º e o 2º período da tarifa.

Cada container tem uma situação, que aparece na coluna **Demurrage** da aba **Carga** da ficha do B/L:

| Situação | Quer dizer |
|---|---|
| **No free time** | Descarregado e dentro do prazo. Sem descarga, a coluna mostra um traço. |
| **Em atraso** (âmbar) | Sem devolução e com mais dias desde a descarga do que o free time. A Demurrage está correndo. |
| **Devolvido** | Tem devolução. A conta do container fechou. |
| **Não se aplica (SOC)** | Container do Cliente: não volta ao armador e não tem Demurrage. |

Um exemplo: com free time de 21 dias, um container descarregado em 1º de outubro fica **Em atraso** a partir de 23 de outubro. Devolvido em 25 de outubro, ele ficou 24 dias fora e paga 3 dias de Demurrage.

Gravar uma data refaz a situação na hora, e mudar o free time também: a condição do B/L, o acordo, a tarifa, o Cliente do B/L ou o cadastro de tipos. A virada do dia fica com a rotina da madrugada ([19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio)). A faixa do alto de todas as telas mostra **N containers em atraso**, os mesmos que o cartão **Correndo (US$)** da página **Demurrage** conta ([9.5](#95-acompanhar-a-demurrage-dos-containers)); o clique abre a página nessa divisão.

Na aba **Faturamento** da ficha, o bloco **Demurrage** soma o que está a emitir (container devolvido, ainda sem Invoice) e o que está correndo (ainda fora), e mostra o valor de cada container, "a faturar" ou "em curso"; passe o mouse no valor para ver cada período. O container já cobrado mostra a Invoice; o dispensado, "Cobrança dispensada" ([9.11](#911-dispensar-a-cobrança-de-um-container)); o dividido com outro Cliente, a parte deste, como "1/2 da caixa" ([9.6](#96-saber-quando-a-invoice-de-demurrage-sai)).

::: atencao
- Tipo de container fora do cadastro **Tipos de container**, desativado ou sem tarifa no grupo não tem Demurrage calculada e segura a Invoice do grupo inteiro. O bloco **Demurrage** da ficha diz "Demurrage não calculada", a linha diz que o tipo está sem tarifa, e na página **Demurrage** o grupo vai para **Travado** até o tipo ou a tarifa ser cadastrado ([9.10](#910-cadastrar-um-tipo-de-container)).
:::

## 9.5 Acompanhar a Demurrage dos containers

**Quem faz:** {{Equipamentos}}

A página **Demurrage**, no menu **Financeiro**, é onde você acompanha os containers até a cobrança. A aba **Containers** mostra só os grupos de B/L ([9.6](#96-saber-quando-a-invoice-de-demurrage-sai)) com Demurrage ainda sem Invoice, cada um numa de quatro divisões. O grupo devolvido todo no free time não aparece, e o grupo sai da aba quando a Invoice que o cobra é emitida.

| Divisão | Quer dizer | O que fazer |
|---|---|---|
| **Correndo** | Algum container do grupo está fora e já passou do free time. | Cobre a devolução do Cliente: a Invoice sai quando todos voltarem. Em âmbar, a linha avisa o que vai segurar a Invoice, como a falta de CE. |
| **A emitir** | Todos voltaram e há Demurrage sem Invoice. | Em geral, nada: a Invoice sai sozinha ([9.6](#96-saber-quando-a-invoice-de-demurrage-sai)). Se a linha diz "Pronto para gerar a Invoice" ou "Invoice anterior DEM-… cancelada à mão: gere a nova", clique em **Gerar Invoice**. |
| **Esperando** | Um container voltou com Demurrage, e outro do grupo ainda está fora, no free time. | Espere a volta dele: a linha diz "Aguarda …", com o container e o último dia livre. |
| **Travado** | O Vela não tem como cobrar: tipo sem tarifa, B/L sem Cliente, B/L cancelado, sem CE Mercante ou com o Portal do Cliente segurando o faturamento. | Use o atalho da linha: **Cadastrar CE**, **Vincular Cliente**, **Abrir Cliente**, **Cadastrar tipo**, **Reativar tipo** ou **Cadastrar tarifa**. Abre um alerta para a equipe que destrava ([20.9](20-alertas.md#209-demurrage)). |

1. Clique no cartão **Correndo (US$)**, **A emitir (US$)** ou **Travado (US$)**, que somam o US$ previsto e contam os containers, ou escolha a divisão. A busca aceita container, B/L, Cliente, Navio / Viagem ou número da Invoice.
2. Cada linha é um grupo, no B/L que emite a Invoice ("+ N B/L do grupo" quando há outros). Leia o **Próximo passo / motivo**.
3. Clique na seta da linha para ver os containers, com as datas, os dias, o free time e o valor de cada um.
4. Para corrigir a data de um container, clique no ícone de calendário, **Editar datas**, na linha dele.

O **US$ previsto hoje** é uma previsão refeita hoje, com a mesma conta da Invoice. No container do grupo que já foi cobrado aparece "cobrada em DEM-…", que abre a Invoice. **Exportar** baixa a divisão aberta; o relatório completo fica em **Relatórios** ([23.2](23-demurrage-no-financeiro.md#232-achar-as-invoices-em-aberto-pagas-e-canceladas)).

## 9.6 Saber quando a Invoice de Demurrage sai

**Quem faz:** o Vela, sozinho · **Gerar Invoice**: {{Qualquer equipe}}

A Invoice de Demurrage cobra de uma vez um **grupo**: os B/Ls ativos da mesma Viagem e do mesmo Cliente que dividem algum container. O B/L que não divide container com nenhum outro é um grupo sozinho. A Invoice sai pelo B/L de menor número do grupo.

Ela sai quando três coisas se juntam:

- todos os containers do grupo, menos os SOC e os de cobrança dispensada, foram devolvidos;
- algum deles passou do free time;
- o B/L tem CE Mercante e o Portal do Cliente está pronto para faturar, ou o Cliente tem a Liberação de faturamento sem Portal (capítulos 13 e 14). Sem isso, o grupo fica em **Travado**, com o motivo; sem o Portal pronto, a etapa **Demurrage** do trilho da ficha do B/L também diz "Retida: …", com o link para o Provisionamento do Portal.

Com isso, a Invoice sai sozinha logo depois da última devolução gravada ([18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container)). Também sai sozinha, em até 15 minutos, quando a Demurrage aparece sem uma data nova: o free time do B/L, o acordo, a tarifa ou o tipo mudaram, ou uma dispensa foi desfeita. Com a emissão na fila, a linha em **A emitir** diz "Emissão automática em andamento". A Invoice nasce emitida, em dólar, com o valor em reais pelo câmbio do dia (ou pelo ROE manual do B/L); o Cliente a vê no Portal e a Régua de Cobrança começa (capítulo 23). O container devolvido no free time entra nela com valor zero.

Por exemplo, o CSC45810A01K00 tem dois containers, CSNU2401018 e CSNU2401023. Se o primeiro voltou em atraso e o segundo ainda está fora, no free time, o grupo fica em **Esperando**, com "Aguarda CSNU2401023 até …", e nada é cobrado até o segundo voltar.

A Invoice cancelada à mão não volta sozinha: nem a data, nem o CE, nem a troca de Cliente a emitem de novo. As caixas dela voltam para **A emitir** com "Invoice anterior DEM-… cancelada à mão: gere a nova". Clique no ícone **Gerar Invoice** no fim da linha: ou a Invoice sai, ou a recusa fica na linha até você editar as datas ou sair da página.

Cada container é cobrado uma vez. Se um container novo entra no grupo depois da Invoice, ele vai numa **Invoice complementar**, só com ele (o ícone passa a ser **Gerar Invoice complementar**).

O container que está em B/Ls de Clientes diferentes na mesma Viagem é dividido em partes iguais: com dois Clientes, cada um paga a metade do valor da caixa calculado pela condição dele (o free time e as diárias do B/L, do acordo ou da tarifa). A Invoice, o documento e o Portal mostram "1/2 da caixa". Se o número de Clientes muda depois da Invoice, vale a regra das datas alteradas ([18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container)).

::: atencao
- Uma devolução que falta segura a Invoice do grupo inteiro, inclusive dos containers que já voltaram em atraso. Cobre do Cliente a devolução que falta, ou grave a data se ela já aconteceu.
- B/L sem Cliente, B/L cancelado e Viagem cancelada não recebem Invoice de Demurrage. Com Demurrage, o B/L sem Cliente ou cancelado fica em **Travado** até o Cliente ser vinculado, o B/L ser reativado ou a cobrança ser dispensada ([9.11](#911-dispensar-a-cobrança-de-um-container)).
:::

## 9.7 Cadastrar tarifas e acordos de Demurrage

**Quem faz:** {{Qualquer equipe}} · desativar, reativar e excluir tarifa e acordo: {{Administrativo}}

O free time e as diárias vêm de três lugares, e vale o primeiro que existir para o container:

| De onde | Vale para | Onde se cadastra |
|---|---|---|
| Condição do B/L | Os containers de um B/L só | Ficha do B/L, aba **Faturamento**, **Definir condição do B/L** |
| Acordo do Cliente | Os containers do Cliente descarregados dentro da vigência | **Demurrage** › **Tarifas e acordos** › **Acordos de Clientes** |
| Tarifa do grupo do tipo de container | Todos os outros | **Demurrage** › **Tarifas e acordos**, aba **Tabela padrão**, **Nova tarifa** |

### O acordo do Cliente

1. Em **Demurrage**, clique em **Tarifas e acordos** e abra **Acordos de Clientes**.
2. Clique em **Novo acordo** e escolha o Cliente.
3. Preencha **Free Time (dias)** e **Vigência de**. **Tarifa P1** e **Tarifa P2** são as diárias em dólar dos dois períodos; em branco, valem as da tarifa.
4. Clique em **Cadastrar acordo** e confirme.

O acordo vale pela data de descarga: mesmo encerrado, ele continua valendo para os containers descarregados dentro da vigência dele. O Cliente não pode ter dois acordos ativos com vigências que se cruzam: para trocar as condições, preencha a **Vigência até** do acordo atual antes de cadastrar o novo.

### A condição de um B/L

Use quando uma negociação vale só para um B/L. Na ficha, aba **Faturamento**, bloco **Condições de Demurrage deste B/L**, **Definir condição do B/L** abre **Free time (dias)**, **Tarifa P1 (USD/dia)** e **Tarifa P2 (USD/dia)**; o campo em branco volta ao acordo ou à tarifa. Ao salvar, a página **Demurrage** e as fichas já mostram a condição nova. O B/L cancelado não oferece **Definir condição do B/L**.

### A tarifa

A **Tabela padrão** tem uma tarifa por grupo de tipos de container: 20' dry, 40' dry, 20' especial, 40' especial, 20' reefer e 40' reefer. A coluna **Tipos que cobre** lista os códigos de cada grupo, que vêm do cadastro **Tipos de container** ([9.10](#910-cadastrar-um-tipo-de-container)). **Nova tarifa** pede o **Grupo de tarifa**, o free time, os dias de cada período, as duas diárias e a vigência.

Cada grupo tem uma tarifa ativa por dia: para mudar o preço, preencha a **Vigência até** da tarifa atual e cadastre a nova a partir do dia seguinte. O Vela recusa a vigência que se cruza com a de outra tarifa do grupo. A tarifa que vale é a vigente no dia do cálculo, não na descarga: uma tarifa nova alcança todos os containers ainda sem Invoice.

::: atencao
- Tarifa, acordo e condição valem para os containers ainda sem Invoice, na hora: a divisão deles na página **Demurrage** muda junto. A Invoice já emitida não muda.
- Para parar de usar uma tarifa ou um acordo que já entrou em vigor, peça ao {{Administrativo}} que o desative. Só se exclui o que ainda não entrou em vigor.
:::

## 9.8 Responder a uma Disputa

**Quem faz:** {{Equipamentos}} e {{Administrativo}} · ler: {{Todas as equipes}}

A **Disputa** é a contestação de uma Invoice de Demurrage pelo Cliente. Só o Cliente a abre, pelo Portal, com um anexo se quiser ([15.6](15-portal-o-que-o-cliente-ve.md#156-a-demurrage-e-a-disputa)). Aberta, ela abre um alerta para {{Equipamentos}} (capítulo 20), a Invoice passa a **Em disputa** e a Régua de Cobrança daquela Invoice para. Cada Invoice tem uma conversa só.

Você tem 1 dia útil para responder, contado de quando a vez passou para você: a linha diz "Responder até …". Vencido o prazo, ela fica em âmbar, com "Prazo venceu em …", e abre o alerta **Disputa de Demurrage sem resposta no prazo** ([20.9](20-alertas.md#209-demurrage)).

1. Em **Demurrage**, clique no cartão **Disputas aguardando resposta** ou abra a aba **Disputas**. Cada linha é uma Disputa; as que esperam por você vêm primeiro, marcadas "Aguarda a nossa resposta".
2. Clique no número da Invoice para abrir a conversa embaixo da linha. **Abrir a Invoice** abre o detalhe dela.
3. Escreva a **Resposta ao Cliente** e, se precisar, anexe um arquivo (PDF, JPG, PNG ou TXT, até 10 MB).
4. Em **Depois de enviar**, escolha **Aguardar Cliente** só se espera resposta dele: enquanto a vez é do Cliente, **Responder** some e você não consegue encerrar a Disputa. **Encerrar pendência (Ninguém)** resolve a Disputa ([9.9](#99-decidir-a-disputa)).
5. Clique em **Responder** e confirme em **Enviar resposta**.

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

Se a data já foi corrigida com a Disputa aberta, o detalhe da Invoice diz "Fora da Régua". Aí o {{Administrativo}} cancela a Invoice, o que encerra a Disputa junto, e alguém clica em **Gerar Invoice** na divisão **A emitir** ([9.6](#96-saber-quando-a-invoice-de-demurrage-sai)).

### Reabrir

Resolvida a Disputa, o Cliente contesta de novo só pedindo a reabertura pelo Portal: o pedido chega como mensagem na conversa, com um alerta. Para atender, escreva a **Justificativa da reabertura** e clique em **Reabrir Disputa**: a Disputa volta aberta, esperando a nossa resposta, e a Régua pausa de novo. A justificativa também aparece para o Cliente. A Disputa de uma Invoice cancelada não reabre.

::: atencao
Cancelar a Invoice encerra junto a Disputa aberta: a conversa recebe uma mensagem do Sistema com o motivo, a Disputa fica **Cancelada** e o Cliente é avisado no Portal. Escreva o motivo para o Cliente ler: ele o vê como você escreveu.
:::

## 9.10 Cadastrar um tipo de container

**Quem faz:** {{Qualquer equipe}} · desativar, reativar e excluir: {{Administrativo}}

O Vela reconhece o tipo do container pelo código que vem no B/L, como 40HC ou 48FR, no cadastro **Tipos de container**. Cada tipo aponta para um grupo de tarifa, e é a tarifa do grupo que cobra a Demurrage ([9.7](#97-cadastrar-tarifas-e-acordos-de-demurrage)). O tipo fora do cadastro não tem tarifa: a importação do B/L avisa "Tipo … sem tarifa de Demurrage: cadastre o tipo em Tarifas e acordos.", o B/L entra, e o grupo dele vai para **Travado**.

1. Em **Demurrage** › **Tarifas e acordos**, abra **Tipos de container** e clique em **Novo tipo**. Pelo atalho **Cadastrar tipo** da divisão **Travado**, a janela já abre com o código.
2. Preencha o **Código** como vem no B/L, só letras e números, e escolha o **Grupo de tarifa**. A **Descrição** é opcional.
3. Clique em **Cadastrar tipo** e confirme.

Os containers desse tipo passam a cobrar pela tarifa do grupo, e o grupo de B/Ls sai de **Travado**, se nada mais o segura.

::: atencao
- O código cadastrado não muda: para corrigir, cadastre o código certo e peça ao {{Administrativo}} que desative o errado. Tipo já usado em B/L não se exclui.
- Desativar um tipo deixa os containers dele sem tarifa: o grupo vai para **Travado**, com alerta ao {{Administrativo}}, até o tipo ser reativado. Pelo atalho **Reativar tipo**, a aba já mostra os inativos.
:::

## 9.11 Dispensar a cobrança de um container

**Quem faz:** {{Qualquer equipe}}

Dispensar é decidir, com justificativa, não cobrar a Demurrage de um container, como a do B/L criado por engano. O container dispensado sai da página **Demurrage** e de qualquer Invoice nova do grupo, e deixa de segurar a Invoice dos outros e o cancelamento do B/L ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)).

1. Em **Demurrage**, aba **Containers**, abra a linha do grupo pela seta.
2. Na linha do container, clique no ícone **Dispensar cobrança**. No celular, o botão fica no cartão do container.
3. Escreva a **Justificativa** (mínimo de 10 caracteres) e confirme em **Dispensar cobrança**.

Na ficha do B/L, aba **Faturamento**, o bloco **Demurrage** passa a mostrar o container como "Cobrança dispensada", com a justificativa ao passar o mouse. Para voltar a cobrar, use o ícone **Desfazer dispensa**, ao lado, também com justificativa: o container volta para a página **Demurrage** e entra na próxima Invoice do grupo. As duas ações ficam no **Histórico** do B/L.

::: atencao
- Só se dispensa o container que passou do free time ou é de tipo sem tarifa e que ainda não está numa Invoice. Para tirar valor de uma Invoice emitida, dê um desconto (capítulo 23).
- A dispensa acompanha a troca de Cliente do B/L. A do B/L sem Cliente não passa ao Cliente vinculado depois: o container volta a ser cobrado.
- No B/L cancelado, a dispensa fica só para leitura: reative o B/L antes de desfazê-la.
:::
