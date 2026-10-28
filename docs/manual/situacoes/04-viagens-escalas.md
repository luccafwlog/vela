# Capítulo 4 — Viagens e Escalas: situações

Catálogo do capítulo 4 do sumário final (destino `Op 4`, área Viagens). Formato
e regras em [README](README.md). Rascunho de 2026-10-28, montado a partir das
regras da matriz; ainda não conferido pelo dono.

## Quem faz

Qualquer setor cria e edita Viagem, escala e programação, omite escala, marca
COD e reverte omissão com motivo (ACE-085, ACE-086, VIA-066). Remover uma
Atracação é de Operações e do Administrativo (ACE-120, VIA-042). Cancelar,
reativar e excluir Viagem e excluir escala são do Administrativo (ACE-087,
VIA-020, VIA-025, VIA-048).

## Quero fazer…

| Nº | Objetivo | Regras |
|---|---|---|
| Q4.01 | Cadastrar uma Viagem nova | VIA-011 a VIA-014, VIA-017 |
| Q4.02 | Planejar as escalas da Viagem e o que cada uma opera | VIA-029, VIA-030, VIA-033, VIA-035 |
| Q4.03 | Atribuir os terminais e registrar a atracação (ETB, ATB, ETD, ATD, Restow) | VIA-032, VIA-038 a VIA-041, VIA-047, VIA-143 |
| Q4.04 | Atualizar as datas do navio (ETA e ATA) | VIA-034, VIA-127, VIA-128 |
| Q4.05 | Acompanhar a Viagem: Próxima escala, Conciliação, Linha do tempo | VIA-005, VIA-007 a VIA-010, VIA-027 |
| Q4.06 | Registrar que o armador omitiu uma escala | VIA-057 a VIA-060, VIA-063 |
| Q4.07 | Mudar o destino de um B/L afetado (COD) ou voltar ao transbordo | VIA-065 a VIA-068, FAT-136, FAT-137 |
| Q4.08 | Conferir e corrigir o ATD do porto de embarque (POL) | VIA-055, VIA-056 |
| Q4.09 | Concluir a Viagem | VIA-016, VIA-019 |
| Q4.10 | Cancelar, reativar ou excluir uma Viagem (Administrativo) | VIA-020 a VIA-026 |
| Q4.11 | Excluir uma escala do planejamento (Administrativo) | VIA-048 a VIA-050 |

## Aconteceu…

### Ao cadastrar ou editar a Viagem

#### S4.01 — "Já existe a viagem NAVIO / NÚMERO"

- **O que o sistema faz:** recusa o cadastro. Se a existente está cancelada,
  diz "Reative-a em Viagens em vez de cadastrar outra.".
- **Por quê:** cada navio e número de viagem existe uma vez; o IMO vale mais
  que a grafia do nome.
- **O que você faz:** abra a Viagem existente. Se ela está cancelada e deve
  voltar, peça ao Administrativo **Reativar viagem**.
- **Regras:** VIA-013, VIA-024.

#### S4.02 — "Navio … com IMO conflitante"

- **O que o sistema faz:** recusa quando o nome é de um navio cadastrado com
  outro IMO; dois navios com o mesmo nome e sem IMO pedem o IMO.
- **Por quê:** o IMO identifica o navio; nome parecido não junta navios
  diferentes.
- **O que você faz:** confira o IMO com o armador e informe o certo.
- **Regras:** VIA-014.

#### S4.03 — O navio ficou com outro nome ou outro armador

- **O que o sistema faz:** navio achado pelo IMO mantém o nome cadastrado
  (a grafia digitada não renomeia), mas recebe o armador digitado, que passa a
  valer para todas as Viagens do navio. Abreviações como "CS" viram "COSCO
  SHIPPING".
- **Por quê:** o cadastro de navio e armador é um só para todas as Viagens.
- **O que você faz:** nada, se o navio é o mesmo. Não há tela de navio nem de
  armador: a correção é pela Viagem.
- **Regras:** VIA-014, VIA-135.

### Ao salvar a escala

#### S4.04 — "Com o ATA registrado, toda frente de operação precisa de terminal"

- **O que o sistema faz:** recusa salvar com frente em **TBC** depois do ATA,
  e recusa datas e Restow na linha TBC.
- **Por quê:** TBC é só "terminal a confirmar"; depois que o navio chegou, cada
  operação tem terminal.
- **O que você faz:** escolha o terminal de cada frente e salve.
- **Regras:** VIA-038, VIA-143.

#### S4.05 — A escala pede justificativa

- **O que o sistema faz:** pede **Justificativa da alteração** quando você
  muda algo já registrado: terminal de uma frente, ATB, ATD, Restow ou a
  exportação. Mudar **BLs e CEs** à mão pede sempre. Preencher campo vazio e
  mudar previsões não pedem.
- **Por quê:** o que já aconteceu no porto só muda com motivo registrado.
- **O que você faz:** escreva o motivo; ele aparece na Linha do tempo.
- **Regras:** VIA-043, CEB-039.

#### S4.06 — "Alteração bloqueada por ADR fechado"

- **O que o sistema faz:** não grava nada que afete o terminal com ADR de
  Saída fechado e oferece **Reabrir ADR**. ETA, ATA e previsões continuam
  editáveis.
- **Por quê:** o ADR fechado é o registro final da operação no terminal.
- **O que você faz:** reabra o ADR com motivo (qualquer setor), corrija a
  escala e feche o ADR de novo (capítulo 11).
- **Regras:** ACE-086, VIA-044, VIA-090.

#### S4.07 — "A escala foi atualizada por outra pessoa"

- **O que o sistema faz:** não grava; seus dados ficam na janela.
- **O que você faz:** anote o que digitou, recarregue a escala e salve de
  novo.
- **Regras:** VIA-045.

#### S4.08 — Não consigo tirar um terminal da escala

- **O que o sistema faz:** tirar o terminal de todas as frentes remove a
  Atracação dele. Só Operações e o Administrativo removem, e a remoção é
  recusada ("Atracação travada: …") quando o terminal tem B/L com CE Mercante,
  documento financeiro ou ADR fechado.
- **O que você faz:** peça a Operações ou ao Administrativo. Com trava,
  resolva a causa antes (por exemplo, reabrir o ADR).
- **Regras:** ACE-120, VIA-042, ALE-047.

#### S4.09 — Não consigo retirar a exportação da escala

- **O que o sistema faz:** com Granito importado ou Embarque de vazios aberto
  no porto, o botão fica com cadeado ("Há carga vinculada…").
- **O que você faz:** a declaração só sai depois que a carga de exportação
  deixar de existir (capítulo 10).
- **Regras:** VIA-036, EQU-097.

### Datas do navio

#### S4.10 — O ETA passou e o navio não chegou

- **O que o sistema faz:** a escala continua como Próxima escala, com "ETA
  vencido" em âmbar, e abre o alerta "ETA de … passou sem ATA registrada." no
  próprio dia.
- **O que você faz:** se o navio chegou, registre o **ATA** com hora; se
  atrasou, atualize o **ETA**.
- **Regras:** VIA-009, VIA-127, VIA-128.

#### S4.11 — Mudei o ETA: o que muda e o que não muda

- **O que muda sozinho:** Próxima escala e ordem das Viagens; Line Up;
  Chegadas e Saídas e Portal (se publicada); alertas de data; prazos D−7 e
  D−5 (B/Ls esperados, Baplie, CE Mercante); alerta de B/L sem Cliente perto do
  ETA; janela do Comunicado de Chegada Próxima (NOA).
- **O que não muda:** a Taxa Local (preço fixado no dia da importação do B/L)
  e a Demurrage (corre pela descarga de cada container).
- **Regras:** VIA-127, VIA-132, VIA-133, ALE-043.

#### S4.12 — A Viagem ficou Concluída sozinha (ou voltou a Ativa)

- **O que o sistema faz:** conclui a Viagem quando toda escala ativa tem
  atracação com ATD, ao salvar a escala. Omitir ou excluir a última escala
  pendente também conclui; reverter a omissão reabre. Concluída, ela sai de
  Chegadas e Saídas, do Portal e do Line Up padrão.
- **O que você faz:** se concluiu antes da hora, confira se falta registrar
  uma escala ou atracação; salvar a escala recalcula.
- **Regras:** VIA-016, VIA-019, VIA-130, VIA-131.

#### S4.13 — O ATD do porto de embarque está errado

- **O que o sistema faz:** o ATD do POL é o menor Laden on Board dos B/Ls
  ativos daquele porto e muda quando B/Ls entram, saem ou são cancelados.
- **O que você faz:** corrija em **Rotas e Manifestos › Editar**. O ATD
  digitado vence o calculado e a saída confirmada em Chegadas e Saídas; apagar
  o ATD digitado volta ao calculado. Atenção: se o Nº de Manifesto da mesma
  janela for recusado, as datas já ficaram gravadas.
- **Regras:** VIA-054, VIA-055, VIA-056, VIA-109, BLR-044.

#### S4.14 — O status BLs e CEs da escala mudou sozinho

- **O que o sistema faz:** recalcula **Aguardando**, **Recebido** e
  **Aprovado** pela conciliação documental a cada importação e substitui até o
  que foi marcado à mão. **Lançando** e **Em aprovação** só existem à mão.
- **O que você faz:** nada, se o cálculo bate. A marcação manual pede
  justificativa e vale até a próxima mudança calculada.
- **Regras:** VIA-037, CEB-038, CEB-039.

### Omissão, transbordo e COD

#### S4.15 — O armador omitiu a única escala brasileira que estava cadastrada

- **O que o sistema faz:** a janela diz "Nenhuma outra escala brasileira nesta
  viagem. Cadastre antes a escala onde a carga será descarregada."
- **Por quê:** o Porto de Transbordo é outra escala da mesma Viagem.
- **O que você faz:** **Adicionar escala** do porto onde a carga desce e omita
  depois.
- **Regras:** VIA-058.

#### S4.16 — Omiti a escala por engano

- **O que o sistema faz:** **Reverter omissão** (qualquer setor, com
  justificativa) desfaz e avisa os Clientes ("Correção de omissão de escala");
  a omissão fica no histórico. É recusado se algum B/L afetado está em COD.
- **O que você faz:** reverta antes o COD de cada B/L (**Reverter para
  transbordo**) e depois a omissão.
- **Regras:** VIA-064, VIA-068.

#### S4.17 — Os dados do navio de transbordo chegaram depois

- **O que o sistema faz:** **Complementar** no cartão **Informações de
  Transbordo** grava para todos os B/Ls afetados e atualiza o Portal, sem nova
  notificação.
- **Regras:** VIA-063.

#### S4.18 — Um B/L foi importado depois da omissão

- **O que o sistema faz:** se o POD é o porto omitido, o B/L entra sozinho como
  afetado, em Transbordo.
- **Regras:** VIA-062, BLR-045.

#### S4.19 — Marquei COD num B/L já faturado

- **O que o sistema faz:** recalcula a Taxa Local no novo destino. Faturado,
  abre um **Ajuste de COD**: sem pagamento, reemissão; com pagamento, fatura
  complementar (valor maior) ou abatimento/restituição (valor menor). O B/L
  sai do Manifesto Mercante do porto omitido (o CE não muda) e o Cliente é
  avisado. Taxa em dólar sem câmbio fixado recusa o COD.
- **O que você faz:** confira o aviso da janela; o Ajuste de COD é liquidado
  pelo Financeiro (capítulo 24). Com taxa alterada à mão, a janela pergunta
  **Gravar mesmo assim**.
- **Regras:** VIA-066, VIA-067, VIA-145, FAT-136, FAT-137.

#### S4.20 — Reverti o COD e o B/L ficou sem Manifesto

- **O que o sistema faz:** o POD original volta, mas o vínculo com o Manifesto
  Mercante não volta sozinho.
- **O que você faz:** em **Rotas e Manifestos › Ver B/Ls**, mova o B/L para o
  Manifesto da rota (capítulo 6).
- **Regras:** VIA-068, CEB-049.

#### S4.21 — Cliquei em Marcar COD (ou Reverter para transbordo, ou Complementar) e nada aconteceu

- **O que o sistema faz:** quando o sistema recusa essas três ações, a tela
  não mostra nenhum aviso: a ação simplesmente não acontece. Na omissão e na
  reversão da omissão aparece só uma mensagem genérica.
- **Pergunta aberta P4:** sem mensagem, o manual não tem como dizer o que
  fazer. Leitura do código em 2026-10-28: `useSetBlDisposition`
  (`src/hooks/useTransshipments.ts`) não trata o erro, e o tratamento geral só
  registra a falha para a equipe técnica.
- **Regras:** VIA-070.

### Cancelar e excluir

#### S4.22 — "A Viagem tem fatura viva ou baixa"

- **O que o sistema faz:** recusa cancelar a Viagem enquanto algum B/L tem
  fatura viva (inclusive paga ou coberta), Invoice de Demurrage não cancelada
  ou baixa.
- **O que você faz:** o Financeiro ou o Administrativo resolve B/L a B/L
  (cancelar fatura, cancelar baixa, Restituição) e o Administrativo cancela a
  Viagem depois.
- **Regras:** VIA-021, FAT-156, DEM-118.

#### S4.23 — A Viagem não pode ser excluída

- **O que o sistema faz:** recusa antes de abrir a janela, com o motivo: B/L
  com CE Mercante, documento financeiro, ADR de Saída fechado, Granito com CE
  ou faturado, comunicado enviado ao Cliente.
- **O que você faz:** cancele a Viagem em vez de excluir. Excluir é para a
  Viagem criada por engano, sem nada oficial.
- **Regras:** VIA-025, VIA-026.

#### S4.24 — A escala não pode ser excluída

- **O que o sistema faz:** recusa com B/L ligado ao porto ("existem B/Ls
  vinculados") ou com trava (CE, documento financeiro, ADR fechado).
- **O que você faz:** se o navio não foi ao porto, **Omitir escala** registra
  o que aconteceu. Excluir é para a escala cadastrada por engano.
- **Regras:** VIA-048, VIA-049.

#### S4.25 — A Viagem cancelada não deixa mudar nada

- **O que o sistema faz:** tudo fica somente leitura ("operação selada e
  somente leitura"); só o status de Demurrage é recalculado. Os alertas do ADR
  da Viagem cancelada continuam abertos e só saem com a exclusão da Viagem.
- **O que você faz:** se o cancelamento foi engano, o Administrativo usa
  **Reativar viagem** com motivo.
- **Regras:** VIA-023, VIA-024, ALE-085.

## Perguntas abertas

| Nº | Situação | Pergunta |
|---|---|---|
| P4 | S4.21 | **Marcar COD**, **Reverter para transbordo** e **Complementar** falham sem nenhum aviso, e omitir ou reverter omissão mostra só uma mensagem genérica. A tela deve mostrar o motivo da recusa? |
