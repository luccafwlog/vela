-- Diagnóstico das importações e do CE Mercante — SOMENTE LEITURA.
--
-- Etapa 0 do plano docs/archive/plans/2026-10-09-correcao-importacoes-ce-mercante.md
-- (salvaguardas). O dono roda no banco de produção, em leitura, e anexa o
-- resultado à PR da Etapa 4. O resultado orienta as Etapas 4, 5, 6, 8 e 11.
--
-- Todas as consultas rodam numa transação READ ONLY: nenhuma linha é gravada.
--
-- Pré-requisito do deploy das migrations 174–213: a 177 aborta se houver CE
-- repetido entre B/Ls não cancelados (somando Granito) pela chave normalizada
-- (`ce_mercante_key`: só letras e dígitos, maiúsculas, sem zeros à esquerda),
-- e a 181 reescreve o Nº de Manifesto na forma canônica (13 caracteres) — duas
-- grafias do mesmo número na mesma Viagem colidem. As consultas 2a–2c e 4 usam
-- exatamente essas chaves; se devolverem linhas, resolva antes do deploy.
-- A 181 também aborta se a reescrita cair numa Viagem Cancelada (a guarda da
-- 066 sela as linhas dela): a consulta 4c lista esses casos.
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

\echo '2a. B/Ls não cancelados com o mesmo CE pela chave normalizada da 177 (Etapa 6)'
SELECT NULLIF(ltrim(upper(regexp_replace(COALESCE(ce_mercante, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '') AS ce_chave, array_agg(ce_mercante ORDER BY id) AS grafias,
       array_agg(id ORDER BY id) AS bls, count(*) AS qtd
FROM public.bls
WHERE NULLIF(ltrim(upper(regexp_replace(COALESCE(ce_mercante, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '') IS NOT NULL AND cancelled_at IS NULL
GROUP BY 1
HAVING count(*) > 1
ORDER BY qtd DESC, 1;

\echo '2b. CE repetido entre B/L de carga e B/L de Granito pela chave normalizada (Etapa 6)'
SELECT b.ce_mercante, g.ce_mercante AS ce_granito, b.id AS bl, g.bl_number AS granito_bl, g.id AS granito_id
FROM public.bls b
JOIN public.granite_bls g ON NULLIF(ltrim(upper(regexp_replace(COALESCE(g.ce_mercante, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '') = NULLIF(ltrim(upper(regexp_replace(COALESCE(b.ce_mercante, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '')
WHERE NULLIF(ltrim(upper(regexp_replace(COALESCE(b.ce_mercante, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '') IS NOT NULL AND b.cancelled_at IS NULL
ORDER BY b.ce_mercante;

\echo '2c. CE repetido entre B/Ls de Granito pela chave normalizada (Etapa 6)'
SELECT NULLIF(ltrim(upper(regexp_replace(COALESCE(ce_mercante, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '') AS ce_chave, array_agg(ce_mercante ORDER BY bl_number) AS grafias,
       array_agg(bl_number ORDER BY bl_number) AS granito_bls
FROM public.granite_bls
WHERE NULLIF(ltrim(upper(regexp_replace(COALESCE(ce_mercante, ''), '[^0-9A-Za-z]', '', 'g')), '0'), '') IS NOT NULL
GROUP BY 1
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

\echo '4c. Nº de Manifesto ou CE Master de rota em Viagem Cancelada que a 181 reescreveria (a guarda da Viagem Cancelada aborta a 181)'
SELECT 'manifestos_mercante' AS origem, m.voyage_id, m.numero AS gravado,
       NULLIF(upper(regexp_replace(COALESCE(m.numero, ''), '[^A-Za-z0-9]', '', 'g')), '') AS canonico
FROM public.manifestos_mercante m
JOIN public.voyages v ON v.id = m.voyage_id AND v.status = 'cancelled'
WHERE m.numero IS DISTINCT FROM NULLIF(upper(regexp_replace(COALESCE(m.numero, ''), '[^A-Za-z0-9]', '', 'g')), '')
UNION ALL
SELECT 'voyage_route_ce_master', r.voyage_id, r.ce_master,
       NULLIF(upper(regexp_replace(COALESCE(r.ce_master, ''), '[^A-Za-z0-9]', '', 'g')), '')
FROM public.voyage_route_ce_master r
JOIN public.voyages v ON v.id = r.voyage_id AND v.status = 'cancelled'
WHERE r.ce_master IS DISTINCT FROM NULLIF(upper(regexp_replace(COALESCE(r.ce_master, ''), '[^A-Za-z0-9]', '', 'g')), '')
ORDER BY 1, 2;

\echo '5. Containers devolvidos sem data de devolução (Etapa 7)'
SELECT c.bl_id, c.container_number, c.discharge_date
FROM public.bl_containers c
WHERE c.demurrage_status = 'returned' AND c.return_date IS NULL
ORDER BY c.bl_id, c.container_number;

\echo '6. Containers FCL em B/Ls de Clientes diferentes na mesma Viagem (Etapa 5)'
SELECT b.voyage_id, upper(btrim(c.container_number)) AS container_number,
       array_agg(DISTINCT b.id) AS bls,
       array_agg(DISTINCT b.customer_id) AS clientes
FROM public.bl_containers c
JOIN public.bls b ON b.id = c.bl_id
WHERE b.cancelled_at IS NULL
  AND COALESCE(b.container_load_type, 'FCL') = 'FCL'
  AND b.customer_id IS NOT NULL
GROUP BY b.voyage_id, 2
HAVING count(DISTINCT b.customer_id) > 1
ORDER BY b.voyage_id, 2;

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
