Só quando a consulta do Itaú para: sem ela, nenhum Pix dá baixa sozinho. O Vela lê o relatório do Itaú e acha a fatura pelo identificador de cada linha; o CNPJ e o valor só conferem.

::: passos
1. No Itaú, baixe o relatório "QR Codes recebidos", em .xlsx ou .xls.
2. Em **Conciliação PIX** › **Conciliar extrato**, escolha o arquivo. A leitura não baixa nada.
3. Confira a **Conferência do extrato**: **Prontas para baixa** são as linhas com uma fatura só e o valor certo.
4. Clique em **Confirmar N baixas**.
:::

O lote é tudo ou nada: se uma linha é recusada, nenhuma entra. O mesmo Pix nunca é baixado duas vezes, mesmo que você leia o arquivo de novo.

A linha que não pôde ser baixada vai para **Pendências** › **Exceções do extrato**, com o motivo. Ela se encerra pela própria linha: **Tentar de novo**, ou a seta, que mostra as faturas que aceitam aquele identificador, e **Baixar nesta fatura**.

::: atencao
Não baixe por outro caminho uma fatura que tem exceção do extrato: a exceção fica em **Pendências**, com o alerta aberto, sem botão que a feche.
:::
