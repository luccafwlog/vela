Cada situação do Vela tem um nome e uma cor, e as cores seguem a regra de [1.4](01-o-vela.md#14-como-o-vela-fala): âmbar pede ação, vermelho venceu, falhou ou bloqueia, verde está concluído ou pago, cinza encerrou sem efeito e azul só informa. "Sem cor" quer dizer o texto normal da tela. Os quadros abaixo dão, para cada coisa que o Vela acompanha, o nome exato na tela, a cor e o que a leva até ali.

## Viagem

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Ativa** | azul | O cadastro da Viagem ([4.1](04-viagens-escalas.md#41-cadastrar-uma-viagem)), ou **Reativar viagem**. |
| **Concluída** | verde | Sozinha, quando toda escala não omitida tem atracação com ATD; ou à mão, em **Editar** ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)). Se uma escala volta a ficar sem ATD, a Viagem volta sozinha a **Ativa**. |
| **Cancelada** | vermelho | **Cancelar viagem**, pelo {{Administrativo}} ([4.8](04-viagens-escalas.md#48-encerrar-cancelar-ou-excluir)). |
| **Faturamento encerrado** (selo) | verde | Todo B/L ativo da Viagem está pago ou isento das Taxas Locais. |

A **Conciliação** da Viagem tem o mesmo nome e a mesma cor nos cartões, na lista e na ficha ([4.5](04-viagens-escalas.md#45-acompanhar-a-viagem)):

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Divergente** | vermelho | O Baplie e os B/Ls não batem ([6.8](06-importacao.md#68-resolver-as-divergências-entre-baplie-e-bl)). |
| **Pendente** | âmbar | Falta CE Mercante em algum B/L. |
| **Conciliada** | ponto verde nos cartões das Viagens; sem cor na lista e na ficha | Nada falta. |
| **Verificando** | cinza | A Viagem tem todos os CEs, mas o Vela ainda confere as divergências do Baplie; depois, vira **Conciliada** ou **Divergente**. |

## Escala

| Na tela | Cor | O que leva a ela |
|---|---|---|
| Faixa verde no Line Up (**Atracado**, no cartão da tela estreita) | verde | O ATB de um terminal, enquanto falta o ATD dele. |
| **Omitida** | âmbar na ficha da Viagem; cinza no Line Up e em Chegadas e Saídas | **Omitir escala** ([4.7](04-viagens-escalas.md#47-quando-o-armador-omite-uma-escala)); **Reverter omissão** desfaz. |
| Data em âmbar | âmbar | A previsão passou e ninguém confirmou; só no Vela, o Cliente vê uma previsão comum. |
| **TBC — pendente** (frente em **Editar escala**) e "N em TBC" | âmbar | Frente sem terminal ([4.3](04-viagens-escalas.md#43-atribuir-os-terminais)); com todas atribuídas, "Todas atribuídas", em verde. |

## B/L

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Cancelado** (selo na ficha) | vermelho | **Cancelar B/L**, pelo {{Administrativo}}; **Reativar B/L** desfaz ([7.8](07-ficha-do-bl.md#78-cancelar-reativar-ou-excluir-um-bl)). |
| **Sem cliente vinculado** (coluna **Cliente** da lista) | âmbar | A importação não achou Cliente com o CNPJ do consignatário; sai com o vínculo ([8.2](08-revisao.md#82-cadastrar-ou-vincular-o-cliente)). |
| Etapa vermelha no trilho **Documental** da ficha | vermelho | O que bloqueia a fatura: Cliente, Taxas Locais ou CE; a etapa **Fatura**, quando a última foi cancelada ([7.1](07-ficha-do-bl.md#71-ler-a-ficha-do-bl)); e a etapa **Demurrage**, quando a Invoice de Demurrage do B/L já faturado espera o Portal do Cliente ficar pronto ou a Liberação ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)). |

Nas listas de **BLs**, de **Containers** e na ficha do Cliente, a coluna **Taxas locais** resume a cobrança do B/L:

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Pendente** | âmbar | Qualquer B/L sem fatura que não é isento, mesmo com as taxas já calculadas. |
| **Emitida** | sem cor | A fatura saiu (B/L faturado, parcialmente pago ou pago). |
| **Isenta** | cinza | O B/L é isento: veículo entregue em LCL ou isenção à mão (capítulo 21). |

## CE Mercante

Na escala, **BLs e CEs** diz em que pé está a documentação no Mercante ([4.2](04-viagens-escalas.md#42-planejar-as-escalas)):

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Aguardando** | âmbar | O começo, até os B/Ls cobrirem a carga da escala. |
| **Recebido** | âmbar na ficha da Viagem; sem cor no Line Up | Os B/Ls cobrem todos os containers cheios do Baplie (na carga solta, chegou um B/L). |
| **Lançando** e **Em aprovação** | âmbar na ficha da Viagem; sem cor no Line Up | Só à mão, com justificativa. |
| **Aprovado** | sem cor | Tudo recebido e CE em todos os B/Ls ativos. |

## Fatura de Taxas Locais

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Emitida** | sem cor | A emissão: sozinha com o CE, ou por **Emitir fatura** ([18.9](18-o-que-muda-sozinho.md#189-emitir-ou-cancelar-uma-fatura)). |
| **Parcialmente paga** | sem cor | Uma baixa menor que o saldo (capítulo 24). |
| **Paga** | ✓ verde | A baixa do saldo inteiro: pelo Pix, pelo extrato ou à mão (capítulo 24). |
| **Coberta** | ✓ verde | Foi paga a consolidada que inclui os B/Ls dela (capítulo 22). |
| **Cancelada** | cinza | **Cancelar fatura**, pelo {{Administrativo}}, ou a correção do B/L que a reemitiu. A consolidada que deixou de valer aparece como **Cancelada** nas listas e como **Obsoleta** no detalhe (capítulo 22). |

**Cancelar baixa** devolve a **Paga** a **Emitida** ou **Parcialmente paga** (capítulo 24).

## Invoice de Demurrage

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Faturado** | sem cor | A Invoice nasce assim, quando o último container do grupo volta ([9.6](09-containers-e-demurrage.md#96-saber-quando-a-invoice-de-demurrage-sai)). |
| **Em disputa** | âmbar | O Cliente abriu uma Disputa no Portal; volta a **Faturado** quando ela é resolvida ([9.9](09-containers-e-demurrage.md#99-decidir-a-disputa)). |
| **Pago** | ✓ verde | A baixa do Pix ou o pagamento registrado (capítulo 23). |
| **Cancelado** | cinza | O cancelamento pelo {{Administrativo}}, ou a reemissão quando as datas, o SOC/COC ou a divisão de um container mudam, ou quando o Cliente do B/L muda ([18.8](18-o-que-muda-sozinho.md#188-mudar-as-datas-de-um-container)). |
| **Fora da Régua** (ao lado da situação) | âmbar | As datas, o SOC/COC ou a divisão de um container mudaram numa Invoice com pagamento, desconto ou Disputa aberta ([23.9](23-demurrage-no-financeiro.md#239-cancelar-uma-invoice-e-gerar-outra)). |

## Container na Demurrage

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **No free time** | sem cor | Descarregado e dentro do free time ([9.4](09-containers-e-demurrage.md#94-ler-a-situação-de-demurrage)). |
| **Em atraso** | âmbar | Sem devolução e com mais dias desde a descarga do que o free time; a virada do dia é marcada às 00h17. |
| **Devolvido** | cinza | A devolução foi gravada. |
| **Não se aplica (SOC)** | cinza | Container do Cliente: não volta ao armador. |

Na **Visão geral** da ficha do B/L, a mesma situação aparece num selo colorido: **No free time** em verde, **Em atraso** em vermelho e **Devolvido** em cinza.

## Divisão da Demurrage

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Correndo** | US$ em âmbar | Container do grupo fora e passado do free time ([9.5](09-containers-e-demurrage.md#95-acompanhar-a-demurrage-dos-containers)). |
| **A emitir** | US$ em âmbar | Todos voltaram e há Demurrage sem Invoice. |
| **Esperando** | US$ em âmbar | Container devolvido com Demurrage espera outro do grupo, ainda no free time. |
| **Travado** | US$ em vermelho | O Vela não tem como cobrar: tipo sem tarifa, B/L sem Cliente ou cancelado, sem CE Mercante ou com o Portal segurando o faturamento. |

## Disputa de Demurrage

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Aberta** | sem cor | O Cliente abriu no Portal, ou a equipe reabriu ([9.8](09-containers-e-demurrage.md#98-responder-a-uma-disputa)). |
| "Aguarda a nossa resposta" | âmbar | A vez é da equipe. Vencido o prazo de 1 dia útil, a linha inteira fica âmbar, com "Prazo venceu em …". |
| "Aguarda o Cliente" | cinza | A equipe respondeu e escolheu **Aguardar Cliente**. |
| **Resolvida** | sem cor | A equipe escolheu **Encerrar pendência (Ninguém)** ([9.9](09-containers-e-demurrage.md#99-decidir-a-disputa)). |
| **Cancelada** | cinza | A Invoice foi cancelada, e a Disputa foi encerrada junto. |

## Conta do Portal

A conta tem duas leituras independentes: a **situação** do acesso e a **decisão** da equipe ([14.1](14-portal-a-conta.md#141-ler-a-fila-do-provisionamento-do-portal)). As cores são as da coluna **Conta** do Provisionamento do Portal.

| Situação | Cor | O que leva a ela |
|---|---|---|
| **Sem conta** | âmbar | O Cliente novo; também **Reativar a conta** e **Revogar o convite** ([14.4](14-portal-a-conta.md#144-acompanhar-o-convite-até-a-ativação) e [14.8](14-portal-a-conta.md#148-suspender-ou-reativar-a-conta)). |
| **Ativação pendente** | sem cor | O convite foi aceito pelo provedor de e-mail ([14.3](14-portal-a-conta.md#143-convidar-o-cliente)). |
| **Convite expirado** | âmbar | 48 horas sem ativação. |
| **Falha no envio** | vermelho | O provedor recusou o convite, ou o endereço devolveu o e-mail. |
| **Ativa** | sem cor | O Cliente definiu a senha. |
| **Suspensa** | âmbar | **Suspender a conta** ([14.8](14-portal-a-conta.md#148-suspender-ou-reativar-a-conta)). |

A decisão passa de **Aguardando análise** a **Provisionamento autorizado** quando o convite é enviado. Conta **Ativa** com a análise reaberta aparece como "Análise reaberta; a conta continua ativa até nova decisão".

## Solicitação de Desbloqueio de CE

| No Vela | Cor | O que leva a ela |
|---|---|---|
| **Em análise** | sem cor | Um documento aprovado e nenhum recusado; ou a validada perdeu um requisito ([12.10](12-desbloqueio-de-ce.md#1210-quando-algo-muda-depois-do-pedido)). |
| **Correção solicitada** | âmbar no detalhe da solicitação e na ficha do Cliente; sem cor na fila de análise | A agência recusou um documento ([12.3](12-desbloqueio-de-ce.md#123-analisar-os-documentos-de-uma-solicitação)). |
| **Documentação validada** | sem cor | Os quatro requisitos cumpridos em todos os B/Ls ([12.1](12-desbloqueio-de-ce.md#121-entender-o-desbloqueio-de-ce)). |
| **Cancelado** | cinza | O Cliente ou a agência cancelou ([12.9](12-desbloqueio-de-ce.md#129-cancelar-uma-solicitação)). |

No Portal, o Cliente lê **Enviada**, **Correção pedida** e **Cancelada**, e o **Rascunho** e a **Correção pedida** ficam em âmbar para ele.

Na tela do Desbloqueio, a coluna **Na ZPT** diz em que pé está cada B/L ([12.2](12-desbloqueio-de-ce.md#122-ler-a-tela-desbloqueio-de-ce)):

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Não exportado** | cinza | Falta algum requisito. |
| **Apto, não exportado** | sem cor, em negrito | Os quatro requisitos cumpridos; falta exportar ([12.6](12-desbloqueio-de-ce.md#126-exportar-os-bls-aptos-para-a-zpt)). |
| **Desbloqueado** | ✓ verde | A conciliação mostrou o CE desbloqueado na ZPT ([12.7](12-desbloqueio-de-ce.md#127-conciliar-com-a-zpt)). |
| **Divergente** | vermelho | Exportado, mas a ZPT ainda mostra o CE bloqueado. |
| **CE alterado: reconferir**, **Cliente alterado**, **Troca de Cliente**, **B/L cancelado** | âmbar | Algo mudou no B/L depois do pedido ([12.10](12-desbloqueio-de-ce.md#1210-quando-algo-muda-depois-do-pedido)). |

## Alerta

| Na tela | Cor | O que leva a ela |
|---|---|---|
| **Crítico** | vermelho | A gravidade vem do tipo do alerta (capítulo 20); o **Normal** fica sem cor. |
| **Entrega alternativa** (selo no sino) | âmbar | Alerta crítico sem ninguém ativo na equipe dele: o aviso foi ao {{Administrativo}} ([20.3](20-alertas.md#203-acompanhar-o-sino)). |
| **ETA próximo** (selo na fila) | âmbar | B/L sem Cliente a 5 dias do ETA do porto ([20.5](20-alertas.md#205-documentação-e-importação)). |

## ADR de Saída

| Na tela | Cor | O que leva a ela |
|---|---|---|
| Seção **Pendente** | âmbar | Toda seção começa assim, e volta a ela se alguém a reabre ([11.2](11-adr-de-saida.md#112-conferir-as-seções-da-sua-equipe)). |
| Seção **Confirmado** ou **Nada a declarar** | sem cor | A equipe dona resolveu a seção. |
| "N de 3 departamentos assinados" | âmbar até as três | Cada assinatura de equipe ([11.3](11-adr-de-saida.md#113-assinar-pela-equipe)). |
| **Sem terminal (TBC)** (aviso na seção e no bloco **ADR**) | âmbar | Frente da escala sem terminal, inclusive a que nasceu depois; o ADR não fecha até ela ganhar terminal ([11.5](11-adr-de-saida.md#115-fechar-e-imprimir-o-adr)). |
