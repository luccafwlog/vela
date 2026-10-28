# Pedidos por área (rascunho para lançar os agentes)

## 01-acesso-admin — ACE
Nome: "Entrada, navegação, Painel, usuários e setores, permissões, ações sobre registros, histórico e relatórios".
Docs: docs/modules/operacao-suporte.md (Guards, shell e navegação; `/painel`; `/relatorios`; `/admin`; Administrativo ativo mínimo; Conta de integração; Shell e navegação), docs/operations/seguranca.md (Modelo de permissões por perfil — as 39 linhas), docs/operations/regras-de-negocio.md (Ações sobre registros: seleção em massa, vocabulário e rótulos, confirmação de ação, hard delete controlado, Trava de exclusão, Cadastro usado, Guarda e recuperação; Permissões internas), docs/identidade-visual.md (cores de status), CONTEXT.md (Ações sobre registros; Histórico e auditoria).
Telas: src/pages/Login.tsx, Painel.tsx, Admin.tsx, adminTabs.ts, Profile.tsx, Relatorios.tsx, relatoriosListState.ts, NaoEncontrado.tsx; src/AppInterno.tsx (guards, menu), componentes de layout (src/components/layout/), janela de confirmação e motivo (procure ConfirmDialog/Justification), notificações internas no topo (sino).
Serviços: adminUsers.ts, adminObservability.ts, auditEntries.ts, deleteRecords.ts, deleteDependencies.ts, permissionMatrix.ts, reports.ts, exports.ts, operationalLists.ts, operationalEvents.ts, appSettings.ts, supabase.ts, supabaseAuth.ts (lado interno); src/lib/errors.ts (mensagens genéricas que a tela mostra para erros do banco), src/lib/departmentLabel.ts, passwordPolicy.ts; função de servidor admin-users.
Material antigo: páginas 1–11 e 28–33 (núcleo comum, "Como o Vela fala", Quem pode o quê, Administrativo, Multissetor, Mensagens do sistema). Pontos a confirmar nº 1, 2, 6, 16, 17, 18 e 19 (texto em manual-antigo.txt, página 35).
Seção extra obrigatória "## Quem faz o quê" (antes de Divergências): (1) as 39 linhas da matriz "O que cada setor pode" conferidas uma a uma contra a guarda do banco que cada uma resume (o banco decide; diga se bate); (2) ações restritas por setor no banco que a matriz não lista; (3) a regra que põe cada pendência num cartão de setor do Painel (Documentação, Equipamentos, Operações, "Sem setor/Legado"?) e se há cartão do Financeiro/Administrativo; (4) como o sistema trata quem trabalha em mais de um setor (um setor por usuário?). Depois, uma tabela por equipe (Documentação, Equipamentos, Operações, Financeiro, Administrativo): o que só ela (com o Administrativo) pode; o que recebe (cartão do Painel); o que todos podem. Onde o código não distingue setores, diga "qualquer setor".

## 02-viagens-adr — VIA
Nome: "Viagens, Escalas, Atracação, datas do navio, omissão, transbordo e COD, ADR de Saída, Chegadas e Saídas, Line-Up e cadastros de apoio".
Docs: docs/modules/viagens.md, docs/modules/chegadas-saidas.md, docs/modules/operacao-suporte.md (`/line-up-tv`, Line-Up), CONTEXT.md (Operação marítima).
Telas: src/pages/Viagens.tsx, ChegadasSaidas.tsx, chegadasSaidasForm.ts, LineUpTVDisplay.tsx; componentes da ficha da Viagem e do ADR (src/components/ — procure voyage, viagem, escala, adr, agency).
Serviços: voyages.ts, voyageForm.ts, voyageFromSchedule.ts, voyageReadModels.ts, voyageRouteSchedules.ts, voyageSummaries.ts, voyageTimeline.ts, voyageVehicleStats.ts, voyageExportSchedules.ts, agencyDepartureReport.ts, agencyReportDeadline.ts, agencyReportInvalidation.ts, agencyReportLabels.ts, agencyReportSla.ts, escalaTerminalAllocation.ts, transshipments.ts, blChangeOfDestinationService.ts, lineup.ts, portalScheduleBulkImport.ts, portalScheduleLanes.ts, portalScheduleVoyages.ts, vesselScheduleImport.ts, portCode.ts, blTerminal.ts; src/lib/escalaState.ts, lineupCycle.ts, lineupFilters.ts.
Material antigo: páginas 5–7 (Line-Up e TV), 9 (ficha da Viagem), 11–13 (ADR) e 26–28 (Trilha Operações). Pontos a confirmar nº 7 ("Não há frente atribuída a este terminal."), 8 (quem reabre o ADR e prazo), 9 (Financeiro tem seção no ADR?) e 20 (o que é COD no Vela).

## 04-ce-baplie — CEB
Nome: "CE Mercante, Manifesto Mercante e Baplie (EDI)".
Docs: docs/modules/manifesto-edi.md (CE Mercante; Manifesto Mercante; `/baplie`; Baplie: marcas, SOC/COC e divergências), docs/operations/regras-de-negocio.md (Conciliação Baplie ↔ B/L; CE e Manifesto Mercante; Gate de CE Mercante no Portal), CONTEXT.md (Baplie e reconciliação; Mercante).
Telas: src/pages/Baplie.tsx, bapliePresentation.ts; onde a ficha do B/L e a ficha da Viagem mostram e editam o CE e o Manifesto Mercante (src/components/).
Serviços: baplieImport.ts, baplieInvalidation.ts, baplieParser.ts, baplieReadModel.ts, baplieReconciliation.ts, baplieWorker.ts, blCeMercante.ts, ceMercanteImport.ts, manifestosMercanteService.ts.
Material antigo: páginas 14–15 (importação do CE Mercante, Baplie EDI). Ponto a confirmar nº 3 (só a parte do CE Mercante: rota exata da importação).

## 05-equipamentos — EQU
Nome: "Containers, datas de container, veículos, Vazios de importação, Embarque de Vazios, Locais (depots) e Granito".
Docs: docs/modules/manifesto-edi.md (`/containers`, `/veiculos`, `/vazios-importacao`, `/embarquevazios`, `/embarquevazios/depots`), docs/modules/granito.md, CONTEXT.md.
Telas: src/pages/Containers.tsx, containersListState.ts, Veiculos.tsx, veiculosPresentation.ts, VaziosImportacao.tsx, EmbarqueVazios.tsx, DepotCadastro.tsx, Granite.tsx.
Serviços: containers.ts, containerCorrection.ts, containerDatesImport.ts, containerTeu.ts, vehicles.ts, vehicleImport.ts, vaziosCusto.ts, vaziosExportOperations.ts, vaziosImport.ts, vaziosImportacaoImport.ts, vaziosNatureza.ts, depots.ts, graniteCargo.ts, graniteImport.ts; src/lib/containerNumber.ts, containerOwnership.ts, containerCounts.ts.
Material antigo: páginas 15 (Containers, Veículos, Vazios IMP), 23–26 (Trilha Equipamentos: Containers e Demurrage, Veículos, Granito, Vazios EXP). Ponto a confirmar nº 11 (Granito: como a cobrança segue).

## 06-clientes-comunicacao — CLI
Nome: "Cadastro do Cliente, Base de Clientes, contatos e Caixas de Comunicação, Comunicados (manuais e régua automática) e Central de Informações (lado interno)".
Docs: docs/modules/clientes.md (inteiro), docs/modules/portal-cliente.md (Central de Informações), docs/operations/regras-de-negocio.md (Reconciliação de cliente; Chave de envio e supressão de e-mail), CONTEXT.md (Revisão e clientes; Comunicação com o cliente; Central de Informações).
Telas: src/pages/Clientes.tsx, clientesListState.ts, ClienteFicha.tsx, ClientesComunicacao.tsx, ClientesInformacoes.tsx.
Serviços: customers.ts, customerBase.ts, customerFicha.ts, customerCadastroChanges.ts, customerCommunicationBoxes.ts, customerCommunicationDispatches.ts, customerCommunicationReadiness.ts, customerCommunicationTemplates.ts, customerCommunications.ts, customerContactConfiguration.ts, customerFinanceCommunications.ts, informationPort.ts, portalInformation.ts, emailLayout.ts; src/lib/cnpj.ts, customerContactDrafts.ts, customerTableViewModel.ts, communicationAutoRunner.ts; funções de servidor send-customer-communication e customer-communication-auto-runner.
Material antigo: páginas 17–18 (Cliente e Portal, Comunicados) e 26 (Comunicados por Equipamentos). Ponto a confirmar nº 15 (chave global de envio de Comunicados: efeito exato).

## 07-portal — POR
Nome: "Portal Fwlog: provisionamento, convite, ativação, login, senha e e-mail de recuperação, suspensão, Modo Inspeção e tudo o que o Cliente vê e faz no Portal".
Docs: docs/modules/portal-cliente.md (tudo, exceto a publicação da Central de Informações, que é da área 06), docs/operations/portal-rate-limit.md, docs/operations/regras-de-negocio.md (Gate de CE Mercante no Portal; Chave de envio e supressão de e-mail), CONTEXT.md (Portal do Cliente).
Telas: src/pages/Portal*.tsx (PortalLogin, PortalAtivacao, PortalForgotPassword, PortalResetPassword, PortalConfirmarEmail, PortalDashboard, PortalBilling, PortalOperacao, PortalInformation, PortalProfile, PortalInspection), src/pages/ClientesPortal.tsx (console interno de provisionamento), src/AppPortal.tsx.
Serviços: portalProvisioning.ts, portalBilling.ts, portalOperation.ts, portalScope.ts, portalRpcContracts.ts, portalContactConfiguration.ts, supabaseAuth.ts; src/lib/portal*.ts, maskEmail.ts, passwordPolicy.ts; funções de servidor portal-* (login, invite-send, invite-activate, password-recovery, password-reset, recovery-email-change, account-suspend, daily-digest, email-webhook, email-events-runner, dispute-attachment) e _shared/portal*.ts.
Material antigo: páginas 17–18 (Cliente e Portal) e 33 (Mensagens que o Cliente vê no Portal).

## 08-desbloqueio-ce — DCE
Nome: "Desbloqueio de CE (Vela e Portal): pedidos, requisitos, condição VIP, documentos, entrega, prazo, avisos, ZPT".
Docs: docs/modules/desbloqueio-ce.md (inteiro), CONTEXT.md (Desbloqueio de CE e condição VIP).
Telas: src/pages/DesbloqueioCe.tsx, PortalDesbloqueioCe.tsx; componentes relacionados.
Serviços: ceUnlockRules.ts, ceUnlockService.ts, ceUnlockSla.ts, ceUnlockZptReconcile.ts; src/lib/ceUnlockCoverage.ts, ceUnlockLabels.ts; funções de servidor ce-unlock-cleanup, ce-unlock-document-download, ce-unlock-export, ce-unlock-notify-email, portal-ce-unlock-document; _shared/ceUnlock*.ts. As funções do esquema ce_unlock_private (command, actor, vip_json, request_json…) são suas.
Material antigo: páginas 19–20 (Desbloqueio de CE). Ponto a confirmar nº 10 (botões, o que o Cliente vê em cada etapa, o que é ZPT).

## 09a-taxas-locais — TAX
Nome: "Taxas Locais: tabelas, itens de taxa, Condições de Cliente, fato gerador e cálculo, preço fixado na importação, data de referência, movimento e isenção, THD IMO/OOG, taxa manual do B/L".
Docs: docs/modules/taxas-locais.md (inteiro), CONTEXT.md (Faturamento, parte de Taxas Locais).
Telas: src/pages/TaxasLocaisTabelas.tsx, taxasLocaisHelpers.ts (parte de cálculo), e onde a ficha do B/L mostra o cálculo e permite taxa manual.
Serviços: src/services/charges/ (inteiro), billing.ts (só a parte de cálculo), blDemurrageConfig.ts não; invoiceBasisCacheKeys.ts.
Material antigo: páginas 10 e 15–16 (Gate: "Cálculo elegível"). Ponto a confirmar nº 5 (condição "cálculo elegível": o que é e quem resolve).

## 09b-faturamento — FAT
Nome: "Faturamento: o que segura a emissão (gate), Liberação sem Portal, emissão automática, individual, consolidada e avulsa, Validação, número, documento, câmbio, vencimento, correção após emissão, troca de Cliente, Ajuste de COD, cancelamento de fatura e documento impresso".
Docs: docs/modules/faturamento.md (exceto pagamento e restituição, que são da área 10), docs/operations/regras-de-negocio.md (Gate de faturamento; Liberação de faturamento sem Portal; Numeração de invoices; Ledger local; Vencimento e inadimplência; Câmbio), docs/operations/manual-financeiro.md, CONTEXT.md (Faturamento; Correção de B/L após faturamento).
Telas: src/pages/TaxasLocais.tsx, taxasLocaisHelpers.ts, faturamentoInvoiceStatus.ts, faturasListState.ts; componentes em src/components/billing/.
Serviços: billing.ts, billingLedger.ts (exceto pagamentos), billingPortalRelease.ts, financialValidation.ts, localBatchBillingWorkflow.ts, reviewBillingAutomation.ts; src/lib/invoiceSituation.ts, chargeStatus.ts, invoiceItemUnit.ts, printDocument.ts.
Material antigo: páginas 10 (Gate de faturamento), 15–17 (Do B/L à fatura, avulsa) e 20 (Faturas em Taxas Locais). Pontos a confirmar nº 5 (parte do gate), 11 (Granito: como a cobrança segue, parte da fatura) e 20 (COD).

## 10-recebimento — REC
Nome: "Recebimento: cobrança Pix do Itaú e baixa automática, Pendências e Pix em análise, plano B pelo extrato, baixa manual, cancelamento de baixa, recibo, restituição e confirmação de devolução".
Docs: docs/modules/reconciliacao-pix.md (inteiro), docs/modules/faturamento.md (Pagamento, saldo e restituição; Detalhe, pagamento, restituição e cancelamento), docs/operations/manual-financeiro.md, docs/operations/regras-de-negocio.md (Conciliação PIX), CONTEXT.md.
Telas: src/pages/Reconciliacao.tsx, reconciliacaoState.ts, faturamentoLedgerPayment.ts; componentes de pagamento e restituição em src/components/billing/.
Serviços: reconciliacao.ts, financialRefunds.ts, billingLedger.ts (pagamentos); src/lib/pix.ts (só leitura), pixDecoder.ts; função de servidor itau-pix e _shared/itauPix.ts.
Material antigo: páginas 20–23 (Pagamento e conciliação Pix, O que fazer em cada situação). Pontos a confirmar nº 13 (recibo vai ao Cliente sozinho?) e 14 (cancelar baixa: a fatura volta a ficar em aberto?).

## 11-demurrage — DEM
Nome: "Demurrage: datas e status do container, SOC, tarifas, free time, P1 e P2, acordo do Cliente, Invoice de Demurrage, cobrança por caixa, PTAX e recálculo, desconto, baixa, cancelamento e restituição, Régua de Cobrança e Disputa".
Docs: docs/modules/demurrage.md (inteiro), CONTEXT.md (Demurrage).
Telas: src/pages/Demurrage.tsx, demurrageListState.ts, DemurrageRates.tsx; componentes em src/components/demurrage/; aba de faturamento da ficha do B/L no que toca a Demurrage; o lado do Portal da Disputa.
Serviços: src/services/demurrage/ (inteiro), demurrageDunning.ts, blDemurrageConfig.ts; funções de servidor demurrage-dunning, recalc-demurrage-ptax, portal-dispute-attachment; _shared/demurrage*.ts.
Material antigo: páginas 23–25 (Containers e Demurrage, Invoice, Informar PTAX, Disputa). Ponto a confirmar nº 12 (faixas P1/P2 e como funciona a Régua de Cobrança).

## 12-alertas-rotinas — ALE
Nome: "Alertas, Notificações Internas e rotinas por horário".
Docs: docs/modules/operacao-suporte.md (`/alertas`, `/alertas/regras`, Alertas e Notificações Internas), docs/revisao-alertas-2026-10.md (registro datado), docs/operations/observabilidade.md (rotinas), docs/operations/segredos-cron.md (só para saber o que cada rotina faz), CONTEXT.md (Alertas e notificações).
Telas: src/pages/Alertas.tsx, AlertasRegras.tsx; o sino de Notificações Internas.
Serviços: alerts.ts, alertRulesCatalog.ts (o texto da tela de Regras); função de servidor alerts-detector.
Seção extra obrigatória "## Catálogo de alertas" (antes de Mensagens): uma linha por tipo do catálogo (`select * from alert_type_catalog`, 55 tipos, inclusive os inativos): `alerta:tipo` | nome na tela | quando abre (condição exata no código) | quem recebe (setores) | severidade | quando fecha sozinho | o que o operador faz e em que tela | destino. Para isso, leia quem cria cada tipo (funções e gatilhos que gravam em alert_items/alerts/internal_notifications) e quem resolve. Também uma linha por rotina por horário (`select jobname, schedule, command from cron.job`, 16) dizendo, em linguagem de operação, o que ela faz e a cada quanto tempo, mesmo que a rotina tenha sido distribuída a outra área.
Material antigo: páginas 5–7 (Painel, Alertas, sino, Regras). Ponto a confirmar nº 2 (parte: quem tria o cartão "Sem setor/Legado").

## 03-bl-revisao — BLR
Nome: "B/L, arquivo de B/L, carga solta e mista, ficha do B/L, Revisão e efeitos de importação".
Docs: docs/modules/manifesto-edi.md (BLs, `/bls`, `/bls/:blId`, importação do B/L, correção após faturamento, B/L Cancelado e exclusão, modalidade, peso e cubagem, contato do manifesto), docs/modules/operacao-suporte.md (`/revisao`, Gate canônico de revisão, Revisão até faturamento), docs/modules/clientes.md (Reconciliação de cliente no B/L, E-mail capturado do B/L), docs/operations/regras-de-negocio.md (Importações, Leitura de planilhas, Rastro das importações, Efeitos de importação), CONTEXT.md.
Telas: src/pages/Bls.tsx, BlDetalhe.tsx, Revisao.tsx, blDetalheHelpers.ts, blsListState.ts, revisaoHelpers.ts e componentes usados por elas.
Serviços: bls.ts, blState.ts, blRails.ts, blFreightImport.ts, blParser.ts, blDocument*.ts, breakbulk*.ts, importCore.ts, importEffects.ts, importFileReceipt.ts, importText.ts, importValidation.ts, manifestImport.ts, review.ts, reviewCustomerGroup.ts, customerReconciliation.ts, blPortalStatus.ts, blTimeline.ts, blTerminal.ts; função de servidor import-effects-runner.
