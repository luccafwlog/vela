# Revisão visual e UX do Vela e Portal — pacote de prompts

Data: 2026-10-07. Base inspecionada: `main`, commit `0160605a`, checkout inicialmente sem diff.
Estado: prompts preparados; campanha de melhorias ainda não executada.

## O que este pacote cobre

O inventário foi conferido estaticamente nos roteadores, nas páginas, nos componentes e na documentação dos módulos. Não houve navegação autenticada, screenshots ou auditoria visual de runtime nesta preparação. Os tópicos dos prompts são alvos de investigação, não defeitos já comprovados. A etapa 00 reconfirma o checkout e coleta a evidência visual disponível antes do redesenho.

As frentes mencionadas pelo usuário foram ampliadas para abranger as rotas atuais dos dois produtos, superfícies sem rota própria e fluxos compartilhados. A rota atual de faturamento interno é `/taxas-locais`; `/faturamento` é compatibilidade. A inspeção interna reutiliza as telas do Portal e não deve receber uma implementação visual paralela.

## Como enviar sem interferência

1. Use Claude com acesso ao repositório atual, idealmente Claude Code. Em uma conversa sem acesso ao código, estes prompts permitem análise de referências fornecidas, mas não revisão completa nem implementação verificada.
2. Execute as etapas **00 a 23 na ordem abaixo**, uma por vez. Não abra todas para implementar simultaneamente. A ordem numérica é uma sequência conservadora de integração, não uma promessa de independência entre etapas distantes.
3. Em cada nova sessão, cole o **contrato comum** e depois o prompt da etapa. Se o arquivo já estiver acessível ao Claude, o prompt também manda lê-lo; não dependa da memória de outra conversa.
4. Antes de iniciar a etapa seguinte, incorpore a anterior ao checkout usado por ela e confirme a revisão de base. Trabalho validado localmente pode ser incorporado sem publicação. Não trabalhe sobre cópia antiga. Use uma branch da campanha ou branches por etapa derivadas da base já integrada, conforme o fluxo autorizado.
5. Registre no plano o resumo de entrega: revisão-base, arquivos alterados, decisões visuais, checks, evidência e pendências destinadas a outra etapa. A sessão seguinte lê esse registro.
6. Não inicie enquanto houver outro agente/sessão escrevendo nos mesmos arquivos. Worktree evita mistura do diff, mas não impede conflito conceitual na integração.
7. Se surgir necessidade de componente compartilhado fora do escopo, registre a necessidade e o owner; continue o trabalho independente. Envie a correção como nova execução focada ao owner e integre-a antes de depender dela. Não duplique o componente nem crie CSS global para contornar o limite.

O ajuste anterior de Desbloqueio de CE e a integração Itaú Pix precisam ser tratados como trabalho existente. O plano de Pix contém pendências de homologação/recibo; este pacote não afirma que elas estão resolvidas nem autoriza alterá-las como decoração.

## Contrato comum — colar em cada nova sessão

```text
Você atuará como designer de produto, especialista em UX e desenvolvedor responsável pelo Vela e Portal Fwlog. Sua missão é analisar e implementar melhorias concretas na etapa indicada, com grande liberdade criativa na apresentação e interação, respeitando as regras de negócio existentes.

Leia AGENTS.md, CONTEXT.md e as fontes relevantes indicadas pela etapa. Confira diretório, branch, revisão e diff antes de editar; preserve trabalho alheio. Leia docs/plans/2026-10-07-revisao-visual-ux-prompts.md, principalmente direção visual, propriedade dos componentes e registros das etapas anteriores. Confirme que a base inclui os trabalhos anteriores. Não execute outras etapas por iniciativa própria.

Comece pelo objetivo real de quem usa a tela: o que precisa encontrar, compreender, decidir e concluir. Inspecione a implementação, seus consumidores e testes; observe a interface local quando o ambiente estiver disponível. Não invente bugs, screenshots ou fluxos observados. Se runtime estiver indisponível, avance com análise e correções estáticas seguras, registre o limite e deixe a verificação visual pendente.

Explore sua criatividade ao máximo: pode reorganizar hierarquia, densidade, layout, formulários e caminhos de interação, desde que isso melhore a tarefa e mantenha a direção visual adotada. Não se limite a trocar cores e bordas. Evite redesenho genérico, excesso de cards, gradientes decorativos, animações gratuitas e espaço que prejudique comparação de dados. Vela precisa favorecer trabalho operacional; Portal precisa orientar o Cliente com clareza.

Revise tipografia, pesos, títulos, formatação de datas/valores/unidades, espaçamento, alinhamento, largura, contraste, ícones, tabelas, cards, filtros, busca, paginação e hierarquia de botões. Avalie a escolha entre dropdown, combobox, campo livre, edição inline, drawer, modal e página. Use o padrão que simplifica a tarefa; não troque por moda. Preserve contexto, filtros, URL, seleção e retorno à lista quando aplicável.

Questione textos repetidos, explicações desnecessárias, badges excessivos, botões redundantes e ações que não funcionam ou não fazem sentido. Remova redundâncias comprovadas ou consolide-as num caminho encontrável. Corrija falhas locais de interação dentro do escopo, após reprodução/check quando viável. Não esconda uma ação defeituosa só para parecer resolvida. Preserve informações essenciais, consequências, justificativas e confirmação exigida pelo sistema. Use pt-BR e vocabulário do CONTEXT.md; Voltar fecha a confirmação, Cancelar é ação de negócio.

Cubra estados inicial, carregando, vazio, sem resultado do filtro, erro, acesso restrito, enviando/salvando, sucesso e falha parcial. Mostre ação em andamento no botão certo, impeça repetição e não desative toda a tela sem motivo. Evite layout pulando, toast como única explicação e erro de consulta parecendo zero. Dados salvos precisam aparecer atualizados nas telas afetadas, usando os owners de cache existentes quando necessário.

Valide desktop, tablet e celular, inclusive largura de 360 px, zoom, conteúdo longo e muitos registros. Confira teclado, nomes acessíveis, foco visível, foco inicial/retorno em modal, labels, mensagens próximas do campo, contraste e informação que não depende só da cor ou hover. Use dados sintéticos e ambiente local controlado; não faça testes ativos em produção, cobranças bancárias ou envios reais.

Implemente no menor owner existente. Reutilize tokens e primitivas aprovadas; não crie versões de Button/Modal/Combobox nem overrides globais por página. Uma lista de pastas nesta etapa não inclui arquivos explicitamente reservados a outra. Pode ler consumidores de outros módulos e verificar regressões, mas não redesenhá-los. Se um componente novo ou não listado tiver múltiplos consumidores, identifique seu owner na matriz antes de editar.

Design não autoriza alterar cálculo financeiro, elegibilidade, saldo, free time, autorização, RLS, RPCs, clientes de autenticação, schema, parser, integração bancária, exclusões ou publicação. Se encontrar problema nesses contratos, descreva reprodução, impacto e proposta e separe da melhoria visual. Não altere arquivos protegidos. Pode resolver decisões rotineiras de UI sem pedir confirmação; pergunte somente se faltar uma decisão de negócio que realmente bloqueie o trabalho.

Não pare em sugestões quando a etapa pede implementação. Implemente, revise o diff e valide. Para mudança de aplicação, execute npm run docs:check, npm run typecheck, npm run lint, npm test e npm run build conforme AGENTS.md/WORKFLOW.md; integração Supabase só em ambiente explicitamente controlado. Acrescente regressão significativa para lógica não trivial usando o harness existente. Rode a11y:contrast quando houver mudança de cores/tokens. Preserve resultados válidos de código inalterado e repita checks afetados após correções. Atualize documentos vivos quando mudar seus contratos; não reescreva registros históricos.

Entregue: problema/objetivo da tela, mudanças e benefício, comparação antes/depois com evidência quando disponível, rotas/estados/viewports cobertos, arquivos e componentes compartilhados tocados, checks executados e resultados, pendências reais e seu owner. Distinga inspeção estática, teste automatizado e runtime observado. Registre o resumo neste plano para a próxima sessão. Não faça commit, push, PR, deploy, publicação, envio ou mutação remota sem autorização específica. Nesta campanha, o limite padrão é implementação e validação local.
```

## Ordem e matriz de cobertura

Os limites de arquivos nos prompts definem propriedade de edição. Referências a serviços/hooks permitem rastrear o fluxo, não autorizam reescrever domínio. Query params, abas e modais fazem parte da rota dona.

| Etapa | Frente | Rotas / superfícies |
|---|---|---|
| 00 | Direção visual e inventário confirmado | Todo o sistema, somente leitura da aplicação |
| 01 | Componentes e estados compartilhados | Base visual dos dois produtos |
| 02 | Navegação, acesso, perfil e notificações | /login; /perfil; /portal/login; /portal/esqueci-senha; /portal/recuperar-senha; /portal/ativar; /portal/confirmar-email; /portal/perfil; shells e estados de acesso |
| 03 | Viagens, escalas, programação e TV | /viagens; /viagens/:voyageId; /chegadas-saidas; /line-up-tv/display |
| 04 | Experiência comum de importações | Importações chamadas por BLs, Viagens, Baplie, Containers, Clientes e Vazios |
| 05 | BLs internos e ficha do B/L | /bls; /bls/:blId |
| 06 | Carga física e reconciliação operacional | /containers; /veiculos; /baplie |
| 07 | Fila de Revisão e resolução de pendências | /revisao |
| 08 | Clientes e ficha completa | /clientes; /clientes/:cnpj |
| 09 | Tabelas de Taxas Locais e condições negociadas | /taxas-locais/tabelas |
| 10 | Faturamento interno, detalhe e fatura avulsa | /taxas-locais; /faturamento apenas como redirecionamento |
| 11 | Demurrage, acordos, tarifas e disputas internas | /demurrage; /demurrage/taxas; acordos exibidos em outros fluxos |
| 12 | Conciliação PIX e exceções do banco | /reconciliacao; /demurrage/reconciliacao como redirecionamento |
| 13 | Faturas, recibos e documentos imprimíveis | Documentos abertos no Vela e Portal, sem rota própria |
| 14 | Portal: B/Ls e Containers | /portal/operacao; equivalente no Modo Inspeção |
| 15 | Portal: faturas, PIX, consolidação e disputas | /portal/billing; equivalente no Modo Inspeção |
| 16 | Central de Informações e administração do conteúdo | /portal/informacoes; /portal/informacoes/:section; /clientes/informacoes; equivalentes no Modo Inspeção |
| 17 | Desbloqueio de CE Mercante, documentos e VIP | /desbloqueio-ce; /portal/desbloqueio-ce; inspeção e painel CE/VIP na ficha do Cliente |
| 18 | Provisionamento, comunicação e Modo Inspeção | /clientes/portal; /clientes/comunicacao; /clientes/portal/inspecao/:customerId/* |
| 19 | Painéis, Alertas e próximas ações | /painel; /alertas; /alertas/regras; /portal |
| 20 | Granito e tarifas | /granito; /granito/taxas |
| 21 | Vazios de importação/exportação e depots | /vazios-importacao; /embarquevazios; /embarquevazios/depots |
| 22 | Relatórios e Administração | /relatorios; /admin; /admin/:tab |
| 23 | Verificação final entre os dois produtos | Toda a matriz, após integração das etapas anteriores |

Rotas de compatibilidade: `/` leva a `/painel`; `/vazios` a `/embarquevazios`; `/carga-solta` e `/manifestos` a `/bls`; `/carga-solta/:blId` a `/bls/:blId`; `/demurrage/invoices` a `/demurrage`; `/demurrage/reconciliacao` a `/reconciliacao`; `/faturamento` preserva os redirecionamentos financeiros previstos. Não crie telas novas para esses aliases. A base `/line-up-tv` não é uma tela ativa própria. Inclua os fallbacks internos, fallback do Portal e `/admin/:tab` inválida na verificação.

Todas as páginas autenticadas do Portal também precisam ser verificadas em `/clientes/portal/inspecao/:customerId`, com suas subrotas `billing`, `operacao`, `desbloqueio-ce`, `perfil`, `informacoes` e `informacoes/:section`. A página filha tem o mesmo owner do Portal; o wrapper é da 18, o shell da 02.

### Propriedade de superfícies compartilhadas

| Superfície | Única etapa que redesenha | Consumidores que apenas reutilizam |
|---|---|---|
| Tokens, primitivas, modal genérico, confirmação, loading/erro e ações em massa | 01 | Todas |
| Shells, sino interno/Portal, contato do Portal e perfil | 02 | Todas as rotas autenticadas; inspeção |
| Seleção/criação de Viagem, programação, ShipScheduleWidget | 03 | Importações, cargas, dashboards |
| Leitura/preview/resultado visual de importações comuns | 04 | BLs, Baplie, Viagens, Containers, Clientes, Vazios |
| Seções da ficha do B/L | 05 | Ficha, listas e caminhos para o B/L |
| Contatos internos e BillingPortalReleaseCard | 08 | Ficha do Cliente, provisionamento |
| InvoiceDetailModal e controles locais de faturamento | 10 | Taxas Locais, Conciliação e demais callers |
| Acordos e controles internos de Demurrage | 11 | Demurrage e ficha do Cliente |
| ReconciliationHistoryTable | 12 | Conciliação e eventuais consumidores financeiros |
| Kit, faturas, recibos, resumos e ADR impressos; CSS de impressão | 13 | Vela e Portal |
| Modal de fatura, PIX, consolidada e disputa do Portal | 15 | Faturas do Portal e inspeção |
| Seções/editor da Central de Informações | 16 | Portal e administração de informações |
| Todos os componentes ce-unlock e painel CE/VIP | 17 | Vela, Portal e ficha do Cliente |
| Wrapper de inspeção e PortalReviewPanel | 18 | Console e acesso interno à inspeção |

`src/index.css` exige atenção: a etapa 01 possui base/tokens; a 13 somente regras de impressão. Etapas de página não alteram o tema global. A 23 pode corrigir regressões de integração identificadas, sempre registrando owner e consumidores.

## Prompts por etapa

Cada bloco abaixo é o prompt específico. Em uma sessão nova, envie também o contrato comum acima; com acesso a este arquivo, sua leitura é obrigatória.

### 00 — Direção visual e inventário confirmado

```text
Execute somente a etapa 00 — Direção visual e inventário confirmado do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: Todo o sistema, somente leitura da aplicação.
Owners de apresentação: src/AppInterno.tsx; src/AppPortal.tsx; src/components/layout/; src/components/ui/; src/index.css.
Leia primeiro: docs/README.md; docs/RASTREABILIDADE.md; docs/ARCHITECTURE.md.

Confirme o inventário atual de rotas, abas, modais, formulários, documentos e componentes compartilhados. Compare com a matriz deste pacote e acrescente superfícies novas à etapa adequada, sem iniciar sua implementação. Examine telas representativas dos dois produtos no ambiente local disponível. Proponha e escolha, com justificativa, uma direção visual coerente: profissional, legível, expressiva e adequada à operação marítima. Diferencie a densidade de trabalho do Vela da orientação ao cliente no Portal. Defina tipografia, escala, espaçamento, contraste, cores semânticas, densidade, navegação, formulários e comportamento responsivo. Não force cards ou espaços excessivos sobre tabelas operacionais. Registre as decisões e a matriz de propriedade no plano vivo deste pacote, sem modificar as telas. A entrega desta etapa é o contrato visual para as seguintes, com lacunas de evidência explícitas.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 01 — Componentes e estados compartilhados

```text
Execute somente a etapa 01 — Componentes e estados compartilhados do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: Base visual dos dois produtos.
Owners de apresentação: src/components/ui/; src/index.css; src/components/shared/QueryStateGate.tsx; src/components/shared/BulkActionsBar.tsx; src/components/shared/OperationalBadges.tsx; src/components/shared/TruncationNote.tsx.
Leia primeiro: WORKFLOW.md §9; docs/ARCHITECTURE.md — Camadas do frontend.

Implemente a direção da etapa 00 nas primitivas existentes. Revise botões, inputs, selects, comboboxes, badges, cards, títulos, breadcrumbs, filtros, abas, paginação, skeletons, toasts, modal e confirmação. Dê aos botões de carregamento texto específico, tamanho estável e proteção contra repetição; diferencie carregamento da tela de uma ação em andamento. Garanta foco, teclado, Escape quando apropriado, retorno de foco, rolagem do modal, leitura por tecnologias assistivas e redução de movimento. Preserve o contrato de confirmação das ações. Verifique consumidores representativos no Vela e no Portal antes de alterar props ou defaults. Esta etapa possui os tokens globais e as primitivas; não redesenhe o conteúdo das páginas nem as regras de impressão, reservadas à etapa 13.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 02 — Navegação, acesso, perfil e notificações

```text
Execute somente a etapa 02 — Navegação, acesso, perfil e notificações do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /login; /perfil; /portal/login; /portal/esqueci-senha; /portal/recuperar-senha; /portal/ativar; /portal/confirmar-email; /portal/perfil; shells e estados de acesso.
Owners de apresentação: src/components/layout/; src/components/portal/NotificationBell.tsx; src/components/portal/PortalContactConfiguration.tsx; src/pages/Login.tsx; src/pages/Profile.tsx; src/pages/PortalLogin.tsx; src/pages/PortalForgotPassword.tsx; src/pages/PortalResetPassword.tsx; src/pages/PortalAtivacao.tsx; src/pages/PortalConfirmarEmail.tsx; src/pages/PortalProfile.tsx; src/pages/NaoEncontrado.tsx; src/components/admin/AlterarMinhaSenhaModal.tsx; src/components/ErrorBoundary.tsx; src/components/PortalErrorBoundary.tsx.
Leia primeiro: docs/modules/portal-cliente.md; docs/modules/operacao-suporte.md; docs/operations/seguranca.md; WORKFLOW.md — Sessões.

Melhore orientação na navegação, agrupamento, indicação de página ativa, menu móvel, logout e estados de sessão. Revise acesso por CNPJ, mostrar senha, recuperação, convite, token inválido/expirado/consumido, confirmação de e-mail e erros próximos aos campos. Preserve mensagens genéricas de recuperação e login, sem revelar existência de conta. No perfil, torne claras as diferenças entre dados cadastrais, contatos, caixas de recebimento e Email de Recuperação; mantenha o salvamento independente por formulário e a cobertura obrigatória dos destinatários. Revise os sinos de notificações, lidas/não lidas, links e feedback. Inclua erro global, acesso restrito e página não encontrada. Não altere clientes de autenticação, regras de sessão ou componentes de provisionamento. A inspeção reutiliza o PortalLayout: preserve sua faixa e bloqueio de escrita.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 03 — Viagens, escalas, programação e TV

```text
Execute somente a etapa 03 — Viagens, escalas, programação e TV do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /viagens; /viagens/:voyageId; /chegadas-saidas; /line-up-tv/display.
Owners de apresentação: src/pages/Viagens.tsx; src/pages/ChegadasSaidas.tsx; src/pages/LineUpTVDisplay.tsx; src/components/voyages/ exceto documentos impressos; src/components/lineup/; src/components/shared/VoyageCreateModal.tsx; src/components/shared/VoyageScheduleModals.tsx; src/components/shared/VoyageSectionCards.tsx; src/components/shared/VoyageCombobox.tsx; src/components/portal/ShipScheduleWidget.tsx.
Leia primeiro: docs/modules/viagens.md; docs/modules/chegadas-saidas.md; docs/modules/operacao-suporte.md.

Revise lista e detalhe da Viagem, seleção, busca, filtros, abas, cards, trilhos, histórico, escalas e Atracações, frentes de importação/exportação, manifestos e ADR. Torne legíveis datas previstas e efetivas e identifique o terminal dono de cada data. Revise formulários de criação/edição, omissão, transbordo, justificativas e assinaturas. Diferencie ETA vencido, data não informada e OMIT; não confunda ADR operacional com decisão arquitetural. Na programação e no widget do Portal, priorize consulta rápida e consistência com a origem das datas. No display de TV, revise distância de leitura, contraste, densidade, paginação/ciclo e atualização sem perturbar a tela. Esta etapa possui o ShipScheduleWidget, consumido pelo painel do Portal na etapa 19. Documentos de ADR pertencem à etapa 13; controles de importação pertencem à 04.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 04 — Experiência comum de importações

```text
Execute somente a etapa 04 — Experiência comum de importações do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: Importações chamadas por BLs, Viagens, Baplie, Containers, Clientes e Vazios.
Owners de apresentação: src/components/shared/FileImportModal.tsx; src/components/shared/BlDocumentImportModal.tsx; src/components/shared/BlImportModal.tsx; src/components/shared/CeMercanteImportModal.tsx; src/components/shared/ContainerDatesImportModal.tsx; src/components/shared/ImportIssuesPanel.tsx; src/components/shared/ImportReadProgress.tsx; src/components/shared/ImportResultPanel.tsx; src/components/shared/VoyageImportActions.tsx; src/components/shared/VaziosImportacaoImportParts.tsx; src/components/customers/ImportBaseModal.tsx.
Leia primeiro: WORKFLOW.md §7; docs/modules/manifesto-edi.md; docs/modules/clientes.md; src/services/importCore.ts.

Revise o percurso selecionar arquivo → ler → conferir → confirmar → ver resultado. Padronize dropzone, formatos/limites, instruções indispensáveis, prévia, avisos, erros por linha, totais e resultado parcial. Mostre claramente o que entra, muda ou é rejeitado e como corrigir; não finja progresso percentual quando o sistema só conhece fases. Preserve a prévia que funciona como confirmação. Evite mensagens técnicas sem orientação, modais excessivos e perda de contexto ao trocar arquivo. Verifique cada consumidor; não crie outro leitor ou matcher de cabeçalhos, nem altere parsers/regras de importação. A planilha ZPT específica do Desbloqueio de CE pertence à etapa 17. Páginas consumidoras só serão compostas nas suas etapas.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 05 — BLs internos e ficha do B/L

```text
Execute somente a etapa 05 — BLs internos e ficha do B/L do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /bls; /bls/:blId.
Owners de apresentação: src/pages/Bls.tsx; src/pages/BlDetalhe.tsx; src/components/bl/.
Leia primeiro: docs/modules/manifesto-edi.md; docs/modules/faturamento.md; CONTEXT.md — B/L, COD e revisão.

Revise listagem, ações de linha e em massa, filtros, expansão, importações como pontos de entrada e todas as abas da ficha. Inclua Visão Geral, trilhos, cliente, carga, frete, operação, cobrança, Portal e histórico. Faça o operador entender situação, bloqueio, próxima ação e consequência sem repetir o mesmo aviso em vários cards. Diferencie container, carga solta e misto, CE Mercante, Manifesto Mercante, transbordo e COD. Revise o card de Portal e a comunicação entre ficha e financeiro. Preserve ações e campos necessários; consolidar uma ação duplicada exige manter um caminho encontrável. Consuma os modais de importação da 04, o modal financeiro da 10 e os acordos/controles internos de Demurrage da 11 sem mudar seus owners. Nesta etapa, componentes de src/components/bl/ são seus, mesmo quando chamados fora da ficha; confira esses consumidores.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 06 — Carga física e reconciliação operacional

```text
Execute somente a etapa 06 — Carga física e reconciliação operacional do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /containers; /veiculos; /baplie.
Owners de apresentação: src/pages/Containers.tsx; src/pages/Veiculos.tsx; src/pages/Baplie.tsx.
Leia primeiro: docs/modules/manifesto-edi.md.

Revise listas, busca por identificador/B/L/Viagem, filtros, tabelas, expansão e edição das datas/localização. Diferencie carga física de documento e dados importados de correção manual. No Baplie, torne compreensível cobertura documental, divergência, pendência e resultado da reconciliação, sem reduzir tudo a uma cor. Mostre o vínculo com Viagem e B/L e o efeito de cada atualização. Inclua arquivo inválido, carga sem documento, identificadores longos, muitas linhas e uso no celular. Componentes comuns de importação pertencem à 04; VoyageCombobox e criação de Viagem à 03; ficha do B/L à 05. Preserve regras de equipamentos e atualização de dados nas telas consumidoras.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 07 — Fila de Revisão e resolução de pendências

```text
Execute somente a etapa 07 — Fila de Revisão e resolução de pendências do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /revisao.
Owners de apresentação: src/pages/Revisao.tsx; src/components/review/; src/components/shared/ReviewInlineEditors.tsx.
Leia primeiro: docs/modules/operacao-suporte.md; docs/modules/clientes.md; docs/modules/taxas-locais.md.

Melhore a triagem por cliente, prioridade, causa e próxima ação, sem alterar o gate canônico por B/L. Revise grupos, drawer, evidências documentais, edição inline, vínculo/criação de Cliente e contato, CNPJs conflitantes e convite opcional. Torne explícito o que bloqueia faturamento, o que falta resolver e o efeito de concluir a revisão. Evite obrigar a pessoa a comparar textos dispersos ou salvar sem compreender os vínculos. Preserve evidências brutas e segregação de conflitos. Mostre carregamento, erro, sucesso e pendência remanescente. Não redesenhe cadastro geral, fila de provisionamento ou motor de cálculo; convites reais não serão enviados como teste.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 08 — Clientes e ficha completa

```text
Execute somente a etapa 08 — Clientes e ficha completa do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /clientes; /clientes/:cnpj.
Owners de apresentação: src/pages/Clientes.tsx; src/pages/ClienteFicha.tsx; src/components/clientes/; src/components/customers/ exceto ImportBaseModal.tsx.
Leia primeiro: docs/modules/clientes.md; docs/modules/portal-cliente.md.

Revise a lista, cadastro, busca, ações e ficha em Visão Geral, Cadastro & Contatos, Operacional, Financeiro, Histórico e Desbloqueio de CE / VIP. Faça a ficha funcionar como ponto de orientação: identidade do Cliente, pendências e caminhos para resolver. Simplifique redundâncias entre cards e abas, preserve links para B/Ls/faturas e diferencie contato de cobrança, recuperação de acesso e cadastro. Esta etapa possui CustomerContactConfiguration e BillingPortalReleaseCard, inclusive seus consumidores no console de Portal; verifique todos. Preserve as consequências da Liberação de faturamento sem Portal e suas permissões. A aba CE/VIP apenas compõe o painel da etapa 17; acordos de Demurrage pertencem à 11; não altere esses componentes aqui.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 09 — Tabelas de Taxas Locais e condições negociadas

```text
Execute somente a etapa 09 — Tabelas de Taxas Locais e condições negociadas do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /taxas-locais/tabelas.
Owners de apresentação: src/pages/TaxasLocaisTabelas.tsx; src/components/taxasLocais/.
Leia primeiro: docs/modules/taxas-locais.md; CONTEXT.md — Taxas Locais.

Revise tabelas, itens, filtros por POD e modo de carga, formulários de inclusão/edição e condições negociadas por Cliente. Torne evidentes moeda, unidade, quantidade, preço, vigência, aplicação e prioridade entre tabelas, sem alterar o cálculo. Dê aos estados ativos, futuros, vencidos e não aplicados o significado real do sistema; vigência exibida não deve prometer um filtro que o motor não executa. Reduza complexidade de seleção e edição sem esconder a origem da tarifa. Inclua tabela sem itens, item manual, override e dados longos. Não altere a operação de faturamento, tarifas de Demurrage/Granito nem referências públicas da Central de Informações.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 10 — Faturamento interno, detalhe e fatura avulsa

```text
Execute somente a etapa 10 — Faturamento interno, detalhe e fatura avulsa do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /taxas-locais; /faturamento apenas como redirecionamento.
Owners de apresentação: src/pages/TaxasLocais.tsx; src/components/billing/ exceto InvoiceDocumentLocal.tsx e ReconciliationHistoryTable.tsx.
Leia primeiro: docs/modules/faturamento.md; docs/modules/taxas-locais.md; docs/operations/manual-financeiro.md.

Revise Validação e faturas, filtros, métricas, conferência, detalhe, consolidada, avulsa, pagamentos, correções, reemissões, restituições, ajustes de COD e alertas financeiros. Dê máxima atenção ao modal de fatura e ao formulário de fatura avulsa: Cliente, Item da tabela versus Outra, vínculos opcionais conforme o tipo, quantidade, moeda e descrição pública. Faça total emitido, recebido, abatimento, devolução, saldo e cobertura serem distinguíveis. Evite modal sobre modal e botões com finalidade duplicada; preserve conferência e justificativas. Esta etapa é dona de InvoiceDetailModal, usado também em Conciliação e outras telas: valide todos os modos, inclusive cancelamento de baixa. Não invente vencimento para Taxas Locais. Layout de documentos e recibos pertence à 13; histórico de conciliação à 12; componentes do Portal à 15. Preserve o trabalho vigente de Pix Itaú.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 11 — Demurrage, acordos, tarifas e disputas internas

```text
Execute somente a etapa 11 — Demurrage, acordos, tarifas e disputas internas do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /demurrage; /demurrage/taxas; acordos exibidos em outros fluxos.
Owners de apresentação: src/pages/Demurrage.tsx; src/pages/DemurrageRates.tsx; src/components/demurrage/ exceto InvoiceDocument.tsx e CustomerSummaryReport.tsx.
Leia primeiro: docs/modules/demurrage.md; docs/operations/manual-financeiro.md.

Revise abas de Containers, Clientes e invoices, free time, datas, períodos, tarifas, acordos por Cliente, descontos, PTAX, emissão, baixa, cancelamento, régua de cobrança e conversas de disputa. Explique valores previstos e emitidos, moeda e câmbio, sem mudar fórmulas nem fixar um free time visual. Separe informação operacional da decisão financeira. Revise modais e seus campos condicionais, justificativas, mensagens e estado de atualização. Esta etapa possui acordos e seus componentes mesmo quando consumidos na ficha do Cliente. Documentos e relatório imprimível são da 13; conversa/disputa do Portal é da 15. Preserve pausa de cobrança e os estados reais de disputa.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 12 — Conciliação PIX e exceções do banco

```text
Execute somente a etapa 12 — Conciliação PIX e exceções do banco do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /reconciliacao; /demurrage/reconciliacao como redirecionamento.
Owners de apresentação: src/pages/Reconciliacao.tsx; src/components/billing/ReconciliationHistoryTable.tsx.
Leia primeiro: docs/modules/reconciliacao-pix.md; docs/operations/manual-financeiro.md; plano vivo da integração Itaú Pix.

Revise o monitor Cobranças Pix Itaú, status de consulta, cobranças pendentes/incertas/com erro, recebimento sem baixa e tratamento com motivo. Revise também upload do extrato, matching, linhas seguras/ambíguas/sem candidato, parcial/excesso, confirmação do lote, resultado por item, histórico, filtros e exportação. Faça a diferença entre Pix recebido, baixa confirmada e exceção pendente ficar clara. Exiba resultado parcial honesto e não prometa baixa porque um spinner acabou. Preserve matching, TXID, idempotência e permissões; não chame o banco real durante testes. Consuma InvoiceDetailModal da 10 e documento/recibo da 13 sem editá-los. Se encontrar falha de saldo ou liquidação, registre como defeito funcional separado do design.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 13 — Faturas, recibos e documentos imprimíveis

```text
Execute somente a etapa 13 — Faturas, recibos e documentos imprimíveis do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: Documentos abertos no Vela e Portal, sem rota própria.
Owners de apresentação: src/components/billing/InvoiceDocumentLocal.tsx; src/components/demurrage/InvoiceDocument.tsx; src/components/demurrage/CustomerSummaryReport.tsx; src/components/voyages/AgencyReportDocument.tsx; src/components/shared/InvoiceDocumentKit.tsx; src/components/shared/invoiceFormat.ts; apenas regras de impressão em src/index.css.
Leia primeiro: WORKFLOW.md §10; docs/modules/faturamento.md; docs/modules/demurrage.md; docs/modules/viagens.md; docs/operations/manual-financeiro.md.

Crie uma apresentação consistente e profissional para fatura individual, consolidada, avulsa, Demurrage, recibo, resumo de Cliente e ADR. Revise hierarquia, identidade, dados do emissor/Cliente, números, datas, itens longos, moeda, totais, quebras de página, rodapé e impressão A4. Diferencie total emitido de dinheiro efetivamente recebido, abatimento, cobertura, restituição e líquido; não descreva cobertura como dinheiro pago. Recibo não deve induzir novo pagamento; preserve o contrato que não exibe PIX nesse documento. Confira visualização em tela e saída de impressão/Salvar como PDF, sem adotar biblioteca nova automaticamente. Esta etapa possui o kit e os documentos compartilhados, mas não a lógica de emissão/baixa ou handlers das páginas. Verifique consumidores internos e do Portal; mude handlers somente em uma etapa do respectivo owner se houver necessidade comprovada.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 14 — Portal: B/Ls e Containers

```text
Execute somente a etapa 14 — Portal: B/Ls e Containers do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /portal/operacao; equivalente no Modo Inspeção.
Owners de apresentação: src/pages/PortalOperacao.tsx; componentes exclusivos de operação do Portal descobertos no checkout.
Leia primeiro: docs/modules/portal-cliente.md; docs/modules/manifesto-edi.md.

Redesenhe a experiência de consultar B/Ls e Containers pensando no Cliente: encontrar a carga, entender situação, datas e próxima providência. Revise abas, filtros, expansão, tabela desktop, cards mobile, paginação e exportação. Destaque pendências úteis, free time e devolução sem saturar a tela com badges. Torne legíveis omissão, Informações de Transbordo e COD, sem expor motivo interno. Preserve o caminho para Depósitos de devolução com POD selecionado e o contexto ao voltar de Faturas ou Informações. Não duplique uma ficha interna dentro do Portal. Preserve query params de aba/devolução e o Modo Inspeção somente leitura. Referências da Central de Informações são da 16; documentos financeiros da 13; CE da 17.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 15 — Portal: faturas, PIX, consolidação e disputas

```text
Execute somente a etapa 15 — Portal: faturas, PIX, consolidação e disputas do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /portal/billing; equivalente no Modo Inspeção.
Owners de apresentação: src/pages/PortalBilling.tsx; src/components/portal/PortalBillingTabs.tsx; src/components/portal/PortalConsolidatedModal.tsx; src/components/portal/PortalInvoiceDetailModal.tsx; src/components/portal/PortalDemurrageDetailModal.tsx; src/components/portal/PortalPixPaymentBlock.tsx; src/components/portal/DisputeModal.tsx; src/components/portal/PortalDisputeConversation.tsx.
Leia primeiro: docs/modules/portal-cliente.md; docs/modules/faturamento.md; docs/modules/demurrage.md; plano vivo Itaú Pix.

Revise a jornada do Cliente da lista até entender, pagar e consultar recibo. Inclua Taxas Locais, avulsas com ou sem B/L/Viagem, consolidadas, Demurrage, filtros, seleção, saldo e detalhe. Faça fatura, consolidada e recibo terem funções claras. Dê atenção ao QR Code, Copiar código PIX, confirmação da cópia, atualização da cobrança, indisponibilidade, pagamento parcial e quitação. Não simule confirmação de pagamento nem trate emissão de cobrança como recebimento. Revise abertura e acompanhamento de disputa, anexos quando existentes e conversas. Reduza redundâncias, rolagem desnecessária e modais em cascata, sem esconder itens ou condições. Notas públicas da avulsa não autorizam expor notas internas. Consuma documentos da 13; confira client e inspect, inclusive ações bloqueadas. Não altere integrações bancárias.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 16 — Central de Informações e administração do conteúdo

```text
Execute somente a etapa 16 — Central de Informações e administração do conteúdo do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /portal/informacoes; /portal/informacoes/:section; /clientes/informacoes; equivalentes no Modo Inspeção.
Owners de apresentação: src/pages/PortalInformation.tsx; src/pages/ClientesInformacoes.tsx; src/components/portal/information/; src/components/portal-information/.
Leia primeiro: docs/modules/portal-cliente.md — Central de Informações; docs/RASTREABILIDADE.md — Central de Informações.

Revise a entrada e as seis seções: Taxas Locais, Devolução, Demurrage, Agentes, Atendimento/Contato e Tracking. Priorize encontrar a informação e agir: porto, depósito, endereço, horário, restrições, contatos e link externo. Melhore comparações de tarifas e explicação de referências sem transformar tabela pública em cálculo pessoal da fatura. Preserve portos atendidos e fontes oficiais. Devolução é orientada por porto e depósitos publicados; não reintroduza indicação individual por container ou planilha removida. Revise estados sem publicação, referência indisponível e URL externa. No Vela, melhore cadastro, editor, prévia e publicação de depots/agentes/contatos/tracking/observações com as permissões atuais. Esta etapa possui ReferenceSections inclusive seu uso na administração; tarifas oficiais continuam sendo da 09/11, cadastro operacional de depots da 21.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 17 — Desbloqueio de CE Mercante, documentos e VIP

```text
Execute somente a etapa 17 — Desbloqueio de CE Mercante, documentos e VIP do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /desbloqueio-ce; /portal/desbloqueio-ce; inspeção e painel CE/VIP na ficha do Cliente.
Owners de apresentação: src/pages/DesbloqueioCe.tsx; src/pages/PortalDesbloqueioCe.tsx; src/components/ce-unlock/.
Leia primeiro: docs/modules/desbloqueio-ce.md; docs/operations/seguranca.md; planos vivo e arquivado da revisão de CE.

Primeiro identifique as alterações já feitas no ajuste anterior de Desbloqueio de CE e preserve sua intenção. Revise solicitação do Cliente, requisitos, upload/lista de documentos, histórico, fila interna, análise, entrega física, prazos, documentos anuais VIP por CNPJ e importação ZPT. Faça a pessoa entender o que falta, quem precisa agir e qual etapa foi concluída, sem prometer desbloqueio externo que o sistema só registra. Diferencie enviar documento de aprovar requisito e solicitar de concluir. Melhore feedback de arquivo/processamento, rejeição e reenvio. Esta etapa é a única dona dos componentes ce-unlock, inclusive CeUnlockVipCoveragePanel consumido na ficha do Cliente e Portal. Preserve validade anual, papéis, dados internos e formato ZPT vigente. Não altere o trabalho anterior por preferência estética nem execute envios reais.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 18 — Provisionamento, comunicação e Modo Inspeção

```text
Execute somente a etapa 18 — Provisionamento, comunicação e Modo Inspeção do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /clientes/portal; /clientes/comunicacao; /clientes/portal/inspecao/:customerId/*.
Owners de apresentação: src/pages/ClientesPortal.tsx; src/pages/ClientesComunicacao.tsx; src/pages/PortalInspection.tsx; src/components/portal/PortalReviewPanel.tsx.
Leia primeiro: docs/modules/portal-cliente.md; docs/modules/clientes.md; docs/ARCHITECTURE.md — Comunicados e inspeção.

Revise fila de contas, filtros, expansão, decisão de provisionar versus situação da conta, convite, falha, suspensão, recuperação assistida e histórico. Não misture destinatário de comunicado com Email de Recuperação. Na Comunicação, torne claros conferência, prontidão, simulação, envio, falha, tentativa e entrega; envio aceito não é prova de leitura/entrega. Preserve banner de automação desligada e consequências de reenvio. No Modo Inspeção, mantenha faixa persistente, identidade do Cliente inspecionado e ações somente leitura; use as mesmas telas do Portal. Esta etapa possui somente o wrapper de inspeção; páginas filhas pertencem às etapas do Portal. Consuma BillingPortalReleaseCard da 08. Não envie convites/comunicados reais, altere templates de e-mail ou habilite automações nesta revisão.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 19 — Painéis, Alertas e próximas ações

```text
Execute somente a etapa 19 — Painéis, Alertas e próximas ações do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /painel; /alertas; /alertas/regras; /portal.
Owners de apresentação: src/pages/Painel.tsx; src/pages/Alertas.tsx; src/pages/AlertasRegras.tsx; src/pages/PortalDashboard.tsx.
Leia primeiro: docs/modules/operacao-suporte.md; docs/modules/portal-cliente.md.

Transforme os painéis em entradas úteis para agir: prioridade, motivo e destino. Revise métricas, resumos, fila de Alertas, filtros, agrupamento, origem, atualização, dispensa e manual de regras. Diferencie Alerta compartilhado de Notificação pessoal. Evite repetir números sem contexto ou usar erro de consulta como zero. No Portal, destaque faturas, Containers sem devolução, Demurrage e programação com caminhos coerentes; não esconda alerta importante em decoração. Integre o ShipScheduleWidget da 03 sem modificá-lo. Os sinos pertencem à 02 e o catálogo/regra produtora do alerta deve ser preservado; melhore sua apresentação, não invente novos eventos de domínio.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 20 — Granito e tarifas

```text
Execute somente a etapa 20 — Granito e tarifas do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /granito; /granito/taxas.
Owners de apresentação: src/pages/Granite.tsx; src/pages/GraniteRates.tsx; componentes exclusivos identificados dessas páginas.
Leia primeiro: docs/modules/granito.md; CONTEXT.md — Granito.

Revise operação de Granito, seleção de Viagem/porto, documentos, carga, CE, totais e tarifas, incluindo formulários, modais e exportações existentes. Priorize unidades e comparação entre previsto e realizado. Evite copiar linguagem de Containers onde não se aplica. Integre visualmente com Viagens e Revisão sem reimplementar os componentes desses módulos. Preserve a distinção de Granito como apoio operacional e não crie faturamento de Cliente para esse fluxo. Importações comuns permanecem da 04 e documentos de ADR da 13. Teste longos identificadores, quantidades e estados sem carga.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 21 — Vazios de importação/exportação e depots

```text
Execute somente a etapa 21 — Vazios de importação/exportação e depots do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /vazios-importacao; /embarquevazios; /embarquevazios/depots.
Owners de apresentação: src/pages/VaziosImportacao.tsx; src/pages/EmbarqueVazios.tsx; src/pages/DepotCadastro.tsx.
Leia primeiro: docs/modules/manifesto-edi.md; docs/modules/viagens.md.

Revise unidades de vazios, filtros, datas, seleção por escala, importação, inclusão manual, serviços, valores sugeridos e cadastro de terminais/depots. Diferencie vazio de importação, Embarque de Vazios e container cheio; explique unidade física e linha de serviço sem misturar totais. Preserve os controles operacionais de ADR e atribuição de terminal. Dê aos formulários campos claros e ações consistentes, com feedback no item afetado. Não crie CE ou faturamento de Cliente para Embarque de Vazios. Consuma importações da 04 e programação da 03. O cadastro operacional é seu; publicação/instruções da Central de Informações são da 16: não faça um segundo editor dessas informações.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 22 — Relatórios e Administração

```text
Execute somente a etapa 22 — Relatórios e Administração do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: /relatorios; /admin; /admin/:tab.
Owners de apresentação: src/pages/Relatorios.tsx; src/pages/Admin.tsx; src/components/admin/ exceto AlterarMinhaSenhaModal.tsx.
Leia primeiro: docs/modules/operacao-suporte.md; docs/operations/seguranca.md.

Revise relatórios operacionais/financeiros existentes, escolha de período, filtros, tabelas, totais e exportação. Faça o usuário saber qual universo está vendo e o que será exportado. Na Administração, cubra Usuários, Falhas de Roteamento, Log de Ações, Métricas e Relatório SLA ADR, com seus detalhes e modais. Melhore legibilidade de logs sem esconder o dado necessário ao diagnóstico; não exponha segredos. Revise novo usuário e edição de acesso com consequências e permissões atuais, mantendo URLs de abas e fallback de aba inexistente. Perfil/troca da própria senha é da 02; documentos imprimíveis da 13; Relatórios não deve redefinir status ou cálculo dos módulos de origem.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

### 23 — Verificação final entre os dois produtos

```text
Execute somente a etapa 23 — Verificação final entre os dois produtos do pacote docs/plans/2026-10-07-revisao-visual-ux-prompts.md. Leia e aplique integralmente seu contrato comum, matriz de propriedade e entregas anteriores. A etapa 00 produz direção/inventário; as etapas 01–22 implementam; a 23 verifica integração e corrige regressões.

Escopo: Toda a matriz, após integração das etapas anteriores.
Owners de apresentação: Revisão global; correções locais de integração com identificação do owner.
Leia primeiro: AGENTS.md; WORKFLOW.md §11; contrato visual e entregas anteriores.

Faça um passe completo de consistência e fluxos entre módulos. Confirme cobertura de todas as rotas atuais, abas, modais, documentos, redirecionamentos e estados, marcando o que realmente foi observado. Percorra com dados sintéticos Operação → Revisão → Cliente/Portal → Faturamento → PIX/recibo, e as jornadas de consulta do Portal, Informações e CE. Revise desktop, celular, teclado, foco, contraste, erros, carregamento e listas extensas. Procure conflitos de tokens, alterações desfazendo decisões anteriores, ações duplicadas remanescentes, links quebrados, dados desatualizados e divergência client/inspect. Corrija regressões de integração sem iniciar outro redesenho e valide consumidores do owner afetado. Execute os gates obrigatórios e produza resumo de antes/depois, cobertura, pendências e evidência. Arquive este plano e retire sua entrada do índice apenas quando toda a campanha tiver sido concluída ou formalmente encerrada; não confunda o preparo dos prompts com execução.

Use os critérios completos do contrato comum, incluindo criatividade, revisão de textos e botões redundantes, dropdowns/modais, carregamento, acessibilidade, responsividade, checks e registro de entrega. Não avance para outra etapa nesta sessão.
```

## Registro da campanha — preencher ao executar

Preparação deste pacote: inventário estático e divisão de responsabilidades; nenhuma melhoria de interface implementada. Uma etapa só fica concluída com a evidência exigida para seu escopo, ou com encerramento explícito registrando o que não foi verificado.

| Etapa | Estado | Base / revisão de entrega | Resumo, arquivos, decisões, checks e pendências |
|---|---|---|---|
| 00 | Não iniciada | — | — |
| 01 | Não iniciada | — | — |
| 02 | Não iniciada | — | — |
| 03 | Não iniciada | — | — |
| 04 | Não iniciada | — | — |
| 05 | Não iniciada | — | — |
| 06 | Não iniciada | — | — |
| 07 | Não iniciada | — | — |
| 08 | Não iniciada | — | — |
| 09 | Não iniciada | — | — |
| 10 | Não iniciada | — | — |
| 11 | Não iniciada | — | — |
| 12 | Não iniciada | — | — |
| 13 | Não iniciada | — | — |
| 14 | Não iniciada | — | — |
| 15 | Não iniciada | — | — |
| 16 | Não iniciada | — | — |
| 17 | Não iniciada | — | — |
| 18 | Não iniciada | — | — |
| 19 | Não iniciada | — | — |
| 20 | Não iniciada | — | — |
| 21 | Não iniciada | — | — |
| 22 | Não iniciada | — | — |
| 23 | Não iniciada | — | — |
