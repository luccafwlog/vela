-- Diagnóstico das importações e do CE Mercante — SOMENTE LEITURA.
--
-- Etapa 0 do plano docs/plans/2026-10-09-correcao-importacoes-ce-mercante.md
-- (salvaguardas). O dono roda no banco de produção, em leitura, e anexa o
-- resultado à PR da Etapa 4. O resultado orienta as Etapas 4, 5, 6, 8 e 11.
--
-- Todas as consultas rodam numa transação READ ONLY: nenhuma linha é gravada.
-- Uso: psql "$PROD_DATABASE_URL" -X -f supabase/scripts/diagnostico_importacoes_ce_somente_leitura.sql
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

\echo '1. Efeitos pendentes por tipo e idade (Etapas 4 e 13)'
SELECT effect_kind, status, count(*) AS efeitos,
       min(created_at) AS mais_antigo, max(created_at) AS mais_novo,
       max(attempts) AS max_tentativas
FROM public.import_pending_effects
WHERE status NOT IN ('succeeded', 'superseded')
GROUP BY effect_kind, status
ORDER BY effect_kind, status;

\echo '2a. B/Ls não cancelados com o mesmo CE (Etapa 6)'
SELECT ce_mercante, array_agg(id ORDER BY id) AS bls, count(*) AS qtd
FROM public.bls
WHERE ce_mercante IS NOT NULL AND cancelled_at IS NULL
GROUP BY ce_mercante
HAVING count(*) > 1
ORDER BY qtd DESC, ce_mercante;

\echo '2b. CE repetido entre B/L de carga e B/L de Granito (Etapa 6)'
SELECT b.ce_mercante, b.id AS bl, g.bl_number AS granito_bl, g.id AS granito_id
FROM public.bls b
JOIN public.granite_bls g ON g.ce_mercante = b.ce_mercante
WHERE b.ce_mercante IS NOT NULL AND b.cancelled_at IS NULL
ORDER BY b.ce_mercante;

\echo '2c. CE repetido entre B/Ls de Granito (Etapa 6)'
SELECT ce_mercante, array_agg(bl_number ORDER BY bl_number) AS granito_bls
FROM public.granite_bls
WHERE ce_mercante IS NOT NULL
GROUP BY ce_mercante
HAVING count(*) > 1;

\echo '3. CEs fora de 15 dígitos (Etapa 6)'
SELECT 'bls' AS origem, id AS registro, ce_mercante FROM public.bls
WHERE ce_mercante IS NOT NULL AND ce_mercante !~ '^[0-9]{15}$'
UNION ALL
SELECT 'granite_bls', bl_number, ce_mercante FROM public.granite_bls
WHERE ce_mercante IS NOT NULL AND ce_mercante !~ '^[0-9]{15}$'
ORDER BY 1, 2;

\echo '4. Nº de Manifesto Mercante que colidem depois da normalização (Etapa 8.3)'
SELECT upper(regexp_replace(numero, '[^0-9A-Za-z]', '', 'g')) AS numero_canonico,
       array_agg(DISTINCT numero) AS grafias,
       array_agg(DISTINCT voyage_id) AS viagens,
       count(*) AS manifestos
FROM public.manifestos_mercante
WHERE numero IS NOT NULL
GROUP BY 1
HAVING count(*) > 1 OR count(DISTINCT numero) > 1
ORDER BY 1;

\echo '4b. Nº de Manifesto Mercante fora de 13 caracteres alfanuméricos (Etapa 8.3)'
SELECT id, voyage_id, numero
FROM public.manifestos_mercante
WHERE numero IS NOT NULL
  AND upper(regexp_replace(numero, '[^0-9A-Za-z]', '', 'g')) !~ '^[0-9A-Z]{13}$'
ORDER BY voyage_id, numero;

\echo '5. Containers devolvidos sem data de devolução (Etapa 7)'
SELECT c.bl_id, c.container_number, c.discharge_date
FROM public.bl_containers c
WHERE c.demurrage_status = 'returned' AND c.return_date IS NULL
ORDER BY c.bl_id, c.container_number;

\echo '6. Containers FCL em B/Ls de Clientes diferentes na mesma Viagem (Etapa 5)'
SELECT b.voyage_id, c.container_number,
       array_agg(DISTINCT b.id) AS bls,
       array_agg(DISTINCT b.customer_id) AS clientes
FROM public.bl_containers c
JOIN public.bls b ON b.id = c.bl_id
WHERE b.cancelled_at IS NULL
  AND COALESCE(b.container_load_type, 'FCL') = 'FCL'
  AND b.customer_id IS NOT NULL
GROUP BY b.voyage_id, c.container_number
HAVING count(DISTINCT b.customer_id) > 1
ORDER BY b.voyage_id, c.container_number;

\echo '7. Mesmo chassi em Viagens diferentes (Etapa 11)'
SELECT upper(btrim(v.chassis)) AS chassi,
       array_agg(DISTINCT v.voyage_id) AS viagens,
       array_agg(DISTINCT v.bl_id) AS bls
FROM public.vehicles v
WHERE v.chassis IS NOT NULL AND btrim(v.chassis) <> ''
GROUP BY 1
HAVING count(DISTINCT v.voyage_id) > 1
ORDER BY 1;

ROLLBACK;
