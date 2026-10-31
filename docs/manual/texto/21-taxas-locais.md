As Taxas Locais são o que o Cliente paga no porto de descarga por um B/L, como o THD e a taxa de emissão do B/L. O Vela as calcula sozinho, pela tabela de cobrança do porto e do tipo de carga, com o preço fixado no dia da importação, e mostra o resultado na ficha do B/L e na fila **Validação**.

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

A taxa em dólar fica em US$ até a fatura e vira reais pelo câmbio fixado na importação, sem acompanhar a cotação do dia como a Demurrage.

::: atencao
O B/L continua na tabela de cobrança do primeiro cálculo mesmo que ela seja desativada depois. Só passa a outra se o POD ou o tipo de carga mudar antes da fatura.
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

- **Container dividido.** O container que aparece em mais de um B/L da mesma Viagem é rateado: cada B/L paga a sua parte, e a **Qtd.** mostra a fração, como "0,5".
- **THD por perfil.** O item por container cujo nome começa com "THD" cobra por perfil: **Padrão** os containers sem IMO e sem OOG, **IMO** os IMO, **OOG** os OOG. O container IMO e OOG ao mesmo tempo paga o THD Padrão × 2,5 (150% de majoração): um THD de R$ 1.420 vira R$ 3.550. Os outros itens por container cobram todos os containers. As marcas vêm do Baplie ou da correção na ficha ([7.3](07-ficha-do-bl.md#73-corrigir-um-container)).
- **Container SOC.** O item com **Cobrar também de container SOC** desmarcado, como Drop Off e Damage Protection, cobra só os containers COC.
- **B/L misto** (container e carga solta) usa as duas tabelas de cobrança do POD. A taxa por B/L sai uma vez: se a tabela de cobrança de container já cobra alguma, as por B/L da de carga solta ficam de fora.

### Veículos

O B/L só de container com veículo e **Movement To** com LCL ou CFS fica **Isento**: não paga taxa e o CE não emite fatura. Para pôr ou tirar a isenção, corrija o **Movement To** na ficha ([7.2](07-ficha-do-bl.md#72-corrigir-os-dados-do-bl)).

No exemplo, o CSC45810B01K00 é de carga solta e paga por tonelada as 38,5 toneladas do manifesto; o CSC45810A02K00, de baterias de lítio, paga o THD IMO se o container dele estiver marcado IMO.

::: atencao
Grave o CE só depois de importar todos os B/Ls que dividem um container. O B/L irmão que chega depois da fatura muda o rateio, e a fatura emitida passa pela correção ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)).
:::

## 21.3 Ler a Validação

**Quem faz:** {{Qualquer equipe}}

A **Validação** é a fila dos B/Ls que ainda não viraram fatura. Ela fica em **Financeiro** › **Taxas Locais**, na segunda aba; a primeira, **Faturas**, está no capítulo 22. Cada B/L mostra um só **Motivo**, o primeiro que segura a fatura, nesta ordem:

| Motivo | Quer dizer | Ação da linha |
|---|---|---|
| **Sem cliente vinculado** | O B/L não tem Cliente conferido. | **Vincular na Revisão** ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)) |
| **Cálculo sem linhas**, **Taxa em revisão** ou **Cálculo incompleto** | O cálculo não fechou, ou o B/L tem pendência na Revisão (a faixa diz "Revisão pendente: …"). | **Recalcular**, depois de corrigir a causa ([21.4](#214-resolver-uma-taxa-em-revisão)). Com pendência na Revisão, a linha traz **Resolver na Revisão**, que abre o B/L na Revisão (capítulo 8): ao gravar lá, o B/L é recalculado sozinho. |
| **Aguardando CE Mercante** | Falta o CE. | **Cadastrar CE** só abre a ficha do B/L; o CE entra pela planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)) |
| **Conta do Portal não ativa** | O Cliente não tem Portal pronto nem Liberação de faturamento. | **Abrir Cliente** ([14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)) |
| **Pronto para emitir** | Nada segura, e a fatura ainda não saiu sozinha. | **Emitir** ([22.2](22-a-fatura.md#222-como-a-fatura-sai)) |

::: passos
1. Em **Financeiro** › **Taxas Locais**, abra a aba **Validação**.
2. Filtre por **Motivo** ou **Navio / Viagem**, ou busque o B/L.
3. Clique na seta à esquerda do B/L (o número abre a ficha). A faixa **Situação do B/L** diz o que falta, com o botão que resolve, e a **Conferência do cálculo** mostra como se chegou ao valor.
:::

::: tela validacao
A Validação com os B/Ls da COSCO SHIPPING SEREIA / 024E: cada um com o primeiro motivo que segura a fatura.
:::

A **Conferência do cálculo** mostra cada linha com a base, a quantidade e o valor, agrupadas pela tabela de cobrança que as produziu; "tarifa negociada" marca a Condição de Cliente.

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
| "Peso de carga solta ausente…" | Taxa por tonelada sem peso. | Informe o peso ([8.4](08-revisao.md#84-informar-o-peso-da-carga-solta)). |
| "Item THD cadastrado com perfil de carga 'any'…" | THD com perfil **Todos**. | Corrija o perfil do item (**Aviso**: **THD sem perfil**). |
| "Base de aplicacao nao suportada pelo motor: teu" | Item por TEU. | Troque a base do item (**Aviso**: **TEU não calculado**). |
| "Tarifa BRL sem valor unitário vigente." (ou USD) | O item não tem valor na moeda dele. | Preencha o valor do item. |

Depois de corrigir:

1. Na **Validação**, marque os B/Ls e clique em **Recalcular selecionados**, ou use **Recalcular** na linha.
2. Recalcular não emite, mas o B/L que já tem CE costuma faturar sozinho logo depois; se ele continuar em **Pronto para emitir**, emita ([22.2](22-a-fatura.md#222-como-a-fatura-sai)).

A correção na ficha do B/L (container, peso, POD) já recalcula ao gravar.

::: atencao
O B/L faturado não é recalculado, e a Validação o tira da seleção. **Recalcular selecionados** também deixa de fora o B/L com Revisão pendente e diz quantos ficaram fora: resolva-os na Revisão. Corrija o dado do B/L: a fatura é corrigida sozinha ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)).
:::

## 21.5 Alterar, excluir ou isentar uma taxa do B/L

**Quem faz:** {{Qualquer equipe}}, com justificativa.

Quando um B/L deve pagar diferente da tabela de cobrança (um desconto acertado, uma taxa que não se aplica), você muda a taxa só dele, na ficha, aba **Faturamento**, bloco **Taxas Locais**. Toda mudança pede uma **Justificativa (interna)** de ao menos 10 caracteres, que o Cliente não vê.

::: passos
1. Na linha da taxa, clique no ícone **Alterar valor da taxa**.
2. Escolha **Por unidade** (o total acompanha a quantidade) ou **Total da taxa** (o total fica fixo, mesmo que a quantidade mude).
3. Digite o novo valor e a justificativa e clique em **Revisar alteração**.
4. Confira o antes → depois e clique em **Alterar valor**.
:::

Os outros ícones da linha excluem a taxa (**Excluir taxa**), voltam ao valor da tabela de cobrança (**Voltar ao valor da tabela**) e trazem de volta a excluída (**Incluir taxa de novo**). A taxa alterada leva a marca **Alterada**; a excluída fica riscada e não soma. A última taxa cobrada não se exclui: para não cobrar nada, isente o B/L.

**Isentar Taxas Locais**, no alto do bloco, zera o B/L inteiro, inclusive as cobranças manuais: a fatura não sai, o B/L sai da Validação e o Desbloqueio de CE considera o Financeiro atendido. **Retirar isenção** recalcula o B/L com as alterações que ele tinha; a fatura não sai sozinha, e você a emite em **Emitir fatura**. A isenção pelo veículo ([21.2](#212-como-cada-taxa-é-contada)) não tem esses botões.

A alteração continua nos recálculos; só se perde se o POD ou o tipo de carga do B/L mudar. Tudo fica no **Histórico das taxas**, abaixo do bloco.

No B/L faturado, as mesmas ações continuam, menos a quantidade da cobrança manual, e a confirmação diz antes o que acontece com a fatura ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)). Isentar o B/L faturado cancela a fatura sem pagamento, sem emitir outra; na paga, o recebido vira Restituição.

::: atencao
A alteração vale para um B/L. O valor errado para todos os B/Ls do porto se corrige na tabela de cobrança ([21.8](#218-reajustar-ou-corrigir-um-preço)).
:::

## 21.6 Lançar uma cobrança manual

**Quem faz:** {{Qualquer equipe}}

A cobrança manual é a taxa que não entra sozinha, como um serviço feito só para um B/L. Ela vem de um item **Só manual** da tabela de cobrança do B/L; sem o item, cadastre-o ([21.7](#217-cadastrar-as-taxas-de-um-porto)) ou cobre por fatura avulsa ([22.4](22-a-fatura.md#224-emitir-uma-fatura-avulsa)).

1. Na ficha, aba **Faturamento**, clique em **Adicionar cobrança manual**.
2. Em **Item**, escolha a taxa. O valor é o do preço fixado do B/L, com a Condição de Cliente, se houver: você não digita valor.
3. Informe a **Quantidade** e, se quiser, a **Observação**.
4. Clique em **Adicionar** e confirme.

A linha entra como **Manual**, sem passar por revisão. O lápis **Editar cobrança manual** muda a quantidade e a observação; a lixeira **Excluir cobrança manual** a tira, com justificativa. O recálculo não apaga a cobrança manual.

::: atencao
Lance antes da fatura. No B/L faturado não se lança cobrança manual nem se muda a quantidade dela: o serviço a mais vai em fatura avulsa.
:::

## 21.7 Cadastrar as taxas de um porto

**Quem faz:** {{Qualquer equipe}} cadastra; ativar e desativar, {{Administrativo}}.

A tabela de cobrança vale para um **Modo de carga** (Container ou Carga solta) e um **POD**. No mesmo modo e POD pode haver várias, mas só uma fica **Em uso no cálculo**: a ativa de vigência inicial mais recente. É ela que os B/Ls importados dali em diante recebem. A vigência é só informativa: não liga nem desliga a tabela de cobrança.

1. Em **Taxas Locais**, clique em **Tabelas e condições**.
2. Clique em **Nova tabela** e preencha **Nova tabela de taxas**. Em **Situação ao cadastrar**, escolha **Desativada (preparar itens antes)**.
3. Abra a tabela de cobrança pelo nome e inclua cada taxa em **Adicionar item**. O item THD por container precisa do perfil **Padrão**, **IMO** ou **OOG** ([21.2](#212-como-cada-taxa-é-contada)).
4. Confira a coluna **Aviso** dos itens e peça ao {{Administrativo}} que ative a tabela de cobrança: menu ⋮ da linha › **Reativar tabela**, com motivo.

A coluna **Situação** diz qual tabela de cobrança está **Em uso no cálculo**; **Ativa, mas não usada**, em âmbar, quer dizer que há outra ativa mais recente no mesmo modo e POD: desative uma das duas. Os B/Ls que já esperavam por ela não passam a ela sozinhos: os que têm CE estão no alerta **Tabela de cobrança faltando** ([20.8](20-alertas.md#208-faturamento-e-taxas-locais)); os sem CE passam a ela quando o CE é gravado, ou antes, com **Recalcular** na **Validação**.

::: atencao
- A tabela de cobrança ativa vale na hora, mesmo com a vigência inicial no futuro e mesmo sem itens: os B/Ls importados nesse meio-tempo ficam ligados a ela, sem taxas, e daí em diante só o {{Administrativo}} inclui itens nela (cada item incluído recalcula esses B/Ls). Cadastre desativada, inclua os itens e só então peça a ativação.
- Depois que um B/L usou a tabela de cobrança, o **POD** e o **Modo de carga** dela não mudam ([21.8](#218-reajustar-ou-corrigir-um-preço)).
- Tabela de cobrança não se exclui. Para tirá-la do cálculo, o {{Administrativo}} a desativa; os B/Ls já vinculados continuam com ela.
:::

## 21.8 Reajustar ou corrigir um preço

**Quem faz:** preparar o reajuste e a Condição de Cliente, {{Qualquer equipe}}; ativar a tabela de cobrança e mudar a já usada, {{Administrativo}}.

**Reajuste** é preço novo daqui para a frente: não mexe em B/L já importado nem em fatura. **Correção** desfaz um erro de cadastro: vale para todos os B/Ls que usaram aquele preço, mesmo os faturados.

| Você quer | Caminho | Efeito |
|---|---|---|
| Reajustar as taxas de um porto | Uma tabela de cobrança nova, do mesmo modo e POD, com os valores novos, ativada no dia em que passam a valer ([21.7](#217-cadastrar-as-taxas-de-um-porto)). | Os B/Ls importados depois pagam o valor novo; os anteriores ficam na tabela de cobrança antiga. |
| Corrigir um valor, incluir ou desativar um item numa tabela de cobrança já usada | O {{Administrativo}} edita, inclui ou desativa o item (menu ⋮). | Todos os B/Ls da tabela de cobrança são recalculados na hora, mesmo com CE, e as faturas emitidas passam pela correção ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)). |
| Valor diferente para um Cliente | Uma Condição de Cliente ([21.9](#219-cadastrar-uma-condição-de-cliente)). | Os B/Ls do Cliente importados depois de cadastrá-la, dentro da vigência. |

::: atencao
Ao editar um item de tabela de cobrança já usada, o formulário avisa antes que é correção. Ao incluir um item novo nela, não avisa, mas o efeito é o mesmo: todos os B/Ls dela são recalculados e as faturas, corrigidas.
:::

## 21.9 Cadastrar uma Condição de Cliente

**Quem faz:** {{Qualquer equipe}} cadastra; editar, desativar, reativar e excluir, {{Administrativo}}.

A **Condição de Cliente** é o valor negociado com um Cliente para um item da tabela de cobrança ([13.7](13-cadastro-do-cliente.md#137-as-faturas-e-as-condições-negociadas)). Ela vale para o B/L quando a vigência cobre o dia em que o B/L foi calculado pela primeira vez, normalmente o da importação; a ETA não entra. Por isso, a Condição nova vale para os B/Ls do Cliente importados depois, e os já importados ficam com o preço que tinham.

1. Em **Tabelas de Taxas Locais**, abra a aba **Condições de Cliente** e clique em **Nova condição**.
2. Escolha o **Cliente** e o **Item de taxa**.
3. Digite o **Valor negociado**, na moeda do item; a tela mostra a diferença para a tabela de cobrança.
4. Preencha a vigência (a **Vigência final** vazia é sem fim) e clique em **Cadastrar condição**.

Na lista, **Sem efeito no cálculo**, em âmbar, marca a Condição cujo item ou tabela de cobrança não está em uso: ela não muda nada até isso ser resolvido.

### Trocar o valor negociado

Duas Condições ativas do mesmo Cliente e item não podem ter vigências que se cruzam. Para trocar o valor, a atual precisa terminar antes de a nova começar. Se ela não tem vigência final, peça ao {{Administrativo}} que a encerre e cadastre a nova a partir do dia seguinte.

::: atencao
- Editar o valor ou a vigência de uma Condição já usada é correção: os B/Ls que a usaram são recalculados e as faturas emitidas passam pela correção ([22.7](22-a-fatura.md#227-quando-o-bl-muda-depois-da-fatura)). Para um valor novo daqui para a frente, cadastre uma Condição nova.
- Desativar ou excluir uma Condição não muda B/L já importado nem fatura: só os B/Ls que entrarem depois voltam ao valor da tabela de cobrança.
:::
