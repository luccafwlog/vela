A página **Admin** é do {{Administrativo}}. É nela que nascem os usuários do Vela, que se escolhe a equipe de cada pessoa e que se cuida do acesso de quem chega e de quem sai. Ela guarda também o histórico de tudo o que se gravou e, para a conta com a marca Dev, a aba **Sistema**: o que pede atenção, as rotinas automáticas, as configurações e os alertas que não acharam ninguém para avisar. O cumprimento do prazo do ADR de Saída por equipe fica em **Relatórios**.

::: aprende
- criar um usuário e escolher a equipe dele;
- trocar a equipe, redefinir a senha ou corrigir o e-mail de um usuário;
- desativar e reativar um usuário sem deixar uma equipe sem ninguém;
- consultar o Histórico de ações, uma linha por ação;
- acompanhar o prazo do ADR de Saída por equipe, em Relatórios;
- usar a aba Sistema (só a conta Dev): pontos de atenção, rotinas, configurações e falhas de entrega de alertas.
:::

## 25.1 Abrir a Administração

**Quem faz:** {{Administrativo}}

**Admin**, no menu, só aparece para o {{Administrativo}}; para as outras equipes, o endereço da página mostra **Acesso restrito** ([1.6](01-o-vela.md#16-quando-algo-dá-errado)). A página **Administração** tem três abas, **Usuários** (abre primeiro), **Histórico de ações** e **Sistema**, cada uma com endereço próprio: o link copiado abre a mesma aba. **Sistema** só aparece para a conta do {{Administrativo}} com a marca Dev; para os demais, a página mostra as outras duas, e o link de **Sistema** abre **Acesso restrito**, com **Ir para Usuários**. Os links antigos das abas que mudaram de lugar continuam funcionando: **Falhas de entrega de alertas** abre **Sistema**, e **Prazo do ADR** abre **Relatórios** › **Prazo do ADR**.

Na aba **Usuários**, a lista abre só com os **Ativos**; em **Situação**, escolha **Inativos** ou **Todos**. Duas marcas da lista pedem atenção:

| Na lista | Quer dizer |
|---|---|
| E-mail em âmbar, com ⚠ | Um e-mail do Vela voltou desse endereço ou foi marcado como spam, e o Vela parou de enviar para ele ([25.4](#254-redefinir-a-senha-ou-corrigir-o-e-mail)). |
| "Documentação · setor antigo Operador" | Vale como Documentação, mas não recebe o resumo diário do Portal ([25.3](#253-trocar-a-equipe-de-um-usuário)). |

::: tela admin-usuarios
A aba **Usuários**: a lista dos ativos, com a marca do setor antigo Operador, e **Editar acesso** (a chave) em cada linha.
:::

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

::: tela editar-acesso
**Editar acesso**: ao trocar o **Setor**, a janela mostra na hora o que a pessoa passa a poder fazer.
:::

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
- Antes de desativar a última pessoa ativa de uma equipe, ative ou crie outra. Sem ninguém, os alertas dessa equipe não têm a quem avisar ([25.8](#258-acompanhar-as-falhas-de-entrega-de-alertas)); a confirmação de **Desativar** avisa quando a pessoa é a última da equipe.
- Não desative a conta **Integração** nem a tire do {{Financeiro}}: é ela que dá a baixa automática dos Pix do Itaú, e desde 2026-11-04 só a conta do {{Financeiro}} dá baixa (antes, também a do {{Administrativo}}). Sem ela, os Pix das faturas de Taxas Locais e das avulsas deixam de baixar sozinhos e vão para análise (capítulo 24). Trocar o setor dela é recusado ("A conta da baixa automática do Pix Itaú precisa ser do Financeiro: …").
:::

## 25.6 Conferir o que cada equipe pode

**Quem faz:** {{Administrativo}}

Abaixo da lista de usuários, o quadro **O que cada setor pode** tem uma linha por ação, agrupada por assunto, e uma coluna por equipe. Ele vem recolhido: **Mostrar** abre o quadro e **Recolher** o fecha. Aberto, começa em **Só exclusivas**, as ações que nem toda equipe faz; **Todas as ações** mostra também as que todas fazem.

O quadro descreve o que o Vela confere a cada gravação, não só o que a tela mostra ([2.2](02-equipes-e-permissoes.md#22-o-que-é-reservado-a-algumas-equipes)). Quando alguém diz que um botão não aparece, procure a ação no quadro: se ela é de outra equipe, o caminho é passar o pedido ([2.3](02-equipes-e-permissoes.md#23-a-quem-passar-cada-pedido)), não trocar a equipe da pessoa.

## 25.7 Consultar o Histórico de ações

**Quem faz:** {{Administrativo}}

O **Histórico de ações** junta numa lista só tudo o que se gravou no Vela, uma linha por **ação**: o que uma pessoa, o Cliente pelo Portal ou o próprio Vela gravou de uma vez. Uma importação de B/L que cria 17 B/Ls e 781 containers é uma linha só, "781 Containers criados, 17 B/Ls criados". Para a história de uma Viagem, de um B/L ou de um Cliente, a ficha de cada um é mais fácil de ler (capítulos 4, 7 e 13). Aqui ficam também as mudanças que não têm ficha (usuários, configurações, tabelas de cobrança e Condições de Cliente, tarifas, acordos e tipos de container de Demurrage, a Liberação de faturamento, os alertas resolvidos com justificativa, cada **Reprocessar** da importação, o Pix marcado como tratado e as exceções do extrato) e o que tem história em outra tela: os pedidos de **Desbloqueio de CE**, a **Conta do Portal**, os **Comunicados** enviados e as mensagens e anexos da **Disputa de Demurrage**.

1. Em **Admin**, abra **Histórico de ações**. Ela abre nos últimos **30 dias**; mude em **Período** (**Hoje**, **7 dias**, **30 dias**, **Tudo** ou **Escolher datas**).
2. Para achar um registro, escreva em **Busca** o B/L, o CE, o container, o navio, a viagem ou o Cliente (nome ou CNPJ). Recorte também por **Assunto** (agrupado por área), por **Ação** (**Criou**, **Alterou** ou **Excluiu**) e por **Por** (uma pessoa, **Sistema** ou **Cliente pelo Portal**).
3. Leia a linha. **Quando** traz a hora com os segundos. **O que fez** resume a ação; o **Registro** vem pelo nome (a Viagem como navio e número, o B/L, o Cliente, a fatura), mesmo depois de excluído, com "e mais N" quando a ação mexeu em vários; o **Motivo** é a justificativa de quem fez. Passe o mouse no nome, em **Por**, para ver o e-mail e a equipe.
4. Clique na seta da linha. Uma ação de uma linha só mostra o **De** e o **Para**; a de várias mostra o resumo por tipo de registro e **Ver campo a campo**, com cada campo que mudou.
5. Para levar o recorte para fora, use **Exportar planilha**: vem uma linha por campo, até 10.000, e a aba **Filtros** da planilha diz o recorte usado (Busca, Assunto, **Por**, Ação e as datas). Com Busca, Assunto ou Ação, a planilha traz só as linhas que batem com eles, não a ação inteira que a tela resume: filtrando **Container**, vêm as linhas dos containers da importação, sem as dos B/Ls; a aba **Filtros** avisa isso.

Na linha do **Sistema**, e quando a mudança veio de uma importação ou de um passo automático do Vela, o **Motivo** diz de onde ela veio ("Origem: …"). Quando ninguém escreveu motivo, a coluna fica com "—". O que o Cliente fez no Portal aparece em **Por** como "Cliente pelo Portal", seguido do nome do Cliente.

Acima de 10.000 ações, o título diz **Mais de 10.000 ações** e o rodapé "Exibindo 1–50 de mais de 10.000"; **Próxima** continua enquanto houver ações, e o período e a busca ajudam a chegar mais rápido.

Ninguém altera nem apaga uma linha. O Vela guarda cinco anos: as linhas mais antigas saem sozinhas, menos o histórico das escalas, que fica para sempre. Desde 06/11/2026 o Vela não grava mais as colunas que só ele usa (data de atualização e afins), que antes apareciam como "B/L alterado".

::: atencao
- Os passos que o Vela faz logo depois de uma importação, como a fatura que sai com o CE, aparecem com o nome de quem importou ([19.3](19-rotinas-por-horario.md#193-os-passos-depois-da-importação)). Se essa pessoa foi desativada, aparecem com a conta escolhida para as rotinas ou, sem ela, com a conta ativa mais antiga do {{Administrativo}}, que pode ser a **Integração**. Nem toda linha com nome foi feita à mão.
:::

## 25.8 Acompanhar as falhas de entrega de alertas

**Quem faz:** a conta do {{Administrativo}} com a marca Dev

Todo alerta avisa no sino as pessoas ativas da equipe dele ([20.3](20-alertas.md#203-acompanhar-o-sino)); alguns tipos avisam também o {{Financeiro}} ou o {{Administrativo}}. Quando ninguém dessas equipes está ativo, o alerta crítico vai ao {{Administrativo}}, com o selo **Entrega alternativa**. O alerta normal, e o crítico quando nem o {{Administrativo}} tem alguém ativo, não chegam a ninguém e ficam registrados no bloco **Falhas de entrega de alertas** da aba **Sistema**. O alerta em si continua na fila de **Alertas**: o que falhou foi o aviso.

1. Em **Admin** › **Sistema**, veja os **Pontos de atenção**: uma equipe sem ninguém ativo aparece ali antes de algum alerta se perder, com **Abrir Usuários**.
2. No bloco **Falhas de entrega de alertas**, leia o **Setor sem destinatário** e o **Motivo**: "Ninguém ativo no setor do alerta." ou "Ninguém ativo no setor do alerta nem no Administrativo.".
3. Em **Usuários**, ative ou crie alguém dessa equipe ([25.2](#252-criar-um-usuário) e [25.5](#255-desativar-ou-reativar-um-usuário)).
4. Use **Abrir alerta** para ir à pendência e tratá-la.

O aviso perdido não é reenviado: quem você ativar vê o alerta na fila e só recebe aviso no sino se o alerta reabrir.

## 25.9 Acompanhar o Prazo do ADR

**Quem faz:** {{Administrativo}}

O prazo é o de [11.4](11-adr-de-saida.md#114-cumprir-o-prazo-de-72-horas): cada equipe assina a sua parte do ADR de Saída até 72 horas corridas depois do ATD do terminal. A visão **Prazo do ADR**, em **Relatórios**, mede quem cumpriu, por equipe, nunca por pessoa. Só o {{Administrativo}} a vê.

1. Em **Relatórios**, abra **Prazo do ADR**.
2. Escolha o período em **Fechado de** e **Fechado até**: entram os ADRs fechados nesses dias.
3. Leia os cartões: para {{Operações}}, {{Documentação}} e {{Equipamentos}}, quantos ADRs a equipe assinou no prazo, de quantos fechados.

::: tela prazo-do-adr
Um ADR fechado em Salvador: Operações e Documentação assinaram no prazo, e Equipamentos atrasou 12 horas.
:::
4. Na lista, cada ADR mostra, por equipe, **No prazo**, **Atrasou N h** (em âmbar) ou **Não assinou** (em cinza); passe o mouse para ver quando a equipe assinou.
5. Para levar a lista para fora, use **Exportar planilha**.

::: atencao
- Ficam fora da medição a escala omitida, o ADR fechado sem ATD e os ADRs fechados antes de a medição existir.
- Os ADRs fechados antes de 15/10/2026 aparecem com o prazo antigo, de três dias úteis, só com a data.
:::

## 25.10 Cuidar das configurações do Vela

**Quem faz:** a conta do {{Administrativo}} com a marca Dev; o intervalo da Régua, também {{Financeiro}} e {{Equipamentos}}

As configurações ficam em **Admin** › **Sistema** › **Configurações**, que só a conta com a marca Dev vê:

| Configuração | O que mostra | Quem muda |
|---|---|---|
| **Envio real** dos e-mails ao Cliente ([16.2](16-emails-e-comunicados.md#162-saber-se-os-e-mails-saem-de-verdade)) | **Envio real** ou **Redirecionado ao suporte**, com a chave e **Enviar teste para mim** | A conta Dev, na própria tela, com confirmação |
| Intervalo da Régua de Cobrança da Demurrage | De quantos em quantos dias a cobrança sai | {{Administrativo}}, {{Financeiro}} e {{Equipamentos}}, em **Demurrage**, botão **Régua de cobrança** (capítulo 23) |
| Conta das rotinas | A conta escolhida ou, sem ela, a que vale: a conta ativa mais antiga do {{Administrativo}} | Suporte técnico |
| Pix | Itaú, com o prazo de vencimento e a conta da baixa automática | Suporte técnico |
| Feriados de Vitória/ES | Até que dia estão cadastrados | Suporte técnico |

**Enviar teste para mim** manda um e-mail ao endereço de login da conta Dev, de verdade, com a chave ligada ou desligada. Use para conferir que o canal de envio funciona sem mandar nada a Cliente. Se o teste não sai, a tela diz por quê: o seu e-mail bloqueado por devolução ou spam, a conta sem e-mail ou o provedor que não aceitou.

Acima das configurações, **Pontos de atenção** lista o que pede ação: equipe sem ninguém ativo, alerta que não chegou a ninguém, rotina cuja última execução falhou, leitura do Pix Itaú parada, e-mail bloqueado e feriados do ano seguinte faltando. Sem nada, diz **Nada pede atenção**. Ao lado, **Rotinas automáticas** mostra cada rotina do Vela, quando roda, a última vez e a situação. No rodapé ficam a versão do Vela e o ambiente.

A marca Dev é dada pela equipe de desenvolvimento, nunca pela tela; na lista de usuários, a conta aparece como "Administrativo · Dev". Cada troca da chave e do intervalo fica no **Histórico de ações**, assunto **Configuração do sistema**.

::: atencao
- Se a troca do envio real falha, o bloco **Configurações** diz o motivo e continua mostrando o estado de verdade, **Envio real** ou **Redirecionado ao suporte**.
- Quando faltam os feriados do ano seguinte, abre também um alerta ([20.9](20-alertas.md#209-demurrage)).
:::
