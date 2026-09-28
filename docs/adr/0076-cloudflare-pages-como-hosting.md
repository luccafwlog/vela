# ADR 0076 — Cloudflare Pages como hosting do Vela e do Portal

- **Status:** aceito; execução registrada no plano de migração Cloudflare
- **Data:** 2026-09-28
- **Decide:** hospedar produção e previews das duas SPAs em Cloudflare Pages, publicados por GitHub Actions.

## Contexto

Os domínios `vela.app.br` e `portalfwlog.com.br` já apontam para os projetos
Cloudflare Pages `vela-internal` e `vela-portal`. Os projetos Vercel perderam
os domínios de produção e a conexão Git foi desligada. Ainda havia configuração
de roteamento, telemetria, CORS e build no repositório que mantinha dependência
operacional da Vercel.

## Decisão

1. Manter as duas entradas Vite e publicar os artefatos separados pelo workflow
   de produção e pelos workflows de preview do Cloudflare Pages.
2. Gerar `_headers` e `_redirects` no staging Pages; não manter `vercel.json`
   como fonte paralela de headers ou roteamento.
3. Remover as integrações de Analytics e Speed Insights exclusivas da Vercel.
   Sentry e PostHog mantêm a telemetria de erro e de produto já configurada.
4. Permitir em CORS os domínios de produção, localhost de desenvolvimento e
   previews dos dois projetos Pages. Origem adicional exige URL HTTPS exata.
5. Preservar a limpeza de `.map` e `.vite` como parte genérica de todo build.
   Os projetos Vercel permanecem sem conexão Git e podem servir apenas como
   opção de rollback manual depois de restaurar sua configuração.

## Consequências

- GitHub Actions e Cloudflare Pages são os únicos responsáveis pelos
  deployments frontend de rotina.
- A integração Supabase continua sendo responsável pelas branches de banco e
  migrations; o workflow Pages entrega as credenciais públicas correspondentes.
- Alterações em CSP devem atualizar o gerador `scripts/cloudflare-pages-stage.mjs`.
- Para voltar à Vercel, o responsável precisa restaurar configuração de build,
  reconectar o Git e executar cutover DNS; os deployments existentes não são
  considerados uma rota ativa de recuperação sem essa preparação.

## Relação com decisões anteriores

- Estende a [ADR 0066](./0066-transicao-marca-vela.md): identidades e entradas
  de Vela/Fwlog permanecem; o hosting passa a Cloudflare Pages.
- Supersede parcialmente a [ADR 0056](./0056-branching-automatico-supabase-vercel.md):
  permanece o branching automático do Supabase por PR, mas previews Vercel e a
  sincronização Supabase/Vercel deixam de fazer parte do deploy do frontend.
- Estende a [ADR 0010](./0010-validacao-testes-deploy-gates.md): CI continua
  validando PRs, e GitHub Actions publica Pages após os gates.
