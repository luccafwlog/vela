# Planos de implementação (vivos)

Planos ativos — trabalho previsto e ainda não concluído. Este é o único
diretório de planos vivos do projeto; skills e agentes gravam planos novos aqui.

Quando um plano é totalmente executado, encerrado ou superado por decisão
registrada, ele é movido para [`../archive/plans/`](../archive/plans/README.md)
com nota de estado e motivo; o arquivo continua sendo histórico, não fonte de
verdade sobre o estado atual.

## Planos ativos

- [2026-10-13 — Revisão geral da documentação](2026-10-13-revisao-geral-documentacao.md) — aplica a [ADR 0081](../adr/0081-governanca-documental-dono-unico-e-adr-historica.md): dono único por fato, `CONTEXT.md` como glossário, faixa "Situação atual" nas ADRs e varredura por domínio com registro de decisões pendentes; Fase 0 concluída em 2026-10-13.

- [2026-10-07 — Revisão visual e UX: pacote de prompts](2026-10-07-revisao-visual-ux-prompts.md) — prompts para 24 etapas sequenciais no Vela e Portal; etapas 00, 01 e 02 concluídas em 2026-10-07 (direção "Carta náutica", inventário, tokens, primitivas, shells e acesso), 03, 04, 05 e 06 em 2026-10-08 (Viagens, Chegadas e Saídas, Line-Up na TV, programação do Portal, importações comuns, BLs e ficha do B/L, Containers, Veículos e Baplie) e 07, 08, 09 e 10 em 2026-10-09 (Revisão, Clientes e ficha do Cliente, Tabelas de Taxas Locais e Condições de Cliente, faturamento interno, detalhe da fatura e fatura avulsa), 11 em 2026-10-12 (Demurrage, Invoices, Disputas, tarifas e acordos) e 12 em 2026-10-13 (Conciliação PIX: Pendências, extrato e histórico de baixas); conformidade das etapas 00–05 auditada em 2026-10-08 ([relatório](../archive/audits/2026-10-08-auditoria-contrato-etapas-00-05.md)); revisado em 2026-10-12 depois do merge da PR 929 (nota editorial com superfícies novas por dono e itens de aceite nos prompts 11, 12, 13, 15, 17, 19, 20, 21 e 23); próxima: etapa 13.

- [2026-10-04 — Desbloqueio de CE Mercante (Issue 557)](2026-10-04-desbloqueio-ce-mercante.md) — backend publicado em produção (conferido em 2026-10-10); Portal, gestão em Importação, documentos anuais VIP até 31/12 por CNPJ e planilha ZPT com cinco colunas (`zpt-5-v2`). Matrizes de pagamento, acesso entre CNPJs, compatibilidade dos frontends e fluxo A/B até a exportação feitos em 2026-10-13. A ativação depende do aceite operacional, da homologação ZPT (planilha `zpt-5-v2` e conciliação com o "Exportar Tela" real), da migration `220` em produção, da prova do expurgo e da correção do alerta de troca de CE com Desbloqueio conferido (decisão pendente B1); caminho crítico no plano.

Planos concluídos, encerrados ou superados ficam no [índice dos planos arquivados](../archive/plans/README.md). As notas de estado que este índice acumulou até 2026-10-13 estão no [registro histórico](../archive/reports/2026-10-14-estado-planos-vivos-ate-2026-10-13.md); as anteriores, no [registro de 2026-09-18](../archive/reports/2026-09-18-notas-historicas-indice-planos.md).

## Ao concluir um plano

1. `git mv docs/plans/<plano>.md docs/archive/plans/`
2. Remover a linha da lista acima e acrescentar o plano, com estado e motivo, ao [índice dos planos arquivados](../archive/plans/README.md).
3. Se a spec originária estiver em `docs/spec/`, movê-la para `docs/archive/specs/`.
4. Registrar a entrega no [`../CHANGELOG.md`](../CHANGELOG.md).
5. Rodar `npm run docs:check`.
