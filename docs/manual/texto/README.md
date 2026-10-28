# Texto do Manual do Operador

Fonte do Manual do Operador: um arquivo Markdown por capítulo e o
[`manual.json`](manual.json), que diz as partes, os capítulos e a ficha de
cada capítulo. O PDF sai de `npm run manual:build`
([gerador](../../../scripts/manual/pdf/README.md)); `npm run manual:check`
confere o texto. O que cada capítulo deve responder está no
[catálogo de situações](../situacoes/README.md); a regra que o texto explica
está na [matriz de cobertura](../cobertura/).

## Como o texto é escrito

O manual explica como o Vela opera e o que o usuário faz para alcançar cada
objetivo ([plano](../../plans/2026-10-26-manual-do-operador.md#o-manual-parte-do-objetivo-de-quem-usa)).

- **Cada seção é um objetivo** ("4.1 Cadastrar uma Viagem nova"), com o nome
  que a pessoa usaria para pedir ajuda, não o nome da tela. A lista "Quero
  fazer…" da abertura do capítulo é montada sozinha a partir delas.
- **Cada procedimento segue o modelo de oito partes:** ficha (Quando usar,
  Quem faz, Antes de começar), passo a passo com as imagens, O sistema faz
  sozinho, Onde conferir, Se algo der errado (quadros "Aconteceu…") e Por que é
  assim. Parte que não se aplica fica de fora; a ordem não muda.
- **As situações comuns** do catálogo viram quadros "Aconteceu…" dentro da
  seção onde acontecem; as que atravessam o capítulo ficam numa seção própria
  no fim ("Situações comuns").
- **Os nomes são os da tela,** em negrito e exatamente como aparecem (botão,
  aba, coluna, filtro, situação). Mensagens do sistema entre aspas, com o
  texto exato da matriz.
- **Linguagem:** segunda pessoa, frases curtas, um passo por linha, o porquê
  depois do como. Termos do negócio pelo [glossário](../../../CONTEXT.md),
  explicados na primeira vez em que aparecem no capítulo.
- **Proibido no texto impresso** (o `manual:check` recusa): tabela (fora de
  "tabela de cobrança" ou "de taxas"), banco, RPC, migration, query, trigger,
  Edge Function, endpoint, cron, JSON, payload, ID técnico, "[confirmar]" e
  TODO. Onde a matriz diz "o banco recusa", o manual diz "o Vela recusa".
- **Só o que o sistema faz.** Toda frase sai de uma regra da matriz ou do que
  a captura mostra. Regra que não cabe no texto corrido vai para um quadro
  ou para o fim da seção; nenhuma é inventada nem suavizada.

## Formato

```markdown
Parágrafo de abertura do capítulo (vai para a página de abertura).

::: aprende
- o que a pessoa aprende neste capítulo;
:::

## 4.1 Cadastrar uma Viagem nova

<!-- regras: VIA-011 VIA-012 VIA-013 -->

::: ficha
- **Quando usar:** …
- **Quem faz:** {{Qualquer equipe}}
- **Antes de começar:** …
:::

::: passos
1. No menu, clique em **Viagens**.
2. Clique em **Nova Viagem**.
:::

![Legenda da imagem.](captura/viagens-topo)

::: lado
3. Passo ao lado da imagem.

![Legenda.](captura/nova-viagem)
:::

::: sozinho
- O que o Vela faz depois, sem ninguém pedir.
:::

::: conferir
Onde ver o resultado.
:::

::: aconteceu "Mensagem ou situação"
- **O que o sistema faz:** …
- **Por quê:** …
- **O que você faz:** …
:::

::: porque
O motivo de negócio.
:::
```

- `::: atencao` e `::: nao-faca` são os outros dois quadros fixos; `:::
  mensagem Texto exato` é o cartão de mensagem (Apêndice B).
- `{{Administrativo}}`, `{{Documentação}}`, `{{Operações}}`,
  `{{Equipamentos}}`, `{{Financeiro}}`, `{{Qualquer equipe}}` e `{{Todas as
  equipes}}` viram a etiqueta colorida da equipe.
- `![legenda](captura/id)` sozinha no parágrafo vira a imagem marcada. O `id`
  é uma captura de [`capturas.mjs`](../../../scripts/manual/pdf/capturas.mjs);
  os números marcados na imagem são os números dos passos, então o passo e a
  marca têm o mesmo número. Dentro de `::: lado`, a lista fica à esquerda e a
  imagem à direita.
- Números de passo continuam entre blocos: depois de `2.`, o próximo bloco
  começa em `3.`.
- `## N.M Título` é seção (entra no sumário com página); `### Título` é
  subtítulo dentro da seção.
- Link para outra seção: a âncora do GitHub, que é o título da seção em
  minúsculas, sem acento e sem pontuação, com hífen no lugar do espaço —
  `[4.2](#42-planejar-as-escalas-da-viagem)`; de outro capítulo, com o
  arquivo: `[6.2](06-importacao.md#62-importar-os-bls-de-container)`. O
  `docs:check` confere as duas formas, e o gerador as transforma em link
  interno do PDF.

## Regras citadas

Cada regra da matriz escrita no texto é citada num comentário perto dela:
`<!-- regras: VIA-011 VIA-012 -->`. Regra destinada ao capítulo mas que o
sumário põe em outro capítulo é registrada como adiada:
`<!-- adiado: EQU-049 EQU-050 → capítulo 10 -->`. O `manual:check` falha
quando uma regra dos destinos do manifesto (`matriz` de cada capítulo) não
tem lugar, ou quando a citação não existe na matriz. Citar sem escrever não
vale: a conferência independente da Etapa 3 procura a regra no texto.
