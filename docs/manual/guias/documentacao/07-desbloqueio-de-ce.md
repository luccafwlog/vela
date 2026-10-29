Para retirar a carga, o Cliente precisa do CE desbloqueado na ZPT. O Cliente pede pelo Portal; a agência confere os documentos, registra o B/L original e envia à ZPT a planilha dos B/Ls prontos, dentro do prazo. Manual: capítulo 12.

## 7.1 Os quatro requisitos

O Cliente abre uma **solicitação** no Portal (protocolo "CE-…"), com os B/Ls que já têm CE. Cada B/L precisa de quatro requisitos:

| Requisito | Quem cumpre | Como o Vela sabe |
|---|---|---|
| **Taxas locais** | O Cliente paga | Pela baixa do pagamento |
| **Termo de devolução** | O Cliente anexa | Você aprova (seção 7.3) |
| **Procuração** | O Cliente anexa | Você aprova (seção 7.3) |
| **B/L original** | O Cliente entrega na agência | Você marca (seção 7.4) |

Com os quatro, a solicitação fica **Documentação validada** e o B/L fica apto para a ZPT.

## 7.2 A tela Desbloqueio de CE

Em **Importação** › **Desbloqueio de CE**, a aba **Solicitações** é a fila dos pedidos com documento por analisar, o mais antigo primeiro. A aba **Andamento dos B/Ls** mostra todo B/L com CE e em que pé está cada requisito.

::: tela desbloqueio-andamento
O Andamento dos B/Ls, com os B/Ls que já têm CE.
:::

::: passos
1. Os cartões filtram a lista. **Aptos, não exportados** é a fila do envio à ZPT.
2. **Buscar** aceita vários números de B/L ou CE colados de uma vez.
3. A coluna **B/L original** registra a entrega (seção 7.4).
4. **Conciliar com a ZPT** traz de volta o que a ZPT fez (seção 7.7).
:::

## 7.3 Analisar os documentos

::: passos
1. Em **Solicitações**, clique no protocolo da solicitação.
2. No bloco **Documentos**, clique em **Analisar** na linha do termo de devolução ou da procuração.
3. Clique em **Abrir** e confira o documento.
4. Clique em **Aprovar termo de devolução** (ou **Aprovar procuração**) e confirme.
:::

Se houver o que corrigir, clique em **Recusar…**, escreva em **O que o cliente precisa corrigir** e clique em **Recusar documento**. O Cliente recebe o motivo como você escreveu e reenvia.

## 7.4 Registrar a entrega do B/L original

::: passos
1. Em **Andamento dos B/Ls**, busque o B/L.
2. Marque a caixa na coluna **B/L original**.
3. Clique em **Registrar entrega**.
:::

Para vários B/Ls, marque-os na primeira coluna e clique em **Registrar entrega de N B/Ls**.

## 7.5 O prazo

O prazo é da agência, para enviar o B/L à ZPT. Ele começa quando o último requisito é cumprido e conta só dias úteis:

| Quando o prazo começa | Quando vence |
|---|---|
| Dia útil, antes das 12h | Às 17h do mesmo dia |
| Dia útil, a partir das 12h | Às 12h do dia útil seguinte |
| Sábado ou domingo | Segunda-feira, às 12h |

O Cliente vê o mesmo prazo no Portal. O que cumpre o prazo é a exportação (seção 7.6).

## 7.6 Exportar para a ZPT

::: passos
1. Em **Andamento dos B/Ls**, clique no cartão **Aptos, não exportados**.
2. Marque os B/Ls. A caixa do cabeçalho marca todos os do filtro.
3. Clique em **Exportar N aptos para a ZPT** e confirme. Cabem até 100 B/Ls por planilha.
4. Importe o arquivo baixado, desbloqueio-ce-zpt.xlsx, na aba "Planilha desbloqueio" da ZPT.
:::

Os B/Ls passam a mostrar "Exportado" com a data. As planilhas ficam em **Planilhas enviadas à ZPT**.

## 7.7 Conciliar com a ZPT

Exportar não prova o desbloqueio. Para saber o que a ZPT fez:

::: passos
1. Na ZPT, use **Exportar Tela** e guarde o arquivo como veio.
2. Em **Andamento dos B/Ls**, clique em **Conciliar com a ZPT** e escolha o arquivo.
3. Confira a **Prévia** e clique em **Conciliar N CEs**.
:::

O CE desbloqueado vira **Desbloqueado**. O que continua bloqueado vira **Divergente**: passe o mouse para ver o que a ZPT diz que falta, resolva e exporte de novo pelo cartão **Divergentes na ZPT**.
