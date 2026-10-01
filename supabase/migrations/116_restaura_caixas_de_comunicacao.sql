-- Migration 116: restaura o catálogo de caixas de comunicação.
--
-- Em produção, customer_communication_boxes e customer_communication_box_kinds
-- foram encontradas vazias (2026-10-01). Esse catálogo é semeado pela 008 e
-- não é dado operacional. Sem ele, o trigger seed_customer_contact_box_links
-- falha com FK 23503 ao criar um contato e a importação de B/L que captura o
-- e-mail do consignatário (capture_manifest_financial_contact) é recusada
-- inteira (HTTP 409). Repete os valores da 008 e o backfill dos vínculos de
-- contatos. Só insere (ON CONFLICT DO NOTHING); não altera nem apaga linhas.

INSERT INTO public.customer_communication_boxes (code, label, description, sort_order)
VALUES
  ('documentacao_operacao', 'Documentação e Operação', 'CE e Taxas, NOA, NOR e NOB.', 1),
  ('financeiro', 'Financeiro', 'CE e Taxas e Cobranças de Demurrage.', 2),
  ('demurrage', 'Demurrage', 'Cobranças de Demurrage e futuros comunicados de Demurrage.', 3)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.customer_communication_box_kinds (box_code, kind)
VALUES
  ('documentacao_operacao', 'aviso_chegada_noa'),
  ('documentacao_operacao', 'aviso_prontidao_nor'),
  ('documentacao_operacao', 'aviso_atracacao_nob'),
  ('documentacao_operacao', 'ce_mercante_taxas'),
  ('financeiro', 'ce_mercante_taxas'),
  ('financeiro', 'cobranca_demurrage'),
  ('demurrage', 'cobranca_demurrage')
ON CONFLICT DO NOTHING;

-- Contatos principais ativos com e-mail recebem todas as caixas.
INSERT INTO public.customer_contact_box_links (contact_id, box_code)
SELECT cc.id, ccb.code
FROM public.customer_contacts cc
CROSS JOIN public.customer_communication_boxes ccb
WHERE cc.is_primary = true AND cc.deactivated_at IS NULL
  AND cc.email_normalized IS NOT NULL
ON CONFLICT DO NOTHING;

-- Adicionais ativos com e-mail e sem vínculo recebem documentacao_operacao.
INSERT INTO public.customer_contact_box_links (contact_id, box_code)
SELECT cc.id, 'documentacao_operacao'
FROM public.customer_contacts cc
WHERE (cc.is_primary = false OR cc.is_primary IS NULL) AND cc.deactivated_at IS NULL
  AND cc.email_normalized IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.customer_contact_box_links l WHERE l.contact_id = cc.id)
ON CONFLICT DO NOTHING;
