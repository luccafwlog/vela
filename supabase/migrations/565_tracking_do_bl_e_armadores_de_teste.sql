-- 565: tracking da Cosco com a marca {BL} e armadores de teste fora do cadastro.
--
-- Pedido do dono (2026-11-01):
-- 1. O site da Cosco abre direto na consulta do B/L quando o número vai depois
--    de `value=`. O link semeado na 137 terminava em `value=` sem a marca, e o
--    Portal só oferecia o botão geral do armador. Com `value={BL}`, a seção
--    Tracking das Informações e a nova coluna Tracking de B/Ls e containers
--    abrem o site já na busca do B/L (`trackingUrlForBl`). Só troca o link
--    que ainda é o semeado; um link editado no Vela fica como está.
-- 2. "QA SHIPPING LINE", "QA-DISPLAY-2026 Carrier" e "QA Carrier - Plano
--    654-660" são armadores de teste (auditoria e2e de 2026-06-12, fixture
--    QA-DISPLAY-2026, plano 654-660) que apareciam em Informações do Portal →
--    Tracking. Em 2026-11-01 existiam só na staging, sem navio, viagem, tabela
--    de taxas nem link; produção tinha só a Cosco. O DELETE casa nome e SCAC e
--    pula o armador que ganhou navio ou tabela de taxas (as chaves de
--    `vessels` e `charge_tables` recusariam a exclusão), para a migration
--    nunca falhar no deploy. O link do armador, se houver, sai junto (ON
--    DELETE CASCADE de `carrier_portal_information`).
--
-- Dados existentes: as duas mudanças reescrevem ou apagam linhas e dependem do
-- "Data status" do AGENTS.md (seção Gotchas): o banco de produção só tem dados
-- de teste. O gatilho `audit_carriers` registra a exclusão no histórico.
--
-- Rollback: recriar os armadores pelo cadastro, se preciso; o link da Cosco
-- volta pelo editor de Tracking do Vela (Informações do Portal → Tracking).

UPDATE public.carrier_portal_information
SET tracking_url = 'https://spe.coscoshipping.com/main/newcargotracking?label=T&value={BL}'
WHERE tracking_url = 'https://spe.coscoshipping.com/main/newcargotracking?label=T&value=';

DELETE FROM public.carriers AS c
WHERE (c.name, COALESCE(c.scac, '')) IN (
    ('QA SHIPPING LINE', 'QASC'),
    ('QA-DISPLAY-2026 Carrier', 'QAD'),
    ('QA Carrier - Plano 654-660', 'QA66')
  )
  AND NOT EXISTS (SELECT 1 FROM public.vessels AS v WHERE v.carrier_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM public.charge_tables AS t WHERE t.carrier_id = c.id);
