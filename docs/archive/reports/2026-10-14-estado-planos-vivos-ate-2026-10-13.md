# Estado dos planos no índice vivo até 2026-10-13

> Texto retirado em 2026-10-14 de [`docs/plans/README.md`](../../plans/README.md) pela revisão geral da documentação (achados M-09, M-10 e M-23): resumos de planos já arquivados e seções datadas do ciclo de vida, copiados sem edição de texto (só os links relativos foram ajustados ao novo local). O estado de cada plano arquivado fica no [índice dos planos arquivados](../plans/README.md); o que foi entregue, no [CHANGELOG](../../CHANGELOG.md).

## Planos arquivados citados na seção "Planos ativos"

O plano [2026-10-09 — Correção das importações e do CE Mercante](../plans/2026-10-09-correcao-importacoes-ce-mercante.md) foi concluído e arquivado em 2026-10-12: PR 929 integrada, migrations `174` a `217` em produção depois do diagnóstico da Etapa 0 e `import-effects-runner` ligado.
O plano [2026-09-28 — Remediação da auditoria de segurança run-2](../plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md) foi concluído e arquivado em 2026-10-09: credenciais antigas e deploy key removidas, URL Configuration do Auth corrigida, troca de e-mail com PKCE, importação com e-mail novo e recusa de upload do Financeiro observadas em produção, segredos de cron rotacionados e backup diário confirmado.
O plano [2026-10-08 — Correção das pendências da auditoria das etapas 00–05](../plans/2026-10-08-correcao-pendencias-auditoria-etapas-00-05.md) foi concluído e arquivado em 2026-10-08: correções integradas pela PR 903, decisões N1 (wordmark não conta) e N2 (viagem cancelada sai do Line-Up na TV e no Painel) aplicadas.
O plano [2026-09-06 — Remediação das auditorias #654–#660](../plans/2026-09-06-plano-remediacao-auditorias-654-660.md) foi concluído e arquivado em 2026-09-29 após validação de todas as provas de runtime em produção e otimização do TV refresh.
O plano [2026-10-07 — Desbloqueio de CE: revisão do fluxo](../plans/2026-10-07-desbloqueio-ce-revisao-fluxo.md) foi executado localmente e arquivado (publicação, agenda do e-mail e aceite da planilha pela ZPT pendentes).
O plano [2026-09-23 — Alinhamento entre apresentação, documentação e código](../plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md) foi concluído e arquivado.
O plano [2026-09-23 — Issue 710: consolidação serviço a serviço](../plans/2026-09-23-issue-710-consolidacao-service-a-service.md) foi concluído e arquivado.
O plano [2026-09-17 — Unificação de B/Ls, carga mista e Manifesto Mercante](../plans/2026-09-17-unificacao-bls-carga-mista-e-manifesto-mercante.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação das auditorias marítimas (PR 706)](../plans/2026-09-20-remediacao-auditorias-maritimas.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação da fronteira de segurança do Portal](../plans/2026-09-20-remediacao-fronteira-seguranca-portal.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação de clientes, revisão e comunicação](../plans/2026-09-20-remediacao-clientes-revisao-comunicacao.md) foi concluído e arquivado.
O plano [2026-09-12 — Transição de marca: Transhipping Desk → Vela](../plans/2026-09-12-plano-transicao-marca-vela.md) foi concluído e arquivado (PR #688).
O plano [2026-09-03 — Issue 609: contatos e caixas de comunicação](../plans/2026-09-03-issue-609-contatos-caixas-comunicacao.md) foi concluído e arquivado.

## Atualização do ciclo de vida — 2026-09-29

O plano [2026-09-06 — Remediação das auditorias #654–#660](../plans/2026-09-06-plano-remediacao-auditorias-654-660.md)
foi concluído em 2026-09-29 com a validação em produção de todas as etapas
de runtime (Pix estático em PSP real, convite Resend pós-PR #802, paridade de
faturas no Portal, ingestão de arquivos e acessibilidade por teclado) e a
otimização do TV display refresh.

## Atualização do ciclo de vida — 2026-09-25

Por confirmação do responsável pelo Vela, os planos de governança das skills,
da revisão sistemática multiagente e da auditoria do Portal/F12 foram
concluídos e movidos para [`../archive/plans/`](../plans/). O plano
Cloudflare permanece vivo.

## Revisão do ciclo de vida — 2026-09-19

Naquela revisão, os planos #654–#660, da revisão sistemática e de governança
das skills ainda continuavam vivos: o primeiro exigia prova de runtime; o
segundo mantinha C4/D4/D6 abertos; e o terceiro mantinha a validação no
Alienware e o encerramento pendentes. Nenhum foi arquivado apenas por ter
grande parte implementada.

As notas de execução intermediária de agosto/setembro foram preservadas no
[registro histórico](2026-09-18-notas-historicas-indice-planos.md).

## Notas do fim do índice

O plano [2026-10-02 — Correção dos achados da PR 839](../plans/2026-10-02-correcao-achados-pr-839.md) foi encerrado com implementação e validação local concluídas; publicação e CI ficam registrados na PR.

A Central de Informações aprovada em 2026-10-04 foi implementada e validada
localmente: [registro arquivado](../plans/2026-10-04-portal-informacoes.md).
Publicação remota não realizada.
