A Viagem é a passagem de um navio pelos portos brasileiros. Tudo o que o Vela faz depois (B/Ls, CE Mercante, cobrança, Comunicados ao Cliente) se pendura nela e nas suas escalas. Este capítulo mostra como cadastrar a Viagem, planejar as escalas, manter as datas do navio em dia e registrar o que muda no caminho.

::: aprende
- cadastrar uma Viagem e planejar as escalas que ela faz no Brasil;
- atribuir os terminais e registrar chegada, atracação e saída do navio;
- saber o que muda sozinho quando uma data muda, e o que não muda;
- registrar a omissão de uma escala, o transbordo e a mudança de destino (COD);
- concluir, cancelar ou excluir uma Viagem.
:::

## 4.1 Cadastrar uma Viagem nova

<!-- regras: VIA-001 VIA-011 VIA-012 VIA-013 VIA-014 VIA-017 VIA-135 ACE-085 -->

::: ficha
- **Quando usar:** O armador confirmou uma viagem do navio para o Brasil e ela ainda não está no Vela.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Tenha o nome do navio, o **IMO** (os 7 dígitos que identificam o navio) e o número da viagem que o armador usa. Procure a viagem em **Viagens › Buscar**: ela pode já ter sido criada por Chegadas e Saídas ou pela planilha de programação.
:::

::: passos
1. No menu, clique em **Viagens**.
2. No alto da página, clique em **Nova Viagem**. A janela **Nova Viagem** abre.
:::

::: tela viagens-topo
Viagens: o menu e o botão Nova Viagem.
:::

::: lado
3. Confira **Armador** e **SCAC**. Eles já vêm com Cosco Shipping Specialized Carriers e CSSC; troque só se a viagem for de outro armador.
4. Em **Navio**, digite o nome do navio.
5. Em **IMO**, digite os 7 dígitos do navio.
6. Em **Numero da viagem**, digite o número que o armador usa (por exemplo, 024E).
7. Se a viagem deve aparecer para os Clientes na programação do Portal, ligue a chave de **Chegadas e Saídas**. Ligada, ela diz **Aparece em Chegadas e Saídas**.
8. Clique em **Cadastrar viagem**. Aparece o aviso "Viagem cadastrada com sucesso." e a Viagem nasce **Ativa**.

::: tela nova-viagem
A janela Nova Viagem preenchida com o navio do exemplo.
:::
:::

As datas não são digitadas aqui. Chegada, atracação e saída pertencem a cada escala e são planejadas na ficha da Viagem ([4.2](#42-planejar-as-escalas-da-viagem)). O bloco **1º Porto Brasileiro** aparece aqui com a caixa desabilitada: você indica outro 1º porto na edição da Viagem ([4.4](#44-atualizar-as-datas-do-navio)).

::: sozinho
- Grava navio, SCAC e número da viagem em maiúsculas.
- Acha o navio pelo IMO. Achado assim, o navio mantém o nome que já tinha no cadastro, mesmo que você tenha digitado de outro jeito, e passa a ter o armador digitado.
- Navio novo entra com o nome padronizado: "ZYHY" vira "ZHONG YUAN HAI YUN", "CS", "C.S." e "C S" viram "COSCO SHIPPING", e "M/V", "MV" e "VSL" saem do nome.
- Acha o armador pelo SCAC. Se o SCAC já existe, vale o nome cadastrado e o nome digitado é ignorado; sem SCAC, o armador é achado pelo nome.
- Com a chave de Chegadas e Saídas ligada, publica a Viagem na programação e no Portal.
- Registra "Viagem criada" na **Linha do tempo** da Viagem, com a origem "botão Nova viagem".
:::

::: conferir
Em **Viagens**, a Viagem aparece na faixa de cartões do alto e no quadro, ordenada pela próxima escala; até você planejar as escalas, o cartão diz "Sem escala brasileira prevista". Clique nela para abrir a ficha, com o selo **Ativa**.
:::

::: aconteceu "Já existe a viagem NAVIO / NÚMERO. Abra a viagem existente em vez de cadastrar outra."
- **O que o sistema faz:** Recusa o cadastro. O Vela compara o navio pelo IMO (que vale mais que a grafia do nome) e o número sem diferença de maiúsculas nem de espaços no começo ou no fim. Se a Viagem existente está cancelada, a mensagem termina com "Reative-a em Viagens em vez de cadastrar outra.".
- **Por quê:** Cada navio e número de viagem existe uma vez só no Vela.
- **O que você faz:** Abra a Viagem existente. Se ela está cancelada e deve voltar, peça ao {{Administrativo}} para usar **Reativar viagem** ([4.10](#410-cancelar-reativar-ou-excluir-uma-viagem)).
:::

::: aconteceu "Navio … com IMO conflitante (… vs …). Corrija antes de importar."
- **O que o sistema faz:** Recusa quando o nome é de um navio já cadastrado com outro IMO. Dois navios com o mesmo nome e sem IMO também recusam ("Navio … ambíguo: mais de um cadastro sem IMO. Informe o IMO."). Sem motivo legível, o aviso é "Falha ao cadastrar viagem. Revise os dados e tente novamente." (na edição, "Falha ao atualizar viagem. Revise os dados e tente novamente.").
- **Por quê:** O IMO identifica o navio; nome parecido não junta navios diferentes.
- **O que você faz:** Confira o IMO com o armador, digite o certo e tente de novo.
:::

::: aconteceu "Armador obrigatorio (min. 2 caracteres)"
- **O que o sistema faz:** Não grava sem armador e navio com pelo menos 2 caracteres e sem o número da viagem ("Navio obrigatorio (min. 2 caracteres)", "Numero da viagem obrigatorio").
- **O que você faz:** Preencha os três campos e clique de novo em **Cadastrar viagem**.
:::

::: atencao
O armador vale para todas as Viagens do mesmo navio: ao corrigir o armador de uma Viagem, você corrige nas outras do mesmo navio também. Navio e armador não têm tela própria nem exclusão; eles nascem e mudam pelas Viagens.
:::

::: porque
O IMO vale mais que a grafia do nome para o mesmo navio, escrito de dois jeitos, continuar sendo um navio só. E a Viagem nasce sem datas porque um navio pode passar por mais de um porto brasileiro, cada um com as suas datas.
:::

## 4.2 Planejar as escalas da Viagem

<!-- regras: VIA-029 VIA-030 VIA-033 VIA-034 VIA-035 ACE-085 -->

A **escala** é a passagem da Viagem por um porto brasileiro: um porto, uma escala, com importação, exportação ou as duas. É a escala que guarda a chegada do navio ao porto: o **ETA** (chegada prevista) e o **ATA** (chegada realizada). Portos estrangeiros da rota, como Shanghai (CNSHA), nunca são escala.

::: ficha
- **Quando usar:** A Viagem está cadastrada e você sabe por quais portos brasileiros o navio vai passar e quando chega a cada um.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Tenha o código de cada porto (BRSSA para Salvador, BRVIX para Vitória) e o ETA com data e hora de Brasília. Confira o **Planejamento por escala** da Viagem: a escala pode já ter nascido de um arquivo de B/L ou de Chegadas e Saídas.
:::

::: passos
1. Abra a ficha da Viagem. Na aba **Visão geral**, no bloco **Planejamento por escala**, clique em **Adicionar escala**. A janela **Adicionar escala** abre.
:::

::: tela viagem-planejamento-vazio
O Planejamento por escala de uma Viagem ainda sem escala.
:::

::: lado
2. Em **Porto da escala**, digite o código do porto (no exemplo, BRSSA). O campo sugere BRVIX, BRSSA, BRPEC, BRSUA, BRSSZ e outros.
3. Em **ETA · previsto**, informe a data e a hora da chegada prevista. A hora é obrigatória. Se o navio já chegou, informe também o **ATA · realizado**, com hora.
4. Em **Operação da escala**, escolha **Somente importação**, **Importação + exportação** ou **Somente exportação**. A escala nova já vem em **Somente importação**. Com exportação, veja "Exportação na escala", logo abaixo.
5. Clique em **Adicionar escala**. A escala entra no **Planejamento por escala**.

::: tela adicionar-escala
A janela Adicionar escala com o porto de Salvador.
:::
:::

Repita para cada porto. No exemplo, a Viagem 024E tem duas escalas: Salvador (BRSSA) e Vitória (BRVIX). A janela de uma escala nova não mostra os terminais: você os atribui depois, na edição da escala ([4.3](#43-atribuir-os-terminais-e-registrar-a-atracação)).

### Exportação na escala

<!-- regras: VIA-035 EQU-115 ALE-045 -->

Com **Importação + exportação** ou **Somente exportação**, a janela pede o que vai ser embarcado:

- Em **Carga de exportação**, marque **Granito**, **Embarque de vazios** ou os dois. Sem nenhum, a janela avisa "Uma nova declaração de exportação exige granito ou vazios.".
- Com **Embarque de vazios**, aparecem **Quantidade de CNTR vazios** e **Movimentos**. Os dois podem ficar em branco.
- Em **Portos de descarga**, digite os portos de destino separados por vírgula. Eles formam a perna de exportação da rota.

Declarar a exportação é decisão sua, mesmo sem saber ainda a quantidade. Cada escala tem uma só declaração. Para retirar, volte a **Somente importação**: a janela pede confirmação ("Retirar a exportação desta escala") e, ao salvar, descarta as frentes de exportação, as quantidades e os portos.

O Line Up marca a exportação com Granito pela declaração da escala, e não pela importação do Granito. O Granito importado aparece no painel de Granito da aba **Exportação** da Viagem (manifestos, B/Ls e peso) e na seção **Carga carregada** do ADR de Saída (capítulo 11). Mudar a exportação da escala, ou vincular, desvincular ou mover um manifesto de Granito ou de Embarque de Vazios, recalcula na hora o alerta **Exportação pendente pós-ATD** da Viagem.

### BLs e CEs, Vinculada e Nº escala

<!-- regras: VIA-037 -->

O bloco **BLs e CEs** da janela diz em que pé está a documentação da escala:

- **BLs e CEs**: **Aguardando**, **Recebido**, **Lançando**, **Em aprovação** ou **Aprovado**. O Vela atualiza sozinho pela conciliação documental. Mudar à mão pede justificativa.
- **Vinculada** (**Sim** ou **Não**): confirma que os manifestos foram vinculados à escala no Mercante.
- **Nº escala (Mercante)**: o número da escala no Mercante.

Um não substitui o outro: informe cada um quando souber. Na escala só de exportação, o status é o da exportação.

### De onde mais nasce uma escala

<!-- regras: VIA-030 VIA-052 BLR-029 CEB-063 -->

Além de **Adicionar escala**, vira escala:

- o porto de descarga (POD) de um B/L importado. O POD tem de ser reconhecido pelo apelido conhecido ou pelo cadastro de portos; senão a linha do arquivo dá erro ("POD "…" não está no cadastro de portos: cadastre o porto ou corrija o arquivo." ou "POD ausente no arquivo: informe o porto de descarga.");
- o porto com chegada gravada em Chegadas e Saídas ou na planilha de programação (capítulo 5);
- o porto com exportação declarada;
- o porto com Atracação.

Grafias do mesmo porto são a mesma escala: BRVIT e BRVIX são Vitória; Sepetiba e Itaguaí ficam em BRIGI. Já Navegantes e Itajaí, e Recife e Suape, são escalas distintas.

O Baplie (capítulo 6) não cria escala. Para conferir navio, viagem e escalas, a importação do Baplie lê só as escalas de importação ativas da Viagem (não excluídas, não omitidas). O porto brasileiro do arquivo que ainda não é escala aparece desmarcado, como "BRxxx — sem escala na viagem (N containers); marcado, entra no Baplie sem escala". Marcado, os containers entram e ficam pendentes de conciliação até a escala existir. Container com POD estrangeiro fora das escalas ativas fica fora, com o aviso "N containers fora das escalas da viagem não serão importados". Trocar a Viagem na importação desmarca esses portos, e a Viagem sem escala não tem essa conferência de porto.

O menor ETA das escalas de importação marca o 1º porto brasileiro, de onde contam os prazos D−7 e D−5 da Viagem ([4.4](#44-atualizar-as-datas-do-navio)).

::: sozinho
<!-- regras: VIA-033 VIA-134 VIA-141 CEB-038 CEB-039 -->
- Grava o porto pelo código, em maiúsculas. O código brasileiro que o Vela ainda não conhece vale como digitado; o porto entra no cadastro, com o próprio código como nome, quando a escala recebe exportação ou terminal.
- A escala nova nasce importadora.
- Guarda cada gravação no Histórico da escala (ETA, ATA, terminal, Atracação, frente, exportação, BLs e CEs, Vinculada, Nº escala, remoção e omissão), com autor, setor, momento e justificativa. Nada é apagado; a tela mostra sempre a gravação mais recente.
- No fim de toda gravação que mexe em B/L, container de B/L, Baplie, Granito ou exportação, recalcula o **BLs e CEs** de cada escala brasileira:
  - **Aguardando**: nenhum B/L ativo; ou B/L de container sem Baplie; ou container cheio do Baplie naquele POD sem B/L ativo do mesmo POL.
  - **Recebido**: há B/Ls ativos e todos os cheios do Baplie daquele POD estão cobertos; ou só há carga solta, sem cheio no Baplie.
  - **Aprovado**: Recebido, e todos os B/Ls ativos com CE Mercante. Na exportação conta só o Granito: **Aprovado** quando todos os B/Ls de Granito do POL têm CE.
- O status calculado só é gravado quando muda, e então substitui o que estava, inclusive o marcado à mão. Fica no Histórico como "Atualização automática de BLs e CEs pela conciliação documental: …". **Lançando** e **Em aprovação** só existem à mão.
- Registra na Linha do tempo a escala adicionada.
:::

::: conferir
No **Planejamento por escala**, cada escala tem uma linha: **Porto**, **Opera** (Importação · Exportação), **ETA**, **ATA**, **ATD**, **CE Mercante** (o status BLs e CEs, em âmbar fora de **Aprovado**), **Nº Escala** e **Vinculada** (Sim ou Não), com o lápis **Editar**. Em tela com menos de 1.024 pixels de largura, Opera, ATA e Vinculada saem da linha e ficam só na edição. Sem escala, aparece "Nenhuma escala planejada para esta viagem.". Na lista de Viagens, o cartão passa a mostrar as escalas brasileiras com o ETA.
:::

::: aconteceu "A escala é de porto brasileiro; portos estrangeiros da rota não são escalas."
- **O que o sistema faz:** Não adiciona a escala de porto estrangeiro. Com o campo vazio, avisa "Informe o porto da escala.". Código fora do formato brasileiro (BR e mais três letras ou dígitos) é recusado com "LOCODE brasileiro invalido: …".
- **Por quê:** Escala é só a passagem por um porto brasileiro. O porto de embarque estrangeiro aparece na rota dos B/Ls ([4.6](#46-conferir-o-atd-do-porto-de-embarque-e-o-nº-de-manifesto-da-rota)).
- **O que você faz:** Digite o código brasileiro do porto, como BRSSA ou BRVIX.
:::

<!-- regras: VIA-036 EQU-097 -->

::: aconteceu "Há carga vinculada; a declaração não pode ser retirada."
- **O que o sistema faz:** Com Granito importado no porto, ou Embarque de vazios aberto na escala (mesmo sem nenhuma unidade), a declaração daquela carga não sai: o botão fica com cadeado e a janela avisa que "a declaração só pode ser retirada depois que a carga deixar de existir". Retirar a exportação inteira, ou excluir a escala, é recusado por qualquer caminho: "Não é possível remover a declaração de exportação da escala …: existem operações de carga.".
- **Por quê:** A carga de exportação precisa de uma escala que a declare.
- **O que você faz:** A declaração só sai depois que a carga de exportação deixar de existir (capítulo 10).
:::

<!-- regras: VIA-037 CEB-038 CEB-039 -->

::: aconteceu "O status BLs e CEs da escala mudou sozinho"
- **O que o sistema faz:** Recalcula **Aguardando**, **Recebido** e **Aprovado** pela conciliação documental a cada importação e substitui até o status marcado à mão.
- **Por quê:** O status acompanha os B/Ls, o Baplie e os CEs que o Vela já recebeu.
- **O que você faz:** Nada, se o cálculo bate com a documentação. Para marcar à mão (por exemplo, **Lançando**), escreva a justificativa; sem ela, a janela avisa "Informe a justificativa para alterar BLs e CEs.". A marcação manual vale até a próxima mudança calculada.
:::

<!-- regras: EQU-077 -->

::: aconteceu "Nenhuma escala brasileira na viagem: cadastre a escala em Adicionar escala, no Planejamento por escala da aba Visão geral da viagem, antes de criar o embarque."
- **O que o sistema faz:** **Novo embarque** de vazios pede **Viagem** e **Porto de embarque**, escolhido entre as escalas brasileiras ativas da Viagem (sem as excluídas e as omitidas) e os portos de POL e POD dos B/Ls. Sem nenhum, aparece esta mensagem. Falha de leitura não é falta de escala. **Criar embarque** abre o embarque criado ("Embarque criado.") ou, se a escala já tem um, abre o existente ("Este embarque já existia e foi aberto."). Vindo da Viagem, pela ação **Novo embarque de vazios**, a Viagem já vem escolhida.
- **O que você faz:** Planeje a escala no **Planejamento por escala** da aba **Visão geral** e crie o embarque de novo (capítulo 10).
:::

::: porque
Um porto, uma escala: chegar a Salvador é um fato só, mesmo que o navio descarregue e embarque. Por isso ETA e ATA ficam na escala, e as datas de cada terminal ficam na Atracação ([4.3](#43-atribuir-os-terminais-e-registrar-a-atracação)). A exportação é declarada antes de se saber a quantidade para que as frentes de exportação recebam terminal e o Line Up já mostre o embarque.
:::

## 4.3 Atribuir os terminais e registrar a atracação

<!-- regras: VIA-038 VIA-040 VIA-041 ACE-120 -->

Cada escala se divide em **frentes de operação**: o recorte da escala por sentido e tipo de carga. Cada frente recebe o terminal onde a operação acontece:

- em **Importação**: **Carga cheia** (sempre na escala importadora e nos B/Ls de contêiner), **Carga solta** (B/L de carga solta; o B/L misto ocupa as duas), **Vazios** (vazios de importação no porto) e **Veículos**;
- em **Exportação**: **Granito** e **Vazios**, conforme a declaração de exportação.

Frente sem terminal fica **TBC — pendente** ("terminal a confirmar"). O selo no alto diz "N em TBC" ou "Todas atribuídas". Frentes diferentes podem dividir o mesmo terminal.

Cada terminal atribuído vira uma **Atracação**: a passagem do navio por aquele terminal. Ela tem as datas de berço, sempre com data e hora de Brasília: **ETB** (atracação prevista), **ATB** (atracação realizada), **ETD** (desatracação prevista) e **ATD** (desatracação realizada). Tem também o **Restow**, os containers descarregados e reembarcados por reestiva no berço.

::: ficha
- **Quando usar:** Você sabe em que terminal cada operação da escala acontece, ou o navio atracou ou desatracou num terminal.
- **Quem faz:** {{Qualquer equipe}} · remover uma Atracação: {{Operações}} e {{Administrativo}}
- **Antes de começar:** A escala precisa existir ([4.2](#42-planejar-as-escalas-da-viagem)). Tenha o terminal de cada operação e as datas com hora.
:::

::: passos
1. Na ficha da Viagem, no **Planejamento por escala**, clique no lápis **Editar** da escala (no exemplo, BRVIX). A janela **Editar escala** abre. Enquanto lê as frentes, ela mostra "Carregando operações e terminais da escala…" e **Salvar escala** fica desabilitado.
:::

::: lado
2. Em **Terminais e atracações**, escolha o terminal de cada frente (no exemplo, TVV para **Importação · Carga cheia**). A lista traz só os terminais portuários do porto da escala. O cartão do terminal aparece em **Atracações por terminal**.
3. No cartão, informe o **ETB · previsto**, com data e hora.
4. Informe o **ETD · previsto**, com data e hora. Quando o navio atracar e desatracar, volte a esta janela e informe **ATB · realizado** e **ATD · realizado**. Se houve Restow, digite a quantidade em **Restow** (número inteiro, zero ou mais).
5. Clique em **Salvar escala**.

::: tela escala-terminais
Terminais e atracações: a frente de carga cheia no TVV e as previsões do terminal.
:::
:::

Qualquer equipe salva a escala inteira de uma vez: ETA, ATA, BLs e CEs, Vinculada, Nº escala, exportação, o terminal das frentes e as datas e o Restow de cada Atracação.

::: sozinho
<!-- regras: VIA-032 VIA-042 VIA-141 VIA-143 EQU-118 ALE-044 ALE-047 BLR-083 -->
- Cria uma Atracação para cada terminal atribuído. Cada terminal aparece uma vez por escala. Frente sem terminal não cria Atracação: antes do ATA, a escala guarda uma só Atracação **TBC**, sem datas e sem cartão na janela.
- Enquanto alguma frente está em TBC, a escala não conclui. Quando nenhuma frente fica em TBC (com o ATA registrado, nenhuma pode ficar), a Atracação TBC sai e deixa de segurar a conclusão da escala e da Viagem.
- Ordena as Atracações pelo ATB (ou pelo ETB, na falta dele) e, no empate, pela sigla do terminal. A ordem não é digitada.
- Confere que o porto e o terminal batem com o cadastro de portos. A janela preenche esses dados a partir da escala.
- Liga cada frente à seção do ADR de Saída daquele terminal (capítulo 11): **Carga cheia** e **Carga solta** a **Carga descarregada**; **Vazios** de importação a **Vazios descarregados**; **Veículos** a **Veículos**; **Granito** a **Carga carregada**; **Vazios** de exportação a **Embarque de vazios**.
- Dá a cada B/L o terminal de descarga da frente do POD dele. Para um B/L descarregar em outro terminal, use **Definir exceção** (ou **Alterar exceção**) na ficha do B/L, com justificativa obrigatória: a exceção aparece em âmbar ("Exceção deste B/L, fora da Frente de Operação") e fica no Histórico. **Remover exceção** volta ao terminal herdado, e corrigir o POD tira a exceção do POD anterior (capítulo 7).
- Recalcula na hora todos os alertas da Viagem quando muda porto, terminal, ETB, ATB, ETD, ATD ou Restow de uma Atracação.
- Quando um terminal perde todas as frentes, remove a Atracação dele; ela fica no Histórico com as datas que tinha. O ADR de Saída aberto daquele terminal é apagado só se não tiver assinatura, ocorrência, histórico nem alerta; com alerta, ele é preservado.
- Registra no Histórico o setor de quem gravou, e na Linha do tempo os terminais, as Atracações e o Restow.
:::

::: conferir
No **Planejamento por escala**:

1. Clique na seta antes do porto para abrir as Atracações da escala (elas ficam fechadas por padrão): **Terminal**, **ETB**, **ATB**, **ETD**, **ATD** e **Restow**, com o lápis de cada uma. No fim fica **Adicionar atracação**, que leva à mesma janela da escala. Sem Atracação, aparece "Sem atracação em BRVIX.".
2. Para corrigir, clique no lápis da escala e refaça os passos.

::: tela viagem-planejamento
Planejamento por escala com as Atracações de Vitória abertas.
:::
:::

<!-- regras: VIA-143 -->

::: aconteceu "Com o ATA registrado, toda frente de operação precisa de terminal: TBC não é terminal. Escolha o terminal de cada frente."
- **O que o sistema faz:** Recusa salvar a escala com alguma frente em TBC depois que o ATA foi registrado, também ao gravar a declaração de exportação. A Atracação TBC não aceita datas: ETB, ETD, ATB, ATD e Restow nela são recusados ("TBC não é terminal: ETB, ETD, ATB, ATD e Restow só na atracação de um terminal. Escolha o terminal antes de informar as datas.").
- **Por quê:** TBC é só "terminal a confirmar". Depois que o navio chegou, cada operação tem terminal.
- **O que você faz:** Escolha o terminal de cada frente e salve.
:::

<!-- regras: VIA-043 -->

::: aconteceu "Informe a justificativa para alterar o estado terminalizado existente da escala."
- **O que o sistema faz:** Mostra e exige **Justificativa da alteração** quando a escala já foi salva e você muda um dado registrado: o terminal de uma frente, ATB, ATD, Restow ou a declaração de exportação. Mudar **BLs e CEs** à mão pede justificativa sempre, mesmo na escala nova. Corrigir o ATA mostra o campo, mas ele é opcional. Preencher um campo vazio e mudar previsões (ETA, ETB, ETD), **Vinculada** e **Nº escala** não pedem justificativa. O Vela confere de novo ao gravar ("Justificativa obrigatoria para alterar estado terminalizado existente.").
- **Por quê:** O que já aconteceu no porto só muda com motivo registrado.
- **O que você faz:** Escreva o motivo e salve. Ele aparece na Linha do tempo como "Justificativa: …".
:::

<!-- regras: VIA-044 VIA-090 ACE-085 ACE-086 -->

::: aconteceu "Alteração bloqueada por ADR fechado (TERMINAL / …). Reabra o ADR antes de continuar."
- **O que o sistema faz:** Não grava nada quando a mudança afeta um terminal com ADR de Saída fechado: frente, terminal, ATB, ATD, Restow ou exportação. A janela diz "A alteração não foi aplicada porque existe ADR fechado…", e cada bloqueio traz **Reabrir ADR**, que leva à aba **ADR** daquele terminal. ETA, ATA e as previsões da Atracação continuam editáveis.
- **Por quê:** O ADR fechado é o registro final da operação no terminal. Com ele fechado, o Vela recusa também mudar resolução, observação, assinatura e terminal do ADR ("ADR fechado: reabra antes de alterar …").
- **O que você faz:** Reabra o ADR com motivo (qualquer equipe pode; sem motivo, o Vela recusa), corrija a escala e feche o ADR de novo, o que qualquer equipe também pode fazer (capítulo 11).
:::

<!-- regras: VIA-045 VIA-041 -->

::: aconteceu "A escala foi atualizada por outra pessoa. Seus dados foram preservados; recarregue a escala antes de salvar novamente."
- **O que o sistema faz:** Não grava nada se outra pessoa salvou a mesma escala depois que você abriu a janela. Seus dados ficam na janela, e o aviso no canto diz "A escala foi atualizada por outra pessoa. Recarregue antes de salvar novamente.". Duas gravações da mesma escala nunca se misturam. As outras recusas aparecem na janela com o próprio motivo; sem motivo legível, "Falha ao salvar a escala.".
- **O que você faz:** Anote o que digitou, feche a janela, abra a escala de novo e salve.
:::

<!-- regras: VIA-042 ACE-120 -->

::: aconteceu "Somente Operações e o Administrativo removem atracação."
- **O que o sistema faz:** Tirar um terminal de todas as frentes remove a Atracação dele, e remover Atracação é de Operações e do Administrativo. Vale também ao mover a única frente de um terminal para outro. Mesmo para eles, a remoção é recusada ("Atracação travada: …", na janela da escala) quando o terminal tem B/L com CE Mercante, documento financeiro emitido ou ADR de Saída fechado. B/L sem terminal próprio conta para toda Atracação do porto.
- **Por quê:** A trava protege o que já é oficial naquele terminal: CE Mercante, documento financeiro ou ADR fechado.
- **O que você faz:** Peça a Operações ou ao Administrativo. Com trava, resolva a causa antes (por exemplo, reabrir o ADR). O terminal do ADR antigo, feito por porto, também é só de Operações e do Administrativo: os outros recebem "Terminal pertence ao departamento operacoes.".
:::

<!-- regras: VIA-040 -->

::: aconteceu "A hora do … é obrigatória quando a data estiver preenchida para o terminal …"
- **O que o sistema faz:** A janela recusa data sem hora, ATD sem ATB ou anterior a ele ("Informe o ATB antes do ATD do terminal …"), ETD sem ETB ou anterior a ele ("Informe o ETB antes do ETD do terminal …"), e Restow que não seja inteiro de zero para cima ("Restow inválido para o terminal …"). O Vela confere a ordem das datas de novo ao gravar.
- **O que você faz:** Complete a hora e corrija a ordem das datas.
:::

<!-- regras: VIA-039 -->

::: aconteceu "Terminal inativo … nao pode receber nova atribuicao."
- **O que o sistema faz:** Terminal desativado continua nas escalas antigas, marcado "(inativo · histórico)" ou "Terminal inativo · histórico", mas não recebe nova frente nem nova Atracação. Terminal de outro porto, ou que não é terminal portuário, é recusado ("Terminal nao pertence ao porto … ou nao e terminal portuario.").
- **O que você faz:** Escolha um terminal ativo do porto da escala. Se o certo está desativado, peça ao Administrativo para reativá-lo (capítulo 5).
:::

<!-- regras: VIA-144 -->

::: aconteceu "Falha ao carregar frentes e terminais."
- **O que o sistema faz:** Se a leitura das frentes e dos terminais falha, a janela mostra o erro (ou o motivo) e não deixa salvar. Fechar a janela com dados digitados não pede confirmação: o que você digitou se perde.
- **O que você faz:** Feche a janela, abra a escala de novo e refaça.
:::

<!-- regras: FAT-025 -->

::: aconteceu "A fatura do B/L é recusada por pendência de terminal de descarga"
- **O que o sistema faz:** B/L com pendência de terminal de descarga não emite fatura, e a recusa lista a pendência: B/L com terminal escolhido sem frente de importação desse terminal no POD, ou B/L misto sem terminal escolhido cujas frentes de contêiner e de carga solta no POD têm terminais diferentes (ou faltam).
- **O que você faz:** {{Operações}} atribui o terminal às frentes de importação da escala do POD ou define a exceção de terminal no B/L (capítulo 7).
:::

<!-- regras: CLI-061 -->

::: aconteceu "Nenhuma carga disponível para envio de NOB"
- **O que o sistema faz:** No envio manual do Aviso de Atracação (NOB), Atracação sem frente atribuída não traz carga, com a orientação de atribuir a frente na escala. Terminal sem sigla cadastrada deixa o Cliente **Bloqueado**, com "Terminal da Atracação sem sigla cadastrada.".
- **O que você faz:** Atribua o terminal às frentes da escala. Sem sigla, corrija o cadastro do terminal (capítulo 5) e envie de novo (capítulo 16).
:::

::: porque
Cada terminal tem o próprio ciclo de berço e o próprio ADR de Saída. Por isso as datas de atracação ficam na Atracação, e não na escala. TBC só diz que o terminal ainda não foi confirmado: depois que o navio chegou, a operação já tem lugar. E mudar o que já aconteceu pede justificativa para o Histórico explicar cada correção.
:::

## 4.4 Atualizar as datas do navio

<!-- regras: VIA-034 ACE-085 -->

::: ficha
- **Quando usar:** O armador mudou a chegada prevista (ETA) ou o navio chegou ao porto (ATA).
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Tenha a data e a hora de Brasília. ATB e ATD são do terminal: registre-os no cartão da Atracação ([4.3](#43-atribuir-os-terminais-e-registrar-a-atracação)).
:::

::: passos
1. Na ficha da Viagem, no **Planejamento por escala**, clique no lápis **Editar** da escala.
2. Em **Chegada ao porto**, mude o **ETA · previsto** ou informe o **ATA · realizado**, sempre com data e hora.
3. Se você corrigiu um ATA já registrado, a janela mostra **Justificativa da alteração**. O motivo é opcional, mas fica no Histórico.
4. Clique em **Salvar escala**.
:::

O **ATD da escala** é só leitura: nasce das Atracações. Ele existe quando todas as Atracações da escala têm ATD, e vale o mais recente. A dica embaixo do campo diz de onde ele veio ou "Aguardando o ATD de …".

### Indicar outro 1º porto brasileiro

<!-- regras: VIA-018 VIA-133 ALE-042 -->

Os prazos D−7 e D−5 da Viagem contam do primeiro ETA brasileiro: o menor ETA das escalas ativas de importação (não excluídas, não omitidas), ou o ETA indicado na edição da Viagem, quando for anterior.

- Em D−7 (sete dias antes) abrem os alertas de B/Ls esperados e de Baplie ausente ou sem cobertura, e a conciliação Baplie × B/L passa a cobrar todas as rotas.
- Em D−5 (cinco dias antes) abre o alerta de CE Mercante faltando.

Incluir ou excluir um B/L, mudar a Viagem, o POL ou o POD dele, ou cancelá-lo, recalcula na hora os alertas **B/L esperado pendente** e **CE Mercante pendente** das Viagens de antes e de depois. A importação do arquivo de B/L recalcula uma vez por Viagem, no fim. Na Viagem concluída, só o tipo de alerta já aberto é reavaliado; a cancelada não é recalculada.

Para os prazos contarem de um porto anterior às escalas de importação, indique esse porto na edição da Viagem:

1. Na ficha da Viagem, clique em **Editar**.
2. No bloco **1º Porto Brasileiro (Âncora D−7 / D−5)**, marque **Indicar outro 1º porto brasileiro**. Na Nova Viagem a caixa aparece desabilitada. Na edição você pode marcá-la, mas a Viagem sem escala de importação recusa a indicação ("A indicação exige a existência de ao menos uma Escala própria na viagem.").
3. Preencha **Porto indicado** e **ETA indicado**. Os dois vão juntos.
4. Clique em **Salvar viagem**.

::: sozinho
<!-- regras: VIA-009 VIA-047 VIA-127 VIA-128 VIA-129 VIA-130 ALE-043 ALE-044 -->
**Quando o ETA muda:**

- Mudam a Próxima escala e a ordem da lista de Viagens.
- Mudam a coluna ETA e a ordem do Line Up.
- Muda a data em Chegadas e Saídas e no Portal, se o porto é um dos portos do quadro e a Viagem está publicada e Ativa.
- O alerta "ETA de … passou sem ATA registrada." abre já no próprio dia do ETA (dia de Brasília), se não há ATA. A rotina de alertas confere a cada 15 minutos.
- Mudam os prazos D−7 e D−5 e o alerta "B/L sem Cliente perto do ETA" (5 dias antes).
- Muda a janela do Comunicado Chegada Próxima (NOA), que a régua de Comunicados reavalia na hora.

**Quando o ATA é registrado ou corrigido:**

- A escala deixa de ser a Próxima escala, e a vez passa à seguinte.
- O Line Up mostra o ATA em verde na coluna ETA e passa a linha para "chegado". Se o ATA for apagado, o ETA volta.
- Chegadas e Saídas e o Portal mostram a chegada efetiva com ✓.
- O alerta de ETA sem ATA fecha. Se nenhuma Atracação tem ETB, abre "ATA registrada; falta o ETB.".
- O Aviso de Chegada (NOR) fica devido, e o ADR mostra o ATA na seção Escala.

**Quando o ETB e o ATB mudam** (no cartão da Atracação):

- A partir do próprio dia do ETB, sem ATB, abre "Terminal …: ETB de … passou sem ATB registrada.".
- O ATB deixa a escala **Atracada**: faixa verde no Line Up do Painel e na Tela TV, ATB com ✓ na coluna ETB e a linha no topo do Line Up.
- Sem ETD, abre "Terminal …: ATB registrada; falta o ETD.".
- O Aviso de Atracação (NOB) fica devido para os Clientes daquele terminal, e o ATB aparece no ADR.

**Quando o ETD e o ATD mudam:**

- A partir do próprio dia do ETD, sem ATD, abre "Terminal …: ETD de … passou sem ATD registrada.".
- O ATD fecha esse alerta, tira a linha da Tela TV, começa o prazo de 72 horas do ADR do terminal e abre os alertas de pendência dos setores.
- Quando todas as Atracações da escala têm ATD, a escala fica **Concluída** e perde o destaque. Com todas as escalas concluídas, a gravação deixa a Viagem **Concluída** ([4.9](#49-concluir-a-viagem)).
- Escala com exportação declarada e ATD em algum terminal sem o Granito ou o Embarque de Vazios da Viagem abre "Saída (ATD) registrada no terminal sem a exportação vinculada." para Operações.

**Sempre:** o estado da escala é calculado, nunca escolhido. Sem Atracação, não há estado; com alguma Atracação com ATB e sem ATD, **Atracada**; com todas com ATD, **Concluída**. Mudar ETA, ATA, excluir ou omitir a escala recalcula na hora os alertas de data da escala e dos terminais e os prazos D−7 e D−5. Mudar a Viagem (número, omissão, importação do Baplie, situação) recalcula todos os alertas dela. Se esse recálculo falhar, a gravação vale do mesmo jeito e a rodada de 15 minutos corrige.
:::

::: conferir
<!-- regras: POR-069 CLI-060 CLI-080 -->
- O bloco **Próxima escala**, no alto da ficha, mostra o porto, o ETA, **Planejadas**, **Atracação** e **Status**. A Próxima escala é a escala não omitida, com ETA e ainda sem ATA, de menor ETA. Sem escala a cumprir, o bloco mostra "—" e "Nenhuma escala com ETA a cumprir".
- O Line Up do Painel e Chegadas e Saídas mostram a data nova (capítulo 5).
- No Portal, o bloco **Chegadas e saídas** mostra só as Viagens ativas marcadas para o Portal, com a saída na origem (ETD) e a chegada no Brasil (ETA). O ✓ marca a data efetiva; "Omitida", a escala omitida; o porto excluído some. No Portal, a previsão vencida não fica em âmbar.
- Os Comunicados de chegada seguem as datas (capítulo 16). O NOA exige o ETA da escala e o NOR exige o ATA; o NOB sai por Atracação com ATB. O B/L com exceção de terminal entra só naquele terminal; os outros, pela frente da modalidade (o misto precisa das duas). Ficam fora da conferência de carga a escala excluída ou omitida e o B/L cancelado, sem Cliente ou sem POD, de Cliente inativo ou de Viagem cancelada. O porto casa pela grafia (BRVIT e BRVIX são o mesmo). No envio manual não há janela de dias; o Comunicado livre é um por Cliente e Viagem.
- Na Comunicação dos Clientes, a vista **Cobertura de viagens** (filtros **Navio**, **Viagem** e **Mês**, pelo ETA da Viagem no mês) tem uma linha por Navio / Viagem e porto de descarga. Ali, o NOA só conta como devido de 5 dias antes do ETA em diante, e o NOR depois do ATA; antes disso aparece "—". A ordem começa pela Viagem da escala mais próxima.
:::

<!-- regras: VIA-009 VIA-127 VIA-128 -->

::: aconteceu "ETA de … passou sem ATA registrada."
- **O que o sistema faz:** A escala continua como Próxima escala até o ATA ser registrado: o bloco mostra o ETA com "· vencido" em âmbar e **Status** "ETA vencido" (antes disso, "Pendente"). O ETA vence no fim do próprio dia. O alerta abre já no dia do ETA.
- **Por quê:** Só o ATA passa a vez à escala seguinte. ETA que já passou não tira a escala dessa posição.
- **O que você faz:** Se o navio chegou, registre o **ATA** com hora. Se atrasou, atualize o **ETA**.
:::

<!-- regras: VIA-034 -->

::: aconteceu "A hora do ATA é obrigatória quando a data estiver preenchida."
- **O que o sistema faz:** Não salva ATA sem hora. O ETA também exige hora ao ser digitado ou alterado ("A hora do ETA é obrigatória ao informar ou alterar a data."). O ETA só com data que veio de Chegadas e Saídas continua aceito.
- **O que você faz:** Informe a hora de Brasília e salve.
:::

<!-- regras: VIA-018 -->

::: aconteceu "O ETA indicado (…) deve ser anterior ao menor ETA das escalas próprias (…)"
- **O que o sistema faz:** Recusa o 1º porto indicado com ETA igual ou posterior ao menor ETA das escalas de importação. Sem escala própria, a indicação é recusada. Porto sem ETA, ou ETA sem porto, também não grava ("Informe o ETA do 1º porto brasileiro indicado" / "Informe o 1º porto brasileiro indicado").
- **Por quê:** O porto indicado só serve para antecipar os prazos D−7 e D−5.
- **O que você faz:** Confira o ETA com o armador. Se o primeiro porto é uma escala de importação da Viagem, desmarque **Indicar outro 1º porto brasileiro**.
:::

<!-- regras: VIA-132 -->

::: atencao
As datas do navio não mudam a cobrança. A data de referência das Taxas Locais é o dia da importação do B/L, e não o ETA. A Demurrage corre pela data de descarga de cada container, que o ATA não preenche. E o Desbloqueio de CE não usa as datas da escala.
:::

::: porque
O ETA e o ATA são do porto, e o ETB, o ATB, o ETD e o ATD são de cada terminal. Por isso a chegada se registra na escala, e o berço, na Atracação. A Próxima escala só anda com o ATA, e não com o relógio: o ETA vencido continua na frente para lembrar que falta registrar a chegada.
:::

## 4.5 Acompanhar a Viagem

<!-- regras: VIA-002 VIA-003 VIA-004 -->

A lista de Viagens diz quais navios chegam e o que falta em cada um. A ficha da Viagem junta tudo o que pertence a ela: escalas, carga, documentos e o que aconteceu.

::: ficha
- **Quando usar:** Você quer saber quais navios estão chegando, o que falta de documento e o que mudou numa Viagem.
- **Quem faz:** {{Qualquer equipe}}
:::

### A lista de Viagens

No menu, clique em **Viagens**. A lista traz todas as Viagens, inclusive as concluídas e as canceladas:

- **A faixa de cartões**, no alto, sempre abre no início e diz "Ordenado por próxima escala". Cada cartão mostra o armador, navio / viagem, a situação de conciliação, as escalas brasileiras com o ETA (ou "Sem escala brasileira prevista"), ao lado de cada escala os ícones das operações (contêiner, carga solta, veículos, vazios de importação, vazios de exportação, Granito) e, no rodapé, os B/Ls, os contêineres e a cobertura de CE.
- **O quadro Viagens** aparece quando nenhuma Viagem está aberta, com as colunas **Navio / Viagem**, **Armador**, **Próxima escala**, **Escalas no Brasil**, **B/Ls**, **Containers**, **BB (t)**, **Veículos**, **CE** e **Conciliação** e o lápis de edição. Os contêineres são contados pelo número, uma vez cada. A coluna **CE** conta os B/Ls com CE Mercante sobre o total de B/Ls da Viagem, em âmbar enquanto falta. A Viagem cancelada aparece esmaecida e sem lápis; na faixa de cartões o lápis continua no cartão dela, mas não abre a edição.

A ordem é a da próxima escala no Brasil: o menor ETA primeiro (no empate, a ETB), as Viagens sem próxima escala no fim e, depois, navio e número.

Os filtros ficam sempre abertos:

- **Buscar**: navio, viagem, armador e portos de origem e destino.
- **Período**: **Qualquer**, **Hoje**, **Próximos 7 dias**, **Próximos 30 dias** ou **Entre datas**, sempre pelo dia do ETA da próxima escala: **Hoje** traz o ETA de hoje, a qualquer hora. A Viagem sem próxima escala sai do recorte; em **Hoje**, **Próximos 7 dias** e **Próximos 30 dias**, sai também a Viagem com o ETA vencido.
- **Status**: **Todas**, **Ativas**, **Concluídas** ou **Canceladas**. Começa em **Todas**.
- **Conciliação**: **Todas**, **Conciliada** ou **Pendente**. No filtro, **Pendente** traz as Viagens Pendentes e Divergentes.

Com algum filtro ativo, aparece **Limpar filtros**. O contador ao lado sempre diz "N de M viagens".

### A Conciliação

<!-- regras: VIA-005 CEB-041 CEB-091 -->

A **Conciliação** da Viagem é um sinal operacional, e não uma liberação financeira:

- **Divergente** (vermelho): há divergência aberta entre o Baplie e os B/Ls.
- **Pendente** (âmbar): falta CE Mercante em algum B/L. Manifesto **A informar** não conta.
- **Conciliado** (verde; no quadro e no filtro, **Conciliada**): nada falta. A Viagem sem B/L também fica assim.
- **Verificando** (cinza): a Viagem ativa com Baplie e CE completo, enquanto a contagem de divergências do Baplie não chega. Ela não entra em nenhum filtro de Conciliação.

A Viagem concluída ou cancelada, e a Viagem sem Baplie, seguem só a cobertura de CE. A mesma marca aparece na faixa de Viagens da tela do Baplie EDI, com a mesma conta. A cobertura de CE também aparece na ficha (**CE Mercante** N/M) e na aba **Rotas e Manifestos** ([4.6](#46-conferir-o-atd-do-porto-de-embarque-e-o-nº-de-manifesto-da-rota)).

### A ficha da Viagem

<!-- regras: VIA-007 VIA-008 VIA-010 VIA-001 -->

Clique numa Viagem para abrir a ficha. O endereço guarda a aba aberta: o link copiado reabre na mesma aba.

- **O topo** diz "Viagem · armador", navio / viagem e o selo do status: **Ativa** (azul), **Concluída** (verde) ou **Cancelada** (vermelho). Mostra também as rotas de **Importação** e **Exportação** ("Origem a definir" ou "Destino a definir" quando o lado é desconhecido) e os **B/Ls de importação**.
- **O selo Faturamento encerrado** aparece quando todo B/L ativo da Viagem está isento de Taxas Locais ou pago. B/L cancelado não segura o selo; a Viagem só com B/L cancelado fica sem ele; e o B/L de carga solta ainda sem cálculo segura o selo.
- **As ações** são **Editar** (todas as equipes, Viagem não cancelada), **Cancelar viagem** e **Excluir** (só o Administrativo, Viagem não cancelada) e **Reativar viagem** (só o Administrativo, Viagem cancelada).
- **Cinco blocos**, no alto da ficha e acima das abas, resumem a Viagem: **Contêineres** (cheios distintos de importação, **Vazios a descarregar** com os tipos, **B/Ls**, **IMO / OOG**, **Veículos**); **Carga solta** (toneladas, **B/Ls**, **Máquinas / Packages**, **CBM**, ou "—" quando não há carga solta); **Exportação** (vazios embarcados, **Granito · B/Ls**, **Granito · ton**, **Embarques de vazios**); **Próxima escala** (porto, ETA, **Planejadas**, **Atracação**, **Status**); e **Conciliação** (**CE Mercante** N/M, **Manifestos Mercante** com "N · X a informar" em âmbar, **Divergências EDI × B/Ls**).
- **As abas** são **Visão geral**, **Importação**, **Exportação**, **Rotas e Manifestos** e **ADR**. Na mesma linha ficam os atalhos **Resolver divergências (N)** (quando a Conciliação está Divergente) ou **Baplie EDI**, **B/Ls da viagem** e **Granito** (só com B/L de Granito). As abas Importação e Exportação trazem os totais por porto e a importação rápida no contexto da Viagem: Baplie EDI, B/L container, B/L carga solta, CE Mercante, Veículos e Vazios IMP; Manifesto Granito e Embarque de Vazios (capítulo 6).

### Editar os dados da Viagem

<!-- regras: VIA-015 VIA-017 VIA-013 -->

1. Na ficha, clique em **Editar**. Abre o mesmo formulário do cadastro, com o título **Editar Viagem**.
2. Corrija o que for preciso: navio, IMO, número, **Status** ou a chave de **Chegadas e Saídas**.
3. Clique em **Salvar viagem**. Aparece "Viagem atualizada com sucesso.".

Trocar o navio ou o número passa pela mesma conferência de Viagem repetida do cadastro ([4.1](#41-cadastrar-uma-viagem-nova)). Mudanças de navio, número e status entram sozinhas no Histórico, com o valor anterior e o novo ("Dados da viagem alterados" na Linha do tempo). Ligar a chave **Aparece em Chegadas e Saídas** publica a Viagem na programação e no Portal; desligar tira a Viagem da programação antes do último ATD. A troca vai para o Histórico ("Aparece em Chegadas e Saídas: Não → Sim"). A Viagem cancelada não abre a edição.

### A Linha do tempo

<!-- regras: VIA-027 VIA-134 BLR-069 -->

A **Linha do tempo**, na **Visão geral**, mostra os três eventos mais recentes; **Mostrar todos os N eventos** abre o resto. Cada evento tem **Quando**, **Evento** e **Detalhe**, com o autor embaixo. Entram:

- "Viagem criada", com a origem: botão Nova viagem, Chegadas e Saídas ou planilha;
- as importações de B/L, um evento por arquivo, como "N B/Ls importados · POL → POD" (ou "· N rotas", com cada rota no detalhe), com CNTR ou BB, o Nº de manifesto e o ATD do POL;
- o Baplie, as datas de escala ("ETA alterado · porto" e as outras), terminais e Atracações, CE e Vinculada, Restow, escala adicionada ou removida, omissão e reversão, transbordo complementado, Nº de Manifesto Mercante e "Viagem concluída".

A justificativa digitada na escala aparece como "Justificativa: …". Eventos financeiros não entram.

O evento de importação conta os B/Ls que hoje estão ligados àquele arquivo. O B/L reimportado passa para a importação nova e sai do evento antigo, que fica com o total gravado e o nome do arquivo.

Por trás da Linha do tempo, datas e escalas ficam no Histórico e nunca são apagadas. Cada gravação de ETA, ATA, terminal, Atracação, frente, exportação, BLs e CEs, Vinculada, Nº escala, remoção e omissão é uma linha com autor, setor, momento e justificativa; a tela mostra sempre a mais recente.

::: conferir
<!-- regras: VIA-028 -->
O que você grava atualiza na hora a lista, a ficha, as agendas, o ADR, o Line Up e a Programação no seu computador. Nos computadores das outras pessoas, a tela se atualiza quando é reaberta. O Painel relê o Line Up a cada 90 segundos, e a Tela TV, a cada 30.
:::

<!-- regras: VIA-006 -->

::: aconteceu "Nenhuma viagem neste recorte"
- **O que o sistema faz:** Mostra esta mensagem quando os filtros não deixam nenhuma Viagem. Sem nenhuma Viagem no Vela, aparece "Nenhuma viagem cadastrada".
- **O que você faz:** Clique em **Limpar filtros**. Lembre que **Período** tira do recorte a Viagem com ETA vencido.
:::

::: aconteceu "Não foi possível carregar as viagens"
- **O que o sistema faz:** A falha da lista nunca aparece como lista vazia: aparece esta mensagem com **Tentar novamente**. Se a falha é ao atualizar uma lista já na tela, aparece "Não foi possível atualizar as viagens; a faixa mostra a última lista carregada.".
- **O que você faz:** Clique em **Tentar novamente**. O endereço de uma Viagem que não existe mostra "Viagem não encontrada"; a falha ao abrir a ficha, "Não foi possível abrir esta viagem".
:::

::: aconteceu "Outra pessoa mudou a Viagem e a minha tela não mostra"
- **O que o sistema faz:** As telas não se sincronizam entre as pessoas.
- **O que você faz:** Abra a Viagem de novo. Antes de salvar uma escala, abra a janela de novo se alguém pode ter mexido nela ([4.3](#43-atribuir-os-terminais-e-registrar-a-atracação)).
:::

::: porque
A Conciliação diz o que falta de documento para a operação andar; ela não libera nada no financeiro. E a Linha do tempo mostra só o que aconteceu na operação, para a ficha da Viagem contar a história do navio.
:::

## 4.6 Conferir o ATD do porto de embarque e o Nº de Manifesto da rota

<!-- regras: VIA-053 VIA-054 CEB-043 CEB-044 CEB-002 -->

A aba **Rotas e Manifestos** mostra cada rota dos B/Ls da Viagem, do **POL** (porto de embarque) ao **POD** (porto de descarga). Cada rota tem o **ATD do POL**, a data em que o navio saiu do porto de embarque, e o **Nº de Manifesto Mercante**. Não existe outra tela de Manifesto: o número se informa aqui, e o B/L muda de Manifesto aqui ou na ficha dele.

::: ficha
- **Quando usar:** Você precisa conferir quando a carga saiu do porto de embarque, corrigir esse ATD ou informar o Nº de Manifesto Mercante de uma rota.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Os B/Ls da Viagem precisam estar importados (capítulo 6). Tenha o número de 13 caracteres do Manifesto Mercante.
:::

### Os botões de cada rota

Na ficha da Viagem, abra a aba **Rotas e Manifestos**. Cada rota tem botões de ícone, com o nome ao passar o mouse:

::: passos
1. **Ver B/Ls** ("Ver B/Ls: mover ou desvincular de Manifesto Mercante") abre os B/Ls da rota, para mover ou desvincular de Manifesto.
2. O lápis **Editar ETD previsto + ATD POL e Nº de Manifesto Mercante** abre a janela da rota que já tem número.
3. **Informar Nº de Manifesto Mercante** aparece na rota ainda sem número e abre a mesma janela.
:::

::: tela rotas-manifestos
Rotas da viagem: Ver B/Ls, o lápis Editar e Informar Nº de Manifesto Mercante.
:::

### Corrigir o ATD ou informar o número

Abra a janela **Editar ETD + ATD e Nº de Manifesto Mercante** pelo lápis ou por **Informar Nº de Manifesto Mercante**. Na rota de vazios, a janela se chama **Manifesto de Vazios · Nº de Manifesto Mercante**.

::: lado
1. Em **ATD**, digite a data certa da saída do navio no POL (só data, sem hora). Para voltar ao ATD calculado pelos B/Ls, apague a data. Para informar o número, digite em **Nº do manifesto** os 13 caracteres (por exemplo, 1326502400017).
2. Clique em **Salvar**. Aparece "Manifesto atualizado com sucesso.".

::: tela editar-rota
A janela da rota CNSHA → BRVIX com ETD, ATD e Nº do manifesto.
:::
:::

### Mover ou desvincular B/Ls de um Manifesto

<!-- regras: CEB-048 CEB-049 CEB-050 CEB-098 -->

1. Na rota, clique em **Ver B/Ls**. A janela **B/Ls da rota CNSHA → BRVIX** abre (só rotas com B/L de carga).
2. Marque os B/Ls. Você pode buscar por B/L ou Manifesto, usar **Selecionar todos os filtrados**, segurar Shift para marcar um intervalo ou usar **Colar lista de B/Ls** ("Fora desta rota ou cancelados: …" lista o que não casou). B/L cancelado aparece "(cancelado)" e não se marca.
3. Para mover, digite o número em **Mover para o Nº de Manifesto Mercante**. A janela diz "Será gravado como X." ou "O número tem 13 caracteres, letras ou dígitos.". Clique em **Mover (N)**, que só fica ativo com número válido e B/L marcado. Para deixar os B/Ls sem Manifesto, clique em **Desvincular**.
4. Na confirmação, **Mover B/Ls de Manifesto Mercante** ("N B/L(s) sairão de … e irão para X", com a lista) ou **Desvincular B/Ls do Manifesto Mercante** ("…ficarão sem Manifesto"), escreva o motivo e confirme.

Na ficha do B/L, as mesmas ações se chamam **Mover para outro Manifesto Mercante** e **Desvincular do Manifesto Mercante** (capítulo 7).

::: sozinho
<!-- regras: VIA-055 VIA-056 BLR-044 BLR-148 CEB-042 CEB-045 CEB-047 CEB-049 CEB-050 CEB-056 EQU-066 -->
- **Calcula o ATD do POL:** é o menor **Laden on Board** (a data de embarque do B/L) dos B/Ls ativos da Viagem com aquele POL. Grafias do mesmo porto contam juntas, e B/L cancelado não conta. Importar, cancelar, reativar ou excluir um B/L recalcula, com a razão no Histórico ("ATD recalculado: B/L … cancelado…"). Mudar o POL de um B/L não recalcula na hora.
- **Respeita a correção à mão:** o ATD digitado em **Editar** vence. Daí em diante, nem importação nem cancelamento de B/L mudam o ATD daquele POL, e a saída confirmada em Chegadas e Saídas deixa de valer. A prévia do arquivo de B/L avisa: "ATD do POL … corrigido à mão em …: o Laden on Board do arquivo é … e o ATD não muda.". Apagar o ATD em **Editar** é o único jeito de desfazer: ele volta na hora ao calculado ("ATD manual apagado: volta a valer o menor Laden on Board…").
- **Não mexe na escala:** o ATD do POL é registro da rota. Ele não preenche nem muda as datas da escala, da Atracação, o status da Viagem nem o prazo do ADR.
- **Ao excluir um B/L** (Administrativo, capítulo 7): registra a exclusão, com o motivo, no histórico da Viagem; recalcula o ATD do POL só com os B/Ls que ficaram (o corrigido à mão não muda); anula e apaga o valor a receber do B/L ainda sem fatura e sem baixa; apaga os alertas e o preço fixado dele; descarta os passos pós-importação dele que não têm alerta; e o tira da fila de B/Ls sem tabela de cobrança.
- **Ao salvar a janela da rota:** grava primeiro ETD e ATD e depois o Nº da rota, que cadastra o Manifesto de carga ou de vazio. Copia o número nos arquivos importados da rota; essa cópia só aceita número já cadastrado numa rota da mesma Viagem e só sai quando a rota não tem mais número. A mudança fica no Histórico ("Atualizacao manual de CE Master").
- **Um número por rota:** o Nº de Manifesto Mercante é único no Vela todo e pertence a uma Viagem, a um par POL → POD e a uma natureza, **carga** ou **vazio**. Cada rota tem um só Nº "da rota". O primeiro Manifesto cadastrado por qualquer caminho (planilha, vazios, **Mover**) vira esse número, se a rota ainda não tinha. Trocar o número da rota sem B/L no Manifesto antigo apaga o antigo, e a troca vai para o Histórico da Viagem ("Nº de Manifesto Mercante por rota").
- **Mover e Desvincular:** são tudo ou nada, até 2.000 B/Ls da mesma Viagem e rota, com POL e POD. Mover cadastra o número na rota se ele for novo. O Histórico de cada B/L registra o Manifesto antes e depois, com o motivo. O CE Mercante não muda. Desvincular deixa os B/Ls sem Manifesto, mas o Manifesto continua cadastrado: a rota segue mostrando o número (não volta a **A informar**), e ele só sai pela janela da rota, quando é o número da rota e já não tem B/L.
- **Vazios:** os vazios de importação também têm Nº de Manifesto, de natureza vazio, por rota. Ele vem da planilha de Vazios IMP, que confere as rotas e os números e recusa número já cadastrado em outra rota ou Viagem, ou de **Informar** na rota de vazios. Os vazios cadastrados a partir do Baplie entram sem número: a rota fica **A informar** e conta no alerta **CE Mercante pendente** até o número ser informado.
:::

::: conferir
<!-- regras: VIA-053 CEB-043 -->
O bloco **Rotas da viagem** tem uma linha por rota POL → POD dos B/Ls e uma linha VAZIOS por rota de vazios:

- **Rota**: o nome do porto aparece ao passar o mouse. O link da rota abre BLs (ou Vazios IMP) já filtrados.
- **Carga**: CNTR, CNTR/BB, BB ou VAZIOS.
- **ATD no POL**: o ETD previsto em cinza enquanto não há ATD.
- **B/Ls**: nos vazios, "N cntr".
- **CE Mercante**: "2 de 2", em âmbar quando falta.
- **Nº de manifesto Mercante**: "A informar" em âmbar quando a rota tem B/L (ou vazios) sem número. O alto do bloco conta "N manifestos a informar".

Com omissão de escala, a rota mostra o porto omitido riscado ([4.7](#47-registrar-que-o-armador-omitiu-uma-escala)). Sem rota, aparece "Nenhuma rota de B/L identificada nesta viagem.". Na Viagem cancelada, os botões ficam desabilitados.
:::

<!-- regras: VIA-055 VIA-056 BLR-044 -->

::: aconteceu "O ATD do porto de embarque está errado"
- **O que o sistema faz:** O ATD do POL é o menor Laden on Board dos B/Ls ativos daquele porto e muda quando B/Ls entram, saem ou são cancelados.
- **O que você faz:** Corrija em **Rotas e Manifestos**, no lápis da rota (ou em **Informar Nº de Manifesto Mercante**, se a rota ainda não tem número). O ATD digitado vence o calculado e a saída confirmada em Chegadas e Saídas. Apagar o ATD digitado volta ao calculado.
:::

<!-- regras: VIA-054 CEB-044 -->

::: aconteceu "Falha ao salvar o manifesto."
- **O que o sistema faz:** Datas e número são gravados em sequência. Se o número é recusado, o ETD e o ATD já ficaram gravados. A recusa aparece com o próprio motivo.
- **O que você faz:** Confira o ATD na rota e corrija só o número.
:::

<!-- regras: CEB-042 CEB-045 CEB-046 -->

::: aconteceu "O número de Manifesto foi recusado"
- **O que o sistema faz:** Recusa número que não tem 13 letras ou dígitos e número já cadastrado em outra rota ou Viagem. Trocar ou apagar o número da rota é recusado enquanto o Manifesto antigo tem B/L. Informar o número espera terminar a planilha de CE da mesma Viagem (uma importação por Viagem de cada vez). Se duas gravações cadastram o mesmo número ao mesmo tempo, a segunda recebe "O Manifesto Mercante … foi cadastrado por outra gravação ao mesmo tempo; confira e grave de novo.".
- **O que você faz:** Confira o número. Para trocar o número de uma rota com B/L, use antes **Ver B/Ls** → **Mover** ou **Desvincular**. Na gravação simultânea, confira a aba e grave de novo.
:::

<!-- regras: CEB-049 CEB-051 -->

::: aconteceu "B/L sem CE Mercante não entra em Manifesto: …"
- **O que o sistema faz:** Recusa mover para um Manifesto o B/L sem CE. Se outra pessoa mudou o Manifesto de algum B/L depois que você abriu a janela, recusa a operação inteira ("O Manifesto Mercante mudou depois da tela") e recarrega a lista e a ficha.
- **Por quê:** O CE entra pela planilha de CE Mercante, que também vincula o Manifesto (capítulo 6). Mover e Desvincular são tudo ou nada.
- **O que você faz:** Importe o CE do B/L pela planilha. No conflito, confira a lista e repita.
:::

<!-- regras: CEB-002 -->

::: aconteceu "Não acho a tela de Manifestos"
- **O que o sistema faz:** Não existe tela própria de Manifesto. O endereço antigo de manifestos leva sempre à lista **BLs**, sem manter filtros. O alerta **Portal do Cliente — exceção de fatura** ainda usa esse endereço antigo: sem B/L, abre a lista BLs; com B/L, abre a aba Faturamento da ficha.
- **O que você faz:** Informe o número em **Viagens** › ficha da Viagem › **Rotas e Manifestos**. Para mudar o Manifesto de um B/L, use **Ver B/Ls** ou a ficha do B/L.
:::

::: porque
O ATD do POL e o Manifesto Mercante são registros do documento de embarque, por rota. Por isso ficam na aba de rotas, separados das datas de chegada e de berço das escalas. O Laden on Board de cada B/L diz quando a carga embarcou; a correção à mão existe para quando o arquivo não conta a saída certa.
:::

## 4.7 Registrar que o armador omitiu uma escala

<!-- regras: VIA-057 VIA-058 ACE-085 -->

A **omissão de escala** acontece quando o armador não faz a escala prevista e a carga daquele porto é descarregada em outro porto da mesma Viagem, o **Porto de Transbordo**. Dali a carga segue em **transbordo** (em outro navio, até o destino original) ou recebe **COD** (o destino final muda para o Porto de Transbordo, [4.8](#48-mudar-o-destino-de-um-bl-afetado-cod-ou-voltar-ao-transbordo)). Omitir não é excluir: a escala omitida continua na Viagem, marcada **Omitida**.

::: ficha
- **Quando usar:** O armador avisou que não vai fazer uma escala e descarregou (ou vai descarregar) a carga em outro porto da Viagem.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** O Porto de Transbordo precisa ser outra escala da Viagem: se não está no planejamento, adicione-o antes ([4.2](#42-planejar-as-escalas-da-viagem)). Os dados do navio de transbordo podem ficar para depois.
:::

::: passos
1. Na ficha da Viagem, no **Planejamento por escala**, clique no lápis **Editar** da escala que o armador omitiu (no exemplo, BRSSA).
2. Na janela **Editar escala**, clique em **Omitir escala**. Abre a janela "Omitir escala de BRSSA".
:::

::: lado
3. Em **Porto de Transbordo**, escolha o porto onde a carga foi descarregada (no exemplo, BRVIX). Só aparecem as outras escalas da Viagem não omitidas; o porto omitido nunca aparece.
4. Em **Dados de transbordo (complete quando conhecidos)**, preencha o que já souber: **Navio de Transbordo**, **Armador de Transbordo**, **Viagem de Transbordo**, **ETD de Transbordo** e **ETA de Transbordo**. O que faltar pode ser completado depois.
5. Em **Motivo (opcional)**, escreva por que o armador omitiu a escala.
6. Clique em **Omitir escala**. Abre a confirmação com o resumo.

::: tela omitir-escala
A janela Omitir escala de BRSSA, com Vitória como Porto de Transbordo.
:::
:::

::: lado
7. Confira o resumo e abra **Ver B/Ls afetados (N)**: são os B/Ls cujo POD é exatamente o porto omitido. Clique em **Confirmar omissão**.

::: tela omitir-confirmar
A confirmação da omissão, com o aviso de que qualquer setor pode reverter.
:::
:::

A confirmação avisa: "Qualquer setor pode reverter a omissão, com justificativa; a reversão mantém o histórico da omissão e também notifica os clientes.". Se o Vela recusa, o motivo aparece na própria janela, que fica aberta ([4.12](#412-situações-comuns)); sem motivo legível, aparece "Falha ao omitir a escala. Tente novamente.".

::: sozinho
<!-- regras: VIA-059 VIA-060 VIA-131 VIA-053 POR-083 -->
- Marca a escala como omitida no Histórico ("Escala omitida pelo armador; carga descarregada em …") e guarda os dados de transbordo, tudo na mesma gravação.
- Põe cada B/L afetado em **Transbordo**. O destino final e a Taxa Local não mudam; o CE Mercante e a Demurrage seguem como estão.
- Avisa no Portal cada Cliente vinculado a um B/L afetado, com a notificação "Escala omitida": "A escala de … foi omitida. A carga do B/L … foi descarregada em … e seguira em transbordo para …" (sem acento, como o sistema grava). No Portal, o B/L passa a mostrar **Informações de Transbordo** ("Escala de BRSSA omitida · Porto de Transbordo — BRVIX", com Navio, Armador, Viagem, ETD e ETA), sem o motivo interno.
- Tira a escala omitida da Próxima escala, do status da Viagem, do prazo e dos alertas do ADR, dos alertas de data e dos Comunicados de chegada. Refaz na hora as contas da Próxima escala, dos alertas de data, de exportação e do ADR, dos prazos D−7 e D−5 e da régua de Comunicados. Se era a última escala pendente, a Viagem fica **Concluída** ([4.9](#49-concluir-a-viagem)).
- Mantém a escala no Line Up, na Tela TV e na programação como **Omitida**, que é diferente de "—" (data não informada). Na aba **ADR**, a escala omitida só aparece se já tem ADR fechado, com o selo "Omitida".
- Mostra a rota de transbordo em **Rotas e Manifestos** como CNSHA → ~~BRSSA~~ (Omitida) → BRVIX (Transbordo) → BRSSA (Destino Final): só o código omitido fica riscado.
:::

::: conferir
<!-- regras: VIA-063 BLR-081 -->
- No **Planejamento por escala**, o porto aparece com "Omitida" em âmbar.
- Na **Visão geral**, o cartão **Informações de Transbordo** mostra o porto omitido e o Porto de Transbordo, com navio, armador, viagem, ETD, ETA e o motivo da omissão ("—" quando desconhecido).
- Na ficha de cada B/L afetado, a **Visão geral** ganha o cartão **Transbordo**, que explica o porto omitido ([4.8](#48-mudar-o-destino-de-um-bl-afetado-cod-ou-voltar-ao-transbordo)).
- A **Linha do tempo** da Viagem registra a omissão.
:::

<!-- regras: VIA-058 -->

::: aconteceu "Nenhuma outra escala brasileira nesta viagem. Cadastre antes a escala onde a carga será descarregada."
- **O que o sistema faz:** A janela não deixa omitir a única escala brasileira cadastrada. O Vela também recusa o porto omitido como Porto de Transbordo ("O Porto de Transbordo precisa ser outro porto da viagem, não o porto omitido. Cadastre antes a escala onde a carga será descarregada.").
- **Por quê:** O Porto de Transbordo é outra escala da mesma Viagem.
- **O que você faz:** Clique em **Adicionar escala** com o porto onde a carga desce ([4.2](#42-planejar-as-escalas-da-viagem)) e omita depois.
:::

<!-- regras: VIA-057 VIA-061 -->

::: aconteceu "Não aparece o botão Omitir escala"
- **O que o sistema faz:** **Omitir escala** só aparece na escala com importação, ainda não omitida, de Viagem não cancelada. Omitir de novo um porto com a omissão ainda valendo é recusado ("A escala da viagem … ja foi omitida para o POD …").
- **O que você faz:** Confira se a escala tem importação e se já está **Omitida**. Depois de revertida, a omissão fica no histórico e o porto pode ser omitido de novo.
:::

<!-- regras: VIA-064 ACE-086 -->

::: aconteceu "Omiti a escala por engano"
- **O que o sistema faz:** **Reverter omissão** desfaz a omissão. Qualquer equipe reverte, com justificativa obrigatória. A janela **Reverter omissão de escala** avisa: "Esta ação reverte a omissão para N B/L(s); a omissão e o transbordo ficam no histórico. Clientes com link a um B/L afetado serão notificados da correção.". Revertida, a escala volta a contar para a Próxima escala, para o status da Viagem (recalculado na hora) e para o ADR. Os B/Ls deixam de mostrar o transbordo, o Histórico registra a reversão e cada Cliente vinculado recebe no Portal "Correção de omissão de escala". A reversão é recusada se algum B/L afetado está em COD ("Nao e possivel reverter a omissao: N B/L(s) afetado(s) estao em COD."; a janela mostra essa recusa seguida de "Verifique se algum B/L está em COD.").
- **Por quê:** A reversão corrige o registro, mas a omissão e o transbordo ficam no histórico, e o Cliente é avisado da correção.
- **O que você faz:** Se algum B/L está em COD, reverta antes o COD de cada um ([4.8](#48-mudar-o-destino-de-um-bl-afetado-cod-ou-voltar-ao-transbordo)). Depois, no cartão **Informações de Transbordo**, clique em **Reverter omissão**, escreva a **Justificativa** e confirme em **Reverter omissão**.
:::

<!-- regras: VIA-063 -->

::: aconteceu "Os dados do navio de transbordo chegaram depois"
- **O que o sistema faz:** **Complementar**, no cartão **Informações de Transbordo**, edita navio, armador, viagem, ETD, ETA e motivo para todos os B/Ls afetados de uma vez, com confirmação. Sem mudança, não grava nada; motivo vazio mantém o anterior. Cada complementação entra no Histórico da Viagem e dos B/Ls ("Informações de Transbordo complementadas"), e o Portal passa a mostrar os dados novos, sem nova notificação.
- **O que você faz:** Clique em **Complementar**, preencha os dados e clique em **Salvar informações**. Na confirmação, clique em **Salvar informações** de novo.
:::

<!-- regras: VIA-062 BLR-045 -->

::: aconteceu "Um B/L foi importado depois da omissão"
- **O que o sistema faz:** O B/L novo com POD no porto omitido entra sozinho como afetado, em **Transbordo**. A prévia da importação avisa, e o Histórico do B/L registra "B/L importado depois da omissão de …: afetado, disposição Transbordo".
- **O que você faz:** Nada. Se o Cliente desse B/L vai retirar a carga no Porto de Transbordo, marque o COD ([4.8](#48-mudar-o-destino-de-um-bl-afetado-cod-ou-voltar-ao-transbordo)).
:::

::: porque
A omissão é um fato do armador, e não um erro de planejamento. Por isso a escala não some: ela continua na Viagem marcada **Omitida**, e o Cliente vê no Portal o que aconteceu com a carga dele. Excluir ([4.11](#411-excluir-uma-escala-do-planejamento)) é só para a escala cadastrada por engano.
:::

## 4.8 Mudar o destino de um B/L afetado (COD) ou voltar ao transbordo

<!-- regras: FAT-136 BLR-081 VIA-065 VIA-066 -->

No **transbordo**, a carga segue até o destino original e nada muda na cobrança. No **COD** (Change of Destination), o Cliente retira a carga no Porto de Transbordo: o destino final do B/L muda para esse porto e a Taxa Local é recalculada pela tabela de cobrança do novo porto. O COD é marcado B/L a B/L.

::: ficha
- **Quando usar:** A escala foi omitida ([4.7](#47-registrar-que-o-armador-omitiu-uma-escala)) e o Cliente de um B/L afetado vai retirar a carga no Porto de Transbordo; ou o COD foi marcado por engano.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Abra a ficha do B/L afetado (no exemplo, COSU6424000102).
:::

Na **Visão geral** do B/L afetado, o cartão **Transbordo** diz "Segue em transbordo até …; o destino final e a Taxa Local não mudam." e traz o link **Registro global da omissão**, que leva à Viagem. Os dados do seguimento ficam só para consulta ("A informar" quando faltam).

::: passos
1. No cartão **Transbordo**, clique em **Marcar COD**.
:::

::: tela bl-transbordo
O cartão Transbordo na ficha do B/L afetado.
:::

::: lado
2. Leia os avisos da janela **Marcar COD** e escreva o motivo em **Justificativa**. Ela é obrigatória.
3. Clique em **Confirmar COD**. O cartão passa a se chamar **COD para BRVIX** e diz "Destino final alterado para BRVIX: a Taxa Local foi recalculada nesse porto.".

::: tela marcar-cod
A janela Marcar COD com a justificativa.
:::
:::

::: sozinho
<!-- regras: FAT-136 FAT-137 VIA-066 VIA-067 VIA-069 POR-083 BLR-045 FAT-135 -->
- Muda o POD do B/L para o Porto de Transbordo e recalcula a Taxa Local no novo destino. O transbordo nunca recalcula.
- B/L ainda não faturado é recalculado sem ajuste. Se tem lançamento manual de cobrança, abre um ajuste **Revisão manual de cobrança** para o Financeiro.
- B/L já faturado abre um **Ajuste de COD**, com o valor original (o do documento emitido; com a individual coberta, o da consolidada), o valor no destino (dólar pelo câmbio fixado), a diferença, o pago e o saldo. Sem diferença, não há ajuste. Os caminhos são: sem pagamento, **Reemissão automática**; com pagamento e valor maior, **Fatura complementar**; com pagamento e valor menor, **Abater saldo aberto** ou, se passar do saldo, **Restituição por excedente**. A liquidação do ajuste é do {{Financeiro}} (capítulo 24).
- Tira o B/L do Manifesto Mercante do porto omitido (ele fica "Sem Manifesto"). O CE Mercante não muda: o bloco **Documento Mercante** da ficha diz "não muda com COD".
- Limpa a exceção de terminal do B/L, com registro no Histórico do B/L.
- Avisa o Cliente vinculado no Portal ("Destino alterado (COD)"). No Portal, o B/L mostra "Destino alterado para BRVIX (COD)" com "Sua carga não seguirá em transbordo.", sem o motivo interno e sem dados de navio.
- Mostra a rota em **Rotas e Manifestos** como CNSHA → ~~BRSSA~~ (Omitida) → BRVIX (Destino Final).
- Mantém o destino do COD (e o terminal) quando o arquivo de B/L é reimportado. A prévia avisa: "B/L em COD: o POD continua … (o arquivo traz …); os demais campos atualizam.". Já a correção do POD pelo arquivo, num B/L sem COD, tira a exceção de terminal do POD anterior e desvincula o Manifesto Mercante.
- Repetir o mesmo COD não faz nada.
:::

::: conferir
Na **Visão geral** da ficha do B/L, ao lado dos blocos **Embarque** (Viagem, armador, trecho e terminal de descarga), **Cliente**, **Carga** e **Portal**, ficam o cartão **COD para BRVIX** e o bloco **Documento Mercante** (o CE do B/L, "não muda com COD", e "Sem vínculo com Manifesto Mercante"). Na ficha da Viagem, a rota do COD em **Rotas e Manifestos**. Se o B/L já estava faturado, o Ajuste de COD fica com o Financeiro (capítulo 24).
:::

<!-- regras: VIA-145 CEB-099 -->

::: aconteceu "Taxas alteradas à mão serão afetadas"
- **O que o sistema faz:** Se o B/L tem taxa alterada à mão que o novo POD descarta, depois da confirmação abre este diálogo. **Gravar mesmo assim** marca o COD; **Voltar** não marca nada. **Reverter para transbordo**, que devolve o POD original, faz a mesma pergunta.
- **Por quê:** A taxa alterada à mão é decisão de alguém; o Vela não a descarta sem perguntar. A mesma pergunta aparece na prévia do arquivo de B/L, do Manifesto BB e do Baplie, na seção **Taxas alteradas à mão**, quando a importação descarta ou muda uma taxa alterada à mão; recusar não grava nada ("Importação cancelada antes de gravar: nada foi alterado.", capítulo 6).
- **O que você faz:** Confira a taxa com quem a alterou. Se o COD é certo, clique em **Gravar mesmo assim**.
:::

<!-- regras: VIA-068 -->

::: aconteceu "Marquei o COD por engano"
- **O que o sistema faz:** **Reverter para transbordo**, no cartão **COD para …**, devolve o POD original, desfaz o efeito financeiro do COD e avisa o Cliente no Portal ("Correção de destino (COD)"). A justificativa é obrigatória.
- **O que você faz:** Clique em **Reverter para transbordo**. Na janela **Reverter COD para transbordo**, escreva a **Justificativa** e clique em **Confirmar reversão**.
:::

<!-- regras: VIA-068 CEB-049 -->

::: aconteceu "Reverti o COD e o B/L ficou sem Manifesto"
- **O que o sistema faz:** O POD original volta, mas o vínculo com o Manifesto Mercante, limpo no COD, não volta sozinho.
- **O que você faz:** Em **Rotas e Manifestos** › **Ver B/Ls**, mova o B/L para o Manifesto da rota ([4.6](#46-conferir-o-atd-do-porto-de-embarque-e-o-nº-de-manifesto-da-rota)).
:::

<!-- regras: VIA-067 -->

::: aconteceu "Cambio (ROE) nao configurado; nao e possivel reprecificar linhas em USD."
- **O que o sistema faz:** Recusa o COD (ou a reversão) de B/L com taxa em dólar sem câmbio fixado. No B/L ainda não faturado, a mensagem termina em "calcular linhas em USD.".
- **O que você faz:** Peça ao {{Financeiro}} para registrar o câmbio e tente de novo.
:::

::: porque
O transbordo preserva o destino que o Cliente contratou, então a cobrança não muda. O COD muda esse destino, e por isso a Taxa Local passa a ser a do porto onde a carga é retirada. A decisão é por B/L porque cada Cliente pode escolher um caminho diferente para a mesma omissão.
:::

## 4.9 Concluir a Viagem

<!-- regras: VIA-016 VIA-019 -->

Na maioria das vezes, você não conclui a Viagem: o Vela conclui sozinho quando o navio sai do último terminal. A Viagem passa a **Concluída** quando toda escala gravada e ativa (não omitida, não excluída) tem pelo menos uma Atracação e todas as Atracações têm ATD.

::: ficha
- **Quando usar:** A Viagem terminou e precisa sair da programação antes de todas as Atracações terem ATD.
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** Confira se não falta registrar uma escala ou um ATD: salvar a escala recalcula o status e pode voltar a Viagem a Ativa.
:::

::: passos
1. Na ficha da Viagem, clique em **Editar**.
2. Em **Status**, escolha **Concluida**.
3. Clique em **Salvar viagem**.
:::

::: sozinho
<!-- regras: VIA-019 VIA-130 VIA-131 -->
- Recalcula o status ao clicar em **Salvar escala**, ao omitir, excluir ou reverter a omissão de uma escala, ao gravar de novo um porto removido e ao reativar a Viagem. Omitir ou excluir a última escala pendente conclui a Viagem; reverter a omissão a reabre.
- Segura a Viagem como **Ativa** enquanto alguma escala não tem Atracação, ou tem Atracação sem ATD. Enquanto alguma frente está em TBC, a Atracação **TBC** também segura; quando nenhuma frente fica em TBC, ela sai e deixa de segurar. A Viagem sem nenhuma escala gravada não muda.
- Não recalcula na hora ao confirmar data em Chegadas e Saídas nem ao importar a planilha de programação.
- Nunca muda o status da Viagem cancelada.
- Concluída, a Viagem sai da programação de Chegadas e Saídas e do Portal e some do Line Up no filtro padrão (Ativas). A Linha do tempo registra "Viagem concluída".
:::

::: conferir
O selo **Concluída** (verde) no topo da ficha e o filtro **Status** › **Concluídas** na lista de Viagens.
:::

<!-- regras: VIA-016 VIA-019 VIA-131 -->

::: aconteceu "A Viagem ficou Concluída sozinha (ou voltou a Ativa)"
- **O que o sistema faz:** Conclui a Viagem, ao salvar a escala, quando toda escala ativa tem Atracação com ATD. Omitir ou excluir a última escala pendente também conclui; reverter a omissão reabre. A Viagem concluída à mão volta a Ativa na próxima gravação de escala, se ainda falta ATD.
- **O que você faz:** Se concluiu antes da hora, confira se falta registrar uma escala ou uma Atracação. Salvar a escala recalcula.
:::

::: porque
O fim da Viagem é o fim da operação nos terminais. Por isso quem decide é o ATD de cada Atracação, e não uma data digitada. A conclusão à mão serve para tirar a Viagem da programação quando o registro do porto não vai chegar.
:::

## 4.10 Cancelar, reativar ou excluir uma Viagem

<!-- regras: ACE-087 VIA-020 VIA-012 -->

**Cancelar** é para a Viagem que o armador não vai realizar: ela fica no Vela, somente leitura, com tudo o que tinha. **Reativar** desfaz um cancelamento. **Excluir** apaga a Viagem criada por engano, sem nada oficial. A Viagem não se cancela pela edição: o status **Cancelada** não se escolhe no formulário.

::: ficha
- **Quando usar:** O armador cancelou a viagem; o cancelamento foi engano; ou a Viagem foi cadastrada por engano.
- **Quem faz:** {{Administrativo}}
- **Antes de começar:** Para cancelar, nenhum B/L da Viagem pode ter fatura viva ou baixa: o {{Financeiro}} ou o {{Administrativo}} resolve antes, B/L a B/L.
:::

### Cancelar

Na ficha da Viagem, clique em **Cancelar viagem**. A janela explica que a Viagem fica Cancelada e somente leitura, mantida com os vínculos, e sai do Line Up e da Programação do Portal.

::: lado
1. Em **Motivo do cancelamento**, escreva o motivo. Ele é obrigatório: sem ele, o botão fica desabilitado.
2. Clique em **Cancelar viagem**. Aparece "Viagem cancelada com sucesso.".

::: tela cancelar-viagem
A janela Cancelar viagem, com o motivo obrigatório.
:::
:::

### Reativar

<!-- regras: VIA-024 -->

1. Na ficha da Viagem cancelada, clique em **Reativar viagem**.
2. Escreva o motivo. A janela avisa que a Viagem volta a ativa, deixa de ser somente leitura e reaparece no Line Up e na Programação do Portal, se publicada.
3. Confirme em **Reativar viagem**.

### Excluir

<!-- regras: VIA-025 -->

1. Na ficha da Viagem, clique em **Excluir**. O Vela calcula primeiro o que vai junto e confere as travas.
2. Sem trava, a janela **Excluir viagem** lista o que vai junto ("Vão junto com a viagem:" contêineres, B/Ls, veículos, Manifestos Mercante, Baplie, ADRs em aberto, vazios, omissões, Atracações, frentes, exportação, alertas e o resto). Os manifestos de Granito não vão: só ficam sem Viagem.
3. Escreva o motivo e confirme em **Excluir viagem**. Aparece "Viagem excluída." e a tela volta à lista.

::: sozinho
<!-- regras: VIA-022 VIA-024 VIA-026 DEM-009 ALE-046 ALE-085 -->
**Ao cancelar:**

- Registra "Cancelamento de viagem: motivo" no Histórico.
- Anula os valores a receber dos B/Ls que ainda não tinham fatura nem baixa, com registro no Histórico do B/L.
- Encerra os efeitos de importação pendentes da Viagem.
- Fecha os alertas abertos da Viagem, das escalas e dos terminais, inclusive NOA, NOR, NOB e B/L sem Cliente perto do ETA.
- Tira os B/Ls da fila "sem tabela de cobrança".
- Para a Demurrage: refaz na hora a situação dos containers ainda não devolvidos, e o container de Viagem cancelada fica "no prazo".
- Tira a Viagem do Line Up do Painel e da Tela TV na próxima leitura.
- Não fecha os alertas do ADR das Atracações (**ADR — prazo vencido** e **ADR — departamento pendente**). A rodada de 15 minutos continua conferindo o ADR aberto, que fica somente leitura: ninguém consegue assinar nem fechar. Esses alertas só saem com a exclusão da Viagem.

**Ao reativar:**

- Registra "Reativação de viagem: motivo" no Histórico.
- Recalcula o status pelas Atracações: a Viagem pode voltar já **Concluída**.
- Devolve à fila os efeitos de importação que o cancelamento encerrou, salvo os já substituídos por um mais novo.
- Recalcula os alertas e a Demurrage dos containers ainda não devolvidos, que volta a contar.

**Ao excluir:**

- Apaga a Viagem e tudo o que é dela de uma vez, ou nada. Não se desfaz pelo sistema; os registros apagados ficam guardados na auditoria.
- Tira a Viagem do Line Up e da Programação do Portal.
- Apaga os alertas dela e os itens de outros alertas que digam respeito a ela, inclusive os do ADR. A prévia da exclusão conta esses alertas.
:::

::: conferir
O selo **Cancelada** (vermelho) no topo da ficha, com **Reativar viagem**; na lista, a Viagem cancelada aparece esmaecida. Depois de excluída, a Viagem não aparece mais na lista.
:::

<!-- regras: VIA-021 FAT-156 DEM-118 -->

::: aconteceu "A Viagem tem fatura viva ou baixa: B/L (fatura …). Resolva cada B/L antes de cancelar a Viagem."
- **O que o sistema faz:** Recusa cancelar a Viagem enquanto algum B/L dela tem fatura viva (Taxas Locais ou avulsa, inclusive paga ou coberta), Invoice de Demurrage emitida ou paga, não cancelada ("… Invoice de Demurrage DEM-…"), ou baixa.
- **Por quê:** Cancelar uma fatura não cancela o B/L, não devolve dinheiro e não apaga o documento, que fica preservado com o motivo. A Viagem só se cancela limpa.
- **O que você faz:** O {{Financeiro}} ou o {{Administrativo}} resolve B/L a B/L: cancelar a fatura, cancelar a baixa ou fazer a Restituição (capítulos 22 a 24). Depois, o Administrativo cancela a Viagem.
:::

<!-- regras: VIA-025 VIA-026 -->

::: aconteceu "A viagem NAVIO / N não pode ser excluída: motivos. Corrija ou cancele."
- **O que o sistema faz:** Recusa antes de abrir a janela, com o motivo: B/L com CE Mercante, documento financeiro emitido, ADR de Saída fechado, Granito com CE Mercante ou faturado, ou comunicado enviado ao Cliente. A Viagem cancelada fica retida e não se exclui. Se sobra algum dado ligado à Viagem fora da lista do que vai junto, o Vela recusa: "Viagem N nao pode ser excluida: ha dados vinculados em …".
- **Por quê:** Excluir é para a Viagem criada por engano, sem nada oficial.
- **O que você faz:** Cancele a Viagem em vez de excluir.
:::

<!-- regras: VIA-023 VIA-051 VIA-099 VIA-142 EQU-123 FAT-030 FAT-157 -->

::: aconteceu "Viagem N cancelada: operação selada e somente leitura."
- **O que o sistema faz:** Na Viagem cancelada, tudo fica somente leitura: escalas e datas, Atracações, frentes, exportação, omissão, B/Ls e carga, containers, veículos, Granito, Vazios e Embarque de vazios, Manifestos Mercante, ADR de Saída, faturas e Comunicados novos. A escala diz "Viagem N cancelada: escala somente leitura." e o ADR, "Viagem N cancelada: ADR somente leitura.". A ficha esconde **Editar**, **Adicionar escala**, os lápis, **Omitir escala**, **Excluir escala**, a importação rápida e as ações do ADR. O cartão **Informações de Transbordo** ainda mostra **Complementar** e **Reverter omissão**, mas o Vela recusa.
- **Por quê:** A Viagem cancelada é guardada como estava. Só continuam o recálculo automático do status de Demurrage e da cobrança do Granito e a situação financeira do B/L. Nenhuma fatura nova nasce; só pode restar viva a fatura avulsa ligada apenas à Viagem, sem B/L, e ela se cancela normalmente.
- **O que você faz:** Se o cancelamento foi engano, o Administrativo usa **Reativar viagem**, com motivo.
:::

<!-- regras: VIA-020 VIA-024 -->

::: aconteceu "Somente o Administrativo cancela viagem."
- **O que o sistema faz:** Para as outras equipes, **Cancelar viagem** e **Reativar viagem** não aparecem na ficha; se o pedido chega ao Vela por outra equipe, ele recusa com esta mensagem. A reativação também é só do Administrativo ("Somente o Administrativo reativa viagem."). Se outra pessoa já reativou, aparece "Viagem N não está cancelada.".
- **O que você faz:** Peça ao Administrativo, com o motivo.
:::

::: porque
Cancelar preserva o que aconteceu: a Viagem fica guardada, com os vínculos, para quem precisar consultar. Excluir apaga, e por isso só vale para o que nunca foi oficial. As duas ações são do Administrativo porque mexem em tudo o que se pendura na Viagem.
:::

## 4.11 Excluir uma escala do planejamento

<!-- regras: VIA-048 VIA-049 -->

Excluir tira a escala do planejamento da Viagem. É para a escala cadastrada por engano. Se o navio não foi ao porto porque o armador mudou o roteiro, registre a omissão ([4.7](#47-registrar-que-o-armador-omitiu-uma-escala)).

::: ficha
- **Quando usar:** Uma escala foi cadastrada por engano e não tem B/L nem nada oficial.
- **Quem faz:** {{Administrativo}}
- **Antes de começar:** Tire antes os B/Ls ligados ao porto, como POD ou POL (o cancelado também conta).
:::

::: passos
1. Na ficha da Viagem, no **Planejamento por escala**, clique no lápis **Editar** da escala.
2. Na janela **Editar escala**, clique em **Excluir escala**.
3. Confira na janela **Excluir escala do planejamento** o que vai junto ("Vão junto com a escala:" Atracações, exportação e ADRs de Saída em aberto) e escreva o motivo.
4. Clique em **Excluir**. Aparece "Escala removida do planejamento.".
:::

::: sozinho
<!-- regras: VIA-049 VIA-050 VIA-131 -->
- Marca a escala como removida; o Histórico guarda tudo.
- Apaga a exportação, as Atracações, as frentes e o ADR de Saída aberto do porto.
- Tira a escala da Viagem, do Line Up e da Programação do Portal.
- Refaz na hora as contas da Próxima escala, dos alertas, dos prazos D−7 e D−5 e da régua de Comunicados, e recalcula o status da Viagem: excluir a última escala pendente conclui a Viagem.
- Gravar de novo o mesmo porto (por **Adicionar escala**, Chegadas e Saídas ou planilha) desfaz a remoção, e a escala volta ao planejamento.
:::

::: conferir
A escala sai do **Planejamento por escala** e a Linha do tempo registra a escala removida.
:::

<!-- regras: VIA-048 -->

::: aconteceu "Não é possível excluir esta escala: existem B/Ls vinculados."
- **O que o sistema faz:** Recusa excluir a escala com B/L ligado ao porto, cancelado inclusive. Com B/L cujo POD é o porto, aparece esta mensagem. Com B/L cujo POL é o porto, a recusa vem como "Não é possível excluir a escala BRxxx: B/L vinculado à escala, …. Corrija a escala ou omita.". Sem dado planejado, avisa "Esta escala ja nao possui dados planejados para remover.".
- **O que você faz:** Se o navio não foi ao porto, use **Omitir escala** ([4.7](#47-registrar-que-o-armador-omitiu-uma-escala)). Se a escala é mesmo engano, tire antes os B/Ls dela (capítulo 7).
:::

<!-- regras: VIA-048 VIA-090 VIA-036 -->

::: aconteceu "Não é possível excluir a escala …: motivos. Corrija a escala ou omita."
- **O que o sistema faz:** Recusa quando o porto tem trava: B/L com CE Mercante, documento financeiro emitido ou ADR de Saída fechado. Escala com Granito ou Embarque de Vazios no porto também não se exclui ("Não é possível remover a declaração de exportação da escala …: existem operações de carga.").
- **O que você faz:** Omita a escala, ou resolva a trava antes (por exemplo, reabrir o ADR, capítulo 11).
:::

<!-- regras: VIA-049 VIA-050 -->

::: aconteceu "Sem permissão para excluir a escala. Solicite acesso administrativo."
- **O que o sistema faz:** Para as outras equipes, **Excluir escala** não aparece na janela da escala; se o pedido chega ao Vela por outra equipe, ele recusa com esta mensagem. Em Chegadas e Saídas, a marca de escala removida também só é ligada pelo Administrativo ("Somente o Administrativo retira escala da viagem."), com a mesma trava ("Escala PORTO travada: …"); para as outras equipes, ali só a data sai (capítulo 5).
- **O que você faz:** Peça ao Administrativo, com o motivo.
:::

::: porque
Omitir registra o que aconteceu e avisa o Cliente; excluir apaga o que nunca devia ter existido. Por isso a exclusão é do Administrativo e fica travada quando a escala já tem B/L ou registro oficial.
:::

## 4.12 Situações comuns

<!-- regras: VIA-014 VIA-135 -->

::: aconteceu "O navio ficou com outro nome ou outro armador"
- **O que o sistema faz:** O navio achado pelo IMO mantém o nome cadastrado: a grafia digitada não renomeia o navio das outras Viagens. Mas ele recebe o armador digitado, que passa a valer para todas as Viagens do navio. Abreviações como "CS" viram "COSCO SHIPPING" no navio novo.
- **Por quê:** O cadastro de navio e armador é um só para todas as Viagens.
- **O que você faz:** Nada, se o navio é o mesmo. Não há tela de navio nem de armador: a correção é pela Viagem ([4.1](#41-cadastrar-uma-viagem-nova)).
:::

<!-- regras: VIA-031 VIA-030 -->

::: aconteceu "A linha da escala mostra ETA divergente"
- **O que o sistema faz:** Quando a agenda do porto de descarga e a do POL ou da exportação discordam em ETA, BLs e CEs, Vinculada ou Nº Escala, a linha do **Planejamento por escala** mostra o selo "ETA divergente", "CEs divergente", "VINCULADA divergente" ou "Nº Escala divergente". Os dois valores aparecem ao passar o mouse.
- **Por quê:** O mesmo porto pode ter duas agendas gravadas, por exemplo com duas grafias (BRVIT e BRVIX). Com duas grafias, a escala conta como excluída quando nenhuma está ativa ou quando a gravada por último está excluída.
- **O que você faz:** Passe o mouse no selo, veja qual valor está certo e salve a escala com ele.
:::

<!-- regras: VIA-070 VIA-061 VIA-064 VIA-067 -->

::: aconteceu "Omiti, complementei, reverti a omissão ou mudei o COD e o Vela recusou"
- **O que o sistema faz:** Não grava nada e mostra o motivo da recusa. Em **Omitir escala** e **Reverter omissão**, o motivo aparece na própria janela, que fica aberta. Em **Complementar**, aparece no formulário, que fica aberto. Em **Marcar COD** e **Reverter para transbordo**, aparece no aviso da ficha do B/L. Na reversão da omissão recusada por B/L em COD, aparece também "Verifique se algum B/L está em COD.". Sem motivo legível, aparece a mensagem de falha da própria ação, como "Falha ao omitir a escala. Tente novamente.".
- **Por quê:** O Vela confere quem faz e o estado da omissão e do B/L antes de gravar. Ele recusa usuário sem acesso ativo ou registrado em nome de outro ("Somente usuario interno ativo pode reverter omissao, com o proprio usuario autenticado."), omissão que não existe mais ou já revertida ("Omissao … nao encontrada", "Omissao … ja foi revertida."), porto já omitido ("A escala da viagem … ja foi omitida para o POD …"), porto omitido ou de transbordo em branco ("POD omitido/descarga invalidos") e B/L sem transbordo naquela omissão ("Transbordo do B/L … nao encontrado").
- **O que você faz:** Siga o motivo:
  - usuário sem permissão ativa: saia e entre de novo; se continuar, o {{Administrativo}} confere o seu acesso;
  - "ja foi omitida" ou "ja foi revertida": outra pessoa já fez; abra a Viagem de novo para ver a situação atual;
  - B/L em COD: reverta antes o COD de cada B/L ([4.8](#48-mudar-o-destino-de-um-bl-afetado-cod-ou-voltar-ao-transbordo)) e depois a omissão;
  - "Cambio (ROE) nao configurado; …": peça ao {{Financeiro}} para registrar o câmbio e tente de novo;
  - mensagem de falha da ação: tente de novo; se repetir, leve ao suporte técnico.
:::
