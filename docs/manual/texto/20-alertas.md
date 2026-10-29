Quando alguma coisa precisa de uma pessoa e ninguém pediu, o Vela abre um alerta: um prazo da documentação que chegou, um aviso ao Cliente que não saiu, um Pix que não pôde ser baixado. O alerta fica na fila **Alertas**, à vista de todas as equipes, até a causa deixar de existir; quem precisa saber recebe também uma notificação no sino. Este capítulo mostra como ler a fila, como resolver um alerta e, assunto por assunto, cada alerta do Vela: quando abre, quem recebe e o que fazer. O que provoca os alertas, ação por ação e pelo relógio, está nos capítulos [18](18-o-que-muda-sozinho.md) e [19](19-rotinas-por-horario.md).

::: aprende
- ler a fila de Alertas e achar os alertas da sua equipe;
- resolver um alerta e saber quando ele fecha sozinho;
- usar o sino e saber quem recebe cada notificação;
- o que fazer em cada alerta, por assunto.
:::

## 20.1 Ler a fila de Alertas

**Quem faz:** {{Todas as equipes}}

O alerta é uma pendência que o Vela abriu sozinho. A fila é uma só para todas as equipes: o setor é um filtro, não uma fila separada. Cada alerta tem um setor responsável (**Documentação**, **Equipamentos**, **Operações** ou **Administrativo**) e uma gravidade: **Crítico**, em vermelho, ou **Normal**. O {{Financeiro}} não é setor de alerta: os alertas de dinheiro ficam no setor {{Administrativo}} e chegam ao Financeiro pelo sino ([20.3](#203-acompanhar-o-sino)). A faixa de avisos do alto, com os containers em atraso, é só uma contagem: não é alerta.

::: passos
1. Abra **Alertas** no menu, ou clique no cartão da sua equipe no **Painel**: a fila abre já no seu setor. O número ao lado de **Alertas**, no menu, conta os ativos de todas as equipes.
2. Em **Setor**, escolha a sua equipe. O cartão **Críticos** mostra só os críticos; **Ativos** volta à fila toda.
3. Para achar um caso, use **Busca**: número do B/L, navio, Cliente, CNPJ ou um trecho da mensagem. Uma lista colada de números de B/L também funciona.
4. Leia a linha: **Registro** diz onde está a pendência (o B/L e a Viagem abrem a ficha), **Mensagem** dá o detalhe e **Aberto em** diz desde quando.
:::

Os críticos vêm primeiro e, dentro de cada gravidade, os mais recentes. A fila mostra 100 alertas por página. O cartão e o filtro **Sem setor** juntam alertas antigos, de antes da divisão por equipe: eles não são de nenhuma equipe, e qualquer pessoa pode tratá-los.

O botão **Regras de alertas**, no alto da fila, abre a lista de todos os alertas do Vela, com quando cada um abre, quem recebe e como se resolve. A tela só informa: não resolve nada.

::: atencao
- **Busca**, **Registro** e **Gravidade** filtram só a página carregada. Com mais de 100 alertas, filtre antes por **Setor**, que vale para a fila inteira, ou troque de página.
- A fila não se atualiza sozinha: ela relê ao abrir e depois de cada resolução sua. Para ver o que outra pessoa ou o Vela mudou, abra a página de novo.
:::

## 20.2 Resolver um alerta

**Quem faz:** {{Qualquer equipe}}. Qualquer pessoa ativa resolve qualquer alerta: o setor diz quem é avisado, não quem pode resolver.

Um alerta não se fecha à mão: ele fecha quando a causa deixa de existir. Quase sempre isso acontece sozinho: você corrige o dado e o Vela fecha o alerta na hora da gravação ou, no máximo, na conferência de 15 minutos ([19.2](19-rotinas-por-horario.md#192-os-alertas-que-dependem-do-relógio)). Não existe dispensar nem marcar como visto. Na coluna **Ações**, o botão **Resolver** leva à tela onde a correção se faz; o nome da tela aparece quando você para o mouse sobre ele.

| Como o alerta sai da fila | Quais alertas | O que você faz |
|---|---|---|
| Sozinho, quando a causa some | Quase todos | **Resolver** abre a tela da correção. Corrija; o alerta fecha sozinho. |
| Com justificativa | Os marcados "com justificativa" nas seções deste capítulo | Confira o caso, clique em **Resolver**, escreva o que conferiu em **Justificativa (o que foi conferido)** e confirme em **Resolver**. Quando há uma tela para conferir, um botão ao lado de **Resolver** leva até ela. |
| Reprocessando | **Efeito de importação bloqueado** | Corrija a causa e use **Reprocessar** ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação)). |

A justificativa fica no histórico do alerta e em **Admin** › **Histórico de ações**, assunto **Alerta**, com o seu nome. Ela só tira o alerta da fila: se a situação voltar, o Vela o abre de novo.

Se a causa volta depois de o alerta fechar, ele reabre e as pessoas são avisadas de novo; **Aberto em** mostra a data da reabertura. Num alerta aberto, uma etapa nova também avisa de novo (o ETA passou sem ATA, depois "falta o ETB"); mudar só a contagem ou o texto, não.

::: atencao
- Corrija antes de justificar. A justificativa não corrige nada: só registra que alguém conferiu.
- Se aparecer "Item de alerta não está ativo.", outra pessoa ou o próprio Vela já fechou o alerta. Abra **Alertas** de novo e confira.
:::

## 20.3 Acompanhar o sino

**Quem faz:** {{Todas as equipes}}

O sino é pessoal: traz as **Notificações internas**, o aviso de que abriu um alerta para a sua equipe. Cada pessoa ativa recebe os alertas do setor responsável. Há duas exceções: o {{Financeiro}} recebe também os alertas de dinheiro (**PIX sem conciliação segura**, **Consulta de Pix do Itaú parada**, **Restituição pendente**, **Fatura desatualizada** e **Taxa alterada à mão mudou**), e o {{Administrativo}} recebe também quatro críticos da Documentação sobre o Cliente (**Cliente sem contato alternativo**, **Caixa de comunicação sem destinatário**, **Cliente sem contato principal** e **Portal do Cliente — exceção de fatura**).

::: passos
1. Clique no sino, na barra do alto. Com o menu na lateral, ele fica no pé do menu, como **Notificações**. O número conta as que você ainda não leu.
2. Clique numa notificação: ela abre a tela onde a pendência se resolve e fica lida.
3. Para ver todos os alertas da equipe, use **Abrir fila de Alertas**, no pé do painel.
4. Para limpar o painel de uma vez, use **Marcar todas como lidas** e confirme. Não há como voltar a "não lida".
:::

A notificação é uma fotografia do momento em que o alerta abriu: ela não muda depois. Quando o alerta fecha, ela sai sozinha do sino, mesmo sem ter sido lida. O número se relê a cada 30 segundos, e a lista, a cada minuto com o painel aberto.

Quando um alerta **Crítico** não acha ninguém ativo no setor, a notificação vai ao {{Administrativo}} com o selo **Entrega alternativa**; o alerta continua do setor original. Se nem assim há quem receba, ou se o alerta é Normal, a falha aparece em **Admin** › **Falhas de entrega de alertas**: para resolver, ative alguém do setor na aba **Usuários**.

::: atencao
- Ler a notificação não resolve nada: o alerta continua na fila até a causa sumir.
- A notificação lida sai do sino e não aparece em nenhuma outra tela. Para rever um alerta, use a fila.
:::

## 20.4 Viagem e datas

**Quem recebe:** {{Operações}}

Estes alertas cobram as datas que o navio já devia ter: a data prevista chegou, pelo dia de Brasília, e a realizada não foi registrada. Eles fecham na hora em que você grava a data.

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **Data da escala pendente** | No dia do ETA, se a escala não tem ATA ("ETA de … passou sem ATA registrada."). Com o ATA, se nenhum terminal da escala tem ETB ("ATA registrada; falta o ETB."). | {{Operações}} | Registre o ATA da escala, ou o ETB no cartão do terminal ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)). |
| **Data de terminal pendente** | Para cada terminal: no dia do ETB sem ATB; com o ATB, enquanto falta o ETD; no dia do ETD sem ATD. | {{Operações}} | Registre a data cobrada no cartão do terminal ([4.4](04-viagens-escalas.md#44-manter-as-datas-do-navio-em-dia)). |
| **Exportação pendente pós-ATD** | Com o ATD num terminal de escala que declarou exportação de Granito ou de vazios, enquanto a exportação não foi lançada na Viagem. | {{Operações}} | Importe o Granito ou inclua as unidades no **Embarque de vazios** (capítulo 10), ou corrija a exportação declarada na escala ([4.2](04-viagens-escalas.md#42-planejar-as-escalas)). |

::: atencao
A exportação é conferida pela Viagem, não pelo porto. Numa Viagem com exportação em dois portos, lançar a de um fecha o alerta do outro: confira os dois antes de dar o caso por encerrado.
:::

## 20.5 Documentação e importação

**Quem recebe:** {{Documentação}}; a Planilha de Veículos, {{Equipamentos}}

Sete dias antes do primeiro ETA no Brasil (D−7), o Vela começa a cobrar a documentação da Viagem; cinco dias antes (D−5), o CE e os veículos. O que move esses prazos está em [18.2](18-o-que-muda-sozinho.md#182-mudar-a-chegada-prevista-do-navio). Os outros alertas desta seção abrem na importação ou na Revisão. Fora o **Efeito de importação bloqueado**, que pede **Reprocessar**, todos fecham sozinhos quando o dado é corrigido, e B/L cancelado não conta em nenhum deles.

### Os prazos da Viagem

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **B/L esperado pendente** · crítico | No D−7, se falta B/L para algum porto de descarga da Viagem ou para um porto de embarque com saída programada. | {{Documentação}} | Importe os B/Ls que faltam ([6.2](06-importacao.md#62-importar-os-bls-de-container)). |
| **Baplie ausente** · crítico | No D−7, sem Baplie importado. | {{Documentação}} | Importe o Baplie ([6.7](06-importacao.md#67-importar-o-baplie)). |
| **Cobertura Baplie / B/L** · crítico | Quando há container cheio no Baplie sem B/L, ou container de B/L que não está entre os cheios do Baplie. A mensagem diz quantos. | {{Documentação}} | Corrija o B/L ou o Baplie ([6.8](06-importacao.md#68-resolver-as-divergências-entre-baplie-e-bl)). |
| **CE Mercante pendente** · crítico | No D−5, se há B/L ativo sem CE ou rota de vazios sem **Nº de Manifesto Mercante**. | {{Documentação}} | Importe a planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)) e informe o número do manifesto das rotas de vazios em **Rotas e Manifestos** ([4.6](04-viagens-escalas.md#46-rotas-e-manifestos)). |
| **Planilha de Veículos pendente** · crítico | No D−5, se a Viagem tem B/L de container e nenhum veículo importado, nem a declaração **Esta viagem não terá veículos**. | {{Equipamentos}} | Em **Veículos**, importe a planilha ou declare que a Viagem não terá veículos (capítulo 10). |

### A importação e a Revisão

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **CE fora do Manifesto da rota** | Um B/L com CE mudou de POL, POD ou Viagem e saiu do Manifesto Mercante. | {{Documentação}} | Inclua o B/L no Manifesto da rota nova ou corrija o CE ([6.6](06-importacao.md#66-corrigir-o-ce-ou-o-manifesto-de-um-bl)). |
| **Efeito de importação bloqueado** · crítico | Um passo que roda logo depois da importação (marcas do Baplie, Taxas Locais, fatura pelo CE, veículos) falhou e parou. A mensagem diz o B/L e o motivo. | {{Documentação}} | Corrija a causa e use **Reprocessar** ([6.10](06-importacao.md#610-quando-algo-fica-parado-depois-da-importação)). O alerta fecha quando o passo conclui. |
| **Revisão de B/L — cliente não vinculado** · crítico | Há B/L pendente na Revisão sem Cliente. Um por consignatário. | {{Documentação}} | Vincule o Cliente na Revisão ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)). |
| **Revisão de B/L — peso BB ausente** · crítico | Há B/L de carga solta na Revisão sem o peso. | {{Documentação}} | Informe o peso ([8.4](08-revisao.md#84-informar-o-peso-da-carga-solta)). |
| **Revisão de B/L — Portal não provisionado** · crítico | O Cliente tem B/L parado na Revisão ou fatura retida porque o Portal dele não está pronto e não há Liberação de faturamento. | {{Documentação}} | Leve o Portal a pronto ([14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)) ou peça ao {{Administrativo}} a Liberação ([13.8](13-cadastro-do-cliente.md#138-liberar-o-faturamento-sem-portal)). |
| **B/L sem Cliente perto do ETA** · crítico | Faltam 5 dias ou menos para o ETA do porto (ou ele já passou) e algum B/L desse porto está sem Cliente. Um por escala. | {{Documentação}} | **Resolver** abre a Revisão já nos B/Ls sem Cliente da Viagem. Vincule ou cancele cada um ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)). |

No exemplo, a COSCO SHIPPING SEREIA 024E chega a Salvador em 6 dias: o D−7 já passou, e o Vela cobra os B/Ls e o Baplie da Viagem. O CSC45810A03K00, cujo Cliente ainda não está cadastrado, abre **Revisão de B/L — cliente não vinculado**. Quando faltarem 5 dias para Vitória, abre também **B/L sem Cliente perto do ETA**, e a linha da Revisão ganha na fila o selo **ETA próximo**.

::: atencao
Sem a Planilha de Veículos, o CE emite a fatura cheia do B/L de veículo que seria isento. Não deixe o alerta de veículos para depois do CE.
:::

## 20.6 Cliente e Portal

**Quem recebe:** {{Documentação}}; os quatro críticos de contato e de fatura, também o {{Administrativo}}

Os alertas da conta do Portal só abrem quando o Cliente tem processo ativo: B/L não cancelado e ainda não pago, ou Invoice de Demurrage emitida. Sem nada em aberto, o Vela não cobra a conta. Eles abrem e fecham sozinhos quando a conta, o e-mail ou os B/Ls mudam. No **Provisionamento do Portal**, a coluna **Alerta** mostra **Crítico** na linha do Cliente com alerta grave ([14.1](14-portal-a-conta.md#141-ler-a-fila-do-provisionamento-do-portal)).

### A conta do Portal

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **Portal do Cliente — pendência geral** | O Portal não está pronto: sem conta, conta não ativa ou suspensa, sem usuário de acesso ou sem e-mail de recuperação utilizável. A mensagem diz qual. | {{Documentação}} | Siga a **Ação** da linha do Cliente no Provisionamento (capítulo 14). |
| **Portal do Cliente — convite expirado** | O convite passou de 48 horas sem ativação. | {{Documentação}} | Reenvie o convite ([14.3](14-portal-a-conta.md#143-convidar-o-cliente)). |
| **Portal do Cliente — falha de envio** | O e-mail do convite não saiu. | {{Documentação}} | Confira o e-mail e reenvie o convite ([14.3](14-portal-a-conta.md#143-convidar-o-cliente)). |
| **Portal do Cliente — email suprimido** | O e-mail de recuperação foi bloqueado (devolvido ou marcado como spam). | {{Documentação}} | Troque o e-mail de recuperação ([14.6](14-portal-a-conta.md#146-trocar-o-e-mail-de-recuperação)) ou libere o endereço ([14.7](14-portal-a-conta.md#147-liberar-um-endereço-bloqueado)). |
| **Portal do Cliente — abuso de login** · crítico · com justificativa | Na sexta tentativa de entrada recusada pelo bloqueio do CNPJ. Um por Cliente. | {{Documentação}} | Confira a origem e, se preciso, fale com o Cliente ([17.2](17-suporte-ao-cliente.md#172-o-cliente-não-consegue-entrar)). Não fecha sozinho: resolva com justificativa. |
| **Portal do Cliente — exceção de fatura** · crítico | Uma fatura foi emitida sem o Portal pronto e sem Liberação. Um por B/L. | {{Documentação}} e {{Administrativo}} | Leve o Portal a pronto e, até lá, faça a fatura chegar ao Cliente ([14.5](14-portal-a-conta.md#145-o-que-deixa-o-portal-pronto-para-faturar)). Fecha quando a fatura é paga, cancelada ou substituída. |
| **Portal do Cliente — falha no reprocessamento** · crítico | O Portal ficou pronto (ou foi concedida a Liberação), mas a fatura retida de um B/L não saiu por falha técnica. | {{Documentação}} | Abra o B/L e emita a fatura pela aba **Faturamento** ([7.6](07-ficha-do-bl.md#76-as-taxas-locais-na-ficha)). Se a falha se repete, avise o suporte técnico. O mesmo nome serve a um retorno do provedor de e-mail ([20.13](#2013-rotinas-paradas)). |

### Os contatos do Cliente

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **Cliente sem contato alternativo** · crítico | Um e-mail devolvido deixou o Cliente sem nenhum contato ativo e válido. | {{Documentação}} e {{Administrativo}} | Peça um endereço ao Cliente e cadastre o contato ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe)). Fecha na hora. |
| **Caixa de comunicação sem destinatário** · crítico | Uma caixa de comunicação do Cliente ficou só com e-mails bloqueados. | {{Documentação}} e {{Administrativo}} | Ligue à caixa um contato com e-mail válido e clique em **Salvar contatos** ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). |
| **Cliente sem contato principal** · crítico | A importação de um B/L trouxe um e-mail que está desativado no cadastro, e o Cliente não tem contato principal ativo. | {{Documentação}} e {{Administrativo}} | Escolha o contato principal e clique em **Salvar contatos** ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). |

::: atencao
Resolver o **Portal do Cliente — abuso de login** não desbloqueia o CNPJ: o bloqueio acaba sozinho em até 15 minutos ([17.2](17-suporte-ao-cliente.md#172-o-cliente-não-consegue-entrar)).
:::

## 20.7 Comunicados e e-mail

**Quem recebe:** {{Documentação}}; o e-mail devolvido de um usuário, o {{Administrativo}}

Os avisos ao Cliente saem sozinhos ([19.4](19-rotinas-por-horario.md#194-os-comunicados-automáticos)). Quando um deles não sai, a **Cobertura de viagens** mostra o motivo ([16.8](16-emails-e-comunicados.md#168-quando-um-aviso-não-sai)) e um destes alertas avisa a {{Documentação}}.

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **Comunicado NOA pendente**, **Comunicado NOR pendente** e **Comunicado NOB pendente** | A escala (no NOB, o terminal) está na janela do aviso e algum Cliente com destinatário ainda não recebeu. A mensagem lista os Clientes. | {{Documentação}} | Veja na Cobertura o que segura o aviso ([16.8](16-emails-e-comunicados.md#168-quando-um-aviso-não-sai)); se a janela passou, mande à mão ([16.5](16-emails-e-comunicados.md#165-mandar-um-noa-nor-ou-nob-à-mão)). Fecha quando o último destinatário recebe. |
| **Comunicado sem destinatário** | Um Cliente deveria receber um aviso e não tem contato válido na caixa do modelo. Um por Cliente, com os avisos pendentes. | {{Documentação}} | Ligue um contato à caixa **Documentação e Operação** (no CE e Taxas, **Financeiro**) ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). Os outros Clientes recebem normalmente. |
| **Comunicado automático recusado** · com justificativa | Um aviso não saiu: recusa definitiva do provedor, um dado que só uma pessoa corrige (contato fora da caixa, escala indisponível) ou a terceira falha seguida. Um por Cliente, com o motivo. | {{Documentação}} | Corrija o que o motivo aponta; se é falha do provedor, avise o suporte técnico. Fecha sozinho quando o aviso sai ou deixa de ser devido; senão, com justificativa. |
| **Reenviar Comunicado de CE e Taxas** | O CE de um B/L mudou ou saiu depois de o CE e Taxas ter sido enviado ao Cliente. | {{Documentação}} | Reenvie o CE e Taxas ([16.7](16-emails-e-comunicados.md#167-reenviar-o-comunicado-de-ce-e-taxas)); **Resolver** já abre o Histórico daquele B/L. |
| **Usuário interno com e-mail devolvido** | O e-mail de uma pessoa da equipe foi devolvido ou marcado como spam: os e-mails do Vela não chegam a ela. | {{Administrativo}} | Em **Admin** › **Usuários**, **Editar acesso**, corrija o e-mail e salve. |

::: atencao
- Resolvido com justificativa, o **Comunicado automático recusado** não reabre pelas novas tentativas dos mesmos avisos; só a falha de outro aviso do Cliente o reabre.
- No e-mail do usuário, salvar o mesmo endereço depois de a caixa ser consertada libera o bloqueio. Se o endereço é também contato de um Cliente ou e-mail de recuperação do Portal, ele continua bloqueado: corrija pelo cadastro do Cliente. Trocar só a senha não libera.
:::

## 20.8 Faturamento e Taxas Locais

**Quem recebe:** {{Documentação}}; a fatura desatualizada e a taxa alterada à mão, {{Administrativo}} e {{Financeiro}}

Estes alertas avisam que uma fatura não saiu ou não acompanha mais o B/L. Os de dinheiro aparecem também no alto de **Taxas Locais**, acima das abas, até quatro de cada vez, com o atalho para onde se resolvem (**Abrir fatura**, **Ver na Validação** ou **Abrir**).

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **Cálculo bloqueado** · crítico | Ao sair da Revisão ou ao ganhar o Cliente pela ficha, o Vela tentou faturar o B/L e o cálculo travou: falta tabela de cobrança, há linha inválida ou o B/L ficou sem valor. | {{Documentação}} | **Resolver** abre onde se corrige. Corrija e recalcule (capítulo 21). Fecha quando o cálculo fica válido ou o B/L fica isento, faturado ou cancelado. |
| **Falha de emissão automática** · crítico | A fatura de um B/L não saiu por falha técnica na emissão pelo CE. | {{Documentação}} | Emita a fatura em **Taxas Locais** › **Validação** (capítulo 22). Fecha quando a fatura sai por qualquer caminho, ou quando o B/L deixa de ter o que faturar. |
| **Tabela de cobrança faltando** | B/Ls com CE esperam a fatura porque o POD e a modalidade não têm tabela de cobrança ativa. Um por POD e modalidade, com a lista dos B/Ls. | {{Documentação}} | Cadastre ou ative a tabela de cobrança em **Taxas Locais** (capítulo 21) e emita de novo, por **Retomar emissão** ou pela mesma planilha de CE ([6.5](06-importacao.md#65-importar-o-ce-mercante-e-emitir-as-faturas)). |
| **Fatura desatualizada** · crítico | Uma correção do B/L mudou a cobrança de uma fatura e o Vela não pôde corrigir sozinho: a fatura tem pagamento e o valor subiu, ou a nova fatura não pôde sair. | {{Administrativo}} e {{Financeiro}} | No detalhe da fatura, bloco **Fatura desatualizada**. Com pagamento: emita a Fatura Avulsa da diferença e use **Resolver com justificativa**. Com a reemissão travada: resolva o motivo e use **Tentar aplicar correção** (capítulo 22). |
| **Taxa alterada à mão mudou** · com justificativa | Uma importação, rotina ou correção mudou a base de um B/L (POD, carga, container, veículo) e descartou uma taxa alterada à mão, ou mudou a quantidade dela, sem passar pelo **Gravar mesmo assim**. Um por B/L. | {{Administrativo}} e {{Financeiro}} | Na aba **Faturamento** do B/L, confira a taxa e altere de novo se preciso ([7.6](07-ficha-do-bl.md#76-as-taxas-locais-na-ficha)). Depois, resolva com justificativa. |

::: atencao
- O **Resolver com justificativa** da **Fatura desatualizada** pede **Como a diferença foi tratada** e só fecha o alerta: não emite a avulsa. Emita a avulsa antes.
- A **Fatura desatualizada** fecha sozinha quando a fatura é cancelada, quando sai a nova fatura, quando a troca de Cliente se conclui ou quando os B/Ls voltam a bater com a fatura.
- B/L esperando a Revisão, a conciliação do Cliente ou a tabela de cobrança não é falha: não abre **Falha de emissão automática**.
:::

## 20.9 Demurrage

**Quem recebe:** {{Equipamentos}}, {{Administrativo}} e {{Documentação}}

A Demurrage cobra o container que passou do free time, e a Régua de Cobrança manda a cobrança sozinha ([19.5](19-rotinas-por-horario.md#195-a-demurrage-pelo-relógio)). Estes alertas avisam quando a cobrança não anda sem uma pessoa. A restituição de Demurrage está em [20.10](#2010-pix-e-pagamento).

| Alerta | Quando abre | Quem recebe | O que fazer | Quando fecha |
|---|---|---|---|---|
| **Disputa de invoice Demurrage** | O Cliente abriu uma Disputa no Portal, escreveu nela ou pediu a reabertura: a vez é da equipe. | {{Equipamentos}} | **Resolver** abre a aba **Disputas** na conversa. Responda ou resolva a Disputa (capítulo 23). | Quando a vez passa ao Cliente ou a Disputa é resolvida. |
| **Datas mudaram em Invoice de Demurrage emitida** · crítico · com justificativa | As datas de um container mudaram depois da Invoice. Com pagamento, desconto ou Disputa aberta, a Invoice não é reemitida e a Régua para; se ela foi reemitida e algum container ficou sem cobrança, o alerta diz qual. | {{Administrativo}} | Com pagamento: trate a diferença por restituição de Demurrage ou fatura avulsa. Com desconto ou Disputa: cancele, gere de novo, refaça o desconto ou responda a Disputa. Container sem cobrança: emita a Demurrage dele (capítulo 23). | Sozinho, quando os containers entram numa Invoice emitida ou as datas voltam às faturadas; nos outros casos, com justificativa. |
| **Cobrança de Demurrage recusada** · com justificativa | O provedor recusou em definitivo o e-mail da Régua, para todos os contatos ou parte deles, ou falhou três vezes seguidas. Com recusa definitiva, a Régua pausa a Invoice. | {{Administrativo}} | Recusa: corrija o contato do Cliente ([16.9](16-emails-e-comunicados.md#169-corrigir-o-contato-que-não-recebe)) e resolva com justificativa; a Régua volta a cobrar na rodada seguinte. Falha repetida: avise o suporte técnico. | A falha repetida, quando a cobrança sai; a recusa, com justificativa. Os dois, quando a Invoice é paga, isenta ou cancelada. |
| **Falha na atualização da PTAX Demurrage** · crítico | A atualização das 14h não trouxe a PTAX do dia ou não a levou às Invoices. O último câmbio válido continua valendo. | {{Documentação}} | Peça ao {{Financeiro}}, ao {{Administrativo}} ou a {{Equipamentos}} que use **Informar PTAX**, em **Demurrage**. Se repetir, avise o suporte técnico. | Na próxima atualização que der certo. |
| **Calendário de feriados pendente** | A partir de 1º de novembro, com a cobrança pelo Itaú ligada, se os feriados do ano seguinte não estão cadastrados. | {{Documentação}} | Peça ao suporte técnico o cadastro dos feriados de Vitória/ES do ano seguinte. | Quando os feriados são cadastrados. |

::: atencao
Na **Cobrança de Demurrage recusada**, justifique só depois de corrigir o contato: a justificativa é o que tira a pausa, e a Régua tenta de novo com os contatos que estiverem no cadastro.
:::

## 20.10 Pix e pagamento

**Quem recebe:** {{Administrativo}} e {{Financeiro}}

Com a cobrança pelo Itaú ligada, o Vela baixa sozinho o Pix de cobrança com o valor exato ([19.6](19-rotinas-por-horario.md#196-o-pix-do-itaú)). O que ele não pode baixar com segurança vira alerta. Na fila, estes alertas ficam no setor {{Administrativo}}.

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **PIX sem conciliação segura** · crítico | Um Pix não pôde ser baixado sozinho: valor diferente da cobrança, fatura já paga ou cancelada, cobrança que não existe, baixa automática cancelada ou Pix que não foi gravado depois de várias tentativas. Vale também para a exceção do extrato. | {{Administrativo}} e {{Financeiro}} | **Resolver** abre **Conciliação PIX** › **Pendências**: dê a baixa na fatura certa ou registre a devolução (capítulo 24). |
| **Consulta de Pix do Itaú parada** · crítico · com justificativa | A consulta dos Pix recebidos não avança há mais de 15 minutos: os Pix pagos deixam de ser baixados. | {{Administrativo}} e {{Financeiro}} | Baixe pelo **Conciliar extrato**, em **Conciliação PIX**, e avise o suporte técnico. Fecha sozinho quando a consulta volta a andar. |
| **Restituição pendente** | Há valor a devolver ao Cliente numa fatura ou numa Invoice de Demurrage: pagamento a mais, Pix em duplicidade, correção do B/L, cancelamento. | {{Administrativo}} e {{Financeiro}} | Devolva o valor e marque a restituição como efetuada no detalhe da fatura ou da Invoice (capítulo 24). Fecha quando não resta nada a devolver. |

::: atencao
Na **Consulta de Pix do Itaú parada**, a justificativa tira o alerta da fila por 24 horas, mesmo que a consulta continue parada. Justifique só depois de o suporte técnico assumir o caso, e continue baixando pelo extrato.
:::

## 20.11 Desbloqueio de CE

**Quem recebe:** {{Documentação}} e {{Administrativo}}

O Desbloqueio de CE é o pedido do Cliente para liberar o CE da carga (capítulo 12; o lado do Cliente está em [15.7](15-portal-o-que-o-cliente-ve.md#157-o-desbloqueio-de-ce-pelo-portal)).

| Alerta | Quando abre | Quem recebe | O que fazer | Quando fecha |
|---|---|---|---|---|
| **CE trocado depois do Desbloqueio conferido** · crítico · com justificativa | O CE de um B/L cujo Desbloqueio já tinha sido conferido foi trocado ou removido. | {{Documentação}} | Confira o Desbloqueio com o CE novo (capítulo 12). | Sozinho, quando a conciliação com a ZPT confirma o CE atual como desbloqueado. Se o CE foi removido ou a conferência foi feita fora da conciliação, com justificativa. |
| **Aviso do Desbloqueio de CE não enviado** · com justificativa | O e-mail ao Cliente (documento recusado ou documentação validada) não chegou a ninguém: não há contato na caixa **Documentação e Operação**, ou o envio falhou. Um por Cliente. | {{Administrativo}} | **Abrir Cliente** leva à ficha: ligue à caixa um contato com e-mail válido ([13.6](13-cadastro-do-cliente.md#136-cuidar-dos-contatos-do-cliente)). O aviso no sino do Portal já chegou ao Cliente. | Sozinho, quando o próximo aviso ao mesmo Cliente sai; senão, com justificativa. |

## 20.12 ADR de Saída

**Quem recebe:** cada equipe, o seu: {{Operações}}, {{Documentação}} e {{Equipamentos}}

O ADR de Saída é o relatório de cada terminal depois da saída do navio: cada equipe confirma as próprias seções e assina (capítulo 11). O ATD do terminal começa o prazo de 72 horas corridas, contando fim de semana e feriado. Cada equipe recebe só o alerta da própria parte.

| Alerta | Quando abre | Quem recebe | O que fazer |
|---|---|---|---|
| **ADR — departamento pendente** | A partir do ATD, enquanto a equipe tem seção **Pendente** no ADR do terminal. | A equipe dona da seção | Abra o ADR, marque cada seção da sua equipe como **Confirmado** ou **Nada a declarar** e assine (capítulo 11). |
| **ADR — prazo vencido** · crítico | 72 horas depois do ATD, se a equipe ainda não assinou. Convive com o de departamento pendente. | A equipe sem assinatura | O mesmo: trate as seções e assine. |

Os dois fecham com a assinatura da equipe ou com o fechamento do ADR, e reabrem se uma seção volta a **Pendente**. Escala omitida ou excluída não abre esses alertas.

::: atencao
Cancelar a Viagem não fecha os alertas do ADR, e o ADR de Viagem cancelada fica só para leitura: ninguém consegue assinar. Esses alertas só saem da fila com a exclusão da Viagem ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)).
:::

## 20.13 Rotinas paradas

**Quem recebe:** {{Administrativo}}; o retorno de e-mail sem envio, {{Documentação}}

Quando uma rotina do Vela para, a tela continua gravando, e o que a rotina faria fica esperando ([19.9](19-rotinas-por-horario.md#199-quando-uma-rotina-para)). Estes alertas avisam que algo parou por dentro, e quase sempre o caminho é avisar o suporte técnico. As rotinas com alerta próprio estão no assunto delas: a consulta do Pix em [20.10](#2010-pix-e-pagamento), a PTAX e os feriados em [20.9](#209-demurrage), os passos da importação em [20.5](#205-documentação-e-importação).

| Alerta | Quando abre | Quem recebe | O que fazer | Quando fecha |
|---|---|---|---|---|
| **Fila de efeitos de importação parada** · crítico · com justificativa | Algum passo que roda depois da importação está atrasado há mais de 60 minutos. A conferência é de hora em hora. | {{Administrativo}} | Avise o suporte técnico. | Sozinho, quando a fila volta a andar. |
| **Provedor de e-mail sem retorno** · crítico · com justificativa | O provedor de e-mail não deu nenhum retorno (entrega, devolução ou spam) de pelo menos 3 envios aceitos há mais de 2 horas. Enquanto isso, o Vela não fica sabendo das entregas nem das devoluções. | {{Administrativo}} | Avise o suporte técnico. | Sozinho, no primeiro retorno do provedor. |
| **Rotina agendada com resposta de erro** · crítico · com justificativa | Uma rotina terminou com erro, sem resposta ou por tempo esgotado na última hora. O alerta mostra o horário, não o nome da rotina. | {{Administrativo}} | Passe o horário ao suporte técnico. | Sozinho, quando a última hora fica sem falha. |
| **Portal do Cliente — falha no reprocessamento**, de um retorno de e-mail · crítico · com justificativa | Um retorno do provedor de e-mail não pôde ser ligado a um envio do Vela depois de 6 tentativas, ou serve a mais de um envio. | {{Documentação}} | Peça ao suporte técnico que confira o envio no provedor. | Só com justificativa. |

::: atencao
Nos três primeiros, a justificativa tira o alerta da fila por 24 horas, mesmo que a causa continue. Justifique só depois de o suporte técnico assumir o caso.
:::
