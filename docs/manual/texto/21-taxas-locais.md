As Taxas Locais são o que o Cliente paga no porto de descarga por um B/L, como o THD e a taxa de emissão do B/L. O Vela as calcula sozinho, pela tabela de cobrança do porto e do tipo de carga, com o preço fixado no dia da importação, e mostra o resultado na ficha do B/L e na fila **Validação**. Neste capítulo você entende como cada taxa é contada, resolve o que segura o cálculo, muda uma taxa de um B/L e cadastra as tabelas de cobrança e as Condições de Cliente.

::: aprende
- como o Vela calcula as Taxas Locais e por que o preço fica fixo na importação;
- como o container dividido, o THD, a carga solta e os veículos entram na conta;
- ler a Validação e resolver uma taxa em revisão;
- alterar, excluir ou isentar uma taxa e lançar uma cobrança manual;
- cadastrar uma tabela de cobrança e reajustar ou corrigir um preço;
- cadastrar uma Condição de Cliente.
:::

## 21.1 Como o Vela calcula as Taxas Locais

**Quem acompanha:** {{Todas as equipes}}

Cada taxa é um item de uma **tabela de cobrança**. Há uma tabela de cobrança por porto de descarga (o POD do B/L) e por tipo de carga (**Container** ou **Carga solta**). O item **Automático** entra em todo B/L daquele porto e tipo de carga; o **Só manual** só entra quando alguém o lança no B/L ([21.6](#216-lançar-uma-cobrança-manual)). Se o Cliente negociou um valor para o item, a **Condição de Cliente** substitui o da tabela de cobrança ([21.9](#219-cadastrar-uma-condição-de-cliente)).

O cálculo junta duas coisas que se comportam de jeito diferente:

- **O preço fica fixo no primeiro cálculo,** que é o da importação ([6.2](06-importacao.md#62-importar-os-bls-de-container)): a tabela de cobrança, o valor de cada item, a Condição de Cliente e o câmbio daquele dia. Tabela de cobrança nova, Condição nova ou câmbio novo não mexem no B/L já importado, a não ser que você aceite o preço de hoje numa reimportação ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)).
- **A base é sempre a de agora:** containers, marcas IMO, OOG e SOC/COC, peso, POD, Movement To, veículos e os outros B/Ls que dividem o container. Quando a base muda, o Vela recalcula o B/L ao gravar, com o preço fixado. As datas do navio, os volumes e a cubagem não entram no cálculo.

Até a fatura, a ficha mostra os valores como provisórios: o CE Mercante confirma o cálculo e libera a fatura (capítulo 22). Depois da fatura, o B/L não é mais recalculado, e a mudança na base passa pela correção da fatura ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)).

A taxa em dólar fica em US$ no B/L, e o total aparece como "R$ … + US$ …". Ela vira reais na emissão da fatura, pelo câmbio fixado na importação, sem acompanhar a cotação do dia como a Demurrage.

No exemplo, o CSC45810A01K00 é de container e descarrega em Vitória: paga os itens automáticos da tabela de cobrança de container de BRVIX, pelo preço do dia em que foi importado.

::: atencao
- O B/L continua na tabela de cobrança do primeiro cálculo mesmo que ela seja desativada depois. Só passa a outra se o POD ou o tipo de carga mudar antes da fatura.
- Se o recálculo falha ao gravar uma mudança no B/L (por exemplo, falta o câmbio de uma taxa em dólar), a gravação inteira é recusada e nada muda ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação)).
:::

## 21.2 Como cada taxa é contada

**Quem acompanha:** {{Todas as equipes}}

O campo **Incide** do item diz como a taxa conta:

| Incide | Conta |
|---|---|
| **Por B/L** | Uma vez por B/L. |
| **Por container** | Uma vez por container do B/L. O B/L só de carga solta não paga. |
| **Por tonelada** | O peso da carga solta, em toneladas, mesmo no B/L misto; no B/L só de container, o peso total do B/L. Sem peso, a taxa vai para revisão. |

Quatro situações mudam a conta:

- **Container dividido.** O container que aparece em mais de um B/L da mesma Viagem é rateado: cada B/L paga a sua parte, e a **Qtd.** mostra a fração, como "0,5". O centavo do arredondamento fica no B/L de maior número.
- **THD por perfil.** O item por container cujo nome começa com "THD" separa os containers pelas marcas: o perfil **Padrão** cobra os sem IMO e sem OOG, **IMO** só os IMO e **OOG** só os OOG. O container IMO e OOG ao mesmo tempo paga o THD Padrão com 150% de majoração, × 2,5 (um THD de R$ 1.420 vira R$ 3.550). Os outros itens por container cobram todos os containers. As marcas vêm do Baplie ou da correção na ficha ([7.3](07-ficha-do-bl.md#73-corrigir-um-container)).
- **Container SOC.** O item com **Cobrar também de container SOC** desmarcado, como Drop Off e Damage Protection, cobra só os containers COC.
- **B/L misto** (container e carga solta) usa as duas tabelas de cobrança do POD. A taxa por B/L sai uma vez: se a tabela de cobrança de container já cobra alguma, as por B/L da de carga solta ficam de fora.

### Veículos

O B/L de container que tem veículo e cujo **Movement To** diz LCL ou CFS fica **Isento**: nenhuma taxa é cobrada e o CE não emite fatura. O B/L misto não fica isento, nem o B/L com veículo em FCL ou sem Movement To. Para pôr ou tirar a isenção, corrija o **Movement To** na ficha ([7.2](07-ficha-do-bl.md#72-corrigir-os-dados-do-bl)).

No exemplo, o CSC45810B01K00 é de carga solta: as taxas por tonelada contam as 38,5 toneladas do manifesto. O CSC45810A02K00, de baterias de lítio, paga o THD IMO, e não o Padrão, se o container dele estiver marcado IMO.

::: atencao
- Grave o CE só depois de importar todos os B/Ls que dividem um container. O B/L irmão que chega depois da fatura muda o rateio, e a fatura emitida passa pela correção ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)).
- Sem a planilha de veículos, o B/L que seria isento é faturado cheio quando o CE é gravado ([10.1](10-veiculos-vazios-granito.md#101-importar-os-veículos)).
:::

## 21.3 Ler a Validação

**Quem faz:** {{Qualquer equipe}}

A **Validação** é a fila dos B/Ls que ainda não viraram fatura. Ela fica em **Financeiro** › **Taxas Locais**, na segunda aba; a primeira, **Faturas**, está no capítulo 22. Cada B/L mostra um só **Motivo**, o primeiro que segura a fatura, nesta ordem:

| Motivo | Quer dizer | Ação da linha |
|---|---|---|
| **Sem cliente vinculado** | O B/L não tem Cliente conferido. | **Vincular na Revisão** ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)) |
| **Cálculo sem linhas**, **Taxa em revisão** ou **Cálculo incompleto** | O cálculo não fechou. | **Recalcular**, depois de corrigir a causa ([21.4](#214-resolver-uma-taxa-em-revisão)) |
| **Aguardando CE Mercante** | Falta o CE. | **Cadastrar CE**, que abre a ficha do B/L ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)) |
| **Conta do Portal não ativa** | O Cliente não tem Portal pronto nem Liberação de faturamento. | **Abrir Cliente** ([14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)) |
| **Pronto para emitir** | Nada segura, e a fatura ainda não saiu sozinha. | **Emitir** ([22.2](22-a-fatura.md#222-como-a-fatura-sai)) |

::: passos
1. Em **Financeiro** › **Taxas Locais**, abra a aba **Validação**.
2. Filtre por **Motivo** ou **Navio / Viagem**, ou busque o B/L.
3. Clique no B/L. A faixa **Situação do B/L** diz o que falta, com o botão que resolve, e a **Conferência do cálculo**, ao lado, mostra como se chegou ao valor.
:::

A **Conferência do cálculo** traz cada linha com a base, a quantidade e o valor, agrupadas pela tabela de cobrança que as produziu; "tarifa negociada" marca a Condição de Cliente. Um grupo marcado **Anomalia** pede recálculo. A conferência só mostra: não recalcula nem emite.

No exemplo, o CSC45810A03K00 aparece em **Sem cliente vinculado** e o CSC45810B01K00, em **Conta do Portal não ativa**.

::: atencao
- O B/L **Faturado** ou **Isento** sai da fila. Para vê-lo, marque **Incluir faturados e isentos** em **Mais filtros**. O B/L cancelado não aparece.
- **Buscar B/L ou Cliente** procura pelo nome do consignatário que veio no arquivo, não pelo Cliente vinculado.
:::

## 21.4 Resolver uma taxa em revisão

**Quem faz:** {{Qualquer equipe}}; corrigir item de tabela de cobrança já usada, {{Administrativo}}.

Quando o cálculo não consegue dar valor a uma taxa, a linha fica **Em revisão**, sem valor, e segura a fatura ([7.6](07-ficha-do-bl.md#76-as-taxas-locais-na-ficha)). Não existe aprovar a linha: você corrige a causa e recalcula. O motivo aparece na **Observação** da linha, na ficha, e na linha aberta da Validação:

| O motivo diz | Causa | Corrija |
|---|---|---|
| "Nenhuma tabela de taxas ativa encontrada para o porto de descarga" | Não há tabela de cobrança ativa para o POD e o tipo de carga. | Cadastre ou ative a tabela de cobrança ([21.7](#217-cadastrar-as-taxas-de-um-porto)), ou corrija o POD na ficha. |
| "Tabela de taxas parcial em B/L misto…" | O B/L misto precisa das duas tabelas de cobrança do POD. | Cadastre a que falta. |
| "B/L de container sem containers cadastrados" | Nenhum container com número. | Reimporte o B/L com os containers ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)). |
| "Container IMO e OOG sem item THD standard…" | Não há THD Padrão para o container IMO e OOG. | Inclua o THD Padrão ou cobre por fatura avulsa. |
| "Tarifa BRL sem valor unitário vigente." (ou USD) | O item não tem valor na moeda dele, ou o cálculo não sabe contá-lo: THD com perfil **Todos**, base por TEU ou taxa por tonelada sem peso. | Corrija o item pela coluna **Aviso** (**THD sem perfil**, **TEU não calculado**) ou informe o peso ([8.4](08-revisao.md#84-informar-o-peso-da-carga-solta)). |

Depois de corrigir:

1. Na **Validação**, marque os B/Ls e clique em **Recalcular selecionados**, ou use **Recalcular** na linha.
2. Confira os totais na confirmação e confirme.
3. Quando o motivo passa a **Pronto para emitir**, emita ([22.2](22-a-fatura.md#222-como-a-fatura-sai)). Recalcular não emite.

A correção na ficha do B/L (container, peso, POD) já recalcula ao gravar. Na ficha só existe **Calcular taxas**, para o B/L que nunca foi calculado. Quando a tentativa de faturar trava no cálculo, abre **Cálculo bloqueado** para a {{Documentação}} ([20.8](20-alertas.md#208-faturamento-e-taxas-locais)).

::: atencao
- O texto "Tarifa BRL sem valor unitário vigente." serve a várias causas. A certa está na coluna **Aviso** do item, na tabela de cobrança.
- O B/L faturado não é recalculado, e a Validação o tira da seleção. Corrija o dado do B/L: a fatura é corrigida sozinha ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)).
:::

## 21.5 Alterar, excluir ou isentar uma taxa do B/L

**Quem faz:** {{Qualquer equipe}}, com justificativa.

Às vezes um B/L precisa pagar diferente do que a tabela de cobrança diz: um desconto acertado com o Cliente, uma taxa que não se aplica àquela carga. Você muda a taxa só daquele B/L, na ficha, aba **Faturamento**, bloco **Taxas Locais**; a tabela de cobrança não muda. Toda mudança pede uma **Justificativa (interna)** de ao menos 10 caracteres, que fica no histórico com o seu nome e que o Cliente não vê.

::: passos
1. Na linha da taxa, clique no ícone **Alterar valor da taxa**.
2. Escolha **Por unidade** (o total acompanha a quantidade) ou **Total da taxa** (o total fica fixo, mesmo que a quantidade mude).
3. Digite o novo valor e a justificativa e clique em **Revisar alteração**.
4. Confira o antes → depois e clique em **Alterar valor**.
:::

Os outros ícones da linha excluem a taxa da cobrança (**Excluir taxa**), voltam ao valor da tabela de cobrança e trazem de volta a taxa excluída (**Incluir taxa de novo**). A taxa alterada leva a marca **Alterada**; a excluída fica na lista, riscada, e não soma. A última taxa cobrada não se exclui: para não cobrar nada, isente o B/L.

**Isentar Taxas Locais**, no alto do bloco, zera o B/L inteiro, inclusive as cobranças manuais: a fatura não sai, o B/L sai da Validação e o Desbloqueio de CE considera o Financeiro atendido. **Retirar isenção** recalcula o B/L com as alterações que ele tinha; a fatura não sai sozinha, e você a emite em **Emitir fatura**. A isenção pelo veículo ([21.2](#212-como-cada-taxa-é-contada)) não tem esses botões.

A alteração sobrevive ao recálculo, a um container a mais, à troca de Cliente e à correção do item. Ela só se perde quando a tabela de cobrança da taxa sai do B/L, na troca de POD ou de tipo de carga. Tudo fica no **Histórico das taxas**, abaixo do bloco.

No B/L faturado, as mesmas ações continuam, menos a quantidade da cobrança manual. Antes de gravar, a confirmação diz o que vai acontecer com a fatura: reemissão com número novo, abatimento com Restituição ou **Fatura desatualizada** ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)). Isentar o B/L faturado cancela a fatura sem pagamento, sem emitir outra; na paga, o recebido vira Restituição.

::: atencao
- Quando uma correção do B/L mexe numa taxa alterada à mão, a ficha e a reimportação perguntam antes de gravar ([7.2](07-ficha-do-bl.md#72-corrigir-os-dados-do-bl)). Se a mudança vem de uma rotina, abre **Taxa alterada à mão mudou** ([20.8](20-alertas.md#208-faturamento-e-taxas-locais)).
- A alteração vale para um B/L. O valor errado para todos os B/Ls do porto se corrige na tabela de cobrança ([21.8](#218-reajustar-ou-corrigir-um-preço)).
:::

## 21.6 Lançar uma cobrança manual

**Quem faz:** {{Qualquer equipe}}

A cobrança manual é a taxa que não entra sozinha, como um serviço feito só para um B/L. Ela vem de um item **Só manual** da tabela de cobrança do B/L. Se o item não existe, cadastre-o antes ([21.7](#217-cadastrar-as-taxas-de-um-porto)) ou cobre por fatura avulsa ([22.4](22-a-fatura.md#224-emitir-uma-fatura-avulsa)).

1. Na ficha, aba **Faturamento**, clique em **Adicionar cobrança manual**.
2. Em **Item**, escolha a taxa. O valor é o do preço fixado do B/L, com a Condição de Cliente, se houver: você não digita valor.
3. Informe a **Quantidade** e, se quiser, a **Observação**.
4. Clique em **Adicionar** e confirme.

A linha entra como **Manual**, sem passar por revisão. O lápis **Editar cobrança manual** muda a quantidade e a observação; a lixeira **Excluir cobrança manual** a tira, com justificativa. O recálculo não apaga a cobrança manual.

::: atencao
- Lance antes da fatura. No B/L faturado não se lança cobrança manual nem se muda a quantidade dela: o serviço a mais vai em fatura avulsa.
- Cancelar o B/L apaga as cobranças manuais, e a reativação não as traz de volta ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)).
:::

## 21.7 Cadastrar as taxas de um porto

**Quem faz:** {{Qualquer equipe}} cadastra; ativar e desativar, {{Administrativo}}.

A tabela de cobrança vale para um **Modo de carga** (Container ou Carga solta) e um **POD**; as grafias do mesmo porto contam como uma só (VITORIA e BRVIT valem BRVIX). No mesmo modo e POD pode haver várias, mas só uma fica **Em uso no cálculo**: a ativa de vigência inicial mais recente. É ela que os B/Ls importados dali em diante recebem. A vigência é só informativa: não liga nem desliga a tabela de cobrança.

1. Em **Taxas Locais**, clique no botão do alto que abre **Tabelas de Taxas Locais**.
2. Clique no botão de cadastro e preencha **Nova tabela de taxas**. Em **Situação ao cadastrar**, escolha **Desativada (preparar itens antes)**.
3. Abra a tabela de cobrança pelo nome e inclua cada taxa em **Adicionar item**. Em **Entra no cálculo**, **Automático** cobra de todo B/L; **Só manual** fica para lançar à mão.
4. Confira a coluna **Aviso** dos itens e peça ao {{Administrativo}} que ative a tabela de cobrança, no menu ⋮ da linha.

O nome do item decide o THD: o item por container que começa com "THD" separa os containers por perfil e precisa do perfil **Padrão**, **IMO** ou **OOG**. Com **Todos**, o **Aviso** diz **THD sem perfil** e o B/L vai para revisão.

A **Situação** de cada tabela de cobrança é **Em uso no cálculo**, **Ativa, mas não usada** (em âmbar: há outra ativa mais recente no mesmo modo e POD; desative uma das duas) ou **Desativada**. Se havia B/Ls esperando por ela, siga o alerta **Tabela de cobrança faltando** ([20.8](20-alertas.md#208-faturamento-e-taxas-locais)).

::: atencao
- A tabela de cobrança ativa vale na hora, mesmo com a vigência inicial no futuro e mesmo sem itens: os B/Ls importados nesse meio-tempo ficam presos a ela, sem as taxas. Cadastre desativada, inclua os itens e só então ative. Quem não é do {{Administrativo}} não consegue ativar depois: combine antes.
- Depois que um B/L usou a tabela de cobrança, o **POD** e o **Modo de carga** dela não mudam, e incluir ou corrigir item passa a ser só do {{Administrativo}} ([21.8](#218-reajustar-ou-corrigir-um-preço)).
- Tabela de cobrança não se exclui. Para tirá-la do cálculo, o {{Administrativo}} a desativa; os B/Ls já vinculados continuam com ela.
:::

## 21.8 Reajustar ou corrigir um preço

**Quem faz:** reajuste e Condição de Cliente, {{Qualquer equipe}}; mudar tabela de cobrança já usada, {{Administrativo}}.

No Vela, mudar um preço tem dois sentidos, e cada um tem o seu caminho. **Reajuste** é preço novo daqui para a frente: não mexe em B/L já importado nem em fatura. **Correção** é desfazer um erro de cadastro: vale para todos os B/Ls que usaram aquele preço, mesmo os faturados.

| Você quer | Caminho | Efeito |
|---|---|---|
| Reajustar as taxas de um porto | Uma tabela de cobrança nova, do mesmo modo e POD, com os valores novos, ativada no dia em que passam a valer ([21.7](#217-cadastrar-as-taxas-de-um-porto)). | Os B/Ls importados depois pagam o valor novo; os anteriores ficam na tabela de cobrança antiga. |
| Corrigir um valor cadastrado errado | O {{Administrativo}} edita o item. | Todos os B/Ls da tabela de cobrança são recalculados na hora, mesmo com CE, e as faturas emitidas passam pela correção ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)). |
| Cobrar uma taxa nova de todos os B/Ls | Um item **Automático** na tabela de cobrança em uso. Se ela já foi usada, só o {{Administrativo}} inclui. | Na tabela de cobrança já usada, o mesmo da correção. |
| Tirar uma taxa do cálculo | O {{Administrativo}} desativa o item, no menu ⋮ dele. | O mesmo da correção. |
| Valor diferente para um Cliente | Uma Condição de Cliente ([21.9](#219-cadastrar-uma-condição-de-cliente)). | Os B/Ls do Cliente importados na vigência. |
| Mudar a taxa de um B/L só | Na ficha do B/L ([21.5](#215-alterar-excluir-ou-isentar-uma-taxa-do-bl)). | Só aquele B/L. |

::: atencao
- Ao editar um item de tabela de cobrança já usada, o formulário avisa antes que é correção. Ao incluir um item novo nela, não avisa, mas o efeito é o mesmo: todos os B/Ls dela são recalculados e as faturas, corrigidas.
- Renomear um item muda a cobrança quando o nome passa a começar, ou deixa de começar, com "THD". Isso vale só no próximo cálculo de cada B/L e não corrige as faturas emitidas.
- Item usado não se exclui, só se desativa. **Excluir item** é para o item que nunca entrou em cálculo.
:::

## 21.9 Cadastrar uma Condição de Cliente

**Quem faz:** {{Qualquer equipe}} cadastra; editar, desativar, reativar e excluir, {{Administrativo}}.

A **Condição de Cliente** é o valor negociado com um Cliente para um item da tabela de cobrança ([13.7](13-cadastro-do-cliente.md#137-as-faturas-e-as-condições-negociadas)). Ela vale para o B/L quando a vigência cobre o dia em que o B/L foi calculado pela primeira vez, normalmente o da importação; a ETA não entra. Por isso, a Condição nova vale para os B/Ls do Cliente importados depois, e os já importados ficam com o preço que tinham.

1. Em **Tabelas de Taxas Locais**, abra a aba **Condições de Cliente** e clique em **Nova condição**.
2. Escolha o **Cliente** e o **Item de taxa**. Só aparecem itens **Automático** ativos.
3. Digite o **Valor negociado**, na moeda do item; a tela mostra a diferença para a tabela de cobrança.
4. Preencha a vigência (a **Vigência final** vazia é sem fim) e clique em **Cadastrar condição**.

Na lista, **Sem efeito no cálculo**, em âmbar, marca a Condição cujo item ou tabela de cobrança não está em uso: ela não muda nada até isso ser resolvido.

O B/L que entra sem Cliente, como o CSC45810A03K00 do exemplo, recebe a Condição do Cliente vinculado depois, se a vigência dela cobre o dia da importação.

### Trocar o valor negociado

Duas Condições ativas do mesmo Cliente e item não podem ter vigências que se cruzam. Para trocar o valor, a atual precisa terminar antes de a nova começar. Se ela não tem vigência final, peça ao {{Administrativo}} que a encerre e cadastre a nova a partir do dia seguinte.

::: atencao
- Editar o valor ou a vigência de uma Condição já usada é correção: os B/Ls que a usaram são recalculados e as faturas emitidas passam pela correção ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)). Para um valor novo daqui para a frente, cadastre uma Condição nova.
- Desativar ou excluir uma Condição não muda B/L já importado nem fatura: só os B/Ls que entrarem depois voltam ao valor da tabela de cobrança.
:::
