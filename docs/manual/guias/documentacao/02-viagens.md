Tudo no Vela se pendura numa Viagem: a passagem de um navio pelos portos brasileiros. Toda importação é feita para uma Viagem, que precisa existir antes do arquivo. Manual: capítulos 4, 5 e 11.

## 2.1 Viagens

A lista mostra os navios na ordem em que chegam, o mais próximo primeiro. Antes de criar uma Viagem, procure: ela pode já ter vindo da programação de navios.

::: tela viagens-topo
O menu Viagens e o botão Nova Viagem.
:::

::: passos
1. **Viagens**, no menu, abre a lista. Use os filtros de período e de status para ver, por exemplo, os navios dos próximos 7 dias.
2. **Nova Viagem** cadastra uma Viagem (seção 2.2).
:::

Cada Viagem traz o sinal de **Conciliação**: **Conciliada** (nada falta), **Pendente** (falta CE Mercante em algum B/L) ou **Divergente** (o Baplie e os B/Ls não batem, seção 3.4).

Clique na Viagem para abrir a ficha. As abas: **Visão geral** (as escalas e a Linha do tempo), **Importação** (a carga e os atalhos para importar já com a Viagem escolhida), **Exportação**, **Rotas e Manifestos** e **ADR**.

## 2.2 Nova Viagem e escalas

::: lado
1. Em **Viagens**, clique em **Nova Viagem**.
2. Preencha **Navio**, **IMO** e **Numero da viagem**. O armador já vem preenchido.
3. Para os Clientes verem o navio na programação do Portal, ligue **Aparece em Chegadas e Saídas**.
4. Clique em **Cadastrar viagem**.
::: tela nova-viagem
A janela Nova Viagem preenchida.
:::
:::

Depois, diga por quais portos ela passa. Cada porto brasileiro é uma **escala**:

::: passos
1. Na ficha, aba **Visão geral**, bloco **Planejamento por escala**, clique em **Adicionar escala**.
2. Digite o código do porto, como BRSSA (Salvador) ou BRVIX (Vitória), informe o **ETA** e escolha a **Operação da escala**.
3. Clique em **Adicionar escala**. Repita para cada porto.
:::

O terminal de cada operação e as datas do berço ficam no lápis da escala, em **Terminais e atracações**; normalmente quem os mantém é {{Operações}}. A escala também nasce sozinha quando um arquivo de B/L traz carga para aquele porto.

## 2.3 Chegadas e Saídas

É a programação que o Cliente vê no Portal: para cada navio publicado, quando sai da origem e quando chega a cada porto brasileiro. Abre pelo atalho no alto do **Painel** ou de **Viagens**.

::: tela chegadas-saidas
Chegadas e Saídas: a saída de Shanghai já passou e aparece em âmbar, com o botão de confirmar.
:::

::: passos
1. **Adicionar navio** publica um navio que ainda não está no quadro: preencha o navio, a viagem (VOY) e o **IMO**, desmarque **Não escala** nos portos que ele faz, informe as datas e clique em **Adicionar e publicar**.
2. A data em âmbar já passou e ninguém confirmou: o botão ao lado confirma a saída ou a chegada.
3. O lápis abre as datas do navio para corrigir.
:::

A data é uma só: mudá-la aqui muda a Viagem, o Line Up e o Portal.

## 2.4 Rotas e Manifestos

A aba **Rotas e Manifestos** da Viagem organiza os B/Ls por rota, do porto de embarque (POL) ao de descarga (POD). Cada rota guarda o número do **Manifesto Mercante**, o mesmo que você informa ao importar a planilha de CE (seção 3.5). Para mover B/Ls de um manifesto a outro, use **Ver B/Ls** na rota.

## 2.5 ADR de Saída

Quando o navio sai de um terminal, cada equipe confere e assina a sua parte do ADR de Saída. A da {{Documentação}} são as seções **Carga descarregada** e **Vazios descarregados**. O prazo é de 72 horas depois da saída.

::: lado
1. Na ficha da Viagem, abra a aba **ADR**.
2. Em **Escala**, clique no porto.
3. Em **Terminal**, escolha o terminal.
4. Em cada seção da Documentação, confira o conteúdo, clique em **Alterar**, escolha **Confirmado** (ou **Nada a declarar**) e clique em **Confirmar**.
5. Com as duas seções resolvidas, clique em **Assinar Documentação** e confirme.
::: tela adr-terminal
O ADR do terminal TVV na escala de Vitória.
:::
:::

Os números vêm de onde foram registrados: se algo está errado, corrija na origem (o B/L, os Vazios IMP) e o ADR mostra a correção.
