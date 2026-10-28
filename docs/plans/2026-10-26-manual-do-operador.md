# Manual do Operador do Vela (PDF)

Data: 2026-10-26. Origem: pedido do dono em 2026-10-26, antes de o Vela
começar a operar com Clientes reais nas próximas semanas. Este é o plano do
trabalho, não o manual.

## Estado

**Etapa 1 concluída em 2026-10-28; Etapa 2 com o capítulo-piloto (capítulos 4
a 6) pronto e esperando a aprovação do dono.** Páginas-modelo aprovadas em
2026-10-28. O texto está em [`docs/manual/texto/`](../manual/texto/README.md),
o cenário e as 32 capturas em [`scripts/manual/`](../../scripts/manual/pdf/README.md),
e o PDF sai de `npm run manual:build`. Cada capítulo teve conferência
independente contra o código; as correções estão no texto, e as linhas da
matriz que descreviam outra coisa foram corrigidas ("Atualizações da matriz"
no [README do manual](../manual/README.md)). Os defeitos de código que a
conferência achou esperam decisão do dono (item 5 de "Como retomar").
Divergências
decididas e corrigidas em 2026-10-27; lista "fora do manual" e sumário final
aprovados em 2026-10-28. As 118
divergências (112 fichas) foram decididas pelo dono e executadas nos lotes 1 a
11 do [plano de correções](../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md),
com os ajustes da revisão da PR #1070 (migrations `482` a `490`). Os 2.253
itens do sistema têm lugar na [matriz de cobertura](../manual/README.md)
(`npm run manual:coverage` passa contra o banco local), com 1.560 regras
escritas como o operador as vê e conferidas por uma segunda leitura
independente do código. As 79 divergências de documento defasado foram
corrigidas nos documentos vivos. O resultado, com a tabela de quem faz o quê,
o sumário final proposto, a lista "fora do manual" e as 118 divergências que
dependem de decisão, está no
[relatório de 2026-10-26](../archive/reports/2026-10-26-mapeamento-manual-do-operador.md).
Em 2026-10-28 o dono aprovou deixar fora do manual o que não aparece para
ninguém e definiu a direção do conteúdo: o manual explica como o Vela opera e
o que o usuário faz para alcançar cada objetivo e cumprir cada
responsabilidade, e cobre as situações mais comuns, inclusive as de borda
([O manual parte do objetivo de quem usa](#o-manual-parte-do-objetivo-de-quem-usa)).
No mesmo dia o dono aprovou o sumário final (24 capítulos), o que fecha a
Etapa 1, e pediu para começar a Etapa 2 pela importação de arquivos. O
[catálogo de situações do capítulo 6](../manual/situacoes/06-importacao.md)
foi respondido no texto do piloto: 10 objetivos e 35 situações ligadas às regras da matriz; as
três perguntas ao dono (P1 a P3) foram decididas em 2026-10-28 (a mensagem da
P1 foi corrigida pela migration `500`, PR luccafwlog/vela#1083). Os catálogos dos
[capítulos 4](../manual/situacoes/04-viagens-escalas.md) e
[5](../manual/situacoes/05-programacao.md) também foram respondidos no piloto; a
pergunta P4 (falhas de COD, transbordo e Complementar sem aviso na tela) foi
decidida em 2026-10-28 e corrigida na PR luccafwlog/vela#1085; S4.21 já
descreve a tela nova. As nove páginas-modelo
do projeto gráfico (Etapa 2, item 1) estão em
[`scripts/manual/pdf/`](../../scripts/manual/pdf/README.md), com imagens
capturadas do Vela local com dados fictícios e marcações tiradas da posição
real dos elementos na tela.

**Mudança entrada depois da Etapa 1 (2026-10-28): alterar, excluir e isentar
as Taxas Locais do B/L** ([ADR 0111](../adr/0111-alterar-excluir-e-isentar-taxas-locais-do-bl.md),
migrations `491` a `498`; a `497` e a `498` vêm da revisão da PR). Já
está na matriz, com `npm run manual:coverage` passando: as linhas novas e
mudadas estão listadas, lote a lote, em "Atualizações da matriz" do
[README do manual](../manual/README.md). Áreas do
manual que mudaram: Taxas Locais (09a: alterar, excluir, isentar, Histórico das
taxas, Validação), Faturamento (09b: B/L faturado, consolidada, Origem
**Alterado**), Recebimento (10), Portal (07), Clientes (06: **B/Ls com taxa
alterada**), Revisão e ficha do B/L (03), CE e Baplie (04: prévias de
importação), Equipamentos (05: Veículos), Viagens (02: COD), Alertas (12:
**Taxa alterada à mão mudou**) e Acesso (01: setores que recebem o alerta).
Ao escrever esses capítulos, nada precisa ser remapeado.

Diferença mecânica do plano: o check de cobertura roda contra o banco local
preparado, como o `rpc:check`, e não junto do `docs:check`, porque o
inventário sai do banco com todas as migrations. O material antigo está
guardado como registro histórico e serve só de referência de redação
([Régua de qualidade](#régua-de-qualidade)).

## Como retomar (para quem continuar)

1. **Decisões do dono (feitas).** As 118 divergências (em 112 fichas; ver o README da
   pasta para as seis juntadas) foram decididas em 2026-10-27 na página
   <https://claude.ai/artifact/SDGqaeCFq1Uht6ih1ef46R> (fonte e formato do
   registro em [`docs/manual/decisoes/`](../manual/decisoes/README.md)). Leia as
   escolhas com `ArtifactData` (`list`, coleção `decisoes`). Cada escolha vira
   tarefa própria; não corrija o sistema dentro do trabalho do manual. As
   decisões da revisão da PR #1070 estão em
   [Pontos do dono](../manual/decisoes/pontos-do-dono.md).
2. **Aprovações que fecharam a Etapa 1** (seções 5 e 7 do
   [relatório](../archive/reports/2026-10-26-mapeamento-manual-do-operador.md)):
   a lista "fora do manual" ("tudo bem deixar de fora aquilo que não aparece
   para ninguém") e o sumário final (24 capítulos), aprovados pelo dono em
   2026-10-28 na conversa e registrados na página
   <https://claude.ai/artifact/4VK9aBi787ZSNGWmtNW5FK> (coleção `aprovacoes`,
   documentos `sumario` e `fora`, campos `decisao`, `nota` e `decididoEm`).
3. **Ambiente.** `npm ci`, depois `sudo scripts/setup-local-pg.sh --reset`
   (banco `vela_test` com todas as migrations), depois `npm run manual:coverage`
   (precisa terminar com todos os itens com lugar; 2282/2282 em 2026-10-27).
   O CI roda o mesmo check no job `db`.
4. **Material de trabalho da Etapa 1** (instruções de mapeamento, conferência,
   correção de documento e fichas de decisão; montagem do relatório):
   [`scripts/manual/etapa1/`](../../scripts/manual/etapa1/README.md).
5. **Próximo passo (Etapa 2):** o dono lê o PDF do piloto (capítulos 4 a 6) e
   aprova linguagem, profundidade, imagens e aparência, ou diz o que muda. Junto,
   decide os defeitos de código que a conferência achou e que o texto hoje
   contorna ou descreve como estão: escala nova só de importação com código de
   porto desconhecido ("Escala salva com sucesso." sem escala); ETA com hora
   nunca aparece como vencido e o filtro **Período** perde o ETA com hora;
   mensagem dos Vazios EXP que cita a aba "Escalas" inexistente; Nova Viagem e
   **Adicionar navio** mostram só "Falha ao cadastrar…" em vez do motivo;
   **Adicionar navio** sobre Viagem existente apaga datas dos portos em **Não
   escala** sem a confirmação vermelha; gravar data de escala só de exportação
   a marca como importação; confirmação de **Não escala** igual para todas as
   equipes; **Não escala** com trava grava parte das datas; data sugerida em
   UTC; planilha de programação descarta a hora do ETA; prévia do B/L mostra o
   Embarque em formato ISO; exclusão de B/L com Desbloqueio de CE mostra nome
   técnico. Aprovado o piloto, a Etapa 3 segue pelo catálogo de situações de
   cada lote. Para refazer o PDF: `npm run manual:cenario`, emulador e Vela
   (README do gerador), `npm run manual:capture`, `manual:check` e
   `manual:build`.
6. **Decisões do dono já tomadas nesta conversa**, que valem para as próximas
   etapas: o manual se pauta só pelo código; o material antigo é só referência
   de redação; quem faz o quê sai do código (matriz "O que cada setor pode",
   guardas do banco, avisos por setor), não de tabela pedida ao dono; as
   sessões de teste com a equipe são do dono e ficam fora do plano;
   "certificante" quer dizer CE Mercante.

## Síntese do pedido

O Vela está maduro: identidade visual firmada, regras de negócio desenhadas e
muitos casos de borda tratados no sistema. Antes de abrir para Clientes reais,
a equipe interna precisa de um material de consulta e de aprendizado que
explique **o que fazer em cada momento, como fazer e por quê**.

- **Nada de fora:** nenhuma parte do sistema fica sem lugar no manual. Toda
  regra de negócio que está no código aparece no material de alguma forma: no
  corpo de um capítulo, num apêndice ou no volume de outra equipe. Só pode
  ficar fora o que não tem efeito na operação, listado e aprovado pelo dono.
- **Público da primeira entrega:** os operadores internos, divididos nas
  equipes de **Documentação**, **Equipamentos** e **Operações**. O Financeiro e
  o Administrativo vêm depois, no mesmo material.
- **Conteúdo citado pelo dono como ponto de partida:**
  - as equipes e as responsabilidades de cada uma;
  - o fluxo de trabalho do sistema e a criação da Viagem;
  - a importação da documentação (B/L, Baplie EDI e CE Mercante);
  - o provisionamento do Portal, a criação da conta do Cliente e os e-mails
    que ele recebe;
  - o suporte que a equipe presta ao Cliente;
  - o que o sistema faz sozinho (gatilhos), por exemplo quando se vincula o
    CE Mercante ao B/L ou quando muda a data de chegada do navio;
  - os alertas, quando abrem e quando fecham;
  - o financeiro: alterar e adicionar taxa, cancelar fatura, dar baixa e
    restituir;
  - o que cada perfil pode e não pode fazer.

  O [escopo completo](#escopo-completo) amplia essa lista para o sistema
  inteiro, e o mapeamento da Etapa 1 a fecha.
- **Linguagem:** didática, com o vocabulário da navegação e das telas do Vela,
  sem termos de desenvolvimento.
- **Formato:** PDF com imagens das telas.
- **Fonte de verdade:** o **comportamento atual do sistema**, lido no código.
  Documento ou ADR que diga outra coisa não entra no manual como regra.
- **Uso:** o dono vai usar o manual como roteiro para testar o Vela com a
  equipe e ensinar como agir; por isso cada procedimento tem de poder ser
  seguido sozinho, com a tela à frente.

## Resultado pretendido

1. Um **mapeamento completo do sistema**: cada regra de negócio do código
   ligada ao lugar do manual que a explica, com a garantia, conferida por
   script, de que nenhuma ficou sem destino.
2. Um **Manual do Operador** em PDF que o operador consiga seguir sozinho,
   tarefa por tarefa, com a tela à frente, entendendo a lógica de cada passo.
3. Uma **forma de manter o manual verdadeiro** enquanto o sistema muda: fontes
   no repositório, imagens refeitas por script, conferência automática da
   cobertura e uma regra que obriga a atualizar o manual quando o comportamento
   visível mudar.

O mapeamento cobre o sistema inteiro de uma vez, inclusive o que será escrito
nos volumes do Financeiro e do Administrativo, para que nada caia entre um
volume e outro. A **redação** começa pelo Manual do Operador; os outros
volumes seguem em [Depois do Manual do Operador](#depois-do-manual-do-operador).

Fora de escopo: um guia para o Cliente do Portal (a decidir depois) e vídeos.
O manual não corrige o sistema: defeito encontrado vira tarefa separada.

## Princípios

### O que o código faz é o que o manual diz

Cada afirmação do manual sai do caminho real: tela → botão → serviço → regra no
banco → efeito → onde o resultado aparece. A documentação do repositório
(módulos, `CONTEXT.md`, matriz de permissões, manual financeiro) serve de mapa
para achar esse caminho, não de prova.

Quando o código e um documento discordam, vale a classificação de
[CONVENCOES.md](../CONVENCOES.md#divergência-entre-documento-e-código):

| Caso | O que o manual faz | O que acontece fora do manual |
|---|---|---|
| Documento defasado; código coerente com a decisão | Descreve o código | O documento é corrigido na mesma entrega |
| Código diverge da decisão registrada | Descreve o que o sistema faz hoje, com um aviso visível de "comportamento em revisão" | Vai para a lista de divergências para o dono decidir; se for defeito, vira tarefa |
| Documentos se contradizem e o código não resolve | Não descreve a regra até haver decisão | Vai para a lista de divergências |

O operador nunca lê no manual uma regra que o sistema não cumpre. Um defeito
também não vira regra só porque está no código.

### O manual parte do objetivo de quem usa

Decisão do dono em 2026-10-28. O manual explica exatamente como o Vela opera e
o que o usuário faz para alcançar cada objetivo e cumprir cada
responsabilidade da sua equipe. A matriz de cobertura garante que nenhuma regra
fica sem lugar; ela não é a ordem do texto. O texto é organizado pelas
perguntas de quem está trabalhando:

- **"Quero fazer…"** — cada capítulo abre com os objetivos que ele resolve,
  por equipe, e cada procedimento tem o nome do objetivo ("Cancelar uma fatura
  já paga", "Trocar o Cliente de um B/L"), não o nome da tela.
- **"Aconteceu…"** — as situações mais comuns fora do caminho normal, em
  especial na importação de arquivos: o que o sistema faz naquele caso, a regra
  geral que explica o comportamento e o que o usuário faz para chegar ao
  resultado. Exemplos do dono: cancelar uma fatura já paga, trocar o B/L (ou o
  Cliente dele), reimportar um arquivo com containers diferentes.
- As situações saem do [catálogo de situações](#etapa-2--projeto-gráfico-cenário-imagens-e-pdf-capítulo-piloto)
  (Etapa 2), que liga cada uma às regras da matriz que a respondem.

Fica fora só o que não aparece para ninguém (lista aprovada em 2026-10-28).
A meta é que a maior parte das situações reais tenha resposta no manual, de
forma explicativa, e não só as regras listadas.

### Toda regra tem um lugar, mas nem toda regra vai no corpo do texto

O sistema trata muitos casos de borda. Pôr todos no corpo do texto tornaria o
manual ilegível. Cada regra mapeada recebe um destino:

| Destino | O que vai |
|---|---|
| **Corpo do capítulo** | Caminho normal e desvios frequentes de cada procedimento |
| **Quadro "Se algo der errado"** do procedimento | Bloqueios e recusas que aparecem naquele passo |
| **Apêndice de mensagens** | Cada mensagem que a tela pode mostrar: o que significa e o que fazer |
| **Capítulo de gatilhos** | Tudo o que o sistema faz sozinho depois de uma ação ou de um horário |
| **Capítulo de alertas** | Cada tipo de alerta: quando abre, quem recebe, quando fecha, o que fazer |
| **Capítulo de permissões** | Cada ação que depende do setor |
| **Volume de outra equipe** | Regra que só o Financeiro ou o Administrativo aplica, com uma linha "quem faz e como pedir" no volume do operador quando a operação depende dela |
| **Fora do manual (aprovado)** | Só o que não tem efeito na operação nem na tela (backup, monitoramento técnico, segurança interna), listado com o motivo e aprovado pelo dono |

### Linguagem

- Os nomes são os da tela: rótulos de botões, abas, colunas, filtros e status
  exatamente como aparecem, conferidos no código ou na captura.
- Os termos de negócio seguem o [glossário](../../CONTEXT.md) (Viagem, Escala,
  B/L, CE Mercante, Baplie, Demurrage, free time…), explicados em linguagem de
  navegação na primeira vez que aparecem e repetidos no glossário do manual.
- Termos técnicos proibidos no texto impresso: tabela, banco, RPC, migration,
  query, trigger, Edge Function, endpoint, cron, JSON, ID técnico, payload e
  semelhantes. A lista vira um check automático (Etapa 2).
- Tom: segunda pessoa, frases curtas, um passo por linha, o porquê depois do
  como.

### Modelo de cada procedimento

Todo procedimento do manual segue a mesma forma:

1. **Quando usar** — a situação real da operação.
2. **Quem faz** — os setores que o sistema permite e, quando o sistema aponta
   um setor (alerta, assinatura do ADR de Saída), esse setor.
3. **Antes de começar** — o que precisa existir (Viagem criada, B/L importado,
   CE vinculado…).
4. **Passo a passo** — com imagens da tela e o rótulo exato de cada botão.
5. **O que o sistema faz sozinho depois** — gatilhos, alertas, e-mails,
   cálculos.
6. **Onde conferir o resultado** — tela, coluna, status ou ficha.
7. **Se algo der errado** — mensagens de bloqueio e o que fazer.
8. **Por que é assim** — a lógica do negócio, em poucas linhas.

## Escopo completo

Áreas do sistema que o material cobre, montadas a partir do
[mapa de rotas](../ARCHITECTURE.md#mapa-de-rotas), dos
[documentos de módulo](../README.md#módulos), das
[regras transversais](../operations/regras-de-negocio.md) e das rotinas
automáticas do servidor. A lista é o ponto de partida do mapeamento, não o
limite dele. O que a Etapa 1 achar no código e não estiver aqui entra, e a
cobertura é conferida contra o código, não contra esta tabela.

"Operador" indica o capítulo do sumário do Manual do Operador (seção
seguinte); "Financeiro" e "Administrativo", os volumes seguintes.

### Entrada, navegação e perfis

| Área | O que entra | Onde |
|---|---|---|
| Acesso | Login interno, sessão, troca da própria senha e dados em `/perfil`, tela "Página não encontrada" | Operador 1 |
| Navegação | Menu, Painel (`/painel`) e seus cartões de pendências por setor, Notificações Internas, busca e filtros, seleção em massa, janela de confirmação, como ler status e cores | Operador 1 |
| Rotina e encaminhamento | Rotina diária por setor, checklists, "a quem passar cada pendência", quem trabalha em mais de um setor | Operador 1 e 2; guias de bolso |
| Equipes e permissões | As 39 linhas da matriz "O que cada setor pode" (`/admin/usuarios`), as ações que só o Administrativo faz, as condições por setor, quem recebe cada tipo de alerta | Operador 2 |
| Administração | Usuários e setores (criar, ativar, desativar, trocar e-mail e senha), último Administrativo ativo, conta de integração, falhas de entrega de alertas, histórico de ações, sistema, Prazo do ADR | Administrativo; resumo em Operador 2 |
| Ações sobre registros | Cancelar × excluir, motivo obrigatório, Trava de exclusão, cadastro em uso, guarda e recuperação | Operador 2 e em cada procedimento |

### Operação marítima

| Área | O que entra | Onde |
|---|---|---|
| Viagens | Criar Viagem, identidade do navio, status da Viagem, Escala, Atracação, terminais, datas do navio (ETA, ETB, ETD, ATA, ATD), ETD e ATD do POL, programação, exportação da Escala, omissão de Escala e sua reversão, transbordo, COD, Linha do Tempo, indicadores, importação rápida, cancelar, reativar e excluir | Operador 4 |
| ADR de Saída | Um relatório por terminal da Escala, seções por setor, observação, assinatura, fechar, reabrir com motivo, prazo | Operador 9 |
| Chegadas e Saídas | Programação exibida no Portal, saída da programação | Operador 4 |
| Line-Up | Line-Up e o display da TV | Operador 4 |
| Cadastros de apoio | Navios, armadores, portos, terminais, Locais (depots), feriados e parâmetros que mudam prazos ou cálculos | Operador 4 e 8; Administrativo |

### Documentação e carga

| Área | O que entra | Onde |
|---|---|---|
| Arquivo de B/L | Importação da planilha, prévia, leitura de cabeçalhos, recusa por erro, modalidade, peso e cubagem, carga solta e mista, contato do manifesto, e-mail capturado do B/L, preço das Taxas Locais fixado no aceite da prévia, reimportação | Operador 5 |
| CE Mercante | Importação, vínculo ao B/L, troca de CE e reconferência, Manifesto Mercante, o que o CE libera (Portal, faturamento) | Operador 5, 6 e 15 |
| Baplie (EDI) | Importação, marcas, SOC/COC, divergências, conciliação Baplie × B/L | Operador 5 |
| Outras importações | Veículos, Vazios de importação, Granito, datas de container, Base de Clientes, programação; histórico das importações; efeitos processados depois da importação e efeito bloqueado | Operador 5 |
| Ficha do B/L | Abas, carga, vínculo do Cliente, vínculo do CE, mover veículos, correção antes e depois do faturamento, cancelar, reativar e excluir | Operador 6 |
| Revisão | Pendências, o que cada uma bloqueia (inclusive a emissão da fatura), como resolver, liberação | Operador 7 |
| Containers e veículos | `/containers`, `/veiculos`, local de desova, IMO e OOG, container compartilhado | Operador 8 |
| Vazios | Vazios de importação (natureza), Embarque de Vazios por Escala, linhas de serviço manuais, Locais e valores sugeridos | Operador 8 |
| Granito | Manifesto de Granito, carga movimentada no navio, telas que leem o Granito | Operador 8 |
| Desbloqueio de CE | Requisitos, condição VIP, requisito financeiro, pedido que muda de B/L, documentos, entrega física, prazo, avisos ao Cliente, envio à ZPT e conciliação, troca de CE, conclusão, expurgo de documentos | Operador 10 |

### Cliente e Portal

| Área | O que entra | Onde |
|---|---|---|
| Cadastro do Cliente | Lista e ficha, identidade pelo CNPJ, vínculo do Cliente no B/L, Base de Clientes, contatos e Caixas de Comunicação, saldo pendente, desativação e exclusão | Operador 11 |
| Central de Informações | Cadastros internos e publicação das seis seções que o Cliente lê (Taxas Locais, Devolução, Demurrage, Agentes, Atendimento, Tracking) | Operador 11 |
| Portal: conta do Cliente | Provisionamento, convite, ativação, e-mail de recuperação, recuperação de senha, suspensão, bloqueio temporário de login, o que o CE Mercante libera no Portal | Operador 12 |
| Portal: o que o Cliente vê | Painel, Faturas, Operação, Desbloqueio de CE, Central de Informações, Perfil e notificações, contestação; tudo conferido pelo Modo Inspeção | Operador 12 e 14 |
| E-mails ao Cliente | Convite, recuperação de senha, confirmação de e-mail, resumo diário, Comunicados manuais e régua automática, prontidão de comunicação de taxas, Régua de Cobrança da Demurrage, avisos do Desbloqueio de CE; e-mail recusado, supressão e recusa em cascata | Operador 13 |
| Suporte ao Cliente | Roteiro por pedido do Cliente, sempre conferindo no Modo Inspeção | Operador 14 |

### Financeiro

| Área | O que entra | Onde |
|---|---|---|
| Tabelas de Taxas Locais | Tabelas, itens de taxa, condições de Cliente, data de referência da tarifa, movimento e isenção, THD de IMO e OOG, taxa em dólar | Financeiro; visão geral em Operador 17 |
| Cálculo das Taxas Locais | Fato gerador, fases do cálculo, preço fixo na importação, taxa manual do B/L (adicionar e excluir), o que trava o cálculo | Operador 17; Financeiro |
| Emissão | O que segura a emissão, Liberação de faturamento sem Portal, emissão automática, individual, consolidada e avulsa, Validação, número da fatura, documento congelado, câmbio (ROE e PTAX), vencimento e inadimplência | Operador 17; Financeiro |
| Correções após emissão | Reemissão e fatura sucessora, fatura desatualizada, troca de Cliente após emissão, carga solta faturada na reimportação, Ajuste de COD, cancelamento de fatura | Financeiro; "quem faz e como pedir" em Operador 17 |
| Recebimento | Cobrança Pix do Itaú e baixa automática, Pendências, Pix em análise, consulta parada e plano B, conciliação pelo extrato, baixa manual, cancelamento de baixa, recibo, histórico e exportação | Financeiro |
| Restituição | Restituição, restituição excepcional, confirmação da devolução | Financeiro |
| Demurrage | Datas e status do container, SOC, tarifas, free time, P1 e P2, acordo do Cliente, Invoice de Demurrage, cobrança por caixa, datas alteradas após emissão, recebível sem fatura, recálculo diário e congelamento no pagamento, desconto, baixa, cancelamento e restituição, Régua de Cobrança, disputa | Operador 8 e 17 (parte operacional); Financeiro |

### O sistema sozinho, alertas e relatórios

| Área | O que entra | Onde |
|---|---|---|
| Gatilhos de ações | O que muda sozinho quando se vincula o CE Mercante, muda a data de chegada do navio, vincula ou troca o Cliente, registra o ATD, importa, corrige ou cancela um B/L, muda datas de container, emite ou cancela uma fatura | Operador 15 |
| Rotinas por horário | Detector de alertas, efeitos de importação, régua de Comunicados, Régua de Cobrança da Demurrage, resumo diário do Portal, PTAX diário e recálculo da Demurrage, status de Demurrage, consulta de Pix do Itaú, avisos e expurgo do Desbloqueio de CE, reavaliação de liberação vencida, eventos de entrega de e-mail | Operador 15 |
| Alertas | Alerta × Notificação Interna, telas Alertas e Regras dos alertas, cada tipo ativo (quando abre, quem recebe, quando fecha sozinho, o que fazer), encerrar um alerta | Operador 16 (todos os tipos de Documentação, Equipamentos e Operações); Financeiro e Administrativo (os demais) |
| Relatórios | Relatórios e exportações disponíveis | Operador 1 e capítulos de cada área |
| Quando o sistema falha | Mensagem de erro, serviço indisponível, a quem avisar | Operador 1 e apêndice B |
| Infraestrutura | Backup, monitoramento, retenção de dados, segurança técnica | Fora do manual, salvo o efeito visível ao usuário (por exemplo, dado que some depois de um prazo) |

## Sumário proposto do Manual do Operador

O sumário final sai do mapeamento aprovado (Etapa 1). Os números abaixo são os
usados na coluna "Onde" do escopo.

**Parte I — Entendendo o Vela**

1. O Vela e o Portal Fwlog: entrar, perfil, menu, "como o Vela fala" (cores,
   sinais, janela de confirmação), a rotina diária a partir do Painel,
   relatórios e o que fazer quando o sistema falha.
2. As equipes e o que cada uma faz no sistema, tirado do código (1.4), **o que
   cada perfil pode e não pode**, inclusive cancelar e excluir, e **a quem
   passar cada pendência**.
3. O caminho de uma Viagem do começo ao fim: Viagem → B/L → CE Mercante →
   Revisão → Taxas Locais → fatura → Portal → pagamento, num desenho único.

**Parte II — Operação passo a passo**

4. Viagens, Chegadas e Saídas, Line-Up e cadastros de apoio.
5. Importação da documentação: arquivo de B/L, CE Mercante, Baplie e demais
   importações.
6. A ficha do B/L.
7. Revisão.
8. Equipamentos: containers, veículos, Vazios, Granito e a parte operacional
   da Demurrage.
9. ADR de Saída.
10. Desbloqueio de CE.

**Parte III — O Cliente**

11. Cadastro do Cliente e Central de Informações.
12. Portal: a conta do Cliente e o que ele vê.
13. Os e-mails que o Cliente recebe.
14. Suporte ao Cliente.

**Parte IV — O que o sistema faz sozinho**

15. Gatilhos e rotinas por horário, numa tabela "Você faz (ou chega a hora) →
    o sistema faz → onde aparece".
16. Alertas.

**Parte V — O financeiro visto pela operação**

17. Taxas Locais, emissão, Demurrage e o que cabe a cada equipe; baixa,
    cancelamento e restituição como visão geral ("quem faz e como pedir").

**Apêndices**

- A. Glossário em linguagem de navegação.
- B. Mensagens do sistema: o que significa e o que fazer.
- C. Status e cores: Viagem, B/L, CE, fatura, pedido de desbloqueio, alerta.
- D. "Quero fazer… / Aconteceu… → onde fica": índice por objetivo e por
  situação, gerado do catálogo de situações.
- E. Índice remissivo.

Fora do PDF principal, um **guia de bolso** por equipe (régua visual).

## Régua de qualidade

O manual novo tem de ficar **muito acima** do material que já existe, no visual
e no conteúdo. As réguas abaixo são critérios de aceite, não intenções.

O material antigo ("Vela — Manual do Operador", versão 1, de 2026-10-15, 36
páginas, não revisado) está guardado como registro histórico em
[`docs/archive/assets/2026-10-15-manual-do-operador-antigo.pdf`](../archive/assets/2026-10-15-manual-do-operador-antigo.pdf).
Por decisão do dono, ele é só **referência de como outra pessoa redigiu um
manual completo e hoje desatualizado**. Não é roteiro, não é lista de pontos a
responder e não é fonte: o manual novo se pauta pelo código.

### Régua visual

- **Projeto gráfico próprio**, com capa, abertura de parte e abertura de
  capítulo desenhadas. Cada trilha tem a cor da sua equipe. A abertura do
  capítulo diz o que se aprende, quem usa e o tempo de leitura.
- **Imagens das telas** recortadas na área que importa, com marcações
  numeradas que casam com os passos e o botão a clicar destacado. A tela
  inteira aparece só quando o contexto ajuda.
- **Desenhos próprios:**
  - o caminho da Viagem por equipe, em raias;
  - o ciclo de vida de cada entidade (status e o que move de um para outro);
  - o mapa de gatilhos;
  - a linha do tempo da Demurrage (free time, P1, P2);
  - o que segura a emissão da fatura.
- **A mesma cara do sistema:** cores, letra, ícones e etiquetas de status iguais
  aos da tela, pela [identidade visual](../identidade-visual.md), para o
  operador reconhecer no papel o que vê no Vela.
- **Poucos quadros, sempre os mesmos:** Atenção, Não faça, O sistema faz
  sozinho, Por que é assim.
- **Navegação:**
  - sumário com página e link clicável;
  - cabeçalho com a parte e o capítulo;
  - referências cruzadas clicáveis ("veja 6.2");
  - índice remissivo no fim.
- **Paginação cuidada:** sem página meio vazia, sem tabela ou imagem partida e
  sem título órfão no pé da página.
- **Guia de bolso por equipe:** uma ou duas páginas com a rotina, os checklists
  e o "a quem passar", para imprimir à parte.
- **Formato:** legível na tela e impresso em A4.

### Régua de conteúdo

- Toda regra do mapeamento escrita no destino que recebeu.
- Cada procedimento no [modelo de oito partes](#modelo-de-cada-procedimento),
  com o que precisa existir antes, o que o sistema faz sozinho depois e o
  porquê.
- As telas são achadas pelo caminho do menu e das abas, como o operador
  navega, não pelo endereço da página.
- Recursos de consulta: rotina diária por equipe, checklists, o quadro "a quem
  passar cada pendência" e as mensagens em cartões (onde aparece, o que quer
  dizer, o que fazer).
- Nenhuma marca "[confirmar]", nenhum lugar de imagem vazio e nenhum termo
  técnico proibido no texto impresso.
- Cada rótulo, caminho de tela e mensagem conferido no código ou na captura.
- Um exemplo contínuo: o mesmo navio, a mesma Viagem, o mesmo Cliente e os
  mesmos B/Ls fictícios atravessam o manual inteiro.
- Cada capítulo abre com os objetivos que resolve e traz as situações comuns
  do catálogo ("Aconteceu…"), cada uma com o que o sistema faz, a regra geral
  e o que o usuário faz.
- Fim de capítulo com resumo e um exercício sobre o cenário.

## Escolhas de rotina (podem ser revistas)

- **Um conteúdo, vários PDFs:** um manual único, em partes, gera o PDF completo
  e um PDF por equipe com os capítulos dela e os comuns.
- **Fonte no repositório:** o texto fica em Markdown versionado junto do
  código, para que a mesma alteração que muda o sistema atualize o manual. O PDF
  é gerado por script e não é versionado.
- **Aparência:** o PDF segue a [identidade visual](../identidade-visual.md)
  (cores, letra e status do Vela), em A4, legível impresso.
- **Data e versão na capa:** cada PDF diz a data e a versão do Vela que
  descreve.

## Etapas

### Etapa 1 — Mapeamento completo do sistema

Objetivo: provar que nenhuma regra de negócio do código ficou sem lugar no
manual. A completude é conferida contra listas extraídas do código, não contra
a memória de quem escreve nem contra a documentação.

**1.1 Levantar tudo o que o sistema tem.** No código e num banco local
descartável com todas as migrations aplicadas (o estado final de cada regra é a
última definição, não a primeira), extrair as listas completas de:

| Fonte | O que dá ao manual |
|---|---|
| Telas e rotas do Vela e do Portal | Onde cada coisa acontece |
| Botões, abas, filtros, colunas e janelas de cada tela, com o rótulo exato | O passo a passo |
| Funções do banco que as telas chamam | Cada ação e suas condições |
| Regras automáticas do banco (o que recalcula, bloqueia ou registra sozinho) | Gatilhos e bloqueios |
| Restrições de dado (o que o sistema recusa gravar) | "Se algo der errado" |
| Rotinas agendadas e funções de servidor (e-mail, Portal, Itaú, Demurrage, Desbloqueio de CE, alertas) | O sistema sozinho |
| Catálogo de alertas (tipos ativos, setores avisados, abertura e fechamento) | Capítulo de alertas |
| Modelos de e-mail | E-mails ao Cliente |
| Status de cada entidade e o que move de um para outro | Apêndice de status e fluxo |
| Mensagens de erro e bloqueio do banco e das telas | Apêndice de mensagens |
| Leitores de planilha e arquivo (colunas, formatos, validações) | Importações |
| Cálculos (Taxas Locais, Demurrage, câmbio, vencimento, prazos) | Por que é assim |
| Matriz de permissões e guardas por setor | Capítulo de permissões |

**1.2 Traduzir cada item em regra.** Para cada item das listas, escrever a
regra em linguagem de operação (o que acontece, quando, para quem, com que
efeito visível), com a referência ao código que a sustenta. O trabalho é
dividido pelas áreas do [escopo completo](#escopo-completo) e cada área passa
por uma conferência independente: outra leitura do código procura regra que
faltou ou foi descrita errado.

**1.3 Dar destino a cada regra.** Cada regra recebe um destino da
[tabela de destinos](#toda-regra-tem-um-lugar-mas-nem-toda-regra-vai-no-corpo-do-texto)
e os setores envolvidos (1.4). Item "fora do manual" leva o motivo.

**1.4 Quem faz o quê, tirado do código.** A divisão entre as equipes sai do
que o sistema implementa, não de uma tabela pedida ao dono:

- a matriz "O que cada setor pode" da tela Administração → Usuários
  (`/admin/usuarios`, catálogo `src/services/permissionMatrix.ts`, 39 linhas),
  revisada contra as guardas do banco que ela resume
  ([matriz de permissões](../operations/seguranca.md#modelo-de-permissões-por-perfil)),
  procurando também ação restrita por setor que o catálogo não lista;
- os setores avisados por tipo de alerta (hoje Documentação 38 tipos,
  Administrativo 16, Financeiro 4, Operações 3, Equipamentos 2, pelo
  `ALERT_TYPE_COUNTS` do mesmo catálogo);
- as seções do ADR de Saída assinadas por Operações, Documentação e
  Equipamentos;
- os cartões de pendências por setor do Painel e a regra que põe cada
  pendência num setor;
- como o sistema trata quem trabalha em mais de um setor;
- qualquer outra regra do código que ligue uma ação, aviso ou fila a um setor.

O produto é uma tabela por equipe: o que só ela (com o Administrativo) pode
fazer, os alertas que recebe, o que assina e o que todos os setores podem. Onde
o código não distingue setores, o manual diz "qualquer setor" e não inventa
divisão. Divergência entre a matriz da tela e o banco vai para a lista de
divergências.

**1.5 Cruzar com a documentação.** Toda divergência entre o código e os
documentos de módulo e as regras transversais vai para a lista de
divergências, classificada como em
[Princípios](#o-que-o-código-faz-é-o-que-o-manual-diz), com caso prático e
recomendação, para o dono responder de uma vez.

**1.6 Garantia automática de cobertura.** Um check, rodado junto do
`docs:check`, extrai de novo as listas enumeráveis do código (telas, funções
chamadas pelas telas, regras automáticas, rotinas agendadas, funções de
servidor, tipos de alerta, modelos de e-mail, mensagens) e falha se algum item
não tiver destino na matriz de cobertura. Daqui em diante, tela, regra ou
alerta novo no sistema quebra o check até ganhar lugar no manual.

Produtos:

- **Matriz de cobertura:** documento vivo, guardado junto do texto do manual,
  com cada item do código, a regra em linguagem de operação, o destino e a
  referência ao código. É a fonte do check 1.6 e o índice de trabalho da
  redação.
- **Tabela de quem faz o quê** (1.4), base do capítulo 2.
- **Lista de divergências**, num relatório datado em `docs/archive/reports/`, junto dos números do
  levantamento (quantos itens por fonte e por destino).
- **Sumário final** do Manual do Operador, ajustado ao que o mapeamento achou.

Os documentos de módulo com defasagem do tipo "documento defasado" são
corrigidos na mesma entrega.

**Pronto quando** cada item de cada lista tem destino, o check de cobertura
passa, e o dono aprovou:
a lista "fora do manual", a lista de divergências e o sumário final.
Os três primeiros critérios foram cumpridos em 2026-10-26; a lista de
divergências foi decidida em 2026-10-27; a lista "fora do manual" e o sumário
final foram aprovados em 2026-10-28, o que concluiu a etapa
([relatório](../archive/reports/2026-10-26-mapeamento-manual-do-operador.md)).

### Etapa 2 — Projeto gráfico, cenário, imagens e PDF; capítulo-piloto

1. **Projeto gráfico:** páginas-modelo que cumprem a
   [régua visual](#régua-visual): capa, abertura de parte, abertura de
   capítulo, página de procedimento com imagem marcada, página de desenho,
   cartão de mensagem, página de referência e guia de bolso. O dono aprova as
   páginas-modelo antes do piloto.
2. **Cenário de demonstração:** uma história fictícia e coerente que atravessa o
   manual inteiro: um navio, uma Viagem com Escalas, B/Ls de container, carga
   solta e veículo, um Cliente com Portal, um CE pendente, uma mudança de data
   de chegada, alertas abertos e uma fatura. Parte dos arquivos de importação
   de `test-fixtures/` já forma uma Viagem coerente.
3. **Imagens por script:** o ambiente local de auditoria (Postgres, emulador
   `scripts/design-audit/sb-shim.cjs` e o Vela em modo de desenvolvimento) e
   scripts do navegador que **executam o procedimento como o operador
   faria** e fotografam cada passo. Assim cada procedimento do caminho normal
   fica executado de verdade, não só descrito. Quando a tela mudar, o script
   quebra e avisa que o capítulo envelheceu. Limites conhecidos do ambiente
   local: as funções de servidor (e-mail, Portal, Itaú) e as rotinas agendadas
   não rodam ali. Os e-mails são mostrados a partir dos modelos, e o efeito de
   rotinas automáticas é provocado à mão no cenário, o que fica registrado no
   capítulo.
4. **Geração do PDF:** Markdown → HTML com a aparência do Vela → PDF pelo
   Chromium do Playwright, que o projeto já usa. Comandos novos no
   `package.json` (`manual:capture`, `manual:build`), o check de cobertura
   (1.6) e um check de linguagem que recusa os termos técnicos proibidos no
   texto impresso, marcas "[confirmar]" e lugares de imagem vazios. As
   marcações numeradas sobre as imagens são desenhadas pelo próprio script de
   captura, a partir da posição real dos botões na tela.
5. **Catálogo de situações** ([O manual parte do objetivo de quem usa](#o-manual-parte-do-objetivo-de-quem-usa)):
   por capítulo do sumário final, a lista dos objetivos de cada equipe
   ("Quero fazer…") e das situações comuns fora do caminho normal
   ("Aconteceu…"), começando pela importação de arquivos (B/L, carga solta,
   CE Mercante, Manifesto, Baplie, Veículos, planilha de datas). Fontes: as
   recusas, avisos de prévia, alertas e correções que a matriz já mapeou, e o
   conhecimento da operação. Cada situação aponta as regras da matriz que a
   respondem; situação sem regra é pergunta ao código antes de virar texto. O
   dono confere a lista do piloto e diz o que falta ou o que é raro.
6. **Capítulo-piloto:** "Criar uma Viagem e importar a documentação"
   (capítulos 4 a 6 do sumário final) escrito, ilustrado e gerado em PDF no
   formato final, respondendo todas as situações do catálogo desses
   capítulos.

**Pronto quando** o piloto cumpre as duas réguas e o dono o aprova: linguagem,
profundidade, imagens e aparência. Esse é o molde dos demais capítulos.

### Etapa 3 — Redação em lotes

| Lote | Capítulos | Por quê nesta ordem |
|---|---|---|
| 1 | Parte I (1 a 3) | Base para todo o resto; usa a tabela de quem faz o quê (1.4) |
| 2 | 6, 7 e 15 (gatilhos ligados ao B/L e ao CE) | Completa o fluxo do piloto |
| 3 | 11 a 14 (Cliente, Portal, e-mails, suporte) | Crítico para a abertura aos Clientes |
| 4 | 8 a 10 e 16 (Equipamentos, ADR de Saída, Desbloqueio de CE, alertas) | Rotina das equipes |
| 5 | 17 e apêndices | Fecham o manual |

Cada lote passa por:

1. catálogo de situações dos capítulos do lote, conferido pelo dono;
2. redação no modelo de procedimento, objetivo por objetivo e situação por
   situação do catálogo, conferindo que toda regra da matriz do lote ficou
   escrita;
3. **conferência independente contra o código**: outra leitura, sem o texto do
   autor como premissa, procura qualquer frase que o código contradiga e
   qualquer regra da matriz que o texto não cobriu;
4. check de cobertura, check de linguagem e geração do PDF;
5. revisão do dono.

Os e-mails e impressos ainda estão na migração visual (lote 6b do
[plano de identidade visual](2026-10-13-identidade-visual-tela-a-tela.md)).
As imagens de e-mail do capítulo 13 são feitas por último ou refeitas depois do
lote 6b.

**Pronto quando** o PDF completo do Manual do Operador, os três PDFs por
equipe e os guias de bolso são gerados sem erro, cumprem a
[régua visual](#régua-visual) e a [régua de conteúdo](#régua-de-conteúdo),
toda regra da matriz destinada ao volume do operador está escrita e o dono
aprovou o último lote. O manual sai como
**versão 1.0**.

### Etapa 4 — Manter o manual verdadeiro

Na mesma entrega da versão 1.0:

- linha nova na [tabela de responsabilidade de cada documento](../CONVENCOES.md#responsabilidade-de-cada-documento):
  o Manual do Operador é dono do **procedimento do usuário** de Documentação,
  Equipamentos e Operações; a regra continua no módulo, e o manual diz como
  agir;
- regra no [AGENTS.md](../../AGENTS.md) ("Documentation contract"): mudança
  visível ao operador (rótulo, passo, bloqueio, gatilho, alerta, e-mail,
  permissão) atualiza o manual e a matriz de cobertura na mesma alteração;
- o check de cobertura (1.6) e o de linguagem passam a rodar no CI;
- os scripts de imagem rodam de novo a cada versão do manual.

## Depois do Manual do Operador

Com o mesmo mapeamento, o mesmo cenário e o mesmo gerador de PDF, escrevendo as
regras que a matriz já destinou a cada volume:

1. **Manual do Financeiro:** baixa manual e automática do Pix Itaú,
   cancelamento de baixa e de fatura, restituição, Ajuste de COD, Conciliação,
   Demurrage, tabelas de Taxas Locais. Absorve o
   [manual financeiro](../operations/manual-financeiro.md) atual para não haver
   dois donos do mesmo procedimento.
2. **Manual do Administrativo:** usuários e setores, cancelamentos e
   exclusões com motivo, falhas de entrega, histórico de ações, Prazo do ADR.
3. **PDF completo do Vela:** as três partes num volume.
4. Opcional, a decidir: guia do Cliente para o Portal Fwlog.

**Pronto quando** nenhuma regra da matriz de cobertura está sem texto escrito,
salvo as aprovadas como "fora do manual".

## Riscos

| Risco | Mitigação |
|---|---|
| Uma regra do código fica de fora | Completude conferida contra listas extraídas do código (1.1), conferência independente por área (1.2) e check automático de cobertura (1.6) |
| O sistema muda enquanto o manual é escrito (entregas diárias) | Escrever sobre a `staging` de uma data; o check de cobertura acusa o que surgiu depois; conferir cada lote de novo antes da versão 1.0; data e versão na capa; scripts de imagem quebram quando a tela muda |
| Volume: muitos casos de borda e muita regra | Destinos diferentes para cada tipo de regra: o corpo traz o caminho normal; bloqueios vão para o quadro do passo e o apêndice de mensagens |
| O ambiente local não roda e-mail, Portal externo nem rotinas agendadas | Mostrar e-mails pelos modelos; provocar o efeito das rotinas à mão; o capítulo declara o que foi só lido no código e não executado |
| Divergências demoram a ser decididas | O capítulo afetado sai com o aviso "comportamento em revisão" e os demais seguem |

## Arquivos que o plano cria ou altera (execução)

- Texto do manual em Markdown, um arquivo por capítulo, e a matriz de
  cobertura, numa pasta própria de documentação viva (por exemplo
  `docs/manual/`), indexada em [docs/README.md](../README.md).
- Extração das listas do código e check de cobertura junto das ferramentas de
  `scripts/`.
- Cenário de demonstração (dados fictícios e arquivos de importação), scripts de
  imagem e gerador de PDF junto das ferramentas de `scripts/`
  (`scripts/manual/pdf/`; saída em `artifacts/manual/`, fora do Git).
- Catálogo de situações por capítulo em `docs/manual/situacoes/`.
- `package.json`: comandos do manual.
- Relatório datado do mapeamento em `docs/archive/reports/`.
- `docs/CONVENCOES.md`, `AGENTS.md` e CI na Etapa 4.

## Checks

- Mapeamento: check de cobertura sem item sem destino; números do
  levantamento por fonte registrados no relatório.
- A cada lote: `npm run docs:check`, `git diff --check`, checks de cobertura e
  de linguagem, geração do PDF e scripts de imagem passando.
- Ao mexer em scripts e `package.json`: `npm run typecheck` e `npm run lint`
  quando cobrirem os arquivos alterados.
- Evidência declarada por capítulo: o que foi **executado** no ambiente local,
  o que foi só **lido no código** e o que depende de serviço externo (e-mail,
  Itaú, rotinas agendadas) e não rodou no ambiente local.
