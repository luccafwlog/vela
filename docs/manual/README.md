# Manual do Operador

Fonte do Manual do Operador do Vela, escrito a partir do comportamento atual do
sistema ([plano](../archive/plans/2026-10-26-manual-do-operador.md)). O manual diz como
agir; a regra continua no documento de módulo.

O mapeamento que deu origem à matriz (números, quem faz o quê pelo código,
sumário final proposto e divergências) está no
[relatório de 2026-10-26](../archive/reports/2026-10-26-mapeamento-manual-do-operador.md).

## Texto e PDF

[`texto/`](texto/README.md) é o texto do manual: um Markdown por capítulo e o
`manual.json`, com o formato e as regras de redação. O PDF sai de
`npm run manual:build` e as telas de `npm run manual:capture`, com o cenário de
demonstração ([gerador](../../scripts/manual/pdf/README.md));
`npm run manual:check` confere o texto.

## Guias rápidos

[`guias/`](guias/viagem/guia.json) guarda os guias rápidos: o método de
trabalho em etapas, na ordem em que ele acontece, sem os casos de borda, que
ficam no manual. Cada guia tem um `guia.json` (as etapas, com a equipe que faz
cada uma, quando começam, onde se fazem e quando estão prontas) e um Markdown
por etapa, no mesmo formato do texto do manual, com as mesmas capturas. O
`fluxo` do `guia.json` desenha o mapa da segunda página: uma coluna por equipe,
o tempo em faixas de cima para baixo e as setas do que depende do passo
anterior. O primeiro é o **Guia rápido da Viagem** (`guias/viagem/`, 22
páginas e 19 etapas), das equipes de Documentação, Operações e Equipamentos:
da Viagem aberta e dos terminais das frentes de operação aos arquivos (Baplie,
vazios, B/Ls, carga solta, veículos), à conferência antes do CE (o ponto
crítico: com o CE, a fatura sai e o Cliente vê a carga no Portal), ao CE, à
chegada e à saída do navio, às datas dos containers, à exportação, ao ADR de
Saída e aos alertas de cada equipe. O PDF sai
de `npm run manual:guia -- viagem`, e o `manual:check` confere também o texto
dos guias.

## Pendências

O plano que produziu a versão 1.0 está no
[arquivo histórico](../archive/plans/2026-10-26-manual-do-operador.md). Na
revisão de 2026-11-03 (texto, apêndices e guia conferidos de novo contra o
código, capturas refeitas numa rodada só), o dono decidiu:

1. **Recusas sem acento:** corrigir só as que chegam à tela, isto é, as
   mensagens que a matriz não marca como `Fora`; as guardas internas e as
   funções antigas ficam como estão. Feito na migration `573`
   (PR luccafwlog/vela#1184).
2. **Capturas periódicas:** um workflow semanal refaz as capturas contra a
   `staging` e abre uma issue quando alguma falha, sem bloquear PR
   (`manual-capturas.yml`, PR luccafwlog/vela#1183). É o aviso de texto
   desatualizado que o `manual:check` e o `manual:coverage` não dão: a captura
   falha quando a tela muda o rótulo, o campo ou o botão que ela procura.
3. **Material do Cliente:** só reconferir e corrigir o material de boas-vindas
   que já existe em `artifacts/portal-onboarding-cliente/` (tutorial e guia
   rápido do Portal, HTML e PDF). Nenhum guia novo do Cliente.

O que continua em aberto:

1. **Textos do servidor sem acento que o próprio sistema compara:** ficaram
   como estão, porque outras funções e telas os reconhecem pelo texto:
   "Pendencias de importacao: …", "Acesso ao portal nao provisionado",
   "Cliente nao vinculado", "Aguardando reconciliacao de cliente…", "Cliente nao
   encontrado na base cadastral.", "Conciliacao automatica por TXID", "Nao
   informado", "Atualizacao manual de …", os motivos do Histórico gravados pela
   importação e os cabeçalhos das planilhas exportadas. Acentuá-los exige mudar
   também quem compara.

Os casos de código achados na revisão de 2026-11-03 foram decididos pelo dono
no mesmo dia e entraram na migration `574` (ver "Atualizações da matriz").

## Catálogo de situações

[`situacoes/`](situacoes/README.md) lista, por capítulo, os objetivos de quem
usa o Vela ("Quero fazer…") e as situações comuns fora do caminho normal
("Aconteceu…"), cada uma ligada às regras desta matriz. É a pauta da redação de
cada capítulo.

## Matriz de cobertura

[`cobertura/`](cobertura/) liga cada regra de negócio do código ao lugar do
manual que a explica. Há um arquivo por área do sistema. Cada linha traz a
regra como o operador a vê, o destino no manual, os setores envolvidos e os
itens do código que a implementam.

`npm run manual:coverage` (banco local preparado, ver
[WORKFLOW.md](../../WORKFLOW.md#testes-de-integração); roda também no job `db`
do CI) extrai o inventário do sistema e falha quando:

- um item do sistema não tem lugar na matriz;
- a matriz cita um item que deixou de existir;
- uma linha usa um destino fora da legenda abaixo.

Os itens são citados entre crases pelo identificador do inventário:

| Prefixo | Item |
|---|---|
| `rota:` | Tela com endereço próprio (Vela e Portal) |
| `funcao:` | Função do banco que a tela pode chamar |
| `gatilho:` | Regra que o banco executa sozinho ao gravar um registro |
| `restricao:` | O que o banco recusa gravar (valor, combinação de campos) |
| `unico:` | O que o banco não deixa repetir |
| `politica:` | Quem pode gravar diretamente numa tabela |
| `rotina:` | Rotina por horário |
| `servidor:` | Função de servidor (e-mail, Portal, Itaú, alertas…) |
| `alerta:` | Tipo de alerta do catálogo |
| `email:` | Modelo de e-mail |
| `permissao:` | Linha da matriz "O que cada setor pode" |
| `parametro:` | Parâmetro do sistema |
| `arquivo:` | Área de arquivos enviados |

Mensagens de erro do banco são citadas pelo texto exato, na seção Mensagens.

### Destinos

| Código | Onde |
|---|---|
| `Op 1` | O Vela e o Portal Fwlog: entrar, perfil, menu, como o Vela fala, rotina diária e Painel, relatórios, quando o sistema falha |
| `Op 2` | Equipes, o que cada perfil pode e não pode, cancelar e excluir, a quem passar |
| `Op 3` | O caminho de uma Viagem do começo ao fim |
| `Op 4` | Viagens, Escalas, datas do navio, Chegadas e Saídas, Line-Up, cadastros de apoio |
| `Op 5` | Importação: arquivo de B/L, CE Mercante, Baplie e demais importações |
| `Op 6` | A ficha do B/L |
| `Op 7` | Revisão |
| `Op 8` | Equipamentos: containers, veículos, Vazios, Granito, Demurrage operacional |
| `Op 9` | ADR de Saída |
| `Op 10` | Desbloqueio de CE |
| `Op 11` | Cadastro do Cliente e Central de Informações |
| `Op 12` | Portal: conta do Cliente e o que ele vê |
| `Op 13` | E-mails que o Cliente recebe |
| `Op 14` | Suporte ao Cliente |
| `Op 15` | Gatilhos e rotinas por horário |
| `Op 16` | Alertas |
| `Op 17` | Financeiro visto pela operação |
| `Ap. A` | Glossário |
| `Ap. B` | Mensagens do sistema |
| `Ap. C` | Status e cores |
| `Ap. D` | "Quero fazer… → onde fica" |
| `Fin` | Volume do Financeiro |
| `Adm` | Volume do Administrativo |
| `Fora` | Sem efeito na operação, com o motivo na seção "Itens sem efeito na operação" |

### Setores

`Todos`, `Adm` (Administrativo), `Fin` (Financeiro), `Ope` (Operações), `Doc`
(Documentação), `Equ` (Equipamentos), `Sistema` (o sistema faz sozinho) e
`Cliente` (pelo Portal). A coluna diz quem o sistema deixa fazer e quem ele
avisa, não uma divisão de trabalho que o código não aplica.

## Atualizações da matriz

A matriz foi lida na `staging` em `9839364` (2026-10-26) e é mantida em dia com
o sistema. Cada mudança cita a data e a migration na própria linha.

- **Correções decididas pelo dono** (lotes 1 a 11 do
  [plano](../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md)): a linha da
  divergência corrigida diz "Corrigida no sistema em 2026-10-27" e as regras
  descrevem o comportamento novo.
- **Staging até `c3be255` (2026-10-27)**, revisada contra as decisões do dono
  sem conflito:
  - Baplie: CNTCG e TCG lidos como Taicang e o fim de mensagem do Baplie 1.5
    da COSCO sem aviso (migration `465`; CEB-060, CEB-061).
  - Desbloqueio de CE: prazo da tarde às 12:00 do próximo dia útil, linha do
    prazo no Portal, "Consulte o SISCARGA" e resposta e rodapé dos avisos em
    importacao@fwlog.com.br (migration `466`; DCE-017, DCE-031, DCE-090 a
    DCE-092, POR-099).
  - Faturamento: individual coberta aparece no detalhe do Portal como "Paga ·
    coberta pela fatura X" (POR-073) e **Fatura desatualizada** passou a
    Crítico (migration `467`; catálogo de alertas).
  - Viagem › Rotas e Manifestos: rota com omissão com "(Omitida)",
    "(Transbordo)" e "(Destino Final)" (VIA-053, CEB-043).
  - Veículos: **Esta viagem não terá veículos** e o alerta crítico **Planilha
    de Veículos pendente** de Equipamentos (migration `468`; EQU-128, EQU-129,
    catálogo de alertas, contagens de ACE-119 e ALE-D13).
  - Telemetria: recusas do banco já explicadas na tela deixam de ir ao Sentry;
    sem efeito na operação.
- **Veículo LCL isento no Desbloqueio de CE e "Isentas" no Portal** (decisões
  do dono de 2026-11-03, [ADR 0118](../adr/0118-desbloqueio-do-veiculo-lcl-so-com-o-bl-original.md),
  migration `575`): o veículo LCL com Taxas Locais isentas é desbloqueado só com o
  B/L original, sem solicitação, termo nem procuração (DCE-011, DCE-110); a aba
  B/Ls do Portal mostra "Isentas" no B/L isento (POR-081).
- **VIP coberto no B/L sem solicitação** (pedido do dono de 2026-11-03,
  migration `576`): em Andamento dos B/Ls, termo e procuração do Cliente VIP
  aparecem "coberto pelo anual VIP" antes do pedido, sem deixar o B/L apto
  (DCE-111).
- **Andamento dos B/Ls: busca, filtros e histórico do B/L** (pedidos do dono de
  2026-11-03, migration `577`): a busca separa também por "&" (em todo o
  sistema) e acha o B/L colado com espaço; **Requisito atendido** e **VIP** em
  Mais filtros; **Histórico do B/L** com quando e quem cumpriu cada requisito,
  com ou sem solicitação (ACE-028, DCE-065, DCE-112).
- **Cliente VIP sem solicitação** (decisão do dono de 2026-11-03,
  [ADR 0119](../adr/0119-vip-desbloqueia-sem-solicitacao.md), migration `581`):
  o B/L coberto pelos dois anuais VIP fica apto com as Taxas Locais pagas e o
  B/L original entregue, sem solicitação; vale o anual vigente entre o pagamento
  e a entrega e a exportação (migration `582`); aviso "documentação validada" por B/L, no sino e por e-mail; o Portal
  explica a regra e mostra por B/L o que falta (DCE-091, DCE-111, DCE-113).
- **Pix do QR estático e Histórico de baixas** (achado do dono no staging em
  2026-10-30, [ADR 0115](../adr/0115-qr-estatico-do-vela-e-historico-por-baixa.md),
  migrations `552` e `553`): o Pix do QR estático deixa de aparecer como ZPT
  (origem **QR estático do Vela**) e dá baixa automática onde o QR estático está
  ligado; o Histórico de baixas passa a ter uma linha por baixa e B/L, com
  **Forma da baixa** (coluna e filtro) e o valor que a baixa pôs no B/L
  (REC-017, REC-065 a REC-068 e REC-103).
- **Alterar, excluir e isentar as Taxas Locais do B/L** (pedido do dono de
  2026-10-28, [ADR 0111](../adr/0111-alterar-excluir-e-isentar-taxas-locais-do-bl.md),
  [plano](../archive/plans/2026-10-28-alterar-taxa-calculada-do-bl.md)):
  - Lote 1 (migration `491`): alterar valor por unidade ou total, excluir e
    desfazer taxa, por qualquer setor com justificativa; marcas **Alterada** e
    **Excluída**; bloco **Histórico das taxas**; a alteração sobrevive aos
    recálculos e só se perde com a troca de tabela; excluir cobrança manual
    deixa de ser só do Administrativo (TAX-076, TAX-082, TAX-083, TAX-085,
    TAX-090, TAX-093 a TAX-100, ACE-098 e as mensagens novas).
  - Lote 2 (migration `492`): **Isentar Taxas Locais** e **Retirar
    isenção** na ficha, por qualquer setor com justificativa; o B/L isento à
    mão fica Isento em todo recálculo e sem ação nas taxas; o Desbloqueio de
    CE considera o Financeiro atendido (TAX-101 a TAX-104, DCE-011, ACE-128,
    `permissao:isentar-taxas-locais` e as mensagens novas).
  - Lote 3 (migration `493`): as ações valem no B/L faturado e passam pela
    correção da fatura (reemissão, abatimento e Restituição, Fatura
    desatualizada); a confirmação diz o efeito antes de gravar e o Histórico
    das taxas guarda o efeito; Origem **Alterado** no detalhe da fatura do
    Vela, sem a marca no Portal (FAT-173 a FAT-176, REC-102, POR-131, TAX-077,
    TAX-100 e as mensagens novas; saiu a mensagem provisória do B/L faturado).
  - Lote 4 (migration `494`): a alteração aparece fora da ficha do B/L:
    filtro, coluna do Exportar e avisos da Validação, aviso da consolidada e do
    Recalcular da Revisão, lista **B/Ls com taxa alterada** na ficha do
    Cliente, Histórico de ações legível e aviso de divergência pela parte do
    B/L (TAX-105, TAX-106, FAT-177, FAT-178, CLI-108 e a mensagem nova).
  - Lote 5 (migration `495`): o diálogo **Taxas alteradas à mão serão
    afetadas** (**Gravar mesmo assim**) na ficha, na correção de container, no
    COD e em Veículos; a seção **Taxas alteradas à mão** nas prévias de B/L e
    Manifesto BB e a pergunta no Baplie; o alerta **Taxa alterada à mão mudou**
    (BLR-150, CEB-099, EQU-130, VIA-145, ALE-086 e a marca interna da
    simulação).
  - Revisão da PR luccafwlog/vela#1080 (migration `497`): a confirmação do
    efeito na fatura segue a mesma ordem da correção (consolidada, saldo do
    B/L, Portal sem Liberação; FAT-175); **Revisar alteração** não repete e
    **Voltar** no meio não abre a confirmação (TAX-095); o **Gravar mesmo
    assim** passa a valer também para o peso de contêiner e o COC/SOC da
    correção de container (BLR-150), para o SOC/COC do arquivo de B/L, o B/L
    que passa a dividir o container e toda gravação do Baplie (CEB-099), para
    os veículos selecionados de outras páginas (EQU-130) e para **Reverter
    para transbordo** (VIA-145).
  - Decisão do dono de 2026-10-28 (migration `498`): taxa com total alterado
    cuja quantidade vai a zero sai da cobrança, com a alteração guardada; a
    prévia pede o **Gravar mesmo assim** e, sem ele, abre o alerta (BLR-150,
    ALE-086).
- **Disparo de Comunicados por Viagem escolhida** (revisão da comunicação
  manual de 2026-10-30; tela, sem migration): Navio / Viagem passa a ser a
  Viagem escolhida na lista e obrigatória, POL e POD viram listas com
  **Todos**, a conferência mostra o Porto, os B/Ls sem Cliente e o motivo da
  lista vazia, e o lote conta "Enviando N de M…" (CLI-059, CLI-066, CLI-068 e
  a mensagem da tela). Na **Cobertura de viagens**, a coluna **Sem Cliente**
  mostra os B/Ls sem Cliente como pendência (CLI-080), e o navio/viagem abre a
  página **Comunicados da viagem**, com os B/Ls sem Cliente por consignatário,
  cada porto com os Clientes e o histórico da viagem (CLI-081, CLI-107,
  CLI-109, captura C14).
- **Recusa da carga solta em outra Viagem** (decisão do dono de 2026-10-28,
  pergunta P1 da situação S6.03; migration `500`): a prévia e a gravação do
  Manifesto BB e do B/L avulso mandam excluir o B/L na outra Viagem e importar
  de novo, como o arquivo de B/L de container, em vez de corrigir a Viagem
  pela ficha (BLR-053 e a mensagem do banco).
- **Recusa do banco na omissão, no transbordo e no COD** (decisão do dono de
  2026-10-28, pergunta P4 da situação S4.21; tela, sem migration): **Omitir
  escala**, **Complementar**, **Reverter omissão**, **Marcar COD** e **Reverter
  para transbordo** recusados mostram o motivo do banco, pelo mesmo tradutor
  das outras telas; "Verifique se algum B/L está em COD." só complementa a
  recusa por B/L em COD (VIA-070, VIA-058, VIA-064 e as mensagens).
- **Conferência do capítulo-piloto contra o código** (2026-10-28, PR
  luccafwlog/vela#1093, sem mudança no sistema): linhas que descreviam outra coisa que o código faz. O Baplie
  nunca cria escala (VIA-052, desde a migration `418`); todos os setores mudam
  terminal, ATB, ATD, Restow e frentes da atracação (ACE-085, como a ACE-120);
  o botão que recusa o diálogo das taxas alteradas à mão é **Voltar** (VIA-145);
  sem carga solta e sem próxima escala a tela mostra "—" (VIA-008, VIA-009); a
  conferência do LOCODE e a criação do porto não valem na escala nova só de
  importação (VIA-033); o resultado do CE lista os Retidos e os Pulados por B/L
  (CEB-019); **Remover CE** com fatura emitida é recusado pela própria ação
  (BLR-107); a importação de B/L sem usuário ativo mostra "Usuario sem
  permissao ativa." (ALE-065).
- **Ficha do B/L e Revisão** (2026-10-29, PRs luccafwlog/vela#1088 e #1089;
  migrations `501` e `502`): a etapa **Cliente** do trilho e o **Pronto para
  faturar** do bloco Portal seguem a Liberação de faturamento sem Portal e o B/L
  já faturado (7.1; BLR-078, POR-041, POR-129); a justificativa da ficha e da
  Revisão vai ao Histórico de cada campo, **Trocar Cliente** e **Desvincular**
  pedem motivo (7.4), corrigir o POD para outro porto tira a exceção de
  terminal (7.7) e só a Documentação e o Administrativo veem o convite do Portal
  (8.2; BLR-083, BLR-085, BLR-120). Entrada acrescentada pela conferência de
  2026-10-31, que corrigiu também o quadro de atenção de 7.1.
- **Defeitos corrigidos depois da conferência do piloto** (decisão do dono de
  2026-10-29, PR luccafwlog/vela#1092; telas, e a migration `505` para o
  motivo da exclusão): escala nova só de importação com LOCODE brasileiro novo
  ou fora do formato (VIA-033); **Adicionar navio** não apaga datas da Viagem
  existente (VIA-106); mesmo dia não tira a hora e escala só de exportação não
  vira importação (VIA-107, VIA-113); confirmação de **Não escala** por equipe
  e recusa da trava sem gravação parcial (VIA-108); ETA com hora vencido e
  filtro **Período** pelo dia (VIA-009); motivo da recusa de navio na tela
  (VIA-011, VIA-106); mensagem dos vazios de exportação (EQU-077); datas da
  prévia do B/L em dd/mm/aaaa e motivo da exclusão em português
  (`delete_record_block_reason`).
- **Endereço pelo Portal e datas do B/L cancelado** (2026-10-29, PR
  luccafwlog/vela#1092, que reúne as #1090 e #1091; migrations `503` e `504`):
  o endereço gravado no Perfil do Portal aparece em **Alterações do cadastro**
  com "Cliente pelo Portal" (15.8; CLI-045, POR-088), e a ficha do B/L
  cancelado mostra as datas do container só para leitura, que o Vela também
  recusa gravar por ele (9.2; EQU-026).
- **Efeito de importação que espera tabela de cobrança** (2026-10-29, PR
  luccafwlog/vela#1093, sem mudança no sistema): o B/L sem tabela de cobrança já tem o cálculo em
  revisão, e a fatura dele não sai sozinha quando a tabela é cadastrada; sai ao
  importar de novo a planilha do CE ou ao recalcular o B/L (BLR-138, TAX-015;
  regra em
  [manifesto-edi.md](../modules/manifesto-edi.md), item 20 dos efeitos de
  importação).
- **Excluir Cliente** (2026-10-29, PR luccafwlog/vela#1095, sem mudança no
  sistema): a matriz e a
  [Segurança](../operations/seguranca.md#modelo-de-permissões-por-perfil) davam
  a exclusão de Cliente ao Administrativo sem dizer que a Trava de exclusão
  recusa todo Cliente com CNPJ, que é obrigatório; Cliente se desativa (ACE-088).
- **Correções de 2026-10-29 (PRs luccafwlog/vela#1096 a #1102):** troca do
  envio real que falha agora avisa (CLI-104); com Revisão pendente, a
  Validação oferece **Resolver na Revisão** e **Recalcular selecionados**
  deixa o B/L de fora; a Conciliação tem o mesmo nome e cor em todo lugar;
  **Definir/Trocar ROE manual** só no B/L que emite a Invoice; **Cancelar
  pedido** apagado depois de **Reconferir CE** em B/L já enviado à ZPT
  (migration `510`); recusas com acento (migration `509`).
- **Motivo do bloqueio legível** (2026-10-29, PR luccafwlog/vela#1103): o
  alerta **Efeito de importação bloqueado** mostra o motivo em linguagem de
  operação, com o texto do sistema em **Detalhe técnico** (capítulos 6 e 20).
- **Correções da revisão da release #1084** (2026-10-29, PRs
  luccafwlog/vela#1105 a #1108 e #1110; migrations `511` e `512`): o sinal
  **Verificando** da Conciliação na ficha da Viagem (4.5 e Ap. C, #1105), a
  recusa do **Adicionar navio** com Viagem cancelada (5.2) e o dia sem a hora na
  edição de Chegadas e Saídas (5.3), os dois da #1106, o B/L cancelado sem
  **Definir condição do B/L** (9.7) e o ROE manual "sem efeito" fora do B/L que
  emite a Invoice do grupo (23.4), os dois da #1107. **Conciliada** no glossário
  acompanha a #1098. A matriz já veio atualizada nas PRs; a #1108 (acento da
  recusa da carga solta em outra Viagem) e a #1110 (prévias com troca de POD)
  não mudam o texto do manual. Esta entrada citava antes "#1108 a #1112";
  a conferência de 2026-10-31 corrigiu a faixa.
- **Decisões D1 a D3 do dono na revisão da #1084** (2026-10-29, PRs
  luccafwlog/vela#1114 a #1116; migration `513`): o **Não escala** do
  Administrativo conta também o B/L que embarca no porto (5.3), a carga solta
  com B/L cancelado em outra Viagem manda excluir lá (6.4) e a etapa
  **Demurrage** do trilho avisa a Invoice retida pelo Portal (9.6). A matriz
  veio atualizada nas PRs.
- **Escala com LOCODE fora da lista** (2026-10-29, PR luccafwlog/vela#1118,
  sem migration): a escala de porto brasileiro que o Vela não conhece continua
  no **Planejamento por escala** depois de recarregar. O texto do manual já
  dizia isso (5.8) e não muda; a matriz (VIA-033) veio na PR.
- **Retorno do provedor de e-mail não aplicado** (decisão do dono de
  2026-10-30, migration `535`): a MillionSend avisa todo e-mail da conta,
  também os do site da Fwlog, e o aviso que o Vela não acha abria
  **Portal do Cliente — falha no reprocessamento** crítico para a
  Documentação, com o número do evento em Registro. O aviso de entrega que não
  é do Vela passa a fechar sem alerta; devolução, spam, aviso ambíguo ou que
  falha 6 vezes abrem o tipo novo **Retorno do provedor de e-mail não
  aplicado**, normal, do Administrativo, com o destinatário mascarado em
  Registro (POR-105, ALE-058, catálogo de alertas).
- **Sincronização de 2026-10-31** (PRs luccafwlog/vela#1113 e #1119 a #1130;
  migrations `514` a `553`). A matriz veio atualizada nas PRs; o texto do
  manual e do guia passou a descrever:
  - **Demurrage** (#1113, #1120 e a parte de Demurrage da #1129;
    [ADR 0112](../adr/0112-repaginacao-da-demurrage.md)): as divisões
    **Correndo**, **A emitir**, **Esperando** e **Travado** da aba Containers
    (9.5); a Invoice que sai sozinha em até 15 minutos sem data nova, a cancelada
    à mão que espera **Gerar Invoice** e o rateio da caixa entre Clientes, "1/2
    da caixa" (9.6); uma tarifa por grupo (9.7) e as seções novas **9.10
    Cadastrar um tipo de container** e **9.11 Dispensar a cobrança de um
    container**; Disputas com prazo de 1 dia útil, encerradas com a Invoice
    cancelada (9.8, 9.9); as abas Faturas, Pagas, Canceladas e Por Cliente, o
    Extrato de Demurrage do Cliente, **Exportar** e Relatórios (23.2, 1.5); SOC e
    divisão da caixa depois da Invoice (18.8, 23.6, 23.9); as rotinas de 15
    minutos (19.5); o anexo na abertura da Disputa e "Disputa encerrada" no
    Portal (15.6); a recusa de **Cancelar B/L** com Demurrage sem Invoice (7.8,
    6.9); os alertas **Demurrage travada** e **Disputa de Demurrage sem resposta
    no prazo** (20.9), e os verbetes e status novos (Ap. A, B e C).
  - **Viagens, ADR e vazios** (#1121, #1122, #1128 e as correções da #1129):
    veículo sem frente própria e frente nova em TBC, que deixa a carga fora do
    ADR e trava o fechamento (4.3, 11.2, 11.5); o transbordo no ADR do porto de
    transbordo (4.7); o Embarque de vazios com **Terminal**, **Definir
    terminal** e **Excluir embarque** (10.5); a escala com Embarque de vazios que
    não se exclui (4.8, 5.3); a recusa do B/L em outra Viagem com o caminho do CE
    Mercante (6.4, 6.9); Suape e a coluna **SUAPE ETA** (5.1, 5.5).
  - **Portal, Comunicados, alertas e Pix** (#1119, #1124, #1125, #1126 e
    #1130): as páginas públicas do site fwlog.com.br (17.11 nova; menções em 1,
    3, 4, 5, 15.3 e 18); a coluna **Sem Cliente** da Cobertura de viagens, a
    página **Comunicados da viagem** e o Disparo pela Viagem escolhida (16.3,
    16.5, 16.8, 20.7); o alerta **Retorno do provedor de e-mail não aplicado** e
    a rotina que abre só com duas ou mais falhas ou com 401/403 (20.6, 20.13);
    o **QR estático do Vela** e o **Histórico de baixas** com uma linha por
    baixa e a **Forma da baixa** (24.1, 24.3 a 24.5, 19.6, 20.10, 23.7).
  - **Guia rápido da Viagem**: etapas 2, 4, 6, 7, 12, 13, 15, 16, 17, 18 e 19
    e o `guia.json`, inclusive a volta à etapa 2 quando a carga solta, os vazios
    ou o Granito criam frente nova.
  - **Conferência independente das PRs de 29/10**: o quadro de atenção de 7.1
    (#1088), **Verificando** e a etapa **Demurrage** no Ap. C (#1105, #1115), o
    dia sem a hora na edição de Chegadas e Saídas (5.3, #1106) e as correções
    das entradas desta lista.
  - **Matriz corrigida na conferência desta sincronização**: POR-105 cita as
    mensagens da migration `536`, que trocaram as da `535`; POR-134 diz que o
    endereço público errado fica em branco no site (404 que nega iframe), e não
    **Página não encontrada**; VIA-088 diz que "Frente sem terminal impede o
    fechamento" só aparece com as três assinaturas.
  - A #1123 e a #1127 só mexem em testes; a #1117 é a release.
- **CE e Taxas no Disparo, logo na prévia e contato do manifesto sem nome**
  (pedidos do dono de 2026-10-31, migration `557`): o modo Carga do Disparo
  oferece o CE Mercante · Taxas Locais ao lado de NOA, NOR e NOB, um por
  Cliente e Viagem, bloqueado com o motivo quando falta prontidão (CLI-058,
  CLI-060, CLI-066, CLI-067); a prévia do e-mail mostra a logo da Fwlog, que a
  política de segurança do Vela bloqueava só na prévia (CLI-066); o contato
  capturado do B/L fica sem nome em vez de "Contato manifesto", no Vela e no
  Portal (CLI-032, POR-089).
- **Gerar EDI Mercante** (pedido do dono na issue #560, 2026-11-02, ADR 0116):
  a linha de contêiner e a linha VAZIOS de Rotas e Manifestos geram o arquivo
  do Mercante da rota, com impedimentos e avisos, no lugar do sistema externo
  (VIA-053, VIA-146). As linhas BB e CNTR/BB geram o arquivo parcial de carga
  solta, com o que falta em **A completar** (decisão do dono de 2026-11-03;
  VIA-147).
- **EDI Mercante e Canal de envio só para a conta Dev** (decisão do dono de
  2026-11-03): os botões Gerar EDI Mercante e o bloco Canal de envio de
  Comunicação com Clientes deixam de aparecer para os demais usuários (VIA-146,
  VIA-147, CLI-052).
- **Sincronização de 2026-11-02** (PRs luccafwlog/vela#1132, #1133, #1135,
  #1141, #1143 a #1160 e #1163 a #1172; migrations `554` a `566`). A matriz veio
  atualizada nas PRs; o texto do manual e do guia passou a descrever:
  - **Menu e nomes** (#1151 e #1166): o menu em grupos, com Chegadas e Saídas e
    Line Up TV em Viagens, Locais (depots e terminais) em Exportação, as telas
    do Portal em Clientes e Regras de alertas em Alertas, e o número somado no
    grupo (1.2, 5.1, 5.7, 5.8, 10.7, 13.1, 13.9, 20.1); os cartões **Filtrar**
    e **Filtrando** (1.5); "B/Ls" e "Containers" nas telas (capítulos 4, 6, 7,
    13, 15 e 18, Ap. A e C); a página **Informações** do Portal, antes Central
    de Informações (13.9, 15.3, 17.10); o cartão e o filtro **Taxas a revisar**
    dos Clientes (13.1); a coluna **Pagar** com **Pagar com Pix** nas Faturas
    do Portal (15.5, 15.6).
  - **Alertas** (#1144, #1146 e #1156): os cartões por setor no lugar do
    seletor **Setor** (20.1; guia, etapa 18).
  - **Demurrage só na Demurrage** (#1165): a faixa do alto de todas as telas
    saiu; o câmbio fica na linha abaixo do título da **Demurrage** (1.2, 9.4,
    23.1; guia, etapa 15); **Correndo** diz quantos containers estão pendentes
    de devolução (9.5); "container" no lugar de "caixa" (9.6, 15.6, 23.2, 23.6,
    23.9, Ap. A); a coluna **Demurrage** de B/Ls no Portal (15.4).
  - **Recibo** (#1163): só o **Valor recebido**, e "Recebido pela consolidada"
    na fatura coberta (24.8, 24.9).
  - **Nova Viagem** (#1145, #1155 e #1135): **Portos e datas** com Origem e
    Destino, **Alterar armador**, a chave **Chegadas e Saídas** e a recusa do
    porto digitado sem **Adicionar** (4.1, 4.2, 4.4, 5.1, 5.6, 15, 17; guia,
    etapa 1); **Exportar programação** (5.5).
  - **CE e Taxas** (#1143 e #1159): o envio à mão pelo **Disparo**, que conta
    para a régua e fecha o alerta (16.1, 16.7, 19.4); o contato **Capturado do
    B/L** sem nome (13.6).
  - **Histórico de ações** (#1147 a #1150, #1152, #1153 e a correção da #1132):
    filtro **Ação**, **Por** com **Sistema** e **Cliente pelo Portal**, o
    registro pelo nome, a coluna **Motivo**, as linhas **B/L criado** e as
    trilhas próprias do Desbloqueio de CE, da conta do Portal, dos Comunicados
    e das disputas (25.7, 14.2); a recusa "já foi faturado …; recálculo
    bloqueado." com acento (Ap. B).
  - **Portal** (#1164, #1167 e #1172): a coluna **Tracking** de B/Ls e
    containers (13.9, 15.4); os filtros recolhidos em **Filtros** e os atalhos
    que chegam já filtrados (15.4, 15.7, 17.7); o bloco **Prazo para
    desbloqueio** (15.7); a razão social no **Perfil** (15.8).
  - **Matriz corrigida nesta sincronização**: VIA-114 e POR-132 (o nome da
    chave **Chegadas e Saídas**) e as linhas com "BLs", "Contêineres" e
    "contêiner" que a #1151 renomeou (BLR-001 a BLR-003, BLR-009, BLR-010,
    BLR-012, BLR-D02, BLR-C02 a BLR-C07, BLR-C39, VIA-008, CLI-047, CLI-048,
    POR-081 e as linhas de `04-ce-baplie.md`, `05-equipamentos.md`,
    `08-desbloqueio-ce.md` e `11-demurrage.md`).
  - Sem efeito no texto: a #1133 (permissão interna do envio de Comunicados),
    a #1141 (nova tentativa do token do Itaú), a #1154 e a #1158 (recusas raras),
    a #1157 e a #1160 (ajustes do Histórico de ações) e as PRs do Dependabot
    (#1168 a #1171).
  - O cenário das capturas voltou a rodar sem ajuste à mão: a #1132 corrigiu o
    seed da auditoria visual.
- **Pix na individual e na consolidada aberta** (decisão do dono de 2026-11-03):
  fica como a #1151 deixou, com Pix nas duas; o texto passou a explicar que pagar
  as duas não perde dinheiro, porque o segundo Pix quita a consolidada que
  substituiu a antiga e o excedente vira restituição (15.5, 24.6).
- **Sincronização de 2026-11-03** (PRs luccafwlog/vela#1174 a #1178; migrations
  `567` a `569`). A matriz veio atualizada nas PRs; o texto passou a descrever:
  - **Tela TV** no menu **Viagens**, antes **Line Up TV** (1.2, 5.7), e
    **Line-Up** com hífen no texto e no guia (#1178);
  - "correndo" e "a emitir" por container nas fichas do B/L e do Cliente
    (9.4, 13.2) e o motivo "Demurrage correndo ou a emitir" ao cancelar o B/L
    (7.8, Ap. B) (#1177);
  - o verbete **Rateio da Demurrage entre Clientes**, antes "Rateio da caixa"
    (Ap. A) (#1176).
  - Sem efeito no texto: #1174 (recusas do banco com acento, já citadas com
    acento no Ap. B) e #1175 (IMO na planilha de programação, que o texto não
    detalha).
  - Matriz: a linha da recusa "… alterar BLs e CEs." do banco saiu (a `567`
    trocou o texto); a captura do Line-Up do Painel procura o título novo.
- **2026-11-03, depois das PRs luccafwlog/vela#1179 e #1180** (migrations
  `570` e `571`): o Ap. B cita "(situação financeira: …)" no lugar de
  "(status financeiro=…)". O manual financeiro (`docs/operations/`) foi
  absorvido pelos capítulos 21 a 24 (decisão do dono de 2026-11-03) e está em
  `docs/archive/reports/2026-11-03-manual-financeiro.md`; o que só ele tinha
  entrou em 24.1 (cobranças aguardando o Itaú), 24.4 (tentar de novo ou encerrar
  a tentativa) e 24.6 (tentar emitir para o novo Cliente).
- **Decisões do dono de 2026-11-03, depois dos rascunhos:** os guias do
  Financeiro e do Administrativo não foram adotados (fica só o guia da Viagem),
  e o cancelamento do B/L pago fica como o código faz: a fatura paga por
  inteiro não segura o cancelamento, e o valor recebido só vira Restituição
  pelo **Preparar cancelamento financeiro** feito antes (7.8, 22.9).
- **Quem cancela fatura e exclui Cliente** (decisão do dono de 2026-11-03,
  igual ao código): só o Administrativo. O 4.8, o 13.10 e o Ap. B deixam de
  dizer que o Financeiro cancela; o 13.10 diz quem exclui Cliente.
- **Depois da PR luccafwlog/vela#1173** (EDI Mercante e Canal de envio só para
  a conta Dev): o 16.2 diz que só a conta Dev vê o bloco **Canal de envio** e
  que as outras equipes leem o desvio ao suporte na Cobertura e no Histórico;
  o 16.8 fala do envio real desligado, e não do bloco; a captura da Cobertura
  sai sem o bloco. O EDI Mercante não entra no manual, porque só a conta Dev o
  vê.
- **Depois da PR luccafwlog/vela#1181** (migration `572`): o Ap. B cita o aviso
  novo ao desativar Cliente, "Receba ou cancele antes o que está em aberto.", e
  o 13.10 deixa de avisar que a mensagem citava o Financeiro. As recusas que
  ganharam acento não aparecem no texto do manual.
- **Revisão de 2026-11-03** (capítulos 1 a 25, apêndices e guia conferidos de
  novo contra o código da `staging` em `ecd5ee1`, por lotes, com leitura do
  código antes do texto; sem mudança no sistema). Linhas que descreviam outra
  coisa que o código faz:
  - Viagens e escalas: Suape na **Chegada no Brasil (ETA)** (VIA-103); "X" na
    escala omitida e vazio no porto sem data na **Exportar programação**
    (VIA-111); Locais pelo menu **Exportação** (VIA-137); tirar uma atracação,
    inclusive na troca de terminal da única frente, só por Operações e o
    Administrativo, e travado por B/L com CE ou fatura e por ADR fechado
    (ACE-120).
  - Acesso: **Todas as ações** mostra 44 linhas (ACE-080); a seleção do
    Desbloqueio de CE só liga para a Documentação e o Administrativo (ACE-027).
  - B/L: a Demurrage sem Invoice também segura o **Cancelar B/L**, com
    **Abrir em Demurrage** (BLR-103); mudar POL ou POD de B/L com CE abre **CE
    fora do Manifesto da rota** (BLR-097).
  - Demurrage: o cartão **Correndo (US$)** soma os grupos da divisão, e o grupo
    que não se cobra fica em **Travado** (DEM-005); a janela **Corrigir** da aba
    Carga também muda as datas (DEM-010).
  - Comunicados: a linha que não pode ser marcada mostra o motivo em **Situação**,
    e não "Bloqueado" (CLI-066, CLI-061).
  - Taxas Locais: a falha do **Calcular taxas** diz o motivo (TAX-073).
  - Pix: o QR estático dá baixa sozinho pela consulta, e o extrato fica para o
    que não baixou (REC-005, REC-037); a frase "Desligada: … a baixa vem do
    extrato" do bloco **Cobrança Pix Itaú** é de antes da migration `552`
    (REC-025, caso do dono); cancelar a baixa automática do QR estático também
    volta o Pix a **Em análise** (REC-033, REC-074).
  - Portal: o ícone **Ver meus B/Ls nesta viagem** (no celular, **Meus B/Ls**)
    (POR-069).
  - Alertas: a Viagem cancelada não se exclui, e os alertas do ADR dela só saem
    reativando a Viagem (ALE-085, caso do dono); o botão ao lado de **Resolver**
    leva à tela do registro (ALE-020); o Financeiro recebe **Taxa alterada à mão
    mudou** (ALE-005); os quatro alertas críticos da Documentação avisam também
    o Administrativo desde a migration `485` (catálogo).
  - O módulo [Reconciliação Pix](../modules/reconciliacao-pix.md) deixou de se
    contradizer sobre o QR estático; o tutorial e o guia rápido do Portal em
    `artifacts/portal-onboarding-cliente/` foram corrigidos e os PDFs, gerados
    de novo.
  - Capturas novas: `admin-usuarios` e `editar-acesso` (25.1 e 25.3; a lista de
    usuários passou a sair no ambiente local com a coluna `last_sign_in_at` no
    cenário), `precos-do-porto` (21.7), `demurrage-containers` (9.5),
    `pix-recebidos` (24.4, com dois Pix fictícios no cenário), `restituicao`
    (24.6) e a `tela-tv` já existente em 5.7.
- **Tutorial em PDF no convite do Portal** (pedido de 2026-11-03; Edge, sem
  migration): o e-mail de convite e o de reenvio levam em anexo o tutorial
  completo do Portal (Tutorial_Portal_Fwlog.pdf) e a linha "Em anexo está o
  tutorial completo do Portal." (POR-039, POR-040; 14.3).
- **Portal, pedido do dono de 2026-11-03** (tela, sem migration): container
  ainda não descarregado não conta como sem devolução no Painel nem em B/Ls e
  containers, e a coluna **Devolução** mostra "N sem descarga" à parte (15.4;
  POR-068, POR-081); **Informações** ganha a seção **Tutorial**, com o mesmo
  PDF do convite (15.3; POR-084).
- **Decisões do dono de 2026-11-03, depois da revisão** (migration `574` e telas):
  - Revisão: salvar sem mudar dado o B/L faturado com a carga alterada é
    recusado; com mudança, grava e o B/L segue Pendente até a fatura ser
    corrigida; **Resolver com justificativa** na **Fatura desatualizada** tira o
    B/L da Revisão (8.5, 8.6, 22.8; BLR-102, BLR-129, BLR-133, BLR-149,
    FAT-057, FAT-121).
  - Cancelar B/L sem CE Mercante é recusado no servidor, salvo o B/L que também
    não pode ser excluído (7.8, Ap. B; BLR-10x).
  - Consulta de Pix: com o QR estático, o bloco **Cobrança Pix Itaú** mostra a
    idade da consulta e o alerta **Consulta de Pix do Itaú parada** abre e fecha
    como com o Itaú; a frase "Desligada: … a baixa vem do extrato" saiu (24.1,
    24.3, 20.10; REC-005, REC-023, REC-025, REC-037, ALE-071, catálogo).
  - Cancelar a Viagem fecha os alertas do ADR dela, e a rodada não os reabre
    enquanto ela estiver cancelada (4.8, 20.12; ALE-085, VIA-095, VIA-096).
  - Navio já cadastrado mantém o armador em **Adicionar navio** (Chegadas e
    Saídas) e na **Nova Viagem**, salvo com **Alterar armador** (4.1, 5.2, 5.8;
    VIA-014, VIA-106).
  - **Busca**, **Escalas** e **Período** do Line-Up valem também para a
    exportação (5.7; VIA-120, VIA-135).
  - VIP: a análise do anual propõe um início no ano da cobertura e avisa antes de
    gravar (12.8; DCE-082).
  - Disputa no Portal: fora da vez do Cliente, campo e envio desligados, com
    "Aguardando a resposta da Equipe de Containers"; a recusa diz o mesmo nome
    (15.6; DEM-107, DEM-108, POR-079).
  - Filtro **Status** da aba Demurrage do Portal sem **Cancelada**, com o padrão
    **Todos** (17; DEM-112, POR-071).
  - Recusa do Desbloqueio de CE exportado igual à da tela (DCE-057).
  - "Disputa" no lugar de "Dispute" nas recusas e alertas da Disputa, textos de
    tela corrigidos (4.1 **Número da viagem**) e textos do servidor que não são
    recusa com acento: motivos de revisão das Taxas Locais, **Pode consolidar**,
    avisos do sino do Portal e textos de alertas (21.4; matrizes 02, 03, 04, 05,
    07, 09a, 09b, 10, 11 e 12).
  - 17.11 com o aviso de que as páginas do site entram no ar com a publicação;
    capturas novas `prazo-do-adr` (25.9, com um ADR fechado no cenário) e
    `pix-itau-ligado` (24.1).
