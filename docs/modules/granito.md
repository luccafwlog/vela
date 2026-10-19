# Granito

> **Status:** ativo · **Atualizado:** 2026-10-19 · **Rotas:** `/granito` (`/granito/taxas` leva a `/granito`)

## Propósito e escopo

Granito é o pipeline das planilhas COSCO de blocos de granito embarcados. Ele
serve **só para totalizar a carga movimentada no navio**: quantos B/Ls, quantos
blocos e quanto peso cada navio e viagem levou (regra decidida pelo
responsável em 2026-10-19, no lote 5b da
[identidade visual](../identidade-visual.md)).

- **Sem Cliente.** O B/L de Granito não tem Cliente vinculado. A importação
  grava o shipper como veio na planilha, sem procurar Cliente pelo CNPJ, sem
  sugestão por nome e sem pendência. O Granito não entra na Revisão nem abre
  alerta de Cliente não vinculado.
- **Sem taxa.** Não há cálculo de taxas, tarifa nem fatura de Granito; ele não
  entra na Validação de Taxas Locais.
- **Sem CE.** A planilha de CE Mercante não grava CE em B/L de Granito.

As colunas e tabelas do modelo anterior (`granite_bls.client_id`,
`suggested_client_id`, `charge_status`, `granite_rates`, `granite_bl_charges`
e `invoice_granite_bls`) continuam no banco, sem uso, até uma limpeza à parte;
o que já estava gravado nelas não foi apagado.

A rota é interna e fica sob `ProtectedRoute` em
[`src/AppInterno.tsx`](../../src/AppInterno.tsx). Qualquer Departamento ativo,
inclusive Equipamentos, importa a planilha COSCO (ADR 0078, item 10). As
tabelas operacionais (`granite_manifests`, `granite_bls`) aceitam leitura,
inserção e edição de usuário ativo; a exclusão é só pelas RPCs com motivo e
Trava (`delete_records` e a reimportação): o DELETE direto saiu na migration
`235`.

Fontes executáveis principais:

- [`src/pages/Granite.tsx`](../../src/pages/Granite.tsx);
- [`src/services/graniteImport.ts`](../../src/services/graniteImport.ts)
  (leitura e importação da planilha) e
  [`src/services/graniteCargo.ts`](../../src/services/graniteCargo.ts)
  (consulta, regra do peso e resumo por viagem);
- entrada pela Viagem em
  [`src/components/shared/VoyageImportActions.tsx`](../../src/components/shared/VoyageImportActions.tsx);
- banco: `import_granite_manifest_transactional` na definição da migration
  `325` (corpo da `206`).

## Anatomia das telas

### `/granito`

[`src/pages/Granite.tsx`](../../src/pages/Granite.tsx), na ordem das telas de
lista da identidade visual:

- **Título** "Granito" e, no topo, só **Importar planilha COSCO**.
- **Três cartões de total do recorte** (`MetricCard`): B/Ls, Blocos e Peso
  (em t, uma casa), todos "no recorte".
- **Filtros** sempre abertos: **Busca** por B/L ou shipper (com pausa na
  digitação), **Viagem** (navio ou viagem; `?voyage=` semeia o filtro) e
  **POD**, lista dos portos de descarga do recorte. **Limpar filtros** aparece
  com algum filtro ativo; o vazio com filtro diz os filtros pelo nome do navio
  e da viagem, nunca pelo número interno.
- **Carga por viagem**: uma linha por navio e viagem e trecho, com Navio /
  Viagem (link para a ficha da Viagem), Trecho (POL → POD), B/Ls, Blocos e
  Peso. É o número que a tela existe para dar.
- **B/Ls de Granito**: B/L (com o ícone de copiar; não abre ficha, porque não
  há o que ver além da linha), Shipper (como veio na planilha), Navio /
  Viagem, Trecho, Blocos e Peso. A faixa do bloco repete os totais; uma nota
  explica a regra do peso; **Por página** fica no rodapé.
- **Peso** em toda a tela: o peso real quando a planilha traz; sem ele, o
  declarado pelo shipper (`graniteWeightKg`).

A janela **Importar planilha COSCO** pede a Viagem de destino e o arquivo
`.xls/.xlsx`, diz as colunas obrigatórias (BL e Real Weight) e mostra a
prévia: B/Ls válidos, Blocos, Peso e Erros de leitura, mais as primeiras 50
linhas (B/L, Shipper, Trecho, Blocos, Peso) e o relatório de erros exportável.
Com erro de leitura a confirmação fica bloqueada.

### `/granito/taxas`

Saiu do sistema em 2026-10-19, junto com o cálculo de taxas: sem Cliente, não
há a quem cobrar. O endereço leva a `/granito`. As tarifas gravadas em
`granite_rates` ficam no banco, sem tela.

### Entrada por `/viagens/:voyageId`

Na aba Exportação, [`VoyageImportActions`](../../src/components/shared/VoyageImportActions.tsx)
abre um [`FileImportModal`](../../src/components/shared/FileImportModal.tsx)
já associado à viagem, com o mesmo parser e importador. A prévia resume B/Ls,
blocos, toneladas (pela regra do peso) e erros; aceitar erros de linha
(`allowRowErrors`) exige decisão explícita do operador. A ação "CE Mercante
(Granito)" saiu.

### Superfícies que leem o Granito

- O ADR de Saída (seção **Carga carregada**), a aba Exportação e o card da
  Viagem leem B/Ls, blocos e peso de `granite_manifests` e `granite_bls`; a
  Line Up marca a exportação com Granito pela declaração da escala. Continuam
  iguais.
- A Revisão e a Validação de Taxas Locais não leem mais o Granito.
- Faturas antigas de Granito continuam consultáveis em `/taxas-locais` →
  Faturas, pelas superfícies genéricas de faturamento.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/granito` · filtrar e listar | Sessão interna | `Granite` | `listGraniteBls` (página) e `fetchGraniteCargoRows` (recorte inteiro, sem o POD, em páginas de 1.000) → `summarizeGraniteCargo` | SELECT em `granite_bls` com `granite_manifests!inner`, `voyages`, `vessels` | `queryKeys.granite.bls(filtros)` e `queryKeys.granite.cargo(filtros)`; troca de filtro volta à página 1 | Erro de leitura mostra o aviso com **Tentar novamente**; sem dado, os cartões mostram "—" | **Código:** [`Granite.tsx`](../../src/pages/Granite.tsx), [`graniteCargo.ts`](../../src/services/graniteCargo.ts) · **Teste:** `graniteCargo.test.ts`, `Granite.behavior.test.tsx` |
| `/granito` · abrir a importação e escolher a Viagem | Usuário interno ativo, de qualquer Departamento (ADR 0078, item 10) | `Granite` → `GraniteImportModal`; `VoyageCombobox` | A seleção só prepara os argumentos do importador | Leitura de viagens | Estado local | Sem viagem, arquivo ou usuário o botão fica desabilitado | **Código:** [`Granite.tsx`](../../src/pages/Granite.tsx) |
| `/viagens/:voyageId` · importar Granito | Viagem e usuário definidos; arquivo com B/Ls válidos | `VoyageImportActions`; `FileImportModal` | `parseGraniteManifestFile` → `importGraniteManifest` | `granite_manifests`, `granite_bls` | `afterManifestoImportado`, que inclui a família `granite-bls` (a lista do Granito se atualiza também por aqui) | Erro de leitura por arquivo; falha de gravação recusa o lote | **Código:** [`VoyageImportActions.tsx`](../../src/components/shared/VoyageImportActions.tsx) · **Teste:** `VoyageImportActions.behavior.test.tsx` |
| Ler a planilha COSCO | Arquivo `.xls`/`.xlsx` dentro do limite; primeira aba visível com o cabeçalho COSCO | `handleFile` ou parser do modal genérico | `assertUploadFile` → `readSheet` (primeira aba visível; linhas e abas ocultas ignoradas com aviso) → `matchHeaders`/`createHeaderMapper`; exige B/L único e `real_weight_kg > 0` | Nenhuma escrita; não consulta a base de Clientes | Retorna `ParsedGraniteManifest` com `bls` e `rowErrors` | B/L ausente/duplicado, peso ausente/zero, data de prontidão impossível ou POL/POD fora do catálogo viram erro de linha; planilha sem as colunas obrigatórias é recusada ("Planilha inválida. Colunas obrigatórias: …") | **Código:** [`graniteImport.ts`](../../src/services/graniteImport.ts), [`importCore.ts`](../../src/services/importCore.ts) · **Teste:** `graniteParse.test.ts` |
| Confirmar importação | Viagem existente; usuário; ao menos um B/L válido | `GraniteImportModal.handleImport` ou importer de `VoyageImportActions` | `importGraniteManifest` soma o peso, lê os B/Ls já gravados na Viagem (`graniteImportScope`) e, com B/L em comum, pede confirmação para tirar os ausentes dos manifestos tocados | `import_granite_manifest_transactional` (migration `325`, corpo da `206`; uma transação): ignora `client_id` e `suggested_client_id` do arquivo; manifesto novo quando não há B/L em comum; com B/L em comum, atualiza pelo número (preservando o CE já gravado), inclui os novos e tira os ausentes só com confirmação, com Histórico; ausente com Invoice antiga nunca sai | Fecha a janela; invalida o Granito, a Viagem, o ADR e a Line Up; o aviso diz manifesto novo, novos, atualizados, retirados e mantidos | Viagem ausente, B/L repetido ou erro de escrita recusa tudo; as recusas conhecidas chegam em português, e erro desconhecido vira "Não foi possível importar a planilha do Granito. Tente novamente." (achado G7) | **Código:** [`graniteImport.ts`](../../src/services/graniteImport.ts) · **Teste:** `graniteImportAtomic.test.ts`; **Teste local-pg:** `granitoReimportacao.local-pg.test.ts`, `granitoSemCliente.local-pg.test.ts` |

## Estado e dados

- **`granite_manifests`:** cabeçalho por importação, associado à viagem, com
  portos, quantidade de B/Ls, peso total (soma do peso real) e autor.
- **`granite_bls`:** entidade própria com UUID e os dados COSCO (shipper, CNPJ
  do shipper como veio, portos, blocos, `real_weight_kg`,
  `shipper_weight_kg`, `final_m3`, fase). Não tem FK nem identidade
  compartilhada com `bls`. `ce_mercante` continua único quando preenchido
  (gatilho `guard_ce_mercante_unique`), mas nenhuma tela grava CE de Granito.
- **Colunas sem uso desde a `325`:** `client_id`, `suggested_client_id` e
  `charge_status` (valores antigos ficam; a importação nova não preenche
  vínculo nem sugestão, e o reimportado mantém o que já tinha).
- **Tabelas sem uso desde a `325`:** `granite_rates` (tarifas),
  `granite_bl_charges` (snapshots de cálculo) e `invoice_granite_bls`
  (vínculos de faturas antigas, ainda lidos pelo detalhe da fatura).
- **Peso exibido:** `graniteWeightKg` usa o peso real quando ele existe e é
  maior que zero; senão, o declarado pelo shipper; sem nenhum, a tela mostra
  "—" e o total conta zero.
- **Queries/cache:** família `queryKeys.granite` (`['granite-bls', …]`):
  `bls(filtros)` para a página e `cargo(filtros)` para os totais e a Carga por
  viagem. `afterManifestoImportado` invalida a família inteira.

## Fluxos e invariantes

```mermaid
flowchart LR
    Voyage["Viagem de destino"] --> Cosco["Planilha COSCO"]
    Cosco --> Parse["Leitura + erros por linha"]
    Parse -->|sem erro ou com aceite| Import["import_granite_manifest_transactional<br/>sem Cliente, sem cálculo"]
    Import --> Persist["granite_manifests + granite_bls"]
    Persist --> Screen["/granito: totais e Carga por viagem"]
    Persist --> ADR["ADR de Saída · Carga carregada"]
    Persist --> Export["Viagem · Exportação e Line Up"]
```

- O parser lê a primeira aba visível pelo leitor comum (`readSheet`): linhas e
  abas ocultas são ignoradas com aviso, e um B/L que só está nelas conta como
  fora do arquivo na confirmação de saída. Exige B/L e peso real positivo; B/L
  duplicado na mesma planilha é rejeitado, e o banco reforça unicidade por
  `(manifest_id, bl_number)`.
- **Reimportação e manifesto novo** (ADR 0078, item 25; ADR 0079, decisão 7;
  migrations `186`, `192`, `196` e `206`). Planilha sem nenhum B/L em comum
  com os já gravados na Viagem é outro manifesto. Com B/L em comum, a planilha
  reimporta só os manifestos que ela toca: atualiza os B/Ls pelo número,
  inclui os novos no mais recente desses manifestos e só tira os B/Ls
  ausentes do arquivo (em linha nenhuma, nem nas com erro) depois de
  confirmação, com Histórico; o B/L ausente com Invoice antiga nunca sai. Os
  totais de todos os manifestos da Viagem são refeitos a partir dos B/Ls.
- **Sem Cliente, sem cálculo** (migration `325`). A importação descarta o
  vínculo e a sugestão de Cliente que vierem no payload e tira da fila o
  efeito `granite_billing` que o corpo legado ainda enfileira; o efeito que
  já estivesse na fila termina sem agir (`skipped: granito_sem_calculo`).
  `calculate_granite_bl_charges` e `save_granite_bl_review` não são
  executáveis pela API; a planilha de CE Mercante recusa o alvo `granite`.
- **Sem alerta de Cliente.** O tipo `review_granite_customer_unlinked`
  ("Revisão de Granito — cliente não vinculado") está inativo no catálogo; o
  gatilho que o reconciliava a cada escrita em `granite_bls` saiu, o detector
  não abre nada e os alertas abertos foram fechados na `325`.

## Testes e validação

- [`graniteCargo.test.ts`](../../src/services/__tests__/graniteCargo.test.ts):
  regra do peso (real, senão declarado; sem nenhum, `null`), resumo por
  viagem e trecho, busca escapada por B/L ou shipper, filtros de Viagem e POD
  e leitura do recorte em páginas de 1.000.
- [`graniteParse.test.ts`](../../src/services/__tests__/graniteParse.test.ts):
  cabeçalhos e regras COSCO, datas e a fixture anonimizada de 19 linhas; o
  parser não consulta a base de Clientes. Não comprova upload do usuário nem
  o runtime do Supabase.
- [`graniteImportAtomic.test.ts`](../../src/services/__tests__/graniteImportAtomic.test.ts):
  uma RPC por importação, payload sem `client_id`/`suggested_client_id`,
  reimportação e mensagens de erro.
- [`Granite.behavior.test.tsx`](../../src/pages/__tests__/Granite.behavior.test.tsx):
  tela aprovada (cartões, Carga por viagem, peso pela regra, B/L sem link,
  POD em lista, filtro pelo nome da viagem) e janela de importação sem
  conferência de Cliente.
- **Teste local-pg** (PostgreSQL local com shims de Auth):
  [`granitoSemCliente.local-pg.test.ts`](../../src/integration/granitoSemCliente.local-pg.test.ts)
  (importação sem vínculo nem efeito de cálculo, alerta fechado e fora do
  catálogo, alvo `granite` recusado, grants) e
  [`granitoReimportacao.local-pg.test.ts`](../../src/integration/granitoReimportacao.local-pg.test.ts).
- Não há selo **Runtime**: a tela não foi conferida num ambiente Supabase
  remoto nesta mudança.

## Notas e divergências

- **Histórico — modelo com Cliente e taxa (até 2026-10-19).** Até a migration
  `325`, a importação reconciliava o shipper com Clientes pelo CNPJ (vínculo
  por documento, sugestão por nome; ADR 0043), o B/L sem Cliente caía na
  Revisão (`save_granite_bl_review`) e abria o alerta
  `review_granite_customer_unlinked`, a tela calculava snapshots
  quantitativos a partir de `granite_rates` (**Calcular taxas**, recálculo na
  Validação como "Apoio operacional", efeito `granite_billing` na
  importação), havia a tela `/granito/taxas` e a planilha de CE Mercante
  aceitava o alvo Granito (migration `212`). O responsável decidiu em
  2026-10-19 que o Granito não tem Cliente e serve só para totalizar a carga;
  tudo isso saiu. Antes ainda, o fluxo financeiro de Granito (emissão de
  invoice, `ready_for_billing`) já tinha sido removido; as invoices antigas e
  `invoice_granite_bls` continuam consultáveis.
- **Código — peso real obrigatório na planilha.** O parser continua exigindo
  `Real Weight` positivo em cada linha (sem ele a linha é erro). A regra
  "peso real, senão declarado" vale para tudo o que a tela mostra; se a COSCO
  passar a mandar linhas sem peso real, afrouxar o parser é uma decisão à
  parte (o ADR soma o peso real).
- **Código — leitura do recorte no navegador.** Os totais e a Carga por viagem
  somam no navegador o recorte inteiro, lido em páginas de 1.000 (`ponytail:`
  em [`graniteCargo.ts`](../../src/services/graniteCargo.ts)); com o
  histórico crescendo sem filtro de Viagem, o caminho é uma RPC de agregação.
- **Código — leitores antigos de taxa na Viagem.** O painel de Granito da aba
  Exportação da Viagem ainda mostra "Prontos" e "Faturados", contados de
  `granite_bls.charge_status` (estados do modelo anterior; ficam zerados para
  importações novas). Tirá-los é da tela da Viagem, fora deste lote.
- **Código — corpo legado ainda enfileira o efeito.** O corpo da `206`
  (`import_granite_manifest_transactional_legacy_189`) continua inserindo
  `granite_billing`; o envelope da `325` remove essas linhas na mesma
  transação (`ponytail:` na migration). Reescrever o corpo fica para a
  limpeza das colunas sem uso.
