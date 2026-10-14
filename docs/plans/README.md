# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos

- [2026-10-13 — Revisão geral da documentação](2026-10-13-revisao-geral-documentacao.md) — aplica a [ADR 0082](../adr/0082-governanca-documental-dono-unico-e-adr-historica.md): dono único por fato, `CONTEXT.md` como glossário, faixa "Situação atual" nas ADRs e varredura por domínio com registro de decisões pendentes. Varredura, aplicação e gate concluídos em 2026-10-14 ([relatório](../archive/audits/2026-10-13-revisao-geral-documentacao.md)); vivo até o dono responder as decisões pendentes (25 de negócio, 32 defeitos e 1 registro).

- [2026-10-13 — Identidade visual: migração tela a tela](2026-10-13-identidade-visual-tela-a-tela.md) — base da [identidade visual única](../identidade-visual.md) entregue em 2026-10-13 ([ADR 0081](../adr/0081-identidade-visual-unica.md)): tokens, tema FWLOG do Portal, peças comuns e `npm run design:check`; 21 telas a migrar, cada uma aprovada pelo responsável com captura de hoje, proposta e lista do que muda; ficha do B/L e passada única entregues; próximo: lote 1 (lista de BLs e ficha da Viagem aprovadas, demais telas em aprovação).

- [2026-10-04 — Desbloqueio de CE Mercante (Issue 557)](2026-10-04-desbloqueio-ce-mercante.md) — backend publicado em produção (conferido em 2026-10-10); Portal, gestão em Importação, documentos anuais VIP até 31/12 por CNPJ e planilha ZPT com cinco colunas (`zpt-5-v2`). Matrizes de pagamento, acesso entre CNPJs, compatibilidade dos frontends e fluxo A/B até a exportação feitos em 2026-10-13. A ativação depende do aceite operacional, da homologação ZPT (planilha `zpt-5-v2` e conciliação com o "Exportar Tela" real), da migration `220` em produção, da prova do expurgo e da correção do alerta de troca de CE com Desbloqueio conferido (decisão pendente B1); caminho crítico no plano.

Planos concluídos, encerrados ou superados ficam no [índice dos planos arquivados](../archive/plans/README.md). As notas de estado que este índice acumulou até 2026-10-13 estão no [registro histórico](../archive/reports/2026-10-14-estado-planos-vivos-ate-2026-10-13.md); as anteriores, no [registro de 2026-09-18](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da lista acima e acrescentar o plano, com estado e motivo, ao [índice dos planos arquivados](../archive/plans/README.md).
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
