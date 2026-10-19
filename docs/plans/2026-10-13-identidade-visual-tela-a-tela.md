# Identidade visual — migração tela a tela

Data: 2026-10-13. Decisão: [ADR 0081](../adr/0081-identidade-visual-unica.md).
Regras e peças: [identidade visual](../identidade-visual.md).

## Estado

- **Base entregue em 2026-10-13** (branch `claude/trusting-cerf-bkwctp`):
  tokens (fundo neutro liso, neutros frios, títulos em DM Sans, Syne só no
  nome "Vela"), tema FWLOG do Portal, botão `ghost` com borda, peças comuns
  (`Block`, `LeadValue`, `FactList`, `IdentityBand`, `NextAction`, `NoValue`,
  grupos de colunas), `npm run design:check` com linha de base e
  `a11y:contrast` no CI. Nenhuma tela foi reorganizada.
- **Ficha do B/L entregue em 2026-10-13** (tela 1), a partir do exemplo
  aprovado na página da identidade. Ver o registro abaixo.
- **Passada única em 2026-10-13** (ver a seção própria): tabela padrão,
  identificador sem sublinhado, vazio discreto, copiar identificador e ação
  como botão em todas as telas. Os lotes seguem só para a organização.
- **Lote 1 entregue em 2026-10-14** (as cinco telas e as abas da ficha do
  Cliente), na ordem Lista de BLs, ficha da Viagem, ficha do Cliente, Taxas
  Locais (Faturas e Validação) e Portal · Faturas, com os defeitos anotados
  corrigidos. Ver o registro abaixo. **Correção do mesmo dia:** a primeira
  entrega foi registrada como completa, mas o passe item a item contra a
  página aprovada achou itens faltando (sobretudo nas abas da ficha do
  Cliente); foram feitos na entrada "Lote 1 · passe completo" do registro, que
  lista também o que ficou de fora de propósito. A tabela limpa (uma linha de título, sem texto
  sob a célula, sem quebra nem "…", situação em texto) virou regra 5 e 6 em
  [identidade-visual.md](../identidade-visual.md) e entra nas demais telas
  pelos lotes. Mudanças do lote 1 que valem fora dele: ✓ de "Paga" e ícone de
  "Consolidada" em toda tela que os mostra, e "Abrir disputa" no detalhe da
  fatura de Demurrage do Portal (tela do lote 4).
- **Documentos impressos adiantados em 2026-10-14** (tela 20, PR 939, feita
  como etapa 13 do plano arquivado e trazida para este): o visual dos
  documentos fica como está, por decisão do responsável de 2026-10-13 (barras
  âmbar de total, cabeçalho de tabela azul-marinho, título centralizado com
  filete, bloco de dados do Cliente em tabela e bloco Pix; um redesenho foi
  feito e reprovado). Entraram só regras de impressão e de comportamento. Ver
  o registro abaixo.
- **Abas que faltavam no lote 1, propostas em 2026-10-15:** o lote 1
  reorganizou só a Visão geral das fichas do B/L e da Viagem. Por decisão do
  responsável de 2026-10-15, o lote 1 só se encerra com as outras oito abas
  (Carga, Detalhes do B/L, Faturamento e Histórico do B/L; Importação,
  Exportação, Rotas e Manifestos e ADR da Viagem) e com as pendências de
  verificação do lote 1; o lote 2 começa depois. As oito propostas estão numa
  página só ("Abas do lote 1", na conta do responsável), com capturas da
  `main` de 2026-10-15. Aprovadas e implementadas em 2026-10-15 (ver o
  registro): Carga, Detalhes do B/L, Faturamento e Histórico do B/L; Importação
  e Exportação na opção A (a tabela proposta foi recusada) e Rotas e
  Manifestos; o ADR em 2026-10-15, com a linha do tempo em painel e registro.
  **Lote 1 encerrado em 2026-10-15**, com as pendências resolvidas: o tema
  escuro foi retirado do sistema por decisão do responsável (não tinha
  seletor na tela e não fora aprovado), e as telas seguintes não são mais
  conferidas no escuro. O lote 2 é o próximo.
- **Lote 2 proposto em 2026-10-15** numa página só ("Lote 2 da identidade",
  na conta do responsável), com capturas da `main` de 2026-10-15 no ambiente
  local: Revisão, Chegadas e Saídas com a programação do Portal, Demurrage
  (abas, detalhe da Invoice) e as Tarifas de Demurrage, Containers, Veículos,
  Baplie, a faixa de viagens (lista de Viagens, Veículos e Baplie) e a lista
  de Clientes. Achados fora da mudança visual, encontrados na proposta e
  corrigidos no próprio lote (ver "Demais telas" abaixo): a faixa de viagens diz "Ordenado por
  próxima escala" mas só a lista de Viagens ordena; o cartão da faixa nunca
  mostra "Divergente" (`buildVoyageRailItems` calcula sem as divergências
  abertas); a barra do topo diz "N demurrages vencidos", contra a regra B29;
  Exportar em Veículos leva só a página na tela.
  **Revisão, 2026-10-16:** aprovada a fila em tabela com uma linha por
  Cliente. O grupo aberto se adapta ao caso, sem a janela lateral "Revisar
  B/L" (decisão do responsável): nome lido sem CNPJ mostra os dados brutos do
  B/L (linha do consignatário e descrição da carga); CNPJ lido leva ao
  cadastro, com o Portal provisionado no mesmo passo se o operador quiser;
  Cliente cadastrado com Portal pendente põe o foco no provisionamento. Os
  exemplos por caso (A a G: nome sem CNPJ, CNPJ lido, CNPJs divergentes,
  Portal, peso, outra pendência, Granito) estão na rodada 2 da mesma página;
  C a G aprovados em 2026-10-16. Na mesma data saíram "Corrigir dados" e a
  janela lateral (a correção do B/L fica na ficha do B/L), e A e B voltaram
  em rodada 3 com o cadastro reorganizado e o Portal do Cliente como escolha
  visível. **Regra de negócio decidida em 2026-10-16, fora da mudança
  visual:** B/L cujo único CNPJ lido (em qualquer campo) é de um Cliente ativo
  é vinculado automaticamente. Até então a importação só vinculava pelo CNPJ
  do campo do manifesto (`findMatchedCustomer` em `blFreightImport.ts`), e o
  B/L com o CNPJ só no texto do consignatário ou na descrição caía na Revisão.
  Entregue em 2026-10-16 (PR 967, branch `claude/vinculo-automatico-cnpj`).
  **Revisão aprovada em 2026-10-16** com as respostas da rodada 3: no
  cadastro, o Portal do Cliente não vem marcado (o botão só libera depois da
  escolha); no caso D, as ações do Provisionamento (autorizar e enviar,
  reenviar convite, usar outro e-mail) ficam na própria Revisão; a Liberação
  de faturamento sem Portal fica só na ficha do Cliente.
  **Demais telas, respostas de 2026-10-16** (comentários na página):
  aprovadas **Demurrage** (aba Containers com uma linha por B/L) e
  **Tarifas** (inativas atrás de "Mostrar inativas", desligado por padrão,
  também nos Acordos), e os **quatro achados** são corrigidos neste lote
  (ordem da faixa nas três telas, "Divergente" no cartão, "N containers em
  atraso" na barra do topo e Exportar de Veículos com o recorte inteiro).
  Voltaram em rodada 2 na mesma página: Chegadas e Saídas (a ordem fica Saída
  na origem e depois Chegada no Brasil, por ser a cronológica; âmbar para
  previsão passada nas duas; a seta do navio vira "Ver no mapa"; faltava a
  proposta do Portal), Containers (sem cartão por tipo, tipo em filtro; lacre
  fora da tabela), Veículos (uma linha por veículo; "Definir local de
  desova" sempre à vista), Viagens (tabela de viagens quando nenhuma está
  escolhida; o rodapé do cartão fica o de hoje) e Clientes (Desativar só na
  ficha e coluna Portal com todas as situações aprovados; Provisionamento e
  Comunicação não podem virar botões discretos). Baplie aguarda resposta (a
  aplicação do IMO/OOG é automática; o aviso é a hipótese de falha). **Regra
  de negócio proposta na mesma rodada:** número da Invoice de Demurrage
  sequencial por ano (`DEM-2026-0001`), como a fatura de Taxas Locais, no
  lugar de `DEM-<AAAAMMDDHHMMSSmmm>-<B/L>` (migration `278`); aprovada na
  rodada 2, abaixo.
  **Rodada 2 aprovada em 2026-10-16:** Chegadas e Saídas com o Portal
  (Saída antes da Chegada, âmbar nas duas, botão "Ver no mapa"), Containers,
  Veículos (a janela de desova oferece marcados, todo o recorte e só os sem
  local), Baplie, Viagens (tabela com BB e Veículos; cartão inteiro como hoje)
  e Clientes (abas). Também aprovados o número `DEM-AAAA-NNNN` e, como padrão
  do sistema, as abas não selecionadas com fundo sombreado.
- **Lote 2 entregue em 2026-10-16** (PR 969, branch
  `claude/practical-cray-mpdw1p`; a Revisão na branch
  `claude/sweet-turing-r2tdp1`): todas as telas aprovadas, os quatro achados,
  o número `DEM-AAAA-NNNN` (migrations `293` e `294`) e as abas sombreadas. A
  revisão da PR corrigiu os defeitos que achou (migrations `294` e `295`) e
  adiantou, na Comunicação, a troca das abas internas por um controle
  segmentado, para não repetir as abas de Clientes (a tela 16 segue no lote
  5). Ver o registro. Falta conferir em runtime: capturas em 1440, 768 e
  360 px e as migrations `293` a `295` no Supabase remoto. O lote 3 é o
  próximo.
- **Lote 3 proposto em 2026-10-16** numa página só ("Lote 3 da identidade",
  na conta do responsável), com capturas da `main` de 2026-10-16 (depois da
  PR 969) no ambiente local, com dados de teste acrescentados só para a
  captura (pagamentos, cobrança Itaú ligada, exceções do extrato, condições de
  Cliente e solicitações de Desbloqueio de CE): detalhe da fatura de Taxas
  Locais, Tabelas e Condições de Cliente, Conciliação PIX (três abas) e
  Desbloqueio de CE (Solicitações, Controle ZPT e o detalhe). Achados fora da
  mudança visual, propostos para correção no próprio lote: a fatura
  individual se chama "Única BL" no detalhe e no Histórico de baixas e
  "Individual" no filtro; a nota dos itens diz "Origem: Auto" e a coluna
  mostra "Calculado"; a conferência do extrato diz "Nenhum documento aberto
  usa este TXID" para linha sem TXID (Pendências diz "Linha sem TXID no
  extrato"); fatura inexistente mostra "Invoice N nao encontrada"; a
  planilha do Histórico de baixas tem cabeçalhos técnicos ("Nº Documento",
  "Tipo Doc.", "Valor BL", "Status"); o seletor "50 por página" corta o
  texto; `#a85309` escrito direto no prazo e no aviso do modelo do
  Desbloqueio de CE. Aguarda a resposta do responsável, tela a tela.
  **Respostas de 2026-10-16** (comentários na página): no detalhe da
  fatura, Registrar pagamento atrás de botão, o bloco Cancelar fatura some
  para quem não é Administrativo e sai o "Nº interno"; nas Tabelas, cartões
  no lugar do seletor; nas Condições de Cliente, fica a coluna Valor da
  tabela com a diferença; na Conciliação PIX, "Identificador do Pix" no
  lugar de "TXID", o Histórico só com o resumo na faixa do bloco e a tela
  abrindo no Histórico de baixas; no Desbloqueio de CE, documentos recusados
  ou revogados em âmbar, os ícones de hoje nas colunas dos requisitos,
  Navio / Viagem e POD fora da linha mas no filtro e numa exportação comum
  em planilha (nova, separada da planilha da ZPT), e entrega do B/L original
  em massa. Voltaram em rodada 2 na mesma página: o detalhe da fatura (B/Ls e
  itens lado a lado deixariam espaço em branco; agora um embaixo do outro, e
  a fatura de um B/L só leva o B/L no bloco Saldo), os nomes das situações
  das Tabelas (não ficou claro o sentido; proposta "Em uso no cálculo",
  "Ativa, mas não usada" e "Desativada", com a explicação), a ordem das abas
  da Conciliação (Histórico, Pendências, Conciliar extrato) e, no Desbloqueio
  de CE, os botões do topo (cada um no bloco do seu assunto), a seleção em
  qualquer B/L com "Registrar entrega de N B/Ls", a tabela de documentos do
  detalhe (o nome do arquivo abre o documento; um botão "Analisar" só onde há
  decisão) e o nome da segunda aba sem falar em ZPT ("Andamento dos B/Ls",
  sugerido). A rodada 2 refez as propostas de cada tela com as respostas
  aplicadas (a primeira versão só acrescentava blocos no fim de cada tela).
  **Lote 3 aprovado em 2026-10-16**, com a segunda aba do Desbloqueio de CE
  chamada "Andamento dos B/Ls".
- **Lote 3 entregue em 2026-10-16** (branch `claude/serene-edison-ibuix9`):
  as cinco telas aprovadas, os achados e a migration `296`. Ver o registro.
  A revisão da PR 970 corrigiu: o prazo do Desbloqueio de CE voltou a ser
  medido só pela exportação; a seleção guarda o B/L devolvido pela entrega;
  documento recusado volta a poder ser aprovado; "aberta em" pelo rascunho
  ou envio; Busca e POD com pausa e a planilha comum sem B/L repetido; o
  Histórico de baixas voltou a ter o Valor do B/L e o resumo diz "N faturas ·
  R$ X pagos"; a fatura indicada voltou ao Motivo das exceções do Pix; as
  Tabelas voltaram a avisar, com a linha fechada e no cartão "Com aviso", a
  tabela em uso sem item automático ou com vigência fora do período; a
  condição futura sem efeito avisa; e textos ("Aguardando reemissão",
  "Exportar para a ZPT", "ROE não registrado"). Falta conferir em runtime:
  768 e 360 px e a `296` no Supabase remoto. O lote 4 é o próximo.
- **Lote 4 proposto em 2026-10-17** (aprovado em 2026-10-18, abaixo) numa página só ("Lote 4 da identidade",
  na conta do responsável), com capturas da `main` de 2026-10-17 (depois da
  PR 970) no ambiente local, com o login do próprio Cliente (fora do Modo
  Inspeção) e dados de teste acrescentados só para a captura (B/Ls com
  containers em situações diferentes, faturas em todos os estados com Pix,
  uma consolidada, Invoices de Demurrage complementar, em disputa e paga com
  restituição, VIP com procuração anual recusada, cinco solicitações de
  Desbloqueio de CE e a programação de quatro navios): Painel, detalhe da
  fatura e Pix, Gerar fatura consolidada, Demurrage (disputa, complementar e
  recibo), BLs e Containers, Desbloqueio de CE do Cliente, Documentos anuais
  VIP (peça comum), Central de Informações e Perfil. Defeito achado, proposto
  para correção já, fora do lote: abaixo de 640 px a programação de navios do
  Painel do Portal não mostra nenhum navio (a regra que esconde os cartões
  vem depois da que os mostra, em `src/index.css`; lote 2). Achados fora da
  mudança visual, propostos para o lote: o requisito da procuração diz
  "coberta pela procuração anual VIP" com a procuração anual recusada; o
  recibo de Demurrage do Portal sai sem restituições e sem o aviso de
  complementar; motivos sem acento na consolidada ("ja liquidado"),
  "Conversas de Dispute", campo de arquivo do navegador em inglês e ".." no
  fim da notificação de correção; carga solta como "64.5t"; Situação cortada
  na aba Containers a 1440 px. Para decisão: o Saldo pendente de Faturas
  (R$ 48.916,94) soma B/Ls ainda sem fatura e o Painel não; a fatura
  parcialmente paga não lista os pagamentos no Portal. Não capturada: a ficha
  do Cliente com os Documentos anuais (o CNPJ do Cliente de teste tem dígito
  inválido). Aguarda a resposta do responsável, tela a tela.
  **Programação de navios no celular corrigida em 2026-10-18**, fora do lote
  (branch `claude/laughing-meitner-3rfy0l`): a regra do celular passou para
  depois da regra base, com teste de contrato em
  `src/__tests__/designSystemLote2.test.ts`; conferida no Painel do Portal a
  360 e 1440 px no ambiente local.
  **Programação de navios sem sobra em 2026-10-19**, a pedido do
  responsável (colunas espaçadas demais no Vela e no Portal, em qualquer
  largura): Chegadas e Saídas e o Painel do Portal ficam da largura da
  tabela, centralizados (`ScheduleWidthPage` em
  `src/components/portal/ShipScheduleWidget.tsx`); com mais portos a página
  alarga até a tela e daí a tabela rola. Só essas duas páginas; o resto do
  Vela e do Portal segue largo. Recusadas pelo responsável: a sobra no fim da
  linha e o bloco estreito com a página larga. "Ver no mapa" virou só o
  ícone de alfinete na tabela, com o nome no `title`; no cartão do celular
  fica o ícone com o texto. Conferida numa página local com
  dados fictícios, com 6 e 8 portos, a 1920, 1280 e 390 px; não capturada nas
  telas reais.
- **Lote 4 aprovado e entregue em 2026-10-18** (branch
  `claude/laughing-meitner-3rfy0l`, PR 972, junto com a correção do celular).
  O responsável aprovou todas as telas em três rodadas de comentários na
  página e decidiu: (1) o Portal só mostra Taxas Locais de fatura emitida e
  liberada ao Cliente, "exibir algo que não aparece pro cliente é falha grave
  de segurança" ([ADR 0088](../adr/0088-portal-so-mostra-fatura-emitida.md),
  migration `298`): o Saldo pendente do Portal deixou de somar recebível sem
  fatura e rascunho, a consolidação só lista e só aceita B/L faturado, e as
  telas dizem "Aguardando fatura" sem valor; (2) no Desbloqueio de CE, o B/L
  de solicitação ainda não validada pode ser pedido de novo e muda para a
  nova, com a antiga sem B/L cancelada e os documentos enviados de novo
  (caminho A, [ADR 0089](../adr/0089-desbloqueio-ce-bl-muda-de-solicitacao.md),
  migration `299`); (3) tracking com a marca `{BL}` no link do armador; (4)
  tudo na mesma PR. O "E-mail atual" do Perfil pediu a migration `300` (só a
  sessão do Cliente o recebe). Registro abaixo.
- **Lote 5 confirmado em 2026-10-19 e dividido em 5a e 5b** pelo
  responsável, para cada página de aprovação ficar do tamanho dos lotes
  anteriores. **5a:** Painel, fila de Alertas e Regras de alertas (13),
  Provisionamento do Portal, Comunicação e a faixa do Modo Inspeção (16).
  **5b:** Granito com as tarifas, Vazios de importação e Embarque de vazios
  (17), Relatórios e Administração com as cinco abas (18). O 5b é proposto
  depois do 5a.
- **Lote 5a proposto em 2026-10-19** numa página só ("Lote 5a da
  identidade", na conta do responsável), com capturas da `main` de
  2026-10-19 (depois das PRs 975 a 979) no ambiente local, a 1440 e 360 px,
  com o login interno de teste e dados acrescentados só para a captura (uma
  rodada dos detectores de alertas, uma dispensa e quatro Comunicados no
  Histórico). Achados fora da mudança visual, propostos para correção no
  próprio lote: (A1) o Painel não tem cartão do Administrativo, responsável
  por 10 dos 48 tipos de alerta; (A2) mensagens de alerta com texto técnico
  ("Cliente sem_cliente", "a viagem 10", a mesma frase genérica do Portal em
  toda linha, "migração 318" num aviso); (A3) o Provisionamento marca
  "Crítico" todo Cliente com alerta do tipo agrupado, o que inclui os
  normais (`portal_list_provisioning_console`, migration `250`); (A4) a fila
  do Provisionamento mostra o primeiro contato como e-mail de recuperação
  quando nenhum foi gravado, e a linha aberta diz "Em ordem" sem e-mail;
  (A5) "Sair da inspeção" sempre volta ao Provisionamento, mesmo aberta pela
  ficha do Cliente; (A6) "Reparo automático da fila do Portal durante a
  leitura." no Histórico do Portal.
  **Lote 5a aprovado em 2026-10-19**, em três rodadas de comentários na
  página. Decisões: **Painel** sem Atualizar; acessos a Chegadas e Saídas e
  à Tela TV como botões maiores com ícone e descrição (opção B); ETB mostra o
  ATB com ✓ quando registrado; celular em cartões com todas as informações
  da linha. **Alertas** abre em Ativos, sem "Todos" nem Atualizar; Mensagem
  e Registro não repetem nada (Mensagem só com o detalhe, "—" quando não
  há); toda linha com "Resolver" (leva ao lugar da resolução ou, nos alertas
  de conferência sem lugar, abre a justificativa) e "Dispensar", de largura
  fixa. **Regras** sem o código interno e o endereço da tela.
  **Provisionamento** com seis cartões, sem a coluna Decisão; ações
  administrativas numa janela, sem sair da tela; "Ver o que o Cliente veria"
  vira a coluna "Espiadinha", com só o ícone de olho na linha.
  **Comunicação** com duas colunas de CE e Taxas, Histórico em tabela, uma
  barra de abas de segundo nível (largura do bloco, ícone, a escolhida em
  azul-marinho) e o envio real como chave de ligar e desligar (peça comum
  nova `Switch`; a confirmação de hoje continua nos dois sentidos). **Faixa
  do Modo Inspeção** aprovada na rodada 1. **Achados:** todos corrigidos no
  lote, como sugerido. A2 reescreve também os alertas já abertos; A5, com a
  inspeção aberta em outra aba (a Espiadinha), o botão vira "Fechar
  inspeção"; A6 mostra "Entrou na fila do Portal", com "Sistema" na coluna
  Por.
  **Lote 5a entregue em 2026-10-19** (ver Registro). O 5b é o próximo.
- **Lote 5b proposto em 2026-10-19** numa página só ("Lote 5b da
  identidade", na conta do responsável), com capturas da `main` de
  2026-10-19 (depois da PR 986) no ambiente local, a 1440 e 360 px, com o
  login interno de teste e dados acrescentados só para a captura (um
  manifesto de Granito com seis B/Ls e quatro tarifas, dois manifestos de
  vazios de importação e um Embarque de vazios com unidades e serviços):
  Granito, Tarifas do Granito, Vazios de importação, Embarque de vazios,
  Locais (depots e terminais), Relatórios e as cinco abas da Administração.
  Achados fora da mudança visual, propostos para correção no próprio lote:
  no Granito, total da janela de taxas somando R$ e US$ como "BRL", busca
  sem CNPJ com máscara, filtro de porto exato, confirmações das tarifas
  falando em faturamento, "Fixo global" cobrado como "Por B/L", cache da
  Validação e erros crus; nos Vazios, local e serviço inativos aceitos no
  Embarque (tela e banco), ids internos em "Filtros ativos", POD sem campo,
  Nº de manifesto pedido por porto de origem e não por rota, "Embarque
  criado" para o já existente, planilha sem a Natureza, mensagens do banco
  sem acento e o local novo que não abre depois de criado; nos Relatórios,
  abas sem teclado (também na Administração), aviso de limite que nunca
  aparece (a tela espera 2.000 linhas e o servidor entrega 1.000), Por
  Cliente divergente do Financeiro, datas cortadas em UTC e sessão expirada
  tratada como falta de perfil; na Administração, o papel "Administrador"
  no texto dos perfis, "Produção" e "Operacional" fixos, "Última
  conciliação Pix" sempre vazia, rótulos das Métricas que não batem com o
  dado e "Sem prazo" para departamento que não assinou. Aguarda a resposta
  do responsável, tela a tela.
  **Granito, respostas de 2026-10-19** (comentários na página e na
  conversa): a tela mostra só os dados básicos, a quantidade de blocos e o
  peso (saem taxas, fase, pátio, recebimento dos blocos e CBM). **Regra de
  negócio decidida pelo responsável em 2026-10-19, fora da mudança visual:**
  o Granito não terá Cliente vinculado e serve só para totalizar a carga
  movimentada no navio. Consequência proposta na rodada 3 da página: a
  importação deixa de procurar Cliente, o Granito sai da Revisão e da
  Validação de Taxas Locais e o alerta "Revisão de Granito — cliente não
  vinculado" deixa de existir. **Granito aprovado em 2026-10-19** na
  rodada 3: peso real quando houver (senão o declarado) e saem do sistema a
  tela de Tarifas do Granito (`/granito/taxas` passa a levar ao Granito), o
  cálculo de taxas do Granito (também na Validação) e a importação de CE
  Mercante para o Granito; os dados gravados ficam no banco, sem uso.
- **Histórico da aprovação:** lote 1 (BLs, ficha da Viagem, ficha do Cliente, Taxas Locais
  e Faturas do Portal). As cinco propostas
  foram apresentadas em 2026-10-13 numa página só ("Lote 1 da identidade",
  republicada na conta do responsável e atualizada com as decisões abaixo) e
  aguardam a resposta do responsável, tela a tela: aprovado, ajustar ou
  recusado. Decisões pedidas:
  - **Lista de BLs** (aprovada em 2026-10-13, com as decisões abaixo):
    tabela sem faixa de grupos, com as colunas B/L, Cliente, Navio, Viagem,
    Trecho, Carga, CE Mercante e Taxas locais (só a situação; a coluna Fatura
    sai). Saem os cartões "Pendentes de revisão", "Prontos para faturar" e
    "Sem faturamento"; o resumo do recorte vira seis cartões de total (B/Ls,
    Contêineres, Volume, Carga solta, Taxas pendentes e Isentos), que
    acompanham os filtros. Carga solta aparece mesmo zerado. Taxas pendentes
    e Isentos filtram a lista ao toque; os outros só mostram o total.
    Cada pendência aparece uma vez só, na coluna em que se resolve: sai o
    "Revisão pendente" sob o número do B/L; B/L sem Cliente mostra, na coluna
    Cliente, o nome declarado no manifesto em cinza e "Sem cliente vinculado"
    (regra 5; "falta vincular" foi recusado por sugerir Cliente já cadastrado).
    A coluna Taxas locais mostra só três estados: **Pendente** (qualquer
    impeditivo à emissão da fatura de Taxas Locais ao Cliente; o motivo se
    trata na Revisão manual), **Emitida** (a fatura foi emitida) e
    **Isenta** (em cinza; o B/L nunca terá essa fatura). Os
    estados técnicos do cálculo (não calculado, revisão, calculado, pronto
    para faturar) não aparecem na lista; o cartão volta a "Taxas pendentes"
    e conta os Pendentes. Sai a coluna de botões no fim da linha: "Ver
    carga" passa à coluna Carga (o próprio "2 CNTR" abre a carga embaixo da
    linha); o menu ⋮ sai, Excluir fica só na seleção em lote e "Copiar
    número do B/L" vira um ícone ao lado do número, visível ao passar o
    mouse na linha ou ao receber o foco do teclado. O mesmo ícone vale para
    o CE Mercante e o CNPJ, em todas as telas: vira peça compartilhada
    (`CopyValue` em `src/components/ui`), que substitui as cópias feitas à
    mão em `Bls.tsx`, `BlDetalhe.tsx`, `ClienteFicha.tsx` e `Clientes.tsx`;
    na ficha do Cliente, "Copiar CNPJ" sai do menu. A carga aberta na linha
    ganha resumo (contêineres, COC/SOC, peso, CBM, devolvidos) e o atalho
    "Abrir na ficha do B/L"; a tabela de dentro usa cabeçalho claro (exceção
    à regra do cabeçalho azul-marinho, só para tabela dentro de tabela) e as
    colunas Contêiner (com copiar), Tipo, COC/SOC, Perfil, Lacre, Tara, Peso
    bruto, CBM, Descarga, Devolução e Demurrage. A RPC `operational_list_bls`
    já devolve a linha inteira de `bl_containers`; o tipo `BLListItem` é que
    precisa incluir `ownership`, `return_date` e `demurrage_status` (fora de
    `src/types/database.ts`, que é protegido). Carga solta mostra Máquinas,
    Packages, Peso e CBM como dados soltos, a tabela de itens quando houver e
    uma frase só quando não houver dado. Filtros sempre abertos: Busca, Viagem, POL e POD; Revisão,
    Faturamento, Taxas locais e Perfil de carga em "Mais filtros". Ao
    implementar, a regra 3 passa a dizer que os cartões aparecem quando a
    tela precisa deles.
  - **Regra de negócio, fora da mudança visual** (achado de 2026-10-13, por
    leitura do código): o cálculo das Taxas Locais roda sozinho e não depende
    do Cliente. Um B/L só fica "não calculado" se o cálculo falhar na
    importação e a nova tentativa também falhar, ou se a tabela encontrada
    não tiver cobrança que se aplique a ele; nesse segundo caso o resultado
    é zero cobranças sem aviso, e o bloqueio da fatura diz "Nenhuma tabela",
    o que está errado. Os B/Ls de teste COSU6401234505, 509 e 510 estão
    "não calculado" só porque `scripts/design-audit/seed_audit.sql` os cria
    assim.
  - **Ficha da Viagem** (aprovada em 2026-10-13): a tabela de atracações, dentro do Planejamento por
    escala, passa ao cabeçalho claro (regra de tabela dentro de tabela,
    decidida na lista de BLs). O bloco Contêineres inclui os vazios a
    descarregar, com os tipos (manifesto de Vazios de Importação, via
    `useVaziosImportacaoStats`). O Planejamento por escala, recusado na
    primeira proposta por confuso, fica na forma A: tabela com uma linha de
    cabeçalho e sem grupos; cada escala e cada atracação tem o seu botão
    Editar, com Omitir e Excluir dentro da edição;  uma seta no começo da linha,
    antes do porto, abre as atracações (escolhida entre seta, linhas sempre
    à mostra e atracações só dentro de Editar); as atracações abrem embaixo, em tabela de
    cabeçalho claro. Sem faixa de próxima ação (recusada pelo responsável);
    os Manifestos Mercante a informar seguem em âmbar no bloco Conciliação.
    Nenhum texto técnico na Linha do tempo: o evento de
    `pod_schedule_snapshot` (cópia interna da situação das escalas, que
    repete o "CE atualizado" do mesmo instante) sai, e campo da viagem sem
    rótulo em `TIMELINE_VOYAGE_FIELD_LABELS` (`src/services/voyageSummaries.ts`)
    nunca mostra o nome técnico nem o valor bruto. A ficha do B/L mantém a sua.
  - **Ficha do Cliente** (aprovada em 2026-10-14, Visão geral e as cinco
    demais abas): sem faixa de próxima ação, como na Viagem; a
    pendência fica no bloco do assunto (Portal sem conta no bloco Portal, com
    o motivo e os dois caminhos como botões). Na Atividade recente, só o
    identificador é link, sem sublinhado. Com mais de uma pendência, cada
    uma fica no bloco do seu assunto (Portal no bloco Portal, Demurrage no
    bloco Saldo pendente). A ficha do B/L mantém a faixa de próxima ação
    (`NextAction`); a recusa vale só para a Viagem e o Cliente.
    Demais abas (decisões de 2026-10-14, proposta revisada na mesma página,
    seção 3b, aprovada em 2026-10-14):
    - **Cadastro e contatos:** blocos Dados cadastrais (CNPJ só leitura,
      com copiar), Quem recebe os Comunicados (tabela das caixas),
      Contatos, Acesso ao Portal e o novo **Alterações do cadastro** (o que
      mudou, de, para, por quem, quando e justificativa, a partir de
      `audit_logs` e `customer_contact_change_events`). **Regra de negócio
      nova:** caixa sem destinatário recebe o contato principal gravado pelo
      sistema, sem pedir para salvar, registrado como "Feito pelo sistema";
      o aviso âmbar ao abrir a aba sai.
    - **BLs** (hoje "Operacional"): a aba muda de nome; colunas da lista de
      BLs aprovada (B/L, Navio / Viagem, Trecho, Carga, CE Mercante, Taxas
      locais com Pendente/Emitida/Isenta); saem Revisão, Faturamento e
      Criado em.
    - **Financeiro:** Faturas e Recebíveis viram um bloco só, uma linha por
      fatura com os B/Ls; o saldo por B/L abre na linha (▸); B/L com saldo
      sem fatura ativa vira linha "Sem fatura ativa". Busca por B/L,
      Situação e período de emissão; 20 por página; Taxas Locais e
      Demurrage num seletor do mesmo bloco. Pagamentos em tabela com a
      mesma busca e paginação. Na busca por B/L, a consolidada aparece
      inteira quando um dos B/Ls dela bate (confirmado em 2026-10-14).
    - **Histórico:** coluna "Por" (nome; "Sistema"; "—" quando o registro
      não guarda autor), filtro por assunto, coluna Assunto, sem texto
      técnico.
    - **Contêineres** (aba nova pedida e aprovada em 2026-10-14, entre BLs
      e Financeiro; seção 3b.6): uma linha
      por contêiner dos B/Ls do Cliente, com grupos Contêiner (número e
      B/L, tipo, COC/SOC), Datas (descarga, devolução, dias de uso até a
      devolução ou até hoje), Free time (dias e origem: tabela, acordo ou
      B/L; dentro do free time) e Demurrage (situação, valor, fatura).
      Mesmos dados e cálculo da tela Demurrage, só agrupados por Cliente.
      Busca por contêiner ou B/L, filtro de situação, período de descarga,
      20 por página. SOC entra na lista; botão Exportar com a planilha da
      lista filtrada. Versão limpa pedida em 2026-10-14 (a primeira foi
      recusada por excesso de texto, quebras e cortes): oito colunas
      (Contêiner, B/L, Tipo, Descarga, Devolução, Dias, Free time,
      Demurrage), uma linha de título, sem texto embaixo da célula; Dias em
      âmbar quando passa do free time; origem do free time e "Não se aplica
      (SOC)" ao passar o mouse; etiqueta SOC ao lado do tipo. Coluna
      Demurrage (2026-10-14; o selo colorido da opção A foi recusado por
      chamativo): o valor ou o número da fatura, seguido da situação em
      texto cinza: "US$ 1.540,00 em curso" e "US$ 600,00 a faturar" com o
      valor em âmbar; "DEM-2026-0007 em aberto" e "DEM-2026-0004 paga" com
      a fatura como link; vazio sem cobrança.
    - **Desbloqueio de CE e VIP:** novo bloco Solicitações de desbloqueio
      (protocolo, B/Ls, situação, termo, procuração, prazo, aberta em,
      Analisar), com busca por B/L e paginação, antes da Condição VIP.
  - **Taxas Locais · Faturas** (aprovada em 2026-10-14): versão limpa, uma
    linha de título e oito colunas sem texto embaixo da célula, nesta
    ordem: Fatura, B/L, Emissão, Cliente, Navio / Viagem, Total, Saldo e
    Situação. Saldo
    maior que zero em âmbar; Situação em texto (Emitida e Parcialmente paga
    normais, Cancelada em cinza com a linha inteira, Paga com ícone ✓
    verde antes da palavra). fatura com vários
    B/Ls mostra o primeiro e "+n". Saem da linha o CNPJ e o POD (filtro e
    detalhe da fatura) e a coluna **Comunicado de CE** (o Comunicado de CE
    e Taxas é por Cliente e Viagem, não por fatura, e já está em Clientes ›
    Comunicação; a falha de envio segue como alerta; desde 2026-10-18 o
    reenvio fica no Histórico de Clientes › Comunicação, decisão D5 do
    [plano dos e-mails](../archive/plans/2026-10-17-correcao-dos-emails.md)). Busca única por
    fatura ou B/L; resumo do recorte na faixa do título. Consolidada
    marcada por um ícone pequeno de pilha ao lado do número ("Consolidada"
    ao passar o mouse), não por selo. O ícone ✓ de
    paga vale em todas as telas que mostram "paga" (decisão de 2026-10-14).
  - **Taxas Locais · Validação** (aprovada em 2026-10-14, seção 4b): versão limpa com seleção, seta de abrir e seis
    colunas (B/L, Cliente, Navio / Viagem, Motivo, Subtotal, ação). Motivo
    uma vez, em texto; uma ação por linha, a que resolve o motivo
    (Recalcular, Vincular na Revisão, Cadastrar CE, Abrir Cliente, Emitir);
    saem Cálculo, Vínculo do Cliente e Modo de carga (vira filtro). Linha
    aberta refeita em 2026-10-14 (a primeira versão perdeu o que a de hoje
    tem): dois quadros lado a lado. "Situação do B/L" com a explicação do
    motivo numa faixa âmbar (verde quando pronto) e o botão que resolve, e
    só Trecho, CE Mercante, Cliente e CNPJ, alinhados à esquerda (Subtotal,
    Linhas de taxa, Última revisão e Último evento saíram em 2026-10-14 por
    repetirem a linha ou a conferência; quando o histórico explica o
    motivo, a data entra na faixa); "Conferência do cálculo" com a data do
    cálculo e o total no título, a tabela de cobrança e as linhas (Taxa,
    Base, Qtd., Unitário, Total). B/L "Pronto para emitir" (tudo certo e a fatura não saiu
    sozinha) entra na fila normal com o botão Emitir; hoje só aparece com
    "Incluir resolvidos" (decisão de 2026-10-14). Exportar vira uma planilha
    só, uma linha por B/L (sai a "Conferência do escopo"): colunas fixas
    (B/L, Cliente, CNPJ, Navio / Viagem, Trecho, Modo de carga, Motivo,
    Detalhe do motivo, Último cálculo, Subtotal) e uma coluna por taxa com
    o total da taxa no B/L; taxa em US$ com coluna própria "(US$)".
    Respeita a seleção (sem seleção, o filtro); botão com a contagem;
    nomes em português, sem campos de sistema (decisão de 2026-10-14).
  - **Defeito achado, fora da mudança visual** (2026-10-14, código e banco
    local): `getBillingBlock` (`src/components/billing/validacaoPipeline.ts`)
    e `canIssueSingleInvoice` (`ValidacaoOperationsTable.tsx`) só tratam
    `financial_status = 'invoiced'` como faturado; B/L `paid` ou
    `partially_paid` volta à fila como "Cálculo incompleto" e oferece
    Emitir. Correção: usar `isBlFinanciallyLocked`
    (`src/lib/chargeStatus.ts`), como o resto do sistema.
  - **Faturas do Portal** (aprovada em 2026-10-14, versão limpa): tabela no padrão de Taxas Locais ·
    Faturas (Fatura, B/L, Emissão, Navio / Viagem, Total, Saldo, Situação;
    o número da fatura abre o detalhe e o botão Detalhes sai; uma linha de
    título; saldo em âmbar; "Paga" com ✓; sem texto embaixo da célula; POD
    só no filtro e no detalhe). Aba Demurrage (proposta de 2026-10-14,
    seção 5b): bloco "Faturas de Demurrage"; ROE vigente numa linha no topo
    (sai a coluna "Atualizado em"); colunas Fatura, B/L, Emissão, Navio /
    Viagem, Total US$, Total R$ e Situação; "Disputar" sai da lista e vai
    para o fim do detalhe da fatura, discreto ("Discorda de algum valor?
    Abrir disputa"; decisão de 2026-10-14); Total R$
    em âmbar quando a pagar; Situação em texto (Em disputa e Vencida em
    âmbar, Paga com ✓); filtros abertos; dólar como "US$". Nada no lugar do
    vencimento (a taxa local não tem vencimento, ADR 0055); botão "Copiar
    código Pix" (ação nova) no bloco Pagamento.
  - **Defeito achado, fora da mudança visual** (2026-10-14, por leitura do
    código e do banco local): no Modo Inspeção o cartão Saldo pendente lê
    `customers.pending_balance` (RPC `portal_open_inspection`, migration
    `002`), coluna que nenhuma rotina atualiza; o Cliente de teste tem
    R$ 0,00 ali e R$ 3.005,00 em `bl_receivables` abertos. O Portal do
    próprio Cliente calcula certo (`portal_get_session_overview_v2`,
    migration `105`: recebíveis abertos + Demurrage emitida + avulsas em
    aberto). Correção proposta: uma migration nova em que a inspeção usa o
    mesmo cálculo.

## Passada única (2026-10-13)

Decidida pelo responsável em 2026-10-13 (nota na ADR 0081): o que vale igual
em qualquer tela foi aplicado de uma vez, em todo o Vela e o Portal, na PR
[#940](https://github.com/luccafwlog/vela/pull/940), sem esperar os lotes:

1. Tabela padrão em toda `.app-table` (centralizada; texto longo à esquerda
   com `.app-table__text`/`.app-table__text-head`, ou quando a célula já usa
   `.app-table__truncate`/`.app-table__cell-stack`).
2. Identificador sem sublinhado em repouso, em todas as famílias; sublinha ao
   passar o mouse ou com o foco.
3. Cabeçalho claro em tabela dentro de tabela (`tr[data-row-detail]`, tabela
   dentro de `.app-table` e `app-table--nested`).
4. Dado vazio com `NoValue` no lugar de "-", "—" ou texto vazio.
5. `CopyValue` em número do B/L, CE Mercante, CNPJ e número do contêiner; as
   ações "Copiar …" de menu que ficaram redundantes saíram.
6. Ação escrita como texto sublinhado ou só-ícone em linha de tabela virou
   botão com nome (Editar, Omitir, Excluir…). Menus ⋮, setas de abrir linha,
   ordenação e paginação ficaram como estão.

Fora da passada: documentos impressos (faturas, recibos, ADR) e qualquer
reorganização de tela (faixa de identidade, blocos, dado principal, colunas,
cartões), que segue pelos lotes abaixo.

## Lotes

Cada lote passa pela página de aprovação (captura de hoje, proposta, o que
muda) e é implementado depois de aprovado. Com a passada única feita, os
lotes tratam só da organização de cada tela.

| Lote | Telas (ordem da tabela "Telas") | Estado |
|---|---|---|
| 1 | Lista de BLs (2), ficha da Viagem (3), ficha do Cliente (5, com as seis abas), Taxas Locais · Faturas (7), Portal · Faturas (10); desde 2026-10-15, também as quatro abas restantes da ficha do B/L (1) e da ficha da Viagem (3) | Entregue em 2026-10-14 (todas as telas e as abas da ficha do Cliente), branch `claude/determined-bardeen-kvwaxt`; as oito abas restantes foram entregues em 2026-10-15, branch `claude/sweet-rubin-6udppg` |
| 2 | Operação do dia a dia: Revisão (6), Chegadas e Saídas e programação do Portal (4), Demurrage (8), Containers, Veículos e Baplie (14); listas de Viagens e de Clientes; Tarifas de Demurrage (`/demurrage/taxas`, da tela 8) | Entregue em 2026-10-16: Revisão (branch `claude/sweet-turing-r2tdp1`) e as demais telas, os quatro achados, o número `DEM-AAAA-NNNN` e as abas sombreadas (branch `claude/practical-cray-mpdw1p`), com a revisão da PR 969 (migrations `294` e `295`) |
| 3 | Financeiro: detalhe da fatura de Taxas Locais e tabelas de taxas (7), Conciliação PIX (9), Desbloqueio de CE interno (15) | Entregue em 2026-10-16 (aprovado na rodada 2 da página "Lote 3 da identidade"), branch `claude/serene-edison-ibuix9` |
| 4 | Restante do Portal: PIX, consolidada e disputa (10), B/Ls e Containers (11), Painel, Central de Informações, Desbloqueio de CE e Perfil (12); tabela dos Documentos anuais VIP com Aprovar e Solicitar correção, peça comum à ficha do Cliente, ao Portal e à análise do pedido (aprovada no lote 1, adiada para cá em 2026-10-14) ; no documento de Demurrage do Portal, o aviso de Invoice complementar e as restituições no recibo (achados da PR 939) | Aprovado em 2026-10-18 (todas as telas, três rodadas) e entregue em 2026-10-18 na PR 972, branch `claude/laughing-meitner-3rfy0l`, com as migrations `298` a `301` |
| 5a | Painel e Alertas (13); Provisionamento, Comunicação e Modo Inspeção (16) | Confirmado e dividido em 2026-10-19; proposto e aprovado em 2026-10-19 (página "Lote 5a da identidade", três rodadas); entregue em 2026-10-19, branch `claude/stoic-cannon-v7g39p` |
| 5b | Granito, Vazios e depots (17); Relatórios e Administração (18) | Confirmado em 2026-10-19; proposto em 2026-10-19 (página "Lote 5b da identidade"), aguarda resposta |
| 6 | Peças comuns e entrada: modais de importação (19), documentos impressos (20), Login, acesso e perfil (21), e-mails do Vela e do Portal (22, acrescentados em 2026-10-19) | Proposto, a confirmar |

O lote 2 vem logo depois do 1 por ser onde a operação passa mais tempo; o 6
fica por último porque essas telas mudam pouco além da passada única.

## Como cada tela passa

1. Capturar a tela de hoje no ambiente local com dados sintéticos
   (procedimento em [setup/development.md](../setup/development.md) e no
   [registro da campanha anterior](../archive/plans/2026-10-07-revisao-visual-ux-prompts.md#ambiente-local-para-evidência-macos)).
2. Montar a proposta com as peças comuns, sobre os mesmos dados, e listar o
   que muda na organização e o que não muda (dados, abas, ações).
3. O responsável aprova ou ajusta. Só então implementar.
4. Implementar no dono da tela, sem CSS novo de página; apagar o CSS da família
   da tela que deixou de ser usado; rodar `npm run design:check -- --update` e
   conferir que a linha de base caiu.
5. Validar com os gates do [AGENTS.md](../../AGENTS.md), capturas depois em
   1440, 768 e 360 px e registrar abaixo.

Desde a passada única (abaixo), identificador que abre o registro não é
sublinhado em repouso em nenhuma família; link no meio de frase
(`.billing-demurrage-notice a`, `.app-import-templates a`, login) continua
sublinhado.

Decisão de negócio encontrada no caminho (cálculo, regra, RPC) é registrada à
parte e não entra na mudança visual. As pendências não visuais anotadas no
plano arquivado continuam válidas e são conferidas quando a tela dona entrar.

## Telas

| Ordem | Tela | Rotas | Pontos já conhecidos | Estado |
|---|---|---|---|---|
| 1 | Ficha do B/L | `/bls/:blId` | Visão geral numa caixa só com filetes; "Resolver na Revisão", "Definir exceção" e "Ver itens da carga" como texto (regra 9) | Entregue em 2026-10-13 (aba Visão geral, faixa, próxima ação e trilhos); Carga, Detalhes do B/L, Faturamento e Histórico entregues em 2026-10-15 (lote 1), branch `claude/sweet-rubin-6udppg` |
| 2 | Lista de BLs | `/bls` | Cartões que filtram, faixa de resumo, linha com duas ações | Entregue em 2026-10-14 (lote 1) |
| 3 | Ficha da Viagem e Viagens | `/viagens`, `/viagens/:voyageId` | Ficha restaurada em 2026-10-08 com faixa azul-marinho; conferir contra as regras | Ficha entregue em 2026-10-14 (lote 1, Visão geral); Importação, Exportação, Rotas e Manifestos e ADR entregues em 2026-10-15 (lote 1); lista de Viagens entregue em 2026-10-16 (lote 2) |
| 4 | Chegadas e Saídas e programação do Portal | `/chegadas-saidas`, Painel do Portal | "X" em toda célula, grupos ETD/ETA sem separação. Decidido em 2026-10-16: Saída na origem antes da Chegada no Brasil, também no formulário e no cartão do celular; porto sem data sai; previsão passada em âmbar nas duas | Entregue em 2026-10-16 (lote 2), branch `claude/practical-cray-mpdw1p` |
| 5 | Ficha do Cliente e Clientes | `/clientes`, `/clientes/:cnpj` | `.app-customer-*` é a maior família de CSS de página | Ficha entregue em 2026-10-14 (Visão geral, as abas e a aba nova Contêineres); lista de Clientes entregue em 2026-10-16 (lote 2) |
| 6 | Revisão | `/revisao` | `review-link-button` como ação em texto (regra 9) | Entregue em 2026-10-16 (lote 2), branch `claude/sweet-turing-r2tdp1` |
| 7 | Taxas Locais e detalhe da fatura | `/taxas-locais`, `/taxas-locais/tabelas` | `app-invoice-comm__link`, `app-fin-alerts__link` | Faturas e Validação entregues em 2026-10-14 (lote 1); detalhe da fatura, Tabelas e Condições de Cliente entregues em 2026-10-16 (lote 3) |
| 8 | Demurrage | `/demurrage`, `/demurrage/taxas` | `app-dem-link` (número da Invoice é identificador; conferir as ações) | Entregue em 2026-10-16 (lote 2, com as Tarifas e o número `DEM-AAAA-NNNN`), branch `claude/practical-cray-mpdw1p` |
| 9 | Conciliação PIX | `/reconciliacao` | `app-pix-link` | Entregue em 2026-10-16 (lote 3) |
| 10 | Portal: Faturas, PIX, consolidada e disputa | `/portal/billing` e inspeção | Pix abaixo dos itens no detalhe; saldo pendente diverge entre telas (regra de dado, à parte) | Faturas (Taxas Locais e Demurrage) entregues em 2026-10-14 (lote 1), com o Saldo pendente da inspeção corrigido (migration `225`); detalhe por situação, Pix em faixa baixa, Pagamentos recebidos, consolidada com filtros, tela de Disputas, Invoice complementar e restituições entregues em 2026-10-18 (lote 4, PR 972) |
| 11 | Portal: B/Ls e Containers | `/portal/operacao` e inspeção | | Entregue em 2026-10-18 (lote 4, PR 972) |
| 12 | Portal: Painel, Central de Informações, Desbloqueio de CE, Perfil | `/portal`, `/portal/informacoes`, `/portal/desbloqueio-ce`, `/portal/perfil` | | Entregue em 2026-10-18 (lote 4, PR 972), com a peça comum dos Documentos anuais VIP |
| 13 | Painel, Alertas | `/painel`, `/alertas`, `/alertas/regras` | | Entregue em 2026-10-19 (lote 5a) |
| 14 | Containers, Veículos, Baplie | `/containers`, `/veiculos`, `/baplie` | | Entregue em 2026-10-16 (lote 2), branch `claude/practical-cray-mpdw1p` |
| 15 | Desbloqueio de CE interno | `/desbloqueio-ce` | | Entregue em 2026-10-16 (lote 3), com a aba "Andamento dos B/Ls" |
| 16 | Provisionamento, Comunicação, Modo Inspeção | `/clientes/portal`, `/clientes/comunicacao`, faixa de inspeção | Abas de Clientes (`ClientesTabs`) abaixo do cabeçalho e vistas da Comunicação em controle segmentado desde 2026-10-16 (lote 2); barra de abas de segundo nível desde o lote 5a | Entregue em 2026-10-19 (lote 5a) |
| 17 | Granito, Vazios, depots | `/granito`, `/vazios-importacao`, `/embarquevazios` | `VaziosImportacaoPreview` com cores fixas do tema escuro | Pendente (lote 5b) |
| 18 | Relatórios e Administração | `/relatorios`, `/admin/:tab` | | Pendente (lote 5b) |
| 19 | Importações (modais comuns) | modais de importação | | Pendente |
| 20 | Documentos impressos | faturas, recibos, ADR | Marca Transhipping; só regras de impressão. Visual mantido por decisão de 2026-10-13 | Regras de impressão e comportamento entregues em 2026-10-14 (PR 939); restam, sem mudar o visual: taxas com ponto decimal (`60.00`), CNPJ sem máscara no resumo por Cliente, rótulos em inglês ("From/To") e textos de 9–11 px |
| 21 | Login, acesso e perfil | `/login`, `/portal/login` e telas públicas | | Pendente |
| 22 | E-mails do Vela e do Portal | modelos do Portal (`supabase/functions/_shared/portalEmailTemplates.ts`: convite, reenvio, recuperação de senha, troca de e-mail, senha alterada, resumo diário, aviso de devolução, aviso do Desbloqueio de CE) e dos Comunicados (`src/services/customerCommunicationTemplates.ts`: CE e Taxas, régua automática, Cobrança de Demurrage) | Acrescentada em 2026-10-19 a pedido do responsável; até então a aparência dos e-mails não tinha dono (o [plano dos e-mails](../archive/plans/2026-10-17-correcao-dos-emails.md) só corrigiu envio e conteúdo). Dois layouts separados, cada um com cópia própria das cores (`#152238`, `#d4882e`, cinzas), fonte do sistema e logo branco da Fwlog; os Comunicados usam ainda um verde-azulado (`#0f766e`) fora da identidade. Restrições de e-mail, como nos impressos: sem as fontes do site, layout em tabela e estilo escrito no HTML. Proposta mostra cada modelo como chega hoje e como ficaria; primeiro passo provável é uma base de layout só | Pendente (lote 6) |

O plano é concluído quando todas as linhas estiverem entregues e a linha de
base de `design:check` não tiver mais famílias de CSS de página nem violações
em TSX, ou quando o responsável encerrar formalmente o que restar.

## Registro

| Data | Tela | Base / branch | Resumo, checks e evidência |
|---|---|---|---|
| 2026-10-13 | Base da identidade | `2f06add`; `claude/trusting-cerf-bkwctp` | Ver "Estado". **Teste:** `docs:check`, `typecheck`, `lint`, `npm test` (747 arquivos, 4.622 testes; 81 arquivos de integração pulados sem banco), `build`, `size-limit` (Vela 248,95 KiB, igual à base; Portal 208,17 KiB), `a11y:contrast` (63 pares, incluindo o tema do Portal) e `design:check`. **Runtime:** capturas antes e depois em ambiente local com dados sintéticos (12 telas a 1440 px e BLs a 360 px), sem erro de console; nenhuma tela reorganizada. **Não verificado:** tema escuro e Portal fora do Modo Inspeção. |
| 2026-10-13 | Ficha do B/L | `9e55f1c`; `claude/trusting-cerf-bkwctp` | `IdentityBand`, `NextAction` com "Resolver na Revisão" como botão, trilhos em `Block`, Visão geral em cinco blocos (Embarque, Documento Mercante, Cliente; Carga com tabela de contêineres em grupos Devolução e No terminal; Portal); botões em "Definir exceção", "Ver na aba Carga", "Abrir conciliação" e "Enviar convite do Portal"; aba ativa em azul-marinho em todo o sistema; família `app-bl` de 138 para 108 regras. Refeita a partir do exemplo aprovado, porque a implementação da sessão anterior não chegou a ser enviada. Junto: `design:check` passa a contar `#RGBA` e cada parte de seletor agrupado (linha de base remedida sobre o mesmo CSS), e `LeadValue`/`Fact` mantêm detalhe 0. **Teste:** `docs:check`, `typecheck`, `lint`, `npm test` (748 arquivos, 4.627 testes; 81 de integração pulados sem banco), `build`, `size-limit` (Vela 248,93 KiB; Portal 208,16 KiB), `a11y:contrast`, `design:check`. **Runtime:** Postgres 16 local com `validation_seed` e `seed_audit`, `sb-shim` e Vite; B/Ls COSU6401234501 (normal), COSU6401234505 (sem Cliente, cadastro na largura toda) e COSU6401234509 (carga solta) a 1440, 768 e 360 px, sem rolagem lateral nem erro de console. **Não verificado:** tema escuro, B/L misto e cancelado em runtime, e as demais telas com a aba ativa nova. |
| 2026-10-13 | Regra 6 (todas as tabelas com grupos) | `ac6c354`; `claude/trusting-cerf-bkwctp` | O responsável achou pesada a faixa de 3 px entre grupos de colunas na ficha do B/L; passa a linha de 1 px clara (`--app-border-soft`). Nota na ADR 0081 e regra 6 atualizada. **Teste:** `design:check`, `docs:check`, `a11y:contrast`, testes de `src/components/ui`. **Runtime:** ficha do B/L COSU6401234501 a 1440, 768 e 360 px, sem erro de console. |
| 2026-10-13 | Tabela padrão (regra 6) | `1ba43e9`; `claude/trusting-cerf-bkwctp` | Entre quatro formatos comparados lado a lado, o responsável escolheu o centralizado (C), com texto longo à esquerda. `app-table--padrao` aplicado à tabela de contêineres da ficha do B/L; a linha vertical entre grupos saiu. As demais tabelas passam ao padrão quando a tela for migrada. |
| 2026-10-13 | Passada única (todas as telas) | `53ba959`, `b52938c`, `a058389`, `d67a88e`, `cbe47ab` e o commit desta entrada; `claude/trusting-cerf-bkwctp` | Os seis itens da seção "Passada única" em cerca de 90 arquivos do Vela e do Portal; `MetricCard` passou a aceitar `NoValue`. **Teste:** `typecheck`, `lint`, `npm test` (749 arquivos, 4.634 testes; 82 de integração pulados sem banco), `build`, `size-limit` (Vela 249,51 KiB de 250; Portal 208,58 KiB), `a11y:contrast`, `design:check`, `docs:check`. **Runtime:** Postgres 16 local com `validation_seed` e `seed_audit`, a 1440 px: `/bls`, `/bls/COSU6401234501`, `/viagens/10`, `/clientes/12345678000190`, `/taxas-locais`, `/demurrage`, `/containers`, `/veiculos`, `/baplie`, `/revisao`, sem erro de console nem rolagem lateral; Containers, Veículos e Baplie corrigidos depois da captura (colunas empilhadas voltaram à esquerda). **Não verificado:** Portal em runtime, tema escuro, 768 e 360 px. **Ficou de fora:** traço "-" em texto montado (navio / viagem, POL → POD, datas de escala vindas de `voyageCardHelpers` e `ShipScheduleWidget`), copiar em prévias de importação e dentro de botões, colunas de lista de motivos (ficam centralizadas para não cortar). |
| 2026-10-13 | Regra 9 (identificador sem sublinhado) | `2adc40c`; `claude/trusting-cerf-bkwctp` | Pedido do responsável: número do B/L, nome do Cliente e navio só na cor de link, com sublinhado ao passar o mouse ou com foco. `.app-identity a` ajustado (azul claro sobre o azul-marinho); as demais famílias ficam listadas acima para a migração de cada tela. |
| 2026-10-13 | Revisão da PR 940 e exceção da regra 6 | `f550b14`; `claude/trusting-cerf-bkwctp` | Revisão independente em quatro áreas; achados corrigidos (ver CHANGELOG). Comparando lado a lado a Fila de Alertas com a mensagem cortada em "…" e com quebra de linha, o responsável escolheu manter a exceção: texto corrido que é o próprio conteúdo da linha e não aparece inteiro em outro lugar (mensagem do alerta, observação, descrição de item, nome da taxa, notas do acordo) quebra linha com `.app-table__text--wrap`; nomes seguem com "…" e `title`. **Teste:** `typecheck`, `lint`, `npm test` (4.635 testes), `build`, `size-limit` (Vela 249,51 KiB), `a11y:contrast`, `design:check`, `docs:check`; CI verde em `8bae617`. **Evidência:** alinhamento cabeçalho × célula medido no Chromium em 35 telas do Vela com banco local; Portal e larguras menores não observados. |
| 2026-10-14 | Lote 1 (Lista de BLs, ficha da Viagem, ficha do Cliente, Taxas Locais · Faturas e Validação, Portal · Faturas) | `d9bae41`, `3963945`, `6b7704b`, `ea465c3`, `03a2d79`, `4453da2` e o commit desta entrada; `claude/determined-bardeen-kvwaxt` | Tabela limpa nas cinco telas; regras 5 e 6 emendadas; peças `StatusText`, `ConsolidatedMark`, `InvoiceSituation`, `LocalChargesStatus` e `app-table__row--muted`. Defeitos corrigidos: B/L faturado sai da fila da Validação; "Pronto para emitir" entra na fila padrão; caixa de Comunicado sem destinatário recebe o contato principal (migration `223`); estado de Taxas locais da lista de BLs derivado do financeiro (`222`), sem contar B/L cancelado como Pendente (`226`, da revisão da PR); solicitações de Desbloqueio de CE na ficha do Cliente (`224`, com os B/Ls dos pedidos encerrados pela `227`); Saldo pendente do Modo Inspeção igual ao do Cliente (`225`). A planilha da Validação mantém a coluna Contêiner compartilhado (ADR 0038, nota de 2026-10-14). Abaixo de 1024 px, Faturas internas e lista de BLs viram cartões e a Validação e o planejamento da Viagem tiram colunas, para Saldo, Situação e ações não ficarem atrás da rolagem. **Teste:** `docs:check`, `typecheck`, `lint`, `npm test` (750 arquivos, 4.650 testes; 82 de integração pulados sem banco), `build`, `size-limit` (Vela 224,97 KiB; Portal 207,75 KiB), `a11y:contrast`, `design:check`, `migrations:check`, `rpc:check` e `portalInspectionParity.local-pg.test.ts` em `vela_test` recriado com as migrations. **Runtime:** Postgres 16 local com `validation_seed` e `seed_audit`, `sb-shim` e Vite, a 1440, 768 e 360 px: `/bls`, `/viagens/10`, `/clientes/12345678000190` (Visão geral, Financeiro, Cadastro e contatos), `/taxas-locais` (Faturas e Validação) e `/clientes/portal/inspecao/101/billing` (Taxas Locais, Demurrage e o detalhe da FAT-2026-0018), sem rolagem lateral nem erro de console; Saldo pendente da inspeção R$ 3.005,00 (antes R$ 0,00). **Não verificado:** tema escuro; Portal fora do Modo Inspeção; detalhe da fatura de Demurrage e a disputa em runtime (a massa local não tem fatura de Demurrage; cobertos por teste de componente); aplicação das migrations `222` a `227` no Supabase remoto. Na revisão da PR também: o detalhe da fatura de Demurrage do Portal não mostra o Pix guardado de fatura paga ou cancelada, e Limpar filtros não traz de volta a busca de Faturas que ainda estava na pausa; Emitir da Validação marca pronto e emite numa transação (B/L calculado ou revisado também emite); fatura cancelada não repete o saldo do B/L no Financeiro do Cliente. |
| 2026-10-14 | Lote 1 · passe completo contra a página aprovada | o commit desta entrada; `claude/determined-bardeen-kvwaxt` | Cada item de "O que muda", "O que não muda" e "Decidido" das oito seções da página aprovada conferido contra o código. Feitos agora: **ficha do Cliente** — e-mail do contato principal na faixa; Cadastro com "Quem recebe os Comunicados" (tabela Caixa, O que recebe, Quem recebe) separado de Contatos, "Sem conta" em âmbar como dado principal do Acesso ao Portal e "—" nos campos vazios, "Feito pelo sistema" nas Alterações do cadastro; BLs com o nome do manifesto em cinza sob o B/L quando difere; Financeiro com a Liberação em bloco e o dado principal "Não concedida" (âmbar enquanto retém), resumo do recorte filtrado no título, Demurrage com Vencimento e Disputa e os filtros "Pagas"/"Canceladas"; Histórico sem o motivo técnico escrito pelo sistema; Desbloqueio com o bloco Condição VIP ("VIP habilitado" / "Sem condição VIP" em cinza), Documentos anuais com "Coberto até 31/12/AAAA" ou "Falta" em âmbar, e solicitações em andamento primeiro (migration `228`); Cliente sem linha na fila do Portal tratado como "sem conta" (Faturas retidas, Liberação). **Validação** — motivos "Taxa em revisão" e "Conta do Portal não ativa", data da falha da emissão automática (ou do bloqueio do cálculo) na faixa, a partir do Alerta aberto do B/L; "Exportar N B/Ls"; arquivo `validacao-taxas-locais-AAAA-MM-DD.xlsx`; título sem "· 0 selecionados"; Navio / Viagem na expansão só abaixo de 1024 px. **Viagem** — Linha do tempo sem o nome técnico do campo na divergência conciliada e com "→". **Portal** — B/L como "primeiro +N"; trecho no detalhe de Demurrage. **Revisão da PR (Codex):** saldo novo de B/L com fatura paga vai para "Sem fatura ativa" (a fatura paga leva só o razão liquidado); "US$ … em aberto" soma o líquido do desconto; a coluna Pago do Financeiro lê os pagamentos registrados (`total_paid_brl`), não total − saldo; mudança de contato feita no Portal aparece como "Cliente pelo Portal"; B/L isento e depois cancelado sai dos Isentos (migration `229`, verificada em `vela_test` numa transação descartada); a busca de Faturas chega à URL num efeito. ✓ de Paga no detalhe interno da fatura e na seção Taxas Locais da ficha do B/L. **Ficou como está, de propósito:** "Aprovado" do CE em tinta normal, não verde (a regra 5 da tabela limpa, posterior, deixa verde só para Paga); Editar de cada escala numa última coluna sem título; coluna extra Contêiner compartilhado na planilha (ADR 0038); quadro "Pendências de revisão" na expansão da Validação (diz quais taxas estão em revisão); paginação de 20 em Taxas Locais (a página dizia 25, mas o sistema já usava 20 antes da proposta); documentos anuais em lista, não em tabela (a peça é a mesma do Portal e da análise do pedido; adiada para o lote 4 pelo responsável em 2026-10-14). **Teste:** `docs:check`, `typecheck`, `lint`, `npm test` (751 arquivos, 4.666 testes; 82 de integração pulados sem banco), `build`, `a11y:contrast`, `design:check` (linha de base atualizada), `migrations:check`, `rpc:check`. **Runtime:** `ce_unlock_customer_requests` executada em `vela_test` numa transação descartada, devolvendo em análise, enviada, cancelada e concluída nessa ordem; Postgres 16 local com `sb-shim` e Vite, `/clientes/12345678000190` (Cadastro e contatos, Financeiro, Desbloqueio de CE e VIP sem e com VIP ligado no banco local) a 1440, 768 e 360 px e `/taxas-locais?tab=validacao` a 1440, sem rolagem lateral nem erro de console. **Não verificado:** tema escuro; Portal, Viagem e a faixa com a data da falha em runtime (cobertos por teste); aplicação da `228` e da `229` no Supabase remoto. |
| 2026-10-14 | Documentos impressos (tela 20, adiantada) | PR 939, branch `claude/awesome-cray-vm0ctv` (base `c4a984f`, atualizada com a `main` depois da PR 947) | Feita em 2026-10-13 como etapa 13 do [plano arquivado](../archive/plans/2026-10-07-revisao-visual-ux-prompts.md), que foi encerrado antes do merge; o registro fica aqui e o plano arquivado não foi alterado. Visual dos documentos mantido (decisão de 2026-10-13; redesenho reprovado). Correções: `@page` A4 com margem vertical em todas as páginas e "Página N de M" no rodapé, igual em `index.css` e em `lib/printDocument.ts`; Invoice de Demurrage paga ou cancelada sem Pix nem "QR em preparação" (a mesma regra do detalhe do Portal no lote 1); aviso "Invoice complementar de DEM-…" por `useDemurrageComplementOf` em `/demurrage` e na Conciliação, com Imprimir esperando a consulta; recibo da individual coberta com "Recebido pela consolidada … (atribuído a estes B/Ls)"; com documento aberto em modal, só ele vai ao papel (o ADR deixou de levar a ficha da Viagem; o Modo Inspeção deixou de levar a faixa e uma página em branco); valores sem quebra; chave React repetida; título do ADR sem caixa alta. **Achados de contrato, sem alteração:** a Invoice de Demurrage lê Cliente, B/L, navio e rota do cadastro atual (o congelamento da migration `183` é só de Taxas Locais); `complementary` não é gravado e o aviso depende da inferência por Invoices vivas anteriores. **Para o lote 4:** o Portal não passa a complementar ao documento e imprime o recibo de Demurrage sem as restituições. **Linha de base de `design:check`:** a PR foi feita antes da catraca da ADR 0081; ao trazê-la para a `main`, as regras de impressão (`@media print`, o dono que a identidade dá a elas) subiram `invoice-print`, `agency-report`, `customer-report`, `app-main`, `app-shell` e `app-modal`, e o aviso de complementar um tamanho de letra no documento de Demurrage. As duas regras de "só o documento no papel" viraram uma, e o aviso usa as cores do kit (`DOC_NAVY`, `DOC_BORDER`, `DOC_SUBTOTAL`), sem hex novo; o resto foi aceito com `--update --allow-increase`. O título do ADR sem caixa alta baixou `caixa-alta`. **Teste (2026-10-14, depois da atualização com a `main`):** `docs:check`, `typecheck`, `lint`, `npm test` (754 arquivos, 4.682 testes; integrações de banco puladas), `build`, `size-limit` (Vela 225,00 KiB; Portal 207,80 KiB), `a11y:contrast` e `design:check`. **Runtime (2026-10-13):** PDFs do Chromium de 18 documentos sintéticos antes e depois, e fatura, recibo, Invoice complementar, relatório por Cliente, ADR fechado e Modo Inspeção no app local. **Não verificado:** impressora física, Safari, Firefox, login real do Portal. |
| 2026-10-15 | Lote 1 · abas restantes (B/L: Carga, Detalhes, Faturamento, Histórico; Viagem: Importação, Exportação, Rotas e Manifestos) | `claude/sweet-rubin-6udppg` (sobre `ddac0da`) | Propostas em quatro rodadas na página "Abas do lote 1". Decisões: blocos de Carga só com o tipo de carga do B/L; **Corrigir** abre uma janela com Perfil, COC/SOC, Lacre, Peso bruto, CBM, Descarga e Devolução; lacre, peso e CBM sempre corrigíveis, inclusive com B/L faturado (não entram na base da fatura), e a reimportação do B/L volta ao arquivo (migration `289`, `correct_bl_container_data`); Histórico com páginas de 20; colunas de Taxas Locais só quando alguma linha foge do normal; Importação e Exportação mantêm a organização de hoje com faixa de total e cabeçalho da escala em azul-marinho (opção A), B/Ls de contêiner e de carga solta e sem textos explicativos no rodapé; Rotas com siglas e a fonte do sistema. Peça comum nova `.app-link` (aceita com `--allow-increase`); CSS sem uso de `app-bl-*` e `app-voyage-*` removido. **Teste:** `docs:check`, `typecheck`, `lint`, `npm test` (766 arquivos, 4.778 testes; integrações de banco puladas), `build`, `design:check` (linha de base atualizada), `a11y:contrast`, `migrations:check`, `rpc:check` (contra o banco local da auditoria). **Banco local:** `correct_bl_container_data` executada numa transação descartada (grava os três campos, o histórico com justificativa e aparece em `bl_timeline`). **Runtime:** Postgres 16 local com `validation_seed` e `seed_audit`, `sb-shim` e Vite, a 1440 px: as quatro abas do COSU6401234506 e do XPDU5500987601, a correção de lacre de ponta a ponta pela janela Corrigir, Histórico a 360 px, e `/viagens/10` (Importação, Exportação, Rotas e Manifestos), sem erro de console nem rolagem lateral. **Não verificado:** tema escuro; 768 px; Corrigir com Part Lot e com B/L faturado em runtime (coberto por teste de componente); faixa de Salvar presa no rodapé em runtime; aplicação da `289` no Supabase remoto. **Pendente:** ADR (linha do tempo). |
| 2026-10-15 | Lote 1 · aba ADR da Viagem, prazo de 72 h e hora obrigatória | `claude/sweet-rubin-6udppg` | Aba ADR em blocos: seletores rotulados de Escala e Terminal; bloco ADR com "x de 3 departamentos assinados" (âmbar até completar), prazo, escala e terminal; um bloco por departamento com "n de m seções resolvidas · aguarda assinatura" e "Assinar <Departamento>"; cada seção como bloco interno com frentes e "Pendente" em âmbar; conteúdo com dado principal e tabelas internas (zero escrito); frente `importacao:veiculo` como "Veículos". Linha do tempo: painel dos seis marcos (sem quem assinou) e registro do que aconteceu (ATD com registro, assinaturas com prazo, reaberturas com justificativa, fechamento). Prazo do ADR em 72 horas corridas da hora do ATD (migration `290`, nota na ADR 0039). Hora obrigatória em ETB, ATB, ETD, ATD e ATA, e no ETA digitado; atracação gravada com fuso de Brasília (migration `291`). Defeito achado na conferência: atracação sem agenda do POD (escala salva só com datas do terminal) não formava a escala, e o ADR ficava sem ATD e sem prazo; `projectVoyageEscalaSchedules` passa a criar a escala a partir da atracação. **Teste:** `typecheck`, `lint`, `npm test`, `docs:check`, `migrations:check`, `design:check` (linha de base atualizada), `a11y:contrast`. **Runtime:** `/viagens/10` aba ADR, escalas BRSSZ e BRVIX, a 1440 px. **Não verificado:** 768 e 360 px; tema escuro; ADR fechado em runtime; `290` e `291` no Supabase remoto. |
| 2026-10-15 | Lote 1 · pendências | `claude/sweet-rubin-6udppg` | Portal de Demurrage deixa de mostrar "Vencida": o estado legado `overdue` aparece como Emitida (B29, Demurrage não vence). **Runtime:** tema escuro a 1440 px em `/bls`, as cinco abas do COSU6401234506, `/viagens/10` (Visão geral, Importação, ADR), `/clientes/12345678000190` e `/taxas-locais` (Faturas e Validação), sem defeito de contraste visto; Portal com login de Cliente (fora do Modo Inspeção; a função `portal-login` foi substituída no teste por uma sessão do `sb-shim`): Painel, Faturas e o detalhe de uma fatura de Demurrage de teste (DEM-2026-0001, criada no banco local), com Pagamento, Pix em preparação e a fatura `overdue` como Emitida. Colunas 1º e 2º período do detalhe de Demurrage do Portal numa linha ("9 × US$ 30,00"), sem "Dias cobrados" (aprovado em 2026-10-15), conferido na DEM-2026-0001. Tema escuro retirado (decisão do responsável de 2026-10-15): tokens e regras `[data-visual-theme='dark']`, a variante `dark:` do Tailwind e os casos `dark` e `portal-dark` de `a11y:contrast`; preferência `dark` guardada no navegador volta ao tema atual. **Teste:** `typecheck`, `lint`, `npm test` (4.774 testes), `design:check` (linha de base atualizada), `a11y:contrast`, `docs:check`. |
| 2026-10-16 | Lote 2 · Revisão | `claude/sweet-turing-r2tdp1` | Fila em tabela, uma linha por Cliente, com cinco cartões (Outras pendências filtra); grupo aberto por caso (`ReviewGroupDetail`): nome sem CNPJ com o texto bruto do B/L, CNPJ lido com o cadastro, CNPJs divergentes em tabela, e-mail, peso, Portal (convite na própria Revisão, `ReviewPortalBlock`), conferência do B/L (`ReviewBlCheckForm`) e Granito. Saíram a janela lateral e "Corrigir dados". Peça comum nova `ChoiceCards` (Portal do Cliente no cadastro, sem opção marcada; aceita com `--allow-increase`); 123 regras `review-*` removidas. **Teste:** `typecheck`, `lint`, `npm test` (suíte completa; o contrato de CSS do shell ajustado ao novo marcador), `design:check` (linha de base atualizada), `docs:check`. **Runtime:** Postgres 16 local com `validation_seed`, `seed_audit` e B/Ls da fila ajustados para os casos A a F, `sb-shim` e Vite, `/revisao` com todos os grupos abertos a 1440, 768 e 360 px, sem rolagem lateral nem erro de console. **Não verificado:** caso G (Granito) e envio real do convite em runtime (cobertos por teste); `a11y:contrast` e `build` rodados depois (ver commit). **Pendente na data:** vínculo automático por CNPJ lido único de cliente ativo (regra decidida em 2026-10-16), entregue depois na PR 967. |
| 2026-10-16 | Lote 2 · demais telas | `claude/practical-cray-mpdw1p` | **Achados:** faixa na ordem da próxima escala nas três telas (`compareVoyageRailItems`), "Divergente" no cartão (`useVoyageRailDivergences`), "N containers em atraso" na barra do topo e Exportar de Veículos com o recorte inteiro. **Tarifas:** colunas separadas e inativas atrás de "Mostrar inativas" (`?inativas=1`). **Demurrage:** Containers com uma linha por B/L e contêineres abrindo embaixo (colunas da fatura do Portal), Faturas/Pagas/Canceladas em tabela limpa, detalhe com dado principal; número `DEM-AAAA-NNNN` (migration `293`). **Chegadas e Saídas e Portal:** `ScheduleTable` comum (Saída antes da Chegada, âmbar nas duas, "Omitida", "—", Ver no mapa). **Containers**, **Veículos** (linha por veículo, janela de desova com marcados, recorte ou só sem local), **Baplie** (blocos), **Viagens** (filtros abertos e tabela com BB e Veículos) e **Clientes** (abas `ClientesTabs`, tabela limpa; Desativar foi para a ficha). Abas não selecionadas sombreadas em todo o sistema (regra 7). CSS e código sem uso removidos (`WorkspaceNav`, campo inline de desova, barra antiga de Viagens). **Teste:** `typecheck`, `lint`, `npm test` (suíte completa, 4.813 testes), `build`, `design:check` (linha de base atualizada), `a11y:contrast` (com os pares das abas), `docs:check`, `migrations:check`; **Postgres 16 local:** replay das migrations, `rpc:check` e as suítes local-pg de Demurrage (52 testes), mais a renumeração da `293` com os gatilhos ativos. **Não verificado:** capturas no navegador em 1440, 768 e 360 px; migration `293` aplicada em produção (depende do deploy). |
| 2026-10-16 | Revisão do lote 2 (PR 969) | `claude/tender-mayer-ypjt7s`, levada a `claude/practical-cray-mpdw1p` | Revisão em cinco frentes; achados corrigidos na PR. **Demurrage:** a emissão automática pela planilha de datas sai `DEM-AAAA-NNNN`, não mais `DEM-AUTO-<efeito>`, e o contador pula número já gravado (migration `294`); na aba Containers o âmbar é só o valor ainda sem Invoice ("a faturar de US$ total"), e cada contêiner volta a dizer em que Invoice foi cobrado. **Containers:** contêiner de B/L cancelado diz "B/L cancelado" em cinza nas Taxas locais, e o filtro Taxas locais oferece os três estados da coluna (migration `295`). **Clientes:** larguras das oito colunas (o layout fixo espremia CNPJ, Cidade, Taxas locais e Portal); desativar ou reativar na ficha atualiza o Histórico e o Provisionamento (`afterClienteAtivacaoAlterada`); abas de Clientes abaixo do cabeçalho nas três páginas, e as vistas da Comunicação em controle segmentado. **Viagens:** BB (t) na família `queryKeys.voyages.breakbulkTons`, relida depois de gravar carga, e o traço diz se não há carga solta, se carrega ou se falhou; recorte sem viagens diz "Nenhuma viagem neste recorte"; o "Divergente" da faixa sai de uma leitura por tabela para todas as viagens ativas (`countOpenBaplieDivergences`, a regra da ficha), no lugar de cinco consultas por viagem. **Veículos e Containers:** "Limpar filtros" à vista quando só os filtros abertos filtram; Exportar e a desova para o recorte esperam o filtro novo; a janela de desova diz quantos containers e veículos cada escolha atinge, e "Apagar o local de N containers"; depois de aplicar, a seleção é limpa e a página volta à última com linhas. **Chegadas e Saídas e Portal:** Saída antes da Chegada também no formulário e no cartão do celular, que esconde porto sem data. **Teste:** `typecheck`, `lint`, `npm test`, `build`, `design:check`, `a11y:contrast`, `docs:check`, `migrations:check`; **Postgres 16 local:** replay com `294` e `295`, `rpc:check` e as suítes `demurrageCobrancaPorCaixa`, `auditoriaFaturasDemurrageComunicado` e `operationalLists` (os casos novos falham sem as migrations: `DEM-AUTO-28`; B/L cancelado listado em Pendente). **Não verificado:** capturas no navegador; `294` e `295` em produção. **Fica como está:** a faixa mostra o estado pela cobertura de CE enquanto a contagem de divergências carrega, e viagem concluída ou cancelada não entra na contagem (leria o histórico inteiro de Baplie). |
| 2026-10-16 | Lote 3 (detalhe da fatura de Taxas Locais, Tabelas e Condições de Cliente, Conciliação PIX, Desbloqueio de CE) | `claude/serene-edison-ibuix9` (sobre `59aa729`, PR 969) | Proposto e aprovado em duas rodadas na página "Lote 3 da identidade". **Detalhe da fatura:** blocos Saldo (dado principal em aberto, ✓ Paga, Coberta ou Cancelada; B/L e trecho quando há um B/L só), Fatura desatualizada, B/Ls (só com mais de um B/L), Itens com total e coluna "Em US$" quando há dólar, Pagamentos com "Registrar pagamento" em botão, Restituições em tabela, Cancelar fatura só para o Administrativo; sai o "Nº interno". **Tabelas:** um bloco por escopo com a tabela em uso como dado principal, situações "Em uso no cálculo", "Ativa, mas não usada" (com Desativar na linha) e "Desativada", cartões que filtram (`?lente=nao-usadas` novo), itens com cabeçalho claro e "Adicionar item" uma vez. **Condições de Cliente:** tabela limpa com Cliente como link, situação em texto ("Sem efeito no cálculo" em âmbar, `?vigencia=sem-efeito`) e Valor da tabela com a diferença. **Conciliação PIX:** abre no Histórico de baixas (abas Histórico, Pendências, Conciliar extrato; alertas de Pix vão a `?tab=pendencias`), "Identificador do Pix" no lugar de "TXID", blocos e tabelas limpas nas três abas, resumo do recorte no Histórico; família `app-pix-*` removida. **Desbloqueio de CE:** abas "Solicitações" e "Andamento dos B/Ls", botões no bloco do assunto, cartões que filtram, seleção em qualquer B/L com "Registrar entrega de N B/Ls" (um comando por B/L, não atômico, marcado `ponytail:`), planilha comum do recorte com Navio, Viagem e POD, requisitos com os ícones de hoje, detalhe em blocos com "Analisar" só onde há decisão e Histórico em tabela; migration `296` (filtro `exported`/`unlocked` e autor no histórico). **Achados corrigidos:** "Única BL" passa a "Individual" (inclusive o filtro da lista de Faturas); a conferência do extrato diz "Linha sem identificador no extrato"; fatura inexistente mostra "Fatura não encontrada."; planilha do Histórico com os nomes da tela; seletor "por página" sem corte (`TableFooterPagination`); sem `#a85309` no Desbloqueio de CE. Peça comum: `StatusText` ganhou o tom `danger`. **Teste:** `typecheck`, `lint`, `npm test` (776 arquivos, 4.837 testes; integrações de banco puladas), `build`, `design:check` (linha de base atualizada, só quedas), `a11y:contrast`, `docs:check`, `migrations:check`, `rpc:check` contra o banco local com a `296`. **Runtime:** Postgres 16 local com `validation_seed`, `seed_audit` e os dados de teste da proposta, `sb-shim` e Vite, a 1440 px: detalhe da FAT-2026-0014, `/taxas-locais/tabelas` (duas abas), `/reconciliacao` (Histórico e Pendências), `/desbloqueio-ce` (duas abas e o detalhe CE-2026-000038), sem rolagem lateral da página. **Não verificado:** 768 e 360 px; Conciliar extrato em runtime depois da mudança (coberto por teste); a `296` no Supabase remoto. **Ficou de fora:** Cliente nas faturas candidatas de uma exceção (a RPC não devolve; pede migration); "Revogar aprovação" do VIP no detalhe (continua na ficha do Cliente); POD como lista no Desbloqueio (sem fonte de opções); marca VIP abaixo do nome do Cliente na tabela. |
| 2026-10-18 | Lote 4 (restante do Portal) | `claude/laughing-meitner-3rfy0l`, PR 972 | Implementado em quatro frentes (Painel e Faturas; Demurrage; BLs e Containers, Central de Informações e Perfil; Desbloqueio de CE e Documentos anuais VIP) contra a página aprovada. Migrations `298` (só fatura emitida e liberada no Portal, ADR 0088), `299` (B/L muda de solicitação, ADR 0089) e `300` (e-mail de recuperação só na sessão do Cliente). **Revisão do Codex:** migration `301` (B/L que mudou não volta à solicitação cancelada nem pesa no reenvio dela; "aguardando fatura" só pela pendência de Taxas Locais), prévia da mudança contada por todos os B/Ls ativos da antiga e Perfil relendo o e-mail de recuperação depois da confirmação. **Diferente da página, de propósito:** "Aguardando fatura" sem valor (a maquete mostrava R$ 2.702,00, contra a regra da ADR 0088); motivo "Já está numa consolidada em aberto." sem o número (o RPC não o traz); hora do pagamento escondida também às 12:00:00 (baixa manual grava meio-dia); ícone de link externo no lugar de "↗". **Teste:** `docs:check`, `typecheck`, `lint`, `build`, `a11y:contrast`, `design:check` (linha de base atualizada, sem violação nova), `migrations:check`, `rpc:check`, `npm test` (779 arquivos, 4.904 testes; 95 de banco pulados) e a suíte Postgres local inteira (94 arquivos, 897 testes, antes da `300`; o arquivo da `300` depois, 10 testes). **Runtime:** Postgres 16 local com `sb-shim` e Vite, login do Cliente, 14 telas a 1440 e 360 px sem rolagem lateral nem erro de console. **Não verificado:** migrations no Supabase remoto; ficha do Cliente no Vela (CNPJ de teste inválido; peça coberta por teste); Cliente VIP com documentos válidos na confirmação de mudança; fatura coberta (sem dado de teste). |
| 2026-10-19 | Lote 5a (Painel, Alertas, Regras, Provisionamento, Comunicação, faixa do Modo Inspeção) | `claude/stoic-cannon-v7g39p` | Implementado como aprovado, com os achados A1 (cartão do Administrativo), A2 e A3 (migration `324`: mensagens sem repetir o registro, alertas abertos reescritos, Crítico só com alerta crítico ativo), A4, A5 (`inspectionExit`) e A6. Peças comuns novas: `Switch` e `SegmentedControl` `variant="bar"`. **Teste:** ver a entrega (gates locais e `alertasSemRepetirRegistro.local-pg.test.ts` em Postgres 16 local). **Não verificado:** migration aplicada em produção, tema escuro. |
