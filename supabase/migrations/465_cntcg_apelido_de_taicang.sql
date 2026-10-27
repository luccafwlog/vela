-- 465: CNTCG passa a ser apelido de CNTAC (Taicang).
--
-- Problema:
--   O Baplie da COSCO (BAPLIE 1.5, viagem 260919000000 do GREEN PORTOCEL,
--   2026-09-28) traz 239 containers com LOC+6+CNTCG, outra grafia de Taicang
--   além de CNTAG, CNTCA e TCA. `normalize_port_code` (410) não conhecia
--   CNTCG, e o import recusava o POL desses containers como não reconhecido.
--
-- Mudança:
--   `normalize_port_code` leva CNTCG a CNTAC, junto dos outros apelidos de
--   Taicang. A cópia do app (`STORED_PORT_ALIASES` e `EXACT_PORT_ALIASES` em
--   src/services/portCode.ts) muda junto e a suíte operationalLists confere
--   as duas. Continua `LANGUAGE sql IMMUTABLE` sem `SET`, para ser expandida
--   inline (docs/operations/seguranca.md); `CREATE OR REPLACE` preserva os
--   privilégios da função. Nenhuma linha é reescrita: o import recusava
--   CNTCG, então não há chave gravada com ele, e colunas cruas passam pela
--   função em toda comparação.
--
-- Rollback: recriar `normalize_port_code` pela 410.

CREATE OR REPLACE FUNCTION public.normalize_port_code(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('BRVIT', 'VIT', 'VITORIA', 'VITÓRIA', 'BRVIX', 'VIX') THEN 'BRVIX'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SALVADOR', 'BRSSA', 'SSA') THEN 'BRSSA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('PECEM', 'PECÉM', 'BRPEC', 'PEC') THEN 'BRPEC'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SANTOS', 'BRSSZ', 'SSZ') THEN 'BRSSZ'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('PARANAGUA', 'PARANAGUÁ', 'BRPNG', 'PNG') THEN 'BRPNG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ITAJAI', 'ITAJAÍ', 'BRITJ', 'ITJ') THEN 'BRITJ'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NAVEGANTES', 'BRNVT', 'NVT') THEN 'BRNVT'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RIO GRANDE', 'BRRIG', 'RIG') THEN 'BRRIG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SUAPE', 'BRSUA', 'SUA') THEN 'BRSUA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RECIFE', 'BRREC', 'REC') THEN 'BRREC'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('RIO DE JANEIRO', 'BRRIO', 'BRRDJ') THEN 'BRRIO'
    -- 410: Sepetiba é o porto de Itaguaí; o código correto é BRIGI.
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ITAGUAI', 'ITAGUAÍ', 'BRIGI', 'IGI', 'SEPETIBA', 'BRSEP', 'BRSPB', 'SPB', 'SEP') THEN 'BRIGI'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('MANAUS', 'BRMAO') THEN 'BRMAO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('QINGDAO', 'QINDGAO', 'TSINGTAO', 'CNTAO', 'CNQDG', 'QDG', 'TAO') THEN 'CNTAO'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SHANGHAI', 'CNSHA', 'CNSHG', 'SHG') THEN 'CNSHA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('TAICANG', 'TAIKANG', 'CNTAC', 'CNTAI', 'CNTAG', 'CNTCA', 'CNTCG', 'TCA') THEN 'CNTAC'
    -- Ningbo-Zhoushan e um unico complexo portuario: o Baplie costuma trazer CNZOS
    -- (Zhoushan) para carga que o B/L declara como Ningbo (CNNGB).
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NINGBO', 'CNNGB', 'CNNBO', 'NBO', 'ZHOUSHAN', 'CNZOS', 'ZOS') THEN 'CNNGB'
    -- Guangzhou (CNGZU, CNCAN) e tratado como Nansha.
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('NANSHA', 'CNNSA', 'CNNAN', 'GUANGZHOU', 'CNGZU', 'CNCAN') THEN 'CNNSA'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('ZHANGJIAGANG', 'CNZJG') THEN 'CNZJG'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('XIAMEN', 'AMOY', 'CNXMN', 'XMN') THEN 'CNXMN'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('SHEKOU', 'SHENZHEN', 'CNSHK', 'CNSZK', 'CNSHE') THEN 'CNSHK'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('YANTIAN', 'CNYTN', 'YTN') THEN 'CNYTN'
    WHEN upper(btrim(COALESCE(p_value, ''))) IN ('HONG KONG', 'HONGKONG', 'HKHKG', 'HKG') THEN 'HKHKG'
    ELSE NULLIF(upper(btrim(COALESCE(p_value, ''))), '')
  END;
$$;
