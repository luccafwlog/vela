# ADR 0064 — Caixas de comunicação, salvamento atômico e auditoria de contatos

> **Implementação conferida em 2026-09-18 (Código):** 008/010 implementam caixas e roteamento; 032/038/039 refinam estados de entrega, 045/062 a produção automática.

Status: aceito — 2026-09-03

## Contexto

Antes desta decisão, o roteamento de comunicados aos clientes e o cadastro de
contatos dependiam de dois mecanismos legados:

1. A coluna `purpose` em `customer_contacts` ('geral', 'operacional', 'financeiro', 'faturamento'),
   usada de forma inconsistente por diferentes fluxos de importação e telas;
2. A tabela `customer_contact_preferences` com quatro naturezas rígidas
   (`avisos_gerais`, `avisos_operacionais`, `documentacao`, `demurrage`), com chaves
   por contato geradas por triggers e consultas sem garantia transacional de completude.

Além disso, edições de contatos na interface interna e no Portal do Cliente eram
feitas por operações `INSERT`/`UPDATE`/`DELETE` soltas, sem snapshot de estado
anterior/posterior e sem garantia de que exatamente um contato principal estivesse
ativo. Contatos excluídos fisicamente quebravam a rastreabilidade de comunicados já
despachados ou tentativas registradas.

Quando um B/L novo trazia dados de contato no manifesto ou na confirmação de
faturamento, a inserção ocorria pontualmente, correndo o risco de sobrescrever
dados válidos ou cadastrar endereços sem vinculação a qualquer categoria de envio.

## Decisão

1. **Catálogo de 3 Caixas de Comunicação:**
   O roteamento passa a ser estruturado em torno de três caixas oficiais
   armazenadas na tabela `customer_communication_boxes`:
   - `documentacao_operacao`: CE e Taxas, NOA, NOR e NOB;
   - `financeiro`: CE e Taxas e Cobranças de Demurrage;
   - `demurrage`: Cobranças de Demurrage e futuros comunicados de Demurrage.

   A tabela `customer_communication_box_kinds` mapeia os modelos (`kind`) de
   comunicado permitidos para cada caixa. A tabela é extensível para novos
   modelos sem alteração estrutural no código da aplicação.

2. **Vínculo M:N entre Contatos e Caixas (`customer_contact_box_links`):**
   Cada contato do cliente pode estar vinculado a zero, uma ou mais caixas.
   Um endereço normalizado não recebe comunicados de uma caixa a menos que
   possua vínculo explícito com ela.

3. **Salvamento Atômico por Snapshot (`_apply_customer_contact_configuration`):**
   Toda alteração nos contatos do cliente (seja via tela interna de Ficha,
   Portal do Cliente, importação de B/L ou rotina de sistema) converge para a
   função privada `_apply_customer_contact_configuration`.
   - Adquire bloqueio pessimista do cliente com `FOR UPDATE`;
   - Valida regras cadastrais: exatamente um contato principal ativo, e-mail
     válido obrigatório no principal, unicidade de e-mail normalizado entre
     contatos ativos do mesmo cliente;
   - Aplica modificações em lote (upsert, ativação, desativação, vinculação de caixas);
   - Gera um evento agrupado de alteração atômica.

4. **Desativação Lógica (`deactivated_at`):**
   Contatos não são mais deletados fisicamente do banco de dados. Exclusões na UI
   marcam `deactivated_at = now()`. Contatos desativados **preservam seus vínculos**
   com caixas para histórico e são ignorados em todas as conferências e disparos
   de comunicados, mas preservam integridade de tentativas passadas. A unicidade
   de e-mail é **inclusiva contra registros inativos** (o índice não filtra
   `deactivated_at`): reutilizar o e-mail de um contato inativo é rejeitado com
   mensagem identificando o contato existente.

5. **Trilha de Auditoria Agrupada (`customer_contact_change_events`):**
   Cada operação de alteração de contatos grava uma linha append-only em
   `customer_contact_change_events`, identificada por `action_id` (UUID único da
   transação), registrando a fonte (`portal`, `interno`, `bl_automatico`, `sistema`),
   o autor, snapshots completos em JSON (`before_snapshot`, `after_snapshot`) e
   o resumo das modificações (`change_summary`).

6. **Auto-captura e Proteção de Sobrescrita (`ensure_customer_contact_email`):**
   A captura automática de contatos a partir de manifestos ou B/Ls reutiliza
   contatos existentes com o mesmo e-mail (**sem reativar desativados e sem
   alterar caixas existentes**), adiciona a caixa `documentacao_operacao` (e as
   três caixas quando o contato capturado é o primeiro principal), mas **nunca**
   sobrescreve o nome ou telefone do contato caso já existam no cadastro,
   preservando os dados cadastrados pelos operadores ou pelo cliente. Quando o
   e-mail reaparece para um cliente sem principal ativo, registra o alerta
   `cliente_sem_contato_principal` para triagem humana.

7. **Fallback e Reparo por Disponibilidade (`repair_customer_contact_box_fallbacks`):**
   Se um contato em bounce permanente ou desativação deixa uma caixa sem nenhum
   destinatário ativo, a rotina `repair_customer_contact_box_fallbacks` vincula o
   contato principal ativo àquela caixa como fallback para evitar que o cliente
   fique sem cobertura de comunicados operacionais ou financeiros.

8. **Roteamento Determinístico e Pré-validação de Destinatários:**
   O front-end e os disparadores resolvem destinatários elegíveis e excluídos
   (por supressão, desativação ou ausência de cobertura de caixa) através de
   regras determinísticas (`resolveCustomerCommunicationRecipientsByBoxes`).
   A conferência de envio compara elegibilidade por caixa no momento do disparo
   (`customer_communication_recipient_allowed` + checagem de supressão na Edge
   Function `send-customer-communication`); não há snapshot cruzado
   tela-vs-disparo — a trilha `customer_communications` + tentativas é a fonte
   de auditoria do que foi enviado.

9. **Compatibilidade e Transição Segura:**
   A coluna `purpose` em `customer_contacts` e a tabela `customer_contact_preferences`
   permanecem no banco de dados para segurança de rollback, mas nenhuma consulta de
   produção da aplicação lê mais essas estruturas. O trigger legado
   `trg_seed_customer_contact_preferences` foi desativado em favor da nova
   infraestrutura de caixas.

## Consequências

- Roteamento transparente e previsível para todas as categorias de comunicado.
- Fim das inconsistências de preferências de contatos e eliminação de condições de corrida.
- Rastreabilidade total de quem alterou o contato (equipe interna, portal do cliente ou captura de B/L) na Linha do Tempo do cliente.
- Resiliência contra caixas vazias através de fallbacks automatizados.
