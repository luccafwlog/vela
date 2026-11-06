# Revisão do Embarque de vazios (exportação) — 2026-11-06

Revisão pedida pelo dono: saber se o **Embarque de vazios** recebe todas as
informações que o **ADR de Saída** (Agency Departure Report) precisa, como o
local de cada unidade se liga a **Locais (depots e terminais)**, que influência
isso tem no cálculo dos serviços, como a armazenagem é calculada (linha manual
ou automática) e como tudo isso aparece no ADR. A pergunta de partida incluía
uma lacuna percebida na tela: não há onde informar o **porto de descarga** das
unidades.

É um registro datado, feito sobre a `staging` em `24e51684` (migration `602` a
última da cadeia local). A produção estava na migration `599` no dia. A regra
vigente continua em
[Manifestos & EDI § `/embarquevazios`](../../modules/manifesto-edi.md#embarquevazios),
[Manifestos & EDI § `/embarquevazios/depots`](../../modules/manifesto-edi.md#embarquevaziosdepots)
e [Viagens § Agency Departure Report (ADR)](../../modules/viagens.md#agency-departure-report-adr).
As decisões que moldaram o fluxo são as ADRs
[0031](../../adr/0031-vazios-exp-grao-container-cadastro-depot-tarifas.md),
[0032](../../adr/0032-cadastro-depot-servicos-precificados-por-tipo-de-calculo.md),
[0033](../../adr/0033-embarque-vazios-unidades-importadas-servicos-lancados.md),
[0036](../../adr/0036-adr-embarque-vazios-secao-unica-escala-fora-das-fases.md) e
[0113](../../adr/0113-embarque-de-vazios-opera-num-terminal.md).

Rótulos de evidência como em [CONVENCOES.md](../../CONVENCOES.md#labels-de-evidência):
**Código** (leitura estática), **Teste** (teste existente, não executado nesta
revisão), **Runtime** (consulta somente leitura à produção em 2026-11-06,
agregada, sem dado de Cliente) e **Suspeita**.

## Resposta curta

1. **O que entra hoje.** A planilha de **Unidades embarcadas** tem sete
   colunas: CONTAINER, TIPO, LOCAL, CONDIÇÃO, ENTRADA, SAÍDA e EMBARQUE. Só
   CONTAINER, LOCAL e CONDIÇÃO são obrigatórias. Os custos não vêm da planilha:
   cada serviço é uma **Linha de serviço** lançada à mão na aba **Serviços**
   (ADR 0033). **Código:** `src/services/vaziosImport.ts`,
   `public/templates/unidades-embarcadas-modelo.csv`.
2. **Porto de descarga: não existe.** Nem a planilha, nem a janela
   **Adicionar unidade**, nem o ADR têm POD. A tabela das unidades ganhou as
   colunas `pol` e `pod` na migration `053` (2026-09), mas nada as grava nem as
   lê. A spec do Manifesto Mercante já registrava isso como "a única lacuna
   funcional" do modelo e decidia que vazios de exportação geram Manifesto
   Mercante ([spec arquivada de 2026-09-17](../specs/2026-09-17-manifesto-mercante-design.md),
   "Exportação — lacuna funcional"). Nada disso foi implementado.
3. **Local da unidade → cadastro.** A coluna LOCAL casa com o **Código** do
   local em Locais, igual exato sem diferenciar maiúsculas. Nome do depot,
   apelido ou grafia do relatório do depot não casam. O tipo do local decide
   tudo o que vem depois: **Depot** exige entrada e saída e gera armazenagem;
   **Terminal portuário** é Embarque direto, sem datas e sem armazenagem.
4. **Armazenagem é semiautomática.** Os **dias** são calculados sozinhos a
   partir das unidades: `(saída − entrada + 1) − free time do depot para a
   condição`, nunca negativo, somados por depot e condição. O **preço** só
   entra quando alguém lança a linha. O botão **Lançar armazenagem** da tabela
   **Armazenagem a lançar** faz isso num clique. Depois de lançada, a
   quantidade da linha acompanha as unidades, a menos que alguém use
   **Informar a quantidade à mão**. Handling, transporte, overtime, visual
   check e bundle são 100% manuais: quantidade e valor digitados, com o valor
   sugerido pelo catálogo.
5. **No ADR.** A seção **Embarque de vazios** (Equipamentos, uma resolução só)
   mostra as unidades por tipo e local, a Operação de pátio (dias de storage,
   locais, linhas de serviço e total) e, no impresso, um anexo com as unidades
   de depot. Não mostra POD, data de embarque, TEU nem os dias por unidade. Há
   rótulos que não dizem o que contam (achados C2 a C5).
6. **Uso real.** A produção não tem nenhum Embarque de vazios, nenhuma unidade
   e nenhuma linha. O cadastro já está preenchido: 6 depots, 4 terminais e 50
   serviços (**Runtime**). Mudar o modelo agora não exige migrar dado de
   embarque. Toda migration nova continua exigindo a linha
   `Plano de preservação:`, conferida pelo `migrations:check` (AGENTS.md).

**O achado mais urgente** é C1. O cadastro real do depot ZIRAN tem
**ARMAZENAGEM 20''** (R$ 1,58/dia) e **ARMAZENAGEM 40''** (R$ 3,14/dia), mas
o sistema só aceita uma linha de armazenagem por depot e condição, sem tipo
de container. Ele também escolhe ao acaso qual dos dois serviços o
**Lançar armazenagem** usa. O primeiro embarque com unidades do ZIRAN sai com
o valor de armazenagem errado.

## 1. Como o fluxo funciona hoje

### 1.1 Criar o embarque

Em **Embarque de vazios**, o botão **Novo embarque** pede **Viagem**,
**Porto de embarque** (entre as escalas brasileiras da Viagem) e **Terminal**
(o da frente Vazios EXP da escala; ADR 0113). O banco aceita um embarque por
escala (`vazios_export_operations`, único por `(voyage_id, embark_port)`). O
embarque não guarda POD, data, navio de destino nem número de manifesto. Ele
é só a âncora da escala. **Código:** `create_vazios_export_operation`
(migration `541`).

### 1.2 Unidades embarcadas

| Campo na tela / planilha | Obrigatório | Regra | Onde aparece depois |
| --- | --- | --- | --- |
| Container | Sim | ISO `AAAA9999999`; uma vez por embarque | ADR (contagem), anexo |
| Tipo | Não | Texto livre em maiúsculas; não confere com tabela de tipos | ADR por tipo; não entra no preço |
| Local | Sim | Código de Locais, ativo | Decide depot × Embarque direto, free time, ADR por local |
| Condição | Sim | **Vazio** ou **Com material** (`vazio`, `empty`, `material`, `com material`, `loaded`) | Free time aplicado; linha de armazenagem por condição |
| Entrada / Saída | Só para Depot | Saída ≥ entrada; Terminal portuário não aceita datas | Dias de armazenagem; anexo do ADR |
| Embarque | Não | Não pode ser antes da saída do depot | Só na tabela do Embarque; não vai ao ADR |
| **Porto de descarga** | — | **Não existe** | — |

A importação é tudo ou nada: uma linha com erro recusa a planilha inteira.
A reimportação atualiza por container, preserva a unidade incluída à mão e
tira a unidade de planilha anterior que o arquivo novo não traz (migration
`187`). **Código:** `src/services/vaziosImport.ts`,
`import_vazios_bookings_transactional_legacy_189` (definição vigente na
migration `573`), `validate_vazios_booking_operation` (migration `326`).
**Teste:** `vaziosImportUpsert.test.ts`, `vaziosReimportacao.local-pg.test.ts`.

### 1.3 Vínculo do local com Locais (depots e terminais)

- **Como casa.** A planilha casa por código, `lower(d.code) = lower(btrim(local))`.
  Uma planilha com "Capixaba" no lugar de "CAPIXABA TERMINAIS" é recusada com
  "local não encontrado em Locais". Não há apelido por local, como existe para
  portos.
- **O que o tipo decide.** O **Depot** exige as duas datas, aplica o
  **Free time vazio** ou o **Free time material** e gera armazenagem. O
  **Terminal portuário** é Embarque direto: sem datas, sem armazenagem, mas
  com serviços lançáveis.
- **O que não é conferido.**
  - O Depot não tem porto no cadastro (`depots.port_id` só vale para
    terminal), então qualquer depot entra em qualquer escala.
  - Um Terminal portuário de **outro porto** é aceito como Embarque direto: a
    validação olha só tipo e ativo, nunca o porto do embarque.
  - Um Terminal portuário do mesmo porto, mas diferente do terminal do
    embarque, também passa sem aviso.

  **Código:** `validate_vazios_booking_operation`, `vaziosImport.ts`
  (`validateLocalAgainstDepots`).
- **Onde o local pesa no cálculo:**
  1. qual free time vale;
  2. o agrupamento dos dias em **Armazenagem a lançar** (depot × condição);
  3. quais serviços a janela **Lançar linha** oferece (o catálogo é do local);
  4. o valor sugerido;
  5. as contagens por local no ADR e no bloco de exportação da Viagem.
- **Onde o local não pesa:** na quantidade de handling, transporte ou
  overtime. A linha de serviço não aponta para unidades (ADR 0033), então
  "quantos containers saíram do depot X" nunca chega sozinho à linha.

O mesmo cadastro de Locais é também o cadastro de terminais do sistema
inteiro: frentes da escala, terminal do B/L, ADR por terminal e Portal.
Trocar o código ou desativar um local tem efeito fora do Embarque de vazios.

### 1.4 Linhas de serviço e catálogo

A janela **Lançar linha** pede Local, Natureza, Serviço (do catálogo do
local), Quantidade e Valor unitário. O valor vem sugerido do catálogo e pode
ser alterado. O total é `quantidade × valor unitário`. A Natureza decide a
validação no banco:

- **Armazenagem** exige Depot e uma linha por depot e condição.
- **Transporte** exige o destino do serviço.
- **Geral** pede só o local.

**Código:** `validate_vazios_export_service_line` (migration `331`),
índice `uq_vazios_storage_line_operation_local_condition`,
`src/services/vaziosCusto.ts`.

Depois de lançada, a linha só aceita **Observação** e **Excluir**. Para
corrigir quantidade ou valor, é preciso excluir com motivo e lançar de novo
(**Código:** `EmbarqueVazios.tsx`, ações da tabela de linhas).

### 1.5 Armazenagem, passo a passo

1. Para cada unidade de Depot: `dias = (saída − entrada + 1) − free time`,
   nunca negativo. O +1 conta o dia de entrada e o de saída. O free time é o
   do depot para a condição da unidade, lido **na hora** do cadastro de
   Locais.
2. Os dias somam por (depot, condição).
3. **Armazenagem a lançar** lista as combinações com dias > 0 e sem linha
   ainda. **Lançar armazenagem** grava a linha com o serviço de armazenagem
   do depot para aquela condição (ou o genérico, sem condição), a quantidade
   calculada e o valor do catálogo.
4. Enquanto **Informar a quantidade à mão** não for usado, a quantidade da
   linha é recalculada a cada leitura a partir das unidades. Mudou a planilha,
   mudou a quantidade.

Exemplo: uma unidade no ZIRAN, Vazio, com entrada em 01/10 e saída em 05/11,
tem 36 dias. Menos 30 de free time, dá 6 dias cobráveis. Outra unidade, com
entrada em 20/10, tem 17 dias e não cobra nada.

**Código:** `diasCobraveis`, `armazenagemPorDepotCondicao`,
`armazenagemALancar`, `quantidadeEfetiva` em `vaziosCusto.ts`. **Teste:**
`vaziosCusto.test.ts`.

### 1.6 O que vai para o ADR

| ADR — aba | ADR — impresso | De onde vem | Observação |
| --- | --- | --- | --- |
| **Containers embarcados**: "N vazios embarcados" e tabela Tipo × Local | **Embarque de vazios**: Tipo, Condição, Local, Quantidade | Unidades | Sem POD, sem TEU, sem data de embarque |
| **Operação de pátio**: "N dias de storage", **Containers em storage**, **Unidades sem armazenagem**, **Depots / terminais**, **Total da operação** | **Operação de vazios**: Embarque direto, Depots | Unidades + depots | Rótulos divergentes (C3, C4) |
| Tabela de Linhas de serviço | **Linhas de serviço do embarque** + TOTAL | Linhas | Coluna Tipo sempre "—"; Rota mostra só o destino (C6, C7) |
| — | **Storage**: Containers, Dias | `computeStorageTotals` | Conta unidade dentro do free time; ignora a quantidade à mão (C2, C4) |
| — | **Anexo — unidades que geraram armazenagem** | Unidades com entrada e saída | Inclui quem não gerou armazenagem; não mostra dias (C2) |

A seção tem uma resolução só, de Equipamentos (ADR 0036). O fechamento
congela o que a tela calculou (`closed_snapshot`). Antes de fechar, os números
mudam sempre que unidade, linha ou free time mudam. **Código:**
`src/services/agencyDepartureReport.ts`,
`src/components/voyages/VoyageAgencyReportTab.tsx`,
`src/components/voyages/AgencyReportDocument.tsx`.

## 2. O que o cadastro real mostra (Runtime, produção, 2026-11-06)

| Local | Tipo | Free time vazio / material | Armazenagem cadastrada |
| --- | --- | --- | --- |
| CAPIXABA TERMINAIS | Depot | 60 / 60 | EMPTY (Vazio) R$ 2,81; FULL (Com material) R$ 6,71 |
| J&W | Depot | 25 / 25 | Só Vazio, R$ 4,00 |
| PONTUAL | Depot | 21 / 21 | Só Vazio, R$ 4,00 |
| TCVV | Depot | 60 / 60 | Só Vazio, R$ 2,15 |
| ZIRAN | Depot | 30 / 30 | **Duas para Vazio: 20'' R$ 1,58 e 40'' R$ 3,14** |
| WINDROSE | Depot | 0 / 0 | Nenhum serviço |
| PENEDO, PORTMAC, TECON SSA, TVV | Terminal portuário | — | PENEDO tem um transporte; os outros três, nenhum serviço |

O que o catálogo revela sobre o modelo:

- **O preço varia por tamanho de container, e o modelo não tem tamanho.**
  Armazenagem 20''/40'' (ZIRAN) e transporte "1X40''", "2X20''" e
  "40HC/40GP/2*20GP" estão todos codificados no **nome** do serviço. O
  catálogo grava serviço sem tipo de container, e a linha também não tem
  tipo.
- **O handling varia por condição** (CAPIXABA: HANDLING IN/OUT EMPTY R$ 67,10
  × FULL R$ 207,40). Ele é lançado como Geral, com a quantidade contada à mão.
- **O overtime é um serviço com o percentual no nome** ("OVERTIME HANDLING
  OUT 50%", R$ 45,00 = 50% de R$ 90,00), como a ADR 0033 decidiu.
- **Dados para Equipamentos conferir:**
  - "TRANSPORTE 1X20''" está como **Geral**, sem destino, no J&W e no
    PONTUAL, enquanto "1X40''" e "2X20''" são **Transporte** com destino.
  - No PONTUAL, "TRANSPORTE 1X20''" custa R$ 732,60, o mesmo que "1X40''". No
    J&W, o 1X20'' custa a metade.
  - "TRANSPORTATION FR/20 PARCIAL" aparece duas vezes no CAPIXABA.
  - Dois nomes terminam com espaço ("ARMAZENAGEM ", "CNTR W/ MATERIAL
    REORGANIZATION ").
  - WINDROSE está ativo, sem serviço e com free time zero.
  - Quatro depots não têm armazenagem para **Com material**. Uma unidade com
    material neles mostra "Sem serviço de armazenagem cadastrado".

## 3. Achados

### Correções: o sistema calcula ou mostra algo errado

| # | Gravidade | O que acontece | Efeito | Evidência |
| --- | --- | --- | --- | --- |
| C1 | Alta | A armazenagem não separa 20' de 40'. O banco aceita **uma** linha por (embarque, depot, condição), sem tipo de container, e **Lançar armazenagem** escolhe o primeiro serviço que a consulta devolve (`.find` sobre `listArmazenagemServices`, sem ordem). | No ZIRAN, 10 × 20' e 10 × 40' com 6 dias cobráveis cada deveriam custar 60 × 1,58 + 60 × 3,14 = **R$ 283,20**. O sistema lança 120 × 1,58 = R$ 189,60 **ou** 120 × 3,14 = R$ 376,80, conforme a ordem do banco, e recusa a segunda linha. | **Código:** `EmbarqueVazios.tsx` (busca do serviço da Armazenagem a lançar), `listArmazenagemServices` em `src/services/depots.ts`, índice `uq_vazios_storage_line_operation_local_condition`, `validate_vazios_export_service_line` (recusa tipo na armazenagem). **Runtime:** catálogo do ZIRAN. |
| C2 | Média | **Anexo — unidades que geraram armazenagem** lista toda unidade com entrada e saída, inclusive a que ficou dentro do free time. O **Storage → Containers** do impresso e o **Containers em storage** da aba contam do mesmo jeito. | O Financeiro recebe uma lista maior do que a cobrança e sem os dias por unidade, então não consegue conferir a fatura do depot pelo anexo. | **Código:** `vaziosUnidadesComPeriodo` em `AgencyReportDocument.tsx`; `computeStorageTotals` em `vaziosExportOperations.ts`. |
| C3 | Baixa | Na aba, **Unidades sem armazenagem** conta só o Embarque direto. A unidade de depot dentro do free time também está sem armazenagem e não entra. O impresso chama o mesmo número de **Embarque direto**. | O mesmo número tem dois nomes, e um deles diz outra coisa. | **Código:** `directEmbarkCount` em `VoyageAgencyReportTab.tsx`. |
| C4 | Baixa | **Depots / terminais**, na aba, lista só depots (filtra `tipo === 'depot'`). **Storage → Dias** e **N dias de storage** usam a conta calculada e ignoram **Informar a quantidade à mão** da linha. | Com quantidade à mão, a mesma seção mostra dois totais de dias diferentes sem explicar. | **Código:** `depots`, `hasPatioOperation` e `data.storage` em `VoyageAgencyReportTab.tsx`. |
| C5 | Média | O free time é lido do cadastro na hora; a linha não guarda o free time aplicado. | Trocar o free time de um depot muda a armazenagem de **todo** embarque com ADR aberto, inclusive os antigos e os reabertos. Um embarque com ADR fechado passa a mostrar na tela um número diferente do impresso congelado. O catálogo não tem vigência (ADR 0033), mas o valor unitário fica na linha e o free time não. | **Código:** `diasCobraveis` lê `depots.free_time_*`; `vazios_export_service_lines` não tem coluna de free time. |
| C6 | Baixa | A coluna **Tipo** das linhas de serviço sai "—" em toda linha nova, no Embarque, na aba ADR e no impresso. | Coluna morta no documento que vai ao Financeiro. | **Código:** as três tabelas; [manifesto-edi.md](../../modules/manifesto-edi.md#embarquevazios) já registra "a coluna Tipo das linhas novas fica —". |
| C7 | Baixa | A coluna **Rota** mostra só o destino. A origem é o Local, em outra coluna. Fora do transporte, aparece "Sem rota" ou "—". | Leitura confusa da rota. | **Código:** `VoyageAgencyReportTab.tsx`, `AgencyReportDocument.tsx`. |
| C8 | Média | O local da unidade não é conferido contra o porto: Terminal portuário de outro porto passa como Embarque direto, e Depot não tem porto. | Um erro de código na planilha (por exemplo, TECON SSA num embarque de Vitória) vira Embarque direto válido, sem armazenagem, e some da conta. | **Código:** `validate_vazios_booking_operation`, importação. **Runtime:** nenhum depot tem porto. |
| C9 | Baixa | O leitor não aceita a condição "EMPTY W/ MATERIAL", que é o rótulo que o próprio ADR usa. Também não reconhece os cabeçalhos do relatório real de depot citado na ADR 0031 (IMPORT EMPTY RETURN DATE, EMPTY GATE OUT, Current Status). | Converter o relatório do depot para o modelo de sete colunas é trabalho manual e fonte de erro. | **Código:** `parseCondition` e `HEADER_MAP` em `vaziosImport.ts`; `VAZIOS_CONDITION_LABELS` em `agencyDepartureReport.ts`. |
| C10 | Baixa | A data de **Embarque** é opcional e não é comparada com a Atracação do terminal (ATB/ATD). | Uma data de embarque fora da escala passa calada. Ela também não vai ao ADR. | **Código:** `validate_vazios_booking_operation`; constraint `vazios_bookings_movement_after_hand_out` (migration `065`) só compara com a saída do depot. |
| C11 | Baixa | A Linha de serviço não se edita: corrigir valor ou quantidade exige excluir com motivo e lançar de novo. | Atrito e rastro poluído para uma correção de digitação. | **Código:** ações da tabela de linhas em `EmbarqueVazios.tsx`. |

### Lacunas: falta capacidade para "informar todos os fatos do embarque"

| # | O que falta | Por que importa | Evidência |
| --- | --- | --- | --- |
| L1 | **Porto de descarga (POD) por unidade** | Saber para onde cada vazio vai: conferência com o armador, ADR por destino e rota do Manifesto Mercante de exportação. | **Código:** `vazios_bookings.pol/pod` existem desde a migration `053` e não são gravados nem lidos por nenhuma tela, RPC ou relatório. A [spec de 2026-09-17](../specs/2026-09-17-manifesto-mercante-design.md) já pedia "porto de origem e de destino" no embarque. |
| L2 | **Manifesto Mercante dos vazios de exportação** | A mesma spec decidiu: "Vazios geram manifesto? Sim, importação e exportação; sem CE". Hoje a aba **Rotas e Manifestos** e o **Gerar EDI Mercante** só conhecem rotas de importação: B/Ls e Vazios de importação. | **Código:** `vaziosRoutes` vem de `vaziosImpStats` em `VoyageCard.tsx`; o EDI Mercante (ADR 0116) é de importação. |
| L3 | **Tamanho do container no catálogo e na linha** | Armazenagem e transporte reais variam por 20'/40' (seção 2). Sem isso, C1 não se resolve, e o tipo fica escondido no nome do serviço. | **Runtime:** catálogo. **Código:** catálogo e linha sem tipo ([manifesto-edi.md](../../modules/manifesto-edi.md#embarquevazios), "Valor da linha"). |
| L4 | **Quantidade sugerida para handling e transporte** | Handling in/out é 1 por unidade do depot (por condição, no CAPIXABA). Transporte é por viagem de caminhão (1×40 ou 2×20) do depot ao terminal. Tudo isso pode ser contado pelas unidades, como já se faz com a armazenagem. Hoje é contado à mão. | **Código:** quantidade inicial 0 na janela **Lançar linha**; só a armazenagem tem quantidade calculada. |
| L5 | **Apelidos do local** | Para a planilha do depot casar sem reescrever a coluna LOCAL. | **Código:** casamento só por código. |
| L6 | **Conferências cruzadas** | (a) Embarque direto: o container deveria ter descarregado neste porto (Vazios de importação ou B/L). (b) A entrada no depot costuma ser a devolução do container de importação (`bl_containers.return_date`, Demurrage). (c) A quantidade embarcada pode ser comparada com o planejado da exportação da escala (`voyage_export_schedules.containers_qty`). | **Suspeita** de valor operacional: não verificado com Equipamentos se essas três fontes batem na prática. |
| L7 | **Unidades vindas do terminal** | O Baplie de saída ou o relatório de carregamento do terminal traz container, tipo, POD e data de embarque. Ele pode alimentar ou conferir a lista em vez de depender só da planilha do depot. | **Suspeita:** o Vela importa Baplie para a descarga; não foi verificado se a agência recebe o Baplie de saída de cada escala. |
| L8 | **TEU e data no ADR** | Vazios descarregados mostram TEU; o Embarque de vazios não. A data de embarque não aparece em lugar nenhum do ADR. | **Código:** `AgencyReportDocument.tsx`. |
| L9 | **Um terminal por escala** | Vazios embarcando por dois terminais na mesma escala exigem outra decisão (limite registrado na ADR 0113). | ADR 0113, Consequências. |

## 4. Melhorias propostas, em lotes

### Lote A: correções sem decisão de negócio nova

1. **Anexo e Storage dizem o que contam (C2, C4).** O anexo passa a ter as
   colunas Dias no depot, Free time e **Dias cobráveis**, com total, e lista
   só as unidades com dias cobráveis maiores que zero. Pode também ganhar a
   linha "N unidades dentro do free time" para fechar a conta. **Containers
   em storage** vira "Unidades com armazenagem". **Storage → Dias** passa a
   ser a soma das quantidades efetivas das linhas, com o calculado ao lado
   quando houver quantidade à mão.
2. **Rótulos coerentes (C3, C4).** Na aba, **Embarque direto** no lugar de
   **Unidades sem armazenagem**, e **Depots** no lugar de **Depots /
   terminais**, ou listar os dois.
3. **Coluna Rota "origem → destino" e fim da coluna Tipo morta (C6, C7)**, a
   menos que o Lote C devolva o tipo à linha.
4. **Leitor da planilha (C9).** Aceitar "EMPTY W/ MATERIAL" e "FULL" como
   Com material e adicionar os cabeçalhos do relatório real como apelidos.
5. **Terminal do porto certo (C8).** Recusar Terminal portuário de outro porto
   como Embarque direto e avisar, sem recusar, quando o terminal da unidade
   difere do terminal do embarque.
6. **Editar Linha de serviço (C11)** com o mesmo rastro de alteração das
   outras escritas.

### Lote B: porto de descarga (L1, L8; L2 depende de decisão)

- Coluna **POD** obrigatória na planilha e campo na janela **Adicionar
  unidade**, validados pelo catálogo de portos (`normalize_port_code`, como
  nos Vazios de importação). O POL é o porto do embarque, derivado e não
  digitado. Usa as colunas `pol`/`pod` que já existem.
- No ADR, a listagem ganha o eixo POD: Tipo × Condição × Local × **POD**, ou
  um quadro "por destino". Entram também TEU e o período das datas de
  embarque.
- Se o dono confirmar L2: a aba **Rotas e Manifestos** ganha a linha VAZIOS
  de exportação por rota (porto do embarque → POD), com o Nº do Manifesto
  Mercante e o alerta **CE Mercante pendente**, como já acontece na
  importação. O EDI Mercante de exportação seria um passo seguinte.

### Lote C: serviços por tamanho e quantidades sugeridas (C1, L3, L4)

- O serviço do catálogo ganha **Tamanho** (20', 40' ou qualquer). A linha de
  armazenagem passa a ser única por (depot, condição, tamanho), e **Armazenagem
  a lançar** soma os dias por (depot, condição, tamanho). Isso resolve o ZIRAN
  sem truque de nome.
- **Quantidade sugerida** na janela **Lançar linha**, pelo mesmo padrão da
  armazenagem: calculada, visível e substituível à mão.
  - Handling in/out = unidades do local (por condição, quando o serviço tem
    condição).
  - Transporte = unidades do local até o terminal, convertidas em viagens
    pelo tamanho (1×40 ou 2×20).
  - Overtime, visual check, bundle e reorganização continuam digitados.

  A linha continua sendo lançada por alguém (ADR 0033 preservada: o sistema
  não presume que o serviço aconteceu, só faz a conta).
- **Congelar o free time na linha de armazenagem (C5)** no lançamento, e
  mostrar quando o cadastro mudou depois.

### Lote D: automação das fontes (L5, L6, L7), depois de ouvir Equipamentos

- **Apelidos por local** em Locais, aprendidos na prévia ("Associar 'Capixaba'
  a CAPIXABA TERMINAIS").
- **Conferências na prévia**, como avisos e não recusas:
  - Embarque direto sem descarga do container neste porto;
  - entrada no depot diferente da devolução registrada em Demurrage;
  - quantidade embarcada diferente da planejada na exportação da escala;
  - data de embarque fora da Atracação (C10).
- Se a agência recebe o Baplie de saída ou o relatório de carregamento do
  terminal: usá-lo para preencher container, tipo, POD e data de embarque e
  cruzar com a planilha do depot.

### Lote E: catálogo (dados, não código)

Equipamentos confere os itens da seção 2 em **Locais (depots e terminais)**:

- os transportes "1X20''" como Geral;
- o preço do 1X20'' no PONTUAL;
- o serviço duplicado no CAPIXABA;
- WINDROSE ativo e sem serviço;
- a falta de armazenagem Com material em quatro depots;
- os terminais sem serviço.

## 5. Decisões que dependem do dono

1. **POD por unidade é obrigatório?** Recomendação: sim, na planilha e na
   inclusão manual. Sem POD não há rota de exportação.
2. **Os vazios de exportação geram Manifesto Mercante (e EDI) no Vela?** A
   spec de 2026-09-17 diz que sim. Confirmar antes de construir o Lote B
   completo.
3. **Tamanho no catálogo (Lote C).** Aceitar que a armazenagem e o transporte
   tenham preço por tamanho, mudando a regra "uma armazenagem por depot e
   condição" da ADR 0033.
4. **Quantidade sugerida para handling e transporte.** É uma extensão da ADR
   0033: a linha continua manual, a conta vira sugestão. Precisa de ADR nova
   ou de banner "Situação atual" na 0033.
5. **Free time congelado na linha** ou free time com vigência no cadastro.
6. **Quais fontes automáticas existem de fato** (Baplie de saída, relatório
   de carregamento do terminal, relatório do depot) e em que formato. Essa
   pergunta é para Equipamentos.

## 6. Evidência e limites desta revisão

- **Código:** leitura das telas `EmbarqueVazios.tsx`, `DepotCadastro.tsx`,
  `VoyageAgencyReportTab.tsx` e `AgencyReportDocument.tsx`; dos serviços
  `vaziosImport.ts`, `vaziosExportOperations.ts`, `vaziosCusto.ts`,
  `agencyDepartureReport.ts` e `depots.ts`; e das definições vigentes de
  `import_vazios_bookings_transactional*` (migrations `408` e `573`),
  `validate_vazios_booking_operation` (`326`),
  `validate_vazios_export_service_line` (`331`) e
  `create_vazios_export_operation` (`541`).
- **Runtime:** duas consultas somente leitura na produção (projeto Vela,
  migration `599`) em 2026-11-06: contagem de embarques, unidades e linhas
  (todas zero) e o catálogo de Locais e serviços (seção 2). Nenhuma escrita.
- **Não verificado:** a tela rodando (nenhum fluxo foi exercido no navegador),
  os testes listados (citados, não executados) e o formato real dos relatórios
  de depot e de terminal. As conferências L6 e L7 são hipóteses de valor
  operacional, não fatos.
