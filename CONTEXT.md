# Contexto do Sistema

Glossário de domínio do Vela e do Portal Fwlog
([ADR 0082](docs/adr/0082-governanca-documental-dono-unico-e-adr-historica.md)).
Cada verbete traz o termo, uma definição curta, a distinção que evita confusão
com conceitos próximos e o link para a regra. A regra vigente — prazos, ramos,
exceções, efeitos e estado de implementação — fica no módulo dono, listado no
[índice documental](docs/README.md), ou em
[Regras de negócio](docs/operations/regras-de-negocio.md) quando atravessa
módulos. O motivo de cada decisão está no [índice de ADRs](docs/adr/README.md);
procedimentos de execução, no [WORKFLOW.md](WORKFLOW.md).

Use este arquivo como glossário canônico: não invente sinônimos para entidades,
estados ou ações. Quando um verbete diverge do documento dono, vale o dono, e o
verbete é corrigido.

## Como consultar

| Assunto | Seção |
|---|---|
| Excluir, cancelar, desativar e demais ações sobre registros | [Ações sobre registros](#ações-sobre-registros) |
| Viagem, Escala, Atracação, ADR e vazios | [Operação marítima](#operação-marítima) |
| Documento e carga física | [Baplie e reconciliação](#baplie-e-reconciliação) |
| CE, Manifesto Mercante e frete documental | [Mercante](#mercante) |
| Revisão, cadastro e contatos | [Revisão e clientes](#revisão-e-clientes) |
| Taxas Locais, câmbio, Demurrage e PIX | [Faturamento](#faturamento) |
| Histórico do B/L e Auditoria | [Histórico e auditoria](#histórico-e-auditoria) |
| Alertas, Notificações Internas e indicadores | [Alertas e notificações](#alertas-e-notificações) |
| Acesso, provisionamento e permissões | [Portal do Cliente](#portal-do-cliente) |
| Modelos, destinatários e envios | [Comunicação com o cliente](#comunicação-com-o-cliente) |
| Onde conferir os contratos no código | [Referências de verificação dos contratos](#referências-de-verificação-dos-contratos) |
| Corrigir B/L já faturado | [Correção de B/L após faturamento](#correção-de-bl-após-faturamento) |
| Desbloqueio de CE Mercante e Cliente VIP | [Desbloqueio de CE e condição VIP](#desbloqueio-de-ce-e-condição-vip) |
| Central de Informações do Portal e indicação de devolução | [Central de Informações e indicação de devolução](#central-de-informações-e-indicação-de-devolução) |

**Distinções essenciais:** Escala é passagem pelo porto; Atracação é passagem
pelo terminal. B/L é documento; container é unidade física. CE Mercante é do
B/L; Manifesto Mercante agrupa documentos. Taxas Locais e Demurrage têm ciclos
financeiros diferentes. Alerta é pendência compartilhada; Notificação Interna
é aviso pessoal. ADR operacional não é a ADR de arquitetura do repositório.

## Comunicação orientada ao sistema

Ao explicar uma mudança, comece pela linguagem que a pessoa vê no Vela —
página, botão, campo, coluna, estado — e só depois acrescente o detalhe
técnico. O contrato completo está em
[Linguagem do sistema](docs/agents/linguagem-do-sistema.md).

## Ações sobre registros

Vocabulário das ações que tiram um registro de circulação ou desfazem uma ação
anterior. Cada termo tem um único efeito, e o rótulo do botão corresponde a
ele. Quem pode, motivo, confirmação e as divergências de rótulo que ainda
existem nas telas estão em
[Regras de negócio § Ações sobre registros](docs/operations/regras-de-negocio.md#ações-sobre-registros).

**Excluir**
Apagar o registro do banco; irreversível pelo aplicativo. Serve só para erro de
cadastro em registro que ainda não tem vínculo.
- **Distinto de:** Corrigir e Cancelar, que são a saída para o registro que já
  não pode ser excluído; Remover, que não apaga.
→ Regra: [Regras de negócio § Hard delete controlado](docs/operations/regras-de-negocio.md#hard-delete-controlado)

**Corrigir**
Editar os campos de um registro. É o caminho para erro de cadastro em registro
que já tem vínculo; o valor anterior fica só na Auditoria.
→ Regra: [Regras de negócio § Vocabulário e rótulos](docs/operations/regras-de-negocio.md#vocabulário-e-rótulos)

**Cancelar**
Registrar, com motivo, que um fato de negócio deixou de valer: o armador
cancelou a viagem, a fatura foi anulada, uma baixa foi lançada por engano. O
registro permanece e continua visível como cancelado.
- **Distinto de:** correção de erro de cadastro; e do botão **Voltar**, que
  fecha um diálogo sem executar a ação.
→ Regra: [Regras de negócio § Vocabulário e rótulos](docs/operations/regras-de-negocio.md#vocabulário-e-rótulos)

**Reativar**
Desfazer, com motivo e rastro, um cancelamento ou uma desativação; o Histórico
mostra os dois eventos. Documento fiscal cancelado não se reativa: emite-se
outro, que referencia o cancelado.
- **Distinto de:** Reverter, que desfaz uma marcação sobre algo que continua
  ativo.
→ Regra: [Regras de negócio § Vocabulário e rótulos](docs/operations/regras-de-negocio.md#vocabulário-e-rótulos)

**Desativar**
Tirar de uso um cadastro que não será mais escolhido: ele sai das listas de
escolha e continua no histórico e nos documentos que o referenciam. O oposto é
Reativar. "Inativar" não é usado como ação; *Inativo* é o nome do estado
exibido.
→ Regra: [Regras de negócio § Cadastro usado](docs/operations/regras-de-negocio.md#cadastro-usado)

**Remover**
Tirar um item de um lugar ou de um vínculo sem apagá-lo, como a exceção de
terminal de um B/L. O item continua existindo; o oposto é adicioná-lo de novo.
- **Distinto de:** Excluir, que apaga o registro do banco.
→ Regra: [Regras de negócio § Vocabulário e rótulos](docs/operations/regras-de-negocio.md#vocabulário-e-rótulos)

**Revogar**
Retirar uma permissão ou liberação concedida: Liberação de faturamento sem
Portal, convite ("Revogar convite"), sessão. O oposto é conceder de novo.
→ Regra: [Regras de negócio § Confirmação de ação](docs/operations/regras-de-negocio.md#confirmação-de-ação)

**Reverter**
Desfazer, com motivo, uma marcação sobre algo que continua ativo: omissão de
escala, transbordo.
- **Distinto de:** Reativar, que traz de volta algo cancelado ou desativado.
→ Regra: [Viagens § Omissão de Escala, Transbordo e COD](docs/modules/viagens.md#omissão-de-escala-transbordo-e-cod)

**Dispensar**
Parar de ver um aviso; nada muda no dado. Só existe em Alertas e Notificações.
→ Regra: [Operação e Suporte § Leitura, dispensa e Eco de Tratamento](docs/modules/operacao-suporte.md#leitura-dispensa-e-eco-de-tratamento)

**Restituição**
Devolução ao Cliente de valor que ele pagou a maior, com registro próprio
([ADR 0083](docs/adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 1).
- **Evitar:** "estorno" (sinônimo antigo, do vocabulário de 2026-09-24)
- **Distinto de:** Cancelar baixa, que desfaz uma baixa lançada por engano e
  não devolve dinheiro.
→ Regra: [Faturamento § Pagamento, saldo e restituição](docs/modules/faturamento.md#pagamento-saldo-e-restituição);
Demurrage em [Demurrage § Baixa, cancelamento da baixa e restituição](docs/modules/demurrage.md#baixa-cancelamento-da-baixa-e-restituição)

**Cadastro usado**
Cadastro de referência (tarifa, Cliente, Local, serviço do Local) que já
originou cobrança ou vínculo. Não se exclui; só se desativa, para que todo
valor cobrado mantenha a origem.
→ Regra: [Regras de negócio § Cadastro usado](docs/operations/regras-de-negocio.md#cadastro-usado)

**Guarda e recuperação**
Por quanto tempo cada dado fica no banco e como se recupera o que se perdeu:
o usuário interno não se exclui, a auditoria e os eventos do Portal têm prazo
de guarda, e a recuperação vem do backup diário ou da cópia na auditoria.
→ Regra: [Regras de negócio § Guarda e recuperação](docs/operations/regras-de-negocio.md#guarda-e-recuperação)

**Confirmação de ação**
Diálogo que antecede toda ação que grava ou altera dado, envia algo a alguém
ou tira um registro de circulação. Diz o que será feito, em quais registros, a
consequência visível e se dá para desfazer. O botão que fecha sem executar se
chama **Voltar**, para não confundir com a ação Cancelar.
→ Regra: [Regras de negócio § Confirmação de ação](docs/operations/regras-de-negocio.md#confirmação-de-ação)

**Trava de exclusão**
Marco a partir do qual um dado de viagem deixa de ser excluível: o CE
Mercante do B/L. Vazios, que não têm CE, travam com o ADR de Saída fechado.
Depois da trava, o caminho é corrigir ou cancelar, não excluir.
→ Regra: [Regras de negócio § Trava de exclusão](docs/operations/regras-de-negocio.md#trava-de-exclusão)

## Operação marítima

**Viagem**
Unidade principal da operação: um navio identificado por número de viagem e
acompanhado em suas escalas, agendas e cargas.
→ Regra: [Viagens § Status da Viagem e Viagem Cancelada](docs/modules/viagens.md#status-da-viagem-e-viagem-cancelada)

**Viagem Cancelada**
Viagem que não será mais realizada pelo armador, embora tenha sido cadastrada
ou programada. Preserva registros e vínculos e fica somente leitura; pode ser
reativada se o cancelamento foi por engano.
- **Distinto de:** Viagem Concluída (recebeu o último ATD) e exclusão (a
  viagem sai do sistema com o que é dela, antes da Trava de exclusão).
→ Regra: [Viagens § Status da Viagem e Viagem Cancelada](docs/modules/viagens.md#status-da-viagem-e-viagem-cancelada)

**Alias de Nome de Navio**
Prefixo abreviado reconhecido como equivalente ao prefixo canônico do nome do
navio, sem alterar o nome exibido ou cadastrado (ex.: `ZYHY` = `ZHONG YUAN HAI
YUN`; `CS` = `COSCO SHIPPING`).
→ Regra: [Viagens § Identidade do navio](docs/modules/viagens.md#identidade-do-navio)

**Escala portuária**
Passagem de uma viagem por um porto brasileiro, identificada por
`(Viagem, porto)`. É dona da chegada ao porto — ETA e ATA —; as datas de berço
pertencem às suas Atracações. Um porto, uma escala, com importação, exportação
ou as duas.
- **Distinto de:** POL e POD, que são papéis do conhecimento de embarque e da
  rota (`ETD do POL`, POD do B/L, POD omitido), não linhas do planejamento da
  Viagem; portos estrangeiros da rota não são escalas.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**Exportação da Escala**
Declaração explícita do operador de que a escala terá embarque (granito,
containers vazios e movimentos previstos), feita mesmo antes de qualquer
quantidade ser conhecida.
- **Distinto de:** haver número de exportação preenchido, que não declara nada.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**BLs e CEs da Escala**
Status documental por viagem e porto: **Aguardando**, **Recebido**,
**Aprovado**, além de **Lançando** e **Em aprovação**, marcados à mão. É
derivado da cobertura de B/Ls e de CE Mercante, com edição manual justificada.
→ Regra: [Viagens § BLs e CEs da Escala](docs/modules/viagens.md#bls-e-ces-da-escala)

**Próxima Escala**
Escala não omitida, com ETA informado e ainda sem ATA, que tem o menor ETA
entre as escalas pendentes da Viagem. ETA vencido não a tira dessa posição.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**Linha do Tempo da Viagem**
Histórico operacional dos acontecimentos da Viagem, sem eventos financeiros.
- **Distinto de:** Linha do Tempo do ADR, que só mostra os marcos de conclusão
  de um ADR.
→ Regra: [Viagens § Linha do Tempo da Viagem](docs/modules/viagens.md#linha-do-tempo-da-viagem)

**Omissão de Escala**
Evento operacional em que o armador não realiza a escala prevista em um POD; a
carga afetada é descarregada em outro porto da mesma viagem, para seguir em
transbordo ou receber COD. Na programação de navios aparece como `OMIT`.
- **Distinto de:** excluir a escala (POD removido do planejamento) e de `X`
  (data ainda não informada).
→ Regra: [Viagens § Omissão de Escala, Transbordo e COD](docs/modules/viagens.md#omissão-de-escala-transbordo-e-cod)

**Porto de Transbordo**
Porto onde a carga de uma escala omitida é efetivamente descarregada para seguir
em transbordo ou receber COD. Pode ser diferente do POD original do B/L.
→ Regra: [Viagens § Omissão de Escala, Transbordo e COD](docs/modules/viagens.md#omissão-de-escala-transbordo-e-cod)

**Transbordo**
Seguimento da carga em navio de terceiro após a omissão de escala, até o POD
original: o destino final é preservado. Os dados do seguimento (porto, navio,
armador, viagem, ETD e ETA) formam um registro global da omissão, compartilhado
pelos B/Ls afetados; não é uma nova Viagem.
- **Distinto de:** COD, exceção individual por B/L que muda o destino final.
→ Regra: [Viagens § Omissão de Escala, Transbordo e COD](docs/modules/viagens.md#omissão-de-escala-transbordo-e-cod)

**COD (Change of Destination)**
Alteração do destino final do B/L para o Porto de Transbordo após omissão de
escala, marcada deliberadamente pelo operador, com justificativa, B/L a B/L. O
CE Mercante do B/L não muda; o vínculo com o Manifesto Mercante do porto
omitido é limpo. Reprecifica a Taxa Local no novo destino final.
- **Distinto de:** Transbordo (destino preservado, sem reprecificação) e
  correção do POD por reimportação ou pela ficha, que nunca é COD.
- **Ver também:** Ajuste de COD, Taxas Locais, Omissão de Escala, Porto de Transbordo, Manifesto Mercante
→ Regra: [Viagens § Omissão de Escala, Transbordo e COD](docs/modules/viagens.md#omissão-de-escala-transbordo-e-cod) (lado operacional); [Faturamento § Ajuste de COD](docs/modules/faturamento.md#ajuste-de-cod) (reprecificação)

**Ajuste de COD**
Diferença financeira apurada quando um COD reprecifica a Taxa Local de um B/L já
faturado. Antes do faturamento não há ajuste: o B/L é simplesmente recalculado.
- **Ver também:** COD, Taxas Locais, Recebível Local, Invoice Individual
→ Regra: [Faturamento § Ajuste de COD](docs/modules/faturamento.md#ajuste-de-cod)

**Visão Geral do B/L**
Aba padrão da ficha do B/L, que consolida viagem e escalas, transbordo/COD,
carga, cliente, Portal e financeiro, com os trilhos operacional e financeiro e
a próxima ação.
→ Regra: [Manifestos & EDI § `/bls/:blId`](docs/modules/manifesto-edi.md#blsblid)

**Rota da Viagem**
Sequência de portos de uma viagem. Cada escala registra a chegada ao porto
(ETA/ATA) e as Atracações que a compõem; B/Ls e demais documentos de carga
referenciam esses mesmos portos.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**Frente de Operação**
Recorte da escala por sentido e modalidade. A atribuição de terminal liga a
carga à Atracação correspondente; frente sem terminal é **TBC**. Em B/L misto,
carga cheia e carga solta são frentes distintas do mesmo documento, não dois
B/Ls.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**Atracação**
Passagem de uma Escala por um terminal, com ciclo próprio de berço: ETB e ATB
para a atracação, ETD e ATD para a desatracação, além do Restow. Nasce da
atribuição de um terminal a uma Frente de Operação; o mesmo terminal ocorre uma
vez por Escala.
_Evitar_: berço, janela, escala no terminal.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**ATB (Actual Time of Berthing)**
Data e hora efetivas em que a embarcação atracou no terminal da Atracação.
- **Distinto de:** ATA, chegada ao porto, da Escala; e ETB, previsão de
  atracação naquele terminal.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**ATD (Actual Time of Departure)**
Data efetiva, sem hora, em que a embarcação desatracou do terminal da
Atracação. Marca o início da contagem do Prazo de Conclusão do ADR.
- **Distinto de:** ETD, previsão de desatracação; e ATD do POL, registro
  documental da rota.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**Estado da Escala**
Estado derivado das Atracações — `Atracada` ou `Concluída` —, nunca um campo
manual.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**ETD do POL**
Data estimada de saída da viagem no porto de carregamento; permanece como
previsão da rota mesmo depois de conhecida a saída efetiva.
- **Distinto de:** ETD da Atracação: o ETD do POL é registro documental da
  rota, sem vínculo com a Escala nem com a Atracação.
→ Regra: [Viagens § ETD e ATD do POL](docs/modules/viagens.md#etd-e-atd-do-pol-manifesto-mercante-da-rota)

**ATD do POL**
Data efetiva de saída da viagem no porto de carregamento; para container, vem
do `Laden on Board` do B/L.
- **Distinto de:** ATD da Atracação: o ATD do POL é registro documental do
  conhecimento e nunca preenche nem substitui as datas da Escala ou da
  Atracação.
→ Regra: [Viagens § ETD e ATD do POL](docs/modules/viagens.md#etd-e-atd-do-pol-manifesto-mercante-da-rota)

**Programação de Navios (Chegadas e Saídas)**
Quadro com a previsão de datas por porto da rota, exibido ao cliente no Portal e
mantido em Chegadas e Saídas. Não tem cadastro próprio: é a projeção das
Viagens marcadas como visíveis.
- **Distinto de:** **Line-Up (TV)**, painel operacional interno derivado das
  viagens cadastradas.
→ Regra: [Chegadas e Saídas § Programação no Portal](docs/modules/chegadas-saidas.md#programação-no-portal) e [§ Saída da Programação](docs/modules/chegadas-saidas.md#saída-da-programação); Line-Up em [Operação e suporte](docs/modules/operacao-suporte.md#line-up)

**ADR (Agency Departure Report)**
Relatório operacional do navio no porto: uma exibição consolidada do que
aconteceu na escala, com resolução por seção, sign-off por departamento e
fechamento. No modelo terminalizado há um ADR por terminal da escala; o legado
tem um por (viagem, porto). O ADR fechado é a fonte que o Financeiro usa para
aprovar pagamentos de faturas.
- **Ver também:** Seção do ADR, Resolução de Seção, Sign-off Departamental, Fechamento do ADR, Listagem do operado
- **Distinto de:** Architecture Decision Record (`docs/adr/`), que é documento
  de engenharia deste repositório. Em código e schema, usar sempre
  `agency_departure_report`, nunca `adr` solto.
→ Regra: [Viagens § Agency Departure Report (ADR)](docs/modules/viagens.md#agency-departure-report-adr)

**Seção do ADR**
Bloco temático do ADR com um departamento dono e uma resolução própria. São
seis: Escala (Operações); Carga descarregada e Vazios descarregados
(Documentação); Veículos, Carga carregada e Embarque de vazios (Equipamentos).
→ Regra: [Viagens § Seções e donos](docs/modules/viagens.md#seções-e-donos)

**Resolução de Seção**
Estado de uma seção quanto ao seu dono: Pendente → Confirmado ou Nada a
declarar. Ausência de dado não é conclusão.
- **Distinto de:** Sign-off Departamental, que assina o conjunto das seções de
  um departamento.
→ Regra: [Viagens § Resolução de Seção e Observação](docs/modules/viagens.md#resolução-de-seção-e-observação)

**Listagem do operado**
Forma de exibição do ADR (aba e impresso) que lista só as combinações que
realmente ocorreram na escala, sem linhas zeradas.
→ Regra: [Viagens § Conteúdo e listagem do operado](docs/modules/viagens.md#conteúdo-e-listagem-do-operado)

**Sign-off Departamental**
Ato pelo qual Operações, Documentação ou Equipamentos assina, de uma vez, o
conjunto das suas seções do ADR. O fechamento exige os três.
- **Distinto de:** Resolução de Seção, que é por seção.
→ Regra: [Viagens § Sign-off Departamental](docs/modules/viagens.md#sign-off-departamental)

**Equipamentos**
Departamento que responde, no ADR, pelas seções **Veículos**, **Carga
carregada** (hoje com o Granito como conteúdo) e **Embarque de vazios** (VAZIOS
EXP). Vazios descarregados (importação) são da Documentação.
→ Regra: [Viagens § Seções e donos](docs/modules/viagens.md#seções-e-donos)

**Overtime (de escala)**
Movimentação de vazios fora do horário normal, cobrada pelo depot ou pelo
transportador. É declarada como uma Linha de Serviço do Embarque, como qualquer
serviço performado.
- **Distinto de:** acréscimo percentual — a linha não tem percentual, e o valor
  do serviço já é o efetivo.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Embarque de Vazios (EXP)**
Registro operacional do embarque de containers vazios de exportação de uma
Escala, criado por Equipamentos; existe um por escala. Reúne a Lista de
Unidades Embarcadas (o fato) e as Linhas de Serviço do Embarque (o custo); o
grão não é o container.
- **Ver também:** Unidade Embarcada, Linha de Serviço do Embarque, Operação de Pátio
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Unidade Embarcada**
Container vazio efetivamente embarcado na escala; item da Lista de Unidades
Embarcadas, com local de origem (Depot ou Terminal Portuário), condição, datas
de entrada e saída do depot e data de embarque.
- **Distinto de:** Linha de Serviço do Embarque — a unidade é fato importado e
  não carrega preço.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Linha de Serviço do Embarque**
Declaração, lançada à mão, de um serviço efetivamente performado na operação de
vazios: serviço, local, quantidade e valor unitário, e a rota quando é
transporte. Não aponta para containers específicos.
- **Distinto de:** Unidade Embarcada, que é fato operacional importado e não
  carrega preço.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Cadastro de Terminais**
Registro dos locais com que a operação de vazios trabalha — cada local é
um **Depot** ou um **Terminal Portuário** — e dos **valores sugeridos** dos
seus serviços. A entidade é o local; o valor sugerido não é tarifa nem fonte do
cálculo.
- **Evitar:** "Cadastro de Depot" (nome anterior), "Taxas de Vazios", "tabela de
  taxas de depot"
- **Distinto de:** o **porto** da Escala (um Terminal Portuário fica dentro de
  um porto) e a Tabela de Taxas — Granito, que é tabela de tarifas.
- **Ver também:** Free Time de Storage, Embarque Direto, Natureza do Serviço
→ Regra: [Manifestos & EDI § `/embarquevazios/depots`](docs/modules/manifesto-edi.md#embarquevaziosdepots)

**Free Time de Storage**
Dias de armazenagem gratuita que o Depot concede ao container vazio antes de
começar a cobrar; varia por depot e pela condição da unidade (totalmente vazio
ou com material do armador).
- **Distinto de:** Free Time de Demurrage, que se aplica à carga de importação
  do cliente, não ao vazio no depot.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Embarque Direto**
Unidade Embarcada cujo local de origem é um Terminal Portuário: o container
descarregou, ficou no terminal e é reembarcado sem passar por depot. Não gera
armazenagem, mas pode ter serviços lançados como qualquer outra.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Hand-in / Hand-out**
Movimentos de gate do container vazio no depot: hand-in é a entrada e hand-out
a saída, cada um com data por Unidade Embarcada. Os dias de armazenagem vêm
dessas duas datas.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Material do Armador**
Container vazio embarcado com material do armador dentro. É um dos valores da
Condição do Container Vazio, não um campo independente.

**Condição do Container Vazio**
Estado do vazio no embarque: **totalmente vazio** ou **com material do
armador**. Atributo de cada Unidade Embarcada; define qual free time do depot
se aplica e separa as linhas de armazenagem, uma por (depot, condição).
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Natureza do Serviço**
Comportamento de um serviço do Cadastro de Terminais — que pode ser de
armazenagem, de transporte ou geral — e que decide quais campos a Linha de
Serviço exige e se a quantidade é calculada ou digitada. Cada local
tem seu próprio catálogo de serviços, aberto a serviços novos.
- **Sinônimos:** "forma de cobrança" (nome usado pela operação)
- **Distinto de:** Tipo de Cálculo da ADR 0032 (`fixo_por_container` /
  `storage_por_dias` / `quantidade`), que precificava automaticamente e foi
  aposentado pela ADR 0033.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Valor da Linha**
Valor unitário gravado na Linha de Serviço do Embarque: já é o valor efetivo da
cobrança, inclusive para overtime ou majoração. O total da linha é quantidade ×
valor unitário.
- **Distinto de:** valor sugerido do Cadastro de Terminais, que só preenche a
  linha e pode ser sobrescrito.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Operação de Pátio**
Subseção da seção Embarque de vazios do ADR que mostra o custo da operação de
vazios da escala: armazenagem, embarque direto, locais e Linhas de Serviço, com
o total. É exibição derivada do Embarque de Vazios e não tem resolução própria.
- **Distinto de:** Containers embarcados, a outra subseção, que exibe a Lista
  de Unidades Embarcadas.
→ Regra: [Manifestos & EDI § `/embarquevazios`](docs/modules/manifesto-edi.md#embarquevazios)

**Natureza do Vazio Descarregado**
Classificação do container vazio descarregado: **cama** (base de estiva para
cargas OOG) ou **cover plate** (tampas para porões do navio).
→ Regra: [Manifestos & EDI § `/vazios-importacao`](docs/modules/manifesto-edi.md#vazios-importacao)

**Restow**
Container descarregado e reembarcado por reestiva, no berço, com o equipamento
do terminal.
- **Distinto de:** contagem da Escala — o Restow é contado por Atracação, e o
  ADR de cada terminal declara o seu.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**Local de Desova**
Local onde um container com veículo foi desovado. Atributo do container,
agregado por marca no ADR.
→ Regra: [Manifestos & EDI § `/veiculos`](docs/modules/manifesto-edi.md#veiculos)

**Observação da Seção**
Texto livre e opcional de uma seção do ADR, escrito pelo dono da seção, sem
histórico. Substituiu a antiga Ocorrência da Escala (diário do ADR), que não é
mais usada.
- **Distinto de:** Resolução de Seção, que é o dado formal da seção.
→ Regra: [Viagens § Resolução de Seção e Observação](docs/modules/viagens.md#resolução-de-seção-e-observação)

**Fechamento do ADR**
Ato explícito que encerra o ADR depois dos três Sign-offs Departamentais e
congela o snapshot que o Financeiro consulta; mudanças posteriores na origem
não alteram o relatório fechado. O Financeiro não tem ato próprio de aprovação:
o fechamento é o marco. Reabrir pede justificativa.
→ Regra: [Viagens § Fechamento, reabertura e impressão](docs/modules/viagens.md#fechamento-reabertura-e-impressão)

**Linha do Tempo do ADR**
Sequência datada dos marcos de conclusão de um ADR: saída do navio (ATD),
vencimento do Prazo de Conclusão, os três Sign-offs Departamentais com as
reaberturas e o Fechamento. É exibição derivada: nenhum marco nasce nela.
- **Distinto de:** Linha do Tempo da Viagem.
- **Ver também:** Prazo de Conclusão do ADR, Sign-off Departamental, Fechamento do ADR, ATD, Omissão de Escala
→ Regra: [Viagens § Linha do Tempo do ADR](docs/modules/viagens.md#linha-do-tempo-do-adr)

**Prazo de Conclusão do ADR**
Compromisso interno de que cada departamento assina a sua parte do ADR até três
dias úteis depois do ATD da Atracação. É medido por departamento, nunca por
pessoa.
- **Ver também:** Linha do Tempo do ADR, Sign-off Departamental, ATD
- **Distinto de:** o alerta de pendência do ADR, que sinaliza seção não
  resolvida a partir do lançamento do ATD e não conhece data-limite.
→ Regra: [Viagens § Prazo de Conclusão do ADR](docs/modules/viagens.md#prazo-de-conclusão-do-adr) e [§ Alertas do ADR](docs/modules/viagens.md#alertas-do-adr)

**Número de Escala do Mercante**
Identificador criado no sistema federal Mercante para uma Escala (Viagem,
porto). Uma Viagem com várias Escalas brasileiras tem um número por Escala;
Atracações não têm número próprio.
- **Distinto de:** Vínculo de Manifestos à Escala e Nº de Manifesto Mercante.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**Vínculo de Manifestos à Escala**
Confirmação (**Vinculada**) de que os manifestos foram vinculados à escala no
Mercante. Não é sinônimo de o Número de Escala existir.
→ Regra: [Viagens § Escala, Atracação e datas](docs/modules/viagens.md#escala-atracação-e-datas)

**B/L (Bill of Lading / Conhecimento de Embarque)**
Documento de transporte que agrupa carga sob um consignatário. É a unidade
operacional de revisão, cobrança de Taxas Locais e vínculo com Cliente. O
arquivo do B/L é a fonte documental da carga de container, inclusive de Frete &
Despesas do BL, da data de emissão e da data de embarque na origem.
→ Regra: [Manifestos & EDI § Importação do B/L e invariantes gerais](docs/modules/manifesto-edi.md#importação-do-bl-e-invariantes-gerais)

**B/L Cancelado**
B/L com CE Mercante que não vai seguir: a carga não embarcou ou o armador
reemitiu o documento com outro número. Fica somente leitura, sai do faturamento
e libera o CE para o B/L reemitido; pode ser reativado se foi engano.
- **Distinto de:** B/L excluído — B/L sem CE não é cancelado: é excluído.
→ Regra: [Manifestos & EDI § B/L Cancelado e exclusão](docs/modules/manifesto-edi.md#bl-cancelado-e-exclusão)

**Razão Social do Consignatário**
Nome empresarial curto do consignatário, extraído até a natureza jurídica
(inclusive combinações como `LTDA EPP`), exibido em tabelas e usado como
sugestão na reconciliação de Cliente — nunca como vínculo, que só se estabelece
por documento exato.
- **Distinto de:** bloco completo do consignatário, preservado como dado
  documental e para auditoria.
→ Regra: [Manifestos & EDI § `/bls`](docs/modules/manifesto-edi.md#bls)

**Manifesto**
Documento que agrupa B/Ls de uma operação marítima. Para carga de container não
é fonte de ingestão (os dados entram pelos arquivos de B/L); para carga solta,
o Manifesto BB é fonte de ingestão ao lado do B/L avulso, e os dois gravam o
mesmo B/L.
- **Distinto de:** Manifesto Mercante, o número oficial por rota.
→ Regra: [Manifestos & EDI § `/bls`](docs/modules/manifesto-edi.md#bls)

**B/L Avulso**
Conhecimento de embarque recebido como documento individual do armador (.pdf ou
.docx), não consolidado em manifesto. É fonte de ingestão de carga solta: cada
arquivo cria ou atualiza um B/L da Viagem escolhida. Não carrega CE Mercante.
→ Regra: [Manifestos & EDI § `/bls`](docs/modules/manifesto-edi.md#bls)

**CNTR**
Abreviação de domínio para container.

**Carga Solta / Breakbulk (BB)**
Carga transportada sem container, representada por itens, peso e volume
vinculados ao B/L.
→ Regra: [Manifestos & EDI § Modalidade, peso e cubagem do B/L](docs/modules/manifesto-edi.md#modalidade-peso-e-cubagem-do-bl)

**B/L com Carga Mista (Misto)**
B/L unificado (`cargo_mode = 'misto'`) que contém contêineres e carga solta no
mesmo conhecimento. Participa das duas lentes operacionais sem ser contado duas
vezes, e a fatura tem um bloco para cada modalidade.
→ Regra: [Manifestos & EDI § Modalidade, peso e cubagem do B/L](docs/modules/manifesto-edi.md#modalidade-peso-e-cubagem-do-bl)

**Peso do B/L (contêiner x carga solta)**
Peso físico do B/L em duas componentes disjuntas: a da carga conteinerizada (em
kg) e a da carga solta (em t). O peso total é a soma com conversão de unidade,
nunca uma componente isolada.
→ Regra: [Manifestos & EDI § Modalidade, peso e cubagem do B/L](docs/modules/manifesto-edi.md#modalidade-peso-e-cubagem-do-bl)

**Cubagem do B/L (contêiner x carga solta)**
Cubagem do B/L em m³, em duas componentes disjuntas — contêiner e carga solta
—, somadas para o total.
→ Regra: [Manifestos & EDI § Modalidade, peso e cubagem do B/L](docs/modules/manifesto-edi.md#modalidade-peso-e-cubagem-do-bl)

**Painel Unificado de BLs**
Tela `/bls`, que reúne todos os B/Ls da agência, de qualquer modalidade
(`container`, `carga_solta` ou `misto`), e substitui as antigas telas
`/manifestos` e `/carga-solta`.
→ Regra: [Manifestos & EDI § `/bls`](docs/modules/manifesto-edi.md#bls)

**RoRo**
Carga rolante, especialmente veículos importados vinculados a B/L e, quando
aplicável, ao container físico.
→ Regra: [Manifestos & EDI § `/veiculos`](docs/modules/manifesto-edi.md#veiculos)

**Granito**
Carga de exportação: blocos de granito embarcados nas escalas brasileiras.
"Importação", no fluxo de Granito, é a ingestão das planilhas COSCO, não o
sentido da carga. Tem B/Ls, revisão e tarifas próprios; na Validação de Taxas
aparece como **Apoio operacional**, sem emissão de invoice.
- **Distinto de:** B/L de carga — o B/L de Granito é entidade própria, e
  conferir quantidades não é faturar.
→ Regra: [Granito § Fluxos e invariantes](docs/modules/granito.md#fluxos-e-invariantes)

## Baplie e reconciliação

**Baplie EDI**
Arquivo EDIFACT do plano de estiva. É a autoridade da presença física dos
containers, da posição a bordo e das marcas operacionais.
- **Distinto de:** contagem de cheios do ADR, que é documental (vem dos B/Ls).
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

**Staging Baplie**
Estado intermediário dos containers importados do Baplie, por Viagem, antes da
conciliação com os B/Ls; cada importação substitui o staging anterior.
→ Regra: [Manifestos & EDI § `/baplie`](docs/modules/manifesto-edi.md#baplie)

**Conciliação Baplie × B/L**
Comparação, dentro da mesma Viagem, entre a carga física do Baplie e os dados
documentais dos B/Ls.
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

**Divergência de Existência**
Container presente numa fonte e ausente na outra. Fica visível para o operador e
não altera dados comerciais.
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

**Divergência de Atributo**
Conflito entre o Baplie e o B/L numa característica do mesmo container: o perfil
IMO/OOG corrigido à mão (**IMO/OOG manual diverge**) ou o SOC/COC (**SOC/COC
divergente**). A única resolução é **Vale o B/L**, com motivo.
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

**Estado de Conciliação da Viagem**
Resumo de prontidão dos dados da Viagem:

- **Divergente:** há conflito ainda não resolvido;
- **Pendente:** falta fonte, CE ou etapa de conciliação;
- **Conciliada:** fontes e CEs necessários estão coerentes.

É um sinal operacional, não autorização financeira.
→ Regra: [Viagens § Conciliação, importação rápida e indicadores](docs/modules/viagens.md#conciliação-importação-rápida-e-indicadores)

**Flags Operacionais**
Características físicas da carga, como IMO, classe, número ONU, OOG e status
cheio/vazio. Não incluem consignatário, documento fiscal ou peso de cobrança.
O B/L declara a carga perigosa no nível do conhecimento; o Baplie refina quais
containers são de fato IMO.
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

**IMO**
Classificação de carga perigosa segundo a International Maritime Organization.
- **Distinto de:** carga perigosa em quantidade limitada (LQ), que é carga
  normal.
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

**OOG (Out of Gauge)**
Container com dimensões fora do padrão ISO.
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

**THD por perfil de carga**
THD com valor próprio para cada perfil de carga do container — normal, IMO e
OOG — na tabela de taxas; o container IMO e OOG ao mesmo tempo tem cobrança
própria, derivada do THD normal.
→ Regra: [Taxas Locais § THD de container IMO e OOG](docs/modules/taxas-locais.md#thd-de-container-imo-e-oog)

**SOC / COC**
Propriedade do container: **COC** (carrier owned) é do armador; **SOC** (shipper
owned) é do próprio cliente. O B/L é soberano sobre o Baplie; sem informação em
nenhuma fonte, o container é tratado como COC e aparece como "Não informado".
- **Ver também:** Demurrage e Taxas Locais, onde estão os efeitos do SOC.
→ Regra: [Manifestos & EDI § Baplie: marcas, SOC/COC e divergências](docs/modules/manifesto-edi.md#baplie-marcas-soccoc-e-divergências)

## Mercante

**NCM**
Código da Nomenclatura Comum do Mercosul da mercadoria, campo próprio do B/L;
um B/L pode ter mais de um, e a manifestação no Mercante o exige.
- **Distinto de:** NCM vazio, que significa que ninguém cadastrou e nenhum
  documento declarou — não que a carga não tem NCM; a descrição da carga só
  propõe o código.
→ Regra: [Manifestos & EDI § Importação do B/L e invariantes gerais](docs/modules/manifesto-edi.md#importação-do-bl-e-invariantes-gerais)

**CE Mercante**
Conhecimento Eletrônico registrado por B/L no sistema Mercante, nos sentidos de
importação e exportação. Um número de CE pertence a um só B/L não cancelado,
somando B/Ls de carga e de Granito. Entra pela planilha de CE Mercante e é
corrigido ou removido pela ficha do B/L; cadastrá-lo leva ao cálculo e à
emissão das Taxas Locais, mas não comprova a emissão.
- **Distinto de:** Nº de Manifesto Mercante (da rota) e Desbloqueio de CE.
→ Regra: [Manifestos & EDI § CE Mercante](docs/modules/manifesto-edi.md#ce-mercante); efeito na emissão em [Taxas Locais](docs/modules/taxas-locais.md#fluxos-e-invariantes)

**Manifesto Mercante**
Número oficial do manifesto aduaneiro registrado no Mercante para uma rota
(POL → POD) da Viagem, com natureza **carga** ou **vazio**: 13 caracteres,
letras ou dígitos. Uma rota pode ter vários.
- **Evitar:** "CE Master" (nome descontinuado; sobrevive só em identificadores)
- **Distinto de:** o CE de cada B/L, o Número de Escala do Mercante e o número
  de viagem interna da agência.
→ Regra: [Manifestos & EDI § Manifesto Mercante](docs/modules/manifesto-edi.md#manifesto-mercante)

**Frete & Despesas do BL**
Linhas da seção "Freight & Charges" do B/L: frete marítimo (ex.: OCEAN FREIGHT)
e despesas declaradas pelo armador (ex.: THD), cada uma com valor, moeda e
indicador prepaid/collect. É dado documental declarado pelo armador e exibido
na ficha do B/L.
- **Distinto de:** Taxas Locais — a cobrança do desk ao Cliente (Recebível
  Local / invoice). Os dois não se alimentam.
→ Regra: [Manifestos & EDI § Estado e dados](docs/modules/manifesto-edi.md#estado-e-dados)

## Revisão e clientes

**Revisão Operacional**
Etapa humana, na tela Revisão, para resolver o vínculo de Cliente, o peso da
carga solta e correções documentais que impedem o faturamento. Não resolve CE
Mercante nem bloqueio de cálculo: esses ficam na ficha do B/L, na planilha de
CE e na Validação de Taxas Locais.
→ Regra: [Operação e suporte § `/revisao`](docs/modules/operacao-suporte.md#revisao)

**Reconciliação de Cliente**
Vínculo confirmado entre o consignatário importado (B/L ou Granito) e o
cadastro de Cliente. Só o CNPJ exato vincula sozinho; nome, nome canônico ou
similaridade produzem apenas Cliente sugerido, que uma pessoa confirma na
Revisão. Sugestão não é vínculo e não libera faturamento.
→ Regra: [Clientes § Reconciliação de cliente em B/L e Granito](docs/modules/clientes.md#reconciliação-de-cliente-em-bl-e-granito)

**Troca de Consignatário**
Correção do consignatário de um B/L já gravado, feita reimportando o arquivo
do armador, com aceite explícito na prévia. Nasce de erro de lançamento e pode
acontecer depois do CE Mercante (que permanece o mesmo) e da fatura emitida:
o B/L muda de Cliente. Não confundir com a Reconciliação de Cliente, que dá o
primeiro vínculo a um B/L ainda sem Cliente.
→ Regra: [Manifestos & EDI § Importação do B/L e invariantes gerais](docs/modules/manifesto-edi.md#importação-do-bl-e-invariantes-gerais); efeito na fatura em [Faturamento § Troca de Cliente após emissão](docs/modules/faturamento.md#troca-de-cliente-após-emissão-regra-de-cnpj)

**Cliente**
Pessoa jurídica, identificada pelo CNPJ (numérico ou alfanumérico), responsável
por cargas e cobranças no sistema. Não existe Cliente pessoa física.
→ Regra: [Clientes § Identidade e rota do Cliente](docs/modules/clientes.md#identidade-e-rota-do-cliente)

**Email de Contato**
Endereço de e-mail de um contato do Cliente, canal dos Comunicados. Cada
Cliente tem um único contato principal ativo e pode ter contatos adicionais.
Não confundir com o Email de Recuperação do Portal: os dois podem coincidir,
mas não se sincronizam.
→ Regra: [Clientes § Contatos e Caixas de Comunicação](docs/modules/clientes.md#contatos-e-caixas-de-comunicação)

**Caixa de Comunicação**
Agrupador de roteamento ao qual um Email de Contato é vinculado: Documentação
e Operação, Financeiro e Demurrage. Cada caixa reúne um pacote fixo de modelos
de Comunicado, e as caixas não são exclusivas. O Cliente escolhe caixas, não
Naturezas.
→ Regra: [Clientes § Contatos e Caixas de Comunicação](docs/modules/clientes.md#contatos-e-caixas-de-comunicação)

**E-mail Capturado do B/L**
Endereço do consignatário lido no documento do B/L e incorporado ao cadastro do
Cliente cujo CNPJ é o do documento. Não reativa contato desativado nem altera
caixas de endereço já cadastrado; quem reativa é a importação da Base de
Clientes.
→ Regra: [Clientes § E-mail capturado do B/L](docs/modules/clientes.md#e-mail-capturado-do-bl)

**Ficha do Cliente**
Ponto de consulta do Cliente em `/clientes/:cnpj`, organizado em abas, com
caminhos para as telas onde cada fluxo existe. Executa na própria ficha só as
ações do Cliente (cadastro, contatos, Portal, Liberação, acordos de Demurrage,
VIP do Desbloqueio de CE).
→ Regra: [Clientes § `/clientes/:cnpj`](docs/modules/clientes.md#clientescnpj)

**Saldo Pendente do Cliente**
Leitura consolidada do que o Cliente tem em aberto em Taxas Locais e Demurrage,
com as duas parcelas. A parcela local inclui Taxas Locais já calculadas ainda
sem fatura emitida; não é conceito contábil novo.
→ Regra: [Clientes § Saldo pendente](docs/modules/clientes.md#saldo-pendente)

## Faturamento

**Fatura Avulsa**
Fatura manual (`invoice_type = 'manual'`) emitida contra um Cliente fora do
cálculo automático de Taxas Locais, com Tipo de cobrança **Item da tabela**
(item manual da tabela do B/L, B/L obrigatório) ou **Outra** (item livre, B/L e
Viagem opcionais). Distinta da fatura de Taxas Locais: não cria recebível nem
entra no ledger local.
→ Regra: [Faturamento § Propósito e escopo](docs/modules/faturamento.md#propósito-e-escopo)

**Taxas Locais**
Cobranças ligadas ao B/L no porto de destino, calculadas por tabelas, itens e
eventuais Condições de Cliente. Distintas do Demurrage, que é cobrança por tempo
de container e tem persistência própria.
→ Regra: [Taxas Locais § Fluxos e invariantes](docs/modules/taxas-locais.md#fluxos-e-invariantes)

**Fato Gerador da Taxa Local**
A emissão do CE Mercante, não a chegada da carga: emitido o CE, a taxa é devida
pelo porto declarado nele. Distinto do cálculo provisório da importação, que
serve só para conferência.
→ Regra: [Taxas Locais § Fato gerador e fases do cálculo](docs/modules/taxas-locais.md#fato-gerador-e-fases-do-cálculo)

- **Ver também:** Omissão de Escala, COD, Data de Referência da Tarifa

**Motivo de Bloqueio de Faturamento**
Categoria fechada que responde por que um B/L ainda não virou fatura: *Sem
cliente vinculado*, *Cálculo incompleto*, *Aguardando CE Mercante* ou *Portal
não provisionado*. Não é status marcado por alguém nem se confunde com
`charge_status`; *Pronto para emitir* é situação resolvida, não bloqueio.
→ Regra: [Faturamento § Motivo de bloqueio de faturamento](docs/modules/faturamento.md#motivo-de-bloqueio-de-faturamento)

**Container compartilhado**
Container dividido entre B/Ls da mesma Viagem e do mesmo Cliente, cobrado de
cada B/L pelo rateio. Container FCL não é dividido entre Clientes diferentes.
→ Regra: [Faturamento § Container compartilhado na emissão](docs/modules/faturamento.md#container-compartilhado-na-emissão);
importação em [Manifestos & EDI](docs/modules/manifesto-edi.md)

**Tabela de Taxas Locais**
Cadastro que define quais taxas locais existem e quanto custam, por POD e
modalidade; é a fonte dos valores padrão. A vigência é informativa: vale a
tabela **ativa** do escopo, e desativar é a única forma de tirá-la do cálculo.
→ Regra: [Taxas Locais § Tabela aplicável, Item de Taxa e Condição de Cliente](docs/modules/taxas-locais.md#tabela-aplicável-item-de-taxa-e-condição-de-cliente)

- **Evitar:** "tabela de preços", "tarifa local"
- **Ver também:** Item de Taxa, Condição de Cliente, Tarifa de Demurrage

**Herança e Exceção de Terminal por B/L**
O B/L herda o terminal da frente de operação da escala; a exceção individual é
gravada no B/L com justificativa. Terminal não escolhe preço: não reprecifica
Taxas Locais.
→ Regra: [Manifestos & EDI](docs/modules/manifesto-edi.md); efeito no preço em
[Taxas Locais § Tabela aplicável, Item de Taxa e Condição de Cliente](docs/modules/taxas-locais.md#tabela-aplicável-item-de-taxa-e-condição-de-cliente)

**Âncora de Taxa Local**
O que determina o preço de um B/L: destino final (POD) e modalidade escolhem as
tabelas; a Data de Referência escolhe a Condição de Cliente, não a tabela.
→ Regra: [Taxas Locais § Tabela aplicável, Item de Taxa e Condição de Cliente](docs/modules/taxas-locais.md#tabela-aplicável-item-de-taxa-e-condição-de-cliente)

**Fatura Adaptativa Modular**
Layout da fatura impressa de Taxas Locais que agrupa os itens em blocos com
subtotal: Carga conteinerizada, Carga solta (breakbulk) e Taxas administrativas
e documentais; B/L misto mostra os dois blocos de carga.
→ Regra: [Faturamento § Documento imprimível](docs/modules/faturamento.md#documento-imprimível)

**Item de Taxa**
Linha da Tabela de Taxas Locais: a taxa, o valor unitário e a base de
incidência (B/L, container, tonelada). **Item automático** é aplicado pelo
sistema a todo B/L elegível; **item manual** só entra quando o usuário o lança.
Os dois tipos não se misturam.
→ Regra: [Taxas Locais § Tabela aplicável, Item de Taxa e Condição de Cliente](docs/modules/taxas-locais.md#tabela-aplicável-item-de-taxa-e-condição-de-cliente)

- **Ver também:** Tabela de Taxas Locais, Lançamento Manual

**Condição de Cliente**
Valor negociado com um Cliente para um Item de Taxa, que substitui o valor da
tabela enquanto vigente, na moeda do item. É acordo comercial, não desconto
pontual; diferente da Tarifa de Demurrage, não admite duas vigências
sobrepostas.
→ Regra: [Taxas Locais § Tabela aplicável, Item de Taxa e Condição de Cliente](docs/modules/taxas-locais.md#tabela-aplicável-item-de-taxa-e-condição-de-cliente)

- **Evitar:** "desconto", "override de cliente"
- **Ver também:** Item de Taxa, Cliente, Tarifa de Demurrage

**Data de Referência da Tarifa**
Data que escolhe qual Condição de Cliente vale para um B/L: ETA da escala do
POD, depois ETA da Viagem, depois hoje. Não escolhe a tabela e não é a ATA nem
a data de importação do B/L.
→ Regra: [Taxas Locais § Data de Referência da Tarifa](docs/modules/taxas-locais.md#data-de-referência-da-tarifa)

- **Ver também:** Tabela de Taxas Locais, Condição de Cliente, Escala

**Movimento (FCL/LCL)**
Declaração do armador, no B/L, de como a carga foi estufada na origem e é
entregue no destino (`CY` = `FCL`, `CFS` = `LCL`), com um lado de origem e um de
destino. Para Taxa Local vale o lado do destino.
→ Regra: [Taxas Locais § Movimento e Isenção de Taxas Locais](docs/modules/taxas-locais.md#movimento-e-isenção-de-taxas-locais)

- **Evitar:** "tipo de carregamento"
- **Ver também:** Isenção de Taxas Locais, Taxas Locais

**Isenção de Taxas Locais**
Dispensa de Taxas Locais para B/L com veículo entregue em LCL no destino.
Exige prova positiva: veículo em FCL ou sem Movimento declarado paga
normalmente.
→ Regra: [Taxas Locais § Movimento e Isenção de Taxas Locais](docs/modules/taxas-locais.md#movimento-e-isenção-de-taxas-locais)

- **Ver também:** Movimento (FCL/LCL), Taxas Locais

**Taxa Local em Dólar**
Item de Taxa cadastrado em USD, convertido em BRL pelo ROE na emissão da fatura
e congelado. Difere do Demurrage, que recalcula o BRL a cada PTAX até o
pagamento.
→ Regra: [Faturamento § Taxa local em dólar](docs/modules/faturamento.md#taxa-local-em-dólar)

- **Ver também:** ROE, Recálculo Diário, Item de Taxa

**Conferência de Cálculo**
Leitura de como o valor de Taxas Locais de um B/L foi obtido (tabela, itens,
base e quantidade). Não recalcula, não aprova e não emite. Para B/L faturado,
mostra o cálculo e avisa quando ele diverge do valor congelado na fatura, que
prevalece.
→ Regra: [Faturamento § Validação](docs/modules/faturamento.md#validação)

- **Ver também:** Taxas Locais, Item de Taxa, Invoice Individual, Invoice Consolidada

**Recebível Local**
Saldo de Taxas Locais de um B/L no ledger. Pode ser ligado a invoice individual
ou consolidada e liquidado por um ou mais pagamentos; não é o documento
apresentado ao Cliente.
→ Regra: [Faturamento § Ownership financeiro](docs/modules/faturamento.md#ownership-financeiro)

**Invoice Individual**
Fatura emitida para as cobranças elegíveis de um B/L, com valores e
identificação congelados na emissão.
→ Regra: [Faturamento § Ownership financeiro](docs/modules/faturamento.md#ownership-financeiro)

**Invoice Consolidada**
Fatura que reúne recebíveis de vários B/Ls do mesmo Cliente. Quando é paga, as
individuais dos mesmos recebíveis ficam Cobertas.
→ Regra: [Faturamento § Ownership financeiro](docs/modules/faturamento.md#ownership-financeiro)

**Ledger Local**
Histórico de recebíveis, vínculos com invoices, liquidações e eventos de ciclo
de vida que é a fonte do saldo de Taxas Locais. Demurrage fica fora dele.
→ Regra: [Faturamento § Ownership financeiro](docs/modules/faturamento.md#ownership-financeiro)

**Demurrage**
Cobrança da sobreestadia de containers: os dias entre a descarga e a devolução
ao pátio que passam do free time. Cobrada em USD por Invoice de Demurrage, fora
do ledger de Taxas Locais. A descarga é a data informada pelo terminal, não a
ATA da Viagem.
→ Regra: [Demurrage § Datas do container e status de Demurrage](docs/modules/demurrage.md#datas-do-container-e-status-de-demurrage)

**Free Time**
Período após a descarga em que o container fica no pátio sem cobrança. Vem do
override do B/L, do Acordo de Demurrage do Cliente ou da Tarifa de Demurrage,
nessa ordem.
- **Ver também:** P1, P2, Free Time Override
→ Regra: [Demurrage § Tarifa, free time, P1 e P2](docs/modules/demurrage.md#tarifa-free-time-p1-e-p2)

**P1 (Período 1)**
Primeira faixa tarifária após o free time: diária em USD dos dias entre o fim
do free time e o fim da faixa P1 do grupo tarifário. Free time além do fim de
P1 deixa P1 com zero dias, e a cobrança começa direto em P2.
- **Evitar:** "taxa P1", "tarifa P1"
- **Ver também:** Free Time, P2
→ Regra: [Demurrage § Tarifa, free time, P1 e P2](docs/modules/demurrage.md#tarifa-free-time-p1-e-p2)

**P2 (Período 2)**
Segunda faixa tarifária, de diária normalmente maior que a de P1. Começa no
dia definido pelo grupo tarifário, mas nunca antes do dia seguinte ao fim do
free time.
- **Evitar:** "taxa P2", "tarifa P2"
- **Ver também:** P1, Free Time
→ Regra: [Demurrage § Tarifa, free time, P1 e P2](docs/modules/demurrage.md#tarifa-free-time-p1-e-p2)

**Free Time Override**
Free time próprio de um B/L, que prevalece sobre o acordo e a tarifa. Move só
o início da cobrança; não desloca as faixas P1/P2. Distinto dos overrides P1/P2
do B/L, que trocam só a diária.
- **Ver também:** Free Time, P1, P2
→ Regra: [Demurrage § Tarifa, free time, P1 e P2](docs/modules/demurrage.md#tarifa-free-time-p1-e-p2)

**ROE (Taxa de Câmbio)**
Taxa USD→BRL: PTAX Venda do BCB × Markup. Em Taxas Locais, congela na emissão;
na Invoice de Demurrage, acompanha a PTAX pelo Recálculo Diário e só congela
no pagamento.
- **Ver também:** PTAX, Markup, Recálculo Diário
→ Regra: [Regras de negócio § Câmbio](docs/operations/regras-de-negocio.md#câmbio-roe--ptax); em Demurrage, [Demurrage § Recálculo diário e congelamento no pagamento](docs/modules/demurrage.md#recálculo-diário-e-congelamento-no-pagamento)

**Markup**
Fator 1,065 aplicado à PTAX para obter o ROE. É o spread fixo cobrado pelo
armador, não uma margem de proteção cambial: essa proteção deixa de existir
quando o valor passa a ser recalculado diariamente.
- **Ver também:** ROE, PTAX
→ Regra: [Regras de negócio § Câmbio](docs/operations/regras-de-negocio.md#câmbio-roe--ptax)

**Recálculo Diário**
Reavaliação do valor em BRL das Invoices de Demurrage emitidas e não pagas com
a PTAX nova; o USD não muda. Cada recálculo deixa uma foto imutável no
histórico da Invoice, e o recálculo para no pagamento, que congela o valor.
- **Ver também:** ROE, PTAX, Markup, Invoice de Demurrage
→ Regra: [Demurrage § Recálculo diário e congelamento no pagamento](docs/modules/demurrage.md#recálculo-diário-e-congelamento-no-pagamento)

**Invoice de Demurrage**
Documento da sobreestadia de um B/L ou do grupo de B/Ls do mesmo Cliente que
divide container na Viagem; cobra cada caixa não-SOC uma vez por Viagem e
Cliente, e o grupo pode ter Invoice complementar. Nasce emitida com o USD
travado; o BRL segue o Recálculo Diário. Distinta da fatura de Taxas Locais.
- **Ver também:** P1, P2, Free Time, ROE, Recálculo Diário
→ Regra: [Demurrage § Emissão da Invoice de Demurrage](docs/modules/demurrage.md#emissão-da-invoice-de-demurrage) e [§ Grupo de Demurrage e cobrança por caixa](docs/modules/demurrage.md#grupo-de-demurrage-e-cobrança-por-caixa)

**Tarifa de Demurrage (Rate)**
Tabela geral do armador, por tipo de container, com free time, faixas P1/P2,
diárias em USD e vigência. É a última fonte da precedência: override do B/L,
depois Acordo de Demurrage do Cliente, depois a Tarifa.
- **Ver também:** P1, P2, Free Time, Free Time Override, Acordo de Demurrage do Cliente
→ Regra: [Demurrage § Tarifa, free time, P1 e P2](docs/modules/demurrage.md#tarifa-free-time-p1-e-p2)

**Acordo de Demurrage do Cliente**
Condições negociadas com um Cliente: free time e, opcionalmente, diárias P1/P2,
válidas para todos os tipos de container na vigência. Vale o acordo vigente na
data de descarga de cada container; o que o acordo não define vem da Tarifa.
- **Ver também:** Demurrage, Free Time, P1, P2, Tarifa de Demurrage (Rate), Free Time Override
→ Regra: [Demurrage § Acordo de Demurrage do Cliente](docs/modules/demurrage.md#acordo-de-demurrage-do-cliente)

**Conciliação PIX**
Tela que acompanha a baixa automática dos Pix cobrados pelo
Itaú, trata o que ficou sem baixa (aba Pendências), mostra o Histórico de
baixas e, como plano B, baixa faturas a partir do extrato bancário. O extrato
liga o Pix à fatura só pelo TXID; o valor confirma a fatura encontrada, não a
procura. Pix sem fatura segura não é baixado: fica para decisão humana.
→ Regra: [Reconciliação PIX § Propósito e escopo](docs/modules/reconciliacao-pix.md#propósito-e-escopo);
casamento em [§ Matching e confirmação pelo extrato](docs/modules/reconciliacao-pix.md#matching-e-confirmação-pelo-extrato)

- **Ver também:** Pix recebido, Baixa, Exceção pendente, TXID

**Cobrança Pix Itaú**
Cobrança dinâmica registrada no Itaú para cada fatura aberta (Taxas Locais,
avulsa ou Invoice de Demurrage), com TXID próprio (`VELA…`) e valor que
acompanha a fatura; o Pix pago é consultado no banco e baixado sozinho.
Enquanto o banco não confirma a cobrança, Vela e Portal mostram "QR em
preparação". Distinta do **QR estático**, montado pelo Vela sem registro no
banco, cujo pagamento só é baixado pelo extrato ou por Registrar pagamento.
→ Regra: [Reconciliação PIX § Cobrança dinâmica Itaú](docs/modules/reconciliacao-pix.md#cobrança-dinâmica-itaú--migration-151)

**TXID**
Identificador que a cobrança Pix carrega e que volta no Pix pago, no extrato e
na consulta do Itaú; é a única chave que liga um Pix a uma fatura. Uma mesma
fatura pode ter mais de um TXID ao longo do tempo (nova apresentação da
cobrança), por isso não se confunde com o número da fatura, mesmo quando o QR
estático usa esse número.
→ Regra: [Reconciliação PIX § Matching e confirmação pelo extrato](docs/modules/reconciliacao-pix.md#matching-e-confirmação-pelo-extrato)

**Pix recebido**
O dinheiro que entrou na conta, lido na consulta do Itaú ou no extrato. Não é
Baixa: só vira baixa quando o TXID leva a uma fatura pagável e o valor confere.
O Pix do Itaú que não deu baixa aparece em **Pix recebidos sem baixa**, na aba
Pendências, até a fatura ficar paga ou alguém marcá-lo como tratado.
→ Regra: [Reconciliação PIX § Monitoramento das cobranças Itaú](docs/modules/reconciliacao-pix.md#monitoramento-das-cobranças-itaú)

**Baixa**
Registro, na fatura, de um pagamento recebido: quita ou reduz o saldo e aparece
no Histórico de baixas. Vem da baixa automática do Itaú, do extrato (plano B)
ou de **Registrar pagamento** no detalhe. Desfazer uma baixa lançada por engano
é **Cancelar baixa**, que não devolve dinheiro ao Cliente.
→ Regra: [Reconciliação PIX § Cancelar baixa](docs/modules/reconciliacao-pix.md#cancelar-baixa);
pagamento no detalhe em [Faturamento § Pagamento, saldo e restituição](docs/modules/faturamento.md#pagamento-saldo-e-restituição)

**Exceção pendente**
Linha do extrato sem baixa segura (Sem documento ou Ambígua), salva já na
leitura até alguém tratar em **Exceções do extrato**, na aba Pendências. Não é
baixa nem recusa definitiva. Distinta do Pix recebido sem baixa, que vem da
consulta do Itaú e não do extrato.
→ Regra: [Reconciliação PIX § Exceções do extrato](docs/modules/reconciliacao-pix.md#exceções-do-extrato)

## Histórico e auditoria

**Histórico (do B/L)**
Linha do tempo completa dos acontecimentos de um B/L: alterações manuais de
campos, mudanças em containers, cálculo e revisão de taxas, emissão e
pagamento de faturas e o que as importações gravaram. É o termo guarda-chuva
que abrange a Auditoria, não um sinônimo dela. O contexto gravado por uma
importação aparece como **Origem**, não como motivo.
→ Regra: [Regras de negócio § Rastro das importações](docs/operations/regras-de-negocio.md#rastro-das-importações);
tela em [Manifestos & EDI § `/bls/:blId`](docs/modules/manifesto-edi.md#blsblid)

**Auditoria**
Subconjunto do Histórico: as alterações deliberadas registradas com
justificativa — quem mudou o quê, de qual valor para qual, e por quê. Toda
auditoria é um evento do Histórico; nem todo evento do Histórico é auditoria.
- **Distinto de:** eventos gerados pelo sistema (emissão de fatura, contexto
  de importação), que não têm justificativa deliberada.
→ Regra: [Regras de negócio § Rastro das importações](docs/operations/regras-de-negocio.md#rastro-das-importações);
guarda em [Regras de negócio § Guarda e recuperação](docs/operations/regras-de-negocio.md#guarda-e-recuperação)

## Alertas e notificações

**Alerta**
Pendência operacional registrada automaticamente pelo sistema e compartilhada
por toda a equipe interna. Existe uma única vez por entidade e permanece aberto
enquanto a condição de origem existir; não há reconhecimento. Responde "o que
ainda precisa ser feito".
- **Distinto de:** Notificação Interna (aviso pessoal sobre o que aconteceu) e
  Indicador Operacional (contagem sem ciclo de vida).
→ Regra: [Operação e Suporte § Ciclo de vida do Alerta](docs/modules/operacao-suporte.md#ciclo-de-vida-do-alerta); alertas do ADR em [Viagens § Alertas do ADR](docs/modules/viagens.md#alertas-do-adr)

**Notificação Interna**
Aviso pessoal entregue no sino a um usuário interno sobre um Evento
Notificável, com estado de leitura próprio de cada destinatário. Responde "o
que aconteceu e eu preciso saber". Um Alerta origina Notificações Internas
para vários destinatários.
- **Distinto de:** Alerta; ler a notificação não trata a pendência.
→ Regra: [Operação e Suporte § Notificação Interna e Regra de Destinatários](docs/modules/operacao-suporte.md#notificação-interna-e-regra-de-destinatários)

**Cópia Congelada**
Propriedade da Notificação Interna: descreve o Evento Notificável como ele
ocorreu, não o estado atual da entidade envolvida. Dispensar ou fechar o Alerta
não apaga nem altera as Notificações Internas já entregues.
→ Regra: [Operação e Suporte § Notificação Interna e Regra de Destinatários](docs/modules/operacao-suporte.md#notificação-interna-e-regra-de-destinatários)

**Evento Notificável**
Acontecimento do sistema que origina Notificações Internas: a abertura ou a
nova ocorrência de um item de Alerta e o Eco de Tratamento.
→ Regra: [Operação e Suporte § Notificação Interna e Regra de Destinatários](docs/modules/operacao-suporte.md#notificação-interna-e-regra-de-destinatários)

**Regra de Destinatários**
Declaração, por tipo de Alerta no catálogo, de quais setores internos recebem
a Notificação Interna (a audiência).
- **Distinto de:** setor responsável, que é o setor do item e agrupa a fila
  `/alertas`.
→ Regra: [Operação e Suporte § Notificação Interna e Regra de Destinatários](docs/modules/operacao-suporte.md#notificação-interna-e-regra-de-destinatários)

**Eco de Tratamento**
Notificação Interna enviada aos demais destinatários quando alguém executa uma
ação manual de tratamento — hoje, a dispensa temporária —, para impedir que
duas pessoas trabalhem a mesma pendência sem saber.
→ Regra: [Operação e Suporte § Leitura, dispensa e Eco de Tratamento](docs/modules/operacao-suporte.md#leitura-dispensa-e-eco-de-tratamento)

**Leitura e Dispensa**
Ações distintas e sem acoplamento. Ler é pessoal, vale apenas para quem leu e
não altera o Alerta. Dispensar é ato coletivo de triagem: tira a pendência da
fila ativa até uma data de revisão, com motivo, mas não resolve a origem nem
libera gate.
→ Regra: [Operação e Suporte § Leitura, dispensa e Eco de Tratamento](docs/modules/operacao-suporte.md#leitura-dispensa-e-eco-de-tratamento)

**Fechamento automático**
Encerramento do Alerta quando a recomputação da condição de origem, no
servidor, confirma que ela foi resolvida.
- **Distinto de:** leitura, reconhecimento (que não existe) e dispensa.
→ Regra: [Operação e Suporte § Ciclo de vida do Alerta](docs/modules/operacao-suporte.md#ciclo-de-vida-do-alerta)

**Indicador Operacional**
Contagem derivada de uma consulta ao estado atual, como containers com
demurrage vencido. Não tem instante de ocorrência nem estado de leitura.
- **Distinto de:** Alerta e Notificação Interna; não entra na entrega pessoal.
→ Regra: [Operação e Suporte § Indicador Operacional](docs/modules/operacao-suporte.md#indicador-operacional)

## Portal do Cliente

**Portal do Cliente**
Aplicação externa (Portal Fwlog) em que o Cliente consulta painel, faturas,
B/Ls e containers, Central de Informações, notificações, disputas e perfil, e
pede o Desbloqueio de CE. Não confundir com a página interna Provisionamento do
Portal nem com o Modo Inspeção, que são do Vela.
→ Regra: [Portal do Cliente § Propósito e escopo](docs/modules/portal-cliente.md#propósito-e-escopo)

**Provisionamento do Portal**
Processo interno de analisar o Cliente, validar o Email de Recuperação, enviar
o Convite do Portal e acompanhar a ativação. Enviar o convite não conclui o
provisionamento: ele só termina quando a Conta de Portal fica Ativa, depois de
a pessoa autorizada definir a senha.
→ Regra: [Portal do Cliente § Console `/clientes/portal`](docs/modules/portal-cliente.md#console-clientesportal)

**Gate de faturamento do Portal**
Condição verificada no banco antes de toda emissão de Taxas Locais, manual ou
automática pelo CE: a Conta de Portal do Cliente está pronta para ele ver a
fatura, ou há Liberação de faturamento sem Portal vigente. Distinto da
prontidão geral do Portal, que é pendência de cadastro do Cliente.
→ Regra: [Regras de negócio § Gate de faturamento](docs/operations/regras-de-negocio.md#gate-de-faturamento);
efeito na emissão em [Faturamento § Propósito e escopo](docs/modules/faturamento.md#propósito-e-escopo)

**Liberação de faturamento sem Portal**
Decisão do Administrativo, por Cliente, com justificativa e data de revisão,
que abre o Gate de faturamento do Portal enquanto o Portal não fica pronto.
Não ativa a conta nem dá acesso ao Cliente.
→ Regra: [Regras de negócio § Gate de faturamento](docs/operations/regras-de-negocio.md#gate-de-faturamento)

**Provisionamento autorizado**
Decisão de provisionamento registrada quando Documentação ou Administrativo
confirma o Email de Recuperação e envia o Convite do Portal; a outra decisão é
Aguardando análise. A decisão da equipe e a situação da conta são dimensões
diferentes: Provisionamento autorizado coexiste com Ativação pendente, Convite
expirado ou Falha no envio.
→ Regra: [Portal do Cliente § Console `/clientes/portal`](docs/modules/portal-cliente.md#console-clientesportal)

**Inspeção do Portal (Modo Inspeção)**
Visão interna e somente leitura do que um Cliente específico vê no Portal, com
o mesmo layout e as mesmas páginas. O usuário interno continua na própria
identidade: não cria sessão de Portal nem executa ações do Cliente.
→ Regra: [Portal do Cliente § Inspeção do Portal](docs/modules/portal-cliente.md#inspeção-do-portal)

**Conta de Portal**
Vínculo entre um Cliente e um usuário técnico do Supabase Auth, criado na
ativação do convite. Cada Cliente tem no máximo um registro de Portal e,
portanto, no máximo uma conta ativa.
→ Regra: [Portal do Cliente § Console `/clientes/portal`](docs/modules/portal-cliente.md#console-clientesportal)

**Identificador de Login do Portal**
Valor digitado no login: somente o CNPJ da empresa, com ou sem máscara. CPF e
email não são identificadores de login do Portal.
→ Regra: [Portal do Cliente § Identidade, convite e recuperação](docs/modules/portal-cliente.md#identidade-convite-e-recuperação)

**Email Técnico do Portal**
Identidade interna, aleatória e invisível que liga o CNPJ ao Supabase Auth.
Não é o Email de Recuperação, não é informado ao Cliente e não é aceito como
login.
→ Regra: [Portal do Cliente § Identidade, convite e recuperação](docs/modules/portal-cliente.md#identidade-convite-e-recuperação)

**Email de Recuperação do Portal**
Endereço que recebe convites e links de recuperação de acesso. É separado da
identidade de login e pode ser compartilhado por mais de um CNPJ; não recebe
Comunicados nem faturas (esses vão aos contatos e Caixas de Comunicação).
→ Regra: [Portal do Cliente § Identidade, convite e recuperação](docs/modules/portal-cliente.md#identidade-convite-e-recuperação)

**Email candidato para o Portal**
Endereço de um contato ativo do Cliente sugerido para análise no painel
Revisão do Portal, com finalidade e origem. Candidato não é email autorizado e
nunca é escolhido automaticamente.
→ Regra: [Portal do Cliente § Identidade, convite e recuperação](docs/modules/portal-cliente.md#identidade-convite-e-recuperação)

**Acesso ao Portal (seção da ficha)**
Seção da aba Cadastro e contatos da ficha do Cliente com o resumo do Portal
(situação, Email de Recuperação, entrega, último evento); **Gerenciar aqui**
abre o painel Revisão do Portal. Antes era chamada "Seção Portal do Cliente da
Ficha".
→ Regra: [Clientes § Anatomia das telas](docs/modules/clientes.md#anatomia-das-telas)

**Convite do Portal**
Link de uso único enviado ao Email de Recuperação para a pessoa autorizada
definir a senha da Conta de Portal. Vale 48 horas; abrir o link não consome o
convite nem ativa a conta.
→ Regra: [Portal do Cliente § Identidade, convite e recuperação](docs/modules/portal-cliente.md#identidade-convite-e-recuperação)

**Ativação pendente**
Situação da conta em que o convite foi aceito pelo provedor e há um link
válido, mas a senha ainda não foi definida. Não significa que o email foi
entregue ou aberto. No armazenamento, o código técnico é `convite_pendente`.
→ Regra: [Portal do Cliente § Provisionamento e ativação do convite](docs/modules/portal-cliente.md#provisionamento-e-ativação-do-convite)

**Token de Convite do Portal**
Valor aleatório e opaco no link do convite ou da recuperação. Não contém CNPJ
nem email, e só o seu hash é guardado.
→ Regra: [Portal do Cliente § Identidade, convite e recuperação](docs/modules/portal-cliente.md#identidade-convite-e-recuperação)

**Segredos privilegiados do Portal**
`service_role` do Supabase e a chave do provedor de e-mail: existem só nas Edge Functions,
nunca no navegador, em logs ou em auditoria.
→ Regra: [Segurança § Outras defesas](docs/operations/seguranca.md#outras-defesas)

**Remetente transacional do Portal**
Identidade "de" e endereço de resposta dos emails de convite, reenvio,
recuperação e troca de email, com a marca Fwlog.
→ Regra: [Serviços externos § MillionSend (envio)](docs/operations/servicos-externos.md#millionsend-envio)

**Email de Convite do Portal**
Mensagem que leva o link de ativação, identifica a empresa e o CNPJ mascarado
e informa a validade de 48 horas. Distinto do Email de Reenvio, que invalida os
links anteriores.
→ Regra: [Portal do Cliente § Email transacional](docs/modules/portal-cliente.md#email-transacional)

**Email de Reenvio do Portal**
Mensagem com um novo link de ativação, que avisa que os anteriores deixaram de
funcionar e reinicia a validade de 48 horas.
→ Regra: [Portal do Cliente § Email transacional](docs/modules/portal-cliente.md#email-transacional)

**Email de Recuperação de Senha do Portal**
Mensagem com link de uso único, válido por 1 hora, para o Cliente definir nova
senha. Não confundir com o Email de Recuperação, que é o endereço.
→ Regra: [Portal do Cliente § Email transacional](docs/modules/portal-cliente.md#email-transacional)

**Tentativa de entrega transacional do Portal**
Registro de um envio de email do Portal com chave de idempotência e os eventos
de envio, entrega, bounce ou complaint. "Aceito pelo provedor" não é
"entregue".
→ Regra: [Portal do Cliente § Email transacional](docs/modules/portal-cliente.md#email-transacional)

**Falha no envio**
Situação da conta quando o envio do convite não foi aceito pelo provedor;
exige revisar o email e reenviar.
→ Regra: [Portal do Cliente § Alertas internos do Portal](docs/modules/portal-cliente.md#alertas-internos-do-portal)

**Email suprimido do Portal**
Endereço na lista de bloqueio de envio após bounce permanente ou complaint.
Não recebe novos envios até a equipe informar outro endereço ou liberar o
atual (**Liberar endereço bloqueado**).
→ Regra: [Portal do Cliente § Alertas internos do Portal](docs/modules/portal-cliente.md#alertas-internos-do-portal)

**Template transacional do Portal**
Modelo de cada email do Portal, com versão HTML e texto puro equivalente.
→ Regra: [Portal do Cliente § Email transacional](docs/modules/portal-cliente.md#email-transacional)

**Webhook de entrega do Portal**
Aviso do provedor de e-mail (MillionSend) sobre entrega, bounce ou complaint, aceito só com assinatura
válida. Receber o webhook não significa que o histórico já foi atualizado: o
evento é processado depois.
→ Regra: [Portal do Cliente § Email transacional](docs/modules/portal-cliente.md#email-transacional)

**Alerta interno do Portal**
Pendência do Portal para a equipe interna, no console, em `/alertas` e no
sino. Não é a Notificação In-App do Portal, que vai ao Cliente.
→ Regra: [Portal do Cliente § Alertas internos do Portal](docs/modules/portal-cliente.md#alertas-internos-do-portal)

**Visualização global interna**
Leitura ampla de todo usuário interno ativo, inclusive de dados financeiros e
de tarifação. Não equivale a acesso irrestrito: algumas telas e dados têm
fronteira própria.
→ Regra: [Segurança § Visualização global interna](docs/operations/seguranca.md#visualização-global-interna)

**Departamento**
Assinatura de responsabilidade de um usuário interno (Administrativo,
Financeiro, Operações, Documentação, Equipamentos). Na comunicação de negócio,
prefira o nome do Departamento; no código ele é o `role`. Departamento não
significa acesso irrestrito.
→ Regra: [Segurança § Roles internas](docs/operations/seguranca.md#roles-internas)

**Escrita interna global**
Regra de que todo Departamento ativo escreve dado interno, com rastro
obrigatório; as exceções são operações com Departamentos autorizados próprios.
→ Regra: [Segurança § Modelo de permissões por perfil](docs/operations/seguranca.md#modelo-de-permissões-por-perfil)

**Rastro obrigatório**
Registro, em toda escrita, do autor e do Departamento no instante do evento;
ações automáticas assinam `sistema`.
→ Regra: [Segurança § Roles internas](docs/operations/seguranca.md#roles-internas)

**Usuário interno ativo**
Identidade do Supabase Auth com perfil interno ativo e papel reconhecido. Uma
identidade Auth sem perfil ativo não tem acesso interno.
→ Regra: [Segurança § Roles internas](docs/operations/seguranca.md#roles-internas)

**Administrativo ativo mínimo**
Regra de manter sempre ao menos um usuário Administrativo ativo: o último não
se rebaixa de setor nem se desativa (correção pendente).
- **Evitar:** "Administrador ativo mínimo" (o papel Administrador não existe mais)
→ Regra: [Operação e Suporte § Administrativo ativo mínimo](docs/modules/operacao-suporte.md#administrativo-ativo-mínimo)

**Dupla proteção RBAC**
A interface esconde ou mostra ações conforme a permissão, mas quem autoriza é
o banco (RLS, RPCs) e as Edge Functions; esconder um botão não protege a
operação.
→ Regra: [Segurança § RLS-first](docs/operations/seguranca.md#rls-first)

**Desacoplamento financeiro do Portal**
Emitir fatura sem o Cliente ter Portal pronto. Hoje só existe de forma
explícita e por Cliente, pela Liberação de faturamento sem Portal; não há
exceção automática.
→ Regra: [Regras de negócio § Gate de faturamento](docs/operations/regras-de-negocio.md#gate-de-faturamento)

**Exceção crítica da fatura**
Alerta vinculado a uma fatura emitida sem Portal ativo nem Liberação vigente.
Fecha quando a fatura deixa de estar aberta, sem resolver a pendência geral de
prontidão do Portal do Cliente.
→ Regra: [Portal do Cliente § Estado e dados](docs/modules/portal-cliente.md#estado-e-dados)

**Pendência geral de prontidão do Portal**
Alerta interno de Cliente com processo ativo cujo Portal não está pronto (conta
ativa com Email de Recuperação utilizável), independentemente de qualquer
fatura. Não confundir com a exceção crítica de fatura, que é vinculada a uma
fatura emitida sem Portal.
→ Regra: [Portal do Cliente § Alertas internos do Portal](docs/modules/portal-cliente.md#alertas-internos-do-portal)

**Área administrativa**
A área `/admin` (Usuários, logs, métricas e demais abas), exclusiva do
Departamento Administrativo; nenhum outro perfil vê a entrada no menu.
→ Regra: [Segurança § Visualização global interna](docs/operations/seguranca.md#visualização-global-interna)

**Aguardando análise**
Decisão de provisionamento do Cliente que a equipe ainda não autorizou para
convite. Nenhum convite sai automaticamente: Documentação ou Administrativo
revisa o Cliente e envia o convite individualmente.
→ Regra: [Portal do Cliente § Console `/clientes/portal`](docs/modules/portal-cliente.md#console-clientesportal)

**Convite expirado**
Situação da conta cujo convite venceu (48 horas) sem ativação; o novo envio é
manual.
→ Regra: [Portal do Cliente § Alertas internos do Portal](docs/modules/portal-cliente.md#alertas-internos-do-portal)

**Conta de Portal ativa**
Situação (Ativa) em que o Cliente já definiu a senha e entra com o CNPJ. Não
confundir com Provisionamento autorizado, que é a decisão da equipe.
→ Regra: [Portal do Cliente § Console `/clientes/portal`](docs/modules/portal-cliente.md#console-clientesportal)

**Sessão do Portal**
Sessão do Supabase Auth do Portal, isolada da sessão do aplicativo interno no
mesmo navegador: sair de uma não derruba a outra.
→ Regra: [Portal do Cliente § Login e escopo da sessão](docs/modules/portal-cliente.md#login-e-escopo-da-sessão)

**Login do Portal**
Entrada por CNPJ e senha; a identidade técnica é resolvida no servidor, fora
da interface do Cliente. Não existe senha própria em tabela nem sessão por
token legado.
→ Regra: [Portal do Cliente § Login e escopo da sessão](docs/modules/portal-cliente.md#login-e-escopo-da-sessão)

**Dashboard do Portal (Painel)**
Página inicial do Portal (`/portal`), com indicadores financeiros e
operacionais, atalho para a Central de Informações e a programação de navios
(Chegadas e Saídas). Não exibe alertas.
→ Regra: [Portal do Cliente § `/portal`](docs/modules/portal-cliente.md#portal)

**Disputa de Demurrage**
Contestação que o Cliente abre no Portal sobre valores, dias ou condições de
uma Invoice de Demurrage. Vira uma conversa: Equipamentos é o dono da Disputa
e do seu Alerta, e o Administrativo responde e reabre como cobertura. Disputa
aberta pausa a Régua de Cobrança.
→ Regra: [Demurrage § Disputa de Demurrage](docs/modules/demurrage.md#disputa-de-demurrage)

**Notificação In-App do Portal**
Mensagem exibida ao Cliente no sino do Portal em resposta a eventos
financeiros ou operacionais. Destina-se ao Cliente, não à equipe interna; o
aviso pessoal equivalente do sistema interno é a Notificação Interna, com
destinatário, audiência e ciclo próprios.
→ Regra: [Portal do Cliente § Notificações e perfil](docs/modules/portal-cliente.md#notificações-e-perfil)

**Página Provisionamento do Portal (`/clientes/portal`)**
Console interno com a fila de análise, convites e situações do Portal por
Cliente, de onde se abre o painel Revisão do Portal. Candidatos de email são
só sugestões e nunca alteram sozinhos o Email de Recuperação.
→ Regra: [Portal do Cliente § Console `/clientes/portal`](docs/modules/portal-cliente.md#console-clientesportal)

## Comunicação com o cliente

**Comunicado ao Cliente**
E-mail que a Transhipping envia aos Emails de Contato de um Cliente. É canal
distinto do e-mail transacional do Portal, com trilha, lista de supressão e
chave de envio próprias: reclamação num canal não suprime o outro, mas o bounce
permanente vale nos dois.
→ Regra: [Clientes § Comunicados ao Cliente](docs/modules/clientes.md#comunicados-ao-cliente)

**Natureza do Comunicado**
Classificação técnica interna do Comunicado: Avisos gerais, Avisos
operacionais, Documentação e Demurrage. O Cliente não escolhe Natureza; escolhe
Caixas de Comunicação.
→ Regra: [Clientes § Comunicados ao Cliente](docs/modules/clientes.md#comunicados-ao-cliente)

**Modelo de Comunicado**
Texto que um Comunicado usa. NOA, NOR, NOB e os comunicados financeiros são
fixos; o institucional e o livre são escritos pelo usuário interno no disparo.
O modelo determina o Recorte de Destinatários: o livre é texto da hora para os
clientes de uma viagem, não uma variante do institucional.
→ Regra: [Clientes § Comunicados ao Cliente](docs/modules/clientes.md#comunicados-ao-cliente)

**Chegada Próxima (NOA)**
Comunicado, por Escala, que antecipa a chegada da embarcação pelo ETA.
`NOA` (*Notice of Arrival*) é a denominação de mercado. Distinção com o NOR:
a Chegada Próxima anuncia a chegada que vai acontecer (ETA); o Aviso de Chegada
comunica a que já aconteceu (ATA).
→ Regra: [Clientes § Régua automática de Comunicados](docs/modules/clientes.md#régua-automática-de-comunicados)

**Aviso de Chegada (NOR)**
Comunicado, por Escala, que informa a chegada efetiva da embarcação ao porto ou
à área de fundeio, ancorado no ATA. `NOR` (*Notice of Readiness*) é a
denominação de mercado e permanece no lado inglês do assunto.
→ Regra: [Clientes § Régua automática de Comunicados](docs/modules/clientes.md#régua-automática-de-comunicados)

**Aviso de Atracação (NOB)**
Comunicado, por Atracação, que informa a atracação efetiva no terminal (berço),
ancorado no ATB. Alcança só os Clientes cuja carga é daquele terminal.
`NOB` (*Notice of Berthing*) é a denominação de mercado.
→ Regra: [Clientes § Régua automática de Comunicados](docs/modules/clientes.md#régua-automática-de-comunicados)

**Disparo de Comunicado**
Envio manual de um Comunicado a um Recorte de Destinatários, sempre depois da
conferência, com um e-mail por Cliente — nunca vários Clientes no mesmo e-mail.
→ Regra: [Clientes § Comunicados ao Cliente](docs/modules/clientes.md#comunicados-ao-cliente)

**Recorte de Destinatários**
Conjunto de Clientes resolvido pelos filtros do Disparo: os B/Ls filtrados por
navio/viagem, POL e POD, com o CNPJ só restringindo. Filtro vazio nunca
significa todos os Clientes; só o institucional dispensa a carga.
→ Regra: [Clientes § Comunicados ao Cliente](docs/modules/clientes.md#comunicados-ao-cliente)

**Vínculo a Caixa de Comunicação**
Relação entre um Email de Contato e uma ou mais Caixas de Comunicação, que
decide quais Comunicados o endereço recebe. Não confundir com o Vínculo do
Comunicado, que liga o Comunicado aos B/Ls.
→ Regra: [Clientes § Contatos e Caixas de Comunicação](docs/modules/clientes.md#contatos-e-caixas-de-comunicação)

**Histórico de Alterações de Contatos**
Registro append-only, por Cliente, de toda ação sobre contatos e vínculos a
caixas, com estado anterior e novo, origem e autor. Não substitui o histórico
dos Comunicados.
→ Regra: [Clientes § Contatos e Caixas de Comunicação](docs/modules/clientes.md#contatos-e-caixas-de-comunicação)

**Vínculo do Comunicado**
Ligação entre um Comunicado e os B/Ls que o motivaram; é o que faz o Comunicado
aparecer no Histórico do B/L. Um Comunicado tem um Cliente e vários B/Ls; o
institucional é o único sem vínculo.
→ Regra: [Clientes § Comunicados ao Cliente](docs/modules/clientes.md#comunicados-ao-cliente)

**Cliente Comunicável**
Cliente elegível ao Comunicado institucional, por ter carga recente ou futura.
Restringe o alcance do único Comunicado que não nasce de um recorte de carga.
→ Regra: [Clientes § Comunicados ao Cliente](docs/modules/clientes.md#comunicados-ao-cliente)

**Prontidão de Comunicação de Taxas**
Condição, por Cliente e Viagem, para o envio automático do Comunicado de CE
Mercante e Taxas Locais. É distinta do gate de revisão do B/L, que não exige CE
Mercante.
→ Regra: [Clientes § Prontidão de Comunicação de Taxas](docs/modules/clientes.md#prontidão-de-comunicação-de-taxas)

**Régua de Cobrança**
Sequência automática de cobranças numeradas de uma Invoice de Demurrage não
paga, no intervalo configurado pelo Administrativo, sem teto. Pausa em Disputa
aberta, sem contato válido ou com a Invoice suspensa. Não confundir com a régua
automática dos avisos operacionais (NOA, NOR, NOB e CE e Taxas).
→ Regra: [Demurrage](docs/modules/demurrage.md); destinatários em [Clientes § Cobrança de Demurrage por caixa](docs/modules/clientes.md#cobrança-de-demurrage-por-caixa)

**Tratamento de Bounce em Cascata**
Reação a um bounce permanente: o endereço é suprimido, as caixas são reparadas,
um contato restante do Cliente é avisado e, sem nenhum contato válido, a equipe
recebe um alerta crítico.
→ Regra: [Clientes § Tratamento de Bounce em Cascata](docs/modules/clientes.md#tratamento-de-bounce-em-cascata)

**Chave de envio de Comunicados**
Controle único que habilita ou silencia o envio real de Comunicados; desligada,
o Disparo é conferido e registrado como simulado. Não confundir com o e-mail
transacional do Portal, que ela não silencia (salvo o aviso de bounce).
→ Regra: [Clientes § Chave de envio de Comunicados](docs/modules/clientes.md#chave-de-envio-de-comunicados)

## Referências de verificação dos contratos

As fontes executáveis para conferir as distinções mais sujeitas a regressão —
peso do B/L misto, motivos da Validação, CE obrigatório, Gate de faturamento do
Portal e Liberação, permissões por Departamento, contatos e caixas, prazo do
ADR, COD, Trava de exclusão, rastro das importações e webhook de e-mail — estão
em [Regras de negócio § Referências de verificação dos contratos](docs/operations/regras-de-negocio.md#referências-de-verificação-dos-contratos).
O caminho de cada tela até o código está em [RASTREABILIDADE.md](docs/RASTREABILIDADE.md).

## Correção de B/L após faturamento

**Correção de B/L após faturamento**
Alteração do B/L (reimportação, Baplie, edição de B/L, containers ou veículos)
que muda o valor faturado ou o Cliente de uma fatura de Taxas Locais já
emitida. A fatura nunca é editada: o sistema reemite, abate ou restitui
sozinho. Erro de preço (tabela ou Condição de Cliente) não é correção.
→ Regra: [Faturamento § Correção após emissão](docs/modules/faturamento.md#correção-após-emissão-adr-0077)

**Reemissão pendente**
Fatura cancelada pela correção do B/L cuja sucessora não pôde ser emitida
(por exemplo, Portal não pronto); o alerta mostra o motivo até a reemissão.
→ Regra: [Faturamento § Correção após emissão](docs/modules/faturamento.md#correção-após-emissão-adr-0077)

**Fatura desatualizada**
Alerta de fatura com pagamento cujo valor ou Cliente não corresponde mais ao
B/L corrigido. Distinto da Reemissão pendente: a fatura paga não é reemitida.
→ Regra: [Faturamento § Correção após emissão](docs/modules/faturamento.md#correção-após-emissão-adr-0077)

**Restituição pendente**
Alerta de dinheiro recebido a devolver ao Cliente, aberto quando a redução
supera o saldo em aberto. Fecha quando a devolução é registrada.
→ Regra: [Faturamento § Correção após emissão](docs/modules/faturamento.md#correção-após-emissão-adr-0077)

## Desbloqueio de CE e condição VIP

**Desbloqueio de CE**
Pedido do Cliente, feito no Portal, para um ou vários B/Ls do mesmo CNPJ com
CE Mercante. Quem desbloqueia o CE é a ZPT, sozinha, quando as quatro colunas da
carga estão marcadas; o Vela controla os requisitos e gera a planilha que
alimenta a ZPT. Não confundir com o CE Mercante em si, que é dado do B/L.
→ Regra: [Desbloqueio de CE § Propósito e escopo](docs/modules/desbloqueio-ce.md#propósito-e-escopo)

**Requisitos do Desbloqueio**
As quatro condições de cada B/L: **Financeiro** (taxas locais liquidadas,
apurado pelo sistema), **Termo de devolução** e **Procuração** (anexados pelo
Cliente e validados pelo desk por solicitação) e **BL de Entrega** (original
recebido, marcado pelo desk). Aprovar documentos não desbloqueia o CE.
→ Regra: [Desbloqueio de CE § Requisitos e condição VIP](docs/modules/desbloqueio-ce.md#requisitos-e-condição-vip)

**Documentação validada**
Situação da solicitação cujos B/Ls têm os quatro requisitos; é o que o Cliente
vê, com a orientação de conferir no Mercante. Não significa CE desbloqueado: o
Cliente nunca vê nada da ZPT.
→ Regra: [Desbloqueio de CE § Conclusão](docs/modules/desbloqueio-ce.md#conclusão)

**Condição VIP**
Condição por CNPJ em que termo e procuração anuais aprovados e vigentes
substituem os anexos de cada pedido, e a solicitação não passa pela análise.
Não dispensa pagamento nem entrega por B/L; o selo VIP sem documentos vigentes
não dispensa nada.
→ Regra: [Desbloqueio de CE § Requisitos e condição VIP](docs/modules/desbloqueio-ce.md#requisitos-e-condição-vip)

**Exportação para a ZPT**
Geração, pelo desk, da planilha dos B/Ls aptos; é o registro do envio à ZPT, não
a prova do desbloqueio.
→ Regra: [Desbloqueio de CE § Envio e conciliação com a ZPT](docs/modules/desbloqueio-ce.md#envio-e-conciliação-com-a-zpt)

**Desbloqueio conferido / Divergente**
Resultado da conciliação do arquivo "Exportar Tela" da ZPT com o que o Vela
exportou: *Desbloqueio conferido* quando a ZPT mostra a carga desbloqueada,
*Divergente* quando foi exportada e continua bloqueada. Só o desk vê.
→ Regra: [Desbloqueio de CE § Envio e conciliação com a ZPT](docs/modules/desbloqueio-ce.md#envio-e-conciliação-com-a-zpt)

**Prazo (SLA) do Desbloqueio**
Prazo do desk para deixar o B/L pronto para a ZPT, contado do envio da
solicitação em dias úteis e cumprido pela exportação. Recomeça quando o Cliente
resolve uma pendência dele.
→ Regra: [Desbloqueio de CE § Prazo (SLA)](docs/modules/desbloqueio-ce.md#prazo-sla)

## Central de Informações e indicação de devolução

**Central de Informações**
Área do Portal (`/portal/informacoes`) com Taxas Locais de importação,
devolução, Demurrage, agentes por porto, atendimento e tracking, mantidos no
Vela, que é a fonte oficial. Planilhas não são referência operacional;
tarifas de exportação e Detention não fazem parte dela.
→ Regra: [Portal do Cliente § Central de Informações](docs/modules/portal-cliente.md#central-de-informações)

**Devolução por porto de descarga**
Regra de devolução do container vazio em qualquer depot ativo e publicado do
porto de descarga. Não existe indicação específica de depot por container
(descontinuada antes da produção), e container SOC não tem devolução.
→ Regra: [Portal do Cliente § Central de Informações](docs/modules/portal-cliente.md#central-de-informações)
