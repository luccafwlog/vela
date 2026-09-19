# Roadmap do Vela e do Portal Fwlog

Baseline documental revisado em 2026-09-18. A presença no código não comprova rollout remoto.

Este documento separa capacidades entregues, evolução confirmada, backlog e
riscos ativos. Planos datados registram o caminho de uma mudança, mas não
substituem este baseline.

## Implementado no repositório

### Operação

- viagens em layout master-detail, com deep link por viagem;
- planejamento de Escalas/Atracações, Manifestos Mercante por rota e linha do tempo;
- importação e reconciliação de Baplie EDI;
- B/Ls unificados de container, carga solta e mistos;
- containers, veículos RoRo e CE Mercante;
- Vazios de Importação por Baplie ou planilha;
- bookings de Vazios de Exportação;
- projeção unificada de escalas POL/POD/EXP, com operação por terminal;
- Cadastro de Depot com tarifas e serviços extras, importação por container e custos refletidos no ADR;
- fluxo especializado de Granito;
- fila de revisão operacional e reconciliação de cliente.

### Financeiro

- tabelas de taxas locais e overrides por cliente;
- cálculo, revisão e gate de faturabilidade;
- tentativa automática de cálculo/emissão após correção de cliente na revisão;
- invoice individual e consolidada;
- ledger local, pagamentos parciais, reversões, reembolsos e ciclo de vida;
- Demurrage em persistência própria;
- conciliação PIX unificada;
- documentos imprimíveis com QR PIX;
- relatórios e alertas financeiros;
- alertas internos por catálogo, detectores server-side e notificações por usuário.

### Portal do Cliente

- login por CNPJ e senha usando sessão Supabase Auth;
- recuperação de senha;
- dashboard financeiro e operacional;
- faturas locais e de Demurrage;
- consolidação e obsolescência self-service dentro das guardas;
- B/Ls e containers;
- gate de visibilidade por CE Mercante;
- notificações, disputas e perfil;
- exportações filtradas;
- programação de navios.

### Plataforma

- RLS e RPCs como fronteira de segurança;
- default-deny de funções privilegiadas, com exceção pré-login documentada;
- sessões interna e do Portal isoladas;
- CI com documentação, lint, build e testes antes do merge;
- squash merge e deploy automatizado na Vercel;
- Sentry inicializado em produção;
- `@e965/xlsx` para planilhas, com limite de upload antes do parsing;
- auditorias técnica, funcional e visual preservadas como snapshots.

## Em evolução

### Testes e ambientes

- automatizar smoke/E2E dos fluxos de maior risco;
- executar Auth, RLS, RPCs, Edge Functions e email em ambiente Supabase
  descartável;
- reduzir dependência de testes textuais de migration com validação comportamental
  em banco;
- manter fixtures reais por layout de armador.

### Arquitetura

- decompor páginas grandes quando houver cobertura de caracterização;
- consolidar operações de serviço e hooks apenas onde houver duplicação real;
- melhorar tipagem de selects Supabase complexos;
- reduzir casts em caminhos financeiros;
- manter `src/types/database.ts` alinhado ao schema atual.

### Operação e observabilidade

- monitorar abuso e falsos positivos no login do Portal (`portal-login`);
- melhorar visibilidade de falhas em jobs e escritas best-effort;
- acompanhar drift entre migrations locais e ambientes remotos;
- amadurecer evidências de release e smoke pós-deploy.

## Backlog

- formalizar a entidade de trecho de viagem;
- criar relatório consolidado por viagem para CNTR, BB, Granito, veículos e
  vazios;
- adicionar autenticação mais forte ao Portal quando houver requisito de
  negócio e suporte operacional;
- substituir o reset suspenso por ferramenta validada, idempotente e segura;
- validar readiness dos Previews automáticos já configurados e os runners ainda dependentes de ativação;
- avaliar realtime para eventos operacionais prioritários;
- revisar políticas e índices orientado por queries reais, não por contagem
  genérica de advisors.

## Riscos ativos

| Risco | Impacto | Mitigação atual | Próximo passo |
|---|---|---|---|
| Migrations não são aplicadas pelo CI da SPA | Alto | Coordenação manual e testes de contrato | Automatizar detecção de drift e ambiente de validação |
| E2E completo ainda depende de execução manual | Alto | `docs/operations/validacao.md`, fixtures e testes unitários | Smoke automatizado dos fluxos financeiro e Portal |
| Reset amplo está desatualizado | Alto | Script e procedimento marcados como suspensos | Reconstruir e provar em banco descartável |
| Layout novo de armador pode quebrar parser | Médio | Parsers isolados, limite de upload e fixtures | Fixture real antes de cada novo layout |
| Login do Portal pode sofrer enumeração/abuso | Médio | Hash por CNPJ, janela de tentativas e erro genérico | Métricas e revisão periódica do limite |
| Páginas grandes concentram risco de regressão | Médio | Mudanças cirúrgicas e testes focados | Decomposição oportunista com caracterização |

## Critério para mover um item

- **Em produção:** código, migration e ambiente aplicável foram verificados.
- **Em evolução:** trabalho confirmado ou risco com ação em andamento.
- **Backlog:** intenção ainda sem compromisso de implementação.
- **Resolvido:** remover da lista ativa e preservar a evidência no plano, ADR,
  auditoria ou histórico Git apropriado.
