A documentação de uma Viagem chega do armador em arquivos: o B/L de cada carga, o manifesto da carga solta, a planilha de CE Mercante e o Baplie, que é o plano de carga do navio. Cada arquivo entra por uma importação que lê tudo, mostra numa prévia o que vai mudar e só grava quando você confirma. Neste capítulo você importa cada arquivo na ordem em que eles costumam chegar e aprende a corrigir o que o armador mudou depois.

::: aprende
- como toda importação funciona, da escolha do arquivo à gravação;
- importar os B/Ls de container e a carga solta, e reimportar um B/L corrigido;
- importar o CE Mercante e ler o resultado da emissão das faturas;
- importar o Baplie e resolver as divergências com os B/Ls;
- trocar um B/L reemitido e destravar o que ficou parado.
:::

## 6.1 Como toda importação funciona

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

Toda importação é feita para uma Viagem, que precisa existir no Vela (capítulo 4). Há três portas, e todas abrem as mesmas janelas:

- a lista **BLs**, no botão **Importar**;
- a ficha da Viagem, aba **Importação**, no bloco **Importação rápida**, com a Viagem já escolhida;
- a página **Baplie EDI**, para o Baplie.

::: passos
1. No menu, abra **Importação** e clique em **BLs**. No alto da lista, clique em **Importar**.
2. Escolha o tipo de arquivo, por exemplo **B/L de contêiner (.xlsx)**.
:::

::: tela bls-importar-menu
A lista BLs com o menu Importar aberto.
:::

Toda janela de importação segue as mesmas três etapas, mostradas no alto: **Arquivo**, **Prévia** e **Resultado**. Você escolhe a Viagem e o arquivo; o Vela lê e mostra na prévia o que vai criar, mudar ou deixar de fora; só quando você confirma é que algo é gravado.

Na prévia, o que ela aponta tem dois pesos:

- **Erro** impede a importação. Em regra, um erro recusa o arquivo inteiro: a Viagem nunca fica com metade de um arquivo gravada.
- **Aviso** não impede. Quando a janela pede, marque que conferiu os avisos para seguir.

::: atencao
- Só uma importação grava em cada Viagem por vez. Se duas se cruzam, a segunda não grava nada e pede para tentar de novo.
- Na Viagem cancelada, nenhuma importação é aceita.
:::

## 6.2 Importar os B/Ls de container

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

O B/L (conhecimento de embarque) é o documento que agrupa a carga de um consignatário, a empresa que recebe a carga. É pelo B/L que o Vela vincula o Cliente, calcula as Taxas Locais e mostra a carga no Portal. E é só por esta importação que os containers entram no Vela.

O arquivo é a planilha do B/L no layout da COSCO, um B/L por arquivo. Você pode escolher vários de uma vez.

::: lado
1. Em **BLs**, clique em **Importar** › **B/L de contêiner (.xlsx)**.
2. Em **Navio / Viagem**, escolha a Viagem de destino.
3. Escolha os arquivos dos B/Ls.
4. Confira a **Prévia**: uma linha por B/L, com a situação (**Cria**, **Atualiza** ou **Erro**), a rota e o consignatário.
5. Clique em **Importar N B/Ls** e, no resultado, em **Concluir**.

::: tela importar-bl-previa
A prévia dos três B/Ls de container da Viagem 024E.
:::
:::

A Viagem vem antes do arquivo de propósito: o Vela compara o navio e a viagem do arquivo com ela e recusa o arquivo de outro navio.

Ao gravar, acontecem três coisas que você precisa saber:

- **O Cliente é vinculado pelo CNPJ.** Quando o CNPJ do consignatário é de um Cliente do Vela, o vínculo é automático. Quando não é, o B/L entra sem Cliente e vai para a **Revisão** (capítulo 8), onde alguém confere. No exemplo, o CSC45810A03K00 traz um CNPJ que ainda não é Cliente, e a prévia avisa em âmbar.
- **As Taxas Locais são calculadas na hora,** com o preço do dia da importação. Esse preço fica fixo: mudanças posteriores na tabela de cobrança ou no câmbio não mexem nele.
- **Nenhuma fatura sai ainda.** A fatura só sai depois do CE Mercante ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)).

::: atencao
- Se o B/L já está em outra Viagem, ele é recusado: a importação nunca muda a Viagem de um B/L. Veja [6.9](#69-trocar-o-bl).
- O B/L cancelado fica de fora, sem ser tocado; o resto do arquivo entra.
- Peso ou tara escritos de um jeito ambíguo, como "3,800", são recusados: o Vela não adivinha um número que muda a cobrança. Corrija no arquivo.
:::

## 6.3 Reimportar um B/L que o armador corrigiu

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

O armador às vezes manda uma versão nova de um B/L que já está no Vela. Você reimporta o arquivo, e a prévia mostra cada campo que muda, como antes → depois.

1. Abra a ficha do B/L e clique em **Reimportar B/L**.
2. Escolha o arquivo novo.
3. Confira a coluna **Diferenças** da prévia e os blocos que ela abrir.
4. Clique em **Importar 1 B/L**.

Vários B/Ls corrigidos podem entrar juntos, pelo caminho normal da [6.2](#62-importar-os-bls-de-container): os que já existem aparecem como **Atualiza**.

A ideia é esta: o arquivo novo é a fonte dos dados do documento, mas o que já foi decidido no Vela só muda se alguém confirmar. Por isso a prévia pode abrir blocos que pedem a sua decisão:

| Bloco | Quando aparece | Sem marcar |
|---|---|---|
| **Faturamento** | O B/L já tem fatura e a mudança afeta a cobrança. | A cobrança fica como estava. |
| **Preço** | O preço de hoje é diferente do fixado na importação. | O preço fixado continua. |
| **Troca de consignatário** | O arquivo aponta outro Cliente. | O Cliente continua o mesmo. |
| **Taxas alteradas à mão** | A mudança afeta uma taxa que alguém alterou à mão. | Nada é gravado. |

As datas dos containers (descarga e devolução) e o perfil e o COC/SOC corrigidos à mão no Vela ficam: o arquivo não os muda. Já o lacre, o peso e o CBM de cada container voltam ao que o arquivo traz.

::: atencao
Container que o arquivo novo não traz sai do B/L. A prévia mostra quais saem: confira antes de importar.
:::

## 6.4 Importar a carga solta

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

A carga solta (BB) é a carga que viaja sem container, como máquinas e volumes. Ela chega de dois jeitos, que gravam o mesmo tipo de B/L:

- o **Manifesto de carga solta (BB)**, uma planilha com vários B/Ls;
- o **B/L de carga solta (.pdf, .docx)**, o documento avulso do armador, um arquivo por B/L.

::: lado
1. Em **BLs**, clique em **Importar** › **Manifesto de carga solta (BB)**.
2. Em **Viagem de destino**, escolha a Viagem.
3. Em **Formato numérico do arquivo**, deixe **Detectar pelo arquivo** ou diga se o arquivo usa vírgula ou ponto decimal.
4. Escolha a planilha.
5. Confira a prévia e clique em **Importar N B/Ls**.

::: tela manifesto-bb-previa
A prévia do Manifesto BB.
:::
:::

O B/L avulso segue o mesmo caminho, pela opção **B/L de carga solta (.pdf, .docx)**.

Na carga solta, o peso é o que mais pesa na cobrança. Por isso o Vela é rigoroso com ele: no Manifesto BB, peso ausente é erro, e um número como "259.312", que pode ser milhar ou decimal, é recusado até você declarar o formato no passo 3.

::: atencao
- O B/L de carga solta já faturado só muda peso, volumes ou rota com a sua confirmação na prévia.
- O CE Mercante não entra por aqui, mesmo que a planilha tenha a coluna: ele vem pela planilha de CE ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)).
- O B/L do arquivo que está cancelado em outra Viagem fica de fora, e o resto entra. Para importá-lo nesta Viagem, o {{Administrativo}} exclui o B/L na outra Viagem e você importa de novo ([6.9](#69-trocar-o-bl)).
:::

## 6.5 Importar o CE Mercante e emitir as faturas

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

O CE Mercante é o número de 15 algarismos do conhecimento eletrônico de cada B/L no Mercante. Ele é o que libera o B/L: sem CE, não sai fatura e o Cliente não vê o B/L no Portal. Por isso, logo depois de gravar a planilha, a própria janela já emite as faturas.

Cada planilha corresponde a um Manifesto Mercante, que é de uma rota (porto de embarque → porto de descarga). Os B/Ls precisam estar importados antes: o CE nunca cria B/L.

::: lado
1. Em **BLs**, clique em **Importar** › **CE Mercante**.
2. Em **Nº de Manifesto Mercante**, digite os 13 caracteres do manifesto.
3. Escolha a planilha, com as colunas **BL** e **CE MERCANTE**.
4. Confira a prévia e clique em **Importar N CEs**.

::: tela ce-previa
A planilha de CE do manifesto de Vitória, pronta para importar.
:::
:::

::: lado
5. Se algum B/L já tinha outro CE, a janela mostra a troca e pede confirmação com motivo. Sem troca, grava direto.
6. Espere a emissão das faturas terminar, sem fechar a janela, e clique em **Concluir**.

::: tela ce-resultado
O resultado da emissão das faturas.
:::
:::

O resultado diz o que aconteceu com cada B/L:

| No resultado | Quer dizer | O que fazer |
|---|---|---|
| **faturados** | A fatura saiu. | Nada. |
| **retidos** | O Cliente ainda não tem o Portal ativo nem Liberação de faturamento. | Peça a ativação do Portal (capítulo 14). A fatura sai sozinha depois. |
| **aguardando** | Falta conciliar o Cliente, terminar a Revisão ou cadastrar a tabela de cobrança. | Falta conciliar o Cliente ou terminar a Revisão: a fatura sai sozinha depois. Falta a tabela de cobrança: cadastre-a e importe a mesma planilha de novo ([20.8](20-alertas.md#208-faturamento-e-taxas-locais)). |
| **nada a faturar** | O B/L não tem taxa a cobrar, ou é isento. | Confira as Taxas Locais, se esperava cobrança. |
| **bloqueados** | Falha técnica na emissão. | O Vela abre um alerta para a Documentação e tenta de novo sozinho. |
| **pulados** | Alguém cancelou a última fatura do B/L. | Se a fatura deve sair, use **Emitir** na ficha do B/L. |

No exemplo, o CSC45810A01K00 foi faturado; o CSC45810B01K00 ficou retido, porque o Cliente ainda não tem o Portal ativo; e o CSC45810A03K00 ficou aguardando, porque ainda não tem Cliente.

::: atencao
- O Excel tira os zeros à esquerda de um número, e o CE perde algarismos. Formate a coluna CE como texto antes de digitar.
- Um erro em qualquer linha bloqueia a planilha inteira. Planilha com B/Ls de duas rotas também é recusada: separe por manifesto.
- Se a emissão parar no meio, use **Retomar emissão** ou importe a mesma planilha de novo. Não sai fatura em dobro.
:::

## 6.6 Corrigir o CE ou o manifesto de um B/L

**Quem faz:** {{Qualquer equipe}}

O CE é documento oficial, então toda correção pede um motivo e fica no histórico do B/L. Há dois caminhos:

- **Vários B/Ls:** importe a planilha de CE com o número certo ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)). A janela mostra cada troca e pede confirmação e motivo.
- **Um B/L:** na ficha do B/L, aba **Detalhes do B/L**, no bloco **Documento Mercante**, use **Corrigir CE** ou **Remover CE**.

Para mudar o B/L de manifesto, use o mesmo bloco da ficha ou, para vários B/Ls, **Ver B/Ls** em **Rotas e Manifestos** ([4.6](04-viagens-escalas.md#46-rotas-e-manifestos)).

Trocar o CE não muda a fatura já emitida.

::: atencao
- O CE de um B/L com fatura emitida não pode ser removido, só corrigido. Para removê-lo, o {{Administrativo}} cancela a fatura antes.
- Se o B/L já tinha o Desbloqueio de CE conferido, a troca do CE abre um alerta para a Documentação, porque o desbloqueio precisa ser conferido de novo (capítulo 12).
:::

## 6.7 Importar o Baplie

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

O Baplie é o plano de carga do navio: diz quais containers estão a bordo, cheios ou vazios, para que porto vão e com que marcas. As marcas são três: **IMO** (carga perigosa), **OOG** (carga fora de medida) e **SOC** ou **COC** (container do Cliente ou do armador).

O Baplie e o B/L se completam. O Baplie é a fonte da carga física, o que está a bordo; o B/L é a fonte documental, de quem é a carga e quem paga. Por isso o Baplie confere a carga com os B/Ls e leva as marcas aos containers deles, mas não cria B/L, nem container de B/L, nem escala.

::: lado
1. No menu, abra **Importação** › **Baplie EDI** e escolha a Viagem.
2. Clique em **Importar Baplie EDI** (ou **Reimportar Baplie**, se ela já tem um).
3. Confira a **Viagem de destino** e escolha o arquivo.
4. Em **Portos de descarga a importar**, deixe marcados só os portos desta operação.
5. Clique em **Importar N containers**.

::: tela baplie-previa
A prévia do Baplie da COSCO SHIPPING SEREIA / 024E.
:::
:::

O Vela confere o navio do arquivo com o da Viagem e recusa o Baplie de outro navio. Os portos de descarga são conferidos com as escalas da Viagem: por isso convém planejar as escalas antes (capítulo 4).

Quando a Viagem já tem Baplie e o arquivo novo é diferente, a janela **Substituir o Baplie da viagem** mostra o que entra, o que sai e o que muda antes de gravar.

::: atencao
- O porto brasileiro que ainda não é escala aparece desmarcado. Se o navio vai mesmo a esse porto, crie a escala na Viagem.
- A marca IMO ou OOG corrigida à mão na ficha do B/L vale mais que o Baplie: o Baplie nunca a troca, e a diferença aparece como divergência.
:::

## 6.8 Resolver as divergências entre Baplie e B/L

**Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.

Depois do Baplie, o Vela confere cada container cheio a bordo com os B/Ls da Viagem. Quando eles não batem, a Viagem fica **Divergente** e o bloco **Conciliação Baplie × B/L**, em **Baplie EDI**, lista as divergências por grupo. A conciliação não muda nada sozinha: ela mostra onde o físico e o documental não batem, e quem decide é você, depois de confirmar com o armador.

::: tela baplie-conciliacao
A conciliação da Viagem 024E: um container cheio a bordo sem B/L.
:::

| Grupo | Quer dizer | O que fazer |
|---|---|---|
| **No Baplie, sem B/L** | Container cheio a bordo sem documento. | Peça o B/L ao armador. A divergência some quando ele é importado. |
| **Em B/L, fora do Baplie** | O B/L declara um container que não está a bordo. | Confirme o embarque. Se embarcou, peça o Baplie corrigido. |
| **Cheio no B/L, vazio no Baplie** | Os dois discordam sobre a carga. | Confirme com o armador qual está certo e corrija o documento errado. |
| **SOC/COC diverge** ou **IMO/OOG manual diverge** | O B/L e o Baplie dão marcas diferentes. Vale o B/L. | Se o B/L está certo, use **Vale o B/L**; se não, corrija na ficha do B/L. |

**Vale o B/L** encerra uma divergência de marca: clique nele na linha da divergência, escreva o motivo (o que o armador confirmou) e confirme. O motivo fica no histórico.

## 6.9 Trocar o B/L

**Quem faz:** {{Administrativo}} exclui ou cancela o B/L antigo; {{Qualquer equipe}} importa o novo.

O número do B/L existe uma vez só no Vela, mesmo cancelado, e a importação nunca muda a Viagem de um B/L. Por isso, trocar um B/L é sempre tirar o antigo e importar o novo.

### O armador reemitiu o B/L com outro número

1. Se o B/L antigo **não tem CE**, o {{Administrativo}} o exclui na lista **BLs**.
2. Se ele **tem CE**, não se exclui: o {{Administrativo}} o cancela, em **Mais ações › Cancelar B/L** na ficha. Antes, resolva a fatura ou o pagamento em aberto. O cancelamento libera o CE para o B/L novo.
3. Importe o B/L novo ([6.2](#62-importar-os-bls-de-container)) e depois a planilha de CE com o CE nele ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)).

### O B/L foi importado na Viagem errada

1. O {{Administrativo}} exclui o B/L na Viagem errada.
2. Importe o arquivo de novo na Viagem certa e, se ele já tinha CE, a planilha de CE também.

::: atencao
- Cancelar não libera o número: para importar o B/L em outra Viagem, ele precisa ser excluído.
- Só se exclui o B/L sem CE e que nunca teve fatura. Por isso, confira a Viagem antes de importar o CE: é ele que libera a fatura.
:::

## 6.10 Quando algo fica parado depois da importação

**Quem faz:** {{Qualquer equipe}}

Alguns passos acontecem logo depois da gravação, sozinhos: aplicar as marcas do Baplie, calcular as Taxas Locais, faturar pelo CE. Normalmente você nem percebe. Quando um deles falha por um motivo técnico, abre o alerta **Efeito de importação bloqueado** (capítulo 20). Para destravar:

1. Em **Alertas**, abra o alerta e clique em **Reprocessar**. A janela mostra o motivo do bloqueio. Quando a causa é técnica, ele diz "Falha técnica ao executar o passo." e guarda o texto do sistema em **Detalhe técnico**: copie-o se precisar avisar o suporte técnico.
2. Corrija a causa (por exemplo, o câmbio que faltava). A falta de tabela de cobrança não bloqueia: o passo espera; depois de cadastrar a tabela de cobrança, importe de novo a planilha de CE ([20.8](20-alertas.md#208-faturamento-e-taxas-locais)).
3. Escreva o que você corrigiu e clique em **Reprocessar**.

O alerta fecha sozinho quando o passo conclui.

Duas situações parecem problema, mas são o caminho normal:

- **O B/L ficou Pendente na Revisão.** O B/L com algo a conferir (Cliente não vinculado, peso faltando) espera na Revisão (capítulo 8), e a fatura dele espera junto.
- **O Cliente não vê o B/L no Portal.** O B/L só aparece no Portal depois do CE Mercante.

::: atencao
Se a importação foi recusada com "Taxas Locais do B/L … não calculadas", quase sempre falta o câmbio do dia. Espere a cotação do dia ou peça ao {{Financeiro}} para informá-la, e importe de novo.
:::

## 6.11 Outras importações

Outras importações seguem o mesmo molde (Arquivo, Prévia e Resultado) e estão no capítulo de cada assunto:

| Importação | Onde fica | Capítulo |
|---|---|---|
| Programação de navios | **Chegadas e Saídas**, **Importar programação** | 5 |
| Datas de descarga e devolução dos containers | **Containers**, **Importar datas** | 9 |
| Veículos | **Veículos**, **Importar veículos** | 10 |
| Vazios de importação | **Vazios IMP**, **Importar planilha** | 10 |
| Embarque de vazios | **Vazios EXP**, dentro do embarque, **Importar planilha** | 10 |
| Granito | **Granito**, **Importar planilha COSCO** | 10 |
| Arquivo da ZPT | **Desbloqueio de CE**, **Conciliar com a ZPT** | 12 |
| Base de Clientes | **Clientes**, **Importar base** | 13 |

Os vazios que o Baplie traz também podem ser cadastrados direto pela página **Baplie EDI**, no bloco **Vazios de importação** (capítulo 10).
