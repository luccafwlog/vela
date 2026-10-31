Quando alguma coisa precisa de uma pessoa e ninguém pediu, o Vela abre um alerta: um prazo da documentação que chegou, um aviso ao Cliente que não saiu, um Pix que não pôde ser baixado. O alerta fica na fila **Alertas**, à vista de todas as equipes, até a causa deixar de existir; quem precisa saber recebe também uma notificação no sino. O que provoca os alertas, ação por ação e pelo relógio, está nos capítulos [18](18-o-que-muda-sozinho.md) e [19](19-rotinas-por-horario.md).

::: aprende
- ler a fila de Alertas e achar os alertas da sua equipe;
- resolver um alerta e saber quando ele fecha sozinho;
- usar o sino e saber quem recebe cada notificação;
- o que fazer em cada alerta, por assunto.
:::

## 20.1 Ler a fila de Alertas

**Quem faz:** {{Todas as equipes}}

A fila é uma só para todas as equipes: o setor é um filtro, não uma fila separada. Cada alerta tem um setor responsável (**Documentação**, **Equipamentos**, **Operações** ou **Administrativo**) e uma gravidade: **Crítico**, em vermelho, ou **Normal**. O {{Financeiro}} não é setor de alerta: os alertas de dinheiro ficam no setor {{Administrativo}} e chegam ao Financeiro pelo sino ([20.3](#203-acompanhar-o-sino)).

::: passos
1. Abra **Alertas** no menu, ou clique no cartão da sua equipe no **Painel**: a fila abre já no seu setor.
2. Em **Setor**, escolha a sua equipe. O cartão **Críticos** mostra só os críticos; **Ativos** volta à fila toda.
3. Para achar um caso, use **Busca**: número do B/L, navio, Cliente, CNPJ ou um trecho da mensagem. Uma lista colada de números de B/L também funciona.
4. Leia a linha: **Registro** diz onde está a pendência (o B/L e a Viagem abrem a ficha), **Mensagem** dá o detalhe e **Aberto em** diz desde quando.
:::

::: tela alertas-fila
A fila de Alertas, com os críticos no alto.
:::

Os críticos vêm primeiro e, dentro de cada gravidade, os mais recentes.

O botão **Regras de alertas**, no alto da fila, abre a lista de todos os alertas do Vela, com quando cada um abre, quem recebe e como se resolve.

::: atencao
- **Busca**, **Registro** e **Gravidade** filtram só a página carregada. Com mais de 100 alertas, filtre antes por **Setor**, que vale para a fila inteira, ou troque de página.
- A fila não se atualiza sozinha: ela relê ao abrir e depois de cada resolução sua. Para ver o que outra pessoa ou o Vela mudou, abra a página de novo.
:::

## 20.2 Resolver um alerta

**Quem faz:** {{Qualquer equipe}}. Qualquer pessoa ativa resolve qualquer alerta: o setor diz quem é avisado, não quem pode resolver.

Um alerta não se fecha à mão: ele fecha quando a causa deixa de existir. Quase sempre isso acontece sozinho: você corrige o dado e o Vela fecha o alerta na hora da gravação ou, no máximo, na conferência de 15 minutos ([19.2](19-rotinas-por-horario.md#192-os-alertas-que-dependem-do-relógio)). Não existe dispensar nem marcar como visto. Na coluna **Ações**, há três caminhos:

- **Sozinho, quando a causa some** (quase todos): **Resolver** abre a tela da correção. Corrija, e o alerta fecha.
- **Com justificativa** (os marcados assim nas seções deste capítulo): confira o caso, clique em **Resolver**, escreva o que conferiu em **Justificativa (o que foi conferido)** e confirme. Quando há uma tela para conferir, um botão ao lado de **Resolver** leva até ela. A justificativa fica também em **Admin** › **Histórico de ações**, assunto **Alerta**.
- **Reprocessando** (só o **Efeito de importação bloqueado**): corrija a causa e use **Reprocessar** ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação)).

Se a causa volta depois de o alerta fechar, ele reabre e as pessoas são avisadas de novo; **Aberto em** mostra a data da reabertura.

::: atencao
- Corrija antes de justificar. A justificativa não corrige nada: só registra que alguém conferiu.
- Na **Consulta de Pix do Itaú parada** e nos alertas de rotina parada ([20.13](#2013-rotinas-paradas)), a justificativa tira o alerta da fila por 24 horas, mesmo que a causa continue. Justifique só depois de o suporte técnico assumir o caso.
:::

## 20.3 Acompanhar o sino

**Quem faz:** {{Todas as equipes}}

O sino é pessoal: traz as **Notificações internas**, o aviso de que abriu um alerta para a sua equipe. Cada pessoa ativa recebe os alertas do seu setor; o {{Financeiro}} recebe também os de dinheiro, e o {{Administrativo}}, os críticos de contato e de fatura do Cliente. O "Quem recebe" de cada assunto diz quais.

::: passos
1. Clique no sino, na barra do alto. Com o menu na lateral, ele fica no pé do menu, como **Notificações**.
2. Clique numa notificação: ela abre a tela onde a pendência se resolve e fica lida.
3. Para limpar o painel de uma vez, use **Marcar todas como lidas** e confirme. Não há como voltar a "não lida".
:::

A notificação é uma fotografia do momento em que o alerta abriu: ela não muda depois. Quando o alerta fecha, ela sai sozinha do sino, mesmo sem ter sido lida.

Quando um alerta **Crítico** não acha ninguém ativo nos setores que recebem, a notificação vai ao {{Administrativo}} com o selo **Entrega alternativa**; o alerta continua do setor original. Se nem assim há quem receba, ou se o alerta é Normal, a falha aparece em **Admin** › **Falhas de entrega de alertas**: para resolver, ative alguém do setor na aba **Usuários**.

::: atencao
A notificação lida sai do sino e não aparece em nenhuma outra tela. Para rever um alerta, use a fila.
:::

## 20.4 Viagem e datas

**Quem recebe:** {{Operações}}

Estes alertas cobram as datas que o navio já devia ter: a data prevista chegou, pelo dia de Brasília, e a realizada não foi registrada. Eles fecham na hora em que você grava a data.

| Alerta | Quando abre | O que fazer |
|---|---|---|
| **Data da escala pendente** | No dia do ETA, se a escala não tem ATA. Com o ATA, se nenhum terminal da escala tem ETB. | Registre o ATA da escala, ou o ETB no cartão do terminal ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)). |
| **Data de terminal pendente** | Para cada terminal: no dia do ETB sem ATB; com o ATB, enquanto falta o ETD; no dia do ETD sem ATD. | Registre a data cobrada no cartão do terminal ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)). |
| **Exportação pendente pós-ATD** | Com o ATD num terminal de escala que declarou exportação de Granito ou de vazios, enquanto a exportação não foi lançada na Viagem. | Importe o Granito ([10.8](10-veiculos-vazios-granito.md#108-importar-o-granito)) ou inclua as unidades no **Embarque de vazios** ([10.5](10-veiculos-vazios-granito.md#105-registrar-o-embarque-de-vazios)), ou corrija a exportação declarada na escala ([4.2](04-viagens-escalas.md#42-planejar-as-escalas)). |

::: atencao
A exportação é conferida pela Viagem, não pelo porto. Numa Viagem com exportação em dois portos, lançar a de um fecha o alerta do outro: confira os dois antes de dar o caso por encerrado.
:::

## 20.5 Documentação e importação

**Quem recebe:** {{Documentação}}; a Planilha de Veículos, {{Equipamentos}}

Sete dias antes do primeiro ETA no Brasil (D−7), o Vela começa a cobrar a documentação da Viagem; cinco dias antes (D−5), o CE e os veículos. Fora o **Efeito de importação bloqueado**, que pede **Reprocessar**, todos fecham sozinhos quando o dado é corrigido, e B/L cancelado não conta em nenhum deles.

### Os prazos da Viagem

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **B/L esperado pendente** · crítico | No D−7, se falta B/L para algum porto de descarga da Viagem ou para um porto de embarque com saída programada. | {{Documentação}} | Importe os B/Ls que faltam ([6.2](06-importacao.md#62-importar-os-bls-de-container)). |
| **Baplie ausente** · crítico | No D−7, sem Baplie importado. | {{Documentação}} | Importe o Baplie ([6.7](06-importacao.md#67-importar-o-baplie)). |
| **Cobertura Baplie / B/L** · crítico | Quando há container cheio no Baplie sem B/L, ou container de B/L que não está entre os cheios do Baplie. Antes do D−7, só conta nas rotas que já têm B/L. A mensagem diz quantos. | {{Documentação}} | Corrija o B/L ou o Baplie ([6.8](06-importacao.md#68-resolver-as-divergências-entre-baplie-e-bl)). |
| **CE Mercante pendente** · crítico | No D−5, se há B/L ativo sem CE ou rota de vazios sem **Nº de Manifesto Mercante**. | {{Documentação}} | Importe a planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)) e informe o número do manifesto das rotas de vazios em **Rotas e Manifestos** ([4.6](04-viagens-escalas.md#46-rotas-e-manifestos)). |
| **Planilha de Veículos pendente** · crítico | No D−5, se a Viagem tem B/L de container e nenhum veículo importado, nem a declaração **Esta viagem não terá veículos**. | {{Equipamentos}} | Em **Veículos**, importe a planilha ou declare que a Viagem não terá veículos ([10.1](10-veiculos-vazios-granito.md#101-importar-os-veículos)). |

### A importação e a Revisão

| Alerta | Quando abre | O que fazer |
|---|---|---|
| **CE fora do Manifesto da rota** | Um B/L com CE mudou de POL, POD ou Viagem e saiu do Manifesto Mercante. | Inclua o B/L no Manifesto da rota nova ou corrija o CE ([6.6](06-importacao.md#66-corrigir-o-ce-ou-o-manifesto-de-um-bl)). |
| **Efeito de importação bloqueado** · crítico | Um passo que roda logo depois da importação falhou e parou. A mensagem diz o B/L e o motivo; o texto do sistema fica em **Detalhe técnico**. | Corrija a causa e use **Reprocessar** ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação)). |
| **Revisão de B/L — cliente não vinculado** · crítico | Há B/L pendente na Revisão sem Cliente. Um por consignatário. | Vincule o Cliente na Revisão ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)). |
| **Revisão de B/L — peso BB ausente** · crítico | Há B/L de carga solta na Revisão sem o peso. | Informe o peso ([8.4](08-revisao.md#84-informar-o-peso-da-carga-solta)). |
| **Revisão de B/L — Portal não provisionado** · crítico | O Cliente tem B/L parado na Revisão ou fatura retida porque o Portal dele não está pronto e não há Liberação de faturamento. | Leve o Portal a pronto ([14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)) ou peça ao {{Administrativo}} a Liberação ([13.8](13-cadastro-do-cliente.md#138-liberar-o-faturamento-sem-portal)). |
| **B/L sem Cliente perto do ETA** · crítico | Faltam 5 dias ou menos para o ETA do porto (ou ele já passou) e algum B/L desse porto está sem Cliente. Um por escala. | **Resolver** abre a Revisão já nos B/Ls sem Cliente da Viagem. Vincule cada um ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)); o B/L que não segue, peça ao {{Administrativo}} que cancele ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)). |

Quando o B/L sem Cliente fica a 5 dias do ETA, a linha da **Revisão de B/L — cliente não vinculado** ganha na fila o selo **ETA próximo**.

::: atencao
Sem a Planilha de Veículos, o CE emite a fatura cheia do B/L de veículo que seria isento. Não deixe o alerta de veículos para depois do CE.
:::

## 20.6 Cliente e Portal

**Quem recebe:** {{Documentação}}; os quatro críticos de contato e de fatura, também o {{Administrativo}}

Os quatro primeiros alertas da conta só abrem quando o Cliente tem processo ativo (B/L não cancelado e ainda não pago, ou Invoice de Demurrage em aberto) e abrem e fecham sozinhos quando a conta, o e-mail ou os B/Ls mudam.

### A conta do Portal

| Alerta | Quando abre | O que fazer |
|---|---|---|
| **Portal do Cliente — pendência geral** | O Portal não está pronto: sem conta, conta não ativa ou suspensa, sem usuário de acesso ou sem e-mail de recuperação utilizável. A mensagem diz qual. | Siga a **Ação** da linha do Cliente no Provisionamento ([14.1](14-portal-a-conta.md#141-ler-a-fila-do-provisionamento-do-portal)). |
| **Portal do Cliente — convite expirado** | O convite passou de 48 horas sem ativação. | Reenvie o convite ([14.3](14-portal-a-conta.md#143-convidar-o-cliente)). |
| **Portal do Cliente — falha de envio** | O e-mail do convite não saiu. | Confira o e-mail e reenvie o convite ([14.3](14-portal-a-conta.md#143-convidar-o-cliente)). |
| **Portal do Cliente — email suprimido** | O e-mail de recuperação foi bloqueado (devolvido ou marcado como spam). | Troque o e-mail de recuperação ([14.6](14-portal-a-conta.md#146-trocar-o-e-mail-de-recuperação)) ou libere o endereço ([14.7](14-portal-a-conta.md#147-liberar-um-endereço-bloqueado)). |
| **Portal do Cliente — abuso de login** · crítico · com justificativa | Na sexta tentativa de entrada recusada pelo bloqueio do CNPJ. Um por Cliente. | Confira a origem e, se preciso, fale com o Cliente ([17.2](17-suporte-ao-cliente.md#172-o-cliente-não-consegue-entrar)). Não fecha sozinho: resolva com justificativa. |
| **Portal do Cliente — exceção de fatura** · crítico | Uma fatura foi emitida sem o Portal pronto e sem Liberação. Um por B/L. | Leve o Portal a pronto e, até lá, faça a fatura chegar ao Cliente ([14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)). Fecha quando a fatura é paga, mesmo em parte, cancelada ou substituída. |
| **Portal do Cliente — falha no reprocessamento** · crítico | O Portal ficou pronto (ou foi concedida a Liberação), mas a fatura retida de um B/L não saiu por falha técnica. | Abra o B/L e emita a fatura pela aba **Faturamento** ([7.6](07-ficha-do-bl.md#76-as-taxas-locais-na-ficha)). |

### Os contatos do Cliente

| Alerta | Quando abre | O que fazer |
|---|---|---|
| **Cliente sem contato alternativo** · crítico | Um e-mail devolvido deixou o Cliente sem nenhum contato ativo e válido. | Peça um endereço ao Cliente e cadastre o contato ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe)). |
| **Caixa de comunicação sem destinatário** · crítico | Uma caixa de comunicação do Cliente ficou só com e-mails bloqueados. | Ligue à caixa um contato com e-mail válido e clique em **Salvar contatos** ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). |
| **Cliente sem contato principal** · crítico | A importação de um B/L trouxe um e-mail que está desativado no cadastro, e o Cliente não tem contato principal ativo. | Escolha o contato principal e clique em **Salvar contatos** ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). |

## 20.7 Comunicados e e-mail

**Quem recebe:** {{Documentação}}; o e-mail devolvido de um usuário, o {{Administrativo}}

Quando um aviso ao Cliente não sai, um destes alertas avisa a {{Documentação}}; a página **Comunicados da viagem**, aberta pelo navio e viagem na **Cobertura de viagens**, mostra o motivo ([16.8](16-emails-e-comunicados.md#168-quando-um-aviso-não-sai)).

| Alerta | Quando abre | O que fazer |
|---|---|---|
| **Comunicado NOA pendente**, **Comunicado NOR pendente** e **Comunicado NOB pendente** | A escala (no NOB, o terminal) está na janela do aviso e algum Cliente com destinatário ainda não recebeu. A mensagem lista os Clientes. | Veja na página da viagem, pela Cobertura, o que segura o aviso ([16.8](16-emails-e-comunicados.md#168-quando-um-aviso-não-sai)). Fecha quando o último destinatário recebe. |
| **Comunicado sem destinatário** | Um Cliente deveria receber um aviso e não tem contato válido na caixa do modelo. Um por Cliente, com os avisos pendentes. | Ligue um contato à caixa **Documentação e Operação** (no CE e Taxas, **Financeiro**) ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). |
| **Comunicado automático recusado** · com justificativa | Um aviso não saiu: recusa definitiva do provedor, um dado que só uma pessoa corrige ou a terceira falha seguida. Um por Cliente, com o motivo. | Corrija o que o motivo aponta; se é falha do provedor, avise o suporte técnico. Fecha sozinho quando o aviso sai ou deixa de ser devido; senão, com justificativa. |
| **Reenviar Comunicado de CE e Taxas** | O CE de um B/L mudou ou saiu depois de o CE e Taxas ter sido enviado ao Cliente. | Reenvie o CE e Taxas ([16.7](16-emails-e-comunicados.md#167-reenviar-o-comunicado-de-ce-e-taxas)). |
| **Usuário interno com e-mail devolvido** | O e-mail de uma pessoa da equipe foi devolvido ou marcado como spam: os e-mails do Vela não chegam a ela. | Em **Admin** › **Usuários**, **Editar acesso**, corrija o e-mail e salve. |

::: atencao
Resolvido com justificativa, o **Comunicado automático recusado** não reabre pelas novas tentativas dos mesmos avisos; só a falha de outro aviso do Cliente o reabre.
:::

## 20.8 Faturamento e Taxas Locais

**Quem recebe:** {{Documentação}}; a fatura desatualizada e a taxa alterada à mão, {{Administrativo}} e {{Financeiro}}

Estes alertas avisam que uma fatura não saiu ou não acompanha mais o B/L. Os de dinheiro aparecem também no alto de **Taxas Locais**.

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **Cálculo bloqueado** · crítico | Ao sair da Revisão ou ao ganhar o Cliente pela ficha, o Vela tentou faturar o B/L e o cálculo travou: falta tabela de cobrança, há linha inválida ou o B/L ficou sem valor. | {{Documentação}} | **Resolver** abre onde se corrige. Corrija e recalcule (capítulo 21). Fecha quando o cálculo fica válido ou o B/L fica isento, faturado ou cancelado. |
| **Falha de emissão automática** · crítico | A fatura de um B/L não saiu por falha técnica na emissão pelo CE. | {{Documentação}} | Emita a fatura em **Taxas Locais** › **Validação** (capítulo 22). Fecha quando a fatura sai. |
| **Tabela de cobrança faltando** | B/Ls com CE esperam a fatura porque o POD e a modalidade não têm tabela de cobrança ativa. Um por POD e modalidade, com a lista dos B/Ls. | {{Documentação}} | Cadastre ou ative a tabela de cobrança em **Taxas Locais** (capítulo 21). Os B/Ls não pegam a tabela de cobrança sozinhos: importe de novo a mesma planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)), sem fatura em dobro, ou recalcule-os na **Validação** e emita os que ficarem em **Pronto para emitir**. |
| **Fatura desatualizada** · crítico | Uma correção do B/L mudou a cobrança de uma fatura e o Vela não pôde corrigir sozinho: a fatura tem pagamento e o valor subiu, ou a nova fatura não pôde sair. | {{Administrativo}} e {{Financeiro}} | No detalhe da fatura, bloco **Fatura desatualizada**. Com pagamento: emita a Fatura Avulsa da diferença e use **Resolver com justificativa**. Com a reemissão travada: resolva o motivo e use **Tentar aplicar correção** (capítulo 22). |
| **Taxa alterada à mão mudou** · com justificativa | Uma importação, rotina ou correção mudou a base de um B/L (POD, carga, container, veículo) e descartou uma taxa alterada à mão, ou mudou a quantidade dela, sem passar pelo **Gravar mesmo assim**. Um por B/L. | {{Administrativo}} e {{Financeiro}} | Na aba **Faturamento** do B/L, confira a taxa e altere de novo se preciso ([7.6](07-ficha-do-bl.md#76-as-taxas-locais-na-ficha)). Depois, resolva com justificativa. |

## 20.9 Demurrage

**Quem recebe:** {{Equipamentos}}, {{Administrativo}} e {{Documentação}}

Estes alertas avisam quando a cobrança da Demurrage não anda sem uma pessoa. A restituição de Demurrage está em [20.10](#2010-pix-e-pagamento).

| Alerta | Quando abre | Quem recebe | O que fazer | Quando fecha |
|---|---|---|---|---|
| **Disputa de invoice Demurrage** | O Cliente abriu uma Disputa no Portal, escreveu nela ou pediu a reabertura, ou a equipe a reabriu: a vez é da equipe. | {{Equipamentos}} | **Resolver** abre a Disputa. Responda ou resolva a Disputa ([9.8](09-containers-e-demurrage.md#98-responder-a-uma-disputa)). | Quando a vez passa ao Cliente, a Disputa é resolvida ou a Invoice é cancelada. |
| **Disputa de Demurrage sem resposta no prazo** | A Disputa espera a resposta da equipe há mais de 1 dia útil: o prazo vence no mesmo horário do dia útil seguinte ao de quando a vez passou à equipe (sexta 17h vence segunda 17h). Um por Invoice. | {{Equipamentos}} | **Abrir Disputa** abre a conversa na aba **Disputas**. Responda ou decida a Disputa ([9.8](09-containers-e-demurrage.md#98-responder-a-uma-disputa) e [9.9](09-containers-e-demurrage.md#99-decidir-a-disputa)). | Na hora em que a equipe responde, a Disputa é resolvida ou a Invoice é cancelada. |
| **Demurrage travada** | Um grupo de B/Ls tem Demurrage que o Vela não tem como cobrar: tipo de container sem tarifa, B/L sem Cliente, B/L cancelado, sem CE Mercante ou com o Portal do Cliente segurando o faturamento. É a divisão **Travado** da página **Demurrage**; um alerta por grupo. | {{Documentação}}, quando falta CE ou Cliente ou o Portal segura; {{Administrativo}}, no tipo sem tarifa e no B/L cancelado. Mudou o motivo, muda a equipe. | **Abrir Demurrage** abre a divisão **Travado** já buscando o B/L: use o atalho da linha ([9.5](09-containers-e-demurrage.md#95-acompanhar-a-demurrage-dos-containers)). Se não há o que cobrar, dispense a cobrança ([9.11](09-containers-e-demurrage.md#911-dispensar-a-cobrança-de-um-container)). | Sozinho, quando o grupo sai de **Travado**. |
| **Datas mudaram em Invoice de Demurrage emitida** · crítico · com justificativa | As datas, o SOC/COC ou a divisão de um container entre Clientes mudaram depois da Invoice, ou o B/L dela foi cancelado. Com pagamento, desconto ou Disputa aberta, a Invoice não é reemitida e a Régua para; a mensagem diz a causa. Se ela foi reemitida e algum container ficou sem cobrança, o alerta diz qual. | {{Administrativo}} | Com pagamento: trate a diferença por restituição de Demurrage ou fatura avulsa. Com desconto: cancele, gere de novo e refaça o desconto. Com Disputa: veja [9.9](09-containers-e-demurrage.md#99-decidir-a-disputa). Container sem cobrança: emita a Demurrage dele; se o alerta diz que a Invoice foi cancelada à mão, use **Gerar Invoice** ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)). | Sozinho, quando os containers entram numa Invoice emitida ou as datas voltam às faturadas; nos outros casos, com justificativa. |
| **Cobrança de Demurrage recusada** · com justificativa | O provedor recusou em definitivo o e-mail da Régua, para todos os contatos ou parte deles, ou falhou três vezes seguidas. Com recusa definitiva, a Régua pausa a Invoice. | {{Administrativo}} | Recusa: corrija primeiro o contato do Cliente ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe)) e depois resolva com justificativa; a Régua volta a cobrar na rodada seguinte. Falha repetida: avise o suporte técnico. | A falha repetida, quando a cobrança sai; a recusa, com justificativa. Os dois, quando a Invoice é paga, isenta ou cancelada. |
| **Falha na atualização da PTAX Demurrage** · crítico | A atualização das 14h não trouxe a PTAX do dia ou não a levou às Invoices. O último câmbio válido continua valendo. | {{Documentação}} | Peça ao {{Financeiro}}, ao {{Administrativo}} ou a {{Equipamentos}} que use **Informar PTAX**, em **Demurrage**. Se repetir, avise o suporte técnico. | Na próxima atualização automática que der certo; o **Informar PTAX** atualiza as Invoices, mas não fecha o alerta. |
| **Calendário de feriados pendente** | A partir de 1º de novembro, com a cobrança pelo Itaú ligada, se os feriados do ano seguinte não estão cadastrados. | {{Documentação}} | Peça ao suporte técnico o cadastro dos feriados de Vitória/ES do ano seguinte. | Quando os feriados são cadastrados. |

## 20.10 Pix e pagamento

**Quem recebe:** {{Administrativo}} e {{Financeiro}}

O Pix de uma cobrança do Vela que não pode ser baixado sozinho com segurança vira alerta. O Pix do QR estático e o feito digitando a chave ficam **Sem baixa** em **Pix recebidos**, sem alerta ([24.1](24-pagamento-e-restituicao.md#241-acompanhar-a-baixa-automática-do-pix)).

| Alerta | Quando abre | O que fazer |
|---|---|---|
| **PIX sem conciliação segura** · crítico | Um Pix não pôde ser baixado sozinho, por exemplo com valor diferente da cobrança ou de fatura já paga ou cancelada. | **Resolver** abre **Conciliação PIX** › **Pendências**: dê a baixa na fatura certa ou registre a devolução (capítulo 24). |
| **Consulta de Pix do Itaú parada** · crítico · com justificativa | A consulta dos Pix recebidos não avança há mais de 15 minutos: os Pix pagos deixam de ser baixados. | Baixe pelo **Conciliar extrato**, em **Conciliação PIX**, e avise o suporte técnico. Fecha sozinho quando a consulta volta a andar. |
| **Restituição pendente** | Há valor a devolver ao Cliente numa fatura ou numa Invoice de Demurrage, como pagamento a mais ou Pix em duplicidade. | Devolva o valor e marque a restituição como efetuada no detalhe da fatura ou da Invoice (capítulo 24). Fecha quando não resta nada a devolver. |

## 20.11 Desbloqueio de CE

**Quem recebe:** {{Documentação}} e {{Administrativo}}

| Alerta | Quando abre | Quem recebe | O que fazer | Quando fecha |
|---|---|---|---|---|
| **CE trocado depois do Desbloqueio conferido** · crítico · com justificativa | O CE de um B/L cujo Desbloqueio já tinha sido conferido foi trocado ou removido. | {{Documentação}} | Confira o Desbloqueio com o CE novo ([12.7](12-desbloqueio-de-ce.md#127-conciliar-com-a-zpt)). | Sozinho, quando a conciliação com a ZPT confirma o CE atual como desbloqueado. Se o CE foi removido ou a conferência foi feita fora da conciliação, com justificativa. |
| **Aviso do Desbloqueio de CE não enviado** · com justificativa | O e-mail ao Cliente (documento recusado ou documentação validada) não chegou a ninguém: não há contato na caixa **Documentação e Operação**, ou o envio falhou. Um por Cliente. | {{Administrativo}} | **Abrir Cliente** leva à ficha: ligue à caixa um contato com e-mail válido ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). O aviso no sino do Portal já chegou ao Cliente. | Sozinho, quando o próximo aviso ao mesmo Cliente sai; senão, com justificativa. |

## 20.12 ADR de Saída

**Quem recebe:** cada equipe, o seu: {{Operações}}, {{Documentação}} e {{Equipamentos}}

| Alerta | Quando abre | O que fazer |
|---|---|---|
| **ADR — departamento pendente** | A partir do ATD, enquanto a equipe tem seção **Pendente** no ADR do terminal. | Abra o ADR e marque cada seção da sua equipe como **Confirmado** ou **Nada a declarar** ([11.2](11-adr-de-saida.md#112-conferir-as-seções-da-sua-equipe)). |
| **ADR — prazo vencido** · crítico | 72 horas depois do ATD, se a equipe ainda não assinou. | Trate as seções e assine ([11.3](11-adr-de-saida.md#113-assinar-pela-equipe)). |

O **ADR — departamento pendente** fecha quando a última seção da equipe sai de **Pendente**; o **ADR — prazo vencido**, com a assinatura da equipe. Os dois fecham também com o fechamento do ADR e reabrem se uma seção volta a **Pendente**. Escala omitida ou excluída não abre esses alertas.

::: atencao
Cancelar a Viagem não fecha os alertas do ADR, e o ADR de Viagem cancelada fica só para leitura: ninguém consegue assinar. Esses alertas só saem da fila com a exclusão da Viagem ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)).
:::

## 20.13 Rotinas paradas

**Quem recebe:** {{Administrativo}}

Estes alertas avisam que uma rotina parou por dentro; quase sempre o caminho é avisar o suporte técnico ([19.9](19-rotinas-por-horario.md#199-quando-uma-rotina-para)).

| Alerta | Quando abre | Quem recebe | O que fazer | Quando fecha |
|---|---|---|---|---|
| **Fila de efeitos de importação parada** · crítico · com justificativa | Algum passo que roda depois da importação está atrasado há mais de 60 minutos. A conferência é de hora em hora. | {{Administrativo}} | Avise o suporte técnico. | Sozinho, quando a fila volta a andar. |
| **Provedor de e-mail sem retorno** · crítico · com justificativa | O provedor de e-mail não deu nenhum retorno (entrega, devolução ou spam) de pelo menos 3 envios aceitos há mais de 2 horas. Enquanto isso, o Vela não fica sabendo das entregas nem das devoluções. | {{Administrativo}} | Avise o suporte técnico. | Sozinho, no primeiro retorno do provedor. |
| **Rotina agendada com resposta de erro** · crítico · com justificativa | Na última hora, duas ou mais chamadas de rotina terminaram com erro ou sem resposta, uma foi recusada por acesso (resposta 401 ou 403), 10 esgotaram o tempo ou 30 ficaram paradas na fila. Uma falha isolada não abre. O alerta mostra o horário, não o nome da rotina. | {{Administrativo}} | Passe o horário ao suporte técnico. | Sozinho, quando a última hora não tem mais nenhuma dessas situações. |
| **Retorno do provedor de e-mail não aplicado** · com justificativa | O provedor de e-mail avisou que um e-mail foi devolvido ou marcado como spam, mas ele não está entre os enviados pelo Vela; ou o aviso serve a mais de um envio, ou não pôde ser aplicado depois de 6 tentativas. A mesma conta do provedor envia os e-mails do site da Fwlog. **Registro** mostra o destinatário mascarado. | {{Administrativo}} | Se o e-mail saiu de outro sistema, como o site, resolva com justificativa. Se saiu do Vela, passe o destinatário e o horário ao suporte técnico e confira o contato do Cliente ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe)). | Só com justificativa. |
