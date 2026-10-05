# Desbloqueio de CE Mercante

> **Status:** implementado no checkout, publicação pendente · **Atualizado:** 2026-10-05 · **Rotas:** `/desbloqueio-ce`, `/portal/desbloqueio-ce`, `/clientes/portal/inspecao/:customerId/desbloqueio-ce`

## Propósito e escopo

Importação → Desbloqueio de CE reúne B/Ls com CE, com ou sem solicitação.
O cliente solicita no Portal após liquidação integral das taxas locais. Um
pedido pode conter até 100 B/Ls do mesmo CNPJ. Termo e procuração são comuns por
pedido ou anuais de cliente VIP; a entrega física é registrada pelo desk.
Aprovação documental, exportação, registro de envio e confirmação externa são
atos diferentes. O sistema não chama API da ZPT para liberar a carga.

## Anatomia das telas

- Portal: Solicitar desbloqueio, Minhas solicitações e Documentos anuais para VIP.
  Selecionar BLs prepara um rascunho; anexar PDFs e confirmar envia o pedido.
  Correção solicitada permite nova versão. Modo Inspeção permanece somente leitura.
- Vela: tabela por B/L, filtros e requisitos; registrar/reverter entrega, abrir
  protocolo e selecionar B/Ls para análise documental. Pagamento é somente leitura.
  Modelo do termo permite cadastrar PDF oficial, sem gerar texto jurídico.
- Clientes → ficha → Desbloqueio de CE / VIP: habilitar/revogar VIP, apresentar
  documentos anuais, aprovar vigência e renovar. Portal também permite apresentar
  anuais sem B/L/pagamento; somente o desk aprova.
- Histórico ZPT: baixar lote preservado e registrar envio externo. Confirmar
  desbloqueio é feito no protocolo por B/L e exige CE atual e referência externa.
  O desk consulta data/CE/referência na seção Confirmações externas do detalhe;
  essas referências internas não são projetadas ao Portal nem às leituras resumidas.

## Regras de negócio

Os quatro requisitos são termo aprovado, procuração aprovada, taxas locais
integralmente liquidadas e B/L original entregue. Selo VIP não dispensa documento:
exige termo e procuração anuais aprovados/vigentes para o mesmo CNPJ. Validade
até 31/12 do ano declarado, inclusive em America/Sao_Paulo; não renova em janeiro.
Documento novo em análise não revoga o anterior vigente; renovação pode ser
aplicada aos pedidos pendentes pelo desk, com histórico.

Taxas locais usam recebíveis/settlements, não status isolado de fatura. Pagamento
parcial, ausência de liquidação, nova obrigação de COD ou cancelamento de baixa
impedem aptidão. Demurrage/avulsas não fazem parte do requisito local.
Cancelamento de B/L e correção do CE também exigem nova conferência. Histórico
externo confirmado não é apagado por mudança financeira posterior.

## Catálogo de ações

| Ação | Dono | Efeito |
|---|---|---|
| Preparar/enviar pedido, corrigir anexos | Portal do próprio CNPJ | Reserva e envio atômico, requisitos financeiros revalidados |
| Aprovar/corrigir documentos, entrega/reversão, VIP | Administrativo/Documentação | Transições auditadas com versão e confirmação |
| Consultar requisitos | Também Financeiro/Operações | Sem anexos sensíveis nem escrita |
| Exportar aptos | Administrativo/Documentação | XLSX com BL, Termo, Procuração, Entrega de BL, Pagamento das taxas; Sim/Não |
| Confirmar desbloqueio | Administrativo/Documentação | Por B/L/CE, com referência externa; só conclui pedido se todos confirmados |

## Persistência e segurança

Migrations `134`–`141`: tabelas `ce_unlock_*`, schema privado de helpers/receipts,
RLS sem acesso direto do navegador e RPCs com escopo server-side. Escritas
cliente/internal usam dispatchers distintos com allowlists; retries compartilham
chave idempotente e recusam alteração de payload. Inspeção tem wrappers de leitura.

Bucket privado `ce-unlock-documents`. Upload pela Edge Function valida sessão,
PDF/MIME/assinatura, 10 MiB, 20 uploads/24h e 100 MiB ativos por cliente. Download
exige autorização atual e URL assinada por 60 s. Documentos são versionados.
Funções: `portal-ce-unlock-document`, `ce-unlock-document-download`,
`ce-unlock-export`, `ce-unlock-cleanup`; config e operação no
[manual externo](../operations/servicos-externos.md).

## Validação e operação

Testes SQL reais: `src/integration/ceUnlock.local-pg.test.ts`; regras VIP/ZPT e
PDF em `src/services/__tests__/ceUnlock*.test.ts`; componentes e Portal em seus
harnesses existentes. Postgres local usa shims de Auth/Storage/cron, que não
comprovam o gateway Supabase nem envio ZPT. Publicação e arquivo ZPT em operação
real precisam de validação no ambiente autorizado.

O expurgo reivindica/fixa os registros no banco antes de apagar objetos;
rascunho expirado é cancelado sob lock, e falha física permite retry.
O modelo atual e anuais vigentes não são expurgados por mera idade.

Expurgo usa Storage API: uploads abandonados após 1 dia, rascunhos após 7 dias,
registros documentais inativos após 5 anos, preservando metadados e histórico.
Não excluir anuais só por não terem pedido. Job `ce-unlock-cleanup` nasce
inativo; configurar seu segredo no Vault/Edge Functions antes de ativar.

Evidência da execução e limitações estão no
[relatório local](../archive/reports/2026-10-04-desbloqueio-ce-implementacao.md).
A fila calcula os requisitos dos candidatos antes de paginar; custo O(n),
indicado como `ponytail` no serviço. Avaliar read model indexado com aumento
do volume operacional.

### Robustez de finalização

Após mudança de Cliente do BL, o pedido anterior perde aplicabilidade; seu
cancelamento libera uma nova solicitação para o Cliente atual, sem expor
histórico privado. Falha na resposta de finalização do upload não remove PDF
já registrado; compensação e expurgo reivindicam o documento no banco antes
da remoção. O logout do Portal remove seu cache privado de CE.
