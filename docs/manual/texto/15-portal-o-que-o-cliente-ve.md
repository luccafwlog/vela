O Cliente não vê o Vela: vê o Portal Fwlog, que lê os mesmos dados. Quando ele liga com uma dúvida, você precisa saber o que está na tela dele. Duas regras explicam quase tudo: o B/L só aparece para o Cliente depois do CE Mercante, e a fatura só depois de emitida. Como o Cliente ganha o acesso está no capítulo 14; o que fazer quando ele pede ajuda, no capítulo 17.

::: aprende
- ver o Portal de um Cliente como ele vê, pelo Modo Inspeção;
- como o Cliente entra e recupera a senha;
- o que aparece no Painel, em BLs e Containers e em Faturas;
- como o Cliente paga, contesta uma Demurrage e pede o Desbloqueio de CE;
- o que o Cliente muda sozinho no Perfil e os avisos que ele recebe no Portal.
:::

## 15.1 Ver o Portal como o Cliente vê

**Quem faz:** {{Todas as equipes}}

O **Modo Inspeção** abre o Portal de um Cliente com os mesmos dados e o mesmo saldo que ele vê, sem a senha dele e sem mexer na sessão dele. É o jeito mais rápido de entender uma dúvida do Cliente: você olha a mesma tela.

1. Em **Clientes** › **Provisionamento do Portal**, clique no olho da coluna **Espiadinha**. O Portal abre numa aba nova. Pela ficha do Cliente, use **Acesso ao Portal** › **Gerenciar aqui** › **Ver como o Cliente vê** (ou **Ver o que o Cliente veria**, com a conta ainda não ativa).
2. A faixa **Modo Inspeção**, no alto, mostra o Cliente, o CNPJ e se a conta está ativa.
3. Navegue pela barra do Portal: **Painel**, **Faturas**, **BLs e Containers**, **Desbloqueio de CE**, **Informações** e **Perfil**.
4. Para sair, use o botão da faixa: **Fechar inspeção**, **Voltar à ficha do Cliente** ou **Voltar ao Provisionamento**.

::: tela portal-inspecao
O Portal da ATLANTICO IMPORTADORA LTDA no Modo Inspeção.
:::

Tudo o que o Cliente faria fica apagado, com a dica "Ação do cliente — indisponível em Modo Inspeção": consolidar faturas, abrir ou responder disputa, anexar, salvar contatos e endereço, marcar notificações. Você vê, mas não age por ele.

::: atencao
Com a conta não ativa, o Cliente não entra no Portal. A inspeção mostra o que ele veria depois de ativar, não o que ele vê hoje.
:::

## 15.2 Como o Cliente entra

**Quem faz:** o Cliente, no Portal. Quem orienta: {{Qualquer equipe}}

O acesso é da empresa, não da pessoa: o Cliente entra em portalfwlog.com.br com o **CNPJ** do cadastro e uma **Senha**. CPF e e-mail não servem de login.

Qualquer recusa mostra a mesma mensagem: "CNPJ ou senha inválidos. Após várias tentativas, o acesso fica suspenso por 15 minutos.…". Vale para senha errada, CNPJ sem conta, conta não ativa ou suspensa e Cliente desativado. É de propósito: a tela não revela quem tem conta. A causa você confere na fila do Provisionamento (capítulo 14).

Com 5 erros do mesmo CNPJ em 15 minutos, o login fica bloqueado por até 15 minutos, em qualquer computador. A equipe não tem botão para desbloquear: o bloqueio passa sozinho.

Para trocar uma senha esquecida, o Cliente usa **Esqueci minha senha**, informa o CNPJ e recebe um link no e-mail de recuperação, válido por 1 hora. Ao redefinir, ele é desconectado dos outros aparelhos e o e-mail de recuperação recebe "Sua senha do Portal do Cliente foi alterada".

::: atencao
- A tela **Link enviado** aparece exista ou não a conta (só depois de muitos pedidos seguidos ela pede para esperar). O link só sai de verdade para conta **Ativa**, com e-mail de recuperação gravado e fora da lista de bloqueio, e no máximo um por hora. Se o Cliente não recebeu, confira a conta antes de pedir que ele tente de novo.
- O link vai só para o e-mail de recuperação, nunca para os contatos. Se essa pessoa saiu da empresa, troque o endereço ([14.6](14-portal-a-conta.md#146-trocar-o-e-mail-de-recuperação)).
:::

## 15.3 O Painel e a programação dos navios

**Quem faz:** {{Todas as equipes}}

O **Painel** é a primeira tela do Cliente. Quatro cartões resumem o que está em aberto e levam à tela de cada assunto.

Abaixo, o bloco **Chegadas e saídas** é a programação que você mantém em **Chegadas e Saídas**, no Vela ([5.1](05-programacao.md#51-ler-a-programação-em-chegadas-e-saídas)): só as Viagens ativas e publicadas, com a saída na origem e a chegada no Brasil. O Cliente não vê o âmbar da previsão vencida, só uma previsão comum. **Ver meus B/Ls** aparece na viagem em que ele tem carga e abre os B/Ls daquela viagem. Por último, **Consultas** leva às seções da Central de Informações (capítulo 13). O mesmo quadro, sem **Ver meus B/Ls**, aparece a qualquer pessoa no site da Fwlog ([17.11](17-suporte-ao-cliente.md#1711-responder-sobre-o-site-da-fwlog)).

As telas do Portal leem os dados quando o Cliente as abre; elas não se atualizam sozinhas. Uma data que você grava aparece para ele na próxima leitura, ou quando ele clica em **Atualizar** em **Chegadas e saídas**.

::: atencao
Se o Cliente não vê um navio, confira na Viagem se a chave **Aparece em Chegadas e Saídas** está ligada e se a Viagem está **Ativa**. A Viagem concluída sai da programação.
:::

## 15.4 Os B/Ls e os containers

**Quem faz:** {{Todas as equipes}}

**BLs e Containers** lista os B/Ls do Cliente que têm CE Mercante. O B/L sem CE não aparece em nenhuma tela do Portal: nem aqui, nem nas faturas, nem na Demurrage ([18.1](18-o-que-muda-sozinho.md#181-vincular-o-ce-ao-bl)). O B/L cancelado depois do CE continua na lista, com o selo **Cancelado**.

Na aba **BLs**, cada linha traz a carga, a Viagem e o trecho. A coluna **Pagamento** diz "R$ … em aberto", "Pago" ou "Aguardando fatura". Essa última aparece sem valor: o Portal nunca mostra uma Taxa Local que ainda não foi faturada. O B/L com escala omitida mostra **Informações de Transbordo**, ou o novo destino no COD, sem o motivo interno ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)).

A aba **Containers** mostra, para cada container, a **Descarga**, a **Devolução**, os **Dias de uso**, o **Free time**, os **Dias em demurrage** e a situação:

Duas situações pedem explicação: **SOC (sem devolução)** é container do próprio Cliente, sem devolução nem Demurrage; **Tarifa indisponível** quer dizer que o Vela não achou o free time oficial do container.

As datas de descarga e de devolução que {{Equipamentos}} grava aparecem aqui na próxima leitura do Cliente (capítulo 9).

::: atencao
- Se o Cliente diz que um B/L não aparece, abra o bloco **Portal** da ficha do B/L: ele diz se o B/L está visível e, se não está, por quê ([7.4](07-ficha-do-bl.md#74-vincular-ou-trocar-o-cliente-do-bl)).
:::

## 15.5 As faturas e o Pix

**Quem faz:** o Cliente, no Portal. Quem orienta: {{Qualquer equipe}}; na rotina, o {{Financeiro}}.

Em **Faturas**, a aba **Taxas Locais** lista as faturas de Taxas Locais e as avulsas. Só chega ao Portal a fatura emitida, e só quando todos os B/Ls dela têm CE Mercante; a avulsa aparece sempre. A cancelada fica escondida e só aparece no filtro **Cancelada**. Em cima, os cartões **Saldo pendente**, **Faturas emitidas** e **B/Ls elegíveis** (os que podem entrar numa consolidada).

::: tela portal-faturas
As faturas da ATLANTICO IMPORTADORA LTDA no Portal: a do CSC45810A01K00, emitida pela Liberação.
:::

O número da fatura abre o detalhe, com o bloco **Pagamento** primeiro:

1. Em aberto, "R$ … a pagar", com **Pague com Pix**: o QR e **Copiar código Pix**. Na fatura parcialmente paga, o Pix cobra só o saldo.
2. Depois do pagamento, a baixa leva de 1 a 5 minutos. O detalhe aberto se atualiza sozinho e passa a **Paga**, com **Imprimir recibo**.
3. A fatura individual paga por uma consolidada aparece como **Coberta**, com o link para a consolidada.

O Cliente também junta faturas: **Gerar fatura consolidada** escolhe os B/Ls com saldo em aberto e **Consolidar e emitir** emite uma fatura só, que aparece no Vela como qualquer consolidada (capítulo 22). Enquanto ela não tem pagamento, o Cliente pode desfazê-la em **Refazer consolidada**.

::: atencao
- O **Saldo pendente** do Portal não é o da ficha do Cliente no Vela: ele soma só as faturas que o Cliente vê, mais a Demurrage em R$ de hoje. Quando o Cliente questiona o saldo, compare fatura por fatura.
- O recibo não vai por e-mail: o Cliente o imprime no Portal, na fatura **Paga**. Se ele pedir o recibo a você, imprima pelo Vela (capítulo 24).
:::

## 15.6 A Demurrage e a Disputa

**Quem faz:** o Cliente, no Portal. Quem responde à Disputa: {{Equipamentos}}

A aba **Demurrage** de **Faturas** lista as Invoices emitidas ou pagas dos B/Ls com CE. A cancelada não chega ao Portal, e o container que ainda está correndo não tem valor no Portal antes da Invoice ([23.2](23-demurrage-no-financeiro.md#232-achar-as-invoices-em-aberto-pagas-e-canceladas)). Cada Invoice mostra o total em US$ e o **Total R$ hoje**: o valor em reais acompanha o câmbio do dia (o ROE de hoje, que a faixa mostra) até o pagamento. Enquanto a Invoice está em aberto, o detalhe traz o Pix. O container dividido com outro Cliente aparece com "1/2 da caixa": cada um paga a sua parte ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)).

Se o Cliente discorda de um valor, ele contesta no detalhe da Invoice em aberto, em **Abrir disputa**: escreve o **Motivo da disputa** e, se quiser, usa **Anexar arquivo** (PDF, JPG, PNG ou TXT, até 10 MB). Ele acompanha a conversa em **Disputas**.

A Disputa chega a {{Equipamentos}} como alerta, e a Régua de Cobrança daquela Invoice para. Na conversa, a equipe aparece como "Equipe de Containers", e o Cliente só escreve quando é a vez dele. Cada Invoice tem uma conversa só: depois da Disputa resolvida, o detalhe oferece **Solicitar reabertura** no lugar de **Abrir disputa**, e ela continua resolvida até a equipe decidir. Se a Invoice é cancelada, a Disputa é encerrada junto e o Cliente recebe "Disputa encerrada", com o motivo. Como a equipe responde e decide está no capítulo 9.

::: atencao
- Invoice paga não aceita disputa nova. A conversa aberta antes do pagamento continua.
- O Cliente abre no máximo 3 disputas ou mensagens a cada 30 minutos. Se ele diz que o Portal recusou a mensagem, peça que espere um pouco.
- Se o anexo é recusado depois de a Disputa abrir (mais de 20 anexos em 24 horas, ou mais de 100 MB somando as Disputas abertas), a Disputa fica aberta e a janela oferece **Reenviar anexo**; o Cliente também pode anexar depois, na conversa.
:::

## 15.7 O Desbloqueio de CE pelo Portal

**Quem faz:** o Cliente, no Portal. Quem analisa: {{Documentação}}

Em **Desbloqueio de CE**, o Cliente pede que a agência libere o CE dos B/Ls dele. A página tem as abas **Nova solicitação**, **Minhas solicitações** e, para o Cliente VIP, **Documentos anuais**. No alto, o bloco **O que o desbloqueio pede** lista os quatro requisitos de cada B/L: Taxas Locais pagas, termo de devolução, procuração e B/L original entregue na agência.

1. Na lista **B/Ls com CE Mercante**, o Cliente marca os B/Ls (até 100) e clica em **Pedir desbloqueio de N B/Ls**. B/L com Taxas Locais em aberto nem pode ser marcado.
2. Na solicitação aberta, anexa o termo de devolução e a procuração em PDF, de até 10 MiB cada. Quando os documentos anuais VIP cobrem todos os B/Ls, o Cliente não anexa nada.
3. Clica em **Solicitar desbloqueio**.

O Cliente acompanha a situação em **Minhas solicitações**; na **Correção pedida**, ele vê o motivo inteiro, como a agência escreveu. O prazo para desbloqueio só começa quando os quatro requisitos estão cumpridos em todos os B/Ls da solicitação. A análise pela equipe está no capítulo 12.

::: atencao
- O rascunho que o Cliente não envia é cancelado 7 dias depois de criado, e os B/Ls ficam livres de novo.
- O Cliente cancela a própria solicitação só no rascunho ou na correção pedida. Depois disso, ele precisa pedir à agência.
:::

## 15.8 O Perfil: contatos, endereço e e-mail de recuperação

**Quem faz:** o Cliente, no Portal. Quem orienta: {{Qualquer equipe}}

Em **Perfil**, o Cliente cuida de três coisas, cada uma com o próprio botão:

- **Quem recebe os comunicados**: os contatos do Cliente e as caixas de cada um (**Documentação e Operação**, **Financeiro** e **Demurrage**). São os mesmos contatos da ficha do Cliente no Vela (capítulo 13), com as mesmas regras: um contato principal ativo, com e-mail. O que o Cliente salva aqui vale na hora no Vela.
- **Endereço da empresa**: o endereço do cadastro, que sai nas faturas emitidas depois.
- **E-mail de recuperação**: o Cliente troca o endereço informando a senha atual e o novo e-mail duas vezes. O novo só vale depois que ele clica no link de confirmação, que chega ao endereço novo e vale por 48 horas. Até lá, o antigo continua valendo e recebe um aviso do pedido.

::: atencao
- O endereço que o Cliente grava no Portal muda o cadastro na hora e aparece em **Alterações do cadastro**, na ficha, com "Cliente pelo Portal" na coluna **Por**.
- Contato com endereço bloqueado aparece no Perfil com o aviso "Endereço bloqueado". Ele não recebe Comunicados até o e-mail ser trocado (capítulo 16).
:::

## 15.9 Os avisos no sino

**Quem faz:** {{Todas as equipes}}

O sino, no alto do Portal, mostra as notificações do Cliente, com o número das não lidas. Elas nascem sozinhas, sem ação da equipe:

- "Nova fatura emitida" e "Nova fatura de demurrage", uma por fatura;
- a consolidada criada, desfeita ou substituída;
- "Disputa registrada", "Disputa respondida" e "Disputa encerrada";
- a escala omitida e o destino alterado (COD), e as correções deles;
- os avisos do Desbloqueio de CE.

As notificações ficam só no Portal: não saem por e-mail. Os e-mails que o Cliente recebe estão no capítulo 16. Para saber se o Cliente viu um aviso de um B/L, abra o bloco **Portal** da ficha do B/L: **Avisos ao Cliente** mostra os mais recentes, cada um como "lida" ou "não lida".
