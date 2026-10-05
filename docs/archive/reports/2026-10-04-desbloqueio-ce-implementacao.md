# Entrega local — Desbloqueio de CE Mercante

Data: 2026-10-05. Escopo: Issue 557 e refinamentos do usuário. Implementação
executada mediante autorização explícita; **sem publicação remota**.
[Módulo vivo](../../modules/desbloqueio-ce.md),
[plano](../../plans/2026-10-04-desbloqueio-ce-mercante.md),
[spec](../../spec/2026-10-04-desbloqueio-ce-mercante-design.md).

## Resultado funcional

- Vela em Importação → Desbloqueio de CE: BLs com CE, requisitos por item,
  protocolo/data, filtros, análise documental, entrega/reversão e histórico.
  Pagamento deriva dos recebíveis/liquidações; não é marcado manualmente.
- Portal: seleção de BLs pagos, rascunho, modelo oficial disponível quando
  cadastrado, PDFs comuns por pedido, envio e correção/reenvio, histórico;
  inspeção somente leitura. Botão de envio desabilitado sem documentos/pagamento.
- VIP: configuração por CNPJ na ficha, apresentação anual no Portal ou Vela,
  análise/vigência até 31/12; documento aprovado tem período imutável. Renovação
  exige documento novo; aplicação aos itens pendentes é explícita.
- ZPT: XLSX de cinco colunas, requisitos Sim/Não, snapshot e histórico de lotes,
  download preservado, reexportação com referência anterior, registro de envio
  e confirmação externa por BL/CE independentes. Não há chamada de API ZPT.
- PDFs privados: autorização atual, limite de arquivo/corpo, quota, registro
  vinculado ao objeto, URL assinada curta, expurgo com reivindicação no banco.
  Agenda inicialmente inativa até configuração no ambiente autorizado.

## Evidência local

- PostgreSQL 16 descartável em `/tmp`: replay de todas as migrations do
  diretório ativo em banco novo, com shims exatos do repositório para
  Auth/Storage/cron/Vault/net; migrations novas `134`–`142` aplicadas.
- 21 testes SQL reais passaram: CNPJ, papéis, pagamento parcial, VIP/prazo,
  versões/correção, documento substituído, alteração do Cliente, expurgo,
  concorrência de reversão/cancelamento, confirmação individual e CE divergente.
- Suíte completa, checks de documentação, tipos, lint, build, migrations e
  catálogo RPC executados; contagens finais registradas na conclusão abaixo.
- Quatro Edge Functions passaram em `deno check`. A função de exportação foi
  também executada em Deno, autenticando pelo shim HTTP local e lendo o banco
  real; arquivo foi reaberto e conferido quanto a cabeçalhos/ordem/indicadores.
  [Amostra fictícia](../../../test-fixtures/ce-unlock/zpt-five-columns-example.xlsx).
- Navegador Chrome via agent-browser: login de fixture, fila interna, Portal
  somente com BLs do CNPJ, seleção de BL pago, confirmação/criação de rascunho,
  dois campos de PDF e envio bloqueado sem anexos; confirmação interna por BL/CE
  com referência fictícia e evidência visível; não houve overlay de erro.
  No Portal, a sessão de fixture foi preparada pelo endpoint Auth local;
  o formulário de login por CNPJ não integra essa evidência.
  Portal mobile verificado em 390 px, sem overflow horizontal ou overlay.
  Dados são locais; o shim não equivale ao gateway Supabase em produção.

## Revisão independente e regressões

Um revisor independente examinou o conjunto. Seis achados importantes foram
corrigidos em um passe: aprovação da versão exata submetida; não reutilizar
PDF superado no reenvio; negar aplicabilidade/dados vivos após troca de Cliente;
reivindicar expurgo antes da remoção física; vigência anual imutável; locks e
revalidação no envio/confirmar. Testes falharam contra as funções anteriores e
passaram contra a correção. Testes de concorrência usam duas sessões SQL reais.
O autor verificou ainda importação Deno em execução, RLS e contrato de abas.
Regressões adicionais cobrem revogação anual simultânea ao envio e reenvio
parcial sem reescrever documentos de BLs confirmados, mesmo após reversão
financeira desses itens. Projeções de leitura separam evidência externa do desk
e metadados do cliente anterior após reatribuição de BL. A seleção pode remover
itens que perderam elegibilidade; os serviços preservam o motivo do servidor
e recarregam requisitos após falha de comando. O logout remove também o cache
CE privado do Portal. Após cancelamento do pedido anterior, o Cliente atual
pode criar novo pedido; o histórico anterior continua isolado. A compensação
de falha de upload reivindica apenas documentos ainda pendentes, preservando
um PDF registrado quando a confirmação HTTP se perde.

Pendências menores da revisão: UI interna exibe versões comuns atuais, embora
anteriores persistam; hash de lote permanece sem preenchimento. Snapshot e
histórico de lotes são preservados. Custo da listagem O(n) antes de paginação
está indicado no serviço; futura escala pede read model indexado.

## Decisões de execução

- Usar checkout isolado existente, branch `work`, preservando planejamento:
  evita deslocar o workspace do app; custo é manter as alterações nessa branch.
- Executar defaults autorizados de entrega/papéis/retenção/Sim-Não; não criar
  campo CS distinto do CE; PDF jurídico fornecido pelo desk, sem texto inventado.
  Custo: eventual mudança operacional pede ajuste, não edição jurídica automática.
- Tipos de domínio e facade próprios, preservando `database.ts` e migrations
  anteriores protegidos. Custo: novos contratos não entram no tipo gerado até
  futura regeneração autorizada.
- Manter ledger manual porque scripts da skill não estão no filesystem.
  Custo: evidência registrada manualmente, sem automação desses scripts.
- Dispatchers de comandos com allowlists no servidor substituem várias RPCs
  individuais propostas; locking/idempotência/autorização compartilham um dono.
  Custo: nomes dos contratos diferem do plano inicial, mapas atualizados juntos.
- PostgreSQL/psql/Deno/browser obtidos em `/tmp` quando ausentes; nenhuma
  dependência de produto adicionada nem mutação em ambiente remoto.
  Custo: shims locais não provam os serviços gerenciados reais.
- Validar fluxo por SQL executado/UI/runtime, em vez de duplicar cada contrato
  em testes textuais de migration. Custo: os cenários adicionais do plano e
  homologação externa continuam identificados sem alegação de terem sido testados.
- Preservar branch local; integração/publicação exigem uma instrução para o
  ambiente escolhido. Custo: funcionalidade ainda não está disponível no remoto.

## Pendências externas

Publicar backend → Edge Functions → Vela/Portal e validar Preview/gateway/
Storage real; cadastrar PDF oficial e configurar segredo/agendamento de expurgo;
homologar a amostra com responsável/ZPT. Plano/spec permanecem ativos por esse
aceite. Nenhuma issue foi fechada e nenhum desbloqueio/envio externo foi efetuado.

## Conclusão da verificação

Em 2026-10-05, a execução final passou: 693 arquivos / 3.858 testes na suíte
completa (52 arquivos / 313 cenários ignorados por suas condições de execução),
mais os 21 cenários SQL reais executados explicitamente em banco novo.
Passaram `docs:check`, `typecheck`, `lint`, `build`, `migrations:check` e
`rpc:check` (216 RPCs de produção resolvidas). Todos os 140 arquivos de migration
ativos foram reaplicados no banco descartável; as quatro novas funções Edge
passaram em `deno check`. Arquivos protegidos e dependências de produto preservados.
Entrega na branch local `work`, sem push, PR, publicação ou operação externa.
