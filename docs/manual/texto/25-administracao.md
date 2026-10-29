A página **Admin** é do {{Administrativo}}. É nela que nascem os usuários do Vela, que se escolhe a equipe de cada pessoa e que se cuida do acesso de quem chega e de quem sai. Ela guarda também as telas de acompanhamento: o histórico de tudo o que se gravou, os alertas que não acharam ninguém para avisar e o cumprimento do prazo do ADR de Saída por equipe. As poucas configurações do Vela ficam nas telas dos seus assuntos, e este capítulo diz onde.

::: aprende
- criar um usuário e escolher a equipe dele;
- trocar a equipe, redefinir a senha ou corrigir o e-mail de um usuário;
- desativar e reativar um usuário sem deixar uma equipe sem ninguém;
- consultar o Histórico de ações e as falhas de entrega de alertas;
- acompanhar o prazo do ADR de Saída por equipe;
- saber quais configurações existem e quem as muda.
:::

## 25.1 Abrir a Administração

**Quem faz:** {{Administrativo}}

**Admin**, no menu, só aparece para o {{Administrativo}}; para as outras equipes, o endereço da página mostra **Acesso restrito** ([1.6](01-o-vela.md#16-quando-algo-dá-errado)). A página **Administração** tem cinco abas, cada uma com endereço próprio: o link copiado abre a mesma aba.

| Aba | Para quê |
|---|---|
| **Usuários** (abre primeiro) | As pessoas do Vela e o quadro **O que cada setor pode** ([25.2](#252-criar-um-usuário) a [25.6](#256-conferir-o-que-cada-equipe-pode)) |
| **Falhas de entrega de alertas** | Os alertas que não acharam ninguém ativo para avisar ([25.8](#258-acompanhar-as-falhas-de-entrega-de-alertas)) |
| **Histórico de ações** | Tudo o que se gravou no Vela, com quem fez ([25.7](#257-consultar-o-histórico-de-ações)) |
| **Sistema** | A versão, o ambiente e as datas da última Viagem e da última fatura ([25.10](#2510-cuidar-das-configurações-do-vela)) |
| **Prazo do ADR** | O cumprimento das 72 horas do ADR de Saída, por equipe ([25.9](#259-acompanhar-o-prazo-do-adr)) |

Na aba **Usuários**, a lista abre só com os **Ativos**; em **Situação**, escolha **Inativos** ou **Todos**. **Busca** acha pelo nome ou pelo e-mail, e **Setor** recorta pela equipe. Algumas marcas da lista pedem atenção:

| Na lista | Quer dizer |
|---|---|
| **Integração**, ao lado do nome | Conta técnica da baixa automática do Pix, não uma pessoa ([25.5](#255-desativar-ou-reativar-um-usuário)). |
| E-mail em âmbar, com ⚠ | Um e-mail do Vela voltou desse endereço ou foi marcado como spam, e o Vela parou de enviar para ele ([25.4](#254-redefinir-a-senha-ou-corrigir-o-e-mail)). |
| "Documentação · setor antigo Operador" | Vale como Documentação, mas não recebe o resumo diário do Portal ([25.3](#253-trocar-a-equipe-de-um-usuário)). |
| "Administrativo · Dev" | A conta que liga e desliga o envio real de e-mails ([25.10](#2510-cuidar-das-configurações-do-vela)). |
| Linha cinza, **Inativo** | Usuário desativado ([25.5](#255-desativar-ou-reativar-um-usuário)). |

## 25.2 Criar um usuário

**Quem faz:** {{Administrativo}}

Cada pessoa tem o próprio usuário, e a equipe dele decide o que ela pode fazer ([2.2](02-equipes-e-permissoes.md#22-o-que-é-reservado-a-algumas-equipes)). Não existe cadastro aberto no Vela: todo usuário nasce aqui.

1. Em **Admin** › **Usuários**, clique em **Novo usuário**.
2. Preencha **Nome completo** e **E-mail de login** e escolha o **Setor**. A janela mostra na hora o que a pessoa vai poder fazer ("Com este setor, … pode") e o que não vai.
3. Defina a **Senha** e repita em **Confirmar senha**: pelo menos 8 caracteres, com letra maiúscula, minúscula e número.
4. Clique em **Criar usuário**, confira o resumo na janela **Criar usuário interno** e confirme.

O usuário nasce ativo e já pode entrar. O Vela não manda e-mail à pessoa: entregue a ela o e-mail e a senha. Depois, ela mesma troca a senha em **Meu perfil** › **Alterar senha** ([1.1](01-o-vela.md#11-entrar-e-sair)).

::: atencao
- Um e-mail de login serve a um usuário só. Se a pessoa já teve usuário no Vela, não crie outro: reative o antigo ([25.5](#255-desativar-ou-reativar-um-usuário)). Usuário não se exclui, e o e-mail dele continua ocupado ("Já existe um usuário com este e-mail.").
:::

## 25.3 Trocar a equipe de um usuário

**Quem faz:** {{Administrativo}}

1. Na linha da pessoa, clique em **Editar acesso** (o ícone da chave).
2. Em **Setor**, escolha a equipe nova. A janela mostra o que a pessoa passa a poder.
3. Clique em **Salvar** e confirme o antes → depois.

A troca vale na hora para o que a pessoa grava, mas o menu e os botões dela só mudam quando ela recarrega a página ou entra de novo; a sessão não cai. O que ela gravou antes continua no histórico com a equipe daquele momento ([2.4](02-equipes-e-permissoes.md#24-quem-fez-o-quê)).

Quem aparece como "setor antigo Operador" passa a Documentação do mesmo jeito: abra **Editar acesso** e clique em **Salvar** com **Documentação** escolhida. A partir daí a pessoa recebe o resumo diário do Portal ([2.1](02-equipes-e-permissoes.md#21-as-equipes)).

::: atencao
- O seu próprio **Setor** fica travado: só outra pessoa do {{Administrativo}} o troca.
- O Vela nunca fica sem {{Administrativo}}: tirar da equipe, ou desativar, a última pessoa ativa do {{Administrativo}} é recusado ("… é o último usuário Administrativo ativo. …"). Ative ou crie outra antes. A conta **Integração** não conta.
:::

## 25.4 Redefinir a senha ou corrigir o e-mail

**Quem faz:** {{Administrativo}}

Ninguém consegue ver a senha de outra pessoa. Para socorrer quem esqueceu, você define uma nova: o Vela não tem "esqueci a senha".

1. Na linha da pessoa, clique em **Editar acesso**.
2. Para a senha, preencha **Nova senha** e **Confirmar nova senha**. Para o e-mail, corrija o **E-mail de login**. O que você não mexer fica como está.
3. Clique em **Salvar** e confirme.
4. Entregue a senha nova à pessoa.

A troca derruba na hora as sessões abertas da pessoa, em qualquer computador: ela entra de novo com a credencial nova. O e-mail novo já vale para entrar, sem confirmação por e-mail. O **Histórico de ações** registra o e-mail antigo e o novo; da senha, só "Senha redefinida".

**E-mail devolvido.** Quando um e-mail do Vela volta de um endereço da equipe, ou é marcado como spam, a lista mostra o endereço em âmbar e abre o alerta **Usuário interno com e-mail devolvido** ([20.7](20-alertas.md#207-comunicados-e-e-mail)). Corrija o endereço em **Editar acesso**. Se a caixa já voltou a funcionar, salve o mesmo e-mail: isso libera o endereço e fecha o alerta. Trocar só a senha não libera.

::: atencao
- Trocar o seu próprio e-mail ou a sua senha aqui encerra a sua sessão ("Acesso atualizado. Entre de novo com a nova credencial."). Para a sua senha, use **Meu perfil** › **Alterar senha**.
- O endereço que também é contato de um Cliente ou e-mail de recuperação do Portal continua bloqueado, e a tela avisa: a correção é pelo cadastro do Cliente ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe) e [14.7](14-portal-a-conta.md#147-liberar-um-endereço-bloqueado)).
- Na conta com a marca Dev, só a própria pessoa troca o e-mail e a senha.
:::

## 25.5 Desativar ou reativar um usuário

**Quem faz:** {{Administrativo}}

Usuário não se exclui: ele é o autor do que fez no Vela, e o histórico precisa dele. Quando a pessoa sai da empresa, desative o usuário.

1. Na linha da pessoa, clique em **Desativar** e confirme. Não pede motivo.
2. Para reativar, escolha **Inativos** em **Situação**, clique em **Reativar** na linha, escreva o motivo e confirme.

Desativado, o usuário perde o acesso na hora: a sessão aberta cai e a próxima ação dele é recusada. Reativado, ele volta a entrar com o e-mail e a senha que tinha.

::: atencao
- Ninguém desativa o próprio acesso, nem a última pessoa ativa do {{Administrativo}} ([25.3](#253-trocar-a-equipe-de-um-usuário)).
- Antes de desativar a última pessoa ativa de uma equipe, ative ou crie outra. Sem ninguém, os alertas dessa equipe não têm a quem avisar ([25.8](#258-acompanhar-as-falhas-de-entrega-de-alertas)).
- Não desative a conta **Integração** nem a passe para uma equipe que não seja {{Financeiro}} ou {{Administrativo}}: é ela que dá a baixa automática dos Pix do Itaú. Sem ela, os Pix das faturas de Taxas Locais e das avulsas deixam de baixar sozinhos e vão para análise (capítulo 24).
:::

## 25.6 Conferir o que cada equipe pode

**Quem faz:** {{Administrativo}}

Abaixo da lista de usuários, o quadro **O que cada setor pode** tem uma linha por ação, agrupada por assunto, e uma coluna por equipe: ✓ pode, ○ não pode, ou a condição escrita. Ele abre em **Só exclusivas**, as ações que nem toda equipe faz; **Todas as ações** mostra também as que todas fazem. As janelas **Novo usuário** e **Editar acesso** montam o "Com este setor, … pode" com as mesmas linhas.

O quadro descreve o que o Vela confere a cada gravação, não só o que a tela mostra ([2.2](02-equipes-e-permissoes.md#22-o-que-é-reservado-a-algumas-equipes)). Quando alguém diz que um botão não aparece, procure a ação no quadro: se ela é de outra equipe, o caminho é passar o pedido ([2.3](02-equipes-e-permissoes.md#23-a-quem-passar-cada-pedido)), não trocar a equipe da pessoa.

## 25.7 Consultar o Histórico de ações

**Quem faz:** {{Administrativo}}

O **Histórico de ações** junta numa lista só tudo o que se gravou no Vela, com quem fez e quando. Para a história de uma Viagem, de um B/L ou de um Cliente, a ficha de cada um é mais fácil de ler (capítulos 4, 7 e 13). Aqui ficam também as mudanças que não têm ficha: usuários, configurações, tabelas de cobrança e Condições de Cliente, tarifas e acordos de Demurrage, os alertas resolvidos com justificativa e cada **Reprocessar** da importação.

1. Em **Admin**, abra **Histórico de ações**.
2. Recorte por **Assunto** (Viagem, B/L, Fatura, Usuário, Alerta, Configuração do sistema e outros), por **Por** (**Qualquer pessoa**, **Sistema** ou uma pessoa) e pelos dias em **De** e **Até**.
3. Leia a linha: **Quando**, **Por**, **Assunto**, **Registro** e **O que mudou**, numa frase. A seta abre o **De**, o **Para** e o **Motivo**.

A lista vem da ação mais recente para a mais antiga, 50 por página. Ninguém altera nem apaga uma linha. O Vela guarda cinco anos: as linhas mais antigas saem sozinhas, menos o histórico das escalas, que fica para sempre.

::: atencao
- Os passos que o Vela faz logo depois de uma importação, como a fatura que sai com o CE, aparecem com o nome de quem importou ([19.3](19-rotinas-por-horario.md#193-os-passos-depois-da-importação)). Se essa pessoa foi desativada, aparecem com a conta escolhida para as rotinas ou, sem ela, com a pessoa ativa mais antiga do {{Administrativo}}. Nem toda linha com nome foi feita à mão.
:::

## 25.8 Acompanhar as falhas de entrega de alertas

**Quem faz:** {{Administrativo}}

Todo alerta avisa no sino as pessoas ativas da equipe dele ([20.3](20-alertas.md#203-acompanhar-o-sino)). Quando a equipe não tem ninguém ativo, o alerta crítico vai ao {{Administrativo}}, com o selo **Entrega alternativa**. O alerta normal, e o crítico quando nem o {{Administrativo}} tem alguém ativo, não chegam a ninguém e ficam registrados nesta aba. O alerta em si continua na fila de **Alertas**: o que falhou foi o aviso.

1. Em **Admin**, abra **Falhas de entrega de alertas**.
2. Leia o **Setor sem destinatário** e o **Motivo**.
3. Em **Usuários**, ative ou crie alguém dessa equipe ([25.2](#252-criar-um-usuário) e [25.5](#255-desativar-ou-reativar-um-usuário)).
4. Use **Abrir alerta** para ir à pendência e tratá-la.

A falha fica na lista como registro, mesmo depois de resolvida. O aviso perdido não é reenviado: quem você ativar vê o alerta na fila, não no sino.

## 25.9 Acompanhar o Prazo do ADR

**Quem faz:** {{Administrativo}}

O prazo é o de [11.4](11-adr-de-saida.md#114-cumprir-o-prazo-de-72-horas): cada equipe assina a sua parte do ADR de Saída até 72 horas corridas depois do ATD do terminal. Esta aba mede quem cumpriu, por equipe, nunca por pessoa.

1. Em **Admin**, abra **Prazo do ADR**.
2. Escolha o período em **Fechado de** e **Fechado até**: entram os ADRs fechados nesses dias.
3. Leia os cartões: para {{Operações}}, {{Documentação}} e {{Equipamentos}}, quantos ADRs a equipe assinou no prazo, de quantos fechados, e a porcentagem.
4. Na lista, cada ADR mostra o ATD, o prazo e, por equipe, **No prazo**, **Atrasou N h** (em âmbar) ou **Não assinou** (em cinza). Passe o mouse para ver quando a equipe assinou.

A equipe que não assinou conta como fora do prazo. A última coluna, **Dias corridos do ATD ao Fechamento**, mede o ADR inteiro.

::: atencao
- Ficam fora da medição a escala omitida, o ADR fechado sem ATD e os ADRs fechados antes de a medição existir.
:::

## 25.10 Cuidar das configurações do Vela

**Quem faz:** {{Administrativo}}; o envio real de e-mails, só a conta com a marca Dev

O Vela tem poucas configurações com tela, e cada uma fica no seu assunto:

| Configuração | Onde | Quem muda |
|---|---|---|
| **Envio real** dos e-mails ao Cliente | **Clientes** › **Comunicação**, bloco **Canal de envio** ([16.2](16-emails-e-comunicados.md#162-saber-se-os-e-mails-saem-de-verdade)) | Só a conta do {{Administrativo}} com a marca Dev |
| Intervalo da Régua de Cobrança da Demurrage | **Demurrage**, botão **Régua de cobrança** (capítulo 23) | {{Administrativo}} |

A marca Dev é dada pela equipe de desenvolvimento, nunca pela tela; na lista de usuários, a conta aparece como "Administrativo · Dev". Ligar e desligar o envio real pede confirmação nos dois sentidos. Cada troca da chave e do intervalo fica no **Histórico de ações**, assunto **Configuração do sistema**.

O resto não tem tela:

- **O prazo do ADR não é configurável:** são 72 horas corridas depois do ATD, iguais para todas as equipes ([11.4](11-adr-de-saida.md#114-cumprir-o-prazo-de-72-horas)).
- **A cobrança do Pix pelo Itaú, a conta que dá a baixa automática e o calendário de feriados de Vitória/ES** ficam com o suporte técnico. Quando faltam os feriados do ano seguinte, abre um alerta ([20.9](20-alertas.md#209-demurrage)).

A aba **Sistema** da Administração só mostra: a **Versão** do Vela (a mesma do menu da conta), o **Ambiente** (**Produção**, **Prévia** ou **Desenvolvimento**) e as datas da **Última viagem criada** e da **Última fatura emitida**.

::: atencao
- Depois de ligar ou desligar o envio real, confira se o bloco **Canal de envio** passou a **Envio real** ou a **Redirecionado ao suporte**: se a troca falha, a tela não avisa.
:::
