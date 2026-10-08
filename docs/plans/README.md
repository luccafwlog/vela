# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos

- [2026-10-07 — Revisão visual e UX: pacote de prompts](2026-10-07-revisao-visual-ux-prompts.md) — prompts para 24 etapas sequenciais no Vela e Portal; etapas 00 e 01 concluídas em 2026-10-07 (direção "Carta náutica", inventário, tokens e primitivas); próxima: etapa 02.


- [2026-10-06 — Integração Itaú Pix: QR dinâmico e baixa automática](2026-10-06-integracao-itau-pix.md) — em execução; provedor `itau` ativo em produção desde 07/10 (`itau-pix` v8 desde 08/10, baixa por consulta a cada minuto); individual de teste baixada pelo cron; pendentes recibo da individual no Portal e prova da consolidada ([histórico de execução](../archive/reports/2026-10-07-integracao-itau-pix-execucao.md)); substitui a PR 827 (simulação, defasada pelas migrations 122–149).
- [2026-10-04 — Desbloqueio de CE Mercante (Issue 557)](2026-10-04-desbloqueio-ce-mercante.md) — checklist reconciliado em 2026-10-07, código integrado na `main`; publicação remota não conferida e homologação pendente; Portal, gestão em Importação, documentos anuais VIP até 31/12 por CNPJ e planilha ZPT com cinco colunas; detalhes documentais/operacionais a homologar.
- [2026-09-28 — Remediação da auditoria de segurança run-2](2026-09-28-remediacao-auditoria-seguranca-run-2.md) — após cinco falhas HTTP 400, consulta Cloudflare individual por nome passou no run `37631613061`; Preview/PKCE, validação dos outros workflows, credenciais em runtime, regras de acesso, importação, tentativa Storage como Financeiro, segredos do Vault e backup agendado seguem pendentes — ver "Atualização operacional de 2026-10-07".

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
