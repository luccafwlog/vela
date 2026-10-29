Nem toda carga é um container cheio com Cliente. Este capítulo cuida do resto que passa pelas mãos de {{Equipamentos}} e de {{Operações}}: os **veículos** que chegam dentro dos containers, os **vazios** que o navio descarrega (Vazios IMP) e embarca (Vazios EXP), os **Locais** de onde os vazios saem e o **Granito** exportado. Cada um entra por uma planilha própria, com as etapas de toda importação (capítulo 6), e quase tudo aparece depois no ADR de Saída da escala (capítulo 11).

::: aprende
- importar a planilha de veículos e definir o local de desova;
- mover ou excluir um veículo lançado no B/L errado;
- cadastrar os vazios de importação e a natureza de cada um;
- registrar o embarque de vazios de uma escala e lançar os serviços;
- cadastrar os depots, os terminais e os serviços deles;
- importar o manifesto de Granito.
:::

## 10.1 Importar os veículos

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

Os veículos chegam dentro de containers de B/Ls de container. O arquivo do B/L não os traz: eles entram pela planilha de veículos do armador, ligados ao B/L e ao container. Por isso importe os B/Ls antes.

O veículo pesa na cobrança: o B/L de container com veículos cujo **Movement To** é LCL (ou CFS) fica **Isento** das Taxas Locais (capítulo 21). Sem a planilha, o CE emite a fatura cheia desse B/L.

1. No menu **Importação**, abra **Veículos** e escolha a Viagem na faixa do alto ou em **Buscar viagem**.
2. Clique em **Importar veículos** e escolha o arquivo (.xlsx, .xls ou .csv). Serve o modelo da janela ou o Daily Report do armador, mesmo com cabeçalhos em chinês.
3. Confira a prévia e clique em **Importar N veículos**.

A planilha precisa de **CHASSI**, **MARCA**, **MODELO**, **PESO**, **CUBAGEM**, **CONTAINER**, **TIPO_CONTAINER**, **LACRE** e **BL**; **LOCAL DE DESOVA** é opcional. Ao importar, cada linha é conferida com o que está gravado: o B/L precisa ser da Viagem, o container precisa ser daquele B/L, com o mesmo tipo e o mesmo lacre, e o chassi não pode estar em outra Viagem ativa. Uma linha recusada recusa a planilha inteira, e a janela lista as recusadas.

### Viagem sem veículos

Cinco dias antes da chegada, a Viagem com B/L de container que ainda não tem veículo abre um alerta para {{Equipamentos}} (capítulo 20). Se a Viagem não traz veículos, declare: na lista vazia, clique em **Esta viagem não terá veículos**. O alerta fecha e a declaração fica na Linha do tempo da Viagem. Se a planilha chegar depois, importe: a declaração se desfaz sozinha.

::: atencao
- A planilha só acrescenta veículos: o chassi que já está na Viagem é recusado, e com ele a planilha inteira. Numa segunda leva, importe só os veículos novos; para corrigir um veículo, veja [10.3](#103-mover-ou-excluir-um-veículo).
- O local de desova da planilha só preenche o container sem local. Se ele já tem outro, a janela pergunta: **Trocar pelo da planilha** ou **Manter o gravado**.
:::

## 10.2 Definir o local de desova

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

O **local de desova** é onde o container é aberto e os veículos saem dele. O local é do container, não do veículo: vale para todos os veículos dentro dele e para o mesmo container em todos os B/Ls da Viagem. Ele aparece no ADR de Saída, na seção de veículos (capítulo 11).

1. Na lista de **Veículos**, filtre o que interessa ou marque os veículos. O cartão **Sem local de desova** filtra os que faltam.
2. Clique em **Definir local de desova**.
3. Em **Aplicar a**, escolha os veículos marcados, todos os do recorte ou só os sem local.
4. Digite o local e clique em **Aplicar a N containers**.

O campo em branco apaga o local. Se algum container já tem outro local, o Vela lista os afetados e pede confirmação antes de trocar. A troca fica no Histórico de cada B/L.

::: atencao
O local vale para o container inteiro, inclusive para os veículos que o filtro esconde. Confira na janela quantos veículos, no total, a escolha atinge.
:::

## 10.3 Mover ou excluir um veículo

**Quem faz:** {{Qualquer equipe}}

Nenhuma tela edita um veículo: ele entra pela planilha e muda só por duas ações da barra de seleção, as duas com motivo.

- **Mover para outro B/L:** marque os veículos, clique em **Mover para outro B/L**, informe o **B/L de destino** e, se ele tiver mais de um container, o **Container que recebe os veículos**. Confirme com o motivo.
- **Excluir selecionados:** marque os veículos e confirme com o motivo. Não há desfazer; para trazê-los de volta, importe uma planilha só com eles.

O motivo fica no Histórico do B/L. As Taxas Locais dos B/Ls sem fatura são recalculadas na hora; o B/L faturado segue a correção da fatura (capítulo 22).

::: atencao
O container com veículos não sai do B/L quando o B/L é reimportado sem ele. Mova ou exclua os veículos antes ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)).
:::

## 10.4 Cadastrar os vazios de importação

**Quem faz:** {{Qualquer equipe}}

Os **vazios de importação** são os containers vazios que o navio descarrega no porto. Eles não têm B/L nem Cliente, mas têm Manifesto Mercante próprio, um por rota (POL → POD). **Vazios IMP**, no menu **Importação**, lista os vazios de cada Viagem, com o número do manifesto de cada um.

Há dois jeitos de cadastrá-los:

- **Pela planilha do armador**, o jeito completo. Em **Vazios IMP**, clique em **Importar planilha**, escolha a **Viagem de destino** e o arquivo, com **Container**, **POL** e **POD** (e, se houver, **Tipo** e **Tara (kg)**). Depois da leitura, informe o **Nº do manifesto Mercante** de cada rota e importe.
- **Pelo Baplie**, quando a planilha não veio. Na página **Baplie EDI**, o bloco **Vazios de importação** oferece **Cadastrar N vazios** ([6.7](06-importacao.md#67-importar-o-baplie)). Eles entram sem número de manifesto: informe depois em **Rotas e Manifestos** da Viagem ([4.6](04-viagens-escalas.md#46-rotas-e-manifestos)).

::: tela vazios-imp
Os vazios da COSCO SHIPPING SEREIA / 024E, ainda sem número de manifesto.
:::

A planilha vale mais que o Baplie: o container que ela traz sai dos vazios do Baplie. Importar a planilha de novo substitui os containers de cada rota que ela traz. Enquanto uma rota de vazios está sem número, a lista mostra **Sem número** em âmbar e a Viagem conta como CE Mercante pendente (capítulo 20).

### A natureza do vazio

Alguns vazios têm uma função a bordo: **Cama** é a base de estiva de uma carga OOG; **Cover plate** é a tampa de porão. Para registrar, marque os containers na lista e clique em **Cama**, **Cover plate** ou **Limpar**. A natureza aparece no ADR de Saída, em **Vazios descarregados** (capítulo 11).

::: atencao
- Um vazio existe uma vez por Viagem. Se outra planilha já gravou o container numa rota que esta não traz, o arquivo é recusado: traga a rota inteira ou tire o container.
- Quando o Baplie é reimportado e os vazios mudam, o bloco mostra **Atualizar vazios do Baplie**. A natureza já marcada é mantida.
:::

## 10.5 Registrar o embarque de vazios

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

O **Embarque de vazios** registra os containers vazios que o navio embarca num porto brasileiro. Cada escala tem um embarque, com duas partes: as **unidades embarcadas**, o que embarcou e de onde saiu, e os **serviços**, o custo da operação ([10.6](#106-lançar-os-serviços-do-embarque)).

1. No menu **Exportação**, abra **Vazios EXP** e clique em **Novo embarque**. Da ficha da Viagem, a ação **Novo embarque de vazios** já traz a Viagem.
2. Escolha a **Viagem** e o **Porto de embarque**, entre as escalas da Viagem, e clique em **Criar embarque**. Se a escala já tem embarque, o Vela abre o existente.
3. Na aba **Unidades embarcadas**, clique em **Importar planilha** ou, para uma unidade só, em **Adicionar unidade**.
4. Em cada unidade vão o **Container**, o **Local** de onde saiu, a **Condição** (**Vazio** ou **Com material**) e as datas. Saindo de um depot, **Entrada** e **Saída** são obrigatórias; saindo do terminal (embarque direto), elas não existem.

A planilha tem as colunas Container, Tipo, Local (o código do cadastro de Locais), Condição, Entrada, Saída e Embarque; Container, Local e Condição são obrigatórias. Ela não tem prévia: **Importar** confere e grava em seguida, tudo ou nada. Importar de novo substitui a lista da escala, mas mantém as unidades incluídas à mão que o arquivo não traz. O mesmo container só embarca uma vez na Viagem.

::: atencao
- Confira a escala antes de criar o embarque. O embarque não se exclui pela tela e, enquanto ele existe, a declaração de vazios da escala não sai ([4.2](04-viagens-escalas.md#42-planejar-as-escalas)).
- Com o ADR de Saída do porto fechado, o embarque fica travado: a tela mostra **ADR de Saída fechado** e nada se inclui, edita ou exclui. Reabra o ADR antes (capítulo 11).
:::

## 10.6 Lançar os serviços do embarque

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

Os serviços são o custo do embarque: armazenagem no depot, transporte entre locais e serviços gerais. Cada linha é quantidade × valor unitário, e o total vai para o ADR de Saída (capítulo 11).

A armazenagem o Vela calcula pela lista de unidades: para cada unidade de depot, os dias da entrada à saída, contando os dois, menos o free time do depot para a condição dela. Entrada em 1º e saída em 10 de outubro são 10 dias; com free time de 7 dias para vazio, ficam 3 dias de armazenagem.

1. Abra a aba **Serviços**. Quando há armazenagem calculada sem linha, o bloco **Armazenagem a lançar** aparece no alto, com cada depot e condição.
2. Clique no ícone **Lançar armazenagem** da linha: ela entra com o serviço, a quantidade calculada e o valor do cadastro.
3. Para transporte e serviços gerais, clique em **Lançar linha** e escolha **Local**, **Natureza** e **Serviço**. O **Valor unitário** vem sugerido do cadastro do local; troque se o valor efetivo foi outro.
4. Para comentar uma linha, use o ícone **Observação**: o texto aparece no ADR.

A quantidade da armazenagem acompanha a lista de unidades. Para fixar outro número, marque **Informar a quantidade à mão, no lugar do cálculo**. A linha lançada não se edita, fora a observação: para mudar, exclua a linha (com motivo) e lance de novo.

::: atencao
Se **Armazenagem a lançar** diz que falta o serviço de armazenagem ou que o local está inativo, o ícone da linha abre o local em Locais: cadastre o serviço ([10.7](#107-cadastrar-depots-terminais-e-serviços)) ou peça ao {{Administrativo}} que reative o local.
:::

## 10.7 Cadastrar depots, terminais e serviços

**Quem faz:** {{Qualquer equipe}} · desativar, reativar e excluir: {{Administrativo}}

Os **Locais** são de dois tipos:

- **Depot:** o pátio onde o vazio espera antes do embarque. Tem **Free time vazio** e **Free time com material**, em dias, e gera armazenagem.
- **Terminal portuário:** o terminal da escala, como o TVV. Precisa de **Porto brasileiro**, não tem free time nem armazenagem, mas pode cobrar serviços. É o mesmo terminal que se escolhe nas escalas e nos B/Ls ([5.8](05-programacao.md#58-navios-armadores-portos-e-terminais)).

1. Em **Vazios EXP**, clique em **Locais (depots e terminais)**.
2. Clique em **Novo local** e preencha **Código** (único), **Nome**, **Tipo** e o porto ou os free times. Clique em **Cadastrar local**.
3. Com o local aberto, em **Serviços do catálogo**, clique em **Adicionar serviço**: o nome, a **Natureza** (Armazenagem, Transporte ou Geral), a **Condição** (na armazenagem) ou o **Destino da rota** (no transporte) e o **Valor sugerido (R$)**.

O valor do catálogo é só uma sugestão para as linhas do embarque: não tem vigência, e mudá-lo não muda as linhas já lançadas. Já o free time e o tipo do depot mudam a armazenagem calculada dali em diante.

::: atencao
- Local ou serviço desativado sai das escolhas novas, mas continua onde já foi usado. Só se exclui o que nunca foi usado.
- O serviço de transporte sem destino ativo não aparece em **Lançar linha**.
:::

## 10.8 Importar o Granito

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

O **Granito** é carga de exportação: blocos de pedra embarcados num porto brasileiro. No Vela ele só é totalizado: quantos B/Ls, blocos e toneladas cada navio levou. O B/L de Granito não tem Cliente, taxa, fatura nem CE, e não passa pela Revisão.

1. No menu **Exportação**, abra **Granito** e clique em **Importar planilha COSCO**. Da ficha da Viagem, a ação **Manifesto Granito** já traz a Viagem.
2. Escolha a Viagem e o arquivo: o "Relatório de Cargas/Booking" que a COSCO exporta, com as colunas **BL** e **Real Weight**.
3. Confira a prévia (B/Ls, blocos e peso) e importe.

O peso que conta é sempre o peso real da planilha; o declarado pelo shipper não entra em lugar nenhum. Nenhuma tela edita um B/L de Granito: ele entra e sai só pela planilha.

A planilha sem nenhum B/L em comum com os da Viagem vira outro manifesto. A que tem B/L em comum atualiza os B/Ls pelo número e pergunta o que fazer com os que sumiram do arquivo: **Tirar da Viagem** ou **Manter gravados**.

::: atencao
- O porto de carregamento da planilha precisa ser uma escala da Viagem. Senão, o Granito aparece no ADR de Saída como dado órfão (capítulo 11).
- Com Granito importado no porto, a declaração de exportação da escala não sai ([4.2](04-viagens-escalas.md#42-planejar-as-escalas)).
- Se a escala declara exportação e o navio sai do terminal sem o Granito ou os vazios vinculados, abre um alerta para {{Operações}} (capítulo 20).
:::
