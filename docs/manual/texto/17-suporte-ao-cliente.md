Quando o Cliente pede ajuda, quase sempre é uma destas coisas: não consegue entrar no Portal, o e-mail não chegou, a fatura não aparece ou o Pix não baixou. A resposta está em três lugares: a ficha do Cliente, a conta dele no **Provisionamento do Portal** e o próprio Portal, visto como ele vê. Este capítulo é um índice das situações mais comuns, com o caminho curto de cada uma. O detalhe de cada tela está nos capítulos 13 a 16.

::: aprende
- ver o Portal como o Cliente vê, sem a senha dele;
- resolver o acesso: entrada, convite, senha, e-mail de recuperação e CNPJ;
- descobrir por que um e-mail não chegou;
- explicar o B/L ou a fatura que não aparece, o Pix que não baixou e o saldo diferente;
- a quem passar cada pedido;
- responder sobre a programação e a consulta de container do site da Fwlog.
:::

## 17.1 Ver o Portal como o Cliente vê

**Quem faz:** {{Qualquer equipe}}

Comece sempre pela **Espiadinha**: ela abre o Portal do Cliente como ele vê, sem a senha dele ([15.1](15-portal-o-que-o-cliente-ve.md#151-ver-o-portal-como-o-cliente-vê)). É o jeito mais rápido de confirmar o que ele está dizendo e de conferir, depois, que o problema foi resolvido.

Antes de responder, olhe também a linha do Cliente no **Provisionamento do Portal**: a coluna **Conta** diz em que pé está o acesso, a coluna **Alerta** mostra **Crítico** quando há um alerta grave do Portal, e a coluna **Ação** diz o próximo passo ([14.1](14-portal-a-conta.md#141-ler-a-fila-do-provisionamento-do-portal)).

## 17.2 O Cliente não consegue entrar

**Quem faz:** conferir, {{Qualquer equipe}} · agir na conta, {{Documentação}} e {{Administrativo}}

O Portal dá a mesma resposta para senha errada, CNPJ sem conta, conta não ativa ou suspensa, Cliente desativado e bloqueio por tentativas: "CNPJ ou senha inválidos…". É de propósito, para não revelar quem tem conta. A causa você descobre no Vela, pela coluna **Conta**:

| Conta | O que fazer |
|---|---|
| **Sem conta**, **Ativação pendente** ou **Convite expirado** | O Cliente ainda não criou a senha. Envie ou reenvie o convite (capítulo 14). |
| **Falha no envio** | O convite não chegou ([17.5](#175-o-e-mail-não-chegou)). |
| **Suspensa** | **Ações administrativas** › **Reativar a conta**. A conta volta ao começo: o Cliente precisa de um convite novo e de uma senha nova. |
| **Ativa** | Siga os passos abaixo. |

Com a conta **Ativa**:

1. Confirme que o Cliente usa o CNPJ do cadastro; a pontuação não importa. Se o {{Administrativo}} trocou o CNPJ, vale o novo.
2. Veja se o Cliente está desativado na ficha (capítulo 13). Desativado não entra.
3. Se a coluna **Alerta** mostra **Crítico**, veja em **Alertas** se é o **Portal do Cliente — abuso de login** (capítulo 20): cinco entradas recusadas em 15 minutos bloqueiam o CNPJ por até 15 minutos, e não há botão para desbloquear; peça que o Cliente espere e tente de novo.
4. Se nada disso, a senha está errada: oriente o Cliente a usar **Esqueci minha senha** ([17.4](#174-o-cliente-esqueceu-a-senha)).

::: atencao
"O Portal pede para entrar de novo" é normal depois de uma troca de senha ou do e-mail de recuperação, de uma suspensão ou da desativação do Cliente: todas encerram as sessões abertas. Entrar com outro CNPJ no mesmo navegador também troca o Cliente aberto.
:::

## 17.3 O convite não funciona

**Quem faz:** {{Documentação}} e {{Administrativo}}

O convite vale 48 horas e uma vez só, e cada reenvio invalida os anteriores. Quem abre um link velho vê **Convite indisponível**.

- Conta em **Convite expirado** ou **Ativação pendente**: reenvie o convite (capítulo 14) e peça que o Cliente use só o e-mail mais novo.
- Conta **Ativa**: o convite já foi usado. Oriente o Cliente a entrar com o CNPJ e a senha, ou a usar **Esqueci minha senha**.
- Cliente desativado: o convite não ativa. Reativar é do {{Administrativo}} (capítulo 13).

## 17.4 O Cliente esqueceu a senha

**Quem faz:** orientar, {{Qualquer equipe}} · cuidar da conta, {{Documentação}} e {{Administrativo}}

O próprio Cliente recupera a senha: na tela de entrada do Portal, em **Esqueci minha senha**, com o CNPJ. O link vai para o e-mail de recuperação da conta e vale 1 hora, uma vez. A tela diz que o link foi enviado, exista ou não a conta; só pede para esperar quando há muitos pedidos seguidos. Por isso, quando o link não chega, confira no Vela:

- o link só sai para conta **Ativa** e com o e-mail de recuperação fora da lista de bloqueio ([17.5](#175-o-e-mail-não-chegou));
- dentro de 1 hora não sai outro link: o primeiro continua valendo. Peça que o Cliente procure esse e-mail, também no spam;
- se o e-mail de recuperação não existe mais, troque-o primeiro ([17.6](#176-trocar-o-e-mail-de-recuperação-ou-o-cnpj)) e só depois peça a recuperação.

::: atencao
Se o Cliente não consegue redefinir a senha nem com um link novo, a recuperação pode ter travado no meio. Não reenvie em série: chame o suporte técnico.
:::

## 17.5 O e-mail não chegou

**Quem faz:** {{Documentação}} e {{Administrativo}}

Primeiro, saiba qual e-mail. O convite e a recuperação de senha vão para o **e-mail de recuperação** da conta do Portal. Os Comunicados vão para os contatos do Cliente, conforme a caixa de cada um ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)).

Para o convite ou a recuperação de senha:

1. Abra a linha do Cliente no **Provisionamento do Portal** e veja a **Última entrega** e o **Estado do e-mail**.
2. **Entregue** ou **Aceito pelo provedor**: o e-mail saiu. Peça que o Cliente olhe o spam. "Aceito pelo provedor" ainda não garante que chegou.
3. **Devolvido**, **Falha permanente** ou o aviso em vermelho de lista de bloqueio: o endereço não recebe. Troque o e-mail de recuperação ([17.6](#176-trocar-o-e-mail-de-recuperação-ou-o-cnpj)) ou, no convite, use **Revisar e-mail e reenviar**.
4. Se o Cliente confirmar que a caixa voltou a funcionar, use **Ações administrativas** › **Liberar endereço bloqueado**.

Para um Comunicado, veja no **Histórico** da ficha do Cliente, assunto **Comunicados**, para quem ele foi e em que situação ficou (capítulo 16). Confira se a caixa daquele aviso tem um contato com e-mail e se o contato não está com "Endereço bloqueado"; nesse caso, troque o e-mail do contato (capítulo 13).

## 17.6 Trocar o e-mail de recuperação ou o CNPJ

**Quem faz:** {{Documentação}} e {{Administrativo}} · CNPJ: {{Administrativo}}

- **O Cliente tem a senha:** ele mesmo troca o e-mail de recuperação, no **Perfil** do Portal ([15.8](15-portal-o-que-o-cliente-ve.md#158-o-perfil-contatos-endereço-e-e-mail-de-recuperação)).
- **O Cliente perdeu a senha e o e-mail antigo:** troque o e-mail de recuperação na conta dele ([14.6](14-portal-a-conta.md#146-trocar-o-e-mail-de-recuperação)); depois, o Cliente usa **Esqueci minha senha**.
- **O CNPJ mudou ou está errado:** o {{Administrativo}} troca na conta ([14.9](14-portal-a-conta.md#149-alterar-o-cnpj)).

::: atencao
O novo e-mail de recuperação ganha o acesso à conta. Confirme com o Cliente que o endereço é de alguém autorizado por ele.
:::

## 17.7 O B/L ou a fatura não aparece no Portal

**Quem faz:** {{Qualquer equipe}}

O Cliente só vê o B/L que tem CE Mercante, está vinculado a ele e tem a conta do Portal **Ativa**. Na ficha do B/L, o bloco **Portal** diz se o B/L está visível e, se não está, por quê: "Sem CE Mercante", "Sem cliente vinculado" ou "Conta do Portal não está ativa" ([7.4](07-ficha-do-bl.md#74-vincular-ou-trocar-o-cliente-do-bl)).

Para a fatura, confira nesta ordem:

1. **Ela foi emitida?** O rascunho não aparece. A fatura retida por falta de Portal ainda não existe: em **Taxas Locais** › **Validação**, o B/L aparece com o motivo **Conta do Portal não ativa** (capítulos 13 e 14).
2. **Todos os B/Ls dela têm CE Mercante?** A fatura com vários B/Ls só aparece quando todos têm.
3. **O B/L mudou de Cliente?** A fatura nova é do novo Cliente ([18.4](18-o-que-muda-sozinho.md#184-vincular-ou-trocar-o-cliente-do-bl)).
4. **O filtro esconde a fatura?** No Portal, o **Status** começa em **Em vigor (sem canceladas)**: a fatura cancelada ou substituída só aparece com **Cancelada**. A Invoice de Demurrage cancelada não chega ao Portal.

Confira o resultado pela **Espiadinha** ([17.1](#171-ver-o-portal-como-o-cliente-vê)).

## 17.8 O Pix não baixou ou o saldo não bate

**Quem faz:** orientar, {{Qualquer equipe}} · conferir o pagamento, {{Financeiro}}

A baixa do Pix é automática e costuma levar cerca de um minuto ([19.6](19-rotinas-por-horario.md#196-o-pix-do-itaú)). No Portal, o detalhe da fatura aberto se atualiza sozinho a cada 20 segundos.

1. Peça que o Cliente atualize a página do Portal depois de alguns minutos.
2. Se a fatura continuar em aberto, passe ao {{Financeiro}}, que confere em **Conciliação PIX** (capítulo 24). O Pix com valor diferente do da fatura não baixa sozinho.

O recibo não vai por e-mail: no Portal, a fatura **Paga** tem **Imprimir recibo**. O detalhe da fatura no Vela também imprime.

Quando o Cliente diz que o valor do Portal é diferente do Vela, os dois saldos contam coisas diferentes ([13.2](13-cadastro-do-cliente.md#132-ler-a-ficha-do-cliente)); a Demurrage em reais ainda muda com a cotação do dia até o pagamento.

## 17.9 O Cliente contesta a Demurrage

**Quem faz:** {{Equipamentos}} e {{Administrativo}}

A contestação de uma Invoice de Demurrage é a **Disputa**, e só o Cliente a abre: no Portal, no detalhe da Invoice em aberto, em **Abrir disputa**. O Vela não abre Disputa pelo Cliente. Aberta, ela chega a {{Equipamentos}} com um alerta e pausa a cobrança automática da Invoice.

1. Oriente o Cliente a abrir a Disputa pelo Portal, explicando o motivo. Se a Invoice já teve uma Disputa resolvida, ele pede a reabertura nela, em **Solicitar reabertura** ([15.6](15-portal-o-que-o-cliente-ve.md#156-a-demurrage-e-a-disputa)).
2. Responda em **Demurrage**, aba **Disputas**, com **Responder** (capítulo 9). A resposta aparece para o Cliente no Portal.

## 17.10 Outros pedidos

**Quem faz:** {{Todas as equipes}}

| O Cliente pede | Onde resolver |
|---|---|
| mudar quem recebe os avisos por e-mail | Contatos da ficha do Cliente (capítulo 13), ou ele mesmo, no **Perfil** do Portal (capítulo 15) |
| corrigir o endereço que sai na fatura | **Dados cadastrais** da ficha (capítulo 13), ou ele mesmo, no **Perfil** do Portal. Vale para as faturas emitidas depois. |
| juntar várias faturas numa só | Ele mesmo, no Portal; a tela diz por que um B/L não pode entrar (capítulo 15) |
| liberar o CE para retirar a carga | Desbloqueio de CE (capítulo 12) |
| onde devolver o container, o tracking ou o contato da agência | Central de Informações do Portal (capítulo 13) |
| entender um aviso que recebeu por e-mail | E-mails e Comunicados (capítulo 16) |
| como a transportadora acompanha um container sem entrar no Portal | Consulta de container do site da Fwlog ([17.11](#1711-responder-sobre-o-site-da-fwlog)) |

## 17.11 Responder sobre o site da Fwlog

**Quem faz:** {{Qualquer equipe}}

O site da Fwlog, fwlog.com.br, mostra duas páginas do Portal a qualquer pessoa, sem login: servem a quem não tem conta, como a transportadora do Cliente. As duas leem os dados do Vela, e nenhuma mostra Cliente, B/L, CE Mercante, valores, Pix ou contatos.

- **Chegadas e saídas** é o quadro do Painel do Portal ([15.3](15-portal-o-que-o-cliente-ve.md#153-o-painel-e-a-programação-dos-navios)), sem **Ver meus B/Ls**: as mesmas Viagens, com a chave **Aparece em Chegadas e Saídas** ligada ([5.1](05-programacao.md#51-ler-a-programação-em-chegadas-e-saídas)), e as mesmas datas, que chegam ao site em até um minuto e meio. O mapa do navio só aparece quando ele tem **IMO**. Desligar a chave tira a Viagem do Portal e do site juntos.
- **Consulta de container**: a pessoa digita só o número do container e vê a situação, a data limite de devolução (a descarga mais o free time), o tipo, o navio, a viagem, o porto de descarga, a descarga, o free time e a devolução. A resposta é a da Viagem mais recente do container. Entram Salvador, Vitória, Pecém e Suape: os containers descarregados ou previstos nos últimos 90 dias e os que ainda não foram devolvidos.

O free time e a data limite são os mesmos do Portal e da Invoice de Demurrage. Quando a consulta não bate com o que a pessoa espera, confira no Vela:

| A consulta mostra | O que conferir no Vela |
|---|---|
| **Aguardando descarga** | A descarga do container ([9.2](09-containers-e-demurrage.md#92-gravar-a-descarga-e-a-devolução)). |
| **Free time vencido**, mas o container já voltou | A devolução: sem ela gravada, o container continua contando como fora ([9.2](09-containers-e-demurrage.md#92-gravar-a-descarga-e-a-devolução)). |
| **Free time a confirmar com a Fwlog** | Nenhum free time foi achado para o container: confira o acordo do Cliente e a tarifa do grupo do tipo dele ([9.7](09-containers-e-demurrage.md#97-cadastrar-tarifas-e-acordos-de-demurrage)), e se o tipo está cadastrado e ativo ([9.10](09-containers-e-demurrage.md#910-cadastrar-um-tipo-de-container)). |
| "Não encontramos este container…" | Na Viagem mais recente do container: se o B/L tem CE Mercante e Cliente vinculado, se não é SOC e se o porto de descarga e as datas estão gravados. |

::: atencao
- Só aparece o container de B/L com CE Mercante e Cliente vinculado. Se a Viagem mais recente do container ainda não pode aparecer, a resposta é "não encontrado", nunca a Viagem anterior.
- "Consulta indisponível no momento. Tente mais tarde." costuma passar na virada da hora. Se continuar, ou se a página no site aparece em branco ou como **Página não encontrada**, avise o suporte técnico: o endereço colado no site pode estar errado.
:::
