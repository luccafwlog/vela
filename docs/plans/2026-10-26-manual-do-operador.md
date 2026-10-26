# Manual do Operador do Vela (PDF)

Data: 2026-10-26. Origem: pedido do dono em 2026-10-26, antes de o Vela
começar a operar com Clientes reais nas próximas semanas. Este é o plano do
trabalho, não o manual.

## Estado

Nada executado. As decisões D1 a D3 (abaixo) estão pendentes e bloqueiam
partes do plano. O material antigo de operação das telas, feito semanas atrás
e ainda não revisado, deve ser enviado pelo dono como insumo (D1).

## Síntese do pedido

O Vela está maduro: identidade visual firmada, regras de negócio desenhadas e
muitos casos de borda tratados no sistema. Antes de abrir para Clientes reais,
a equipe interna precisa de um material de consulta e de aprendizado que
explique **o que fazer em cada momento, como fazer e por quê**.

- **Público da primeira entrega:** os operadores internos, divididos nas
  equipes de **Documentação**, **Equipamentos** e **Operações**. O Financeiro e
  o Administrativo vêm depois, no mesmo material.
- **Conteúdo:** as equipes e as responsabilidades de cada uma; o fluxo de
  trabalho do sistema; a criação da Viagem; a importação da documentação (B/L,
  Baplie EDI e CE Mercante); o provisionamento do Portal e a criação da conta do
  Cliente; os e-mails que o Cliente recebe; o suporte que a equipe presta ao
  Cliente; o que o sistema faz sozinho (gatilhos), por exemplo quando se vincula
  o CE Mercante ao B/L ou quando muda a data de chegada do navio; os alertas,
  quando abrem e quando fecham; o financeiro (alterar e adicionar taxa, cancelar
  fatura, dar baixa, restituir); o que cada perfil pode e não pode fazer.
- **Linguagem:** didática, com o vocabulário da navegação e das telas do Vela,
  sem termos de desenvolvimento.
- **Formato:** PDF com imagens das telas.
- **Fonte de verdade:** o **comportamento atual do sistema**, lido no código.
  Documento ou ADR que diga outra coisa não entra no manual como regra.
- **Uso:** o manual vira o roteiro para testar o Vela com a equipe e ensinar
  como agir. É ele que vai dizer se o sistema e a operação estão alinhados.

## Resultado pretendido

1. Um **Manual do Operador** em PDF que o operador consiga seguir sozinho,
   tarefa por tarefa, com a tela à frente, entendendo a lógica de cada passo.
2. Um **roteiro de sessões com a equipe** tirado do próprio manual: cada
   procedimento vira um teste com resultado registrado.
3. Uma **forma de manter o manual verdadeiro** enquanto o sistema muda: fontes
   no repositório, imagens refeitas por script e uma regra que obriga a
   atualizar o manual quando o comportamento visível mudar.

Fora de escopo nesta etapa: o manual do Financeiro e o do Administrativo (vêm
depois, na seção [Depois do Manual do Operador](#depois-do-manual-do-operador)),
um guia para o Cliente do Portal, vídeos e treinamento presencial. O manual não
corrige o sistema: defeito encontrado vira tarefa separada.

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

### Caso de borda entra pela mensagem que o operador vê

O sistema trata muitos casos de borda. Explicar cada um no corpo do texto
tornaria o manual ilegível. O corpo cobre o caminho normal e os desvios
frequentes. Os demais entram num apêndice organizado pela **mensagem que a
tela mostra**: "Apareceu esta mensagem → o que significa → o que fazer".

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
2. **Quem faz** — a equipe responsável e quem mais o sistema permite.
3. **Antes de começar** — o que precisa existir (Viagem criada, B/L importado,
   CE vinculado…).
4. **Passo a passo** — com imagens da tela e o rótulo exato de cada botão.
5. **O que o sistema faz sozinho depois** — gatilhos, alertas, e-mails,
   cálculos.
6. **Onde conferir o resultado** — tela, coluna, status ou ficha.
7. **Se algo der errado** — mensagens de bloqueio e o que fazer.
8. **Por que é assim** — a lógica do negócio, em poucas linhas.

## Decisões pendentes

### D1 — Material antigo

O dono tem um material de algumas semanas atrás que tenta cobrir a operação de
todas as telas. Não foi revisado, não tem imagens e tem informações que já
mudaram.

**Recomendação: usar o material, mas não como fonte.** Ele serve para três
coisas: (1) lista de cobertura, pois toda tela ou situação que ele trata entra
no manual ou fica fora com motivo declarado; (2) vocabulário da equipe, ou seja,
como a operação chama as coisas; (3) sinal de mudança, pois cada afirmação dele
que o código contradiz indica algo que mudou ou um defeito. Nenhuma frase dele
entra no manual sem ser conferida no código.

Envio: anexar na conversa (PDF, Word ou Markdown) ou subir na branch. Não entra
como documento vivo do repositório; se o dono quiser guardá-lo, vai para
`docs/archive/reports/` como registro histórico.

### D2 — Quem faz o quê em cada equipe

O sistema define o que cada perfil **pode** fazer, mas não o que cada equipe
**deve** fazer. Pela [matriz de permissões](../operations/seguranca.md#modelo-de-permissões-por-perfil),
quase toda a operação (criar e editar Viagem, importar arquivos, emitir avulsa…)
é permitida aos cinco perfis. O código só dá pistas da divisão:

- os setores que recebem cada tipo de alerta (`ALERT_TYPE_COUNTS` em
  `src/services/permissionMatrix.ts`): Documentação 38 tipos, Administrativo
  16, Financeiro 4, Operações 3, Equipamentos 2;
- as seções do ADR de Saída, assinadas pelo setor dono: Operações,
  Documentação e Equipamentos.

O capítulo "As equipes e suas responsabilidades" precisa de uma decisão do
dono: quem responde por cada etapa do fluxo (criar Viagem, atualizar datas do
navio, importar B/L, importar Baplie, vincular CE Mercante, vincular Cliente,
Revisão, datas de container, Vazios, provisionar o Portal, atender o Cliente…).

**Recomendação:** na Etapa 1, montar um rascunho dessa tabela a partir das
pistas do código e da operação descrita no material antigo, e o dono (ou os
líderes das equipes) corrige. A tabela separa sempre "a equipe responsável" de
"quem mais o sistema permite".

### D3 — Ambiente das sessões com a equipe

As imagens do manual saem de um ambiente local com dados fictícios (Etapa 2),
sem tocar em produção. As sessões com a equipe precisam de um Vela acessível
pelo navegador. Opções:

| Opção | A favor | Contra |
|---|---|---|
| **A. Produção, antes da abertura aos Clientes** | É o ambiente real, com e-mail, cobrança Itaú e rotinas automáticas funcionando; a sessão também testa a produção. Hoje a produção só tem dados de teste ([AGENTS.md](../../AGENTS.md#gotchas), "Data status") | Os e-mails saem de verdade: o cenário precisa usar só caixas da própria equipe. Pix de cobrança é dinheiro real. Os dados de treino precisam ser apagados pelo [procedimento oficial](../operations/reset-ambiente.md) antes da abertura |
| **B. Ambiente de Preview** | Isolado da produção | Precisa ser criado sob demanda e é temporário; e-mails, cobrança e rotinas automáticas podem não funcionar como em produção, e o treino deixa de testar o ambiente real |

**Recomendação:** A, com o cenário de treino usando só endereços de e-mail
internos, nenhum Pix real sem decisão explícita e limpeza dos dados antes da
abertura. O treino tem de terminar antes de o "Data status" do AGENTS.md mudar
para "dados reais".

### Escolhas já feitas (rotina, podem ser revistas)

- **Um conteúdo, vários PDFs:** um manual único, em partes, gera o PDF completo
  e um PDF por equipe com os capítulos dela e os comuns.
- **Fonte no repositório:** o texto fica em Markdown versionado junto do
  código, para que a mesma alteração que muda o sistema atualize o manual. O PDF
  é gerado por script e não é versionado.
- **Aparência:** o PDF segue a [identidade visual](../identidade-visual.md)
  (cores, letra e status do Vela), em A4, legível impresso.
- **Data e versão na capa:** cada PDF diz a data e a versão do Vela que
  descreve.

## Sumário proposto do Manual do Operador

O sumário é ponto de partida. O inventário da Etapa 1 pode acrescentar,
juntar ou cortar capítulos.

**Parte I — Entendendo o Vela**

1. O Vela e o Portal Fwlog: entrar, perfil, menu, Painel e como achar as coisas.
2. As equipes e suas responsabilidades (D2) e **o que cada perfil pode e não
   pode**: as 39 linhas da matriz "O que cada setor pode" (`/admin/usuarios`)
   em linguagem de operação.
3. O caminho de uma Viagem do começo ao fim: Viagem → B/L → CE Mercante →
   Revisão → Taxas Locais → fatura → Portal → pagamento, num desenho único.

**Parte II — Operação passo a passo**

4. Viagens: criar a Viagem, Escalas, Atracação, datas do navio (ETA, ETB, ETD,
   ATA, ATD), omissão de Escala, transbordo, Linha do Tempo, Line-Up e
   Chegadas e Saídas (a programação que o Cliente vê no Portal).
5. Importação da documentação: arquivo de B/L, CE Mercante, Baplie (EDI),
   veículos, Vazios de importação, Granito e datas de container; como ler a
   prévia, o que acontece quando o arquivo tem erro, onde ver o
   histórico.
6. A ficha do B/L: carga (containers, carga solta, veículos), vínculo do
   Cliente, vínculo do CE Mercante, correções e cancelamento.
7. Revisão: as pendências, o que cada uma bloqueia e como resolver.
8. Equipamentos: containers, datas de container, Demurrage do ponto de vista da
   operação (free time, devolução), Vazios de importação, Embarque de Vazios e
   Locais (depots).
9. ADR de Saída: seções por equipe, assinatura, fechar e reabrir.
10. Desbloqueio de CE: pedidos do Cliente, documentos, prazo, condição VIP e
    envio à ZPT.

**Parte III — O Cliente**

11. Cadastro do Cliente: ficha, contatos e caixas de comunicação, Base de
    Clientes.
12. Portal: provisionamento, convite, ativação e criação da conta, suspensão e
    o Modo Inspeção (ver o Portal como o Cliente vê).
13. Os e-mails que o Cliente recebe: convite, recuperação de senha, resumo
    diário, Comunicados (manuais e régua automática), Régua de Cobrança da
    Demurrage e avisos do Desbloqueio de CE; e-mail recusado ou suprimido, e o
    que fazer.
14. Suporte ao Cliente: roteiro de atendimento pelos pedidos mais prováveis
    ("não consigo entrar", "não recebi o e-mail", "a fatura não aparece", "o
    valor está errado", "quero contestar", "preciso do CE"), sempre conferindo
    pelo Modo Inspeção.

**Parte IV — O que o sistema faz sozinho**

15. Gatilhos, numa tabela "Você faz → o sistema faz → onde aparece": vincular o
    CE Mercante ao B/L, alterar a data de chegada do navio, vincular ou trocar
    o Cliente do B/L, registrar o ATD, importar ou cancelar um B/L, mudar datas
    de container, entre outros que o inventário encontrar.
16. Alertas: diferença entre Alerta e Notificação Interna; telas Alertas e
    Regras dos alertas; para cada tipo que chega a Documentação, Equipamentos
    ou Operações: quando abre, quem recebe, quando fecha sozinho e o que fazer.

**Parte V — O financeiro visto pela operação**

17. Taxas Locais e faturamento no que toca o operador: por que uma fatura não
    sai (o que segura a emissão), alterar ou adicionar taxa, fatura avulsa,
    desconto de Demurrage e as ações financeiras que o sistema permite a
    qualquer equipe. Baixa, cancelamento de fatura e restituição aparecem como
    visão geral ("quem faz e como pedir"); o passo a passo completo fica no
    manual do Financeiro.

**Apêndices**

- A. Glossário em linguagem de navegação.
- B. Mensagens do sistema: o que significa e o que fazer.
- C. Status e cores: Viagem, B/L, CE, fatura, pedido de desbloqueio, alerta.
- D. "Quero fazer… → onde fica": índice por tarefa.

## Etapas

### Etapa 0 — Decisões (este plano)

Respostas do dono para D1 a D3 e envio do material antigo.

### Etapa 1 — Inventário a partir do código

Levantar, no código e no banco local com todas as migrations aplicadas:

- todas as telas internas e as ações de cada uma (rótulos exatos), cruzadas
  com o [mapa de rotas](../ARCHITECTURE.md#mapa-de-rotas);
- a matriz de permissões (`src/services/permissionMatrix.ts` e as guardas do
  banco);
- o catálogo de alertas (tipos ativos, setores avisados, quando abre e quando
  fecha), conferido também na tela `/alertas/regras`;
- o que roda sozinho: regras automáticas do banco, rotinas agendadas e as
  funções de servidor de e-mail, Portal, cobrança, Demurrage e Desbloqueio de
  CE;
- os e-mails que o Cliente pode receber e o que dispara cada um;
- os status de cada entidade e as mensagens de bloqueio que a tela mostra.

Produtos:

- **Matriz de cobertura:** cada item acima ligado a um capítulo ou marcado
  "fora do manual do operador" com motivo.
- **Lista de divergências:** código × documentação × material antigo,
  classificada como em [Princípios](#o-que-o-código-faz-é-o-que-o-manual-diz),
  cada uma com caso prático e recomendação, para o dono responder de uma vez.
- **Rascunho da tabela de responsabilidades** (D2).

Os três ficam num relatório datado em `docs/archive/reports/`.
Os documentos de módulo com defasagem do tipo "documento defasado" são
corrigidos na mesma entrega.

**Pronto quando** o dono recebe a matriz de cobertura, a lista de divergências
e o rascunho de responsabilidades.

### Etapa 2 — Cenário de treino, imagens e PDF; capítulo-piloto

1. **Cenário de treino:** uma história fictícia e coerente que atravessa o
   manual inteiro: um navio, uma Viagem com Escalas, B/Ls de container, carga
   solta e veículo, um Cliente com Portal, um CE pendente, uma mudança de data
   de chegada, alertas abertos e uma fatura. Parte dos arquivos de importação
   de `test-fixtures/` já forma uma Viagem coerente. O mesmo cenário serve às
   imagens e às sessões com a equipe.
2. **Imagens por script:** o ambiente local de auditoria (Postgres, emulador
   `scripts/design-audit/sb-shim.cjs` e o Vela em modo de desenvolvimento) e
   scripts do navegador que **executam o procedimento como o operador
   faria** e fotografam cada passo. Assim cada procedimento do caminho normal
   fica executado de verdade, não só descrito. Quando a tela mudar, o script
   quebra e avisa que o capítulo envelheceu. Limites conhecidos do ambiente
   local: as funções de servidor (e-mail, Portal, Itaú) e as rotinas agendadas
   não rodam ali. Os e-mails são mostrados a partir dos modelos, e o efeito de
   rotinas automáticas é provocado à mão no cenário, o que fica registrado no
   capítulo.
3. **Geração do PDF:** Markdown → HTML com a aparência do Vela → PDF pelo
   Chromium do Playwright, que o projeto já usa. Comandos novos no `package.json`
   (`manual:capture`, `manual:build`) e um check de linguagem que recusa os
   termos técnicos proibidos no texto impresso.
4. **Capítulo-piloto:** "Criar uma Viagem e importar a documentação"
   (capítulos 4 e 5) escrito, ilustrado e gerado em PDF no formato final.

**Pronto quando** o dono aprova o piloto: linguagem, profundidade, imagens e
aparência. Esse é o molde dos demais capítulos.

### Etapa 3 — Redação em lotes

| Lote | Capítulos | Por quê nesta ordem |
|---|---|---|
| 1 | Parte I (1 a 3) | Base para todo o resto; depende de D2 |
| 2 | 6, 7 e 15 (gatilhos ligados ao B/L e ao CE) | Completa o fluxo do piloto |
| 3 | 11 a 14 (Cliente, Portal, e-mails, suporte) | Crítico para a abertura aos Clientes |
| 4 | 8 a 10 e 16 (Equipamentos, ADR de Saída, Desbloqueio de CE, alertas) | Rotina das equipes |
| 5 | 17 e apêndices | Fecham o manual |

Cada lote passa por:

1. redação no modelo de procedimento;
2. **conferência independente contra o código**: outra leitura, sem o texto do
   autor como premissa, procura qualquer frase que o código contradiga;
3. check de linguagem e geração do PDF;
4. revisão do dono.

Os e-mails e impressos ainda estão na migração visual (lote 6b do
[plano de identidade visual](2026-10-13-identidade-visual-tela-a-tela.md)).
As imagens de e-mail do capítulo 13 são feitas por último ou refeitas depois do
lote 6b.

**Pronto quando** o PDF completo do Manual do Operador e os três PDFs por
equipe são gerados sem erro, com todos os itens da matriz de cobertura
cobertos ou justificados.

### Etapa 4 — Sessões com a equipe (o manual como balizador)

1. Roteiro por equipe tirado do manual: cada procedimento vira um caso de
   teste executado pelo operador no ambiente escolhido em D3, seguindo só o
   manual.
2. Cada passo recebe um resultado: **ok**, **manual errado ou confuso**,
   **sistema errado**, **regra a decidir** ou **difícil de usar**.
3. Correções: o manual é corrigido; defeito do sistema e regra a decidir viram
   tarefas próprias. Nenhuma correção do sistema entra escondida no trabalho do
   manual.
4. Resultado das sessões registrado num relatório datado em
   `docs/archive/reports/`.

**Pronto quando** todos os procedimentos foram executados pela equipe, os
itens "manual errado" estão corrigidos e os demais estão com tarefa aberta ou
decisão do dono. O manual sai como **versão 1.0**.

### Etapa 5 — Manter o manual verdadeiro

Na mesma entrega da versão 1.0:

- linha nova na [tabela de responsabilidade de cada documento](../CONVENCOES.md#responsabilidade-de-cada-documento):
  o Manual do Operador é dono do **procedimento do usuário** de Documentação,
  Equipamentos e Operações; a regra continua no módulo, e o manual diz como
  agir;
- regra no [AGENTS.md](../../AGENTS.md) ("Documentation contract"): mudança
  visível ao operador (rótulo, passo, bloqueio, gatilho, alerta, e-mail,
  permissão) atualiza o manual na mesma alteração;
- cada seção guarda, fora do texto impresso, a referência ao caminho no código
  que a sustenta; o `docs:check` confere que essas referências existem;
- os scripts de imagem rodam de novo a cada versão do manual.

## Depois do Manual do Operador

Com o mesmo método, o mesmo cenário e o mesmo gerador de PDF:

1. **Manual do Financeiro:** baixa manual e automática do Pix Itaú,
   cancelamento de baixa e de fatura, restituição, Ajuste de COD, Conciliação,
   Demurrage. Absorve o [manual financeiro](../operations/manual-financeiro.md)
   atual para não haver dois donos do mesmo procedimento.
2. **Manual do Administrativo:** usuários e setores, cancelamentos e
   exclusões com motivo, falhas de entrega, histórico de ações, Prazo do ADR.
3. **PDF completo do Vela:** as três partes num volume.
4. Opcional, a decidir: guia do Cliente para o Portal Fwlog.

## Riscos

| Risco | Mitigação |
|---|---|
| O sistema muda enquanto o manual é escrito (entregas diárias) | Escrever sobre a `staging` de uma data; conferir cada lote de novo antes da versão 1.0; data e versão na capa; scripts de imagem quebram quando a tela muda |
| Volume: muitos casos de borda e muita regra | Caminho normal no corpo; casos de borda pelo apêndice de mensagens; a matriz de cobertura mostra o que ficou fora e por quê |
| Responsabilidades sem dono (D2) | O capítulo 2 só fecha com a tabela aprovada; os demais capítulos dizem "equipe responsável" a partir dela |
| O ambiente local não roda e-mail, Portal externo nem rotinas agendadas | Mostrar e-mails pelos modelos; provocar o efeito das rotinas à mão; validar esses pontos nas sessões com a equipe (D3) |
| Treino em produção envia e-mails reais e cria cobranças | Cenário só com caixas internas; nenhum Pix real sem decisão; limpeza oficial antes da abertura |
| Divergências demoram a ser decididas | O capítulo afetado sai com o aviso "comportamento em revisão" e os demais seguem |

## Arquivos que o plano cria ou altera (execução)

- Texto do manual em Markdown, um arquivo por capítulo, numa pasta própria de
  documentação viva (por exemplo `docs/manual/`), indexada em
  [docs/README.md](../README.md).
- Cenário de treino (dados fictícios e arquivos de importação), scripts de
  imagem e gerador de PDF junto das ferramentas de `scripts/`.
- `package.json`: comandos do manual.
- Relatórios datados em `docs/archive/reports/` (inventário e sessões).
- `docs/CONVENCOES.md` e `AGENTS.md` na Etapa 5.

## Checks

- A cada lote: `npm run docs:check`, `git diff --check`, check de linguagem do
  manual, geração do PDF e scripts de imagem passando.
- Ao mexer em scripts e `package.json`: `npm run typecheck` e `npm run lint`
  quando cobrirem os arquivos alterados.
- Evidência declarada por capítulo: o que foi **executado** no ambiente local,
  o que foi só **lido no código** e o que só a sessão com a equipe pode
  confirmar.
