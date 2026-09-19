# Convenções da documentação

Contrato editorial da documentação do Vela e do Portal Fwlog. Use-o para
escolher onde registrar uma informação, como sustentá-la e quando arquivá-la.
As instruções de trabalho dos agentes permanecem em [AGENTS.md](../AGENTS.md).

## Responsabilidade de cada documento

| Informação | Fonte canônica |
|---|---|
| Significado de uma entidade, estado ou regra de negócio | [CONTEXT.md](../CONTEXT.md) |
| Camadas, integrações e mapa de rotas | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Instalação, comandos, testes, migrations e deploy | [WORKFLOW.md](../WORKFLOW.md) |
| Comportamento de telas e ações de um domínio | Módulo correspondente no [índice documental](README.md) |
| Caminho da ação até código, banco e evidências | [RASTREABILIDADE.md](RASTREABILIDADE.md) |
| Motivo de uma decisão e suas alternativas | ADR numerada e [índice de ADRs](adr/README.md) |
| Trabalho ainda pretendido | Plano ou spec vivos |
| O que foi observado em uma data/execução | Auditoria ou relatório no arquivo histórico |

Mantenha a explicação completa no documento dono e use links nos demais.
Não duplique listas de versões, contagens ou procedimentos que passam a exigir
manutenção em vários lugares. Código e configuração demonstram o comportamento
implementado; uma spec demonstra intenção. Quando divergem, registre a diferença
sem transformar um bug em regra de negócio nem declarar a intenção entregue.

## Formato e estilo

- Novos arquivos em `kebab-case.md`; preserve os nomes canônicos existentes,
  como `CONTEXT.md` e `WORKFLOW.md`. ADRs usam o padrão numérico do seu índice.
- Prosa em português técnico, com acentos e termos canônicos do glossário.
  Preserve B/L, invoice, demurrage e identificadores quando esse for o termo
  do domínio; não traduza nomes de código nem invente rótulos de interface.
- Explique primeiro o efeito no sistema, depois o mecanismo. Siga o
  [contrato de comunicação](agents/linguagem-do-sistema.md).
- Diagramas em **Mermaid**.
- Caminhos de código em crases são referências literais; para navegação clicável, use links Markdown relativos.
- Links internos relativos ao arquivo que contém o link, inclusive após mover
  documentos. Confira também as âncoras de seção; o gate não as valida.
- Blocos de comando devem indicar o shell e o diretório de execução quando
  não for a raiz. Separe exemplos de Bash e PowerShell quando a sintaxe diferir.
  Informe pré-requisitos, alvo e efeitos de comandos que escrevem dados.
- Exemplos usam valores fictícios; nunca copie credenciais, tokens, dados de
  clientes ou URLs de conexão com senha para a documentação.
- Datas em planos/specs e registros históricos; documentos canônicos de módulo mantêm nomes estáveis.
- Uma data de revisão informa o escopo realmente conferido. Não atualize a data
  de validação remota por ter revisado somente prosa ou código local.

## Estrutura dos módulos

Cada doc de módulo usa estes sete blocos nesta ordem:

1. `## Propósito e escopo`
2. `## Anatomia das telas`
3. `## Catálogo de ações`
4. `## Estado e dados`
5. `## Fluxos e invariantes`
6. `## Testes e validação`
7. `## Notas e divergências`

Use exatamente esses sete títulos de nível 2; organize detalhes com nível 3.
Descreva, respectivamente: limites do módulo; rotas e estados de tela; ações;
entidades e donos dos dados; transições e invariantes; evidências e lacunas;
diferenças conhecidas entre intenção, código e ambiente. Não esconda uma lacuna
sob um título vazio nem invente uma validação para completar o formato.

## Labels de evidência

Afirmações técnicas são calibradas por tipo de prova; as categorias não formam uma ordem de força:

| Label | Quando usar |
|---|---|
| **Código** | A afirmação é verificável por leitura estática do código-fonte |
| **Teste** | Um teste automatizado exercita a afirmação; cite o arquivo/caso e diferencie existência de execução bem-sucedida |
| **Runtime** | Comportamento observado em um ambiente identificado; registre versão, data, cenário e resultado |
| **Suspeita** | A afirmação não foi verificada — é uma hipótese ou risco conhecido |

Inspeções textuais de migrations devem ser nomeadas **Teste de contrato SQL**:
provam a forma do SQL, não sua execução. Um teste que executa SQL em Postgres
real é **Teste**, com o ambiente e os limites dos shims registrados. RLS exige
testar a identidade/papel correspondente; sucesso como superusuário não prova
isolamento por Cliente.

Uma evidência sustenta uma afirmação específica, não o módulo inteiro.
`skip`, ausência de erro no build e presença de arquivo não equivalem a fluxo
validado. Hipóteses devem trazer o que falta verificar. Resultados remotos não
podem ser inferidos de migrations locais ou configurações gravadas.

## Catálogo de ações

Toda ação catalogada num módulo deve expor esta estrutura de tabela:

```text
| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
```

| Coluna | Conteúdo esperado |
|---|---|
| Tela / ação | Rota/tela e rótulo visível que dispara a ação |
| Pré-condições | Estado, dados e autorização necessários |
| Origem | Página/componente que recebe a interação |
| Orquestração | Hook/serviço que coordena a operação |
| Persistência | RPC, tabela, storage ou indicação explícita de que não escreve |
| Efeitos e cache | Reflexos em outras telas, invalidações, filas e notificações |
| Falhas | Erros relevantes e o que o usuário observa ou pode fazer |
| Evidência | Tipo de prova e referência específica; lacuna quando não verificado |

Escape barras verticais literais nas células (`\|`). Não confunda confirmação
de uma chamada com conclusão de um efeito assíncrono.

## Histórico vs arquivo

- Módulos, índices, arquitetura, operações e setup são documentação viva.
  Planos/specs vivos descrevem trabalho pendente, não comportamento entregue.
- ADRs preservam o contexto e a decisão original. Mudanças posteriores usam
  nova ADR e/ou nota editorial datada, com escopo e referência à decisão que
  estende ou supersede a anterior. Atualize o índice; extensão não é sinônimo
  de supersessão. Não reescreva o relato original para apagar sua evolução.
- `docs/archive/` contém registros históricos. Preserve suas conclusões e
  evidências originais; correções posteriores devem ser identificadas como
  notas editoriais, nunca apresentadas como observações da data original.
  Links históricos podem apontar para caminhos da época e não são validados
  pelo gate. Isso não autoriza links quebrados em documentos vivos.

## Ciclo de vida de planos e specs

Existem exatamente dois destinos para cada tipo de documento, definidos pelo estado de execução:

| Documento | Vivo (pendente) | Concluído |
|---|---|---|
| Plano de implementação | `docs/plans/` | `docs/archive/plans/` |
| Spec / design doc | `docs/spec/` | `docs/archive/specs/` |

- Um **plano é vivo** enquanto houver trabalho previsto ainda pendente. Na
  mudança que conclui sua execução, mova-o para `docs/archive/plans/` e retire-o
  do índice vivo. Não espere um commit posterior ao merge para arquivá-lo.
- Uma **spec é viva** enquanto a implementação que descreve estiver pendente.
  Quando o plano derivado termina, mova a spec para `docs/archive/specs/` e
  atualize seu índice. Se houver outros planos ainda pendentes, registre esse
  vínculo e preserve a spec viva até concluir seu escopo.
- Planos cancelados ou substituídos também saem do índice vivo: arquive-os
  indicando o estado e a razão, sem marcá-los como executados.
- Ao mover, atualize os links dos documentos vivos e os índices envolvidos;
  confira links relativos do arquivo movido sem reescrever seu conteúdo histórico.
- Nomenclatura: `YYYY-MM-DD-<tema>.md` (planos) e `YYYY-MM-DD-<tema>-design.md` (specs). Skills e agentes gravam **diretamente** em `docs/plans/` e `docs/spec/` — nunca em subpastas por ferramenta (ex.: `docs/superpowers/` foi aposentado em 2026-07-18).
- Auditorias, reviews e relatórios de execução datados nascem históricos: gravar direto em `docs/archive/audits/` (auditorias/reviews) ou `docs/archive/reports/` (relatórios de execução).

## Revisão e verificação

Antes de concluir uma alteração documental:

1. Confira as afirmações nas fontes executáveis e na definição mais recente
   de cada contrato; uma migration posterior pode substituir a anterior.
2. Elimine contradições entre os documentos vivos afetados e mantenha uma
   referência canônica para cada conceito.
3. Confira caminhos, âncoras, comandos, estados e rótulos citados.
4. Execute `npm run docs:check` e `git diff --check`.

O [gate documental](../scripts/check-docs.mjs) verifica existência dos destinos
de links relativos fora do arquivo histórico, índices obrigatórios, cobertura
do índice de ADRs, formato dos módulos e presença das rotas extraídas dos dois
roteadores na arquitetura e na rastreabilidade. Também rejeita `CLAUDE.md` na
raiz e algumas afirmações obsoletas conhecidas.

Ele não verifica âncoras, URLs externas, caminhos apenas em crases, correção
semântica, execução dos comandos, autorização real ou rollout remoto.
Uma checagem verde não substitui essa revisão.
