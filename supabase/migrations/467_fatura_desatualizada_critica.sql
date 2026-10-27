-- 467: o alerta "Fatura desatualizada" passa a Crítico (reunião de testes de
-- 2026-10-26, decisão do dono de 2026-10-27;
-- docs/plans/2026-10-27-lote-da-reuniao-de-testes-de-26-10.md, bloco 2).
--
-- Problema:
--   `fatura_desatualizada` nasceu Normal (124). É a correção do B/L que o
--   sistema não conseguiu aplicar sozinho a uma fatura emitida: o Cliente
--   pode estar com a cobrança errada até o Administrativo tratar.
--
-- Mudança:
--   O catálogo passa a `critical`; `upsert_alert_item` (078) já grava a
--   gravidade do catálogo nos itens que abre ou atualiza. Os itens ativos
--   desse tipo passam a Crítico agora, como a 078 fez com a Revisão de Granito,
--   para a fila não misturar as duas gravidades no mesmo tipo. A cópia do app
--   (`src/services/alertRulesCatalog.ts`) muda junto.
--
-- Reescreve linhas existentes (`alert_items` ativos de `fatura_desatualizada`):
-- depende da afirmação "Data status" do AGENTS.md (o banco de produção só tem
-- dados de teste). Itens resolvidos e dispensados ficam como estavam.
--
-- Rollback: `UPDATE alert_type_catalog SET severity = 'normal'` e o mesmo nos
-- itens ativos do tipo.

UPDATE public.alert_type_catalog
   SET severity = 'critical'
 WHERE type = 'fatura_desatualizada';

UPDATE public.alert_items
   SET severity = 'critical',
       updated_at = now()
 WHERE item_type = 'fatura_desatualizada'
   AND status = 'active'
   AND severity IS DISTINCT FROM 'critical';
