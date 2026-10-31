A escala se divide em **frentes de operação**: carga cheia, carga solta e vazios na importação; Granito e vazios na exportação. Os veículos seguem a carga cheia. Cada frente recebe o seu terminal, e cada terminal vira uma **Atracação**, com as datas do berço.

::: tela escala-terminais
A frente de carga cheia no terminal TVV, com o ETB e o ETD.
:::

::: passos
1. No **Planejamento por escala**, clique no lápis da escala.
2. Em **Terminais e atracações**, escolha o terminal de cada frente.
3. No cartão de cada terminal, informe o **ETB** e o **ETD**, com data e hora.
4. Clique em **Salvar escala**.
:::

::: sozinho
- O terminal da frente vale para cada B/L da escala: é ele que decide o ADR de Saída e o Aviso de Atracação do B/L.
- O ETB e o ETD chegam ao Line Up, ao Portal e aos avisos ao Cliente.
:::

Escala que também embarca? Na mesma janela, em **Operação da escala**, escolha **Importação + exportação** e marque **Granito** ou **Embarque de vazios**.

Frente sem terminal fica **TBC** ("terminal a confirmar"). A carga que chega depois desta etapa (vazios, carga solta, Granito) cria frente nova em **TBC — pendente**: volte aqui e escolha o terminal dela, senão ela fica fora do ADR de Saída e trava o **Fechar ADR**. Depois do ATA, a escala só grava com terminal em toda frente.
