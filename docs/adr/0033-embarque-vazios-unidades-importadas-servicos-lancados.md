# 0033 — Embarque de Vazios: unidades importadas e serviços lançados à mão substituem o cálculo por container

Status: aceito — 2026-07-28

> **Nota editorial — 2026-09-19.** A fórmula de armazenagem escrita na
> decisão original (`saída − entrada − free time`) estava incompleta: o dia
> de entrada e o dia de saída contam ambos como dia de armazenagem, como o
> código (`diasCobraveis`, `src/services/vaziosCusto.ts`) sempre implementou.
> A fórmula correta, confirmada com o usuário, é
> `(saída − entrada + 1) − free time da condição`, nunca negativa. O texto
> original abaixo permanece como registro histórico da decisão.

## Contexto

As ADRs 0031 e 0032 modelaram o VAZIOS EXP como um fluxo derivado: o container é
o grão, a planilha traz todos os campos operacionais e o custo da escala é
**calculado** pelo sistema a partir do Cadastro de Depot (tarifas por serviço,
tipo de cálculo, free time, incidência de overtime). Uma sessão de grilling em
2026-07-28 com os responsáveis por preencher o ADR (Agency Departure Report)
derrubou a premissa:

1. **O processo ficou engessado.** Definir um template de planilha capaz de
   carregar todos os serviços, unidade por unidade, e manter um cadastro que
   precifique cada combinação obriga a operação a descrever antecipadamente algo
   que ela conhece só depois de executado. Quem preenche prefere **declarar o que
   foi performado**, serviço a serviço.
2. **O sistema presumia custos que ninguém lançou.** Na 0031/0032, handling in/out
   e transporte incidiam automaticamente sobre todo container vindo de depot, e o
   overtime era percentual aplicado sobre serviços marcados. A operação real não
   tem essa regularidade: o que existe é um conjunto de serviços efetivamente
   executados, cada um com sua quantidade, seu local e seu preço acordado.
3. **A planilha carregava mais do que a fonte sabe.** Booking, destino, terminal
   de origem, OS, condição, percentual de overtime e observações vinham do
   arquivo do depot e alimentavam cálculo. Do arquivo, a operação só precisa
   mesmo das **unidades e das datas de gate**, porque o ADR exige exibir as
   unidades que geraram armazenagem.

Isso não altera a ADR 0027: a entrada continua nascendo no módulo dono (VAZIOS
EXP, sob Equipamentos) e o ADR segue exibição derivada, sem redigitação.

## Decisão

### 1. O Embarque de Vazios é o agregado da escala; o grão é a linha de serviço

Cria-se o **Embarque de Vazios**, um por escala, com identidade `(viagem, porto)`
— a mesma do `agency_departure_report`. É criado do zero pelo usuário, que
seleciona viagem (Combobox preditivo, ADR 0018) e porto de embarque. O agregado
reúne duas partes de naturezas distintas, editadas em ambientes separados:

- a **Lista de Unidades Embarcadas** — o fato, importado de planilha;
- as **Linhas de Serviço do Embarque** — o custo, lançado manualmente.

O **container deixa de ser o grão do módulo**: uma linha de serviço não referencia
containers, e a lista de unidades não carrega preço. Não há mais cálculo
automático de custo a partir do container.

### 2. A planilha traz só unidades e datas, e substitui a lista inteira

O import passa a ter sete colunas: container, tipo, **local de origem**, condição
(vazio / com material), entrada no depot, saída do depot e data de embarque. O
local é **obrigatório em toda unidade** — se o container foi embarcado, veio de
algum lugar — e resolve contra o Cadastro de Terminais. Quando é um Terminal
Portuário, a unidade é Embarque Direto e vem sem datas de depot: ela descarregou,
ficou no terminal e está sendo reembarcada. Reimportar é **substituição total**
da lista da escala (não upsert), e o usuário pode criar, editar e excluir
unidades na tela depois do import.

O import é **tudo ou nada**: qualquer divergência é apontada e **impede subir a
planilha**, em vez de importar as linhas boas e listar as ruins. Unidade vinda de
Depot exige as duas datas de gate — sem data de saída não há armazenagem
calculável, e o único caso legítimo de unidade sem datas é o Terminal Portuário.
Essa rigidez é deliberada e diverge do padrão dos demais imports do sistema
(`importCore`, que coleta erros por linha e importa o resto): aqui uma unidade
faltante subestima a armazenagem de uma folha que aprova pagamento, e o erro
silencioso é pior do que o import recusado.

Morrem, por não terem consumidor: booking, destino, terminal de origem,
observações, percentual de overtime por container e o número da OS.

### 3. Toda cobrança é uma linha lançada; três naturezas governam os campos

Cada linha declara um serviço performado com: serviço, local (depot ou terminal),
tipo de container, quantidade e valor unitário e — no transporte —
o destino, sendo o local a origem da rota. A **natureza** do serviço, definida no
cadastro, decide o comportamento:

- **`armazenagem`** — chave `(depot, condição)`, no máximo uma linha por
  combinação; **quantidade calculada** a partir da Lista de Unidades
  (`saída − entrada − free time da condição`, nunca negativa, somada por depot);
  sem percentual e sem tipo de container. O usuário pode sobrescrever a
  quantidade, e o calculado permanece visível ao lado.
- **`transporte`** — exige rota (local de origem → destino).
- **`geral`** — exige apenas o local.

O valor unitário é sempre o valor efetivo do serviço, já incluindo qualquer
majoração ou overtime. O total é `quantidade × valor unitário`; não há
percentual na linha. Overtime handling e overtime transporte continuam sendo
serviços com valor próprio, e duas faixas do mesmo serviço são duas linhas.

Os dez serviços iniciais — armazenagem, transporte, handling in, handling out,
overtime handling, overtime transporte, bundle composition, bundle organization,
visual check e remoção — são **dados pré-cadastrados**, não enum de código: a
lista é aberta e o usuário cadastra serviços novos escolhendo a natureza.

### 4. O Cadastro de Terminais deixa de calcular e passa a sugerir

O antigo Cadastro de Depot passa a registrar **os dois tipos de local** com que a
operação trabalha, porque a coluna de origem da planilha traz ambos: **Depot**,
que tem os dois free times (container vazio e container com material) e é o único
tipo que gera armazenagem, e **Terminal Portuário** (ex.: TVV), que não tem free
time, nunca gera armazenagem e ainda assim cobra serviços. Uma única tabela com
um campo de tipo, e não duas: a diferença entre os dois é exatamente uma regra —
armazenagem —, o que justifica uma coluna, não um cadastro paralelo.

O terminal do cabeçalho do ADR permanece **texto livre**, preenchido pelo setor
responsável, sem vínculo com este cadastro; amarrá-lo seria mexer na ADR 0027,
fora do escopo desta decisão.

O cadastro guarda ainda um catálogo de **valores sugeridos**, chaveado por
`(local, serviço, tipo de container, rota, condição)` com os quatro últimos
opcionais: a busca casa do mais específico para o mais genérico, de modo que
serviços que não variam continuam com uma linha só. Ao lançar, o sistema
pré-preenche o valor sugerido; o **valor efetivo mora sempre na linha**, e
sobrescrever é livre. Sobrescrever **não altera o catálogo**: o cadastro só muda
por edição deliberada na tela de Terminais. Um valor divergente é quase sempre
correção pontual, não mudança de tabela do depot, e deixar o lançamento reescrever
o cadastro faria um erro de digitação virar o preço oficial sem ninguém ver.

Somem do cadastro: tipo de cálculo, vigência, incidência de overtime e as
quantidades por operação. Sem vigência, o valor sugerido vale até alguém
trocá-lo; o histórico não se perde porque o valor efetivo fica gravado na linha
lançada.

### 5. O ADR exibe as linhas, não só os totais

**Vazios embarcados** passa a derivar da Lista de Unidades (contagem e matriz por
tipo de container). **Operação de Pátio** exibe as linhas de serviço detalhadas —
serviço, local, rota, tipo, quantidade, valor unitário e total — mais
o bloco de armazenagem por depot e condição, e o total geral, tudo em BRL. No
impresso, a capa traz os totais e a **lista das unidades que geraram armazenagem
vai em anexo**. Exibir só somatórios faria o Financeiro voltar a pedir a planilha
do Equipamentos, reintroduzindo pela porta dos fundos o que esta decisão remove.

## Consequências

- **Migração de schema:** o sistema está em construção e **não há dado de
  produção a preservar** — as tabelas do fluxo são recriadas em vez de migradas.
  `vazios_bookings` vira a Lista de Unidades com as sete colunas, com local
  obrigatório; `depots` ganha o tipo (`depot` | `terminal_portuario`) e passa a
  ser o Cadastro de Terminais; nasce a tabela
  de Linhas de Serviço do Embarque; `vazios_operation_service_qty` é removida;
  `vazios_export_operations` perde a OS e permanece como âncora `(viagem, porto)`;
  `depot_services` perde `calc_type`, `subject_to_overtime` e vigência e ganha
  natureza e discriminantes; `depots.free_time_days` vira dois campos. Segue a
  numeração sequencial de migrations (ADR 0016).
- **Import:** o parser de vazios encolhe para sete colunas e o RPC passa a
  substituir a lista da escala em vez de fazer upsert por container.
- **Downstream:** `vaziosCusto.ts` deixa de precificar containers e passa a somar
  linhas; `computeStorageTotals` passa a descontar o free time por condição.
- **UI:** `/embarquevazios` lista os Embarques e cria um novo por escala; dentro
  dele, abas separadas de Unidades Embarcadas e Serviços; `/embarquevazios/depots`
  encolhe para depots, free times e catálogo sugerido.
- **RBAC:** inalterado (Administrativo e Equipamentos editam). A mudança de poder
  é aceita conscientemente: Equipamentos passa a **declarar valores** que o
  Financeiro confere, e não apenas fatos — o controle é o Sign-off Departamental
  já existente (ADRs 0027/0029), não uma restrição de perfil.
- **Preserva a ADR 0027:** a entrada continua nascendo no módulo dono e o ADR
  permanece exibição derivada. O que mudou foi *o que* se digita no módulo, não
  *onde*.
- **Perda aceita:** com substituição total, reimportar descarta unidades criadas
  à mão e altera a quantidade das linhas de armazenagem, que derivam da lista. O
  risco oposto — unidade fantasma inflando a contagem de uma folha que aprova
  pagamento — foi julgado pior.
- **Protótipo:** o modelo foi exercitado num demo clicável antes desta decisão —
  reducer puro com as regras de veto e a conta de armazenagem, fora da main.
  *Nota editorial 2026-07-28: o protótipo foi descartado logo após cumprir seu
  papel; esta ADR e o `CONTEXT.md` são o registro do modelo que ele validou.*

## Alternativas consideradas

- **Entrada manual dentro da própria tela do ADR.** Rejeitada: quebraria o
  princípio de exibição derivada da ADR 0027 e criaria duas verdades sobre a
  escala. O departamento que preenche (Equipamentos) já é o dono do módulo de
  vazios e pensa a operação isoladamente.
- **Manter o cálculo automático e só permitir ajustes.** Rejeitada: é o
  engessamento relatado — obriga a cadastrar antecipadamente toda combinação de
  serviço, tipo e rota para que o número saia certo.
- **Duas tabelas, uma para depots e outra para terminais.** Rejeitada: a única
  diferença entre os dois é gerar ou não armazenagem, e separá-los duplicaria
  catálogo de serviços, RLS e busca de sugestão, além de dar à linha de serviço
  dois campos de local mutuamente exclusivos.
- **Aposentar o Cadastro de Depot por completo.** Rejeitada porque o valor de um
  serviço é estável entre escalas; sem catálogo, o mesmo handling seria
  redigitado a cada operação, sem contra-prova para erro de digitação.
- **Catálogo chaveado só por `(depot, serviço)`.** Rejeitada: transporte varia por
  rota e por tipo de container, e uma sugestão sistematicamente errada treina o
  usuário a ignorar o catálogo.
- **Percentual como rótulo, com valor já líquido digitado.** Rejeitada: o
  percentual não faria conta nenhuma e o ADR perderia a informação que o
  Financeiro usa para conferir a fatura.
- **Upsert por container na reimportação** (decisão da 0031). Rejeitada agora que
  a lista deixou de ser base viva e passou a ser o fato de uma escala.

## Relação com as ADRs 0031 e 0032

**Supersede** a ADR 0031 quanto ao grão-container, ao upsert por container, ao
conjunto de colunas da planilha e às tarifas automáticas por depot; e **supersede**
a ADR 0032 quanto aos tipos de cálculo, à vigência de serviço, ao overtime como
percentual importado com incidência por serviço (`subject_to_overtime`) e às
quantidades lançadas por operação.

Permanecem vigentes da 0032: a lista única de serviços sob o depot (em vez de
tarifas estruturadas em colunas), a página `/embarquevazios/depots` fora do menu
superior com acesso por botão, e o mesmo tratamento dado a `/granito/taxas`.
