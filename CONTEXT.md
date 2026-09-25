# Contexto do Sistema

Glossário de domínio do Vela e do Portal Fwlog. Define entidades, estados e
regras de negócio. A implementação é rastreada nos [módulos](docs/README.md),
na [arquitetura](docs/ARCHITECTURE.md) e no [índice de ADRs](docs/adr/README.md);
procedimentos de execução pertencem ao [WORKFLOW.md](WORKFLOW.md).

Revisão editorial e dos contratos citados contra o checkout em 2026-09-19.
Este glossário descreve contratos de domínio; não substitui a leitura do estado
persistido nem das definições executáveis.

## Como consultar

| Assunto | Seção |
|---|---|
| Excluir, cancelar, desativar e demais ações sobre registros | [Ações sobre registros](#ações-sobre-registros) |
| Viagem, Escala, Atracação, ADR e vazios | [Operação marítima](#operação-marítima) |
| Documento e carga física | [Baplie e reconciliação](#baplie-e-reconciliação) |
| CE, Manifesto Mercante e frete documental | [Mercante](#mercante) |
| Revisão, cadastro e contatos | [Revisão e clientes](#revisão-e-clientes) |
| Taxas Locais, câmbio, Demurrage e PIX | [Faturamento](#faturamento) |
| Eventos e pendências | [Histórico e auditoria](#histórico-e-auditoria) e [Alertas e notificações](#alertas-e-notificações) |
| Acesso, provisionamento e permissões | [Portal do Cliente](#portal-do-cliente) |
| Modelos, destinatários e envios | [Comunicação com o cliente](#comunicação-com-o-cliente) |

**Distinções essenciais:** Escala é passagem pelo porto; Atracação é passagem
pelo terminal. B/L é documento; container é unidade física. CE Mercante é do
B/L; Manifesto Mercante agrupa documentos. Taxas Locais e Demurrage têm ciclos
financeiros diferentes. Alerta é pendência compartilhada; Notificação Interna
é aviso pessoal. ADR operacional não é a ADR de arquitetura do repositório.

## Comunicação orientada ao sistema

As comunicações dos agentes devem começar pela linguagem que a pessoa vê no
Vela: página, seção, botão, campo, coluna, filtro, dropdown, modal, aba, card e
estado. Ao explicar uma mudança, descreva **onde** ela acontece, **qual ação**
é executada, **qual efeito visível** ocorre e **onde o resultado aparece**. Só
depois acrescente componente, hook, service, query, RPC ou outro detalhe de
implementação, quando ele ajudar a validar ou decidir o trabalho.

Use este arquivo como glossário canônico. Não invente sinônimos para entidades
ou estados. Se o rótulo da tela ou o vínculo ainda não foi verificado, trate-o
como hipótese e diga o que precisa ser confirmado. O guia operacional completo
está no [contrato de comunicação](docs/agents/linguagem-do-sistema.md).

## Ações sobre registros

Vocabulário decidido em 2026-09-24 para as ações que tiram um registro de
circulação ou desfazem uma ação anterior. Cada termo tem um único efeito; o
rótulo de um botão deve corresponder ao efeito que ele produz. A interface ainda
não segue este vocabulário em todas as telas: as divergências conhecidas estão
na [revisão da exclusão de dados](docs/archive/audits/2026-09-24-revisao-exclusao-de-dados.md)
e são tratadas tela a tela.

**Excluir**
Remove o registro do banco. Irreversível pelo aplicativo. Serve apenas para
erro de cadastro em registro que ainda não tem vínculo. Não é a saída para um
registro que não pode mais ser excluído.

**Corrigir**
Editar os campos de um registro. É o caminho para um erro de cadastro em
registro que já tem vínculo. O valor anterior só é preservado pela Auditoria.

**Cancelar**
Registrar, com motivo, que um fato de negócio deixou de valer: o armador
cancelou a viagem, a fatura foi anulada, uma baixa foi lançada por engano. O
registro permanece e continua visível como cancelado. Não é correção de erro de
cadastro.

**Reativar**
Desfazer, com motivo e rastro, um cancelamento ou uma desativação. O histórico
mostra os dois eventos. Se uma fatura cancelada pode ser reativada ainda será
decidido.

**Desativar**
Tirar de uso um cadastro que não será mais escolhido. O registro sai das listas
de escolha e continua no histórico e nos documentos que o referenciam. O oposto
é Reativar. "Inativar" não é usado como ação; *Inativo* continua sendo o nome
do estado exibido.

**Remover**
Tirar um item de um lugar ou de um vínculo sem apagá-lo: remover a exceção de
terminal de um B/L. O item continua existindo; o oposto é adicioná-lo de novo.
Uma ação que apaga o registro do banco se chama Excluir, não Remover.

**Revogar**
Retirar uma permissão ou liberação concedida: liberação de faturamento no
Portal, convite, sessão. O oposto é conceder de novo.

**Reverter**
Desfazer, com motivo, uma marcação sobre algo que continua ativo: omissão de
escala, transbordo. Difere de Reativar, que traz de volta algo cancelado ou
desativado.

**Dispensar**
Parar de ver um aviso. Nada muda no dado. Exclusivo de Alertas e Notificações.

**Estorno**
Devolução ao cliente de valor que ele pagou a maior. Não é o desfazer de uma
baixa: uma baixa lançada por engano é cancelada.

**Confirmação de ação**
Toda ação que grava ou altera dado, envia algo a alguém ou tira um registro de
circulação abre um diálogo antes de executar. Busca, filtros, abas e
navegação não abrem. O diálogo diz o que será feito e em quais registros
(inclusive a cascata), a consequência visível (onde muda, se o cliente ou o
Portal vê, se recalcula, emite ou envia), se dá para desfazer e como, e pede
motivo obrigatório em Excluir, Cancelar, Reativar, Reverter e Revogar. Salvar
uma edição mostra cada campo com valor anterior e novo. A prévia de
importação vale como o diálogo quando mostra o que entra, muda e sai. Ação em
massa mostra totais, bloqueados com motivo e a lista sob demanda, com um
motivo para o lote. Decidida na
[ADR 0072](docs/adr/0072-toda-escrita-confirmada-com-consequencia.md); a
implementação ainda está pendente.

Em diálogos de confirmação, o botão que fecha sem executar a ação se chama
**Voltar**, para não confundir com a ação Cancelar.

**Trava de exclusão**
Marco a partir do qual um dado de viagem deixa de ser excluível. É o CE
Mercante do B/L, porque ele permite emitir a fatura e liberar a fatura e o
B/L no Portal. O CE trava o B/L, sua carga e tudo de que ele depende (escala,
atracação e viagem); B/Ls sem CE da mesma viagem continuam excluíveis.
Fatura, invoice de Demurrage ou recebível também travam o que referenciam.
Vazios, que não têm CE, travam com o ADR de Saída fechado da escala e
terminal. Corrigir o CE mantém a trava; apagá-lo só a solta enquanto nenhuma
fatura foi emitida nem B/L liberado no Portal. Antes da trava, excluir cabe ao
Administrativo, com motivo; depois, o caminho é corrigir, substituir, reemitir
ou cancelar. Decidida na [ADR 0071](docs/adr/0071-ce-mercante-como-trava-de-exclusao.md);
a implementação ainda segue as regras anteriores.

## Operação marítima

**Viagem**
Unidade principal da operação: um navio identificado por número de viagem e
acompanhado em suas escalas, agendas e cargas.

**Viagem Cancelada**
Viagem que não será mais realizada pelo armador, embora tenha sido cadastrada
ou programada. O cancelamento preserva seus registros e vínculos para
rastreabilidade; não é conclusão nem exclusão. Uma viagem cancelada por
engano pode ser reativada pelo Administrativo, com motivo.

Hoje, uma viagem não cancelada só pode ser excluída pelo Administrativo se
ainda não recebeu qualquer dado vinculado. A regra decidida na
[ADR 0071](docs/adr/0071-ce-mercante-como-trava-de-exclusao.md), ainda não
implementada, é outra: a viagem pode ser excluída, levando junto seus B/Ls,
carga e escalas, enquanto nenhum B/L dela estiver sob a
[Trava de exclusão](#ações-sobre-registros); a tela mostra antes o que será
apagado. Depois da trava, o caminho é corrigir ou cancelar.

**Alias de Nome de Navio**
Prefixo abreviado reconhecido como equivalente ao prefixo canônico do nome do
navio, sem alterar o nome exibido ou cadastrado. `ZYHY` equivale a
`ZHONG YUAN HAI YUN`; `CS` e `C.S.` equivalem a `COSCO SHIPPING`. A equivalência
é bidirecional, exige o alias como prefixo completo separado do restante do nome
e não dispensa a igualdade do número da viagem.

**Escala portuária**
Passagem de uma viagem por um porto brasileiro, identificada por
`(Viagem, porto)`, com datas operacionais, identificadores e vínculos
documentais próprios. É dona da chegada ao porto — ETA e ATA —, enquanto as
datas de berço pertencem às suas Atracações. Um porto, uma escala: a mesma
escala pode descarregar importação, embarcar exportação ou as duas coisas, e o
sentido da operação não a divide em registros diferentes. A sua saída do porto
é derivada: o ATD da última Atracação, existindo apenas quando todas as
Atracações têm ATD. Portos estrangeiros da rota não são escalas —
permanecem como papel documental do B/L.

- **Distinto de:** POL e POD, que são papéis do conhecimento de embarque e da
  rota (`ETD do POL`, POD do B/L, POD omitido), não linhas do planejamento da
  Viagem.

**Exportação da Escala**
Declaração de que a escala terá embarque, com os dados próprios do sentido de
exportação: granito, containers vazios e movimentos previstos. É uma decisão
explícita do operador, não um estado derivado de haver número preenchido — uma
escala pode estar declarada como exportadora antes de qualquer quantidade ser
conhecida. Retirar a declaração é impossível enquanto houver carga de
exportação vinculada à escala (granito ou Embarque de Vazios); sem carga, a
retirada descarta os dados de planejamento.

**Próxima Escala**
Escala não omitida, com ETA informado e ainda sem ATA, que possui o menor ETA
entre as escalas pendentes da Viagem. Um ETA já vencido não retira a escala
dessa posição; ela permanece como Próxima Escala com a indicação “ETA vencido —
ATA pendente”.

**Linha do Tempo da Viagem**
Histórico operacional dos acontecimentos da Viagem, sem eventos financeiros.
Importações de B/L são consolidadas por rota, com quantidade, POL e POD; omissões
de escala informam o POD omitido, o Porto de Transbordo e o motivo quando houver.
Alterações editoriais de terminologia não são acontecimentos da Viagem e não
integram sua linha do tempo.

**Omissão de Escala**
Evento operacional em que o armador não realiza a escala prevista em um POD. A
carga afetada é descarregada em outro porto da mesma viagem para seguir em
transbordo ou ser convertida em COD. A omissão em si não tem efeito financeiro;
só o COD reprecifica a Taxa Local, no destino final (ADR 0051). CE Mercante e
Demurrage seguem manuais.

Uma omissão registrada por engano é reversível pelo Administrativo, com justificativa e
notificação de correção ao cliente, enquanto nenhum B/L afetado estiver em COD.
Omitir duas vezes o mesmo POD é erro, não atualização silenciosa.

A escala omitida permanece visível na programação de navios, marcada como
`OMIT` na coluna daquele porto — para o operador em Chegadas e Saídas e para o
cliente no Portal (ADR 0052). `OMIT` é distinto de `X`: um diz que a escala não
vai acontecer, o outro que a data ainda não foi informada. O motivo interno da
omissão não acompanha essa marca.

**Porto de Transbordo**
Porto onde a carga de uma escala omitida é efetivamente descarregada para seguir
em transbordo ou receber COD. Pode ser diferente do POD original do B/L.

**Transbordo**
Seguimento da carga em navio de terceiro após omissão de escala. Porto, navio,
armador, viagem, ETD e ETA de transbordo formam um registro global da omissão,
compartilhado pelos B/Ls afetados e complementado progressivamente conforme as
informações se tornam conhecidas. Esses dados são referência operacional leve,
não uma nova Viagem; COD permanece uma exceção individual por B/L.

O ADR do Porto de Transbordo (Porto onde a carga foi efetivamente
descarregada) passa a contar essa carga, separada da carga de destino final
própria daquele porto. A apuração é por porto; no modelo terminalizado ela
aparece no ADR do terminal que operou a frente correspondente — ver Porto de
Transbordo e ADR.

O registro global é mantido na Viagem. Cada B/L afetado exibe os dados herdados
para consulta e conserva apenas sua ação individual de COD. Alterações do
registro global integram a Linha do Tempo da Viagem e o Histórico dos B/Ls
afetados.
Cada complementação é auditada pela RPC `update_voyage_omission`; a disposição
`transshipment` ou `cod` continua no grão individual do B/L.

A disposição individual (`transshipment`/`cod`) é operada na ficha do B/L; a
Viagem edita apenas o registro global e lista os B/Ls afetados para consulta.

No Portal, a omissão gera uma notificação e o COD gera outra para o B/L
específico. Os dados globais vigentes permanecem visíveis em Informações de
Transbordo; complementos posteriores atualizam esse card sem criar uma nova
notificação a cada edição.

**COD (Change of Destination)**
Alteração do destino final do B/L para o Porto de Transbordo após omissão de
escala. É uma exceção por B/L, marcada deliberadamente pelo operador com
justificativa registrada.

Reprecifica a Taxa Local: ela é devida no destino final, e o COD muda o destino
final (ADR 0051). O Transbordo não reprecifica, porque nele o destino final é
preservado — a carga segue por navio de terceiro até o POD original. A diferença
apurada vira um Ajuste de COD; CE Mercante e Demurrage seguem manuais.

`set_bl_cod` grava a decisão e calcula um Ajuste de COD append-only. A prévia
usa o ROE vigente para linhas em USD; quando o B/L já foi faturado, o valor
original vem do snapshot do documento efetivamente emitido e nunca da tabela
atual do POD antigo. A emissão de fatura complementar, cancelamento/reemissão
e restituição exige conclusão vinculada pelo Financeiro.

O CE Mercante do B/L nunca muda. O Manifesto Mercante do B/L muda: ao aplicar
COD, o B/L deixa de constar no manifesto do porto omitido e seu vínculo
(`bls.manifesto_mercante_id`) é limpo (NULL), gerando pendência operacional de
vinculação ao manifesto do novo destino (monitorada via o filtro "Sem manifesto" no LineUp).

- **Ver também:** Ajuste de COD, Taxas Locais, Omissão de Escala, Porto de Transbordo, Manifesto Mercante

**Ajuste de COD**
Diferença financeira apurada quando um COD reprecifica a Taxa Local de um B/L já
faturado. Quando falta valor, é cobrada por Fatura Complementar de COD; quando
sobra, o destino depende do que já entrou. Antes do faturamento não há ajuste:
B/L não faturado é simplesmente recalculado, e B/L faturado e não pago gera
pendência de cancelar e reemitir a fatura.

Com pagamento parcial, a diferença a menor **abate o saldo em aberto** antes de
virar restituição: só a parcela da redução que exceder o saldo em aberto volta como
dinheiro. Devolver a diferença cheia restituiria o que nunca entrou. Com a
fatura integralmente paga, a diferença a menor vira restituição direto.

O COD apura e registra a diferença; a emissão do documento e a liberação da
restituição são atos do Financeiro, nunca automáticos.

O ajuste é criado automaticamente pela transição de COD e permanece pendente
até que Financeiro vincule o documento resultante (ou registre abatimento/
restituição pela operação transacional de liquidação).

- **Ver também:** COD, Taxas Locais, Recebível Local, Invoice Individual

**Visão Geral do B/L**
Informa a aba padrão da ficha do B/L que consolida viagem e escalas,
transbordo/COD, carga, cliente, Portal e financeiro, com os trilhos operacional
e financeiro e a próxima ação.

**Rota da Viagem**
Sequência de portos de uma viagem. Cada escala registra a chegada ao porto
(ETA/ATA) e as Atracações que a compõem, cada uma com o seu próprio ciclo de
berço (ETB/ATB/ETD/ATD). É o dado que o sistema operacional consome — B/Ls e
demais documentos de carga referenciam esses mesmos portos.

**Frente de Operação**
Recorte da escala por sentido e modalidade, persistido em
`voyage_escala_operation_fronts`. A atribuição de terminal liga a carga à
Atracação correspondente. Frentes distintas podem compartilhar terminal;
frente sem terminal permanece TBC. Para B/L misto, carga cheia e carga solta
são frentes distintas do mesmo documento, não dois B/Ls (ADR 0068).

**Atracação**
Passagem de uma Escala por um terminal, com o ciclo próprio de berço: ETB e ATB
para a atracação, ETD e ATD para a desatracação. É dona dessas quatro datas e do
Restow — a Escala é dona apenas de ETA e ATA, a chegada ao porto. Uma Escala é
uma sequência ordenada de Atracações; o mesmo terminal ocorre uma vez por
Escala. A ordem é derivada de `COALESCE(ATB, ETB)`, com empate desfeito pelo
código do terminal: não é campo digitado. Nasce da atribuição de um terminal a
uma Frente de Operação; sem frente não há Atracação, e uma frente sem terminal
escolhido é uma Atracação **TBC**.
_Evitar_: berço, janela, escala no terminal.

**ATB (Actual Time of Berthing)**
Data e hora efetivas em que a embarcação atracou no terminal da Atracação. É
distinta de ATA, que registra a chegada ao porto e pertence à Escala, e de ETB,
que registra a previsão de atracação naquele terminal.

**ATD (Actual Time of Departure)**
Data efetiva em que a embarcação desatracou do terminal da Atracação,
registrada sem hora. É distinta de ETD, que permanece a previsão de
desatracação daquele terminal. Marca o início da contagem do Prazo
de Conclusão do ADR.

**Estado da Escala**
Estado derivado por `deriveEscalaState` (`src/lib/escalaState.ts`): sem
Atracações, nulo; todas com ATD, `Concluída`; caso contrário, qualquer ATB
preenchido e ainda sem ATD resulta em `Atracada`; sem esses fatos, nulo. No
caminho legado de uma única Atracação, ATD precede ATB. Não é um campo manual.

**ETD do POL**
Data estimada de saída da viagem no porto de carregamento. Permanece como a
previsão da rota mesmo quando uma saída efetiva é posteriormente conhecida. É
registro documental da rota, sem vínculo com a Escala nem com a Atracação: não
descreve a operação do navio no porto brasileiro.

**ATD do POL**
Data efetiva de saída da viagem no porto de carregamento. Para carga de
container, a data `Laden on Board` informada pelo B/L é sua fonte documental.
Quando B/Ls da mesma Viagem e POL informam datas diferentes, a data mais antiga
é o ATD canônico do POL.
Não tem vínculo com a Escala nem com a Atracação: é registro documental do
conhecimento, não da operação do navio, e nunca preenche nem substitui as datas
delas. Vive em dois lugares — a coluna ATD POL de Escalas & Manifestos e o
quadro de Chegadas e Saídas — além do próprio B/L.
Em Chegadas e Saídas, onde não há coluna própria de ATD, ocupa visualmente a
célula de ETD com destaque verde, sem transformar conceitualmente ATD em ETD.

**Programação de Navios (Chegadas e Saídas)**
Quadro de line-up exibido ao cliente no Portal, com a previsão de datas por porto
da rota. É uma **visão voltada ao cliente**, distinta do **Line-Up (TV)**, que é o
painel operacional derivado das viagens já cadastradas. Conforme a ADR 0021,
não há cadastro próprio: cadastrar em Chegadas e Saídas cria ou anexa a própria
Viagem e as suas Escalas, e a Programação exibida no Portal é uma projeção das
viagens marcadas como visíveis — inclusive as escalas que só embarcam.

O Line-Up e o Painel **segregam os sentidos**: uma escala que descarrega e
embarca aparece em duas linhas, uma de importação e uma de exportação, com as
**mesmas datas da Escala** e diferindo apenas no conteúdo operado. Escala de
sentido único produz uma linha só. É granularidade de exibição, não um segundo
registro: o planejamento da Viagem continua mostrando uma linha por Escala.

**ADR (Agency Departure Report)**
Relatório operacional do navio no porto. No modelo terminalizado, cada terminal
atribuído às frentes da Escala brasileira tem seu ADR; vários terminais no mesmo
porto podem gerar vários relatórios. O legado mantém um ADR por (viagem, porto).
Portos de origem estrangeiros não geram ADR. Uma operação
que só embarca também gera ADR, e o fechamento exige os três
sign-offs departamentais mesmo quando um departamento não tem nada a declarar.
Documenta tudo que aconteceu na escala — datas confirmadas, carga descarregada
e carregada, embarque e descarga de vazios, granito, carga solta, veículos,
armazenagem e depot dos vazios, overtime e ocorrências. É a fonte confiável
usada pelo Financeiro para aprovar pagamentos de faturas.

Containers cheios são contados exclusivamente pelos B/Ls (fonte documental,
ADR 0025); o Baplie não determina mais essa contagem. Carga em transbordo
(de uma Omissão de Escala) conta no ADR do Porto de Transbordo onde foi
efetivamente descarregada, separada da carga de destino final desse mesmo
porto — ver Transbordo e Porto de Transbordo. Vazio do Baplie sem B/L conta
como natureza própria (`vazio`) na listagem de carga descarregada, distinta
da classificação cama/cover plate da seção de Vazios descarregados.

O ADR é uma **exibição consolidada** de dados construídos nos módulos de
origem, não uma redigitação: carga, veículos, vazios, depot e overtime nascem
nos seus módulos; apenas ocorrências e sign-offs nascem no próprio ADR. Existe
no escopo da operação correspondente; as pendências do relatório terminalizado
são avaliadas a partir do ATD daquele terminal, respeitando a elegibilidade e
os marcos de vigência dos alertas.

A identidade do ADR legado continua sendo (viagem, porto). Para o modelo
terminalizado, a identidade nova é (viagem, porto, terminal), materializada por
`report_id`: uma frente pertence a um único terminal, várias frentes no mesmo
terminal compartilham um ADR, e cada terminal tem fechamento independente.
Frente sem terminal é `TBC`, não cria ADR e bloqueia o fechamento. ADRs legados
sem `terminal_id` permanecem legíveis pelo caminho antigo. O armador exibido no
cabeçalho deriva do navio da viagem.

- **Ver também:** Seção do ADR, Resolução de Seção, Sign-off Departamental, Fechamento do ADR, Listagem do operado

- **Distinto de:** Architecture Decision Record (`docs/adr/`), que é documento
  de engenharia deste repositório. Em código e schema, usar sempre
  `agency_departure_report`, nunca `adr` solto.

**Seção do ADR**
Bloco temático do ADR com um departamento dono e um estado de resolução próprio.
São seis seções. A **Escala** — identidade do relatório (armador, navio/viagem,
porto, terminal) e datas confirmadas — abre o ADR sozinha, porque é o assunto do
relatório e não uma etapa dele. As outras cinco vêm na ordem do ciclo:
importação (carga descarregada, vazios descarregados, veículos) → exportação
(granito, embarque de vazios). O conteúdo derivado do sistema é
exibido, não redigitado; apenas a Observação e a resolução/sign-off nascem no
ADR. Divisão de donos:
- **Operações:** escala (identidade e datas confirmadas).
- **Documentação:** carga descarregada e vazios descarregados.
- **Equipamentos:** veículos, granito e embarque de vazios.

**Resolução de Seção**
Estado de uma seção quanto ao seu dono: Pendente → Confirmado ou Nada a declarar.
Ausência de dado não é conclusão: zero overtime sem resolução é seção Pendente,
não escala sem overtime. A primeira saída de Pendente é uma decisão que pede
confirmação explícita; alterar uma decisão já tomada — voltar a Pendente ou
trocar entre Confirmado e Nada a declarar — exige justificativa. Toda transição é
registrada em histórico (autor, momento, de→para e, quando aplicável,
justificativa).

**Listagem do operado**
Forma de exibição do ADR (aba e impresso) que lista apenas as combinações
(tipo × natureza, ou tipo × condição × local, conforme a seção) que
realmente ocorreram na escala, com o total no topo. Ausência de ocorrência
não vira linha zerada: uma seção sem nenhum dado mostra uma única linha
"Nada operado nesta escala" e continua exigindo Resolução de Seção
(Pendente/Confirmado/Nada a declarar) — ausência de dado não é conclusão.

**Sign-off Departamental**
Ato pelo qual um departamento assina, de uma vez, o conjunto das suas seções do
ADR, confirmando que refletem a realidade da escala. São três — Operações,
Documentação e Equipamentos — e o fechamento do ADR exige os três. Só é
habilitado quando todas as seções do departamento estão resolvidas (Confirmado
ou Nada a declarar); reabrir um sign-off já dado exige justificativa. Os alertas
de informação faltante, disparados após o ATD aplicável ao relatório, são por departamento
("Documentação pendente"), não por seção.

**Equipamentos**
Departamento responsável pelo embarque de vazios de exportação (VAZIOS EXP) e
pelos veículos. Vazios descarregados (importação) pertencem à Documentação.

**Overtime (de escala)**
Movimentação de vazios realizada fora do horário normal, cobrada pelo depot ou
pelo transportador. É declarada como uma **Linha de Serviço do Embarque**, igual
a qualquer outro serviço performado — não é acréscimo percentual derivado de
coluna importada nem de incidência configurada por serviço.
Alimenta o ADR; a conferência da fatura correspondente é do Financeiro.

**Embarque de Vazios (EXP)**
Registro operacional do embarque de containers vazios de exportação de uma
escala, criado do zero por Equipamentos no módulo VAZIOS EXP. Existe **um por
escala** — (viagem, porto), a identidade da Escala —, e reúne duas partes
de naturezas distintas:

- a **Lista de Unidades Embarcadas** — o fato: quais containers foram
  embarcados, com suas datas; entra por planilha;
- as **Linhas de Serviço do Embarque** — o custo: quais serviços foram
  performados; entram manualmente.

O grão do módulo **deixou de ser o container**: uma linha de serviço não aponta
para containers específicos, e a lista de unidades não carrega preço. O único
ponto onde as duas partes se tocam é a armazenagem.

- **Ver também:** Unidade Embarcada, Linha de Serviço do Embarque, Operação de Pátio

**Unidade Embarcada**
Container vazio efetivamente embarcado na escala; item da Lista de Unidades
Embarcadas. Tem número, tipo, **local de origem** (sempre presente — um Depot ou
um Terminal Portuário do Cadastro de Terminais), condição, datas de entrada e
saída do depot e data de embarque. A lista é **completa**: inclui as unidades que
não geraram armazenagem — as de Terminal Portuário vêm sem datas de depot. É a
fonte da contagem de vazios embarcados e dos dias de armazenagem exibidos no ADR.

Unidade vinda de **Depot** tem obrigatoriamente as duas datas de gate; a única
unidade sem datas é a que veio de **Terminal Portuário**. Planilha que viole isso
não sobe: a divergência é apontada e a importação inteira é recusada.

**Linha de Serviço do Embarque**
Declaração de um serviço efetivamente performado na operação de vazios, lançada
manualmente pelo usuário. Cada linha tem serviço, tipo de container, quantidade,
valor unitário, local onde foi performado e — quando o serviço é transporte — a
rota percorrida (origem → destino). O mesmo serviço com tipos de container ou
rotas diferentes são **linhas diferentes**, porque o valor difere. O usuário
lança quantas linhas forem necessárias; o sistema não presume nenhuma.

Exceção única: a quantidade da linha de armazenagem é **preenchida a partir da
Lista de Unidades Embarcadas** (dias cobráveis daquele depot), não digitada. O
usuário pode sobrescrevê-la, e o sistema mantém o valor calculado visível ao
lado como referência.

A tela aponta as combinações (depot, condição) da Lista de Unidades que ainda
não têm linha de armazenagem lançada, com um atalho de um clique que já
preenche serviço, quantidade calculada e valor sugerido do Cadastro de
Terminais — o usuário ainda lança (um clique é um lançamento), o sistema só
para de fazê-lo procurar o que falta. Isso não presume a linha: sem cadastro de
armazenagem para aquela condição no depot, a tela não oferece o atalho e
aponta para o Cadastro de Terminais.

- **Distinto de:** Unidade Embarcada, que é fato operacional importado e não
  carrega preço.

**Cadastro de Terminais**
Registro dos locais com que a operação de vazios trabalha e dos **valores
sugeridos** de seus serviços. Cada local tem um **tipo**:

- **Depot** — local de armazenagem do vazio antes do embarque. Tem os dois Free
  Times de Storage e é o único tipo que gera armazenagem.
- **Terminal Portuário** — o próprio terminal da escala (ex.: TVV). Não tem free
  time e nunca gera armazenagem: a unidade que vem dele descarregou, ficou no
  local e está sendo reembarcada. Cobra serviços como qualquer outro local.

Terminal Portuário exige um porto brasileiro do cadastro e persiste o vínculo
em `depots.port_id -> ports.id`; Depot comum continua sem porto. A escolha de
terminal na escala usa somente terminais ativos ligados ao porto da escala.
Terminal inativo não pode ser atribuído a uma nova frente, mas permanece
visível quando referenciado por histórico. O código é normalizado e único;
exclusão física é bloqueada por referências.

Não é a fonte do cálculo: ao lançar uma Linha de Serviço do Embarque, o usuário
escolhe o local e o serviço, e o sistema **sugere** o valor unitário registrado,
que ele pode sobrescrever naquela linha. O valor efetivo mora sempre na linha
lançada, e o cadastro não tem vigência — o valor sugerido vale até alguém trocá-lo.

A entidade nomeada é o **local**, não a "taxa": é distinta da Tabela de Taxas —
Granito, que é genuinamente uma tabela de tarifas.

- **Evitar:** "Cadastro de Depot" (nome anterior, quando o cadastro só
  tinha depots), "Taxas de Vazios", "tabela de taxas de depot"
- **Distinto de:** o **porto** da escala (identidade `(viagem, porto)` do ADR
  legado, ex.: BRVIX). Um Terminal Portuário fica *dentro* de um porto. ADR
  novo referencia o terminal cadastrado por `terminal_id`; o texto permanece
  apenas para leitura histórica legada.
- **Ver também:** Free Time de Storage, Embarque Direto, Linha de Serviço do
  Embarque, Natureza do Serviço, Tabela de Taxas — Granito

**Free Time de Storage**
Dias de armazenagem gratuita concedidos pelo depot ao container vazio antes do
início da cobrança. É atributo dos locais do tipo **Depot** e varia por depot **e
por condição da unidade**: um free time para o container totalmente vazio, outro
para o container com material do armador. A armazenagem cobrável de uma unidade
é `(saída do depot − entrada no depot + 1) − free time aplicável`, nunca
negativa — o +1 conta tanto o dia de entrada quanto o dia de saída como dias de
armazenagem. Distinto do Free Time de Demurrage, que se aplica à carga de
importação do cliente e não ao vazio no depot.

**Embarque Direto**
Unidade Embarcada cujo local de origem é um **Terminal Portuário**, não um
Depot: o container descarregou, permaneceu no terminal e está sendo reembarcado,
sem passar por depot. Vem sem datas de depot e não gera armazenagem. Não implica
ausência de custos: qualquer serviço performado sobre ele é declarado como Linha
de Serviço, como todos os demais.

**Hand-in / Hand-out**
Movimentos de gate do container vazio no depot: hand-in é a entrada, hand-out é
a saída, cada um com data por unidade embarcada. Os dias de armazenagem derivam
da diferença entre as duas datas (incluindo ambos os dias) menos o free time
aplicável; o ADR exibe o total de containers e de dias.

**Material do Armador**
Container vazio embarcado com material do armador em seu interior. Deriva da
Condição do Container Vazio, não de um campo independente.

**Condição do Container Vazio**
Estado do vazio no embarque, com dois valores: **totalmente vazio** ou **com
material do armador**. É atributo de cada Unidade Embarcada, define qual dos dois
free times do depot se aplica e separa as linhas de armazenagem — uma por
(depot, condição).

**Natureza do Serviço**
Comportamento de uma Linha de Serviço do Embarque, atributo do serviço no
Cadastro de Terminais. São três, e a natureza decide quais campos a linha exige:

- **`armazenagem`** — exige um local do tipo Depot e a condição; a quantidade (dias) é calculada a
  partir da Lista de Unidades Embarcadas; não tem percentual nem tipo de
  container; no máximo uma linha por (depot, condição).
- **`transporte`** — exige a rota, sendo o local da linha a origem e o destino o
  outro extremo.
- **`geral`** — exige apenas o local.

A lista de serviços é **aberta**: um serviço novo é cadastrado escolhendo sua
natureza, sem mudança de código. Os dez iniciais são armazenagem, transporte,
handling in, handling out, overtime handling, overtime transporte, bundle
composition, bundle organization, visual check e remoção.

A natureza define quais campos a linha exige e se a quantidade é digitada ou
calculada. O valor unitário do serviço já é o valor efetivo, inclusive quando o
serviço representa uma majoração ou overtime; a linha não recebe percentual.

- **Sinônimos:** "forma de cobrança" (nome usado pela operação)
- **Distinto de:** Tipo de Cálculo da ADR 0032 (`fixo_por_container` /
  `storage_por_dias` / `quantidade`), que precificava automaticamente e foi
  aposentado pela ADR 0033.

**Valor da Linha**
O valor unitário gravado na Linha de Serviço do Embarque já é o valor efetivo
da cobrança. Serviços de overtime ou de majoração devem ser cadastrados com o
valor atualizado; a linha não oferece nem persiste percentual. O total é
`quantidade × valor unitário`.

**Operação de Pátio**
Subseção do ADR dentro de Embarque de vazios, que consolida o custo da operação
de vazios da escala: as Linhas de Serviço do Embarque com suas quantidades e
valores, e a armazenagem (containers e dias, com o custo junto). É exibição
derivada do Embarque de Vazios e alimenta a conferência das faturas pelo
Financeiro. **Não tem resolução própria** (ADR 0036): é uma das duas partes do
agregado Embarque de Vazios, ao lado de Containers embarcados — que exibe a
Lista de Unidades Embarcadas —, e as duas são cobertas pela resolução única da
seção. De 2026-07-21 a 2026-08-04 foi seção assinável separada (ADR 0029).

Serviços antes tratados como conceitos próprios (reorganização, bundle
composition, visual check, handling, transporte, overtime) não têm mais
existência separada no modelo: todos são Linhas de Serviço do Embarque.

**Natureza do Vazio Descarregado**
Classificação do container vazio descarregado: **cama** (base de estiva para
cargas OOG) ou **cover plate** (tampas para porões do navio).

**Restow**
Container descarregado e reembarcado por reestiva. A reestiva acontece no berço,
com o equipamento daquele terminal: a contagem é da **Atracação**, não da
Escala, e é o ADR daquele terminal que a declara. Uma Escala com duas Atracações
tem duas contagens independentes.

**Local de Desova**
Local onde um container com veículo foi desovado. Atributo do container,
agregado por marca no ADR.

**Ocorrência da Escala**
Lançamento livre no diário da escala dentro do ADR: texto com autor,
departamento e data/hora, em lista append-only. Qualquer departamento registra,
marcado com o seu nome; a ocorrência pode, opcionalmente, referenciar uma seção
do ADR. Operações é dona do sign-off do diário. Cobre qualquer acontecimento
não estruturado da escala. Não possui taxonomia fixa.

**Fechamento do ADR**
Ato explícito que encerra o ADR quando os três departamentos assinaram (cada um
com todas as suas seções resolvidas). Congela um
snapshot dos dados derivados e próprios; é esse snapshot que o Financeiro
consulta para aprovar pagamentos — mudanças posteriores na origem não alteram o
relatório fechado. Reabrir exige justificativa auditada e novo fechamento. O
Financeiro não possui ato próprio de aprovação do ADR; o fechamento é o marco.
O ADR fechado é imprimível pelo navegador.

**Linha do Tempo do ADR** *(ADR 0039)*
Sequência datada dos marcos de conclusão de um ADR: a saída do navio (ATD) e o
momento em que ela foi registrada no sistema, o vencimento do Prazo de Conclusão,
os três Sign-offs Departamentais — com as reaberturas de assinatura e as suas
justificativas —, e o Fechamento. É **exibição derivada** como o resto do ADR:
nenhum marco nasce nela; ela lê datas que os próprios atos já registram. Serve
para responder, por escala, quem assinou quando e se o Prazo de Conclusão foi
cumprido.

Exibir a reabertura ao lado da assinatura é o que separa demora de zelo: um
departamento que assinou no prazo e reabriu para corrigir aparece com a causa do
seu atraso à vista, em vez de indistinguível de quem simplesmente demorou.
Exibir o momento do registro do ATD, por sua vez, é o que explica o ADR que nasce
vencido — a causa é o lançamento tardio da saída, não uma falha do departamento.

No ADR fechado, o impresso mostra **as datas de assinatura**, que são evidência
de quem validou o quê e quando, mas não o veredito de prazo: cumprimento e
atraso são medida interna da agência e vivem só nas telas.

Sem ATD não há marco zero: o ADR de escala cujo navio ainda não saiu tem linha do
tempo, mas não tem prazo nem cor. Assinar antes da saída é permitido e fica
registrado como tal; quando o ATD chega, essas assinaturas já contam como
cumpridas. Escala omitida nunca tem prazo — o navio não atracou, não houve saída
—, e o seu ADR fica fora da medição em definitivo, nem cumprido nem descumprido.

- **Ver também:** Prazo de Conclusão do ADR, Sign-off Departamental, Fechamento do ADR, ATD, Omissão de Escala

**Prazo de Conclusão do ADR** *(ADR 0039)*
Compromisso interno de que cada departamento assina a sua parte do ADR até três
dias úteis depois da saída aplicável ao relatório. No ADR terminalizado, a
contagem começa na **data real do ATD da Atracação** (`terminal_atd`); no legado,
usa o ATD da escala. Não começa no momento em que a saída foi registrada: navio que
saiu na segunda e teve o ATD lançado na quarta já chega ao lançamento com dois
dias consumidos, e um ADR pode nascer com o prazo vencido. O prazo vence no fim
do terceiro dia útil após o ATD e é contado em dias, sem hora — a hora da saída
não é considerada. O dia do ATD não conta, mesmo quando é dia útil. Quando a
escala tem também um ATD do POL e as duas datas divergem, o relógio segue a data
operacional do relatório; a divergência continua exposta, mas não move o prazo.

**Dia útil**, para este prazo, é de segunda a sexta: sábado e domingo não são
contados. Feriados contam como dia útil — o prazo não conhece calendário de
feriados, nacional ou portuário. Navio que sai na segunda vence na quinta; navio
que sai no sábado começa a contar na segunda e vence na quarta.

São três prazos independentes, um por departamento, todos com a mesma
data-limite; o prazo de um departamento é cumprido pelo seu Sign-off
Departamental. O Fechamento do ADR é marco de conclusão do relatório, mas não
tem prazo próprio, porque não pertence a nenhum departamento.

O cumprimento é medido pela **assinatura que vale agora**, não pela primeira que
existiu. Um departamento que reabre a própria assinatura para corrigir algo volta
a estar em contagem e fica fora do prazo se reassinar depois da data-limite; os
outros dois permanecem em dia, porque reabrir o ADR não apaga as assinaturas
alheias. O atraso é sempre do departamento que reabriu a sua própria.

O compromisso **não retroage**: só escalas cujo ATD é posterior ao início da
vigência são medidas. ADRs anteriores não ganham cumprimento calculado nem
entram no agregado, ainda que o dado das suas assinaturas exista — a operação
que os assinou não conhecia o prazo.

O cumprimento é atributo do **departamento**, nunca da pessoa: o nome de quem
assinou continua visível em cada ADR, mas a medição agregada não soma por
usuário. Quem clica no botão é quem estava disponível, não necessariamente quem
produziu o dado que faltava.

O vencimento sem assinatura gera **alerta próprio**, um por departamento em
falta. Ele não substitui o alerta de pendência do ADR: os dois convivem porque
dizem coisas diferentes — um lembra que há trabalho a fazer desde que o ATD foi
lançado, o outro afirma que o compromisso foi descumprido.

- **Ver também:** Linha do Tempo do ADR, Sign-off Departamental, ATD
- **Distinto de:** o alerta de pendência do ADR, que sinaliza seção não
  resolvida a partir do lançamento do ATD e não conhece data-limite.

**Número de Escala do Mercante**
Identificador criado no sistema federal Mercante para uma escala do navio. Uma
viagem com múltiplos terminais pode ter mais de um número de escala.

**Vínculo de Manifestos à Escala**
Confirmação de que os manifestos foram vinculados à escala no Mercante. Não é
sinônimo de o Número de Escala existir.

**B/L (Bill of Lading / Conhecimento de Embarque)**
Documento de transporte que agrupa carga sob um consignatário. É a unidade
operacional usada para revisão, cobrança de taxas locais e vínculo com cliente.
O arquivo do B/L é a fonte documental de ingestão da carga de container: pode
criar um B/L inexistente e corrigir dados comerciais já gravados, além de ser a
fonte de Frete & Despesas do BL, da data de emissão e da data de embarque na
origem. A operação de container não depende da importação de Manifesto.

**Razão Social do Consignatário**
Nome empresarial curto exibido em tabelas e usado como sugestão na reconciliação
de cliente — nunca como vínculo, que só se estabelece por documento exato. É
extraído até a natureza jurídica, incluindo combinações como `LTDA EPP`, e não
inclui endereço, telefone, CEP, cidade ou país. Quando nenhuma natureza jurídica
é reconhecida, corresponde à primeira linha não vazia do bloco do consignatário.
É distinta do bloco completo do consignatário, preservado para EDI e auditoria.

**Manifesto**
Documento que agrupa B/Ls de uma operação marítima. Para carga de container,
não é fonte de ingestão do sistema: os dados documentais entram pelos próprios
arquivos de B/L. Para carga solta, o manifesto BB continua sendo fonte de
ingestão, agora ao lado do B/L avulso — as duas portas convivem e gravam o
mesmo B/L.

**B/L Avulso**
Conhecimento de embarque recebido como documento individual do armador (.pdf
ou .docx), e não consolidado em manifesto. É fonte de ingestão de carga solta:
cada arquivo cria ou atualiza um B/L da viagem escolhida. Não carrega CE
Mercante — esse dado continua entrando pela importação de CE Mercante.

**CNTR**
Abreviação de domínio para container.

**Carga Solta / Breakbulk (BB)**
Carga transportada sem container, representada por itens, peso e volume
vinculados ao B/L.

**B/L com Carga Mista (Misto)**
Conhecimento de embarque unificado (`cargo_mode = 'misto'`) que contém
simultaneamente contêineres e carga solta (breakbulk). Na apuração operacional,
participa tanto dos agregadores de contêineres quanto dos de carga solta sem
duplicar a contagem única de B/Ls da viagem. No faturamento, gera fatura
adaptativa modular com blocos distintos para contêiner e carga solta.

**Peso do B/L (contêiner x carga solta)**
O peso físico de um B/L vive em duas colunas **disjuntas**: `bls.total_weight_kg`
mede somente a carga conteinerizada e `bls.bb_weight_ton` somente a carga solta.
O peso total em kg é `total_weight_kg + bb_weight_ton × 1000`; em toneladas,
divide-se esse resultado por 1000. Nunca se somam diretamente unidades
diferentes nem se escolhe uma componente isolada. Até a migration 061, os
importadores de carga solta
espelhavam o mesmo peso nas duas colunas, o que forçava os consumidores a
escolher uma (`bb_weight_ton ?? total_weight_kg / 1000`); o desempate subcontava
o B/L misto e a soma, sobre o espelho, contava a carga solta duas vezes. Quem
precisa do peso total usa `blTotalWeightKg`/`blTotalWeightTon` (`src/lib/cargoMode.ts`)
no TypeScript e a soma com conversão de unidades no SQL.

**Cubagem do B/L (contêiner x carga solta)**
Desde a migration `064`, `bls.total_cbm` mede somente carga conteinerizada e
`bls.bb_cbm` somente carga solta, ambas em m³. A cubagem total é a soma por
`blTotalCbm` (`src/lib/cargoMode.ts`). Importação e revisão atualizam cada
componente separadamente, inclusive no B/L misto. Máquinas e cubagem BB também
contam como sinal de carga solta na derivação de `cargo_mode`.

**Painel Unificado de BLs**
Superfície canônica em `/bls` que centraliza todos os B/Ls da agência
independentemente do seu modo de carga (`container`, `carga_solta` ou `misto`),
substituindo em definitivo as antigas telas e rotas segregadas `/manifestos` e
`/carga-solta`.

**RoRo**
Carga rolante, especialmente veículos importados e vinculados a B/L e, quando
aplicável, ao container físico.

**Granito**
Carga de exportação: blocos de granito embarcados nas escalas brasileiras.
"Importação" no fluxo de Granito refere-se à ingestão das planilhas COSCO
(entrada de dados), não ao sentido da carga. Mantém revisão e registros
operacionais próprios. Na Validação de Taxas aparece como **Apoio operacional**,
sem participar da emissão de invoices; conferência de quantidades não é
faturamento financeiro.

## Baplie e reconciliação

**Baplie EDI**
Arquivo EDIFACT do plano de estiva. É a autoridade para a presença física de
containers, posição a bordo e flags operacionais. Essa autoridade física é
preservada, mas a **contagem** de containers cheios do ADR é documental (vem dos
B/Ls) — o Baplie não determina mais essa contagem; um container cheio do
Baplie sem B/L correspondente vira aviso de divergência, não conta como
carga.

**Staging Baplie**
Estado intermediário dos containers importados do Baplie antes da conciliação
com os B/Ls. Uma reimportação substitui o staging anterior da viagem.

**Conciliação Baplie × B/L**
Comparação, dentro da mesma viagem, entre a carga física do Baplie e os dados
documentais dos B/Ls.

**Divergência de Existência**
Container presente numa fonte e ausente na outra. Exige visibilidade para o
operador, mas não altera silenciosamente dados comerciais.

**Divergência de Atributo**
Conflito em dado operacional, como status, IMO ou OOG. O operador escolhe qual
fonte prevalece quando a resolução não é automática.

**Estado de Conciliação da Viagem**
Resumo de prontidão dos dados:

- **Divergente:** há conflito ainda não resolvido;
- **Pendente:** falta fonte, CE ou etapa de conciliação;
- **Conciliada:** fontes e CEs necessários estão coerentes.

É um sinal operacional, não autorização financeira isolada.

**Flags Operacionais**
Características físicas da carga, como IMO, classe, número ONU, OOG e status
cheio/vazio. Não incluem consignatário, documento fiscal ou peso de cobrança.
O B/L declara carga perigosa no nível do conhecimento (DG Class e número ONU na
descrição da mercadoria), aplicando-se inicialmente a todos os containers do
B/L; o Baplie refina depois quais containers são de fato IMO.

**IMO**
Classificação de carga perigosa segundo a International Maritime Organization.

**OOG (Out of Gauge)**
Container com dimensões fora do padrão ISO.

## Mercante

**NCM**
Código da Nomenclatura Comum do Mercosul da mercadoria do B/L, guardado como
campo próprio do B/L — somente dígitos, de 4 a 8 por código, sem pontuação e sem
duplicata. Um B/L pode ter mais de um. É exigido pela manifestação no Mercante.

Vazio significa que ninguém cadastrou e nenhum documento declarou; não significa
que a carga não tem NCM. A descrição da carga continua sendo lida para **propor**
o código, nunca para substituí-lo: a importação grava o NCM que o documento
declara e preserva o cadastrado quando o documento não declara nenhum. Ver
ADR 0057.

**CE Mercante**
Conhecimento Eletrônico registrado por B/L no sistema Mercante, nos sentidos de
importação e exportação. Sua transição aciona o cálculo e a tentativa de emissão
automática das Taxas Locais no servidor. Se houver bloqueios, o cadastro do CE
não comprova emissão: o resultado e a fila de efeitos precisam ser consultados.
O CE também integra a liberação documental do B/L no Portal; o acesso depende
da conta do Cliente. O Comunicado de CE e Taxas depende da prontidão do conjunto
Cliente/Viagem, da chave de envio e do processamento do canal, não de um envio
imediato garantido ao salvar o CE. A relação CE × B/L é 1:1: um
número de CE não pode ser usado por mais de um B/L. Embarque de Vazios é a exceção
operacional: não emite CE porque é módulo de custo pago pela agência ao depot,
sem invoice ou recebível de cliente.

**Manifesto Mercante** (anteriormente designado "CE Master")
Número oficial do manifesto aduaneiro registrado no sistema Mercante para uma
determinada rota/escala portuária da viagem. A nomenclatura "CE Master" foi
descontinuada do sistema em favor de "Nº de Manifesto Mercante". É registrado na
tabela `manifestos_mercante`, que suporta múltiplos manifestos por rota e
segregação por natureza de carga (`natureza IN ('carga', 'vazio')`). Convive com
a tabela legada `voyage_route_ce_master`, preservada para compatibilidade retroativa
com importadores existentes. É distinto dos CEs individuais dos
B/Ls e não se confunde com o número de viagem interna da agência.

**Frete & Despesas do BL**
Linhas da seção "Freight & Charges" do conhecimento de embarque (B/L): frete
marítimo (ex.: OCEAN FREIGHT) e despesas declaradas pelo armador (ex.: THD),
cada uma com valor, moeda e indicador prepaid/collect. É a **fonte do bloco de
frete do registro C5** do EDI Mercante — informação que o manifesto não traz.

- **Distinto de:** Taxas Locais. Frete & Despesas do BL é dado declarado pelo
  armador para o manifesto Mercante; Taxas Locais é a cobrança do desk ao
  cliente (Recebível Local / invoice). Os dois não se alimentam.

## Revisão e clientes

**Revisão Operacional**
Etapa humana para resolver cliente, CE, peso, inconsistências de cálculo e
outros dados que impedem o avanço seguro.

**Reconciliação de Cliente**
Vínculo confirmado entre o consignatário importado e o cadastro de Cliente. O
vínculo só pode ser estabelecido por documento exato — CNPJ para pessoa
jurídica, CPF para pessoa física. Match por nome, por nome canônico ou por
similaridade é sugestão, nunca vínculo. Matching automático incerto deve
permanecer pendente de decisão humana.

Match por nome é persistido separadamente como sugestão (`suggested_customer_id`
ou `suggested_client_id`) e aparece na fila de revisão. Só a confirmação humana
preenche o vínculo; faturamento considera exclusivamente `customer_id` e
`client_id`. Ver ADR 0043 e migrations `284`–`287`.

**Troca de Consignatário**
Correção do consignatário de um B/L já gravado, feita reimportando o arquivo do
armador. Nasce de erro de lançamento e pode acontecer a qualquer momento,
inclusive depois do CE Mercante — que permanece o mesmo — e depois da fatura
emitida. Quando o B/L muda de consignatário, ele muda de dono: o vínculo de
Cliente é refeito e a cobrança já emitida acompanha, **com o mesmo valor devido**;
só o cliente vinculado à fatura muda. A troca é sempre antecipada no preview da
importação — de quem para quem, com CNPJ, e quais faturas acompanham — e só
acontece com aceite explícito do operador.

Não é automática em três situações, sinalizadas antes do aceite: fatura
consolidada com outros B/Ls, fatura com pagamento registrado, e consignatário
ainda não cadastrado como Cliente havendo cobrança. Nesses casos o vínculo fica
como está e os demais campos do B/L seguem sendo corrigidos. Ver ADR 0017.

**Cliente**
Pessoa jurídica ou física responsável por cargas e cobranças no sistema.

**Email de Contato**
Canal de comunicação do Cliente. Cada Cliente tem um Email de Contato Principal,
necessário para o cadastro, e pode ter Emails de Contato adicionais. Pode
coincidir com o email técnico do Portal, mas os conceitos não são equivalentes.
O Cliente pode cadastrar e alterar seus contatos no Portal; a alteração passa a
valer imediatamente para os Comunicados. Um endereço suprimido continua
cadastrado para rastreabilidade, mas não recebe mensagens e deve aparecer com o
motivo da restrição. Um Cliente não pode ficar sem contato principal.

**Caixa de Comunicação**
Agrupador de roteamento escolhido no Portal para um endereço de contato. O
Cliente pode vincular um endereço a uma ou mais caixas. As caixas não são
exclusivas: Documentação e Operação reúne CE e Taxas, NOA, NOR e NOB;
Financeiro reúne CE e Taxas e Cobranças de Demurrage; Demurrage reúne Cobranças
de Demurrage e eventuais comunicações sobre Demurrage. Os pacotes são fixos
para o Cliente, mas podem receber novos modelos de Comunicado ao longo do
tempo. O contato principal nasce vinculado a todas as caixas; para removê-lo
de uma caixa, outra conta de e-mail deve substituí-lo na mesma gravação. Se um
endereço vinculado ficar indisponível, o sistema usa o contato principal como
substituto e alerta a equipe.

**E-mail Capturado do B/L**
Endereço encontrado em um B/L e incorporado automaticamente ao cadastro do
Cliente. Se o Cliente já tem contato principal, entra como contato adicional; se
ainda não tem, torna-se o contato principal. Nasce ativo, com os vínculos de
caixa definidos pela regra de captura: como adicional, Documentação e Operação (ou
Financeiro na confirmação de taxas); como principal, todas as caixas. A captura fica
visível na Ficha do Cliente e na Linha do Tempo. Um endereço anteriormente
desativado é reativado quando reaparece em outro B/L, recebendo as caixas
pertinentes sem sobrescrever nome ou telefone já existentes.

**Ficha do Cliente**
Hub de consulta do Cliente em `/clientes/:cnpj`, organizado em abas (Visão
Geral, Cadastro & Contatos, Operacional, Financeiro, Histórico). Consolida a
visão de cadastro, operação e financeiro com deep links para agir nas telas
onde cada fluxo já existe; não duplica fluxos de ação. As únicas operações
executadas na própria ficha são a edição auditada do cadastro, a gestão de
contatos e o provisionamento embutido do Portal.

**Saldo Pendente do Cliente**
Soma do saldo das invoices locais emitidas e ainda não pagas — incluindo as
vencidas e as parcialmente pagas, pelo saldo restante — e das invoices de
Demurrage não pagas do Cliente, exibida com a decomposição entre as duas
origens. É leitura
consolidada para a Ficha do Cliente, não um novo conceito contábil: cada
origem mantém seu ciclo de vida próprio.

## Faturamento

**Taxas Locais**
Cobranças ligadas ao B/L, calculadas por tabelas, itens e eventuais regras
específicas do cliente.

**Motivo de Bloqueio de Faturamento**
*Pronto para emitir* é um código resolvido, fora da fila padrão, e não um bloqueio.
Categoria fechada que responde por que um B/L ainda não virou fatura. São quatro,
e nenhuma é status marcado por alguém: *Sem cliente vinculado*, *Cálculo
incompleto*, *Aguardando CE Mercante* e *Portal não provisionado*. A confirmação
do cálculo é o cadastro do CE Mercante — não existe ato separado de aprovação ou
de marcação como pronto.

Nenhum deles impede **calcular**: as taxas são calculadas para conferência
mesmo com bloqueio aberto. Esses motivos impedem emitir, na emissão manual e
na automática pela transição do CE (ADR 0070). Sem Portal pronto, o CE calcula
e retém a fatura no B/L; ela sai quando o Portal fica Ativo ou quando o
Administrativo concede a **Liberação de faturamento sem Portal**.
Quando mais de um está aberto, o
motivo exibido segue esta ordem: cliente, cálculo, CE Mercante, portal. O portal
vem por último porque é o único que não se resolve no B/L: é cadastro do
cliente, e vale para todos os B/Ls dele.
Distinto de `charge_status`, que é registro interno do motor de cálculo e não é
exibido ao operador como essa categoria de bloqueio.

O rótulo da fila é informativo; a validação server-side continua sendo a
autoridade para a emissão.

O cálculo tem **duas fases**:

- **Provisória** — importar o B/L calcula as taxas com o que ele tem naquele
  momento. Serve para conferência: o operador extrai planilha e valida. Nada é
  emitido nem publicado. O import recalcula também os B/Ls **irmãos** — os que
  dividem container e ainda não têm fatura —, para que o rateio provisório fique
  certo mesmo quando o segundo B/L entra numa importação posterior.
- **Confirmada** — cadastrar o CE Mercante recalcula, fecha e só então emite a
  fatura quando os demais requisitos forem satisfeitos. A regra operacional é
  cadastrar o CE após completar os B/Ls envolvidos no rateio; a presença do CE,
  sozinha, não prova que essa conferência foi feita.

O **fato gerador é a emissão do CE Mercante**, não a chegada da carga. Emitido o
CE, a taxa local é devida pelo porto declarado nele. O Transbordo preserva o
destino e não reprecifica; o COD é a exceção de ADR 0051: altera o destino final
e gera um Ajuste de COD pela diferença entre os valores localizados, mantendo o
CE Mercante inalterado. A emissão do documento financeiro resultante é um ato
do Financeiro.

Por isso a fatura de taxas locais é emitida dias antes da atracação: o cliente
precisa dela paga para retirar a carga. O documento emitido preserva seu valor;
ajustes posteriores, como COD, seguem atos próprios e não reescrevem o snapshot.

B/Ls que dividem um mesmo container **recebem o CE no mesmo momento**. É essa
regra operacional — não uma trava de software — que garante o rateio correto de
taxa de container compartilhado.

- **Ver também:** Fato Gerador, Omissao de Escala, COD, Data de Referência da Tarifa

**Tabela de Taxas Locais**
Cadastro que define quais taxas locais existem e quanto custam, por POD e por
modo de carga. É a fonte de verdade dos valores padrão — o sistema não tem preço
embutido em código. Tem a mesma natureza da Tarifa de Demurrage: condições
cadastradas e valores correspondentes.

**A vigência da tabela é informativa** e não participa do cálculo (ADR 0040): o
motor aplica a tabela **ativa** do mesmo POD e modo de carga, e a única forma de
tirar uma tabela do ar é inativá-la. Se houver mais de uma ativa no mesmo
escopo, vence a de vigência inicial mais recente e a tela avisa que a outra não
está sendo aplicada. Um período vencido ou futuro em tabela ativa também vira
aviso, nunca exclusão.

- **Evitar:** "tabela de preços", "tarifa local"
- **Ver também:** Item de Taxa, Condição de Cliente, Tarifa de Demurrage

**Herança e Exceção de Terminal por B/L**
`bls.terminal_id` preenchido é a exceção individual; nulo herda o terminal
resolvido por `resolve_bl_terminal_id` a partir de `voyage_escala_operation_fronts`.
A alteração passa por `set_bl_terminal_override`, exige justificativa e registra
`audit_logs`. `pod_port_id` participa da FK composta com o terminal cadastrado.
No B/L misto, as frentes de carga cheia e carga solta devem convergir ao mesmo
terminal, salvo exceção válida. Ausência/conflito gera pendência de revisão.
Terminal não faz parte da chave de `charge_tables` e não reprecifica Taxas
Locais (ADR 0068). COD limpa a exceção anterior ao mudar o destino.

**Âncora de Taxa Local**
O destino final/POD e o escopo comercial determinam as tabelas aplicáveis;
a data de referência seleciona condições de cliente, não a vigência da tabela.
B/L misto resolve duas tabelas, container e carga solta, pela função compartilhada
`resolve_bl_local_charge_table_ids`, com taxa documental apenas do lado container.
O valor emitido permanece congelado; COD segue os ajustes da ADR 0051.

**Fatura Adaptativa Modular**
Modelo de fatura que organiza seus itens visual e documentalmente em blocos
dependentes da carga do B/L: Bloco de Contêineres (itens tarifados por container,
THC, etc.), Bloco de Carga Solta (itens tarifados por peso/tonelada ou volume/m³)
e Bloco de Taxas Documentais e Administrativas. Em B/Ls mistos, ambos os blocos
de carga são renderizados de forma clara e coesa.

**Item de Taxa**
Linha da Tabela de Taxas Locais: a taxa em si, com o valor unitário e a regra
que determina sobre o que ela incide (o B/L inteiro, cada container, a tonelada
da carga solta). Divide-se em dois tipos que **não** se misturam:

- **Item automático** — aplicado pelo sistema a todo B/L elegível, sem
  intervenção.
- **Item manual** — existe no cadastro mas nunca é aplicado sozinho; depende de
  o usuário decidir lançá-lo naquele processo.

- **Ver também:** Tabela de Taxas Locais, Lançamento Manual

**Condição de Cliente**
Valor negociado com um Cliente específico para um Item de Taxa específico,
substituindo o valor padrão da tabela enquanto estiver vigente. É condição
comercial, não desconto pontual: aplica-se sozinha a todos os processos daquele
Cliente no período.

**Não pode haver duas Condições vigentes** para o mesmo Cliente e o mesmo Item
de Taxa. Sobreposição é erro de cadastro, não agendamento: são dois acordos
conflitantes para o mesmo período. Trocar uma condição exige fechar a vigência
da anterior. Por isso não existe — e não deve existir — critério de desempate.

Difere da Tarifa de Demurrage nesse ponto: aquela é lista de preço pública, onde
agendar uma vigência por cima da anterior é operação normal e a mais recente
vence. Condição de Cliente é acordo negociado, e conflito precisa aparecer.

- **Evitar:** "desconto", "override de cliente"
- **Ver também:** Item de Taxa, Cliente, Tarifa de Demurrage

**Data de Referência da Tarifa**

Data que determina qual **Condição de Cliente** vale para um B/L. Precedência:
**ETA da escala do POD** → ETA geral da viagem → data de hoje. Ancorar na escala
faz com que todos os B/Ls do mesmo navio, no mesmo porto, caiam na mesma
condição negociada; os degraus seguintes existem para que a falta de uma data
operacional nunca impeça o cálculo (ADR 0040).

**Não determina qual Tabela de Taxas Locais vale** — essa escolha é por escopo e
por tabela ativa, sem data. Antes da ADR 0040 a data escolhia as duas coisas, e
sua ausência parava o cálculo inteiro.

Não é a ATA: o CE Mercante é cadastrado dias antes da atracação, então a fatura
já foi emitida quando a ATA passa a existir. Não é a data de importação do B/L,
que é fato administrativo e não comercial.

- **Ver também:** Tabela de Taxas Locais, Condição de Cliente, Escala

**Movimento (FCL/LCL)**
Declaração do armador, presente no próprio B/L, sobre como a carga foi estufada
na origem e como é entregue no destino. É a fonte de verdade sobre um B/L ser
FCL ou LCL.

Aparece em **duas notações equivalentes**, e o B/L pode trazer qualquer uma das
duas — na prática `FCL`/`LCL` é a mais comum:

| Notação | Equivale a |
|---|---|
| `CY` (*Container Yard*) | `FCL` — container cheio |
| `CFS` (*Container Freight Station*) | `LCL` — consolidação/desconsolidação |

São **dois lados**: origem e destino. O B/L declara o par, e os mistos existem
(`FCL/LCL`, `LCL/FCL`). Para Taxa Local vale o **lado do destino** — taxa local
é cobrança de chegada, e o que define se há o que cobrar é quem executa a
movimentação no porto de destino. No contexto da isenção de veículos, num B/L
`FCL/LCL` o armador entrega o
container na CFS e o cliente retira sua parte de lá: a movimentação de destino
não é do armador, logo não há taxa local dele. Num `LCL/FCL` é o inverso — há
taxa local. LCL sozinho não concede isenção a qualquer carga: veja as duas
condições em **Isenção de Taxas Locais**.

A justificativa histórica da isenção ("taxas pagas na origem") é explicação
comercial, não critério: usar o lado da origem inverteria os dois casos mistos.

O operador pode sobrescrever a leitura do documento na ficha do B/L quando ele
vier errado ou vazio, e a correção fica registrada no Histórico.

Quando não há nem documento nem override, o sistema **cobra normalmente**. A
isenção exige LCL declarado; ausência não isenta. O modo de falha é cobrar de
quem talvez não devesse — visível e contestável — em vez de isentar quem devia
pagar, que não deixa rastro. A correção acontece na fase provisória do cálculo,
antes de qualquer fatura existir.

- **Evitar:** "tipo de carregamento"
- **Ver também:** Isenção de Taxas Locais, Taxas Locais

**Isenção de Taxas Locais**

Dispensa de cobrança de taxas locais para carga de veículos **em LCL**, cujas
taxas foram pagas na origem. Depende de duas condições, não de uma: haver
veículo no B/L **e** o Movimento indicar LCL. Veículo em FCL paga normalmente, e
veículo sem Movimento declarado também — a isenção exige prova positiva.

A isenção é consequência de dado operacional (o cadastro de veículos), então
precisa ser conferível: as isenções aplicadas devem ser visíveis em tela, não
apenas inferíveis do valor zero.

- **Ver também:** Movimento (FCL/LCL), Taxas Locais

**Taxa Local em Dólar**

Item de Taxa cadastrado em USD — como a Booking Cancelation Fee. Converte-se em
BRL **na emissão da fatura**, pelo ROE vigente naquele momento, e o valor
convertido é congelado junto com o resto da fatura.

Difere do Demurrage, que recalcula o BRL a cada PTAX até o pagamento: ali a
dívida está correndo, aqui o valor já é devido por inteiro desde o CE. Aplicar
Recálculo Diário a uma taxa local criaria dois comportamentos para o mesmo
documento conforme a moeda do item.

- **Ver também:** ROE, Recálculo Diário, Item de Taxa

**Conferência de Cálculo**
Reconstituição de como o valor de taxas locais de um B/L foi obtido: a tabela de
cobrança usada, os itens dela que incidiram, a base de aplicação de cada item e a
quantidade correspondente. É leitura, nunca ato — conferir não recalcula, não
aprova e não emite. Enquanto a fatura não existe, a conferência é feita sobre o
cálculo; emitida a fatura, ela passa a ser a fonte, porque é o que o cliente
recebeu.
- **Ver também:** Taxas Locais, Item de Taxa, Invoice Individual, Invoice Consolidada

**Recebível Local**
Saldo financeiro de taxas locais de um B/L. Pode ser ligado a invoice individual
ou consolidada e liquidado por um ou mais pagamentos.

**Invoice Individual**
Documento financeiro emitido para as cobranças elegíveis de um B/L, com
valores e condições preservados no snapshot da emissão.

**Invoice Consolidada**
Documento que reúne recebíveis de múltiplos B/Ls do mesmo cliente.

**Ledger Local**
Histórico de recebíveis, vínculos com invoices, liquidações e eventos de ciclo
de vida usado para reconstruir saldos de taxas locais.

**Demurrage**
Cobrança pela sobreestadia de containers — tempo entre descarga e devolução ao
pátio, excedendo o free time contratado.

**Free Time**
Período após a descarga durante o qual o container pode ficar no pátio sem
cobrança. Definido por container type (grupo tarifário) ou por override por B/L.

- **Evitar:** "taxa P1", "tarifa P1"
- **Ver também:** P1, P2

**P1 (Período 1)**
Primeira faixa tarifária após o free time. Taxa diária em USD aplicada aos dias
entre o fim do free time e o início de P2. Quando o free time override do B/L é
maior que o fim de P1 do grupo, P1 tem zero dias e a cobrança inicia direto em
P2.

- **Evitar:** "taxa P1", "tarifa P1"
- **Ver também:** Free Time, P2

**P2 (Período 2)**
Segunda faixa tarifária, com taxa diária superior a P1. Aplicada a partir do dia
definido pelo grupo tarifário, independentemente do free time override do B/L.

- **Evitar:** "taxa P2", "tarifa P2"
- **Ver também:** P1, Free Time

**Free Time Override**
Valor de free time específico de um B/L, sobrescrevendo o padrão do grupo
tarifário. Afeta apenas o início da cobrança (P1 começa em override+1), sem
deslocar as faixas P1/P2.

- **Ver também:** Free Time, P1, P2

**ROE (Taxa de Câmbio)**
Taxa de câmbio USD→BRL calculada a partir da PTAX do BCB com fator 1,065.
Em Taxas Locais, congela na emissão. Em **Demurrage**, pode ser atualizada
enquanto a invoice não está paga, pelo recálculo com nova PTAX. O
congelamento do valor de Demurrage ocorre no pagamento, registrado de
forma imutável no histórico da invoice. As colunas que guardam o último valor
recalculado chamam-se `current_roe` e `current_total_brl`.

No cabeçalho interno, a referência cambial é a composição explícita PTAX Venda
× 1,065 = ROE, acompanhada da data efetiva da cotação. O Portal não exibe essa composição:
na aba Demurrage informa apenas o ROE vigente e sua data de atualização; cada
invoice paga preserva o ROE que foi congelado no pagamento.

- **Ver também:** PTAX, Markup, Recálculo Diário

**Markup**
Fator multiplicativo (1,065) aplicado à PTAX para obter o ROE. É o **spread
fixo cobrado pelo armador**, não uma margem de proteção contra flutuação cambial
— a proteção cambial deixa de existir quando o valor passa a ser recalculado
diariamente.

- **Ver também:** ROE, PTAX

**Recálculo Diário**
Processo de reavaliação do valor em BRL de invoices de Demurrage **não pagas**,
usando nova PTAX divulgada pelo BCB. Atualiza `current_roe`/
`current_total_brl` e grava uma entrada imutável no histórico. Encerra-se no
pagamento, quando o valor é congelado.

- **Ver também:** ROE, PTAX, Markup, Invoice de Demurrage

**Invoice de Demurrage**
Documento financeiro que cobra sobreestadia de containers. Cada item armazena a
composição completa do cálculo: free days, dias P1, taxa P1, dias P2, taxa P2,
subtotal. O cliente (portal) deve ver free time e valor por período para
garantir transparência. O admin vê o detalhe completo incluindo ROE e descontos.

Só pode ser emitida quando **todos os containers do B/L já foram devolvidos** —
não se fatura com container ainda fora, pois os dias de demurrage (e portanto o
`total_usd`) ainda estariam acumulando. Na emissão o **valor em USD fica fixo**
(dias travados); apenas o valor em BRL flutua com o Recálculo Diário até o
pagamento. O monitoramento de containers ainda fora (demurrage correndo) é
operacional, não gera fatura.

- **Ver também:** P1, P2, Free Time, ROE, Recálculo Diário

**Tarifa de Demurrage (Rate)**
Configurável por container type com vigência temporal na tabela geral do
armador (`demurrage_rates`). A resolução usa precedência estrita: override no B/L >
acordo vigente do cliente > tarifa geral do armador. A tarifa do banco é a
única fonte de verdade; não existe fallback estático. O `active` flag é o
mecanismo de desativação imediata; `valid_to` é para expiração agendada.

- **Ver também:** P1, P2, Free Time, Free Time Override, Acordo de Demurrage do Cliente

**Acordo de Demurrage do Cliente**
Condições comerciais negociadas diretamente com o cliente (`customer_demurrage_agreements`),
definindo dias de Free Time e, opcionalmente, tarifas diárias personalizadas (P1/P2)
válidas para todos os tipos de container no período de vigência. A vigência é
resolvida com base na data de descarga (`discharge_date`) do container. Campos não
personalizados no acordo herdam automaticamente os valores padrão da tabela geral
do armador.

- **Ver também:** Demurrage, Free Time, P1, P2, Tarifa de Demurrage (Rate), Free Time Override

**Conciliação PIX**
Comparação entre transações recebidas e cobranças emitidas, priorizando TXID e
valor. Casos ambíguos exigem decisão humana.

## Histórico e auditoria

**Histórico (do B/L)**
Linha do tempo completa dos acontecimentos de um B/L: alterações manuais de
campos, mudanças em containers, cálculo e revisão de taxas, e emissão e
pagamento de faturas. É o termo guarda-chuva que abrange a Auditoria — não um
sinônimo dela.

**Auditoria**
Subconjunto do Histórico: as alterações deliberadas registradas com
justificativa (quem mudou o quê, de qual valor para qual, e por quê). Toda
auditoria é um evento do Histórico; nem todo evento do Histórico é uma auditoria
— eventos gerados pelo sistema (ex.: emissão de fatura) não têm justificativa.

## Alertas e notificações

**Alerta**
Pendência operacional registrada automaticamente pelo sistema e compartilhada
por toda a equipe interna. Existe uma única vez e permanece aberto enquanto a
condição de origem existir. Não há estado de reconhecimento: leitura é pessoal
e não trata a pendência. Responde "o que ainda precisa ser feito".

No ADR, a identidade do agregado é `(viagem, porto, terminal)` quando o
relatório é terminalizado e `(viagem, porto)` no legado. Cada agregado possui
dois itens independentes por departamento: pendência de seção e prazo vencido.
O terminal usa `terminal_atd` como ATD autoritativo; a reconciliação é
server-side e reabrir uma seção invalida o sign-off departamental dono.

**Notificação Interna**
Aviso pessoal entregue a um usuário interno sobre um Evento Notificável, com
estado de leitura próprio de cada destinatário. Responde "o que aconteceu e eu
preciso saber". Não é sinônimo de Alerta: um Alerta origina Notificações
Internas para vários destinatários, e há Notificações Internas que não nascem
de Alerta.

**Cópia Congelada**
Invariante da Notificação Interna: ela descreve o Evento Notificável como ele
ocorreu, não o estado atual da entidade envolvida. Dispensar ou fechar o Alerta
não apaga nem altera as Notificações Internas já entregues — o registro de que
o usuário foi avisado permanece.

**Evento Notificável**
Acontecimento do sistema que origina Notificações Internas. Abrange os
acontecimentos que já registram Alerta e um conjunto explícito de
acontecimentos que interessam ao usuário sem constituir pendência a tratar.

**Regra de Destinatários**
Declaração, por tipo de Evento Notificável, de quais papéis internos recebem a
Notificação Interna. É a única fonte da audiência: quem produz o evento não
decide quem é avisado.

**Eco de Tratamento**
Notificação Interna emitida aos demais destinatários quando alguém executa uma
ação manual de tratamento, como uma dispensa temporária. Existe para impedir
que duas pessoas trabalhem a mesma pendência sem saber.

**Leitura e Dispensa**
Ações distintas e sem acoplamento. Ler é pessoal, vale apenas para quem leu e
não altera o Alerta. Dispensar é ato coletivo de triagem: tira a pendência da
fila prioritária por prazo determinado, mas não resolve a origem nem libera
gate. Toda dispensa exige motivo, autor e data futura de revisão.

**Fechamento automático**
Transição do Alerta para encerrado somente depois que a recomputação server-side
confirmar que a condição de origem foi resolvida. Não é sinônimo de leitura,
reconhecimento ou dispensa.

**Indicador Operacional**
Contagem derivada de uma consulta ao estado atual, como containers com
demurrage vencido ou B/Ls de granito sem cálculo. Não é Alerta nem Notificação
Interna: não tem instante de ocorrência nem estado de leitura, e por isso não
entra na entrega pessoal.

## Portal do Cliente

**Portal do Cliente**
Interface externa onde o cliente consulta painel, faturas, B/Ls, containers,
notificações, disputas e perfil.

**Provisionamento do Portal**
Processo interno de analisar o Cliente, validar o Email de Recuperação do Portal,
autorizar e enviar o Convite do Portal e acompanhar a ativação da Conta de
Portal. Autorizar ou enviar o convite não torna o Cliente provisionado; o
provisionamento só se conclui quando a Conta de Portal fica Ativa após a pessoa
autorizada definir a senha.

**Gate de faturamento do Portal**
Condição server-side usada nos fluxos ordinários de emissão: a Conta de Portal
está Ativa, vinculada ao usuário de autenticação e com Email de Recuperação
válido e não suprimido, de modo que o cliente consiga acessar e visualizar a
fatura. A ausência dessa condição mantém o processo bloqueado e pode aparecer
na revisão ou nos alertas do Cliente. Vale para toda emissão, inclusive a
automática pela transição do CE (ADR 0070, migration `083`, que retirou a
exceção interna da `051`). A única saída sem Portal é a **Liberação de
faturamento sem Portal**. Consulte também **Desacoplamento financeiro do
Portal**.

**Liberação de faturamento sem Portal**
Decisão do Administrativo, por Cliente, que abre o Gate de faturamento do
Portal enquanto o Portal não fica pronto. Exige justificativa e data de
revisão de até 30 dias; registra autor e data. Não depende de contato com
e-mail: a fatura não é enviada por e-mail, e sem Portal um usuário interno a
imprime e entrega ao Cliente (migration `085`). Ao ser concedida, emite as
faturas que o CE reteve, com as taxas calculadas no registro do CE, sem
recalcular pela tabela vigente. Vencida a data de revisão, ou revogada, a trava volta e a próxima
retenção reabre o Alerta de Portal não provisionado. Não ativa a conta nem dá
acesso ao Cliente. Conceder e revogar ficam na ficha do Cliente (aba
Financeiro) e no Console do Portal; os outros Departamentos só consultam.

**Provisionamento autorizado**
Decisão auditada de Documentação ou Administrativo que confirma o Email de
Recuperação do Portal e inicia o envio do Convite do Portal na mesma operação.
Pode coexistir com Ativação pendente, Convite expirado ou Falha no envio, pois a
decisão da equipe e a situação da conta são dimensões diferentes.

**Inspeção do Portal**
Visão interna, permanente e somente leitura do que um Cliente específico vê no
Portal. O usuário interno permanece na própria identidade, acessa
`/clientes/portal/inspecao/:customerId/*` e não cria sessão de Portal nem executa
ações do cliente. O modo é identificado visualmente e usa o mesmo
`PortalLayout`, páginas e núcleo de leitura do Portal externo; as ações de
escrita ficam visíveis, porém indisponíveis. A abertura é auditada pela
ferramenta, não por cada chamada direta à API.

**Conta de Portal**
Vínculo entre um Cliente e um usuário do Supabase Auth. Um cliente possui no
máximo uma conta ativa provisionada internamente.

**Identificador de Login do Portal**
Valor informado na tela de login: somente o CNPJ da empresa, com ou sem máscara.
CPF e email não são identificadores de login do Portal.

**Email Técnico do Portal**
Identidade interna, aleatória e invisível usada pelo Portal para vincular o CNPJ
à autenticação. Não é email de recuperação, não é informado ao cliente e não é
aceito como identificador de login.

**Email de Recuperação do Portal**
Endereço usado para convites e recuperação de acesso. É separado da identidade
de login, pode ser compartilhado por mais de um CNPJ e pode ser alterado sob as
regras de segurança do Portal. A confirmação da troca — seja pelo cliente
(Portal → Perfil) ou de forma assistida por Documentação/Administrativo —
encerra as sessões existentes, no mesmo racional da troca de senha.

**Email candidato para o Portal**
Endereço encontrado em um contato existente do Cliente e apresentado para
análise manual. A finalidade indica o papel cadastrado (geral, financeiro ou
operacional) e a origem indica de qual cadastro o endereço veio; candidato não é
sinônimo de email autorizado nem é selecionado automaticamente.

**Seção Portal do Cliente da Ficha**
Seção específica da ficha completa do Cliente para exibir e operar o
provisionamento. Identifica o Email de Recuperação do Portal, deixando explícito
quando ele foi escolhido entre candidatos ou informado manualmente, além da
situação da conta, convite, alertas e histórico operacional.

**Convite do Portal**
Autorização temporária enviada ao email de recuperação para que a pessoa
autorizada defina a senha da Conta de Portal. É de uso único, expira em 48 horas
e não torna a conta ativa antes da definição da senha. Abrir o link apenas exibe
a tela de ativação; o token só é consumido quando o cliente envia uma senha
válida e a ativação conclui com sucesso.

**Ativação pendente**
Situação em que o envio do Convite do Portal foi aceito e existe um token válido,
mas a pessoa autorizada ainda não concluiu a ativação definindo a senha. Não
significa necessariamente que o email foi entregue ou aberto; entrega,
bounce/rejeição e ativação são acompanhados separadamente. No armazenamento,
essa situação mantém o código técnico `convite_pendente`.

Na tela de ativação, a empresa é identificada pelo nome e por um CNPJ
parcialmente mascarado, preservando os dois primeiros dígitos, a filial e os
dígitos verificadores (ex.: `12.***.***/0001-90`).

Após a ativação, o cliente vê a confirmação e é redirecionado ao login; não há
entrada automática na sessão do Portal.

**Token de Convite do Portal**
Valor aleatório, opaco e de uso único enviado no link do convite. Não contém
CNPJ ou email, e somente seu hash é persistido. A validação verifica finalidade,
vencimento e uso anterior antes do consumo atômico.

**Teste de replay de token**
Teste de segurança do piloto que tenta reutilizar um token consumido, expirado,
invalidado por reenvio ou inválido. O segundo uso deve falhar sem revelar
informações; qualquer replay aceito bloqueia a aprovação do piloto.

**Segredos privilegiados do Portal**
`service_role` do Supabase e chave da Resend ficam somente em Edge Functions ou
outros segredos do backend. Nunca são enviados ao navegador, gravados em logs ou
auditoria, nem usados pelo frontend para contornar RLS e permissões.

**Teste anti-enumeração e abuso**
Gate do piloto que verifica resposta genérica para CNPJ inexistente ou senha
incorreta, bloqueio após cinco falhas em quinze minutos por quinze minutos,
recuperação sem confirmação de existência e alerta ao Administrativo em abuso
recorrente.

**Teste de recuperação assistida e troca de email**
Gate do piloto que verifica senha atual, confirmação do novo endereço, manutenção
do email antigo até a confirmação, validação manual com justificativa e auditoria
quando a equipe intervém, e ausência de acesso do operador à senha final. Falhas
devem deixar o cadastro inalterado e chamadas não autorizadas devem ser negadas.

**Teste de logs e auditoria do Portal**
Gate do piloto que inspeciona logs de aplicação, navegador, rede e auditoria para
confirmar que senha, token bruto, `service_role`, chave da Resend e email completo
não sejam expostos. Qualquer vazamento bloqueia a aprovação do piloto.

**Evidência de testes do Portal**
Registro dos testes automatizados e manuais executados antes do piloto, com data,
versão, ambiente e resultado. O piloto só começa sem falhas críticas pendentes.

**Governança do piloto do Portal**
O Administrativo possui a aprovação final para iniciar e encerrar o piloto.
Documentação executa o provisionamento cotidiano dos clientes selecionados.

**Lista de clientes-piloto do Portal**
Relação de aproximadamente dez clientes representativos, preparada pela
Documentação e aprovada pelo Administrativo. Prioriza atividade real, email
validável e diversidade de casos; clientes sem email não recebem disparo real
e permanecem somente na fila operacional.

**Atendimento do piloto do Portal**
Documentação é o primeiro nível de atendimento e acompanha convites, ativações,
expirações e pendências. Administrativo trata exceções, incidentes de segurança
e decisões de encerramento do piloto.

**Critério de saída do piloto do Portal**
O piloto só termina quando cada cliente selecionado está Ativo ou possui a
exceção formal Provisionamento não necessário no momento, sem incidentes
críticos pendentes e com autorização final do Administrativo para avançar.

**Métricas do piloto do Portal**
O acompanhamento diário registra clientes selecionados, convites enviados e
entregues, ativações, expirações, bounces, tempo até ativação e pendências de
atendimento.

**Janela do piloto do Portal**
Não há prazo fixo. O piloto permanece aberto com acompanhamento diário até
cumprir o critério de saída; enquanto houver cliente pendente, não há avanço
para a abertura geral.

**Checklist de prontidão do piloto do Portal**
Antes do primeiro convite real, o Administrativo aprova domínio/DNS verificado,
Resend e webhooks configurados, backfill concluído, Console e alertas
operacionais, lista de clientes aprovada e canal de suporte monitorado.

**Sequência de GO LIVE do Portal**
Deploy sem disparos reais; pré-voo e reconciliação dos Clientes existentes; configuração e
verificação de domínio, Resend e webhooks; ativação de alertas e suporte; piloto;
aprovação final do Administrativo; abertura geral. Convites reais só ocorrem
depois das quatro primeiras etapas técnicas e operacionais.

**Gate de upgrade do Portal**
Antes da abertura geral, o Administrativo revisa métricas do piloto, cotas,
necessidade de backups e previsão de emails e decide formalmente se o ambiente
deve migrar para Supabase Pro e/ou Resend Pro.

**Rollback escalonado do Portal**
Em incidente operacional, novos convites são pausados sem apagar histórico.
Em incidente de segurança, sessões são revogadas e contas afetadas podem ser
suspensas. A retomada depende de decisão do Administrativo.

**Abertura geral gradual do Portal**
A aprovação do GO LIVE não dispara convites em massa. Cada Cliente permanece em
Aguardando análise até revisão individual da Documentação ou do Administrativo,
que seleciona o Email de Recuperação e envia o convite manualmente.

**Monitoramento pós-abertura do Portal**
Após a abertura geral, Documentação acompanha a fila e as métricas diariamente.
Alertas críticos continuam imediatos para o Administrativo, que pode pausar
convites ou executar o rollback escalonado quando necessário.

**Remetente transacional do Portal**
Identidade usada nos emails de convite, reenvio, recuperação e alteração de
email: `Transhipping — Portal do Cliente <portal@dominio-proprio>` (a marca
vem primeiro para sobreviver ao truncamento do nome do remetente em clientes
de email), com `Reply-To` em `suporte@dominio-proprio`. O domínio próprio
precisa estar verificado e com DNS configurado antes de envios a clientes
reais.

**Email de Convite do Portal**
Mensagem transacional sem senha ou dados financeiros. O link contém o token
opaco necessário à ativação; não o reproduza em logs ou auditoria. Identifica
a empresa e o CNPJ parcialmente mascarado, informa a validade de 48 horas e
orienta o destinatário a criar a própria senha ou avisar a Transhipping se não
for a pessoa autorizada.

**Email de Reenvio do Portal**
Mensagem que identifica um novo link, avisa que os anteriores foram invalidados
e reinicia a validade em 48 horas. Não expõe motivo interno, operador ou
histórico de tentativas.

**Email de Recuperação de Senha do Portal**
Mensagem com link de uso único, válido por uma hora, identificando a empresa e
o CNPJ parcialmente mascarado. O token opaco fica no link, nunca como senha; a troca de
senha encerra as sessões anteriores.

**Tentativa de entrega transacional do Portal**
Registro de uma tentativa de email com chave de idempotência, eventos de envio,
entrega, bounce ou complaint e retries apenas para falhas transitórias. Após
três tentativas transitórias sem sucesso, a situação vira Falha no envio e
exige reenvio manual.

**Email suprimido do Portal**
Endereço marcado como indisponível após bounce permanente ou complaint. Não
recebe novos retries ou reenvios até a equipe informar/validar outro endereço;
o histórico permanece para auditoria e todos os CNPJs relacionados são
alertados.

**Template transacional do Portal**
Cada mensagem possui versão HTML responsiva e texto puro equivalente, sem pixel
de abertura ou rastreamento de clique.

**Webhook de entrega do Portal**
Evento do Resend aceito somente com assinatura válida e dentro da janela de
tempo. O evento é persistido numa inbox durável, deduplicado pelo ID do
provedor e processado por consumidor posterior. Receber o webhook não significa
que o histórico já foi atualizado; retries preservam a idempotência.

**Teste de assinatura e replay de webhook**
Gate do piloto que envia webhook com assinatura inválida, fora da janela de
tempo e repetido. Assinatura inválida e timestamp fora da janela devem ser
rejeitados. Uma repetição válida pode receber sucesso como no-op (ou permanecer
pendente de processamento), sem duplicar efeitos de entrega, bounce ou complaint.

**Alerta interno do Portal**
Pendência exibida somente no Console e na central `/alertas` para a equipe
interna. Alertas críticos também geram email imediato para usuários ativos de
Documentação e Administrativo; o resumo diário é enviado às 08:00 quando há
pendências ou atividade relevante. Financeiro consulta no sistema e Operações
não recebe pendências do Portal.

**Visualização global interna**
A leitura interna é ampla, inclusive para dados financeiros e de tarifação,
mas não equivale a acesso irrestrito. Toda a árvore `/admin` é administrativa;
`/clientes/comunicacao` exige permissão específica. Ações também possuem
fronteiras próprias, conforme **Escrita interna global**. Consulte a matriz
vigente em `src/hooks/useAuth.tsx`, os guards e a autorização do servidor.

**Departamento**
Assinatura de responsabilidade de um usuário interno (Administrativo,
Financeiro, Operações, Documentação, Equipamentos). Identifica o autor no
registro de eventos e define quem assina cada seção do ADR de Saída. O sistema
também usa o papel associado para autorizar operações específicas; Departamento
não significa acesso irrestrito. Na comunicação de negócio, prefira o nome do
Departamento; preserve `role` e os demais identificadores ao explicar o código.

**Escrita interna global**
A escrita operacional é compartilhada, com exceções aplicadas por operação:

| Operação | Departamentos autorizados |
|---|---|
| Administração de usuários e painel administrativo | Administrativo |
| Provisionamento do Portal | Administrativo e Documentação |
| Liquidação de ajustes financeiros | Administrativo e Financeiro |
| Comunicados e edição interna das Caixas de Comunicação | Administrativo, Documentação e Equipamentos |
| Alterar a chave global de envio de Comunicados | Administrativo |
| Resposta e reabertura de disputa de Demurrage | Equipamentos e Administrativo |
| Exclusão operacional protegida | Administrativo, conforme a fronteira da operação; a declaração de exportação de uma escala sem vínculo pode ser removida por qualquer Departamento ativo (migration `080`) |

Essa tabela resume as exceções; não substitui as validações de estado e de
escopo das RPCs. Assinaturas do ADR também respeitam o departamento dono.

**Rastro obrigatório**
Toda escrita registra autor e Departamento no instante do evento. O
Departamento é gravado junto com o evento, nunca derivado do cadastro atual.
Ações automáticas assinam `sistema`.


**Usuário interno ativo**
Identidade Auth com perfil interno ativo e papel reconhecido. Quantidades e
identidades de usuários são dados do ambiente, não invariantes deste glossário.
Uma identidade Auth sem perfil ativo não possui acesso interno.

**Administrador ativo mínimo**
O sistema deve manter pelo menos um Administrador ativo. Não é permitido
desativar ou rebaixar o último Administrador, e alterações de perfil/status
exigem confirmação, motivo e auditoria.

**Dupla proteção RBAC**
A interface usa `can(permission)` para orientar exceções de navegação, mas a
autoridade real está em RLS, RPCs e Edge Functions; o rastro obrigatório
responsabiliza as operações auditadas e as permissões precisam ser verificadas
também por chamadas diretas à API.

O lado do frontend que lê essa recusa é `classifyDbError` em
`src/lib/errors.ts`: uma tabela de códigos Postgres/PostgREST para `kind` e
mensagem em português. É o classificador compartilhado; os consumidores devem
evitar expor `details`, `hint` ou dados sensíveis do erro bruto na interface.

**Teste de isolamento por CNPJ**
Gate de segurança do piloto que tenta acessar e alterar, por chamadas diretas à
API, dados de outro Cliente/CNPJ. A interface ocultar a ação não é suficiente:
RLS, RPCs e Edge Functions devem negar o acesso; qualquer falha bloqueia a
aprovação do piloto.

**Desacoplamento financeiro do Portal**
O desacoplamento é explícito e por Cliente: a **Liberação de faturamento sem
Portal** (ADR 0070). Não existe mais exceção automática. De 2026-09 até a
migration `083`, a transição do CE emitia sem Portal num contexto privado da
`051`; essa exceção foi retirada, e o contexto privado da `051` não muda mais
nenhum gate. Contato com e-mail não é condição de faturamento, com ou sem
Portal (migration `085`, que desfez a exigência da `084`).

Quando uma fatura é emitida sem Email de Recuperação ou sem Portal ativo (por
exemplo, emitida antes da `083`), a pendência é crítica, permanece aberta e
entra no resumo diário interno. Emitida com a Liberação vigente, ela não abre
essa exceção: a Liberação é a decisão registrada.

A exceção crítica da fatura fica vinculada àquela fatura e encerra-se quando ela
deixa de estar aberta, por exemplo após pagamento, cancelamento, substituição ou
obsolescência. Isso não encerra automaticamente a pendência geral do Cliente
sem Portal ativo.

A pendência geral só é encerrada quando a Conta de Portal fica ativa após o
cliente definir a senha ou quando a equipe registra a exceção formal
Provisionamento não necessário no momento, sempre com justificativa. Convite
enviado ou entregue continua como Ativação pendente; expiração, bounce e
complaint permanecem críticos.

O encerramento automático de uma exceção crítica não envia email unitário de
resolução. O Console e `/alertas` são atualizados, e o encerramento entra como
atividade no próximo resumo diário das 08:00.

O alerta crítico de fatura é disparado uma única vez na transição da fatura para
Emitida, com deduplicação por fatura e evento. Alterações posteriores na mesma
fatura não repetem o email; uma nova fatura do mesmo Cliente gera novo evento.

**Exceção crítica da fatura**
Alerta vinculado a uma fatura emitida enquanto faltava Email de Recuperação ou
Conta de Portal ativa. Permanece aberto enquanto a fatura estiver aberta e é
encerrado quando ela é paga, cancelada, substituída ou se torna obsoleta, sem
resolver a prontidão geral do Cliente.

**Pendência geral de prontidão do Portal**
Indica que o Cliente continua sem Conta de Portal ativa, independentemente do
estado de uma fatura específica. Persiste até a ativação da Conta de Portal ou
o registro justificado de Provisionamento não necessário no momento.

**Área administrativa**
Rota e menu `/admin` são exclusivos do perfil Administrativo, incluindo
Usuários, logs, métricas e todas as subabas. Nenhum outro perfil visualiza sua
entrada.

**Aguardando análise**
Estado do Cliente que ainda não foi aprovado pela equipe para receber convite.
O tamanho da base inicial é histórico, não uma quantidade atual. Nenhum envio ocorre
automaticamente; Documentação ou Administrativo deve revisar o Cliente, indicar
ou informar o Email de Recuperação e executar o convite individualmente.

**Backfill inicial do Portal**
Operação de implantação que cria registros de Portal para Clientes elegíveis em
Aguardando análise, sem selecionar emails candidatos, criar Conta de Portal,
criar identidade Auth ou disparar qualquer email. A contagem de identidades Auth
é revalidada imediatamente antes da execução; o inventário histórico não é uma
premissa operacional. Antes da escrita, um pré-voo somente leitura apresenta os
totais encontrados de Clientes, registros de Portal, vínculos Auth e emails
selecionados; divergência cancela a execução até confirmação do Administrador.

**Convite expirado**
Estado de um convite cujo prazo terminou sem ativação. Exige alerta para a
Documentação e ação manual para novo envio.

**Conta de Portal ativa**
Estado em que o cliente já definiu sua senha e pode autenticar com o CNPJ.

**Provisionamento não necessário no momento**
Exceção registrada pela equipe para um Cliente que não precisa de acesso agora.
Novo processo ou cobrança devolve o Cliente para Aguardando análise.

**Sessão do Portal**
Sessão do Supabase Auth isolada da sessão do aplicativo interno no mesmo
navegador.

**Login do Portal**
Autenticação por CNPJ e senha. O CNPJ é normalizado antes da resolução e a
identidade interna é tratada fora da interface do cliente. Não utiliza senha
própria em tabela nem sessão por token legado.

**Dashboard do Portal**
Página inicial com resumo financeiro, indicadores operacionais, programação de
navios e alertas.

**Disputa de Demurrage**
Contestação do cliente sobre valores, dias ou condições de uma cobrança de
demurrage. Equipamentos é o dono da disputa e do seu Alerta; o Administrativo
também responde e reabre, como cobertura, e o Portal mostra quem respondeu.

**Notificação In-App do Portal**
Mensagem exibida ao cliente no Portal em resposta a eventos financeiros ou
operacionais. Destina-se ao cliente e não à equipe interna; o aviso pessoal
equivalente do sistema interno é a Notificação Interna, com destinatário,
audiência e ciclo próprios.

**Provisionamento do Portal (pré-piloto)**
O acesso operacional entra pelo cabeçalho de Clientes e mantém `/clientes/portal` como console dedicado. O console usa expansão inline, filtro Todos, deep links `?cliente={id}` e exportação XLSX. Candidatos são apenas sugestões e nunca alteram automaticamente o Email de Recuperação.

## Comunicação com o cliente

**Comunicado ao Cliente**
Mensagem de e-mail enviada pela Transhipping ao Email de Contato de um Cliente.
É canal distinto do email transacional do Portal: tem trilha, lista de
supressão e chave de envio próprias, ainda que compartilhe remetente e
identidade visual com ele. Um endereço suprimido por reclamação no Portal
continua recebendo Comunicado, e vice-versa. A exceção é o bounce permanente,
que vale nos dois canais: a caixa não existe, e os dois saem do mesmo
remetente.

**Natureza do Comunicado**
Classificação técnica interna do Comunicado, em quatro valores: Avisos gerais,
Avisos operacionais, Documentação e Demurrage. Não é uma categoria que o Cliente
cadastra ou escolhe no Portal; o Cliente configura Caixas de Comunicação, que
podem reunir mais de uma Natureza e compartilhar o mesmo Comunicado. Cada Modelo
de Comunicado continua mapeado para uma Natureza; o Comunicado livre entra em
Avisos gerais. Seu público pode ser todos os contatos ou uma Caixa de
Comunicação específica.

**Modelo de Comunicado**
Texto pré-definido que um Comunicado usa. Chegada Próxima (NOA), Aviso de Chegada
(NOR), Aviso de Atracação (NOB) e os dois comunicados financeiros são fixos e
versionados no código; o institucional e o livre são escritos pelo usuário interno
no momento do disparo, e o texto de qualquer um dos dois pode ser salvo para reuso
no mesmo acervo de modelos salvos. Todo modelo renderiza por Cliente, com as
variáveis da carga do próprio destinatário.

O modelo determina o Recorte de Destinatários, e não o contrário: só o
institucional dispensa a carga; NOA, NOR, NOB e o livre partem sempre dos B/Ls
filtrados. O livre é, portanto, um texto escrito na hora e endereçado aos clientes
de uma viagem — não uma variante do institucional.

**Chegada Próxima (NOA)**
Comunicado que antecipa a chegada da embarcação. É sempre por Escala e comunica
o **ETA** da Escala (com data e hora opcional), saindo 5 dias antes da previsão
de chegada — não o ATA, que é a chegada já consumada e esvazia a função do aviso.
Uma viagem com vários portos tem vários ETAs e vários avisos. `NOA` (*Notice of Arrival*)
é a denominação de mercado.

**Aviso de Chegada (NOR)**
Comunicado que informa a prontidão e a chegada efetiva da embarcação ao porto
(ou área de fundeio). É sempre por Escala e ancora no **ATA** da Escala, exigindo
data e hora obrigatórias. `NOR` (*Notice of Readiness*) é a denominação de mercado.

O par NOA/NOR divide a palavra *chegada* e a distinção é a do tempo verbal: a
**Chegada Próxima** anuncia uma chegada que ainda vai acontecer (ETA), o **Aviso
de Chegada** comunica a que já aconteceu (ATA). O assunto bilíngue do e-mail
carrega os dois lados — `Notice of Arrival / Chegada Próxima` e `Notice of
Readiness / Aviso de Chegada` —: o lado inglês é o termo de mercado que o
cliente estrangeiro reconhece e não acompanha a renomeação.

**Aviso de Atracação (NOB)**
Comunicado que informa a atracação efetiva da embarcação no terminal portuário
(berço). É sempre por Atracação e ancora no **ATB** da Atracação, exigindo data e
hora obrigatórias. Uma Escala com múltiplos terminais gera um NOB para cada
atracação realizada. `NOB` (*Notice of Berthing*) é a denominação de mercado.

Cada NOB alcança apenas os Clientes cuja carga pertence a uma Frente de Operação
atribuída àquele terminal: quem descarregou no berço vizinho não entra. Sai pela
régua automática assim que o ATB é registrado, dentro da janela operacional de
30 dias do marco, alinhado ao detector de alertas e ao NOR. O envio repetido é
barrado pela idempotência da Atracação. O disparo manual continua sendo o
caminho para os casos que a régua não alcançou. Atracação sem frente atribuída
(Atracação TBC) não comunica por nenhum dos dois caminhos, e o alerta de NOB
pendente permanece aberto durante a sua janela operacional de 30 dias (ADR 0067).

**Disparo de Comunicado**
Operação de enviar um Comunicado a um Recorte de Destinatários. Passa
obrigatoriamente por conferência antes do envio e produz um e-mail por Cliente
— nunca vários Clientes no mesmo destinatário.

**Recorte de Destinatários**
Conjunto de Clientes resolvido pelos filtros do Disparo. O universo é a carga:
parte dos B/Ls filtrados por navio, viagem, POD e POL, com CNPJ restringindo o
resultado. Filtro vazio nunca significa todos os Clientes.

**Vínculo a Caixa de Comunicação**
Relação entre um endereço de contato e uma ou mais Caixas de Comunicação. No
autoatendimento do Portal, o Cliente administra esses vínculos, e a alteração
passa a valer imediatamente. Todo novo contato deve ser criado já com ao menos
uma caixa; o vínculo aplica o conjunto de Comunicados definido para a caixa, sem
seleção individual de Naturezas no Portal. Um contato pode pertencer a várias
caixas. A Ficha do Cliente e a conferência de Comunicados exibem os endereços
agrupados por caixa.

**Histórico de Alterações de Contatos**
Registro append-only, por Cliente, de qualquer ação realizada sobre seus
contatos e vínculos a Caixas de Comunicação (`customer_contact_change_events`).
Uma ação agrupa as mudanças sob um mesmo `action_id` e preserva o estado anterior e
o novo em snapshots completos, o resumo estruturado (`change_summary`), a origem
(`portal`, `interno`, `bl_automatico`, `sistema`), o autor ou conta que realizou a
ação e o momento da alteração. É consultável pela equipe interna na Linha do Tempo
do Cliente e não substitui o histórico operacional dos Comunicados.

**Vínculo do Comunicado**
Ligação entre um Comunicado e os B/Ls que o motivaram. Um Comunicado tem um
Cliente e vários B/Ls. O Comunicado institucional é o único sem vínculo. O
vínculo é o que faz o Comunicado aparecer no Histórico do B/L.

**Cliente Comunicável**
Cliente elegível ao Comunicado institucional: tem ao menos um contato com e-mail
e ao menos um B/L cuja Escala tenha ETA a partir de doze meses atrás — a janela
limita só o passado, e B/L de viagem futura conta. Restringe o alcance do comunicado
que não nasce de um recorte de carga.

**Prontidão de Comunicação de Taxas**
Condição, avaliada por Cliente e Viagem, para o disparo automático do Comunicado
de CE Mercante e Taxas Locais: todos os B/Ls daquele Cliente na viagem têm CE
Mercante preenchido, nenhuma pendência de revisão operacional aberta e faturamento
concluído (`financial_status` em `invoiced` ou `paid`). O atingimento dessa condição
dispara o e-mail automaticamente. Cliente sem prontidão fica bloqueado e visível
na tela de faturamento; os demais clientes da viagem não são segurados por ele.
É condição distinta do gate de revisão do B/L, que deliberadamente não exige CE
Mercante.

**Régua de Cobrança**
Sequência automática de Comunicados de cobrança de uma fatura de Demurrage.
Começa no primeiro faturamento (`first_billed_at`), repete semanalmente a cada
7 dias enquanto a fatura não for paga (`paid_at IS NULL`), e fica pausada
enquanto houver Disputa de Demurrage aberta ou caso o cliente fique sem contatos
válidos (todos suprimidos) — o encerramento da disputa ou regularização cadastral
retoma a contagem. Não possui teto de envios: cobra continuamente até a liquidação.
Cada cobrança da sequência é numerada, e é esse número que distingue uma cobrança da
anterior sobre a mesma fatura.

**Tratamento de Bounce em Cascata**
Mecanismo de contingência disparado quando uma tentativa de envio retorna bounce
permanente. O sistema suprime o endereço e envia um e-mail transacional automático
ao contato principal do cliente informando o erro. Se o próprio contato principal
sofreu o bounce, o aviso é enviado a um contato alternativo cadastrado; não
havendo nenhum contato válido restante, a régua de cobrança pausa e um alerta interno
de severidade alta é gerado para a equipe providenciar a regularização cadastral.

**Chave de envio de Comunicados**
Controle único que habilita ou silencia todo o canal de Comunicado. Nasce
desligada e só é ligada por decisão auditada do Administrativo — os demais
perfis que operam o módulo leem a chave, mas não a alteram. Não afeta o
email transacional do Portal. Desligada, o Disparo continua sendo montado e
conferido, mas é registrado como simulado em vez de enviado.

## Referências de verificação dos contratos

Estas referências permitem conferir as distinções mais sujeitas a regressão;
não substituem a leitura da última definição na cadeia ativa de migrations.

| Contrato | Fonte executável |
|---|---|
| Peso e cubagem de B/L misto | [cargoMode.ts](src/lib/cargoMode.ts) |
| Motivos exibidos na Validação, incluindo Granito | [validacaoPipeline.ts](src/components/billing/validacaoPipeline.ts) |
| CE obrigatório e fronteiras de emissão | [migration 047](supabase/migrations/047_bl_documental_gates.sql) |
| Gate do Portal na emissão automática e Liberação de faturamento sem Portal | [migration 083](supabase/migrations/083_portal_trava_universal_liberacao_faturamento.sql) |
| Permissões por Departamento | [useAuth.tsx](src/hooks/useAuth.tsx) e [rotas internas](src/AppInterno.tsx) |
| Edição interna dos contatos e caixas | [migration 008](supabase/migrations/008_portal_contact_boxes.sql) |
| Calendário do prazo do ADR | [agencyReportDeadline.ts](src/services/agencyReportDeadline.ts) |
| ATD do terminal, ajuste de COD e prontidão do Portal | Funções `reconcile_agency_report_alerts`, `apply_cod_financial_effect` e `customer_portal_access_ready` na [base consolidada](supabase/migrations/002_business_logic_and_security.sql) |
| Inbox e resposta a webhook duplicado | [portal-email-webhook](supabase/functions/portal-email-webhook/index.ts) |
