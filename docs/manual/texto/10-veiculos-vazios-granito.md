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

O veículo pesa na cobrança: o B/L de container com veículos e **Movement To** LCL (ou CFS) fica **Isento** das Taxas Locais (capítulo 21). Sem a planilha, ao gravar o CE o Vela emite a fatura cheia desse B/L.

1. No menu **Importação**, abra **Veículos** e escolha a Viagem na faixa do alto ou em **Buscar viagem**.
2. Clique em **Importar veículos** e escolha o arquivo (.xlsx, .xls ou .csv).
3. Confira a prévia e clique em **Importar N veículos**.

Uma linha recusada recusa a planilha inteira, e a janela lista as recusadas.

### A Viagem terá veículos?

A partir de 7 dias antes do primeiro ETA no Brasil, o Vela pede a {{Equipamentos}} que responda, na lista vazia de **Veículos**, se a Viagem terá veículos (capítulo 20). Só {{Equipamentos}} e o {{Administrativo}} veem os botões da resposta:

- **Esta viagem não terá veículos**: os alertas de veículos fecham e a {{Documentação}} pode importar o CE. Se a planilha chegar depois, importe: a declaração se desfaz sozinha.
- **Esta viagem terá veículos**: a lista passa a dizer **Viagem com veículos a importar**, e o CE dos B/Ls de container fica travado até a planilha entrar. Um veículo importado já libera o CE da Viagem inteira.

Enquanto não há resposta nem veículo, a planilha de CE dos B/Ls de container é recusada ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)). Para mudar a resposta, use **Trocar para com veículos** ou **Trocar para sem veículos**; para apagá-la, **Desfazer declaração**. As duas pedem motivo, que fica na Linha do Tempo da Viagem.

::: atencao
- A planilha só acrescenta veículos: o chassi que já está na Viagem é recusado, e com ele a planilha inteira. Numa segunda leva, importe só os veículos novos; para corrigir um veículo, veja [10.3](#103-mover-ou-excluir-um-veículo).
:::

## 10.2 Definir o local de desova

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

O **local de desova** é onde o container é aberto e os veículos saem dele. O local é do container, não do veículo: vale para todos os veículos dentro dele e para o mesmo container em todos os B/Ls da Viagem. Ele aparece no ADR de Saída, na seção de veículos (capítulo 11).

1. Na lista de **Veículos**, filtre o que interessa ou marque os veículos. O cartão **Sem local de desova** filtra os que faltam.
2. Clique em **Definir local de desova**.
3. Em **Aplicar a**, escolha os veículos marcados, todos os do recorte ou só os sem local.
4. Digite o local e clique em **Aplicar a N containers**.

A troca fica no Histórico de cada B/L.

## 10.3 Mover ou excluir um veículo

**Quem faz:** {{Qualquer equipe}}

Nenhuma tela edita um veículo: ele entra pela planilha e muda só por duas ações da barra de seleção, as duas com motivo.

- **Mover para outro B/L:** marque os veículos, clique em **Mover para outro B/L**, informe o **B/L de destino** e, se ele tiver mais de um container, o **Container que recebe os veículos**. Confirme com o motivo.
- **Excluir selecionados:** marque os veículos e confirme com o motivo. Não há desfazer; para trazê-los de volta, importe uma planilha só com eles.

O motivo fica no Histórico do B/L. As Taxas Locais dos B/Ls sem fatura são recalculadas na hora; o B/L faturado segue a correção da fatura (capítulo 22).

::: atencao
Reimportar o B/L sem um container que tem veículos é recusado na prévia: mova ou exclua os veículos dele antes ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)).
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

Importar a planilha de novo substitui os containers de cada rota que ela traz. Enquanto uma rota de vazios está sem número, a lista mostra **Sem número** em âmbar e a Viagem conta como CE Mercante pendente (capítulo 20).

Os vazios também criam a frente de vazios da escala. Se os terminais da escala já foram escolhidos, escolha o dessa frente, que nasce em TBC ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)): sem ele, os vazios ficam fora do ADR de Saída, e o ADR não fecha.

### A natureza do vazio

Alguns vazios têm uma função a bordo: **Cama** é a base de estiva de uma carga OOG; **Cover plate** é a tampa de porão. Para registrar, marque os containers na lista e clique em **Cama**, **Cover plate** ou **Limpar**. A natureza aparece no ADR de Saída, em **Vazios descarregados** (capítulo 11).

::: atencao
- Reimportar o Baplie mantém a natureza já marcada.
:::

## 10.5 Registrar o embarque de vazios

**Quem faz:** {{Qualquer equipe}}; na rotina, {{Equipamentos}} · excluir o embarque: {{Administrativo}}

O **Embarque de vazios** registra os containers vazios que o navio embarca num porto brasileiro. Cada escala tem um embarque, e ele opera num terminal: o da frente de vazios da exportação da escala, que decide em que ADR de Saída o embarque entra. O embarque tem duas partes: as **unidades embarcadas**, o que embarcou e de onde saiu, e os **serviços**, o custo da operação ([10.6](#106-lançar-os-serviços-do-embarque)).

1. No menu **Exportação**, abra **Vazios EXP** e clique em **Novo embarque**. Da ficha da Viagem, a ação **Novo embarque de vazios** já traz a Viagem.
2. Escolha a **Viagem**, o **Porto de embarque**, entre as escalas da Viagem, e o **Terminal**. Se a escala já tem terminal para os vazios, ele vem escolhido e não muda aqui: para trocar, edite a escala ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)).
3. Clique em **Criar embarque**. Se a escala já tem embarque, o Vela abre o existente.
4. Na aba **Unidades embarcadas**, clique em **Importar planilha** ou, para uma unidade só, em **Adicionar unidade**.
5. Em cada unidade vão o **Container**, o **Local** de onde saiu, a **Condição** (**Vazio** ou **Com material**), as datas e o **Porto de descarga (POD)**, onde o vazio vai descarregar. Saindo de um depot, **Entrada** e **Saída** são obrigatórias; saindo do terminal (embarque direto), elas não existem, e o terminal precisa ser do porto do embarque.
6. Em **Manifesto Mercante por porto de descarga**, informe o número do manifesto de cada rota pelo ícone **Informar**. Os vazios já embarcam manifestados: o Vela só registra o número.

O terminal escolhido vai para a escala, como se você o escolhesse na janela dela: a escala passa a declarar o Embarque de vazios, a frente de vazios ganha o terminal e, se ele ainda não estava na escala, nascem a Atracação e o ADR de Saída dele. A faixa do embarque mostra o **Terminal**.

A planilha tem oito colunas: **Container**, **Tipo**, **Local** (o código do cadastro de Locais), **Condição**, **Entrada**, **Saída**, **Embarque** e **POD**. São obrigatórias **Container**, **Local**, **Condição** e **POD**. O POD aceita o código do porto (CNSHA) ou o nome (Shanghai), e não pode ser o porto do embarque. A planilha não tem prévia: grava tudo ou nada, e importar de novo substitui a lista, mas mantém as unidades incluídas à mão. O mesmo container só embarca uma vez na Viagem.

::: atencao
- Confira a escala e o terminal antes de criar o embarque. Enquanto ele existe, a frente de vazios não volta para TBC, a declaração de vazios não sai e a escala não se exclui. Trocar o terminal da frente na escala continua valendo: o embarque e o ADR vão junto.
- Porto sem terminal portuário ativo não recebe embarque: o terminal precisa estar em **Locais (depots e terminais)** ([10.7](#107-cadastrar-depots-terminais-e-serviços)).
- O embarque criado antes de o terminal ser obrigatório mostra **Sem terminal** e o aviso **Embarque sem terminal**: escolha o **Terminal** e clique em **Definir terminal**. Até lá, nenhum ADR de Saída da escala fecha.
:::

### Excluir um embarque criado por engano

Só o {{Administrativo}} exclui, e só o embarque ainda vazio: sem unidade, sem linha de serviço e com o ADR de Saída aberto. Fora disso, **Excluir embarque** não aparece.

1. Abra o embarque e clique em **Excluir embarque**, no alto.
2. Escreva o motivo e confirme em **Excluir**.

A frente de vazios, a Atracação e o ADR do terminal ficam na escala. Sem o embarque, a janela da escala volta a poder mudá-los ou tirá-los.

## 10.6 Lançar os serviços do embarque

**Quem faz:** {{Qualquer equipe}}. Na rotina, {{Equipamentos}}.

Os serviços são o custo do embarque: armazenagem no depot, transporte entre locais e serviços gerais. Cada linha é quantidade × valor unitário, e o total vai para o ADR de Saída (capítulo 11).

A armazenagem o Vela calcula pela lista de unidades: para cada unidade de depot, os dias da entrada à saída, contando os dois, menos o free time do depot para a condição dela. Entrada em 1º e saída em 10 de outubro são 10 dias; com free time de 7 dias para vazio, ficam 3 dias de armazenagem. O depot que cobra 20' e 40' com preços diferentes tem uma linha de armazenagem para cada tamanho.

1. Abra a aba **Serviços**. Quando há armazenagem calculada sem linha, o bloco **Armazenagem a lançar** aparece no alto, com cada depot, condição e, quando o depot cobra por tamanho, o **Tamanho**.
2. Clique no ícone **Lançar armazenagem** da linha: ela entra com o serviço do tamanho certo, a quantidade calculada e o valor do cadastro.
3. Para transporte e serviços gerais, clique em **Lançar linha** e escolha **Local**, **Natureza** e **Serviço**. O **Valor unitário** vem sugerido do cadastro do local; troque se o valor efetivo foi outro. Abaixo da **Quantidade** aparece a sugestão (as unidades daquele local, do tamanho do serviço) e o botão **Usar N** a aplica. Confira antes: o overtime ou o transporte de dois de 20' por viagem pedem outro número.
4. Para comentar uma linha, use o ícone **Observação**: o texto aparece no ADR.
5. Para corrigir uma linha, use o ícone **Editar**: a mesma janela abre com a linha, e **Salvar linha** grava a correção.

A quantidade da armazenagem acompanha a lista de unidades. Para fixar outro número, marque **Informar a quantidade à mão, no lugar do cálculo**. A linha de armazenagem guarda o free time do dia em que foi lançada: mudar o free time do depot depois não a muda.

## 10.7 Cadastrar depots, terminais e serviços

**Quem faz:** {{Qualquer equipe}} · desativar, reativar e excluir: {{Administrativo}}

Os **Locais** são de dois tipos:

- **Depot:** o pátio onde o vazio espera antes do embarque. Tem **Free time vazio** e **Free time com material**, em dias, e gera armazenagem.
- **Terminal portuário:** o terminal da escala, como o TVV ([5.8](05-programacao.md#58-navios-armadores-portos-e-terminais)). Precisa de **Porto brasileiro**, não tem free time nem armazenagem, mas pode cobrar serviços.

1. No menu, abra **Exportação** › **Locais (depots e terminais)**. O botão de mesmo nome, em **Vazios EXP**, abre a mesma tela.
2. Clique em **Novo local** e preencha **Código** (único), **Nome**, **Tipo** e o porto ou os free times. Clique em **Cadastrar local**.
3. Com o local aberto, em **Serviços do catálogo**, clique em **Adicionar serviço**: o nome, a **Natureza** (Armazenagem, Transporte ou Geral), o **Tamanho** (20', 40' ou **Qualquer tamanho**), a **Condição** (na armazenagem) ou o **Destino da rota** (no transporte) e o **Valor sugerido (R$)**. O depot que cobra 20' e 40' com preços diferentes tem um serviço para cada tamanho.

O valor do catálogo é só uma sugestão para as linhas do embarque: não tem vigência, e mudá-lo não muda as linhas já lançadas. O free time também não muda a linha de armazenagem já lançada, que guarda o do lançamento; ele vale para a armazenagem ainda a lançar.

::: atencao
- Local ou serviço desativado sai das escolhas novas, mas continua onde já foi usado. Só se exclui o que nunca foi usado.
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
- O Granito importado entra no ADR de Saída pelo terminal da frente de Granito da escala. Se a escala ainda não declarava o Granito, a frente nasce em TBC e a janela da escala já abre com a exportação e o **Granito** marcados: escolha o terminal da frente e clique em **Salvar escala** ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)). Sem isso, o Granito fica fora do ADR, e o ADR não fecha.
- Com Granito importado no porto, a declaração de exportação da escala não sai ([4.2](04-viagens-escalas.md#42-planejar-as-escalas)).
- Se o navio sai do terminal sem o Granito ou os vazios que a escala declarou, abre um alerta para {{Operações}} (capítulo 20).
:::
