# Correções decididas pelo dono (fichas da Etapa 1 e pontos de 2026-10-27)

## Estado

Proposto em 2026-10-27. O dono aprovou a lista e decidiu o conflito de
ACE-D01 (opção A) no mesmo dia.

| Lote | Situação |
|---|---|
| 1 | Executado em 2026-10-27 (migration `469`, [ADR 0104](../adr/0104-marca-dev-e-chave-de-envio-pelo-suporte.md)); falta conferir em staging um envio redirecionado chegando à caixa do suporte |
| 2 | Executado em 2026-10-27 (migration `470`, [ADR 0105](../adr/0105-bl-misto-cobra-taxas-por-bl-da-carga-solta.md)); conferido no Postgres local e nos testes de tela, falta conferir as telas em staging |
| 3 | Executado em 2026-10-27 (migration `471`); conferido no Postgres local e nos testes de tela, falta conferir em staging com um Pix real |
| 4 | Executado em 2026-10-27 (migration `472`); conferido no Postgres local e nos testes de tela, falta conferir em staging (anexos da Disputa pelo Storage e emissão retida pelo gate) |
| 5 | Executado em 2026-10-27 (migration `473`); conferido no Postgres local e nos testes de tela, falta conferir em staging (login com a verificação de segurança e convite pela ficha do B/L) |
| 6 | Executado em 2026-10-27 (migration `474`); conferido no Postgres local e nos testes de tela, falta conferir em staging (Base de Clientes por setor e Cobertura de viagens com envio redirecionado) |
| 7 | Executado em 2026-10-27 (migration `475`, [ADR 0106](../adr/0106-nome-do-autor-no-historico-para-todos.md)); conferido no Postgres local e nos testes de tela. Falta o Administrativo passar os usuários Operador para Documentação em Usuários (ACE-D13) e conferir em staging a tela de entrada de um usuário desativado |
| 8 | Executado em 2026-10-27 (migration `476`, ADRs [0107](../adr/0107-sino-so-do-setor-responsavel.md) e [0108](../adr/0108-fim-da-dispensa-de-alertas.md)); conferido no Postgres local e nos testes de tela; falta conferir em staging o sino de cada setor |
| 9 a 11 | Em execução |

**Revisão contra a staging (2026-10-27, até `c3be255`).** As mudanças que
entraram na staging depois do mapeamento (Baplie e Taicang, migration `465`;
lote da reunião de testes de 26/10, migrations `466` a `468`; correções da
revisão dele; telemetria do Sentry) não contrariam nenhuma decisão deste
plano nem os lotes 1 a 7. Mudam dois números do lote 8 (itens 3 e 6) e o
manual, já atualizado ([atualizações da matriz](../manual/README.md#atualizações-da-matriz)).

Junta numa lista só, em ordem de impacto, o que o dono decidiu:

- as 112 fichas de divergência do
  [mapeamento do Manual do Operador](../archive/reports/2026-10-26-mapeamento-manual-do-operador.md),
  decididas na [página de decisões](../manual/decisoes/README.md) (cópia em
  [`decisoes-2026-10-27.json`](../manual/decisoes/decisoes-2026-10-27.json));
- os quatro [pontos do dono fora das fichas](../manual/decisoes/pontos-do-dono.md)
  (fila de Alertas, sino, fim da dispensa, chave de envio com a marca Dev).

Cada ficha aparece uma vez, pela chave da página (`área:número`), com a opção
escolhida resumida. O caso, o efeito de cada opção e o detalhe técnico estão em
[`fichas.json`](../manual/decisoes/fichas.json).

## Como executar

- **Um lote, uma PR contra `staging`.** O lote é a unidade de aprovação e de
  teste; dentro dele, a ordem é livre. Lotes sem dependência entre si podem
  andar em paralelo.
- **ADR nova** quando o lote muda uma regra registrada (marcado "ADR" na
  tarefa). A ADR antiga ganha o banner "Situação atual".
- **Documento vivo** do módulo corrigido na mesma PR; o arquivo de cobertura da
  área (`docs/manual/cobertura/`) também, para o manual sair do comportamento
  novo. `npm run manual:coverage` continua passando.
- **Evidência** conforme `AGENTS.md` (§ "Verify the claim you will make"): as
  correções de banco pedem `migrations:check` e `rpc:check` e o teste
  `*.local-pg.test.ts` da regra; as de tela, teste do componente ou da página.
- **Migration que reescreve dados** declara no cabeçalho que se apoia no
  "Data status" do `AGENTS.md` (casos marcados "dados").
- O Manual do Operador descreve o sistema como está até cada lote sair; ao
  sair, a área correspondente do manual é atualizada.

## Decisão sobre ACE-D01 e contatos (2026-10-27)

"Ninguém deve ter impedimento de ação em Comunicações" (`ACE-D01`) conflitava
com `06-clientes-comunicacao:D10` (absorve ACE-D14) e `ACE-D04`, que restringem
contatos. O dono escolheu a opção A: todos os setores leem tudo em
Comunicação, disparam Comunicado e salvam modelo; editar contatos e Caixas de
Comunicação continua só de Administrativo, Documentação e Equipamentos. A
chave de envio fica só com a marca Dev (ponto 4).

## Lote 1 — Chave de envio e marca Dev (antes de Clientes reais)

Impacto: alto. Hoje convite e senha do Portal saem ao destinatário real mesmo
com a chave desligada. [Ponto 4](../manual/decisoes/pontos-do-dono.md).

1. Marca **Dev** no usuário; o usuário continua no Administrativo. Tela de
   Usuários mostra "Administrativo · Dev". ADR. Atribuição decidida pelo dono
   em 2026-10-27:
   - por migration, com a lista de e-mails que recebem a marca:
     `lucca.juliatti@fwlog.com.br`, o mesmo em produção e em staging. A
     migration marca as contas da lista que existem no ambiente e ignora as
     que não existem (aviso no log);
   - nenhuma tela dá ou tira a marca e o banco recusa a alteração por
     usuário logado, inclusive do Administrativo (coluna sem INSERT/UPDATE
     para `authenticated`, como `account_kind` na migration `440`); dar ou
     tirar a marca depois é outra migration, por PR;
   - cada mudança grava linha em Admin › Histórico de ações com o motivo
     (`audit_user_profile_changes` e `vela.access_change_reason`);
   - a marca só vale com a conta ativa e no Administrativo; sem ninguém com a
     marca, a chave fica como está até nova migration.
2. `set_communications_enabled` passa a exigir a marca Dev; a tela só oferece
   a chave a quem tem a marca. ADR (a mesma).
3. Chave desligada redireciona todo e-mail dirigido a Cliente para
   `suporte@portalfwlog.com.br`: Comunicados, Régua de Cobrança, avisos do
   Desbloqueio de CE, e-mails de eventos do Portal, convite, recuperação e
   redefinição de senha, troca de e-mail de recuperação. E-mail para a equipe
   (resumo diário do Portal) não passa pela chave. ADR (a mesma).
4. Assunto "[Teste → e-mail do Cliente]" e linha no topo com o Cliente que
   receberia; supressão e bounce do endereço do suporte não marcam o contato
   do Cliente.
5. Envio redirecionado conta como enviado em Cobertura, Régua e alertas; a
   tela troca "Em simulação" por "Redirecionado ao suporte".
6. `ACE-D01`: todo setor lê o estado real da chave e o intervalo da Régua
   (hoje Financeiro e Operações veem "Em simulação" e 7 dias), dispara
   Comunicado e salva modelo; contatos e Caixas seguem com três setores
   (decisão acima). Atualizar a linha "Editar contatos e Caixas de
   Comunicação; disparar Comunicado" da matriz.
7. Atualizar [serviços externos](../operations/servicos-externos.md) (destino
   do redirecionamento), `clientes.md`, `portal-cliente.md`, a matriz de
   permissões e a cobertura das áreas 01, 06 e 07.

## Lote 2 — Taxas Locais e faturamento

Impacto: alto (valor cobrado e fatura emitida).

- `09b-faturamento:FAT-D10` — faturamento automático pula B/L cuja última
  fatura foi cancelada por uma pessoa.
- `09b-faturamento:FAT-D15` — "Tentar aplicar correção" também na fatura sem
  pagamento e no B/L de consolidada; ajustar o texto de "Aguardando
  reemissão".
- `09a-taxas-locais:TAX-D13` — travar mudança de POD e modo em tabela já
  usada; para mudar, criar tabela nova.
- `09a-taxas-locais:TAX-D14` — B/L misto: sem taxa por B/L no container,
  cobrar todas as taxas por B/L da carga solta; atualizar regra e ajuda do
  formulário. Muda regra de cálculo: registrar em `taxas-locais.md`.
- `09a-taxas-locais:TAX-D17` — recalcular quando a modalidade muda.
- `09a-taxas-locais:TAX-D16` — manter o motivo original da linha em revisão.
- `09b-faturamento:FAT-D12` — consolidada mostra B/L sem CE Mercante como não
  elegível, com o motivo.
- `09b-faturamento:FAT-D09` — tirar B/L cancelado da Validação.
- `09a-taxas-locais:TAX-D08` — Histórico do B/L guarda os eventos de taxa e
  mostra o refixar em texto legível.
- `09a-taxas-locais:TAX-D09` — esconder Calcular taxas e cobrança manual no
  B/L cancelado.
- `09a-taxas-locais:TAX-D04` — tirar Granito do formulário de tabela.
- `09a-taxas-locais:TAX-D07` — tirar "Categoria na fatura" do formulário (ou
  dar o rótulo do que ela faz).
- `09a-taxas-locais:TAX-D18` — aba Condições mostra a recusa como a aba
  Tabelas.
- Textos de tela: `TAX-D01` (Condição pelo dia em que o B/L entrou),
  `TAX-D02` (só B/Ls que já usavam a Condição), `TAX-D03` (câmbio e preço
  fixados na entrada do B/L, quatro textos), `TAX-D11` ("Condição de Cliente"
  e situação de cada uma), `TAX-D15` (Revisão orienta corrigir o B/L),
  `FAT-D11` (exemplo `INV-2026-0018`), `FAT-D13` (Cancelar baixa e
  Restituição), `FAT-D16` (itens manuais da tabela).

## Lote 3 — Recebimento e Pix

Impacto: alto (dinheiro recebido e devolvido).

- `10-recebimento:3` — Pix que falha ao gravar vira Pix recebido em análise
  (ou aparece em Pendências); Pix de fora do Vela não abre alerta.
- `10-recebimento:12` — devolução de Pix em duplicidade conta o próprio Pix
  como lastro, nos quatro casos.
- `10-recebimento:11` — conciliação pelo extrato tira o Pix da análise e fecha
  o alerta, como na Demurrage.
- `10-recebimento:1` — Pix em análise mostra o identificador do Pix (com
  copiar) e o VELA… como "Identificador da cobrança".
- `10-recebimento:7` (absorve ALE-D16) — texto da regra Restituição pendente
  lista todos os casos, inclusive Invoice de Demurrage.

## Lote 4 — Demurrage

Impacto: alto.

- `11-demurrage:DEM-D13` — Invoice de Demurrage exige CE Mercante e Gate de
  faturamento do Portal aberto, como as faturas.
- `11-demurrage:DEM-D06` — Portal mostra o dólar com desconto.
- `11-demurrage:DEM-D01` — anexos da Disputa com link para baixar, no Vela e
  no Portal.
- `11-demurrage:DEM-D08` — Invoice reemitida cita a Invoice cancelada.
- `11-demurrage:DEM-D05` — aviso da PTAX pela data de Brasília e só pelo
  recálculo da PTAX.
- `11-demurrage:DEM-D09` — passar as Invoices "vencidas" para emitidas
  (dados).
- `01-acesso-admin:ACE-D08` — as quatro planilhas de Demurrage com datas
  dd/mm/aaaa e os rótulos da tela.

## Lote 5 — Portal do Cliente

Impacto: alto (o que o Cliente vê e consegue fazer).

- `07-portal:POR-D13` — troca de e-mail pela equipe e liberação do endereço
  também emitem as faturas retidas.
- `07-portal:POR-D07` — login mostra a mensagem da verificação de segurança e
  a de rede.
- `07-portal:POR-D04` — link de redefinição vencido mostra "Link inválido ou
  expirado" e leva a pedir outro.
- `07-portal:POR-D06` — notificação de disputa abre Faturamento → Demurrage.
- `07-portal:POR-D12` — ficha do B/L separa "o Cliente vê o B/L" de "Portal
  pronto para faturar"; convite só quando é aceito e a quem pode enviar.
- `03-bl-revisao:BLR-D06` — esconder o convite fora de Documentação e
  Administrativo e traduzir a recusa (junto com POR-D12).
- `07-portal:POR-D01` — convite recusado mostra o motivo (junto com POR-D12).
- `07-portal:POR-D02` — Espiadinha aplica o filtro de omissão vigente.
- `07-portal:POR-D03` — consolidada desfeita aparece como "Desfeita pelo
  cliente pelo portal."
- `07-portal:POR-D05` — limite diário de troca de e-mail com a mensagem
  própria.
- `07-portal:POR-D11` — Refazer consolidada apagado no Modo Inspeção.

## Lote 6 — Clientes, contatos e Comunicados

Impacto: alto (quem recebe o e-mail do Cliente).

- `06-clientes-comunicacao:D10` (absorve ACE-D14) — Base de Clientes e
  Revisão só incluem ou mudam contatos para Administrativo, Documentação e
  Equipamentos; os demais importam só o cadastro.
- `01-acesso-admin:ACE-D04` — inclusão de contato fora das telas só para os
  mesmos três setores.
- `06-clientes-comunicacao:D14` — Cliente com único contato em bounce salva
  contatos com aviso, e o contato é liberado quando o e-mail muda.
- `06-clientes-comunicacao:D18` — verificação do alerta conta só contatos
  ativos.
- `06-clientes-comunicacao:D15` — prévia da Base avisa Cliente desativado e não
  conta sugestão como vínculo.
- `06-clientes-comunicacao:D02` — Cobertura mostra e conta simulado e parcial
  (com o lote 1, "simulado" passa a ser "redirecionado").
- `06-clientes-comunicacao:D03` — Cobertura tira B/L cancelado.
- `06-clientes-comunicacao:D05` — Cobertura só cobra NOA e NOR com a janela
  aberta.
- `06-clientes-comunicacao:D01` — recusar contato sem e-mail no cadastro, com
  aviso.
- `06-clientes-comunicacao:D08` — sistema recusa CNPJ de dígitos repetidos.
- `06-clientes-comunicacao:D07` — e-mail digitado na Revisão grava origem
  "Cadastrado pela equipe".
- `06-clientes-comunicacao:D12` — tirar do modo Institucional o Cliente sem
  contato. Muda regra: registrar em `clientes.md`.
- `06-clientes-comunicacao:D09` — renomear o botão para "Trocar Cliente".
- `06-clientes-comunicacao:D04` (absorve ALE-D10) — dois textos para "a cada
  2 minutos e logo após o evento".

## Lote 7 — Acesso, usuários e Histórico

Impacto: médio.

- `01-acesso-admin:ACE-D06` — fechar ao Administrativo a leitura do Histórico
  de ações, falhas de entrega e Prazo do ADR, como a decisão registrada.
- `01-acesso-admin:ACE-D16` — nome do autor no Histórico para todos os
  setores.
- `01-acesso-admin:ACE-D03b` — tela de entrada explica usuário desativado.
- `01-acesso-admin:ACE-D12` — reativação grava uma linha só, no assunto
  Usuário, com nome e motivo.
- `01-acesso-admin:ACE-D15` — inatividade contada por todas as abas juntas.
- `01-acesso-admin:ACE-D13` — passar os usuários Operador para Documentação
  pela tela de Usuários (ação do Administrativo, sem código).

## Lote 8 — Alertas e sino

Impacto: médio. [Pontos 2 e 3](../manual/decisoes/pontos-do-dono.md).

1. Sino só para o setor responsável pelo item; alerta crítico sem ninguém
   ativo no setor continua indo ao Administrativo. Exceção decidida pelo dono
   em 2026-10-27: os quatro tipos com o Financeiro na audiência (PIX sem
   conciliação segura, Consulta de Pix do Itaú parada, Restituição pendente e
   Fatura desatualizada) continuam avisando também o Financeiro (P5 da ADR
   0085). ADR.
2. Alerta resolvido sai do sino e do número sem marcar como lido. ADR (a
   mesma).
3. Retirar a dispensa: botão, janela, lente e cartão Dispensados, coluna
   "Dispensado até", Eco da dispensa, "N dispensados" no Painel, filtro
   `dismissed` das RPCs, frase de dispensa das 51 regras (50 no mapeamento;
   a 51ª é Planilha de Veículos pendente, migration `468`). Dispensas
   vigentes acabam na hora (dados). O histórico das dispensas fica guardado. ADR.
4. Mapear os tipos cuja origem a equipe não consegue corrigir e dar a eles
   "Resolver com justificativa" (reabrem se a causa voltar).
5. `12-alertas-rotinas:ALE-D03` — tela de Regras mostra só o setor
   responsável (com o item 1, deixa de haver setor só notificado).
6. `12-alertas-rotinas:ALE-D13` (absorve ACE-D03) — matriz de Usuários com 5
   e 4 tipos para Operações e Equipamentos (Equipamentos ganhou Planilha de
   Veículos pendente, migration `468`, e deixou de receber o Pix com o item
   1), conferida depois do item 1.
7. `12-alertas-rotinas:ALE-D05` e `ALE-D12` — alertas levam à tela prometida
   e os de contato abrem a ficha do Cliente.
8. `12-alertas-rotinas:ALE-D06` — "Aberto em" com a data da abertura atual.
9. `12-alertas-rotinas:ALE-D08` — justificativa e autor da resolução em
   Histórico de ações.
10. `12-alertas-rotinas:ALE-D17` — número de Alertas do menu se atualiza
    sozinho.
11. `12-alertas-rotinas:ALE-D18` — Resolver mostra o motivo da recusa (a parte
    de dispensa sai com o item 3).
12. Textos: `ALE-D04` (Registro: Cliente), `ALE-D11` (caso das 14h).
13. `12-alertas-rotinas:ALE-D07` deixa de valer: a dispensa sai.

## Lote 9 — Viagens e escalas

Impacto: alto em parte (Viagem que não conclui).

- `02-viagens-adr:13` — frente de operação vinculada a terminal obrigatória
  até o ATA; "TBC não é terminal". Resolve a Atracação TBC vazia que segura a
  conclusão. ADR.
- `02-viagens-adr:14` — omitir, reverter omissão e excluir escala recalculam
  o status da Viagem.
- `02-viagens-adr:2` (absorve ACE-D02) — todos os setores gravam terminal,
  ATB, ATD e Restow; Operações também troca o terminal de uma frente. Segue a
  regra registrada.
- `02-viagens-adr:5` — aceitar o nome padrão no cadastro e impedir que a
  edição de uma Viagem renomeie o navio. Corrige a regra em `viagens.md`.
- `02-viagens-adr:15` — recusar Porto de Transbordo igual ao porto omitido.
- `02-viagens-adr:4` — selo "Faturamento encerrado" com todos os B/Ls quitados
  ou isentos.
- `02-viagens-adr:6` e `02-viagens-adr:7` — janela da escala e aba ADR
  mostram o motivo de cada recusa.
- `02-viagens-adr:10` — faixa do Line Up conta escalas.
- `02-viagens-adr:3` — textos de omitir e reverter.

## Lote 10 — B/L, Revisão, CE Mercante, Baplie e Equipamentos

Impacto: médio, com dois altos (CEB-D03 e CEB-D10).

- `04-ce-baplie:CEB-D10` — resultado da planilha de CE lista por B/L o
  faturado, retido ou pulado, com motivo.
- `04-ce-baplie:CEB-D03` — conferência do CE diz que o reenvio do Comunicado
  fica pendente (alerta).
- `04-ce-baplie:CEB-D01` — recusar Mover de B/L sem CE.
- `04-ce-baplie:CEB-D04` — alerta de cobertura do Baplie ignora B/L
  cancelado.
- `04-ce-baplie:CEB-D13` — divergência própria "cheio no B/L, vazio no
  Baplie". Muda regra: registrar em `manifesto-edi.md`.
- `03-bl-revisao:BLR-D01` — tirar B/L cancelado da fila e do número da
  Revisão.
- `03-bl-revisao:BLR-D07` — motivo da recusa e formulário travado em B/L
  cancelado.
- `03-bl-revisao:BLR-D12` — prévias só impedem trocar o consignatário com o
  B/L faturado.
- `03-bl-revisao:BLR-D02` — filtro que mostra os B/Ls cancelados.
- `03-bl-revisao:BLR-D05` — Manifesto BB de volta na Importação rápida.
- `05-equipamentos:EQU-D7` — planilha de datas recusa linha de B/L cancelado.
- `05-equipamentos:EQU-D11` — Viagem cancelada recusa Cama e linhas de
  serviço no Embarque de vazios.
- `04-ce-baplie:CEB-D05` — conferência da planilha de CE mostra a nota de
  Portal.
- Textos: `BLR-D03`, `BLR-D04`, `CEB-D02`, `CEB-D06`, `CEB-D12`.

## Lote 11 — Desbloqueio de CE

Impacto: médio (alto no item VIP, que muda quem é cobrado).

- `08-desbloqueio-ce:4` — termo anual cobre todo CE com desbloqueio
  solicitado dentro da vigência, sem olhar importação do B/L nem vínculo do CE.
  Substitui a regra da migration `449` (vigência pela data de importação).
  ADR.
- `08-desbloqueio-ce:5` — documentos de desbloqueio visíveis a todos os
  setores também na Inspeção.
- `08-desbloqueio-ce:2` — ficha do Cliente lista também as solicitações VIP.
- `08-desbloqueio-ce:13` — texto "não pode ser cancelado depois de exportado"
  e regra registrada.
- Textos: `08-desbloqueio-ce:1`, `08-desbloqueio-ce:17`.
- Só documento: `08-desbloqueio-ce:3` (o anual fica até um ano depois da
  vigência) e `08-desbloqueio-ce:11` (exceção do e-mail explicada no manual).

## ADRs previstas

1. Marca Dev e chave de envio que redireciona ao suporte (lote 1; ADR 0104).
2. Sino só do setor responsável e alerta resolvido fora do sino (lote 8).
3. Fim da dispensa de alertas (lote 8).
4. Frente de operação vinculada a terminal até o ATA (lote 9).
5. Cobertura do termo anual VIP pela data da solicitação (lote 11).
6. B/L misto cobra as taxas por B/L da carga solta quando o container não tem (lote 2; ADR 0105, acrescentada na execução porque TAX-D14 muda a decisão 4 da ADR 0069).

## Arquivos

- Decisões: [`docs/manual/decisoes/`](../manual/decisoes/README.md).
- Mapeamento por área: [`docs/manual/cobertura/`](../manual/cobertura/).
- Plano do manual: [Manual do Operador](2026-10-26-manual-do-operador.md).
