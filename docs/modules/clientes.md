# Clientes

> **Status:** ativo · **Atualizado:** 2026-10-09 · **Rotas:** `/clientes`, `/clientes/:cnpj`, `/clientes/comunicacao`

## Propósito e escopo

O módulo mantém o cadastro mestre de clientes, seus contatos, o vínculo com B/Ls e invoices, o provisionamento administrativo da Conta de Portal e a comunicação operacional por e-mail. As rotas são internas, montadas sob `ProtectedRoute` e `AppLayout` em `src/AppInterno.tsx`; seleção/exclusão em massa aparece somente para o Administrativo, a gestão do Portal (permissão `portal_provisioning`) para Documentação e Administrativo, e Comunicados exigem a permissão `customer_communications`. A fronteira efetiva continua nas policies, RPCs e Edge Functions do Supabase.

`clientes.md` é dono do ciclo cadastral e do adaptador interno de provisionamento. Autenticação, sessão e autosserviço externos pertencem a [Portal do Cliente](portal-cliente.md); reconciliação manual e gate de faturamento pertencem a [Operação e suporte](operacao-suporte.md).

### Reconciliação de cliente em B/L e Granito

O CNPJ exato, normalizado para 14 caracteres alfanuméricos canônicos, pode preencher automaticamente o
cliente. Match por nome nunca preenche `customer_id` ou `client_id`: fica em
`bls.suggested_customer_id` ou `granite_bls.suggested_client_id`, aparece como
“Sugerido” na fila `/revisao` e exige confirmação humana. O faturamento ignora
as colunas de sugestão. O backfill preserva faturados e decisões manuais; suas
consultas de impacto devem ser executadas em somente-leitura antes da aplicação.

Fontes executáveis principais: `src/pages/Clientes.tsx`, `src/pages/ClientesComunicacao.tsx`, `src/components/customers/CustomerTable.tsx`, `src/components/customers/CreateCustomerModal.tsx`, `src/components/customers/ImportBaseModal.tsx`, `src/components/customers/customerCreateForm.ts`, `src/pages/ClienteFicha.tsx`, `src/components/clientes/FichaTabs.tsx`, `src/components/clientes/fichaTabConfig.ts`, `src/components/clientes/VisaoGeralTab.tsx`, `src/components/clientes/CadastroContatosTab.tsx`, `src/components/clientes/OperacionalTab.tsx`, `src/components/clientes/FinanceiroTab.tsx`, `src/components/clientes/HistoricoTab.tsx`, `src/components/bl/BlHistoricoTab.tsx`, `src/components/billing/InvoiceCommunicationStatusCell.tsx`, `src/hooks/useCustomers.ts`, `src/hooks/useCustomerFicha.ts`, `src/hooks/useCustomerCommunications.ts`, `src/hooks/useCustomerCommunicationReadiness.ts`, `src/services/customers.ts`, `src/services/customerFicha.ts`, `src/services/customerCommunications.ts`, `src/services/customerCommunicationDispatches.ts`, `src/services/customerCommunicationTemplates.ts`, `src/services/customerFinanceCommunications.ts`, `src/services/customerCommunicationReadiness.ts`, `src/services/portalProvisioning.ts`, `src/services/customerBase.ts`, `src/services/customerReconciliation.ts`, `src/services/deleteDependencies.ts`, `src/services/deleteAudit.ts`, `src/services/exports.ts`, `supabase/functions/send-customer-communication/index.ts`, `supabase/migrations_archive/376_customer_local_charges_communication_readiness.sql`, `supabase/migrations_archive/377_portal_invoice_exception_audience.sql`, `supabase/migrations_archive/373_comunicados_anexos.sql` e `supabase/migrations_archive/374_comunicados_alertas.sql`.

## Anatomia das telas

### `/clientes`

`src/pages/Clientes.tsx` compõe a tela; busca, filtros, ordem e página vivem na URL (`src/pages/clientesListState.ts`: `q`, `email`, `emails`, `bls`, `saldo`, `ordem`, `dir`, `pagina`), e o "Clientes" do breadcrumb da ficha volta ao último recorte da sessão. As unidades visuais são `src/components/customers/CustomerTable.tsx`, `src/components/customers/CreateCustomerModal.tsx` (incluindo o formulário de contato) e `src/components/customers/ImportBaseModal.tsx` (etapa 04):

- busca sempre visível por razão social, nome fantasia ou CNPJ (com espera de 300 ms antes de consultar);
- dois cards que filtram ao clique: **Saldo pendente** (`saldo=com`) e **Sem e-mail de contato** (`emails=sem`); os demais números do recorte ficam na faixa de resumo da lista (clientes, B/Ls vinculados, com taxas a revisar, prontos para faturar), com "—" quando o resumo falha;
- filtros por e-mail do contato, existência de e-mail, de B/L e de saldo;
- tabela paginada em 50 linhas, ordenável por cliente, quantidade de B/Ls e saldo. O nome do Cliente é o link da ficha; a linha diz em texto o que pede atenção (desativado, situação do Portal quando trava a fatura, sem e-mail, B/Ls com taxas a revisar). A única ação visível é **Mais ações** (⋮): ver faturas em Taxas Locais, copiar CNPJ ou e-mail e, para o Administrativo, desativar/reativar e excluir. Abaixo de 640 px cada Cliente vira um cartão;
- seleção por linha/página e exclusão controlada, visíveis somente para admin;
- criação manual, importação da base e exportação XLSX do recorte inteiro (mesma consulta da lista, todas as páginas, com "Exportando…" no botão);
- estados explícitos de carregamento, erro, vazio inicial (com Importar base e Novo cliente) e vazio do filtro (com Limpar filtros); com cache offline, a tabela continua visível com aviso de desatualização; sem cache, os dados derivados e a tabela são substituídos pelo estado de conexão, não por zeros/lista vazia;
- modais de cadastro e preview da planilha. No cadastro, o contato principal é único (rádio), nasce em todas as Caixas de Comunicação, e os erros de contato e de gravação ficam no próprio modal, que continua aberto.

A consulta usa paginação no Supabase apenas no caso simples. Filtros dependentes de contatos/saldo e ordenações calculadas carregam o conjunto candidato, filtram/ordenam no cliente e só depois recortam a página (`src/hooks/useCustomers.ts`).

### `/clientes/:cnpj`

`src/pages/ClienteFicha.tsx` usa o parâmetro `:cnpj` como chave de `customers.cnpj_cpf` (`maybeSingle`: Cliente inexistente é resposta, sem 406). O cabeçalho identifica o Cliente (CNPJ, nome em DM Sans, nome fantasia, cidade/UF, e-mail do contato principal e B/Ls vinculados) e reúne em **Mais ações** copiar CNPJ, faturas em Taxas Locais, B/Ls na lista de BLs (`/bls?q=<CNPJ>`) e o Provisionamento do Portal. Cliente desativado ganha faixa com data, efeito e motivo. As abas usam `TabList` com painel (`src/components/clientes/fichaTabConfig.ts`, `?tab=`; a Visão geral não grava o parâmetro); a aba **Desbloqueio de CE e VIP** só aparece para quem lê o Desbloqueio de CE e um link antigo sem permissão cai na Visão geral. Todas leem o mesmo `data` de `useCustomerDetail` mais suas próprias queries de `src/hooks/useCustomerFicha.ts` (`src/services/customerFicha.ts`):

- **Visão geral** (`VisaoGeralTab`): ponto de orientação. **Pendências** montadas por `src/components/clientes/fichaOverview.ts`, da mais urgente para a informativa, cada uma com consequência e destino: Portal não provisionado (faturas retidas no registro do CE; Provisionamento e Liberação), Portal não ativo com Liberação vigente (informativo, com a data de revisão), Email de Recuperação com falha, B/Ls em revisão (`/revisao?cliente=<id>`), B/Ls vinculados por nome aguardando confirmação, faturas de Demurrage vencidas, disputas abertas, containers com Demurrage correndo (`/demurrage?busca=<nome>`) e falta de contato principal com e-mail (sem impedir faturamento). Fonte que carrega ou falha é nomeada ("Não foi possível verificar: …", com Tentar novamente) e nunca vira "sem pendência". Ao lado, saldo pendente (Taxas Locais + Demurrage) e a situação: Conta de Portal, Liberação (quando o Portal não está pronto), contato principal e B/Ls. Abaixo, a atividade recente (5 eventos) com o caminho para o Histórico.
- **Cadastro e contatos** (`CadastroContatosTab`): três seções com papéis distintos. **Dados cadastrais**: CNPJ como dado (alterado só pelo Administrativo, no painel do Portal) e campos editáveis; o aviso "N alterações não salvas" com a justificativa obrigatória, Descartar e Salvar cadastro só aparece quando algo mudou, e os erros ficam junto do campo. **Contatos e Caixas de Comunicação** (`CustomerContactConfiguration`): quadro de destinatários por caixa e um grupo por contato (principal, adicional, desativado, origem, endereço bloqueado), com aviso de alteração não salva e Descartar. **Acesso ao Portal**: situação da conta, Email de Recuperação (que só recebe convite e recuperação de senha, não Comunicados nem faturas), entrega e último evento; **Gerenciar aqui** abre o `PortalReviewPanel` (etapa 18) no lugar do resumo, e o link leva ao Provisionamento.
- **Operacional** (`OperacionalTab`): B/Ls vinculados por nome aguardando confirmação e a tabela de B/Ls (revisão e faturamento em palavras, data do vínculo), com caminhos para a Revisão e para a lista de BLs.
- **Financeiro** (`FinanceiroTab`): Liberação de faturamento sem Portal compacta no topo (estado, quando vale, formulário só ao pedir), faturas de Taxas Locais (total e saldo), faturas de Demurrage, recebíveis de Taxas Locais (lidos via RPC `get_customer_receivables`), pagamentos, acordos de Demurrage (modal da etapa 11) e tarifas do cliente — cada seção distingue carregando/erro/restrito/vazio.
- **Histórico** (`HistoricoTab`): timeline completa (auditoria de cadastro com o nome do campo, eventos do Portal, contato criado, alteração de contatos, fatura emitida, pagamento local recebido, Demurrage emitida/paga, B/L vinculado e Comunicado simulado/enviado/falho), ordenada pela data real do evento, da mais recente para a mais antiga.

Loading com skeleton cobre a página inteira antes de qualquer aba montar. Documento ausente ou não encontrado mostra "Cliente não encontrado" com o caminho de volta; falha de consulta mostra o motivo com Tentar novamente.

`useCustomerDetail` carrega `customers`, `customer_contacts` e `bls`. O saldo
pendente da lista usa `get_customer_pending_balances`: o razão
`bl_receivables` é a fonte local e as Demurrages emitidas/vencidas completam o
total, sem somar invoices individuais e consolidadas em duplicidade. Na ficha,
falha ou carregamento de Demurrage aparece explicitamente e nunca vira saldo
zero. O provisionamento é consultado e alterado na fila `/clientes/portal`.

### `/clientes/comunicacao`

`src/pages/ClientesComunicacao.tsx` mantém as abas de cobertura, disparo e histórico. A cobertura filtra navio, viagem e mês e mostra a matriz NOA/NOR/NOB/CE-Taxas. O histórico filtra navio, mês, modelo, status e origem (`Robô automático` ou `Operador`); a viagem pode ser filtrada pela ficha do cliente.

A aba **Disparo** tem duas colunas: à esquerda o operador compõe, à direita o
painel **O que será enviado** responde "quem vai receber isto?" desde o primeiro
segundo, com a frase do disparo, as quatro métricas do recorte, os anexos e os
botões de ação. A frase é montada por `describeCargoScope` a partir dos filtros
informados e, sem recorte operacional, diz o que falta em vez de mentir um
alcance — no modo carga, filtro vazio nunca significa todos os clientes. O CNPJ
aparece na frase, mas não a completa sozinho: como
`validateCustomerCommunicationFilters` não o aceita como recorte, uma frase que se
declarasse pronta com ele contradiria o botão de conferência, que seguiria
travado.

A coluna da composição encadeia três perguntas, separadas por divisórias e sem
numeração (a numeração 1·2·3 prometia um wizard que a tela não tem):

1. **Modo e Modelo** — o Modo é um segmentado de duas opções e o Modelo uma lista
   de rádio com a descrição de cada um visível, sem abrir nada (cada grupo declara
   `role="radiogroup"` com o próprio nome, porque o `name` compartilhado liga os
   rádios para o teclado mas não diz de que pergunta eles são resposta): um select
   esconde
   justamente a diferença entre NOA, NOR, NOB e **Livre**, que é onde morava a
   confusão. O Modo escolhe o Recorte de Destinatários (**Carga**, clientes de uma
   viagem; **Institucional**, Clientes Comunicáveis) e a lista de modelos já vem
   filtrada por ele (`MANUAL_CUSTOMER_COMMUNICATION_KINDS_BY_MODE`). Trocar o
   modelo nunca troca o modo — `filters.mode` é sempre derivado do modelo por
   `getCustomerCommunicationDispatchMode`, e trocar o modo apenas escolhe o
   primeiro modelo válido do novo modo. O título de cada modelo vem de
   `customerCommunicationKindLabel`, e não de uma cópia local, para a lista, a
   faixa-resumo e o histórico dizerem o mesmo nome. O **Público** ocupa sempre a
   mesma faixa, na mesma altura, vindo de `getCustomerCommunicationAudienceRule`:
   fixo na caixa Documentação e Operação para NOA/NOR/NOB (com a etiqueta `Fixo`),
   todos os contatos no institucional, e um select apenas no livre (etiqueta
   `Você escolhe`). No modo Institucional, onde só existe um modelo e o público é
   fixo, os dois controles somem: um select de uma opção só não é escolha, e
   mantê-lo obrigava a repetir na tela o que o Modo já tinha dito. Em lugar deles
   fica uma frase que declara o que o modo resolveu.
2. **Recorte** — no modo Carga, quatro filtros numa linha só: **Navio / Viagem**,
   **POL**, **POD** e CNPJ, com trilhas desiguais de propósito (texto longo nos
   dois extremos, sigla de cinco letras no meio). Exige ao menos um filtro
   operacional (`OPERATIONAL_CUSTOMER_COMMUNICATION_FILTERS`: navio/viagem, POL ou
   POD), validado por `validateCustomerCommunicationFilters`, que também desabilita
   o botão de conferência; CNPJ é restrição adicional, nunca o recorte em si — daí
   o rótulo do grupo nomear os três campos que valem. Navio e viagem são um campo
   só, como no Line-up: `matchesVesselVoyage` casa contra `NAVIO VIAGEM`
   concatenado e exige cada termo digitado, então `ALTAIR 2401E`, `ALTAIR` e
   `2401E` recortam o que o operador espera. O filtro por **Nº da Escala do
   Mercante** não existe mais — era preenchido à mão e, em branco no cadastro,
   zerava o recorte em silêncio; desde o ADR 0067 o NOB é automático e ancorado na
   Atracação, então desambiguar dois terminais deixou de depender dele. No modo
   Institucional o CNPJ opcional não fica órfão numa grade de um campo só: ganha ao
   lado o painel que declara o universo (Cliente Comunicável — B/L com ETA desde
   doze meses atrás, sem limite superior para datas futuras).
3. **Mensagem** — só aparece para os modelos escritos pelo operador
   (`isUserWrittenCustomerCommunicationKind`: institucional e livre). Assunto e
   corpo moram dentro de uma moldura única com a aparência do e-mail, com contagem
   de caracteres e o aviso de que cabeçalho, assinatura e dados da carga são
   acrescentados no envio; por isso usam `input`/`textarea` sem borda própria em
   vez dos primitivos `Input`/`Textarea`. O acervo de modelos salvos é
   compartilhado pelos dois. O **Livre** permanece no modo Carga: é texto escrito
   na hora, endereçado aos clientes da viagem filtrada, e por isso mantém vínculo
   de B/L. Escrever assunto e mensagem é pré-condição para conferir, e não só para
   disparar: a conferência desmonta o editor, então chegar lá sem texto deixaria a
   tela exigindo um campo que ela mesma tirou de cena.

Conferir troca a tela: a composição colapsa numa faixa-resumo de uma linha com
**Editar composição**, e a lista de destinatários assume a coluna principal como
tabela (cabeçalho no padrão do app), em vez dos cartões empilhados que obrigavam a
rolar o formulário inteiro para chegar em quem recebe. `showConference` é estado de
tela e não `conferenceQuery.data`: voltar pelo Editar não muda a chave da query,
então derivar a vista do cache deixaria a lista montada depois do pedido de voltar.
O painel da direita vira **Pronto para disparar**, com as métricas preenchidas,
`Marcar todos`/`Desmarcar` na tabela (a seleção em massa nunca alcança linha
bloqueada) e o motivo textual sempre que o botão de disparo estiver travado. A
coluna **B/Ls** conta apenas os B/Ls vinculados ao Comunicado; nas linhas
institucionais, que não vinculam nenhum, ela diz `Sem vínculo` e mostra à parte
quantas cargas provaram que o cliente é comunicável (`sourceBls`) — somar os dois
sob o mesmo número prometeria um vínculo que o envio não cria.

A conferência agrupa B/Ls por cliente, calcula elegíveis, excluídos e motivos de bloqueio, permite desmarcar destinatários e exige confirmação explícita de reenvio apenas para os modelos ancorados em carga (`requiresResendConfirmation`). Institucional e livre carregam `dispatch_id` novo a cada lote — cada envio é uma mensagem diferente, não o reenvio do mesmo Comunicado —, então o disparo anterior vira informação no painel e não trava a operação.

O preview usa os renderizadores pt-BR de `customerCommunicationTemplates.ts`, com assunto bilíngue, data/hora de Brasília e isolamento por cliente/terminal. Anexos são validados antes do dispatch (até três arquivos, 10 MB no total; formatos de cobrança local e demurrage são proibidos). A faixa de simulação permanece visível enquanto `app_settings.communications_enabled` estiver desligado; nesse estado a Edge Function registra `simulado` e não chama o Resend. Os modelos de texto reutilizáveis (institucional e livre compartilham o mesmo acervo) são salvos pela RPC `save_customer_communication_saved_template`; o bucket de anexos permanece privado e sem escrita direta pelo navegador (`supabase/migrations_archive/375_comunicados_bloco2_correcoes.sql`).

A régua automática cobre NOA, NOR, **NOB** e `ce_mercante_taxas`. Os destinatários
de todo envio automático saem da Caixa de Comunicação que o Cliente configurou —
`documentacao_operacao` nos avisos operacionais, somada a `financeiro` no
comunicado de CE e Taxas —, o mesmo recorte da conferência manual; até a migration
`045` a produtora do cron ignorava as caixas e alcançava todos os contatos do
Cliente. O NOB é produzido por Atracação e restrito aos Clientes da Frente de
Operação atribuída àquele terminal (`bl_operation_front_modalidade` no banco,
`operationFrontKindForCargoMode` no app); Atracação sem frente atribuída não
comunica e mantém o alerta `comunicado_nob_pendente` aberto. Ver ADR 0067.

O Histórico da rota, da ficha do cliente e do B/L lê a mesma trilha de `customer_communications` e `customer_communication_attempts`; a criação do comunicado e de seus vínculos é feita pela RPC atômica `create_customer_communication_atomic`. O runner `supabase/functions/customer-communication-auto-runner/index.ts`, agendado pela migration `381_customer_communications_automation.sql`, avalia NOA, NOR, NOB e `ce_mercante_taxas` em background, aplica a chave global e grava claims idempotentes; as correções de lease e prontidão estão na migration `384_comunicados_automacao_falhas.sql`. A migration `135` corrige `customer_local_charges_communication_payload`, que falhava com `bl_id` ambíguo e impedia o runner de montar o comunicado de taxas locais; `communicationEligibility.local-pg.test.ts` cobre a montagem.

O catálogo estrutural `customer_communication_kinds` precisa conter as dez
combinações fixas da migration `002`. A migration `157` repõe entradas ausentes
sem alterar preferências ou habilitar envio real. A regressão
`customerCommunicationCatalog.local-pg.test.ts` simula a perda do catálogo e
verifica a criação de institucional e livre após reposição idempotente.

O envio com chave global desligada passa `simulate: true` ao helper de e-mail:
registra uma tentativa aceita em modo simulado, sem chamada ao Resend. Falta de
credencial em envio real continua sendo falha. A simulação respeita supressões
e preserva uma confirmação real já existente. **Teste:** `emailShared.test.ts`
e `emailMissingConfiguration.test.ts`. **Runtime em produção, 2026-10-06:**
Functions manual v169 e Demurrage v166 publicadas; institucional `id=2` ficou
`simulado`, com duas tentativas aceitas sem ID do provedor e chave desligada.
O runner Demurrage não foi executado nessa validação.

A identidade única de `customer_communications` combina tipo, cliente, âncoras,
`dispatch_id` e `attempt_discriminator`; o status fica fora dela porque muda
conforme as tentativas são projetadas. A migration
[`100_customer_communication_statusless_idempotency.sql`](../../supabase/migrations/100_customer_communication_statusless_idempotency.sql)
faz preflight sem reescrever tentativas e interrompe a aplicação se encontrar
identidades duplicadas que precisem de reconciliação.

O resumo financeiro `ce_mercante_taxas` não é um disparo genérico por invoice:
após o vínculo do CE, a prontidão é calculada por cliente/viagem e exige CE,
revisão limpa e faturamento concluído em todos os B/Ls ativos. A Taxas Locais
exibe o bloqueio e o último comunicado; um reenvio assistido pede confirmação e
usa novo discriminador. A chave global continua controlando envio real versus
simulação.

## Catálogo de ações

| Tela / ação | Pré-condições | Origem | Orquestração | Persistência | Efeitos e cache | Falhas | Evidência |
|---|---|---|---|---|---|---|---|
| `/clientes` — buscar e filtrar | Usuário interno ativo; termos/filtros opcionais | `Clientes`, `setFilterField` | `useCustomers`/`useCustomerSummary`; busca base no Supabase e filtros de contato, email, B/L e saldo em `filterCustomerRowsByClientSideFilters` | Leitura de `customers`, `customer_contacts`, `bls`; RPC `get_customer_pending_balances` agrega ledger local e Demurrage | Reseta página; queries `['customers', filters]` e `['customers-summary', filters]` | Erro da consulta exibe erro da lista; resumo pode falhar em query própria | **Teste:** `src/hooks/__tests__/useCustomersFilters.test.ts`; **Código:** `src/hooks/useCustomers.ts`, `src/services/customers.ts` |
| `/clientes` — paginar e ordenar | Resultado carregado | `CustomerTable`, botões de cabeçalho e paginação | `toggleSort`, `sortCustomerRows`; ordenação não padrão força varredura e paginação client-side | Somente leitura | Atualiza `filters.sortKey`, `sortDirection` ou `page`; nova chave de query | Custo cresce com o conjunto quando filtro/ordenação exige processamento local | **Teste:** `src/lib/__tests__/customerTableViewModel.test.ts`; **Código:** `src/components/customers/CustomerTable.tsx`, `src/hooks/useCustomers.ts` |
| `/clientes` — selecionar linhas | Admin; linhas na página | Checkboxes em `CustomerTable` e `BulkActionsBar` | `useRowSelection` recebe um escopo formado pelos filtros, ordenação e página; “selecionar todos” atua nos IDs visíveis | Nenhuma | Seleção é limpa ao trocar o escopo ou após exclusão | Não mantém IDs invisíveis de outra página/filtro | **Código:** `src/pages/Clientes.tsx`, `src/components/customers/CustomerTable.tsx`, `src/hooks/useRowSelection.ts` · **Teste:** `src/hooks/__tests__/useRowSelection.test.tsx` |
| `/clientes` — abrir ficha/Taxas Locais | Linha existente | Nome do Cliente (link) e item “Ver faturas em Taxas Locais” do menu da linha em `CustomerTable` | React Router; `buildCustomerBillingUrl` | Nenhuma | Navega para `/clientes/{cnpj_cpf}` ou `/taxas-locais?tab=invoices&customer=...` | Rota de ficha falha se a chave não coincidir exatamente | **Teste:** `src/lib/__tests__/customerTableViewModel.test.ts`; **Código:** `src/components/customers/CustomerTable.tsx` |
| `/clientes/comunicacao` — conferir e disparar Comunicado | `customer_communications`; carga com filtro operacional ou modo institucional | `ClientesComunicacao`, filtros e confirmação | `useCustomerCommunicationConference` → agrupamento/elegibilidade → `useDispatchCustomerCommunication` em sequência; falha da reconferência bloqueia o lote | RPC `create_customer_communication_atomic`; Edge valida B/L/cliente/âncoras e deriva o público fixo dos modelos operacionais | Invalida conferência, históricos da ficha e do B/L; mantém banner de simulação com chave global desligada | Contato inexistente, B/L vazio/alheio, âncora divergente, preferência desabilitada, complaint/bounce, natureza ausente, anexo inválido ou erro do provedor | **Teste:** `src/services/__tests__/customerCommunications.test.ts`, `src/pages/__tests__/ClientesComunicacao.test.tsx`; **Código:** `src/pages/ClientesComunicacao.tsx`, `supabase/functions/send-customer-communication/index.ts` |
| `/clientes` — criar cliente | CNPJ com 14 posições alfanuméricas; razão social com 2+ caracteres; contatos parcialmente preenchidos precisam de nome; um único contato principal, com e-mail | `CreateCustomerModal`, `handleCreateCustomer` | Zod → `createCustomer` → RPC `create_customer_with_contacts`; colagem/digitação normalizada para maiúsculas sem pontuação e validada pelo módulo 11 | Cliente e contatos são inseridos na mesma transação; a migration `293_cnpj_alfanumerico` canonicaliza e valida o identificador, e o trigger do Portal cria a fila sem convite ou email | Invalida `['customers']`, `['customers-summary']` e `['customer-lookup']`; navega à ficha | Duplicidade, CNPJ inválido, contato inválido ou erro de banco revertem toda a criação; o motivo fica no modal, que continua aberto | **Código:** `src/pages/Clientes.tsx`, `src/components/customers/CreateCustomerModal.tsx`, `src/services/customers.ts`, `supabase/migrations_archive/293_cnpj_alfanumerico.sql` |
| `/clientes` — importar planilha | `.xlsx`, `.xls` ou `.csv` dentro do limite; cabeçalho CNPJ e Razão Social | `ImportBaseModal`, `handleBaseFile`/`handleImportBase` | `assertUploadSize` → import dinâmico de `@e965/xlsx` → `parseCustomerBaseRows` → `importCustomerBaseRows`; CNPJ pontuado é normalizado e validado | UPSERT `customers`; INSERT de novos `customer_contacts`; UPDATE de `bls.customer_id` | Preview com novos, atualizados, sem alteração e linhas ignoradas (relatório baixável); invalida `['customers']`, `['customer-lookup']`, `['bls']`; com clientes pendentes o modal continua aberto e lista CNPJ e motivo | Arquivo grande, aba/cabeçalho inválido, CNPJ/nome ausente ou inválido ou falha em qualquer escrita | **Teste:** limite em `src/services/__tests__/uploadLimits.test.ts`; **Código:** `src/components/customers/ImportBaseModal.tsx`, `src/services/customerBase.ts` |
| `/clientes` — exportar conjunto filtrado | Consulta disponível | `handleExportBase` | `fetchCustomerRows(filtros da lista, sem paginar)` — a mesma consulta, busca por documento, filtros e ordem da tabela — e `exportCustomerBaseWorkbook` | Leitura de `customers`, `customer_contacts`, `bls`, saldos; download XLSX local | Não altera cache; exporta todas as páginas do recorte; recorte vazio avisa e não gera arquivo | Toast genérico; a coluna Email do arquivo continua vazia (ver Notas) | **Código:** `src/pages/Clientes.tsx`, `src/services/exports.ts` · **Teste:** `src/pages/__tests__/Clientes.behavior.test.tsx` |
| `/clientes` — prévia e exclusão em massa | Administrativo (os demais não veem seleção nem Excluir); ao menos um ID selecionado | `runCustomerDelete`/`BulkActionsBar` e menu de `CustomerTable` | `checkCustomerDependencies` pede a prévia ao banco; confirmação; `deleteCustomers` | RPC `delete_records('customer', …)` (migration `087`): prévia e exclusão com as mesmas regras; contatos, overrides e cliente saem na mesma sub-transação, com a linha `deleted` em `audit_logs` | Toast conta só o que o banco apagou e lista os recusados; limpa seleção; invalida `customers`, `customers-summary`, `customer-lookup` | Todos bloqueados, cancelamento, recusa de papel (42501). Hoje todo cliente com CNPJ é recusado por `portal_provisioning_events` ser somente inclusão | **Teste:** `src/services/__tests__/deleteRecords.test.ts`, `src/integration/deleteRecords.local-pg.test.ts`; **Código:** `src/pages/Clientes.tsx`, `src/components/customers/CustomerTable.tsx`, `src/services/deleteRecords.ts` |
| `/clientes` — Desativar / Reativar cliente | Administrativo; desativar é recusado com fatura, recebível ou fatura de Demurrage em aberto; motivo obrigatório | Menu da linha em `CustomerTable` | `deactivateCustomer` (prévia e execução) e `reactivateCustomer` → RPCs `deactivate_customer`/`reactivate_customer` (migration `092`) | `customers.deactivated_at`, `deactivated_by`, `deactivation_reason`; `audit_logs` `deactivated` | Cliente desativado sai da busca de cliente, dos overrides e da reconciliação; perde o Portal; B/L novo com o CNPJ dele vira sugestão na Revisão (`matched_name`, nota "cliente desativado"); vínculo manual é recusado | Bloqueio exibido sem abrir a confirmação | `src/pages/Clientes.tsx`; `src/services/customers.ts`; `src/integration/customerDeactivate.local-pg.test.ts` |
| `/clientes/:cnpj` — carregar ficha completa | `:cnpj` presente e igual ao documento persistido | `useCustomerDetail`; query da Conta de Portal para admin | Query mestre/contatos/B/Ls → query de invoices → `getCustomerPortalAccount` | SELECT em `customers`, `customer_contacts`, `bls`, `invoices`; RPC `get_customer_portal_account` | Queries `['customer-detail', cnpj]` e `['customer-portal-account', id]` | Permissão de invoices vira lista vazia com `invoices_access_denied`; demais erros caem no estado genérico | **Código:** `src/hooks/useCustomers.ts`, `src/pages/ClienteFicha.tsx` |
| `/clientes/:cnpj` — editar mestre | Cliente carregado; usuário interno ativo (política `customers_update_active_global`, escrita global da migration `295`, hoje no `002`); justificativa não vazia | `saveCustomer` (aba Cadastro e contatos) | `updateCustomerWithAudit` calcula apenas campos alterados | UPDATE `customers`, depois INSERT em `audit_logs` por campo | Invalida `['customer-detail', cnpj]`, `['customers']` e a timeline; limpa justificativa | Sem alteração não há botão de salvar; justificativa vazia ou falha aparecem junto do formulário; update e auditoria não estão na mesma transação; usuário inativo é recusado pela RLS | **Código:** `src/components/clientes/CadastroContatosTab.tsx`, `src/services/customers.ts`, `supabase/migrations/002_business_logic_and_security.sql` · **Teste:** `src/components/clientes/__tests__/CadastroContatosTab.test.tsx` |
| `/clientes/:cnpj` — criar/editar contatos e caixas | Cliente carregado; permissão `customer_communications` (Documentação, Equipamentos e Administrativo); um principal ativo com e-mail; toda caixa coberta por contato ativo e elegível | `CustomerContactConfiguration` (aba Cadastro e contatos) | `internalSaveCustomerContactConfiguration` grava o conjunto inteiro | RPC `internal_save_customer_contact_configuration` (migration `008`), justificativa opcional no histórico de contatos | Invalida `['customer-detail', cnpj]`, `['customers']`, `['customers-summary']` e `['customer-ficha', 'timeline', customerId]`; recarrega a configuração | Regra violada ou erro do banco ficam no formulário; falha ao carregar mostra Tentar novamente sem formulário | **Código:** `src/components/clientes/CustomerContactConfiguration.tsx` · **Teste:** `src/components/clientes/__tests__/CustomerContactConfiguration.behavior.test.tsx` |
| `/clientes/:cnpj` — desativar contato | Confirmação explícita; mesma permissão; o principal não é desativado sem outro principal | Botão Desativar do contato em `CustomerContactConfiguration` | Marca o rascunho; grava com Salvar contatos | Mesma RPC; o contato fica com o histórico e deixa de receber Comunicados | Mesma invalidação | Cancelamento ou erro do banco | **Código:** `src/components/clientes/CustomerContactConfiguration.tsx` |
| `/clientes/portal` — revisar e enviar convite | Documentação/Administrativo; cliente sem conta ativa; email não suprimido | `ClientesPortal` | `portal-invite-send` gera token opaco, registra hash e envia email | `portal_invites`, `portal_email_attempts`, `customer_portal_accounts` | Ativação pendente ou falha de envio; token nunca chega ao navegador | Email inválido/suprimido, permissão, conta ativa ou rate limit | **Código:** `supabase/functions/portal-invite-send/index.ts` |
| `/clientes/:cnpj` — rota inválida/não encontrada | Documento ausente, formatado ou inexistente | Estado terminal de `ClienteFicha` | `useCustomerDetail` só habilita com valor; consulta por igualdade exata | SELECT `customers` por `cnpj_cpf` | Nenhuma navegação automática | Ausência/PGRST116 mostra “Cliente não encontrado”; demais erros mostram falha de consulta distinta | **Código:** `src/pages/ClienteFicha.tsx`, `src/hooks/useCustomers.ts` · **Teste:** `src/pages/__tests__/ClienteFicha.behavior.test.tsx` |

## Estado e dados

| Estado/fonte | Dono e formato | Observações |
|---|---|---|
| `['customers', filters]` | `useCustomers` | Lista e total da paginação; filtros/ordenação fazem parte da chave. |
| `['customers-summary', filters]` | `useCustomerSummary` | Reexecuta a busca sem paginação; `staleTime` de 60 s. |
| `['customer-detail', cnpj]` | `useCustomerDetail` | Mestre, contatos, B/Ls, todas as invoices (paginadas até esgotar) e saldo apenas de status `issued`. |
| `['customer-lookup', search]` | `useCustomerLookup` | Habilitada com 2+ caracteres; até 25 resultados. |
| `['customer-portal-account', customerId]` | `ClienteFicha` | Somente admin; `retry:false`. |
| `['customer-ficha', 'demurrage-invoices', customerId]` | `useCustomerDemurrageInvoices` | Aba Financeiro/Visão Geral; `Restrictable` (`{ rows, denied }`); paginado até esgotar. |
| `['customer-ficha', 'receivables', customerId]` | `useCustomerReceivables` | Aba Financeiro; lê via RPC `get_customer_receivables` (não a tabela direto — a RLS de `bl_receivables` é `is_admin()`-only e devolveria lista vazia silenciosa para outros perfis); `Restrictable`. |
| `['customer-ficha', 'payments', customerId]` | `useCustomerPayments` | Aba Financeiro; `Restrictable`; paginado até esgotar. |
| `['customer-ficha', 'rate-overrides', customerId]` | `useCustomerRateOverrides` | Aba Financeiro; paginado até esgotar. |
| `['customer-ficha', 'manual-charge-bls', customerId]` | `useCustomerManualChargeBls` | Aba Financeiro; paginado até esgotar. |
| `['customer-ficha', 'pending-reconciliation', customerId]` | `useCustomerPendingReconciliation` | Abas Visão Geral/Operacional; só `matched_name` (documento exato resolve sozinho — `isCustomerReconciliationResolved`). |
| `['customer-ficha', 'running-demurrage', customerId]` | `useCustomerRunningDemurrage` | Aba Visão Geral; paginado até esgotar. |
| `['customer-ficha', 'timeline', customerId]` | `useCustomerTimeline` | Abas Visão Geral/Histórico; invalidada também por mutações de contato (`CadastroContatosTab`), não só por `['customer-detail', cnpj]`. |
| `['customer-communications', 'conference', filters, kind, nature]` | `useCustomerCommunicationConference` | Só habilitada após “Conferir”; escopo inclui modo e todos os filtros, tipo e natureza. |
| `['customer-communications', 'history', customerId?]` | `useCustomerCommunicationHistory` | Histórico da rota ou da ficha; atualizado após cada dispatch. |
| `['customer-communications', 'bl', blId]` | `useBlCommunicationHistory` | Histórico de Comunicados vinculados ao B/L; atualizado após dispatch. |
| `['customer-communications', 'status', voyageId, customerId]` | `useCustomerVoyageCommunicationStatus` | Último envio, discriminador e motivo de bloqueio exibidos em Taxas Locais. |
| Filtros, seleção, modais e formulários | Estado local das páginas | Busca, filtros, ordem e página de `/clientes` persistem na URL (`clientesListState.ts`); a ficha persiste a aba (`?tab=`). Seleção, modais e formulários não persistem. |
| `customers.cnpj_cpf` | Identidade cadastral | UNIQUE e NOT NULL desde `supabase/migrations_archive/001_schema.sql`; a migration `293` persiste 14 caracteres `A-Z0-9` em maiúsculas, sem pontuação. |
| `customer_contacts` | Contatos do cliente | Finalidade aceita: `geral`, `operacional`, `faturamento`, `financeiro`. |
| `customer_portal_accounts` | Conta técnica do Portal | Relaciona cliente a `auth.users` por `auth_user_id`; `active` não substitui o vínculo Auth. |
| `customer_communications` | Trilha de Comunicados | Âncoras e snapshots preservam o contexto do envio; comunicado institucional não possui vínculo B/L. Status `simulado` não encerra alerta operacional. |
| `customer_communication_templates` | Modelos server-side fixos | Um modelo ativo por tipo; leitura autenticada, escrita somente por `service_role`. |
| `customer_communication_saved_templates` | Modelos institucionais reutilizáveis | Leitura interna; criação somente pela RPC autorizada. |

O saldo da lista não usa `customers.pending_balance`: `fetchIssuedInvoiceBalanceByCustomer` percorre invoices `issued`. A ficha aplica a mesma noção sobre as invoices que conseguiu ler. Dados de matching ficam em quatro mapas em memória, carregados em páginas de 1.000 registros por `loadCustomerMaps`.

## Fluxos e invariantes

1. **Identidade normalizada:** todo cliente tem CNPJ de 14 posições; CNPJs numéricos e alfanuméricos coexistem. Entrada e colagem removem pontuação, preservam letras e convertem para maiúsculas; `customers.cnpj_cpf` é a identidade única.
2. **Chave de rota:** `/clientes/:cnpj` consulta igualdade exata. Links internos usam o valor persistido; deep links devem usar o CNPJ canônico sem pontuação.
3. **Contatos:** `purpose` pertence ao conjunto `geral/operacional/faturamento/financeiro`; `is_primary` é preferência de exibição, não unicidade garantida pelo service.
4. **Importação e dedupe:** o parser mescla linhas do mesmo documento, preserva o melhor texto e a união de emails; a persistência faz UPSERT por `cnpj_cpf`, evita emails já existentes e vincula retroativamente B/Ls ainda sem cliente quando `manifest_customer_cnpj_cpf` coincide.
5. **Precedência de matching:** documento exato → nome normalizado exato → nome canônico exato → Levenshtein `>= 0,90`. O fuzzy só compara candidatos cujo primeiro token canônico seja idêntico.
6. **Conta ativa funcional:** `active=true` requer `auth_user_id` e email técnico. A sequência canônica é convite aprovado → ativação pelo cliente → identidade técnica vinculada → login por CNPJ.
7. **Edge Functions:** convite, ativação, recuperação e suspensão são fronteiras server-side; o navegador não escolhe a conta diretamente. O email técnico **não** é segredo: depois do login ele aparece no claim `email` do JWT. Por isso o GoTrue guarda `HMAC(PORTAL_PASSWORD_PEPPER, senha)` e não a senha digitada; testar senha direto em `/auth/v1/token` exige o pepper, e o limite por CNPJ do `portal-login` não é contornável (auditoria run-2, #7). Conta ainda com senha pura migra no primeiro login.
8. **Hard delete:** a UI é admin-only, RLS de `customers`/`customer_contacts` reserva DELETE a admin (`supabase/migrations_archive/010_rls_by_role.sql`) e o service bloqueia qualquer cliente com B/L, invoice local, invoice de demurrage, recebível ou lote. Contatos e overrides são removidos antes do mestre; exclusão em massa pode prosseguir parcialmente.
9. **Comunicação por cliente:** cada B/L candidato pertence ao cliente selecionado; NOA/NOR/NOB também exigem a âncora operacional compatível, e institucional rejeita IDs de B/L. Contato, preferência, complaint e bounce são reavaliados na Edge Function, não apenas na UI.
10. **Idempotência e reenvio:** a criação atômica usa tipo, cliente, natureza, âncoras e discriminador; simulação e envio ocupam status distintos, e a confirmação de reenvio incrementa apenas o discriminador daquela trilha.

## Testes e validação

Os testes históricos abaixo foram inspecionados na cartografia; os contratos do Bloco 2 aparecem ao final e devem ser mantidos junto das migrations 373/374.

| Evidência | Tipo | O que sustenta | Limite |
|---|---|---|---|
| `src/services/__tests__/customers.test.ts` | **Teste** unitário | Erros de RPC, saldo `issued`, sequência conta inativa → Function → ativação e bloqueio sem `auth_user_id` | Supabase, Auth e Function são mocks; não prova deploy/runtime. |
| `src/services/__tests__/customers.delete.test.ts` | **Teste** unitário | Bloqueio por B/L/fatura, delete parcial e ordem contatos → overrides → cliente | Não prova RLS, FKs ou auditoria real. |
| `src/services/__tests__/customerReconciliation.test.ts` | **Teste** unitário | Precedência, canonização e guarda do primeiro token no fuzzy | Não carrega uma base real. |
| `src/hooks/__tests__/useCustomersFilters.test.ts` | **Teste** unitário | Filtro de email e cards derivados | Não cobre paginação híbrida nem consulta Supabase. |
| `src/lib/__tests__/customerTableViewModel.test.ts` | **Teste** unitário | Ordenação, chips, contato principal e URL de faturamento | Não cobre interação completa da página. |
| `src/services/__tests__/uploadLimits.test.ts` | **Teste** unitário | Rejeição de planilha acima do limite antes de `arrayBuffer` | Não cobre parsing/importação de fixture válida. |
| `src/services/__tests__/reviewGateHardeningMigration.test.ts` | **Teste de contrato SQL** | Presença textual do gate `active + auth_user_id` e rejeição de ativação inválida | Regex/conteúdo de migration; não executa PostgreSQL nem confirma migration aplicada. |
| `src/services/__tests__/customerCommunicationTemplates.test.ts` | **Teste** unitário | Render pt-BR, assunto bilíngue, data de Brasília, isolamento e limites/bloqueios de anexos | Não envia e-mail real nem executa Storage. |
| `src/services/__tests__/avisosOperacionaisAssuntoParidade.test.ts` | **Teste** de paridade | Renderizador, seed do squash e migration `046` repetem o mesmo assunto bilíngue | Não executa a migration; compara o texto. |
| `src/services/__tests__/customerCommunications.test.ts` | **Teste** unitário | Filtros de carga, CNPJ, Cliente Comunicável, agrupamento, exclusões e discriminador de reenvio | Não confirma RLS nem dados remotos reais. |
| `src/services/__tests__/sendCustomerCommunicationFunction.test.ts` | **Teste de contrato** | Auth/permissão, natureza, preferência, supressões, RPC atômica e simulação sem Resend | Contrato textual da Function; não prova deploy ou envio externo. |
| `src/services/__tests__/comunicadosAnexosMigration.test.ts` | **Teste de contrato SQL** | Bucket privado, limites/MIME, RLS de Storage/templates e RPC atômica | Não executa PostgreSQL nem confirma migration aplicada. |
| `src/services/__tests__/comunicadosAlertasMigration.test.ts` | **Teste de contrato SQL** | Catálogo e detectores NOA/NOR/NOB/bounce, janelas e runner server-only | Não executa o scheduler remoto. |
| `src/pages/__tests__/Clientes.behavior.test.tsx` | **Teste** de comportamento | Sem cache offline mostra indisponibilidade; com cache mantém linhas e avisa que estão salvas | Não simula browser/rede real; Preview é validado separadamente. |

**Runtime:** no Preview #797, SHA `70f39333`, em 2026-09-29, foi testado `/clientes` autenticado como `Preview Admin`. Offline com cache, o cliente e os resumos permaneceram visíveis com aviso de dados salvos. Um filtro novo em modo offline, sem cache para a query, mostrou indisponibilidade sem tabela nem KPIs; ao reconectar, a leitura retomou e limpar o filtro restaurou o cliente. A validação cadastral restante precisa registrar ambiente e dados controlados para: criar cliente e contatos; importar XLSX/CSV com duplicatas, erros e B/L retroativo; editar mestre e conferir `audit_logs`; provisionar/criar/resetar/desativar usuário Auth real; tentar ativação sem `auth_user_id`; excluir lote misto e conferir bloqueios, RLS, cascatas/SET NULL e auditoria.

### Provisionamento do Portal

O cabeçalho desta página é o ponto de entrada para `/clientes/portal`, com badge de Clientes aguardando análise. A ficha mantém, na seção Acesso ao Portal, o resumo, o botão “Gerenciar aqui” e o deep link por ID; contatos continuam candidatos e não sincronizam o Email de Recuperação.

## Notas e divergências

- **Exportação e recorte (corrigido em 2026-10-09, etapa 08 da revisão visual).** `handleExportBase` passou a usar `fetchCustomerRows`, a mesma consulta da lista: busca por documento, filtros e ordem iguais aos da tabela. Continua em aberto que `exportCustomerBaseWorkbook` grava a coluna Email vazia (serviço de exportação, fora da tela).
- **Código — update e auditoria não são atômicos.** `updateCustomerWithAudit` atualiza `customers` antes de inserir `audit_logs`; falha da auditoria deixa o cadastro alterado embora a UI informe falha.
- **Código — mensagem de migration desatualizada.** `normalizeCustomerPortalRpcError` orienta aplicar `025_billing_orchestration_portal.sql`, enquanto o contrato vigente de ativação foi endurecido por `supabase/migrations_archive/129_review_gate_hardening.sql`.
- `customer_rate_overrides` é apagado junto do hard delete, mas sua manutenção funcional pertence a [Taxas Locais](taxas-locais.md).
### Cobertura e automação de Comunicados

**Código:** `/clientes/comunicacao` agora expõe o painel de cobertura, o
disparo manual e o histórico auditável. O runner `customer-communication-
auto-runner` avalia NOA, NOR, NOB e CE Mercante em background a cada quinze minutos, respeita a
chave global de envio e registra a origem como `automatico`; a chave de claim
impede duplicação em execuções concorrentes. O histórico principal filtra
navio, mês, modelo, status e origem; a viagem pode ser restringida pela ficha
do cliente.

### Caixas do contato principal

O editor interno de contatos aplica a mesma regra do Perfil no Portal, compartilhada em `src/lib/customerContactDrafts.ts`: o principal sem vínculos começa com as três caixas marcadas; caixas sem substituto elegível são repostas no rascunho, e delegações salvas com cobertura são preservadas. Uma caixa do principal só pode ser desmarcada quando outro contato ativo, com e-mail e sem bloqueio de entrega, cobre aquela caixa. As alterações dependem de salvar; usuários sem permissão de edição visualizam os vínculos armazenados.

### Desbloqueio de CE Mercante — 2026-10-04

O módulo de [Desbloqueio de CE](desbloqueio-ce.md) introduz pedidos no Portal,
gestão em Importação e condição VIP/documentos anuais na ficha do Cliente.
Implementado no checkout; publicação ainda não executada.

O botão **Informações do Portal** em `/clientes/portal` abre `/clientes/informacoes`;
esse acesso não ocupa a barra superior. A aba Demurrage exibe a tabela oficial
de tarifas e permite editar as observações públicas conforme as permissões.
