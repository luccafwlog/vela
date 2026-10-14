# 2026-10-13 — Revisão geral da documentação

Relatório da revisão geral feita de 2026-10-13 a 2026-10-14 no branch
`claude/stoic-ride-76sf0b`, a pedido do dono, sob a
[ADR 0082](../../adr/0082-governanca-documental-dono-unico-e-adr-historica.md).
É registro histórico: descreve o que foi conferido e mudado nestas datas. As
decisões que ficaram com o dono continuam no
[plano vivo da revisão](../../plans/2026-10-13-revisao-geral-documentacao.md)
até serem respondidas.

## Resultado em uma frase

A documentação viva passou a ter um dono por fato. O `CONTEXT.md` virou só
glossário, as regras foram para os módulos e para `regras-de-negocio.md`, e as
ADRs antigas ganharam uma faixa que diz o que ainda vale e onde está a regra
de hoje. Ficaram 58 decisões com o dono: 25 de negócio, 32 defeitos em que o
código desobedece uma decisão registrada e 1 sobre registrar decisões já em
produção.

## Método

| Etapa | O que foi feito |
|---|---|
| Regras do trabalho | ADR 0082, `CONVENCOES.md` (dono por tipo de informação; classificação (a)/(b)/(c)) e plano vivo |
| Auditoria | 15 escopos: 12 domínios (D0 transversal a D11 infraestrutura) e 3 transversais (RASTREABILIDADE, ARCHITECTURE e índices). Cada documento foi confrontado com a cadeia de ADRs, as migrations ativas e `src/` |
| Verificação | Cada achado passou por um verificador independente, com as lentes de código e de decisão, que confirmou, ajustou ou refutou |
| Aplicação | Um agente por dono de arquivo, sem dois agentes no mesmo arquivo; commits por domínio |
| Glossário | As 23 fatias do `CONTEXT.md` foram reescritas pelos donos dos domínios e montadas de novo |
| Conferência das regras | Um workflow comparou cada fatia original com a nova e procurou, nos donos, cada regra retirada (665 regras, com verificador adversarial) |
| Proteção | `docs:check` ampliado e testado no CI |

Evidência: leitura estática de documentos, código e migrations ativas
(**Código**), testes dos scripts do gate (**Teste**) e uma listagem só leitura
das Edge Functions de produção em 2026-10-14 (**Runtime**). Nenhuma suíte
da aplicação, nenhuma RLS e nenhum fluxo de tela foram executados nesta
revisão; o que os documentos dizem sobre isso vem das fontes que eles citam.

## Achados

| Tipo | Quantidade | Destino |
|---|---:|---|
| (a) documento defasado | 304 | Corrigido no documento dono |
| dup — mesmo fato em mais de um lugar | 42 | Texto completo no dono; nos demais, link |
| (b) código diverge da decisão | 49 | Registrado; vira tarefa de código depois da resposta do dono |
| (c) documentos se contradizem | 4 | Registrado como decisão pendente |
| Refutado pelo verificador | 1 | Descartado (D1-24) |
| **Total** | **400** | |

Severidade: 21 alta, 183 média, 196 baixa.

| Escopo | (a) | dup | (b) | (c) |
|---|---:|---:|---:|---:|
| D0 Transversal e Administração | 18 | 2 | 5 | 1 |
| D1 Viagens | 22 | 1 | 2 | — |
| D2 ADR operacional e vazios | 21 | 2 | 10 | — |
| D3 B/L e Baplie | 24 | 5 | 2 | — |
| D4 CE Mercante e Desbloqueio | 25 | 2 | 2 | — |
| D5 Clientes e Revisão | 19 | 3 | 3 | — |
| D6 Taxas Locais e Faturamento | 21 | 5 | 2 | 1 |
| D7 Demurrage | 19 | 2 | 4 | — |
| D8 Conciliação PIX | 17 | 2 | 2 | — |
| D9 Portal e segurança | 21 | 1 | 5 | 2 |
| D10 Alertas e comunicação | 19 | 7 | 8 | — |
| D11 Infraestrutura | 21 | 1 | 3 | — |
| RASTREABILIDADE | 20 | 4 | 1 | — |
| ARCHITECTURE | 15 | 4 | — | — |
| Índices, roadmap e soltos | 22 | 1 | — | — |

Os 53 itens (b)/(c), depois de unidos os repetidos, viraram os lotes A e B do
plano. A aplicação e a conferência final acrescentaram A25, B26 a B32 e C1.

## O que mudou

### Glossário

O `CONTEXT.md` caiu de 2.376 para 1.584 linhas, com as mesmas seções de
primeiro nível. Cada verbete tem termo, definição curta, distinção e link para
a regra. Prazos, ramos, exceções, efeitos e estado de implementação foram para:

- os doze módulos de `docs/modules/`;
- `regras-de-negocio.md`, que passou a ser dono das ações sobre registros
  (Confirmação de ação, Hard delete, Trava de exclusão, Cadastro usado, Guarda
  e recuperação), da Leitura de planilhas, do Rastro das importações e da
  Liberação de faturamento sem Portal;
- `linguagem-do-sistema.md`, dono do contrato de comunicação.

A conferência das regras retiradas achou uma perda real: quem pode excluir
escala de exportação. A revisão tinha escrito em `seguranca.md` que é qualquer
Departamento ativo, mas a migration `088` devolveu a exclusão ao
Administrativo. Achou também um erro vizinho: a nota D9-05 dizia que o resumo
das 08:00 avisa da exceção crítica de fatura, e o código mostra que não avisa.
Os dois foram corrigidos.

### ADRs

- Nenhuma ADR foi movida nem renumerada. 66 das 81 ADRs abrem com a faixa
  "Situação atual (2026-10-13)", que diz o que não vale mais, quem alterou e
  onde está a regra vigente.
- O índice ganhou as colunas Status, Implementação e Regra vigente em.
  Status: 45 supersedidas parcialmente, 8 estendidas e 28 aceitas.
- Números de migration da cadeia anterior à consolidação passaram a ser
  escritos "migration arquivada `NNN`".

### Documentos

- Módulos: os doze seguem as sete seções e o catálogo de oito colunas.
  `desbloqueio-ce.md` foi reescrito nesse formato e entrou no gate.
- `ARCHITECTURE.md` descreve o desenho e aponta as regras aos módulos.
  `RASTREABILIDADE.md` foi conferido rota a rota.
- `WORKFLOW.md`, setup e operações foram conferidos contra `package.json`,
  scripts e workflows. `validacao.md` aponta para as regras nos módulos em vez
  de repeti-las.
- `ROADMAP.md` e `CHANGELOG.md` agora registram o que foi entregue desde
  2026-09-18. Os índices de planos e specs listam só o que está vivo.
- As skills grilling, design-audit, improve-codebase-architecture e
  vela-code-review tratam o `CONTEXT.md` como vocabulário e o módulo como dono
  da regra.
- Documentos datados foram para `docs/archive/`:
  - os quatro relatórios de skills de 2026-09-18;
  - a conferência do BR Code de 2026-09-10;
  - as duas auditorias de `docs/design-audit/`, com 71 imagens.

### Integração com a `main`

Durante a revisão, a `main` publicou a identidade visual única
([ADR 0081](../../adr/0081-identidade-visual-unica.md)). A ADR de governança,
ainda não publicada, passou a ser a 0082. O merge manteve as duas mudanças: a
identidade visual entrou na tabela de donos, no índice documental e no índice
de ADRs, e a ADR 0066 registra a extensão. A passada única da identidade mudou
rótulos, menus, blocos e ações em mais de cem arquivos de tela. Um segundo
workflow atualizou os módulos a essas telas, com um verificador por domínio, e
os 16 pontos que ele apontou foram corrigidos e conferidos no código.

### Gate documental

O `npm run docs:check` passou a recusar:

- ADR com número repetido, sem linha na tabela do índice, ou com a linha
  `Status:` diferente dela;
- ADR estendida ou supersedida sem a faixa "Situação atual";
- documento com data no nome fora de `docs/archive/`, salvo plano ou spec
  vivos;
- link para uma seção que não existe (`arquivo.md#secao` ou `#secao`), com a
  âncora no estilo do GitHub.

Os helpers têm testes de asserts no CI (`scripts/lib/docs-adr.test.mjs` e
`scripts/lib/docs-anchors.test.mjs`), e o fixture do gate tem dezoito
cenários de rejeição. Quando as três primeiras regras entraram, acusaram 57
erros; no fim da revisão, com a regra de âncoras também ligada, o gate passa
sem erros.

## Defeitos de código encontrados

Registrados no plano, sem correção nesta revisão. Os de maior impacto:

| Item | Defeito |
|---|---|
| B1 | Trocar o CE de um B/L com Desbloqueio conferido não abre alerta; bloqueia a ativação do Desbloqueio de CE |
| A21 | RPCs legadas do Portal e a policy `cpa_admin_all` permitem reativar conta Suspensa fora da máquina de estados |
| A14 | Qualquer usuário interno ativo grava a referência cambial usada na emissão de Demurrage |
| A16 | O plano B pelo extrato não acha Invoice de Demurrage nem fatura avulsa |
| B3 | NOB com B/L misto ou com exceção de terminal nunca é gravado |
| B4 | Um Cliente do NOB sem contato faz a produtora automática de Comunicados abortar inteira (Suspeita) |
| B32 | `notify-invoice-issued`, que a ADR 0058 mandou apagar, segue publicada em produção |

## O que não foi verificado

- Execução: nenhuma suíte de testes da aplicação, nenhum teste de RLS e nenhum
  fluxo de tela.
- Estado remoto: só a listagem das Edge Functions. O resto vem de registros
  datados.
- Diagramas Mermaid: conferidos pela sintaxe, sem renderização.
- Telas: os rótulos e as ações citados nos módulos foram conferidos no código
  depois do merge com a `main`, não na tela em execução.
- Seções "Celular e toque" e "Densidade e primitivas visuais" da
  `ARCHITECTURE.md`: não foram reconferidas.
- O gate não verifica correção semântica. A coerência entre módulos foi
  conferida pelos verificadores da auditoria e pela conferência das regras do
  glossário, não por uma checagem automática.
