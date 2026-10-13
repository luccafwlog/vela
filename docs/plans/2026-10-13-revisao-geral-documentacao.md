# 2026-10-13 — Revisão geral da documentação

Plano vivo da revisão aprovada pelo dono em 2026-10-13. As regras do trabalho
estão na [ADR 0081](../adr/0081-governanca-documental-dono-unico-e-adr-historica.md)
e em [CONVENCOES.md](../CONVENCOES.md). Este arquivo também é o registro de
achados e de decisões pendentes enquanto a revisão durar; ao terminar, vai
para `docs/archive/plans/` e o relatório final nasce em `docs/archive/audits/`.

## Objetivo

A documentação viva diz o que o sistema faz hoje, cada fato tem um único dono,
e as ADRs antigas são lidas como histórico sem confundir com a regra vigente.

## Fases

| Fase | Entrega | Estado |
|---|---|---|
| 0 | ADR 0081, `CONVENCOES.md` e este plano | concluída |
| 1 | Inventário de temas × documentos | em andamento |
| 2 | Varredura por domínio: corrige (a), registra (b) e (c), leva as regras do `CONTEXT.md` para os módulos | pendente |
| 3 | Rodadas de decisão com o dono, em lote por domínio | pendente |
| 4 | Faixas e índice de ADRs, documentos datados para o arquivo, ampliação do `docs:check`, relatório final | pendente |

## Domínios da varredura

Cada domínio confronta, para o mesmo tema: cadeia de ADRs, `CONTEXT.md`, doc
do módulo, `regras-de-negocio.md`, `manual-financeiro.md`,
`RASTREABILIDADE.md`, `ARCHITECTURE.md` e `ROADMAP.md` contra as migrations
ativas e `src/`.

| # | Domínio | Documentos principais | Estado |
|---|---|---|---|
| 1 | Viagens e Operação | `viagens.md`, `chegadas-saidas.md`, `operacao-suporte.md` (ADR operacional, Line-Up) | pendente |
| 2 | B/L, EDI, Baplie, Granito e vazios | `manifesto-edi.md`, `granito.md` | pendente |
| 3 | CE Mercante e Desbloqueio de CE | `desbloqueio-ce.md`, plano e spec de desbloqueio | pendente |
| 4 | Clientes, Taxas Locais e Faturamento | `clientes.md`, `taxas-locais.md`, `faturamento.md`, `manual-financeiro.md` | pendente |
| 5 | Demurrage | `demurrage.md` | pendente |
| 6 | Conciliação PIX | `reconciliacao-pix.md` | pendente |
| 7 | Portal, autenticação e segurança | `portal-cliente.md`, `seguranca.md`, `portal-rate-limit.md` | pendente |
| 8 | Alertas, notificações e comunicação | `operacao-suporte.md` (alertas), comunicação com o cliente | pendente |
| 9 | Infraestrutura e processo | `WORKFLOW.md`, `setup/`, `servicos-externos.md`, `segredos-cron.md`, `backup-r2.md`, `observabilidade.md`, `AGENTS.md`, `README.md` | pendente |

## Inventário (Fase 1)

Preenchido na Fase 1.

## Correções aplicadas — tipo (a)

Registradas por domínio no commit correspondente; resumo no relatório final.

## Decisões pendentes — tipos (b) e (c)

Cada item traz o caso, o que dizem os documentos, o que faz o código, as
opções e a recomendação. Itens respondidos viram ADR nova e saem desta lista.

Nenhuma registrada ainda.
