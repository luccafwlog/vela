Os termos que o Vela usa, em ordem alfabética, cada um em poucas palavras e com a seção onde é explicado.

## A

**Acordo de Demurrage**: o free time e as diárias negociados com um Cliente, para os containers dele descarregados dentro da vigência. [9.7](09-containers-e-demurrage.md#97-cadastrar-tarifas-e-acordos-de-demurrage)

**ADR de Saída** (Agency Departure Report): o relatório de saída do navio em cada terminal, conferido e assinado por {{Operações}}, {{Documentação}} e {{Equipamentos}}. Fechado, é o retrato que o {{Financeiro}} consulta. Capítulo 11.

**Alerta**: a pendência que o Vela abre sozinho na fila **Alertas** e que fica lá até a causa sumir ou alguém o resolver com justificativa. O sino só avisa que ele abriu. Capítulo 20.

**Armador**: a companhia de navegação que opera o navio e emite o B/L. A **Nova Viagem** já traz a Cosco Shipping Specialized Carriers (CSSC). [4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)

**ATA, ATB e ATD** (Actual Time of Arrival, Berthing, Departure): a chegada ao porto, a atracação e a saída do terminal, depois que aconteceram. A ATA fica na escala; ATB e ATD, na Atracação. O ATD começa o prazo de 72 horas do ADR de Saída; o **ATD do POL** é a saída do porto de embarque, tirada da data de embarque dos B/Ls. [4.2](04-viagens-escalas.md#42-planejar-as-escalas), [4.3](04-viagens-escalas.md#43-atribuir-os-terminais) e [4.6](04-viagens-escalas.md#46-rotas-e-manifestos)

**Atracação**: a passagem do navio por um terminal da escala, com as datas do berço (ETB, ATB, ETD e ATD). Nasce quando um terminal é escolhido para uma frente de operação. [4.3](04-viagens-escalas.md#43-atribuir-os-terminais)

## B

**B/L** (Bill of Lading, conhecimento de embarque): o documento que agrupa a carga de um consignatário; por ele o Vela vincula o Cliente e calcula as Taxas Locais. [6.2](06-importacao.md#62-importar-os-bls-de-container) e capítulo 7

**B/L cancelado**: o B/L com CE Mercante que não vai seguir, porque a carga não embarcou ou o armador o reemitiu com outro número. Fica no Vela, somente leitura; o B/L sem CE não se cancela, se exclui. [7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)

**Baixa**: o registro, na fatura, de um pagamento recebido. A **Forma da baixa** diz de onde ele veio: **Automática (Itaú)**, **Pelo extrato**, **Manual** ou **Isenção**. Desfazer uma baixa lançada por engano é **Cancelar baixa**, que não devolve dinheiro ao Cliente. Capítulo 24.

**Baplie**: o plano de carga do navio: os containers a bordo, cheios ou vazios, o porto de destino e as marcas (IMO, OOG, SOC ou COC). É a fonte da carga física; o B/L, a documental. [6.7](06-importacao.md#67-importar-o-baplie)

**BB**: veja Carga solta.

**BLs e CEs**: a situação da documentação de uma escala no Mercante, de **Aguardando** a **Aprovado**. [4.2](04-viagens-escalas.md#42-planejar-as-escalas)

## C

**Caixa** (de comunicação): o grupo de contatos do Cliente que recebe um tipo de e-mail: **Documentação e Operação**, **Financeiro** ou **Demurrage**. [13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente) e [16.1](16-emails-e-comunicados.md#161-saber-para-quem-vai-cada-e-mail)

**Carga solta** (BB, breakbulk): a carga que viaja sem container, como máquinas e volumes. A cobrança dela depende do peso. [6.4](06-importacao.md#64-importar-a-carga-solta)

**CE Mercante**: o conhecimento eletrônico de cada B/L no Mercante, com 15 algarismos. É ele que torna a Taxa Local devida: com o CE, sai a fatura e o B/L aparece no Portal. [6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)

**Cliente**: a empresa, pelo CNPJ, que recebe a carga do B/L e paga a fatura. Não existe Cliente pessoa física. Capítulo 13.

**COC** e **SOC**: de quem é o container. COC (carrier owned) é do armador; SOC (shipper owned) é do Cliente, não volta ao armador e não tem Demurrage. Sem a informação, vale COC. [6.7](06-importacao.md#67-importar-o-baplie) e [9.4](09-containers-e-demurrage.md#94-ler-a-situação-de-demurrage)

**COD** (Change of Destination): veja Omissão.

**Comunicado**: o e-mail que o Vela manda ao Cliente: NOA, NOR, NOB, CE e Taxas, Cobrança de Demurrage, livre ou Institucional. Capítulo 16.

**Conciliação**: na Viagem, o sinal **Conciliada**, **Pendente** ou **Divergente** do que falta de documento ([4.5](04-viagens-escalas.md#45-acompanhar-a-viagem)). Não é a **Conciliação PIX** (capítulo 24) nem a da ZPT ([12.7](12-desbloqueio-de-ce.md#127-conciliar-com-a-zpt)).

**Condição de Cliente**: o valor negociado com um Cliente para uma taxa. Enquanto vigente, substitui o valor da tabela de cobrança. [13.7](13-cadastro-do-cliente.md#137-as-faturas-e-as-condições-negociadas) e capítulo 21

**Consignatário**: a empresa que recebe a carga, declarada no B/L. É pelo CNPJ dele que o Vela acha o Cliente. [6.2](06-importacao.md#62-importar-os-bls-de-container)

**Consolidada** (fatura): a fatura que junta B/Ls do mesmo Cliente. Quando ela é paga, as faturas individuais desses B/Ls ficam **Cobertas**. Capítulo 22.

**Correndo**, **A emitir**, **Esperando** e **Travado**: as quatro divisões da aba **Containers** da Demurrage, pela situação da cobrança de cada grupo de B/Ls com Demurrage ainda sem Invoice. [9.5](09-containers-e-demurrage.md#95-acompanhar-a-demurrage-dos-containers)

## D

**Demurrage**: a sobreestadia do container cheio: os dias além do free time entre a descarga e a devolução, cobrados em dólar numa Invoice de Demurrage. Capítulos 9 e 23.

**Depot**: o pátio onde o container vazio espera o embarque. No Vela é um Local, como o terminal, com free time próprio de armazenagem. [10.7](10-veiculos-vazios-granito.md#107-cadastrar-depots-terminais-e-serviços)

**Desbloqueio de CE**: o pedido do Cliente, pelo Portal, para liberar o CE e retirar a carga. Quem desbloqueia é a ZPT; o Vela controla os quatro requisitos de cada B/L. [12.1](12-desbloqueio-de-ce.md#121-entender-o-desbloqueio-de-ce)

**Descarga** e **devolução**: as duas datas de cada container cheio: quando ele sai do navio no terminal e quando o Cliente o entrega vazio de volta ao armador. [9.2](09-containers-e-demurrage.md#92-gravar-a-descarga-e-a-devolução)

**Dispensa da cobrança**: a decisão, com justificativa, de não cobrar a Demurrage de um container. Diferente do desconto, que é da Invoice emitida. [9.11](09-containers-e-demurrage.md#911-dispensar-a-cobrança-de-um-container)

**Disputa**: a contestação de uma Invoice de Demurrage, aberta pelo Cliente no Portal. Enquanto está aberta, a Régua de Cobrança daquela Invoice para. Cada Invoice tem uma conversa só, e a equipe tem 1 dia útil para responder. [9.8](09-containers-e-demurrage.md#98-responder-a-uma-disputa)

## E

**E-mail de recuperação**: o endereço da conta do Portal que recebe o convite, o link de troca de senha e os avisos de segurança. Não é o login e não recebe Comunicados nem faturas. [14.3](14-portal-a-conta.md#143-convidar-o-cliente)

**Equipe**: o grupo a que cada pessoa pertence no Vela: {{Documentação}}, {{Operações}}, {{Equipamentos}}, {{Financeiro}} ou {{Administrativo}}. A equipe decide o que a pessoa pode fazer; na tela, ela aparece como **Setor** ou como departamento. [2.1](02-equipes-e-permissoes.md#21-as-equipes)

**Escala**: a passagem da Viagem por um porto brasileiro. Um porto, uma escala, para descarregar, embarcar ou as duas coisas. Guarda a chegada ao porto (ETA e ATA). Porto estrangeiro não é escala. [4.2](04-viagens-escalas.md#42-planejar-as-escalas)

**ETA, ETB e ETD** (Estimated Time of Arrival, Berthing, Departure): a chegada prevista ao porto e a atracação e a saída previstas no terminal. Do ETA contam os prazos da documentação e o aviso de chegada ao Cliente. O **ETD do POL** é a saída prevista do porto de embarque. [4.2](04-viagens-escalas.md#42-planejar-as-escalas), [4.3](04-viagens-escalas.md#43-atribuir-os-terminais) e [18.2](18-o-que-muda-sozinho.md#182-mudar-a-chegada-prevista-do-navio)

## F

**Fatura**: a cobrança emitida ao Cliente: de Taxas Locais, individual (um B/L) ou consolidada, ou avulsa. O número tem o formato INV-ano-sequência. Capítulo 22.

**FCL** e **LCL**: como a carga é entregue no destino, pelo **Movement To** do B/L: FCL (ou CY), o container inteiro de um consignatário; LCL (ou CFS), a carga de vários no mesmo container. O B/L de container com veículo em LCL fica isento das Taxas Locais. [10.1](10-veiculos-vazios-granito.md#101-importar-os-veículos) e capítulo 21

**Free time**: os dias depois da descarga em que o Cliente fica com o container sem pagar Demurrage; vem da condição do B/L, do acordo do Cliente ou da tarifa do grupo do tipo de container, nessa ordem. O depot tem outro, o da armazenagem. [9.4](09-containers-e-demurrage.md#94-ler-a-situação-de-demurrage) e [10.7](10-veiculos-vazios-granito.md#107-cadastrar-depots-terminais-e-serviços)

**Frente de operação**: o recorte da escala por tipo de carga: carga cheia, carga solta e vazios na importação; Granito e vazios na exportação. Cada frente recebe o seu terminal; o veículo viaja no container e segue a carga cheia. [4.3](04-viagens-escalas.md#43-atribuir-os-terminais)

## G

**Granito**: carga de exportação, blocos de pedra embarcados num porto brasileiro. No Vela ele só é totalizado: o B/L de Granito não tem Cliente, taxa nem fatura. [10.8](10-veiculos-vazios-granito.md#108-importar-o-granito)

**Grupo de tarifa**: os tipos de container que cobram pela mesma tarifa de Demurrage: 20' dry, 40' dry, 20' especial, 40' especial, 20' reefer e 40' reefer. [9.7](09-containers-e-demurrage.md#97-cadastrar-tarifas-e-acordos-de-demurrage)

## I

**IMO**: o **número IMO** do navio, que o identifica ([4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)); e a marca **IMO** do container de carga perigosa, que vem do Baplie e muda as Taxas Locais ([6.7](06-importacao.md#67-importar-o-baplie)).

**Invoice de Demurrage**: a cobrança da Demurrage, em dólar, de um B/L ou dos B/Ls do mesmo Cliente que dividem containers na Viagem; o valor em reais acompanha a PTAX até o pagamento. [9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai) e capítulo 23

**Isento**: o B/L sem Taxas Locais, pelo veículo entregue em LCL ou por isenção à mão, com justificativa. Capítulo 21.

## L

**LCL**: veja FCL e LCL.

**Liberação** (de faturamento sem Portal): a decisão do {{Administrativo}} de faturar um Cliente cujo Portal ainda não está pronto, até uma data de revisão de no máximo 30 dias. [13.8](13-cadastro-do-cliente.md#138-liberar-o-faturamento-sem-portal)

## M

**Manifesto Mercante**: o número oficial do manifesto de uma rota da Viagem (porto de embarque → porto de descarga), com 13 caracteres. [4.6](04-viagens-escalas.md#46-rotas-e-manifestos) e [6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)

**Mercante**: o sistema federal onde a carga é registrada. Dele vêm o CE de cada B/L, o Manifesto de cada rota e o número da escala. [4.2](04-viagens-escalas.md#42-planejar-as-escalas)

**Modo Inspeção** (Espiadinha): ver o Portal de um Cliente como ele vê, sem a senha dele e sem agir por ele. [15.1](15-portal-o-que-o-cliente-ve.md#151-ver-o-portal-como-o-cliente-vê)

**Movement To**: veja FCL e LCL.

## N

**NOA**, **NOR** e **NOB**: os avisos de navio ao Cliente por e-mail: NOA (Chegada Próxima) antes do ETA; NOR (Aviso de Chegada) depois do ATA; NOB (Aviso de Atracação) depois do ATB, só para a carga daquele terminal. [16.1](16-emails-e-comunicados.md#161-saber-para-quem-vai-cada-e-mail) e [19.4](19-rotinas-por-horario.md#194-os-comunicados-automáticos)

## O

**Omissão** (escala omitida): o armador não fez a escala prevista e descarregou a carga daquele porto em outra escala da mesma Viagem, o **Porto de Transbordo**. A escala continua na Viagem, marcada **Omitida**. Dali, a carga segue em **transbordo** (outro navio a leva ao destino original, e a cobrança não muda) ou em **COD** (Change of Destination: o destino do B/L passa a ser o Porto de Transbordo, e a Taxa Local é recalculada). Esse transbordo não é o container "em transbordo" do Baplie. [4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)

**OOG** (Out of Gauge): a carga fora de medida, que não cabe nas dimensões do container padrão. A marca vem do Baplie. [6.7](06-importacao.md#67-importar-o-baplie)

## P

**P1** e **P2**: o 1º e o 2º período da tarifa de Demurrage, depois do free time, cada um com a sua diária em dólar. [9.4](09-containers-e-demurrage.md#94-ler-a-situação-de-demurrage) e [9.7](09-containers-e-demurrage.md#97-cadastrar-tarifas-e-acordos-de-demurrage)

**Part Lot**: o container dividido entre B/Ls da mesma Viagem, quando a carga dele é de mais de um consignatário. O perfil, o COC/SOC, o lacre e as datas do container valem para todos esses B/Ls. [7.3](07-ficha-do-bl.md#73-corrigir-um-container)

**POD** e **POL**: o porto de descarga (Port of Discharge) e o porto de embarque (Port of Loading) do B/L. [4.6](04-viagens-escalas.md#46-rotas-e-manifestos)

**Portal Fwlog** (Portal do Cliente): o sistema do Cliente, com os mesmos dados do Vela: B/Ls, faturas, Pix, Disputa e Desbloqueio de CE. Duas páginas dele, Chegadas e saídas e a Consulta de container, aparecem sem login no site da Fwlog ([17.11](17-suporte-ao-cliente.md#1711-responder-sobre-o-site-da-fwlog)). Capítulos 14 e 15.

**Portal pronto**: a conta do Portal **Ativa**, com o e-mail de recuperação válido e fora da lista de bloqueio. Sem ele, a fatura de Taxas Locais e a Invoice de Demurrage ficam retidas, salvo com a Liberação. [14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)

**Porto de Transbordo**: veja Omissão.

**Preço fixado**: as Taxas Locais de um B/L usam a tabela de cobrança, a Condição de Cliente e o câmbio do dia em que o B/L foi importado. Mudanças posteriores nesses cadastros não o alcançam. [6.2](06-importacao.md#62-importar-os-bls-de-container) e capítulo 21

**PTAX**: a cotação oficial do dólar, que o Vela busca de segunda a sexta, às 14h. É a base do ROE. [19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio) e capítulo 23

## Q

**QR estático**: o QR do Pix que o Vela monta sozinho, com o número da fatura, quando a cobrança pelo Itaú está desligada. O Pix pago nele aparece em **Pix recebidos** como **QR estático do Vela**. [24.1](24-pagamento-e-restituicao.md#241-acompanhar-a-baixa-automática-do-pix)

## R

**Rateio da caixa**: a divisão em partes iguais da Demurrage do container que está em B/Ls de Clientes diferentes na mesma Viagem; com dois Clientes, "1/2 da caixa". [9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)

**Régua de Cobrança**: os e-mails de cobrança que o Vela manda sozinho enquanto a Invoice de Demurrage está em aberto, a cada 7 dias se o {{Administrativo}} não mudou o intervalo. [19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio) e capítulo 23

**Revisão**: a fila dos B/Ls que a importação não deixou prontos para faturar: sem Cliente, sem Portal pronto ou sem o peso da carga solta. Capítulo 8.

**ROE** (Rate of Exchange): o câmbio do Vela, a PTAX vezes 1,065. Nas Taxas Locais fica fixo no dia da importação do B/L; na Demurrage, acompanha a PTAX até o pagamento. Capítulo 23.

## S

**SOC**: veja COC e SOC.

## T

**Tabela de cobrança**: o cadastro das Taxas Locais de um porto de descarga e de um tipo de carga: quais taxas existem e quanto custam. Capítulo 21.

**Taxas Locais**: as cobranças do B/L no porto de destino, calculadas pela tabela de cobrança do POD e do tipo de carga. Ficam devidas com o CE Mercante. Capítulo 21.

**TBC** ("terminal a confirmar"): a frente de operação que ainda não tem terminal. O que ela traz fica fora do ADR de Saída, e nenhum ADR da escala fecha enquanto ela existir. [4.3](04-viagens-escalas.md#43-atribuir-os-terminais)

**Tipo de container**: o código do container como vem no B/L (40HC, 48FR), no cadastro **Tipos de container**; o tipo fora do cadastro, ou desativado, não tem tarifa de Demurrage. [9.10](09-containers-e-demurrage.md#910-cadastrar-um-tipo-de-container)

**Transbordo**: veja Omissão.

## V

**Vazios** (IMP e EXP): os containers vazios que o navio descarrega (Vazios IMP) ou embarca (Vazios EXP) numa escala. Não têm B/L nem Cliente. O Embarque de vazios opera num terminal, o da frente de vazios da exportação da escala. [10.4](10-veiculos-vazios-granito.md#104-cadastrar-os-vazios-de-importação) e [10.5](10-veiculos-vazios-granito.md#105-registrar-o-embarque-de-vazios)

**Viagem**: a passagem de um navio pelos portos brasileiros, identificada pelo navio e pelo número, como COSCO SHIPPING SEREIA 024E. Tudo no Vela se pendura nela. [4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)

**VIP** (condição VIP): o Cliente que manda o termo de devolução e a procuração uma vez por ano, em vez de a cada pedido de Desbloqueio de CE. [12.8](12-desbloqueio-de-ce.md#128-atender-o-cliente-vip)

## Z

**ZPT**: o sistema que desbloqueia o CE Mercante para a retirada da carga quando os quatro requisitos estão marcados nele. O Vela a alimenta com uma planilha e confere depois o que ela fez. [12.6](12-desbloqueio-de-ce.md#126-exportar-os-bls-aptos-para-a-zpt) e [12.7](12-desbloqueio-de-ce.md#127-conciliar-com-a-zpt)
