O Portal Fwlog é onde o Cliente vê os B/Ls, recebe as faturas e paga. Ninguém se cadastra sozinho nele: a conta nasce do convite que a {{Documentação}} ou o {{Administrativo}} envia, e só fica ativa quando o Cliente define a senha. Até lá, a fatura de Taxas Locais do Cliente fica retida. Neste capítulo você acompanha a fila das contas, convida o Cliente, cuida do e-mail de recuperação e suspende, reativa ou corrige uma conta. O que o Cliente vê depois de entrar está no capítulo 15.

::: aprende
- ler a fila do Provisionamento do Portal e abrir a conta de um Cliente;
- convidar o Cliente e acompanhar o convite até a ativação;
- saber quando o Portal está pronto para faturar e quando entra a Liberação de faturamento sem Portal;
- trocar o e-mail de recuperação ou liberar um endereço bloqueado;
- suspender, reativar ou corrigir o CNPJ de uma conta.
:::

## 14.1 Ler a fila do Provisionamento do Portal

**Quem faz:** {{Todas as equipes}} leem. Na rotina, a {{Documentação}}.

Todo Cliente cadastrado no Vela, pelo cadastro, pela Revisão ou pela ficha do B/L, entra na hora nesta fila, com a conta **Sem conta** e **Aguardando análise**. Nada sai sozinho: nenhum convite é enviado sem que alguém autorize. **Aguardando análise** não pede aprovação de ninguém: quer dizer só que o Cliente ainda não foi convidado. Enviar o convite já autoriza a conta.

A coluna **Conta** diz em que pé está o acesso, e a coluna **Ação** diz o próximo passo:

| Conta | Quer dizer | Ação |
|---|---|---|
| **Sem conta** | Nenhum convite pendente. | **Enviar convite**, **Escolher e-mail** ou **Cadastrar e-mail** |
| **Ativação pendente** | O convite saiu e o Cliente ainda não definiu a senha. | **Acompanhar convite** |
| **Convite expirado** | O link passou das 48 horas sem ser usado. | **Reenviar convite** |
| **Falha no envio** | O provedor de e-mail recusou o convite. | **Revisar e-mail e reenviar** |
| **Ativa** | O Cliente entra no Portal. | **Ver conta**, ou **Validar e-mail de recuperação** se o endereço tem problema |
| **Suspensa** | A equipe cortou o acesso. | **Reativar conta** |

1. Em **Clientes**, abra a aba **Provisionamento do Portal**. O número ao lado da aba conta os Clientes em **Aguardando análise**.
2. Os cartões filtram a fila, e a página abre em **Aguardando análise**. **Sem e-mail** reúne quem não tem e-mail de recuperação nem contato com e-mail. Clique de novo no cartão marcado para ver todos.
3. **Busca** acha pela razão social ou pelo CNPJ; o filtro **Alerta** mostra só quem tem alerta crítico.
4. Clique no nome do Cliente, ou no botão da coluna **Ação**, para abrir a conta ([14.2](#142-abrir-a-conta-de-um-cliente)).

A fila põe no alto quem tem alerta crítico, depois quem tem fatura em aberto ou B/L em andamento. Todo dia, às 8h, a {{Documentação}} e o {{Administrativo}} recebem por e-mail o **Resumo do Portal**, com os convites que esperam ativação e as falhas de entrega ([19.8](19-rotinas-por-horario.md#198-o-portal-liberação-entrega-de-e-mail-e-resumo-diário)).

::: atencao
O Cliente desativado continua na fila, mas não recebe convite nem entra no Portal. Para devolver o acesso, reative o Cliente na ficha dele (capítulo 13).
:::

## 14.2 Abrir a conta de um Cliente

**Quem faz:** {{Todas as equipes}} leem · ações: {{Documentação}} e {{Administrativo}}

A conta abre na própria fila, embaixo da linha, ou na ficha do Cliente, aba **Cadastro e contatos**, bloco **Acesso ao Portal** › **Gerenciar aqui**. É o mesmo painel nos dois lugares, com quatro blocos:

- **Conta do Portal**: a situação em destaque, e embaixo dela a decisão. Ao lado, o **E-mail de recuperação**, a **Origem** (escolhido entre os contatos ou **Informado manualmente**), a **Última entrega** e o **Estado do e-mail**.
- **Liberação de faturamento sem Portal** ([14.5](#145-o-que-deixa-o-portal-pronto-para-faturar)).
- **E-mail de recuperação e convite**: a escolha do endereço, o botão do convite ou da troca e **Ações administrativas**, que lista só o que vale para a situação da conta.
- **Histórico do Portal**: os dez eventos mais recentes, com **Quando**, **O que aconteceu**, **Conta** e **Por**.

A **Última entrega** fala do último e-mail do Portal para a conta: convite, recuperação de senha ou aviso. **Aceito pelo provedor** quer dizer só que o provedor recebeu o e-mail para enviar; **Entregue** confirma que ele chegou ao servidor de e-mail do Cliente. **Devolvido** e **Reclamação** pedem atenção ([14.7](#147-liberar-um-endereço-bloqueado)).

{{Operações}} vê só o bloco **Contatos com e-mail** e o e-mail de recuperação. {{Financeiro}} e {{Equipamentos}} veem o painel com os botões apagados.

::: atencao
A coluna **Por** do Histórico mostra a equipe de quem agiu, não a pessoa. Escreva na justificativa o que você conferiu e com quem: é isso que fica para quem ler depois.
:::

## 14.3 Convidar o Cliente

**Quem faz:** {{Documentação}} e {{Administrativo}}

O convite vai para o **e-mail de recuperação**, o endereço da pessoa que o Cliente autorizou a cuidar do acesso. Esse endereço recebe o convite, o link de troca de senha e os avisos de segurança da conta, e só isso: Comunicados e faturas vão aos contatos do Cliente (capítulo 13). Ele também não é o login: o Cliente entra no Portal com o CNPJ.

1. Abra a conta do Cliente ([14.2](#142-abrir-a-conta-de-um-cliente)).
2. No bloco **E-mail de recuperação e convite**, escolha um dos contatos do Cliente ou **Outro e-mail**, e digite o endereço.
3. Clique em **Enviar convite para …** (ou **Reenviar convite para …**).
4. Na janela **Autorizar e-mail de recuperação**, confirme que o endereço pertence à pessoa autorizada pelo Cliente e clique em **Enviar convite**.

Com "Convite aceito pelo provedor de e-mail.", a conta passa a **Ativação pendente**. O Cliente recebe o e-mail "Ative o acesso da … ao Portal do Cliente", com o botão **Ativar acesso**. O link vale por 48 horas e uma vez só; cada reenvio invalida o link anterior.

No exemplo, a MAQUINAS HORIZONTE LTDA espera o Portal na Revisão. O convite vai para importacao@maquinas-horizonte.example, o contato principal dela.

O mesmo convite sai da Revisão ([8.3](08-revisao.md#83-convidar-o-cliente-para-o-portal)) e do bloco **Portal** da ficha do B/L ([7.4](07-ficha-do-bl.md#74-vincular-ou-trocar-o-cliente-do-bl)), com as mesmas regras. Os dois levam para cá quando a conta não aceita convite.

::: atencao
- Conta **Ativa** ou **Suspensa** não recebe convite: a ativa usa a recuperação de senha, e a suspensa precisa ser reativada antes ([14.8](#148-suspender-ou-reativar-a-conta)).
- O mesmo e-mail pode servir a mais de um CNPJ, e o painel avisa "Este e-mail também aparece em N outro(s) CNPJ(s)". Confira com o Cliente: quem lê essa caixa pode trocar a senha de todas essas contas.
:::

## 14.4 Acompanhar o convite até a ativação

**Quem faz:** {{Documentação}} e {{Administrativo}}

No e-mail, o Cliente clica em **Ativar acesso**. A tela mostra a empresa e o CNPJ, com parte dos números escondida, e pede a **Nova senha** e a **Confirmar senha**: no mínimo 8 caracteres, com letra maiúscula, minúscula e número. Depois de **Ativar acesso**, a tela **Acesso ativado** manda entrar com o CNPJ e a senha; o Cliente não entra sozinho. Na fila, a conta fica **Ativa**, o Histórico registra "Ativação concluída pelo cliente" e as faturas retidas do Cliente saem na hora ([14.5](#145-o-que-deixa-o-portal-pronto-para-faturar)).

Quando a ativação não acontece:

| Na fila ou no relato do Cliente | O que fazer |
|---|---|
| **Ativação pendente** há dias | Peça ao Cliente para procurar o e-mail, também no spam. Se não achar, reenvie. |
| **Convite expirado** | Reenvie. O Vela marca o convite como expirado depois de 48 horas, mas não reenvia sozinho. |
| **Falha no envio** | O endereço foi recusado. Confira-o com o Cliente, corrija e clique em **Revisar e-mail e reenviar**. |
| O Cliente vê **Convite indisponível** | O link venceu, já foi usado ou foi trocado por um reenvio. Peça para usar o e-mail mais recente ou reenvie. |

Se o convite foi para o endereço errado, revogue-o: em **Ações administrativas**, escolha **Revogar o convite** (só na **Ativação pendente**), escreva a justificativa e confirme em **Revogar convite**. O link deixa de funcionar e a conta volta a **Sem conta** e **Aguardando análise**. Para seguir, envie um novo convite.

::: atencao
**Aceito pelo provedor** não prova que o e-mail chegou à caixa do Cliente. Antes de reenviar várias vezes, confirme o endereço com ele.
:::

## 14.5 O que deixa o Portal pronto para faturar

**Quem faz:** {{Todas as equipes}} conferem · Liberação de faturamento sem Portal: {{Administrativo}}

O Portal do Cliente está **pronto** quando a conta está **Ativa** e o e-mail de recuperação é válido, está **Em ordem** e fora da lista de bloqueio. É no Portal que o Cliente vê e paga a fatura; por isso, sem Portal pronto, o CE Mercante calcula a fatura de Taxas Locais e a **retém**. O B/L fica na Revisão como **Portal não provisionado** (capítulo 8). A fatura avulsa não depende do Portal.

A fatura retida sai sozinha, com o preço fixado na importação, quando:

- o Cliente ativa a conta;
- o Cliente confirma um novo e-mail de recuperação pelo Portal;
- a equipe troca o e-mail de recuperação ou libera o endereço bloqueado, e o Portal fica pronto ([14.6](#146-trocar-o-e-mail-de-recuperação) e [14.7](#147-liberar-um-endereço-bloqueado));
- o {{Administrativo}} concede a Liberação de faturamento sem Portal.

A **Liberação de faturamento sem Portal** é a decisão de faturar um Cliente enquanto o Portal dele não fica pronto. Ela tem justificativa e uma data de revisão de no máximo 30 dias. O bloco fica no painel da conta e na aba **Financeiro** da ficha do Cliente (capítulo 13), e o botão só aparece quando o Portal não está pronto e não há Liberação vigente.

1. No bloco **Liberação de faturamento sem Portal**, clique em **Conceder liberação** (ou **Conceder nova liberação**, se o Cliente já teve uma).
2. Preencha **Justificativa** e **Data de revisão** e clique em **Liberar faturamento**.
3. Confirme em **Liberar e emitir** e leia o resultado: quantas faturas saíram e quantos B/Ls seguem com outro bloqueio.

No exemplo, a ATLANTICO IMPORTADORA LTDA tem Liberação: o CSC45810A01K00 foi faturado sem que ela tenha conta ativa.

::: atencao
- A Liberação não ativa a conta nem dá acesso ao Cliente: sem Portal, alguém da equipe precisa entregar a fatura a ele. Continue o convite.
- Quando a data de revisão passa, as novas faturas voltam a ficar retidas e os B/Ls ainda não faturados voltam para a Revisão ([19.8](19-rotinas-por-horario.md#198-o-portal-liberação-entrega-de-e-mail-e-resumo-diário)).
- **Visível no Portal**, no bloco **Portal** da ficha do B/L, pede só a conta ativa, o Cliente e o CE. Com o e-mail de recuperação bloqueado, o Cliente vê o B/L, mas a fatura nova fica retida.
:::

## 14.6 Trocar o e-mail de recuperação

**Quem faz:** {{Documentação}} e {{Administrativo}}

Troque quando a pessoa que cuidava do acesso saiu da empresa ou o endereço parou de funcionar. Aqui a troca é para a conta **Ativa**; antes da ativação, basta enviar um novo convite para o endereço certo. O próprio Cliente também troca pelo Portal, com a senha atual e a confirmação pelo endereço novo (capítulo 15).

1. Na conta do Cliente, em **Novo e-mail de recuperação**, escolha um contato ou **Outro e-mail**.
2. Escreva a **Justificativa da troca**: o que você conferiu e com quem.
3. Clique em **Trocar e-mail de recuperação**.

O endereço novo vale na hora. Os links de recuperação de senha pendentes deixam de valer, o Cliente é desconectado do Portal em todos os aparelhos e o endereço anterior recebe o e-mail "Seu Email de Recuperação foi trocado". Se a troca deixa o Portal pronto, as faturas retidas saem ([14.5](#145-o-que-deixa-o-portal-pronto-para-faturar)).

::: atencao
- Avise o Cliente antes: ele vai precisar entrar de novo.
- Com uma recuperação de senha em andamento, a troca é recusada. Espere o Cliente terminar a redefinição e tente de novo.
:::

## 14.7 Liberar um endereço bloqueado

**Quem faz:** {{Documentação}} e {{Administrativo}}

Quando um e-mail do Portal volta como devolvido em definitivo ou marcado como spam, o endereço entra na lista de bloqueio e o Vela para de enviar a ele. O bloqueio nunca vence sozinho. Se o endereço bloqueado é o e-mail de recuperação, o painel avisa em vermelho e a fila mostra **Validar e-mail de recuperação**. O Cliente continua entrando com a senha, mas a recuperação de senha não chega a ele, e o Portal deixa de estar pronto para faturar.

Há duas saídas: trocar para outro endereço ([14.6](#146-trocar-o-e-mail-de-recuperação)) ou, se o Cliente confirma que a caixa voltou a funcionar, liberar o atual.

1. Na conta do Cliente, clique em **Ações administrativas** e escolha **Liberar endereço bloqueado**.
2. Escreva na **Justificativa** quem confirmou que a caixa voltou e clique em **Liberar endereço bloqueado**.
3. Confirme em **Liberar endereço**.

O endereço sai da lista e o **Estado do e-mail** volta a **Em ordem** em todas as contas que usam esse endereço, cada uma com o registro no Histórico. Se o Portal fica pronto, as faturas retidas saem.

::: atencao
Libere só com a confirmação do Cliente. Cada e-mail enviado a uma caixa que não existe mais prejudica a entrega dos e-mails do Portal a todos os Clientes.
:::

## 14.8 Suspender ou reativar a conta

**Quem faz:** {{Documentação}} e {{Administrativo}}

**Suspender** corta o acesso do Cliente na hora, sem apagar a conta: use quando há suspeita de acesso indevido ou o Cliente pede o bloqueio.

1. Na conta do Cliente, clique em **Ações administrativas** e escolha **Suspender a conta**.
2. Escreva a **Justificativa** e clique em **Suspender a conta**.

O Cliente é desconectado de todos os aparelhos, a conta fica **Suspensa** e os links pendentes deixam de valer. O Cliente não recebe e-mail sobre a suspensão: avise-o você.

**Reativar a conta** (em **Ações administrativas**, na conta **Suspensa**) não devolve a conta como estava. Ela volta a **Sem conta** e **Aguardando análise**, a senha antiga deixa de valer e o Cliente precisa de um novo convite e de uma senha nova ([14.3](#143-convidar-o-cliente)).

::: atencao
- Para o Cliente, a conta suspensa parece senha errada: o login mostra a mesma mensagem genérica (capítulo 15). Confira a situação aqui antes de orientá-lo.
- A conta suspensa não é Portal pronto: as faturas novas do Cliente ficam retidas até a nova ativação ou uma Liberação.
:::

## 14.9 Alterar o CNPJ

**Quem faz:** {{Administrativo}}

O CNPJ do cadastro é o login do Cliente no Portal. Depois que o Cliente tem um convite ou uma conta, o CNPJ fica protegido: o cadastro e a Base de Clientes não o mudam, e a ficha avisa "Alterado só pelo Administrativo, com auditoria, em Acesso ao Portal › Gerenciar aqui.".

1. Na conta do Cliente ([14.2](#142-abrir-a-conta-de-um-cliente)), clique em **Ações administrativas** e escolha **Alterar o CNPJ**.
2. Digite o **Novo CNPJ** e a **Justificativa**.
3. Clique em **Alterar o CNPJ**.

A troca muda de uma vez o CNPJ do Cliente e o do login. Avise o Cliente: a partir daí ele entra com o CNPJ novo.
