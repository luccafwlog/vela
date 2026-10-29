A documentação chega do armador em arquivos: o B/L de cada carga, o manifesto da carga solta, o Baplie e a planilha de CE Mercante. Cada um entra por uma importação que lê o arquivo, mostra numa prévia o que vai mudar e só grava quando você confirma. Manual: capítulos 6 e 10.

## 3.1 Como toda importação funciona

Há três portas, e todas abrem as mesmas janelas: a lista **BLs**, no botão **Importar**; a ficha da Viagem, aba **Importação**, no bloco **Importação rápida**; e a página **Baplie EDI**.

::: passos
1. No menu, abra **Importação** e clique em **BLs**. No alto da lista, clique em **Importar**.
2. Escolha o tipo de arquivo.
:::

::: tela bls-importar-menu
A lista BLs com o menu Importar aberto.
:::

Toda janela segue três etapas: **Arquivo**, **Prévia** e **Resultado**. Na prévia, **Erro** impede a importação (o arquivo inteiro fica de fora, nunca pela metade) e **Aviso** só pede que você confira. Nada é gravado antes de você confirmar.

A ordem do dia a dia: os **B/Ls de container** e a **carga solta** primeiro; depois o **Baplie** e a planilha de **veículos** (que {{Equipamentos}} importa); por último, o **CE Mercante**.

## 3.2 B/Ls de container

O arquivo é a planilha do B/L no layout da COSCO, um B/L por arquivo; você pode escolher vários de uma vez.

::: lado
1. Em **BLs**, clique em **Importar** › **B/L de contêiner (.xlsx)**.
2. Em **Navio / Viagem**, escolha a Viagem.
3. Escolha os arquivos dos B/Ls.
4. Confira a **Prévia**: uma linha por B/L, com **Cria**, **Atualiza** ou **Erro**, a rota e o consignatário.
5. Clique em **Importar N B/Ls** e, no resultado, em **Concluir**.
::: tela importar-bl-previa
A prévia de três B/Ls de container.
:::
:::

::: sozinho
- O Cliente é vinculado pelo CNPJ do consignatário. Se o CNPJ ainda não é de um Cliente, o B/L entra sem Cliente e vai para a **Revisão** (seção 4.2); a prévia avisa em âmbar.
- As Taxas Locais são calculadas na hora, com o preço do dia da importação.
- Nenhuma fatura sai ainda: ela espera o CE Mercante.
:::

Se o armador mandar o B/L corrigido, use **Reimportar B/L** na ficha do B/L.

## 3.3 Carga solta

A carga sem container (máquinas, volumes) chega no **Manifesto de carga solta (BB)**, uma planilha com vários B/Ls, ou no B/L avulso do armador.

::: passos
1. Em **BLs**, clique em **Importar** › **Manifesto de carga solta (BB)** (ou **B/L de carga solta (.pdf, .docx)**).
2. Escolha a **Viagem de destino**.
3. Em **Formato numérico do arquivo**, deixe **Detectar pelo arquivo**.
4. Escolha o arquivo, confira a prévia e clique em **Importar N B/Ls**.
:::

Na carga solta o peso é o que mais pesa na cobrança: no manifesto, linha sem peso é erro; o B/L avulso sem peso vai para a Revisão (seção 4.4).

## 3.4 Baplie EDI

O Baplie é o plano de carga do navio: diz o que está a bordo e marca os containers de carga perigosa (IMO) e fora de medida (OOG). Ele confere a carga com os B/Ls, mas não cria B/L.

::: lado
1. No menu, abra **Importação** › **Baplie EDI** e escolha a Viagem.
2. Clique em **Importar Baplie EDI** (ou **Reimportar Baplie**).
3. Confira a **Viagem de destino** e escolha o arquivo.
4. Em **Portos de descarga a importar**, deixe marcados os portos desta operação.
5. Clique em **Importar N containers**.
::: tela baplie-previa
A prévia do Baplie.
:::
:::

Depois da importação, o bloco **Conciliação Baplie × B/L**, na mesma página, lista o que não bate: container a bordo sem B/L, B/L com container fora do Baplie ou marcas diferentes. Sem divergência, a Viagem fica **Conciliada**. Com divergência, confirme com o armador e peça o documento que falta; a divergência some quando o documento certo é importado.

## 3.5 CE Mercante

O CE é o número de 15 algarismos de cada B/L no Mercante, e é ele que libera o B/L: com o CE, a fatura sai e o Cliente vê o B/L no Portal. Cada planilha é um Manifesto Mercante, de uma rota só, e os B/Ls precisam estar importados antes.

::: lado
1. Em **BLs**, clique em **Importar** › **CE Mercante**.
2. Em **Nº de Manifesto Mercante**, digite os 13 caracteres do manifesto.
3. Escolha a planilha, com as colunas **BL** e **CE MERCANTE**.
4. Confira a prévia e clique em **Importar N CEs**.
::: tela ce-previa
A planilha de CE de um manifesto, pronta para importar.
:::
:::

::: lado
5. Se algum B/L já tinha outro CE, a janela pede confirmação com motivo.
6. Espere a emissão das faturas terminar, sem fechar a janela, e clique em **Concluir**.
::: tela ce-resultado
O resultado da emissão das faturas.
:::
:::

| No resultado | Quer dizer |
|---|---|
| **faturados** | A fatura saiu. Nada a fazer. |
| **retidos** | O Cliente ainda não tem o Portal ativo: convide-o (seção 5.4). A fatura sai sozinha na ativação. |
| **aguardando** | Falta o Cliente ou a Revisão (seção 4.2). A fatura sai sozinha quando a pendência se resolve. |

::: atencao
Formate a coluna do CE como texto no Excel antes de digitar: o Excel apaga os zeros à esquerda e o CE perde algarismos.
:::

## 3.6 Containers, Veículos e Vazios IMP

- **Containers** lista os containers de todos os B/Ls. Escolha a Viagem e busque pelo container, lacre, B/L ou Cliente; o número do B/L abre a ficha.
- **Veículos** recebe a planilha de veículos do armador, ligada aos B/Ls e containers; quem importa na rotina é {{Equipamentos}}. Viagem sem veículos: **Esta viagem não terá veículos**.
- **Vazios IMP** recebe os containers vazios que o navio descarrega. Clique em **Importar planilha**, escolha a **Viagem de destino** e o arquivo e informe o **Nº do manifesto Mercante** de cada rota. Sem a planilha, o Baplie oferece **Cadastrar N vazios**.
