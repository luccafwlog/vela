# 0083 — Decisões da revisão geral da documentação

Status: aceito — 2026-10-14 (decisões do dono). Implementada em 2026-10-14 pelo
[plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md)
(migrations `230` a `266`; a tabela "Execução" do plano liga cada item à sua
prova). Migration nova só vale em produção depois de publicada.

Responde às decisões pendentes A1–A25 e aos itens B28, B30 e B32 do
[plano da revisão geral](../archive/plans/2026-10-13-revisao-geral-documentacao.md)
e aprova como defeitos os demais itens do lote B. Supersede parcialmente as
ADRs [0015](./0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md),
[0034](./0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md),
[0051](./0051-cod-reprecifica-no-destino-final.md),
[0053](./0053-ciclo-de-vida-alerta-dispensa-temporaria.md),
[0063](./0063-configuracao-de-jobs-cron-no-vault.md),
[0071](./0071-ce-mercante-como-trava-de-exclusao.md),
[0075](./0075-fatura-avulsa-flexivel.md) e
[0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md) (item 19).

## Contexto

A revisão geral de 2026-10-13
([relatório](../archive/audits/2026-10-13-revisao-geral-documentacao.md))
confrontou cada documento com as ADRs, as migrations ativas e o código. Onde o
código divergia de uma decisão registrada (tipo b) ou os documentos se
contradiziam sem que o código resolvesse (tipo c), o item virou decisão do dono,
com caso prático, opções e recomendação. O dono respondeu todos em 2026-10-14.
A evidência dos casos é leitura estática de código e migrations; o que o plano
marcou como **Suspeita** não foi executado.

## Decisão

### Transversal e Administração

1. **Restituição é o termo** (A1). Devolver ao Cliente o que pagou a maior é
   Restituição, como as telas já mostram; "estorno" passa a ser sinônimo a
   evitar. Cancelar baixa continua sendo outra ação.
2. **Administrativo ativo mínimo** (A2). O banco recusa rebaixar de setor ou
   desativar o último Administrativo ativo, e a tela explica o motivo.
3. **Perfil interno não se exclui, nem pela API** (A3). O banco revoga a
   exclusão de perfil interno, como a migration `086` fez com documento fiscal;
   o usuário só é desativado ([ADR 0074](./0074-usuarios-retencao-e-backup-diario.md)).
4. **O hook protege só migrations existentes** (A4). Migration nova é permitida;
   migration destrutiva continua coberta por `npm run migrations:check`.
5. **Exceção ao cofre** (A5). As funções `SECURITY DEFINER` das migrations `218`
   e `219`, que disparam a Edge Function na importação e na cobrança Pix, podem
   ler o segredo do Vault além do job do `pg_cron`. A exposição aceita: a
   chamada com o segredo passa pela fila do `pg_net`. Supersede parcialmente a
   [ADR 0063](./0063-configuracao-de-jobs-cron-no-vault.md).
6. **Backup com heartbeat já** (A6). O backup diário ganha heartbeat no Better
   Stack, que avisa quando não roda, e vai para um executor sempre ligado antes
   de revogar o "Data status" do `AGENTS.md`.

### Viagens

7. **Escala com B/L não se exclui** (A7). O banco recusa, como a tela já faz:
   primeiro saem os B/Ls, depois a escala. Supersede parcialmente a
   [ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md) quanto à escala.
8. **Omissão revertida pode ser registrada de novo** (A8). A unicidade da
   omissão de escala vale só entre as não revertidas; a revertida fica no
   histórico.

### Faturamento e Taxas Locais

9. **Qualquer setor emite fatura avulsa** (A9). Todo usuário interno ativo
   pode gerar fatura avulsa, com motivo e rastro. Supersede parcialmente a
   [ADR 0075](./0075-fatura-avulsa-flexivel.md) quanto a quem emite.
10. **Caminho manual segue a vigência do automático** (A10). O lançamento manual
    e o "Item da tabela" da avulsa escolhem a tabela e a Condição de Cliente
    pela mesma regra do cálculo automático
    ([ADR 0040](./0040-vigencia-da-tabela-de-taxas-e-informativa.md)).
11. **COD segue a ADR 0077** (A11). A reemissão automática da fatura vale também
    para o COD; o Ajuste de COD registra o fato e é liquidado com a fatura
    sucessora, sem "Cancelar e reemitir". Supersede parcialmente a
    [ADR 0051](./0051-cod-reprecifica-no-destino-final.md).

### Demurrage

12. **Excedente de Invoice paga é tratado à mão** (A12). Quando a correção reduz
    uma Invoice de Demurrage já paga, o sistema suspende e alerta, e o
    Financeiro lança a Restituição. Vale enquanto Demurrage não tiver saldo nem
    pagamento parcial. Supersede parcialmente o item 19 da
    [ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md).
13. **E-mail da Régua mostra o USD líquido** (A13), coerente com o BRL e a tela.
14. **Só o job do BCB e o Informar PTAX gravam a referência cambial** (A14),
    como manda a decisão 4 da
    [ADR 0065](./0065-inbox-efeitos-e-autoridade-financeira.md).
15. **A Régua retoma ancorada no último envio** (A15). Depois de uma disputa,
    sai uma cobrança e as seguintes seguem o intervalo normal, sem rajada.

### Conciliação PIX

16. **O plano B pelo extrato acha Demurrage e avulsa** (A16), pelo TXID da
    cobrança.
17. **Pix de Demurrage sem TXID vira exceção** (A17). A baixa automática por CNPJ
    na janela das duas PTAX fica abandonada. Supersede parcialmente a
    [ADR 0015](./0015-demurrage-conciliacao-janela-duas-ptax-data-pagamento.md).

### Portal do Cliente e segurança

18. **Operações vê o console completo** (A18). Vale a
    [ADR 0045](./0045-inspecao-do-portal.md): o mascaramento do Email de
    Recuperação, da origem, da entrega e dos candidatos para Operações sai,
    porque a leitura interna é global
    ([ADR 0044](./0044-leitura-interna-global-departamento-restringe-escrita.md)).
19. **A exceção crítica de fatura entra no resumo das 08:00** (A19), junto com o
    sino e `/alertas`. O e-mail imediato não volta.
20. **O desenho de piloto e GO LIVE de julho é arquivado** (A20). A abertura do
    Portal terá formato novo, a definir quando for planejada.
21. **O caminho legado de contas do Portal sai** (A21). Saem as RPCs
    `upsert_customer_portal_account` e `set_customer_portal_account_active`, o
    job e a tabela de sessões antigas, e a escrita direta permitida pela policy
    `cpa_admin_all`. O "Data status" do `AGENTS.md` permite a remoção sem
    preservar linhas.
22. **O Comunicado de CE e Taxas aceita as duas caixas** (A22): Documentação e
    Operação, e Financeiro, como a
    [ADR 0064](./0064-caixas-de-comunicacao-e-auditoria-de-contatos.md) diz.
23. **Alerta fecha pela origem; conferência sem fato de origem se resolve com
    justificativa** (A23). Quando há fato verificável (o reenvio do Comunicado,
    por exemplo), o alerta fecha sozinho. Os tipos de conferência que não têm
    esse fato, como `portal_abuso_login`, ganham "Resolver com justificativa",
    com motivo obrigatório e registro no histórico. Supersede parcialmente a
    [ADR 0053](./0053-ciclo-de-vida-alerta-dispensa-temporaria.md).
24. **A audiência do alerta é o catálogo mais o setor do item** (A24), como
    `/alertas/regras` já mostra. Supersede parcialmente a
    [ADR 0034](./0034-notificacao-interna-separada-do-alerta-sino-entrega-alertas-trata.md).
25. **A reconsolidação pelo Portal continua sem alerta interno e vale para
    qualquer consolidada do Cliente** (A25), inclusive a emitida pela equipe
    interna. Confirma o comportamento atual da
    [ADR 0002](./0002-portal-self-service-reconsolidation.md).

### Lote B

26. **Os defeitos do lote B são corrigidos a favor da decisão registrada.** Cada
    um vira tarefa de código, por ordem de impacto, junto com o código das
    decisões acima. Escolhas dentro do lote:
    - B28: o diálogo "Vincular cliente ao grupo" passa a avisar que o e-mail do
      manifesto entra como contato; a captura protegida continua
      ([ADR 0064](./0064-caixas-de-comunicacao-e-auditoria-de-contatos.md)).
    - B30: o detalhe da Invoice de Demurrage no Portal mostra free time e valor
      por período de cada container.
    - B32: a Edge Function antiga de aviso de fatura emitida, que a
      [ADR 0058](./0058-canal-de-comunicado-ao-cliente.md) mandou apagar, é
      apagada em produção (autorizado pelo dono; a remoção é feita no painel
      ou na CLI do Supabase).

## Alternativas rejeitadas

As opções de cada item estão no plano arquivado da revisão. As rejeitadas em
que o dono contrariou a recomendação: e-mail imediato ou só sino até o GO LIVE
(A19, ficou o resumo das 08:00); plano vivo de GO LIVE (A20, ficou o
arquivamento); só Financeiro e Administrativo emitindo avulsa (A9, ficaram
todos os setores); alerta interno de reconsolidação e recusa de consolidada
emitida pela equipe interna (A25).

## Consequências

- Os módulos deixam de dizer "decisão pendente" nesses pontos e passam a
  descrever a regra decidida, com a divergência de código marcada como
  correção pendente até o plano de correções entregá-la.
- O glossário usa Restituição e "Administrativo ativo mínimo".
- A11, A12 e A17 confirmam ou simplificam o comportamento atual, então não
  pedem código além do ajuste de tela, texto e documentação.
- A21 remove objetos do banco; a migration correspondente declara que se apoia
  no "Data status" do `AGENTS.md`.
