Depois da importação, cada B/L precisa de três coisas para faturar: o Cliente certo, o Portal desse Cliente pronto e, na carga solta, o peso. O que a importação não resolveu sozinha vai para a **Revisão**. Manual: capítulos 7 e 8.

## 4.1 Ficha do B/L

A ficha abre pelo número do B/L, em **BLs**, na **Revisão** ou em qualquer tela que mostre o B/L.

::: tela bl-ficha
A ficha de um B/L já faturado.
:::

::: passos
1. O cabeçalho: modalidade, Viagem, trecho, CE Mercante e Cliente. **Reimportar B/L** fica aqui.
2. A **Próxima ação** aparece quando falta uma etapa e leva aonde ela se resolve.
3. O trilho **Operacional** acompanha o navio e a carga.
4. O trilho **Documental** mostra as etapas até a fatura: **Cliente**, **Taxas Locais**, **CE Mercante** e **Fatura**.
5. As abas: **Visão geral**, **Carga**, **Detalhes do B/L**, **Faturamento** e **Histórico**.
:::

Para corrigir o que veio errado no arquivo, abra **Detalhes do B/L**, corrija os campos, escreva a **Justificativa da alteração**, clique em **Salvar alterações** e confirme. Se o armador mandou um arquivo novo, prefira **Reimportar B/L**. Tudo fica no **Histórico**, com o antes, o depois e quem mudou.

## 4.2 Revisão

A fila dos B/Ls que ainda não podem faturar. O B/L entra com uma de três pendências e sai sozinho quando a última se resolve.

| Pendência | Quer dizer | Seção |
|---|---|---|
| **Sem cliente vinculado** | O CNPJ do consignatário não é de nenhum Cliente. | 4.3 |
| **Portal não provisionado** | O Cliente ainda não tem o Portal ativo. | 4.4 |
| **Peso da carga solta ausente** | O B/L de carga solta está sem peso. | 4.4 |

::: tela revisao-fila
A Revisão, com um Cliente ainda sem cadastro e outro esperando o Portal.
:::

::: passos
1. Os cartões contam as pendências e filtram a fila ao toque.
2. **Buscar** acha pelo B/L, Cliente ou CNPJ; **Navio / viagem** recorta por Viagem.
3. Cada linha é um Cliente, com os seus B/Ls e a **Próxima ação**. A seta abre o grupo.
:::

A fila agrupa os B/Ls pelo CNPJ: um cadastro resolve todos os B/Ls do grupo de uma vez.

## 4.3 Cadastrar ou vincular o Cliente

::: lado
1. Na linha do Cliente, clique na seta para abrir o grupo.
2. No bloco **Cadastrar o cliente**, confira o CNPJ lido e escolha **Cadastrar novo cliente** ou **Vincular a um cliente cadastrado**.
3. Para cadastrar, confira **Razão social**, **CNPJ** e **E-mail principal**, que vêm do B/L. Em **Portal do Cliente**, escolha **Enviar o convite agora**.
4. Clique em **Cadastrar e vincular** (ou **Vincular N B/Ls**) e confirme.
::: tela revisao-cadastrar
O grupo de um Cliente novo, com o CNPJ lido no B/L.
:::
:::

O cadastro grava o Cliente, o e-mail como contato principal, e vincula todos os B/Ls do grupo. O B/L passa a **Portal não provisionado** até o Cliente ativar a conta.

::: atencao
Uma **Sugestão por nome** nunca vincula sozinha: pode ser outra empresa de nome parecido. Confira o CNPJ antes de clicar em **Usar a sugestão**.
:::

## 4.4 Convidar para o Portal e informar o peso

A fatura só sai com o Portal do Cliente ativo, porque é lá que ele a vê e paga.

::: passos
1. Abra o grupo do Cliente. O bloco **Portal do Cliente** mostra a situação da conta e o **E-mail para o convite**.
2. Se o e-mail não é o certo, clique em **Usar outro e-mail** e digite o novo.
3. Clique em **Autorizar e enviar convite** e confirme em **Enviar convite**.
:::

Quando o Cliente define a senha, a conta fica **Ativa**, os B/Ls saem da fila e as faturas retidas saem sozinhas. O acompanhamento do convite está na seção 5.4.

Na pendência **Peso da carga solta ausente**, abra o grupo e, no bloco **Informar o peso da carga solta**, digite o peso em toneladas em **Peso (t)**, com vírgula decimal. Tecle Enter, confira o antes → depois e clique em **Salvar correção**.
