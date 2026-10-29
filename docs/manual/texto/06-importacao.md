A documentação de uma Viagem chega do armador em arquivos: o B/L de cada carga, o Manifesto da carga solta, a planilha de CE Mercante e o Baplie, o plano de carga do navio. No Vela, cada arquivo entra por uma importação que lê tudo, mostra numa prévia o que vai mudar e só grava quando você confirma. Este capítulo mostra como importar cada arquivo, como corrigir o que o armador mudou depois e o que o Vela faz sozinho com o que foi gravado: o cálculo das Taxas Locais, as faturas, as marcas do Baplie e a Revisão.

::: aprende
- importar os B/Ls de container e a carga solta de uma Viagem;
- reimportar um B/L que o armador corrigiu, inclusive quando ele já tem fatura;
- importar a planilha de CE Mercante e ler o resultado da emissão das faturas;
- corrigir o CE ou o Manifesto Mercante de um B/L;
- importar o Baplie, resolver as divergências com os B/Ls e cadastrar os vazios;
- trocar um B/L reemitido pelo armador e destravar o que ficou parado depois da importação.
:::

## 6.1 Por onde importar e como toda importação funciona

<!-- regras: BLR-013 VIA-010 CEB-001 -->

::: ficha
- **Quando usar:** Antes da primeira importação, e sempre que tiver dúvida sobre o que a janela de importação está mostrando.
- **Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}} importa os B/Ls, o CE Mercante e o Baplie.
- **Antes de começar:** A Viagem precisa existir no Vela (capítulo 4).
:::

Toda importação é feita para uma Viagem. A Viagem de destino é escolhida antes do arquivo, para o Vela comparar o arquivo com ela. Esta seção mostra onde ficam as importações e o que todas têm em comum; as seções seguintes explicam cada arquivo.

Há três caminhos para importar, e eles abrem as mesmas janelas:

- **Lista BLs.** No menu **Importação**, clique em **BLs**. O botão **Importar**, no alto da lista, abre o menu com **B/L de contêiner (.xlsx)**, **B/L de carga solta (.pdf, .docx)**, **Manifesto de carga solta (BB)** e **CE Mercante**. Se a lista está filtrada por uma Viagem, a janela já abre com ela escolhida.
- **Ficha da Viagem.** A ficha tem as abas **Visão geral**, **Importação**, **Exportação**, **Rotas e Manifestos** e **ADR**. As abas **Importação** e **Exportação** trazem os totais por porto e abrem cada importação com a Viagem já escolhida. A aba **Importação** tem o bloco **Importação rápida**, com **Baplie EDI**, **B/L container**, **B/L carga solta**, **CE Mercante**, **Manifesto BB**, **Veículos** e **Vazios IMP**. A aba **Exportação** tem o bloco **Ações da exportação**, com **Manifesto Granito** e **Novo embarque de vazios**. Na linha das abas ficam os atalhos **Resolver divergências (N)** (quando a Conciliação está Divergente) ou **Baplie EDI**, **B/Ls da viagem** e **Granito** (só com B/L de Granito). Na Viagem cancelada, esses dois blocos somem.
- **Baplie EDI.** É a primeira opção do grupo **Importação** do menu. A página trabalha sempre com uma Viagem: sem Viagem escolhida, mostra **Escolha uma viagem** ("O Baplie é importado e conferido com os B/Ls por viagem…"). Escolha a Viagem na faixa de viagens ou em **Buscar viagem**. A Viagem escolhida fica no endereço da página, e o link de um alerta abre direto nela.

A ficha do B/L tem ainda **Reimportar B/L**, para o arquivo corrigido de um B/L ([6.3](#63-reimportar-um-bl-que-o-armador-corrigiu)).

::: passos
1. No menu, abra **Importação** e clique em **BLs**. No alto da lista, clique em **Importar**.
2. Clique no arquivo que vai importar. Por exemplo, **B/L de contêiner (.xlsx)**.
:::

::: tela bls-importar-menu
A lista BLs com o menu Importar aberto.
:::

Pela ficha da Viagem, o mesmo começo fica na aba **Importação**, no bloco **Importação rápida**:

::: tela viagem-importacao-rapida
A Importação rápida da aba Importação, na ficha da Viagem.
:::

### Quem importa

<!-- regras: ACE-090 ACE-091 CEB-005 -->

Qualquer pessoa ativa do Vela, de qualquer equipe, importa todos os arquivos (B/L, CE, Baplie, veículos, Vazios, Granito, datas e Clientes) e reprocessa, com justificativa, o que a importação deixou travado ([6.11](#611-o-que-acontece-depois-da-importação)). Também são de qualquer equipe: corrigir e remover o CE de B/L sem fatura, mover e desvincular B/L de Manifesto Mercante, informar o Nº de Manifesto, usar **Vale o B/L** e **Aplicar IMO/OOG agora** e cadastrar os vazios do Baplie. Tudo fica no Histórico com o nome de quem fez. O Vela recusa usuário desativado e sessão vencida.

Na Viagem cancelada, nada disso é aceito: o Vela recusa com "Viagem … cancelada: operação selada e somente leitura.", os botões da aba **Rotas e Manifestos** ficam desativados e os blocos **Importação rápida** e **Ações da exportação** não aparecem.

### Arquivo, Prévia e Resultado

<!-- regras: BLR-065 -->

Toda importação segue o mesmo caminho, mostrado no alto da janela em três etapas: **Arquivo · Prévia · Resultado**.

- **Arquivo.** Clique na área do arquivo ou arraste o arquivo para ela. A área diz os formatos aceitos e o limite de 10 MB; enquanto falta a Viagem, ela fica desativada e diz por quê. A janela traz o modelo do arquivo para baixar e o atalho **Como preencher**. Durante a leitura, você pode clicar em **Interromper leitura**. Para usar outro arquivo, clique em **Trocar arquivo**; escolher de novo o mesmo arquivo relê o conteúdo.
- **Prévia.** O Vela mostra o que vai criar, mudar ou deixar de fora. Nada foi gravado ainda.
- **Resultado.** Depois que você confirma, o Vela grava e mostra o que entrou e o que pede ação.

O rodapé da janela diz, em geral, em que ponto você está: "Nada é gravado antes de você conferir a prévia e confirmar.", "Lendo o arquivo. Nada foi gravado.", "Prévia pronta. Nada foi gravado ainda." e, no fim, "Importação gravada.". No arquivo de B/L com pendência, o fim é "Importação gravada com pendências; veja acima."; na planilha de CE, "CE gravado. A emissão das faturas aparece acima.".

### Erros e avisos

<!-- regras: BLR-066 -->

Os erros e avisos da prévia ficam num painel com a lista completa, separando erro de aviso. A lista pode ser baixada em CSV, sem o conteúdo do arquivo.

- **Erro** impede a importação. Cada seção diz o que é erro em cada arquivo; em regra, um erro recusa o arquivo inteiro.
- **Aviso** não impede. Quando a janela pede, marque "Conferi os avisos e quero importar o arquivo" para seguir.

Se a leitura ou a gravação falha, a janela mostra "A importação não foi concluída" e a prévia continua na tela.

### Como o Vela lê uma planilha

<!-- regras: BLR-067 -->

Vale para o Manifesto BB, a planilha de CE Mercante e as demais importações por planilha:

- Só uma aba pode ter dados. Duas abas com dados, ou a primeira vazia e os dados em outra, recusam o arquivo, com o nome das abas.
- Linhas e abas ocultas são ignoradas, com aviso. Dado que só existe nelas é recusado, e a mensagem diz isso.
- Aba com dado além de 100.000 linhas ou de 1.000 colunas é recusada.
- Arquivo corrompido: a mensagem pede para salvar o arquivo de novo no Excel.
- CSV salvo no formato antigo do Windows (Windows-1252) é aceito com aviso. O separador é o que o próprio arquivo usa.

O arquivo de B/L de container é a exceção: o Vela lê as células pela posição, inclusive as ocultas ([6.2](#62-importar-os-bls-de-container)).

### Arquivo já importado

<!-- regras: BLR-068 -->

No arquivo de B/L de container, no Manifesto BB e no B/L avulso, no Granito e nos Vazios IMP e EXP, o Vela guarda uma impressão digital (assinatura) de cada arquivo importado, com o nome dele. A planilha de CE Mercante, o Baplie, os Veículos, as datas e a base de Clientes não têm esse aviso. Se você escolhe de novo o mesmo arquivo para a mesma Viagem e o mesmo tipo de importação, a prévia avisa **Arquivo já importado**: "Este arquivo já foi importado em \<data> por \<pessoa>." e "A importação continua permitida; confira se é mesmo para gravar de novo.". Manifesto BB e B/L avulso contam como o mesmo tipo. O aviso não impede a importação.

Se a assinatura não pôde ser calculada, a importação segue. Assinatura com defeito é recusada: "Assinatura do arquivo inválida: escolha o arquivo de novo.".

### Uma importação por Viagem de cada vez

<!-- regras: BLR-070 CEB-015 -->

Só uma importação grava em cada Viagem por vez: arquivo de B/L, planilha de CE, Baplie, vazios e as demais. **Informar** o Nº de Manifesto Mercante também espera. A segunda gravação espera a primeira terminar. Se as duas se cruzam, a segunda não grava nada: "Outra importação da mesma Viagem estava em andamento. Nada foi gravado: tente de novo.".

Na planilha de CE, se a gravação inteira trava com outra, a janela tenta de novo uma vez, sozinha. Se o choque é numa linha, ela volta com "Outra gravação estava usando os mesmos B/Ls; importe de novo." e nada é gravado.

### Onde fica o registro

<!-- regras: BLR-069 BLR-070 -->

- **Linha do tempo da Viagem** (aba **Visão geral**): cada importação de B/L (de container, Manifesto BB ou B/L avulso) aparece como "N B/Ls importados · POL → POD", ou "· N rotas", com cada rota no detalhe, e com CNTR ou BB e o autor. O registro guarda o nome do arquivo, quem importou, quando, a Viagem e o total de B/Ls.
- A contagem e a rota do evento são as dos B/Ls que hoje estão ligados àquela importação. O B/L reimportado passa para a importação nova e sai do evento antigo, que fica com o total gravado e o nome do arquivo. Por isso, a rota de um evento antigo mostra os B/Ls de hoje, não os do dia da importação.
- **Histórico do B/L**: toda linha que a importação cria, altera ou exclui fica com quem, quando, antes → depois e a **Origem** "Importação de \<tipo> · Viagem \<navio> \<número>". O que a importação grava ao criar o B/L aparece como um único "B/L criado".

### As telas se atualizam sozinhas

<!-- regras: BLR-071 -->

Depois de cada importação, as telas abertas (BLs, ficha do B/L, Containers, Veículos, Viagens, Revisão, Taxas Locais, ADR e Line-Up) se atualizam sozinhas, sem recarregar a página. As telas fechadas leem os dados de novo ao abrir. Isso vale para o que você gravou: o que outra pessoa importou aparece quando você reabre ou atualiza a tela.

::: porque
A prévia existe para nada ser gravado sem alguém conferir. O "tudo ou nada" faz a Viagem nunca ficar com metade de um arquivo. E uma importação por vez evita que duas gravações misturem os mesmos B/Ls.
:::

## 6.2 Importar os B/Ls de container

<!-- regras: BLR-017 EQU-005 -->

::: ficha
- **Quando usar:** O armador mandou as planilhas dos B/Ls de container de uma Viagem.
- **Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.
- **Antes de começar:** A Viagem precisa estar no Vela (capítulo 4). Tenha os arquivos .xlsx ou .xls no layout da COSCO, um B/L por arquivo, até 10 MB cada.
:::

O B/L (conhecimento de embarque) é o documento que agrupa a carga de um consignatário, a empresa que recebe a carga. É pelo B/L que o Vela vincula o Cliente, calcula as Taxas Locais (as cobranças do porto de destino) e mostra a carga no Portal. Os containers só entram no Vela por esta importação: o Baplie confere a carga a bordo, mas não cria container no B/L. Por isso, a lista **Containers** sem filtro diz "Nenhum container importado" até o primeiro arquivo de B/L.

A janela **Importar B/L de container** abre de três lugares: **BLs › Importar › B/L de contêiner (.xlsx)**; a ficha da Viagem, aba **Importação**, **Importação rápida › B/L container** (com a Viagem já escolhida); e a ficha do B/L, **Reimportar B/L** ([6.3](#63-reimportar-um-bl-que-o-armador-corrigiu)).

::: passos
1. Em **BLs**, clique em **Importar** (figura em [6.1](#61-por-onde-importar-e-como-toda-importação-funciona)).
2. Clique em **B/L de contêiner (.xlsx)**. A janela **Importar B/L de container** abre.
:::

::: lado
3. Em **Navio / Viagem**, escolha a Viagem de destino: digite parte do nome do navio e clique na Viagem. Aberta pela Viagem, ela já vem escolhida.
4. Na área **Arquivo**, escolha os arquivos dos B/Ls. Pode escolher vários de uma vez. Para recomeçar com outros, clique em **Trocar arquivo**.
5. Confira a **Prévia**: uma linha por B/L, com a **Situação**, a rota e o **Consignatário**.
6. Clique em **Importar N B/Ls** (no exemplo, **Importar 3 B/Ls**). Enquanto grava, a janela não fecha.

::: tela importar-bl-previa
A prévia dos três B/Ls de container da Viagem 024E.
:::
:::

::: lado
7. Confira o **Resultado** e clique em **Concluir**.

::: tela importar-bl-resultado
O resultado: 3 B/Ls gravados e 4 containers.
:::
:::

No exemplo, os três B/Ls da COSCO SHIPPING SEREIA / 024E entram como novos. COSU6424000101 (para Vitória) e COSU6424000102 (para Salvador) são da ATLANTICO IMPORTADORA LTDA, com o CNPJ identificado. O consignatário de COSU6424000103 (CNPJ 63.045.879/0001-08) ainda não é Cliente do Vela: a prévia diz "CNPJ não identificado" em âmbar, e o B/L entra sem Cliente e vai para a Revisão.

### A Viagem de destino

<!-- regras: BLR-019 -->

A Viagem é obrigatória e vem antes do arquivo. Sem ela, a área do arquivo fica desativada e diz "Escolha a viagem de destino: a prévia compara o navio e a viagem do arquivo com ela.". O arquivo de outro navio ou de outra viagem vira erro do B/L. O que o arquivo não traz (navio ou número da viagem) fica fora dessa comparação. Trocar a Viagem descarta a prévia e as decisões que você já marcou.

### O que o Vela lê do arquivo

<!-- regras: BLR-018 BLR-020 BLR-021 BLR-022 BLR-023 EQU-008 EQU-012 -->

O arquivo é a planilha .xlsx ou .xls do B/L no layout da COSCO, um B/L por arquivo. O Vela lê as células pela posição, na aba "Page 1" (ou na primeira), inclusive linhas e abas ocultas. O modelo está em **Modelo .xlsx**, na própria janela.

Do documento, o Vela lê:

- número do B/L, shipper, consignatário, notify e also notify (Notify 2);
- do consignatário: o bloco inteiro e a razão social curta (que termina na natureza jurídica, como LTDA), com o CNPJ, o e-mail e o telefone ("TEL") do bloco;
- Place of Receipt, POL (porto de embarque), POD (porto de descarga), Place of Delivery, navio e viagem;
- Type of Movement, Laden on Board (a data de embarque), data e local de emissão;
- descrição da carga, com NCM, classe IMO e número ONU, e o total de volumes;
- os containers e o Frete e despesas.

A data de emissão é a Date of Issue ou, sem ela, o Laden on Board. O pagamento do frete vem da linha Ocean Freight.

**Containers.** Só vira container o número no padrão ISO: quatro letras e sete algarismos, sem espaço (por exemplo, CSNU2401018). Cláusula ou texto no meio dos containers é ignorado, e o mesmo container repetido no arquivo conta uma vez. As planilhas põem o número em maiúsculas e tiram os espaços das pontas; o resto é recusado ("formato ISO esperado (XXXX0000000)").

**IMO e OOG.** Classe IMO ou número ONU na descrição marcam os containers do B/L como IMO (carga perigosa). O arquivo nunca marca OOG (carga fora de medida): essa marca vem do Baplie ou da correção manual.

**Modalidade.** Todo B/L tem uma modalidade: **Container**, **Carga Solta** ou **Misto** (os dois). Cada importação de B/L é de container ou de carga solta. O B/L de container pode ser **FCL** (container cheio, de um só Cliente) ou **LCL** (carga que divide o container), ou ficar sem essa marca. O Vela lê isso no Type of Movement: "FCL/FCL" ou "LCL/LCL" na primeira caixa, ou "CY-CY" (FCL) e "CFS-CFS" (LCL) na segunda. Sem nenhum deles, a prévia avisa e o B/L mantém a modalidade gravada; o B/L novo entra sem modalidade.

**Números.** Tara ou peso de container com um separador só, seguido de três algarismos ("3,800" ou "28.000"), pode ser milhar ou decimal: o B/L vira erro, e a mensagem mostra as duas leituras. Com os dois separadores, o da direita é o decimal. Cubagem de container com um separador só é sempre decimal ("30,000" = 30 m³). Número presente que não pôde ser lido (tara, peso, cubagem, total de volumes, valor do frete) fica vazio com aviso, nunca em silêncio.

<!-- regras: BLR-098 -->

**NCM.** O NCM é campo próprio do B/L e é exigido na manifestação no Mercante: códigos separados por vírgula, só algarismos, de 4 a 8 por código. Na ficha do B/L, a tela descarta código com menos de 4 algarismos ou repetido e corta o que passa de 8. Quando a descrição da carga declara outro NCM, o botão "Usar \<códigos>, que a descrição declara, como NCM do B/L" preenche o campo. NCM vazio quer dizer que ninguém cadastrou e nenhum documento declarou.

### A prévia

<!-- regras: BLR-024 BLR-025 -->

A **Prévia** mostra 10 B/Ls por página, com as colunas:

- **Linha** e **B/L**;
- **Situação**: **Cria** (B/L novo), **Atualiza** (B/L já gravado que muda), **Sem mudança**, **Erro** ou "Cancelado, fica de fora";
- **Viagem**, **POL → POD** e **Embarque**;
- **Consignatário**: o CNPJ, com "CNPJ identificado" ou, em âmbar, "CNPJ não identificado; Cliente pelo nome", "CNPJ não identificado" ou "Sem CNPJ no arquivo";
- **Diferenças**: cada campo que muda, como antes → depois; a mudança que afeta a fatura vem com "(faturamento)" em âmbar ([6.3](#63-reimportar-um-bl-que-o-armador-corrigiu)).

O resumo no alto conta os novos, os atualizados, os sem mudança, os com erro e os de CNPJ não identificado.

Erro em qualquer B/L recusa o arquivo inteiro: o botão **Importar N B/Ls** fica desligado e o rodapé diz "Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo.". Com vários arquivos, um que não pôde ser lido bloqueia todos. A gravação também é uma só: se o Vela recusa qualquer B/L ao gravar, nada fica gravado, a tela diz "Nada foi gravado: \<motivo>" e a prévia continua aberta.

### O Cliente do B/L

<!-- regras: BLR-041 BLR-042 -->

O Vela só vincula o Cliente sozinho pelo CNPJ: o CNPJ do consignatário, de um único Cliente ativo (o CNPJ com letras também vale). Sem CNPJ nesse campo, vale o único CNPJ lido no bloco do consignatário ou na descrição da carga. Vinculado assim, o B/L fica "Conferido por CNPJ" e não fica retido no faturamento por causa do Cliente. Na gravação, o Vela confere de novo e recusa o Cliente que não bate com o CNPJ do arquivo.

Quando o CNPJ não resolve, o Vela procura, nesta ordem: o único CNPJ lido no B/L (só CNPJ rotulado e com algarismos válidos); o nome igual; o nome sem sufixo jurídico e sem pontuação; o nome parecido (90% ou mais, com a mesma primeira palavra). Achado só pelo nome, o Cliente é apenas sugerido: o B/L entra sem Cliente e vai para a Revisão. Dois CNPJs diferentes no B/L não vinculam: o B/L vai para a Revisão com os candidatos. Cliente desativado não é candidato pelo nome; pelo CNPJ, vira sugestão com a nota "Cliente desativado: reative o cliente ou escolha outro.".

### Ao gravar

<!-- regras: BLR-038 BLR-046 CEB-077 FAT-165 FAT-106 -->

- Antes de calcular, o Vela aplica aos containers do arquivo as marcas IMO/OOG e SOC/COC do Baplie da Viagem, se ele já foi importado. Assim, a ordem não importa: o B/L importado depois do Baplie recebe as marcas na própria importação.
- Na mesma gravação, cada B/L novo ou ainda não faturado recebe o cálculo das Taxas Locais, ainda provisório, com o preço fixado na data da importação. Se o cálculo não pode ser feito, nada é gravado. Por isso, ao fim da importação, o B/L de container ou misto nunca fica com as Taxas Locais **Não calculado**. B/L faturado não é recalculado.
- Se o cálculo de um B/L falha (câmbio do dia ausente e afins), o arquivo inteiro é recusado ([6.13](#613-situações-comuns)). O câmbio só é exigido do B/L com Cliente e taxa em dólar: o B/L sem Cliente fica com o preço fixado sem câmbio e recebe o câmbio no primeiro cálculo seguinte que tiver câmbio.
- A importação não emite fatura: a fatura só sai depois do CE Mercante ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)).

O resultado fica na própria janela: "Importação concluída: N B/Ls gravados · N containers entraram" (e os que saíram, na reimportação), com ", com pendências" e a lista do que pede ação; o botão vira **Concluir**. Enquanto grava, o X, a tecla Esc e **Voltar** não fecham a janela ("Aguarde: a gravação ainda está em andamento.").

A gravação tem um tempo máximo de 60 segundos, o bastante para uns 7.000 containers. O arquivo grande demais é recusado inteiro, pedindo para dividir os B/Ls em arquivos menores. O mesmo B/L em dois arquivos do mesmo envio também é recusado.

<!-- regras: BLR-043 CLI-032 BLR-044 BLR-045 VIA-062 BLR-047 -->

::: sozinho
- Vincula o Cliente pelo CNPJ e marca o vínculo "Conferido por CNPJ".
- Transforma o e-mail do consignatário em contato do Cliente, só quando o CNPJ do documento é o do Cliente. O endereço novo entra ativo, com a origem "Capturado do B/L": como principal (nas três caixas) se o Cliente não tem contato principal ativo; senão, como adicional, só em Documentação e Operação. Endereço já cadastrado, ativo ou desativado, não é duplicado, reativado nem muda de caixa; se ele está desativado e o Cliente não tem principal ativo, abre o alerta "Cliente sem contato principal". O Histórico do Cliente mostra "Contatos: alteração via B/L".
- Usa o Laden on Board para o ATD (saída real) do POL da Viagem: vale o menor entre os B/Ls ativos do mesmo POL. ATD corrigido à mão na Viagem não muda, e a prévia avisa: "ATD do POL \<porto> corrigido à mão em \<data>: o Laden on Board do arquivo é \<data> e o ATD não muda.".
- Põe o B/L novo cujo POD foi omitido na Viagem como afetado pela omissão, com disposição Transbordo; a prévia avisa, e o Histórico do B/L registra "B/L importado depois da omissão de …: afetado, disposição Transbordo" (capítulo 4).
- Passa cada B/L sem fatura pela Revisão: com pendência, ele fica **Pendente**, e a linha "Pendencias de importacao: …" vai para o fim das notas, sem apagar o que a pessoa escreveu; sem pendência, fica **Revisado**. O Histórico registra "Gate canonico aplicado apos importacao" ou, quando a segunda passada da gravação muda a situação, "Gate canonico reaplicado apos e-mail importado". Cliente achado só pelo nome deixa o B/L sem Cliente e **Pendente**. B/L faturado não é reavaliado.
- Registra a importação na **Linha do tempo** da Viagem e cada mudança no Histórico do B/L ([6.1](#61-por-onde-importar-e-como-toda-importação-funciona)).
:::

::: conferir
Em **BLs**, filtre pela Viagem: os B/Ls aparecem com o Cliente (ou sem Cliente vinculado) e sem CE Mercante até a planilha de CE ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)). Na ficha do B/L, aba **Histórico**, fica a linha "B/L criado" com a Origem da importação. Os containers aparecem em **Containers**, e os B/Ls **Pendentes**, na **Revisão** (capítulo 8).
:::

<!-- regras: BLR-019 -->

::: aconteceu "Arquivo é da viagem \<navio / viagem>, mas você apontou \<navio / viagem>."
- **O que o sistema faz:** Marca o B/L com erro e não deixa importar nada.
- **Por quê:** A Viagem de destino é escolhida antes do arquivo justamente para o Vela comparar navio e viagem.
- **O que você faz:** Confira a Viagem de destino. Se escolheu errado, troque a Viagem: a prévia é refeita. Se o arquivo é que está errado, peça o arquivo certo ao armador.
:::

<!-- regras: BLR-025 BLR-066 -->

::: aconteceu "Com erro no arquivo, nada é importado. Corrija e escolha o arquivo de novo."
- **O que o sistema faz:** Desliga **Importar N B/Ls** enquanto houver um B/L com erro. Com vários arquivos, um ilegível bloqueia todos.
- **Por quê:** A importação com erro é recusada inteira, para a Viagem nunca ficar com metade do arquivo gravada.
- **O que você faz:** Abra o painel de problemas (dá para baixar em CSV). Corrija o arquivo, ou tire do envio o arquivo com erro, e escolha os arquivos de novo.
:::

<!-- regras: BLR-026 -->

::: aconteceu "O B/L \<nº> já está na Viagem \<navio / viagem>: exclua o B/L lá e importe de novo (cancelar não libera o número)."
- **O que o sistema faz:** Marca a linha com erro na prévia e recusa o B/L na gravação. A importação nunca muda a Viagem de um B/L. Se ele está cancelado na outra Viagem, a mensagem é "O B/L … está cancelado na Viagem …: o número continua lá. Exclua o B/L na Viagem … e importe de novo.".
- **Por quê:** O número do B/L existe uma vez só no Vela, mesmo cancelado.
- **O que você faz:** Siga [6.10](#610-trocar-o-bl-reemitido-com-outro-número-ou-importado-na-viagem-errada): o {{Administrativo}} exclui o B/L na Viagem errada e você importa de novo na certa.
:::

<!-- regras: BLR-027 -->

::: aconteceu "B/L \<nº> está cancelado e não será alterado: para importar, reative o B/L pela ficha (Administrativo) e importe de novo."
- **O que o sistema faz:** Deixa esse B/L de fora, sem tocar nele, e importa o resto. O resultado lista "B/Ls cancelados que ficaram como estavam". A importação nunca reativa um B/L. Arquivo só com B/Ls cancelados não grava nada: "Nada foi gravado: todos os B/Ls do arquivo estão cancelados. Reative pela ficha (Administrativo) e importe de novo.".
- **Por quê:** B/L cancelado é somente leitura.
- **O que você faz:** Se o B/L deve voltar, peça ao {{Administrativo}} **Mais ações › Reativar B/L** na ficha e importe de novo. Se o armador reemitiu com outro número, importe o B/L novo ([6.10](#610-trocar-o-bl-reemitido-com-outro-número-ou-importado-na-viagem-errada)).
:::

<!-- regras: BLR-023 -->

::: aconteceu "Peso ou tara com número ambíguo ("3,800", "28.000")"
- **O que o sistema faz:** Marca o B/L com erro e mostra as duas leituras possíveis.
- **Por quê:** O mesmo texto pode ser 3,8 kg ou 3.800 kg. O Vela não adivinha peso, que muda a cobrança.
- **O que você faz:** Corrija o número no arquivo (use os dois separadores, como "3.800,000") e escolha o arquivo de novo.
:::

<!-- regras: BLR-029 -->

::: aconteceu "POD "\<texto>" não está no cadastro de portos: cadastre o porto ou corrija o arquivo."
- **O que o sistema faz:** Marca a linha com erro. Sem o porto de descarga, a mensagem é "POD ausente no arquivo: informe o porto de descarga.". O POD é reconhecido pelo apelido conhecido ou pelo cadastro de portos (nome ou código); o POL reconhecido pelo cadastro é gravado com o código do porto.
- **Por quê:** O POD define a tabela de cobrança, o Manifesto e a escala.
- **O que você faz:** Corrija o arquivo, ou cadastre o porto (capítulo 5), e escolha o arquivo de novo.
:::

<!-- regras: BLR-034 -->

::: aconteceu "Container \<nº> já está no B/L \<nº> (\<Cliente>): container FCL não é dividido entre Clientes diferentes."
- **O que o sistema faz:** Marca o erro na prévia e recusa na gravação quando o container FCL já está num B/L ativo de outro Cliente na mesma Viagem.
- **Por quê:** Container cheio (FCL) é de um Cliente só. Só B/L LCL e container com veículos podem ser divididos entre Clientes.
- **O que você faz:** Confirme com o armador qual B/L está certo e corrija o arquivo ou o outro B/L.
:::

<!-- regras: BLR-028 -->

::: aconteceu "Aba VIN ignorada: veículos entram só pela planilha de Veículos; os veículos já gravados no B/L ficam."
- **O que o sistema faz:** Ignora a aba de veículos do arquivo de B/L e mantém os veículos já gravados.
- **Por quê:** Veículos entram e saem só pela planilha de Veículos.
- **O que você faz:** Importe a planilha de Veículos (capítulo 10).
:::

<!-- regras: BLR-018 ALE-065 -->

::: aconteceu "Arquivo B/L não reconhecido como XLS/XLSX."
- **O que o sistema faz:** Recusa o arquivo que não é planilha. Se a sessão não é de um usuário ativo do Vela, a gravação é recusada com "Usuario sem permissao ativa.".
- **O que você faz:** Escolha a planilha .xlsx ou .xls do B/L. No caso da sessão, entre de novo no Vela e importe outra vez.
:::

::: porque
O Cliente só se vincula sozinho pelo CNPJ porque vincular o Cliente errado põe o B/L no Portal e na fatura de outra empresa. E o preço é fixado no dia da importação para a cobrança não mudar sozinha quando a tabela de cobrança ou o câmbio mudam depois.
:::

## 6.3 Reimportar um B/L que o armador corrigiu

<!-- regras: BLR-030 BLR-031 -->

::: ficha
- **Quando usar:** O armador mandou uma versão nova do arquivo de um B/L de container que já está no Vela.
- **Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.
- **Antes de começar:** Tenha o arquivo novo do B/L. O B/L não pode estar cancelado ([6.2](#62-importar-os-bls-de-container), quadro do B/L cancelado).
:::

::: passos
1. Abra a ficha do B/L (em **BLs**, clique no número).
2. Clique em **Reimportar B/L**. A janela **Importar B/L de container** abre com o B/L da ficha. O botão só aparece em B/L com container e não cancelado.
3. Escolha o arquivo novo do B/L. A janela só aceita o arquivo daquele número.
4. Confira a coluna **Diferenças** da prévia: cada campo que muda aparece como antes → depois.
5. Confira os blocos que a prévia abrir (**Faturamento**, **Preço**, **Troca de consignatário**, **Taxas alteradas à mão**) e marque só o que deve mudar.
6. Clique em **Importar 1 B/L** e, no resultado, em **Concluir**.
:::

Vários B/Ls corrigidos de uma vez entram por **BLs › Importar › B/L de contêiner (.xlsx)**, como em [6.2](#62-importar-os-bls-de-container): o B/L que já existe aparece com a **Situação** **Atualiza**, e os blocos abaixo valem do mesmo jeito.

### O que muda e o que fica

<!-- regras: BLR-031 BLR-032 BLR-044 -->

- A reimportação atualiza só os campos que o arquivo traz, e cada mudança vai para o Histórico do B/L.
- Laden on Board vazio ou ilegível não muda a data gravada; a prévia avisa. O ATD corrigido à mão na Viagem também não muda.
- NCM declarado no documento substitui o gravado (Histórico "NCM declarado no documento reimportado"). Documento sem NCM mantém o cadastrado.
- O Frete e despesas é trocado inteiro pelo do arquivo.
- Os containers são conferidos pelo número. O container que continua no arquivo mantém descarga, devolução, situação de Demurrage, local de desova, perfil IMO/OOG e o SOC/COC corrigido à mão. Só mudam lacre, tipo, tara, peso bruto, cubagem e o SOC/COC declarado, quando ele não foi corrigido à mão.
- O container novo com IMO declarado no B/L nasce marcado como IMO, e o Baplie não tira essa marca.

<!-- regras: EQU-127 DEM-010 -->

**Datas do container.** As datas de descarga e devolução nunca vêm do arquivo de B/L. Elas só mudam por **Editar datas** na aba Containers, pela devolução na ficha do B/L ou pela planilha de **Importar datas**, e valem para todos os B/Ls ativos que dividem o container na Viagem. A descarga vem do terminal; a chegada do navio não a preenche (capítulo 9).

O container que entra depois num B/L (importação ou reimportação) nasce sem **Descarga** e **Devolução**, mesmo que o mesmo container já tenha datas noutro B/L ativo da Viagem (o container dividido entre B/Ls, ou Part Lot). Só o local de desova é herdado. Para levar as datas a ele, grave-as pelo B/L novo (janela **Corrigir** ou linha da planilha de datas com esse B/L), ou salve de novo as mesmas datas em **Editar datas** de Demurrage pelo B/L antigo, que as leva a todos os B/Ls do container. Pela janela **Corrigir** e pela planilha, repetir as mesmas datas no B/L antigo não muda nada ("Nenhum dado do container mudou." na janela, "Sem alteração" na planilha).

### Os containers que saem do B/L

<!-- regras: BLR-033 -->

O container gravado que o arquivo novo não traz sai do B/L, mas só quando a prévia mostrou a saída, no aviso "Saem do B/L: …". Ao gravar, o Histórico do B/L registra "Reimportacao de B/L: container ausente do arquivo, remocao mostrada na previa". O container que tem veículo gravado não sai: a linha do B/L vira erro (veja o quadro no fim da seção).

### Bloco Faturamento: B/L que já tem fatura

<!-- regras: BLR-035 BLR-036 -->

O B/L com fatura emitida (faturado, pago ou com fatura viva) não muda a cobrança sem alguém decidir. Quando o arquivo muda algo que afeta a cobrança (quantidade de containers, container dividido com outro B/L, perfil IMO/OOG, SOC/COC, peso de B/L só de carga solta, CNPJ faturado, POL ou POD), a prévia abre o bloco **Faturamento**. Ele mostra o que acontece com cada fatura e traz uma confirmação por B/L, "Confirmar o faturamento do B/L \<nº>"; com vários B/Ls, uma caixa marca todos. A confirmação nunca vem marcada.

- **Sem marcar:** o B/L entra com os demais campos, e containers, peso, cubagem, POL, POD, Place of Delivery e CNPJ, razão social e e-mail do consignatário ficam como estavam. O Histórico registra "Mudança com impacto na fatura não aplicada (sem confirmação)".
- **Marcado:** a fatura segue a base nova sozinha. Sem pagamento, ela é cancelada e reemitida com o valor novo (com a consolidada que incluir o B/L). Com pagamento, fica desatualizada e segue para restituição ou cobrança avulsa (capítulo 22). O Histórico registra "Mudança com impacto na fatura aplicada com confirmação".

O B/L só calculado, ainda sem fatura, recebe a base nova sem pedir confirmação e é recalculado com o preço fixado.

### Bloco Preço: passar o B/L ao preço de hoje

<!-- regras: BLR-037 TAX-053 -->

O preço das Taxas Locais é fixado no dia da importação e só muda pela prévia do arquivo de B/L. Para cada B/L já gravado, da mesma Viagem, não cancelado e sem fatura, a prévia calcula o preço de hoje (tabela de cobrança, Condição de Cliente, câmbio e total). Se ele difere do fixado, a seção **Preço** ("muda em N B/Ls") mostra o preço do dia da importação e o de hoje, com um aceite por B/L: "Passar o B/L \<nº> ao preço de hoje".

- **Sem marcar:** o preço do dia da importação fica, e só a mudança do arquivo é aplicada.
- **Marcado:** o B/L passa à tabela de cobrança, à Condição, ao câmbio e à data de hoje. O Histórico do B/L registra o motivo "Reimportação do arquivo de B/L: o operador aceitou o preço de hoje na prévia".

Se o preço de hoje não pode ser calculado (falta câmbio ou tabela de cobrança), o bloco não aparece para aquele B/L e o preço fixado fica.

### Bloco Troca de consignatário: trocar o Cliente do B/L

<!-- regras: BLR-039 BLR-040 BLR-043 -->

Quando o B/L já tem Cliente e o arquivo aponta outro Cliente, ou um CNPJ diferente do gravado e do Cliente (consignatário não cadastrado), a prévia abre o bloco **Troca de consignatário**. Há um cartão por B/L, com o Cliente do B/L de → para, o CNPJ, os documentos preservados e o que fazer com os recebimentos, e um aceite só: "Confirmo a troca de cliente em N B/Ls". Linha com erro não anuncia troca.

- **Sem o aceite:** Cliente, consignatário, bloco, CNPJ, razão social e e-mail gravados ficam; os demais campos entram, e o resultado diz "Consignatário mantido em …".
- **Com o aceite:** o B/L passa ao novo Cliente. As Taxas Locais sem pagamento são reemitidas para ele. Com pagamento, o recebido é devolvido ao Cliente original antes da nova cobrança. O e-mail do consignatário vai para os contatos do Cliente novo. Sem nada financeiro, o B/L volta à conciliação de Cliente.

Impedem a troca, com o motivo no cartão ("Impedimento: …"): a Invoice de Demurrage paga sem restituição confirmada, e o consignatário não cadastrado quando o B/L está faturado (fatura viva, situação faturado ou pago, ou recebível com baixa). Recebível em aberto de B/L não faturado não impede: ele é anulado e recalculado. Se a troca é recusada na gravação, o resto do arquivo não se desfaz, e o resultado diz "A troca de cliente foi recusada; o B/L continua com o cliente anterior".

A troca também pode ser feita na ficha do B/L, por **Trocar Cliente** (capítulo 7).

### B/L em COD

<!-- regras: BLR-045 VIA-069 FAT-135 -->

O B/L em COD (mudança de destino registrada por causa de uma omissão de escala) mantém o POD do COD. A reimportação nunca muda o POD, nem o terminal, de um B/L em COD de omissão vigente; a prévia avisa "B/L em COD: o POD continua \<porto> (o arquivo traz \<porto>); os demais campos atualizam.". Fora do COD, o POD corrigido pelo arquivo tira a exceção de terminal do POD anterior e desvincula o B/L do Manifesto Mercante.

### Taxas alteradas à mão

<!-- regras: CEB-099 -->

Se o B/L já gravado tem taxa alterada ou isenção feita à mão (capítulo 21), a prévia mostra a seção **Taxas alteradas à mão**, com o efeito em cada uma: "mantida", "quantidade muda de 2 para 3", "alteração descartada" ou "isento à mão — continua isento". A prévia conta também o SOC/COC que o arquivo traz (sem trocar o corrigido à mão) e o B/L da Viagem que passa a dividir um container com o B/L importado.

Quando a alteração se perde, ou um total alterado à mão ganha quantidade nova, o Vela pede **Gravar mesmo assim** antes de importar. Recusar não grava nada: "Importação cancelada antes de gravar: nada foi alterado.". Enquanto o Vela confere as taxas alteradas, a janela não fecha e **Importar** não repete.

::: sozinho
- Registra no Histórico do B/L cada campo que mudou, com a Origem da importação.
- Recalcula as Taxas Locais do B/L não faturado com o preço fixado (ou com o preço de hoje, se você aceitou).
- Com a confirmação de faturamento, cancela e reemite a fatura sem pagamento, ou a marca como desatualizada se já tem pagamento.
:::

::: conferir
Na ficha do B/L, aba **Histórico**: cada mudança, com antes → depois, e as linhas de confirmação ou de mudança não aplicada.
:::

<!-- regras: BLR-030 -->

::: aconteceu "Arquivo contém o B/L \<nº>, mas a ficha aberta é a do \<nº>."
- **O que o sistema faz:** Marca o erro e não importa nada.
- **Por quê:** Pela ficha, a janela só aceita o arquivo do B/L que está aberto.
- **O que você faz:** Escolha o arquivo certo, ou importe o outro B/L por **BLs › Importar**.
:::

::: aconteceu "O container \<nº> do B/L \<nº> sai pelo arquivo, mas tem o veículo \<chassi>: mova ou exclua os veículos dele (planilha de Veículos ou ficha) antes de tirar o container."
- **O que o sistema faz:** Marca a linha do B/L com erro e não deixa o container sair.
- **Por quê:** Todo veículo precisa estar num container do B/L.
- **O que você faz:** Mova ou exclua os veículos desse container, pela planilha de Veículos ou pela ficha (capítulo 10), e importe de novo.
:::

::: aconteceu "Refaça a prévia e importe de novo."
- **O que o sistema faz:** Recusa a gravação quando o B/L mudou entre a prévia e o clique em **Importar**: por exemplo, "B/L …: a confirmação de faturamento chegou sem o impacto mostrado na prévia." ou "B/L …: o Cliente enviado não é o do CNPJ do consignatário no arquivo.".
- **Por quê:** As confirmações valem só para o que a prévia mostrou.
- **O que você faz:** Escolha o arquivo de novo, confira a prévia atualizada e importe.
:::

::: porque
O arquivo novo do armador é a fonte da lista de containers e dos dados do documento. Mas o que já foi decidido no Vela (datas, correções manuais, fatura emitida, preço fixado, Cliente) só muda quando alguém confirma na prévia.
:::

## 6.4 Importar a carga solta: Manifesto BB e B/L avulso

<!-- regras: BLR-048 EQU-012 -->

::: ficha
- **Quando usar:** O armador mandou o manifesto ou os B/Ls avulsos da carga solta de uma Viagem.
- **Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.
- **Antes de começar:** A Viagem precisa estar no Vela. Tenha a planilha .xlsx, .xls ou .csv (Manifesto BB) ou os arquivos .pdf ou .docx (B/L avulso).
:::

A carga solta (BB, de breakbulk) é a carga que viaja sem container, como máquinas e volumes. Ela entra de dois jeitos, e os dois gravam o mesmo B/L de carga solta, sem CE Mercante:

- o **Manifesto de carga solta (BB)**, planilha com vários B/Ls: **BLs › Importar › Manifesto de carga solta (BB)**, ou na Viagem, **Importação rápida › Manifesto BB**. Abre a janela **Importar manifesto BB (carga solta)**, com a **Viagem de destino** escolhida na própria janela;
- o **B/L de carga solta (.pdf, .docx)**, o B/L avulso do armador, um arquivo por B/L: **BLs › Importar › B/L de carga solta (.pdf, .docx)**, ou **Importação rápida › B/L carga solta**. Abre a janela **Importar B/Ls de carga solta**.

O CE entra depois, pela planilha de CE Mercante, que também vincula o Manifesto Mercante ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)). Cada importação é só de carga solta: o B/L que já tem containers e recebe carga solta passa a **Misto**.

::: passos
1. Em **BLs**, clique em **Importar** e em **Manifesto de carga solta (BB)**. A janela **Importar manifesto BB (carga solta)** abre.
:::

::: lado
2. Em **Viagem de destino**, escolha a Viagem.
3. Em **Formato numérico do arquivo**, deixe **Detectar pelo arquivo** ou declare como o arquivo escreve os números (veja abaixo).
4. Na área **Arquivo**, escolha a planilha. Para usar outra, clique em **Trocar arquivo**.
5. Confira a prévia e clique em **Importar N B/Ls** (no exemplo, **Importar 1 B/L**).

::: tela manifesto-bb-previa
A prévia do Manifesto BB com o B/L de carga solta da Viagem 024E.
:::
:::

Ao gravar, aparece o aviso "Manifesto BB importado: N B/Ls." e o resultado conta "N B/Ls novos, N corrigidos, N sem mudança", com as pendências de cada B/L ou "Tudo o que o arquivo trazia foi aplicado.". Clique em **Concluir**.

::: tela manifesto-bb-resultado
O resultado do Manifesto BB.
:::

No exemplo, o B/L COSU6424000201, da MAQUINAS HORIZONTE LTDA, entra com 2 máquinas, 6 packages, 38,5 t e 112,4 m³, com destino a Vitória.

### A planilha do Manifesto BB

<!-- regras: BLR-049 BLR-050 BLR-051 BLR-052 -->

O Manifesto BB aceita .xlsx, .xls e .csv em três layouts: o resumido (o modelo da janela, em **Modelo .xlsx** e **Modelo .csv**), o legado (vários itens por B/L) e o do armador. No resumido, as colunas obrigatórias são BL, MAQUINAS, PACKAGES, PACKAGES TOTAL, WEIGHT (TON), CBM (M3), SHIPPER, CONSIGNEE e NOTIFY; CNPJ, POL e POD são opcionais. Cada linha cria ou corrige um B/L de carga solta da Viagem.

**Formato numérico do arquivo.** As opções são **Detectar pelo arquivo** (o padrão), **1.234,56 (vírgula decimal)** e **1,234.56 (ponto decimal)**.

- Em **Detectar pelo arquivo**, valor como "259.312" ou "12,500", que o arquivo não desempata, é recusado. Declarar o formato resolve.
- Formato declarado que o arquivo contradiz é recusado.
- O layout resumido é sempre vírgula decimal com três casas ("175,440" t).
- Trocar o formato relê o arquivo. A Viagem e o formato ficam travados durante a gravação e depois do resultado.

**É erro da linha** (e recusa o arquivo inteiro):

- peso bruto ausente ou zerado, porque a taxa por tonelada depende dele;
- número que não é número no formato lido;
- valor acima do plausível para um B/L: 200.000 t de peso, 400.000 m³ de cubagem, 100.000 máquinas ou 1.000.000 de volumes;
- consignatário não identificado;
- no layout legado, o mesmo BL com consignatário, CNPJ, POL ou POD diferentes entre as linhas.

Cubagem ausente é só aviso. A coluna CE preenchida é ignorada, com aviso.

**A prévia** mostra os 25 primeiros B/Ls, com **Situação** (**Cria** ou **Atualiza**), **B/L**, **Máquinas**, **Packages**, **Total de packages**, **Peso (t)**, **CBM (m³)**, **Shipper**, **Consignee** e **Notify**, e o resumo (B/Ls, atualizam, máquinas, packages, t e m³). Qualquer linha com erro recusa o arquivo inteiro; aviso não impede. Para B/L já gravado, a prévia lembra: "CE Mercante e Cliente vinculado ficam como estão. A Revisão é refeita pelas pendências do arquivo; a nota escrita fica.".

### O B/L avulso (.pdf, .docx)

<!-- regras: BLR-062 BLR-063 BLR-064 -->

O B/L avulso é um arquivo .pdf ou .docx por B/L; dá para escolher vários de uma vez. A **Viagem de destino** é obrigatória, e a janela traz um exemplo para baixar.

::: passos
1. Em **BLs**, clique em **Importar** e em **B/L de carga solta (.pdf, .docx)**.
2. Escolha a **Viagem de destino**.
3. Escolha os arquivos dos B/Ls.
4. Confira a prévia de cada arquivo. Se houver avisos, marque "Conferi os avisos e quero importar o arquivo".
5. Clique em **Importar N B/Ls**.
:::

A prévia mostra um arquivo por vez: B/L, Navio / viagem, Rota, Shipper, Consignee, Notify, CNPJ do consignatário, Marcas, Máquinas, Frete, Vias originais, NCM, Local e data de emissão, Descrição da carga e Ressalvas do navio.

- **Erro**, que recusa todos os arquivos do envio ("Este arquivo tem erro: nenhum arquivo do lote é importado"): arquivo sem número do B/L, de outro navio ou de outra viagem, ou com B/L que está em outra Viagem.
- **Aviso**, que pede o aceite "Conferi os avisos e quero importar o arquivo": consignatário, CNPJ, número da viagem, peso, cubagem, packages diferentes do total por extenso e porto desconhecido. Os arquivos com aviso entram como foram lidos.
- **B/L cancelado** só informa: "B/L cancelado: este arquivo não é tocado".

**Peso e cubagem do B/L avulso.** Peso em toneladas (MT, TONS, T) com um separador seguido de três algarismos é decimal: "25.350 TONS" são 25.350 kg. Sem essa unidade (KGS), é milhar: "11.652 KGS" são 11.652 kg. O aviso diz o valor gravado em kg. Cubagem com um separador só é decimal. Peso ou cubagem presentes e ilegíveis entram vazios, com aviso.

### O que vale para os dois

<!-- regras: BLR-053 BLR-054 BLR-055 BLR-057 BLR-061 -->

- **B/L de outra Viagem** recusa o arquivo inteiro ([6.10](#610-trocar-o-bl-reemitido-com-outro-número-ou-importado-na-viagem-errada)).
- **B/L cancelado** é aviso: a linha é ignorada e o resto entra. Arquivo só com B/Ls cancelados não é erro: o rodapé diz "Nenhum B/L a importar." e o botão fica desativado.
- **Reimportar** corrige só o que o arquivo traz. Valor vazio no arquivo não apaga o gravado. CE Mercante, Cliente vinculado e observações não mudam (o resultado avisa "CE Mercante ignorado em …"). A descrição montada a partir das quantidades do layout resumido só vai para B/L novo. O NCM do arquivo substitui o gravado só quando declarado. Os itens são trocados quando mudam; no B/L avulso (um item), o número que o documento não traz fica o do item gravado. O Histórico registra "Carga solta reimportada: \<campos>", com a Viagem e a rota.
- A importação que tiraria toda a carga solta de um B/L faturado ou pago é recusada inteira, pedindo estorno ou refaturamento antes.
- A mesma pessoa pode gravar até cinco importações de B/L (de container, BB ou avulso) por minuto; a sexta pede para esperar.

<!-- regras: BLR-073 -->

**Peso e cubagem do B/L.** Peso e cubagem têm duas partes que não se misturam: **Peso contêiner (kg)** e **CBM contêiner (m³)** só com container; **Peso (t)** e **CBM carga solta (m³)** só com carga solta. O B/L misto mostra as duas, e uma não sobrescreve a outra. O total soma as duas partes, com a conversão de unidade. Nenhum valor pode ser negativo.

### Carga solta já faturada

<!-- regras: BLR-056 FAT-133 FAT-134 -->

No B/L de carga solta faturado (faturado, pago ou com fatura viva), POL, POD, peso, cubagem, volumes, máquinas e itens só mudam com a confirmação "Confirmo a mudança nos B/Ls faturados". Vale também para a carga solta nova num B/L de container faturado. A prévia mostra, por B/L, as faturas e o valor antes → depois, simulados sem gravar: "…, sem mudança de valor", "… → valor a revisar" ou "reemissão bloqueada (…); a fatura não será cancelada".

- **Sem a confirmação:** o B/L faturado mantém os valores gravados, a carga solta nova não entra e o resultado diz, por exemplo, "\<B/L>: POL e PESO mantido (B/L faturado, sem confirmação).".
- **Com a confirmação:** a fatura sem pagamento só é cancelada e reemitida se o valor mudar (mudar só o POL não reemite). Com pagamento, a diferença segue para restituição ou cobrança avulsa. Se a fatura nova não puder sair, a antiga não é cancelada e abre o alerta **Fatura desatualizada**.

### Troca de Cliente na carga solta

<!-- regras: BLR-058 -->

O CNPJ de outro Cliente, ou de consignatário não cadastrado diferente do gravado, pede o aceite "Confirmo a troca de Cliente em N B/Ls".

- **Sem o aceite:** Cliente e consignatário ficam ("Cliente e consignatário mantidos em …: a troca de Cliente não foi confirmada.").
- **Com o aceite e consignatário não cadastrado:** o B/L sai do Cliente e volta à conciliação de Cliente. A gravação recusa essa troca quando o B/L está faturado (fatura viva, situação faturado ou pago, ou valor a receber com baixa), como a prévia avisa.

O aceite vale só para a troca mostrada: se o B/L mudou depois da prévia, ele não é aplicado. B/L em COD mantém o POD ("POD mantido em \<B/L> (B/L em COD).").

<!-- regras: BLR-059 BLR-060 -->

::: sozinho
- Vincula o Cliente só pelo CNPJ exato (coluna CNPJ ou o lido no consignatário). Casado pelo CNPJ, o consignatário gravado passa a ser a razão social do Cliente. Pelo nome, o Cliente é só sugerido, e o B/L novo sem Cliente entra na Revisão com "Cliente nao vinculado automaticamente".
- Não cria contato do Cliente: a carga solta não traz e-mail.
- Calcula na hora as Taxas Locais do B/L novo ou alterado (e do idêntico que ainda não tinha cálculo). A falha recusa o arquivo. Depois a tela calcula de novo, e o que falhar só aparece no resultado ("\<B/L> ficou sem cálculo automático: …"), sem desfazer nada.
- Deixa o pedido de faturamento para o processamento que roda depois da importação ([6.11](#611-o-que-acontece-depois-da-importação)), só para B/L novo ou alterado: reimportar o mesmo arquivo não gera trabalho.
- Refaz a Revisão: com pendência, o B/L fica **Pendente**; sem pendência, o B/L que estava Pendente passa a **Sem pendência**.
:::

::: conferir
Em **BLs**, no filtro **Modalidade**, escolha **Carga solta** ou **Misto** e filtre pela Viagem. Na ficha do B/L, o peso em toneladas e a cubagem da carga solta; no **Histórico**, a linha da importação.
:::

<!-- regras: BLR-053 -->

::: aconteceu "B/L de outra Viagem: o lote será recusado"
- **O que o sistema faz:** A prévia avisa "O B/L \<nº> já está na Viagem \<navio / viagem>. A importação é recusada: exclua o B/L lá e importe de novo (cancelar não libera o número).". Na gravação, nenhum B/L do arquivo é gravado.
- **Por quê:** A importação nunca muda a Viagem de um B/L, e o número existe uma vez só no Vela, mesmo cancelado.
- **O que você faz:** Peça ao {{Administrativo}} para excluir o B/L na outra Viagem e importe de novo ([6.10](#610-trocar-o-bl-reemitido-com-outro-número-ou-importado-na-viagem-errada)).
:::

<!-- regras: BLR-049 -->

::: aconteceu "Planilha invalida. Colunas obrigatorias: …"
- **O que o sistema faz:** Recusa a planilha que não tem alguma das colunas obrigatórias.
- **O que você faz:** Baixe o modelo na janela, acerte o cabeçalho e escolha a planilha de novo.
:::

<!-- regras: BLR-050 -->

::: aconteceu "Valores como "259.312" ou "12,500" são recusados"
- **O que o sistema faz:** Em **Detectar pelo arquivo**, recusa o número que pode ser milhar ou decimal quando o resto do arquivo não desempata.
- **Por quê:** O peso define a cobrança por tonelada; o Vela não adivinha.
- **O que você faz:** Em **Formato numérico do arquivo**, escolha **1.234,56 (vírgula decimal)** ou **1,234.56 (ponto decimal)**. A prévia é refeita.
:::

<!-- regras: BLR-051 CEB-022 -->

::: aconteceu "Coluna CE ignorada nas linhas …: o Manifesto BB não grava CE Mercante; o CE entra pela planilha de CE Mercante."
- **O que o sistema faz:** Ignora a coluna CE e importa o resto.
- **Por quê:** O CE Mercante só entra pela planilha de CE Mercante.
- **O que você faz:** Depois do Manifesto BB, importe a planilha de CE ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)).
:::

<!-- regras: BLR-057 -->

::: aconteceu "B/L … ja foi faturado (status financeiro=…); a importacao removeria carga solta. Estorne/refature antes de substituir o manifesto."
- **O que o sistema faz:** Recusa a importação inteira.
- **Por quê:** O arquivo tiraria toda a carga solta de um B/L faturado ou pago.
- **O que você faz:** Confirme com o armador. Se a carga saiu mesmo do B/L, peça o estorno ou o refaturamento antes (capítulo 22).
:::

<!-- regras: BLR-061 -->

::: aconteceu "Muitas tentativas. Aguarde alguns minutos e tente novamente."
- **O que o sistema faz:** Recusa o Manifesto BB ou o B/L avulso depois de cinco importações de B/L da mesma pessoa no último minuto. Libera depois de 60 segundos.
- **O que você faz:** Espere um minuto e importe de novo.
:::

::: porque
Manifesto BB e B/L avulso são duas formas do mesmo documento e gravam o mesmo B/L. O peso é o que mais pesa na cobrança da carga solta, por isso o Vela recusa número ambíguo e pede confirmação para mudar o que já foi faturado.
:::

## 6.5 Importar o CE Mercante e emitir as faturas

<!-- regras: CEB-003 CEB-022 CEB-023 -->

::: ficha
- **Quando usar:** O Mercante registrou os CEs dos B/Ls de uma rota e você tem a planilha com B/L e CE e o Nº de Manifesto Mercante.
- **Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.
- **Antes de começar:** Os B/Ls precisam estar importados ([6.2](#62-importar-os-bls-de-container), [6.4](#64-importar-a-carga-solta-manifesto-bb-e-bl-avulso)): o CE nunca cria B/L. Uma planilha por Manifesto, com os B/Ls da mesma Viagem e da mesma rota POL → POD.
:::

O CE Mercante é o número de 15 algarismos do conhecimento eletrônico de cada B/L no Mercante. Ele entra só pela planilha de CE Mercante: nenhuma outra importação o grava, e o B/L nunca nasce com CE. Depois, só a ficha do B/L corrige ou remove o CE ([6.6](#66-corrigir-o-ce-ou-o-manifesto-de-um-bl)). Um número de CE só pode estar em um B/L não cancelado, contando também os B/Ls de Granito. O Vela compara o CE só pelas letras e algarismos, sem zeros à esquerda: "0123…" e "123…" são o mesmo CE.

O CE é o que libera a fatura e o B/L no Portal. Por isso, ao gravar a planilha, a própria janela já emite as faturas.

A planilha se importa em **BLs › Importar › CE Mercante** ou na Viagem, aba **Importação**, **Importação rápida › CE Mercante**. Aberta pela Viagem, ou pela lista BLs filtrada por Viagem, a janela traz o campo **Viagem** já preenchido, e você pode mudá-lo. Pela lista sem filtro, não há campo **Viagem** e o arquivo entra inteiro.

::: passos
1. Em **BLs**, clique em **Importar** e em **CE Mercante**. A janela **Importar CE Mercante** abre.
:::

::: lado
2. Em **Nº de Manifesto Mercante**, digite o número do Manifesto deste lote: 13 caracteres, letras ou algarismos.
3. Na área **Arquivo**, escolha a planilha com as colunas **BL** e **CE MERCANTE**.
4. Confira a prévia (**linhas válidas** e **linhas com erro**) e clique em **Importar N CEs** (no exemplo, **Importar 3 CEs**).

::: tela ce-previa
A planilha de CE do Manifesto de Vitória, pronta para importar.
:::
:::

::: lado
5. Confira a **Conferência com o que já está gravado**. Sem erro nem troca de CE a confirmar, o Vela grava no mesmo clique e começa a emitir as faturas.
6. Espere a emissão terminar, sem fechar a janela. Leia o **Resultado: emissão das faturas** e clique em **Concluir**. Se nenhum B/L tem fatura a emitir (todos já faturados, por exemplo), a janela fecha sozinha depois do aviso, sem o resultado.

::: tela ce-resultado
A conferência e o resultado da emissão das faturas.
:::
:::

No exemplo, a planilha do Manifesto 1326502400017 (rota CNSHA → BRVIX) grava o CE de três B/Ls, e a emissão termina assim:

- COSU6424000101, da ATLANTICO IMPORTADORA LTDA: faturado, com a fatura INV-2026-0001;
- COSU6424000201, da MAQUINAS HORIZONTE LTDA: retido, "Retido: a Conta do Portal do Cliente não está ativa.";
- COSU6424000103, ainda sem Cliente: aguardando, "Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.".

### A planilha

<!-- regras: CEB-008 CEB-009 CEB-010 CEB-014 CEB-096 -->

A planilha é .xlsx, .xls ou .csv, até 10 MB, com os dados numa aba só, e precisa das colunas **BL** e **CE MERCANTE** (aceita variações como "B/L", "Nº BL" e "CE"). Há planilha-modelo na própria janela. A prévia mostra até 25 linhas lidas e o resumo **linhas válidas / linhas com erro**.

O B/L é lido em maiúsculas, sem espaços nas pontas; do CE ficam só os algarismos. É erro de linha:

- linha sem B/L, ou com B/L e sem CE ("Linha sem CE Mercante para o BL X.");
- CE que não tem 15 algarismos ("CE Mercante invalido para o BL X: esperado 15 digitos, recebido N.");
- o mesmo B/L em duas linhas ("BL X repetido na planilha de CE Mercante.");
- o mesmo CE em dois B/Ls;
- com o campo **Viagem** preenchido, B/L de outra Viagem ("B/L X pertence a outra viagem"). Limpar o campo **Viagem** importa o arquivo inteiro;
- B/L que não existe no Vela ("B/L X não encontrado no sistema."): o B/L tem de ser importado antes.

Qualquer erro bloqueia a planilha inteira: não há como gravar só as linhas boas.

B/L cancelado na planilha é ignorado, com aviso ("B/L X está cancelado: não é tocado, e o resto da planilha entra."), e o resto entra. A planilha de CE não grava CE em B/L de Granito; o CE que já estava num B/L de Granito continua contando para a regra do CE único e para o status **BLs e CEs** da exportação.

### O Nº de Manifesto Mercante

<!-- regras: CEB-007 CEB-042 CEB-017 -->

O Nº de Manifesto Mercante é o número oficial do manifesto de uma rota POL → POD da Viagem. Ele é obrigatório: sem ele, o rodapé diz **Informe o Nº de Manifesto Mercante para importar.** e **Importar CEs** fica desativado. O número tem 13 caracteres, letras ou algarismos; espaços e separadores são ignorados, e ele é guardado em maiúsculas. A janela não confere o formato enquanto você digita: número com outro tamanho só é recusado na conferência, com "Nada foi gravado: Nº de Manifesto Mercante inválido: …".

- Cada importação é um Manifesto: todos os B/Ls da planilha têm de ser da mesma Viagem e da mesma rota.
- O número é único no Vela inteiro e pertence a uma Viagem, a uma rota POL → POD e a uma natureza, **carga** ou **vazio**. Navegantes e Itajaí, Recife e Suape contam como portos diferentes.
- Repetir um número já cadastrado junta os B/Ls a ele. Uma rota pode ter vários Manifestos, importados em vezes separadas.
- Outro número para um B/L que já está num Manifesto move o B/L, com confirmação e motivo ([6.6](#66-corrigir-o-ce-ou-o-manifesto-de-um-bl)).

### A conferência com o que já está gravado

<!-- regras: CEB-011 CEB-012 -->

Ao clicar em **Importar N CEs**, o Vela confere a planilha sem gravar e mostra **Conferência com o que já está gravado**. Por B/L, ela traz **CE (antes → depois)**, **Manifesto (antes → depois)** e **Situação**:

- **Grava o CE**: o B/L recebe o CE;
- **Sem mudança**: o B/L já tem esse CE e esse Manifesto;
- **Troca o CE**: o B/L tinha outro CE (em âmbar; [6.6](#66-corrigir-o-ce-ou-o-manifesto-de-um-bl));
- **Cancelado, não é tocado** (em âmbar).

A mudança de Manifesto também aparece em âmbar. As notas dizem "fatura N não muda", "o reenvio do Comunicado fica pendente (alerta)" (nada é reenviado sozinho: a troca abre o alerta de reenvio), "Desbloqueio já conferido" e "visível no Portal" ou "fora do Portal". O resumo conta **trocas de CE**, **mudanças de Manifesto** e **erros**; a lista mostra até 50 B/Ls.

Com erro, ou com troca a confirmar, a janela para ali. Sem nada disso, grava no mesmo clique. Mudar o Nº de Manifesto, a Viagem ou o arquivo desfaz a conferência e a confirmação.

A conferência recusa o lote inteiro, com "Nada foi gravado: …", quando:

- os B/Ls são de mais de uma Viagem ou rota;
- falta POL ou POD nos B/Ls;
- os B/Ls não são da Viagem escolhida;
- o Nº de Manifesto tem outro formato, ou já pertence a outra Viagem, a outra rota ou a um Manifesto de vazios.

O CE que já está em outro B/L ativo, ou num B/L de Granito, e o B/L que não existe no Vela aparecem por linha, no painel de problemas, e também bloqueiam a planilha inteira.

### O que a gravação faz

<!-- regras: CEB-016 FAT-021 -->

A gravação da planilha é tudo ou nada. Na mesma operação, o Vela:

- grava os CEs;
- cadastra o Manifesto, se o número é novo, com registro no Histórico da Viagem;
- vincula os B/Ls ao Manifesto, com o Histórico do B/L "Manifesto Mercante: antes → depois";
- registra no Histórico do B/L o CE, com "Importação de CE Mercante · Viagem … · Manifesto … · Rota A → B · Motivo: …";
- calcula as Taxas Locais dos B/Ls que recebem o primeiro CE. Trocar um CE por outro não recalcula.

Se o cálculo de algum B/L falha, nada da planilha é gravado ([6.13](#613-situações-comuns)). Ao terminar, o aviso diz "CE Mercante atualizado em N B/Ls." ou, quando a planilha tem B/L cancelado, "CE Mercante atualizado em N B/Ls; N B/Ls cancelados não foram tocados.".

Sem CE Mercante, a fatura de Taxas Locais não sai por nenhum caminho: o Vela recusa emitir, recusa incluir o B/L numa fatura emitida e recusa ligar o valor a receber a uma consolidada emitida ("B/L … sem CE Mercante. Cadastre o CE antes de faturar."). A fatura avulsa é a única exceção.

### A emissão das faturas e o resultado

<!-- regras: CEB-018 CEB-019 FAT-049 -->

Logo depois de gravar, a própria janela emite as faturas em lotes de 25 B/Ls (o Vela aceita no máximo 50 por vez), com o aviso **Emitindo as faturas em lotes. Não feche esta janela.**. Enquanto grava ou emite, o X, a tecla Esc e **Voltar** não fecham ("Aguarde: a gravação ou a emissão das faturas ainda está em andamento."). Terminada a emissão, o botão passa a **Concluir**.

O bloco **Resultado: emissão das faturas** conta os **processados** e separa cada B/L assim:

| No resultado | O que quer dizer | O que você faz |
|---|---|---|
| **faturados** | A fatura saiu; a lista mostra o número. O B/L que já tinha fatura conta como faturado, sem segunda fatura. | Nada. |
| **retidos** | O Cliente não tem a Conta do Portal pronta nem Liberação de faturamento ("Retido: a Conta do Portal do Cliente não está ativa."). | Peça a ativação do Portal do Cliente (capítulo 14) ou a Liberação de faturamento ao {{Administrativo}}. A fatura sai sozinha depois, com o cálculo do dia do CE. |
| **aguardando** | Falta a conciliação do Cliente, a Revisão do B/L ou a tabela de cobrança do POD e da modalidade. Não é falha. | Resolva a causa dita no motivo: Cliente e Revisão (capítulo 8) ou tabela de cobrança (capítulo 21). |
| **nada a faturar** | O cálculo não tem taxa com valor, ou o B/L é isento ("Nada a faturar: o cálculo do B/L não tem taxa com valor."). | Confira as Taxas Locais do B/L, se esperava cobrança. |
| **bloqueados** | Falha técnica na emissão. Abre na hora o alerta **Falha de emissão automática** (Documentação), que fecha quando a fatura sai. | Leia o motivo. O pedido que ficou na fila tenta de novo sozinho; se a falha continuar, abre também **Efeito de importação bloqueado** ([6.11](#611-o-que-acontece-depois-da-importação)). |
| **pulados** | A última fatura do B/L foi cancelada por uma pessoa ("Pulado: a fatura foi cancelada e aguarda Emitir na ficha do B/L."), ou o B/L está sem CE ou cancelado ("Pulado: B/L sem CE Mercante ou cancelado."). | Se a fatura deve sair, use **Emitir** na ficha do B/L. |

Os motivos de **aguardando** são três: "Aguardando conciliação do Cliente: a fatura sai quando o Cliente do B/L for conciliado.", "Aguardando Revisão do B/L: a fatura sai quando a Revisão terminar." e "Aguardando tabela de cobrança: …", com o POD, a modalidade e onde cadastrar a tabela de cobrança em **Taxas Locais**.

A fatura emitida aqui leva a nota interna "Sistema — CE Mercante: fatura automática após o registro do CE.", que não é impressa. O B/L cuja última fatura foi cancelada por uma pessoa não é faturado de novo sozinho: sai só por **Emitir**.

<!-- regras: FAT-048 FAT-054 DEM-012 POR-066 -->

::: sozinho
- Toda gravação de CE novo ou trocado deixa um pedido de faturamento na fila do que a importação deixou para depois, como rede de segurança. Se a emissão da janela falha, o Vela tenta de novo sozinho por esse pedido. O mesmo pedido repetido não cria segunda fatura, e o B/L que já foi faturado encerra o pedido. A falha que persiste aparece como **Efeito de importação bloqueado**, com o motivo "Faturamento automatico do B/L … bloqueado: …" ([6.11](#611-o-que-acontece-depois-da-importação)). Revisão pendente e tabela de cobrança faltando deixam o pedido esperando, sem alerta crítico, e ele termina sozinho quando a causa se resolve.
- Depois que o B/L tem CE, a fatura também sai sozinha quando ele recebe ou troca o Cliente, ou quando a conciliação do Cliente termina: o Vela calcula e emite na mesma gravação, se tudo estiver pronto, com a mesma nota interna. Se o cálculo falha, essa gravação é recusada ("Taxas Locais do B/L … não calculadas: …. Nada foi gravado: corrija e grave de novo."). Sem Cliente conciliado, o CE só calcula e a fatura espera o Cliente.
- Se o B/L tem uma Invoice de Demurrage esperando para sair (todos os containers devolvidos), gravar o CE a põe de novo na fila de emissão (capítulo 9).
- O B/L passa a aparecer no Portal do Cliente: sem CE, ele não aparece lá ([6.11](#611-o-que-acontece-depois-da-importação)).
:::

::: conferir
Em **BLs**, filtre pela Viagem: a coluna **CE Mercante** mostra o número. Na Viagem, aba **Rotas e Manifestos**, a rota mostra o **Nº de manifesto Mercante** e a coluna **CE Mercante** ("3 de 3"). Na ficha de cada B/L, aba **Histórico**, a linha da importação de CE; em **Taxas Locais**, as faturas emitidas.
:::

<!-- regras: CEB-007 -->

::: aconteceu "Informe o Nº de Manifesto Mercante para importar."
- **O que o sistema faz:** Deixa **Importar CEs** desativado enquanto o campo **Nº de Manifesto Mercante** está vazio. Com número de outro tamanho, a conferência recusa: "Nada foi gravado: Nº de Manifesto Mercante inválido: …".
- **O que você faz:** Digite os 13 caracteres do Manifesto, como estão no Mercante.
:::

<!-- regras: CEB-009 -->

::: aconteceu "CE Mercante invalido para o BL X: a célula é numérica e ficou com N digitos. Formate a coluna CE como texto e digite os 15 digitos."
- **O que o sistema faz:** Marca a linha com erro e bloqueia a planilha.
- **Por quê:** O Excel tira os zeros à esquerda de um número, e o CE tem 15 algarismos.
- **O que você faz:** No Excel, formate a coluna CE como texto, digite de novo os 15 algarismos e importe.
:::

<!-- regras: CEB-010 -->

::: aconteceu "B/L X não encontrado no sistema."
- **O que o sistema faz:** Bloqueia a planilha inteira.
- **Por quê:** O CE nunca cria B/L.
- **O que você faz:** Importe primeiro o arquivo do B/L ([6.2](#62-importar-os-bls-de-container) ou [6.4](#64-importar-a-carga-solta-manifesto-bb-e-bl-avulso)) e depois a planilha de CE.
:::

<!-- regras: CEB-012 -->

::: aconteceu "Os B/Ls da planilha são de mais de uma viagem ou rota (POL → POD). Um manifesto tem uma única rota: separe a planilha por manifesto."
- **O que o sistema faz:** Recusa o lote inteiro.
- **Por quê:** Cada importação é um Manifesto Mercante, e o Manifesto é de uma Viagem e de uma rota POL → POD.
- **O que você faz:** Separe a planilha por rota, uma importação por Manifesto.
:::

<!-- regras: CEB-012 CEB-042 -->

::: aconteceu "O Manifesto Mercante … já está cadastrado para outra viagem, rota ou natureza."
- **O que o sistema faz:** Recusa o lote.
- **Por quê:** O Nº de Manifesto é único no Vela e pertence a uma rota de uma Viagem, de carga ou de vazios.
- **O que você faz:** Confira o número no Mercante. Repetir o número da mesma rota só junta B/Ls a ele.
:::

<!-- regras: CEB-012 CEB-023 -->

::: aconteceu "O CE Mercante N já está em outro B/L não cancelado (Y)."
- **O que o sistema faz:** Marca a linha e bloqueia a planilha inteira.
- **Por quê:** Um CE só pode estar em um B/L não cancelado.
- **O que você faz:** Confira o número. Se o B/L antigo foi reemitido com outro número, ele precisa ser cancelado antes ([6.10](#610-trocar-o-bl-reemitido-com-outro-número-ou-importado-na-viagem-errada)).
:::

<!-- regras: CEB-018 FAT-054 -->

::: aconteceu "A emissão parou"
- **O que o sistema faz:** Mostra "O CE já foi gravado. Retome para emitir os N B/Ls que faltam." com **Retomar emissão**, que continua do ponto em que parou. Se a janela fechou antes de emitir, o Vela emite depois, sozinho, pela fila que roda a cada minuto.
- **Por quê:** O CE e a fatura são gravados em etapas, com uma rede de segurança para a segunda.
- **O que você faz:** Clique em **Retomar emissão**, ou importe a mesma planilha de novo. Não sai fatura em dobro.
:::

::: porque
O CE é o registro oficial do B/L no Mercante. Sem ele, o B/L não pode ser cobrado nem aparecer ao Cliente. Por isso o Vela emite a fatura logo que o CE é gravado e, quando algo falta, diz exatamente o que segura cada B/L.
:::

## 6.6 Corrigir o CE ou o Manifesto de um B/L

<!-- regras: BLR-094 CEB-013 -->

::: ficha
- **Quando usar:** O CE de um B/L foi gravado com o número errado, o Mercante trocou o CE, ou o B/L está no Manifesto errado.
- **Quem faz:** {{Qualquer equipe}}.
- **Antes de começar:** Tenha o número certo e o motivo da correção: toda correção pede motivo e fica no Histórico.
:::

Há dois caminhos. A planilha de CE corrige vários B/Ls de uma vez; a ficha do B/L corrige um. Na ficha, aba **Detalhes do B/L**, o bloco **Documento Mercante** fica fora do formulário: o CE muda só por **Corrigir CE** e **Remover CE**, e o Manifesto Mercante, por **Mover para um manifesto** e **Desvincular**, cada um com o seu motivo. No B/L cancelado, os dois ficam desativados. Sem CE, a dica diz "O CE entra pela importação de CE Mercante, que também vincula o Manifesto.".

### Trocar o CE pela planilha

::: passos
1. Importe a planilha com o CE certo, como em [6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas).
2. Na **Conferência com o que já está gravado**, confira as linhas **Troca o CE**, com o CE antes → depois, e as de Manifesto que muda.
3. Marque **Confirmo trocar o CE de N B/Ls e mudar o Manifesto de N B/Ls**.
4. Em **Motivo**, escreva por que o CE ou o Manifesto muda.
5. Clique de novo em **Importar N CEs**.
:::

O motivo vai para o Histórico de cada B/L, e a fatura já emitida não muda. Antes de gravar, a tela refaz a conferência: se outra gravação mudou esses B/Ls, ela mostra a troca nova e desmarca a confirmação ("Os B/Ls mudaram depois da prévia. Confira a prévia atualizada e confirme a troca com o motivo.").

### Corrigir ou remover o CE na ficha

<!-- regras: BLR-107 -->

::: passos
1. Abra a ficha do B/L, aba **Detalhes do B/L**.
2. No bloco **Documento Mercante**, clique em **Corrigir CE** e digite o CE novo; ou clique em **Remover CE**.
3. Escreva o motivo e confirme.
:::

O CE do B/L com fatura emitida (que não seja rascunho, cancelada ou obsoleta) não pode ser removido: o Vela diz quais faturas impedem. Corrija o número ou peça ao {{Administrativo}} para cancelar a fatura antes. O passo a passo completo da ficha está no capítulo 7.

### Mover o B/L para outro Manifesto ou desvincular

<!-- regras: CEB-017 -->

Para um B/L, use **Mover para um manifesto** ou **Desvincular** no bloco **Documento Mercante** da ficha. Para vários B/Ls da mesma rota, use **Ver B/Ls** na aba **Rotas e Manifestos** da Viagem. Os dois pedem motivo e não mudam o CE. A planilha de CE com outro número para um B/L já vinculado também move o B/L, com a confirmação acima.

### Informar o Nº de Manifesto na rota

<!-- regras: VIA-053 VIA-054 CEB-042 -->

A aba **Rotas e Manifestos** da Viagem tem o bloco **Rotas da viagem**, com uma linha por rota POL → POD dos B/Ls e uma linha VAZIOS por rota de vazios:

- **Rota** (o nome do porto aparece ao passar o mouse). Com escala omitida, o porto omitido aparece riscado, com "(Omitida)", seguido do porto de transbordo ou do destino final;
- **Carga**: CNTR, CNTR/BB, BB ou VAZIOS;
- **ATD no POL** (o ETD previsto, em cinza, enquanto não há ATD);
- **B/Ls**;
- **CE Mercante**: quantos B/Ls têm CE ("2 de 2"), em âmbar quando falta;
- **Nº de manifesto Mercante**: o número, ou "A informar" em âmbar.

As ações são botões de ícone, com o nome ao passar o mouse: **Ver B/Ls** ("Ver B/Ls: mover ou desvincular de Manifesto Mercante") e **Informar Nº de Manifesto Mercante** (rota ainda sem número) ou **Editar ETD previsto + ATD POL e Nº de Manifesto Mercante**. Na Viagem cancelada, ficam desativados. Sem nenhuma rota, a aba diz "Nenhuma rota de B/L identificada nesta viagem.".

::: passos
1. Na Viagem, aba **Rotas e Manifestos**, clique em **Informar Nº de Manifesto Mercante** (ou no lápis da rota). A janela "Editar ETD + ATD e Nº de Manifesto Mercante" abre.
2. Confira **ETD** e **ATD** do POL (só data) e digite o **Nº do manifesto**: 13 caracteres, letras ou algarismos.
3. Clique em **Salvar**. Aparece "Manifesto atualizado com sucesso.".
:::

Qualquer usuário ativo grava. O número segue as mesmas regras da planilha de CE: é único e pertence a uma rota e a uma natureza. As datas e o número são gravados em sequência: se o número é recusado ("Falha ao salvar o manifesto." ou o motivo do Vela), as datas podem já ter ficado gravadas.

<!-- regras: DCE-076 -->

::: sozinho
- Registra a troca no Histórico de cada B/L, com o motivo.
- Não muda a fatura já emitida: trocar o CE não refatura.
- Se o B/L já tinha o Desbloqueio de CE conferido, a troca (ou a remoção) do CE abre o alerta crítico **CE trocado depois do Desbloqueio conferido**, para a Documentação, e a prévia da planilha avisa "Desbloqueio já conferido". O resultado da conciliação vale só para o CE com que foi conferido: trocado o CE, a coluna Na ZPT deixa de mostrar o resultado antigo. O alerta fecha sozinho quando uma conciliação confere o desbloqueio do CE atual (capítulo 12).
:::

<!-- regras: BLR-107 -->

::: aconteceu "O CE Mercante do B/L \<nº> nao pode ser removido: ha fatura emitida (\<faturas>). O Administrativo precisa cancelar a fatura antes."
- **O que o sistema faz:** Recusa **Remover CE** no B/L que tem fatura emitida e diz quais faturas impedem. A própria janela de **Remover CE** já avisa: "O B/L volta a aguardar CE. Com fatura viva, a remoção é recusada: o Administrativo cancela a fatura antes."
- **Por quê:** A fatura emitida depende do CE; o B/L faturado não volta a ficar sem CE.
- **O que você faz:** Use **Corrigir CE** com o número certo. Se o CE tem de sair mesmo, o {{Administrativo}} cancela a fatura antes.
:::

::: porque
O CE é documento oficial. A troca fica registrada com motivo para qualquer pessoa saber depois quem trocou, quando e por quê. E a fatura não muda sozinha, porque o valor dela não depende do número do CE.
:::

## 6.7 Importar o Baplie

<!-- regras: CEB-004 CEB-057 EQU-005 -->

::: ficha
- **Quando usar:** O armador mandou o Baplie da Viagem, ou uma versão nova dele.
- **Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.
- **Antes de começar:** Convém que a Viagem tenha as escalas de importação (capítulo 4): é com elas que o Vela confere os portos do arquivo. Tenha o arquivo .edi, .txt, .edi2 ou .bpl, até 10 MB.
:::

O Baplie é o arquivo do plano de carga do navio (no formato EDIFACT). Ele diz quais containers estão a bordo, cheios ou vazios, para que porto vão e com que marcas: IMO (carga perigosa), OOG (carga fora de medida) e SOC ou COC (container do próprio Cliente ou do armador). No Vela, o Baplie confere a carga física com os B/Ls e leva essas marcas aos containers dos B/Ls; ele não cria B/L nem container de B/L.

O Baplie se importa em **Baplie EDI** (**Importar Baplie EDI** na Viagem sem Baplie, **Reimportar Baplie** na que já tem) ou na Viagem, aba **Importação**, **Importação rápida › Baplie EDI**. A janela **Importar Baplie EDI** é a mesma. Em **Baplie EDI**, a **Viagem de destino** vem com a Viagem da página e pode ser trocada; pela Viagem, ela vem fixa.

::: passos
1. No menu, abra **Importação** e clique em **Baplie EDI**. Escolha a Viagem na faixa de viagens ou em **Buscar viagem**.
2. Clique em **Importar Baplie EDI** (ou **Reimportar Baplie**). A janela **Importar Baplie EDI** abre.
:::

::: lado
3. Confira a **Viagem de destino** e escolha o arquivo do Baplie na área **Arquivo**. O Vela lê o arquivo, confere navio, viagem e escalas e mostra a prévia.
4. Em **Portos de descarga a importar**, deixe marcados só os portos desta operação.
5. Clique em **Importar N containers** (no exemplo, **Importar 7 containers**). Enquanto grava, a janela não fecha.

::: tela baplie-previa
A prévia do Baplie da COSCO SHIPPING SEREIA / 024E, com Salvador e Vitória marcados.
:::
:::

::: passos
6. Se a Viagem já tinha Baplie e algo mudou, a janela **Substituir o Baplie da viagem** mostra a diferença. Confira e clique em **Substituir**; **Voltar** não grava.
:::

No exemplo, o Baplie traz 7 containers: 5 cheios (um deles IMO, o das baterias de COSU6424000102) e 2 vazios, para Salvador e Vitória.

### O arquivo e a conferência da Viagem

<!-- regras: CEB-057 CEB-058 CEB-062 VIA-052 (só a leitura das escalas ativas de importação; o Baplie não cria escala) -->

O arquivo pode ser .edi, .txt, .edi2 ou .bpl, até 10 MB; o modelo está em **Modelo .edi**. A leitura mostra o progresso e pode ser interrompida (**Interromper leitura**). Conteúdo que não é EDIFACT é recusado ("Arquivo Baplie não reconhecido como EDI."). Nada é gravado antes de você conferir a prévia e confirmar.

Antes de liberar a importação, a janela confere o navio, a viagem e as escalas da Viagem escolhida ("Conferindo navio, viagem e escalas da Viagem…"). Para isso, lê as escalas ativas de importação da Viagem, sem as removidas e as omitidas. Se essa leitura falha, aparece **Importação bloqueada**, com **Tentar novamente**: sem essa conferência, nada se grava. Na prévia aparecem a **Viagem** escolhida e o **Navio/viagem no arquivo**.

- **Navio.** Arquivo de outro navio, com o nome vindo da identificação do transporte, bloqueia a importação ("O arquivo é do navio X; a viagem escolhida é do navio Y."). Nome que o Vela só deduziu do arquivo apenas avisa. Só a janela confere o navio; a gravação não confere de novo.
- **Número da viagem.** Nunca é conferido, porque o número do armador não é o da Viagem no Vela. Ele só aparece na prévia.

A escala da Viagem nasce por **Adicionar escala** ou por Chegadas e Saídas (capítulos 4 e 5).

### Erros e avisos do arquivo

<!-- regras: CEB-059 CEB-060 EQU-008 -->

Recusam o Baplie inteiro:

- trecho do arquivo depois do fim do arquivo;
- conjunto sem container, número de container inválido ou container duplicado ("Container X duplicado (conjuntos A e B).");
- indicador de cheio ou vazio ausente ou inválido;
- POL ausente ou não reconhecido, ou POD ausente;
- peso ausente ou inválido em container cheio (a unidade aceita é quilo, tonelada ou libra);
- falta do fim da mensagem ou do fim do arquivo: "O arquivo parece cortado ou incompleto; peça o Baplie de novo ao armador.";
- arquivo em que nenhum container sobrou.

A lista de problemas pode ser baixada em planilha.

São só avisos:

- dígito verificador do container que não confere ("dígito verificador não confere (ISO 6346); confira o número com o armador"). Só o Baplie confere o dígito verificador; as planilhas não;
- carga em quantidade limitada (LQ), tratada como carga normal;
- POD com código desconhecido (o container fica de fora);
- POD ausente, trocado pelo local de entrega;
- segundo container do mesmo lugar a bordo sem POL, POD ou peso;
- contagem do fim da mensagem ou do arquivo diferente do que chegou (a diferença de um que o Baplie da COSCO sempre traz não avisa);
- container em transbordo;
- arquivo sem o navio ("O arquivo não diz o navio").

### Os portos de descarga

<!-- regras: CEB-063 CEB-064 CEB-065 -->

- O container cujo POD estrangeiro não é escala ativa da Viagem (não excluída, não omitida, com importação) fica de fora, com o aviso que lista os containers por porto: "N containers fora das escalas da viagem não serão importados".
- O porto brasileiro que não é escala aparece desmarcado: "BRxxx — sem escala na viagem (N containers); marcado, entra no Baplie sem escala". Marcado, os containers entram e ficam pendentes de conciliação até a escala existir; o Baplie nunca cria a escala. Trocar a Viagem desmarca esses portos.
- Viagem sem escala não tem conferência de porto.

Em **Portos de descarga a importar (desmarque os que não são desta operação)**, só os portos marcados são substituídos. Os outros portos da Viagem ficam como estão, com as marcas e os vazios. Também saem e voltam os containers sem POD e os que o arquivo traz noutro porto. O resumo mostra containers, cheios, IMO, OOG, portos de descarga, **fora das escalas**, **em porto sem escala** e **em transbordo**, e o botão diz **Importar N containers**.

Ao gravar, o Vela confere de novo, já com a Viagem travada: porto estrangeiro fora das escalas e porto de escala omitida (marcado como sem escala) recusam o arquivo. O Baplie e os vazios de importação lidos na prévia têm de ser os mesmos da gravação: outra importação ou recadastro depois da prévia recusa, e você escolhe o arquivo de novo.

### Como o Vela lê o Baplie

<!-- regras: CEB-061 CEB-068 CEB-069 CEB-070 -->

- **Peso:** o VGM (peso verificado); sem VGM, o peso bruto.
- **OOG:** só com excesso de dimensão maior que zero.
- **IMO, classe e ONU:** pela carga perigosa declarada. A carga em quantidade limitada (LQ) não marca IMO.
- **SOC/COC:** pelo campo do dono do container no arquivo. Cada container fica SOC, COC ou não informado.
- **Portos:** os códigos brasileiros de três letras (SSZ, ITJ, PNG, RIG, SSA, PEC, SUA, REC, NVT) valem como os de cinco. CNTAG, CNTCA, CNTCG, TCA e TCG são lidos como Taicang (CNTAC).
- **B/L citado:** "BM" no lugar do número do B/L é lido como B/L não citado; a coluna **B/L citado** fica com um traço, também no Baplie já gravado.
- **Cada container uma vez:** no Baplie de uma Viagem, cada container aparece uma vez só, com número no padrão ISO, cheio ou vazio.
- **Navio compartilhado:** todo container do arquivo entra, seja qual for o armador. O de outro armador aparece como **No Baplie, sem B/L**. Não há código de armador a cadastrar.
- **Transbordo:** o container em transbordo entra marcado (**Transbordo**, ou "· transbordo" na lista) e aparece na conciliação, mas não leva IMO, OOG nem SOC/COC aos B/Ls e não abre divergência de SOC/COC nem de perfil. Vazio em transbordo não vira vazio de importação.

### Reimportar e substituir

<!-- regras: CEB-066 CEB-067 CEB-074 -->

**Reimportar** compara o arquivo com o Baplie gravado nos portos marcados: cheio ou vazio, POL, POD, tipo, IMO, OOG, SOC/COC e transbordo. Lugar a bordo, peso e B/L citado não contam.

- Sem Baplie gravado nos portos marcados (primeira importação ou porto novo), o Vela grava direto, sem diálogo.
- Sem diferença, grava direto: "Baplie reimportado sem diferenças… Vazios e Nº do manifesto Mercante mantidos.".
- Com diferença, ou com marca que cai, abre **Substituir o Baplie da viagem**, com a lista **Incluído / Removido / Alterado**, "Marca que cai: …", "Perfil manual mantido: …" (que sozinho não abre o diálogo) e o efeito nos vazios. **Substituir** confirma; **Voltar** não grava.

O Baplie é sempre completo: o container ou a marca que some do arquivo novo apaga só as marcas que vieram do Baplie anterior (inclusive o SOC/COC vindo dele), depois da confirmação na janela de substituição. As marcas do B/L e as correções manuais continuam.

A gravação é uma só: containers, marcas nos B/Ls e recadastro dos vazios entram juntos, ou nada entra ("A importação não foi concluída", e a prévia fica). Enquanto grava, a janela não fecha. O Histórico da Viagem registra "Baplie importado" ou "Baplie substituído (portos …)", com o total antes → depois e o nome de quem importou.

### As marcas nos B/Ls

<!-- regras: CEB-071 CEB-072 CEB-073 CEB-077 CEB-099 DEM-015 -->

Ao fim de toda importação, o Vela aplica IMO, classe, ONU, OOG e SOC/COC do Baplie aos containers cheios de todos os B/Ls ativos da Viagem que têm o container (inclusive o container dividido entre B/Ls). Com o container repetido, IMO e OOG valem se qualquer linha marca, e vale a maior classe e ONU. B/L cancelado fica de fora. A ordem não importa: o B/L importado depois recebe as marcas na própria importação.

- **IMO/OOG:** o perfil do container tem três origens: o B/L, o Baplie ou a correção manual (aba Carga da ficha, com justificativa). Para container presente no Baplie, o Baplie prevalece sobre o B/L; quando ele confirma o B/L, a origem continua B/L. A correção manual nunca é trocada pelo Baplie: a diferença vira **IMO/OOG manual diverge** ([6.8](#68-resolver-as-divergências-entre-baplie-e-bl)).
- **SOC/COC:** vale o B/L. O Baplie só preenche o container que o B/L não informa, ou que já veio do Baplie; nunca troca o valor do B/L nem a correção manual. Sem informação em nenhuma fonte, o container é tratado como COC e aparece **Não informado** (no filtro **SOC/COC**, na lista Containers e nos cartões do Baplie em tela estreita; na lista do Baplie, um traço).
- O container SOC (do Cliente) não gera Demurrage: não entra na aba Containers da Demurrage (salvo se já estiver numa Invoice viva), não conta como devolução pendente do grupo, e o Vela recusa colocá-lo numa Invoice.

O aviso final diz onde as marcas foram aplicadas, o que caiu, os perfis manuais mantidos e o efeito nas faturas. Quando alguma marca muda, o Histórico da Viagem registra "Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container (conjunto atômico)".

Se as marcas novas afetam uma taxa alterada ou uma isenção feita à mão, o Vela pergunta antes de gravar, em toda gravação: na primeira importação da Viagem, no arquivo sem diferença e depois do **Substituir**, quando ele aparece. Recusar não grava nada.

### O bloco Carga física no Baplie

<!-- regras: CEB-078 CEB-076 CEB-095 -->

Em **Baplie EDI**, o bloco **Carga física no Baplie** mostra "N containers", **Cheios**, **Vazios**, **IMO**, **OOG** e "importado em \<data e hora>". A Viagem sem Baplie mostra **Esta viagem ainda não tem Baplie**, com **Importar Baplie EDI**.

- Se algum container de B/L ainda não recebeu as marcas do Baplie, o bloco mostra **IMO/OOG do Baplie ainda não aplicados a N containers de B/L**, com **Aplicar IMO/OOG agora** (aviso "IMO/OOG do Baplie aplicados aos B/Ls."). Sem pendência, a nota diz que os dados estão aplicados. Importar o mesmo arquivo de novo também refaz a aplicação.
- Hoje a janela não termina com o Baplie gravado e marcas ou vazios pendentes: ou entra tudo, ou nada. A pendência deixada por um Baplie gravado antes disso continua visível, com **Aplicar IMO/OOG agora** e **Atualizar vazios do Baplie** ([6.9](#69-cadastrar-os-vazios-de-importação-do-baplie)); o aviso de resultado parcial, com **Recadastrar vazios** e **Concluir**, só aparece nesse caso antigo.
- Falha de leitura mostra **Não foi possível ler o Baplie desta viagem.** ("Isto não significa que a viagem está sem Baplie."), com **Tentar novamente**. Se a releitura falha com dados já na tela, eles ficam, com o aviso **Não foi possível atualizar o Baplie desta viagem** ("Os dados abaixo são da última leitura e podem estar desatualizados.") e **Tentar novamente**.

::: conferir
Em **Baplie EDI**, com a Viagem escolhida: o bloco **Carga física no Baplie**, a **Conciliação Baplie × B/L** ([6.8](#68-resolver-as-divergências-entre-baplie-e-bl)) e a lista **Containers do Baplie**. No Histórico da Viagem, a linha "Baplie importado" ou "Baplie substituído (portos …)".
:::

<!-- regras: CEB-062 -->

::: aconteceu "O arquivo é do navio X; a viagem escolhida é do navio Y."
- **O que o sistema faz:** Bloqueia a importação. O número da viagem do armador não é conferido.
- **O que você faz:** Confira a **Viagem de destino**. Se ela está certa, peça ao armador o Baplie do navio certo.
:::

<!-- regras: CEB-063 -->

::: aconteceu "BRxxx — sem escala na viagem"
- **O que o sistema faz:** Mostra o porto brasileiro desmarcado. Marcado, os containers entram, mas ficam pendentes de conciliação até a escala existir. Porto estrangeiro fora das escalas fica de fora, com aviso.
- **O que você faz:** Confira se o navio vai mesmo a esse porto. Se vai, crie a escala na Viagem (capítulo 4); se não, deixe o porto desmarcado.
:::

<!-- regras: CEB-064 -->

::: aconteceu "O Baplie desta viagem mudou depois da prévia (outra importação foi gravada). Escolha o arquivo de novo para conferir a diferença. Nada foi gravado."
- **O que o sistema faz:** Recusa a gravação. O mesmo acontece quando os vazios do Baplie foram recadastrados depois da prévia, ou quando o porto marcado é de uma escala omitida ("A escala de … foi omitida: reverta a omissão na Viagem antes de importar containers para ela. Nada foi gravado.").
- **O que você faz:** Escolha o arquivo de novo e confira a diferença atual. No caso da escala omitida, desmarque o porto ou reverta a omissão na Viagem (capítulo 4).
:::

::: porque
O Baplie é a fonte da carga física: o que está a bordo e com que marcas. O B/L é a fonte documental: de quem é a carga e quem paga. Por isso o Baplie confere e marca, mas não cria B/L, não troca o SOC/COC do B/L e não passa por cima de uma correção feita à mão.
:::

## 6.8 Resolver as divergências entre Baplie e B/L

<!-- regras: CEB-079 CEB-086 -->

::: ficha
- **Quando usar:** A Viagem está **Divergente**, o bloco **Conciliação Baplie × B/L** mostra divergências para resolver, ou chegou o alerta de cobertura do Baplie.
- **Quem faz:** {{Qualquer equipe}}. Na rotina, a {{Documentação}}.
- **Antes de começar:** Abra **Baplie EDI** e escolha a Viagem (ou use o atalho **Resolver divergências (N)** da ficha da Viagem). O Baplie precisa estar importado ([6.7](#67-importar-o-baplie)).
:::

O bloco **Conciliação Baplie × B/L** diz a situação da Viagem: **Viagem sem B/L para conferir** (com **Abrir a viagem para importar B/Ls**), **Aguardando B/L das rotas do Baplie**, **Conferindo com os B/Ls…**, **Não foi possível conferir com os B/Ls** (com **Tentar novamente**), **N divergências para resolver** (em âmbar) ou **Baplie e B/Ls conferem**. Embaixo, cada grupo de divergência diz o que a diferença significa e o que fazer. Os números de cada grupo levam à lista do grupo, e os grupos com lista são paginados como a lista (20, 50 ou 100 por página; o rodapé só aparece acima de 20 linhas).

::: passos
1. Abra o grupo da divergência. Em **No Baplie, sem B/L**, clique em **Ver o container na lista** (com mais de um, **Ver os N containers na lista**): a lista **Containers do Baplie** abre filtrada. Nos outros grupos, a lista do próprio grupo mostra o container e o B/L, com link para a aba Carga.
:::

::: tela baplie-conciliacao
A conciliação da Viagem 024E: um container cheio no Baplie sem B/L.
:::

::: passos
2. Confirme com o armador o que está certo: o Baplie ou o B/L.
3. Resolva conforme o grupo, como diz o quadro abaixo: peça o documento que falta, corrija o B/L ou use **Vale o B/L**.
:::

No exemplo, o Baplie traz o container CSNU2401050, cheio, para Vitória, sem nenhum B/L na Viagem. A divergência some quando o armador mandar o B/L e ele for importado.

### Quais containers entram na conferência

<!-- regras: CEB-080 VIA-133 -->

Só os cheios do Baplie são conferidos, rota por rota. Uma rota de cheios do Baplie só entra na conciliação quando tem pelo menos um B/L ativo com container nela; B/L sem container não cobre rota. A partir de 7 dias antes do primeiro ETA brasileiro (o D−7), todas as rotas entram. O bloco mostra **Cheios com B/L** "N de M" (M sem as rotas ainda sem B/L) e "Rotas aguardando B/L" ou "Fora da conciliação até chegar o B/L (N cheios)".

### Os grupos e o que fazer

<!-- regras: CEB-081 CEB-082 CEB-083 CEB-084 -->

| Grupo | O que quer dizer | O que você faz |
|---|---|---|
| **No Baplie, sem B/L** | Container cheio a bordo sem documento na Viagem. Não conta como carga no ADR nem gera cobrança. | Peça ao armador o B/L ou a correção do manifesto. A divergência some quando o B/L é importado. |
| **Em B/L, fora do Baplie** | O B/L declara um container que o Baplie não mostra a bordo. A cobrança continua pelo B/L. Container de B/L cancelado não conta. | Confirme o embarque com o armador; se embarcou, peça o Baplie corrigido e reimporte. |
| **Cheio no B/L, vazio no Baplie** | O container está a bordo, mas o Baplie o traz vazio e o B/L o declara com carga. A cobrança continua pelo B/L. | Confirme com o armador se o container embarcou cheio. Se sim, peça o Baplie corrigido; se embarcou vazio, corrija o B/L. |
| **SOC/COC diverge** | B/L e Baplie informam donos diferentes (só quando os dois informam), em cada B/L ativo do container, mesmo quando o valor do B/L é correção manual. Vale o B/L nas taxas e na Demurrage; nada é trocado sozinho. | Confirme com o armador. Se o B/L está errado, corrija na aba Carga da ficha, com justificativa; se está certo, **Vale o B/L**. |
| **IMO/OOG manual diverge** | O perfil foi corrigido à mão e o Baplie diz outra coisa. A correção manual vale, e o Baplie não a troca. | Confirme com o armador. Se a correção está certa, **Vale o B/L**. |

O grupo **No Baplie, sem B/L** não repete a lista: **Ver os N containers na lista** aplica o filtro **Conciliação = Sem B/L**. O grupo **Em B/L, fora do Baplie** lista **Container** e **B/L**, com link para a aba Carga do B/L. Os grupos de atributo trazem as colunas **No B/L (vale)** e **No Baplie**; no IMO/OOG, com **Container**, **B/L** e o perfil ("IMO", "OOG", "IMO, OOG" ou "sem marca").

### Vale o B/L

<!-- regras: CEB-085 -->

**Vale o B/L** é a única forma de encerrar uma divergência de atributo (SOC/COC ou IMO/OOG manual).

::: passos
1. Na linha da divergência, clique em **Vale o B/L**.
2. Em **Motivo (obrigatório)**, escreva por que o B/L está certo (por exemplo, o que o armador confirmou).
3. Confirme. Aparece **Divergência encerrada: vale o B/L.**.
:::

No SOC/COC, a janela avisa: "Resolve só esta divergência. Um Baplie novo ou uma nova planilha de B/L pode mudar o valor. A resolução fica no Histórico.". No IMO/OOG, ela avisa: "O valor do B/L passa a correção manual: o próximo Baplie não o troca. A resolução fica no Histórico.". A resolução vale para o container em todos os B/Ls ativos da Viagem com o mesmo valor. No perfil IMO/OOG, o valor do B/L passa a ser correção manual. No SOC/COC, fica registrada só a resolução daquele par de valores (um Baplie novo com outro valor volta a divergir), e a origem continua do B/L. O Histórico do B/L registra "Vale o B/L: \<motivo>". Repetir para o mesmo par só atualiza o autor, a data e o motivo.

### A lista Containers do Baplie

<!-- regras: CEB-087 CEB-097 -->

A lista mostra todos os containers do Baplie da Viagem, em ordem de número, com 20, 50 ou 100 por página.

- **Filtros:** **Buscar** (container, lugar a bordo ou B/L citado), **Conciliação** (Todas, Com B/L, Sem B/L, SOC/COC diverge, IMO/OOG manual diverge, Fora da conciliação (sem B/L na rota), Vazios), **Status**, **Tipo**, **POL**, **POD**, **IMO / OOG** e **SOC/COC**.
- **Colunas:** **Container**, **Conciliação**, **Status**, **Tipo**, **Trecho**, **Slot**, **IMO / OOG**, **SOC/COC** e **B/L citado**. Vazios e fora da conciliação ficam em cinza; divergência, em âmbar.
- Sem resultado, a lista diz **Nenhum container neste recorte**, com **Limpar filtros**.
- **Exportar** baixa todos os containers da Viagem, sem os filtros.

A coluna **Conciliação** diz, por container: **Com B/L**; **Sem B/L** (âmbar); **Com B/L · SOC/COC diverge**, **Com B/L · IMO/OOG manual diverge** ou **Com B/L · SOC/COC e IMO/OOG manual divergem** (âmbar); **Fora · rota sem B/L** (rota ainda sem B/L antes do D−7); **Viagem sem B/L**; e **Fora da conciliação** para o vazio. Enquanto a conferência carrega ou falha, a coluna fica com um traço (—).

<!-- regras: CEB-091 -->

A faixa de viagens de **Baplie EDI** marca cada Viagem ativa com o **Estado de Conciliação**, contando as divergências do Baplie com a mesma regra da página.

<!-- regras: CEB-085 -->

::: aconteceu "Não há divergência de … entre o B/L e o Baplie no container …."
- **O que o sistema faz:** Recusa **Vale o B/L** porque a divergência já não existe: o Baplie foi reimportado, o B/L foi corrigido ou outra pessoa resolveu. Se o B/L do container foi cancelado, a mensagem é "O B/L do container … está cancelado: não há divergência a resolver.".
- **O que você faz:** Recarregue **Baplie EDI** e confira a lista de novo.
:::

<!-- regras: CEB-069 -->

::: aconteceu "Container de outro armador aparece como No Baplie, sem B/L"
- **O que o sistema faz:** Em navio compartilhado, importa todos os containers do arquivo; o de outro armador não tem B/L na Viagem e aparece em **No Baplie, sem B/L**.
- **O que você faz:** Confira com o armador quais containers são da operação. Não há código de armador a cadastrar.
:::

::: porque
A conciliação não muda nada sozinha: ela mostra onde o físico (Baplie) e o documental (B/L) não batem, e quem decide é a pessoa que confirmou com o armador. Por isso **Vale o B/L** pede motivo e fica no Histórico.
:::

## 6.9 Cadastrar os vazios de importação do Baplie

<!-- regras: CEB-092 CEB-093 -->

::: ficha
- **Quando usar:** O Baplie da Viagem trouxe vazios que ainda não estão cadastrados.
- **Quem faz:** {{Qualquer equipe}}.
- **Antes de começar:** Abra **Baplie EDI** e escolha a Viagem. O bloco **Vazios de importação** mostra "N vazios — ainda não cadastrados; entram sem Nº de manifesto Mercante, informado depois em Rotas e Manifestos da viagem".
:::

Os containers vazios que o navio descarrega (vazios de importação) ficam fora da conciliação com B/L. Eles podem entrar pela planilha de Vazios IMP (capítulo 10) ou pelo próprio Baplie.

::: passos
1. No bloco **Vazios de importação**, clique em **Cadastrar N vazios** (no exemplo, **Cadastrar 2 vazios**).
:::

::: tela baplie-vazios
O bloco Vazios de importação com os dois vazios do Baplie.
:::

::: passos
2. Na Viagem, aba **Rotas e Manifestos**, informe o Nº de manifesto Mercante da rota de vazios ([6.6](#66-corrigir-o-ce-ou-o-manifesto-de-um-bl)).
:::

A planilha de Vazios IMP vale sobre o Baplie: o Baplie só cadastra os vazios que nenhuma planilha trouxe. O bloco avisa "N vazios já estão na planilha de Vazios de importação", com "Rota diferente: …" quando a rota não bate. Com todos já na planilha, não há botão. Se o Vela não consegue conferir a planilha, não há ação: "Não foi possível conferir os vazios na planilha", com **Tentar de novo**.

Depois do cadastro, o bloco diz "cadastrados em \<data>". Se o cadastro difere dos vazios deste Baplie (containers, rotas ou quantidade), ele fica em âmbar, com **Atualizar vazios do Baplie**, que refaz o cadastro e mantém a natureza digitada (cama ou cover plate). Um Baplie sem nenhum vazio tira da Viagem os vazios do Baplie anterior, com a natureza e o Nº do manifesto Mercante de vazios das rotas que ficam sem container. O link **Abrir Vazios de importação →** leva à tela de vazios.

::: conferir
O aviso diz quantos vazios foram cadastrados ("N vazios cadastrados em Vazios de importação; N ficaram com a planilha."). Em **Vazios IMP**, os vazios aparecem na Viagem. Na aba **Rotas e Manifestos**, a linha VAZIOS mostra "A informar" até o Nº de manifesto Mercante ser informado.
:::

::: aconteceu "Ja existe manifesto Baplie para esta viagem."
- **O que o sistema faz:** Recusa **Cadastrar N vazios** porque outra pessoa já cadastrou os vazios do Baplie desta Viagem. Se outra importação tirou os vazios do Baplie, a mensagem é "Nenhum container vazio encontrado no Baplie desta viagem.".
- **O que você faz:** Recarregue a página. Se houver diferença, o bloco oferece **Atualizar vazios do Baplie**.
:::

::: porque
A planilha de Vazios IMP é a fonte dos vazios; o Baplie só preenche o que ela não trouxe. Assim, um vazio nunca entra duas vezes na mesma Viagem.
:::

## 6.10 Trocar o B/L: reemitido com outro número ou importado na Viagem errada

<!-- regras: BLR-026 CEB-023 -->

::: ficha
- **Quando usar:** O armador reemitiu o B/L com outro número, ou um B/L foi importado na Viagem errada.
- **Quem faz:** {{Administrativo}} exclui ou cancela o B/L antigo; {{Qualquer equipe}} importa o novo e o CE.
- **Antes de começar:** Na ficha do B/L antigo, veja se ele tem CE Mercante (bloco **Documento Mercante**) e fatura (aba **Faturamento**).
:::

O número identifica o B/L no Vela, no Portal e no Mercante, e existe uma vez só no Vela, mesmo cancelado. A importação nunca muda a Viagem de um B/L, e um B/L novo nunca vira o antigo. Por isso, trocar um B/L é sempre tirar o antigo e importar o novo.

### O armador reemitiu o B/L com outro número

Tire o B/L antigo primeiro, para os containers e o CE não ficarem em dois B/Ls ao mesmo tempo.

::: passos
1. Se o B/L antigo **não tem CE Mercante**, peça ao {{Administrativo}} para excluí-lo na lista **BLs** (caixa de seleção da linha e **Excluir**, com motivo).
2. Se o B/L antigo **tem CE Mercante**, ele não se exclui: é cancelado. Antes, resolva o que impede o cancelamento: fatura em aberto (o {{Administrativo}} cancela a fatura), Invoice de Demurrage em aberto (capítulo 9) ou pagamento (o {{Financeiro}} ou o {{Administrativo}} registra a baixa ou a Restituição). Depois, o {{Administrativo}} usa **Mais ações › Cancelar B/L** na ficha, com motivo ("Use quando a carga não embarcou ou o armador reemitiu o documento com outro número."). O cancelamento libera o CE.
3. Importe o arquivo do B/L novo ([6.2](#62-importar-os-bls-de-container) ou [6.4](#64-importar-a-carga-solta-manifesto-bb-e-bl-avulso)).
4. Importe a planilha de CE Mercante com o CE no B/L novo ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)).
:::

O CE do B/L cancelado fica livre para o B/L reemitido. Se depois alguém reativar o B/L cancelado, o Vela recusa a reativação enquanto o CE dele estiver noutro B/L ativo.

### O B/L foi importado na Viagem errada

Na Viagem certa, a importação recusa o B/L: "O B/L \<nº> já está na Viagem \<navio / viagem>: exclua o B/L lá e importe de novo (cancelar não libera o número).".

::: passos
1. Peça ao {{Administrativo}} para excluir o B/L na Viagem errada (lista **BLs**, caixa de seleção, **Excluir**).
2. Importe de novo o arquivo na Viagem certa.
3. Se o B/L já tinha CE, importe a planilha de CE de novo, agora na Viagem certa.
:::

A exclusão só é possível se o B/L não tem CE Mercante, nem fatura (mesmo cancelada), nem Invoice de Demurrage. Comunicado ao Cliente enviado ou pedido de Desbloqueio de CE também impedem a exclusão. O aviso diz qual vínculo impede, como "vinculado a pedido de Desbloqueio de CE". Se o B/L na Viagem errada já tem CE e nunca teve fatura, remova o CE na ficha (**Remover CE**, com motivo, [6.6](#66-corrigir-o-ce-ou-o-manifesto-de-um-bl)) antes de pedir a exclusão. Por isso, confira a Viagem antes de importar o CE: a fatura só sai depois dele.

::: aconteceu "Este B/L não pode ser excluído:"
- **O que o sistema faz:** Recusa a exclusão e diz, abaixo, o número do B/L e o motivo: "B/L com CE Mercante" (cancele em vez de excluir) ou "documento financeiro emitido" (qualquer fatura de Taxas Locais do B/L, mesmo cancelada, ou Invoice de Demurrage).
- **Por quê:** B/L com documento oficial ou financeiro não some do Vela: ele é cancelado e fica no histórico.
- **O que você faz:** Se o armador reemitiu o B/L, cancele-o (passo 2 acima). Se o B/L foi importado na Viagem errada e já teve fatura, ele não chega mais à Viagem certa pelo Vela: leve o caso ao suporte técnico.
:::

::: nao-faca
Não cancele um B/L para importá-lo em outra Viagem: cancelar não libera o número. Só a exclusão libera.
:::

::: porque
O número do B/L é a ligação entre o Vela, o Portal e o Mercante. Se o mesmo número pudesse existir duas vezes, o CE, a fatura e o Cliente poderiam ir para o B/L errado.
:::

## 6.11 O que acontece depois da importação

<!-- regras: ALE-068 FAT-055 FAT-056 TAX-015 -->

Alguns passos de uma importação ficam para logo depois da gravação: aplicar as marcas físicas do Baplie, calcular as Taxas Locais, faturar pelo CE, faturar o Granito e a Demurrage e recalcular depois dos veículos. O Vela processa esses passos sozinho, logo depois da importação e, de novo, a cada minuto. Não há tela para acompanhar: o resultado aparece na ficha do B/L e, se algo trava, num alerta.

- O B/L em Revisão, ou sem tabela de cobrança, espera sem alerta e segue sozinho quando a causa se resolve.
- Cadastrar ou editar uma tabela de cobrança faz o Vela tentar de novo, na hora, os passos que esperavam por ela.
- O cálculo parado por falta de câmbio volta sozinho para a fila quando o câmbio de referência é gravado (pela rotina diária da PTAX ou por **Informar PTAX**).
- Quando o cálculo de um B/L roda, o Vela recalcula também os outros B/Ls que dividem container com ele e ainda não foram faturados (inclusive com CE ou retidos). Quando roda para a Viagem inteira, recalcula só os B/Ls ainda provisórios (sem CE e sem retenção).
- A falha técnica bloqueia o passo e abre o alerta **Efeito de importação bloqueado**.

### Destravar um efeito de importação bloqueado

<!-- regras: ALE-022 ACE-091 -->

::: passos
1. No menu, clique em **Alertas** e abra o alerta **Efeito de importação bloqueado**.
2. Clique em **Reprocessar**. A janela **Reprocessar efeito de importação** mostra o B/L e o **Motivo do bloqueio**, e avisa "Corrija a causa antes de reprocessar.".
3. Corrija a causa (por exemplo, a tabela de cobrança ou o câmbio que faltava).
4. Em **Justificativa (o que foi corrigido)**, escreva o que você corrigiu e clique em **Reprocessar**.
:::

Aparece "Efeito reenviado para a fila. O alerta fecha quando o efeito concluir.". O alerta continua aberto, com **Reprocessando…** (desativado), e fecha quando o passo conclui ou é descartado. Se bloquear de novo, o mesmo alerta mostra o novo motivo, sem nova notificação. Qualquer equipe reprocessa.

### O que se atualiza sozinho na Viagem

<!-- regras: ALE-042 VIA-037 VIA-133 -->

- **Alertas de B/L esperado e de CE pendente.** Incluir ou excluir B/L, mudar a Viagem, o POL ou o POD, ou cancelar o B/L recalcula na hora os alertas **B/L esperado pendente** e **CE Mercante pendente** das Viagens de antes e de depois. A importação do arquivo de B/L recalcula uma vez por Viagem, no fim. Na Viagem concluída, só o tipo de alerta já aberto é reavaliado; a Viagem cancelada não é recalculada.
- **Prazos D−7 e D−5.** Os prazos contam do primeiro ETA brasileiro: o menor ETA das escalas ativas de importação (não removidas, não omitidas), ou o ETA indicado na edição da Viagem, quando for anterior. No D−7, abrem os alertas de B/Ls esperados e de Baplie ausente ou sem cobertura, e a conciliação Baplie × B/L passa a cobrar todas as rotas. No D−5, abre o de CE Mercante faltando (capítulo 20).
- **BLs e CEs da escala.** Na janela da escala, o bloco **BLs e CEs** tem o status **Aguardando**, **Recebido**, **Lançando**, **Em aprovação** ou **Aprovado**, que a conciliação documental atualiza sozinha. Mudá-lo à mão exige justificativa ("Informe a justificativa para alterar BLs e CEs."). **Vinculada** (Sim/Não) confirma que os manifestos foram vinculados à escala no Mercante, e **Nº escala (Mercante)** é o número da escala no Mercante; um não substitui o outro. Na escala só de exportação, o status é o da exportação.

### O B/L no Portal do Cliente

<!-- regras: POR-066 -->

O B/L sem CE Mercante não aparece para o Cliente no Portal: nem em BLs e Containers, nem nas faturas, na consolidação ou em Demurrage. A fatura com vários B/Ls só aparece quando todos têm CE; a fatura avulsa não depende de CE. Isso não muda o cálculo nem a emissão no Vela.

### A Revisão

<!-- regras: BLR-047 -->

Cada importação passa os B/Ls sem fatura pela Revisão. O B/L com pendência (Cliente não vinculado, peso da carga solta faltando, dado a conferir) fica **Pendente**, com a lista das pendências no fim das notas. Resolva na **Revisão** (capítulo 8): enquanto a pendência existe, a fatura do B/L espera.

<!-- regras: ACE-029 -->

::: conferir
Os filtros **POL**, **POD** e tipo de container das listas BLs, Containers e Relatórios oferecem os portos e tipos dos B/Ls e containers gravados, com o código do porto padronizado e o tipo em maiúsculas. Escolher um porto também traz as grafias antigas gravadas do mesmo porto. Depois de importar, o porto novo já aparece no filtro.
:::

::: porque
Separar a gravação do que vem depois deixa a importação rápida e segura: o arquivo é gravado inteiro, e o cálculo ou a fatura que falham não desfazem o que já entrou. O alerta garante que nada fica parado sem alguém saber.
:::

## 6.12 Outras importações

<!-- regras: DEM-010 -->

Outras importações seguem o mesmo molde (**Arquivo · Prévia · Resultado**) e estão explicadas no capítulo de cada assunto:

| Importação | Onde fica | Capítulo |
|---|---|---|
| Programação de navios (datas de várias Viagens) | **Viagens › Chegadas e Saídas**, **Importar programação** | 5 |
| Datas de descarga e devolução dos containers | **Containers** (ou **Demurrage**), **Importar datas** | 9 |
| Veículos | **Veículos**, **Importar veículos**; ou na Viagem, **Importação rápida › Veículos** | 10 |
| Vazios de importação | **Vazios IMP**, **Importar planilha**; ou na Viagem, **Importação rápida › Vazios IMP** | 10 |
| Embarque de vazios | **Vazios EXP** (página Embarque de vazios): abra o embarque e, no bloco **Unidades embarcadas**, clique em **Importar planilha** (fica fora com o ADR de Saída fechado); ou na Viagem, aba **Exportação**, **Novo embarque de vazios** | 10 |
| Granito | **Granito**, **Importar planilha COSCO**; ou na Viagem, aba **Exportação**, **Manifesto Granito** | 10 |
| Arquivo da ZPT | **Desbloqueio de CE**, **Conciliar com a ZPT** ({{Administrativo}} e {{Documentação}}) | 12 |
| Base de Clientes | **Clientes**, **Importar base** | 13 |

As datas de descarga e devolução nunca vêm do arquivo de B/L nem do Baplie: elas só mudam por **Editar datas**, pela devolução na ficha do B/L ou pela planilha de **Importar datas**, e valem para todos os B/Ls ativos que dividem o container na Viagem.

## 6.13 Situações comuns

<!-- regras: BLR-038 CEB-016 FAT-056 FAT-106 -->

::: aconteceu "Taxas Locais do B/L … não calculadas: …. Nada foi gravado: corrija e grave de novo."
- **O que o sistema faz:** Recusa o arquivo inteiro (de B/L ou de CE) e diz o B/L e o que falta. Quase sempre é o câmbio do dia, exigido do B/L com Cliente e taxa em dólar.
- **Por quê:** O B/L não é gravado sem a cobrança calculada.
- **O que você faz:** Espere o câmbio do dia, ou peça **Informar PTAX** ao {{Financeiro}}, ao {{Administrativo}} ou a {{Equipamentos}}, e importe de novo. Os cálculos que tinham parado por falta de câmbio voltam sozinhos para a fila quando ele é gravado.
:::

<!-- regras: BLR-070 CEB-015 -->

::: aconteceu "Outra importação da mesma Viagem estava em andamento. Nada foi gravado: tente de novo."
- **O que o sistema faz:** Não grava nada.
- **Por quê:** Só uma importação por Viagem grava de cada vez.
- **O que você faz:** Espere a outra terminar e importe de novo.
:::

<!-- regras: BLR-068 -->

::: aconteceu "Arquivo já importado"
- **O que o sistema faz:** Mostra quem importou o arquivo e quando, sem bloquear.
- **Por quê:** Importar de novo o mesmo arquivo é permitido (por exemplo, para refazer uma etapa), mas costuma ser engano.
- **O que você faz:** Confira se é mesmo para gravar de novo. Se não, feche a janela.
:::

<!-- regras: BLR-047 BLR-060 -->

::: aconteceu "O B/L ficou Pendente na Revisão depois de importar"
- **O que o sistema faz:** Passa cada B/L pela Revisão. O que tem pendência fica **Pendente**, com a lista no fim das notas.
- **O que você faz:** Resolva na **Revisão** (capítulo 8): vincule ou cadastre o Cliente, informe o peso, confira os dados.
:::

<!-- regras: POR-066 -->

::: aconteceu "O Cliente não vê o B/L no Portal"
- **O que o sistema faz:** Esconde do Portal o B/L sem CE Mercante.
- **O que você faz:** Importe a planilha de CE Mercante ([6.5](#65-importar-o-ce-mercante-e-emitir-as-faturas)).
:::

<!-- regras: CEB-005 -->

::: aconteceu "Viagem … cancelada: operação selada e somente leitura."
- **O que o sistema faz:** Recusa importar, cadastrar vazios, **Vale o B/L**, **Informar**, **Mover** e **Desvincular** na Viagem cancelada.
- **O que você faz:** Confira se a Viagem é a certa. Se ela deve voltar, peça ao {{Administrativo}} para reativá-la (capítulo 4).
:::

<!-- regras: BLR-066 -->

::: aconteceu "A importação não foi concluída"
- **O que o sistema faz:** Mostra a falha na própria janela e mantém a prévia.
- **O que você faz:** Leia o motivo, corrija e importe de novo. Nada foi gravado.
:::

<!-- adiado: EQU-028 EQU-029 EQU-030 EQU-031 EQU-033 EQU-041 → capítulo 9 -->
<!-- adiado: EQU-049 EQU-050 EQU-051 EQU-052 EQU-053 EQU-055 EQU-064 EQU-065 EQU-066 EQU-067 EQU-068 EQU-070 EQU-071 EQU-072 EQU-073 EQU-083 EQU-084 EQU-111 EQU-112 EQU-113 EQU-114 EQU-125 EQU-130 → capítulo 10 -->
<!-- adiado: DCE-073 DCE-074 → capítulo 12 -->
<!-- adiado: CLI-014 CLI-015 CLI-016 CLI-017 CLI-018 CLI-019 CLI-020 → capítulo 13 -->
