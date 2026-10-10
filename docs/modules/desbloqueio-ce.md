# Desbloqueio de CE Mercante

> **Status:** publicado em produção (backend e Cloudflare Pages, conferido em 2026-10-10); compatibilidade frontend/backend, homologação e ativação pendentes · **Atualizado:** 2026-10-10 · **Rotas:** `/desbloqueio-ce`, `/portal/desbloqueio-ce`, `/clientes/portal/inspecao/:customerId/desbloqueio-ce`

## Propósito e escopo

A ZPT desbloqueia o CE Mercante sozinha quando as quatro colunas de uma carga
estão marcadas. O Vela substitui o controle manual dessas colunas: o cliente
solicita no Portal, o desk valida documentos e marca a entrega, e a planilha
exportada do Vela alimenta a ZPT. O sistema não chama API da ZPT.
Um pedido pode conter até 100 B/Ls do mesmo CNPJ. Termo de devolução e procuração
são comuns por pedido ou anuais de cliente VIP; a entrega física é registrada pelo desk.
Aprovação documental, exportação e conciliação são atos diferentes.

## Anatomia das telas

- Portal: abas Nova solicitação, Minhas solicitações e Documentos anuais (só VIP).
  Nova solicitação lista os quatro requisitos (com o modelo do termo para baixar) e uma
  tabela de BLs. Abaixo dos requisitos fica o memorando de liberação de documentos
  (`public/templates/memorando-liberacao-documentos-modelo.docx`), formulário para retirar
  documentos na agência; não é requisito nem entra no pedido. Selecionar e continuar
  cria o rascunho sem confirmação, pois o cliente pode cancelá-lo. A solicitação abre em modal: próximo passo do estado, prazo, documentos
  (anexar/substituir com o motivo da recusa à vista), requisitos por BL e histórico.
  O cliente cancela enquanto o pedido está em rascunho ou com correção solicitada.
  Com tudo atendido, "Documentação validada… consulte o Mercante". Não mostra envio,
  ZPT nem desbloqueio. Modo Inspeção é somente leitura (aviso global da inspeção).
- Vela, aba **Solicitações**: uma linha por pedido a validar (cliente, BLs, status do
  termo de devolução e da procuração, prazo). Cada documento é aprovado ou recusado
  para o pedido inteiro; recusa exige motivo. Pedidos VIP não passam por aqui.
- Vela, aba **Controle ZPT**: uma linha por B/L com CE, com ou sem pedido. T. de
  Devolução, Procuração e Financeiro são ícones somente leitura (verde = atendido);
  **BL de Entrega** é a única caixa clicável (confirmação ao marcar, motivo ao
  desmarcar), inclusive antes de existir pedido. Filtro padrão *Aptos — não exportados*.
  Coluna Prazo (vencido / vence hoje) e coluna ZPT (exportado, desbloqueado, divergente).
  Exporta até 100 aptos (seleção por linha ou dos aptos da página). No cabeçalho, em
  modais: **Modelo do termo de devolução** (DOCX oficial, sem texto jurídico gerado; o cliente
  baixa, preenche, assina e anexa em PDF),
  **Histórico ZPT** (baixar e reexportar lotes) e **Conciliar com a ZPT** (importa o
  "Exportar Tela").
- Clientes → ficha → Desbloqueio de CE / VIP: habilitar/revogar VIP, apresentar
  documentos anuais, aprovar vigência e renovar. Portal também permite apresentar
  anuais sem B/L/pagamento; somente o desk aprova.

## Regras de negócio

Os quatro requisitos são termo de devolução aprovado, procuração aprovada, taxas locais
integralmente liquidadas (Financeiro) e B/L original entregue (BL de Entrega). Selo VIP
não dispensa documento: exige termo e procuração anuais aprovados/vigentes para o mesmo
CNPJ. Validade até 31/12 do ano declarado, inclusive em America/Sao_Paulo; não renova
em janeiro. Reserva de upload sem PDF registrado não substitui a versão enviada nem
consome quota ativa após compensação/expurgo. Documento novo em análise não revoga o
anterior vigente; renovação pode ser aplicada aos pedidos pendentes pelo desk, com histórico.

Taxas locais usam recebíveis/settlements vigentes do Cliente atual, não status
isolado de fatura. Troca de CNPJ com devolução ou reemissão pendente bloqueia
solicitação e atos posteriores; o recebimento antigo permanece no histórico e
não financia o novo Cliente. A nova cobrança precisa de liquidação própria.
Restituição de excedente por redução normal do mesmo Cliente não bloqueia
aptidão quando o valor corrigido já está coberto. Pagamento
parcial, ausência de liquidação, nova obrigação de COD ou cancelamento de baixa
impedem aptidão. Demurrage/avulsas não fazem parte do requisito local. Correções para menor
reduzem o valor exigível: a liquidação cobre o valor original menos a correção,
com saldo zero e evidência real no ledger.
Cancelamento de B/L e correção do CE também exigem nova conferência.

**Conclusão.** A solicitação passa a *Documentação validada* quando todos os B/Ls
ativos têm os quatro requisitos; desfazer um requisito a reabre. Solicitação concluída
não pode mais ser cancelada (nem pelo desk). O aviso "documentação validada" sai só na
primeira conclusão. A conclusão é reavaliada nos comandos e, para liquidações feitas fora
do módulo, pela varredura `ce_unlock_refresh_open()` que o job `ce-unlock-notify-email`
executa a cada 5 minutos (ponytail: O(solicitações abertas); upgrade: fila por trigger).

**Prazo (SLA).** Começa no envio; só dias úteis, sem feriados. Antes das 12:00 vence às
17:00 do mesmo dia; a partir das 12:00, às 12:30 do próximo dia útil; sábado/domingo
vencem segunda às 12:00. Recomeça com a pendência do cliente resolvida
(reenvio, entrega do original, nova liquidação); aprovar documento não recomeça.
Calculado na tela (`ceUnlockSla.ts`) e no banco (`ce_unlock_private.sla_deadline`,
usado no texto do aviso); o teste SQL confere os dois com os mesmos casos. O
cumprimento é medido pela data da exportação.

**Avisos ao cliente.** Recusa de documento (com o motivo) e documentação validada (com o
prazo) geram um aviso no sino do Portal e uma linha na fila `ce_unlock_email_outbox`; a
Edge Function `ce-unlock-notify-email` envia aos contatos da caixa **Documentação e
Operação**, respeitando a chave global de Comunicados, supressão e bounce, e registra a tentativa
em `portal_email_attempts`. Nenhum texto cita ZPT ou desbloqueio confirmado. O Portal mostra
só a data do prazo (nunca "vencido"), e seu histórico omite exportação, entrega e VIP.

**Envio e conciliação.** Só entram na planilha B/Ls com os quatro requisitos. O layout
`zpt-5-v2` usa os cabeçalhos do "Exportar Tela" da ZPT (`BL`, `Financeiro`,
`Term. Devolucao`, `Procuracao`, `BL Entrega`; Sim/Não). **Exportar registra o envio**
(data e usuário por B/L); lotes antigos `zpt-5-v1` mantêm seu layout. Importar o
.xls da ZPT concilia por CE (ignora zeros à esquerda): *Desbloqueado* vira
*Desbloqueio conferido* (mesmo sem exportação pelo Vela); exportado e ainda bloqueado
vira *Divergente* com status, descrição e colunas em "Não"; bloqueado e nunca exportado
é ignorado. O Vela guarda status, descrição, data e colunas em "Não"; nunca o CPF/nome do
operador da ZPT. A conciliação não altera o prazo nem o que o Portal mostra.

## Catálogo de ações

| Ação | Dono | Efeito |
|---|---|---|
| Preparar/enviar pedido, corrigir anexos | Portal do próprio CNPJ | Reserva e envio atômico, requisitos financeiros revalidados |
| Cancelar pedido (rascunho ou correção solicitada) | Portal do próprio CNPJ | Libera os B/Ls; motivo padrão "Cancelado pelo cliente" |
| Aprovar/recusar termo de devolução e procuração | Administrativo/Documentação | Vale para o pedido inteiro; recusa exige motivo e avisa o cliente |
| Marcar/desmarcar BL de Entrega, VIP, reconferir CE, cancelar | Administrativo/Documentação | Transições auditadas com versão e confirmação |
| Consultar requisitos | Também Financeiro/Operações | Sem anexos sensíveis nem escrita |
| Exportar aptos | Administrativo/Documentação | XLSX `zpt-5-v2`; registra o envio por B/L |
| Conciliar com a ZPT | Administrativo/Documentação | Importa o "Exportar Tela"; resultado só no Vela |

## Persistência e segurança

Migrations `137`–`149`, `160`, `161` e `173`: tabelas `ce_unlock_*`, schema privado de helpers/receipts,
RLS sem acesso direto do navegador e RPCs com escopo server-side. A `160` acrescenta
`exported_at/exported_by/export_id` em `ce_unlock_request_bls`, `ce_unlock_zpt_status`
(conciliação) e `ce_unlock_email_outbox`. A `173` faz o modelo publicado pelo desk ser
`.docx` (nome, assinatura ZIP e tipo no Storage); termo, procuração e anuais seguem só PDF. Escritas
cliente/internal usam dispatchers distintos com allowlists (Portal: `draft`, `submit`,
`cancel`); retries compartilham chave idempotente e recusam alteração de payload.
`ce_unlock_reconcile` é função própria (sem receipts: o payload é grande e a operação é
idempotente) e só aceita escrita interna. Campos de envio/ZPT são removidos das
projeções do Portal (`ce_unlock_private.portal_view`). Inspeção tem wrappers de leitura.
As ações `sent` e `confirm` foram removidas; confirmações externas antigas permanecem
como histórico do desk.

Bucket privado `ce-unlock-documents`. Upload pela Edge Function valida sessão,
PDF/MIME/assinatura, 10 MiB, 20 uploads/24h e 100 MiB ativos por cliente. Download
exige autorização atual e URL assinada por 60 s. Documentos são versionados.
Funções: `portal-ce-unlock-document`, `ce-unlock-document-download`,
`ce-unlock-export`, `ce-unlock-cleanup`, `ce-unlock-notify-email`; config e operação no
[manual externo](../operations/servicos-externos.md).

## Validação e operação

Testes SQL reais: `src/integration/ceUnlock.local-pg.test.ts` (inclui cancelamento pelo
cliente, fila de Solicitações, paridade do prazo SQL×tela, conciliação e fila de e-mail);
regras VIP/ZPT, prazo, leitura do arquivo da ZPT e e-mail em `src/services/__tests__/ceUnlock*.test.ts`;
o handler de upload é exercitado em Deno por `supabase/functions/portal-ce-unlock-document/index.test.ts`;
componentes e Portal em seus harnesses existentes. Postgres local usa shims de Auth/Storage/cron,
que não comprovam o gateway Supabase nem o envio real de e-mail. **Não comprovado:** aceite da
planilha `zpt-5-v2` pela aba "Planilha desbloqueio" da ZPT (sem modelo oficial de importação; o
primeiro upload real é o teste) e entrega real dos avisos por e-mail.

O expurgo reivindica/fixa os registros no banco antes de apagar objetos;
rascunho expirado é cancelado sob lock, e falha física permite retry.
O modelo atual e anuais vigentes não são expurgados por mera idade.

Expurgo usa Storage API: uploads abandonados após 1 dia, rascunhos após 7 dias,
registros documentais inativos após 5 anos, preservando metadados e histórico.
Não excluir anuais só por não terem pedido. Os jobs `ce-unlock-cleanup` e
`ce-unlock-notify-email` não são criados pela migration; configurar o segredo no
Vault/Edge Functions e então agendá-los como passo operacional
([segredos e cron](../operations/segredos-cron.md)).

Evidência da execução original e limitações estão no
[relatório local](../archive/reports/2026-10-04-desbloqueio-ce-implementacao.md); a revisão de
2026-10-07 segue [spec](../archive/specs/2026-10-07-desbloqueio-ce-revisao-fluxo-design.md) e
[plano](../archive/plans/2026-10-07-desbloqueio-ce-revisao-fluxo.md). A fila calcula os requisitos
dos candidatos antes de paginar; custo O(n), indicado como `ponytail` no serviço. Avaliar read
model indexado com aumento do volume operacional.

### Robustez de finalização

Após mudança de Cliente do BL, o pedido anterior perde aplicabilidade; seu
cancelamento libera uma nova solicitação para o Cliente atual, sem expor
histórico privado. Falha na resposta de finalização do upload não remove PDF
já registrado; compensação e expurgo reivindicam o documento no banco antes
da remoção. O logout do Portal remove seu cache privado de CE.

Ações financeiras de baixa, cancelamento, restituição e retry invalidam também
as consultas de CE no mesmo cliente de cache; os comandos revalidam no banco.
