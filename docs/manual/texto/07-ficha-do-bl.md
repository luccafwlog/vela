A ficha do B/L reúne tudo o que o Vela sabe de um B/L: o documento, a carga, o Cliente, o CE Mercante, as Taxas Locais e a história de cada mudança. É nela que você confere em que pé o B/L está e corrige o que a importação trouxe errado. Toda correção fica no **Histórico** do B/L, com o antes, o depois, o seu nome e a justificativa. Neste capítulo você lê a ficha, corrige o B/L e os containers, cuida do Cliente e, se é do Administrativo, cancela, reativa ou exclui um B/L.

::: aprende
- ler a ficha e ver o que ainda falta para o B/L;
- corrigir os dados do B/L e de um container, com justificativa;
- vincular, trocar ou desvincular o Cliente do B/L;
- o que a ficha faz com o CE, o Manifesto e as Taxas Locais;
- pôr um B/L num terminal de descarga diferente do da escala;
- cancelar, reativar e excluir um B/L.
:::

## 7.1 Ler a ficha do B/L

**Quem faz:** {{Todas as equipes}}

A ficha abre pelo número do B/L, em **BLs**, na **Revisão** ou em qualquer tela que mostre o B/L.

::: tela bl-ficha
A ficha do CSC45810A01K00, já faturado.
:::

1. O cabeçalho diz a modalidade (**Container**, **Carga solta** ou **Misto**), a Viagem, o trecho, o CE Mercante e o Cliente. **Reimportar B/L**, no B/L de container ou misto, fica aqui ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)).
2. A **Próxima ação** só aparece quando falta alguma etapa documental. Ela diz qual e leva aonde ela se resolve.
3. O trilho **Operacional** acompanha o navio e a carga: saída do POL, chegada ao POD, descarga e devolução dos containers.
4. O trilho **Documental** mostra as etapas até a fatura: **Cliente**, **Taxas Locais**, **CE Mercante** e **Fatura**, com o número de pendências.
5. As abas: **Visão geral** (Embarque, **Documento Mercante**, **Cliente**, um resumo da **Carga** e o **Portal**), **Carga** (containers, carga solta e veículos), **Detalhes do B/L** (o documento), **Faturamento** (Taxas Locais e Demurrage) e **Histórico**.

O **Histórico** conta tudo o que mudou no B/L: cada campo, com antes e depois, quem mudou e a justificativa, e também os Comunicados enviados ao Cliente. O que veio de uma importação aparece com a **Origem**. Use os filtros por assunto para achar uma mudança.

::: atencao
A etapa **Cliente** do trilho fica vermelha enquanto a conta do Portal do Cliente não está ativa, mesmo quando a fatura já saiu pela Liberação de faturamento sem Portal, como no exemplo. Confira na etapa **Fatura** se ela foi emitida.
:::

## 7.2 Corrigir os dados do B/L

**Quem faz:** {{Qualquer equipe}}

A aba **Detalhes do B/L** é o documento como o Vela o guarda: as partes (shipper, consignatário, notify), a rota, a emissão e o pagamento, os pesos, o NCM e a descrição da carga. Corrija aqui o que a importação trouxe errado. Se o armador mandou um arquivo novo, reimporte o B/L em vez de digitar ([6.3](06-importacao.md#63-reimportar-um-bl-que-o-armador-corrigiu)).

1. Na ficha, abra a aba **Detalhes do B/L** e corrija os campos.
2. Em **Justificativa da alteração**, escreva por que mudou.
3. Clique em **Salvar alterações**.
4. Confira o antes → depois de cada campo e confirme.

O CE Mercante e o Manifesto ficam no alto da aba, no bloco **Documento Mercante**, e não entram no **Salvar alterações**: cada um tem a sua ação ([7.5](#75-o-ce-e-o-manifesto-pela-ficha)). A Viagem do B/L não muda pela ficha ([6.9](06-importacao.md#69-trocar-o-bl)).

Ao salvar, o Vela refaz sozinho o que depende do que você mudou:

- **POD**, pesos ou **Movement To** recalculam as Taxas Locais do B/L ainda sem fatura. Mudar o POD troca a tabela de cobrança, que é a do porto de descarga.
- Mudar o **POL** ou o **POD** tira o B/L do Manifesto Mercante.
- A Revisão do B/L é refeita: se a correção resolve a pendência, o B/L sai da Revisão (capítulo 8).

::: atencao
- No B/L faturado, a fatura não é editada aqui: ao salvar POD, pesos ou Movement To, o Vela reemite a fatura sem pagamento ou leva a fatura paga à correção (capítulo 22).
- Se o B/L tem taxa com valor alterado à mão e a mudança mexe nela, abre a janela **Taxas alteradas à mão serão afetadas**. Leia o que acontece com cada taxa antes de clicar em **Gravar mesmo assim**.
:::

## 7.3 Corrigir um container

**Quem faz:** {{Qualquer equipe}}

O container é corrigido na aba **Carga**, um de cada vez. O mesmo container pode estar em mais de um B/L da Viagem (o **Part Lot**, quando a carga de um container é de vários consignatários). Como ele é um só container físico, a correção do perfil, do COC/SOC, do lacre e das datas vale para todos os B/Ls ativos da Viagem que o dividem. Peso bruto e CBM, não: cada B/L tem a sua parte.

::: lado
1. Na aba **Carga**, no bloco **Contêineres**, clique no lápis **Corrigir** da linha do container.
2. Corrija o que mudou: **Perfil** (Standard, OOG, IMO), **COC/SOC**, **Lacre**, **Peso bruto (kg)**, **CBM (m³)**, **Descarga** ou **Devolução**.
3. Escreva a **Justificativa**.
4. Clique em **Salvar correção** e confirme o antes → depois.

::: tela bl-corrigir-container
Correção do lacre de um container do CSC45810A01K00. Como o B/L está faturado, Perfil e COC/SOC ficam travados.
:::
:::

Perfil e COC/SOC recalculam as Taxas Locais; as datas recalculam a Demurrage (capítulo 9).

::: atencao
- O perfil e o COC/SOC corrigidos à mão valem mais que o Baplie e que a reimportação. Já o lacre, o peso e o CBM voltam ao que o arquivo traz quando o B/L é reimportado.
- A descarga gravada só se troca, nunca se apaga. Para apagar a devolução, deixe o campo vazio: a justificativa vale como motivo.
:::

## 7.4 Vincular ou trocar o Cliente do B/L

**Quem faz:** {{Qualquer equipe}} · e-mail do Cliente: {{Administrativo}}, {{Documentação}} e {{Equipamentos}} · convite do Portal: {{Documentação}} e {{Administrativo}}

O Cliente do B/L é quem vê o B/L no Portal e recebe a fatura. A importação só o vincula sozinha pelo CNPJ ([6.2](06-importacao.md#62-importar-os-bls-de-container)); o resto se decide à mão, na **Revisão** ou aqui, no bloco **Cliente** da **Visão geral**.

### B/L sem Cliente

O B/L sem Cliente está na Revisão, e o bloco **Cliente** abre o formulário **Cadastrar ou vincular cliente**. É o mesmo cadastro da Revisão ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)), mas vale só para este B/L. Quando outros B/Ls têm o mesmo CNPJ, resolva na Revisão, que vincula todos de uma vez.

1. Em **Buscar cliente cadastrado**, procure o Cliente. Se ele não existe, confira a **Razão social** e o **CNPJ**, que precisa ser um dos lidos no B/L.
2. Confira o **E-mail principal do cliente**. Se quiser, marque **Enviar convite do Portal para este mesmo e-mail**.
3. Clique em **Criar cliente e vincular este B/L** (ou **Adicionar e-mail e vincular este B/L**, com Cliente já cadastrado) e confirme.

Se a correção libera o B/L e ele já tem CE, a ficha tenta emitir a fatura na hora.

### Trocar ou desvincular o Cliente

1. No bloco **Cliente**, clique em **Trocar Cliente**.
2. Busque o Cliente pela razão social ou pelo CNPJ e clique em **Vincular** na linha dele.
3. Confira o antes → depois, escreva o **Motivo** e confirme.

O B/L passa a aparecer no Portal do novo Cliente e entra no faturamento dele, com as Taxas Locais recalculadas para ele. **Desvincular** faz o contrário, também com motivo: o B/L sai do Portal do Cliente, o valor a faturar é anulado e o B/L volta para a Revisão. O motivo fica no Histórico.

Ao lado, o bloco **Portal** diz se o Cliente vê o B/L e, se não vê, por quê; dali sai o convite do Portal (capítulo 14).

::: atencao
- B/L faturado não fica sem Cliente: não há **Desvincular**, só **Trocar Cliente**. Sem pagamento, a troca cancela a fatura e a emite para o novo Cliente, se ele tem Portal pronto ou Liberação; senão, a fatura antiga continua valendo e o B/L vai para a Revisão. Se o Cliente anterior pagou Demurrage ou fatura avulsa do B/L, a troca é recusada até a Restituição desse valor ser confirmada.
- Quando o bloco avisa "O manifesto declara outro cliente", o documento cita outro CNPJ. Confirme com o armador antes de trocar.
- Cliente desativado não recebe B/L. Reative-o antes, na ficha do Cliente (capítulo 13).
:::

## 7.5 O CE e o Manifesto pela ficha

**Quem faz:** {{Qualquer equipe}}

O CE e o Manifesto ficam na aba **Detalhes do B/L**, no bloco **Documento Mercante**. **Corrigir CE** e **Remover CE** estão em [6.6](06-importacao.md#66-corrigir-o-ce-ou-o-manifesto-de-um-bl). O que você precisa saber a mais:

- **Mover para um manifesto** põe o B/L num Manifesto Mercante: digite os 13 caracteres do número, clique em **Mover** e escreva o motivo. Se o número é novo, ele é cadastrado na rota. Só B/L com CE entra em Manifesto.
- **Desvincular** deixa o B/L sem Manifesto.
- Mudar o POL, o POD ou a Viagem do B/L o tira do Manifesto sozinho.

Remover o CE desfaz mais do que parece: o B/L sai do Manifesto, deixa de aparecer no Portal e volta a contar como CE pendente. O CE só volta pela planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)).

::: atencao
Corrigir o CE de um B/L cujo Comunicado de CE e Taxas já saiu deixa o Comunicado pendente de reenvio (capítulo 16).
:::

## 7.6 As Taxas Locais na ficha

**Quem faz:** {{Qualquer equipe}}

A aba **Faturamento** mostra, no bloco **Taxas Locais**, o que o B/L vai pagar ou pagou: o total, a **Fatura** (o número abre a fatura) e uma linha por taxa. O preço é o fixado no dia da importação ([6.2](06-importacao.md#62-importar-os-bls-de-container)). Como cada taxa é calculada está no capítulo 21; a fatura, no capítulo 22.

Daqui você pode:

- **Calcular taxas**, quando o bloco diz que elas ainda não foram calculadas;
- **Adicionar cobrança manual**, para um item que só se cobra à mão;
- alterar o valor de uma taxa, excluí-la ou isentar o B/L inteiro (**Isentar Taxas Locais**), sempre com justificativa (capítulo 21). No B/L já faturado, a mudança passa pela correção da fatura (capítulo 22);
- **Emitir fatura**, quando a fatura não saiu sozinha. O botão aparece com Cliente, CE Mercante e taxas calculadas. Se a última fatura do B/L foi cancelada por uma pessoa, a nova só sai por aqui.

Abaixo ficam a **Demurrage** dos containers e as **Condições de Demurrage deste B/L** (capítulos 9 e 23).

::: atencao
Linha **Em revisão** segura a fatura: **Emitir fatura** fica desligado até a causa ser corrigida e as taxas recalculadas (capítulo 21).
:::

## 7.7 Mudar o terminal de descarga de um B/L

**Quem faz:** {{Qualquer equipe}}

O B/L descarrega no terminal da frente de operação da escala do POD ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)). Quando um B/L descarrega em outro terminal do mesmo porto, você registra uma exceção só para ele. É o terminal do B/L que decide em que ADR de Saída e em que Aviso de Atracação ele conta (capítulos 11 e 16).

1. Na **Visão geral**, bloco **Embarque**, em **Terminal de descarga**, clique em **Definir exceção** (ou **Alterar exceção**).
2. Em **Terminal aplicado**, escolha um terminal do porto do POD. A lista mostra todos, e o Vela recusa o de outro porto.
3. Escreva a **Justificativa** e clique em **Salvar exceção**.

A exceção aparece como "Exceção deste B/L, fora da Frente de Operação" e fica no Histórico. Para voltar ao terminal da escala, abra a exceção e use **Remover exceção**, com justificativa.

::: atencao
Mudar o POD para outro porto tira a exceção: corrigir o POD na ficha, reimportar o B/L com outro POD ou marcar COD. O B/L volta ao terminal da escala do novo POD, e o Histórico diz "Exceção de terminal removida". Se no porto novo ele também descarrega fora da frente de operação, defina a exceção de novo.
:::

## 7.8 Cancelar, reativar ou excluir um B/L

**Quem faz:** {{Administrativo}}

O número do B/L existe uma vez só no Vela. O caminho para tirar um B/L do jogo depende do CE:

| Ação | Quando | Onde |
|---|---|---|
| **Excluir** | O B/L não tem CE nem documento financeiro (fatura, mesmo cancelada, ou Invoice de Demurrage). | Lista **BLs** |
| **Cancelar B/L** | O B/L tem CE: a carga não embarcou ou o armador reemitiu o B/L com outro número. | Ficha, **Mais ações** |
| **Reativar B/L** | Desfazer um cancelamento. | Ficha, **Mais ações** |

### Cancelar

1. Na ficha, clique em **Mais ações** (o botão de três pontos) › **Cancelar B/L**.
2. Se a ficha avisa que o B/L "não pode ser cancelado agora", resolva o que o aviso lista. A Invoice de Demurrage em aberto também segura.
3. Escreva o motivo e confirme.

O B/L cancelado continua na lista, somente leitura, com a faixa "B/L cancelado em…" e o motivo. Ele sai do faturamento e do Manifesto Mercante, aparece como Cancelado no Portal e libera o CE para o B/L reemitido. As importações o deixam de fora.

### Reativar

Em **Mais ações** › **Reativar B/L**, com motivo. O B/L volta a ser editável, as Taxas Locais são recalculadas e ele volta ao Manifesto, se o Manifesto ainda serve à rota. O Vela recusa a reativação se o CE do B/L já está em outro B/L ativo.

### Excluir

1. Na lista **BLs**, marque a caixa da linha do B/L.
2. Clique em **Excluir selecionados**.
3. Escreva o motivo e confirme em **Excluir**.

::: atencao
- A exclusão não tem volta: containers, carga solta, veículos e cálculos saem junto, e o preço fixado também. Se o mesmo B/L for importado de novo, o preço é fixado outra vez, no dia da nova importação.
- O cancelamento apaga as cobranças manuais do B/L. Na reativação, as taxas calculadas voltam, mas as manuais precisam ser lançadas de novo.
:::
