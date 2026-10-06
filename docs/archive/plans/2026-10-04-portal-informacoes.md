# Central de Informações — plano de implementação

> Execução autorizada pelo usuário. Skills: writing-plans e executing-plans;
> frentes de interface independentes usam dispatching-parallel-agents.

**Objetivo:** concentrar consultas do cliente no Portal usando o Vela como
origem, preservando a identidade visual existente.

**Arquitetura:** tabelas complementares e RPCs autenticadas; serviços tipados,
hooks React Query e telas compostas com as primitivas existentes. As tabelas
financeiras existentes continuam oficiais.

**Stack:** React, TypeScript, React Query, Supabase/PostgreSQL, Vitest.

**Spec:** [Desenho e contratos](../spec/2026-10-04-portal-informacoes.md).

## Restrições globais

Sem novas bibliotecas de UI, planilhas ou alteração de migrations históricas.
Não editar tipos gerados protegidos; contratos novos têm tipos próprios.
Sem taxas de exportação ou Detention. Não aplicar alterações em produção.
Novo SQL segue numeração sequencial em WORKFLOW.md e nasce com acesso fechado.

## Foco da revisão

Outro cliente não consulta unidade alheia; indicação despublicada não vira
devolução geral; BLs compartilhados não recebem instruções conflitantes;
ausência de tarifa não inventa free time; links externos não executam esquemas
inseguros. Casos pertencem aos testes do backend e serviço.

### Task 1: Contratos e serviços

Arquivos: src/services/portalInformation.ts, src/hooks/usePortalInformation.ts,
src/services/portalRpcContracts.ts e testes de serviço/URL.

Interfaces: PortalInformation, PortalDepot, PortAgent, PortalContact,
CarrierTracking, LocalReferenceTable, ReturnGuidance; leituras portal e internas
e mutações internal_save_portal_information/set_container_return_instruction.

- [x] Escrever testes de URL insegura e escopo cliente/inspeção; observar falha.
- [x] Implementar tipos próprios, serviços e hooks; invalidar queries afetadas.
- [x] Executar testes focados; esperado: PASS.

### Task 2: Banco e dados iniciais

Arquivo: nova migration 134_portal_information.sql; testes de integração local.
Consome os contratos da Task 1; produz RPCs e complementos de depots, agentes,
atendimento, tracking e indicação específica. Informações iniciais são as do site.

- [x] Testar regra geral, indicação, retirada, indisponibilidade, SOC e escopo.
- [x] Implementar schema, policies, funções, auditoria e dados de referência.
- [x] Alinhar free time da consulta operacional sem alterar faturas emitidas.
- [x] Validar SQL em banco descartável; esperado: consultas e isolamento PASS.

### Task 3: Administração no Vela

Arquivos: tela de informações internas e componente de indicação por container;
rotas internas e navegação; testes de comportamento.
Consome serviços/hooks da Task 1. Reutiliza cadastros de depots e armadores,
sem substituí-los. Permissões de edição devem corresponder ao backend.

- [x] Testar seleção e retirada de indicação antes de implementar.
- [x] Implementar edição de depots, agentes, contatos e tracking e justificar
      indicação; expor acesso junto do container e nas rotas internas.
- [x] Verificar testes focados e typecheck; esperado: PASS.

### Task 4: Central no Portal

Arquivos: PortalInformation.tsx e componentes por seção; AppPortal, PortalLayout,
PortalDashboard, PortalOperacao e atalhos de Faturas; paridade Modo Inspeção.
Consome PortalInformation/ReturnGuidance da Task 1.

- [x] Testar orientação restrita e estados de indisponibilidade antes da UI.
- [x] Implementar seis seções e atalhos com componentes e tokens existentes.
- [x] Validar filtros, rotas cliente/inspeção e mobile; esperado: PASS.

### Task 5: Integração e entrega

- [x] Atualizar módulos, rastreabilidade e termos de devolução no CONTEXT.md.
- [x] Executar docs:check, typecheck, lint, npm test, build, migrations:check,
      rpc:check e integração PostgreSQL local; inspecionar todos os resultados.
- [x] Verificar visualmente as telas e revisar a mudança inteira.
- [x] Arquivar spec/plano com evidência e limites da validação; produção não
      implantada. Não afirmar implantação a partir de arquivos locais.


## Estado final — 2026-10-04

Implementação e validação locais concluídas; a publicação remota é separada.
A interface interna final é `ClientesInformacoes.tsx` para explicitar sua
fronteira em relação às páginas do cliente. Não houve implantação em produção.

Evidência: 50 testes focados de serviço/interface; 18 testes reais de PostgreSQL
16.14; replay completo de 132 migrations até `134`; catálogo de 203 RPCs;
TypeScript, build, ESLint, migrations:check, docs:check e diff-check. Revisão
independente sem achados pendentes após corrigir refresh em foco e aliases de
POD. Visual: 22 capturas desktop/mobile de componentes reais com fixtures,
sem overflow; seleção múltipla e retirada verificadas em stubs locais.
A autenticação remota e o ambiente de produção não foram exercitados.

A suíte completa foi repetida após corrigir a fronteira de marca e tornar
explícito o RLS na nova migration para a verificação estática. Testes existentes
de Clientes e Demurrage também passaram isoladamente após falhas intermitentes
sob execução concorrente; a repetição final usa 4 workers, limite de 15s e uma
tentativa adicional para absorver a variação do ambiente, sem mudar os testes.

Resultado final da suíte completa: 693 arquivos / 3.875 testes aprovados;
52 arquivos / 303 testes condicionais ignorados. Os 18 testes PostgreSQL
foram ativados e executados separadamente com LOCAL_PG_INTEGRATION=1.


Nota de integração — 2026-10-05: migrations de Informações renumeradas de 134/135 para 135/136 antes da publicação, preservando a ordem e o SQL.

Nota de integração — 2026-10-06: a main publicou sua própria 135; as migrations de Informações passaram a 137/138 (a 136 ficou com os controles financeiros da PR 846), preservando a ordem e o SQL.
