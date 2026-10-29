# Texto do Manual do Operador

Fonte do Manual do Operador: um arquivo Markdown por capítulo e o
[`manual.json`](manual.json), que diz as partes, os capítulos e a ficha de
cada capítulo. O PDF sai de `npm run manual:build`
([gerador](../../../scripts/manual/pdf/README.md)); `npm run manual:check`
confere o texto. A [matriz de cobertura](../cobertura/) é a referência interna
completa do que o sistema faz; o manual escolhe o que ensinar.

## Como o texto é escrito: o padrão enxuto

Decisão do dono de 2026-10-29 ([plano](../../plans/2026-10-26-manual-do-operador.md#padrão-enxuto-o-manual-é-uma-aula)).
O manual é uma aula sobre o Vela: quem escreve explica o sistema a um colega e
escolhe o que detalhar e o que omitir. O teste de cada frase é "a pessoa
precisa disto para fazer o trabalho, e a tela não diz?". Se não, sai.

- **Cada seção é um objetivo** ("4.1 Cadastrar uma Viagem"), com o nome que a
  pessoa usaria para pedir ajuda. A lista "Quero fazer…" da abertura do
  capítulo é montada sozinha a partir delas.
- **Meia página a uma página por seção:** quem faz, um parágrafo que explica o
  conceito quando ele não é óbvio, de 3 a 5 passos e, se ajudar, uma imagem.
- **Passo só para o que a tela não diz.** "Preencha **Navio**, **IMO** e
  **Numero da viagem**" é um passo; "Em **Navio**, digite o nome do navio"
  não é.
- **Explicar o conceito, não o mecanismo.** "A escala guarda a chegada ao
  porto; o berço fica no terminal" ajuda; como o Vela padroniza o nome do navio
  por dentro não ajuda.
- **Atenção só para o que causa erro ou retrabalho**, no máximo dois ou três
  pontos por seção, com o que surpreende quem usa.
- **Efeitos que importam, numa frase.** Diga o que muda para outra pessoa ou
  para o Cliente ("a data nova chega ao Portal"), não a lista do que o sistema
  faz por dentro.
- **Fica de fora:** mensagens de erro que a própria tela explica, o "por que é
  assim" que não muda o trabalho, os detalhes internos e as situações raras.
  Situação difícil com um caminho que ninguém adivinha (trocar o B/L, cancelar
  fatura paga) entra como seção curta, em poucos passos.
- **Cada coisa uma vez,** no lugar dela; nas outras seções, um link.
- **Os nomes são os da tela,** em negrito e exatamente como aparecem. Termos do
  negócio pelo [glossário](../../../CONTEXT.md), explicados na primeira vez em
  que aparecem no capítulo.
- **Linguagem:** segunda pessoa, frases curtas, tom de quem explica. O texto
  impresso não usa termos técnicos (o `manual:check` recusa tabela, fora de
  "tabela de cobrança" ou "de taxas", banco, RPC, migration, query, trigger,
  Edge Function, endpoint, cron, JSON, payload, ID técnico, "[confirmar]" e
  TODO).
- **Só o que o sistema faz.** Toda afirmação sai do código (a matriz e a
  conferência independente ajudam a achar); nada é inventado nem suavizado.

## Formato

```markdown
Parágrafo de abertura do capítulo (vai para a página de abertura).

::: aprende
- o que a pessoa aprende neste capítulo;
:::

## 4.1 Cadastrar uma Viagem

**Quem faz:** {{Qualquer equipe}}

Parágrafo curto com o conceito, se ele não é óbvio.

::: lado
1. Em **Viagens**, clique em **Nova Viagem**.
2. Preencha …

::: tela nova-viagem
Legenda.
:::
:::

::: atencao
- O que causa erro ou retrabalho.
:::
```

- `::: lado` põe os passos à esquerda e a imagem à direita; `::: passos` é a
  lista sozinha; `::: tela id`, com a legenda dentro, é a imagem marcada. O
  `id` é uma captura de [`capturas.mjs`](../../../scripts/manual/pdf/capturas.mjs);
  os números marcados na imagem são os números dos passos.
- `::: atencao` é o quadro de atenção. `::: nao-faca`, `::: sozinho`,
  `::: conferir`, `::: porque`, `::: aconteceu "…"` e `::: mensagem` ainda
  existem no gerador, mas o padrão enxuto quase não os usa.
- `{{Administrativo}}`, `{{Documentação}}`, `{{Operações}}`,
  `{{Equipamentos}}`, `{{Financeiro}}`, `{{Qualquer equipe}}` e `{{Todas as
  equipes}}` viram a etiqueta colorida da equipe.
- Tabelas em Markdown servem para comparar poucas opções (sinais, ações).
- `## N.M Título` é seção (entra no sumário com página); `### Título` é
  subtítulo dentro da seção.
- Link para outra seção: a âncora do GitHub, que é o título em minúsculas, sem
  pontuação, com hífen no lugar do espaço — `[4.2](#42-planejar-as-escalas)`;
  de outro capítulo, com o arquivo: `[6.2](06-importacao.md#62-…)`. O
  `docs:check` confere as duas formas, e o gerador as transforma em link
  interno do PDF.
