# ADR 0081 — Identidade visual única do Vela e do Portal Fwlog

**Data:** 2026-10-13 · **Status:** aceito

## Contexto

A campanha de revisão visual de 2026-10-07 executou as etapas 00 a 12 a partir
de um contrato escrito na etapa 00 (direção "Carta náutica": papel creme com
pontos, filetes em vez de caixas, Syne nos títulos, liberdade criativa ampla em
cada etapa). O responsável registrou que gostava menos do resultado a cada
etapa. A revisão do contrato encontrou quatro causas:

- o texto do contrato contradizia a decisão do responsável de 2026-10-08
  (cabeçalho de tabela azul-marinho), que entrou só como nota no topo do plano;
- cada sessão redesenhava a sua tela sem aprovação prévia, e o aceite media
  pixels e contagens, não se a tela ficou melhor para quem opera;
- a identidade vivia no CSS de cada página: `src/index.css` tinha 14.803
  linhas, a maior parte em famílias próprias de tela (`.app-customer-*` com
  184 regras, `.app-bl-*` com 135), além de 88 cores escritas direto e 48
  tamanhos de letra fora da escala nos componentes;
- o problema real, nas palavras do responsável, era **caçar a informação**:
  assuntos sem separação e nada em destaque.

As alternativas foram comparadas numa página com antes e depois em telas reais
(dados do ambiente local): A "Marinha" (azul-marinho estrutura a tela, blocos
com título), B "Papel" (o contrato vigente, consolidado) e C "Neutro" (branco e
cinza, IBM Plex Sans).

## Decisão

1. A identidade dos dois produtos é a direção A com o fundo da C: azul-marinho
   estrutura a tela, fundo cinza neutro e liso, blocos brancos com título em
   faixa azulada.
2. Nove regras valem para todas as telas, descritas em
   [docs/identidade-visual.md](../identidade-visual.md): um assunto por bloco;
   dado principal em destaque; lugar fixo para cada coisa; ausência discreta;
   cor só para o que pede ação; grupos de colunas separados; estrutura
   azul-marinho com fundo neutro; uma família de letra (DM Sans, Plex Mono nos
   códigos, Syne só no nome "Vela"); ação tem cara de botão (texto sublinhado
   só para o identificador que abre o próprio registro e para o breadcrumb).
3. O Portal mantém a marca FWLOG: azul-marinho da logo e azul do globo, sem
   dourado e sem Syne, com a mesma gramática de blocos.
4. A linguagem visual é fixa; a organização de cada tela (blocos, ordem, dado
   principal, colunas) se ajusta tela a tela com aprovação do responsável a
   partir de captura de hoje, proposta e lista do que muda. Uma necessidade que
   as regras não cobrem muda a regra para todas as telas.
5. A identidade fica nas peças comuns de `src/components/ui/` (`Block`,
   `LeadValue`, `FactList`, `IdentityBand`, `NextAction`, `NoValue`, grupos de
   colunas e `Button`) e é verificada por `npm run design:check`, uma catraca
   sobre cor solta, tamanho fora da escala, caixa alta, cor do Tailwind, fonte
   de marca e crescimento de CSS de página.

## Consequências

- A troca de tokens muda fundo, letra dos títulos, navegação ativa do Portal e
  botões `ghost` em todas as telas de uma vez, sem reorganizar nenhuma.
- As etapas 13 a 23 da campanha de 2026-10-07 deixam de ser executadas como
  prompts sequenciais; o trabalho restante é o
  [plano de migração tela a tela](../plans/2026-10-13-identidade-visual-tela-a-tela.md).
  Os registros das etapas 00 a 12 continuam como histórico no plano arquivado.
- Telas novas compõem as peças comuns; a revisão de aparência deixa de ser
  necessária, e a aprovação passa a cobrir só a organização.
- A linha de base da catraca registra a dívida visual existente e só desce,
  tela a tela.

## Relação com decisões anteriores

- Substitui o "Contrato visual" da etapa 00 e as notas de 2026-10-08 do
  [plano de revisão visual](../archive/plans/2026-10-07-revisao-visual-ux-prompts.md),
  preservando o que elas decidiram e esta ADR confirma (cabeçalho de tabela
  azul-marinho, faixa de identidade azul-marinho, wordmark fora da regra da
  Syne).
- Estende a [ADR 0066](./0066-transicao-marca-vela.md): a separação de marcas
  Vela, Fwlog e Transhipping passa a ter tokens próprios no Portal.
- Não altera regras de negócio, autorização, RPCs ou schema.

## Nota de 2026-10-13: linha entre grupos de colunas

Ao ver a ficha do B/L implementada, o responsável achou pesada a faixa
vertical de 3 px entre os grupos de colunas (regra 6). A separação continua,
mas como linha de 1 px bem clara, no cabeçalho e no corpo. Vale para todas as
tabelas com grupos; o texto da regra em
[identidade-visual.md](../identidade-visual.md) já reflete a mudança.

## Nota de 2026-10-13: tabela padrão centralizada

Comparando quatro formatos da mesma tabela, o responsável escolheu o
centralizado e trocou a nota anterior. Na tabela padrão
(`app-table--padrao`), títulos dos grupos, cabeçalhos e células ficam
centralizados, números inclusive. A exceção é o texto longo que pode passar do
limite da coluna (nome do Cliente ou do consignatário, descrição): ele fica à
esquerda, para o começo do valor aparecer. Os grupos de colunas são marcados
pelo título centralizado com um traço embaixo, sem linha vertical entre
colunas. A regra 6 em [identidade-visual.md](../identidade-visual.md) foi
reescrita; as tabelas passam ao padrão tela a tela.

## Nota de 2026-10-13: identificador sem sublinhado

O responsável não quer números e nomes sublinhados só por abrirem o próprio
registro. Na regra 9, o identificador (número do B/L, nome do Cliente, navio)
e o caminho de navegação ficam só na cor de link, sem sublinhado; o
sublinhado aparece ao passar o mouse ou com o foco do teclado. A faixa de
identidade foi ajustada; as famílias de página que ainda sublinham links em
repouso (`app-invoices__number`, `app-dem-link`, `app-pix-link` e outras)
mudam quando a tela dona migrar.

## Nota de 2026-10-13: uma pendência, um lugar

Na revisão da lista de BLs, o responsável pediu que cada pendência de um
registro seja informada uma vez só. Um B/L sem Cliente mostrava "Revisão
pendente" sob o número e "Sem cliente vinculado" na coluna Cliente: dois avisos
para o mesmo fato. A regra 5 passa a dizer que, em lista, a pendência aparece
na coluna em que se resolve, sem aviso genérico repetindo o fato.
