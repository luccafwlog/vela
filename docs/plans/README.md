# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos

- [2026-10-07 — Revisão visual e UX: pacote de prompts](2026-10-07-revisao-visual-ux-prompts.md) — prompts para 24 etapas sequenciais no Vela e Portal; etapas 00, 01 e 02 concluídas em 2026-10-07 (direção "Carta náutica", inventário, tokens, primitivas, shells e acesso), 03, 04, 05 e 06 em 2026-10-08 (Viagens, Chegadas e Saídas, Line-Up na TV, programação do Portal, importações comuns, BLs e ficha do B/L, Containers, Veículos e Baplie) e 07 em 2026-10-09 (Revisão); conformidade das etapas 00–05 auditada em 2026-10-08 ([relatório](../archive/audits/2026-10-08-auditoria-contrato-etapas-00-05.md)); próxima: etapa 08.


- [2026-10-09 — Correção das importações e do CE Mercante](2026-10-09-correcao-importacoes-ce-mercante.md) — 13 etapas a partir da [revisão das importações de 2026-10-09](../archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md): reimportação de carga solta e de B/L de container, leitura de datas e números em planilhas, fila de efeitos antes de ligar o runner, container compartilhado, unicidade e portas do CE, Demurrage e Comunicado, contrato da importação de CE, Baplie e demais importações; checagens `it.fails` das Etapas 1–7 já no CI; nenhuma etapa iniciada; 22 decisões de negócio pendentes.

- [2026-10-04 — Desbloqueio de CE Mercante (Issue 557)](2026-10-04-desbloqueio-ce-mercante.md) — checklist reconciliado em 2026-10-07, código integrado na `main`; publicação remota não conferida e homologação pendente; Portal, gestão em Importação, documentos anuais VIP até 31/12 por CNPJ e planilha ZPT com cinco colunas; detalhes documentais/operacionais a homologar.

O plano [2026-09-28 — Remediação da auditoria de segurança run-2](../archive/plans/2026-09-28-remediacao-auditoria-seguranca-run-2.md) foi concluído e arquivado em 2026-10-09: credenciais antigas e deploy key removidas, URL Configuration do Auth corrigida, troca de e-mail com PKCE, importação com e-mail novo e recusa de upload do Financeiro observadas em produção, segredos de cron rotacionados e backup diário confirmado.
O plano [2026-10-08 — Correção das pendências da auditoria das etapas 00–05](../archive/plans/2026-10-08-correcao-pendencias-auditoria-etapas-00-05.md) foi concluído e arquivado em 2026-10-08: correções integradas pela PR 903, decisões N1 (wordmark não conta) e N2 (viagem cancelada sai do Line-Up na TV e no Painel) aplicadas.
O plano [2026-09-06 — Remediação das auditorias #654–#660](../archive/plans/2026-09-06-plano-remediacao-auditorias-654-660.md) foi concluído e arquivado em 2026-09-29 após validação de todas as provas de runtime em produção e otimização do TV refresh.
O plano [2026-10-07 — Desbloqueio de CE: revisão do fluxo](../archive/plans/2026-10-07-desbloqueio-ce-revisao-fluxo.md) foi executado localmente e arquivado (publicação, agenda do e-mail e aceite da planilha pela ZPT pendentes).
O plano [2026-09-23 — Alinhamento entre apresentação, documentação e código](../archive/plans/2026-09-23-alinhamento-apresentacao-docs-codigo.md) foi concluído e arquivado.
O plano [2026-09-23 — Issue 710: consolidação serviço a serviço](../archive/plans/2026-09-23-issue-710-consolidacao-service-a-service.md) foi concluído e arquivado.
O plano [2026-09-17 — Unificação de B/Ls, carga mista e Manifesto Mercante](../archive/plans/2026-09-17-unificacao-bls-carga-mista-e-manifesto-mercante.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação das auditorias marítimas (PR 706)](../archive/plans/2026-09-20-remediacao-auditorias-maritimas.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação da fronteira de segurança do Portal](../archive/plans/2026-09-20-remediacao-fronteira-seguranca-portal.md) foi concluído e arquivado.
O plano [2026-09-20 — Remediação de clientes, revisão e comunicação](../archive/plans/2026-09-20-remediacao-clientes-revisao-comunicacao.md) foi concluído e arquivado.
O plano [2026-09-12 — Transição de marca: Transhipping Desk → Vela](../archive/plans/2026-09-12-plano-transicao-marca-vela.md) foi concluído e arquivado (PR #688).
O plano [2026-09-03 — Issue 609: contatos e caixas de comunicação](../archive/plans/2026-09-03-issue-609-contatos-caixas-comunicacao.md) foi concluído e arquivado.

## Atualização do ciclo de vida — 2026-09-29

O plano [2026-09-06 — Remediação das auditorias #654–#660](../archive/plans/2026-09-06-plano-remediacao-auditorias-654-660.md)
foi concluído em 2026-09-29 com a validação em produção de todas as etapas
de runtime (Pix estático em PSP real, convite Resend pós-PR #802, paridade de
faturas no Portal, ingestão de arquivos e acessibilidade por teclado) e a
otimização do TV display refresh.

## Atualização do ciclo de vida — 2026-09-25

Por confirmação do responsável pelo Vela, os planos de governança das skills,
da revisão sistemática multiagente e da auditoria do Portal/F12 foram
concluídos e movidos para [`../archive/plans/`](../archive/plans/). O plano
Cloudflare permanece vivo.

## Revisão do ciclo de vida — 2026-09-19

Naquela revisão, os planos #654–#660, da revisão sistemática e de governança
das skills ainda continuavam vivos: o primeiro exigia prova de runtime; o
segundo mantinha C4/D4/D6 abertos; e o terceiro mantinha a validação no
Alienware e o encerramento pendentes. Nenhum foi arquivado apenas por ter
grande parte implementada.

As notas de execução intermediária de agosto/setembro foram preservadas no
[registro histórico](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da tabela acima.
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.

O plano [2026-10-02 — Correção dos achados da PR 839](../archive/plans/2026-10-02-correcao-achados-pr-839.md) foi encerrado com implementação e validação local concluídas; publicação e CI ficam registrados na PR.

A Central de Informações aprovada em 2026-10-04 foi implementada e validada
localmente: [registro arquivado](../archive/plans/2026-10-04-portal-informacoes.md).
Publicação remota não realizada.
