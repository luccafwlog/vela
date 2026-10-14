# 0057 — NCM deixa de ser derivado da descrição e vira campo próprio do B/L

> **Situação atual (2026-10-13).** Decisão vigente e implementada, reafirmada pela [ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md), item 17 (o NCM do documento vence quando declarado). As migrations `358` e `359` citadas abaixo são da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente em [Manifestos & EDI](../modules/manifesto-edi.md), seção "Fluxos e invariantes".

Status: aceito — 2026-08-28

## Contexto

O NCM nunca foi um dado do sistema. `src/lib/ncm.ts` extraía os códigos de
`cargo_description` por expressão regular, e a ficha do B/L (`BlOperacionalTab`)
os desenhava a partir dela a cada render. Não havia coluna, não havia edição, e
o operador não tinha onde corrigir.

O modelo se sustentava enquanto a descrição carregasse o código. Ela não
carrega, em dois caminhos reais de ingestão:

1. **B/L de container.** `blParser.parseCargoDescription` lê a descrição de
   **uma única célula** abaixo do rótulo "Description of Goods". Quando o
   armador quebra o quadro de mercadoria em mais linhas, a linha do NCM fica
   fora da descrição gravada.
2. **Carga solta.** `normalizeCarrierBreakbulkDescription` **remove de
   propósito** as linhas iniciadas por `NCM NUMBER` ao montar a descrição de uma
   linha, e `breakbulkImport` guarda apenas as **3 primeiras** descrições de
   item.

O sintoma que revelou o problema: reimportar o B/L atualizava a descrição da
carga e o NCM continuava vazio ou velho. Não era falha de atualização — era
ausência de dado. Não havia o que atualizar.

O gatilho de negócio é a **manifestação no Mercante**, que exige o NCM. Um campo
que só existe quando o texto livre do armador colabora não serve como origem de
declaração fiscal.

## Decisão

1. **`bls.ncm_codes TEXT[]` passa a ser o campo do NCM** — somente dígitos, 4 a
   8 por código, sem pontuação e sem duplicata, validado por `CHECK`. Vazio
   significa "ninguém cadastrou e o documento não declarou", não "a carga não
   tem NCM".

2. **É cadastrável na ficha.** A aba Operacional deixa de exibir badges
   somente-leitura e passa a ter campo editável, salvo por `save_bl_review` com
   a mesma auditoria campo a campo dos demais. Quando a descrição declara um
   NCM diferente do cadastrado, a ficha oferece o código lido como sugestão de
   um clique — sugestão, nunca sobrescrita automática.

3. **A importação preenche, mas nunca apaga.** Container e carga solta gravam o
   NCM que o documento declara. Documento **sem** NCM preserva o que está
   cadastrado: ausência em texto livre não é declaração de que a carga não tem
   NCM, e apagar destruiria justamente o cadastro manual feito para o Mercante.
   A gravação é auditada e, no preview do import, aparece no diff como qualquer
   outro campo (ADR 0017).

4. **A extração de texto continua existindo, rebaixada a auxiliar.**
   `extractNcmCodes` (front) e `public.extract_ncm_codes` (banco) seguem a mesma
   regra — inclusive a exclusão do número ONU escrito como `UN NCM.:3556` — e
   servem para propor valor, fazer o backfill e alimentar a heurística de
   máquinas da carga solta. Nenhuma delas é mais a fonte do dado exibido.
   A paridade entre as duas foi conferida contra o Postgres do branch de
   preview: a primeira versão SQL (migration `358`) deixava o número ONU passar
   e colava códigos vizinhos, e a migration `359` a corrigiu.

5. **Backfill em duas fontes.** B/L cuja descrição declara NCM começa
   preenchido; carga solta é preenchida a partir do texto completo dos itens
   (`bl_breakbulk_items`), que é onde o código sobrevive à limpeza da descrição.
   B/L sem nenhuma das duas fontes fica vazio e aguarda cadastro.

## Consequências

- `CONTEXT.md` redefine **NCM** como campo próprio do B/L.
- A ficha do B/L ganha um campo editável; o badge continua, agora refletindo o
  que está gravado.
- Corrigir a descrição da carga deixa de ser a única forma de corrigir o NCM.
- A manifestação no Mercante passa a ter uma origem estável para o dado. **O
  consumo do campo pelo gerador de EDI não faz parte desta decisão** e continua
  pendente (`docs/modules/manifesto-edi.md`).
- Os dois defeitos de leitura que motivaram a ADR **continuam existindo** e
  ficam registrados: a descrição de container ainda vem de uma célula só, e a de
  carga solta ainda descarta linhas e itens. A decisão os contorna para o NCM
  ao dar-lhe campo próprio; não os corrige para os demais dados da descrição.
  Corrigi-los é trabalho separado, no parser.

## Alternativas consideradas

- **Corrigir só os parsers e manter o NCM derivado.** Resolveria os dois casos
  conhecidos e deixaria o dado refém do próximo layout de armador que escrever
  "HS CODE" em vez de "NCM". Rejeitada: declaração fiscal não pode depender de
  regex sobre texto livre.
- **Coluna `ncm TEXT` única.** Mais simples, mas um B/L com mais de uma
  mercadoria tem mais de um NCM, e concatenar em texto recriaria o problema de
  origem. Rejeitada.
- **Tabela `bl_ncms`.** Correta para NCM por item, com quantidade e peso por
  código. Rejeitada por ora: nada no sistema consome NCM por item, e a
  manifestação pede o conjunto do B/L. O array é o menor passo que atende; virar
  tabela é um caminho aberto se a granularidade por item passar a ser exigida.
- **Preencher o NCM apagando quando o documento não declara.** Coerente com
  "o documento é a autoridade", mas destrói o cadastro manual na primeira
  reimportação de um B/L cuja descrição não traz o código — exatamente o caso
  que originou a decisão. Rejeitada.
