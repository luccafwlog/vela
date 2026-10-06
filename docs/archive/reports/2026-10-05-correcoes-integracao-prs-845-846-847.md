# Correções de integração — PRs 845, 846 e 847

## Resultado e decisões

Ordem de merge: **846 → 845 → 847**. A 845 contém a 846 e tem sua branch como base; a 847 contém a 845 e tem sua branch como base. Após cada merge, conferir a base da dependente e retargetar para `main`. Sem force-push, merge remoto ou implantação em produção nesta execução.

- **846:** migration inédita 134 mantém recebível anterior arquivado/void e impede que a baixa anterior liquide a nova cobrança. Cobertura de troca de CNPJ com pagamento parcial/integral, nova baixa e retorno ao CNPJ anterior. Gate rejeita versões repetidas de migrations.
- **845:** migrations próprias 135/136, renomeadas com SQL idêntico; herda correções financeiras.
- **847:** migrations CE 137–146, renomeadas com SQL idêntico; nova 147 exige recebível `local_charges` do Cliente atual e bloqueia troca pendente. Excedente por redução não bloqueia CE indevidamente. O efeito financeiro comum invalida consultas CE. Ambas as funcionalidades permanecem em rotas, menus, caches e contratos de Inspeção.

Histórico de produção conferido em leitura: aplicado até 133. Migrations 001–133 preservadas. O preview da 845 já contém as antigas 134/135 de Informações.

## Verificação

- Vermelho confirmado antes das correções: duplicidade de versão, cache CE, pagamento antigo após troca de CNPJ e nova cobrança recusando sua própria baixa.
- 846: 3.848 testes gerais aprovados; suíte financeira final 46 aprovados; gates TypeScript/lint/build/docs/migrations/segurança aprovados. CI dd67453d aprovado.
- 845: 3.927 testes gerais e 41 testes SQL aprovados; gates aprovados. CI ae4f7a4c aprovado.
- Árvore integrada: 3.947 testes gerais aprovados, 378 condicionais ignorados; TypeScript/lint/build/docs/migrations/segurança aprovados. Replay limpo de 145 arquivos em PostgreSQL 16 descartável, invariantes de schema e catálogo de 224 RPCs aprovados.
- Gate de migrations: 19 cenários aprovados. QueryClient real: regressões de invalidação aprovadas. Revisão independente sem achados acionáveis.
- Fixture CE de cancelamento após troca de Cliente corrigida: pagamento anterior permanece histórico; elegibilidade retorna após liquidação própria do Cliente atual. Testes financeiros separados usam RPCs reais.

## Limites e Preview

SQL usa banco local descartável e shims; não comprova gateway, Auth/Storage remotos, transferência bancária nem procedimento externo ZPT. Permanecem os requisitos operacionais do plano CE.

Preview 845: erro de tabela já existente pelo histórico antigo 134/135; reconstrução exige reset e apaga dados exclusivos do preview. Confirmação solicitada ao usuário. Preview 846: Supabase pulado por ausência de branch associada; provisionamento/publicação recusam esse estado. Não alterar SQL para mascarar histórico incompatível. Produção preservada.

Resultados finais da bateria SQL e do CI integrado registrados após execução.
