-- 464: endereços das agências que recebem o B/L original no Desbloqueio de CE.
--
-- Problema: a migration 447 criou os contatos `entrega_bl_vitoria`,
-- `entrega_bl_salvador` e `entrega_bl_suape` da Central de Informações com
-- "Endereço a definir", e o Portal mostra esse texto nas três agências.
--
-- Mudança: grava os endereços passados pelo responsável em 2026-10-26, com a
-- agência na primeira linha e uma informação por linha (o Portal respeita as
-- quebras). Só troca o texto provisório: endereço já editado no Vela
-- (Informações do Portal → Contato) fica como está.
--
-- Data status: as linhas reescritas são cadastro de configuração, não dado de
-- negócio, e só perdem o texto provisório. O check de migrations destrutivas
-- pede a declaração para todo UPDATE; esta migration cita a afirmação
-- "Data status" do AGENTS.md por essa exigência, e não dependeria dela se a
-- afirmação fosse revogada.
--
-- Rollback: voltar `address` a 'Endereço a definir' nas três chaves.

UPDATE public.portal_information_contacts SET address = v.address
FROM (VALUES
 ('entrega_bl_vitoria', E'Transhipping\nRua Dr. Desembargador Ferreira Coelho, 330\nEdifício Eldorado Center – Sala 813\nPraia do Suá, Vitória/ES – CEP 29052-210'),
 ('entrega_bl_salvador', E'Marinav\nAv. Jequitaia, 940\nComércio, Salvador/BA – CEP 40015-035'),
 ('entrega_bl_suape', E'Transglobal\nAv. Portuária, S/N – Porto de Suape\nIpojuca/PE – CEP 55590-000')
) AS v(key, address)
WHERE portal_information_contacts.key = v.key
  AND btrim(portal_information_contacts.address) IN ('', 'Endereço a definir');
