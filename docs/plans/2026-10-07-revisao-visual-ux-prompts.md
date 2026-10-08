# Revisão visual e UX do Vela e Portal — pacote de prompts

Data: 2026-10-07. Base inspecionada: `main`, commit `0160605a`, checkout inicialmente sem diff.
Estado: etapas 00 e 01 concluídas em 2026-10-07 (direção visual, inventário, tokens e primitivas registrados abaixo); próxima: etapa 02.

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

#### Complementos de propriedade confirmados na etapa 00

O inventário de 2026-10-07 encontrou superfícies sem dono explícito na tabela acima. Elas passam a ter o owner abaixo; as demais linhas continuam válidas.

| Superfície | Etapa dona | Consumidores que apenas reutilizam |
|---|---|---|
| `layout/InternalNotificationBell.tsx` (sino do Vela) e `portal/NotificationBell.tsx` (sino do Portal) | 02 | Shells e inspeção |
| `security/TurnstileChallenge.tsx` e `PortalErrorBoundary.tsx` | 02 | Login e recuperação do Portal |
| `shared/DomainIcon.tsx` (ícones de domínio) | 01 | Navegação (02), Viagens (03) |
| Primitivas novas pedidas por este contrato: resumo compacto, controle segmentado, trilho de etapas e painel lateral genérico, se adotados | 01 | Todas |
| `billing/ManualChargeFormFields.tsx` | 10 | Cobranças na ficha do B/L (05) |
| `billing/FinancialRefundsPanel.tsx` | 10 | Demurrage (11) |
| `demurrage/DemurrageBadges.tsx` | 11 | Relatórios (22) |
| `review/ReviewCustomerOnboarding.tsx` | 07 | Cliente na ficha do B/L (05) |
| `voyages/VoyageRail.tsx` (faixa de Viagens) | 03 | Baplie e Veículos (06) |
| `bl/BlRailsPipeline.tsx` (trilhos da ficha) | 05, até a 01 entregar um trilho genérico; depois 05 migra para a primitiva | Ficha do B/L |
| `PortalTransshipmentCard`, definido dentro de `PortalOperacao.tsx` | 14 | Portal e inspeção |
| Arquivos auxiliares em `src/pages/` (`adminTabs.ts`, `blDetalheHelpers.ts`, `faturamentoInvoiceStatus.ts`, `revisaoHelpers.ts` etc.) | Etapa da página que os nomeia | Componentes que os importam |
| Rotas de redirecionamento e `lib/routeRedirects.ts` | Sem redesenho; cada etapa confere o alias da sua rota e a 23 verifica todos | — |

Dependência em dois sentidos: `BillingPortalReleaseCard` (08) é usado pelo `PortalReviewPanel` (18), que por sua vez é composto em `clientes/CadastroContatosTab.tsx` (08). Cada etapa altera só o próprio componente e confere o outro como consumidor. `bl/BlReviewContextPanel.tsx` não tem consumidor fora do próprio teste (**Código**); a 05 decide entre remover ou reconectar.

## Etapa 00 — direção visual e inventário confirmado

Registro de 2026-10-07 sobre a base `ba7cd09d` (`main` após a PR 894). Esta seção é o contrato visual das etapas 01–23. Ela orienta decisões; não implementa telas.

### Evidência e limites

- **Runtime**, ambiente local descartável: Postgres 16 em diretório temporário, todas as migrations do repositório, `validation_seed.sql`, `seed_audit.sql` e `sb-shim.cjs`; Vite em modo de desenvolvimento; Chromium do Playwright 1.63 sem interface. Login interno de auditoria (Administrativo). Capturas de 41 rotas autenticadas e 6 públicas em 1440×900 e 360×780 com toque, 28 abas/variações por query param em 1440×900, 5 rotas em 768×1024 e no tema escuro, e 6 modais. Nenhum envio, emissão, baixa ou gravação foi confirmado.
- **Resultado medido:** nenhuma rota teve rolagem horizontal da página em 1440 ou 360 px. O único erro de console foi o 406 da ficha do Cliente, causado pelo seed (abaixo). Os modais abertos têm nome acessível, levam o foco para dentro e fecham com Escape, em desktop e celular. `npm run a11y:contrast` aprovou os 22 pares de tokens verificados.
- **Artefatos do ambiente, não do produto:** o seed grava CNPJ com máscara e o app consulta a forma canônica, por isso a ficha do Cliente respondia "Cliente não encontrado" até a normalização local dos CNPJs; `customers.pending_balance` não é recalculado pelo seed. O shim não aplica RLS como o PostgREST, não tem realtime e não emula Turnstile nem Edge Functions.
- **Lacunas:** o login real do Portal não foi exercitado; as telas autenticadas do Portal foram vistas pelo Modo Inspeção, que usa o mesmo `PortalLayout` e as mesmas páginas, com escrita bloqueada. Os dados sintéticos são poucos (12 B/Ls, 8 Clientes, 4 Viagens, 6 faturas de Taxas Locais, nenhuma fatura de Demurrage e nenhum Pix), então listas extensas, conteúdo longo, erro de consulta e falha parcial não foram observados. Também não foram testados zoom de 200%, leitor de tela, impressão, Portal no tema escuro nem o caminho completo de teclado. As capturas ficaram fora do repositório; cada etapa refaz a sua linha de base antes de alterar a tela.

### Diagnóstico transversal

Os produtos já têm identidade: papel quente, azul-marinho, dourado, Syne nos títulos e trilhos de etapa na ficha do B/L. O problema principal não é estética. A interface gasta espaço e atenção antes de entregar o dado de trabalho.

| Padrão observado | Exemplo (**Runtime**, salvo indicação) | Efeito para quem usa |
|---|---|---|
| Topo alto | No Vela desktop, faixa de avisos, barra da marca e barra de navegação somam cerca de 140 px. O título com descrição e o traço dourado ocupam outros 120 px. Em BLs a tabela começa perto de 650 px. | O operador rola antes de ver o primeiro registro. |
| Muitos cards de métrica | BLs mostra 12 cards de igual peso; Taxas Locais mostra 5. Em 360 px os cards de BLs ocupam cerca de 600 px antes da lista. | Números sem prioridade competem com a tarefa. |
| Card dentro de card | A ficha da Viagem empilha três níveis de borda e cabeçalhos azul-marinho em tabelas aninhadas. | A hierarquia fica pesada e difícil de escanear. |
| Linhas pouco densas | As linhas de BLs têm cerca de 69 px; as de Taxas Locais, de 120 a 130 px. A coluna "Comunicação financeira" quebra em cinco linhas. | Poucos registros por tela e comparação difícil. |
| Ações redundantes por linha | Em BLs, a linha tem número do B/L com link, botão "Abrir B/L", menu ⋮ e seta de expansão. | Quatro caminhos para decisões parecidas. |
| Identificador cortado | Em BLs a 360 px, o número do B/L aparece como "XPDU…" e a coluna de ações fica com a largura. Em 1440 px, o cabeçalho "Fatura" fica cortado e encosta em "Ações". | O dado que identifica a carga some. |
| Tipografia dispersa | **Código:** cerca de 20 tamanhos em `index.css`, mais 7 tamanhos arbitrários em TSX, incluindo 10 px (40 usos) e 9 px. Há 157 ocorrências de caixa alta e 245 cores hexadecimais em TSX. | Rótulos pequenos e espaçados ficam lentos de ler; o tema fica difícil de manter. |
| Abas e botões parecidos | Abas com borda (Viagem, B/L, Cliente), controle segmentado próprio (Modalidade) e links com cara de aba ("Baplie EDI", "B/Ls da viagem"). | Não fica claro o que troca a vista e o que navega. |
| Controles duplicados | **Código:** a lente "Modalidade" de BLs repete o filtro Modalidade do painel de filtros. | Dois estados para a mesma decisão. |
| Badges em excesso | A ficha do B/L mostra "Conferido por nome", "Não visível no Portal", "Baplie não importado" e "Herdado da escala", todos em caixa alta. | O estado importante perde destaque. |
| Texto e idioma | Faltam acentos em "Pendencias PIX persistidas", "conciliacao", "DESCRICAO" e "NUMERO DA VIAGEM". O Line Up usa VESSEL, VOY e LINKED. A página "Revisão Manual" aparece como "Revisão" no menu. | Parece inacabado e mistura idiomas. |
| Paginação incoerente | A Conciliação vazia mostra "Página 1 de 1" no topo e "Página 0 de 0" no rodapé. | O usuário desconfia do dado. |
| Formulário espremido | A fatura avulsa põe sete campos em uma linha: rótulos quebram em três linhas, a seta do select cobre "Outra" e a descrição tem cerca de 70 px. | Uma tarefa financeira crítica fica difícil de preencher. |
| Pagamento escondido no Portal | O detalhe da fatura mostra métricas, B/Ls, itens e containers antes do bloco Pix, que fica abaixo da dobra. | A ação principal do Cliente exige rolagem. |
| Cabeçalho do Portal em 360 px | "Portal do cliente" encosta no sino; a faixa de inspeção ocupa três linhas. | Toque impreciso e conteúdo empurrado para baixo. |
| Faixa de avisos em 768 px | O aviso "2 demurrages vencidos" é cortado em "vencid". | O alerta perde o sentido. |

Pontos que devem ser preservados: o trilho Operacional/Documental com "Próxima ação" na ficha do B/L, a faixa de inspeção persistente, a TV com barra verde para "atracada", os modais acessíveis, os cards móveis em BLs e Containers do Portal, a ausência de rolagem horizontal e o tema escuro do Vela.

### Direções consideradas

| Direção | Ideia | Decisão |
|---|---|---|
| **A — Carta náutica** | Evolui a identidade atual para um instrumento de precisão: papel quente, tinta azul-marinho, filetes finos em vez de caixas, números tabulares, cores de sinalização usadas só para estado e um trilho de etapas como assinatura visual. O Vela fica compacto; o Portal usa a mesma tinta com mais ar e orientação. | **Escolhida** |
| B — Ponte de comando | Console escuro e de alto contraste, como o passadiço. | Rejeitada como padrão: cansa no trabalho longo, imprime mal e estranha ao Cliente. Fica para a TV e o tema escuro. |
| C — SaaS neutro | Branco, cinza e azul genéricos com muitos cards. | Rejeitada: perde a identidade e repete o problema dos cards. |

A direção A foi escolhida por quatro razões. Ela corrige os problemas observados (espaço, densidade, hierarquia) sem trocar a marca. Ela reaproveita os tokens e o tema escuro existentes, o que reduz o risco de migração em 22 etapas. Ela dá ao Vela densidade de planilha operacional e ao Portal clareza guiada a partir da mesma base. E o trilho de etapas já existe e expressa bem a viagem da carga: Saída → Chegada → Descarga → Devolução, ou Emitida → Paga.

### Contrato visual

**Princípios**

1. O dado de trabalho aparece na primeira dobra. Topo, título e resumo não podem empurrar a lista para depois de cerca de 260 px no Vela desktop.
2. Uma superfície por nível. Seções dentro de uma superfície são separadas por filete e título, nunca por outro card.
3. Cor indica estado ou ação, nunca enfeite. Todo estado também tem texto, e ícone ou forma quando o contraste de cor não basta.
4. Cada tarefa tem um caminho principal. Ações equivalentes são consolidadas e as secundárias ficam em "Mais ações".
5. Um rótulo vale mais que uma explicação. Uma descrição só fica se mudar uma decisão; o resto vira ajuda contextual ou sai.

**Tipografia**

| Uso | Família | Tamanho/linha | Peso |
|---|---|---|---|
| Título de página (Vela) | Syne | 24/32 | 700 |
| Título de página e boas-vindas (Portal), tela de login | Syne | 32/40 | 700 |
| Título de painel, modal ou drawer | DM Sans (Syne nunca, nem com identificador) | 20/28 | 600 |
| Título de seção | DM Sans | 16/24 | 600 |
| Corpo do Portal, campos, botões | DM Sans | 14/20 (Portal: 16/24 no corpo) | 400/500 |
| Tabela e corpo denso do Vela | DM Sans | 13/18 | 400; cabeçalho 500 |
| Legenda, meta, ajuda | DM Sans | 12/16 | 400/500 |
| Códigos sujeitos a confusão de caracteres (container, CE, TXID, IMO, código Pix) | IBM Plex Mono | 13/18 | 400 |
| Números, valores e datas | DM Sans com `tabular-nums`, alinhados à direita | conforme o contexto | 400; total 600 |

- Tamanho mínimo de 12 px. Os tamanhos 9, 10 e 11 px saem.
- Sete degraus: 12, 13, 14, 16, 20, 24 e 32. A etapa 01 cria tokens e utilitários para eles e remove tamanhos arbitrários nas primitivas. As páginas migram nas suas etapas.
- Caixa normal (sentence case) em rótulos, cabeçalhos de tabela, badges e abas. Caixa alta fica para códigos que já são maiúsculos (LOCODE, container, B/L) e para um sobretítulo opcional por painel, sem `letter-spacing` acima de 0,04 em.
- Syne só aparece em uma linha por tela. Identificador longo no título (por exemplo B/L COSU6401234503) usa DM Sans 24/600, com o tipo do documento em legenda.

**Cor e semântica**

Os valores de `--app-*` continuam os mesmos. A etapa 01 acrescenta aliases semânticos de primeiro plano, fundo e borda, com par no tema escuro e verificação em `a11y:contrast`.

| Papel | Base | Uso |
|---|---|---|
| Estrutura | `--app-navy`, `--app-topbar` | Shell, TV e cabeçalho de modal. Não usar como fundo de cabeçalho de tabela comum. |
| Ação | `--app-blue-btn`, `--app-link` | Botão principal e link. Um botão principal por região. |
| Sucesso / concluído | `--app-green` | Paga, confirmada, atracada, devolvido |
| Atenção / aguarda ação | `--app-gold`, `--app-gold-strong` | Pendente, aguardando, vence em breve |
| Bloqueio / erro / vencido / perigo | `--app-red` | Bloqueado, falhou, vencido, excluir |
| Informativo | `--app-blue-soft` | Emitida, em análise, origem do dado |
| Neutro | `--app-muted` | Não se aplica, sem dado, rascunho |

- O dourado também é a marca, mas fora de estado só aparece na indicação da navegação ativa. O traço dourado sob todo título de página sai.
- O padrão de pontos fica no login, na tela vazia e nas faixas de boas-vindas. A área de dados usa papel liso.
- Cabeçalho de tabela comum: fundo `--app-surface-muted`, texto 12/500 em caixa normal, filete inferior forte e cabeçalho fixo ao rolar. O cabeçalho azul-marinho fica só no Line Up e na TV, que imitam o quadro físico.

**Espaço, densidade e superfícies**

- Escala de 4 px: 4, 8, 12, 16, 24, 32 e 48. Margem lateral de 24 px no desktop e 16 px no celular.
- Densidade **compacta** (Vela, ponteiro fino): linha de tabela de 40 px e controle de 36 px.
- Densidade **confortável** (Portal e qualquer ponteiro de toque): linha de 52 px e controle de 44 px. Essa regra substitui os 44 px para todo controle quando o ponteiro é fino no Vela e preserva os 44 px de alvo de toque da remediação de 2026-09-20.
- Raio de 8 px nas superfícies e de 6 px em controles e tags. Hoje o tema escuro usa 12 px; isso deve ser unificado.
- Superfícies separadas por borda. Sombra só em sobreposição (menu, popover, modal, toast).
- Métricas: até quatro cards, e só quando cada um leva a uma decisão ou filtro. Os demais números viram uma **faixa de resumo** de uma linha na barra da tabela (por exemplo "12 B/Ls · 16 CNTRs · 1.069,1 m³"). Card de métrica clicável aplica o filtro correspondente.

**Navegação e cabeçalho de página**

- Vela desktop: marca, navegação e ferramentas do usuário em **uma barra** de até 64 px, mais a faixa de avisos de até 28 px. A versão do app passa para o menu do usuário. Abaixo de 1100 px continua o botão Menu.
- Portal: uma barra de 64 px com a marca FWLOG, a navegação e as ações da conta; a faixa de inspeção cabe em uma linha a 360 px, com o nome truncado e completo em `title`/texto acessível.
- Cabeçalho de página no Vela: breadcrumb quando houver profundidade, título 24 px com contexto curto e ações principais na mesma linha, numa altura alvo de até 72 px. O título visível é igual ao rótulo do menu (por exemplo Revisão).
- Abas: um único padrão, sublinhado com indicação ativa e `role="tablist"`, sempre refletido na URL. O controle segmentado serve para lentes e filtros de 2 a 4 opções. Navegar para outra página é link com seta, nunca botão com cara de aba.

**Tabelas e listas**

- O identificador abre a ficha. Pode haver no máximo uma ação secundária visível; as demais vão para "Mais ações" (⋮). O botão "Abrir X" sai quando o identificador já é link. A expansão da linha só fica se mostrar o que a ficha não mostra.
- Célula com no máximo duas linhas. Em valores financeiros, o número principal é o que decide (saldo ou total) e os demais aparecem em linha secundária ou dica.
- Ausência de dado é "—" com significado acessível; zero só quando o sistema sabe que é zero. Datas em dd/mm/aaaa (dd/mm em quadros), moeda em "R$ 1.805,00", CNPJ sempre com máscara.
- Tabela larga: cabeçalho fixo e primeira coluna fixa. O identificador nunca é truncado: ele quebra a linha ou usa a coluna fixa.
- Abaixo de 640 px, a lista principal vira cards com identificador, estado, dois ou três fatos e a ação principal. Rolagem lateral fica para tabelas secundárias, com indicação visível.
- Paginação no formato "Exibindo 1–20 de 132", com o mesmo texto no topo e no rodapé; vazio é "Nenhum registro", nunca "Página 0 de 0".

**Formulários e escolha de controle**

- Rótulo acima do campo, 13/500, em caixa normal. Campo obrigatório leva asterisco e `aria-required`. Ajuda e erro ficam logo abaixo do campo.
- No máximo duas colunas em modal e três em página. Texto longo ocupa a largura toda. No celular, uma coluna.
- Lista fixa de até 7 opções: select nativo estilizado. Entidade pesquisável (Cliente, Viagem, B/L, Item da tabela): Combobox. Duas a quatro opções exclusivas que mudam o formulário (por exemplo Item da tabela ou Outra): controle segmentado. Edição inline só para um campo isolado com salvamento por linha e feedback na própria linha.
- Botões: um principal com verbo e objeto ("Emitir fatura avulsa"), secundário com contorno, terciário como link. Destrutivo com contorno vermelho na tela e vermelho sólido na confirmação. Durante a ação, o rótulo continua visível, há indicador e `aria-busy`, e a largura não muda.

**Modal, drawer, página e confirmação**

| Padrão | Quando usar |
|---|---|
| Modal | Tarefa curta e focada (até cerca de 7 campos, uma decisão), como criar Viagem ou emitir fatura avulsa |
| Drawer / painel lateral | Consultar ou ajustar um registro sem perder a lista e os filtros (Revisão, detalhe de fatura no Vela). A 01 decide se promove um drawer genérico a partir do padrão do `ReviewDrawer`. |
| Página | Conteúdo com abas, histórico ou várias ações (fichas) |
| Confirmação | `ConfirmDialog` com consequência, justificativa quando o sistema exige, "Voltar" para fechar e o verbo específico na ação |

- Não abrir modal sobre modal. O foco inicial vai para o primeiro campo quando houver formulário e para o título nos modais de leitura. Hoje o foco cai sempre em "Fechar modal"; a 01 revisa.
- No Portal, o detalhe financeiro abre com "quanto, até quando e como pagar" antes do detalhamento.

**Estados e feedback**

- Carregamento com skeleton na geometria final. Ação em andamento fica no botão que a disparou. A tela só é bloqueada quando continuar seria inconsistente.
- Vazio inicial (o que é e como começar), vazio do filtro ("Limpar filtros"), erro de consulta com "Tentar novamente" e sem zeros falsos, acesso restrito com o motivo e falha parcial com o que deu certo e o que falta.
- Toast só confirma uma ação que já está visível na tela. Resultado relevante (importação, lote, conciliação) fica no conteúdo.

**Responsividade**

- Pontos de quebra: 360 (mínimo), 640 (modal vira folha; listas viram cards), 768 (faixa de abas com rolagem), 1100 (navegação recolhe) e 1440 (referência).
- Nenhum texto de aviso é cortado sem reticência e sem acesso ao texto completo. O cabeçalho móvel não sobrepõe título e ícones.

**Vela × Portal**

| Aspecto | Vela | Portal |
|---|---|---|
| Pergunta da tela | "O que está pendente e onde ajo?" | "O que preciso fazer e quanto devo?" |
| Densidade | Compacta, tabela como superfície principal | Confortável, largura máxima de cerca de 1200 px centralizada |
| Topo da página | Título, faixa de resumo e ações | Título, uma frase de orientação e "o que precisa da sua atenção" com ação direta |
| Linguagem | Vocabulário do CONTEXT.md, siglas operacionais com legenda | Rótulos voltados ao Cliente já existentes, sem jargão interno e sem códigos sem explicação |
| Cards | Só para resumo decisório e listas móveis | Permitidos para resumos e listas móveis; tabela no desktop |
| Marca | Vela (veleiro) | FWLOG |

**Superfícies especiais**

- **TV (03):** variante escura de alto contraste, texto mínimo de 28 px a 1920 px de largura, estados por palavra e cor, sem azul claro para números e sem texto de três linhas por célula.
- **Impressão (13):** papel branco, tinta preta e azul-marinho, sem padrão de fundo, A4, valores alinhados. Recibo distingue o valor recebido do total emitido.
- **Tema escuro (01):** todo token novo precisa de par escuro e passar em `a11y:contrast`. O Portal continua só com o tema claro.
- **Modo Inspeção (18):** faixa persistente e compacta e as mesmas telas do Portal. Controles bloqueados ficam desativados com motivo, sem sumir.
- **Trilho de etapas (assinatura):** uma sequência horizontal de estados com ponto, rótulo e valor, já usada na ficha do B/L. A 01 decide se vira primitiva. Consumidores candidatos: Viagem (03), B/L (05), Desbloqueio de CE (17) e ciclo da fatura no Portal (15).

**Critérios de aceite de cada etapa**

Cada etapa compara a sua tela com este contrato e registra no próprio relato:

- **Primeira dobra:** posição da primeira linha de dado.
- **Ações:** quantidade de ações por linha.
- **Tipografia:** tamanhos fora da escala.
- **Caixa e cor:** uso de caixa alta e de cor como único sinal.
- **Formulário:** campos por linha.
- **Estados:** quais foram cobertos.
- **Larguras:** resultado em 360, 768 e 1440 px.

Divergência intencional exige justificativa no relato.

### Inventário confirmado

**Código:** o inventário foi conferido nos roteadores, nas páginas e em `src/components/` (via `src/AppInterno.tsx` e `src/AppPortal.tsx`). Todas as rotas da matriz existem, e não há rota atual sem etapa.

- **Base `/line-up-tv`:** não é rota e cai em NaoEncontrado, como a matriz já prevê.
- **`/admin/:tab` inválida:** renderiza NaoEncontrado.
- **`*` no Portal:** redireciona para `/portal`; o Portal não tem página 404 própria.
- **Inspeção:** a rota não exige permissão específica além da sessão interna. A autorização real está na RPC `portal_open_inspection`; nenhuma mudança foi feita nesta etapa.

Abas e modais por rota, para conferência das etapas:

| Etapa | Abas (rótulo / parâmetro) e modais confirmados |
|---|---|
| 03 | Viagem `?tab=`: Visão geral, Importação, Exportação, Rotas e Manifestos (`manifestos`), ADR. Modais: VoyageCreateModal (criar/editar), Cancelar viagem, EscalaModal, PolScheduleModal, OmitEscalaModal, impressão do ADR. Confirmações de exclusão, reativação, transbordo, observação e terminal do ADR. Chegadas e Saídas: formulário inline e publicação. |
| 05 | Ficha `?tab=`: Visão Geral, Carga, Detalhes do B/L, Faturamento, Histórico. Confirmações com motivo para cancelar ou reativar B/L, perfil do container e SOC/COC. Lista com expansão (`BlRowDetail`), ações em massa e `BreakbulkManifestUploadModal`. |
| 06 | Veículos: Importar Veículos e Definir local de desova. Baplie: seções Stats, Vazios e Reconciliação, mais `BaplieUploadModal`. Containers: exclusão e ações em massa. |
| 07 | `ReviewDrawer`, `ReviewGroupBlock` e cinco confirmações (correção, recálculo, vínculo, cadastro e e-mail). |
| 08 | Ficha `?tab=`: `visao-geral`, `cadastro`, `operacional`, `financeiro`, `historico`, `desbloqueio-ce`. Lista com CreateCustomerModal, menu de ações e ImportBaseModal (04). |
| 09 | `?tab=`: Tabelas, Overrides. Formulários de tabela e de item; confirmações de ativar e excluir. |
| 10 | `?tab=`: Faturas, Validação (`pendencias` abre Validação filtrada). Modais ConsolidatedInvoiceModal, ManualInvoiceModal e InvoiceDetailModal (com correção, restituição e resolução de fatura defasada). Painéis de reemissão, alertas financeiros e ajustes de COD. |
| 11 | Demurrage: Containers, Faturas, Pagas, Canceladas, Por Cliente. Modais de datas, detalhes, PTAX, desconto, disputa, pagamento, estorno, régua e relatório. Taxas `?tab=`: Tabela Padrão (Armador), Acordos de Clientes. |
| 12 | Monitor Itaú, upload de extrato, pendências persistidas, histórico. Abre InvoiceDetailModal (10) e a fatura de Demurrage. |
| 16 | Portal `:section`: taxas, devolucao, demurrage, agentes, atendimento, tracking. Vela: seções de depots, agentes, contato, armadores e observações com `InformationEditor`. |
| 17 | Vela `?aba=`: Solicitações, Controle ZPT (`controle`). Modais de termo, ZPT, histórico ZPT e solicitação. Portal: Nova solicitação, Minhas solicitações, Documentos anuais (estado local, sem URL) e `?pedido=`. |
| 18 | Comunicação `?tab=`: Cobertura de viagens, Disparo, Histórico, com prévia e ativação de envio real. Provisionamento com chips de estado e `PortalReviewPanel`. |
| 19 | Painel com Line Up, filtros e exportação. Alertas e Regras (`?regra=` é preenchido automaticamente). Painel do Portal com quatro cards, Central e ShipScheduleWidget. |
| 20 | Modais Taxas do B/L, Resultado persistido e Importar Planilha COSCO; taxas com modal. |
| 21 | Importar Unidades Embarcadas; exclusões de unidade e de serviço; cadastro de depots. |
| 22 | Relatórios: Operacional, Financeiro, Por Cliente, Demurrage. Admin `/admin/:tab`: `usuarios`, `falhas`, `logs`, `metricas`, `prazo-adr`, mais NovoUsuarioModal e EditarAcessoModal. |
| 14, 15 | Operação `?tab=bls\|containers` e `?devolucao=`. Faturas `?tab=local\|demurrage` com modais de consolidada, disputa, detalhe da fatura, detalhe de Demurrage, conversa de disputa, impressão e confirmação "Desfazer fatura consolidada". |

Lacunas do Modo Inspeção a conferir nas etapas donas (**Código**, sem alteração):

- "Refazer consolidada" no detalhe da fatura do Portal não é desativado na inspeção; só a RPC bloqueia (15).
- "Disputar" abre o modal, embora o envio esteja desativado (15).
- `PortalDesbloqueioCe` verifica `scope.mode` diretamente em vez de `isPortalReadOnly` (17).

### Alvos observados por etapa

São insumo para as etapas donas, não escopo desta. **Runtime** salvo indicação.

| Etapa | Alvo |
|---|---|
| 01 | Escala tipográfica; caixa normal; cabeçalho claro de tabela; densidade compacta e confortável; raio único; tag de estado; faixa de resumo; controle segmentado; foco inicial do modal; paginação coerente; aliases semânticos com par escuro. |
| 02 | Unificar a barra do Vela; versão no menu do usuário; aviso cortado em 768 px; sobreposição do título com o sino no Portal a 360 px; faixa de inspeção com três linhas. |
| 03 | Cards aninhados e tabelas azul-marinho na ficha da Viagem; "Baplie EDI" e "B/Ls da viagem" com aparência de aba; "NUMERO DA VIAGEM" sem acento; TV com "0 MAQ / 0 PACK / 0 TOTAL" ilegível à distância e número em azul claro. **Suspeita:** na mesma escala, o Painel mostrou CEs "Lançando" e a TV "Aguardando"; conferir a origem antes de redesenhar. |
| 04 | Botões de importação ocupam quatro linhas em BLs a 360 px. |
| 05 | 12 cards em BLs; quatro ações por linha; número do B/L cortado a 360 px; coluna Fatura cortada a 1440 px; lente Modalidade duplicada (**Código**); badges em excesso na ficha; `BlReviewContextPanel` sem uso. |
| 07 | Título "Revisão Manual" diferente do menu; ações de vínculo pouco distinguíveis por grupo. |
| 10 | Linhas de 120 a 130 px e "Comunicação financeira" em cinco linhas; formulário da fatura avulsa espremido. **Suspeita:** com CNPJ canônico, a lista de faturas mostra o CNPJ sem máscara. |
| 12 | Acentos ausentes; paginação "1 de 1" e "0 de 0"; "Exportar Excel" ativo sem registros. |
| 15 | Bloco Pix abaixo da dobra no detalhe; "DESCRICAO" sem acento. **Suspeita:** "Saldo pendente" em Faturas lê `customers.pending_balance`, enquanto o Painel do Portal soma as faturas e a ficha do Cliente usa saldo calculado; com o seed, os valores foram R$ 0,00 e R$ 3.315,00. Confirmar em dados reais de homologação antes de tratar como defeito (15/19). |
| 19 | Painel do Portal: cards com o mesmo peso e programação vazia ocupando destaque; Line Up com cabeçalhos em inglês. |

### Ambiente local para evidência (macOS)

O `local-stack.ps1` é só para Windows, e `setup-local-pg.sh` cria o banco `vela_test` sem o seed de auditoria. Para reproduzir esta etapa sem tocar no Supabase real:

1. Crie um cluster descartável com `initdb` e inicie-o com `pg_ctl`, usando `LC_ALL=C`, uma porta livre e um diretório de socket curto. O socket não aceita caminho maior que 103 bytes.
2. No banco `app`, aplique `scripts/design-audit/bootstrap.sql` sem a linha `create extension ... pg_cron`. Aplique também os shims de `cron`, `vault`, `net` e `storage` do bloco SQL de `scripts/setup-local-pg.sh`. Isso evita gravar o stub do pg_cron no Postgres do Homebrew.
3. Aplique as migrations em ordem, os grants e os seeds descritos em `scripts/design-audit/win/local-stack.ps1`. Normalize `customers.cnpj_cpf` para a forma canônica.
4. Instale o `pg` fora do repositório (`NODE_PATH`) e inicie `sb-shim.cjs` com `PGPORT` apontando para o cluster. Use `.env` local com `VITE_SUPABASE_URL=http://127.0.0.1:5173/sb-proxy` e rode `npm run dev`. O login de auditoria está em `scripts/README.md`.

## Entrega da etapa 01 — tokens e primitivas

Registro de 2026-10-07 sobre a base `74d82566` (`main` após a PR 896). Esta etapa aplica o contrato visual da etapa 00 aos tokens e às primitivas. As telas mudam só pelo que herdam; cada etapa dona migra o próprio conteúdo.

### O que mudou para todas as telas

| Superfície | Antes (**Runtime**, 1440 px) | Depois |
|---|---|---|
| Título da página | Syne 35,2 px com traço dourado; cabeçalho termina em 214 px | Syne 24/32 no Vela e 32/40 no Portal (28 abaixo de 640 px), sem traço; termina em 209 px |
| Cabeçalho de tabela | Azul-marinho, 11 px, peso 800, caixa alta espaçada | Fundo `--app-surface-muted`, 12/500 em caixa normal, filete forte; Line Up mantém azul-marinho; vale também para as classes antigas `bg-[#0d1117]` |
| Botão, campo e select | 44 px em tudo | 36 px no Vela com mouse; 44 px no toque, no Portal e no Modo Inspeção (**Runtime**: 36 e 44 medidos) |
| Aba | Botão preenchido azul-marinho | Sublinhado em tinta azul, 40 px no Vela com mouse e 44 px no toque |
| Tag de estado (`Badge`) | Pílula, 11 px, caixa alta | Raio de 6 px, 12/500, caixa normal, cores por alias semântico |
| Rótulo de campo | 12 px em caixa alta, cinza | 13/500 em caixa normal, cor de texto |
| Card de métrica | Rótulo de 11 px em caixa alta; azul claro `#58a6ff` no primário | 12/500 em caixa normal; valor 20/600; primário em `--app-link` |
| Modal | Raio de 16 px; título em Syne 18 px; foco inicial em "Fechar modal" | Raio de 8 px; título em DM Sans 20/28; foco no primeiro campo ou no título (**Runtime**: Nova viagem e Fatura avulsa focam o primeiro campo) |
| Paginação | "Página 1 de 1" ou "Página 0 de 0", com Anterior/Próxima inúteis | "Exibindo 1–2 de 2" ou "Nenhum registro"; página e navegação só com mais de uma página |
| Botão em andamento | Rótulo escondido; nome acessível trocado por "Carregando…" | Rótulo visível, indicador no lugar do ícone, `aria-busy`, largura estável; `loadingLabel` dá o texto da ação |
| Tema escuro | Raio de 12 px; hover do secundário e botão destrutivo com gradiente claro | Raio de 8 px; hover e destrutivo por token |

As primeiras linhas de dado subiram de 30 a 52 px nas rotas medidas (BLs 737→705; Taxas Locais 684→637; Admin 458→406; Demurrage 651→598). Ainda ficam abaixo dos 260 px do princípio 1, porque a sobra está nas próprias telas: metade da altura vem dos cards e filtros de cada página.

### Tokens e primitivas novos

- **Tokens:**
  - escala `--app-size-{caption,table,body,section,panel,page,hero}`;
  - `@theme` com `text-table` (13/18) e `text-hero` (32/40); 12, 14, 16, 20 e 24 são `text-xs`, `text-sm`, `text-base`, `text-xl` e `text-2xl`;
  - `--app-radius-control`;
  - densidade em `--app-control-h`, `--app-control-h-sm`, `--app-row-h` e `--app-cell-{py,px}`;
  - aliases `--app-{success,warning,danger,info,neutral}-{fg,bg,border}` nos três blocos de tema;
  - `--app-thead-border`.
- **Densidade:** os shells receberam `app-shell--vela` (`AppLayout`) e `app-shell--portal` (`PortalLayout`); foi a única mudança nesses arquivos, que são da 02. A densidade compacta vale só sob `@media (pointer: fine)`. Assim, o Modo Inspeção, que fica dentro do shell do Vela, volta à densidade do Portal.
- **Células de `.app-table`:** a densidade padrão está em `@layer components`. O `py-3 px-4` que as telas ainda declaram vence, então as linhas continuam com 64–69 px até cada etapa dona remover esse padding.
- **Componentes novos em `src/components/ui/`:**
  - `Drawer`, baseado no Modal e promovido do padrão do `ReviewDrawer`;
  - `TabList`, com setas, Home/End e ativação automática;
  - `SegmentedControl`, grupo de rádio com uma única parada de Tab;
  - `SummaryStrip`, uma lista `<dl>` de uma linha;
  - `StepRail`, que é a assinatura visual: estado em texto, `aria-current="step"`, coluna abaixo de 640 px;
  - `src/lib/pagination.ts`, com `describePageRange` para usar o mesmo texto no topo e no rodapé.
- **Componentes existentes que ganharam props, sem quebrar chamadores:**
  - `Modal.size`, com `lg` como padrão;
  - `TabButton.count`, `countLabel`, `id` e `controls`;
  - `MetricCard.onSelect` e `selected` (com `onSelect`, o card vira botão com `aria-pressed`);
  - `Badge`, que aceita tons semânticos (`success`, `warning`, `danger`, `info`, `neutral`) além dos nomes de cor.
- **`QueryStateGate`:** o carregamento passa a ser esqueleto com texto para leitor de tela (`loadingFallback` aceita a geometria final), e "Tentar novamente" usa `Button`.
- **`BulkActionsBar`:** região nomeada, fixa no topo ao rolar, contagem em `aria-live` e "Limpar seleção".
- **`OperationalBadges`:** "Não calc." passou a "Não calculado".

Decisões desta etapa:

- **Drawer e trilho viram primitivas.** Os dois têm mais de um consumidor previsto (07/10 e 03/05/15/17).
- **O botão em andamento continua `disabled`, não só `aria-disabled`.** Mantém a proteção contra repetição e o contrato dos testes existentes. A perda de foco ao desativar fica como limite conhecido.
- **A aba ativa usa tinta azul, não dourado.** O dourado continua exclusivo da navegação principal.
- **O cabeçalho de modal continua azul-marinho**, como prevê o papel Estrutura.

### Como cada etapa adota

| Etapa | Adoção pendente (**Código**) |
|---|---|
| 03 | `VoyageCard` com `TabList`; trilho da Viagem com `StepRail` |
| 05 | `BlDetalhe` com `TabList`; `BlRailsPipeline` migra para `StepRail`; lente Modalidade com `SegmentedControl` ou removida; 12 cards → até 4 + `SummaryStrip`; tirar `py-3 px-4` das células |
| 07 | `ReviewDrawer` usa `Drawer` |
| 08, 09, 11, 17, 22 | Faixas de abas (`FichaTabs`, `TaxasLocaisTabelas`, `Demurrage`, `DemurrageRates`, `DesbloqueioCe`, `Relatorios`, `Admin`) com `TabList` |
| 10 | `TaxasLocais` com `TabList`; formulário da fatura avulsa: `.invoice-create-modal__filters` tem 383 px numa folha de 360 px (**Runtime**); "Item da tabela/Outra" com `SegmentedControl`; `Modal size` adequado |
| 12 | Topo da Conciliação com `describePageRange` |
| 14, 15 | `PortalOperacao` e `PortalBilling` com `TabList`; ciclo da fatura com `StepRail` |
| 20 | `Granite.tsx` ainda mostra "Não calc." em `span` próprio; usar `ChargeStatusBadge` |
| Todas | Remover `uppercase`, `tracking-*` e `text-[10px]`/`text-[11px]` (40 e 65 usos em TSX); escolher `Modal size`; usar `loadingLabel` nas ações críticas |

### Evidência e limites

- **Teste:**
  - `npm run docs:check`, `typecheck`, `lint` e `build` passaram;
  - `npm test` passou em 709 arquivos (4.032 testes);
  - `npm run size-limit` deu 239,96 KiB no Vela e 207,21 KiB no Portal;
  - `npm run a11y:contrast` passou em 34 de 34 pares, incluindo os 12 novos pares semânticos nos dois temas;
  - testes novos cobrem a largura e o nome do botão em andamento, a repetição bloqueada, o foco inicial, o tamanho do modal, a paginação vazia e de página única, `describePageRange`, o teclado de `SegmentedControl` e `TabList`, a leitura do `StepRail`, `SummaryStrip`, o `MetricCard` como filtro e o contrato CSS (densidade, cabeçalho, escala e aliases).
- **Runtime:** mesmo ambiente local da etapa 00, recriado neste checkout. Antes e depois: 10 rotas (Vela e inspeção do Portal) em 1440×900 e 360×780 com toque, 2 rotas no tema escuro e 2 modais. Sem rolagem horizontal da página. A folha da fatura avulsa a 360 px rolava de lado ao receber o foco inicial; corrigido com `preventScroll`, e o transbordo de origem ficou para a 10.
- **Não verificado:** leitor de tela real, zoom de 200%, Portal fora do Modo Inspeção, impressão (as tabelas de documentos dentro de modal também ficaram com cabeçalho claro na tela; o CSS de impressão é da 13) e telas sem dados extensos.

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
| 00 | Concluída em 2026-10-07 | Base `ba7cd09d`; branch `claude/revisao-visual-ux-etapa-00`; só documentação | Direção A, "Carta náutica", escolhida e registrada em "Etapa 00 — direção visual e inventário confirmado"; complementos da matriz de propriedade; inventário de rotas, abas e modais; alvos por etapa. **Runtime** local com dados sintéticos: 47 rotas em 1440 e 360 px, 28 variações de aba, 768 px, tema escuro e 6 modais; nenhuma rolagem horizontal; `a11y:contrast` 22/22. Lacunas: login real do Portal (visto via inspeção), poucos dados sintéticos, zoom, leitor de tela e impressão. Arquivos: este plano, `docs/plans/README.md` e correção da contagem de rotas do Portal em `docs/ARCHITECTURE.md`. Telas não alteradas. Próxima: 01. |
| 01 | Concluída em 2026-10-07 | Base `74d82566`; branch `claude/revisao-visual-ux-etapa-01` | Tokens (escala, raio, densidade, aliases semânticos com par escuro, cabeçalho claro) e primitivas (`Button`, `Modal`, `TabButton`, `Badge`, `MetricCard`, paginação, `QueryStateGate`, `BulkActionsBar`) revisados; `Drawer`, `TabList`, `SegmentedControl`, `SummaryStrip`, `StepRail` e `describePageRange` criados. Ver "Entrega da etapa 01". Gates locais e `a11y:contrast` 34/34 verdes; runtime antes/depois em 1440, 360 e escuro. Pendências por etapa na tabela "Como cada etapa adota". Próxima: 02. |
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
