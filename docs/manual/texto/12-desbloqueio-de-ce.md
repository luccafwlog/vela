Para retirar a carga, o Cliente precisa do CE Mercante desbloqueado. Quem desbloqueia é a ZPT, sozinha, quando as quatro condições da carga estão marcadas lá. O Vela controla essas quatro condições B/L a B/L e gera a planilha que alimenta a ZPT. O Cliente pede pelo Portal ([15.7](15-portal-o-que-o-cliente-ve.md#157-o-desbloqueio-de-ce-pelo-portal)); neste capítulo, você faz a parte da agência: confere os documentos, registra o B/L original, exporta para a ZPT dentro do prazo e confere o que a ZPT fez.

::: aprende
- os quatro requisitos e como ler a tela Desbloqueio de CE;
- analisar o termo de devolução e a procuração, aprovar ou pedir correção;
- registrar a entrega do B/L original;
- o prazo da agência e a exportação para a ZPT;
- conciliar com a ZPT;
- atender o Cliente VIP e os documentos anuais;
- cancelar uma solicitação e o que fazer quando algo muda depois do pedido.
:::

## 12.1 Entender o Desbloqueio de CE

**Quem faz:** {{Documentação}} e {{Administrativo}}. As outras equipes consultam tudo, inclusive os documentos, sem os botões de gestão.

O Cliente marca no Portal os B/Ls que quer desbloquear e abre uma **solicitação**, identificada por um protocolo que começa com "CE-". Só entra B/L que já tem CE e as Taxas Locais pagas. Cada B/L precisa de quatro requisitos:

| Requisito | Quem cumpre | Como o Vela sabe |
|---|---|---|
| **Taxas locais** | O Cliente paga | Pela baixa do pagamento. B/L isento também atende. |
| **Termo de devolução** | O Cliente anexa | A agência aprova ([12.3](#123-analisar-os-documentos-de-uma-solicitação)). |
| **Procuração** | O Cliente anexa | A agência aprova ([12.3](#123-analisar-os-documentos-de-uma-solicitação)). |
| **B/L original** | O Cliente entrega na agência | A agência marca ([12.4](#124-registrar-a-entrega-do-bl-original)). |

Só o B/L com os quatro vai para a planilha da ZPT.

A solicitação passa por estas situações: **Rascunho** (o Cliente ainda não enviou), **Enviado**, **Em análise** ou **Correção solicitada**, e **Documentação validada**, quando todos os B/Ls têm os quatro requisitos. Se um requisito cai depois, a validada volta a **Em análise**. A cancelada fica **Cancelado**.

::: atencao
- Taxas pagas quer dizer quitadas por inteiro, com a baixa registrada. Pagamento parcial não basta, e uma fatura avulsa do B/L em aberto também segura o requisito. A Demurrage não entra.
- Com o pagamento feito fora do Desbloqueio, o requisito fica verde na hora, mas a solicitação pode levar até 5 minutos para passar a **Documentação validada** ([19.7](19-rotinas-por-horario.md#197-o-desbloqueio-de-ce)).
:::

## 12.2 Ler a tela Desbloqueio de CE

**Quem faz:** {{Qualquer equipe}}

Em **Importação** › **Desbloqueio de CE**, a página tem duas abas.

**Solicitações** traz o bloco **Solicitações aguardando análise**: os pedidos enviados que ainda têm termo de devolução ou procuração por aprovar, o envio mais antigo primeiro. É a fila de trabalho da análise. As solicitações VIP nem passam por ela ([12.8](#128-atender-o-cliente-vip)).

**Andamento dos B/Ls** mostra todo B/L com CE, com ou sem solicitação. Os cartões filtram a lista: **Aptos, não exportados**, **Exportados, aguardando a ZPT**, **Divergentes na ZPT**, **Desbloqueados** e **B/Ls com CE**. Em cada linha, um ícone verde por requisito atendido, o **Prazo** ([12.5](#125-o-prazo-do-desbloqueio)) e a coluna **Na ZPT**, que diz em que pé o B/L está: **Apto, não exportado**, **Exportado** com a data, o que a ZPT disse na última conciliação (**Desbloqueado** ou **Divergente**, [12.7](#127-conciliar-com-a-zpt)) ou, em âmbar, um impedimento ([12.10](#1210-quando-algo-muda-depois-do-pedido)).

**Buscar** aceita vários números de B/L ou CE colados de uma vez. **Exportar planilha** baixa a lista do filtro, para qualquer equipe; ela não é a planilha da ZPT.

## 12.3 Analisar os documentos de uma solicitação

**Quem faz:** {{Documentação}} e {{Administrativo}}

O termo de devolução e a procuração são da solicitação, não de cada B/L: a sua decisão vale para todos os B/Ls dela.

1. Em **Solicitações**, clique no protocolo da solicitação.
2. No bloco **Documentos**, clique em **Analisar** (a lupa) na linha do termo de devolução ou da procuração.
3. Clique em **Abrir** com o nome do arquivo e confira o documento.
4. Clique em **Aprovar termo de devolução** (ou **Aprovar procuração**) e confirme. Se houver o que corrigir, clique em **Recusar…**, escreva em **O que o cliente precisa corrigir** e clique em **Recusar documento**.

A recusa leva a solicitação a **Correção solicitada**, e o Cliente recebe o motivo no sino do Portal e por e-mail, exatamente como você escreveu ([16.1](16-emails-e-comunicados.md#161-saber-para-quem-vai-cada-e-mail)). Ele anexa a versão nova e reenvia.

Aprovou por engano? No menu ⋮ do documento aprovado, use **Recusar aprovação**. É uma recusa como a outra: pede o motivo e avisa o Cliente.

::: atencao
"Documento ainda não reenviado pelo cliente" quer dizer que o Cliente anexou a versão nova, mas ainda não clicou em **Reenviar solicitação**. Espere o reenvio para analisar.
:::

## 12.4 Registrar a entrega do B/L original

**Quem faz:** {{Documentação}} e {{Administrativo}}

O Cliente entrega o B/L original na agência. Você marca a entrega no Vela, mesmo antes de existir solicitação.

1. Em **Andamento dos B/Ls**, busque o B/L.
2. Marque a caixa na coluna **B/L original**.
3. Clique em **Registrar entrega**.

Para vários B/Ls, marque-os na primeira coluna e clique em **Registrar entrega de N B/Ls**. Os que não gravarem continuam marcados, com o motivo.

Para desfazer uma marcação errada, clique de novo na caixa, escreva o motivo e clique em **Desmarcar entrega**. O B/L deixa de estar apto, e a solicitação validada volta a **Em análise**. Desmarcar é sempre um B/L por vez.

## 12.5 O prazo do desbloqueio

**Quem acompanha:** {{Documentação}}

O prazo é da agência, para enviar o B/L à ZPT. Ele só existe quando os quatro requisitos estão cumpridos e começa no último deles: o envio da solicitação, a aprovação de um documento, a entrega do original ou a baixa do pagamento. Faltando um, não há prazo em lugar nenhum, nem no Portal.

O prazo conta só dias úteis, de segunda a sexta:

| Quando o prazo começa | Quando vence |
|---|---|
| Dia útil, antes das 12h | Às 17h do mesmo dia |
| Dia útil, a partir das 12h | Às 12h do dia útil seguinte |
| Sábado ou domingo | Segunda-feira, às 12h |

Se a documentação da ATLANTICO IMPORTADORA LTDA fica completa numa sexta às 15h, o prazo vence na segunda às 12h. O Cliente vê o mesmo prazo no Portal e no aviso de documentação validada.

O prazo se cumpre com a exportação ([12.6](#126-exportar-os-bls-aptos-para-a-zpt)): depois dela, a coluna mostra só a data, e "Exportado no prazo" ou "Exportado fora do prazo" ao passar o mouse.

::: atencao
- Feriado conta como dia útil: o Vela não tem calendário de feriados.
- Se um requisito cai antes da exportação, o prazo some; quando ele é cumprido de novo, a contagem recomeça. Depois da exportação, o prazo fica parado; se você reexportar o B/L, a coluna **Prazo** passa a medir pela reexportação, que pode cair fora do prazo.
:::

## 12.6 Exportar os B/Ls aptos para a ZPT

**Quem faz:** {{Documentação}} e {{Administrativo}}

Exportar é o registro do envio à ZPT: é o que cumpre o prazo.

1. Em **Andamento dos B/Ls**, clique no cartão **Aptos, não exportados**.
2. Marque os B/Ls. A caixa do cabeçalho marca todos os do filtro, em todas as páginas.
3. Clique em **Exportar N aptos para a ZPT** e confirme. Cabem até 100 B/Ls por planilha.
4. Importe o arquivo baixado, desbloqueio-ce-zpt.xlsx, na aba "Planilha desbloqueio" da ZPT.

Os B/Ls passam a mostrar "Exportado" com a data. Cada planilha fica em **Planilhas enviadas à ZPT**; para corrigir, use **Reexportar**, que gera uma planilha nova com os requisitos de agora.

::: atencao
- Se um só B/L deixou de estar apto, por exemplo porque a baixa do pagamento foi cancelada, o Vela recusa o lote inteiro e diz qual B/L e por quê. Tire esse B/L e exporte de novo.
- Depois da exportação, a solicitação não pode mais ser cancelada, nem pelo Cliente nem pela agência.
:::

## 12.7 Conciliar com a ZPT

**Quem faz:** {{Documentação}} e {{Administrativo}}

Exportar não prova o desbloqueio. Para saber o que a ZPT fez, traga de volta a lista dela.

1. Na ZPT, use **Exportar Tela** e guarde o arquivo como veio (.xls, .xlsx ou .csv).
2. Em **Andamento dos B/Ls**, clique em **Conciliar com a ZPT** e escolha o arquivo.
3. Confira a **Prévia** e clique em **Conciliar N CEs**.

O CE que a ZPT mostra desbloqueado vira **Desbloqueado**, mesmo que o Vela não o tenha exportado. O B/L exportado que continua bloqueado vira **Divergente**; ao passar o mouse, você vê o que a ZPT diz que está pendente. Resolva o ponto e exporte o B/L de novo, pelo cartão **Divergentes na ZPT**.

A conciliação fica só na agência: não muda o prazo nem o que o Cliente vê.

::: atencao
Um único CE ilegível no arquivo, com menos ou mais de 15 dígitos, impede a conciliação inteira. Corrija o arquivo e escolha de novo.
:::

## 12.8 Atender o Cliente VIP

**Quem faz:** {{Documentação}} e {{Administrativo}}

O Cliente VIP manda o termo de devolução e a procuração uma vez por ano. Esses **documentos anuais** substituem os de cada pedido: a solicitação dele não passa pela análise. O pagamento e a entrega do original continuam B/L a B/L. O anual cobre todo B/L cujo desbloqueio foi pedido dentro da vigência dele, que termina sempre em 31/12, e segue cobrindo esse pedido depois de 31/12.

1. Na ficha do Cliente, aba **Desbloqueio de CE e VIP**, clique em **Habilitar condição VIP**, escreva o motivo e clique em **Habilitar VIP**.
2. O Cliente envia os anuais pelo Portal. Você também pode enviar por ele, em **Enviar termo de devolução** ou **Enviar procuração**.
3. No bloco **Documentos anuais**, clique em **Analisar** no documento, confira **Ano da cobertura** e **Início da vigência** e clique em **Aprovar termo de devolução** (ou **Aprovar procuração**). Para pedir outro documento, use **Solicitar correção**, com o motivo.

A solicitação nasce VIP só quando os anuais aprovados cobrem todos os B/Ls escolhidos; se um não está coberto, ela nasce comum, com termo e procuração anexados. A VIP fica **Enviado** até todos os B/Ls terem o pagamento e o original, e então passa sozinha a **Documentação validada**. Como não passa pela fila, você a encontra em **Andamento dos B/Ls**, pela coluna **Solicitação**; o Cliente VIP tem a marca "VIP" ao lado do nome. Se um anual foi revogado ou trocado no meio do caminho, abra a solicitação e use **Aplicar renovação VIP**.

::: atencao
- Anual enviado em dezembro e analisado em janeiro: a tela propõe o ano novo e o início no dia do envio, do ano anterior. Deixe **Ano da cobertura** e **Início da vigência** no mesmo ano, senão o Vela recusa com uma mensagem técnica.
- O Cliente não recebe aviso da análise do anual. Ele vê a situação no Portal, na aba **Documentos anuais**.
- **Revogar condição VIP** vale na hora também para as solicitações VIP em andamento: os B/Ls deixam de estar aptos. O Cliente pede de novo, numa solicitação comum, ou você cancela ([12.9](#129-cancelar-uma-solicitação)).
:::

## 12.9 Cancelar uma solicitação

**Quem faz:** {{Documentação}} e {{Administrativo}}

O Cliente só cancela a própria solicitação no rascunho ou na correção pedida. Depois disso, ele pede à agência.

1. Abra a solicitação e clique em **Cancelar pedido**.
2. Escreva o **Motivo do cancelamento** e confirme.

Os B/Ls ficam livres para uma nova solicitação. O Cliente vê a solicitação cancelada, com o motivo, mas não recebe aviso no sino nem por e-mail.

::: atencao
Na **Documentação validada**, **Cancelar pedido** não aparece; com algum B/L já exportado para a ZPT, ele fica apagado.
:::

## 12.10 Quando algo muda depois do pedido

**Quem faz:** {{Documentação}} e {{Administrativo}}

O Vela reconfere os requisitos sozinho: a baixa de um pagamento marca as taxas, uma baixa cancelada desmarca, e a solicitação validada volta a **Em análise** quando um requisito cai. Três mudanças no B/L pedem você, e aparecem em âmbar na coluna **Na ZPT**:

| Na ZPT | O que aconteceu | O que fazer |
|---|---|---|
| **CE alterado: reconferir** | O CE do B/L mudou depois do pedido. | Na solicitação, clique em **Reconferir CE** na linha do B/L, escreva **Como o CE foi conferido** e confirme. |
| **Cliente alterado** | O B/L passou a outro Cliente depois do pedido. | A solicitação antiga não vale mais para ele. Para o Cliente atual pedir, cancele a antiga ([12.9](#129-cancelar-uma-solicitação)); se ela já foi exportada para a ZPT, não se cancela, e o Cliente atual não consegue pedir esse B/L. |
| **Troca de Cliente** | O B/L trocou de Cliente com pagamento, e a troca ainda espera a devolução ao Cliente anterior e a nova cobrança. | Sai quando o {{Financeiro}} confirma a devolução e a fatura do novo Cliente é emitida ([18.4](18-o-que-muda-sozinho.md#184-vincular-ou-trocar-o-cliente-do-bl)). Daí, falta ele pagar. |

Depois de **Reconferir CE**, na solicitação comum, aprove de novo o termo e a procuração ([12.3](#123-analisar-os-documentos-de-uma-solicitação)); o B/L volta à fila de exportação e precisa ser exportado de novo. O B/L cancelado mostra "B/L cancelado" e não segue.

Trocar ou remover o CE de um B/L que a ZPT já mostrou desbloqueado abre um alerta para a {{Documentação}} (capítulo 20).
