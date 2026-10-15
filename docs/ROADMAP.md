# Roadmap do Vela e do Portal Fwlog

Baseline documental revisado em 2026-09-18 e atualizado em 2026-10-14 nos
itens conferidos pela revisão geral da documentação: entregas desde o baseline,
frentes vivas, backlog e riscos foram confrontados com o código, as migrations
ativas e os planos arquivados citados. A presença no código não comprova
rollout remoto; "em produção" só aparece onde há conferência registrada.

Este documento separa capacidades entregues, evolução confirmada, backlog e
riscos ativos. Cada capacidade ocupa uma linha; a regra vigente está no módulo
linkado. Planos datados registram o caminho de uma mudança, mas não
substituem este baseline.

## Implementado no repositório

### Operação

- viagens em layout master-detail, com deep link por viagem;
- planejamento de Escalas/Atracações, Manifestos Mercante por rota e linha do tempo;
- cancelamento de viagem com reativação, Viagem Cancelada selada e exclusão de viagem em cascata com trava do CE Mercante ([Viagens](modules/viagens.md); migrations `088`, `089`, `178` e `216`);
- Programação de navios por planilha, com prévia e gravação de uma vez só ([Chegadas e Saídas](modules/chegadas-saidas.md); migration `188`);
- Line-Up no Painel e na TV ([Operação & Suporte](modules/operacao-suporte.md));
- Omissão de escala, Transbordo e COD com reprecificação da Taxa Local no destino final ([Viagens](modules/viagens.md); ADRs 0051 e 0052);
- importação e reconciliação de Baplie EDI;
- B/Ls unificados de container, carga solta e mistos;
- containers, veículos RoRo e CE Mercante;
- SOC/COC do container, lido do B/L e do Baplie ([BLs & EDI](modules/manifesto-edi.md); migration `121`);
- Vazios de Importação por Baplie ou planilha;
- Embarque de Vazios por escala, com Unidades Embarcadas importadas e Linhas de Serviço lançadas ([BLs & EDI](modules/manifesto-edi.md); ADR 0033);
- projeção unificada de escalas POL/POD/EXP, com operação por terminal;
- Cadastro de Terminais com valores sugeridos ([BLs & EDI](modules/manifesto-edi.md));
- ADR por terminal com sign-off departamental e Prazo de Conclusão ([Operação & Suporte](modules/operacao-suporte.md));
- fluxo especializado de Granito;
- fila de revisão operacional e reconciliação de cliente;
- Desbloqueio de CE no Vela: validação documental, BL de Entrega, exportação e conciliação com a ZPT ([Desbloqueio de CE](modules/desbloqueio-ce.md)).

### Financeiro

- tabelas de taxas locais e overrides por cliente;
- cálculo, revisão e gate de faturabilidade;
- tentativa automática de cálculo/emissão após correção de cliente na revisão;
- Liberação de faturamento sem Portal por Cliente ([Faturamento](modules/faturamento.md); ADR 0070);
- emissão pelo CE Mercante em lotes ([Faturamento](modules/faturamento.md); migration `181`);
- invoice individual e consolidada;
- Fatura Avulsa ([Faturamento](modules/faturamento.md); ADR 0075);
- correção automática do B/L após faturamento: reemissão sem pagamento, abatimento e restituição com pagamento ([Faturamento](modules/faturamento.md); ADR 0077);
- COD e Ajuste de COD ([Faturamento](modules/faturamento.md));
- ledger local, pagamentos parciais, reversões, reembolsos e ciclo de vida;
- controles de restituição com evidência e resumo de recebimentos ([Faturamento](modules/faturamento.md); migration `136`);
- Demurrage em persistência própria;
- conciliação PIX unificada;
- cobrança Pix dinâmica Itaú por fatura, com baixa automática pela consulta de 1 minuto, em produção desde 2026-10-07; o extrato fica como plano B ([Conciliação PIX](modules/reconciliacao-pix.md); migrations `151`–`154` e `219`);
- documentos imprimíveis com QR PIX;
- relatórios e alertas financeiros;
- alertas internos por catálogo, detectores server-side e notificações por usuário.

### Clientes e Comunicados

- Caixas de Comunicação e auditoria de contatos ([Clientes](modules/clientes.md); ADR 0064);
- Comunicados ao Cliente manuais e automáticos (NOA, NOR, NOB e CE e Taxas) e Régua de Cobrança de Demurrage, sob a chave de envio que nasce desligada ([Clientes](modules/clientes.md); ADR 0059).

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
- programação de navios;
- Central de Informações ([Portal do Cliente](modules/portal-cliente.md));
- Desbloqueio de CE: solicitação por B/L e documentos anuais VIP ([Desbloqueio de CE](modules/desbloqueio-ce.md)).

### Plataforma

- RLS e RPCs como fronteira de segurança;
- default-deny de funções privilegiadas, com exceção pré-login documentada;
- sessões interna e do Portal isoladas;
- política de exclusão: trava pelo CE Mercante com prévia e motivo, B/L e viagem canceláveis e reativáveis, cadastro usado só se desativa, documento fiscal e auditoria imutáveis pela API, e toda escrita confirmada com a consequência ([regras de negócio](operations/regras-de-negocio.md#ações-sobre-registros); ADRs 0071–0073);
- rotina diária de guarda de dados e backup lógico diário cifrado em R2, sem PITR ([regras de negócio](operations/regras-de-negocio.md#guarda-e-recuperação), [backup](operations/backup-r2.md); ADR 0074);
- login do Portal com Cloudflare Turnstile e rate limit distribuído como segunda camada ([segurança](operations/seguranca.md), [rate limit](operations/portal-rate-limit.md));
- CI com documentação, lint, build e testes antes do merge, mais replay de todas as migrations num Postgres 16 real e as suítes `local-pg` ([testes](setup/testing.md));
- deploy automatizado no Cloudflare Pages: Preview por PR e Production a cada merge na `main` ([deploy](setup/deploy.md); ADR 0076);
- Sentry inicializado em produção, heartbeats do Better Stack nos runners e métrica agregada anônima no PostHog ([observabilidade](operations/observabilidade.md), [serviços externos](operations/servicos-externos.md));
- `@e965/xlsx` para planilhas, com limite de upload antes do parsing;
- auditorias técnica, funcional e visual preservadas como snapshots.

## Em evolução

### Planos vivos

As frentes com plano vivo estão no [índice de planos](plans/README.md), com o
caminho crítico de cada uma no próprio plano. Entre elas, a ativação do
Desbloqueio de CE: homologação da planilha com a ZPT, aceite operacional e os
demais itens que bloqueiam a ativação.

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
- webhook do Itaú Pix, opcional: a consulta de 1 minuto atende hoje;
- avaliar realtime para eventos operacionais prioritários;
- revisar políticas e índices orientado por queries reais, não por contagem
  genérica de advisors.

## Riscos ativos

| Risco | Impacto | Mitigação atual | Próximo passo |
|---|---|---|---|
| Migrations chegam ao banco remoto fora do CI da SPA | Alto | O CI aplica todas as migrations num Postgres 16 real e roda as suítes `local-pg`; a integração GitHub do Supabase aplica as pendentes em produção depois do merge; Preview do Supabase só com branch criada à mão (Automatic branching desligado) | Detectar drift entre o banco remoto e a cadeia ativa |
| E2E completo ainda depende de execução manual | Alto | `docs/operations/validacao.md`, fixtures e testes unitários | Smoke automatizado dos fluxos financeiro e Portal |
| Limpeza ampla de dados de teste só é aceitável enquanto não há dado real | Alto | Script único `supabase/scripts/limpar_dados_teste.sql`, provado em banco descartável ([procedimento](operations/reset-ambiente.md)); `app_settings` protegido pela migration `156`; `migrations:check` exige a declaração do "Data status" do `AGENTS.md` | Trocar o "Data status" na mesma mudança que abrir o sistema a dados reais |
| Backup diário depende de uma tarefa num computador ligado | Médio | Par `.dump.enc` + `.manifest.json` diário no R2, conferido de 2026-10-06 a 2026-10-08 ([backup](operations/backup-r2.md)) | Operação do dono ([ADR 0083](adr/0083-decisoes-da-revisao-geral-da-documentacao.md), item 6; A6 no [plano de correções](archive/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)): heartbeat do backup no Better Stack ligado em 2026-10-14 (avisa o dia sem backup); falta o executor sempre ligado antes de revogar o "Data status" |
| Correções da PR 954 (escrita direta pela API, RPCs legadas do Portal, ROE gravável, plano B do extrato, troca de CE com Desbloqueio) publicadas em 2026-10-15; fluxos de tela ainda sem uso real observado | Médio | Migrations `230` a `278` com prova local-pg, aplicadas em produção no merge; job da PTAX das 14h de 2026-10-15 gravou a referência do dia com o markup único da `264` (conferido em 2026-10-15, [Serviços externos](operations/servicos-externos.md#edge-functions)) | Observar o primeiro uso real dos fluxos alterados ([plano de correções](archive/plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)) |
| Layout novo de armador pode quebrar parser | Médio | Parsers isolados, limite de upload e fixtures | Fixture real antes de cada novo layout |
| Login do Portal pode sofrer enumeração/abuso | Médio | Hash por CNPJ, janela de tentativas e erro genérico; Cloudflare Turnstile e rate limit distribuído por IP+CNPJ | Métricas e revisão periódica do limite |
| Páginas grandes concentram risco de regressão | Médio | Mudanças cirúrgicas e testes focados | Decomposição oportunista com caracterização |

## Critério para mover um item

- **Em produção:** código, migration e ambiente aplicável foram verificados.
- **Em evolução:** trabalho confirmado ou risco com ação em andamento.
- **Backlog:** intenção ainda sem compromisso de implementação.
- **Resolvido:** remover da lista ativa e preservar a evidência no plano, ADR,
  auditoria ou histórico Git apropriado.
