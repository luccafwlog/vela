# 0003 — SPA React com rotas lazy e camadas page/hook/service

> **Situação atual (2026-10-13).** A decisão vale inteira; ADRs posteriores a estenderam sem revogar nada. A [ADR 0066](./0066-transicao-marca-vela.md) criou as duas entradas, Vela em `src/AppInterno.tsx` e Portal Fwlog em `src/AppPortal.tsx`, que o texto abaixo já menciona (`src/App.tsx` só reexporta a entrada interna); a [ADR 0018](./0018-selecao-viagem-busca-preditiva-combobox.md) e a [ADR 0034](./0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md) aplicam as camadas a controles compartilhados.
> Regra vigente em [Arquitetura](../ARCHITECTURE.md), seção "Camadas do frontend", e em [WORKFLOW.md](../../WORKFLOW.md), seção "8. Rotas e páginas".

Status: estendida — 2026-06-09

## Contexto

O Vela e o Portal Fwlog concentram muitos módulos operacionais, financeiros e de portal em duas superfícies de navegador sobre a mesma base de código: viagens, importações, revisão, clientes, taxas locais, faturamento, demurrage, conciliação, relatórios, administração e Portal do Cliente.

Sem uma separação estável, a tendência natural seria cada tela misturar navegação, cache, acesso ao Supabase, parsing de arquivos e componentes visuais, tornando difícil evoluir módulos grandes como `Faturamento`, `TaxasLocais`, `Viagens`, `Revisao` e `BlDetalhe`.

## Decisão

Manter o app como uma SPA estática em React 19 + TypeScript + Vite, com rotas no cliente e separação explícita entre páginas, hooks, serviços e componentes.

- `src/AppInterno.tsx` e `src/AppPortal.tsx` são os mapas canônicos de rotas de seus respectivos builds. Cada tela é carregada via `lazyPage()` e exporta um componente nomeado.
- `ProtectedRoute`, `ProtectedRoute adminOnly` e `PortalProtectedRoute` separam navegação interna, administração e portal. Essas barreiras são de experiência de uso; a autorização real fica no Supabase/RLS.
- `src/main.tsx` concentra os providers globais do build interno; `src/portal-main.tsx` concentra os providers do Portal. Cada entrada usa somente o provedor de autenticação de sua superfície, além de React Query, roteador, toast, confirmação, tema visual e `ErrorBoundary`.
- `pages/` orquestra fluxos de tela e interação do usuário.
- `hooks/` encapsula React Query, cache, mutations e invalidação.
- `services/` concentra acesso a Supabase, RPCs, parsers, regras de domínio testáveis e deve lançar erro quando a operação falha.
- `components/ui/`, `components/layout/`, `components/shared/`, `components/billing/`, `components/demurrage/` e `components/lineup/` mantêm componentes reutilizáveis fora das páginas.

## Consequências

- **Positivas**: adicionar uma rota nova tem caminho previsível; chunks por rota reduzem o custo inicial do bundle; serviços podem ser testados sem renderizar UI; React Query fica com chaves centralizadas e invalidações mais rastreáveis.
- **Negativas / custos**: páginas legadas ainda podem ficar grandes quando concentram fluxos densos; decompor essas páginas exige testes antes para evitar regressão operacional.
- **Regra prática**: nova funcionalidade deve nascer no menor ponto apropriado: componente visual em `components/`, estado remoto em `hooks/`, domínio/acesso a dados em `services/` e apenas composição de fluxo em `pages/`.
