# Manifesto Mercante — modelo de domínio e renomeação do "CE Master"

## Decisão aprovada

Modelar o **Manifesto Mercante** como entidade própria, com número único, par de
portos e natureza, substituindo o modelo atual em que o número vive como atributo
da rota chaveado por tipo de carga. A nomenclatura **"CE Master"** é abandonada em
favor de **"Nº de Manifesto Mercante"**.

Este documento registra o levantamento de domínio que sustenta a decisão. Ele é o
insumo da ADR correspondente, não a ADR.

**Marcas de achado.** Segue a mesma convenção da
[spec de carga mista](2026-09-16-unificacao-bls-carga-mista-design.md), seção
"Como ler os achados": **[defeito atual]** produz resultado errado hoje;
**[lacuna de mapa]** funciona hoje e precisa mudar para o modelo fechar.
Diferentemente daquela spec, aqui a maioria dos achados é **[defeito atual]** —
os três da seção "Por que o modelo atual está errado" já limitam a operação sem
nenhuma carga mista envolvida.

---

## A definição que organiza tudo

> **Um manifesto Mercante é um lançamento.**

Não é atributo da rota, não é tipo de carga, não é arquivo. É o ato de lançar no
sistema Mercante, que devolve **um número** e passa a conter aquilo que foi
lançado.

Toda a fenomenologia observada decorre dessa definição:

| Observação | Explicação |
|---|---|
| Uma rota tem N manifestos | N lançamentos |
| Costuma haver um de contêiner e outro de carga solta | prática da agência: lançamentos separados |
| Um B/L com os dois tipos gera um manifesto com os dois | o lançamento continha aquele B/L |
| Vazios têm número de manifesto mas não têm CE | lançamento sem conhecimentos de embarque |

## Os dois sentidos de "manifesto" no negócio

**Manifesto de carga (do armador).** Documento da navegação que registra os B/Ls e
itens de carga transportados entre um par de portos. Um por par de portos. É
documento do armador.

**Manifesto do Mercante.** Manifesto do sistema federal. Reúne os **conhecimentos
de embarque** — o B/L já traduzido para o Mercante. Ao lançar os B/Ls, o Mercante
gera um número para o manifesto e um número de CE para cada B/L. Os CEs de um
mesmo lançamento compõem aquele manifesto.

Este documento trata **exclusivamente do segundo**.

## Os quatro sentidos de "manifesto" no código

Levantados contra o repositório em 2026-09-17. Três estão no schema, e a
ambiguidade entre eles é a causa da nomenclatura confusa:

| Sentido | Onde vive |
|---|---|
| Manifesto de carga (armador) | conceito; para carga solta é fonte de ingestão (`CONTEXT.md`, verbete **Manifesto**) |
| **Manifesto Mercante** | `voyage_route_ce_master.ce_master` e `import_batches.ce_master` — o objeto desta spec |
| **Lote de importação** (arquivo subido) | `import_batches`, e `manifest_id` em `billing_runs`, `charge_calculations`, `invoice_items` |
| Manifestos de fluxo próprio | `granite_manifests`, `vazios_importacao_manifests` |

O terceiro é o mais perigoso: **`manifest_id` no schema significa lote de
importação**, não manifesto Mercante nem manifesto do armador. Quem ler
`charge_calculations.manifest_id` esperando manifesto Mercante lê errado.

---

## Fatos do domínio

Levantados com a operação da agência. Cada um restringe o modelo.

1. **O número é único no Mercante como um todo** — não por viagem, não por escala.
   O número identifica o manifesto globalmente.
2. **O grão é o par de portos.** Um manifesto cobre uma rota. Contêineres vindos
   de dois portos de origem distintos geram dois manifestos.
3. **A rota pode ter N manifestos**, com cargas distintas ou mistas.
4. **Vazios geram manifesto e não geram CE.** Vale para vazios de importação
   (descarregados) e de exportação (embarcados). Não vêm de B/Ls, logo não há
   conhecimento de embarque.
5. **O Mercante exige o porto de origem dos vazios descarregados** — o manifesto
   de vazio tem par de portos como o de carga, não um porto só.
6. **Granito tem a mesma natureza que a carga geral.** Sem regra própria.
7. **O sentido é derivado da rota:** porto de descarga brasileiro → importação;
   porto de embarque brasileiro → exportação. Não é campo.
8. **O CE do B/L nunca muda; o manifesto do B/L muda.** Em COD o B/L deixa de
   constar no manifesto do porto omitido e passa a constar no do novo destino
   (`CONTEXT.md`, verbete de COD).

### Exemplo canônico

Viagem 2544N, escala de Santos:

- descarrega 40 contêineres vazios, todos vindos do mesmo porto;
- embarca 120 contêineres vazios — 70 para Buenos Aires, 50 para Montevidéu.

**Três** manifestos Mercante: um da descarga, um de Santos → Buenos Aires, um de
Santos → Montevidéu. Se os 40 descarregados viessem de dois portos distintos,
seriam quatro.

---

## O modelo

```
manifestos_mercante
  id
  voyage_id
  pol, pod              -- o par de portos do lançamento
  numero                -- Nº de Manifesto Mercante
  natureza              -- 'carga' | 'vazio'
  UNIQUE (numero)       -- único no Mercante como um todo (fato 1)

bls.manifesto_mercante_id   -- FK; nulo = ainda não lançado (pendência)
```

**Por que entidade e não coluna no B/L.** Um manifesto de vazio existe com **zero
B/Ls**. Se o número só morasse em `bls`, o manifesto de vazio não teria onde
existir, e os manifestos de uma rota não seriam enumeráveis a partir dos
documentos.

**Por que `natureza` é explícita e não derivada.** Um manifesto com zero B/Ls pode
ser de vazio **ou** de carga ainda não populado. Sem o campo, os dois estados são
indistinguíveis.

**Por que o sentido não é campo.** Fato 7: a rota resolve. Guardá-lo criaria um
dado redundante e passível de divergir da rota.

### O que sai

| Hoje | Depois |
|---|---|
| `voyage_route_ce_master` (com `cargo_mode` na `UNIQUE`) | removida — os manifestos da rota são as linhas de `manifestos_mercante` daquela rota |
| `import_batches.ce_master` | removida — derivável dos B/Ls do lote |
| Nomenclatura "CE Master" | "Nº de Manifesto Mercante" |

`bls.ce_mercante` **permanece** — é o CE individual do B/L, que nunca muda, e é
coisa distinta do manifesto.

### O que o modelo resolve de graça

- **B/L misto:** aponta para o manifesto em que foi lançado. Não há decisão a
  tomar sobre carga mista, porque manifesto nunca foi função do tipo de carga.
- **Rota com dois manifestos do mesmo tipo:** cabe, sem teto artificial.
- **Vazios:** ganham representação de primeira classe, com rota.
- **Vínculo de Manifestos à Escala** — verbete do `CONTEXT.md` que hoje **não tem
  coluna nenhuma no schema** — ganha onde morar quando for implementado.
- **COD:** limpa a FK e gera pendência, que é o comportamento que o `CONTEXT.md`
  já descreve e que hoje não é implementado.

---

## Por que o modelo atual está errado

### `cargo_mode` na chave é um proxy da identidade do manifesto — **[defeito atual]**

```sql
CREATE TABLE public.voyage_route_ce_master (
    voyage_id bigint NOT NULL,
    pol text NOT NULL,
    pod text NOT NULL,
    ce_master text,
    cargo_mode text DEFAULT 'container'::text NOT NULL   -- ← o defeito
);
-- UNIQUE (voyage_id, pol, pod, cargo_mode)
```

O `CONTEXT.md` define CE Master como *"conhecimento agrupador por rota da viagem
(POL/POD)"* — sem tipo de carga. **A tabela tem uma dimensão que o domínio
documentado não tem.**

A coluna não é descuido: ela codifica a convenção *"normalmente um manifesto de
contêiner e um de carga solta"*. Funciona enquanto a convenção vale e quebra em
dois casos reais — o manifesto que contém os dois tipos, e qualquer rota que
precise de dois manifestos do mesmo tipo. **O segundo caso não depende de carga
mista:** uma rota de contêiner que precise de dois lançamentos já não cabe na
chave hoje.

### A tela só tem um campo por rota — **[defeito atual]**

O caso normal da agência é a rota com **dois** manifestos: um de contêiner e um
de carga solta. A tela de Manifestos/Rotas oferece **um** campo.

A causa está no agrupamento. A linha da tela nasce do par de portos, e só dele
(`voyageCardHelpers.tsx:127`):

```ts
const routeKey = `${pol}__${pod}`
```

B/Ls de contêiner e de carga solta da mesma rota caem na **mesma linha** — é
justamente o que o badge `CNTR/BB` exibe quando os dois tipos coexistem ali. Uma
linha, um campo de Nº de Manifesto Mercante.

A gravação fecha o ciclo: para rota não-vazios, `group.cargoMode` nunca é
preenchido, e `Viagens.tsx:536` envia `cargoMode ?? 'container'`. **Toda rota de
carga é gravada como `'container'`**, qualquer que seja o tipo dos seus B/Ls.

O banco **aceitaria** os dois números — a `UNIQUE (voyage_id, pol, pod,
cargo_mode)` prevê uma linha por tipo. Nada nunca grava a segunda. O número do
manifesto de carga solta não é perdido: ele não tem onde ser digitado.

Vazios são a exceção que funciona: têm linha própria (`routeKey` com sufixo
`__vazios`) e chave própria (`__VAZIOS`), gravadas e lidas de forma coerente.

> **[fato errado — corrigido]** A versão anterior desta seção afirmava que o
> banco guarda os dois números e que `listVoyageRouteCeMasters` sobrescreve um
> pelo outro ao montar o `Map`. A colisão de chave existe no código de leitura —
> `container` e `carga_solta` produzem a mesma chave — mas é **latente**: nenhum
> caminho da aplicação grava a segunda linha. O defeito vigente é a captura, não
> a leitura. Fica o registro para quem for implementar: ao passar a gravar um
> manifesto por lançamento, a chave do `Map` precisa mudar junto, ou a colisão
> deixa de ser latente.

### `manifestRef` do EDI é um valor não identificado exibido como manifesto — **[defeito atual]**

O parser do EDI de CE Mercante lê o segundo token do registro `M` e o chama de
`manifestRef`:

```ts
if (type === 'M') {
  const tokens = line.trim().split(/\s{2,}/)
  manifestRef = tokens[1] ?? null
}
```

Não há validação de formato nem referência ao layout — compare com o CE ao lado,
que tem `CE_MERCANTE_LENGTH = 15`. O `CeMercanteImportModal` exibe esse valor como
**"Manifesto detectado:"**.

O `CONTEXT.md` afirma que o Nº de Manifesto Mercante **não entra no EDI**, e a
operação confirma. Logo o rótulo está errado: mostra como manifesto um token que
ninguém identificou e do qual nada depende. Ou o campo é identificado, nomeado e
validado, ou o rótulo sai.

---

## Captura: vincular o CE é o momento

A vinculação do CE é quando a agência acabou de lançar no Mercante e tem o número
em mãos. É lá que o Nº de Manifesto deve ser informado — uma vez por lançamento,
não redigitado depois em Viagens → Manifestos/Rotas.

**Validação que nasce junto.** Se os B/Ls de um mesmo lançamento resolverem para
**mais de um par de portos**, ou o arquivo mistura manifestos ou algum B/L está com
a rota errada. Hoje isso passa batido.

**Custo operacional a registrar.** Tornar o campo obrigatório exige coluna nova nos
templates de planilha em uso. A mensagem de erro precisa nomear a coluna que
falta, e a obrigatoriedade não pode ser silenciosa.

---

## Situação dos vazios

### Importação — o par de portos já existe

`vazios_importacao_containers` tem `pol` e `pod` **por contêiner**, e o importador
já mapeia `pol | origem | porto_origem | porto origem` com `resolvePortCode` e
`LocodeSchema`.

```sql
CREATE TABLE public.vazios_importacao_containers (
    manifest_id uuid NOT NULL,
    container_number text NOT NULL,
    pol text,
    pod text,
    ...
);
```

O que falta é o nível do manifesto: `vazios_importacao_manifests` tem apenas
`voyage_id`, sem rota. Com o par de portos nos contêineres, os manifestos de um
lote são os pares distintos — e o sistema passa a **detectar sozinho** o caso do
fato 2 (contêineres de dois portos de origem → dois manifestos).

### Exportação — lacuna funcional — **[lacuna de mapa]**

`vazios_bookings` **não tem nenhum campo de porto**, e `vaziosExportOperations.ts`
tampouco. O embarque de vazios precisa passar a informar porto de origem e de
destino; sem isso o manifesto de vazio de exportação não tem rota e o modelo não
fecha.

**Esta é a única lacuna funcional nova que a decisão cria.** As demais mudanças
reorganizam dados que já existem. Nada está errado hoje no embarque de vazios: o
porto simplesmente não é coletado porque nada o exigia.

---

## Pré-requisitos e riscos

**A derivação do sentido depende de dados de cadastro.** `ports` tem `country`,
então a regra do fato 7 é computável — mas `portCode.ts` não tem hoje nenhuma
noção de país, e `bls.pol`/`bls.pod` são `text` **sem FK para `ports`** (só o nível
de escala carrega `port_id`). Derivar o sentido de um B/L depende de casar o texto
com o cadastro e de `country` estar preenchido e normalizado. Falhando o
casamento, o sentido fica **indefinido**, não errado — mas fica indefinido, e a
tela precisa dizer isso em vez de assumir importação.

**A renomeação tem superfície.** 59 ocorrências de `ce_master`/`ceMaster` em `src/`
fora de testes, mais rótulos de tela em `VoyageManifestosTab`, `VoyageScheduleModals`
e `VoyageCard`, títulos de evento em `voyageSummaries`, `telemetryContext`, o
`CONTEXT.md` e os documentos vivos.

**A palavra "manifesto" não é substituível em bloco.** Como registrado na tabela
dos quatro sentidos, a maioria das ocorrências de "manifesto" no código se refere
a lote de importação ou a manifesto do armador, e **permanece**. A renomeação
atinge `ce_master`/`CE Master`, não a palavra.

---

## Fora de escopo

- **Unificação de B/Ls e carga mista** (`2026-09-16-unificacao-bls-carga-mista-design.md`):
  spec separada. Ela deixa de decidir sobre manifesto e passa a referenciar esta.
- **Reclassificação de `manifest_id`** para lote de importação: o verbete entra no
  glossário, mas renomear a coluna é trabalho próprio.
- **Vínculo de Manifestos à Escala:** o modelo abre o lugar; implementar o vínculo
  é outra entrega.

---

## Perguntas resolvidas nesta rodada

| Pergunta | Resposta |
|---|---|
| O número é único por viagem ou no Mercante todo? | No Mercante como um todo |
| Vazios geram manifesto? | Sim, importação e exportação; sem CE, por não virem de B/L |
| Manifesto de vazio tem um porto ou par? | Par — o Mercante exige o porto de origem |
| Granito tem regra própria? | Não, mesma natureza `carga` |
| O sentido é campo ou derivado? | Derivado da rota, pelo país dos portos |

## Em aberto

- **Formato do Nº de Manifesto Mercante.** Não há validação especificada. Se
  houver formato conhecido, ele vira `CHECK` e mensagem de importação — do mesmo
  modo que o CE já tem `CE_MERCANTE_LENGTH = 15`.
- **O que é `tokens[1]` do registro `M`.** Precisa ser identificado contra o layout
  do Mercante/Siscomex Carga antes de decidir entre nomear ou remover o rótulo.
