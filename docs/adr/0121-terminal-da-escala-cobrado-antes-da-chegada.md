# 0121 — Terminal da escala cobrado antes da chegada

Status: aceito — 2026-11-04 (decisões do dono sobre as seis recomendações da
[revisão do vínculo de terminal](../archive/audits/2026-11-04-revisao-vinculo-terminal-escala.md):
"concordo com as recomendações"). Implementada na migration `584` e nas telas
Painel, Visão geral da Viagem, Editar escala e Disparo de Comunicados.

Estende a [ADR 0109](./0109-frente-de-operacao-exige-terminal-ate-o-ata.md) (o
ATA continua sendo o prazo da frente; agora há cobrança antes dele e fora de
Editar escala) e cumpre a [ADR 0067](./0067-nob-automatico-ancorado-na-frente-de-operacao.md)
no que ela decidiu e o código não fazia: o alerta do NOB fica aberto enquanto
há carga sem terminal. Mantém a [ADR 0068](./0068-terminal-do-bl-herdado-da-frente-com-excecao-individual.md).

## Contexto

Com o uso real do sistema (2026-11-03), o dono pediu o mapa do vínculo entre a
escala e o terminal: os Comunicados dependem dele, e não pode haver Viagem com
escala, B/Ls e CEs sem um terminal com as datas certas. A revisão achou que o
terminal só era cobrado tarde:

- na gravação de Editar escala depois do ATA;
- em "Data da escala pendente", quando nenhum terminal tinha ETB;
- no Fechar ADR.

O ATA confirmado em Chegadas e Saídas passava sem a trava. A frente que a tela
deriva dos B/Ls, enquanto ninguém grava Editar escala, não existe para o banco,
e o NOB dela não saía sem aviso. Nada impedia ATB anterior ao ATA.

## Decisão

1. **Alerta "Escala sem terminal"** (`voyage_escala_terminal_missing`), crítico,
   de Operações, por escala.
   - **Quando abre:** no 5º dia antes do ETA da escala, pelo dia de Brasília, ou
     com o ATA, quando alguma frente está sem terminal. Contam as frentes
     gravadas em TBC e as que o banco deriva da carga, a mesma conta que trava o
     Fechar ADR. Também abre quando uma Atracação tem ATB e nenhuma frente.
   - **No ATA:** o ATA muda o marco e notifica de novo.
   - **Quando fecha:** quando toda frente tem terminal, com a escala excluída ou
     omitida, ou com a Viagem cancelada.
2. **ATA fora de Editar escala é aceito.** O ATA confirmado em Chegadas e
   Saídas e o da escala nova não são recusados: o navio chegou, e o NOR depende
   desse fato. Quem cobra o terminal é o alerta da decisão 1. Editar escala
   continua recusando gravar com frente em TBC depois do ATA (ADR 0109).
3. **NOB sem terminal no alerta** (cumpre a ADR 0067).
   - Com ATB em algum terminal da escala nos últimos 30 dias,
     "Comunicado NOB pendente" ganha um item da escala com os Clientes cujos
     B/Ls não pertencem a nenhuma Atracação: frente sem terminal, ou B/L misto
     com carga cheia e carga solta em terminais diferentes e sem exceção.
   - O item fecha quando todo B/L ganha terminal.
   - A conferência do Disparo manual mostra esses Clientes, em vez de
     escondê-los.
4. **ATB não é anterior ao ATA.** O banco recusa, em qualquer caminho, com
   "ATB anterior ao ATA da escala: o navio atraca depois de chegar ao porto.
   Corrija o ATA ou o ATB do terminal <terminal>.". Corrigir os dois na mesma
   gravação passa. O ETB anterior ao ETA só gera aviso na janela, sem recusa:
   é o caso comum do armador que atrasa o navio.
5. **Onde a equipe vê.**
   - O Painel mostra "TBC" em âmbar e tem o filtro "Sem terminal", pela mesma
     conta do banco.
   - A Visão geral da Viagem ganha a coluna de terminal na linha da escala.
   - O Line-Up TV só exibe.
6. **Datas do terminal.**
   - Depois do ATA, cada terminal sem ETB (e ainda sem ATB) é cobrado em
     "Data de terminal pendente".
   - O item da escala que pedia o ETB fica para a escala sem terminal nenhum
     e sem frente a atribuir.

A dúvida sobre o NOB da carga em transbordo no Porto de Transbordo (D6 da
revisão) ficou para ouvir a Documentação; nada muda nela.

## Consequências

- A falta de terminal aparece cinco dias antes da chegada, para Operações, com
  a lista das frentes. Antes, aparecia só no Fechar ADR, depois da saída.
- A carga importada depois que os terminais foram escolhidos entra no alerta
  na rodada de 15 minutos; a gravação de Editar escala o refaz na hora.
- As reconciliações de data da escala rodam no fim da transação. Assim, a
  gravação de Editar escala não abre e fecha alerta no meio, com Notificação
  Interna.
- A Atracação já gravada com ATB anterior ao ATA só é recusada na próxima
  gravação da escala.

> **Nota de 2026-11-04 (revisão da release staging → main).** O plano de desfazer
> do cabeçalho da migration `584` manda reaplicar `reconcile_inactive_voyage_alerts`
> "pela 346"; a definição anterior à `584` é a da migration `468`, que inclui a
> planilha de Veículos (`voyage_vehicle_sheet_pending`). Desfazer pela `346` tiraria
> esse tipo da reavaliação das Viagens concluídas.

Regra vigente: [Viagens](../modules/viagens.md#escala-atracação-e-datas),
[Clientes](../modules/clientes.md#régua-automática-de-comunicados) e
[Operação e Suporte](../modules/operacao-suporte.md#alertas-e-notificações-internas).
