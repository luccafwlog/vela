A página **Admin** é do {{Administrativo}}. É nela que nascem os usuários do Vela, que se escolhe a equipe de cada pessoa e que se cuida do acesso de quem chega e de quem sai. Ela guarda também as telas de acompanhamento: o histórico de tudo o que se gravou, os alertas que não acharam ninguém para avisar e o cumprimento do prazo do ADR de Saída por equipe.

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

**Admin**, no menu, só aparece para o {{Administrativo}}; para as outras equipes, o endereço da página mostra **Acesso restrito** ([1.6](01-o-vela.md#16-quando-algo-dá-errado)). A página **Administração** tem cinco abas, **Usuários** (abre primeiro), **Falhas de entrega de alertas**, **Histórico de ações**, **Sistema** e **Prazo do ADR**, cada uma com endereço próprio: o link copiado abre a mesma aba.

Na aba **Usuários**, a lista abre só com os **Ativos**; em **Situação**, escolha **Inativos** ou **Todos**. Duas marcas da lista pedem atenção:

| Na lista | Quer dizer |
|---|---|
| E-mail em âmbar, com ⚠ | Um e-mail do Vela voltou desse endereço ou foi marcado como spam, e o Vela parou de enviar para ele ([25.4](#254-redefinir-a-senha-ou-corrigir-o-e-mail)). |
| "Documentação · setor antigo Operador" | Vale como Documentação, mas não recebe o resumo diário do Portal ([25.3](#253-trocar-a-equipe-de-um-usuário)). |

A marca **Integração** está em [25.5](#255-desativar-ou-reativar-um-usuário), e "Administrativo · Dev", em [25.10](#2510-cuidar-das-configurações-do-vela).

## 25.2 Criar um usuário

**Quem faz:** {{Administrativo}}

Cada pessoa tem o próprio usuário, e a equipe dele decide o que ela pode fazer ([2.2](02-equipes-e-permissoes.md#22-o-que-é-reservado-a-algumas-equipes)). Não existe cadastro aberto no Vela: todo usuário nasce aqui.

1. Em **Admin** › **Usuários**, clique em **Novo usuário**.
2. Preencha **Nome completo** e **E-mail de login** e escolha o **Setor**: a janela mostra na hora o que a pessoa vai poder fazer.
3. Defina a **Senha** e repita em **Confirmar senha**.
4. Clique em **Criar usuário**, confira o resumo na janela **Criar usuário interno** e confirme.

O usuário nasce ativo e já pode entrar. O Vela não manda e-mail à pessoa: entregue a ela o e-mail e a senha. Depois, ela mesma troca a senha em **Meu perfil** › **Alterar senha** ([1.1](01-o-vela.md#11-entrar-e-sair)).

::: atencao
- Um e-mail de login serve a um usuário só. Se a pessoa já teve usuário no Vela, não crie outro: reative o antigo ([25.5](#255-desativar-ou-reativar-um-usuário)). Usuário não se exclui, e o e-mail dele continua ocupado ("Já existe um usuário com este e-mail.").
:::

## 25.3 Trocar a equipe de um usuário

**Quem faz:** {{Administrativo}}

1. Na linha da pessoa, clique em **Editar acesso** (o ícone da chave).
2. Em **Setor**, escolha a equipe nova.
3. Clique em **Salvar** e confirme o antes → depois.

A troca vale na hora para o que a pessoa grava, mas o menu e os botões dela só mudam quando ela recarrega a página ou entra de novo; a sessão não cai.

Quem aparece como "setor antigo Operador" passa a Documentação do mesmo jeito: abra **Editar acesso** e clique em **Salvar** com **Documentação** escolhida. A partir daí a pessoa recebe o resumo diário do Portal ([2.1](02-equipes-e-permissoes.md#21-as-equipes)).

::: atencao
- O seu próprio **Setor** fica travado: só outra pessoa do {{Administrativo}} o troca.
- O Vela nunca fica sem {{Administrativo}}: tirar da equipe, ou desativar, a última pessoa ativa do {{Administrativo}} é recusado ("… é o último usuário Administrativo ativo. …"). Ative ou crie outra antes. A conta **Integração** não conta.
:::

## 25.4 Redefinir a senha ou corrigir o e-mail

**Quem faz:** {{Administrativo}}

Para socorrer quem esqueceu a senha, você define uma nova: o Vela não tem "esqueci a senha".

1. Na linha da pessoa, clique em **Editar acesso**.
2. Para a senha, preencha **Nova senha** e **Confirmar nova senha**. Para o e-mail, corrija o **E-mail de login**. O que você não mexer fica como está.
3. Clique em **Salvar** e confirme.
4. Entregue a senha nova à pessoa.

A troca derruba na hora as sessões abertas da pessoa, em qualquer computador: ela entra de novo com a credencial nova. O e-mail novo já vale para entrar, sem confirmação por e-mail.

**E-mail devolvido.** Quando um e-mail do Vela volta de um endereço da equipe, ou é marcado como spam, a lista mostra o endereço em âmbar e abre o alerta **Usuário interno com e-mail devolvido** ([20.7](20-alertas.md#207-comunicados-e-e-mail)). Corrija o endereço em **Editar acesso**. Se a caixa já voltou a funcionar, salve o mesmo e-mail: isso libera o endereço e fecha o alerta. Trocar só a senha não libera. No "setor antigo Operador", o **Setor** é salvo junto e o endereço não é liberado: salve primeiro o **Setor** e depois, de novo, o mesmo e-mail.

::: atencao
- Trocar o seu próprio e-mail ou a sua senha aqui encerra a sua sessão ("Acesso atualizado. Entre de novo com a nova credencial."). Para a sua senha, use **Meu perfil** › **Alterar senha**.
- O endereço que também é contato de um Cliente ou e-mail de recuperação do Portal continua bloqueado, e a tela avisa: a correção é pelo cadastro do Cliente ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe) e [14.7](14-portal-a-conta.md#147-liberar-um-endereço-bloqueado)).
- Na conta com a marca Dev, só a própria pessoa troca o e-mail e a senha.
:::

## 25.5 Desativar ou reativar um usuário

**Quem faz:** {{Administrativo}}

Quando a pessoa sai da empresa, desative o usuário.

1. Na linha da pessoa, clique em **Desativar** e confirme. Não pede motivo.
2. Para reativar, escolha **Inativos** em **Situação**, clique em **Reativar** na linha, escreva o motivo e confirme.

Desativado, o usuário perde o acesso na hora: a sessão aberta cai e a próxima ação dele é recusada. Reativado, ele volta a entrar com o e-mail e a senha que tinha.

::: atencao
- Ninguém desativa o próprio acesso nem o último {{Administrativo}} ativo ([25.3](#253-trocar-a-equipe-de-um-usuário)).
- Antes de desativar a última pessoa ativa de uma equipe, ative ou crie outra. Sem ninguém, os alertas dessa equipe não têm a quem avisar ([25.8](#258-acompanhar-as-falhas-de-entrega-de-alertas)).
- Não desative a conta **Integração** nem a passe para uma equipe que não seja {{Financeiro}} ou {{Administrativo}}: é ela que dá a baixa automática dos Pix do Itaú. Sem ela, os Pix das faturas de Taxas Locais e das avulsas deixam de baixar sozinhos e vão para análise (capítulo 24).
:::

## 25.6 Conferir o que cada equipe pode

**Quem faz:** {{Administrativo}}

Abaixo da lista de usuários, o quadro **O que cada setor pode** tem uma linha por ação, agrupada por assunto, e uma coluna por equipe. Ele abre em **Só exclusivas**, as ações que nem toda equipe faz; **Todas as ações** mostra também as que todas fazem.

O quadro descreve o que o Vela confere a cada gravação, não só o que a tela mostra ([2.2](02-equipes-e-permissoes.md#22-o-que-é-reservado-a-algumas-equipes)). Quando alguém diz que um botão não aparece, procure a ação no quadro: se ela é de outra equipe, o caminho é passar o pedido ([2.3](02-equipes-e-permissoes.md#23-a-quem-passar-cada-pedido)), não trocar a equipe da pessoa.

## 25.7 Consultar o Histórico de ações

**Quem faz:** {{Administrativo}}

O **Histórico de ações** junta numa lista só tudo o que se gravou no Vela, com quem fez e quando. Para a história de uma Viagem, de um B/L ou de um Cliente, a ficha de cada um é mais fácil de ler (capítulos 4, 7 e 13). Aqui ficam também as mudanças que não têm ficha: usuários, configurações, tabelas de cobrança e Condições de Cliente, tarifas e acordos de Demurrage, os alertas resolvidos com justificativa e cada **Reprocessar** da importação.

1. Em **Admin**, abra **Histórico de ações**.
2. Recorte por **Assunto** (Viagem, B/L, Fatura, Usuário, Alerta, Configuração do sistema e outros), por **Por** (**Qualquer pessoa**, **Sistema** ou uma pessoa) e pelos dias em **De** e **Até**.
3. Clique na seta da linha para ver o **De**, o **Para** e o **Motivo**.

Ninguém altera nem apaga uma linha. O Vela guarda cinco anos: as linhas mais antigas saem sozinhas, menos o histórico das escalas, que fica para sempre.

::: atencao
- Os passos que o Vela faz logo depois de uma importação, como a fatura que sai com o CE, aparecem com o nome de quem importou ([19.3](19-rotinas-por-horario.md#193-os-passos-depois-da-importação)). Se essa pessoa foi desativada, aparecem com a conta escolhida para as rotinas ou, sem ela, com a conta ativa mais antiga do {{Administrativo}}, que pode ser a **Integração**. Nem toda linha com nome foi feita à mão.
:::

## 25.8 Acompanhar as falhas de entrega de alertas

**Quem faz:** {{Administrativo}}

Todo alerta avisa no sino as pessoas ativas da equipe dele ([20.3](20-alertas.md#203-acompanhar-o-sino)); alguns tipos avisam também o {{Financeiro}} ou o {{Administrativo}}. Quando ninguém dessas equipes está ativo, o alerta crítico vai ao {{Administrativo}}, com o selo **Entrega alternativa**. O alerta normal, e o crítico quando nem o {{Administrativo}} tem alguém ativo, não chegam a ninguém e ficam registrados nesta aba. O alerta em si continua na fila de **Alertas**: o que falhou foi o aviso.

1. Em **Admin**, abra **Falhas de entrega de alertas**.
2. Leia o **Setor sem destinatário** e o **Motivo**: "Ninguém ativo no setor do alerta." ou "Ninguém ativo no setor do alerta nem no Administrativo.".
3. Em **Usuários**, ative ou crie alguém dessa equipe ([25.2](#252-criar-um-usuário) e [25.5](#255-desativar-ou-reativar-um-usuário)).
4. Use **Abrir alerta** para ir à pendência e tratá-la.

O aviso perdido não é reenviado: quem você ativar vê o alerta na fila e só recebe aviso no sino se o alerta reabrir.

## 25.9 Acompanhar o Prazo do ADR

**Quem faz:** {{Administrativo}}

O prazo é o de [11.4](11-adr-de-saida.md#114-cumprir-o-prazo-de-72-horas): cada equipe assina a sua parte do ADR de Saída até 72 horas corridas depois do ATD do terminal. Esta aba mede quem cumpriu, por equipe, nunca por pessoa.

1. Em **Admin**, abra **Prazo do ADR**.
2. Escolha o período em **Fechado de** e **Fechado até**: entram os ADRs fechados nesses dias.
3. Leia os cartões: para {{Operações}}, {{Documentação}} e {{Equipamentos}}, quantos ADRs a equipe assinou no prazo, de quantos fechados.
4. Na lista, cada ADR mostra, por equipe, **No prazo**, **Atrasou N h** (em âmbar) ou **Não assinou** (em cinza); passe o mouse para ver quando a equipe assinou.

::: atencao
- Ficam fora da medição a escala omitida, o ADR fechado sem ATD e os ADRs fechados antes de a medição existir.
- Os ADRs fechados antes de 15/10/2026 aparecem com o prazo antigo, de três dias úteis, só com a data.
:::

## 25.10 Cuidar das configurações do Vela

**Quem faz:** {{Administrativo}}; o envio real de e-mails, só a conta com a marca Dev

O Vela tem poucas configurações com tela, e cada uma fica no seu assunto:

| Configuração | Onde | Quem muda |
|---|---|---|
| **Envio real** dos e-mails ao Cliente | **Clientes** › **Comunicação**, bloco **Canal de envio** ([16.2](16-emails-e-comunicados.md#162-saber-se-os-e-mails-saem-de-verdade)) | Só a conta do {{Administrativo}} com a marca Dev |
| Intervalo da Régua de Cobrança da Demurrage | **Demurrage**, botão **Régua de cobrança** (capítulo 23) | {{Administrativo}} |

A marca Dev é dada pela equipe de desenvolvimento, nunca pela tela; na lista de usuários, a conta aparece como "Administrativo · Dev". Cada troca da chave e do intervalo fica no **Histórico de ações**, assunto **Configuração do sistema**.

O resto não tem tela: a cobrança do Pix pelo Itaú, a conta que dá a baixa automática e o calendário de feriados de Vitória/ES ficam com o suporte técnico. Quando faltam os feriados do ano seguinte, abre um alerta ([20.9](20-alertas.md#209-demurrage)). A aba **Sistema** da Administração só mostra a versão do Vela, o ambiente e as datas da última Viagem criada e da última fatura emitida.

::: atencao
- Se a troca do envio real falha, o bloco **Canal de envio** diz o motivo e continua mostrando o estado de verdade, **Envio real** ou **Redirecionado ao suporte**.
:::
