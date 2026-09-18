# Formato do relatório HTML

A revisão arquitetural é apresentada em um único arquivo HTML autocontido no
diretório temporário do sistema. Prefira CSS e SVG inline para que o relatório
continue legível sem internet. Mermaid ou Tailwind são opcionais e só devem ser
usados quando houver fallback funcional. Mermaid atende bem diagramas de fluxo;
elementos HTML e SVG inline funcionam melhor para os visuais editoriais
(diagramas de massa e cortes de camadas). Combine os formatos sem transformar o
relatório em um painel genérico.

## Estrutura mínima

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Revisão da arquitetura — {{nome do repositório}}</title>
    <!-- Recursos externos são opcionais; o conteúdo principal deve funcionar sem eles. -->
    <style>
      /* camada pequena para detalhes visuais: linhas tracejadas de seam,
         pontas de seta e outros elementos que exigem ajuste fino */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="recomendacao-principal">...</section>
    </main>
  </body>
</html>
```

## Cabeçalho

Nome do repositório, data, escopo e uma legenda compacta: caixa sólida = módulo,
linha tracejada = seam, seta vermelha = vazamento, caixa escura = módulo
profundo. Use português do Brasil, explique o efeito no fluxo do Vela e vá
direto aos candidatos.

## Cartão do candidato

Os diagramas carregam a maior parte da explicação. O texto deve ser curto,
direto e usar o vocabulário arquitetural da skill sem perder a conexão com o
fluxo visível do Vela.

Cada candidato é um `<article>`:

- **Título** — curto, nomeia o aprofundamento (por exemplo, “Concentrar o
  recebimento de uma Viagem”).
- **Linha de selos** — força da recomendação (`Forte` = esmeralda, `Vale
  explorar` = âmbar, `Especulativa` = cinza), além da categoria de dependência
  (`no processo`, `substituível localmente`, `ports e adapters`, `mock`).
- **Arquivos** — lista monoespaçada, `font-mono text-sm`.
- **Diagrama antes/depois** — elemento central, em duas colunas lado a lado.
- **Problema** — uma frase sobre o atrito observado.
- **Solução** — uma frase sobre o que mudaria.
- **Ganhos** — bullets com até seis palavras. Por exemplo: “Testes usam uma
  interface”, “Regra da Taxa Local não vaza”, “Quatro wrappers deixam de existir”.
- **Alerta de ADR** (quando aplicável) — uma linha em caixa âmbar.

Não use parágrafos longos. Se o diagrama exigir um parágrafo para ser
entendido, redesenhe o diagrama.

## Padrões de diagrama

Escolha o padrão que melhor explica cada candidato. Combine formatos; variedade
ajuda a mostrar o tipo de relação que está sendo analisada.

### Grafo Mermaid (dependências e fluxo de chamadas)

Use um `flowchart` ou `graph` Mermaid quando o ponto for “a página de Viagens
chama a regra de B/L, que chama a regra de Taxa Local, e o acoplamento ficou
espalhado”. O cartão pode usar classes locais ou Tailwind quando disponível.
Use `classDef` para destacar vazamentos em vermelho e o módulo profundo em
tom escuro. Diagramas de sequência ajudam a comparar, por exemplo, muitas
idas e vindas antes com uma única consulta depois.

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[Página de Viagens] --> B[Regra da Viagem]
      B --> C[Repositório de BLs]
      C -.leak.-> D[Regra de Taxa Local]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Caixas e setas construídas à mão (quando o layout do Mermaid atrapalhar)

Represente módulos como `<div>`s com bordas e rótulos. Desenhe setas como
`<line>` ou `<path>` SVG inline posicionados sobre um contêiner relativo. Use
esse formato quando o “depois” precisar mostrar um módulo profundo com seus
detalhes internos esmaecidos.

### Corte de camadas (bom para mostrar superficialidade)

Empilhe faixas horizontais (`h-12 border-l-4`) para mostrar as camadas por onde
uma ação passa. Antes: várias camadas finas que apenas repassam a ação. Depois:
uma faixa espessa com a responsabilidade consolidada.

### Diagrama de massa (bom para “interface tão grande quanto a implementação”)

Use dois retângulos por módulo — um para a superfície da interface e outro para
a implementação. Antes: a interface é quase tão grande quanto a implementação
(módulo raso). Depois: a interface é curta e a implementação concentra a
complexidade (módulo profundo).

### Colapso do grafo de chamadas

Antes: árvore de chamadas representada por caixas aninhadas. Depois: a mesma
árvore é representada por uma única caixa, com as chamadas internas esmaecidas.

## Orientações visuais

- Estilo editorial, não painel corporativo. Use espaço em branco generoso.
  Serifas são opcionais nos títulos (`font-serif`).
- Use poucas cores: um acento (esmeralda ou índigo), vermelho para vazamentos e
  âmbar para alertas.
- Mantenha os diagramas perto de 320px de altura para que o antes/depois caiba
  lado a lado sem rolagem excessiva.
- Use `text-xs uppercase tracking-wider` para rótulos de módulos dentro dos
  diagramas; eles devem parecer esquemáticos, não controles de tela.
- O relatório deve ser estático, autocontido e funcional sem dependências
  externas. Se usar Tailwind ou Mermaid por conveniência, inclua uma
  representação inline equivalente e não dependa do carregamento externo.

## Seção de recomendação principal

Use um cartão maior com o nome do candidato, uma frase explicando por que ele é
prioritário e um link âncora para o cartão correspondente.

## Tom

Português do Brasil, conciso — mas os substantivos e verbos arquiteturais devem
vir da análise e do vocabulário do sistema. Concisão não autoriza trocar uma
Viagem, um B/L, uma Taxa Local ou uma fatura por um termo genérico.

Use quando ajudarem: module, interface, implementation, depth, deep, shallow,
seam, adapter, leverage e locality. Explique cada termo pelo efeito no fluxo do
Vela quando o usuário não o conhecer.

Não proíba nomes reais do código. Component, service, API, query e RPC podem ser
usados como evidência técnica; não devem substituir a explicação da página,
ação, entidade, estado e efeito visível.

**Formulações que combinam com o estilo:**

- “O módulo de recebimento de Viagens é raso — a interface quase repete a
  implementação.”
- “A regra da Taxa Local vaza pelo seam.”
- “Aprofundar: uma interface, um lugar para testar.”
- “Dois adapters justificam o seam: API em produção, memória nos testes.”

Os bullets de ganhos devem nomear o benefício com termos da análise: *“locality:
falhas ficam concentradas em um módulo”*, *“leverage: uma interface, várias
áreas do Vela”*, *“a interface encolhe; a implementação absorve os wrappers”*.
Evite “mais fácil de manter” ou “código mais limpo” sem explicar qual efeito
isso produz em uma página, entidade, estado ou fluxo.

Não faça rodeios. Se uma frase puder ser um bullet, transforme-a em bullet. Se
um bullet puder ser removido, remova-o. Se um termo não estiver no vocabulário
da entrada, prefira explicar o efeito no sistema antes de inventar outro.
