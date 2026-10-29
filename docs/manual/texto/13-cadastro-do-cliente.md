O Cliente é a empresa, identificada pelo CNPJ, que recebe a carga do B/L, vê o B/L no Portal e paga a fatura. No Vela, tudo o que é dele fica numa ficha: o cadastro, os contatos que recebem os avisos por e-mail, a conta do Portal, os B/Ls, as faturas e a história de cada mudança. Neste capítulo você encontra e cadastra o Cliente, corrige o cadastro, cuida dos contatos e publica a Central de Informações, a página do Portal onde o Cliente consulta depots, agentes e contatos da agência. Se é do Administrativo, também libera o faturamento sem Portal e desativa um Cliente.

::: aprende
- encontrar um Cliente e ler a ficha dele;
- cadastrar um Cliente, um a um ou pela base de Clientes;
- corrigir o cadastro e cuidar dos contatos que recebem os Comunicados;
- onde ficam as faturas e as condições negociadas do Cliente;
- liberar o faturamento de um Cliente que ainda não tem Portal;
- publicar a Central de Informações do Portal;
- desativar, reativar ou excluir um Cliente.
:::

## 13.1 Encontrar um Cliente

**Quem faz:** {{Todas as equipes}}

A página **Clientes**, no menu, tem três abas: **Clientes**, a lista deste capítulo; **Provisionamento do Portal**, onde se cuida da conta do Cliente no Portal (capítulo 14); e **Comunicação**, os avisos por e-mail (capítulo 16).

::: tela clientes-lista
A lista de Clientes, com a busca e os filtros.
:::

1. Em **Buscar cliente**, digite a razão social, o nome fantasia ou o CNPJ, com ou sem pontuação.
2. Se precisar, recorte pelos filtros: **E-mail do contato**, **B/Ls vinculados**, **Saldo pendente** e **E-mails de contato**.
3. Clique no nome do Cliente para abrir a ficha.

Os cartões do alto somam o recorte inteiro, não só a página. **Saldo pendente** e **Sem e-mail de contato** ficam em âmbar quando há algo e, ao clique, filtram a lista. Na lista, a coluna **Portal** diz em que pé está a conta do Cliente, e o **Saldo pendente** em âmbar abre as faturas dele em **Taxas Locais**. Cliente desativado continua na lista, em cinza.

A busca e os filtros ficam no endereço da página: o link copiado abre o mesmo recorte para um colega. **Exportar base** leva o recorte para uma planilha no formato da importação ([13.4](#134-importar-a-base-de-clientes)).

## 13.2 Ler a ficha do Cliente

**Quem faz:** {{Todas as equipes}}

1. A faixa do alto traz o CNPJ, a cidade, o e-mail do contato principal e quantos B/Ls o Cliente tem. **Mais ações** leva às faturas em **Taxas Locais**, aos B/Ls na lista de **BLs** e ao **Provisionamento do Portal**.
2. A **Visão geral** mostra o **Saldo pendente**, a situação do **Portal**, o **Contato principal** e as pendências do Cliente, cada uma no bloco do assunto e com o atalho para resolver. Embaixo, a **Atividade recente**.
3. As outras abas: **Cadastro e contatos** ([13.5](#135-corrigir-o-cadastro) e [13.6](#136-cuidar-dos-contatos-do-cliente)), **BLs**, **Contêineres** (com a Demurrage de cada um), **Financeiro** ([13.7](#137-as-faturas-e-as-condições-negociadas)), **Histórico** e **Desbloqueio de CE e VIP** (capítulo 12).

O **Saldo pendente** soma duas partes: o **Faturado em aberto** e o **A faturar**, as Taxas Locais já calculadas que ainda não viraram fatura. Por isso ele pode ser maior que o saldo que o Cliente vê no Portal, que conta só as faturas emitidas (capítulo 17).

Duas pendências da **Visão geral** pedem atenção. **Faturas retidas**, no bloco **Portal**, quer dizer que o Portal do Cliente não está pronto e as faturas dele esperam a conta ser ativada (capítulo 14) ou a Liberação ([13.8](#138-liberar-o-faturamento-sem-portal)). **Sem contato principal com e-mail** quer dizer que os Comunicados não chegam ao Cliente, embora a fatura continue saindo ([13.6](#136-cuidar-dos-contatos-do-cliente)).

O **Histórico** conta tudo o que aconteceu com o Cliente: cadastro, contatos, Portal, faturas, pagamentos, B/Ls e Comunicados, com quem fez. Use o filtro por assunto para achar um evento. As mudanças do cadastro e dos contatos, com o antes e o depois, ficam também no bloco **Alterações do cadastro**, na aba **Cadastro e contatos**.

## 13.3 Cadastrar um Cliente

**Quem faz:** {{Documentação}}, {{Equipamentos}} e {{Administrativo}}

O CNPJ é a identidade do Cliente: um Cliente por CNPJ, numérico ou alfanumérico. Não existe Cliente pessoa física. Na maior parte das vezes você não precisa cadastrar: o Cliente nasce na Revisão, a partir do CNPJ lido no B/L ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)), ou pela base de Clientes ([13.4](#134-importar-a-base-de-clientes)). **Novo cliente** serve para cadastrar antes de o manifesto chegar. As outras equipes não veem o botão e trazem o Cliente pela base ou pela Revisão.

1. Em **Clientes**, busque o CNPJ: o Cliente pode já existir. Se não existe, clique em **Novo cliente**.
2. Preencha **CNPJ** e **Razão social**. O endereço não é obrigatório, mas é o que sai na fatura.
3. Em **Contatos**, preencha **Nome** e **E-mail** do **Contato principal**, que recebe todas as caixas. Para outro contato, clique em **Adicionar contato** e marque as caixas dele ([13.6](#136-cuidar-dos-contatos-do-cliente)).
4. Clique em **Cadastrar cliente** e confirme.

A ficha do novo Cliente abre. Ele já pode ser vinculado a B/Ls, e o B/L importado depois com o CNPJ dele se vincula sozinho (capítulo 6). No **Provisionamento do Portal**, ele aparece como **Aguardando análise**: nenhum convite sai sem alguém enviar (capítulo 14).

::: atencao
- O Vela não aceita dois Clientes com o mesmo CNPJ. Se o CNPJ é de um Cliente desativado, peça ao {{Administrativo}} que o reative ([13.10](#1310-desativar-reativar-ou-excluir-um-cliente)).
- Os B/Ls que já esperavam na Revisão com esse CNPJ não se vinculam sozinhos ao novo cadastro: vincule-os na Revisão ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)).
- Todo contato precisa de nome e de e-mail válido. Contato que você não vai preencher, remova antes de cadastrar.
:::

## 13.4 Importar a base de Clientes

**Quem faz:** {{Qualquer equipe}} · e-mails da planilha: {{Documentação}}, {{Equipamentos}} e {{Administrativo}}

A base é uma planilha com um Cliente por linha. **CNPJ**, **Razão Social** e **E-mail** são obrigatórios; Nome Fantasia, Endereço, Cidade, UF e CEP, opcionais. Cabem até 3.000 Clientes por arquivo. O CNPJ decide: se o Cliente já existe, ele é atualizado; se não, é criado. Para corrigir muitos Clientes de uma vez, use **Exportar base**, corrija a planilha e importe de volta.

1. Em **Clientes**, clique em **Importar base** e escolha o arquivo (.xlsx, .xls ou .csv).
2. Confira a **Prévia**: quantos Clientes são novos, atualizados ou ficam sem alteração, os e-mails e os B/Ls que vão ser vinculados.
3. Se há avisos, leia cada um e marque **Conferi os avisos e quero importar o arquivo**.
4. Clique em **Importar**; o botão diz quantos Clientes entram.

A razão social passa a ser a da planilha; os outros campos só mudam quando vêm preenchidos. O e-mail novo vira contato do Cliente, e o que já existe não se repete. Os B/Ls que esperavam na Revisão por um Cliente com aquele CNPJ são vinculados na hora.

::: atencao
- Uma linha sem CNPJ válido, sem Razão Social ou sem e-mail recusa a base inteira: nada é gravado. Corrija a planilha e escolha o arquivo de novo.
- Fora da Documentação, de Equipamentos e do Administrativo, a base grava só o cadastro e deixa os e-mails de fora. A prévia avisa: "Você importa só o cadastro".
- Cliente desativado não muda pela base, e os B/Ls com o CNPJ dele ficam só com sugestão na Revisão.
:::

## 13.5 Corrigir o cadastro

**Quem faz:** {{Qualquer equipe}} · CNPJ: {{Administrativo}}

1. Na ficha, abra **Cadastro e contatos**. No bloco **Dados cadastrais**, corrija a razão social, o nome fantasia, o endereço, a cidade, a UF, o CEP ou as **Notas**.
2. Escreva a **Justificativa**.
3. Clique em **Salvar cadastro** e confira o antes → depois de cada campo.

Os dados novos saem nas faturas emitidas daqui em diante. A fatura já emitida guarda o cadastro do dia da emissão e não muda. As **Notas** são de uso interno: o Cliente não as vê.

O CNPJ não se corrige aqui, porque é com ele que o Cliente entra no Portal: a troca é do {{Administrativo}}, na conta do Portal (capítulo 14).

## 13.6 Cuidar dos contatos do Cliente

**Quem faz:** {{Documentação}}, {{Equipamentos}} e {{Administrativo}}. As outras equipes só leem.

Os **Comunicados** são os e-mails que o Vela manda ao Cliente: o CE e Taxas, os avisos de chegada e atracação do navio (NOA, NOR e NOB) e as cobranças de Demurrage. Eles vão para os contatos do Cliente, organizados em três **caixas**: **Documentação e Operação**, **Financeiro** e **Demurrage**. Cada contato recebe as caixas marcadas para ele, e uma caixa pode ter vários contatos; qual e-mail vai para qual caixa está no capítulo 16.

::: tela cliente-quem-recebe
O quadro Quem recebe os Comunicados da ATLANTICO IMPORTADORA LTDA: o contato principal está nas três caixas.
:::

O **contato principal** é um só e precisa de e-mail. Contato não é acesso ao Portal: o e-mail de recuperação da conta recebe só o convite e a recuperação de senha, nunca Comunicados nem faturas (capítulo 14).

1. Na ficha, abra **Cadastro e contatos**. O bloco **Quem recebe os Comunicados** mostra quem está em cada caixa.
2. No bloco **Contatos**, corrija **Nome**, **E-mail** ou **Telefone / WhatsApp**, ou clique em **Adicionar contato**.
3. Marque as **Caixas de recebimento** de cada contato. Use **Tornar principal** ou **Desativar** quando o Cliente pedir.
4. Clique em **Salvar contatos**. A **Justificativa da alteração** é opcional e vai para o Histórico.

O Cliente também muda os contatos pelo Portal (capítulo 15). Cada contato mostra de onde veio: **Cadastrado pela equipe**, **Informado no Portal** ou **Capturado do B/L**, o e-mail do consignatário que a importação trouxe.

::: atencao
- Toda caixa precisa de pelo menos um contato ativo com e-mail. Para tirar o principal de uma caixa, ponha antes outro contato nela; para desativá-lo, eleja antes outro principal.
- O contato com "Endereço bloqueado" não recebe os Comunicados: o e-mail voltou em definitivo ou foi marcado como spam. Nenhum botão desbloqueia: troque o e-mail do contato pelo endereço novo que o Cliente informar.
:::

## 13.7 As faturas e as condições negociadas

**Quem faz:** ler, {{Todas as equipes}} · criar Condição de Cliente, {{Qualquer equipe}}; mudar uma condição cadastrada, {{Administrativo}}

A aba **Financeiro** da ficha reúne o dinheiro do Cliente: as **Faturas** de Taxas Locais e de Demurrage (a seta de cada fatura abre o saldo por B/L), os **Pagamentos**, os **Acordos de Demurrage** e as **Tarifas do cliente**. O B/L que tem valor a cobrar e nenhuma fatura em vigor aparece como "Sem fatura ativa".

A **Condição de Cliente** é o valor negociado com o Cliente para uma taxa: enquanto vigente, ela substitui o valor da tabela de cobrança no cálculo das Taxas Locais. O bloco **Tarifas do cliente** lista as condições dele com a situação de cada uma (**Vigente**, **Começa em …**, **Encerrada** ou **Desativada**), e o link do bloco abre a lista **Condições de Cliente**, em Taxas Locais, já filtrada pelo Cliente. A condição nova vale para os B/Ls importados depois dela: o B/L já importado guarda o preço do dia da importação (capítulo 21).

No mesmo bloco, **B/Ls com cobrança manual** e **B/Ls com taxa alterada** mostram os B/Ls do Cliente em que alguém lançou, alterou, excluiu ou isentou uma taxa à mão.

Os **Acordos de Demurrage** são o free time e as tarifas negociados com o Cliente. Qualquer equipe cadastra um em **Novo acordo**, no próprio bloco (capítulos 9 e 23).

## 13.8 Liberar o faturamento sem Portal

**Quem faz:** {{Administrativo}}. As outras equipes veem a situação da Liberação.

A fatura só sai para o Cliente com o Portal pronto, isto é, com a conta ativa e o e-mail de recuperação em ordem. Sem isso, a fatura fica retida quando o CE Mercante é registrado, e os B/Ls esperam na Revisão em **Portal não provisionado** ([8.3](08-revisao.md#83-convidar-o-cliente-para-o-portal)). A **Liberação de faturamento sem Portal** é a decisão de faturar mesmo assim, por um prazo. Ela não ativa a conta nem dá acesso ao Cliente: sem Portal, ele não vê a fatura, e alguém da equipe a entrega.

1. Na ficha, aba **Financeiro**, no bloco **Liberação de faturamento sem Portal**, clique em **Conceder liberação**.
2. Escreva a **Justificativa** e escolha a **Data de revisão**, no máximo 30 dias à frente.
3. Clique em **Liberar faturamento** e confirme em **Liberar e emitir**.

As faturas retidas do Cliente são emitidas na hora, e as próximas saem sem esperar o Portal até a data de revisão. O bloco passa a mostrar **Vigente até …**. Para encerrar antes, use **Revogar liberação**, com motivo: as faturas já emitidas continuam valendo, e os B/Ls ainda não faturados voltam para a Revisão.

::: atencao
- Passada a data de revisão, as novas faturas voltam a ficar retidas e os B/Ls não faturados voltam para a Revisão ([19.8](19-rotinas-por-horario.md#198-o-portal-liberação-entrega-de-e-mail-e-resumo-diário)). Antes de vencer, ative o Portal do Cliente (capítulo 14) ou conceda uma nova Liberação.
- **Conceder liberação** só aparece enquanto o Portal não está pronto e não há Liberação vigente. Com o Portal pronto, o bloco diz **Não necessária**.
:::

## 13.9 Publicar a Central de Informações

**Quem faz:** {{Qualquer equipe}}

A **Central de Informações** é a página do Portal onde o Cliente consulta, por porto de descarga, as Taxas Locais, onde devolver o container vazio, a Demurrage, os agentes, os contatos da agência e o tracking do armador. O Vela é a fonte: o que você grava aqui aparece para o Cliente. As Taxas Locais e as tarifas de Demurrage vêm sozinhas das tabelas de cobrança em uso; o resto você mantém aqui.

1. Em **Clientes**, aba **Provisionamento do Portal**, clique em **Informações do Portal**.
2. Escolha a seção: **Depots**, **Agentes**, **Contato**, **Tracking** ou **Demurrage**.
3. Clique em **Editar** no cartão, ou em **Adicionar agente** ou **Adicionar contato**, preencha e clique em **Salvar informações**.

O que cada seção guarda:

- **Depots:** onde o Cliente devolve o vazio. O depot nasce na tela de Locais ([5.8](05-programacao.md#58-navios-armadores-portos-e-terminais)); aqui você completa os portos de devolução, o endereço, o horário, o agendamento e as instruções, e liga **Publicado no Portal**.
- **Agentes:** nome, portos e e-mails. Agente não se exclui: desmarque **Ativo**.
- **Contato:** um cartão por assunto (Importação, Exportação, Containers e Geral). Os três cartões de **Entrega do B/L original** não aparecem na Central, e sim no Desbloqueio de CE do Portal (capítulo 12).
- **Tracking:** o link de consulta de cada armador. Com `{BL}` no link, o Portal abre a consulta já com o número do B/L.
- **Demurrage:** as **Observações públicas de Demurrage**. As tarifas vêm do cadastro de Demurrage.

::: atencao
- O Portal só mostra o que está ativo e publicado: o depot ativo e com **Publicado no Portal**, o agente e o contato ativos, o armador com link. Para publicar um depot, informe pelo menos um porto.
- Os portos vão pelo código, como BRVIX, BRSSA ou BRSUA. As Taxas Locais e a devolução aparecem no Portal só para Vitória, Salvador e Suape.
:::

## 13.10 Desativar, reativar ou excluir um Cliente

**Quem faz:** {{Administrativo}}

Desativar é para o Cliente que não deve mais receber B/L. Ele sai das listas de escolha e perde o acesso ao Portal na hora, e o B/L novo com o CNPJ dele vai para a Revisão. O histórico, as faturas e os B/Ls antigos continuam com ele.

1. Na ficha, clique em **Mais ações** › **Desativar cliente**.
2. Escreva o motivo e confirme.

A ficha passa a mostrar o selo **Desativado** e o motivo. Para desfazer, use **Mais ações** › **Reativar cliente**, também com motivo: o Cliente volta às listas e ao Portal e pode receber B/L de novo.

Excluir é só para o Cliente cadastrado por engano, que ainda não tem nada: nem B/L, nem fatura, nem Comunicado. Na lista **Clientes**, marque o Cliente e clique em **Excluir selecionados**. O Vela mostra antes quem não pode sair e por quê. A exclusão apaga junto os contatos e as Condições de Cliente e não se desfaz.

::: atencao
- O Vela não desativa Cliente com fatura, valor a receber ou Invoice de Demurrage em aberto. O {{Financeiro}} quita ou cancela antes.
- Cliente desativado não recebe B/L nem fatura avulsa. Para vincular um B/L a ele, reative-o antes.
:::
