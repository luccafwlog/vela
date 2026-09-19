# 0017 — B/L como fonte de ingestão e correção; autoridade compartilhada com o manifesto

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** B/L é fonte documental única de container; cálculo provisório pós-import e NCM persistido refinam a decisão. Proteções financeiras e correções auditadas continuam.
> Rastreabilidade: [ADR 0025](./0025-bl-fonte-documental-unica-container-atd-pol.md), [ADR 0038](./0038-taxa-local-valor-congelado-ancorado-na-escala.md), [ADR 0057](./0057-ncm-como-campo-proprio-do-bl.md); [migration ativa 060](../../supabase/migrations/060_pr698_claude_review_followup.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-07-01

## Contexto

O manifesto do armador não carrega o **valor do frete** nem as **despesas**
(THD, BAF, …), obrigatórios para manifestar a carga no Mercante. Esses valores
só existem no **B/L**. A decisão de habilitar o upload do B/L abriu uma questão
que ultrapassa "ler o frete": o `CONTEXT.md` definia o manifesto como *"a
autoridade para dados comerciais e financeiros da carga"*, e o pipeline de
importação ([ADR 0005](./0005-pipeline-importacao-viagem-staging-reconciliacao.md))
trata o manifesto como fonte comercial única, com o Baplie apenas como staging
físico.

Ao permitir que o B/L **crie** um B/L inexistente e **corrija** um já emitido
(um B/L é, na prática, corrigido após emissão), o manifesto deixa de ser a
autoridade absoluta. Ao mesmo tempo, campos do B/L (peso, containers) podem
alimentar o cálculo de Taxas Locais (`applicationBasis` `weight_ton` /
`container_distinct_voyage` / `teu` em `src/services/charges/chargeTableService.ts`),
então correções não podem colidir com faturamento já emitido
([ADR 0006](./0006-revisao-operacional-reconciliacao-cliente-gate-faturamento.md)).

O formato de frete do C5 foi validado byte a byte contra um EDI Mercante real e
aceito (ver `docs/archive/specs/2026-07-01-bl-freight-import-design.md`):
frete marítimo em campo próprio (offset 1739), despesas no bloco 3796 com código
+ tipo prepaid/collect, valor literal sem conversão de moeda.

## Decisão

1. **O B/L é uma fonte de ingestão e correção**, ao lado do manifesto. Pode
   criar um B/L completo (partes, rota, datas, containers/veículos, frete) e
   corrigir dados comerciais de um B/L existente.

2. **Autoridade compartilhada, com o manifesto como autoridade inicial.** Na
   ingestão o manifesto prevalece; um B/L emitido/corrigido pode sobrescrever
   dados comerciais depois. Toda sobrescrita é **precedida de preview do diff
   (de→para) e confirmada pelo operador**, gravando auditoria com justificativa
   automática. Nada é sobrescrito em silêncio (contraste deliberado com a
   conciliação campo-a-campo do Baplie, que aqui seria cerimônia excessiva).

3. **Proteção de faturamento por campo.** Campos comerciais são sempre
   corrigíveis. **Peso** e **conjunto de containers** só são corrigíveis via
   B/L enquanto o B/L não tiver cálculo de taxa nem invoice; havendo cobrança, a
   correção desses dois campos é bloqueada e sinalizada ao operador. Nenhuma
   correção via B/L recalcula, cancela ou altera cobranças.

4. **Frete & Despesas do BL não integram Taxas Locais.** São dado declarado ao
   Mercante (campo de frete do C5 + bloco de despesas), com moeda original
   preservada apenas para exibição/auditoria e valor gravado literal.

## Nota editorial — 2026-07-01 (refino da proteção de faturamento)

A implementação (`import_bl_freight_transactional` na migration
`162_bl_freight_lines.sql` + `src/services/blFreightImport.ts`) **refina a
decisão 3**, que na redação original bloqueava peso e conjunto de containers em
bloco. O bloqueio total mostrou-se largo demais e derrubava o B/L inteiro quando
só um campo era sensível. O modelo corrente identifica exatamente as **variáveis
de faturamento** (ver `chargeTableService.ts`) e, em vez de descartar, **informa
e oferece override auditado**:

- **Sempre corrigíveis** (não são variáveis de faturamento): campos comerciais,
  frete/despesas, **CBM**, e **peso quando a carga é `container`**.
- **Impacto de faturamento** (informado; aplicado só com override explícito do
  operador): **quantidade de containers**, **container compartilhado com outro
  B/L** (`container_distinct_voyage`), **perfil IMO/OOG**, **peso quando a carga
  é `carga_solta`** (`weight_ton`) e **mudança do CNPJ faturado**.
- O override é decidido no preview e auditado como `FATURAMENTO_SOBRESCRITO`; sem
  override, a mudança com impacto vira `ALTERACAO_OPERACIONAL_BLOQUEADA` e os
  demais campos são aplicados normalmente (o B/L não é mais descartado inteiro).
- `granito` mantém seu fluxo de faturamento próprio; se passar a fluir por este
  import, o mesmo gate de peso deve ser estendido (`ponytail`).

Assim, "bloqueada por design" (última consequência) passa a ser "**bloqueada por
padrão, sobrescrevível com auditoria**".

## Nota editorial — 2026-07-01 (autoridade co-primária e viagem declarada)

A redação original chamava o manifesto de **autoridade inicial** e tratava o B/L
como fonte secundária de ingestão/correção. O uso real derrubou essa hierarquia:
o arquivo do B/L é uma **forma primária de introduzir os B/Ls de uma viagem**, e
a operação pode rodar **só com B/Ls, dispensando o manifesto**. A decisão evolui:

- **Autoridade co-primária.** Manifesto e B/L são fontes de ingestão de igual
  status. Nenhuma é autoridade por decreto: a precedência é **temporal** (quem
  cria o B/L primeiro) somada ao gate de faturamento da decisão 3. Toda
  sobrescrita segue precedida de preview do diff + auditoria. `CONTEXT.md`
  redefine **Manifesto** e **B/L** como fontes co-primárias.
- **Viagem declarada e existente.** Todo import de B/L exige o operador
  **apontar navio + viagem por busca preditiva** (ver ADR 0018); a viagem
  **precisa existir** (criada antes via "Nova Viagem"). Dispensa-se o manifesto,
  não a criação da Viagem — que segue sendo a unidade principal da operação.
- **Divergência bloqueia.** O parser lê navio+viagem do arquivo do B/L (`A18`);
  se divergirem da viagem apontada, a linha é bloqueada e **não grava**. O
  auto-match silencioso de viagem (`resolveVoyageId` casando por navio+número+
  rota) sai de cena: o arquivo passa a **validar** a viagem declarada, não a
  resolvê-la. Um upload mira **uma** viagem.
- **Nome.** Como o import sempre criou o B/L inteiro (partes, rota, datas,
  containers/veículos, frete), a ação deixa de se chamar "Importar Frete B/L" e
  passa a "**Importar B/L**"; "frete" era resíduo do escopo original.

## Consequências

- `CONTEXT.md` redefine **Manifesto** como autoridade *inicial* e **B/L** como
  fonte de ingestão/correção; adiciona **Frete & Despesas do BL**.
- O gerador de EDI passa a preencher o frete marítimo (offset 1739) e o bloco de
  despesas (3796), encerrando a "lacuna de frete" de `docs/modules/manifesto-edi.md`.
- Importar um B/L com peso/containers divergentes de um B/L já faturado é uma
  operação **bloqueada por design**, não um erro — exige tratamento manual.
- Estende, sem revogar, a 0005 (novo caminho de ingestão) e a 0006 (o gate
  financeiro ganha uma barreira adicional na correção via B/L).

## Nota editorial — 2026-07-03 (import de manifesto para de sobrescrever em silêncio)

Realizando o princípio "nada sobrescrito em silêncio" na direção
**manifesto → B/L existente**, a migration `165_manifest_overwrite_opt_in.sql`
(#320) torna o import de manifesto **conservador por padrão**: ao reimportar um
manifesto sobre um B/L já existente (inclusive nascido de arquivo de B/L), os
campos comerciais `shipper, consignee, cargo_description, pol, pod,
total_weight_kg, total_cbm` **são mantidos** — o manifesto só os sobrescreve
quando o operador marca *"aplicar sobrescritas"* no preview (`p_apply_overwrites`),
gravando auditoria `FONTE_SOBRESCRITO`. O preview do diff (de→para) já existia
(#307); agora o apply respeita a decisão. Campos de orquestração/reconciliação
(voyage/batch/customer/review) mantêm o comportamento anterior.

## Nota editorial — 2026-07-03 (o lote deixa de ser a espinha; vira metadado opcional)

Pesquisa do #324 (Fog do mapa #304). Um B/L nascido de arquivo de B/L fica com
`batch_id = null` — o import de B/L (`import_bl_freight_transactional`, migration
162) **não cria** `import_batch`. Mapeando os consumidores de `batch_id` /
`import_batches`, a maior parte das dependências que assumiam "lote = manifesto"
já foi resolvida e o lote deixou de ser a espinha da ingestão:

- **Contagem de "manifestos" da viagem** passou a ser por **rota** (POL/POD) via
  `countDistinctRoutes` (ADR 0017 / mapa #304); `countDistinctBatchIds` ficou sem
  consumidor de produção (só em teste) — dead code a remover quando se tocar o
  arquivo.
- **CE Master** saiu de `import_batches.ce_master` para `voyage_route_ce_master`
  por rota em viagem só-B/L (#322).
- **Faturamento** do B/L nascido de B/L roda **inline** no próprio
  `import_bl_freight_transactional` (gate `billing_locked`/hold), sem depender de
  `run_billing_for_import_batch` (que é o caminho do manifesto).
- **Tela Escalas & Manifestos** já é B/L-first: a linha nasce da rota dos B/Ls e
  o batch entra como metadado quando existe (`collectVoyageManifestBatchRows`).

**Decisão.** O modelo de lote passa a ser **metadado opcional do manifesto**, não
a unidade obrigatória de toda ingestão. O import de B/L **não** sintetiza um
`import_batch` "bl_file": `import_batches` carrega colunas específicas de
manifesto (`ce_master`, `cargo_mode` único, `total_bls`) que não descrevem um
arquivo de B/L, e forçá-lo seria acoplar de volta o que #322/#304 desacoplaram.

**Furo residual assumido (`ponytail`).** O import de B/L não tem **dedup em nível
de arquivo** (`uq_import_batches_voyage_hash` só existe para manifesto/breakbulk/
granito) nem **agrupamento de erros por arquivo**; hoje a dedup é por **linha**
(upsert por `bls.id`) e os erros aparecem por B/L no modal. Ceiling: reimportar o
mesmo arquivo de B/L não é barrado no nível do arquivo. Upgrade quando virar dor
real: um log leve de import por arquivo com `file_hash` (não a tabela
`import_batches`), preservando o desacoplamento.

## Nota editorial — 2026-08-28 (a reimportação troca o consignatário e leva a fatura junto)

Investigação da reimportação campo a campo (migration `357`). A decisão 2 dizia
"nada é sobrescrito em silêncio", e o preview de diff realizava isso para os
campos comerciais. Três buracos sobreviviam, todos silenciosos:

- **Campos aplicados fora do diff.** `shipper_block`, `consignee_block`,
  `notify_block`, `notify2_block`, `notify_cnpj_cpf`, `manifest_customer_email`,
  `vehicles`, `voyage_id` e `cargo_mode` eram gravados sem aparecer no preview.
  Passam a ser diffados como os demais, e cada linha do diff ganha rótulo de
  operação (`cargo_description` vira "Descrição da carga (origem do NCM)").
- **Campos prometidos e descartados.** `voyage_id`, `pol`, `pod` e `cargo_mode`
  eram bloqueados em bloco por `v_unlocked_bls` (migration `205`) quando o B/L
  tinha cálculo ou fatura: o preview mostrava a mudança e a RPC não gravava,
  sem override possível. Passam a seguir a regra da nota de 2026-07-01 —
  bloqueados por padrão, **sobrescrevíveis com `override_billing` e auditoria**.
  POD escolhe a tabela de taxa, e viagem define onde a cobrança vive; são
  variáveis de faturamento como as demais, não exceções mudas.
- **O cliente nunca mudava.** `customer_id` só era adotado quando o B/L estava
  sem vínculo (migration `163`). Reimportar com outro consignatário trocava
  `consignee` e `manifest_customer_cnpj_cpf` e deixava o B/L — e a fatura —
  pertencendo ao cliente antigo.

**Decisão.** A reimportação é também o caminho de **correção do consignatário**.
Trocar o consignatário por erro de lançamento pode acontecer a qualquer momento,
inclusive depois do CE Mercante (que não muda: `ce_mercante` não está no payload
do import) e depois da fatura emitida. O preview mostra a troca — de quem para
quem, com CNPJ — e a operação **aceita explicitamente**; só então
`relink_bl_customer` move o B/L, as faturas de taxa local abertas, o recebível
do ledger e a demurrage viva para o novo cliente. **O valor devido não muda:
nenhuma coluna de dinheiro é reescrita, só `customer_id`.**

**Limites da troca automática**, sinalizados no preview antes do aceite:

- fatura **consolidada** com outros B/Ls não troca de dono inteira — separe a
  cobrança primeiro;
- fatura **com pagamento registrado** (ou quitada) não troca — estorne ou
  cancele antes, para não reescrever histórico de recebimento;
- novo consignatário **ainda não cadastrado** como cliente: sem fatura, o B/L
  volta para a fila de reconciliação; com fatura, a troca é impedida
  (`invoices.customer_id` e `bl_receivables.customer_id` são `NOT NULL`).

Em qualquer impedimento, **os demais campos seguem sendo aplicados** — o B/L não
é descartado inteiro, coerente com a nota de 2026-07-01. Toda troca é auditada
com justificativa (`entity_type` `bl` e `invoice`, visíveis no Histórico do B/L
via `bl_timeline`) e reabre a análise de Portal do novo cliente
(`trg_portal_reopen_on_new_process`, migration `325`).

**NCM não é campo próprio.** Não existe coluna `ncm`: `src/lib/ncm.ts` extrai os
códigos da descrição da carga e a ficha do B/L os exibe a partir dela. Como
`cargo_description` sempre foi diffada e aplicada, o NCM já acompanhava a
reimportação; o que faltava era o preview dizer isso com todas as letras.

## Alternativas consideradas

- **Sintetizar um `import_batch` "bl_file" para o import de B/L.** Ganharia dedup
  por arquivo e agrupamento de erros "de graça", mas reacopla a ingestão de B/L
  ao modelo de manifesto (colunas `ce_master`/`cargo_mode`/`total_bls` que não se
  aplicam) logo após #322/#304 terem removido esse acoplamento. Rejeitada; a
  dedup por arquivo, se necessária, vira um log próprio (ver nota 2026-07-03).
- **Divergência vira revisão (estilo Baplie).** Resolver campo a campo em uma
  tela de conciliação. Rejeitada: mais passos e código do que o fluxo de
  correção justifica.
- **B/L só completa vazios, nunca sobrescreve.** Não atende ao requisito de
  "B/L corrigido atualiza o sistema".
- **Recalcular taxas quando o B/L muda peso/containers e ainda não faturado.**
  Rejeitada nesta decisão: acopla o import do B/L ao motor de cálculo; a
  proteção escolhida apenas bloqueia quando já faturado e mantém o import
  desacoplado de faturamento.
