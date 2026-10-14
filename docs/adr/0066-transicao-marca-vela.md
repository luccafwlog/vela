# ADR 0066 — Transição de marca e separação das superfícies de entrega

> **Situação atual (2026-10-13).** As três identidades (Vela no interno, Fwlog no Portal, Transhipping no jurídico e no financeiro) e as duas entradas Vite continuam valendo.
> Não valem mais o item 5 e as consequências sobre os dois projetos Vercel e seus Previews: pela [ADR 0076](./0076-cloudflare-pages-como-hosting.md), Vela e Portal são publicados no Cloudflare Pages (`vela-internal` e `vela-portal`) por GitHub Actions, e os projetos Vercel ficam sem conexão Git, só como opção de rollback manual; a relação com a ADR 0010 "quanto à publicação pela Vercel" também ficou superada.
> A [ADR 0081](./0081-identidade-visual-unica.md) estende a separação de marcas com a identidade visual única do Vela e do Portal Fwlog; as regras de aparência estão em [identidade-visual.md](../identidade-visual.md).
> Regra vigente em [Deploy](../setup/deploy.md), seções "Builds e artefatos" e "Workflows", e em [Serviços externos](../operations/servicos-externos.md), seção "Hospedagem do front-end".

Status: supersedida parcialmente — 2026-09-12

## Contexto

O repositório atende três identidades que não podem ser tratadas como uma
única marca:

- **Vela** é o produto interno usado pela equipe;
- **Fwlog** é a superfície de atendimento e consulta do cliente;
- **Transhipping** é a entidade jurídica e financeira que aparece no CNPJ,
  PIX, invoices, recibos e histórico operacional.

Antes desta decisão, o frontend interno e o Portal eram duas árvores de rota
dentro do mesmo artefato Vite. Isso permitia que uma alteração de identidade
do produto interno alcançasse, por engano, páginas do Portal, templates de
email ou documentos fiscais.

## Decisão

1. A superfície interna passa a se chamar **Vela** e é publicada em
   `https://vela.app.br`.
2. A superfície externa permanece **Fwlog** e é publicada em
   `https://portalfwlog.com.br`. Nenhuma string, logo ou título de Vela deve
   alcançar essa superfície.
3. `Transhipping Agenciamento Marítimo Ltda.` permanece como identidade
   jurídica e financeira. Não se alteram `pixMerchantName`, beneficiário PIX,
   CNPJ, conteúdo fiscal, nomes de remetente do Portal, dados de cobrança,
   histórico ou migrations aplicadas.
4. A base de código continua única, mas entrega dois programas estáticos:
   `index.html` + `src/main.tsx` + `src/AppInterno.tsx` para Vela e
   `portal.html` + `src/portal-main.tsx` + `src/AppPortal.tsx` para Fwlog.
   Serviços, tipos, cliente Supabase e componentes de domínio neutros são
   compartilhados; cada entrada usa somente o provedor de autenticação da sua
   superfície.
5. O projeto Vercel interno (`vela`) e o projeto do Portal (`fwlog-portal`)
   apontam para o mesmo repositório e publicam seus respectivos artefatos,
   com Previews independentes ligados à branch Supabase correspondente.
6. Os assets de identidade visual do Vela são arquivos novos em
   `public/branding/`, entregues pela PR 689. O app interno usa os símbolos e
   ícones Vela; os assets existentes de Fwlog e Transhipping permanecem sem
   substituição.

## Consequências

- O nome do produto interno pode evoluir sem depender da sessão do Portal.
- O isolamento entre os builds torna a fronteira Vela/Fwlog verificável pelo
  artefato, além do teste de conteúdo que cobre emails e documentos fiscais.
- Existem dois projetos Vercel, dois ciclos de Preview e dois conjuntos de
  configurações de domínio; a integração de branching precisa ser conferida
  nos dois.
- A allowlist de CORS precisa aceitar os dois domínios de produção e os dois
  padrões de alias de Preview, sem wildcard amplo.
- Os assets novos ficam isolados em `public/branding/`; isso permite publicar
  Vela sem alterar os logos usados por Fwlog, faturas, recibos ou e-mails.

## Relação com decisões anteriores

- Estende a [ADR 0003](./0003-spa-react-rotas-lazy-camadas-page-hook-service.md)
  quanto à existência de duas entradas e dois mapas de rota sobre a mesma base.
- Atualiza a [ADR 0010](./0010-validacao-testes-deploy-gates.md) quanto à
  publicação pela Vercel em vez de Firebase Hosting.
- Estende a [ADR 0056](./0056-branching-automatico-supabase-vercel.md) para
  conectar os dois projetos Vercel às branches Supabase.
- Não altera as decisões de viagens da ADR 0012, de Demurrage da ADR 0014, de
  grants da ADR 0047 ou de consolidação histórica da ADR 0062.
