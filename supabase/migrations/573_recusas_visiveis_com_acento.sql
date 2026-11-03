-- 573: recusas do servidor que a pessoa pode ver, com acento.
--
-- Decisão do dono de 2026-11-03 (revisão do Manual do Operador): corrigir só
-- as recusas sem acento que chegam à tela, isto é, as mensagens que a matriz de
-- cobertura (docs/manual/cobertura/, seção Mensagens) não marca como "Fora".
-- As guardas internas (destino "Fora") e as funções antigas que nada mais chama
-- ficam como estão.
--
-- Como a lista foi feita: inventário do banco local com toda a cadeia
-- (scripts/manual/inventory.mjs), cruzado com o destino de cada mensagem na
-- matriz; cada uma das 139 mensagens com destino diferente de "Fora" e palavra sem
-- acento foi trocada em TODAS as funções que a levam e que ainda são
-- chamadas (pela tela, pelo servidor, por gatilho, por rotina por horário ou por
-- outra função chamada). Funções que nada chama ficaram de fora:
-- update_container_demurrage_dates, reopen_demurrage_invoice,
-- portal_get_demurrage_invoice_detail_legacy, add_manual_invoice_charge,
-- obsolete_consolidated_invoice e portal_invoice_details_legacy. Também fica
-- import_granite_manifest_transactional_legacy_136: a guarda
-- import_granite_manifest_transactional_core_405 compara o SQLERRM dele
-- ("Viagem nao encontrada.") e o troca por "Viagem de destino não encontrada.",
-- então o texto antigo nunca chega à tela e precisa ficar igual.
--
-- Só a acentuação muda (e a crase em "às frentes", "à viagem", "à exceção" e
-- "à invoice", e "não têm" no plural). Termos em inglês das mensagens antigas
-- (invoice, receivable, sign-off, status=%) ficam: trocar palavra é outra
-- decisão.
--
-- Cada função é a definição vigente (lida com pg_get_functiondef no Postgres
-- local com toda a cadeia aplicada, até a 572) com só esses textos trocados;
-- lógica, ERRCODE, assinatura, SECURITY DEFINER, search_path e grants ficam
-- iguais. Fora a guarda do Granito acima, nenhuma função nem tela compara
-- esses textos (conferido em src/, supabase/functions/ e no corpo das funções:
-- nas funções trocadas, todo uso está num RAISE).
--
-- Só redefine funções; não grava nem reescreve linhas.
-- Rollback: desfazer só as trocas de texto em cada função.
--
-- Mensagens trocadas (antes -> depois):
--   A correcao do B/L ja tratou este valor. Revise o ajuste de COD e a restituicao existente.
--     -> A correção do B/L já tratou este valor. Revise o ajuste de COD e a restituição existente.
--   A escala da viagem % ja foi omitida para o POD %.
--     -> A escala da viagem % já foi omitida para o POD %.
--   ADR % nao corresponde a terminal atribuido na escala.
--     -> ADR % não corresponde a terminal atribuído na escala.
--   ADR fechado: reabra antes de alterar a observacao.
--     -> ADR fechado: reabra antes de alterar a observação.
--   ADR ja fechado.
--     -> ADR já fechado.
--   ADR nao esta fechado.
--     -> ADR não está fechado.
--   Ainda existem linhas com pendencia de revisao
--     -> Ainda existem linhas com pendência de revisão
--   Ajuste de COD % nao encontrado.
--     -> Ajuste de COD % não encontrado.
--   Ajuste de COD % nao esta pendente (status=%).
--     -> Ajuste de COD % não está pendente (status=%).
--   Alocacao do receivable % excede o valor original (%).
--     -> Alocação do receivable % excede o valor original (%).
--   Alterar uma decisao ja registrada exige justificativa.
--     -> Alterar uma decisão já registrada exige justificativa.
--   Ator inativo para faturamento automatico.
--     -> Ator inativo para faturamento automático.
--   B/L "%" nao encontrado.
--     -> B/L "%" não encontrado.
--   B/L % cancelado e somente leitura; não é permitido lançar taxa manual.
--     -> B/L % cancelado é somente leitura; não é permitido lançar taxa manual.
--   B/L % cancelado e somente leitura; reative o B/L para alterar as taxas.
--     -> B/L % cancelado é somente leitura; reative o B/L para alterar as taxas.
--   B/L % cancelado e somente leitura; reative o B/L para calcular.
--     -> B/L % cancelado é somente leitura; reative o B/L para calcular.
--   B/L % nao encontrado.
--     -> B/L % não encontrado.
--   B/L % nao possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.
--     -> B/L % não possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.
--   B/L com pendencia de terminal: %
--     -> B/L com pendência de terminal: %
--   B/L exige reconciliacao manual antes do faturamento.
--     -> B/L exige reconciliação manual antes do faturamento.
--   B/L nao pertence ao cliente selecionado.
--     -> B/L não pertence ao cliente selecionado.
--   B/L obrigatorio para item da tabela.
--     -> B/L obrigatório para item da tabela.
--   B/L possui pendencias no gate de revisao: %
--     -> B/L possui pendências no gate de revisão: %
--   B/L sem linhas faturaveis.
--     -> B/L sem linhas faturáveis.
--   B/L sem quantidade faturavel.
--     -> B/L sem quantidade faturável.
--   B/L(s) nao encontrado(s): %
--     -> B/L(s) não encontrado(s): %
--   Base de cobranca nao suportada na avulsa: %.
--     -> Base de cobrança não suportada na avulsa: %.
--   BL % foi alterado por outro usuario; recarregue antes de salvar
--     -> BL % foi alterado por outro usuário; recarregue antes de salvar
--   BL % nao encontrado
--     -> BL % não encontrado
--   BL nao encontrado
--     -> BL não encontrado
--   BL nao pertence a viagem informada
--     -> BL não pertence à viagem informada
--   BL nao pertence ao container informado
--     -> BL não pertence ao container informado
--   Candidata nao corresponde exatamente ao TXID persistido.
--     -> Candidata não corresponde exatamente ao TXID persistido.
--   Chassi obrigatorio
--     -> Chassi obrigatório
--   Cliente % nao encontrado.
--     -> Cliente % não encontrado.
--   Cliente informado nao corresponde aos B/Ls selecionados.
--     -> Cliente informado não corresponde aos B/Ls selecionados.
--   Container % nao encontrado.
--     -> Container % não encontrado.
--   Container nao encontrado
--     -> Container não encontrado
--   Correcao exige valor menor que a cobranca vigente.
--     -> Correção exige valor menor que a cobrança vigente.
--   Demurrage % nao encontrada.
--     -> Demurrage % não encontrada.
--   Demurrage invoice % ja esta paga.
--     -> Demurrage invoice % já está paga.
--   Demurrage invoice % nao encontrada.
--     -> Demurrage invoice % não encontrada.
--   Demurrage invoice % nao esta paga (status=%).
--     -> Demurrage invoice % não está paga (status=%).
--   Demurrage invoice % nao pode ser baixada no status atual.
--     -> Demurrage invoice % não pode ser baixada no status atual.
--   Departamento % tem secoes pendentes: resolva-as antes de assinar.
--     -> Departamento % tem seções pendentes: resolva-as antes de assinar.
--   Depot comum nao pode ter porto brasileiro.
--     -> Depot comum não pode ter porto brasileiro.
--   Desconto fixo nao pode exceder o total USD da fatura.
--     -> Desconto fixo não pode exceder o total USD da fatura.
--   Desconto nao pode alterar fatura paga ou cancelada.
--     -> Desconto não pode alterar fatura paga ou cancelada.
--   Desconto nao pode ser negativo.
--     -> Desconto não pode ser negativo.
--   E-mail invalido para o cliente %: %
--     -> E-mail inválido para o cliente %: %
--   Emissao automatica nao retornou invoice para o B/L %.
--     -> Emissão automática não retornou invoice para o B/L %.
--   Emissao bloqueada: conta do Portal do cliente nao esta pronta para receber a fatura.
--     -> Emissão bloqueada: conta do Portal do cliente não está pronta para receber a fatura.
--   Emissao consolidada bloqueada: conta do Portal do cliente nao esta pronta para receber a fatura.
--     -> Emissão consolidada bloqueada: conta do Portal do cliente não está pronta para receber a fatura.
--   Escala com frentes de operacao: atribua o terminal as frentes para abrir o ADR do terminal.
--     -> Escala com frentes de operação: atribua o terminal às frentes para abrir o ADR do terminal.
--   Esta baixa financia restituicao por correcao deste recebivel. Confira a restituicao antes de cancelar a baixa.
--     -> Esta baixa financia restituição por correção deste recebível. Confira a restituição antes de cancelar a baixa.
--   Esta baixa financia restituicao. Confira a restituicao antes de cancelar a baixa.
--     -> Esta baixa financia restituição. Confira a restituição antes de cancelar a baixa.
--   Este B/L esta na consolidada %; cancele ou reemita pela consolidada.
--     -> Este B/L está na consolidada %; cancele ou reemita pela consolidada.
--   Existe B/L ja faturado/pago/cancelado na selecao.
--     -> Existe B/L já faturado/pago/cancelado na seleção.
--   Existe B/L vinculado a invoice ativa.
--     -> Existe B/L vinculado à invoice ativa.
--   Fatura % coberta por outro documento pago: o B/L ja foi pago e ela nao pode ser cancelada.
--     -> Fatura % coberta por outro documento pago: o B/L já foi pago e ela não pode ser cancelada.
--   Fatura % nao possui uma foto financeira pagavel.
--     -> Fatura % não possui uma foto financeira pagável.
--   Fatura % tem cotacao invalida na foto financeira.
--     -> Fatura % tem cotação inválida na foto financeira.
--   Fatura com correcao registrada nao pode ser cancelada; para diferenca adicional use fatura avulsa ou nova correcao.
--     -> Fatura com correção registrada não pode ser cancelada; para diferença adicional use fatura avulsa ou nova correção.
--   Fatura e data de pagamento sao obrigatorias.
--     -> Fatura e data de pagamento são obrigatórias.
--   Faturamento automatico do B/L % bloqueado: %
--     -> Faturamento automático do B/L % bloqueado: %
--   Faturamento automatico sem ator validado.
--     -> Faturamento automático sem ator validado.
--   Filtro de flags invalido.
--     -> Filtro de flags inválido.
--   Identificador PIX invalido.
--     -> Identificador PIX inválido.
--   Informe o motivo da exclusao.
--     -> Informe o motivo da exclusão.
--   Inspecao do Portal requer usuario interno ativo.
--     -> Inspeção do Portal requer usuário interno ativo.
--   Invoice % nao encontrada ou acesso negado
--     -> Invoice % não encontrada ou acesso negado
--   Invoice % nao encontrada.
--     -> Invoice % não encontrada.
--   Invoice % nao esta em estado pagavel (status=%).
--     -> Invoice % não está em estado pagável (status=%).
--   Invoice % nao possui saldo em aberto no ledger.
--     -> Invoice % não possui saldo em aberto no ledger.
--   Invoice cancelada nao aceita pagamento.
--     -> Invoice cancelada não aceita pagamento.
--   Invoice ja esta paga.
--     -> Invoice já está paga.
--   Ja existe manifesto Baplie para esta viagem.
--     -> Já existe manifesto Baplie para esta viagem.
--   Justificativa obrigatoria para alterar desconto.
--     -> Justificativa obrigatória para alterar desconto.
--   Justificativa obrigatoria para alterar estado terminalizado existente.
--     -> Justificativa obrigatória para alterar estado terminalizado existente.
--   Justificativa obrigatoria para cancelar a fatura.
--     -> Justificativa obrigatória para cancelar a fatura.
--   Justificativa obrigatoria para retry.
--     -> Justificativa obrigatória para retry.
--   Lote de importacao % nao encontrado
--     -> Lote de importação % não encontrado
--   Marca obrigatoria
--     -> Marca obrigatória
--   Modelo obrigatorio
--     -> Modelo obrigatório
--   Nao e permitido cancelar invoice com pagamentos registrados.
--     -> Não é permitido cancelar invoice com pagamentos registrados.
--   Nao e possivel reverter a omissao: % B/L(s) afetado(s) estao em COD.
--     -> Não é possível reverter a omissão: % B/L(s) afetado(s) estão em COD.
--   Nao foi encontrada fatura ativa para o B/L %.
--     -> Não foi encontrada fatura ativa para o B/L %.
--   Nao foi encontrado snapshot da fatura do B/L %.
--     -> Não foi encontrado snapshot da fatura do B/L %.
--   Nenhum B/L informado para emissao.
--     -> Nenhum B/L informado para emissão.
--   Nenhuma baixa/settlement autoritativa corresponde a excecao PIX %.
--     -> Nenhuma baixa/settlement autoritativa corresponde à exceção PIX %.
--   Nenhuma linha BRL elegivel para faturamento.
--     -> Nenhuma linha BRL elegível para faturamento.
--   Nova expectativa de exportacao exige granito ou vazios.
--     -> Nova expectativa de exportação exige granito ou vazios.
--   Novo terminal portuario exige porto brasileiro.
--     -> Novo terminal portuário exige porto brasileiro.
--   O B/L % ja tem documento de Taxas Locais aberto (individual ou consolidada); nao emita outro por cima.
--     -> O B/L % já tem documento de Taxas Locais aberto (individual ou consolidada); não emita outro por cima.
--   O B/L irmao % (container compartilhado %) foi faturado com outro rateio do container; a fatura dele precisa ser reemitida com o rateio atual antes de faturar o B/L %.
--     -> O B/L irmão % (container compartilhado %) foi faturado com outro rateio do container; a fatura dele precisa ser reemitida com o rateio atual antes de faturar o B/L %.
--   O CE Mercante % ja esta no %. Um CE so pode estar em um B/L nao cancelado: confira o numero ou cancele o outro B/L.
--     -> O CE Mercante % já está no %. Um CE só pode estar em um B/L não cancelado: confira o número ou cancele o outro B/L.
--   O container % esta no B/L % (%) e no B/L % (%): container FCL nao e dividido entre Clientes diferentes. Corrija o Cliente ou o container do arquivo.
--     -> O container % está no B/L % (%) e no B/L % (%): container FCL não é dividido entre Clientes diferentes. Corrija o Cliente ou o container do arquivo.
--   Pagamento % nao encontrado.
--     -> Pagamento % não encontrado.
--   PIX % ja esta associado a outra fatura.
--     -> PIX % já está associado a outra fatura.
--   Pix ja baixado nesta fatura (mesmo TXID ou endToEndId): confira antes de baixar de novo.
--     -> Pix já baixado nesta fatura (mesmo TXID ou endToEndId): confira antes de baixar de novo.
--   Planilha invalida: Container duplicado na planilha.
--     -> Planilha inválida: Container duplicado na planilha.
--   Planilha invalida: corrija todas as linhas e importe novamente.
--     -> Planilha inválida: corrija todas as linhas e importe novamente.
--   Porto brasileiro % nao encontrado.
--     -> Porto brasileiro % não encontrado.
--   Porto de embarque obrigatorio.
--     -> Porto de embarque obrigatório.
--   PT409: B/L ja vinculado a uma invoice ativa.
--     -> PT409: B/L já vinculado a uma invoice ativa.
--   PTAX e data de cotacao sao obrigatorias.
--     -> PTAX e data de cotação são obrigatórias.
--   PTAX invalida.
--     -> PTAX inválida.
--   PTAX obrigatoria para origem %.
--     -> PTAX obrigatória para origem %.
--   Receivable(s) inexistente(s) na selecao.
--     -> Receivable(s) inexistente(s) na seleção.
--   Referencia cambial invalida.
--     -> Referência cambial inválida.
--   Restituicao excede os recebimentos disponiveis do recebivel (%).
--     -> Restituição excede os recebimentos disponíveis do recebível (%).
--   Reversao de omissao exige justificativa.
--     -> Reversão de omissão exige justificativa.
--   Secao pertence ao departamento %.
--     -> Seção pertence ao departamento %.
--   Selecao contem B/Ls de clientes diferentes.
--     -> Seleção contém B/Ls de clientes diferentes.
--   Selecao contem receivables de clientes diferentes.
--     -> Seleção contém receivables de clientes diferentes.
--   Sem permissao para consultar correcao.
--     -> Sem permissão para consultar correção.
--   Sem permissao para consultar os Pix recebidos.
--     -> Sem permissão para consultar os Pix recebidos.
--   Sem permissao para liquidar ajuste de COD.
--     -> Sem permissão para liquidar ajuste de COD.
--   Sem permissao para monitorar o Pix Itau.
--     -> Sem permissão para monitorar o Pix Itaú.
--   Sem permissao para resolver alerta.
--     -> Sem permissão para resolver alerta.
--   Sem permissao para tratar o Pix Itau.
--     -> Sem permissão para tratar o Pix Itaú.
--   Sessao do portal invalida ou expirada.
--     -> Sessão do portal inválida ou expirada.
--   Tabela de cobranca incompleta ou inativa para POD "%" (modo: %). Configure em /taxas-locais/tabelas antes de prosseguir.
--     -> Tabela de cobrança incompleta ou inativa para POD "%" (modo: %). Configure em /taxas-locais/tabelas antes de prosseguir.
--   Terminal inativo % nao pode receber nova atribuicao.
--     -> Terminal inativo % não pode receber nova atribuição.
--   Terminal inativo % nao pode receber novo estado.
--     -> Terminal inativo % não pode receber novo estado.
--   Terminal nao pertence ao porto % ou nao e terminal portuario.
--     -> Terminal não pertence ao porto % ou não é terminal portuário.
--   Terminal pertence ao departamento operacoes.
--     -> Terminal pertence ao departamento operações.
--   TXID % ja foi conciliado.
--     -> TXID % já foi conciliado.
--   Um ou mais receivables selecionados nao tem ROE congelado para linhas em USD; recalcule/atualize o B/L antes de consolidar.
--     -> Um ou mais receivables selecionados não têm ROE congelado para linhas em USD; recalcule/atualize o B/L antes de consolidar.
--   Unidade embarcada nao encontrada.
--     -> Unidade embarcada não encontrada.
--   Usuario ativo sem permissao para editar a escala.
--     -> Usuário ativo sem permissão para editar a escala.
--   Valor divergente das duas ultimas fotos financeiras da Demurrage %.
--     -> Valor divergente das duas últimas fotos financeiras da Demurrage %.
--   Viagem % cancelada deve permanecer retida; use a rotina de recuperacao explicita.
--     -> Viagem % cancelada deve permanecer retida; use a rotina de recuperação explícita.
--   Viagem % nao encontrada
--     -> Viagem % não encontrada
--   Viagem % nao encontrada.
--     -> Viagem % não encontrada.
--   Viagem % nao pode ser excluida: ha dados vinculados em %.%.
--     -> Viagem % não pode ser excluída: há dados vinculados em %.%.
--   Viagem de efeito local nao encontrada: %.
--     -> Viagem de efeito local não encontrada: %.
--   Viagem nao encontrada.
--     -> Viagem não encontrada.
--   Viagem obrigatoria.
--     -> Viagem obrigatória.

CREATE OR REPLACE FUNCTION public._add_manual_bl_charge_impl_106(p_bl_id text, p_charge_item_id bigint, p_quantity numeric DEFAULT 1, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_item record;
  v_actor uuid;
  v_qty numeric(12,6);
  v_unit_brl numeric(12,2);
  v_unit_usd numeric(12,2);
  v_total_brl numeric(14,2);
  v_total_usd numeric(14,2);
  v_key text;
  v_calc_id bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;
  v_actor := COALESCE(p_actor, auth.uid());

  SELECT b.id, b.customer_id, COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.pod, b.charge_status, b.financial_status, b.cancelled_at,
    public.bl_local_charge_reference_date(b.id) AS reference_date
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = upper(btrim(p_bl_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado é somente leitura; não é permitido lançar taxa manual.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_bl.financial_status, 'open') IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado (situação financeira: %); não é permitido lançar taxa manual.',
      p_bl_id, public._financial_status_label(v_bl.financial_status) USING ERRCODE = '22023';
  END IF;

  SELECT cti.id, cti.name, COALESCE(cti.currency, 'BRL') AS currency,
    cti.unit_value_brl, cti.unit_value_usd, cti.value_brl,
    ct.id AS charge_table_id, ct.name AS charge_table_name, ct.cargo_mode, ct.pod,
    cro.override_value,
    fi.charge_item_id AS frozen_item, fi.unit_value_brl AS frozen_brl,
    fi.unit_value_usd AS frozen_usd, fi.override_value AS frozen_override
  INTO v_item
  FROM public.charge_table_items AS cti
  JOIN public.charge_tables AS ct ON ct.id = cti.charge_table_id
    AND ct.id IN (
      SELECT resolved.table_id
      FROM public.resolve_bl_local_charge_table_ids(v_bl.id, v_bl.reference_date) AS resolved
    )
    AND (
      public.normalize_port_code(ct.pod) = public.normalize_port_code(v_bl.pod)
      OR upper(trim(coalesce(ct.pod, ''))) = 'ANY'
    )
  LEFT JOIN LATERAL (
    SELECT cro.override_value
    FROM public.customer_rate_overrides AS cro
    WHERE cro.active
          AND cro.customer_id = v_bl.customer_id
      AND cro.charge_item_id = cti.id
      AND (cro.valid_from IS NULL OR cro.valid_from <= v_bl.reference_date)
      AND (cro.valid_to IS NULL OR cro.valid_to >= v_bl.reference_date)
    ORDER BY cro.created_at DESC
    LIMIT 1
  ) AS cro ON true
  LEFT JOIN public.bl_price_freeze_items AS fi ON fi.bl_id = v_bl.id AND fi.charge_item_id = cti.id
  WHERE cti.id = p_charge_item_id
    AND COALESCE(cti.active, true) = true
    AND COALESCE(cti.manual_only, false) = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual % não elegível para este B/L', p_charge_item_id USING ERRCODE = '22023';
  END IF;

  v_qty := COALESCE(p_quantity, 1);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Quantidade deve ser maior que zero' USING ERRCODE = '22023';
  END IF;
  IF v_item.currency = 'USD' THEN
    v_unit_brl := NULL;
    v_unit_usd := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_usd, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_usd, 0) END;
    v_total_brl := NULL;
    v_total_usd := round(v_qty * COALESCE(v_unit_usd, 0), 2);
  ELSE
    v_unit_brl := CASE WHEN v_item.frozen_item IS NOT NULL THEN COALESCE(v_item.frozen_override, v_item.frozen_brl, v_item.value_brl, 0)
      ELSE COALESCE(v_item.override_value, v_item.unit_value_brl, v_item.value_brl, 0) END;
    v_unit_usd := NULL;
    v_total_brl := round(v_qty * COALESCE(v_unit_brl, 0), 2);
    v_total_usd := NULL;
  END IF;

  v_key := concat('manual:item:', p_charge_item_id, ':',
    extract(epoch FROM clock_timestamp())::bigint, ':', floor(random() * 100000)::int);

  INSERT INTO public.charge_calculations (
    bl_id, charge_table_id, charge_item_id, quantity, unit_value_brl, unit_value_usd,
    total_value_brl, total_value_usd, override_applied, source, status,
    calculation_key, notes, manual_reason, created_by, calculated_at
  ) VALUES (
    v_bl.id, v_item.charge_table_id, p_charge_item_id, v_qty, v_unit_brl, v_unit_usd,
    v_total_brl, v_total_usd, (CASE WHEN v_item.frozen_item IS NOT NULL THEN v_item.frozen_override ELSE v_item.override_value END) IS NOT NULL, 'manual', 'reviewed',
    v_key, NULLIF(trim(coalesce(p_notes, '')), ''), 'other_charge_manual', v_actor, now()
  ) RETURNING id INTO v_calc_id;

  UPDATE public.bls
  SET charge_status = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN 'reviewed' ELSE charge_status END,
      charges_calculated_at = COALESCE(charges_calculated_at, now()),
      charges_reviewed_at = CASE WHEN charge_status IN ('not_calculated', 'exempt') THEN now() ELSE charges_reviewed_at END
  WHERE id = v_bl.id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  ) VALUES (
    'charge_calculation', v_calc_id::text, 'manual_insert', NULL,
    concat(v_item.name, ' | qty=', v_qty, ' | total=', coalesce(v_total_brl::text, v_total_usd::text)),
    auth.uid(), now(), coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Lancamento manual de other charge')
  );

  RETURN jsonb_build_object(
    'id', v_calc_id, 'bl_id', v_bl.id, 'status', 'reviewed', 'currency', v_item.currency,
    'quantity', v_qty, 'unit_value_brl', v_unit_brl, 'unit_value_usd', v_unit_usd,
    'total_value_brl', v_total_brl, 'total_value_usd', v_total_usd
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._apply_baplie_physical_flags_before_reissue_126(p_voyage_id bigint, p_changes jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_filter text[] := NULL;
  v_item jsonb;
  v_num text;
  v_updated bigint[] := ARRAY[]::bigint[];
  v_cleared jsonb := '[]'::jsonb;
  v_applied_to jsonb := '[]'::jsonb;
  v_divergent jsonb := '[]'::jsonb;
  v_plan record;
  v_row public.bl_containers%ROWTYPE;
  v_profile_ok boolean;
  v_own_ok boolean;
  v_is_imo boolean;
  v_imo_class text;
  v_un_number text;
  v_is_oog boolean;
  v_profile_source text;
  v_ownership text;
  v_ownership_source text;
  v_bl_id text;
  v_action_id uuid := gen_random_uuid();
  v_recalculated integer := 0;
  v_calc_errors jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'Viagem obrigatória.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % não encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  IF p_changes IS NOT NULL THEN
    IF jsonb_typeof(p_changes) <> 'array' THEN
      RAISE EXCEPTION 'Filtro de flags inválido.' USING ERRCODE = '22023';
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_changes) LOOP
      v_num := CASE WHEN jsonb_typeof(v_item) = 'string' THEN upper(btrim(v_item #>> '{}'))
                    ELSE upper(btrim(COALESCE(v_item->>'container_number', ''))) END;
      IF NULLIF(v_num, '') IS NOT NULL THEN v_filter := array_append(v_filter, v_num); END IF;
    END LOOP;
  END IF;

  FOR v_plan IN
    SELECT * FROM public._baplie_flag_plan(p_voyage_id, NULL) AS p
    WHERE p.action IN ('apply', 'clear', 'divergent_manual', 'source_only')
      AND (v_filter IS NULL OR upper(btrim(p.container_number)) = ANY(v_filter))
    ORDER BY p.bl_container_id
  LOOP
    IF v_plan.action = 'divergent_manual' THEN
      v_divergent := v_divergent || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
    END IF;

    SELECT * INTO v_row FROM public.bl_containers WHERE id = v_plan.bl_container_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    v_profile_ok := v_row.profile_source IS DISTINCT FROM 'manual';
    v_own_ok := v_row.ownership_source IS DISTINCT FROM 'manual'
      AND v_row.ownership IS NOT DISTINCT FROM v_plan.old_ownership;

    IF v_profile_ok THEN
      v_is_imo := v_plan.new_is_imo;
      v_imo_class := v_plan.new_imo_class;
      v_un_number := v_plan.new_un_number;
      v_is_oog := v_plan.new_is_oog;
      v_profile_source := v_plan.new_profile_source;
    ELSE
      v_is_imo := v_row.is_imo;
      v_imo_class := v_row.imo_class;
      v_un_number := v_row.un_number;
      v_is_oog := v_row.is_oog;
      v_profile_source := v_row.profile_source;
    END IF;
    IF v_own_ok THEN
      v_ownership := v_plan.new_ownership;
      v_ownership_source := v_plan.new_ownership_source;
    ELSE
      v_ownership := v_row.ownership;
      v_ownership_source := v_row.ownership_source;
    END IF;

    UPDATE public.bl_containers AS c
       SET is_imo = v_is_imo,
           imo_class = v_imo_class,
           un_number = v_un_number,
           is_oog = v_is_oog,
           ownership = v_ownership,
           ownership_source = v_ownership_source,
           profile_source = v_profile_source
     WHERE c.id = v_row.id
       AND (c.is_imo IS DISTINCT FROM v_is_imo OR c.imo_class IS DISTINCT FROM v_imo_class
            OR c.un_number IS DISTINCT FROM v_un_number OR c.is_oog IS DISTINCT FROM v_is_oog
            OR c.ownership IS DISTINCT FROM v_ownership OR c.ownership_source IS DISTINCT FROM v_ownership_source
            OR c.profile_source IS DISTINCT FROM v_profile_source);

    IF COALESCE(v_row.is_imo, false) IS DISTINCT FROM COALESCE(v_is_imo, false)
       OR COALESCE(v_row.is_oog, false) IS DISTINCT FROM COALESCE(v_is_oog, false)
       OR v_row.imo_class IS DISTINCT FROM v_imo_class
       OR v_row.un_number IS DISTINCT FROM v_un_number
       OR v_row.ownership IS DISTINCT FROM v_ownership THEN
      v_updated := array_append(v_updated, v_row.id);
      IF v_plan.action = 'clear' THEN
        v_cleared := v_cleared || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id));
      ELSE
        v_applied_to := v_applied_to || jsonb_build_array(jsonb_build_object('container', v_plan.container_number, 'bl_id', v_plan.bl_id,
          'flags', public._baplie_flags_label(COALESCE(v_is_imo, false), COALESCE(v_is_oog, false), v_ownership)));
      END IF;
    END IF;
  END LOOP;

  IF cardinality(v_updated) = 0 THEN
    RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', ARRAY[]::bigint[], 'applied', 0,
      'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
      'recalculated', 0, 'calculation_errors', '[]'::jsonb);
  END IF;

  v_role := public.current_actor_role();
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
  VALUES ('voyage', p_voyage_id::text, 'baplie_physical_flags',
    jsonb_build_object('voyage_id', p_voyage_id)::text,
    jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
      'cleared', jsonb_array_length(v_cleared))::text,
    v_actor, 'Baplie: marcas físicas aplicadas a todos os B/Ls ativos do container (conjunto atômico)', v_role, v_role);

  FOR v_bl_id IN
    SELECT DISTINCT c.bl_id FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
    WHERE c.id = ANY (v_updated) AND COALESCE(b.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid')
    ORDER BY 1
  LOOP
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
      v_recalculated := v_recalculated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_calc_errors := v_calc_errors || jsonb_build_array(jsonb_build_object('bl_id', v_bl_id, 'message', SQLERRM));
      INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      VALUES ('bl', v_bl_id, 'local_charges_auto_calc_error', NULL, SQLERRM, v_actor, now(),
        'Falha no recalculo de taxas locais apos aplicar flags fisicas do Baplie');
      PERFORM public.enqueue_import_effect(v_action_id, 'provisional_charges', v_bl_id, v_actor, 1, NULL,
        jsonb_build_object('voyage_id', p_voyage_id, 'source', 'baplie_physical_flags'));
    END;
  END LOOP;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'updated_ids', v_updated, 'applied', cardinality(v_updated),
    'applied_to', v_applied_to, 'cleared', v_cleared, 'divergent_manual', v_divergent,
    'recalculated', v_recalculated, 'calculation_errors', v_calc_errors);
END;
$function$;

CREATE OR REPLACE FUNCTION public._apply_container_dates_core(p_container_id bigint, p_discharge date, p_return date, p_keep_return boolean)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_number text;
  v_voyage_id bigint;
  v_bls text[];
  v_conflict record;
BEGIN
  SELECT upper(btrim(c.container_number)), b.voyage_id INTO v_number, v_voyage_id
  FROM public.bl_containers AS c JOIN public.bls AS b ON b.id = c.bl_id
  WHERE c.id = p_container_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE (c.id = p_container_id)
     OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL)
  ORDER BY c.id
  FOR UPDATE OF c;

  -- A data que ficaria gravada não pode ter devolução antes da descarga
  -- (CHECK `bl_containers_return_after_discharge_chk`): com a devolução vazia
  -- na planilha, a gravada é mantida e a descarga nova pode passar dela.
  SELECT c.container_number, CASE WHEN p_keep_return THEN c.return_date ELSE p_return END AS return_date
    INTO v_conflict
  FROM public.bl_containers AS c
  JOIN public.bls AS b ON b.id = c.bl_id
  WHERE b.cancelled_at IS NULL
    AND ((c.id = p_container_id)
         OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL))
    AND p_discharge IS NOT NULL
    AND CASE WHEN p_keep_return THEN c.return_date ELSE p_return END < p_discharge
    -- Só a linha que o UPDATE abaixo vai escrever.
    AND (c.discharge_date IS DISTINCT FROM p_discharge
         OR (NOT p_keep_return AND c.return_date IS DISTINCT FROM p_return))
  ORDER BY c.id
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'A descarga informada (%) do container % é posterior à devolução % (%). Informe a devolução corrigida junto com a descarga, ou remova a devolução pela edição do container, com motivo.',
      to_char(p_discharge, 'DD/MM/YYYY'), upper(btrim(v_conflict.container_number)),
      CASE WHEN p_keep_return THEN 'gravada' ELSE 'informada' END,
      to_char(v_conflict.return_date, 'DD/MM/YYYY')
      USING ERRCODE = '22023';
  END IF;

  WITH targets AS (
    SELECT c.id
    FROM public.bl_containers AS c
    JOIN public.bls AS b ON b.id = c.bl_id
    -- 380 (ADR 0094, B4): a data vai só aos B/Ls ativos do container; o
    -- cancelado é somente leitura e fica como está.
    WHERE b.cancelled_at IS NULL
      AND ((c.id = p_container_id)
       OR (upper(btrim(c.container_number)) = v_number AND b.voyage_id = v_voyage_id AND b.cancelled_at IS NULL))
    ORDER BY c.id
    FOR UPDATE OF c
  ), changed AS (
    UPDATE public.bl_containers AS c
       SET discharge_date = p_discharge,
           return_date = CASE WHEN p_keep_return THEN c.return_date ELSE p_return END
      FROM targets
     WHERE c.id = targets.id
       AND (c.discharge_date IS DISTINCT FROM p_discharge
            OR (NOT p_keep_return AND c.return_date IS DISTINCT FROM p_return))
     RETURNING c.bl_id
  )
  SELECT COALESCE(array_agg(DISTINCT bl_id), ARRAY[]::text[]) INTO v_bls FROM changed;
  RETURN v_bls;
END;
$function$;

CREATE OR REPLACE FUNCTION public._auto_bill_bl_core(p_bl_id text, p_actor uuid, p_reuse_calculation boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_actor uuid := COALESCE(p_actor, auth.uid());
  v_calculation jsonb;
  v_ready jsonb;
  v_invoice jsonb;
  v_existing_invoice_id bigint;
  v_previous_context_table text := current_setting('vela.billing_context_table', true);
  v_previous_request_sub text := current_setting('request.jwt.claim.sub', true);
  v_context_table text := format('vela_auto_billing_%s', replace(gen_random_uuid()::text, '-', ''));
  v_impersonated boolean := false;
  v_context_created boolean := false;
  v_sqlstate text;
  v_error_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM auth.uid() OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para o faturamento automático.' USING ERRCODE = '42501';
  END IF;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Faturamento automático sem ator validado.' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_bl
  FROM public.bls
  WHERE id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'bl_not_found',
      'bl_id', p_bl_id
    );
  END IF;

  -- Repetir o save/import não pode criar uma segunda invoice. O status do B/L
  -- é a guarda rápida; o link ativo cobre estados antigos parcialmente gravados.
  IF COALESCE(v_bl.financial_status, 'pending') <> 'pending' THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'financial_status', v_bl.financial_status
    );
  END IF;

  SELECT inv.id
    INTO v_existing_invoice_id
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;

  IF v_existing_invoice_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_invoiced',
      'idempotent', true,
      'bl_id', v_bl.id,
      'invoice_id', v_existing_invoice_id
    );
  END IF;

  -- ADR 0093, decisão 12 (362): fatura cancelada pela pessoa solta o B/L; a
  -- nova sai só pelo Emitir, nunca sozinha (Liberação, ativação do Portal, CE,
  -- planilha de CE, vínculo de Cliente, reprocessamento de efeito). A
  -- reemissão automática da correção (cancelada com `reissue_requested_at`)
  -- continua.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT inv.status, inv.reissue_requested_at
      FROM public.invoices AS inv
      WHERE (inv.invoice_type = 'individual'
             AND EXISTS (SELECT 1 FROM public.invoice_bls AS ib WHERE ib.invoice_id = inv.id AND ib.bl_id = v_bl.id))
         OR (inv.invoice_type = 'consolidated'
             AND EXISTS (SELECT 1 FROM public.invoice_receivable_links AS l WHERE l.invoice_id = inv.id AND l.bl_id = v_bl.id)
             AND NOT EXISTS (SELECT 1 FROM public.invoice_bls AS ib2 WHERE ib2.bl_id = v_bl.id))
      ORDER BY inv.id DESC LIMIT 1) AS last_invoice
    WHERE last_invoice.status = 'cancelled' AND last_invoice.reissue_requested_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', 'invoice_cancelled_awaiting_emitir',
      'bl_id', v_bl.id
    );
  END IF;

  IF NULLIF(btrim(COALESCE(v_bl.ce_mercante, '')), '') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'ce_mercante_missing',
      'bl_id', v_bl.id
    );
  END IF;

  IF v_bl.customer_id IS NULL
     OR COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'customer_reconciliation_pending',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'customer_reconciliation_status', v_bl.customer_reconciliation_status
    );
  END IF;

  -- O worker carrega o iniciador no GUC antes de chamar esta função. Em uma
  -- chamada server-side direta, o ator explícito recebe o mesmo tratamento.
  -- Só altere a identidade depois das saídas idempotentes acima e restaure-a
  -- em qualquer caminho, para não vazar o ator para o restante da sessão.
  IF auth.uid() IS DISTINCT FROM v_actor THEN
    PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
    v_impersonated := true;
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Ator inativo para faturamento automático.' USING ERRCODE = '42501';
  END IF;

  -- O marcador é uma tabela temporária criada sob o owner do SECURITY
  -- DEFINER. O GUC só carrega o nome da tabela e é limpo antes de retornar.
  EXECUTE format(
    'CREATE TEMP TABLE pg_temp.%I (marker boolean NOT NULL) ON COMMIT DROP',
    v_context_table
  );
  v_context_created := true;
  EXECUTE format(
    'INSERT INTO pg_temp.%I(marker) VALUES (true)',
    v_context_table
  );
  PERFORM set_config('vela.billing_context_table', v_context_table, true);

  -- Taxas do dia do CE (decisão de 2026-09-24): ao abrir o gate, a fatura
  -- retida sai com o cálculo que a transição do CE já gravou. Só calcula
  -- quando o B/L nunca teve cálculo (não há cálculo do dia do CE a manter).
  -- `review_required` também é mantido: recalcular apagaria a revisão feita,
  -- e `mark_bl_ready_for_billing` recusa o B/L até a revisão terminar.
  -- ADR 0093, decisão 3: só o preço fica do dia do CE. Se a base mudou desde
  -- o cálculo (ficha, containers, irmão que chegou ou saiu), recalcula com o
  -- preço congelado.
  IF p_reuse_calculation
     AND v_bl.charge_status IN ('calculated', 'reviewed', 'ready_for_billing', 'review_required', 'exempt')
     AND public.bl_calculation_is_current(v_bl.id) THEN
    v_calculation := jsonb_build_object('bl_id', v_bl.id, 'status', v_bl.charge_status, 'reused', true);
  ELSE
    -- 385: a falha de cálculo sai marcada; o gatilho do CE a recusa (B3).
    BEGIN
      v_calculation := public.calculate_bl_local_charges(v_bl.id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl.id, SQLSTATE, SQLERRM);
    END;
  END IF;

  -- Isenção legítima não possui linha positiva para uma invoice. O CE foi
  -- processado corretamente, mas não há documento financeiro a emitir.
  IF v_calculation->>'status' = 'exempt' THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN v_calculation || jsonb_build_object('status', 'skipped', 'reason', 'exempt');
  END IF;

  -- Trava universal do Portal (ADR 0070): sem Portal pronto e sem Liberação
  -- de faturamento vigente, o CE calcula mas não emite. A retenção fica no
  -- B/L e sai pela ativação do Portal ou pela concessão da Liberação, que
  -- reprocessam o Cliente. Não é falha: a fila de efeitos não é acionada.
  IF NOT public.customer_billing_access_ready(v_bl.customer_id) THEN
    EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
    v_context_created := false;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    UPDATE public.bls
       SET billing_hold_reason = COALESCE(NULLIF(btrim(billing_hold_reason), ''), 'Acesso ao portal nao provisionado')
     WHERE id = v_bl.id;
    PERFORM public.reconcile_customer_bl_review_alerts(v_bl.customer_id, NULL, 'portal_billing_hold');
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;
    RETURN jsonb_build_object(
      'status', 'held',
      'reason', 'portal_not_provisioned',
      'bl_id', v_bl.id,
      'customer_id', v_bl.customer_id,
      'calculation', v_calculation
    );
  END IF;

  v_ready := public.mark_bl_ready_for_billing(v_bl.id, v_actor);
  v_invoice := public.create_invoice_from_bls_core(
    ARRAY[v_bl.id],
    v_bl.customer_id,
    'Sistema — CE Mercante: fatura automática após o registro do CE.',
    true,
    v_actor,
    'internal',
    NULL
  );

  IF NULLIF(v_invoice->>'invoice_id', '') IS NULL THEN
    RAISE EXCEPTION 'Emissão automática não retornou invoice para o B/L %.', v_bl.id
      USING ERRCODE = 'P0001';
  END IF;

  EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
  v_context_created := false;
  PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
  PERFORM public.link_invoice_to_ledger((v_invoice->>'invoice_id')::bigint);

  IF v_impersonated THEN
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
  END IF;

  RETURN jsonb_build_object(
    'status', 'invoiced',
    'idempotent', false,
    'bl_id', v_bl.id,
    'calculation', v_calculation,
    'ready', v_ready,
    'invoice', v_invoice
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
    IF v_context_created THEN
      EXECUTE format('DROP TABLE IF EXISTS pg_temp.%I', v_context_table);
      v_context_created := false;
    END IF;
    PERFORM set_config('vela.billing_context_table', COALESCE(v_previous_context_table, ''), true);
    IF v_impersonated THEN
      PERFORM set_config('request.jwt.claim.sub', COALESCE(v_previous_request_sub, ''), true);
    END IF;

    -- A atualização documental não é desfeita porque o efeito recuperável
    -- será criado pelo trigger. O worker registrará o bloqueio com o erro
    -- original e poderá ser reprocessado depois da correção operacional.
    RETURN jsonb_build_object(
      'status', 'blocked',
      'reason', 'auto_billing_failed',
      'bl_id', p_bl_id,
      'sqlstate', v_sqlstate,
      'message', left(regexp_replace(COALESCE(v_error_message, ''), '[[:cntrl:]]', ' ', 'g'), 1000)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public._calculate_bl_local_charges_impl_491(p_bl_id text, p_actor uuid DEFAULT NULL::uuid, p_recalculate boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_actor uuid;
  v_has_vehicles boolean := false;
  v_is_exempt boolean := false;
  v_is_lcl_movement boolean := false;
  v_auto_review boolean := false;
  v_line_count integer := 0;
  v_total_brl numeric(14,2) := 0;
  v_total_usd numeric(14,2) := 0;
  v_status text := 'calculated';
  v_reason text := NULL;
  v_no_containers boolean := false;
  v_qty_dual numeric(12,6) := 0;
  item record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa' USING ERRCODE = '42501';
  END IF;

  SELECT
    b.id,
    b.voyage_id,
    b.batch_id,
    COALESCE(b.cargo_mode, 'container') AS cargo_mode,
    b.customer_id,
    b.pod,
    NULLIF((to_jsonb(b)->>'bb_weight_ton'), '')::numeric AS bb_weight_ton,
    b.total_weight_kg,
    b.movement_to,
    b.financial_status,
    b.cancelled_at
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- F-28 (372): B/L cancelado é somente leitura também para o cálculo.
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado é somente leitura; reative o B/L para calcular.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_bl.financial_status IN ('invoiced', 'partially_paid', 'paid') THEN
    RAISE EXCEPTION 'B/L % já foi faturado (situação financeira: %): o recálculo manual não altera a fatura. Corrija os dados do B/L, que a fatura é corrigida automaticamente.', p_bl_id, public._financial_status_label(v_bl.financial_status) USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  -- ADR 0093, decisão 1: o cálculo usa e grava a tabela vinculada ao B/L.
  PERFORM public.bind_bl_local_charge_tables(p_bl_id);
  -- ADR 0094: o preço (tabela, Condição, data e câmbio) fica fixo no primeiro
  -- cálculo; itens de tabela vinculada depois entram com a data e o câmbio dele.
  PERFORM public.freeze_bl_prices(p_bl_id);
  -- ADR 0093, decisão 3: a base deste cálculo, para a emissão saber se ainda vale.
  INSERT INTO public.bl_charge_calculation_basis (bl_id, basis, calculated_at)
  VALUES (p_bl_id, public.bl_invoice_basis_snapshot(p_bl_id), now())
  ON CONFLICT (bl_id) DO UPDATE SET basis = EXCLUDED.basis, calculated_at = EXCLUDED.calculated_at;
  -- 491 (ADR 0111): alteração à mão cuja tabela saiu do B/L é descartada (POD
  -- novo, modalidade sem aquela tabela) ou passa para a tabela nova do mesmo
  -- escopo (preço refixado), com evento no Histórico das taxas.
  PERFORM public._reconcile_bl_charge_adjustments(p_bl_id);

  IF p_recalculate THEN
    DELETE FROM public.charge_calculations
    WHERE bl_id = p_bl_id
      AND COALESCE(source, 'auto') = 'auto';
  END IF;

  -- Checar isencao LCL de veiculos
  SELECT EXISTS(SELECT 1 FROM public.vehicles WHERE bl_id = p_bl_id)
  INTO v_has_vehicles;

  v_is_lcl_movement := v_bl.movement_to IS NOT NULL AND (
    UPPER(TRIM(v_bl.movement_to)) LIKE '%LCL%' OR UPPER(TRIM(v_bl.movement_to)) LIKE '%CFS%'
  );

  IF v_bl.cargo_mode = 'container' AND v_has_vehicles AND v_is_lcl_movement THEN
    v_is_exempt := true;
    v_reason := 'Carga de veiculos / LCL no destino (movement_to=' || v_bl.movement_to || ') com taxas pagas na origem';

    INSERT INTO public.charge_calculations (
      bl_id, source, status, calculation_key, quantity,
      unit_value_brl, total_value_brl, notes, review_reason, created_by, calculated_at
    )
    VALUES (
      p_bl_id, 'auto', 'exempt', 'exempt:lcl_vehicle', 1,
      0, 0, 'Linha sintetica de isencao', v_reason, v_actor, NOW()
    )
    ON CONFLICT (bl_id, calculation_key) DO UPDATE
      SET status = EXCLUDED.status,
          quantity = EXCLUDED.quantity,
          unit_value_brl = EXCLUDED.unit_value_brl,
          total_value_brl = EXCLUDED.total_value_brl,
          notes = EXCLUDED.notes,
          review_reason = EXCLUDED.review_reason,
          created_by = EXCLUDED.created_by,
          calculated_at = NOW();

    UPDATE public.bls
    SET charge_status = 'exempt',
        charges_calculated_at = NOW(),
        charge_exemption_reason = v_reason,
        billing_hold_reason = NULL
    WHERE id = p_bl_id;

    -- F-26 (372): o B/L que ficou isento anula o recebível em aberto.
    PERFORM public.sync_local_charge_receivable(p_bl_id);

    RETURN jsonb_build_object(
      'bl_id', p_bl_id, 'status', 'exempt', 'table_id', NULL,
      'line_count', 1, 'total_brl', 0, 'total_usd', 0,
      'review_required', false, 'exempt', true, 'reason', v_reason
    );
  END IF;

  -- Checagem de B/L de container sem containers
  IF v_bl.cargo_mode IN ('container', 'misto') THEN
    SELECT COUNT(*)
    INTO v_qty_dual
    FROM (
      SELECT 1 FROM public.bl_containers bc
      WHERE bc.bl_id = p_bl_id AND COALESCE(bc.is_imo, false) AND COALESCE(bc.is_oog, false)
    ) s;

    -- IMO e OOG ao mesmo tempo é cobrado pelo motor (THD normal + 150%, migration 129).

    IF v_bl.cargo_mode = 'container' THEN
      SELECT NOT EXISTS(
        SELECT 1 FROM public.bl_containers AS bc
        WHERE bc.bl_id = p_bl_id AND TRIM(COALESCE(bc.container_number, '')) <> ''
      ) INTO v_no_containers;

      IF v_no_containers THEN
        v_auto_review := true;
        INSERT INTO public.charge_calculations (
          bl_id, source, status, calculation_key, quantity,
          total_value_brl, review_reason, notes, created_by, calculated_at
        )
        VALUES (
          p_bl_id, 'auto', 'review_required', 'review:no_containers', 1,
          0, 'B/L de container sem containers cadastrados', 'Revisao manual obrigatoria', v_actor, NOW()
        )
        ON CONFLICT (bl_id, calculation_key) DO UPDATE
          SET status = EXCLUDED.status, quantity = EXCLUDED.quantity,
              total_value_brl = EXCLUDED.total_value_brl, review_reason = EXCLUDED.review_reason,
              notes = EXCLUDED.notes, created_by = EXCLUDED.created_by, calculated_at = NOW();
      END IF;
    END IF;
  END IF;

  -- Iterar linhas resolvidas por resolve_bl_local_charge_items (ADR 0069)
  -- 491: as linhas já vêm com as alterações à mão aplicadas e com o valor da
  -- tabela ao lado, para a tela.
  FOR item IN SELECT * FROM public._resolve_bl_local_charge_items_charged(p_bl_id, v_bl.pod) LOOP
    IF item.status = 'review_required' THEN
      v_auto_review := true;
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, source, status, calculation_key, quantity,
        total_value_brl, review_reason, notes, created_by, calculated_at
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.source, item.status, item.calculation_key,
        item.quantity, item.total_value_brl, item.review_reason, item.notes, v_actor, NOW()
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET status = EXCLUDED.status,
            quantity = EXCLUDED.quantity,
            total_value_brl = EXCLUDED.total_value_brl,
            review_reason = EXCLUDED.review_reason,
            notes = EXCLUDED.notes,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW();
    ELSE
      INSERT INTO public.charge_calculations (
        bl_id, charge_table_id, charge_item_id, quantity,
        unit_value_brl, unit_value_usd, total_value_brl, total_value_usd,
        override_applied, source, status, calculation_key,
        created_by, calculated_at,
        adjustment_id, table_unit_value_brl, table_unit_value_usd, table_total_value_brl, table_total_value_usd
      )
      VALUES (
        p_bl_id, item.charge_table_id, item.charge_item_id, item.quantity,
        item.unit_value_brl, item.unit_value_usd, item.total_value_brl, item.total_value_usd,
        item.override_applied, item.source, item.status, item.calculation_key,
        v_actor, NOW(),
        item.adjustment_id, item.table_unit_value_brl, item.table_unit_value_usd, item.table_total_value_brl, item.table_total_value_usd
      )
      ON CONFLICT (bl_id, calculation_key) DO UPDATE
        SET charge_table_id = EXCLUDED.charge_table_id,
            charge_item_id = EXCLUDED.charge_item_id,
            quantity = EXCLUDED.quantity,
            unit_value_brl = EXCLUDED.unit_value_brl,
            unit_value_usd = EXCLUDED.unit_value_usd,
            total_value_brl = EXCLUDED.total_value_brl,
            total_value_usd = EXCLUDED.total_value_usd,
            override_applied = EXCLUDED.override_applied,
            source = EXCLUDED.source,
            status = EXCLUDED.status,
            created_by = EXCLUDED.created_by,
            calculated_at = NOW(),
            adjustment_id = EXCLUDED.adjustment_id,
            table_unit_value_brl = EXCLUDED.table_unit_value_brl,
            table_unit_value_usd = EXCLUDED.table_unit_value_usd,
            table_total_value_brl = EXCLUDED.table_total_value_brl,
            table_total_value_usd = EXCLUDED.table_total_value_usd;
    END IF;
  END LOOP;

  -- 491 (D7): taxa com valor total alterado cuja quantidade mudou mantém o
  -- total e ganha o evento no Histórico das taxas.
  PERFORM public._track_bl_charge_adjustment_quantities(p_bl_id);

  SELECT COUNT(*),
         COALESCE(SUM(COALESCE(total_value_brl, 0)), 0),
         COALESCE(SUM(COALESCE(total_value_usd, 0)), 0)
  INTO v_line_count, v_total_brl, v_total_usd
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id;

  IF v_is_exempt THEN
    v_status := 'exempt';
  ELSIF v_auto_review THEN
    v_status := 'review_required';
  ELSIF v_line_count > 0 THEN
    v_status := 'calculated';
  ELSE
    v_status := 'not_calculated';
  END IF;

  UPDATE public.bls
  SET charge_status = v_status,
      charges_calculated_at = NOW(),
      charge_exemption_reason = CASE WHEN v_status = 'exempt' THEN v_reason ELSE NULL END,
      billing_hold_reason = CASE
        WHEN v_status = 'review_required' THEN 'Pendencia de revisao nas taxas locais.'
        WHEN v_status = 'not_calculated' THEN 'Nenhuma tabela de preco ou tarifa encontrada. Adicione os precos e recalcule.'
        ELSE NULL
      END
  WHERE id = p_bl_id;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  RETURN jsonb_build_object(
    'bl_id', p_bl_id,
    'status', v_status,
    'line_count', v_line_count,
    'total_brl', v_total_brl,
    'total_usd', v_total_usd,
    'review_required', v_auto_review,
    'exempt', (v_status = 'exempt'),
    'reason', COALESCE(v_reason, '')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._cancel_invoice_core(p_invoice_id bigint, p_reason text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice record;
  v_payment_count integer;
BEGIN
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a invoice.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', false);
  END IF;

  SELECT COUNT(*) INTO v_payment_count
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  IF v_payment_count > 0 THEN
    RAISE EXCEPTION 'Não é permitido cancelar invoice com pagamentos registrados.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
  SET
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by = p_actor,
    cancel_reason = TRIM(p_reason),
    balance_brl = GREATEST(COALESCE(total_brl, 0) - COALESCE(total_paid_brl, 0), 0)
  WHERE id = p_invoice_id;

  UPDATE public.billing_batches
  SET status = 'cancelled'
  WHERE invoice_id = p_invoice_id;

  UPDATE public.bls AS b
  SET financial_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib2
      JOIN public.invoices AS inv2 ON inv2.id = ib2.invoice_id
      WHERE ib2.bl_id = b.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
    ) THEN 'invoiced'
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_bls AS ib3
      JOIN public.invoices AS inv3 ON inv3.id = ib3.invoice_id
      WHERE ib3.bl_id = b.id
        AND inv3.id <> p_invoice_id
        AND COALESCE(inv3.status, 'issued') = 'paid'
    ) THEN 'paid'
    ELSE 'pending'
  END
  WHERE b.id IN (
    SELECT ib.bl_id
    FROM public.invoice_bls AS ib
    WHERE ib.invoice_id = p_invoice_id
  );

  UPDATE public.granite_bls AS gb
  SET charge_status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.invoice_granite_bls AS igb2
      JOIN public.invoices AS inv2 ON inv2.id = igb2.invoice_id
      WHERE igb2.granite_bl_id = gb.id
        AND inv2.id <> p_invoice_id
        AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue', 'paid')
    ) THEN 'invoiced'
    ELSE 'ready_for_billing'
  END
  WHERE gb.id IN (
    SELECT igb.granite_bl_id
    FROM public.invoice_granite_bls AS igb
    WHERE igb.invoice_id = p_invoice_id
  );

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'invoice', p_invoice_id::text, 'cancel_invoice',
    COALESCE(v_invoice.status, 'issued'), 'cancelled', p_actor, now(),
    TRIM(p_reason)
  );

  RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public._create_manual_invoice_core_272(p_customer_id bigint, p_item_name text, p_quantity numeric, p_unit_value_brl numeric, p_description text DEFAULT NULL::text, p_bl_id text DEFAULT NULL::text, p_voyage_id bigint DEFAULT NULL::bigint, p_actor uuid DEFAULT NULL::uuid, p_charge_item_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_quote jsonb; v_result jsonb; v_invoice bigint; v_pricing_version bigint; v_total numeric(14,2);
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;
  IF p_charge_item_id IS NULL THEN
    RETURN public._create_manual_invoice_custom_122(p_customer_id, p_item_name, p_quantity, p_unit_value_brl,
      p_description, p_bl_id, p_voyage_id, p_actor);
  END IF;
  IF nullif(btrim(p_bl_id), '') IS NULL THEN
    RAISE EXCEPTION 'B/L obrigatório para item da tabela.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.bls WHERE id = upper(btrim(p_bl_id)) AND customer_id = p_customer_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L não pertence ao cliente selecionado.' USING ERRCODE = '42501';
  END IF;
  v_quote := public.quote_manual_invoice_charge(p_bl_id, p_charge_item_id);
  v_total := (v_quote->>'total_brl')::numeric;
  v_result := public._create_manual_invoice_custom_122(p_customer_id, v_quote->>'charge_item_name',
    (v_quote->>'quantity')::numeric, (v_quote->>'unit_value_brl')::numeric,
    p_description, upper(btrim(p_bl_id)), p_voyage_id, p_actor);
  v_invoice := (v_result->>'invoice_id')::bigint;
  INSERT INTO public.pricing_rule_versions(version_key, charge_table_id, charge_item_id, customer_id, customer_rate_override_id, metadata)
    VALUES ('manual_invoice:' || v_invoice, (v_quote->>'charge_table_id')::bigint, p_charge_item_id,
      p_customer_id, (v_quote->>'override_id')::bigint, v_quote) RETURNING id INTO v_pricing_version;
  UPDATE public.invoice_items SET charge_item_id = p_charge_item_id, pricing_rule_version_id = v_pricing_version,
    charge_table_id = (v_quote->>'charge_table_id')::bigint,
    snapshot_payload = v_quote, currency = v_quote->>'currency',
    unit_value_usd = (v_quote->>'effective_unit_value_usd')::numeric,
    -- 383 (ADR 0094, B13): a linha em dólar mostra o unitário só em US$; o
    -- total em R$ é o total em US$ convertido de uma vez, como na taxa local.
    unit_value_brl = CASE WHEN v_quote->>'currency' = 'USD' THEN NULL ELSE unit_value_brl END,
    total_value_usd = (v_quote->>'total_usd')::numeric,
    total_value_brl = v_total
    WHERE invoice_id = v_invoice;
  -- O trigger do Pix só preenche payload vazio; montar com o total final.
  UPDATE public.invoices SET total_brl = v_total, balance_brl = v_total,
    pix_payload = public.build_transshipping_pix_payload(v_total, invoice_number)
    WHERE id = v_invoice;
  UPDATE public.invoice_lifecycle_events SET payload = payload || jsonb_build_object('total_brl', v_total, 'charge_item_id', p_charge_item_id)
    WHERE invoice_id = v_invoice AND event_type = 'issued';
  RETURN v_result || jsonb_build_object('total_brl', v_total, 'balance_brl', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public._list_invoice_details_legacy_134(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_type text;
  v_invoice jsonb;
  v_bls jsonb;
  v_items jsonb;
  v_containers jsonb;
  v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT invoice_type INTO v_invoice_type
  FROM public.invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice_type IS DISTINCT FROM 'manual' THEN
    RETURN public._list_invoice_details_legacy_20260926(p_invoice_id);
  END IF;

  SELECT to_jsonb(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf,
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  LEFT JOIN public.bls AS b ON b.id = i.bl_id
  LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', NULL::bigint,
    'invoice_id', p_invoice_id,
    'bl_id', b.id,
    'charge_status_snapshot', b.charge_status,
    'financial_status_snapshot', b.financial_status,
    'subtotal_brl', COALESCE((SELECT SUM(ii.total_value_brl) FROM public.invoice_items AS ii WHERE ii.invoice_id = p_invoice_id AND ii.bl_id = b.id), 0),
    'subtotal_usd', 0,
    'created_at', NULL,
    'charge_status', b.charge_status,
    'financial_status', b.financial_status,
    'pol', b.pol,
    'pod', b.pod,
    'voyage_number', v.voyage_number,
    'vessel_name', vs.name
  )), '[]'::jsonb)
  INTO v_bls
  FROM public.invoices AS i
  JOIN public.bls AS b ON b.id = i.bl_id
  LEFT JOIN public.voyages AS v ON v.id = COALESCE(i.voyage_id, b.voyage_id)
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(ii.*) ORDER BY ii.id), '[]'::jsonb)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'bl_id', c.bl_id,
    'container_number', c.container_number,
    'type', c.type,
    'seal_number', c.seal_number,
    'gross_weight_kg', c.gross_weight_kg
  ) ORDER BY c.container_number), '[]'::jsonb)
  INTO v_containers
  FROM public.bl_containers AS c
  JOIN public.invoices AS i ON i.bl_id = c.bl_id
  WHERE i.id = p_invoice_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::jsonb)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._list_invoice_details_legacy_20260926(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_payments JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(JSONB_AGG(
    TO_JSONB(ib.*) || jsonb_build_object(
      'charge_status', b.charge_status,
      'financial_status', b.financial_status,
      'pol', b.pol,
      'pod', b.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )
    ORDER BY ib.id
  ), '[]'::JSONB)
  INTO v_bls
  FROM public.invoice_bls AS ib
  JOIN public.bls AS b ON b.id = ib.bl_id
  LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE ib.invoice_id = p_invoice_id;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::JSONB)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'payments', v_payments
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._lock_bl_for_charge_change_491(p_bl_id text, p_justification text, p_actor uuid)
 RETURNS bls
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls;
  v_voyage text;
BEGIN
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo altera as taxas do B/L.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_justification, ''))) < 10 THEN
    RAISE EXCEPTION 'Justificativa obrigatória: escreva ao menos 10 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bl FROM public.bls b WHERE b.id = upper(btrim(COALESCE(p_bl_id, ''))) FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_bl.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'B/L % cancelado é somente leitura; reative o B/L para alterar as taxas.', v_bl.id USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(btrim(v.voyage_number), ''), v.id::text) INTO v_voyage
    FROM public.voyages v WHERE v.id = v_bl.voyage_id AND v.status = 'cancelled';
  IF FOUND THEN
    RAISE EXCEPTION 'Viagem % cancelada: operação selada e somente leitura.', v_voyage USING ERRCODE = '42501';
  END IF;
  -- 493 (D8): B/L faturado passa pela correção automática da fatura. A marca
  -- diz ao cálculo e ao registro do evento que esta transação é a ação do
  -- operador sobre este B/L.
  PERFORM set_config('vela.bl_charge_change', v_bl.id, true);
  RETURN v_bl;
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_get_demurrage_invoice_detail_core_unfiltered_20260920(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  
  v_invoice JSONB;
  v_items   JSONB;
BEGIN
  SELECT row_to_json(t)::jsonb INTO v_invoice
  FROM (
    SELECT di.*, c.name AS customer_name, c.cnpj_cpf AS customer_cnpj_cpf,
      b.pol, b.pod, v.voyage_number, vs.name AS vessel_name
    FROM public.demurrage_invoices di
    JOIN public.customers c ON c.id = di.customer_id
    JOIN public.bls b ON b.id = di.bl_id
    LEFT JOIN public.voyages v ON v.id = b.voyage_id
    LEFT JOIN public.vessels vs ON vs.id = v.vessel_id
    WHERE di.id = p_invoice_id
      AND di.customer_id = p_customer_id
      AND di.status IN ('issued', 'overdue', 'paid')
      AND public.bl_has_portal_release(di.bl_id)
  ) t;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % não encontrada ou acesso negado', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.id), '[]'::jsonb) INTO v_items
  FROM (SELECT * FROM public.demurrage_invoice_items WHERE invoice_id = p_invoice_id) t;

  RETURN jsonb_build_object('invoice', v_invoice, 'items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_inspect_guard(p_customer_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Inspeção do Portal requer usuário interno ativo.' USING ERRCODE = '42501';
  END IF;
  RETURN p_customer_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_invoice_details_before_correction_123(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public._portal_invoice_visible(p_customer_id, p_invoice_id) THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  v_result := public._portal_invoice_details_core_20260927(p_customer_id, p_invoice_id);

  IF v_result #>> '{invoice,invoice_type}' IS DISTINCT FROM 'manual' THEN
    v_result := jsonb_set(
      v_result,
      '{invoice}',
      (v_result->'invoice') - 'notes',
      true
    );
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._portal_invoice_details_core_unfiltered_20260920(p_customer_id bigint, p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  
  v_invoice JSONB;
  v_bls JSONB;
  v_items JSONB;
  v_containers JSONB;
  v_payments JSONB;
BEGIN
  SELECT TO_JSONB(i.*) || jsonb_build_object(
    'customer_name', c.name,
    'customer_cnpj_cpf', c.cnpj_cpf
  )
  INTO v_invoice
  FROM public.invoices AS i
  LEFT JOIN public.customers AS c ON c.id = i.customer_id
  WHERE i.id = p_invoice_id
    AND i.customer_id = p_customer_id;

  IF v_invoice IS NULL THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(JSONB_AGG(
    TO_JSONB(ib.*) || jsonb_build_object(
      'charge_status', b.charge_status,
      'financial_status', b.financial_status,
      'pol', b.pol,
      'pod', b.pod,
      'voyage_number', v.voyage_number,
      'vessel_name', vs.name
    )
    ORDER BY ib.id
  ), '[]'::JSONB)
  INTO v_bls
  FROM public.invoice_bls AS ib
  JOIN public.bls AS b ON b.id = ib.bl_id
  LEFT JOIN public.voyages AS v ON v.id = b.voyage_id
  LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
  WHERE ib.invoice_id = p_invoice_id;

  IF v_bls = '[]'::JSONB THEN
    -- Consolidated ledger invoices have no invoice_bls; build the BL summary
    -- rows from the receivable links (independente de invoice_items ja estar
    -- congelado ou nao).
    SELECT COALESCE(JSONB_AGG(
      jsonb_build_object(
        'id', l.id, 'invoice_id', p_invoice_id, 'bl_id', l.bl_id,
        'charge_status_snapshot', NULL, 'financial_status_snapshot', NULL,
        'subtotal_brl', l.subtotal_brl, 'subtotal_usd', 0, 'created_at', NULL,
        'pol', l.bl_snapshot->>'pol', 'pod', l.bl_snapshot->>'pod',
        'voyage_number', v.voyage_number, 'vessel_name', vs.name
      ) ORDER BY l.id
    ), '[]'::JSONB)
    INTO v_bls
    FROM public.invoice_receivable_links AS l
    LEFT JOIN public.voyages AS v ON v.id = (l.bl_snapshot->>'voyage_id')::bigint
    LEFT JOIN public.vessels AS vs ON vs.id = v.vessel_id
    WHERE l.invoice_id = p_invoice_id;
  END IF;

  SELECT COALESCE(JSONB_AGG(TO_JSONB(ii.*) ORDER BY ii.id), '[]'::JSONB)
  INTO v_items
  FROM public.invoice_items AS ii
  WHERE ii.invoice_id = p_invoice_id;

  IF v_items = '[]'::JSONB THEN
    -- Rede de seguranca: reconstroi ao vivo se, por algum motivo, esta
    -- consolidada nao tiver passado pelo backfill (migration 261). Mesma
    -- logica de reconciliacao usada na gravacao acima.
    WITH links AS (
      SELECT l.id AS link_id, l.bl_id, COALESCE(l.subtotal_brl, 0) AS subtotal_brl
      FROM public.invoice_receivable_links AS l
      WHERE l.invoice_id = p_invoice_id
    ),
    calcs AS (
      SELECT
        cc.bl_id,
        cc.id AS charge_calculation_id,
        cc.charge_table_id,
        cc.charge_item_id,
        cc.quantity,
        cc.unit_value_brl,
        cc.total_value_brl,
        cti.currency,
        cc.unit_value_usd,
        cc.total_value_usd,
        cc.calculation_key,
        cti.name AS charge_name
      FROM public.charge_calculations AS cc
      LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
      WHERE cc.bl_id IN (SELECT bl_id FROM links)
        AND COALESCE(cc.total_value_brl, 0) > 0
        AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing', 'exempt')
    ),
    bl_recon AS (
      SELECT
        links.bl_id,
        links.subtotal_brl,
        COUNT(calcs.charge_calculation_id) AS calc_count,
        COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
      FROM links
      LEFT JOIN calcs ON calcs.bl_id = links.bl_id
      GROUP BY links.bl_id, links.subtotal_brl
    ),
    detailed_items AS (
      SELECT
        calcs.bl_id,
        calcs.charge_calculation_id AS sort_key,
        jsonb_build_object(
          'id', calcs.charge_calculation_id,
          'invoice_id', p_invoice_id,
          'charge_calculation_id', calcs.charge_calculation_id,
          'description', 'BL ' || calcs.bl_id || ' - ' || COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa'),
          'quantity', COALESCE(calcs.quantity, 1),
          'unit_value_brl', calcs.unit_value_brl,
          'total_value_brl', COALESCE(calcs.total_value_brl, 0),
          'bl_id', calcs.bl_id,
          'manifest_id', NULL,
          'charge_table_id', calcs.charge_table_id,
          'charge_item_id', calcs.charge_item_id,
          'source', 'ledger',
          'currency', COALESCE(calcs.currency, 'BRL'),
          'unit_value_usd', calcs.unit_value_usd,
          'total_value_usd', calcs.total_value_usd
        ) AS item
      FROM calcs
      JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
      WHERE bl_recon.calc_count > 0
        AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
    ),
    fallback_items AS (
      SELECT
        links.bl_id,
        links.link_id AS sort_key,
        jsonb_build_object(
          'id', links.link_id,
          'invoice_id', p_invoice_id,
          'charge_calculation_id', NULL,
          'description', 'BL ' || links.bl_id || ' - Taxas locais',
          'quantity', 1,
          'unit_value_brl', links.subtotal_brl,
          'total_value_brl', links.subtotal_brl,
          'bl_id', links.bl_id,
          'manifest_id', NULL,
          'charge_table_id', NULL,
          'charge_item_id', NULL,
          'source', 'ledger',
          'currency', 'BRL',
          'unit_value_usd', NULL,
          'total_value_usd', NULL
        ) AS item
      FROM links
      JOIN bl_recon ON bl_recon.bl_id = links.bl_id
      WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01)
    ),
    all_items AS (
      SELECT bl_id, sort_key, item FROM detailed_items
      UNION ALL
      SELECT bl_id, sort_key, item FROM fallback_items
    )
    SELECT COALESCE(JSONB_AGG(item ORDER BY bl_id, sort_key), '[]'::JSONB)
    INTO v_items
    FROM all_items;
  END IF;

  WITH inv_bls AS (
    SELECT ib.bl_id FROM public.invoice_bls AS ib WHERE ib.invoice_id = p_invoice_id
    UNION
    SELECT irl.bl_id FROM public.invoice_receivable_links AS irl
    WHERE irl.invoice_id = p_invoice_id
  )
  SELECT COALESCE(JSONB_AGG(
    jsonb_build_object(
      'id', cont.id,
      'bl_id', cont.bl_id,
      'container_number', cont.container_number,
      'type', cont.type,
      'seal_number', cont.seal_number,
      'gross_weight_kg', cont.gross_weight_kg
    ) ORDER BY cont.bl_id, cont.container_number
  ), '[]'::JSONB)
  INTO v_containers
  FROM public.bl_containers AS cont
  WHERE cont.bl_id IN (SELECT bl_id FROM inv_bls);

  SELECT COALESCE(JSONB_AGG(TO_JSONB(p.*) ORDER BY p.paid_at DESC, p.id DESC), '[]'::JSONB)
  INTO v_payments
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice', v_invoice,
    'bls', v_bls,
    'items', v_items,
    'containers', v_containers,
    'payments', v_payments
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._register_invoice_correction_core(p_invoice_id bigint, p_receivable_id bigint, p_corrected_total_brl numeric, p_reason text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_invoice record; v_receivable record; v_difference numeric; v_offset numeric;
  v_refund numeric; v_refund_id bigint; v_id bigint; v_link record; v_balance numeric; v_available numeric;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  SELECT * INTO v_receivable FROM public.bl_receivables WHERE id = p_receivable_id FOR UPDATE;
  PERFORM 1 FROM public.invoices WHERE id IN
    (SELECT invoice_id FROM public.ledger_settlements WHERE receivable_id = p_receivable_id)
    ORDER BY id FOR UPDATE;
  v_difference := round(v_receivable.original_amount_brl - v_receivable.correction_amount_brl - p_corrected_total_brl, 2);
  IF v_difference <= 0 THEN
    RAISE EXCEPTION 'Correção exige valor menor que a cobrança vigente.' USING ERRCODE = '22023';
  END IF;
  v_offset := least(v_difference, v_receivable.balance_brl);
  v_refund := v_difference - v_offset;
  IF v_refund > 0 THEN
    -- Restitua somente recebimentos que financiaram este recebível. Uma
    -- consolidada pode conter outros B/Ls e não pode emprestar seu pagamento.
    v_available := v_refund;
    FOR v_link IN
      SELECT s.invoice_id, sum(s.amount_brl) - coalesce((SELECT sum(r.amount_brl)
        FROM public.invoice_refunds r WHERE r.invoice_id = s.invoice_id AND r.status <> 'cancelled'
        AND (r.correction_receivable_id = p_receivable_id
          OR (r.correction_receivable_id IS NULL AND r.origin = 'correction')
          OR EXISTS (SELECT 1 FROM public.cod_adjustments ca WHERE ca.id = r.cod_adjustment_id AND ca.bl_id = v_receivable.bl_id))), 0) AS available
      FROM public.ledger_settlements s WHERE s.receivable_id = p_receivable_id
      GROUP BY s.invoice_id ORDER BY s.invoice_id
    LOOP
      PERFORM 1 FROM public.invoices WHERE id = v_link.invoice_id FOR UPDATE;
      SELECT coalesce(i.total_paid_brl, 0) - coalesce((SELECT sum(r.amount_brl) FROM public.invoice_refunds r
        WHERE r.invoice_id = i.id AND r.status <> 'cancelled'), 0) INTO v_balance FROM public.invoices i WHERE i.id = v_link.invoice_id;
      -- Overpayments never funded a settlement. They reduce cash available at
      -- invoice level, not the receivable's allocated principal.
      v_balance := least(v_available, greatest(v_link.available, 0), greatest(v_balance, 0));
      IF v_balance > 0 THEN
        INSERT INTO public.invoice_refunds(invoice_id, amount_brl, origin, notes, registered_by, correction_receivable_id)
          VALUES (v_link.invoice_id, v_balance, 'correction', btrim(p_reason), p_actor, p_receivable_id)
          RETURNING id INTO v_refund_id;
        v_available := v_available - v_balance;
      END IF;
      EXIT WHEN v_available = 0;
    END LOOP;
    IF v_available > 0 THEN
      RAISE EXCEPTION 'Restituição excede os recebimentos disponíveis do recebível (%).', v_available USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.invoice_corrections(invoice_id, receivable_id, amount_brl, offset_brl, refund_brl,
    corrected_total_brl, reason, created_by) VALUES (p_invoice_id, p_receivable_id, v_difference, v_offset,
    v_refund, round(p_corrected_total_brl, 2), btrim(p_reason), p_actor) RETURNING id INTO v_id;
  UPDATE public.bl_receivables SET correction_amount_brl = correction_amount_brl + v_difference,
    updated_at = now() WHERE id = p_receivable_id;
  -- Fatura que zera sem ter recebido nada fica coberta pela que recebeu.
  FOR v_link IN SELECT DISTINCT i.id FROM public.invoices i JOIN public.invoice_receivable_links l ON l.invoice_id = i.id
    WHERE l.receivable_id = p_receivable_id AND i.status IN ('issued', 'overdue', 'partially_paid', 'paid') ORDER BY i.id
  LOOP
    SELECT coalesce(sum(br.balance_brl), 0) INTO v_balance FROM public.invoice_receivable_links l
      JOIN public.bl_receivables br ON br.id = l.receivable_id WHERE l.invoice_id = v_link.id
      AND l.status IN ('active', 'settled_by_this_invoice');
    UPDATE public.invoices SET balance_brl = v_balance,
      status = CASE WHEN v_balance = 0 AND coalesce(total_paid_brl, 0) = 0 AND id <> p_invoice_id THEN 'covered'
        WHEN v_balance = 0 THEN 'paid' WHEN total_paid_brl > 0 THEN 'partially_paid' ELSE status END,
      covered_by_invoice_id = CASE WHEN v_balance = 0 AND coalesce(total_paid_brl, 0) = 0 AND id <> p_invoice_id
        THEN p_invoice_id ELSE covered_by_invoice_id END
      WHERE id = v_link.id;
  END LOOP;
  UPDATE public.invoice_receivable_links SET status = 'settled_by_this_invoice'
    WHERE invoice_id = p_invoice_id AND receivable_id = p_receivable_id AND v_receivable.balance_brl - v_offset = 0;
  UPDATE public.invoice_receivable_links SET status = 'settled_elsewhere'
    WHERE invoice_id <> p_invoice_id AND receivable_id = p_receivable_id AND status = 'active' AND v_receivable.balance_brl - v_offset = 0;
  UPDATE public.bls SET financial_status = 'paid'
    WHERE id = v_receivable.bl_id AND v_receivable.balance_brl - v_offset = 0;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'correction', jsonb_build_object('correction_id', v_id,
      'offset_brl', v_offset, 'refund_brl', v_refund, 'refund_id', v_refund_id)::text, p_actor, btrim(p_reason));
  UPDATE public.cod_adjustments SET status = 'settled', applied_correction_id = v_id,
    resulting_document_id = coalesce(v_refund_id, p_invoice_id),
    resulting_document_type = CASE WHEN v_refund_id IS NULL THEN 'invoice' ELSE 'refund' END
    WHERE id = nullif(coalesce(nullif(current_setting('vela.cod_basis_events', true), ''), '{}')::jsonb->>v_receivable.bl_id, '')::bigint
      AND status = 'pending' AND action IN ('refund_overpayment', 'offset_open_balance');
  RETURN jsonb_build_object('correction_id' , v_id, 'offset_brl', v_offset, 'refund_brl', v_refund,
    'refund_id', v_refund_id, 'balance_brl', greatest(v_receivable.balance_brl - v_offset, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public._reverse_invoice_payment_impl_109(p_payment_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment RECORD;
  v_invoice RECORD;
  v_settlement RECORD;
  v_unsettled_invoice_ids BIGINT[];
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_actor UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão.' USING ERRCODE = '42501';
  END IF;

  -- Justificativa obrigatoria para cancelar a baixa.
  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento % não encontrado.', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = v_payment.invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', v_payment.invoice_id USING ERRCODE = 'P0002';
  END IF;

  -- Reverte cada settlement, restaurando o receivable
  FOR v_settlement IN
    SELECT * FROM public.ledger_settlements
    WHERE payment_id = p_payment_id
    ORDER BY id
  LOOP
    UPDATE public.bl_receivables
    SET
      settled_amount_brl = GREATEST(COALESCE(settled_amount_brl, 0) - v_settlement.amount_brl, 0),
      balance_brl = COALESCE(balance_brl, 0) + v_settlement.amount_brl,
      status = CASE
        WHEN GREATEST(COALESCE(balance_brl, 0) + v_settlement.amount_brl, 0) >= original_amount_brl THEN 'open'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_settlement.receivable_id;
  END LOOP;

  DELETE FROM public.ledger_settlements WHERE payment_id = p_payment_id;

  -- Restaura invoice_receivable_links que foram afetados por este pagamento
  UPDATE public.invoice_receivable_links irl
  SET status = 'active'
  WHERE irl.invoice_id = v_payment.invoice_id
    AND irl.status = 'settled_by_this_invoice'
    AND COALESCE(v_invoice.status, '') <> 'obsolete'
    AND EXISTS (
      SELECT 1 FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl > 0
    );

  -- Recalcula totais da invoice
  SELECT COALESCE(SUM(COALESCE(balance_brl, 0)), 0)
  INTO v_balance
  FROM public.bl_receivables
  WHERE id IN (
    SELECT receivable_id FROM public.invoice_receivable_links
    WHERE invoice_id = v_payment.invoice_id
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = v_payment.invoice_id
    AND id <> p_payment_id;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = CASE WHEN COALESCE(v_invoice.status, '') = 'obsolete' THEN 0 ELSE GREATEST(v_balance, 0) END,
    -- Libera o TXID conciliado para que o mesmo PIX possa ser reconciliado de novo.
    pix_txid = NULL,
    conciliated_by_extract = false,
    status = CASE
      WHEN COALESCE(v_invoice.status, '') = 'covered' THEN 'covered'
      WHEN COALESCE(v_invoice.status, '') = 'obsolete' THEN 'obsolete'
      WHEN v_total_paid <= 0 AND GREATEST(v_balance, 0) >= (SELECT COALESCE(SUM(original_amount_brl), 0) FROM public.bl_receivables WHERE id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)) THEN 'issued'
      WHEN v_total_paid <= 0 THEN 'issued'
      WHEN GREATEST(v_balance, 0) <= 0 THEN 'paid'
      ELSE 'partially_paid'
    END
  WHERE id = v_payment.invoice_id;

  -- F-04 (migration 356): desfaz só o que este documento causou.
  IF COALESCE(v_invoice.status, '') IN ('paid', 'partially_paid') THEN
    -- Individuais cobertas por esta fatura: só os vínculos delas.
    UPDATE public.invoice_receivable_links irl
    SET status = 'active'
    WHERE irl.status = 'settled_elsewhere'
      AND irl.invoice_id IN (SELECT ind.id FROM public.invoices ind
                             WHERE ind.covered_by_invoice_id = v_payment.invoice_id AND ind.status = 'covered')
      AND EXISTS (SELECT 1 FROM public.bl_receivables br WHERE br.id = irl.receivable_id AND br.balance_brl > 0);
    UPDATE public.invoices ind
    SET status = 'issued', covered_by_invoice_id = NULL
    WHERE ind.covered_by_invoice_id = v_payment.invoice_id
      AND ind.status = 'covered'
      AND EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = ind.id AND l.status = 'active');

    -- Consolidada obsoletada por este pagamento, sem sucessora e sem B/L em
    -- outra consolidada aberta.
    FOR v_settlement IN
      SELECT DISTINCT c.id
      FROM public.invoice_lifecycle_events e
      JOIN public.invoices c ON c.id = e.invoice_id
      WHERE e.event_type = 'obsolete'
        AND e.payload->>'paid_invoice_id' = v_payment.invoice_id::text
        AND c.status = 'obsolete'
        AND NOT EXISTS (SELECT 1 FROM public.invoices s WHERE s.replaces_invoice_id = c.id)
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l
        JOIN public.invoice_receivable_links l2 ON l2.receivable_id = l.receivable_id AND l2.status = 'active'
        JOIN public.invoices o ON o.id = l2.invoice_id
        WHERE l.invoice_id = v_settlement.id AND o.id <> v_settlement.id
          AND o.invoice_type = 'consolidated' AND coalesce(o.status, 'issued') IN ('draft', 'issued', 'partially_paid')
      ) THEN
        UPDATE public.invoices SET status = 'issued', obsolete_reason = NULL WHERE id = v_settlement.id;
        UPDATE public.invoice_receivable_links SET status = 'active'
         WHERE invoice_id = v_settlement.id AND status = 'obsolete';
      END IF;
    END LOOP;
  END IF;

  -- 385: documentos vivos dos mesmos recebíveis mostram o saldo que voltou.
  UPDATE public.invoices i SET balance_brl = s.balance
  FROM (
    SELECT l.invoice_id, COALESCE(SUM(r.balance_brl), 0) AS balance
    FROM public.invoice_receivable_links l JOIN public.bl_receivables r ON r.id = l.receivable_id
    WHERE l.status = 'active'
      AND l.invoice_id IN (
        SELECT l2.invoice_id FROM public.invoice_receivable_links l2
        WHERE l2.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id)
          AND l2.invoice_id <> v_payment.invoice_id)
    GROUP BY l.invoice_id
  ) s
  WHERE i.id = s.invoice_id
    AND i.invoice_type IN ('individual', 'consolidated')
    AND COALESCE(i.status, 'issued') IN ('issued', 'partially_paid', 'overdue')
    AND i.balance_brl IS DISTINCT FROM s.balance;

  -- Atualiza financial_status dos BLs vinculados.
  -- bls.financial_status so aceita 'pending','invoiced','paid','cancelled'
  -- (constraint bls_financial_status_check). Ao cancelar a baixa, o BL volta a
  -- 'invoiced' quando ainda ha saldo, ou 'paid' se tudo continua liquidado.
  UPDATE public.bls b
  SET financial_status = (
    SELECT CASE
      WHEN COUNT(*) FILTER (WHERE br.balance_brl > 0) = 0 THEN 'paid'
      ELSE 'invoiced'
    END
    FROM public.bl_receivables br
    WHERE br.bl_id = b.id
  )
  WHERE b.id IN (
    SELECT br.bl_id FROM public.bl_receivables br
    WHERE br.id IN (
      SELECT receivable_id FROM public.invoice_receivable_links
      WHERE invoice_id = v_payment.invoice_id
    )
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', v_payment.invoice_id::TEXT, 'payment_reversed',
    COALESCE(v_invoice.status, '?') || ' total_paid=' || COALESCE(v_invoice.total_paid_brl::TEXT, '?'),
    (SELECT COALESCE(status, '?') || ' total_paid=' || COALESCE(total_paid_brl::TEXT, '?') FROM public.invoices WHERE id = v_payment.invoice_id),
    v_actor, now(),
    TRIM(p_reason)
  );

  DELETE FROM public.payments WHERE id = p_payment_id;

  -- Saldos das demais faturas ligadas voltam com o recebível (decisão 6).
  PERFORM public._reproject_invoices_for_receivables(v_payment.invoice_id,
    ARRAY(SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = v_payment.invoice_id), v_actor);

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'invoice_id', v_payment.invoice_id,
    'new_status', (SELECT status FROM public.invoices WHERE id = v_payment.invoice_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._run_import_effect_local_charges(p_entity_id text, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_origin public.bls%ROWTYPE;
  v_voyage_id bigint;
  v_container_numbers text[];
  v_bl_ids text[] := ARRAY[]::text[];
  v_current_bl_id text;
  v_result jsonb := '[]'::jsonb;
  v_calculated integer := 0;
  v_one jsonb;
  v_sqlstate text;
  v_wait text;
BEGIN
  SELECT * INTO v_origin FROM public.bls WHERE id = NULLIF(btrim(p_entity_id), '') FOR UPDATE;

  IF FOUND THEN
    v_voyage_id := v_origin.voyage_id;
    IF COALESCE(v_origin.financial_status, 'pending') <> 'pending'
       OR cardinality(public._live_local_invoice_ids_for_bl(v_origin.id)) > 0 THEN
      RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', 0,
        'results', jsonb_build_array(jsonb_build_object('status', 'already_invoiced', 'idempotent', true,
          'bl_id', v_origin.id, 'financial_status', v_origin.financial_status)));
    END IF;

    IF NULLIF(btrim(COALESCE(v_origin.ce_mercante, '')), '') IS NOT NULL THEN
      -- CE gravado: o cálculo do dia do CE vale (ADR 0070, nota 2026-09-24 b).
      v_one := public._auto_bill_bl_core(v_origin.id, p_actor, true);
    ELSE
      v_one := public.calculate_bl_local_charges(v_origin.id, p_actor, true);
    END IF;
    v_result := jsonb_build_array(v_one);
    v_calculated := 1;

    -- Irmãos de container (o rateio muda): todos os não faturados, inclusive
    -- com CE ou retidos (ADR 0093, decisão 3: o preço do CE fica congelado, a
    -- base não). Carga solta não tem container e não toca a Viagem.
    SELECT COALESCE(array_agg(DISTINCT upper(btrim(c.container_number))), ARRAY[]::text[])
      INTO v_container_numbers
    FROM public.bl_containers AS c
    WHERE c.bl_id = v_origin.id AND NULLIF(btrim(c.container_number), '') IS NOT NULL;

    IF cardinality(v_container_numbers) > 0 THEN
      SELECT COALESCE(array_agg(DISTINCT b.id ORDER BY b.id), ARRAY[]::text[]) INTO v_bl_ids
      FROM public.bls AS b
      JOIN public.bl_containers AS c ON c.bl_id = b.id
      WHERE b.voyage_id = v_voyage_id
        AND b.id <> v_origin.id
        AND b.cancelled_at IS NULL
        AND COALESCE(b.financial_status, 'pending') = 'pending'
        AND cardinality(public._live_local_invoice_ids_for_bl(b.id)) = 0
        AND upper(btrim(c.container_number)) = ANY(v_container_numbers);
    END IF;
  ELSE
    IF NULLIF(btrim(p_entity_id), '') IS NULL OR p_entity_id !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Entidade de efeito local desconhecida: %.', p_entity_id USING ERRCODE = 'P0002';
    END IF;
    SELECT v.id INTO v_voyage_id FROM public.voyages AS v WHERE v.id = p_entity_id::bigint;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem de efeito local não encontrada: %.', p_entity_id USING ERRCODE = 'P0002';
    END IF;
    -- Efeito da Viagem: só B/Ls provisórios (sem CE, sem retenção).
    SELECT COALESCE(array_agg(b.id ORDER BY b.id), ARRAY[]::text[]) INTO v_bl_ids
    FROM public.bls AS b
    WHERE b.voyage_id = v_voyage_id
      AND b.cancelled_at IS NULL
      AND COALESCE(b.cargo_mode, 'container') IN ('container', 'carga_solta', 'misto')
      AND COALESCE(b.financial_status, 'pending') = 'pending'
      AND NULLIF(btrim(COALESCE(b.ce_mercante, '')), '') IS NULL
      AND NULLIF(btrim(COALESCE(b.billing_hold_reason, '')), '') IS NULL;
  END IF;

  FOREACH v_current_bl_id IN ARRAY v_bl_ids LOOP
    v_result := v_result || jsonb_build_array(public.calculate_bl_local_charges(v_current_bl_id, p_actor, true));
    v_calculated := v_calculated + 1;
  END LOOP;

  -- 394 (ADR 0095, decisão 18): B/L em Revisão ou sem tabela é espera de
  -- negócio. O efeito fica aguardando, sem Alerta crítico, e conclui sozinho.
  IF v_one IS NOT NULL AND v_one->>'status' = 'blocked' THEN
    v_wait := public._import_effect_business_wait(v_origin.id, v_one->>'reason');
    IF v_wait IS NOT NULL THEN
      RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', v_calculated, 'results', v_result,
        'bl_id', v_origin.id, 'business_wait', v_wait,
        'wait_message', public._import_effect_wait_message(v_wait, v_origin.id));
    END IF;
  END IF;

  IF v_one IS NOT NULL AND v_one->>'status' = 'blocked' AND v_one->>'reason' = 'auto_billing_failed' THEN
    -- O SQLSTATE original decide entre nova tentativa e bloqueio.
    v_sqlstate := COALESCE(NULLIF(v_one->>'sqlstate', ''), 'P0001');
    IF v_sqlstate !~ '^[0-9A-Z]{5}$' THEN v_sqlstate := 'P0001'; END IF;
    RAISE EXCEPTION 'Faturamento automático do B/L % bloqueado: %', v_origin.id,
      COALESCE(v_one->>'message', 'falha desconhecida')
      USING ERRCODE = v_sqlstate;
  END IF;

  RETURN jsonb_build_object('entity_id', p_entity_id, 'calculated', v_calculated, 'results', v_result);
END;
$function$;

CREATE OR REPLACE FUNCTION public._set_agency_report_terminal_impl_20260920(p_voyage_id bigint, p_port text, p_terminal text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_report_id UUID;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;
  IF v_role NOT IN ('administrativo', 'operacoes') THEN
    RAISE EXCEPTION 'Terminal pertence ao departamento operações.' USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  UPDATE public.agency_departure_reports
  SET terminal = NULLIF(btrim(p_terminal), '')
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar terminal.' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._set_bl_ce_mercante(p_bl_id text, p_ce text, p_actor uuid, p_reason text, p_source text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ce text := NULLIF(regexp_replace(COALESCE(p_ce, ''), '\s', '', 'g'), '');
  v_old text;
  v_old_ce text;
  v_previous text := current_setting('vela.ce_mercante_port', true);
  v_result text;
BEGIN
  IF v_ce IS NOT NULL AND v_ce !~ '^[0-9]{15}$' THEN
    RAISE EXCEPTION 'CE Mercante invalido para o B/L %: o CE tem 15 digitos (recebido "%").', p_bl_id, p_ce
      USING ERRCODE = '22023';
  END IF;

  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  v_old_ce := NULLIF(btrim(COALESCE(v_old, '')), '');
  IF v_old_ce IS NOT DISTINCT FROM v_ce THEN
    RETURN 'unchanged';
  END IF;

  -- Mesmo CE em outro formato (máscara, zero à esquerda): a prévia mostra "Sem
  -- mudança"; grava a forma canônica sem reenvio nem alerta (K10).
  IF v_old_ce IS NOT NULL AND v_ce IS NOT NULL
     AND public.ce_mercante_key(v_old_ce) = public.ce_mercante_key(v_ce) THEN
    PERFORM set_config('vela.ce_mercante_port', 'on', true);
    PERFORM public._audit_skip_once('bls', p_bl_id, 'ce_mercante');
    UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
    PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);
    INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('bl', p_bl_id, 'ce_mercante', v_old, v_ce, p_actor,
      concat_ws(' · ', 'Formato do CE Mercante normalizado (mesmo número)', NULLIF(btrim(COALESCE(p_reason, '')), '')));
    RETURN 'unchanged';
  END IF;

  PERFORM set_config('vela.ce_mercante_port', 'on', true);
  -- O fato vai no Histórico abaixo, com motivo; o gatilho genérico não repete.
  PERFORM public._audit_skip_once('bls', p_bl_id, 'ce_mercante');
  UPDATE public.bls SET ce_mercante = v_ce WHERE id = p_bl_id;
  PERFORM set_config('vela.ce_mercante_port', COALESCE(v_previous, 'off'), true);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('bl', p_bl_id, 'ce_mercante', COALESCE(v_old, ''), COALESCE(v_ce, ''), p_actor, p_reason);

  v_result := CASE
    WHEN v_ce IS NULL THEN 'removed'
    WHEN v_old_ce IS NULL THEN 'inserted'
    ELSE 'overwritten'
  END;

  -- Comunicado de CE e Taxas já enviado com o CE anterior: o Cliente precisa
  -- recebê-lo de novo (ADR 0078, itens 4 e 5).
  IF v_result <> 'inserted' AND EXISTS (
    SELECT 1 FROM public.customer_communications AS c
    JOIN public.customer_communication_bls AS cb ON cb.communication_id = c.id
    WHERE cb.bl_id = p_bl_id AND c.kind = 'ce_mercante_taxas' AND c.status IN ('enviado', 'parcial', 'simulado')
  ) THEN
    BEGIN
      PERFORM public.upsert_alert_item(
        'comunicado_ce_reenvio_pendente', 'bl', p_bl_id,
        format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Comunicado de CE e Taxas: reenvie o Comunicado ao Cliente.',
          p_bl_id, COALESCE(v_old, 'sem CE'), COALESCE(v_ce, 'removido')),
        p_source,
        jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old, 'new_ce', v_ce, 'reason', p_reason),
        '/bls/' || p_bl_id
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Nao foi possivel abrir a pendencia de reenvio do B/L %: %', p_bl_id, SQLERRM;
    END;
  END IF;

  -- Troca ou remoção depois do Desbloqueio de CE conferido, por qualquer porta
  -- (planilha ou ficha): abre o alerta (ADR 0078, itens 2 e 4; K2). Conferido
  -- é a conciliação ZPT do CE anterior (migration 230, B1).
  IF v_result <> 'inserted' AND public._bl_ce_unlock_conferred(p_bl_id, v_old_ce) THEN
    PERFORM public.upsert_alert_item(
      'ce_trocado_com_desbloqueio', 'bl', p_bl_id,
      CASE WHEN v_ce IS NULL
        THEN format('O CE Mercante do B/L %s foi removido (era %s) depois do Desbloqueio de CE conferido.', p_bl_id, v_old_ce)
        ELSE format('O CE Mercante do B/L %s mudou (%s -> %s) depois do Desbloqueio de CE conferido.', p_bl_id, v_old_ce, v_ce)
      END,
      p_source,
      jsonb_build_object('bl_id', p_bl_id, 'old_ce', v_old_ce, 'new_ce', v_ce, 'reason', p_reason),
      '/bls/' || p_bl_id);
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._sync_local_charge_receivable_before_correction_123(p_bl_id text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl RECORD;
  v_amount NUMERIC(14,2);
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
  v_paid_amount NUMERIC(14,2);
  v_receivable_id BIGINT;
  v_status TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  -- Igualdade em `id` usa a chave primária; a comparação sem caixa só roda
  -- quando o id exato não existe (migration 180, M07).
  SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
  INTO v_bl
  FROM public.bls
  WHERE id = btrim(p_bl_id);
  IF NOT FOUND THEN
    SELECT id, customer_id, voyage_id, cargo_mode, pol, pod
    INTO v_bl
    FROM public.bls
    WHERE UPPER(id) = UPPER(btrim(p_bl_id))
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- Se o B/L ainda nao tem cliente vinculado, a sincronizacao de recebivel
  -- aguarda a conciliacao cadastral (reconcile/relink). O calculo das taxas
  -- locais permanece preservado.
  IF v_bl.customer_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ADR 0094: o câmbio é o fixado no primeiro cálculo do B/L.
  SELECT r.roe, r.effective_date INTO v_roe, v_roe_effective_date
  FROM public._bl_fixed_roe(v_bl.id) r;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1 FROM public.charge_calculations AS cc
    WHERE cc.bl_id = v_bl.id
      AND COALESCE(cc.total_value_usd, 0) > 0
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ) THEN
    RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível calcular o saldo de linhas em USD.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)
  ), 0)
  INTO v_amount
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = v_bl.id
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  SELECT COALESCE(SUM(p.amount_brl), 0)
  INTO v_paid_amount
  FROM public.invoice_bls ib
  JOIN public.invoices i ON i.id = ib.invoice_id
  JOIN public.payments p ON p.invoice_id = i.id
  WHERE ib.bl_id = v_bl.id
    AND COALESCE(i.status, 'issued') = 'paid'
    AND i.customer_id = v_bl.customer_id
    AND NOT EXISTS (SELECT 1 FROM public.invoice_customer_changes c
      WHERE c.bl_id = v_bl.id AND i.id = ANY(c.original_invoice_ids)
        AND c.status IN ('reissue_pending', 'completed'));

  v_paid_amount := LEAST(v_paid_amount, v_amount);
  v_status := CASE
    WHEN v_amount <= 0 THEN 'void'
    WHEN v_paid_amount >= v_amount THEN 'settled'
    WHEN v_paid_amount > 0 THEN 'partially_settled'
    ELSE 'open'
  END;

  INSERT INTO public.bl_receivables (
    bl_id, customer_id, source, original_amount_brl, settled_amount_brl, balance_brl,
    status, voyage_id, cargo_mode, pol, pod, roe_frozen, roe_effective_date_frozen, updated_at
  )
  VALUES (
    v_bl.id, v_bl.customer_id, 'local_charges', v_amount, v_paid_amount,
    GREATEST(v_amount - v_paid_amount, 0), v_status, v_bl.voyage_id,
    v_bl.cargo_mode, v_bl.pol, v_bl.pod, v_roe, v_roe_effective_date, now()
  )
  ON CONFLICT (source, bl_id)
  DO UPDATE SET
    customer_id = EXCLUDED.customer_id,
    original_amount_brl = EXCLUDED.original_amount_brl,
    settled_amount_brl = EXCLUDED.settled_amount_brl,
    balance_brl = EXCLUDED.balance_brl,
    status = EXCLUDED.status,
    voyage_id = EXCLUDED.voyage_id,
    cargo_mode = EXCLUDED.cargo_mode,
    pol = EXCLUDED.pol,
    pod = EXCLUDED.pod,
    roe_frozen = EXCLUDED.roe_frozen,
    roe_effective_date_frozen = EXCLUDED.roe_effective_date_frozen,
    updated_at = now()
  RETURNING id INTO v_receivable_id;

  RETURN v_receivable_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_cod_financial_effect_legacy_130(p_bl_id text, p_omission_id bigint, p_previous_pod text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_bl RECORD;
  v_invoice_id BIGINT;
  v_invoice_snapshot_total NUMERIC(14,2) := 0;
  v_invoice_snapshot_count INTEGER := 0;
  v_previous_adjustment_total NUMERIC(14,2) := 0;
  v_previous_adjustment_count INTEGER := 0;
  v_original_total NUMERIC(14,2) := 0;
  v_new_total NUMERIC(14,2) := 0;
  v_manual_total NUMERIC(14,2) := 0;
  v_paid_amount NUMERIC(14,2) := 0;
  v_outstanding NUMERIC(14,2) := 0;
  v_difference NUMERIC(14,2) := 0;
  v_offset_amount NUMERIC(14,2) := 0;
  v_refund_amount NUMERIC(14,2) := 0;
  v_action TEXT;
  v_manual_review BOOLEAN := false;
  v_has_manual_lines BOOLEAN := false;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.pod, b.financial_status
  INTO v_bl
  FROM public.bls AS b
  WHERE b.id = p_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- ADR 0094: o COD muda a tabela (POD novo), não o câmbio fixado.
  SELECT r.roe, r.effective_date
  INTO v_roe, v_roe_effective_date
  FROM public._bl_fixed_roe(p_bl_id) r;

  IF v_roe IS NULL AND EXISTS (
    SELECT 1
    FROM public.charge_calculations AS cc
    WHERE cc.bl_id = p_bl_id
      AND COALESCE(cc.total_value_usd, 0) > 0
  ) THEN
    RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível calcular linhas em USD.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(cc.total_value_brl,
      CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
        THEN ROUND(cc.total_value_usd * v_roe, 2)
      END,
      0)), 0),
    BOOL_OR(COALESCE(cc.source, 'auto') = 'manual')
  INTO v_original_total, v_has_manual_lines
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id;

  v_original_total := ROUND(COALESCE(v_original_total, 0), 2);
  v_has_manual_lines := COALESCE(v_has_manual_lines, false);

  SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
    CASE WHEN COALESCE(cc.total_value_usd, 0) > 0
      THEN ROUND(cc.total_value_usd * v_roe, 2)
    END,
    0)), 0)
  INTO v_manual_total
  FROM public.charge_calculations AS cc
  WHERE cc.bl_id = p_bl_id
    AND COALESCE(cc.source, 'auto') = 'manual';
  v_manual_total := ROUND(COALESCE(v_manual_total, 0), 2);

  -- Pending/non-invoiced B/Ls use the existing writing calculator. Manual
  -- rows are source = manual, so calculate_bl_local_charges deletes only auto
  -- rows and preserves their operator-entered intent.
  IF COALESCE(v_bl.financial_status, 'pending') NOT IN ('invoiced', 'partially_paid', 'paid') THEN
    PERFORM public.calculate_bl_local_charges(
      p_bl_id => p_bl_id,
      p_actor => v_actor,
      p_recalculate => true
    );

    IF v_has_manual_lines THEN
      SELECT COALESCE(SUM(COALESCE(cc.total_value_brl,
        CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN ROUND(cc.total_value_usd * v_roe, 2) END, 0)), 0)
      INTO v_new_total
      FROM public.charge_calculations AS cc
      WHERE cc.bl_id = p_bl_id;
      v_new_total := ROUND(COALESCE(v_new_total, 0), 2);
      v_difference := ROUND(v_new_total - v_original_total, 2);
      v_action := 'manual_charge_review';
      v_manual_review := true;
    ELSE
      RETURN;
    END IF;
  ELSE
    -- Billed states must never call the writing calculator: it intentionally
    -- rejects these states. The 311 helper is the single price-resolution
    -- source for both the previous and already-updated destination PODs.
    -- A ponta nova é uma prévia do destino atual. Linhas em USD precisam do
    -- ROE autoritativo do evento; total_value_brl é nulo nessas linhas.
    SELECT r.roe, r.effective_date
    INTO v_roe, v_roe_effective_date
    FROM public._bl_fixed_roe(p_bl_id) r;

    IF v_roe IS NULL AND EXISTS (
      SELECT 1
      FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item
      WHERE COALESCE(item.total_value_usd, 0) > 0
    ) THEN
      RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível reprecificar linhas em USD.'
        USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(SUM(
      COALESCE(item.total_value_brl,
        CASE WHEN COALESCE(item.total_value_usd, 0) > 0
          THEN ROUND(item.total_value_usd * v_roe, 2)
        END,
        0)
    ), 0)
    INTO v_new_total
    FROM public.resolve_bl_local_charge_items(p_bl_id, v_bl.pod) AS item;
    v_new_total := ROUND(COALESCE(v_new_total, 0) + v_manual_total, 2);

    -- A ponta original não é a tabela vigente do POD antigo. O documento que
    -- efetivamente faturou o B/L (invoice_bls, inclusive consolidadas) é o
    -- snapshot monetário; invoice_items/invoices são fallbacks legados.
    SELECT i.id
    INTO v_invoice_id
    FROM public.invoices AS i
    WHERE COALESCE(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
      AND (i.bl_id = p_bl_id OR EXISTS (
        SELECT 1 FROM public.invoice_bls AS ib
        WHERE ib.invoice_id = i.id AND ib.bl_id = p_bl_id
      ))
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
    LIMIT 1;

    IF v_invoice_id IS NOT NULL THEN
      SELECT COALESCE(SUM(ib.subtotal_brl), 0), COUNT(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = v_invoice_id AND ib.bl_id = p_bl_id;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(SUM(COALESCE(
          ii.total_value_brl,
          CASE WHEN COALESCE(ii.total_value_usd, 0) > 0
            THEN ROUND(ii.total_value_usd * NULLIF(ii.snapshot_payload->>'roe', '')::NUMERIC, 2)
          END,
          0
        )), 0), COUNT(*)
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoice_items AS ii
        WHERE ii.invoice_id = v_invoice_id AND ii.bl_id = p_bl_id;
      END IF;

      IF v_invoice_snapshot_count = 0 THEN
        SELECT COALESCE(i.total_brl, 0), 1
        INTO v_invoice_snapshot_total, v_invoice_snapshot_count
        FROM public.invoices AS i
        WHERE i.id = v_invoice_id;
      END IF;
    END IF;

    -- F-18 (368): B/L coberto por consolidada paga (a individual saiu da
    -- busca por estar coberta): o documento é a consolidada, pelo vínculo.
    IF v_invoice_snapshot_count = 0 THEN
      SELECT coalesce(sum(l.subtotal_brl), 0), count(*)
      INTO v_invoice_snapshot_total, v_invoice_snapshot_count
      FROM public.invoice_receivable_links AS l
      WHERE l.bl_id = p_bl_id AND l.status IN ('active', 'settled_by_this_invoice')
        AND l.invoice_id = (
          SELECT i.id FROM public.invoice_receivable_links AS l2 JOIN public.invoices AS i ON i.id = l2.invoice_id
          WHERE l2.bl_id = p_bl_id AND l2.status IN ('active', 'settled_by_this_invoice')
            AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
          ORDER BY i.issued_at DESC NULLS LAST, i.id DESC LIMIT 1);
    END IF;

    IF v_invoice_snapshot_count = 0 THEN
      RAISE EXCEPTION 'Não foi encontrado snapshot da fatura do B/L %.', p_bl_id
        USING ERRCODE = 'P0002';
    END IF;
    v_original_total := ROUND(COALESCE(v_invoice_snapshot_total, 0), 2);

    -- Em uma reversão COD → transbordo (ou nova ida ao COD), a comparação é
    -- contra o último destino efetivamente registrado, para que cada
    -- transição gere seu próprio evento mesmo quando o snapshot original da
    -- invoice permanece imutável.
    SELECT new_destination_value_brl, 1
    INTO v_previous_adjustment_total, v_previous_adjustment_count
    FROM public.cod_adjustments
    WHERE bl_id = p_bl_id AND omission_id = p_omission_id
    ORDER BY id DESC
    LIMIT 1;
    IF v_previous_adjustment_count > 0 THEN
      v_original_total := ROUND(v_previous_adjustment_total, 2);
    END IF;

    SELECT COALESCE(SUM(
      CASE
        WHEN ib.invoice_id IS NOT NULL
          AND COALESCE(i.total_brl, 0) > 0
          AND EXISTS (
            SELECT 1
            FROM public.invoice_bls AS ib_other
            WHERE ib_other.invoice_id = i.id
              AND ib_other.bl_id <> p_bl_id
          )
        THEN p.amount_brl * COALESCE(ib.subtotal_brl, 0) / i.total_brl
        ELSE p.amount_brl
      END
    ), 0)
    INTO v_paid_amount
    FROM public.payments AS p
    JOIN public.invoices AS i ON i.id = p.invoice_id
    LEFT JOIN public.invoice_bls AS ib
      ON ib.invoice_id = i.id AND ib.bl_id = p_bl_id
    WHERE COALESCE(i.status, 'issued') <> 'cancelled'
      AND (i.bl_id = p_bl_id OR ib.bl_id = p_bl_id);
    v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    IF v_paid_amount = 0 THEN
      SELECT COALESCE(SUM(COALESCE(i.total_paid_brl, 0)), 0)
      INTO v_paid_amount
      FROM public.invoices AS i
      WHERE i.bl_id = p_bl_id
        AND COALESCE(i.status, 'issued') <> 'cancelled';
      v_paid_amount := ROUND(GREATEST(COALESCE(v_paid_amount, 0), 0), 2);
    END IF;
    -- F-18 (368): o pago pela consolidada está no recebível do B/L.
    SELECT greatest(v_paid_amount, coalesce(max(r.settled_amount_brl), 0)) INTO v_paid_amount
    FROM public.bl_receivables AS r WHERE r.bl_id = p_bl_id AND r.source = 'local_charges';
    v_paid_amount := ROUND(v_paid_amount, 2);
    v_outstanding := ROUND(GREATEST(v_original_total - v_paid_amount, 0), 2);
    v_difference := ROUND(v_new_total - v_original_total, 2);

    -- F-41 (368): sem diferença não há ajuste (antes, a fatura sem pagamento
    -- ganhava um "Cancelar e reemitir" que nunca se liquidava).
    IF v_difference = 0 THEN
      RETURN;
    END IF;

    -- An unpaid invoice is the only cancel/reissue branch. A B/L remains
    -- financial_status = invoiced while its invoice is partially paid, so
    -- payment money—not only the coarse B/L status—selects the next branch.
    IF v_paid_amount = 0 THEN
      v_action := 'cancel_and_reissue';
      v_manual_review := true;
    ELSIF v_difference > 0 THEN
      v_action := 'complementary_invoice';
    ELSIF v_difference < 0 THEN
      v_offset_amount := ROUND(LEAST(ABS(v_difference), v_outstanding), 2);
      v_refund_amount := ROUND(GREATEST(ABS(v_difference) - v_outstanding, 0), 2);
      v_action := CASE
        WHEN v_refund_amount > 0 THEN 'refund_overpayment'
        ELSE 'offset_open_balance'
      END;
    ELSE
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.cod_adjustments (
    bl_id,
    omission_id,
    original_value_brl,
    new_destination_value_brl,
    difference_brl,
    paid_amount_brl,
    outstanding_balance_brl,
    offset_amount_brl,
    refund_amount_brl,
    action,
    status,
    manual_review_required,
    resulting_document_id,
    resulting_document_type,
    created_by
  )
  VALUES (
    p_bl_id,
    p_omission_id,
    ROUND(v_original_total, 2),
    ROUND(v_new_total, 2),
    ROUND(v_difference, 2),
    ROUND(v_paid_amount, 2),
    ROUND(v_outstanding, 2),
    ROUND(v_offset_amount, 2),
    ROUND(v_refund_amount, 2),
    v_action,
    'pending',
    v_manual_review,
    NULL,
    NULL,
    v_actor
  )
  ;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_customer_base_row_atomic_legacy_189(p_cnpj text, p_name text, p_trade_name text, p_address text, p_city text, p_state text, p_zip text, p_emails jsonb, p_changed_by uuid, p_confirm_name_change boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_cnpj text := NULLIF(btrim(COALESCE(p_cnpj, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_customer_id bigint;
  v_created boolean := false;
  v_email text;
  v_norm text;
  v_seen text[] := ARRAY[]::text[];
  v_contacts_created integer := 0;
  v_bls_linked integer := 0;
  v_current_name text;
  v_linked text[];
  v_bl text;
  v_consignees text[];
  v_consignee text;
  v_previous_batch text;
  -- 474 (D10): só quem edita contatos inclui ou muda contatos pela Base.
  v_can_contacts boolean := public._can_edit_customer_contacts();
  -- 474 (D15): Cliente desativado não muda pela Base.
  v_deactivated boolean := false;
  v_suggested text[];
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_cnpj IS NULL OR v_name IS NULL THEN
    RAISE EXCEPTION 'CNPJ e razao social obrigatorios.' USING ERRCODE = '22023';
  END IF;
  IF p_emails IS NULL OR jsonb_typeof(p_emails) <> 'array' OR jsonb_array_length(p_emails) = 0 THEN
    RAISE EXCEPTION 'Ao menos um e-mail obrigatorio.' USING ERRCODE = '22023';
  END IF;

  -- Lock por cliente: serializa concorrentes do mesmo CNPJ.
  SELECT id INTO v_customer_id FROM public.customers WHERE cnpj_cpf = v_cnpj FOR UPDATE;

  -- Razão social diferente da gravada pede confirmação (ADR 0078, item 24).
  IF FOUND THEN
    SELECT name, deactivated_at IS NOT NULL INTO v_current_name, v_deactivated FROM public.customers WHERE id = v_customer_id;
    IF upper(btrim(regexp_replace(COALESCE(v_current_name, ''), '[^[:alnum:]]+', ' ', 'g'))) <> upper(btrim(regexp_replace(v_name, '[^[:alnum:]]+', ' ', 'g')))
       AND NOT COALESCE(p_confirm_name_change, false) AND NOT v_deactivated THEN
      RAISE EXCEPTION 'Razão social diferente da cadastrada (% → %): confirme a troca.', btrim(v_current_name), v_name
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_customer_id IS NULL THEN
    INSERT INTO public.customers(
      cnpj_cpf, name, trade_name, address, city, state, zip, notes, pending_balance
    ) VALUES (
      v_cnpj, v_name,
      NULLIF(btrim(COALESCE(p_trade_name, '')), ''),
      NULLIF(btrim(COALESCE(p_address, '')), ''),
      NULLIF(btrim(COALESCE(p_city, '')), ''),
      NULLIF(upper(btrim(COALESCE(p_state, ''))), ''),
      NULLIF(btrim(COALESCE(p_zip, '')), ''),
      NULL, 0
    ) RETURNING id INTO v_customer_id;
    v_created := true;
  ELSIF NOT v_deactivated THEN
    UPDATE public.customers
      SET name = v_name,
          trade_name = COALESCE(NULLIF(btrim(COALESCE(p_trade_name, '')), ''), trade_name),
          address = COALESCE(NULLIF(btrim(COALESCE(p_address, '')), ''), address),
          city = COALESCE(NULLIF(btrim(COALESCE(p_city, '')), ''), city),
          state = COALESCE(NULLIF(upper(btrim(COALESCE(p_state, ''))), ''), state),
          zip = COALESCE(NULLIF(btrim(COALESCE(p_zip, '')), ''), zip),
          updated_at = now()
      WHERE id = v_customer_id;
  END IF;

  -- Bases anteriores podiam ter um principal sem e-mail. Ele não satisfaz o
  -- contrato atual; a transação só termina depois que algum e-mail elegível
  -- assume a principalidade.
  IF v_can_contacts AND NOT v_deactivated THEN
  UPDATE public.customer_contacts AS cc
  SET is_primary = false,
      updated_at = now()
  WHERE cc.customer_id = v_customer_id
    AND cc.is_primary = true
    AND cc.deactivated_at IS NULL
    AND cc.email_normalized IS NULL;
  END IF;

  -- Contatos: valida formato e duplicata no envio; existente e no-op.
  -- O primeiro e-mail elegível assume a principalidade se ainda não houver
  -- um principal ativo com e-mail; a decisão é reavaliada a cada iteração.
  FOR v_email IN SELECT value #>> '{}' FROM jsonb_array_elements(p_emails)
  LOOP
    v_norm := lower(NULLIF(btrim(COALESCE(v_email, '')), ''));
    IF v_norm IS NULL OR v_norm !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'E-mail inválido para o cliente %: %', v_cnpj, COALESCE(v_email, '') USING ERRCODE = '22023';
    END IF;
    IF v_norm = ANY (v_seen) THEN
      RAISE EXCEPTION 'E-mail duplicado no envio: %', v_norm USING ERRCODE = '23505';
    END IF;
    v_seen := array_append(v_seen, v_norm);
    CONTINUE WHEN NOT v_can_contacts OR v_deactivated;

    -- Se o endereço já existia como adicional, promovê-lo também corrige
    -- clientes antigos que chegaram sem principal na base cadastral. Um
    -- contato desativado com o mesmo e-mail deve ser reativado; deixá-lo
    -- fora do INSERT abaixo faria o índice único tratar a linha histórica
    -- como duplicata sem criar um principal ativo.
    UPDATE public.customer_contacts AS cc
    SET deactivated_at = NULL,
        is_primary = NOT EXISTS (
          SELECT 1
          FROM public.customer_contacts AS primary_contact
          WHERE primary_contact.customer_id = v_customer_id
            AND primary_contact.is_primary = true
            AND primary_contact.deactivated_at IS NULL
            AND primary_contact.email_normalized IS NOT NULL
        ),
        updated_at = now()
    WHERE cc.customer_id = v_customer_id
      AND cc.email_normalized = v_norm;

    INSERT INTO public.customer_contacts (customer_id, name, email, purpose, is_primary)
    SELECT
      v_customer_id,
      v_name,
      v_norm,
      'financeiro',
      NOT EXISTS (
        SELECT 1
        FROM public.customer_contacts AS cc
        WHERE cc.customer_id = v_customer_id
          AND cc.is_primary = true
          AND cc.deactivated_at IS NULL
          AND cc.email_normalized IS NOT NULL
      )
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_contacts AS cc
      WHERE cc.customer_id = v_customer_id
        AND cc.deactivated_at IS NULL
        AND lower(btrim(COALESCE(cc.email, ''))) = v_norm
    );
    IF FOUND THEN
      v_contacts_created := v_contacts_created + 1;
    END IF;
  END LOOP;

  -- Vínculo retroativo (ADR 0078, item 24): só B/Ls pendentes de Cliente com o
  -- mesmo CNPJ, nunca o rejeitado na Revisão (que recebe o Cliente à mão) nem o
  -- de Viagem cancelada, que é somente leitura: o UPDATE cairia em
  -- `trg_guard_voyage_cancelled_bls` (42501) e derrubaria a linha do Cliente
  -- (V9). A prévia (`compareCustomerBaseWithExisting`) usa o mesmo filtro.
  --
  -- Lote (170): o gatilho de linha dos Alertas fica calado enquanto o vínculo e
  -- a Revisão mudam; o Alerta é reconciliado uma vez no fim.
  v_previous_batch := current_setting('vela.bl_review_batch', true);
  PERFORM set_config('vela.bl_review_batch', 'on', true);
  WITH linked AS (
    UPDATE public.bls AS b
      SET customer_id = v_customer_id,
          customer_reconciliation_status = 'matched_document'
      WHERE b.manifest_customer_cnpj_cpf = v_cnpj
        AND b.customer_id IS NULL
        AND b.cancelled_at IS NULL
        AND COALESCE(b.customer_reconciliation_status, 'missing_customer') <> 'rejected'
        AND NOT EXISTS (
          SELECT 1 FROM public.voyages AS v
          WHERE v.id = b.voyage_id AND v.status = 'cancelled'
        )
      RETURNING b.id, b.consignee, b.customer_id
  )
  -- D15: com Cliente desativado, `guard_bl_link_to_deactivated_customer`
  -- transforma o vínculo em sugestão (customer_id volta nulo): não é vínculo.
  SELECT array_agg(id ORDER BY id) FILTER (WHERE customer_id IS NOT NULL),
         array_agg(DISTINCT consignee) FILTER (WHERE customer_id IS NOT NULL),
         array_agg(id ORDER BY id) FILTER (WHERE customer_id IS NULL)
    INTO v_linked, v_consignees, v_suggested
  FROM linked;
  IF v_suggested IS NOT NULL THEN
    FOREACH v_bl IN ARRAY v_suggested LOOP
      PERFORM public.recompute_bl_review_status(v_bl);
      PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl);
    END LOOP;
  END IF;
  v_bls_linked := COALESCE(cardinality(v_linked), 0);

  IF v_bls_linked > 0 THEN
    FOREACH v_bl IN ARRAY v_linked LOOP
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
      VALUES ('bl', v_bl, 'customer_id', NULL, v_customer_id::text, v_actor, 'Vínculo por documento pela Base de Clientes');
    END LOOP;
    -- O gate da importação captura o contato do manifesto, mas só acrescenta
    -- pendências. Quem libera a Revisão é a dona da regra (V1):
    -- `recompute_bl_review_status` (168) tira a nota "Pendencias de
    -- importacao" velha e devolve o B/L a `reviewed` quando não sobra
    -- pendência real; com pendência real (ex.: Portal não provisionado), fica
    -- só ela. A fila de Reconciliação de Cliente acompanha o vínculo.
    PERFORM public.apply_bl_review_gate_after_import(v_linked, v_actor);
    FOREACH v_bl IN ARRAY v_linked LOOP
      PERFORM public.recompute_bl_review_status(v_bl);
      PERFORM public.sync_customer_reconciliation_queue_for_bl(v_bl);
    END LOOP;
  END IF;
  PERFORM set_config('vela.bl_review_batch', COALESCE(NULLIF(v_previous_batch, ''), 'off'), true);

  IF v_bls_linked > 0 THEN
    -- Um Alerta por Cliente e um por consignatário que deixou de estar sem
    -- Cliente, já com a contagem final (como a 168 e a 170).
    PERFORM public.reconcile_customer_bl_review_alerts(v_customer_id, NULL, 'customer_base_link');
    FOREACH v_consignee IN ARRAY v_consignees LOOP
      PERFORM public.reconcile_customer_bl_review_alerts(NULL, v_consignee, 'customer_base_link');
    END LOOP;
    -- O faturamento segue: com o Cliente, as Taxas Locais são calculadas.
    FOREACH v_bl IN ARRAY v_linked LOOP
      BEGIN
        PERFORM public.calculate_bl_local_charges(v_bl, v_actor, true);
      EXCEPTION WHEN OTHERS THEN
        -- ADR 0094, B3: a linha da Base é recusada inteira.
        PERFORM public._raise_local_charge_failure(v_bl, SQLSTATE, SQLERRM);
      END;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'created', v_created,
    'contacts_created', v_contacts_created,
    'bls_linked', v_bls_linked,
    'linked_bl_ids', to_jsonb(COALESCE(v_linked, ARRAY[]::text[])),
    'bls_suggested', COALESCE(cardinality(v_suggested), 0),
    'customer_deactivated', v_deactivated,
    'contacts_skipped', NOT v_can_contacts
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_demurrage_discount(p_request_id uuid, p_invoice_id bigint, p_discount_mode text, p_discount_value numeric, p_discount_type text DEFAULT NULL::text, p_discount_justification text DEFAULT NULL::text, p_discount_approver text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_mode text := NULLIF(btrim(p_discount_mode), '');
  v_type text := NULLIF(btrim(p_discount_type), '');
  v_value numeric(12,2) := CASE WHEN p_discount_value IS NULL THEN NULL ELSE round(p_discount_value, 2) END;
  v_discount_usd numeric(12,2) := 0;
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_result jsonb;
  v_justification text := NULLIF(btrim(p_discount_justification), '');
  v_exempt boolean := false;
  v_exempt_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para aplicar desconto de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Fatura obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF v_mode IS NOT NULL AND v_mode NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'Modo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('comercial', 'datas', 'cortesia', 'acordo', 'erro') THEN
    RAISE EXCEPTION 'Tipo de desconto invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_value IS NOT NULL AND v_value < 0 THEN
    RAISE EXCEPTION 'Desconto não pode ser negativo.' USING ERRCODE = '22003';
  END IF;
  IF v_value IS NOT NULL AND v_mode IS NULL THEN
    RAISE EXCEPTION 'Modo de desconto obrigatorio.' USING ERRCODE = '22023';
  END IF;
  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatória para alterar desconto.' USING ERRCODE = '22023';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_mode', v_mode,
    'discount_value', v_value,
    'discount_type', v_type,
    'discount_justification', v_justification,
    'discount_approver', NULLIF(btrim(p_discount_approver), '')
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'discount', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;
  IF v_invoice.status IN ('paid', 'cancelled') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Desconto não pode alterar fatura paga ou cancelada.' USING ERRCODE = '22023';
  END IF;

  IF v_value IS NULL THEN
    v_discount_usd := 0;
    v_mode := NULL;
  ELSIF v_mode = 'percent' THEN
    IF v_value > 100 THEN
      RAISE EXCEPTION 'Percentual de desconto deve ficar entre 0 e 100.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := round(v_invoice.total_usd * v_value / 100, 2);
  ELSE
    IF v_value > v_invoice.total_usd THEN
      RAISE EXCEPTION 'Desconto fixo não pode exceder o total USD da fatura.' USING ERRCODE = '22003';
    END IF;
    v_discount_usd := v_value;
  END IF;

  -- D7: desconto que zera o USD líquido de uma Invoice emitida quita a Invoice.
  v_exempt := v_mode IS NOT NULL
    AND v_invoice.total_usd > 0
    AND v_discount_usd >= v_invoice.total_usd
    AND COALESCE(v_invoice.status, 'issued') IN ('issued', 'overdue');

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    v_total_brl := round(greatest(v_invoice.total_usd - v_discount_usd, 0) * v_invoice.current_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_invoice.doc_number) ELSE NULL END;
  ELSE
    v_total_brl := NULL;
    v_pix_payload := NULL;
  END IF;
  IF v_exempt THEN
    v_total_brl := 0;
    v_pix_payload := NULL;
  END IF;

  UPDATE public.demurrage_invoices
  SET discount_type = v_type,
      discount_value = CASE WHEN v_value IS NULL THEN NULL ELSE v_value END,
      discount_mode = v_mode,
      discount_justification = v_justification,
      discount_approver = NULLIF(btrim(p_discount_approver), ''),
      current_total_brl = v_total_brl,
      pix_payload = v_pix_payload,
      status = CASE WHEN v_exempt THEN 'paid' ELSE status END,
      paid_at = CASE WHEN v_exempt THEN v_exempt_date ELSE paid_at END,
      updated_at = now()
  WHERE id = p_invoice_id;

  IF v_invoice.current_roe IS NOT NULL AND v_invoice.current_roe > 0 THEN
    INSERT INTO public.demurrage_invoice_history
      (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES
      (p_invoice_id, v_exempt_date,
       public._demurrage_ptax_from_roe(v_invoice.current_roe), v_invoice.current_roe,
       v_invoice.total_usd, v_total_brl, v_discount_usd, CASE WHEN v_exempt THEN 'payment' ELSE 'manual' END);
  END IF;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'discount',
    jsonb_build_object('mode', v_invoice.discount_mode, 'value', v_invoice.discount_value)::text,
    v_payload::text, auth.uid(), now(), v_justification
  );

  IF v_exempt THEN
    INSERT INTO public.audit_logs(
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification
    ) VALUES (
      'demurrage_invoice', p_invoice_id::text, 'discount_exemption',
      v_invoice.status,
      jsonb_build_object('status', 'paid', 'paid_at', v_exempt_date, 'total_brl', 0)::text,
      auth.uid(), now(), v_justification
    );
  END IF;

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'discount_usd', v_discount_usd,
    'current_total_brl', v_total_brl,
    'pix_payload', v_pix_payload,
    'status', CASE WHEN v_exempt THEN 'paid' ELSE v_invoice.status END,
    'exempted', v_exempt,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'discount', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_ledger_invoice_payment_allocation(p_invoice_id bigint, p_amount_brl numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_open numeric(14,2);
  v_remaining numeric(14,2);
  v_allocation numeric(14,2);
  v_allocated numeric(14,2);
  v_receivable record;
BEGIN
  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(br.balance_brl), 0)
    INTO v_open
  FROM public.bl_receivables AS br
  JOIN public.invoice_receivable_links AS link
    ON link.receivable_id = br.id
   AND link.invoice_id = p_invoice_id
   AND link.status = 'active'
  WHERE br.status IN ('open', 'partially_settled')
    AND br.balance_brl > 0;

  v_remaining := ROUND(LEAST(ROUND(p_amount_brl::numeric, 2), v_open), 2);

  FOR v_receivable IN
    SELECT br.id, br.balance_brl, br.original_amount_brl
    FROM public.bl_receivables AS br
    JOIN public.invoice_receivable_links AS link
      ON link.receivable_id = br.id
     AND link.invoice_id = p_invoice_id
     AND link.status = 'active'
    WHERE br.status IN ('open', 'partially_settled')
      AND br.balance_brl > 0
    ORDER BY br.id
    FOR UPDATE OF br
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_allocation := ROUND(LEAST(v_receivable.balance_brl, v_remaining), 2);
    CONTINUE WHEN v_allocation <= 0;

    SELECT COALESCE(SUM(s.amount_brl), 0)
      INTO v_allocated
    FROM public.ledger_settlements AS s
    WHERE s.receivable_id = v_receivable.id;

    IF ROUND(v_allocated + v_allocation, 2)
       > ROUND(COALESCE(v_receivable.original_amount_brl, 0) + 0.01, 2) THEN
      RAISE EXCEPTION 'Alocação do receivable % excede o valor original (%).',
        v_receivable.id, v_receivable.original_amount_brl
        USING ERRCODE = '23514';
    END IF;
    v_remaining := ROUND(v_remaining - v_allocation, 2);
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_no_fcl_shared_between_customers(p_bl_ids text[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_conflict record;
BEGIN
  SELECT upper(btrim(c.container_number)) AS container_number, b.id AS bl_id, other.id AS other_bl_id,
    customer.name AS customer_name, other_customer.name AS other_customer_name
  INTO v_conflict
  FROM public.bls AS b
  JOIN public.bl_containers AS c ON c.bl_id = b.id
  JOIN public.bl_containers AS oc ON upper(btrim(oc.container_number)) = upper(btrim(c.container_number))
  JOIN public.bls AS other ON other.id = oc.bl_id
  LEFT JOIN public.customers AS customer ON customer.id = b.customer_id
  LEFT JOIN public.customers AS other_customer ON other_customer.id = other.customer_id
  WHERE b.id = ANY(p_bl_ids)
    AND other.id <> b.id
    AND other.voyage_id = b.voyage_id
    AND b.cancelled_at IS NULL AND other.cancelled_at IS NULL
    AND b.customer_id IS NOT NULL AND other.customer_id IS NOT NULL
    AND b.customer_id <> other.customer_id
    AND COALESCE(b.container_load_type, 'FCL') <> 'LCL'
    AND COALESCE(other.container_load_type, 'FCL') <> 'LCL'
    AND NOT EXISTS (SELECT 1 FROM public.vehicles AS v WHERE v.container_id IN (c.id, oc.id))
  ORDER BY b.id, upper(btrim(c.container_number))
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'O container % está no B/L % (%) e no B/L % (%): container FCL não é dividido entre Clientes diferentes. Corrija o Cliente ou o container do arquivo.',
      v_conflict.container_number, v_conflict.bl_id, COALESCE(v_conflict.customer_name, 'Cliente'),
      v_conflict.other_bl_id, COALESCE(v_conflict.other_customer_name, 'outro Cliente')
      USING ERRCODE = 'P0008';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_voyage_escala_ready_for_report_close(p_voyage_id bigint, p_port text, p_report_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_report RECORD;
  v_terminal_code TEXT;
  v_terminal_tipo TEXT;
  v_terminal_port_id BIGINT;
  v_sem_terminal TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT p.id
  INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
    AND upper(btrim(p.locode)) LIKE 'BR%'
  ORDER BY p.id
  LIMIT 1;
  IF v_port_id IS NULL THEN
    RAISE EXCEPTION 'Porto brasileiro % não encontrado.', v_port USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT r.id, r.voyage_id, r.port, r.terminal_id, r.terminal_port_id
  INTO v_report
  FROM public.agency_departure_reports AS r
  WHERE r.id = p_report_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_report.voyage_id <> p_voyage_id
     OR upper(btrim(v_report.port)) <> v_port THEN
    RAISE EXCEPTION 'report_id nao pertence a escala %::%.', p_voyage_id, v_port
      USING ERRCODE = '23514';
  END IF;

  SELECT d.code, d.tipo, d.port_id
  INTO v_terminal_code, v_terminal_tipo, v_terminal_port_id
  FROM public.depots AS d
  WHERE d.id = v_report.terminal_id;
  IF v_report.terminal_id IS NULL OR v_report.terminal_port_id IS NULL THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;
  IF v_terminal_tipo IS DISTINCT FROM 'terminal_portuario'
     OR v_terminal_port_id IS DISTINCT FROM v_port_id
     OR v_report.terminal_port_id IS DISTINCT FROM v_port_id THEN
    RAISE EXCEPTION 'report_id deve referenciar ADR terminalizado do porto %.', v_port
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Frente TBC impede o fechamento do ADR.'
      USING ERRCODE = '23514', DETAIL = 'Atribua todas as frentes a um terminal antes do fechamento.';
  END IF;

  -- 537/538: a frente que a aba deriva dos dados (B/L, veículo, vazio de
  -- importação, Granito) e que ainda não foi gravada com terminal também é TBC.
  v_sem_terminal := public._escala_fronts_without_terminal(p_voyage_id, v_port);
  IF cardinality(v_sem_terminal) > 0 THEN
    RAISE EXCEPTION 'Frente TBC impede o fechamento do ADR: %.', (
        SELECT string_agg(label, ', ' ORDER BY label)
        FROM (
          SELECT CASE f
              WHEN 'importacao:carga_cheia' THEN 'carga cheia'
              WHEN 'importacao:carga_solta' THEN 'carga solta'
              WHEN 'importacao:vazio' THEN 'vazios de importação'
              WHEN 'importacao:veiculo' THEN 'veículos'
              WHEN 'exportacao:granito' THEN 'granito'
              WHEN 'exportacao:vazio' THEN 'embarque de vazios'
              ELSE f
            END AS label
          FROM unnest(v_sem_terminal) AS f
        ) AS labels
      )
      USING ERRCODE = '23514', DETAIL = 'Atribua o terminal destas frentes em Editar escala antes do fechamento.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      AND f.terminal_id = v_report.terminal_id
  ) THEN
    RAISE EXCEPTION 'ADR % não corresponde a terminal atribuído na escala.', v_terminal_code
      USING ERRCODE = '23514';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_demurrage_invoice(p_request_id uuid, p_invoice_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb := jsonb_build_object('invoice_id', p_invoice_id, 'reason', NULLIF(btrim(p_reason), ''));
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para cancelar Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatória para cancelar a fatura.' USING ERRCODE = '22023';
  END IF;
  v_previous := public._demurrage_mutation_request(p_request_id, 'cancel', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN RETURN v_previous; END IF;

  SELECT * INTO v_invoice FROM public.demurrage_invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demurrage invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002'; END IF;
  IF v_invoice.status = 'paid' THEN RAISE EXCEPTION 'Fatura paga deve ser estornada antes do cancelamento.' USING ERRCODE = '22023'; END IF;
  IF v_invoice.status = 'cancelled' THEN RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'idempotent', true); END IF;

  UPDATE public.demurrage_invoices SET status = 'cancelled', updated_at = now() WHERE id = p_invoice_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('demurrage_invoice', p_invoice_id::text, 'status', v_invoice.status, 'cancelled', auth.uid(), now(), btrim(p_reason));
  v_result := jsonb_build_object('invoice_id', p_invoice_id, 'status', 'cancelled', 'idempotent', false);
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'cancel', p_invoice_id, v_payload, v_result, auth.uid()) ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_invoice(p_invoice_id bigint, p_reason text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_effect_consumer boolean := auth.role() = 'service_role'
    AND current_setting('import_effects.consumer', true) = 'vehicle_followup';
  v_consolidated text;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF NOT v_effect_consumer
     AND (auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a invoice.'
      USING ERRCODE = '22023';
  END IF;

  -- Individual coberta por consolidada aberta: cancelar só a individual deixaria
  -- a consolidada cobrando o valor antigo e o B/L livre para nova fatura.
  SELECT inv.invoice_number INTO v_consolidated
  FROM public.invoices own_inv
  JOIN public.invoice_receivable_links own ON own.invoice_id = own_inv.id
  JOIN public.invoice_receivable_links l ON l.receivable_id = own.receivable_id AND l.invoice_id <> own.invoice_id
  JOIN public.invoices inv ON inv.id = l.invoice_id
  WHERE own_inv.id = p_invoice_id
    AND COALESCE(own_inv.invoice_type, 'individual') = 'individual'
    AND COALESCE(own_inv.status, 'issued') <> 'cancelled'
    AND inv.invoice_type = 'consolidated'
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ORDER BY inv.id DESC
  LIMIT 1;
  IF v_consolidated IS NOT NULL THEN
    RAISE EXCEPTION 'Este B/L está na consolidada %; cancele ou reemita pela consolidada.', v_consolidated
      USING ERRCODE = '22023';
  END IF;

  RETURN public._cancel_invoice_core(p_invoice_id, p_reason, COALESCE(p_actor, auth.uid()));
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_voyage(p_voyage_id bigint, p_reason text, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old_status text; v_blocking text; v_bl text; v_voided integer := 0; v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), ''); v_closed integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() OR p_changed_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Somente o Administrativo cancela viagem.' USING ERRCODE = '42501'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.' USING ERRCODE = '22023'; END IF;
  SELECT status INTO v_old_status FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Viagem % não encontrada.', p_voyage_id USING ERRCODE = 'P0002'; END IF;
  IF v_old_status = 'cancelled' THEN RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', false); END IF;
  -- ADR 0093, decisão 14 (363): com fatura viva ou baixa em algum B/L, o
  -- Administrativo resolve cada B/L antes.
  SELECT string_agg(DISTINCT x.bl_id || ' (' || x.what || ')', ', ' ORDER BY x.bl_id || ' (' || x.what || ')') INTO v_blocking FROM (
    SELECT b.id AS bl_id, 'fatura ' || coalesce(i.invoice_number, i.id::text) AS what
    FROM public.bls b
    JOIN public.invoices i ON i.bl_id = b.id OR EXISTS (SELECT 1 FROM public.invoice_bls ib WHERE ib.invoice_id = i.id AND ib.bl_id = b.id)
      OR EXISTS (SELECT 1 FROM public.invoice_receivable_links l WHERE l.invoice_id = i.id AND l.bl_id = b.id AND l.status <> 'obsolete')
    WHERE b.voyage_id = p_voyage_id AND coalesce(i.status, 'issued') NOT IN ('cancelled', 'obsolete')
    UNION ALL
    SELECT b.id, 'Invoice de Demurrage ' || coalesce(d.doc_number, d.id::text)
    FROM public.bls b JOIN public.demurrage_invoices d ON d.bl_id = b.id
    WHERE b.voyage_id = p_voyage_id AND coalesce(d.status, 'issued') NOT IN ('cancelled')
    UNION ALL
    SELECT r.bl_id, 'baixa no recebível'
    FROM public.bl_receivables r JOIN public.bls b ON b.id = r.bl_id
    WHERE b.voyage_id = p_voyage_id AND (r.settled_amount_brl > 0 OR EXISTS (SELECT 1 FROM public.ledger_settlements s WHERE s.receivable_id = r.id))
  ) x;
  IF v_blocking IS NOT NULL THEN
    RAISE EXCEPTION 'A Viagem tem fatura viva ou baixa: %. Resolva cada B/L antes de cancelar a Viagem.', v_blocking
      USING ERRCODE = '22023';
  END IF;

  -- Recebíveis sem fatura saem do saldo.
  FOR v_bl IN SELECT b.id FROM public.bls b WHERE b.voyage_id = p_voyage_id ORDER BY b.id LOOP
    v_voided := v_voided + public._void_unbilled_bl_receivables(v_bl, p_changed_by, 'Cancelamento da Viagem: ' || v_reason);
  END LOOP;

  PERFORM set_config('vela.allow_voyage_cancel', 'on', true);
  UPDATE public.voyages SET status = 'cancelled' WHERE id = p_voyage_id;
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('voyages', p_voyage_id::text, 'status', v_old_status, 'cancelled', p_changed_by, 'Cancelamento de viagem: ' || v_reason);

  UPDATE public.import_pending_effects AS e
     SET status = 'superseded', lease_until = NULL, leased_by = NULL,
         result = COALESCE(e.result, '{}'::jsonb) || jsonb_build_object('reason', 'voyage_cancelled', 'voyage_id', p_voyage_id),
         updated_at = now()
   WHERE e.status IN ('pending', 'retry_wait')
     AND public._import_effect_voyage_id(e.effect_kind, e.entity_id) = p_voyage_id;
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN jsonb_build_object('voyage_id', p_voyage_id, 'status', 'cancelled', 'changed', true, 'closed_effects', v_closed, 'voided_receivables', v_voided);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_agency_departure_report(p_voyage_id bigint, p_port text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
  v_signed_departments INTEGER;
  v_unknown_sections TEXT[];
  v_unknown_top_level TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object'
     OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array'
     OR octet_length(p_snapshot::text) > 8388608 THEN
    RAISE EXCEPTION 'Snapshot invalido: esperado objeto com header, sections, occurrences e signoffs (maximo 8 MiB).' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_top_level
  FROM jsonb_object_keys(p_snapshot) AS key
  WHERE key NOT IN ('header', 'sections', 'occurrences', 'signoffs', 'departmentSignoffs');
  IF v_unknown_top_level IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui chaves de topo desconhecidas: %.', array_to_string(v_unknown_top_level, ', ')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key) INTO v_unknown_sections
  FROM jsonb_object_keys(p_snapshot->'sections') AS key
  WHERE key NOT IN (
    'cargaDescarregada', 'cargaSolta', 'vaziosDescarregados', 'veiculos',
    'vaziosEmbarcados', 'vaziosUnidades', 'vehicleLocations', 'vehicleBreakdown',
    'depots', 'directEmbarkCount', 'granito', 'storage', 'operation', 'costs'
  );
  IF v_unknown_sections IS NOT NULL THEN
    RAISE EXCEPTION 'Snapshot possui secoes desconhecidas: %.', array_to_string(v_unknown_sections, ', ')
      USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE id = v_report_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_signed_departments
  FROM public.agency_departure_report_department_signoffs
  WHERE report_id = v_report_id AND signed_at IS NOT NULL;
  IF v_signed_departments <> 3 THEN
    RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados (% pendentes).', 3 - v_signed_departments
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agency_departure_reports
  SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = v_report_id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADR já fechado.' USING ERRCODE = '23505';
  END IF;

  -- 'agency_report_section_pending' e obsoleto (migration 225 introduz
  -- 'agency_report_department_pending', ja fechado por departamento no
  -- signoff); mantido aqui so para alertas legados pre-0029.
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_section_pending'
    AND entity_type = 'agency_departure_report'
    -- Prefixo literal: '%' e '_' no porto não viram curinga.
    AND starts_with(entity_id, p_voyage_id::text || '::' || upper(btrim(p_port)) || '::')
    AND status <> 'closed';

  -- ADR 0039: fecha os alertas de vencimento do prazo junto com o Fechamento.
  -- Chegar aqui exige os 3 departamentos assinados, entao todo alerta de
  -- vencimento desta escala ja deveria estar sem motivo; este UPDATE e uma
  -- rede de seguranca (ex.: alerta detectado entre o ultimo sign-off e o
  -- clique de Fechar).
  UPDATE public.alerts
  SET status = 'closed', closed_at = now()
  WHERE type = 'agency_report_deadline_missed'
    AND entity_type = 'agency_departure_report'
    -- Prefixo literal: '%' e '_' no porto não viram curinga.
    AND starts_with(entity_id, p_voyage_id::text || '::' || upper(btrim(p_port)) || '::')
    AND status <> 'closed';

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.close_agency_departure_report_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report RECORD;
  v_signed INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  PERFORM public.assert_voyage_escala_ready_for_report_close(p_voyage_id, p_port, p_report_id);
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port)) OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' OR jsonb_typeof(p_snapshot->'header') <> 'object'
     OR jsonb_typeof(p_snapshot->'sections') <> 'object' OR jsonb_typeof(p_snapshot->'occurrences') <> 'array'
     OR jsonb_typeof(p_snapshot->'signoffs') <> 'array' OR octet_length(p_snapshot::TEXT) > 8388608 THEN
    RAISE EXCEPTION 'Snapshot invalido.' USING ERRCODE = '22023';
  END IF;
  SELECT COUNT(*) INTO v_signed FROM public.agency_departure_report_department_signoffs
  WHERE report_id = p_report_id AND signed_at IS NOT NULL;
  IF v_signed <> 3 THEN RAISE EXCEPTION 'Fechamento exige os 3 departamentos assinados (% pendentes).', 3 - v_signed USING ERRCODE = '23514'; END IF;
  UPDATE public.agency_departure_reports SET status = 'closed', closed_at = now(), closed_by = auth.uid(), closed_snapshot = p_snapshot
  WHERE id = p_report_id AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'ADR já fechado.' USING ERRCODE = '23505'; END IF;
  UPDATE public.alerts SET status = 'closed', closed_at = now()
  WHERE type IN ('agency_report_section_pending', 'agency_report_department_pending', 'agency_report_deadline_missed')
    AND entity_type = 'agency_departure_report'
    AND entity_id LIKE public.agency_report_alert_entity_prefix(
      v_report.voyage_id,
      v_report.port,
      (SELECT d.code FROM public.depots AS d WHERE d.id = v_report.terminal_id)
    ) || '%'
    AND status <> 'closed';
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_unified_pix_matches(p_matches jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item RECORD;
  v_result JSONB;
  v_items JSONB := '[]'::jsonb;
  v_local_count INTEGER := 0;
  v_demurrage_count INTEGER := 0;
  v_demurrage_updates JSONB := '[]'::jsonb;
  v_updated_demurrage INTEGER := 0;
  v_paid_date DATE;
  v_match_brl NUMERIC;
  v_match_ptax NUMERIC;
BEGIN
  -- Conciliar é do Financeiro e do Administrativo (ADR 0085, D5).
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_matches) AS row(
      source TEXT,
      invoice_id BIGINT,
      doc_number TEXT,
      txid TEXT,
      amount NUMERIC,
      expected_amount NUMERIC,
      paid_at TIMESTAMPTZ
    )
  LOOP
    IF v_item.paid_at IS NULL THEN
      RAISE EXCEPTION 'Data do extrato nao parseada para %.', COALESCE(v_item.doc_number, v_item.txid, v_item.invoice_id::TEXT)
        USING ERRCODE = '22007';
    END IF;

    IF v_item.source = 'local' THEN
      v_result := public.reconcile_invoice_payment_by_txid(v_item.txid, v_item.amount, v_item.paid_at);
      IF COALESCE((v_result->>'matched')::BOOLEAN, false) IS NOT TRUE
         OR COALESCE((v_result->>'settled')::BOOLEAN, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'Falha ao conciliar fatura local %: %.',
          COALESCE(v_item.doc_number, v_item.txid),
          COALESCE(v_result->>'reason', 'erro desconhecido')
          USING ERRCODE = 'P0001';
      END IF;
      v_local_count := v_local_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'local', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));

    ELSIF v_item.source = 'demurrage' THEN
      v_paid_date := (v_item.paid_at AT TIME ZONE 'UTC')::date;

      -- Janela das duas PTAX mais recentes com event_date <= data do pagamento.
      SELECT w.total_brl, w.ptax_used
      INTO v_match_brl, v_match_ptax
      FROM public.get_demurrage_recent_values(v_item.invoice_id, v_paid_date) AS w
      WHERE ABS(w.total_brl - COALESCE(v_item.amount, 0)) <= 0.01
      ORDER BY w.event_date DESC
      LIMIT 1;

      IF NOT FOUND THEN
        -- Fallback: sem histórico (legado) compara com o valor corrente.
        SELECT d.current_total_brl, public._demurrage_ptax_from_roe(d.current_roe)
        INTO v_match_brl, v_match_ptax
        FROM public.demurrage_invoices d
        WHERE d.id = v_item.invoice_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Demurrage % não encontrada.', v_item.doc_number USING ERRCODE = 'P0002';
        END IF;
        IF v_match_brl IS NULL OR ABS(v_match_brl - COALESCE(v_item.amount, 0)) > 0.01 THEN
          RAISE EXCEPTION 'Valor divergente para demurrage %.', v_item.doc_number USING ERRCODE = '22003';
        END IF;
      END IF;

      v_demurrage_updates := v_demurrage_updates || jsonb_build_array(jsonb_build_object(
        'invoice_id', v_item.invoice_id,
        'paid_at', v_paid_date,
        'pix_txid', v_item.txid,
        'total_brl', v_match_brl,
        'ptax_used', v_match_ptax));
      v_demurrage_count := v_demurrage_count + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'source', 'demurrage', 'invoice_id', v_item.invoice_id, 'doc_number', v_item.doc_number, 'status', 'ok'));
    ELSE
      RAISE EXCEPTION 'Origem de conciliacao PIX invalida: %.', v_item.source USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_demurrage_count > 0 THEN
    v_updated_demurrage := public.confirm_demurrage_pix_matches(v_demurrage_updates);
    IF v_updated_demurrage <> v_demurrage_count THEN
      RAISE EXCEPTION 'Conciliacao de demurrage atualizou % de % faturas.', v_updated_demurrage, v_demurrage_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN jsonb_build_object('local', v_local_count, 'demurrage', v_demurrage_count, 'items', v_items);
END;
$function$;

CREATE OR REPLACE FUNCTION public.correct_bl_ce_mercante(p_bl_id text, p_ce text, p_reason text, p_expected_ce text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old text;
  v_result text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da correcao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_ce IS NOT NULL
     AND public.ce_mercante_key(v_old) IS DISTINCT FROM public.ce_mercante_key(p_expected_ce) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % mudou depois que a ficha foi aberta (agora: %). Recarregue a ficha e confira antes de corrigir.',
      p_bl_id, COALESCE(NULLIF(btrim(COALESCE(v_old, '')), ''), 'sem CE')
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(v_old, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O B/L % ainda nao tem CE Mercante: o CE entra pela planilha de CE Mercante, que tambem vincula o Manifesto Mercante.', p_bl_id
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_ce, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o CE Mercante correto (15 digitos). Para tirar o CE, use Remover CE Mercante.' USING ERRCODE = '22023';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, p_ce, auth.uid(), 'Correcao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_customer_from_bl_manifest(p_bl_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
  v_cnpj text;
  v_email text;
  v_existing public.customers%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para criar cliente.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  v_cnpj := public.normalize_cnpj(v_bl.manifest_customer_cnpj_cpf);
  v_email := NULLIF(lower(btrim(COALESCE(v_bl.manifest_customer_email, ''))), '');
  IF v_cnpj IS NULL OR NULLIF(btrim(COALESCE(v_bl.manifest_customer_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'O manifesto do B/L % não traz o Cliente (razão social e CNPJ).', p_bl_id USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.customers WHERE cnpj_cpf = v_cnpj;
  IF FOUND THEN
    RETURN to_jsonb(v_existing);
  END IF;
  IF v_email IS NULL OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'O cliente do manifesto não está cadastrado e o manifesto não traz e-mail. Cadastre-o em Clientes e vincule pela busca.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('vela.customer_from_manifest', 'on', true);
  v_result := public.create_customer_with_contacts(
    jsonb_build_object('cnpj_cpf', v_cnpj, 'name', btrim(v_bl.manifest_customer_name)),
    jsonb_build_array(jsonb_build_object('email', v_email, 'purpose', 'geral',
      'is_primary', true, 'box_codes', jsonb_build_array('documentacao_operacao', 'financeiro', 'demurrage'))));
  PERFORM set_config('vela.customer_from_manifest', '', true);
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_demurrage_invoice_with_items(p_doc_number text, p_bl_id text, p_customer_id bigint, p_total_usd numeric, p_ready_at date, p_roe_manual boolean, p_roe numeric, p_current_roe numeric, p_roe_source text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice_id bigint;
  v_customer_id bigint;
  v_item_count integer;
  v_invalid_container_count integer;
  v_inconsistent_item_count integer;
  v_item_total numeric(14,2);
  v_total_brl numeric(14,2);
  v_pix_payload text;
  v_ptax numeric(10,4);
  v_business_date date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_doc_number, '')), '') IS NULL
     OR NULLIF(TRIM(COALESCE(p_bl_id, '')), '') IS NULL
     OR p_customer_id IS NULL
     OR COALESCE(p_total_usd, 0) <= 0
     OR p_current_roe IS NULL OR p_current_roe <= 0
     OR p_roe_source NOT IN ('bcb_live', 'cached', 'manual')
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Dados invalidos para criar invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  SELECT b.customer_id
    INTO v_customer_id
    FROM public.bls b
   WHERE b.id = p_bl_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.demurrage_invoices di
    WHERE di.bl_id = p_bl_id AND di.status IN ('issued', 'paid')
  ) THEN
    RAISE EXCEPTION 'Ja existe fatura de Demurrage emitida ou paga para o B/L %. Cancele a fatura atual antes de reemitir.', p_bl_id
      USING ERRCODE = '23505';
  END IF;

  IF v_customer_id IS DISTINCT FROM p_customer_id THEN
    RAISE EXCEPTION 'Cliente informado nao corresponde ao cliente do B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE bc.id IS NULL OR bc.bl_id IS DISTINCT FROM p_bl_id)::integer,
    COUNT(*) FILTER (
      WHERE item.discharge_date IS NULL
         OR item.return_date IS NULL
         OR item.return_date < item.discharge_date
         OR COALESCE(item.total_days, -1) <> (item.return_date - item.discharge_date)
         OR COALESCE(item.free_days, -1) < 0
         OR COALESCE(item.days_p1, -1) < 0
         OR COALESCE(item.days_p2, -1) < 0
         OR COALESCE(item.rate_p1_usd, -1) < 0
         OR COALESCE(item.rate_p2_usd, -1) < 0
         OR item.days_p1 + item.days_p2 > GREATEST(item.total_days - item.free_days, 0)
         OR ABS(COALESCE(item.subtotal_usd, -1)
                - (item.days_p1 * item.rate_p1_usd + item.days_p2 * item.rate_p2_usd)) > 0.01
    )::integer,
    COALESCE(SUM(item.subtotal_usd), 0)
    INTO v_item_count, v_invalid_container_count, v_inconsistent_item_count, v_item_total
    FROM jsonb_to_recordset(p_items) AS item(
      container_id bigint,
      container_number text,
      container_type text,
      discharge_date date,
      return_date date,
      total_days integer,
      free_days integer,
      days_p1 integer,
      rate_p1_usd numeric,
      days_p2 integer,
      rate_p2_usd numeric,
      subtotal_usd numeric
    )
    LEFT JOIN public.bl_containers bc ON bc.id = item.container_id;

  IF v_item_count = 0 OR v_invalid_container_count > 0 THEN
    RAISE EXCEPTION 'Itens de Demurrage invalidos para o B/L %.', p_bl_id USING ERRCODE = '22023';
  END IF;

  IF v_inconsistent_item_count > 0 THEN
    RAISE EXCEPTION 'Calculo de Demurrage inconsistente em % item(ns) do B/L %.', v_inconsistent_item_count, p_bl_id
      USING ERRCODE = '22023';
  END IF;

  IF ABS(v_item_total - p_total_usd) > 0.01 THEN
    RAISE EXCEPTION 'Total dos itens diverge do total da invoice de Demurrage.' USING ERRCODE = '22023';
  END IF;

  IF p_roe_source IN ('bcb_live', 'cached') THEN
    SELECT reference.ptax
      INTO v_ptax
      FROM public.exchange_rate_reference AS reference
     WHERE reference.id = 1
       AND reference.source = p_roe_source
       AND reference.roe = p_current_roe
       AND reference.ptax IS NOT NULL
     FOR SHARE;
    IF v_ptax IS NULL THEN
      RAISE EXCEPTION 'Snapshot cambial sem PTAX registrada para a origem %.', p_roe_source
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Sem desconto na criacao (descontos sao aplicados depois, em USD).
  v_total_brl := ROUND(p_total_usd * p_current_roe, 2);
  v_pix_payload := public.build_transshipping_pix_payload(v_total_brl, TRIM(p_doc_number));

  INSERT INTO public.demurrage_invoices (
    doc_number, bl_id, customer_id, total_usd, ready_at,
    roe_manual, roe, status, billed_at, first_billed_at,
    current_roe, current_total_brl, roe_source, pix_payload
  ) VALUES (
    TRIM(p_doc_number), p_bl_id, p_customer_id, p_total_usd, p_ready_at,
    COALESCE(p_roe_manual, false), p_roe, 'issued', v_business_date, v_business_date,
    p_current_roe, v_total_brl, p_roe_source, v_pix_payload
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.demurrage_invoice_items (
    invoice_id, container_id, container_number, container_type,
    discharge_date, return_date, total_days, free_days,
    days_p1, rate_p1_usd, days_p2, rate_p2_usd, subtotal_usd
  )
  SELECT
    v_invoice_id, item.container_id, item.container_number, item.container_type,
    item.discharge_date, item.return_date, item.total_days, item.free_days,
    item.days_p1, item.rate_p1_usd, item.days_p2, item.rate_p2_usd, item.subtotal_usd
    FROM jsonb_to_recordset(p_items) AS item(
      container_id bigint,
      container_number text,
      container_type text,
      discharge_date date,
      return_date date,
      total_days integer,
      free_days integer,
      days_p1 integer,
      rate_p1_usd numeric,
      days_p2 integer,
      rate_p2_usd numeric,
      subtotal_usd numeric
    );

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (v_invoice_id, v_business_date, v_ptax, p_current_roe, p_total_usd, v_total_brl, 0, p_roe_source);

  RETURN jsonb_build_object('invoice_id', v_invoice_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_from_bls_core(p_bl_ids text[], p_customer_id bigint, p_notes text DEFAULT NULL::text, p_issue_now boolean DEFAULT true, p_actor uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'internal'::text, p_portal_account_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_requested_bls TEXT[];
  v_bl_count INTEGER;
  v_missing_bls TEXT;
  v_customer_id BIGINT;
  v_max_customer_id BIGINT;
  v_conflict_count INTEGER;
  v_usd_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total_brl NUMERIC(14,2);
  v_item_count INTEGER;
  v_status TEXT;
  v_batch_id BIGINT;
  v_roe NUMERIC(10,4);
  v_roe_effective_date DATE;
BEGIN
  v_status := CASE WHEN COALESCE(p_issue_now, true) THEN 'issued' ELSE 'draft' END;

  SELECT ARRAY_AGG(DISTINCT UPPER(TRIM(bl_id)) ORDER BY UPPER(TRIM(bl_id)))
  INTO v_requested_bls
  FROM UNNEST(COALESCE(p_bl_ids, ARRAY[]::TEXT[])) AS input(bl_id)
  WHERE TRIM(COALESCE(bl_id, '')) <> '';

  IF COALESCE(ARRAY_LENGTH(v_requested_bls, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado para emissão.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.bls
  WHERE id = ANY(v_requested_bls)
  FOR UPDATE;

  SELECT COUNT(*) INTO v_bl_count
  FROM public.bls
  WHERE id = ANY(v_requested_bls);

  IF v_bl_count <> ARRAY_LENGTH(v_requested_bls, 1) THEN
    SELECT STRING_AGG(req.bl_id, ', ' ORDER BY req.bl_id)
    INTO v_missing_bls
    FROM UNNEST(v_requested_bls) AS req(bl_id)
    LEFT JOIN public.bls AS b ON b.id = req.bl_id
    WHERE b.id IS NULL;

    RAISE EXCEPTION 'B/L(s) não encontrado(s): %', COALESCE(v_missing_bls, '-')
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.charge_status, 'not_calculated') <> 'ready_for_billing'
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls devem estar como ready_for_billing.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND COALESCE(b.financial_status, 'pending') <> 'pending'
  ) THEN
    RAISE EXCEPTION 'Existe B/L já faturado/pago/cancelado na seleção.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bls AS b
    WHERE b.id = ANY(v_requested_bls)
      AND (b.customer_id IS NULL OR COALESCE(b.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled'))
  ) THEN
    RAISE EXCEPTION 'Todos os B/Ls precisam de cliente reconciliado para faturar.' USING ERRCODE = '22023';
  END IF;

  SELECT MIN(b.customer_id), MAX(b.customer_id)
  INTO v_customer_id, v_max_customer_id
  FROM public.bls AS b
  WHERE b.id = ANY(v_requested_bls);

  IF v_customer_id IS NULL OR v_customer_id <> v_max_customer_id THEN
    RAISE EXCEPTION 'Seleção contém B/Ls de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id <> v_customer_id THEN
    RAISE EXCEPTION 'Cliente informado não corresponde aos B/Ls selecionados.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.customer_billing_access_ready(v_customer_id) THEN
    RAISE EXCEPTION 'Emissão bloqueada: conta do Portal do cliente não está pronta para receber a fatura.' USING ERRCODE = 'P0003';
  END IF;

  SELECT COUNT(*)
  INTO v_conflict_count
  FROM public.invoice_bls AS ib
  JOIN public.invoices AS inv ON inv.id = ib.invoice_id
  WHERE ib.bl_id = ANY(v_requested_bls)
    AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Existe B/L vinculado à invoice ativa.' USING ERRCODE = '23505';
  END IF;

  -- ADR 0094: cada B/L converte pelo câmbio fixado no primeiro cálculo; o do
  -- dia só vale para B/L sem câmbio fixado.
  SELECT COUNT(*)
  INTO v_usd_count
  FROM public.charge_calculations AS cc
  LEFT JOIN public.bl_price_freezes AS fz ON fz.bl_id = cc.bl_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND fz.roe IS NULL
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_usd_count > 0 THEN
    SELECT roe, effective_date INTO v_roe, v_roe_effective_date
    FROM public.exchange_rate_reference WHERE id = 1;

    IF v_roe IS NULL THEN
      RAISE EXCEPTION 'Câmbio (ROE) não configurado; não é possível converter linhas em USD para emitir a fatura.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF ARRAY_LENGTH(v_requested_bls, 1) > 1 THEN
    INSERT INTO public.billing_batches (
      customer_id,
      origin,
      status,
      notes,
      requested_by,
      portal_account_id
    )
    VALUES (
      v_customer_id,
      COALESCE(p_origin, 'internal'),
      'requested',
      NULLIF(TRIM(COALESCE(p_notes, '')), ''),
      p_actor,
      p_portal_account_id
    )
    RETURNING id INTO v_batch_id;
  END IF;

  INSERT INTO public.invoices (
    customer_id,
    bl_id,
    issued_at,
    total_brl,
    status,
    notes,
    total_paid_brl,
    balance_brl,
    issued_by
  )
  VALUES (
    v_customer_id,
    CASE WHEN ARRAY_LENGTH(v_requested_bls, 1) = 1 THEN v_requested_bls[1] ELSE NULL END,
    CASE WHEN v_status = 'issued' THEN now() ELSE NULL END,
    0,
    v_status,
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    0,
    0,
    p_actor
  )
  RETURNING id, invoice_number
  INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_bls (
    invoice_id,
    bl_id,
    charge_status_snapshot,
    financial_status_snapshot,
    subtotal_brl,
    subtotal_usd
  )
  SELECT
    v_invoice_id,
    b.id,
    b.charge_status,
    b.financial_status,
    COALESCE(calc.total_brl, 0),
    COALESCE(calc.total_usd, 0)
  FROM public.bls AS b
  LEFT JOIN (
    -- Bug da review da PR 501 (achado 1): subtotal_brl precisa somar o MESMO
    -- valor convertido que alimenta invoice_items/invoices.total_brl (mesma
    -- conversao USD->BRL feita no INSERT de invoice_items abaixo), e nao
    -- apenas cc.total_value_brl -- que fica NULL para linhas em USD e
    -- deixava o subtotal do B/L zerado/nulo mesmo com fatura cobrando valor
    -- convertido. link_invoice_to_ledger usa esse subtotal para sobrescrever
    -- bl_receivables.original_amount_brl, entao um subtotal errado aqui
    -- zerava o receivable de B/Ls 100% em USD.
    SELECT
      cc.bl_id,
      SUM(COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * COALESCE(fz.roe, v_roe), 2) END, 0)) AS total_brl,
      SUM(COALESCE(cc.total_value_usd, 0)) AS total_usd
    FROM public.charge_calculations AS cc
    LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
    LEFT JOIN public.bl_price_freezes AS fz ON fz.bl_id = cc.bl_id
    WHERE cc.bl_id = ANY(v_requested_bls)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
    GROUP BY cc.bl_id
  ) AS calc ON calc.bl_id = b.id
  WHERE b.id = ANY(v_requested_bls);

  INSERT INTO public.invoice_items (
    invoice_id,
    charge_calculation_id,
    description,
    quantity,
    unit_value_brl,
    total_value_brl,
    bl_id,
    manifest_id,
    charge_table_id,
    charge_item_id,
    source,
    currency,
    unit_value_usd,
    total_value_usd,
    pricing_rule_version_id,
    billing_run_id,
    calculation_key,
    snapshot_payload
  )
  SELECT
    v_invoice_id,
    cc.id,
    CONCAT('BL ', cc.bl_id, ' - ', COALESCE(cti.name, cc.calculation_key, 'Linha de taxa')),
    COALESCE(cc.quantity, 1),
    COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * COALESCE(fz.roe, v_roe), 2) END, 0),
    COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * COALESCE(fz.roe, v_roe), 2) END, 0),
    cc.bl_id,
    cc.manifest_id,
    cc.charge_table_id,
    cc.charge_item_id,
    cc.source,
    COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
    cc.unit_value_usd,
    cc.total_value_usd,
    cc.pricing_rule_version_id,
    cc.billing_run_id,
    cc.calculation_key,
    jsonb_build_object(
      'manifest_id', cc.manifest_id,
      'bl_id', cc.bl_id,
      'charge_table_id', cc.charge_table_id,
      'charge_item_id', cc.charge_item_id,
      'source', cc.source,
      'currency', COALESCE(cti.currency, CASE WHEN COALESCE(cc.total_value_usd, 0) > 0 THEN 'USD' ELSE 'BRL' END),
      'pricing_rule_version_id', cc.pricing_rule_version_id,
      'calculation_key', cc.calculation_key,
      'charge_name', cti.name,
      'shared_quantity_label', CASE
        WHEN cti.application_basis = 'container_distinct_voyage'
          AND cc.quantity > 0 AND cc.quantity < 1
        THEN CONCAT('1/', ROUND(1 / cc.quantity)::INTEGER)
        ELSE NULL
      END,
      'roe', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN COALESCE(fz.roe, v_roe) ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN COALESCE(fz.roe_effective_date, v_roe_effective_date) ELSE NULL END
    )
  FROM public.charge_calculations AS cc
  LEFT JOIN public.charge_table_items AS cti ON cti.id = cc.charge_item_id
  LEFT JOIN public.bl_price_freezes AS fz ON fz.bl_id = cc.bl_id
  WHERE cc.bl_id = ANY(v_requested_bls)
    AND (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma linha BRL elegível para faturamento.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(total_value_brl), 0)
  INTO v_total_brl
  FROM public.invoice_items
  WHERE invoice_id = v_invoice_id;

  UPDATE public.invoices
  SET
    total_brl = v_total_brl,
    total_paid_brl = 0,
    balance_brl = v_total_brl
  WHERE id = v_invoice_id;

  IF v_status = 'issued' THEN
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id = ANY(v_requested_bls);
  END IF;

  IF v_batch_id IS NOT NULL THEN
    UPDATE public.billing_batches
    SET
      status = CASE WHEN v_status = 'issued' THEN 'issued' ELSE 'requested' END,
      invoice_id = v_invoice_id,
      notes = NULLIF(TRIM(COALESCE(p_notes, '')), '')
    WHERE id = v_batch_id;
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    v_invoice_id::TEXT,
    'create_invoice',
    NULL,
    CONCAT('invoice=', v_invoice_number, ' | bl_count=', ARRAY_LENGTH(v_requested_bls, 1), ' | total=', v_total_brl),
    p_actor,
    now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao consolidada via portal do cliente' ELSE 'Emissao de invoice por B/L' END
  );

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', v_status,
    'customer_id', v_customer_id,
    'bl_count', ARRAY_LENGTH(v_requested_bls, 1),
    'total_brl', v_total_brl,
    'balance_brl', v_total_brl,
    'billing_batch_id', v_batch_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_local_consolidated_invoice_core(p_customer_id bigint, p_receivable_ids bigint[], p_actor uuid DEFAULT NULL::uuid, p_origin text DEFAULT 'internal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids BIGINT[];
  v_count INTEGER;
  v_invoice_id BIGINT;
  v_invoice_number TEXT;
  v_total NUMERIC(14,2);
  v_missing_roe_count INTEGER;
  v_bl_without_individual TEXT;
BEGIN
  SELECT ARRAY_AGG(DISTINCT id ORDER BY id)
  INTO v_ids
  FROM UNNEST(COALESCE(p_receivable_ids, ARRAY[]::BIGINT[])) AS u(id)
  WHERE id IS NOT NULL;

  IF COALESCE(ARRAY_LENGTH(v_ids, 1), 0) < 1 THEN
    RAISE EXCEPTION 'Nenhum receivable informado para consolidar.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.customer_billing_access_ready(p_customer_id) THEN
    RAISE EXCEPTION 'Emissão consolidada bloqueada: conta do Portal do cliente não está pronta para receber a fatura.' USING ERRCODE = 'P0003';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  -- ADR 0093, decisão 9 (365): B/L sem individual viva entra na consolidada
  -- como faturamento dele: passa pelas checagens do Emitir (Revisão, CE,
  -- gate) e fica "faturado"; nenhuma individual sai por cima enquanto ela
  -- estiver aberta (gatilho trg_single_open_local_document).
  FOR v_bl_without_individual IN
    SELECT br.bl_id FROM public.bl_receivables br
    WHERE br.id = ANY(v_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices i ON i.id = l.invoice_id
        WHERE l.receivable_id = br.id AND l.status = 'active' AND i.invoice_type = 'individual'
          AND coalesce(i.status, 'issued') IN ('draft', 'issued', 'partially_paid'))
    ORDER BY br.bl_id
  LOOP
    PERFORM public.mark_bl_ready_for_billing(v_bl_without_individual, p_actor);
    UPDATE public.bls SET financial_status = 'invoiced'
     WHERE id = v_bl_without_individual AND coalesce(financial_status, 'pending') = 'pending';
  END LOOP;

  SELECT COUNT(*) INTO v_count FROM public.bl_receivables WHERE id = ANY(v_ids);
  IF v_count <> ARRAY_LENGTH(v_ids, 1) THEN
    RAISE EXCEPTION 'Receivable(s) inexistente(s) na seleção.' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables WHERE id = ANY(v_ids) AND customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'Seleção contém receivables de clientes diferentes.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bl_receivables
    WHERE id = ANY(v_ids) AND (status NOT IN ('open', 'partially_settled') OR balance_brl <= 0)
  ) THEN
    RAISE EXCEPTION 'Todos os receivables precisam estar abertos com saldo positivo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoice_receivable_links l
    JOIN public.invoices inv ON inv.id = l.invoice_id
    WHERE l.receivable_id = ANY(v_ids)
      AND inv.invoice_type = 'consolidated'
      AND COALESCE(inv.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Um ou mais B/Ls já estão em consolidada aberta.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(SUM(balance_brl), 0) INTO v_total
  FROM public.bl_receivables WHERE id = ANY(v_ids);

  INSERT INTO public.invoices (
    customer_id, bl_id, issued_at, total_brl, status, invoice_type,
    notes, total_paid_brl, balance_brl, issued_by
  )
  VALUES (
    p_customer_id, NULL, now(), v_total, 'issued', 'consolidated',
    NULL, 0, v_total, p_actor
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  INSERT INTO public.invoice_receivable_links (invoice_id, receivable_id, bl_id, subtotal_brl, status, bl_snapshot)
  SELECT
    v_invoice_id, br.id, br.bl_id, br.balance_brl, 'active',
    jsonb_build_object('bl_id', br.bl_id, 'voyage_id', br.voyage_id, 'cargo_mode', br.cargo_mode, 'pol', br.pol, 'pod', br.pod)
  FROM public.bl_receivables br
  WHERE br.id = ANY(v_ids);

  -- Achado 4 da review da PR 501: garante que todo receivable USD selecionado
  -- tem ROE congelado antes de montar o detalhamento (evita usar um ROE
  -- global "current" como fallback silencioso).
  SELECT COUNT(*)
  INTO v_missing_roe_count
  FROM public.bl_receivables br
  JOIN public.charge_calculations cc ON cc.bl_id = br.bl_id
  LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
  WHERE br.id = ANY(v_ids)
    AND br.roe_frozen IS NULL
    AND COALESCE(cti.currency, 'BRL') = 'USD'
    AND COALESCE(cc.total_value_usd, 0) > 0
    AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');

  IF v_missing_roe_count > 0 THEN
    RAISE EXCEPTION 'Um ou mais receivables selecionados não têm ROE congelado para linhas em USD; recalcule/atualize o B/L antes de consolidar.' USING ERRCODE = '22023';
  END IF;

  WITH links AS (
    SELECT l.bl_id, l.subtotal_brl, br.roe_frozen, br.roe_effective_date_frozen
    FROM public.invoice_receivable_links l
    JOIN public.bl_receivables br ON br.id = l.receivable_id
    WHERE l.invoice_id = v_invoice_id
  ),
  calcs AS (
    SELECT
      cc.bl_id, cc.id AS charge_calculation_id, cc.charge_table_id, cc.charge_item_id,
      cc.quantity,
      COALESCE(cc.unit_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.unit_value_usd, 0) * links.roe_frozen, 2) END) AS unit_value_brl,
      COALESCE(cc.total_value_brl, CASE WHEN COALESCE(cti.currency, 'BRL') = 'USD' THEN ROUND(COALESCE(cc.total_value_usd, 0) * links.roe_frozen, 2) END, 0) AS total_value_brl,
      cti.currency, cti.application_basis,
      cc.unit_value_usd, cc.total_value_usd, cc.calculation_key, cti.name AS charge_name,
      links.roe_frozen, links.roe_effective_date_frozen
    FROM public.charge_calculations cc
    JOIN links ON links.bl_id = cc.bl_id
    LEFT JOIN public.charge_table_items cti ON cti.id = cc.charge_item_id
    WHERE (COALESCE(cc.total_value_brl, 0) > 0 OR COALESCE(cc.total_value_usd, 0) > 0)
      AND COALESCE(cc.status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing')
  ),
  bl_recon AS (
    SELECT links.bl_id, links.subtotal_brl,
      COUNT(calcs.charge_calculation_id) AS calc_count,
      COALESCE(SUM(calcs.total_value_brl), 0) AS detailed_sum
    FROM links
    LEFT JOIN calcs ON calcs.bl_id = links.bl_id
    GROUP BY links.bl_id, links.subtotal_brl
  )
  INSERT INTO public.invoice_items (
    invoice_id, charge_calculation_id, description, quantity, unit_value_brl,
    total_value_brl, bl_id, charge_table_id, charge_item_id, source, currency,
    unit_value_usd, total_value_usd, calculation_key, snapshot_payload
  )
  SELECT
    v_invoice_id, calcs.charge_calculation_id,
    CONCAT('BL ', calcs.bl_id, ' - ', COALESCE(calcs.charge_name, calcs.calculation_key, 'Linha de taxa')),
    COALESCE(calcs.quantity, 1), calcs.unit_value_brl, calcs.total_value_brl,
    calcs.bl_id, calcs.charge_table_id, calcs.charge_item_id, 'ledger',
    COALESCE(calcs.currency, 'BRL'), calcs.unit_value_usd, calcs.total_value_usd,
    calcs.calculation_key,
    jsonb_build_object(
      'reconciled', true,
      'shared_quantity_label', CASE
        WHEN calcs.application_basis = 'container_distinct_voyage'
          AND calcs.quantity > 0 AND calcs.quantity < 1
        THEN CONCAT('1/', ROUND(1 / calcs.quantity)::INTEGER)
        ELSE NULL
      END,
      'roe', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_frozen ELSE NULL END,
      'roe_effective_date', CASE WHEN COALESCE(calcs.currency, 'BRL') = 'USD' THEN calcs.roe_effective_date_frozen ELSE NULL END
    )
  FROM calcs
  JOIN bl_recon ON bl_recon.bl_id = calcs.bl_id
  WHERE bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01
  UNION ALL
  SELECT
    v_invoice_id, NULL, CONCAT('BL ', bl_recon.bl_id, ' - Taxas locais'),
    1, bl_recon.subtotal_brl, bl_recon.subtotal_brl,
    bl_recon.bl_id, NULL, NULL, 'ledger', 'BRL', NULL, NULL, NULL,
    jsonb_build_object('reconciled', false)
  FROM bl_recon
  WHERE NOT (bl_recon.calc_count > 0 AND ABS(bl_recon.detailed_sum - bl_recon.subtotal_brl) < 0.01);

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, actor, payload)
  VALUES (v_invoice_id, 'issued', p_actor,
    jsonb_build_object('invoice_type', 'consolidated', 'receivable_count', ARRAY_LENGTH(v_ids, 1), 'total_brl', v_total, 'origin', COALESCE(p_origin, 'internal')));

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('invoice', v_invoice_id::TEXT, 'create_consolidated', NULL,
    CONCAT('invoice=', v_invoice_number, ' | receivables=', ARRAY_LENGTH(v_ids, 1), ' | total=', v_total),
    p_actor, now(),
    CASE WHEN COALESCE(p_origin, 'internal') = 'portal' THEN 'Emissao de consolidada via portal do cliente' ELSE 'Emissao de consolidada via ledger' END);

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'status', 'issued',
    'invoice_type', 'consolidated',
    'receivable_count', ARRAY_LENGTH(v_ids, 1),
    'total_brl', v_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_portal_customer_id()
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_customer_id bigint;
  v_revoked_at timestamptz;
  v_issued_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão do portal inválida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.customer_id, a.credentials_revoked_at
  INTO v_customer_id, v_revoked_at
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid()
    AND a.active = true;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Sessão do portal inválida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Acesso ao Portal encerrado: cliente desativado.' USING ERRCODE = '28000';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    -- Sem iat confiável não há como provar emissão pós-revogação.
    BEGIN
      v_issued_at := to_timestamp(NULLIF(auth.jwt() ->> 'iat', '')::double precision);
    EXCEPTION WHEN OTHERS THEN
      v_issued_at := NULL;
    END;

    IF v_issued_at IS NULL OR v_issued_at < v_revoked_at THEN
      RAISE EXCEPTION 'Sessão do portal inválida ou expirada.' USING ERRCODE = '28000';
    END IF;
  END IF;

  RETURN v_customer_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_manual_vazios_booking(p_booking_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_booking RECORD;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para excluir unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da exclusão.' USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.manifest_id, b.voyage_id, COALESCE(op.embark_port, b.pol) AS port
    INTO v_booking
  FROM public.vazios_bookings AS b
  LEFT JOIN public.vazios_export_operations AS op ON op.id = b.operation_id
  WHERE b.id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RAISE EXCEPTION 'Unidade embarcada não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF public._vazios_export_locked_by_adr(v_booking.voyage_id, v_booking.port) THEN
    RAISE EXCEPTION 'ADR de Saída fechado: reabra o ADR para excluir a unidade.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('vela.delete_reason', v_reason, true);
  DELETE FROM public.vazios_bookings WHERE id = p_booking_id;
  PERFORM set_config('vela.delete_reason', '', true);

  DELETE FROM public.vazios_manifests manifest
  WHERE manifest.id = v_booking.manifest_id
    AND manifest.description = 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_bookings booking
      WHERE booking.manifest_id = manifest.id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_agency_departure_report(p_voyage_id bigint, p_port text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF v_port = '' THEN
    RAISE EXCEPTION 'Porto obrigatorio.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id IS NULL
  FOR UPDATE;
  IF FOUND THEN
    RETURN v_report_id;
  END IF;

  -- B6: escala com frente de operação (gravada ou derivada dos dados, como na
  -- aba ADR) é do modelo terminalizado. Sem terminal atribuído (frentes TBC)
  -- não há ADR a abrir; o ADR legado por porto só continua para as escalas sem
  -- frente e para os relatórios que já existem.
  IF public._escala_has_operation_fronts(p_voyage_id, v_port) THEN
    RAISE EXCEPTION 'Escala com frentes de operação: atribua o terminal às frentes para abrir o ADR do terminal.'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.agency_departure_reports (voyage_id, port)
  VALUES (p_voyage_id, v_port)
  RETURNING id INTO v_report_id;
  RETURN v_report_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_invoice_correction_summary_legacy_130(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Sem permissão para consultar correção.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('stale', EXISTS (SELECT 1 FROM public.alert_items ai JOIN public.alerts a ON a.id = ai.alert_id WHERE ai.item_type = 'fatura_desatualizada' AND ai.status = 'active' AND a.entity_type = 'invoice' AND a.entity_id = p_invoice_id::text), 'receivables', (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', br.id, 'bl_id', br.bl_id, 'original_brl', br.original_amount_brl,
    'corrected_brl', br.original_amount_brl - br.correction_amount_brl,
    'paid_brl', br.settled_amount_brl, 'balance_brl', br.balance_brl)), '[]'::jsonb)
    FROM public.bl_receivables br JOIN public.invoice_receivable_links l ON l.receivable_id = br.id
    WHERE l.invoice_id = p_invoice_id AND l.status IN ('active', 'settled_by_this_invoice')),
    'corrections', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'amount_brl', c.amount_brl,
      'offset_brl', c.offset_brl, 'refund_brl', c.refund_brl, 'corrected_total_brl', c.corrected_total_brl,
      'reason', c.reason, 'created_at', c.created_at, 'bl_id', br.bl_id) ORDER BY c.id), '[]'::jsonb)
      FROM public.invoice_corrections c JOIN public.bl_receivables br ON br.id = c.receivable_id
      WHERE c.receivable_id IN (SELECT receivable_id FROM public.invoice_receivable_links WHERE invoice_id = p_invoice_id)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_invoice_reissue_links(p_invoice_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice record;
  v_replaces jsonb;
  v_replaced_by jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  SELECT id, status, replaces_invoice_id, reissue_requested_at, reissue_closed_at, reissue_closed_reason INTO v_invoice
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_build_object('id', p.id, 'invoice_number', p.invoice_number) INTO v_replaces
  FROM public.invoices p WHERE p.id = v_invoice.replaces_invoice_id;

  SELECT jsonb_build_object('id', s.id, 'invoice_number', s.invoice_number) INTO v_replaced_by
  FROM public.invoices s WHERE s.replaces_invoice_id = p_invoice_id;

  RETURN jsonb_build_object(
    'replaces', v_replaces,
    'replaced_by', v_replaced_by,
    'reissue_pending', v_invoice.reissue_requested_at IS NOT NULL AND v_invoice.reissue_closed_at IS NULL AND v_replaced_by IS NULL,
    'reissue_closed_reason', v_invoice.reissue_closed_reason
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_cancel_invoice_with_correction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND EXISTS (
    SELECT 1 FROM public.invoice_corrections c
    JOIN public.invoice_receivable_links l ON l.receivable_id = c.receivable_id
    WHERE l.invoice_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Fatura com correção registrada não pode ser cancelada; para diferença adicional use fatura avulsa ou nova correção.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_cancel_settled_elsewhere()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    IF OLD.status = 'covered' THEN
      RAISE EXCEPTION 'Fatura % coberta por outro documento pago: o B/L já foi pago e ela não pode ser cancelada.',
        coalesce(OLD.invoice_number, OLD.id::text) USING ERRCODE = '22023';
    END IF;
    -- A individual cancelada soltaria o B/L para nova fatura; a consolidada
    -- cancelada devolve o B/L às individuais, que continuam.
    IF OLD.invoice_type = 'individual' AND EXISTS (
      SELECT 1 FROM public.invoice_receivable_links l
      JOIN public.ledger_settlements s ON s.receivable_id = l.receivable_id AND s.invoice_id <> OLD.id
      WHERE l.invoice_id = OLD.id AND l.status IN ('active', 'settled_elsewhere')) THEN
      RAISE EXCEPTION 'Fatura % tem B/L com baixa em outro documento; cancele a baixa naquele documento antes.',
        coalesce(OLD.invoice_number, OLD.id::text) USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ce_mercante_unique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_key text := public.ce_mercante_key(NEW.ce_mercante);
  v_holder text;
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_self text := NEW.id::text;
  v_reactivation boolean;
BEGIN
  -- Granito não tem cancelamento; o jsonb evita ler coluna inexistente.
  v_reactivation := TG_TABLE_NAME = 'bls' AND TG_OP = 'UPDATE'
    AND v_old->>'cancelled_at' IS NOT NULL AND v_new->>'cancelled_at' IS NULL;
  IF v_key IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'bls' AND v_new->>'cancelled_at' IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NOT v_reactivation
     AND public.ce_mercante_key(v_old->>'ce_mercante') IS NOT DISTINCT FROM v_key THEN
    RETURN NEW;
  END IF;

  -- Serializa o mesmo CE: a segunda transação espera e vê o B/L da primeira.
  PERFORM pg_advisory_xact_lock(hashtextextended('ce_mercante:' || v_key, 0));

  SELECT holder INTO v_holder FROM (
    SELECT 'B/L ' || b.id AS holder
    FROM public.bls AS b
    WHERE b.cancelled_at IS NULL
      AND public.ce_mercante_key(b.ce_mercante) = v_key
      AND (TG_TABLE_NAME <> 'bls' OR b.id <> v_self)
    UNION ALL
    SELECT 'B/L de Granito ' || g.bl_number
    FROM public.granite_bls AS g
    WHERE public.ce_mercante_key(g.ce_mercante) = v_key
      AND (TG_TABLE_NAME <> 'granite_bls' OR g.id::text <> v_self)
  ) AS holders
  ORDER BY holder
  LIMIT 1;

  IF v_holder IS NOT NULL THEN
    IF v_reactivation THEN
      RAISE EXCEPTION 'O B/L % não pode ser reativado: o CE Mercante % dele está agora no %. Um CE só pode estar em um B/L não cancelado.',
        v_self, NEW.ce_mercante, v_holder USING ERRCODE = 'P0010';
    END IF;
    RAISE EXCEPTION 'O CE Mercante % já está no %. Um CE só pode estar em um B/L não cancelado: confira o número ou cancele o outro B/L.',
      NEW.ce_mercante, v_holder USING ERRCODE = 'P0010';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_ledger_settlement_allocation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_original numeric(14,2);
  v_allocated numeric(14,2);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.receivable_id IS DISTINCT FROM NEW.receivable_id THEN
    PERFORM 1
    FROM public.bl_receivables
    WHERE id = OLD.receivable_id
    FOR UPDATE;
  END IF;

  SELECT original_amount_brl
    INTO v_original
  FROM public.bl_receivables
  WHERE id = NEW.receivable_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receivable % nao encontrado.', NEW.receivable_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(s.amount_brl), 0)
    INTO v_allocated
  FROM public.ledger_settlements AS s
  WHERE s.receivable_id = NEW.receivable_id
    AND (TG_OP <> 'UPDATE' OR s.id <> OLD.id);

  IF ROUND(v_allocated + COALESCE(NEW.amount_brl, 0), 2)
     > ROUND(COALESCE(v_original, 0) + 0.01, 2) THEN
    RAISE EXCEPTION 'Alocação do receivable % excede o valor original (%).',
      NEW.receivable_id, v_original
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_payment_reversal_after_correction()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_refunds numeric; v_paid numeric;
BEGIN
  PERFORM 1 FROM public.invoices WHERE id = OLD.invoice_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.invoice_refunds r
    WHERE r.invoice_id = OLD.invoice_id AND r.status <> 'cancelled' AND r.correction_receivable_id IS NOT NULL
    GROUP BY r.correction_receivable_id
    HAVING sum(r.amount_brl) > coalesce((SELECT sum(s.amount_brl) FROM public.ledger_settlements s
      WHERE s.invoice_id = OLD.invoice_id AND s.receivable_id = r.correction_receivable_id AND s.payment_id <> OLD.id), 0)
  ) THEN
    RAISE EXCEPTION 'Esta baixa financia restituição por correção deste recebível. Confira a restituição antes de cancelar a baixa.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_corrections WHERE invoice_id = OLD.invoice_id)
     OR EXISTS (SELECT 1 FROM public.invoice_refunds WHERE invoice_id = OLD.invoice_id AND status <> 'cancelled') THEN
    SELECT coalesce(sum(amount_brl), 0) INTO v_refunds FROM public.invoice_refunds WHERE invoice_id = OLD.invoice_id AND status <> 'cancelled';
    SELECT coalesce(sum(amount_brl), 0) INTO v_paid FROM public.payments WHERE invoice_id = OLD.invoice_id AND id <> OLD.id;
    IF v_refunds > v_paid THEN
      RAISE EXCEPTION 'Esta baixa financia restituição. Confira a restituição antes de cancelar a baixa.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_shared_container_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sibling record;
  v_live bigint[];
BEGIN
  -- O rateio com que o B/L entra nesta fatura.
  NEW.container_shares := public.bl_container_share_signature(NEW.bl_id);

  -- Irmão faturado em outra fatura com rateio que não é mais o atual: a
  -- fatura dele precisa ser reemitida antes (ADR 0077); faturar este B/L agora
  -- cobraria o container mais de uma vez.
  FOR v_sibling IN
    SELECT DISTINCT ON (sibling.id) sibling.id, upper(btrim(sibling_container.container_number)) AS container_number,
      link.container_shares AS billed_shares, invoice.status AS invoice_status
    FROM public.bl_containers AS own_container
    JOIN public.bls AS root ON root.id = own_container.bl_id
    JOIN public.bl_containers AS sibling_container
      ON upper(btrim(sibling_container.container_number)) = upper(btrim(own_container.container_number))
    JOIN public.bls AS sibling ON sibling.id = sibling_container.bl_id
    JOIN public.invoice_bls AS link ON link.bl_id = sibling.id
    JOIN public.invoices AS invoice ON invoice.id = link.invoice_id
    WHERE own_container.bl_id = NEW.bl_id
      AND sibling.id <> NEW.bl_id
      AND sibling.voyage_id = root.voyage_id
      AND sibling.cancelled_at IS NULL
      AND sibling.financial_status IN ('invoiced', 'paid')
      AND link.invoice_id <> NEW.invoice_id
      AND COALESCE(invoice.status, 'issued') NOT IN ('cancelled', 'obsolete', 'draft')
    ORDER BY sibling.id, link.id DESC
  LOOP
    IF v_sibling.billed_shares IS NOT NULL
       AND v_sibling.billed_shares IS DISTINCT FROM public.bl_container_share_signature(v_sibling.id) THEN
      -- Com pagamento (ou coberta por consolidada paga), a fatura do irmão não
      -- é reemitida (ADR 0077, item 4): a diferença já seguiu por abatimento ou
      -- restituição e o vínculo guarda o rateio antigo para sempre. Este B/L
      -- fatura com o rateio atual. Mesma régua de "com pagamento" de
      -- `apply_invoice_basis_changes_legacy_130`.
      v_live := public._live_local_invoice_ids_for_bl(v_sibling.id);
      CONTINUE WHEN v_sibling.invoice_status IN ('partially_paid', 'paid', 'covered')
        OR EXISTS (SELECT 1 FROM public.payments AS p WHERE p.invoice_id = ANY(v_live))
        OR EXISTS (SELECT 1 FROM public.invoices AS i WHERE i.id = ANY(v_live) AND i.status IN ('partially_paid', 'paid'))
        OR EXISTS (
          SELECT 1 FROM public.invoice_corrections AS c
          JOIN public.bl_receivables AS r ON r.id = c.receivable_id
          WHERE r.bl_id = v_sibling.id AND r.source = 'local_charges'
        );
      RAISE EXCEPTION
        'O B/L irmão % (container compartilhado %) foi faturado com outro rateio do container; a fatura dele precisa ser reemitida com o rateio atual antes de faturar o B/L %.',
        v_sibling.id, v_sibling.container_number, NEW.bl_id
        USING ERRCODE = 'P0007';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_single_open_local_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status <> 'active' OR NOT EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = NEW.invoice_id AND i.invoice_type = 'individual'
      AND coalesce(i.status, 'issued') IN ('draft', 'issued', 'partially_paid')) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoice_receivable_links l JOIN public.invoices o ON o.id = l.invoice_id
    WHERE l.receivable_id = NEW.receivable_id AND l.invoice_id <> NEW.invoice_id AND l.status = 'active'
      AND o.invoice_type IN ('individual', 'consolidated')
      AND coalesce(o.status, 'issued') IN ('draft', 'issued', 'partially_paid')) THEN
    RAISE EXCEPTION 'O B/L % já tem documento de Taxas Locais aberto (individual ou consolidada); não emita outro por cima.', NEW.bl_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_voyage_hard_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_table text;
  v_column text;
  v_has_rows boolean;
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Viagem % cancelada deve permanecer retida; use a rotina de recuperação explícita.', OLD.id
      USING ERRCODE = '42501';
  END IF;

  -- O catalogo e a fonte da lista: uma nova tabela que passe a apontar para
  -- uma Viagem nao pode abrir uma cascata silenciosa por falta de atualizacao
  -- deste guard. O cast textual permite cobrir voyage_id bigint e integer, e
  -- tambem referencias opcionais como customer_communications.anchor_voyage_id.
  FOR v_table, v_column IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns AS c
    JOIN information_schema.tables AS t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('voyage_id', 'anchor_voyage_id')
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'voyages' AND c.table_name NOT IN ('voyage_documental_state', 'voyage_documental_pending')
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
         FROM public.%I
         WHERE %I IS NOT NULL AND %I::text = $1::text
       )',
      v_table,
      v_column,
      v_column
    )
    INTO v_has_rows
    USING OLD.id;

    IF v_has_rows THEN
      RAISE EXCEPTION 'Viagem % não pode ser excluída: há dados vinculados em %.%.', OLD.id, v_table, v_column
        USING ERRCODE = 'P0003';
    END IF;
  END LOOP;

  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_bl_freight_with_metadata_legacy_189(p_bls jsonb, p_changed_by uuid, p_batch jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_batch_id bigint := NULL;
  v_filename text;
  v_voyage_id bigint;
  v_cargo_mode text := 'container';
  v_total_bls integer;
  v_bl_id text;
  v_mismatch integer := 0;
  v_updated integer := 0;
  v_action_id uuid := gen_random_uuid();
  v_item jsonb;
  v_physical_effect jsonb;
  v_physical_effect_id bigint;
  v_calc_errors jsonb := '[]'::jsonb;
  v_batch_containers jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF p_bls IS NULL OR jsonb_typeof(p_bls) <> 'array' OR jsonb_array_length(p_bls) = 0 THEN
    RAISE EXCEPTION 'Nenhum B/L informado.' USING ERRCODE = '22023';
  END IF;

  v_result := public.import_bl_freight_transactional(p_bls, p_changed_by);

  -- O batch e opcional (ADR 0017): mesmo no B/L avulso o calculo inicial
  -- deve acontecer nesta mesma operacao, sem depender de worker offline.
  IF p_batch IS NOT NULL THEN
    v_filename := NULLIF(btrim(COALESCE(p_batch->>'filename', '')), '');
    v_voyage_id := NULLIF(btrim(COALESCE(p_batch->>'voyage_id', '')), '')::bigint;
    v_cargo_mode := COALESCE(NULLIF(btrim(COALESCE(p_batch->>'cargo_mode', '')), ''), 'container');
    IF v_filename IS NULL OR v_voyage_id IS NULL THEN
      RAISE EXCEPTION 'Batch invalido: filename e voyage_id obrigatorios.' USING ERRCODE = '22023';
    END IF;
    IF v_cargo_mode NOT IN ('container', 'carga_solta') THEN
      RAISE EXCEPTION 'cargo_mode de batch invalido.' USING ERRCODE = '22023';
    END IF;

    PERFORM 1 FROM public.voyages WHERE id = v_voyage_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Viagem % não encontrada', v_voyage_id USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*) INTO v_mismatch
    FROM jsonb_array_elements(p_bls) AS item
    WHERE (item->>'voyage_id')::bigint IS DISTINCT FROM v_voyage_id;
    IF v_mismatch > 0 THEN
      RAISE EXCEPTION 'Batch da viagem % com B/L de outra viagem.', v_voyage_id USING ERRCODE = '22023';
    END IF;

    v_total_bls := jsonb_array_length(p_bls);

    INSERT INTO public.import_batches(
      filename, voyage_id, cargo_mode, uploaded_by, status, total_bls, total_containers
    ) VALUES (
      v_filename, v_voyage_id, v_cargo_mode, v_actor, 'completed', v_total_bls, NULL
    ) RETURNING id INTO v_batch_id;

    UPDATE public.bls AS b
      SET batch_id = v_batch_id
      FROM jsonb_array_elements(p_bls) AS item
      WHERE b.id = item->>'id' AND b.voyage_id = v_voyage_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> v_total_bls THEN
      RAISE EXCEPTION 'Vinculo de batch falhou: % de % B/Ls vinculados.', v_updated, v_total_bls USING ERRCODE = 'P0002';
    END IF;

    -- Migration 178: sem efeito `physical_flags`; as flags do lote são
    -- aplicadas logo abaixo, na mesma transação.

    -- Baplie soberano em qualquer ordem (migration 118): se o Baplie da
    -- viagem ja existe, as flags fisicas valem antes do calculo inicial
    -- abaixo; o runner do efeito acima nao e pre-requisito.
    -- Migration 150: só os contêineres deste lote (sem filtro a função varre
    -- a viagem inteira, ~3 s numa viagem de ~500 B/Ls).
    SELECT jsonb_agg(DISTINCT upper(btrim(container->>'container_number')))
      INTO v_batch_containers
      FROM jsonb_array_elements(p_bls) AS item,
           jsonb_array_elements(COALESCE(item->'containers', '[]'::jsonb)) AS container
      WHERE NULLIF(btrim(COALESCE(container->>'container_number', '')), '') IS NOT NULL;
    IF v_batch_containers IS NOT NULL THEN
      PERFORM public.apply_baplie_physical_flags_atomic(v_voyage_id, v_batch_containers, v_actor);
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bls)
  LOOP
    -- Preserva o ID exato que foi persistido em public.bls
    v_bl_id := v_item->>'id';
    CONTINUE WHEN v_bl_id IS NULL OR btrim(v_bl_id) = '';
    -- B/L faturado não é recalculado aqui (migration 175, M02): a fatura
    -- emitida segue a ADR 0077 pela base capturada na própria importação.
    -- Recalcular só devolvia "recalculo bloqueado" e enfileirava
    -- provisional_charges em toda reimportação idêntica.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM public.bls
      WHERE id = v_bl_id AND COALESCE(financial_status, 'pending') IN ('invoiced', 'paid')
    ) OR cardinality(public._live_local_invoice_ids_for_bl(v_bl_id)) > 0;

    -- ADR 0094, B3: falha de cálculo recusa o arquivo inteiro, com o B/L e o
    -- que falta (antes: rastro e efeito `provisional_charges` de recuperação).
    BEGIN
      PERFORM public.calculate_bl_local_charges(v_bl_id, v_actor, true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._raise_local_charge_failure(v_bl_id, SQLSTATE, SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('result', v_result, 'batch_id', v_batch_id, 'calculation_errors', v_calc_errors);
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_manifest_transactional_legacy_165(p_filename text, p_voyage_id bigint, p_uploaded_by uuid, p_cargo_mode text, p_file_hash text, p_total_bls integer, p_total_containers integer, p_bls jsonb, p_containers jsonb, p_errors jsonb, p_apply_overwrites boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch_id BIGINT;
  v_bl_ids TEXT[];
  v_error_count INT;
  v_missing_container_refs INT;
  v_ambiguous_container_refs INT;
  v_recent_imports INT;
  v_existing_bl_ids TEXT[];
BEGIN
  SELECT COUNT(*) INTO v_recent_imports
  FROM public.import_batches
  WHERE uploaded_by = p_uploaded_by
    AND created_at > NOW() - INTERVAL '60 seconds';

  IF COALESCE(v_recent_imports, 0) >= 5 THEN
    RAISE EXCEPTION 'Limite de importacoes atingido. Aguarde 60 segundos antes de importar novamente.'
      USING ERRCODE = 'P0429';
  END IF;

  IF p_voyage_id IS NULL THEN
    RAISE EXCEPTION 'voyage_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % não encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  v_error_count := COALESCE(jsonb_array_length(p_errors), 0);

  INSERT INTO public.import_batches(
    filename, voyage_id, cargo_mode, uploaded_by, status,
    total_bls, total_containers, error_count, file_hash
  )
  VALUES (
    p_filename,
    p_voyage_id,
    COALESCE(p_cargo_mode, 'container'),
    p_uploaded_by,
    'processing',
    p_total_bls,
    p_total_containers,
    v_error_count,
    p_file_hash
  )
  RETURNING id INTO v_batch_id;

  CREATE TEMP TABLE pg_temp.tmp_old_containers (
    old_container_id BIGINT PRIMARY KEY,
    bl_id TEXT NOT NULL,
    container_number TEXT NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_new_containers (
    new_container_id BIGINT PRIMARY KEY,
    bl_id TEXT NOT NULL,
    container_number TEXT NOT NULL
  ) ON COMMIT DROP;

  CREATE TEMP TABLE pg_temp.tmp_container_rebind (
    old_container_id BIGINT PRIMARY KEY,
    new_container_id BIGINT NOT NULL
  ) ON COMMIT DROP;

  IF p_bls IS NOT NULL AND jsonb_array_length(p_bls) > 0 THEN
    SELECT array_agg(b.id) INTO v_existing_bl_ids FROM public.bls b
      WHERE b.id IN (SELECT x->>'id' FROM jsonb_array_elements(p_bls) x);

    INSERT INTO public.bls (
      id,
      voyage_id,
      batch_id,
      cargo_mode,
      shipper,
      consignee,
      cargo_description,
      customer_id,
      pol,
      pod,
      total_weight_kg,
      total_cbm,
      review_status,
      financial_status,
      notes,
      manifest_customer_cnpj_cpf,
      manifest_customer_name,
      manifest_customer_email,
      customer_reconciliation_status,
      customer_reconciliation_notes,
      billing_hold_reason
    )
    SELECT
      bl->>'id',
      p_voyage_id,
      v_batch_id,
      COALESCE(p_cargo_mode, 'container'),
      bl->>'shipper',
      bl->>'consignee',
      bl->>'cargo_description',
      NULLIF(bl->>'customer_id', '')::BIGINT,
      bl->>'pol',
      bl->>'pod',
      NULLIF(bl->>'total_weight_kg', '')::NUMERIC,
      NULLIF(bl->>'total_cbm', '')::NUMERIC,
      COALESCE(bl->>'review_status', 'ok'),
      COALESCE(bl->>'financial_status', 'pending'),
      bl->>'notes',
      public.normalize_document_text(bl->>'manifest_customer_cnpj_cpf'),
      COALESCE(NULLIF(bl->>'manifest_customer_name', ''), bl->>'consignee'),
      NULLIF(bl->>'manifest_customer_email', ''),
      COALESCE(
        NULLIF(bl->>'customer_reconciliation_status', ''),
        CASE
          WHEN NULLIF(bl->>'customer_id', '') IS NOT NULL THEN 'reconciled'
          ELSE 'missing_customer'
        END
      ),
      NULLIF(bl->>'customer_reconciliation_notes', ''),
      NULLIF(bl->>'billing_hold_reason', '')
    FROM jsonb_array_elements(p_bls) AS bl
    ON CONFLICT (id) DO UPDATE SET
      voyage_id = EXCLUDED.voyage_id,
      batch_id = EXCLUDED.batch_id,
      cargo_mode = EXCLUDED.cargo_mode,
      shipper = CASE WHEN p_apply_overwrites THEN EXCLUDED.shipper ELSE public.bls.shipper END,
      consignee = CASE WHEN p_apply_overwrites THEN EXCLUDED.consignee ELSE public.bls.consignee END,
      cargo_description = CASE WHEN p_apply_overwrites THEN EXCLUDED.cargo_description ELSE public.bls.cargo_description END,
      customer_id = EXCLUDED.customer_id,
      pol = CASE WHEN p_apply_overwrites THEN EXCLUDED.pol ELSE public.bls.pol END,
      pod = CASE WHEN p_apply_overwrites THEN EXCLUDED.pod ELSE public.bls.pod END,
      total_weight_kg = CASE WHEN p_apply_overwrites THEN EXCLUDED.total_weight_kg ELSE public.bls.total_weight_kg END,
      total_cbm = CASE WHEN p_apply_overwrites THEN EXCLUDED.total_cbm ELSE public.bls.total_cbm END,
      review_status = EXCLUDED.review_status,
      financial_status = EXCLUDED.financial_status,
      notes = EXCLUDED.notes,
      manifest_customer_cnpj_cpf = EXCLUDED.manifest_customer_cnpj_cpf,
      manifest_customer_name = EXCLUDED.manifest_customer_name,
      manifest_customer_email = EXCLUDED.manifest_customer_email,
      customer_reconciliation_status = EXCLUDED.customer_reconciliation_status,
      customer_reconciliation_notes = EXCLUDED.customer_reconciliation_notes,
      billing_hold_reason = EXCLUDED.billing_hold_reason;

    IF p_apply_overwrites AND v_existing_bl_ids IS NOT NULL AND array_length(v_existing_bl_ids, 1) > 0 THEN
      INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
      SELECT 'bl', bid, 'FONTE_SOBRESCRITO', NULL, NULL, p_uploaded_by, now(),
             'Manifesto sobrescreveu dados comerciais do B/L com aprovacao do operador'
      FROM unnest(v_existing_bl_ids) AS bid;
    END IF;

    SELECT array_agg(DISTINCT bl->>'id')
    INTO v_bl_ids
    FROM jsonb_array_elements(p_bls) AS bl;

    IF v_bl_ids IS NOT NULL AND array_length(v_bl_ids, 1) > 0 THEN
      INSERT INTO pg_temp.tmp_old_containers (old_container_id, bl_id, container_number)
      SELECT id, bl_id, container_number
      FROM public.bl_containers
      WHERE bl_id = ANY(v_bl_ids);

      PERFORM 1
      FROM public.vehicles
      WHERE container_id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers)
      FOR UPDATE;

      PERFORM 1
      FROM public.charge_calculations
      WHERE container_id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers)
      FOR UPDATE;
    END IF;
  END IF;

  IF p_containers IS NOT NULL AND jsonb_array_length(p_containers) > 0 THEN
    WITH inserted AS (
      INSERT INTO public.bl_containers (
        bl_id, container_number, seal_number, type, tare_weight_kg,
        gross_weight_kg, cbm, is_oog, is_imo, imo_class, un_number
      )
      SELECT
        c->>'bl_id',
        c->>'container_number',
        c->>'seal_number',
        c->>'type',
        NULLIF(c->>'tare_weight_kg', '')::NUMERIC,
        NULLIF(c->>'gross_weight_kg', '')::NUMERIC,
        NULLIF(c->>'cbm', '')::NUMERIC,
        COALESCE((c->>'is_oog')::BOOLEAN, false),
        COALESCE((c->>'is_imo')::BOOLEAN, false),
        c->>'imo_class',
        c->>'un_number'
      FROM jsonb_array_elements(p_containers) AS c
      RETURNING id, bl_id, container_number
    )
    INSERT INTO pg_temp.tmp_new_containers (new_container_id, bl_id, container_number)
    SELECT id, bl_id, container_number
    FROM inserted;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_temp.tmp_old_containers) THEN
    INSERT INTO pg_temp.tmp_container_rebind (old_container_id, new_container_id)
    SELECT old_ref.old_container_id, MIN(matched.new_container_id) AS new_container_id
    FROM pg_temp.tmp_old_containers AS old_ref
    JOIN LATERAL (
      SELECT new_ref.new_container_id
      FROM pg_temp.tmp_new_containers AS new_ref
      WHERE new_ref.bl_id = old_ref.bl_id
        AND new_ref.container_number = old_ref.container_number
    ) AS matched ON TRUE
    GROUP BY old_ref.old_container_id
    HAVING COUNT(*) = 1;

    SELECT COUNT(*)
    INTO v_missing_container_refs
    FROM (
      SELECT old_ref.old_container_id
      FROM pg_temp.tmp_old_containers AS old_ref
      WHERE EXISTS (
        SELECT 1
        FROM public.vehicles AS v
        WHERE v.container_id = old_ref.old_container_id
      )
         OR EXISTS (
        SELECT 1
        FROM public.charge_calculations AS cc
        WHERE cc.container_id = old_ref.old_container_id
      )
      EXCEPT
      SELECT old_container_id
      FROM pg_temp.tmp_container_rebind
    ) AS missing_refs;

    IF COALESCE(v_missing_container_refs, 0) > 0 THEN
      RAISE EXCEPTION
        'Reimport abortado: % vinculo(s) de container referenciados por veiculos/calculos nao puderam ser remapeados.',
        v_missing_container_refs
        USING ERRCODE = '23503';
    END IF;

    SELECT COUNT(*)
    INTO v_ambiguous_container_refs
    FROM (
      SELECT old_ref.old_container_id
      FROM pg_temp.tmp_old_containers AS old_ref
      JOIN pg_temp.tmp_new_containers AS new_ref
        ON new_ref.bl_id = old_ref.bl_id
       AND new_ref.container_number = old_ref.container_number
      WHERE EXISTS (
        SELECT 1
        FROM public.vehicles AS v
        WHERE v.container_id = old_ref.old_container_id
      )
         OR EXISTS (
        SELECT 1
        FROM public.charge_calculations AS cc
        WHERE cc.container_id = old_ref.old_container_id
      )
      GROUP BY old_ref.old_container_id
      HAVING COUNT(*) > 1
    ) AS ambiguous_refs;

    IF COALESCE(v_ambiguous_container_refs, 0) > 0 THEN
      RAISE EXCEPTION
        'Reimport abortado: % container(s) remapeados de forma ambigua por numero dentro do mesmo B/L.',
        v_ambiguous_container_refs
        USING ERRCODE = '23505';
    END IF;

    UPDATE public.vehicles AS v
    SET container_id = rebind.new_container_id
    FROM pg_temp.tmp_container_rebind AS rebind
    WHERE v.container_id = rebind.old_container_id;

    UPDATE public.charge_calculations AS cc
    SET container_id = rebind.new_container_id
    FROM pg_temp.tmp_container_rebind AS rebind
    WHERE cc.container_id = rebind.old_container_id;

    DELETE FROM public.bl_containers
    WHERE id IN (SELECT old_container_id FROM pg_temp.tmp_old_containers);
  END IF;

  IF v_error_count > 0 THEN
    INSERT INTO public.import_errors(batch_id, row_number, error_type, error_message, raw_data)
    SELECT
      v_batch_id,
      NULLIF(e->>'row_number', '')::INT,
      COALESCE(e->>'error_type', 'parser'),
      e->>'error_message',
      CASE WHEN e ? 'raw_data' THEN e->'raw_data' ELSE NULL END
    FROM jsonb_array_elements(p_errors) AS e;
  END IF;

  UPDATE public.import_batches
  SET status = CASE WHEN v_error_count > 0 THEN 'partial' ELSE 'completed' END
  WHERE id = v_batch_id;

  IF v_bl_ids IS NOT NULL THEN
    UPDATE public.charge_calculations AS cc
    SET manifest_id = v_batch_id
    WHERE cc.bl_id = ANY(v_bl_ids);
  END IF;

  RETURN v_batch_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vazios_bookings_transactional_legacy_189(p_voyage_id bigint, p_port text, p_uploaded_by uuid, p_bookings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id UUID;
  v_operation_id UUID;
  v_total INTEGER := jsonb_array_length(COALESCE(p_bookings, '[]'::JSONB));
  v_updated INTEGER := 0;
  v_inserted INTEGER := 0;
  v_removed INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user()
     OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar unidades.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_port), '') IS NULL THEN
    RAISE EXCEPTION 'Porto de embarque obrigatório.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS item(container_number TEXT)
    GROUP BY upper(btrim(container_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Planilha inválida: Container duplicado na planilha.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.vazios_export_operations (voyage_id, embark_port, updated_at)
  VALUES (p_voyage_id, upper(btrim(p_port)), now())
  ON CONFLICT (voyage_id, embark_port) DO UPDATE SET updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_operation_id;

  -- ponytail: validacao no RPC e tudo-ou-nada para nao subestimar pagamento por erro de uma linha.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
      container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
      hand_in_date DATE, hand_out_date DATE, movement_date DATE
    )
    LEFT JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code))
    WHERE NULLIF(btrim(r.container_number), '') IS NULL
       OR r.container_number !~ '^[A-Za-z]{4}[0-9]{7}$'
       OR NULLIF(btrim(r.local_code), '') IS NULL
       OR d.id IS NULL
       OR (d.id IS NOT NULL AND NOT d.active)
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND (r.hand_in_date IS NULL OR r.hand_out_date IS NULL))
       OR (COALESCE(d.tipo, 'depot') = 'depot' AND r.hand_out_date < r.hand_in_date)
       OR (d.id IS NOT NULL AND d.tipo = 'terminal_portuario' AND (r.hand_in_date IS NOT NULL OR r.hand_out_date IS NOT NULL))
       OR r.condition IS NULL OR r.condition NOT IN ('vazio', 'material')
  ) THEN
    RAISE EXCEPTION 'Planilha inválida: corrija todas as linhas e importe novamente.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_bookings_in (
    container_number text, container_type text, local_id uuid, condition text,
    hand_in_date date, hand_out_date date, movement_date date
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_bookings_in;
  INSERT INTO pg_temp.vazios_bookings_in
  SELECT upper(btrim(r.container_number)), r.container_type, d.id, r.condition, r.hand_in_date, r.hand_out_date, r.movement_date
  FROM jsonb_to_recordset(COALESCE(p_bookings, '[]'::JSONB)) AS r(
    container_number TEXT, container_type TEXT, local_code TEXT, condition TEXT,
    hand_in_date DATE, hand_out_date DATE, movement_date DATE
  )
  JOIN public.depots d ON lower(d.code) = lower(btrim(r.local_code)) AND d.active;

  INSERT INTO public.vazios_manifests (voyage_id, description, total_bookings, imported_by)
  VALUES (p_voyage_id, p_port, v_total, p_uploaded_by) RETURNING id INTO v_manifest_id;

  -- Atualiza por container (o mesmo id), inclusive a unidade incluída à mão.
  UPDATE public.vazios_bookings b
  SET container_type = i.container_type, local_id = i.local_id, condition = i.condition,
      hand_in_date = i.hand_in_date, hand_out_date = i.hand_out_date, movement_date = i.movement_date
  FROM pg_temp.vazios_bookings_in i
  WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO public.vazios_bookings (
    voyage_id, operation_id, manifest_id, container_number, container_type,
    local_id, condition, hand_in_date, hand_out_date, movement_date
  )
  SELECT p_voyage_id, v_operation_id, v_manifest_id, i.container_number, i.container_type, i.local_id,
         i.condition, i.hand_in_date, i.hand_out_date, i.movement_date
  FROM pg_temp.vazios_bookings_in i
  WHERE NOT EXISTS (SELECT 1 FROM public.vazios_bookings b
                    WHERE b.operation_id = v_operation_id AND upper(btrim(b.container_number)) = i.container_number);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Unidade de planilha anterior que o arquivo novo não traz sai; a incluída à
  -- mão (manifesto de inclusão manual) fica.
  -- ponytail: a unidade manual é reconhecida pela descrição do manifesto que
  -- `create_manual_vazios_booking` grava; uma coluna de origem seria o upgrade.
  DELETE FROM public.vazios_bookings b
  USING public.vazios_manifests vm
  WHERE vm.id = b.manifest_id AND b.operation_id = v_operation_id
    AND vm.description IS DISTINCT FROM 'Inclusao manual no Embarque de Vazios'
    AND NOT EXISTS (SELECT 1 FROM pg_temp.vazios_bookings_in i WHERE i.container_number = upper(btrim(b.container_number)));
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Manifestos sem unidade não ficam órfãos.
  DELETE FROM public.vazios_manifests vm
  WHERE vm.voyage_id = p_voyage_id
    AND NOT EXISTS (SELECT 1 FROM public.vazios_bookings b WHERE b.manifest_id = vm.id);
  -- Os totais lidos pelos cards contam as unidades que ficaram em cada manifesto.
  UPDATE public.vazios_manifests vm
  SET total_bookings = (SELECT count(*) FROM public.vazios_bookings b WHERE b.manifest_id = vm.id)
  WHERE vm.voyage_id = p_voyage_id;

  RETURN jsonb_build_object(
    'manifest_id', CASE WHEN EXISTS (SELECT 1 FROM public.vazios_manifests WHERE id = v_manifest_id) THEN v_manifest_id END,
    'operation_id', v_operation_id,
    'total', v_total,
    'updated', v_updated,
    'inserted', v_inserted,
    'removed', v_removed,
    'replaced', FALSE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.import_vazios_importacao_transactional_legacy_189(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_containers jsonb, p_manifestos jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_containers jsonb := COALESCE(p_containers, '[]'::jsonb);
  v_manifestos jsonb := COALESCE(p_manifestos, '[]'::jsonb);
  v_total integer;
  v_sem_rota integer;
  v_rotas_sem_numero text;
  v_rotas_com_dois_numeros text;
  v_numero_repetido text;
  v_numero_cadastrado text;
  v_route record;
  v_existing record;
  v_mercante_id uuid;
  v_mercante_ids uuid[] := ARRAY[]::uuid[];
  v_previous_mirror text := current_setting('vela.route_manifest_mirror', true);
  v_replaced integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar vazios.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(v_manifestos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Número do manifesto Mercante é obrigatório.' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*),
         count(*) FILTER (WHERE NULLIF(btrim(item.pol), '') IS NULL OR NULLIF(btrim(item.pod), '') IS NULL)
    INTO v_total, v_sem_rota
    FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text);

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhum container na planilha.' USING ERRCODE = '22023';
  END IF;
  IF v_sem_rota > 0 THEN
    RAISE EXCEPTION 'POL e POD são obrigatórios em todas as linhas: o Nº de manifesto Mercante pertence ao porto de origem.' USING ERRCODE = '22023';
  END IF;

  -- Rota e Nº na forma do cadastro; dois códigos do mesmo porto com o mesmo
  -- Nº viram uma rota só.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_import_manifestos (pol text, pod text, numero text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_import_manifestos;
  INSERT INTO pg_temp.vazios_import_manifestos
  SELECT DISTINCT public.normalize_port_code(m.pol), public.normalize_port_code(m.pod),
         public.canonical_manifesto_numero(m.numero)
  FROM jsonb_to_recordset(v_manifestos) AS m(pol text, pod text, numero text);

  SELECT string_agg(r.pol || ' → ' || r.pod, ', ' ORDER BY r.pol, r.pod)
    INTO v_rotas_sem_numero
    FROM (
      SELECT DISTINCT public.normalize_port_code(item.pol) AS pol, public.normalize_port_code(item.pod) AS pod
      FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
    ) r
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.vazios_import_manifestos m
                      WHERE m.pol = r.pol AND m.pod = r.pod AND m.numero IS NOT NULL);
  IF v_rotas_sem_numero IS NOT NULL THEN
    RAISE EXCEPTION 'Informe um Nº de manifesto Mercante para cada porto de origem: falta em %.', v_rotas_sem_numero USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(d.pol || ' → ' || d.pod, ', ' ORDER BY d.pol, d.pod)
    INTO v_rotas_com_dois_numeros
    FROM (
      SELECT pol, pod FROM pg_temp.vazios_import_manifestos
      WHERE numero IS NOT NULL GROUP BY pol, pod HAVING count(*) > 1
    ) d;
  IF v_rotas_com_dois_numeros IS NOT NULL THEN
    RAISE EXCEPTION 'A rota % recebeu mais de um Nº de manifesto Mercante (o mesmo porto aparece com códigos diferentes na planilha): informe um só.', v_rotas_com_dois_numeros USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.vazios_import_manifestos m
    WHERE m.numero IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(v_containers) AS item(pol text, pod text)
      WHERE public.normalize_port_code(item.pol) = m.pol AND public.normalize_port_code(item.pod) = m.pod
    )
  ) THEN
    RAISE EXCEPTION 'Há Nº de manifesto Mercante para uma rota que não está na planilha.' USING ERRCODE = '22023';
  END IF;

  SELECT min(numero) INTO v_numero_repetido
    FROM (SELECT numero FROM pg_temp.vazios_import_manifestos GROUP BY numero HAVING count(*) > 1) d;
  IF v_numero_repetido IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" foi informado para mais de um porto de origem.', v_numero_repetido USING ERRCODE = '22023';
  END IF;

  -- O número da mesma rota de vazios nesta Viagem é reaproveitado; em qualquer
  -- outro lugar, recusa.
  SELECT min(m.numero) INTO v_numero_cadastrado
    FROM pg_temp.vazios_import_manifestos m
    JOIN public.manifestos_mercante mm ON mm.numero = m.numero
    WHERE NOT (mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
               AND public.normalize_port_code(mm.pol) = m.pol
               AND public.normalize_port_code(mm.pod) = m.pod);
  IF v_numero_cadastrado IS NOT NULL THEN
    RAISE EXCEPTION 'O número de manifesto Mercante "%" já foi cadastrado no sistema.', v_numero_cadastrado USING ERRCODE = '23505';
  END IF;

  -- Natureza digitada antes da substituição.
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  -- A planilha nova substitui os containers das rotas que ela traz.
  DELETE FROM public.vazios_importacao_containers c
  USING public.vazios_importacao_manifests m
  WHERE m.id = c.manifest_id AND m.voyage_id = p_voyage_id
    AND EXISTS (SELECT 1 FROM pg_temp.vazios_import_manifestos r
                WHERE r.pol = public.normalize_port_code(c.pol) AND r.pod = public.normalize_port_code(c.pod));
  GET DIAGNOSTICS v_replaced = ROW_COUNT;

  -- Nº de Manifesto da rota: corrige o existente ou cadastra; o espelho da
  -- rota acompanha.
  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  FOR v_route IN
    SELECT r.pol, r.pod, r.numero FROM pg_temp.vazios_import_manifestos r
    WHERE r.numero IS NOT NULL ORDER BY r.numero
  LOOP
    SELECT mm.id, mm.numero INTO v_existing
    FROM public.manifestos_mercante mm
    WHERE mm.voyage_id = p_voyage_id AND mm.natureza = 'vazio'
      AND public.normalize_port_code(mm.pol) = v_route.pol
      AND public.normalize_port_code(mm.pod) = v_route.pod
    ORDER BY mm.created_at, mm.id
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      v_mercante_id := v_existing.id;
      IF v_existing.numero IS DISTINCT FROM v_route.numero THEN
        UPDATE public.manifestos_mercante SET numero = v_route.numero WHERE id = v_mercante_id;
      END IF;
    ELSE
      INSERT INTO public.manifestos_mercante (voyage_id, pol, pod, numero, natureza)
      VALUES (p_voyage_id, v_route.pol, v_route.pod, v_route.numero, 'vazio')
      RETURNING id INTO v_mercante_id;
    END IF;
    v_mercante_ids := v_mercante_ids || v_mercante_id;

    UPDATE public.voyage_route_ce_master AS cm
    SET ce_master = v_route.numero, updated_by = p_uploaded_by, updated_at = now()
    WHERE cm.voyage_id = p_voyage_id AND cm.cargo_mode = 'vazios'
      AND public.normalize_port_code(cm.pol) = v_route.pol
      AND public.normalize_port_code(cm.pod) = v_route.pod
      AND cm.ce_master IS DISTINCT FROM v_route.numero;
    INSERT INTO public.voyage_route_ce_master (voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
    SELECT p_voyage_id, v_route.pol, v_route.pod, 'vazios', v_route.numero, p_uploaded_by, now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.voyage_route_ce_master AS cm
      WHERE cm.voyage_id = p_voyage_id AND cm.cargo_mode = 'vazios'
        AND public.normalize_port_code(cm.pol) = v_route.pol
        AND public.normalize_port_code(cm.pod) = v_route.pod
    );
  END LOOP;
  PERFORM set_config('vela.route_manifest_mirror', COALESCE(NULLIF(v_previous_mirror, ''), 'off'), true);

  INSERT INTO public.vazios_importacao_manifests (
    voyage_id, description, total_containers, imported_by, source
  )
  VALUES (p_voyage_id, p_description, v_total, p_uploaded_by, 'manual')
  RETURNING id INTO v_manifest_id;

  INSERT INTO public.vazios_importacao_containers (
    manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
  )
  SELECT v_manifest_id, item.container_number, item.container_type, item.tare_kg, item.pol, item.pod, n.natureza
  FROM jsonb_to_recordset(v_containers) AS item(
    container_number text,
    container_type text,
    tare_kg numeric,
    pol text,
    pod text
  )
  LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(item.container_number));

  PERFORM public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'mercante_manifest_ids', to_jsonb(v_mercante_ids),
    'replaced_containers', v_replaced);
END;
$function$;

CREATE OR REPLACE FUNCTION public.itau_pix_mark_receipt_handled(p_end_to_end_id text, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Sem permissão para tratar o Pix Itaú.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_note, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo (mínimo de 5 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id AND status = 'review') THEN
    RAISE EXCEPTION 'Pix Itaú não está em análise.' USING ERRCODE = '22023';
  END IF;
  PERFORM public._itau_pix_close_receipt(p_end_to_end_id, left(btrim(p_note), 500), auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.itau_pix_monitor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para monitorar o Pix Itaú.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'provider', public._itau_pix_provider(),
    'polled_until', (SELECT itau_pix_polled_until FROM public.app_settings WHERE id = 1),
    'counts', coalesce((SELECT jsonb_object_agg(status, n) FROM (
      SELECT status, count(*) AS n FROM public.itau_pix_charges GROUP BY status) s), '{}'::jsonb),
    -- ponytail: até 200 linhas por lista; paginar se o volume pedir.
    'charges', coalesce((SELECT jsonb_agg(row_to_json(c) ORDER BY c.updated_at) FROM (
      SELECT ch.id, ch.txid, ch.status, ch.uncertain, ch.attempts, ch.last_error, ch.amount_brl,
             ch.next_attempt_at, ch.updated_at,
             CASE WHEN ch.invoice_id IS NOT NULL THEN 'local' ELSE 'demurrage' END AS source,
             coalesce(i.id, d.id) AS invoice_id, coalesce(i.invoice_number, d.doc_number) AS doc_number
      FROM public.itau_pix_charges ch
      LEFT JOIN public.invoices i ON i.id = ch.invoice_id
      LEFT JOIN public.demurrage_invoices d ON d.id = ch.demurrage_invoice_id
      -- Só o que ainda aguarda o banco: cobrança encerrada com erro antigo não pede atenção.
      WHERE ch.status IN ('pending_create', 'pending_update', 'pending_expire_check', 'pending_cancel')
      ORDER BY ch.updated_at LIMIT 200) c), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(row_to_json(r) ORDER BY r.paid_at DESC) FROM (
      SELECT end_to_end_id, txid, amount_brl, paid_at, reason
      FROM public.itau_pix_receipts WHERE status = 'review'
      ORDER BY paid_at DESC LIMIT 200) r), '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public.itau_pix_settle_core_425(p_end_to_end_id text, p_txid text, p_amount_brl numeric, p_paid_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_existing text;
  v_charge public.itau_pix_charges%ROWTYPE;
  v_invoice_type text;
  v_duplicate boolean := false;
  v_successor bigint;
  v_actor uuid;
  v_previous_sub text := current_setting('request.jwt.claim.sub', true);
  v_result jsonb;
  v_reason text;
  v_request uuid := md5('itau-pix:' || p_end_to_end_id)::uuid;
BEGIN
  IF p_end_to_end_id IS NULL OR p_txid IS NULL OR p_amount_brl IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Recebimento Itaú incompleto.' USING ERRCODE = '22023';
  END IF;
  -- Mesma ordem de lock para o mesmo Pix: execuções concorrentes esperam.
  PERFORM pg_advisory_xact_lock(hashtextextended('itau_pix_e2e:' || p_end_to_end_id, 0));
  SELECT status INTO v_existing FROM public.itau_pix_receipts WHERE end_to_end_id = p_end_to_end_id;
  IF FOUND THEN RETURN v_existing; END IF;

  SELECT * INTO v_charge FROM public.itau_pix_charges WHERE txid = p_txid FOR UPDATE;
  IF FOUND THEN
    -- O Pix existe no banco: a cobrança está paga, haja baixa ou análise.
    -- Marcar antes da baixa evita que o gatilho do QR a veja como aberta e
    -- tente cancelá-la no Itaú.
    UPDATE public.itau_pix_charges SET status = 'concluded', updated_at = now() WHERE id = v_charge.id;
  END IF;
  IF v_charge.id IS NULL THEN
    v_reason := 'TXID do Vela sem cobrança registrada.';
  -- ADR 0093, decisão 18 (375): Pix em duplicidade em fatura de Taxas Locais
  -- já paga, coberta ou cancelada vira recebimento sem fatura aberta, ligado à
  -- fatura de origem, com restituição pendente.
  ELSIF v_charge.invoice_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
      AND i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('paid', 'covered', 'cancelled'))
    AND (
      EXISTS (SELECT 1 FROM public.payments p
              WHERE upper(btrim(coalesce(p.bank_reference, ''))) = upper(btrim(p_end_to_end_id)))
      OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
                 AND public.normalize_pix_txid(i.pix_txid) = public.normalize_pix_txid(p_txid))
      OR EXISTS (SELECT 1 FROM public.ledger_settlements s
                 WHERE public.normalize_pix_txid(s.pix_txid) = public.normalize_pix_txid(p_txid))) THEN
    -- 385: o mesmo Pix já foi baixado nesta fatura.
    v_result := jsonb_build_object('already_settled', true, 'invoice_id', v_charge.invoice_id);
  ELSIF v_charge.invoice_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id
      AND i.invoice_type IN ('individual', 'consolidated') AND i.status IN ('paid', 'covered', 'cancelled')) THEN
    v_reason := 'Pix em duplicidade: a fatura de origem já estava paga, coberta ou cancelada. Restituição pendente registrada; o Pix sai da análise quando a devolução for confirmada.';
    v_duplicate := true;
  -- Demurrage: a cobrança guarda a revisão mais nova; o pagamento da revisão
  -- anterior é válido e register_demurrage_payment confere a janela de PTAX.
  ELSIF v_charge.invoice_id IS NOT NULL AND (
      (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id AND i.status = 'obsolete')
       AND NOT EXISTS (
         WITH RECURSIVE chain AS (
           SELECT s.id, s.status, 1 AS depth FROM public.invoices s WHERE s.replaces_invoice_id = v_charge.invoice_id
           UNION ALL
           SELECT s.id, s.status, c.depth + 1 FROM chain c JOIN public.invoices s ON s.replaces_invoice_id = c.id
           WHERE c.depth < 50)
         SELECT 1 FROM chain WHERE status IN ('issued', 'partially_paid')))
      OR (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = v_charge.invoice_id AND i.invoice_type = 'manual')
          AND public._manual_invoice_cancel_pending(v_charge.invoice_id))) THEN
    -- 386 (D5): consolidada substituída sem sucessora aberta ou avulsa em
    -- cancelamento com devolução integral: sem fatura aberta, como a decisão 18.
    v_reason := 'Pix sem fatura aberta para recebê-lo (consolidada substituída sem sucessora aberta ou avulsa em cancelamento com devolução integral). Restituição pendente registrada; o Pix sai da análise quando a devolução for confirmada.';
    v_duplicate := true;
  ELSIF v_charge.invoice_id IS NOT NULL AND round(p_amount_brl, 2) <> v_charge.amount_brl THEN
    v_reason := 'Valor recebido difere do valor da cobrança.';
  ELSE
    BEGIN
      -- F-05: o mesmo Pix não é baixado duas vezes (extrato ou baixa manual
      -- com o endToEndId na referência).
      IF v_charge.invoice_id IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.payments p
                   WHERE upper(btrim(coalesce(p.bank_reference, ''))) = upper(btrim(p_end_to_end_id)))
           OR EXISTS (SELECT 1 FROM public.invoices i
                      WHERE i.id = v_charge.invoice_id AND i.invoice_type = 'manual'
                        AND public.normalize_pix_txid(i.pix_txid) = public.normalize_pix_txid(p_txid))) THEN
        RAISE EXCEPTION 'Pix já baixado nesta fatura (mesmo TXID ou endToEndId): confira antes de baixar de novo.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_charge.demurrage_invoice_id IS NOT NULL THEN
        v_result := public.register_demurrage_payment(v_request, v_charge.demurrage_invoice_id,
          (p_paid_at AT TIME ZONE 'America/Sao_Paulo')::date, p_txid, round(p_amount_brl, 2), NULL);
      ELSE
        SELECT itau_pix_settlement_actor INTO v_actor FROM public.app_settings WHERE id = 1;
        IF v_actor IS NULL THEN
          RAISE EXCEPTION 'Usuário de baixa automática Itaú não configurado.';
        END IF;
        PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
        SELECT invoice_type INTO v_invoice_type FROM public.invoices WHERE id = v_charge.invoice_id;
        IF v_invoice_type = 'manual' THEN
          v_result := public.register_verified_invoice_payment(v_charge.invoice_id, round(p_amount_brl, 2), 'pix',
            p_paid_at, 'Baixa automática Itaú Pix', v_request, p_end_to_end_id);
        ELSIF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_charge.invoice_id AND status = 'obsolete') THEN
          -- 361 (decisão 8): QR da consolidada substituída quita a sucessora
          -- aberta; o excedente vira restituição pendente.
          WITH RECURSIVE chain AS (
            SELECT s.id, s.status, 1 AS depth FROM public.invoices s WHERE s.replaces_invoice_id = v_charge.invoice_id
            UNION ALL
            SELECT s.id, s.status, c.depth + 1 FROM chain c JOIN public.invoices s ON s.replaces_invoice_id = c.id
            WHERE c.depth < 50
          )
          SELECT id INTO v_successor FROM chain WHERE status IN ('issued', 'partially_paid') ORDER BY depth DESC LIMIT 1;
          IF v_successor IS NULL THEN
            RAISE EXCEPTION 'Consolidada substituída sem sucessora aberta para receber o Pix.';
          END IF;
          v_result := public.register_ledger_invoice_payment(v_successor, round(p_amount_brl, 2), 'pix', p_paid_at, NULL,
            'manual', 'Pix do QR da consolidada substituída ' || v_charge.invoice_id || ' (baixa automática Itaú Pix)', v_actor);
          UPDATE public.payments SET bank_reference = p_end_to_end_id WHERE id = (v_result->>'payment_id')::bigint;
        ELSE
          v_result := public.reconcile_invoice_payment_by_txid(p_txid, round(p_amount_brl, 2), p_paid_at);
          IF coalesce((v_result->>'settled')::boolean, false) IS NOT TRUE THEN
            RAISE EXCEPTION 'Conciliação recusou: %', coalesce(v_result->>'reason', 'sem motivo');
          END IF;
          UPDATE public.payments SET bank_reference = p_end_to_end_id,
            notes = coalesce(notes || ' · ', '') || 'Baixa automática Itaú Pix'
          WHERE id = (v_result->'payment'->>'payment_id')::bigint;
        END IF;
        -- F-48 (376): a baixa automática Itaú tem origem própria.
        UPDATE public.ledger_settlements SET source = 'itau_pix'
        WHERE source = 'pix_extract' AND payment_id IN (SELECT id FROM public.payments WHERE upper(btrim(coalesce(bank_reference, ''))) = upper(p_end_to_end_id));
        PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- Mesma regra da 152: erro passageiro falha a chamada para nova tentativa.
      IF left(SQLSTATE, 2) IN ('08', '40', '53', '55', '57', 'XX') THEN RAISE; END IF;
      -- Desfaz só a baixa; a cobrança continua 'concluded' (paga no banco).
      PERFORM set_config('request.jwt.claim.sub', coalesce(v_previous_sub, ''), true);
      v_reason := left(SQLERRM, 300);
    END;
  END IF;

  UPDATE public.itau_pix_receipt_failures SET status = 'handled', updated_at = now()
   WHERE end_to_end_id = p_end_to_end_id AND status <> 'handled';
  IF FOUND THEN
    PERFORM public.resolve_alert_item('pix_unreconciled', 'itau_pix_receipt_failure', p_end_to_end_id, 'itau_pix',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'resolved_by', 'itau_pix_settle'));
  END IF;
  INSERT INTO public.itau_pix_receipts(end_to_end_id, txid, charge_id, amount_brl, paid_at, status, reason, result)
  VALUES (p_end_to_end_id, p_txid, v_charge.id, round(p_amount_brl, 2), p_paid_at,
    CASE WHEN v_reason IS NULL THEN 'settled' ELSE 'review' END, v_reason, v_result);
  IF v_duplicate THEN
    INSERT INTO public.invoice_refunds (invoice_id, amount_brl, origin, notes, purpose, itau_end_to_end_id)
    VALUES (v_charge.invoice_id, round(p_amount_brl, 2), 'pix_duplicate',
      'Pix recebido pelo Itaú (endToEndId ' || p_end_to_end_id || ') sem fatura aberta para recebê-lo: fatura paga, coberta, cancelada, substituída sem sucessora aberta ou em cancelamento com devolução integral.',
      'correction', p_end_to_end_id);
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', p_end_to_end_id,
      'Pix de R$ ' || to_char(round(p_amount_brl, 2), 'FM999G999G990D00') || ' recebido pelo Itaú (TXID ' || p_txid
        || ') não foi baixado automaticamente: ' || v_reason,
      'itau_pix', 'administrativo',
      jsonb_build_object('end_to_end_id', p_end_to_end_id, 'txid', p_txid, 'amount_brl', round(p_amount_brl, 2),
        'invoice_id', v_charge.invoice_id, 'demurrage_invoice_id', v_charge.demurrage_invoice_id),
      '/reconciliacao');
    RETURN 'review';
  END IF;
  RETURN 'settled';
END;
$function$;

CREATE OR REPLACE FUNCTION public.link_pix_reconciliation_candidate(p_exception_id bigint, p_resolution_source text, p_invoice_id bigint DEFAULT NULL::bigint, p_demurrage_invoice_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_candidate RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  IF p_resolution_source NOT IN ('local', 'demurrage') THEN
    RAISE EXCEPTION 'Origem de resolucao PIX invalida.' USING ERRCODE = '22023';
  END IF;
  IF (p_resolution_source = 'local' AND (p_invoice_id IS NULL OR p_demurrage_invoice_id IS NOT NULL))
     OR (p_resolution_source = 'demurrage' AND (p_demurrage_invoice_id IS NULL OR p_invoice_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Vinculo PIX exige exatamente uma candidata da origem escolhida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;
  IF v_exception.status = 'resolved' THEN
    RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
  END IF;
  IF v_exception.normalized_txid = '' THEN
    RAISE EXCEPTION 'Linha sem TXID nao possui candidata segura para vinculo manual.' USING ERRCODE = 'P0001';
  END IF;

  -- A candidata precisa ser uma fatura aberta que aceita o TXID pela
  -- resolução única (migration 242): individual, consolidada, avulsa ou
  -- Invoice de Demurrage, pelo TXID da cobrança.
  SELECT c.invoice_id AS id, c.doc_number, c.amount_brl
  INTO v_candidate
  FROM public._pix_txid_open_candidates(v_exception.normalized_txid) AS c
  WHERE c.source = p_resolution_source
    AND c.invoice_id = CASE WHEN p_resolution_source = 'local' THEN p_invoice_id ELSE p_demurrage_invoice_id END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidata não corresponde exatamente ao TXID persistido.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET metadata = metadata || jsonb_build_object(
        'manual_candidate', jsonb_build_object(
          'source', p_resolution_source,
          'invoice_id', CASE WHEN p_resolution_source = 'local' THEN p_invoice_id ELSE NULL END,
          'demurrage_invoice_id', CASE WHEN p_resolution_source = 'demurrage' THEN p_demurrage_invoice_id ELSE NULL END,
          'doc_number', v_candidate.doc_number,
          'linked_at', now()
        )
      ),
      updated_at = now()
  WHERE id = v_exception.id;

  RETURN jsonb_build_object('id', v_exception.id, 'status', 'active', 'candidate', v_candidate.doc_number);
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_itau_pix_receipts(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_situation text DEFAULT NULL::text, p_origin text DEFAULT NULL::text, p_amount_brl numeric DEFAULT NULL::numeric, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_doc_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para consultar os Pix recebidos.' USING ERRCODE = '42501';
  END IF;
  IF p_situation IS NOT NULL AND p_situation NOT IN ('settled', 'received', 'review', 'handled') THEN
    RAISE EXCEPTION 'Situação desconhecida: %.', p_situation USING ERRCODE = '22023';
  END IF;
  IF p_origin IS NOT NULL AND p_origin NOT IN ('vela', 'static', 'none', 'other', 'test') THEN
    RAISE EXCEPTION 'Origem desconhecida: %.', p_origin USING ERRCODE = '22023';
  END IF;
  IF v_search IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_doc_like := nullif(upper(regexp_replace(v_search, '[^0-9A-Za-z]', '', 'g')), '');
    v_doc_like := CASE WHEN v_doc_like IS NULL THEN NULL ELSE '%' || v_doc_like || '%' END;
  END IF;

  WITH base AS (
    SELECT r.end_to_end_id, r.txid, r.amount_brl, r.paid_at, r.status, r.reason, r.handled_note, r.created_at, r.raw,
      coalesce((r.result ->> 'already_settled')::boolean, false) AS already_settled,
      public._itau_pix_origin(r.txid) AS origin,
      s.source AS settled_source, s.invoice_id AS settled_invoice_id, s.doc_number AS settled_doc_number,
      CASE WHEN c.invoice_id IS NOT NULL THEN 'local' WHEN c.demurrage_invoice_id IS NOT NULL THEN 'demurrage' END AS charge_source,
      coalesce(c.invoice_id, c.demurrage_invoice_id) AS charge_invoice_id,
      coalesce(ci.invoice_number, cd.doc_number) AS charge_doc_number
    FROM public.itau_pix_receipts r
    LEFT JOIN public.itau_pix_charges c ON c.id = r.charge_id
    LEFT JOIN public.invoices ci ON ci.id = c.invoice_id
    LEFT JOIN public.demurrage_invoices cd ON cd.id = c.demurrage_invoice_id
    LEFT JOIN LATERAL public._itau_pix_receipt_settlement(r.end_to_end_id, r.txid) s ON true
    WHERE (p_from IS NULL OR r.paid_at >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (p_to IS NULL OR r.paid_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
      AND (p_amount_brl IS NULL OR abs(r.amount_brl - p_amount_brl) < 0.005)
  ), classified AS (
    SELECT b.*,
      -- Só a baixa que existe conta: cancelada, o Pix volta a "Sem baixa"
      -- mesmo com o status 'settled' gravado pela baixa automática.
      CASE
        WHEN b.settled_invoice_id IS NOT NULL THEN 'settled'
        WHEN b.status IN ('review', 'handled') THEN b.status
        ELSE 'received'
      END AS situation
    FROM base b
  ), filtered AS (
    SELECT k.* FROM classified k
    WHERE (p_situation IS NULL OR k.situation = p_situation)
      AND (p_origin IS NULL OR k.origin = p_origin)
      AND (v_search IS NULL
        OR k.end_to_end_id ILIKE v_like OR k.txid ILIKE v_like
        OR coalesce(k.settled_doc_number, k.charge_doc_number, '') ILIKE v_like
        OR coalesce(public._itau_pix_payer_name(k.raw), '') ILIKE v_like
        OR coalesce(k.raw ->> 'infoPagador', '') ILIKE v_like
        OR (v_doc_like IS NOT NULL AND coalesce(public._itau_pix_payer_document(k.raw), '') LIKE v_doc_like))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'total_amount_brl', (SELECT coalesce(sum(amount_brl), 0) FROM filtered),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'end_to_end_id', f.end_to_end_id,
        'txid', f.txid,
        'origin', f.origin,
        'amount_brl', f.amount_brl,
        'paid_at', f.paid_at,
        'recorded_at', f.created_at,
        'situation', f.situation,
        'settled_by', CASE WHEN f.situation <> 'settled' THEN NULL
          WHEN f.status = 'settled' AND f.already_settled THEN 'extract'
          WHEN f.status = 'settled' THEN 'itau' ELSE 'manual' END,
        'settled_source', f.settled_source,
        'settled_invoice_id', f.settled_invoice_id,
        'settled_doc_number', f.settled_doc_number,
        'charge_source', f.charge_source,
        'charge_invoice_id', f.charge_invoice_id,
        'charge_doc_number', f.charge_doc_number,
        'reason', f.reason,
        'handled_note', f.handled_note,
        'pix_key', nullif(btrim(f.raw ->> 'chave'), ''),
        'payer_name', public._itau_pix_payer_name(f.raw),
        'payer_document', public._itau_pix_payer_document(f.raw),
        'payer_message', nullif(btrim(f.raw ->> 'infoPagador'), ''),
        'raw', f.raw
      ) ORDER BY f.paid_at DESC, f.end_to_end_id)
      FROM (SELECT * FROM filtered ORDER BY paid_at DESC, end_to_end_id LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bl_ready_and_create_invoice(p_bl_id text, p_customer_id bigint DEFAULT NULL::bigint, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl_id TEXT := upper(trim(p_bl_id));
  v_customer_id BIGINT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p_customer_id, b.customer_id)
  INTO v_customer_id
  FROM public.bls b
  WHERE b.id = v_bl_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % sem cliente vinculado.', v_bl_id USING ERRCODE = '22023';
  END IF;

  PERFORM public.mark_bl_ready_for_billing(v_bl_id, p_actor);

  RETURN public.create_invoice_from_bls_with_ledger(
    ARRAY[v_bl_id],
    v_customer_id,
    p_notes,
    true,
    p_actor
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_bl_ready_for_billing(p_bl_id text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl record;
  v_pending_count integer := 0;
  v_table_count integer := 0;
  v_invoiceable_count integer := 0;
  v_review_reasons text[];
  v_terminal_pendencies text[];
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso negado para marcar B/L como pronto para faturar.' USING ERRCODE = '42501';
  END IF;

  SELECT id, charge_status, pod, cargo_mode, customer_id, customer_reconciliation_status
  INTO v_bl FROM public.bls WHERE id = p_bl_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L "%" não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  -- ADR 0093, decisão 3: a emissão usa a base atual (preço do dia do CE).
  IF public._refresh_bl_calculation_if_stale(p_bl_id, p_actor) THEN
    SELECT id, charge_status, pod, cargo_mode, customer_id, customer_reconciliation_status
    INTO v_bl FROM public.bls WHERE id = p_bl_id;
  END IF;

  -- Gate 1: Assertiva universal de CE Mercante (migration 047)
  PERFORM public.assert_bl_ce_mercante(p_bl_id);

  -- Gate 2: Vinculo de cliente (migration 047)
  IF v_bl.customer_id IS NULL THEN
    RAISE EXCEPTION 'B/L % não possui cliente vinculado. Vincule um cliente antes de marcar como pronto para faturar.', p_bl_id USING ERRCODE = 'P0003';
  END IF;

  -- Gate 3: Status de reconciliacao (migration 047)
  IF COALESCE(v_bl.customer_reconciliation_status, 'missing_customer') NOT IN ('matched_document', 'reconciled') THEN
    RAISE EXCEPTION 'B/L exige reconciliação manual antes do faturamento.' USING ERRCODE = '22023';
  END IF;

  -- Gate 4: Pendencias no gate de revisao (migration 047)
  v_review_reasons := public.compute_bl_review_pendencies(p_bl_id);
  IF COALESCE(cardinality(v_review_reasons), 0) > 0 THEN
    RAISE EXCEPTION 'B/L possui pendências no gate de revisão: %', array_to_string(v_review_reasons, ', ') USING ERRCODE = '22023';
  END IF;

  -- Gate 5: Linhas com review_required (migration 047)
  SELECT COUNT(*) INTO v_pending_count FROM public.charge_calculations WHERE bl_id = p_bl_id AND status = 'review_required';
  IF v_pending_count > 0 THEN
    RAISE EXCEPTION 'Ainda existem linhas com pendência de revisão' USING ERRCODE = '22023';
  END IF;

  -- Gate 6: Terminal de descarga (ADR 0068 / migration 055)
  v_terminal_pendencies := public.check_bl_terminal_pendencies(p_bl_id);
  IF array_length(v_terminal_pendencies, 1) > 0 THEN
    RAISE EXCEPTION 'B/L com pendência de terminal: %', array_to_string(v_terminal_pendencies, ', ')
      USING ERRCODE = '22023';
  END IF;

  -- Gate 7: Linhas faturaveis (migration 047)
  SELECT COUNT(*) INTO v_invoiceable_count
  FROM public.charge_calculations
  WHERE bl_id = p_bl_id
    AND (COALESCE(total_value_brl, 0) > 0 OR COALESCE(total_value_usd, 0) > 0)
    AND COALESCE(status, 'calculated') IN ('calculated', 'reviewed', 'ready_for_billing');
  
  IF v_invoiceable_count = 0 THEN
    RAISE EXCEPTION 'B/L sem linhas faturáveis.' USING ERRCODE = '22023';
  END IF;

  -- Gate 8: Resolucao de tabelas de taxas compartilhada (ADR 0069)
  SELECT COUNT(*) INTO v_table_count
  FROM public.resolve_bl_local_charge_table_ids(p_bl_id);

  IF (v_bl.cargo_mode = 'misto' AND v_table_count < 2) OR (v_bl.cargo_mode <> 'misto' AND v_table_count = 0) THEN
    RAISE EXCEPTION
      'Tabela de cobrança incompleta ou inativa para POD "%" (modo: %). Configure em /taxas-locais/tabelas antes de prosseguir.',
      v_bl.pod, v_bl.cargo_mode USING ERRCODE = 'P0004';
  END IF;

  UPDATE public.charge_calculations 
  SET status = 'ready_for_billing' 
  WHERE bl_id = p_bl_id AND status IN ('calculated', 'reviewed');

  UPDATE public.bls 
  SET charge_status = 'ready_for_billing', billing_hold_reason = NULL 
  WHERE id = p_bl_id;

  PERFORM public.sync_local_charge_receivable(p_bl_id);

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES ('bl', p_bl_id, 'charge_status', COALESCE(v_bl.charge_status, 'null'), 'ready_for_billing', auth.uid(), NOW(), 'Marcado como pronto para faturar no modulo de Taxas Locais');

  RETURN jsonb_build_object('bl_id', p_bl_id, 'status', 'ready_for_billing', 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.omit_voyage_escala(p_voyage_id bigint, p_omitted_pod text, p_discharge_pod text, p_reason text, p_changed_by uuid, p_onward_vessel_name text DEFAULT NULL::text, p_onward_carrier text DEFAULT NULL::text, p_onward_voyage_number text DEFAULT NULL::text, p_onward_etd timestamp with time zone DEFAULT NULL::timestamp with time zone, p_onward_eta timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_omitted TEXT := upper(btrim(COALESCE(p_omitted_pod, '')));
  v_discharge TEXT := upper(btrim(COALESCE(p_discharge_pod, '')));
  v_entity_id TEXT := p_voyage_id::text || '::' || v_omitted;
  v_omission_id BIGINT;
  v_constraint TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;

  IF v_omitted = '' OR v_discharge = '' THEN
    RAISE EXCEPTION 'POD omitido/descarga invalidos' USING ERRCODE = '22023';
  END IF;
  -- 477 (02-viagens-adr:15): a carga é descarregada em outro porto da viagem.
  IF COALESCE(public.normalize_port_code(v_discharge), v_discharge) = COALESCE(public.normalize_port_code(v_omitted), v_omitted) THEN
    RAISE EXCEPTION 'O Porto de Transbordo precisa ser outro porto da viagem, não o porto omitido. Cadastre antes a escala onde a carga será descarregada.'
      USING ERRCODE = '22023';
  END IF;

  -- Serializa concorrentes da mesma viagem (por viagem/escala via lock + unique).
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem % não encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    INSERT INTO public.voyage_omissions(
      voyage_id, omitted_pod, discharge_pod, reason, omitted_by,
      onward_vessel_name, onward_carrier, onward_voyage_number, onward_etd, onward_eta
    )
    VALUES (
      p_voyage_id, v_omitted, v_discharge,
      NULLIF(btrim(COALESCE(p_reason, '')), ''),
      p_changed_by,
      NULLIF(btrim(COALESCE(p_onward_vessel_name, '')), ''),
      NULLIF(btrim(COALESCE(p_onward_carrier, '')), ''),
      NULLIF(btrim(COALESCE(p_onward_voyage_number, '')), ''),
      p_onward_etd, p_onward_eta
    )
    RETURNING id INTO v_omission_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      -- So a constraint de omissao esperada vira duplicidade amigavel;
      -- qualquer outra unique_violation propaga (nao esconde outra constraint).
      IF v_constraint = 'voyage_omissions_voyage_id_omitted_pod_key' THEN
        RAISE EXCEPTION 'A escala da viagem % já foi omitida para o POD %.', p_voyage_id, v_omitted
          USING ERRCODE = '23505';
      END IF;
      RAISE;
  END;

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule', v_entity_id, 'omitted', 'false', 'true', p_changed_by,
    'Escala omitida pelo armador; carga descarregada em ' || v_discharge
  );

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage', p_voyage_id::text, 'escala_omitida', v_omitted, v_discharge, p_changed_by,
    COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Omissao de escala')
  );

  INSERT INTO public.bl_transshipments(bl_id, omission_id, disposition, created_by)
  SELECT b.id, v_omission_id, 'transshipment', p_changed_by
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
  ON CONFLICT (bl_id, omission_id) DO NOTHING;

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id, b.id, 'transshipment', 'Escala omitida',
    'A escala de ' || v_omitted || ' foi omitida. A carga do B/L ' || b.id ||
      ' foi descarregada em ' || v_discharge || ' e seguira em transbordo para ' || v_omitted || '.',
    NULL
  FROM public.bls b
  WHERE b.voyage_id = p_voyage_id
    AND upper(btrim(COALESCE(b.pod, ''))) = v_omitted
    AND b.customer_id IS NOT NULL;

  RETURN v_omission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.portal_get_session_overview_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_account RECORD;
  v_customer RECORD;
BEGIN
  PERFORM public.current_portal_customer_id();

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão do portal inválida ou expirada.' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, a.customer_id, a.active, a.contact_email, a.login_cnpj
  INTO v_account
  FROM public.customer_portal_accounts AS a
  WHERE a.auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão do portal inválida ou expirada.' USING ERRCODE = '28000';
  END IF;

  IF NOT v_account.active THEN
    RAISE EXCEPTION 'Acesso ao portal desativado. Entre em contato com o suporte.' USING ERRCODE = '28000';
  END IF;

  SELECT c.id, c.name, c.cnpj_cpf
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = v_account.customer_id;

  UPDATE public.customer_portal_accounts
  SET last_login_at = now()
  WHERE id = v_account.id;

  RETURN jsonb_build_object(
    'customer_id',       v_customer.id,
    'customer_name',     v_customer.name,
    'customer_cnpj_cpf', v_customer.cnpj_cpf,
    'cnpj_cpf',          v_customer.cnpj_cpf,
    'pending_balance',   public._portal_customer_pending_balance(v_customer.id),
    'contact_email',     v_account.contact_email,
    'account_id',        v_account.id,
    'login_cnpj',        v_account.login_cnpj
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_active_invoice_bl_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM public.invoices WHERE id = NEW.invoice_id AND coalesce(status,'issued') IN ('draft','issued','partially_paid','overdue','paid'))
 AND EXISTS(SELECT 1 FROM public.invoice_bls ib JOIN public.invoices inv ON inv.id = ib.invoice_id
   WHERE ib.bl_id = NEW.bl_id AND ib.id IS DISTINCT FROM NEW.id AND coalesce(inv.status,'issued') IN ('draft','issued','partially_paid','overdue','paid')
   AND NOT EXISTS(SELECT 1 FROM public.invoice_customer_changes c JOIN public.bl_receivables r ON r.id = c.receivable_id
    WHERE c.bl_id = ib.bl_id AND c.status IN ('reissue_pending','completed') AND inv.id=ANY(c.original_invoice_ids)
    AND r.source = 'local_charges_archived:' || r.id::text AND r.balance_brl = 0 AND r.original_amount_brl = r.correction_amount_brl
    AND NOT EXISTS(SELECT 1 FROM public.invoice_refunds f WHERE f.correction_receivable_id = r.id AND f.status = 'pending')))
 THEN RAISE EXCEPTION 'PT409: B/L já vinculado a uma invoice ativa.' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.quote_manual_invoice_charge(p_bl_id text, p_charge_item_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item record;
  v_basis text;
  v_quantity numeric := 1;
  v_unit numeric;
  v_roe numeric;
  v_roe_date date;
  v_override bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_read_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_item FROM public.list_manual_charge_items_for_bl(p_bl_id)
    WHERE charge_item_id = p_charge_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item manual não elegível para este B/L.' USING ERRCODE = '22023';
  END IF;
  SELECT application_basis INTO v_basis FROM public.charge_table_items WHERE id = p_charge_item_id;
  IF v_basis = 'teu' THEN
    SELECT sum(CASE WHEN normalized ~ '^45' THEN 2.25 WHEN normalized ~ '^(40|42)' THEN 2
      WHEN normalized ~ '^(20|22)' THEN 1 ELSE NULL END)
    INTO v_quantity FROM (SELECT regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') normalized
      FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))) c;
    IF EXISTS (SELECT 1 FROM public.bl_containers WHERE bl_id = upper(btrim(p_bl_id))
      AND regexp_replace(upper(coalesce(type, '')), '[[:space:]-]', '', 'g') !~ '^(45|40|42|20|22)') THEN
      RAISE EXCEPTION 'Tipo de container desconhecido; confira os TEUs do B/L.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_basis IS DISTINCT FROM 'bl' THEN
    RAISE EXCEPTION 'Base de cobrança não suportada na avulsa: %.', v_basis USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'B/L sem quantidade faturável.' USING ERRCODE = '22023';
  END IF;
  SELECT cro.id INTO v_override FROM public.customer_rate_overrides cro
    JOIN public.bls b ON b.customer_id = cro.customer_id
    WHERE b.id = upper(btrim(p_bl_id)) AND cro.charge_item_id = p_charge_item_id AND cro.active
      AND (cro.valid_from IS NULL OR cro.valid_from <= public.bl_local_charge_reference_date(b.id))
      AND (cro.valid_to IS NULL OR cro.valid_to >= public.bl_local_charge_reference_date(b.id))
    ORDER BY cro.created_at DESC LIMIT 1;
  IF v_item.currency = 'USD' THEN
    SELECT roe, effective_date INTO v_roe, v_roe_date FROM public.exchange_rate_reference WHERE id = 1;
    IF v_roe IS NULL OR v_roe <= 0 THEN
      RAISE EXCEPTION 'Câmbio (ROE) não configurado.' USING ERRCODE = '22023';
    END IF;
    v_unit := round(v_item.effective_unit_value_usd * v_roe, 2);
  ELSE
    v_unit := v_item.effective_unit_value_brl;
  END IF;
  RETURN to_jsonb(v_item) || jsonb_build_object('quantity', v_quantity, 'application_basis', v_basis,
    'unit_value_brl', v_unit, 'total_brl', CASE WHEN v_item.currency = 'USD'
      THEN round(round(v_quantity * v_item.effective_unit_value_usd, 2) * v_roe, 2) ELSE round(v_quantity * v_unit, 2) END,
    'total_usd', CASE WHEN v_item.currency = 'USD' THEN round(v_quantity * v_item.effective_unit_value_usd, 2) END,
    'roe', v_roe, 'roe_effective_date', v_roe_date, 'override_id', v_override);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_demurrage_invoices(p_ptax numeric, p_quote_date date, p_source text DEFAULT 'bcb_live'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_roe numeric; v_updated integer := 0; v_inv record; v_total_brl numeric(14,2); v_pix_payload text; v_discount_usd numeric(12,2);
BEGIN
  IF p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN' OR p_quote_date IS NULL THEN
    RAISE EXCEPTION 'PTAX e data de cotação são obrigatórias.' USING ERRCODE = '22023';
  END IF;
  IF p_source NOT IN ('bcb_live', 'cached', 'manual') THEN RAISE EXCEPTION 'Origem de PTAX invalida: %.', p_source USING ERRCODE = '22023'; END IF;
  v_roe := public._demurrage_roe_from_ptax(p_ptax);
  PERFORM public.save_exchange_rate_reference_v2(p_ptax, v_roe, p_quote_date, p_source, p_quote_date);
  FOR v_inv IN
    SELECT id, total_usd, coalesce(discount_value, 0) AS discount_value, discount_mode, doc_number, current_roe
    FROM public.demurrage_invoices
    -- 402: a vencida e não paga é tão aberta quanto a emitida.
    WHERE status IN ('issued', 'overdue') AND paid_at IS NULL
      -- 382 (ADR 0094, B10): Invoice com ROE manual fica fora do recálculo
      -- pela PTAX até alguém tirar o ROE manual.
      AND NOT coalesce(roe_manual, false)
    FOR UPDATE
  LOOP
    CONTINUE WHEN v_inv.current_roe IS NOT NULL AND v_inv.current_roe = v_roe;
    v_discount_usd := 0;
    IF v_inv.discount_value > 0 THEN
      v_discount_usd := CASE WHEN v_inv.discount_mode = 'percent' THEN round(v_inv.total_usd * (v_inv.discount_value / 100), 2) ELSE v_inv.discount_value END;
    END IF;
    v_total_brl := round(greatest(v_inv.total_usd - v_discount_usd, 0) * v_roe, 2);
    v_pix_payload := CASE WHEN v_total_brl > 0 THEN public.build_transshipping_pix_payload(v_total_brl, v_inv.doc_number) ELSE NULL END;
    UPDATE public.demurrage_invoices SET current_roe = v_roe, current_total_brl = v_total_brl, roe_source = p_source, pix_payload = v_pix_payload, updated_at = now() WHERE id = v_inv.id;
    INSERT INTO public.demurrage_invoice_history(invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
    VALUES (v_inv.id, p_quote_date, p_ptax, v_roe, v_inv.total_usd, v_total_brl, v_discount_usd, p_source);
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('updated', v_updated, 'roe', v_roe, 'quote_date', p_quote_date, 'source', p_source);
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_demurrage_payment(p_request_id uuid, p_invoice_id bigint, p_paid_at date, p_pix_txid text DEFAULT NULL::text, p_total_brl numeric DEFAULT NULL::numeric, p_ptax_used numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payload jsonb;
  v_previous jsonb;
  v_invoice public.demurrage_invoices%ROWTYPE;
  v_match record;
  v_has_history boolean;
  v_total_brl numeric(14,2);
  v_ptax numeric(10,4);
  v_roe numeric(10,4);
  v_discount numeric(12,2);
  v_result jsonb;
  v_txid text := NULLIF(btrim(p_pix_txid), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_financeiro_user()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para registrar baixa de Demurrage.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_paid_at IS NULL THEN
    RAISE EXCEPTION 'Fatura e data de pagamento são obrigatórias.' USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND char_length(v_txid) > 140 THEN
    RAISE EXCEPTION 'Identificador PIX inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_total_brl IS NOT NULL AND p_total_brl < 0 THEN
    RAISE EXCEPTION 'Valor pago nao pode ser negativo.' USING ERRCODE = '22003';
  END IF;

  v_payload := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'paid_at', p_paid_at,
    'pix_txid', v_txid,
    'total_brl', CASE WHEN p_total_brl IS NULL THEN NULL ELSE round(p_total_brl, 2) END
  );
  v_previous := public._demurrage_mutation_request(p_request_id, 'payment', p_invoice_id, v_payload);
  IF v_previous IS NOT NULL THEN
    RETURN v_previous;
  END IF;

  SELECT * INTO v_invoice
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.status = 'paid' THEN
    IF v_txid IS NOT NULL AND v_invoice.pix_txid = v_txid THEN
      RETURN jsonb_build_object('invoice_id', p_invoice_id, 'status', 'paid', 'idempotent', true);
    END IF;
    RAISE EXCEPTION 'Demurrage invoice % já está paga.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status NOT IN ('issued', 'overdue') OR v_invoice.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'Demurrage invoice % não pode ser baixada no status atual.', p_invoice_id USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id AND h.event_date <= p_paid_at
  ) INTO v_has_history;

  IF v_has_history THEN
    -- A prova financeira vem da foto persistida, e a janela e a mesma do
    -- reconciliador: as DUAS fotos mais recentes ate a data do extrato.
    -- Uma cotacao mais antiga que isso e divergencia, nao quitacao.
    SELECT w.total_brl, w.ptax_used
      INTO v_match
    FROM public.get_demurrage_recent_values(p_invoice_id, p_paid_at) AS w
    WHERE p_total_brl IS NULL OR abs(w.total_brl - round(p_total_brl, 2)) <= 0.01
    ORDER BY w.event_date DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Valor divergente das duas últimas fotos financeiras da Demurrage %.', p_invoice_id
        USING ERRCODE = '22003';
    END IF;

    v_total_brl := round(COALESCE(p_total_brl, v_match.total_brl), 2);
    v_ptax := v_match.ptax_used;
    -- O ROE da foto casada; get_demurrage_recent_values nao o projeta, entao
    -- ele vem da mesma linha pela chave (invoice, data, total).
    SELECT h.roe_used INTO v_roe
    FROM public.demurrage_invoice_history AS h
    WHERE h.invoice_id = p_invoice_id
      AND h.event_date <= p_paid_at
      AND h.total_brl = v_total_brl
    ORDER BY h.event_date DESC, h.id DESC
    LIMIT 1;
    v_roe := COALESCE(v_roe, v_invoice.current_roe);
  ELSE
    -- Legado sem foto: a propria fatura e a unica referencia disponivel. O ROE
    -- aplicado e conhecido; a PTAX que o originou, nao. Registrar NULL em vez
    -- de deduzir mantem o historico honesto (#658 F9).
    v_total_brl := round(COALESCE(p_total_brl, v_invoice.current_total_brl), 2);
    v_roe := v_invoice.current_roe;
    v_ptax := NULL;
    IF v_invoice.current_total_brl IS NULL
       OR p_total_brl IS NULL
       OR abs(v_invoice.current_total_brl - p_total_brl) > 0.01 THEN
      RAISE EXCEPTION 'Valor divergente da foto financeira da Demurrage %.', p_invoice_id USING ERRCODE = '22003';
    END IF;
  END IF;

  -- ptax_used e procedencia e pode faltar; o par (total_brl, roe_used) e que
  -- precisa ser pagavel. Uma PTAX presente, porem, tem de ser positiva.
  IF v_total_brl IS NULL OR v_total_brl <= 0 OR v_roe IS NULL OR v_roe <= 0 THEN
    RAISE EXCEPTION 'Fatura % não possui uma foto financeira pagável.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_ptax IS NOT NULL AND v_ptax <= 0 THEN
    RAISE EXCEPTION 'Fatura % tem cotação inválida na foto financeira.', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_txid IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.demurrage_invoices d
    WHERE btrim(d.pix_txid) = v_txid AND d.id <> p_invoice_id
  ) THEN
    RAISE EXCEPTION 'PIX % já está associado a outra fatura.', v_txid USING ERRCODE = '23505';
  END IF;

  v_discount := greatest(0, round(v_invoice.total_usd - v_total_brl / v_roe, 2));

  UPDATE public.demurrage_invoices
  SET status = 'paid',
      paid_at = p_paid_at,
      pix_txid = v_txid,
      conciliated_by_extract = (v_txid IS NOT NULL),
      current_total_brl = v_total_brl,
      current_roe = v_roe,
      updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO public.demurrage_invoice_history
    (invoice_id, event_date, ptax_used, roe_used, total_usd, total_brl, discount_usd, source)
  VALUES
    (p_invoice_id, p_paid_at, v_ptax, v_roe, v_invoice.total_usd, v_total_brl, v_discount, 'payment');

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, changed_at, justification
  ) VALUES (
    'demurrage_invoice', p_invoice_id::text, 'payment_registered',
    v_invoice.status,
    jsonb_build_object('status', 'paid', 'paid_at', p_paid_at, 'pix_txid', v_txid)::text,
    auth.uid(), now(), 'Baixa de Demurrage por contrato financeiro.'
  );

  v_result := jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', 'paid',
    'paid_at', p_paid_at,
    'total_brl', v_total_brl,
    'idempotent', false
  );
  INSERT INTO public.demurrage_mutation_requests(request_id, operation, invoice_id, request_payload, result, created_by)
  VALUES (p_request_id, 'payment', p_invoice_id, v_payload, v_result, auth.uid())
  ON CONFLICT (request_id) DO NOTHING;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_invoice_payment(p_invoice_id bigint, p_amount_brl numeric, p_payment_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_total_paid NUMERIC(14,2);
  v_balance NUMERIC(14,2);
  v_remaining NUMERIC(14,2);
  v_next_status TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_amount_brl, 0) <= 0 THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', COALESCE(p_amount_brl, 0)),
      auth.uid(),
      now(),
      'Valor de pagamento menor ou igual a zero'
    );
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'cancelled' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' cancelada'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice cancelada'
    );
    RAISE EXCEPTION 'Invoice cancelada não aceita pagamento.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') = 'paid' THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' ja paga'),
      auth.uid(),
      now(),
      'Tentativa de pagamento em invoice ja quitada'
    );
    RAISE EXCEPTION 'Invoice já está paga.' USING ERRCODE = '22023';
  END IF;

  v_remaining := GREATEST(COALESCE(v_invoice.balance_brl, COALESCE(v_invoice.total_brl, 0)), 0);
  IF p_amount_brl > v_remaining THEN
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
    )
    VALUES (
      'system_event',
      'billing',
      'invoice_payment_invalid',
      NULL,
      CONCAT('invoice=', p_invoice_id, ' | amount=', p_amount_brl, ' | remaining=', v_remaining),
      auth.uid(),
      now(),
      'Tentativa de pagamento acima do saldo da invoice'
    );
    RAISE EXCEPTION 'Pagamento acima do saldo em aberto da invoice.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (
    invoice_id,
    amount_brl,
    payment_method,
    paid_at,
    registered_by,
    notes
  )
  VALUES (
    p_invoice_id,
    p_amount_brl,
    COALESCE(NULLIF(TRIM(COALESCE(p_payment_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  v_balance := GREATEST(COALESCE(v_invoice.total_brl, 0) - v_total_paid, 0);

  IF v_balance = 0 THEN
    v_next_status := 'paid';
  ELSIF v_total_paid > 0 THEN
    v_next_status := 'partially_paid';
  ELSE
    v_next_status := 'issued';
  END IF;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = v_balance,
    status = v_next_status
  WHERE id = p_invoice_id;

  IF v_next_status = 'paid' THEN
    UPDATE public.bls AS b
    SET financial_status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.invoice_bls AS ib2
        JOIN public.invoices AS inv2 ON inv2.id = ib2.invoice_id
        WHERE ib2.bl_id = b.id
          AND inv2.id <> p_invoice_id
          AND COALESCE(inv2.status, 'issued') IN ('draft', 'issued', 'partially_paid', 'overdue')
      ) THEN 'invoiced'
      ELSE 'paid'
    END
    WHERE b.id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  ELSE
    UPDATE public.bls
    SET financial_status = 'invoiced'
    WHERE id IN (
      SELECT ib.bl_id
      FROM public.invoice_bls AS ib
      WHERE ib.invoice_id = p_invoice_id
    );
  END IF;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification
  )
  VALUES (
    'invoice',
    p_invoice_id::TEXT,
    'register_payment',
    COALESCE(v_invoice.total_paid_brl::TEXT, '0'),
    v_total_paid::TEXT,
    auth.uid(),
    now(),
    'Registro de pagamento'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', v_next_status,
    'total_paid_brl', v_total_paid,
    'balance_brl', v_balance
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_ledger_invoice_payment_legacy_052(p_invoice_id bigint, p_amount_brl numeric, p_method text DEFAULT 'pix'::text, p_paid_at timestamp with time zone DEFAULT now(), p_pix_txid text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text, p_notes text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_invoice RECORD;
  v_actor UUID;
  v_payment_amount NUMERIC(14,2);
  v_open NUMERIC(14,2);
  v_excess NUMERIC(14,2) := 0;
  v_remaining NUMERIC(14,2);
  v_remaining_open NUMERIC(14,2);
  v_allocation NUMERIC(14,2);
  v_payment_id BIGINT;
  v_total_paid NUMERIC(14,2);
  v_all_receivable_ids BIGINT[];
  v_receivable_ids BIGINT[];
  v_receivable RECORD;
  v_next_status TEXT;
  v_covered INTEGER := 0;
  v_obsoleted INTEGER := 0;
  v_receivables_settled INTEGER := 0;
  v_cross JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão de faturamento.' USING ERRCODE = '42501';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  IF COALESCE(p_source, 'manual') NOT IN ('manual', 'pix_extract') THEN
    RAISE EXCEPTION 'Origem de pagamento invalida.' USING ERRCODE = '22023';
  END IF;

  v_payment_amount := ROUND(COALESCE(p_amount_brl, 0)::NUMERIC, 2);
  IF v_payment_amount <= 0 THEN
    RAISE EXCEPTION 'Valor de pagamento deve ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_pix_txid, '')), '') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.ledger_settlements
       WHERE pix_txid IS NOT NULL
         AND UPPER(REGEXP_REPLACE(pix_txid, '[^A-Za-z0-9]', '', 'g'))
           = UPPER(REGEXP_REPLACE(p_pix_txid, '[^A-Za-z0-9]', '', 'g'))
     ) THEN
    RAISE EXCEPTION 'TXID % já foi conciliado.', p_pix_txid USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_invoice.status, 'issued') NOT IN ('issued', 'partially_paid', 'overdue') THEN
    RAISE EXCEPTION 'Invoice % não está em estado pagável (status=%).', p_invoice_id, v_invoice.status
      USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY_AGG(irl.receivable_id ORDER BY irl.receivable_id)
  INTO v_all_receivable_ids
  FROM public.invoice_receivable_links irl
  WHERE irl.invoice_id = p_invoice_id;

  SELECT ARRAY_AGG(irl.receivable_id ORDER BY irl.receivable_id)
  INTO v_receivable_ids
  FROM public.invoice_receivable_links irl
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active';

  IF v_receivable_ids IS NULL OR ARRAY_LENGTH(v_receivable_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Invoice % sem receivables ativos vinculados no ledger.', p_invoice_id
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM public.bl_receivables WHERE id = ANY(v_receivable_ids) ORDER BY id FOR UPDATE;

  SELECT COALESCE(SUM(balance_brl), 0)
  INTO v_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids)
    AND status IN ('open', 'partially_settled');

  IF COALESCE(v_open, 0) <= 0 THEN
    RAISE EXCEPTION 'Invoice % não possui saldo em aberto no ledger.', p_invoice_id USING ERRCODE = '22023';
  END IF;

  -- Pagamentos manuais e PIX podem liquidar parcialmente.
  -- Qualquer excedente continua proibido para PIX e gera restituição somente
  -- no caminho manual.
  v_excess := ROUND(GREATEST(v_payment_amount - v_open, 0)::NUMERIC, 2);
  IF v_excess > 0 AND COALESCE(p_source, 'manual') <> 'manual' THEN
    RAISE EXCEPTION 'Valor (%) excede o saldo em aberto do documento (%).',
      v_payment_amount, v_open USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (invoice_id, amount_brl, payment_method, paid_at, registered_by, notes)
  VALUES (
    p_invoice_id,
    v_payment_amount,
    COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
    COALESCE(p_paid_at, now()),
    v_actor,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_payment_id;

  -- Aloca no maximo o saldo aberto; o que passar disso e excedente (restituicao).
  v_remaining := ROUND(LEAST(v_payment_amount, v_open)::NUMERIC, 2);

  FOR v_receivable IN
    SELECT id, balance_brl
    FROM public.bl_receivables
    WHERE id = ANY(v_receivable_ids)
      AND status IN ('open', 'partially_settled')
      AND balance_brl > 0
    ORDER BY id
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_allocation := ROUND(LEAST(v_receivable.balance_brl, v_remaining)::NUMERIC, 2);
    IF v_allocation <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.ledger_settlements (
      payment_id, receivable_id, invoice_id, amount_brl, settled_at, method, pix_txid, source
    )
    VALUES (
      v_payment_id,
      v_receivable.id,
      p_invoice_id,
      v_allocation,
      COALESCE(p_paid_at, now()),
      COALESCE(NULLIF(TRIM(COALESCE(p_method, '')), ''), 'pix'),
      NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
      COALESCE(p_source, 'manual')
    );

    UPDATE public.bl_receivables
    SET
      settled_amount_brl = LEAST(original_amount_brl, COALESCE(settled_amount_brl, 0) + v_allocation),
      balance_brl = GREATEST(COALESCE(balance_brl, 0) - v_allocation, 0),
      status = CASE
        WHEN GREATEST(COALESCE(balance_brl, 0) - v_allocation, 0) <= 0 THEN 'settled'
        ELSE 'partially_settled'
      END,
      updated_at = now()
    WHERE id = v_receivable.id;

    v_remaining := ROUND((v_remaining - v_allocation)::NUMERIC, 2);
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Falha ao alocar pagamento: saldo residual %.', v_remaining USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.invoice_receivable_links irl
  SET status = 'settled_by_this_invoice'
  WHERE irl.invoice_id = p_invoice_id
    AND irl.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.bl_receivables br
      WHERE br.id = irl.receivable_id
        AND br.balance_brl <= 0
    );

  SELECT COALESCE(SUM(balance_brl), 0)
  INTO v_remaining_open
  FROM public.bl_receivables
  WHERE id = ANY(v_receivable_ids)
    AND status IN ('open', 'partially_settled');

  SELECT COALESCE(SUM(amount_brl), 0)
  INTO v_total_paid
  FROM public.payments
  WHERE invoice_id = p_invoice_id;

  v_next_status := CASE WHEN v_remaining_open <= 0 THEN 'paid' ELSE 'partially_paid' END;

  UPDATE public.invoices
  SET
    total_paid_brl = v_total_paid,
    balance_brl = GREATEST(v_remaining_open, 0),
    status = v_next_status
  WHERE id = p_invoice_id;

  -- Excedente da baixa manual: registra restituicao pendente ao cliente.
  IF v_excess > 0 THEN
    INSERT INTO public.invoice_refunds (invoice_id, payment_id, amount_brl, status, registered_by, notes)
    VALUES (p_invoice_id, v_payment_id, v_excess, 'pending', v_actor, NULLIF(TRIM(COALESCE(p_notes, '')), ''));
  END IF;

  UPDATE public.bls b
  SET financial_status = 'paid'
  WHERE b.id IN (
    SELECT br.bl_id
    FROM public.bl_receivables br
    WHERE br.id = ANY(v_receivable_ids)
      AND br.balance_brl <= 0
  );

  SELECT COUNT(*)
  INTO v_receivables_settled
  FROM public.bl_receivables
  WHERE id = ANY(v_all_receivable_ids)
    AND balance_brl <= 0;

  -- ADR 0093, decisões 6 a 8 (migration 356): toda fatura aberta ligada aos
  -- recebíveis desta baixa é reprojetada, parcial ou não.
  v_cross := public._reproject_invoices_for_receivables(p_invoice_id, v_receivable_ids, v_actor);
  v_covered := (v_cross->>'covered')::integer;
  v_obsoleted := (v_cross->>'obsoleted')::integer;

  INSERT INTO public.invoice_lifecycle_events (invoice_id, event_type, receivable_id, actor, payload)
  VALUES (
    p_invoice_id,
    CASE
      WHEN COALESCE(p_source, 'manual') = 'pix_extract' THEN 'reconciled_by_txid'
      WHEN v_next_status = 'paid' THEN 'paid'
      ELSE 'partially_paid'
    END,
    NULL,
    v_actor,
    jsonb_build_object(
      'amount_brl', v_payment_amount,
      'source', COALESCE(p_source, 'manual'),
      'pix_txid', NULLIF(TRIM(COALESCE(p_pix_txid, '')), ''),
      'status', v_next_status,
      'refund_due_brl', v_excess
    )
  );

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, justification)
  VALUES (
    'invoice', p_invoice_id::TEXT, 'ledger_payment',
    COALESCE(v_invoice.balance_brl::TEXT, '0'), v_remaining_open::TEXT, auth.uid(), now(),
    'Baixa via ledger (' || COALESCE(p_source, 'manual') || ')'
  );

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'payment_id', v_payment_id,
    'status', v_next_status,
    'amount_brl', v_payment_amount,
    'balance_brl', GREATEST(v_remaining_open, 0),
    'refund_due_brl', v_excess,
    'receivables_settled', v_receivables_settled,
    'individuals_covered', v_covered,
    'consolidated_obsoleted', v_obsoleted
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_bl_ce_mercante(p_bl_id text, p_reason text, p_expected_ce text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_invoices text;
  v_result text;
  v_old text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da remocao do CE Mercante.' USING ERRCODE = '22023';
  END IF;
  SELECT ce_mercante INTO v_old FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B/L % não encontrado.', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_ce IS NOT NULL
     AND public.ce_mercante_key(v_old) IS DISTINCT FROM public.ce_mercante_key(p_expected_ce) THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % mudou depois que a ficha foi aberta (agora: %). Recarregue a ficha e confira antes de remover.',
      p_bl_id, COALESCE(NULLIF(btrim(COALESCE(v_old, '')), ''), 'sem CE')
      USING ERRCODE = '22023';
  END IF;
  v_invoices := NULLIF(array_to_string(public._bl_live_invoice_numbers(p_bl_id), ', '), '');
  IF v_invoices IS NOT NULL THEN
    RAISE EXCEPTION 'O CE Mercante do B/L % não pode ser removido: há fatura emitida (%). O Administrativo precisa cancelar a fatura antes.', p_bl_id, v_invoices
      USING ERRCODE = 'P0011';
  END IF;
  v_result := public._set_bl_ce_mercante(p_bl_id, NULL, auth.uid(), 'Remocao do CE Mercante pela ficha: ' || v_reason, 'ce_mercante_ficha');
  RETURN jsonb_build_object('status', v_result, 'bl_id', p_bl_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report(p_voyage_id bigint, p_port text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN
    RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_report_id
  FROM public.agency_departure_reports
  WHERE voyage_id = p_voyage_id
    AND port = upper(btrim(p_port))
    AND status = 'closed'
    AND terminal_id IS NULL
  FOR UPDATE;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'ADR não está fechado.' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.agency_departure_reports
  SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL
  WHERE id = v_report_id;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  -- 564: a chave é o próprio ADR, como o fechamento (559) e a reabertura
  -- por report_id gravam: fechar e reabrir ficam no mesmo registro.
  VALUES ('agency_departure_report', v_report_id::text,
          'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_agency_departure_report_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_report RECORD;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  IF btrim(COALESCE(p_justification, '')) = '' THEN RAISE EXCEPTION 'Reabertura exige justificativa.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514'; END IF;
  IF v_report.status <> 'closed' THEN RAISE EXCEPTION 'ADR não está fechado.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.agency_departure_reports SET status = 'open', closed_at = NULL, closed_by = NULL, closed_snapshot = NULL WHERE id = p_report_id;
  -- Reabrir destrava a edição sem apagar decisões, assinaturas ou histórico.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report', p_report_id::TEXT, 'status', 'closed', 'open', auth.uid(), btrim(p_justification));
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.replace_vazios_from_baplie_transactional(p_voyage_id bigint, p_description text, p_uploaded_by uuid, p_replace_existing boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_manifest_id uuid;
  v_empty integer;
  v_total integer;
  v_planilha integer;
  v_pruned integer;
  v_removed integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_uploaded_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para importar vazios Baplie.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  PERFORM public._set_import_context('Vazios pelo Baplie', p_voyage_id, NULL);
  PERFORM pg_advisory_xact_lock(hashtextextended('vazios_importacao:' || p_voyage_id::text, 0));

  SELECT count(*)::integer INTO v_empty
  FROM public.baplie_containers
  WHERE voyage_id = p_voyage_id AND status = 'empty' AND NOT is_transshipment;

  IF v_empty = 0 THEN
    IF NOT p_replace_existing THEN
      RAISE EXCEPTION 'Nenhum container vazio encontrado no Baplie desta viagem.'
        USING ERRCODE = 'P0002';
    END IF;
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
    GET DIAGNOSTICS v_removed = ROW_COUNT;
    v_pruned := public._vazios_importacao_prune(p_voyage_id);
    RETURN jsonb_build_object('manifest_id', NULL, 'total', 0, 'planilha', 0, 'pruned', v_pruned, 'removed', v_removed > 0);
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_natureza (container_number text, natureza text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_natureza;
  INSERT INTO pg_temp.vazios_natureza SELECT * FROM public._vazios_importacao_natureza_map(p_voyage_id);

  IF p_replace_existing THEN
    DELETE FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie';
  ELSIF EXISTS (
    SELECT 1 FROM public.vazios_importacao_manifests
    WHERE voyage_id = p_voyage_id AND source = 'baplie'
  ) THEN
    RAISE EXCEPTION 'Já existe manifesto Baplie para esta viagem.'
      USING ERRCODE = '23505';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vazios_398_baplie (container_number text, size_type text, weight_kg numeric, pol text, pod text) ON COMMIT DROP;
  TRUNCATE pg_temp.vazios_398_baplie;
  INSERT INTO pg_temp.vazios_398_baplie
  SELECT DISTINCT ON (upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')))
         b.container_number, b.size_type, b.weight_kg, b.pol, b.pod
  FROM public.baplie_containers AS b
  WHERE b.voyage_id = p_voyage_id AND b.status = 'empty' AND NOT b.is_transshipment
    AND NOT EXISTS (
      SELECT 1 FROM public.vazios_importacao_containers AS c
      WHERE c.voyage_id = p_voyage_id
        AND c.container_key = upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g'))
    )
  ORDER BY upper(regexp_replace(b.container_number, '[^A-Za-z0-9]', '', 'g')), b.id;
  SELECT count(*)::integer INTO v_total FROM pg_temp.vazios_398_baplie;
  v_planilha := v_empty - v_total;

  IF v_total > 0 THEN
    INSERT INTO public.vazios_importacao_manifests (
      voyage_id, description, total_containers, imported_by, source
    )
    VALUES (
      p_voyage_id, COALESCE(p_description, 'Importado via Baplie EDI'),
      v_total, p_uploaded_by, 'baplie'
    )
    RETURNING id INTO v_manifest_id;

    INSERT INTO public.vazios_importacao_containers (
      manifest_id, container_number, container_type, tare_kg, pol, pod, natureza
    )
    SELECT v_manifest_id, b.container_number, b.size_type, b.weight_kg, b.pol, b.pod, n.natureza
    FROM pg_temp.vazios_398_baplie AS b
    LEFT JOIN pg_temp.vazios_natureza n ON n.container_number = upper(btrim(b.container_number));
  END IF;

  v_pruned := public._vazios_importacao_prune(p_voyage_id);

  RETURN jsonb_build_object('manifest_id', v_manifest_id, 'total', v_total, 'planilha', v_planilha,
    'pruned', v_pruned, 'removed', false);
END $function$;

CREATE OR REPLACE FUNCTION public.resolve_pix_reconciliation_exception(p_exception_id bigint, p_resolution_source text, p_invoice_id bigint DEFAULT NULL::bigint, p_demurrage_invoice_id bigint DEFAULT NULL::bigint, p_txid text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_exception public.pix_reconciliation_exceptions%ROWTYPE;
  v_normalized_txid TEXT := public.normalize_pix_txid(p_txid);
  v_authoritative BOOLEAN := false;
  v_paid_date DATE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para a conciliação de Pix.' USING ERRCODE = '42501';
  END IF;
  IF p_resolution_source NOT IN ('local', 'demurrage') THEN
    RAISE EXCEPTION 'Origem de resolucao PIX invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exception
  FROM public.pix_reconciliation_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Excecao PIX % nao encontrada.', p_exception_id USING ERRCODE = 'P0002';
  END IF;
  IF v_exception.status = 'resolved' THEN
    RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
  END IF;
  IF v_normalized_txid IS DISTINCT FROM v_exception.normalized_txid THEN
    RAISE EXCEPTION 'TXID informado nao corresponde exatamente ao TXID persistido na excecao.' USING ERRCODE = '22023';
  END IF;

  IF p_resolution_source = 'local' THEN
    IF p_invoice_id IS NULL OR p_demurrage_invoice_id IS NOT NULL OR v_normalized_txid = '' THEN
      RAISE EXCEPTION 'Resolucao local exige invoice local e TXID persistido.' USING ERRCODE = '22023';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.ledger_settlements first_settlement
        ON first_settlement.invoice_id = i.id
       AND first_settlement.source = 'pix_extract'
       AND public.normalize_pix_txid(first_settlement.pix_txid) = v_exception.normalized_txid
      WHERE i.id = p_invoice_id
        AND i.invoice_type IN ('individual', 'consolidated')
        AND ABS((
          SELECT COALESCE(SUM(all_settlements.amount_brl), 0)
          FROM public.ledger_settlements all_settlements
          WHERE all_settlements.payment_id = first_settlement.payment_id
        ) - v_exception.amount_brl) <= 0.01
        AND (
          public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
          OR v_exception.normalized_txid <> ''
        )
    ) OR EXISTS (
      -- Avulsa (migration 242): a baixa por TXID vai por `payments`, nunca por
      -- `ledger_settlements`; a prova é o TXID gravado na fatura e o evento
      -- `reconciled_by_txid` com o mesmo valor da exceção.
      SELECT 1
      FROM public.invoices i
      JOIN public.invoice_lifecycle_events e
        ON e.invoice_id = i.id
       AND e.event_type = 'reconciled_by_txid'
       AND public.normalize_pix_txid(e.payload->>'txid') = v_exception.normalized_txid
      WHERE i.id = p_invoice_id
        AND i.invoice_type = 'manual'
        AND i.conciliated_by_extract = true
        AND public.normalize_pix_txid(i.pix_txid) = v_exception.normalized_txid
        AND ABS(COALESCE((e.payload->>'amount_brl')::numeric, 0) - v_exception.amount_brl) <= 0.01
    ) INTO v_authoritative;
  ELSE
    IF p_demurrage_invoice_id IS NULL OR p_invoice_id IS NOT NULL OR v_exception.paid_at IS NULL THEN
      RAISE EXCEPTION 'Resolucao Demurrage exige invoice e data paga persistida.' USING ERRCODE = '22023';
    END IF;
    v_paid_date := (v_exception.paid_at AT TIME ZONE 'UTC')::DATE;
    SELECT EXISTS (
      SELECT 1
      FROM public.demurrage_invoices d
      WHERE d.id = p_demurrage_invoice_id
        AND d.status = 'paid'
        AND d.conciliated_by_extract = true
        AND d.paid_at = v_paid_date
        AND public.normalize_pix_txid(d.pix_txid) = v_exception.normalized_txid
        AND EXISTS (
          SELECT 1
          FROM public.get_demurrage_recent_values(d.id, v_paid_date) w
          WHERE ABS(w.total_brl - v_exception.amount_brl) <= 0.01
        )
    ) INTO v_authoritative;
  END IF;

  IF NOT v_authoritative THEN
    RAISE EXCEPTION 'Nenhuma baixa/settlement autoritativa corresponde à exceção PIX %.', p_exception_id USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.pix_reconciliation_exceptions
  SET status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
      resolution_source = p_resolution_source,
      resolved_invoice_id = p_invoice_id,
      resolved_demurrage_invoice_id = p_demurrage_invoice_id,
      updated_at = now()
  WHERE id = v_exception.id;

  PERFORM set_config('alerts.foundation_trigger', 'on', true);
  PERFORM public.resolve_alert_item(
    'pix_unreconciled', 'pix_transaction', v_exception.id::TEXT,
    'pix_reconciliation_authoritative', jsonb_build_object(
      'exception_id', v_exception.id,
      'resolution_source', p_resolution_source,
      'invoice_id', COALESCE(p_invoice_id, p_demurrage_invoice_id),
      'txid', NULLIF(p_txid, '')
    )
  );
  PERFORM set_config('alerts.foundation_trigger', 'off', true);

  RETURN jsonb_build_object('id', v_exception.id, 'status', 'resolved');
END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_stale_invoice(p_invoice_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_customer bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Sem permissão para resolver alerta.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 15 THEN
    RAISE EXCEPTION 'Informe a justificativa da resolução (mínimo de 15 caracteres): qual avulsa foi emitida ou por que a diferença não é cobrada.' USING ERRCODE = '22023';
  END IF;
  SELECT customer_id INTO v_customer FROM public.invoices WHERE id = p_invoice_id;
  IF v_customer IS NULL THEN RAISE EXCEPTION 'Fatura não encontrada.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.resolve_alert_item('fatura_desatualizada', 'invoice', p_invoice_id::text, 'manual_correction_resolution',
    jsonb_build_object('reason', btrim(p_reason), 'actor', auth.uid()));
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, new_value, changed_by, justification)
    VALUES ('invoice', p_invoice_id::text, 'stale_invoice_resolved', 'resolved', auth.uid(), btrim(p_reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.retry_import_effect(p_effect_id bigint, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.import_pending_effects%ROWTYPE;
  v_actor uuid := auth.uid();
  v_role text := public.current_actor_role();
  v_justification text := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_assign_initiator boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (v_actor IS NULL OR NOT public.is_active_user()
          OR v_role NOT IN ('administrativo', 'financeiro', 'operacoes', 'documentacao', 'equipamentos')) THEN
    RAISE EXCEPTION 'Usuário sem permissão para reabrir efeito.' USING ERRCODE = '42501';
  END IF;
  IF v_justification IS NULL OR char_length(v_justification) > 500 THEN
    RAISE EXCEPTION 'Justificativa obrigatória para retry.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
  FROM public.import_pending_effects
  WHERE id = p_effect_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Efeito % não encontrado.', p_effect_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'Somente efeitos bloqueados podem ser reabertos.' USING ERRCODE = '22023';
  END IF;

  -- 570: o efeito gravado sem iniciador passa a ser de quem reprocessa.
  v_assign_initiator := v_row.created_by IS NULL AND v_actor IS NOT NULL;

  UPDATE public.import_pending_effects
     SET status = 'retry_wait',
         attempts = 0,
         next_attempt_at = now(),
         lease_until = NULL,
         leased_by = NULL,
         last_error_code = NULL,
         last_error_message = NULL,
         created_by = CASE WHEN v_assign_initiator THEN v_actor ELSE created_by END,
         result = COALESCE(result, '{}'::jsonb)
           || jsonb_build_object('manual_retry_justification', v_justification)
           || CASE WHEN v_assign_initiator
                THEN jsonb_build_object('initiator_assigned_on_retry', v_actor)
                ELSE '{}'::jsonb END,
         updated_at = now()
   WHERE id = v_row.id;

  INSERT INTO public.audit_logs(
    entity_type, entity_id, field_name, old_value, new_value,
    changed_by, justification, actor_role, actor_department
  ) VALUES (
    'import_effect', v_row.id::text, 'retry',
    jsonb_build_object('status', 'blocked', 'attempts', v_row.attempts)::text,
    (jsonb_build_object('status', 'retry_wait', 'attempts', 0)
      || CASE WHEN v_assign_initiator
           THEN jsonb_build_object('created_by', v_actor, 'initiator_assigned_on_retry', true)
           ELSE '{}'::jsonb END)::text,
    v_actor, v_justification, COALESCE(v_role, 'sistema'), COALESCE(v_role, 'sistema')
  );

  SELECT * INTO v_row FROM public.import_pending_effects WHERE id = p_effect_id;
  RETURN jsonb_build_object('effect', to_jsonb(v_row), 'idempotent', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_demurrage_payment(p_invoice_id bigint, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor UUID;
  v_old_status TEXT;
  v_pix_txid TEXT;
  v_e2e TEXT;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Usuário sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(TRIM(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe a justificativa para cancelar a baixa.' USING ERRCODE = '22023';
  END IF;

  v_actor := COALESCE(p_actor, auth.uid());

  SELECT status, NULLIF(btrim(pix_txid), '') INTO v_old_status, v_pix_txid
  FROM public.demurrage_invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old_status, '') <> 'paid' THEN
    RAISE EXCEPTION 'Demurrage invoice % não está paga (status=%).', p_invoice_id, COALESCE(v_old_status, '?')
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.demurrage_invoices
  SET
    status = 'issued',
    paid_at = NULL,
    pix_txid = NULL,
    conciliated_by_extract = false
  WHERE id = p_invoice_id;

  INSERT INTO public.audit_logs (
    entity_type,
    entity_id,
    field_name,
    old_value,
    new_value,
    changed_by,
    changed_at,
    justification
  )
  VALUES (
    'demurrage_invoice',
    p_invoice_id::TEXT,
    'payment_reversed',
    v_old_status,
    'issued',
    v_actor,
    now(),
    TRIM(p_reason)
  );

  -- Baixa automática Itaú cancelada: o Pix volta para análise do Financeiro.
  -- A baixa automática grava o TXID da cobrança; a manual, o identificador do Pix.
  IF v_pix_txid IS NOT NULL THEN
    SELECT r.end_to_end_id INTO v_e2e
    FROM public.itau_pix_receipts r
    WHERE (upper(r.end_to_end_id) = upper(v_pix_txid) AND r.status IN ('settled', 'handled'))
       OR (r.status = 'settled' AND public._itau_pix_origin(v_pix_txid) = 'vela'
           AND public.normalize_pix_txid(r.txid) = public.normalize_pix_txid(v_pix_txid))
    ORDER BY r.created_at DESC
    LIMIT 1;
    IF v_e2e IS NOT NULL THEN
      UPDATE public.itau_pix_receipts
      SET status = 'review', reason = 'Baixa cancelada: ' || btrim(p_reason),
          handled_at = NULL, handled_by = NULL, handled_note = NULL
      WHERE end_to_end_id = v_e2e;
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      PERFORM public.upsert_alert_item('pix_unreconciled', 'itau_pix_receipt', v_e2e,
        'A baixa automática do Pix ' || v_e2e || ' foi cancelada (' || btrim(p_reason) || '): dê a baixa na fatura certa ou registre a devolução.',
        'itau_pix', 'administrativo', jsonb_build_object('end_to_end_id', v_e2e, 'demurrage_invoice_id', p_invoice_id), '/reconciliacao');
      PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'new_status', 'issued'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revert_voyage_omission(p_omission_id bigint, p_justification text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_omission RECORD;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
  v_cod_count INTEGER;
  v_entity_id TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Somente usuário interno ativo pode reverter a omissão, em nome do próprio usuário.'
      USING ERRCODE = '42501';
  END IF;

  IF v_justification IS NULL THEN
    RAISE EXCEPTION 'Reversão de omissão exige justificativa.' USING ERRCODE = '22023';
  END IF;

  SELECT o.id, o.voyage_id, o.omitted_pod, o.discharge_pod, o.reverted_at
  INTO v_omission
  FROM public.voyage_omissions AS o
  WHERE o.id = p_omission_id
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Omissão % não encontrada.', p_omission_id USING ERRCODE = 'P0002';
  END IF;
  IF v_omission.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Omissão % já foi revertida.', p_omission_id USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_cod_count
  FROM public.bl_transshipments AS t
  WHERE t.omission_id = p_omission_id
    AND t.disposition = 'cod';

  IF v_cod_count > 0 THEN
    RAISE EXCEPTION 'Não é possível reverter a omissão: % B/L(s) afetado(s) estão em COD.', v_cod_count
      USING ERRCODE = '22023';
  END IF;

  v_entity_id := v_omission.voyage_id::TEXT || '::' || upper(btrim(v_omission.omitted_pod));

  -- Este audit row é obrigatório: voyageRouteSchedules deriva omitted dele e,
  -- desde a 306, os consumidores de estado terminalizado e de alertas de ADR
  -- contam a escala ativa pela mesma decisão mais recente.
  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage_pod_schedule',
    v_entity_id,
    'omitted',
    'true',
    'false',
    p_changed_by,
    v_justification
  );

  INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES (
    'voyage',
    v_omission.voyage_id::TEXT,
    'omissao_revertida',
    v_omission.omitted_pod,
    v_omission.discharge_pod,
    p_changed_by,
    v_justification
  );

  INSERT INTO public.portal_notifications(customer_id, bl_id, type, title, message, link)
  SELECT
    b.customer_id,
    b.id,
    'transshipment',
    'Correção de omissão de escala',
    'A omissão da escala de ' || v_omission.omitted_pod || ' foi revertida. O B/L ' || b.id ||
      ' voltou a seguir a programação original da viagem.',
    NULL
  FROM public.bl_transshipments AS t
  JOIN public.bls AS b ON b.id = t.bl_id
  WHERE t.omission_id = p_omission_id
    AND b.customer_id IS NOT NULL;

  UPDATE public.voyage_omissions
  SET reverted_at = now(),
      reverted_by = p_changed_by,
      revert_justification = v_justification
  WHERE id = p_omission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_bl_demurrage_config(p_bl_id text, p_expected_updated_at timestamp with time zone, p_free_time_override integer, p_rate_p1_usd numeric, p_rate_p2_usd numeric, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bl public.bls%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para configurar demurrage.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_bl FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_bl.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  UPDATE public.bls
  SET
    free_time_override = p_free_time_override,
    demurrage_rate_override_p1_usd = p_rate_p1_usd,
    demurrage_rate_override_p2_usd = p_rate_p2_usd
  WHERE id = p_bl_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by, justification
  )
  SELECT 'bl', p_bl_id, change.field_name, change.old_value, change.new_value,
         p_changed_by, 'Config de demurrage (Faturamento).'
  FROM (VALUES
    ('free_time_override', v_bl.free_time_override::TEXT, p_free_time_override::TEXT),
    ('demurrage_rate_override_p1_usd', v_bl.demurrage_rate_override_p1_usd::TEXT, p_rate_p1_usd::TEXT),
    ('demurrage_rate_override_p2_usd', v_bl.demurrage_rate_override_p2_usd::TEXT, p_rate_p2_usd::TEXT)
  ) AS change(field_name, old_value, new_value)
  WHERE change.old_value IS DISTINCT FROM change.new_value;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_bl_review(p_bl_id text, p_expected_updated_at timestamp with time zone, p_update_payload jsonb, p_audit_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_current_updated_at timestamptz;
  v_result jsonb;
  v_reason text;
  v_previous_context text := current_setting('vela.import_context', true);
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'updated_at obrigatorio; recarregue o B/L antes de salvar'
      USING ERRCODE = 'PT409';
  END IF;

  SELECT updated_at INTO v_current_updated_at
  FROM public.bls WHERE id = p_bl_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;
  IF v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  -- 502: das linhas do navegador vale só a justificativa; o antes e o depois
  -- vêm dos gatilhos, que leem o motivo de `vela.import_context`.
  IF jsonb_typeof(p_audit_rows) = 'array' THEN
    SELECT NULLIF(btrim(a->>'justification'), '')
      INTO v_reason
    FROM jsonb_array_elements(p_audit_rows) AS a
    WHERE NULLIF(btrim(a->>'justification'), '') IS NOT NULL
    LIMIT 1;
  END IF;
  IF v_reason IS NOT NULL THEN
    PERFORM set_config('vela.import_context', v_reason, true);
  END IF;

  -- A cubagem breakbulk faltava na funcao legada. Persistimos primeiro sob o
  -- mesmo lock e repassamos a nova versao.
  IF p_update_payload ? 'bb_cbm' THEN
    UPDATE public.bls
    SET bb_cbm = NULLIF(p_update_payload->>'bb_cbm', '')::numeric
    WHERE id = p_bl_id
    RETURNING updated_at INTO v_current_updated_at;
  END IF;

  SELECT public.save_bl_review_legacy_070(
    p_bl_id,
    v_current_updated_at,
    -- O CE Mercante não muda pela edição da ficha: só por Corrigir/Remover
    -- CE Mercante (migration 177; ADR 0078, itens 1, 2 e 5).
    p_update_payload - 'bb_cbm' - 'ce_mercante',
    -- A legada grava as linhas recebidas, menos as de `review_status`, e usa
    -- a justificativa da primeira na linha da situação da Revisão. Uma linha
    -- de `review_status` leva o motivo sem gravar nada vindo do navegador.
    CASE WHEN v_reason IS NULL THEN '[]'::jsonb
         ELSE jsonb_build_array(jsonb_build_object('field_name', 'review_status', 'justification', v_reason))
    END,
    p_changed_by
  ) INTO v_result;

  IF v_reason IS NOT NULL THEN
    PERFORM set_config('vela.import_context', COALESCE(v_previous_context, ''), true);
  END IF;
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_bl_review_legacy_070(p_bl_id text, p_expected_updated_at timestamp with time zone, p_update_payload jsonb, p_audit_rows jsonb, p_changed_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_new_updated_at TIMESTAMPTZ;
  v_current_updated_at TIMESTAMPTZ;
  v_next_customer_id BIGINT;
  v_previous_status TEXT;
  v_input_notes TEXT;
  v_human_notes TEXT;
  v_rowcount INT;
  v_reasons TEXT[];
  v_status TEXT;
  v_notes TEXT;
  v_justification TEXT := 'Revisao manual';
  v_manifest_email TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para revisar B/L.'
      USING ERRCODE = '42501';
  END IF;

  IF p_bl_id IS NULL OR p_bl_id = '' THEN
    RAISE EXCEPTION 'bl_id obrigatorio' USING ERRCODE = '22004';
  END IF;

  SELECT updated_at
  INTO v_current_updated_at
  FROM public.bls
  WHERE id = p_bl_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BL % não encontrado', p_bl_id USING ERRCODE = 'P0002';
  END IF;

  IF p_expected_updated_at IS NOT NULL
     AND v_current_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_next_customer_id := CASE
    WHEN p_update_payload ? 'customer_id'
      THEN NULLIF(p_update_payload->>'customer_id', '')::BIGINT
    ELSE NULL
  END;

  UPDATE public.bls AS b
  SET
    shipper            = CASE WHEN p_update_payload ? 'shipper' THEN p_update_payload->>'shipper' ELSE b.shipper END,
    consignee          = CASE WHEN p_update_payload ? 'consignee' THEN p_update_payload->>'consignee' ELSE b.consignee END,
    notify_party       = CASE WHEN p_update_payload ? 'notify_party' THEN p_update_payload->>'notify_party' ELSE b.notify_party END,
    ce_mercante        = CASE WHEN p_update_payload ? 'ce_mercante' THEN p_update_payload->>'ce_mercante' ELSE b.ce_mercante END,
    pol                = CASE WHEN p_update_payload ? 'pol' THEN p_update_payload->>'pol' ELSE b.pol END,
    pod                = CASE WHEN p_update_payload ? 'pod' THEN p_update_payload->>'pod' ELSE b.pod END,
    place_of_delivery  = CASE WHEN p_update_payload ? 'place_of_delivery' THEN p_update_payload->>'place_of_delivery' ELSE b.place_of_delivery END,
    place_of_receipt   = CASE WHEN p_update_payload ? 'place_of_receipt' THEN p_update_payload->>'place_of_receipt' ELSE b.place_of_receipt END,
    movement_from      = CASE WHEN p_update_payload ? 'movement_from' THEN p_update_payload->>'movement_from' ELSE b.movement_from END,
    movement_to        = CASE WHEN p_update_payload ? 'movement_to' THEN p_update_payload->>'movement_to' ELSE b.movement_to END,
    issue_place        = CASE WHEN p_update_payload ? 'issue_place' THEN p_update_payload->>'issue_place' ELSE b.issue_place END,
    bl_emission_date   = CASE WHEN p_update_payload ? 'bl_emission_date' THEN NULLIF(p_update_payload->>'bl_emission_date', '')::DATE ELSE b.bl_emission_date END,
    cargo_description  = CASE WHEN p_update_payload ? 'cargo_description' THEN p_update_payload->>'cargo_description' ELSE b.cargo_description END,
    total_weight_kg    = CASE WHEN p_update_payload ? 'total_weight_kg' THEN NULLIF(p_update_payload->>'total_weight_kg', '')::NUMERIC ELSE b.total_weight_kg END,
    total_cbm          = CASE WHEN p_update_payload ? 'total_cbm' THEN NULLIF(p_update_payload->>'total_cbm', '')::NUMERIC ELSE b.total_cbm END,
    bb_machine_qty     = CASE WHEN p_update_payload ? 'bb_machine_qty' THEN NULLIF(p_update_payload->>'bb_machine_qty', '')::NUMERIC ELSE b.bb_machine_qty END,
    bb_packages_qty    = CASE WHEN p_update_payload ? 'bb_packages_qty' THEN NULLIF(p_update_payload->>'bb_packages_qty', '')::NUMERIC ELSE b.bb_packages_qty END,
    bb_packages_total  = CASE WHEN p_update_payload ? 'bb_packages_total' THEN NULLIF(p_update_payload->>'bb_packages_total', '')::NUMERIC ELSE b.bb_packages_total END,
    bb_weight_ton      = CASE WHEN p_update_payload ? 'bb_weight_ton' THEN NULLIF(p_update_payload->>'bb_weight_ton', '')::NUMERIC ELSE b.bb_weight_ton END,
    incoterm           = CASE WHEN p_update_payload ? 'incoterm' THEN p_update_payload->>'incoterm' ELSE b.incoterm END,
    payment_type       = CASE WHEN p_update_payload ? 'payment_type' THEN NULLIF(p_update_payload->>'payment_type', '') ELSE b.payment_type END,
    free_time_override = CASE WHEN p_update_payload ? 'free_time_override' THEN NULLIF(p_update_payload->>'free_time_override', '')::INT ELSE b.free_time_override END,
    notes              = CASE WHEN p_update_payload ? 'notes' THEN p_update_payload->>'notes' ELSE b.notes END,
    -- NCM cadastrado a mão na ficha (migration 358). Chega como array JSON de
    -- códigos; `[]` é uma decisão do operador de limpar, não um valor ausente.
    ncm_codes          = CASE
      WHEN p_update_payload ? 'ncm_codes'
        THEN public.normalize_ncm_codes(p_update_payload->'ncm_codes')
      ELSE b.ncm_codes
    END,
    customer_id        = CASE WHEN p_update_payload ? 'customer_id' THEN v_next_customer_id ELSE b.customer_id END,
    customer_reconciliation_status = CASE
      WHEN p_update_payload ? 'customer_reconciliation_status'
        THEN p_update_payload->>'customer_reconciliation_status'
      WHEN p_update_payload ? 'customer_id'
        THEN CASE WHEN v_next_customer_id IS NULL THEN 'missing_customer' ELSE 'reconciled' END
      ELSE b.customer_reconciliation_status
    END,
    customer_reconciliation_notes = CASE
      WHEN p_update_payload ? 'customer_reconciliation_notes'
        THEN NULLIF(p_update_payload->>'customer_reconciliation_notes', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL THEN 'Cliente removido manualmente do B/L.'
          ELSE 'Cliente reconciliado manualmente na revisao do B/L.'
        END
      ELSE b.customer_reconciliation_notes
    END,
    billing_hold_reason = CASE
      WHEN p_update_payload ? 'billing_hold_reason'
        THEN NULLIF(p_update_payload->>'billing_hold_reason', '')
      WHEN p_update_payload ? 'customer_id'
        THEN CASE
          WHEN v_next_customer_id IS NULL
            THEN COALESCE(b.billing_hold_reason, 'Cliente sem reconciliacao aprovada.')
          ELSE NULL
        END
      ELSE b.billing_hold_reason
    END
  WHERE b.id = p_bl_id
    AND (p_expected_updated_at IS NULL OR b.updated_at = p_expected_updated_at)
  RETURNING b.review_status, b.notes
  INTO v_previous_status, v_input_notes;

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'BL % foi alterado por outro usuário; recarregue antes de salvar', p_bl_id
      USING ERRCODE = 'PT409';
  END IF;

  v_reasons := public.compute_bl_review_pendencies(p_bl_id);
  v_status := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) = 0 THEN 'reviewed'
    ELSE 'pending_review'
  END;

  -- The machine-owned line always stays at the end. Human notes remain intact.
  v_human_notes := btrim(
    regexp_replace(
      COALESCE(v_input_notes, ''),
      E'(^|\\n)Pendencias de importacao:[^\\n]*$',
      '',
      'i'
    )
  );

  v_notes := CASE
    WHEN COALESCE(cardinality(v_reasons), 0) > 0 THEN concat_ws(
      E'\n',
      NULLIF(v_human_notes, ''),
      'Pendencias de importacao: ' || array_to_string(v_reasons, ', ')
    )
    ELSE NULLIF(v_human_notes, '')
  END;

  UPDATE public.bls AS b
  SET
    review_status = v_status,
    notes = v_notes
  WHERE b.id = p_bl_id
  RETURNING b.updated_at INTO v_new_updated_at;

  IF p_audit_rows IS NOT NULL
     AND jsonb_typeof(p_audit_rows) = 'array'
     AND jsonb_array_length(p_audit_rows) > 0 THEN
    SELECT COALESCE(NULLIF(a->>'justification', ''), v_justification)
    INTO v_justification
    FROM jsonb_array_elements(p_audit_rows) AS a
    LIMIT 1;

    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    SELECT
      COALESCE(a->>'entity_type', 'bl'),
      COALESCE(a->>'entity_id', p_bl_id),
      a->>'field_name',
      a->>'old_value',
      a->>'new_value',
      p_changed_by,
      COALESCE(NULLIF(a->>'justification', ''), v_justification)
    FROM jsonb_array_elements(p_audit_rows) AS a
    WHERE a->>'field_name' IS DISTINCT FROM 'review_status';
  END IF;

  IF v_previous_status IS DISTINCT FROM v_status THEN
    INSERT INTO public.audit_logs (
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      changed_by,
      justification
    )
    VALUES (
      'bl',
      p_bl_id,
      'review_status',
      v_previous_status,
      v_status,
      p_changed_by,
      v_justification
    );
  END IF;

  PERFORM public.sync_customer_reconciliation_queue_for_bl(p_bl_id);

  -- ADR 0061: a conciliacao de cliente tem casa unica na Revisao, e por isso a
  -- Revisao precisa produzir aqui o efeito completo que a Validacao produzia —
  -- vincular o cliente E capturar o e-mail do manifesto como contato
  -- financeiro. Sem isto, remover os botoes da Validacao seria regressao.
  --
  -- Roda depois do sync porque e ele quem fecha a fila (`status = 'approved'`)
  -- para o B/L recem-vinculado; a fila e tambem quem guarda o e-mail do
  -- manifesto que a Validacao usava. `approved_by` fica com o revisor: quem
  -- resolveu foi quem salvou a revisao, e o sync nao conhece o ator (roda
  -- tambem na importacao, sem revisor humano).
  IF p_update_payload ? 'customer_id' AND v_next_customer_id IS NOT NULL THEN
    UPDATE public.customer_reconciliation_queue AS q
    SET approved_by = COALESCE(q.approved_by, p_changed_by)
    WHERE q.bl_id = p_bl_id
      AND q.status = 'approved'
    RETURNING q.manifest_customer_email INTO v_manifest_email;

    -- M14 também na Revisão (decisão do dono de 2026-10-15, migration 271): o
    -- e-mail do manifesto só vira contato do Cliente cujo CNPJ é o do
    -- documento, como na importação (migrations 175 e 194). Com CNPJ
    -- divergente, o vínculo é feito e o contato não.
    IF EXISTS (
      SELECT 1
      FROM public.bls AS b
      JOIN public.customers AS c ON c.id = v_next_customer_id
      WHERE b.id = p_bl_id
        AND NULLIF(public.normalize_document_text(b.manifest_customer_cnpj_cpf), '') IS NOT NULL
        AND public.normalize_document_text(c.cnpj_cpf) = public.normalize_document_text(b.manifest_customer_cnpj_cpf)
    ) THEN
      PERFORM public.capture_manifest_financial_contact(v_next_customer_id, v_manifest_email);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated_at', v_new_updated_at,
    'review_status', v_status,
    'pendencias', to_jsonb(v_reasons)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_exchange_rate_reference_v2(p_ptax numeric, p_roe numeric, p_effective_date date, p_source text, p_quote_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source text := NULLIF(btrim(COALESCE(p_source, '')), '');
  v_quote_date date := COALESCE(p_quote_date, p_effective_date);
  v_spread_version integer := public._demurrage_spread_version();
  v_actor uuid := auth.uid();
  -- B24 (ADR 0014): o ROE da PTAX vem do ponto canônico do banco; quem chama
  -- pode mandar só a PTAX (p_roe nulo), e o ROE informado é conferido.
  v_roe numeric := COALESCE(p_roe, CASE WHEN p_ptax IS NOT NULL AND p_ptax > 0 THEN public._demurrage_roe_from_ptax(p_ptax) END);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT public.is_active_user() THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_source NOT IN ('bcb_live', 'cached', 'manual')
     OR p_effective_date IS NULL
     OR v_roe IS NULL OR v_roe <= 0 OR v_roe > 1000
     OR v_roe::text = 'NaN'
     OR v_quote_date IS NULL THEN
    RAISE EXCEPTION 'Referência cambial inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_source IN ('bcb_live', 'cached')
     AND (p_ptax IS NULL OR p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN') THEN
    RAISE EXCEPTION 'PTAX obrigatória para origem %.', v_source USING ERRCODE = '22023';
  END IF;
  IF p_ptax IS NOT NULL AND (p_ptax <= 0 OR p_ptax > 1000 OR p_ptax::text = 'NaN') THEN
    RAISE EXCEPTION 'PTAX inválida.' USING ERRCODE = '22023';
  END IF;
  IF v_source IN ('bcb_live', 'cached')
     AND v_roe IS DISTINCT FROM public._demurrage_roe_from_ptax(p_ptax) THEN
    RAISE EXCEPTION 'ROE divergente da PTAX e do spread vigente.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.exchange_rate_reference_history(
    source, ptax, roe, effective_date, quote_date, spread_version, recorded_by
  ) VALUES (
    v_source, p_ptax, v_roe, p_effective_date, v_quote_date, v_spread_version, v_actor
  ) ON CONFLICT DO NOTHING;

  INSERT INTO public.exchange_rate_reference(
    id, ptax, roe, effective_date, updated_at, source, quote_date, spread_version
  ) VALUES (
    1, p_ptax, v_roe, p_effective_date, now(), v_source, v_quote_date, v_spread_version
  )
  ON CONFLICT (id) DO UPDATE
  SET ptax = EXCLUDED.ptax,
      roe = EXCLUDED.roe,
      effective_date = EXCLUDED.effective_date,
      updated_at = now(),
      source = EXCLUDED.source,
      quote_date = EXCLUDED.quote_date,
      spread_version = EXCLUDED.spread_version;

  RETURN jsonb_build_object(
    'source', v_source,
    'ptax', p_ptax,
    'roe', v_roe,
    'effective_date', p_effective_date,
    'quote_date', v_quote_date,
    'spread_version', v_spread_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_port text := upper(btrim(COALESCE(p_port, '')));
  v_result jsonb;
BEGIN
  -- O corpo anterior confere o usuário antes de ler o payload; a regra do
  -- ATA só lê o payload depois de um usuário ativo existir.
  IF auth.uid() IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário ativo sem permissão para editar a escala.' USING ERRCODE = '42501';
  END IF;

  -- 482 (ADR 0109): com o ATA da escala registrado, toda frente precisa de
  -- terminal; TBC não é terminal.
  IF jsonb_typeof(p_fronts) = 'array'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_fronts) AS f(item)
       WHERE NULLIF(btrim(COALESCE(f.item->>'terminal_id', '')), '') IS NULL
     )
     AND public._escala_ata_registrada(p_voyage_id, p_port, p_export_expectation) THEN
    RAISE EXCEPTION 'Com o ATA registrado, toda frente de operação precisa de terminal: TBC não é terminal. Escolha o terminal de cada frente.'
      USING ERRCODE = '22023';
  END IF;

  v_result := public.save_voyage_escala_terminal_state_legacy_482(
    p_voyage_id, p_port, p_expected_revision, p_fronts, p_terminals, p_export_expectation, p_justification
  );
  IF COALESCE((v_result->>'blocked')::boolean, false) THEN
    RETURN v_result;
  END IF;

  -- A Atracação TBC só existe enquanto alguma frente está em TBC.
  IF NOT EXISTS (
    SELECT 1 FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id IS NULL
  ) THEN
    DELETE FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id IS NULL;
    IF jsonb_typeof(v_result->'terminals') = 'array' THEN
      v_result := jsonb_set(v_result, '{terminals}', COALESCE((
        SELECT jsonb_agg(item) FROM jsonb_array_elements(v_result->'terminals') AS t(item)
        WHERE NULLIF(t.item->>'terminal_id', '') IS NOT NULL
      ), '[]'::jsonb), true);
    END IF;
    PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state_legacy_482(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_department TEXT;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_current_revision INTEGER := 0;
  v_next_revision INTEGER;
  v_entity_id TEXT;
  v_front RECORD;
  v_old_front RECORD;
  v_new_front RECORD;
  v_terminal RECORD;
  v_old_terminal RECORD;
  v_depot RECORD;
  v_report RECORD;
  v_old_export_exists BOOLEAN := FALSE;
  v_old_export_declared BOOLEAN := FALSE;
  v_old_export_granite BOOLEAN := FALSE;
  v_old_export_empty BOOLEAN := FALSE;
  v_old_export_containers_qty INTEGER;
  v_old_export_movements_qty INTEGER;
  v_old_export_discharge_ports TEXT[] := '{}'::TEXT[];
  v_old_export_ce_status TEXT;
  v_old_export_linked BOOLEAN := FALSE;
  v_export_existing_id UUID;
  v_export_existing_id_found BOOLEAN := FALSE;
  v_export_canonical_id UUID;
  v_export_granite BOOLEAN := FALSE;
  v_export_empty BOOLEAN := FALSE;
  v_export_declared BOOLEAN := FALSE;
  v_export_containers_qty INTEGER;
  v_export_movements_qty INTEGER;
  v_export_discharge_ports TEXT[] := '{}'::TEXT[];
  v_export_ce_status TEXT;
  v_export_linked BOOLEAN := FALSE;
  v_export_old JSONB;
  v_export_new JSONB;
  v_current_terminal_assignment BOOLEAN;
  v_existing_terminal_state BOOLEAN;
  v_existing_front BOOLEAN;
  v_front_changed BOOLEAN;
  v_state_changed BOOLEAN;
  v_requires_justification BOOLEAN := FALSE;
  v_closed_blockers JSONB := '[]'::JSONB;
  v_report_id UUID;
  v_report_status TEXT;
  v_terminal_code TEXT;
  v_blocked_report_id UUID;
  v_schedule JSONB;
  v_schedule_entity_id TEXT;
  v_schedule_field TEXT;
  v_schedule_old_value TEXT;
  v_schedule_new_value TEXT;
  v_new_voyage_status TEXT;
  v_active_pods INTEGER;
  v_pending_pods INTEGER;
BEGIN
  PERFORM set_config('vela.documental_justification', coalesce(p_justification, ''), true);
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin', 'administrativo', 'operacoes', 'operator', 'documentacao', 'equipamentos', 'financeiro') THEN
    RAISE EXCEPTION 'Usuário ativo sem permissão para editar a escala.'
      USING ERRCODE = '42501';
  END IF;
  -- 432: setor do autor (ADR 0046), o mesmo mapeamento do envelope v2 (429).
  v_department := CASE
    WHEN v_role IN ('admin', 'administrativo') THEN 'administrativo'
    WHEN v_role IN ('documentacao', 'operator') THEN 'documentacao'
    WHEN v_role = 'equipamentos' THEN 'equipamentos'
    WHEN v_role = 'financeiro' THEN 'financeiro'
    ELSE 'operacoes'
  END;
  v_entity_id := p_voyage_id::TEXT || '::' || v_port;

  IF p_expected_revision IS NULL THEN
    RAISE EXCEPTION 'Revision esperada obrigatoria.' USING ERRCODE = '22023';
  END IF;
  IF p_fronts IS NULL OR jsonb_typeof(p_fronts) <> 'array'
     OR p_terminals IS NULL OR jsonb_typeof(p_terminals) <> 'array'
     OR p_export_expectation IS NULL OR jsonb_typeof(p_export_expectation) <> 'object'
     OR (p_export_expectation ? 'discharge_ports'
         AND jsonb_typeof(p_export_expectation->'discharge_ports') <> 'array')
     OR (p_export_expectation ? 'schedule'
         AND jsonb_typeof(p_export_expectation->'schedule') <> 'object') THEN
    RAISE EXCEPTION 'Payload de escala invalido.' USING ERRCODE = '22023';
  END IF;

  -- A escala física é a linha da viagem; o lock serializa todas as escritas
  -- terminais da mesma escala, mesmo quando ela ainda não tem state próprio.
  PERFORM 1 FROM public.voyages WHERE id = p_voyage_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_port !~ '^BR[A-Z0-9]{3}$' THEN
    -- 556: com acento.
    RAISE EXCEPTION 'LOCODE brasileiro inválido: %.', v_port USING ERRCODE = '22023';
  END IF;

  -- ports é a referência FK usada pela escala, não uma lista fechada de lanes.
  -- O seed 307 dá nomes aos portos conhecidos; um LOCODE brasileiro válido
  -- informado pela operação também precisa poder criar a primeira escala.
  -- O lock por código evita duas primeiras escritas criarem linhas duplicadas.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_port, 0));
  SELECT p.id INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
    AND upper(btrim(p.locode)) LIKE 'BR%'
  ORDER BY p.id
  LIMIT 1;
  IF v_port_id IS NULL THEN
    INSERT INTO public.ports (name, locode, country)
    VALUES (v_port, v_port, 'Brasil')
    RETURNING id INTO v_port_id;
  END IF;

  SELECT rs.revision
  INTO v_current_revision
  FROM public.voyage_escala_revision_state AS rs
  WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port
  FOR UPDATE;
  IF NOT FOUND THEN
    v_current_revision := 0;
  END IF;
  IF p_expected_revision <> v_current_revision THEN
    RAISE EXCEPTION 'REVISAO_OBSOLETA: esperada %, atual %.', p_expected_revision, v_current_revision
      USING ERRCODE = 'P0001';
  END IF;
  v_next_revision := v_current_revision + 1;

  -- 477 (02-viagens-adr:2): todos os setores gravam terminal, ATB, ATD e
  -- Restow da escala, como diz a matriz de permissões (ADR 0085).

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    GROUP BY lower(btrim(sentido)), lower(btrim(modalidade))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Frente duplicada na escala.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
    GROUP BY terminal_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Terminal duplicado no estado da escala.' USING ERRCODE = '23505';
  END IF;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    IF NOT (
      (v_front.sentido = 'importacao' AND v_front.modalidade IN ('carga_cheia', 'carga_solta', 'vazio', 'veiculo'))
      OR (v_front.sentido = 'exportacao' AND v_front.modalidade IN ('granito', 'vazio'))
    ) THEN
      RAISE EXCEPTION 'Frente %/% invalida.', v_front.sentido, v_front.modalidade USING ERRCODE = '23514';
    END IF;
    IF (v_front.sentido = 'importacao' AND v_front.source <> 'operational_data')
       OR (v_front.sentido = 'exportacao' AND v_front.source <> 'export_declaration') THEN
      RAISE EXCEPTION 'Fonte invalida para a frente %/%.', v_front.sentido, v_front.modalidade USING ERRCODE = '23514';
    END IF;

    IF v_front.terminal_id IS NOT NULL THEN
      SELECT d.id, d.code, d.name, d.active, d.tipo, d.port_id
      INTO v_depot
      FROM public.depots AS d
      WHERE d.id = v_front.terminal_id AND d.port_id = v_port_id
        AND d.tipo = 'terminal_portuario';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Terminal não pertence ao porto % ou não é terminal portuário.', v_port
          USING ERRCODE = '23514';
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.voyage_escala_terminal_state AS s
        WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_front.terminal_id
      ) INTO v_existing_terminal_state;
      SELECT EXISTS (
        SELECT 1 FROM public.voyage_escala_operation_fronts AS old_f
        WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
          AND old_f.sentido = v_front.sentido
          AND old_f.modalidade = v_front.modalidade
          AND old_f.terminal_id = v_front.terminal_id
      ) INTO v_current_terminal_assignment;
      -- Histórico pode continuar apontando para terminal inativo; uma nova
      -- atribuição só aceita cadastro ativo.
      IF NOT v_current_terminal_assignment AND NOT v_depot.active THEN
        RAISE EXCEPTION 'Terminal inativo % não pode receber nova atribuição.', v_depot.code
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_fronts) AS f(
      sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT
    )
    WHERE f.terminal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_terminals) AS t(
          terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
        )
        WHERE t.terminal_id = f.terminal_id
      )
  ) THEN
    RAISE EXCEPTION 'Frente atribuida exige terminal no estado da escala.'
      USING ERRCODE = '23514';
  END IF;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID,
      terminal_atb TIMESTAMPTZ,
      terminal_atd TIMESTAMPTZ,
      terminal_rtw INTEGER
    )
  LOOP
    SELECT d.id, d.code, d.name, d.active, d.tipo, d.port_id
    INTO v_depot
    FROM public.depots AS d
    WHERE d.id = v_terminal.terminal_id AND d.port_id = v_port_id
      AND d.tipo = 'terminal_portuario';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Terminal de estado nao pertence ao porto %.', v_port USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.voyage_escala_terminal_state AS s
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id
    ) INTO v_existing_terminal_state;
    IF NOT v_existing_terminal_state AND NOT v_depot.active THEN
      RAISE EXCEPTION 'Terminal inativo % não pode receber novo estado.', v_depot.code
        USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE f.terminal_id = v_terminal.terminal_id
    ) AND NOT v_existing_terminal_state THEN
      RAISE EXCEPTION 'Estado informado para terminal sem frente atribuida.' USING ERRCODE = '23514';
    END IF;
    IF v_terminal.terminal_atd IS NOT NULL
       AND (v_terminal.terminal_atb IS NULL OR v_terminal.terminal_atd < v_terminal.terminal_atb) THEN
      RAISE EXCEPTION 'terminal_atd < terminal_atb para o terminal %.', v_depot.code
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF COALESCE(p_export_expectation->>'existing_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    v_export_existing_id := (p_export_expectation->>'existing_id')::UUID;
  END IF;
  SELECT COALESCE(ves.tem_exportacao, FALSE), COALESCE(ves.has_granite, FALSE), COALESCE(ves.has_empty, FALSE),
         ves.containers_qty, ves.movements_qty, COALESCE(ves.discharge_ports, '{}'::TEXT[]),
         ves.ce_status, COALESCE(ves.linked, FALSE)
  INTO v_old_export_declared, v_old_export_granite, v_old_export_empty,
       v_old_export_containers_qty, v_old_export_movements_qty, v_old_export_discharge_ports,
       v_old_export_ce_status, v_old_export_linked
  FROM public.voyage_export_schedules AS ves
  WHERE ves.id = v_export_existing_id AND ves.voyage_id = p_voyage_id
  FOR UPDATE;
  v_export_existing_id_found := FOUND;
  IF NOT v_export_existing_id_found THEN
    SELECT COALESCE(ves.tem_exportacao, FALSE), COALESCE(ves.has_granite, FALSE), COALESCE(ves.has_empty, FALSE),
           ves.containers_qty, ves.movements_qty, COALESCE(ves.discharge_ports, '{}'::TEXT[]),
           ves.ce_status, COALESCE(ves.linked, FALSE)
    INTO v_old_export_declared, v_old_export_granite, v_old_export_empty,
         v_old_export_containers_qty, v_old_export_movements_qty, v_old_export_discharge_ports,
         v_old_export_ce_status, v_old_export_linked
    FROM public.voyage_export_schedules AS ves
    WHERE ves.voyage_id = p_voyage_id AND ves.pol = v_port
    FOR UPDATE;
  END IF;
  v_old_export_exists := FOUND;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'granito' THEN
    v_export_granite := COALESCE((p_export_expectation->>'granito')::BOOLEAN, FALSE);
  ELSE
    v_export_granite := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'granito'
    );
  END IF;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'has_empty' THEN
    v_export_empty := COALESCE((p_export_expectation->>'has_empty')::BOOLEAN, FALSE);
  ELSIF COALESCE(p_export_expectation, '{}'::JSONB) ? 'vazios' THEN
    v_export_empty := COALESCE((p_export_expectation->>'vazios')::BOOLEAN, FALSE);
  ELSE
    v_export_empty := EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
      WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'vazio'
    );
  END IF;
  IF (COALESCE(p_export_expectation, '{}'::JSONB) ? 'has_empty')
     AND (COALESCE(p_export_expectation, '{}'::JSONB) ? 'vazios')
     AND COALESCE((p_export_expectation->>'has_empty')::BOOLEAN, FALSE)
         IS DISTINCT FROM COALESCE((p_export_expectation->>'vazios')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Expectativas de vazios divergentes.' USING ERRCODE = '23514';
  END IF;
  IF COALESCE(p_export_expectation, '{}'::JSONB) ? 'tem_exportacao' THEN
    v_export_declared := COALESCE((p_export_expectation->>'tem_exportacao')::BOOLEAN, FALSE);
    IF NOT v_export_declared AND (v_export_granite OR v_export_empty) THEN
      RAISE EXCEPTION 'Expectativa de exportacao desligada com frente declarada.' USING ERRCODE = '23514';
    END IF;
    IF v_export_declared AND NOT (v_export_granite OR v_export_empty)
       AND NOT (v_old_export_exists AND v_old_export_declared
                AND NOT v_old_export_granite AND NOT v_old_export_empty) THEN
      RAISE EXCEPTION 'Nova expectativa de exportação exige granito ou vazios.' USING ERRCODE = '23514';
    END IF;
  ELSE
    v_export_declared := v_export_granite OR v_export_empty;
  END IF;

  v_export_containers_qty := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'containers_qty'
      THEN (p_export_expectation->>'containers_qty')::INTEGER
    ELSE v_old_export_containers_qty
  END;
  v_export_movements_qty := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'movements_qty'
      THEN (p_export_expectation->>'movements_qty')::INTEGER
    ELSE v_old_export_movements_qty
  END;
  v_export_discharge_ports := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'discharge_ports'
      THEN COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(p_export_expectation->'discharge_ports')),
        '{}'::TEXT[]
      )
    ELSE v_old_export_discharge_ports
  END;
  v_export_ce_status := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'ce_status'
      THEN p_export_expectation->>'ce_status'
    ELSE v_old_export_ce_status
  END;
  v_export_linked := CASE
    WHEN COALESCE(p_export_expectation, '{}'::JSONB) ? 'linked'
      THEN COALESCE((p_export_expectation->>'linked')::BOOLEAN, FALSE)
    ELSE v_old_export_linked
  END;
  IF v_export_granite AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'granito'
  ) THEN
    RAISE EXCEPTION 'Expectativa de granito exige a frente exportacao/granito.' USING ERRCODE = '23514';
  END IF;
  IF v_export_empty AND NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = 'exportacao' AND lower(btrim(f.modalidade)) = 'vazio'
  ) THEN
    RAISE EXCEPTION 'Expectativa de vazios exige a frente exportacao/vazio.' USING ERRCODE = '23514';
  END IF;

  v_export_old := jsonb_build_object(
    'tem_exportacao', v_old_export_declared,
    'granito', v_old_export_granite,
    'vazios', v_old_export_empty,
    'has_empty', v_old_export_empty,
    'containers_qty', v_old_export_containers_qty,
    'movements_qty', v_old_export_movements_qty,
    'discharge_ports', v_old_export_discharge_ports,
    'ce_status', v_old_export_ce_status,
    'linked', v_old_export_linked
  );
  v_export_new := jsonb_build_object(
    'tem_exportacao', v_export_declared,
    'granito', v_export_granite,
    'vazios', v_export_empty,
    'has_empty', v_export_empty,
    'containers_qty', v_export_containers_qty,
    'movements_qty', v_export_movements_qty,
    'discharge_ports', v_export_discharge_ports,
    'ce_status', v_export_ce_status,
    'linked', v_export_linked
  );
  IF (v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked') THEN
    v_requires_justification := v_requires_justification
      OR (v_current_revision > 0 AND v_old_export_declared);
  END IF;

  -- Primeiro compara tudo. Nenhuma escrita, nem de uma frente, acontece
  -- antes de terminar a checagem de ADR fechado.
  FOR v_old_front IN
    SELECT old_f.sentido, old_f.modalidade, old_f.terminal_id, old_f.source
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
  LOOP
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    INTO v_new_front
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
    WHERE lower(btrim(f.sentido)) = v_old_front.sentido
      AND lower(btrim(f.modalidade)) = v_old_front.modalidade;
    v_existing_front := FOUND;
    IF NOT v_existing_front THEN
      v_front_changed := TRUE;
    ELSE
      v_front_changed := v_old_front.terminal_id IS DISTINCT FROM v_new_front.terminal_id
        OR v_old_front.source IS DISTINCT FROM v_new_front.source;
    END IF;
    IF v_front_changed THEN
      v_requires_justification := v_requires_justification
        OR (v_current_revision > 0 AND v_old_front.terminal_id IS NOT NULL);
      IF v_old_front.terminal_id IS NOT NULL THEN
        SELECT d.code, r.id
        INTO v_terminal_code, v_blocked_report_id
        FROM public.agency_departure_reports AS r
        JOIN public.depots AS d ON d.id = r.terminal_id
        WHERE r.voyage_id = p_voyage_id AND r.port = v_port
          AND r.terminal_id = v_old_front.terminal_id AND r.status = 'closed'
        LIMIT 1;
        IF FOUND THEN
          v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
            'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
            'reason', 'front_change'
          ));
        END IF;
      END IF;
    END IF;
  END LOOP;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    SELECT old_f.terminal_id, old_f.source
    INTO v_old_front
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND old_f.sentido = v_front.sentido AND old_f.modalidade = v_front.modalidade;
    v_existing_front := FOUND;
    IF NOT v_existing_front THEN
      v_front_changed := TRUE;
    ELSE
      v_front_changed := v_old_front.terminal_id IS DISTINCT FROM v_front.terminal_id
        OR v_old_front.source IS DISTINCT FROM v_front.source;
    END IF;
    IF v_front_changed AND v_front.terminal_id IS NOT NULL THEN
      SELECT d.code, r.id
      INTO v_terminal_code, v_blocked_report_id
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port
        AND r.terminal_id = v_front.terminal_id AND r.status = 'closed'
      LIMIT 1;
      IF FOUND THEN
        v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
          'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
          'reason', 'front_change'
        ));
      END IF;
    END IF;
  END LOOP;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
    )
  LOOP
    SELECT s.terminal_atb, s.terminal_atd, s.terminal_rtw
    INTO v_old_terminal
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id;
    v_existing_terminal_state := FOUND;
    IF NOT v_existing_terminal_state THEN
      v_state_changed := TRUE;
    ELSE
      v_state_changed := v_old_terminal.terminal_atb IS DISTINCT FROM v_terminal.terminal_atb
        OR v_old_terminal.terminal_atd IS DISTINCT FROM v_terminal.terminal_atd
        OR v_old_terminal.terminal_rtw IS DISTINCT FROM v_terminal.terminal_rtw;
    END IF;
    IF v_state_changed THEN
      v_requires_justification := v_requires_justification OR (
        v_current_revision > 0 AND v_existing_terminal_state AND (
          v_old_terminal.terminal_atb IS NOT NULL
          OR v_old_terminal.terminal_atd IS NOT NULL
          OR v_old_terminal.terminal_rtw IS NOT NULL
        )
      );
      SELECT d.code, r.id
      INTO v_terminal_code, v_blocked_report_id
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port
        AND r.terminal_id = v_terminal.terminal_id AND r.status = 'closed'
      LIMIT 1;
      IF FOUND THEN
        v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
          'terminal_code', v_terminal_code, 'report_id', v_blocked_report_id,
          'reason', 'terminal_dates'
        ));
      END IF;
    END IF;
  END LOOP;

  IF v_export_old IS DISTINCT FROM v_export_new AND v_current_revision > 0 THEN
    v_requires_justification := v_requires_justification OR (
      v_old_export_declared
      AND (v_export_old - 'ce_status' - 'linked') IS DISTINCT FROM (v_export_new - 'ce_status' - 'linked')
    );
    FOR v_report IN
      SELECT DISTINCT r.id, r.terminal_id, d.code
      FROM public.agency_departure_reports AS r
      JOIN public.depots AS d ON d.id = r.terminal_id
      WHERE r.voyage_id = p_voyage_id AND r.port = v_port AND r.status = 'closed'
        AND r.terminal_id IN (
          SELECT f.terminal_id
          FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
          WHERE f.terminal_id IS NOT NULL
          UNION
          SELECT old_f.terminal_id
          FROM public.voyage_escala_operation_fronts AS old_f
          WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port AND old_f.terminal_id IS NOT NULL
        )
    LOOP
      v_closed_blockers := v_closed_blockers || jsonb_build_array(jsonb_build_object(
        'terminal_code', v_report.code, 'report_id', v_report.id,
        'reason', 'export_expectation'
      ));
    END LOOP;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      blocker
      ORDER BY blocker->>'terminal_code', blocker->>'reason', blocker->>'report_id'
    ),
    '[]'::JSONB
  )
  INTO v_closed_blockers
  FROM jsonb_array_elements(v_closed_blockers) AS blockers(blocker);

  IF jsonb_array_length(v_closed_blockers) > 0 THEN
    -- A tentativa bloqueada não escreve nada: a UI recebe o contrato estável
    -- e pode traduzir terminal_code/report_id sem parsear DETAIL.
    RETURN jsonb_build_object(
      'revision', v_current_revision,
      'fronts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sentido', f.sentido, 'modalidade', f.modalidade,
          'terminal_id', f.terminal_id, 'source', f.source,
          'last_changed_at', f.last_changed_at, 'last_changed_by', f.last_changed_by,
          'revision', f.revision
        ) ORDER BY f.sentido, f.modalidade)
        FROM public.voyage_escala_operation_fronts AS f
        WHERE f.voyage_id = p_voyage_id AND f.port = v_port
      ), '[]'::JSONB),
      'terminals', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'terminal_id', s.terminal_id, 'code', d.code, 'name', d.name,
          'active', d.active, 'port_id', s.port_id,
          'terminal_atb', s.terminal_atb, 'terminal_atd', s.terminal_atd,
          'terminal_rtw', s.terminal_rtw, 'revision', s.revision,
          'report_id', r.id
        ) ORDER BY s.terminal_atb NULLS LAST, d.code)
        FROM public.voyage_escala_terminal_state AS s
        JOIN public.depots AS d ON d.id = s.terminal_id
        LEFT JOIN public.agency_departure_reports AS r
          ON r.voyage_id = s.voyage_id AND r.port = s.port AND r.terminal_id = s.terminal_id
        WHERE s.voyage_id = p_voyage_id AND s.port = v_port
      ), '[]'::JSONB),
      'closed_blockers', v_closed_blockers,
      'blocked', TRUE
    );
  END IF;
  IF v_requires_justification AND NULLIF(btrim(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatória para alterar estado terminalizado existente.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.voyage_escala_revision_state (voyage_id, port, port_id, revision)
  VALUES (p_voyage_id, v_port, v_port_id, 0)
  ON CONFLICT (voyage_id, port) DO NOTHING;

  -- O conjunto recebido representa todos os terminais ainda atribuídos a
  -- frentes. Remover os ausentes evita que ATB/ATD órfãos continuem visíveis
  -- no Line-Up e que a FK contra depots impeça a limpeza do terminal.
  FOR v_old_terminal IN
    SELECT s.*
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port
      AND s.terminal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_terminals) AS t(terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER)
        WHERE t.terminal_id = s.terminal_id
      )
  LOOP
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department
    )
    VALUES (
      'voyage_pod_schedule', v_entity_id, 'terminal_state_removed',
      jsonb_build_object(
        'terminal_id', v_old_terminal.terminal_id,
        'terminal_atb', v_old_terminal.terminal_atb,
        'terminal_atd', v_old_terminal.terminal_atd,
        'terminal_rtw', v_old_terminal.terminal_rtw
      )::TEXT,
      NULL, auth.uid(), clock_timestamp(), p_justification, v_role, v_department
    );
    DELETE FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id = v_old_terminal.terminal_id;
  END LOOP;

  UPDATE public.voyage_escala_revision_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  UPDATE public.voyage_escala_terminal_state
  SET revision = v_next_revision, updated_at = now()
  WHERE voyage_id = p_voyage_id AND port = v_port;

  FOR v_terminal IN
    SELECT t.terminal_id, t.terminal_atb, t.terminal_atd, t.terminal_rtw
    FROM jsonb_to_recordset(p_terminals) AS t(
      terminal_id UUID, terminal_atb TIMESTAMPTZ, terminal_atd TIMESTAMPTZ, terminal_rtw INTEGER
    )
  LOOP
    SELECT s.terminal_atb, s.terminal_atd, s.terminal_rtw
    INTO v_old_terminal
    FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id = v_terminal.terminal_id;
    v_existing_terminal_state := FOUND;
    INSERT INTO public.voyage_escala_terminal_state (
      voyage_id, port, port_id, terminal_id, terminal_atb, terminal_atd, terminal_rtw, revision
    )
    VALUES (
      p_voyage_id, v_port, v_port_id, v_terminal.terminal_id,
      v_terminal.terminal_atb, v_terminal.terminal_atd, v_terminal.terminal_rtw, v_next_revision
    )
    ON CONFLICT (voyage_id, port, terminal_id) DO UPDATE SET
      port_id = EXCLUDED.port_id,
      terminal_atb = EXCLUDED.terminal_atb,
      terminal_atd = EXCLUDED.terminal_atd,
      terminal_rtw = EXCLUDED.terminal_rtw,
      revision = EXCLUDED.revision,
      updated_at = now();

    IF NOT v_existing_terminal_state THEN
      v_state_changed := TRUE;
    ELSE
      v_state_changed := v_old_terminal.terminal_atb IS DISTINCT FROM v_terminal.terminal_atb
        OR v_old_terminal.terminal_atd IS DISTINCT FROM v_terminal.terminal_atd
        OR v_old_terminal.terminal_rtw IS DISTINCT FROM v_terminal.terminal_rtw;
    END IF;

    IF v_state_changed AND (
      v_terminal.terminal_atb IS NOT NULL OR v_terminal.terminal_atd IS NOT NULL
      OR v_terminal.terminal_rtw IS NOT NULL
      OR v_old_terminal.terminal_atb IS NOT NULL OR v_old_terminal.terminal_atd IS NOT NULL
      OR v_old_terminal.terminal_rtw IS NOT NULL
    ) THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'terminal_dates',
        CASE WHEN v_existing_terminal_state THEN jsonb_build_object(
          'terminal_id', v_terminal.terminal_id,
          'terminal_atb', v_old_terminal.terminal_atb,
          'terminal_atd', v_old_terminal.terminal_atd,
          'terminal_rtw', v_old_terminal.terminal_rtw
        )::TEXT ELSE NULL END,
        jsonb_build_object(
          'terminal_id', v_terminal.terminal_id,
          'terminal_atb', v_terminal.terminal_atb,
          'terminal_atd', v_terminal.terminal_atd,
          'terminal_rtw', v_terminal.terminal_rtw
        )::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
  END LOOP;

  FOR v_old_front IN
    SELECT old_f.*
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
        WHERE lower(btrim(f.sentido)) = old_f.sentido
          AND lower(btrim(f.modalidade)) = old_f.modalidade
      )
  LOOP
    INSERT INTO public.audit_logs (
      entity_type, entity_id, field_name, old_value, new_value,
      changed_by, changed_at, justification, actor_role, actor_department
    )
    VALUES (
      'voyage_pod_schedule', v_entity_id, 'front_removed', to_jsonb(v_old_front)::TEXT, NULL,
      auth.uid(), clock_timestamp(), p_justification, v_role, v_department
    );
    DELETE FROM public.voyage_escala_operation_fronts WHERE id = v_old_front.id;
  END LOOP;

  FOR v_front IN
    SELECT lower(btrim(f.sentido)) AS sentido,
           lower(btrim(f.modalidade)) AS modalidade,
           f.terminal_id,
           f.source
    FROM jsonb_to_recordset(p_fronts) AS f(sentido TEXT, modalidade TEXT, terminal_id UUID, source TEXT)
  LOOP
    SELECT old_f.*
    INTO v_old_front
    FROM public.voyage_escala_operation_fronts AS old_f
    WHERE old_f.voyage_id = p_voyage_id AND old_f.port = v_port
      AND old_f.sentido = v_front.sentido AND old_f.modalidade = v_front.modalidade;
    v_existing_front := FOUND;

    INSERT INTO public.voyage_escala_operation_fronts (
      voyage_id, port, port_id, sentido, modalidade, terminal_id, source,
      revision, last_changed_at, last_changed_by
    )
    VALUES (
      p_voyage_id, v_port, v_port_id, v_front.sentido, v_front.modalidade,
      v_front.terminal_id, v_front.source, v_next_revision, clock_timestamp(), auth.uid()
    )
    ON CONFLICT (voyage_id, port, sentido, modalidade) DO UPDATE SET
      port_id = EXCLUDED.port_id,
      terminal_id = EXCLUDED.terminal_id,
      source = EXCLUDED.source,
      revision = EXCLUDED.revision,
      last_changed_at = EXCLUDED.last_changed_at,
      last_changed_by = EXCLUDED.last_changed_by,
      updated_at = now();

    IF NOT v_existing_front THEN
      IF v_front.terminal_id IS NOT NULL THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'front_created', NULL,
        jsonb_build_object('sentido', v_front.sentido, 'modalidade', v_front.modalidade,
                           'terminal_id', v_front.terminal_id, 'source', v_front.source,
                           'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_front.terminal_id))::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
      END IF;
    ELSE
      IF v_old_front.terminal_id IS DISTINCT FROM v_front.terminal_id THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'terminal_assignment',
          jsonb_build_object(
            'terminal_id', v_old_front.terminal_id,
            'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_old_front.terminal_id)
          )::TEXT,
          jsonb_build_object(
            'terminal_id', v_front.terminal_id,
            'terminal_code', (SELECT d.code FROM public.depots AS d WHERE d.id = v_front.terminal_id)
          )::TEXT,
          auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
      END IF;
      IF v_old_front.source IS DISTINCT FROM v_front.source THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'front_source',
          v_old_front.source, v_front.source,
          auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
      END IF;
    END IF;
  END LOOP;

  IF p_export_expectation IS NOT NULL OR v_old_export_exists OR v_export_declared THEN
    IF (p_export_expectation IS NOT NULL OR v_export_declared)
       AND (NOT v_old_export_exists OR v_export_old IS DISTINCT FROM v_export_new) THEN
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'export_expectation',
        CASE WHEN v_old_export_exists THEN v_export_old::TEXT ELSE NULL END,
        v_export_new::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
    IF v_export_existing_id_found THEN
      SELECT ves.id
      INTO v_export_canonical_id
      FROM public.voyage_export_schedules AS ves
      WHERE ves.voyage_id = p_voyage_id
        AND ves.pol = v_port
        AND ves.id <> v_export_existing_id
      FOR UPDATE;
      IF FOUND THEN
        UPDATE public.voyage_export_schedules
        SET tem_exportacao = v_export_declared,
            has_granite = v_export_granite,
            has_empty = v_export_empty,
            containers_qty = v_export_containers_qty,
            movements_qty = v_export_movements_qty,
            discharge_ports = v_export_discharge_ports,
            ce_status = v_export_ce_status,
            linked = v_export_linked,
            updated_at = now()
        WHERE id = v_export_canonical_id AND voyage_id = p_voyage_id;
        DELETE FROM public.voyage_export_schedules
        WHERE id = v_export_existing_id AND voyage_id = p_voyage_id;
      ELSE
        UPDATE public.voyage_export_schedules
        SET pol = v_port,
            tem_exportacao = v_export_declared,
            has_granite = v_export_granite,
            has_empty = v_export_empty,
            containers_qty = v_export_containers_qty,
            movements_qty = v_export_movements_qty,
            discharge_ports = v_export_discharge_ports,
            ce_status = v_export_ce_status,
            linked = v_export_linked,
            updated_at = now()
        WHERE id = v_export_existing_id AND voyage_id = p_voyage_id;
      END IF;
    ELSE
      INSERT INTO public.voyage_export_schedules (
        voyage_id, pol, tem_exportacao, has_granite, has_empty,
        containers_qty, movements_qty, discharge_ports, ce_status, linked, updated_at
      )
      VALUES (
        p_voyage_id, v_port, v_export_declared, v_export_granite, v_export_empty,
        v_export_containers_qty, v_export_movements_qty, v_export_discharge_ports,
        v_export_ce_status, v_export_linked, now()
      )
      ON CONFLICT (voyage_id, pol) DO UPDATE SET
        tem_exportacao = EXCLUDED.tem_exportacao,
        has_granite = EXCLUDED.has_granite,
        has_empty = EXCLUDED.has_empty,
        containers_qty = EXCLUDED.containers_qty,
        movements_qty = EXCLUDED.movements_qty,
        discharge_ports = EXCLUDED.discharge_ports,
        ce_status = EXCLUDED.ce_status,
        linked = EXCLUDED.linked,
        updated_at = now();
    END IF;
  END IF;

  -- O editor terminalizado envia também o snapshot dos campos do POD. Como
  -- esta função já segura o lock da escala, os audit rows são gravados na
  -- mesma transação das frentes, evitando o estado parcial antigo (frentes
  -- salvas, datas do POD falhando em uma segunda chamada).
  v_schedule := p_export_expectation->'schedule';
  IF v_schedule IS NOT NULL THEN
    v_schedule_entity_id := p_voyage_id::TEXT || '::' || v_port;
    FOREACH v_schedule_field IN ARRAY ARRAY[
      'eta', 'etb', 'ata', 'atb', 'etd', 'atd', 'rtw', 'ces',
      'linked', 'escala_number', 'tem_importacao', 'deleted'
    ] LOOP
      IF v_schedule ? v_schedule_field THEN
        SELECT al.new_value
        INTO v_schedule_old_value
        FROM public.audit_logs AS al
        WHERE al.entity_type = 'voyage_pod_schedule'
          AND al.entity_id = v_schedule_entity_id
          AND al.field_name = v_schedule_field
        ORDER BY al.changed_at DESC, al.id DESC
        LIMIT 1;
        v_schedule_new_value := CASE
          WHEN v_schedule->v_schedule_field IS NULL OR v_schedule->v_schedule_field = 'null'::JSONB THEN NULL
          ELSE v_schedule->>v_schedule_field
        END;
        -- O editor sempre envia deleted=false para retirar um soft-delete,
        -- mas isso não deve gerar uma linha de auditoria em cada salvamento.
        IF v_schedule_field = 'deleted'
           AND v_schedule_new_value = 'false'
           AND v_schedule_old_value IS DISTINCT FROM 'true' THEN
          CONTINUE;
        END IF;
        IF v_schedule_field = 'ces'
           AND v_schedule_old_value IS NULL
           AND v_schedule_new_value IN ('waiting', 'missing') THEN
          CONTINUE;
        END IF;
        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN
          INSERT INTO public.audit_logs (
            entity_type, entity_id, field_name, old_value, new_value,
            changed_by, changed_at, justification, actor_role, actor_department
          )
          VALUES (
            'voyage_pod_schedule', v_schedule_entity_id, v_schedule_field,
            v_schedule_old_value, v_schedule_new_value,
            auth.uid(), clock_timestamp(), p_justification, v_role, v_department
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- O caminho terminalizado já gravou o ATD na mesma transação. Recalcula o
  -- status da viagem aqui para manter o contrato do save legado sem uma
  -- segunda chamada sujeita a observar um snapshot parcial.
  IF v_schedule ? 'atd' THEN
    WITH pod_entities AS (
      SELECT DISTINCT al.entity_id
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
    ), latest_atd AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, NULLIF(btrim(al.new_value), '') AS atd
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'atd'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), latest_omitted AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, al.new_value
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'omitted'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), latest_deleted AS (
      SELECT DISTINCT ON (al.entity_id) al.entity_id, al.new_value
      FROM public.audit_logs AS al
      WHERE al.entity_type = 'voyage_pod_schedule'
        AND al.field_name = 'deleted'
        AND split_part(al.entity_id, '::', 1)::BIGINT = p_voyage_id
      ORDER BY al.entity_id, al.changed_at DESC, al.id DESC
    ), active AS (
      SELECT e.entity_id, a.atd
      FROM pod_entities AS e
      LEFT JOIN latest_atd AS a ON a.entity_id = e.entity_id
      LEFT JOIN latest_omitted AS o ON o.entity_id = e.entity_id
      LEFT JOIN latest_deleted AS d ON d.entity_id = e.entity_id
      WHERE COALESCE(o.new_value, 'false') <> 'true'
        AND COALESCE(d.new_value, 'false') <> 'true'
    )
    SELECT COUNT(*)::INTEGER, COUNT(*) FILTER (WHERE NULLIF(btrim(atd), '') IS NULL)::INTEGER
    INTO v_active_pods, v_pending_pods
    FROM active;

    IF v_active_pods > 0 THEN
      v_new_voyage_status := CASE WHEN v_pending_pods = 0 THEN 'completed' ELSE 'active' END;
      UPDATE public.voyages
      SET status = v_new_voyage_status
      WHERE id = p_voyage_id
        AND status <> 'cancelled'
        AND status IS DISTINCT FROM v_new_voyage_status;
    END IF;
  END IF;

  -- A primeira frente cria/reutiliza o ADR do terminal. Um ADR aberto sem
  -- frentes é o único que pode ser removido; ADR fechado fica preservado.
  FOR v_depot IN
    SELECT DISTINCT f.terminal_id, d.code, d.name, d.port_id
    FROM public.voyage_escala_operation_fronts AS f
    JOIN public.depots AS d ON d.id = f.terminal_id
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NOT NULL
  LOOP
    SELECT r.id, r.status INTO v_report_id, v_report_status
    FROM public.agency_departure_reports AS r
    WHERE r.voyage_id = p_voyage_id AND r.port = v_port AND r.terminal_id = v_depot.terminal_id
    FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.agency_departure_reports (
        voyage_id, port, terminal, terminal_id, terminal_port_id
      )
      VALUES (p_voyage_id, v_port, v_depot.code, v_depot.terminal_id, v_depot.port_id)
      ON CONFLICT (voyage_id, port, terminal_id) WHERE terminal_id IS NOT NULL
      DO UPDATE SET terminal = EXCLUDED.terminal
      RETURNING id INTO v_report_id;
      INSERT INTO public.audit_logs (
        entity_type, entity_id, field_name, old_value, new_value,
        changed_by, changed_at, justification, actor_role, actor_department
      )
      VALUES (
        'voyage_pod_schedule', v_entity_id, 'adr_created', NULL,
        jsonb_build_object('terminal_code', v_depot.code, 'report_id', v_report_id)::TEXT,
        auth.uid(), clock_timestamp(), p_justification, v_role, v_department
      );
    END IF;
  END LOOP;

  FOR v_report IN
    SELECT r.id, r.terminal_id, r.status, d.code
    FROM public.agency_departure_reports AS r
    JOIN public.depots AS d ON d.id = r.terminal_id
    WHERE r.voyage_id = p_voyage_id AND r.port = v_port
      AND r.terminal_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.voyage_escala_operation_fronts AS f
        WHERE f.voyage_id = p_voyage_id AND f.port = v_port
          AND f.terminal_id = r.terminal_id
      )
    FOR UPDATE OF r
  LOOP
    IF v_report.status = 'open' THEN
      -- Um ADR aberto só pode ser removido quando não há filhos, histórico ou
      -- alertas associados. Qualquer alerta do ADR, em qualquer status, preserva
      -- o registro para não perder o histórico operacional.
      IF NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_signoffs
        WHERE report_id = v_report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_department_signoffs
        WHERE report_id = v_report.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.agency_departure_report_occurrences
        WHERE report_id = v_report.id
      )
       AND NOT EXISTS (
         SELECT 1
         FROM public.audit_logs AS al
         -- Eventos do ciclo do ADR usam o próprio report_id como entity_id.
         -- O índice idx_audit_logs_entity_id torna esta guarda pontual; não
         -- faça ILIKE sobre old_value/new_value dentro do lock da escala.
         WHERE al.entity_id = v_report.id::TEXT
       )
      AND NOT EXISTS (
        SELECT 1
        FROM public.alerts AS a
        WHERE a.entity_type = 'agency_departure_report'
          AND a.entity_id LIKE public.agency_report_alert_entity_prefix(p_voyage_id, v_port, v_report.code) || '%'
      ) THEN
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'adr_removed',
          jsonb_build_object('terminal_code', v_report.code, 'report_id', v_report.id)::TEXT,
          NULL, auth.uid(), clock_timestamp(), p_justification, v_role, v_department
        );
        DELETE FROM public.agency_departure_reports
        WHERE id = v_report.id AND status = 'open';
      ELSE
        INSERT INTO public.audit_logs (
          entity_type, entity_id, field_name, old_value, new_value,
          changed_by, changed_at, justification, actor_role, actor_department
        )
        VALUES (
          'voyage_pod_schedule', v_entity_id, 'adr_preserved',
          jsonb_build_object('terminal_code', v_report.code, 'report_id', v_report.id)::TEXT,
          'dependentes ou historico preservados', auth.uid(), clock_timestamp(),
          p_justification, v_role, v_department
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'revision', v_next_revision,
    'fronts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sentido', f.sentido, 'modalidade', f.modalidade,
        'terminal_id', f.terminal_id, 'source', f.source,
        'last_changed_at', f.last_changed_at, 'last_changed_by', f.last_changed_by,
        'revision', f.revision
      ) ORDER BY f.sentido, f.modalidade)
      FROM public.voyage_escala_operation_fronts AS f
      WHERE f.voyage_id = p_voyage_id AND f.port = v_port
    ), '[]'::JSONB),
    'terminals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'terminal_id', s.terminal_id, 'code', d.code, 'name', d.name,
        'active', d.active, 'port_id', s.port_id,
        'terminal_atb', s.terminal_atb, 'terminal_atd', s.terminal_atd,
        'terminal_rtw', s.terminal_rtw, 'revision', s.revision,
        'report_id', r.id
      ) ORDER BY s.terminal_atb NULLS LAST, d.code)
      FROM public.voyage_escala_terminal_state AS s
      JOIN public.depots AS d ON d.id = s.terminal_id
      LEFT JOIN public.agency_departure_reports AS r
        ON r.voyage_id = s.voyage_id AND r.port = s.port AND r.terminal_id = s.terminal_id
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port
    ), '[]'::JSONB),
    'closed_blockers', '[]'::JSONB,
    'blocked', FALSE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state_v2(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result JSONB;
  v_schedule JSONB;
  v_schedule_entity_id TEXT;
  v_schedule_field TEXT;
  v_schedule_old_value TEXT;
  v_schedule_new_value TEXT;
  v_role TEXT;
  v_department TEXT;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_ata TEXT;
BEGIN
  -- A guarda permanece na fronteira pública mesmo quando o corpo histórico
  -- for substituído. Não ler payload nem delegar antes da autorização.
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN (
       'admin', 'administrativo', 'operacoes', 'operator',
       'documentacao', 'equipamentos', 'financeiro'
     ) THEN
    RAISE EXCEPTION 'Usuário ativo sem permissão para editar a escala.'
      USING ERRCODE = '42501';
  END IF;

  IF p_export_expectation IS NULL
     OR jsonb_typeof(p_export_expectation) <> 'object'
     OR (p_export_expectation ? 'schedule'
         AND jsonb_typeof(p_export_expectation->'schedule') <> 'object') THEN
    RAISE EXCEPTION 'Payload de escala invalido.' USING ERRCODE = '22023';
  END IF;

  -- O setor gravado é o do autor (ADR 0046): Financeiro não assina como
  -- Operações, e o perfil legado operator é Documentação, como no resto do Vela.
  v_department := CASE
    WHEN v_role IN ('admin', 'administrativo') THEN 'administrativo'
    WHEN v_role IN ('documentacao', 'operator') THEN 'documentacao'
    WHEN v_role = 'equipamentos' THEN 'equipamentos'
    WHEN v_role = 'financeiro' THEN 'financeiro'
    ELSE 'operacoes'
  END;

  -- 477 (02-viagens-adr:13, decisão do dono): com o ATA da escala registrado,
  -- toda frente de operação precisa de terminal; TBC não é terminal.
  IF p_export_expectation->'schedule' ? 'ata' THEN
    v_ata := NULLIF(btrim(COALESCE(p_export_expectation->'schedule'->>'ata', '')), '');
  ELSE
    SELECT NULLIF(btrim(COALESCE(al.new_value, '')), '') INTO v_ata
    FROM public.audit_logs AS al
    WHERE al.entity_type = 'voyage_pod_schedule'
      AND al.entity_id = p_voyage_id::TEXT || '::' || v_port
      AND al.field_name = 'ata'
    ORDER BY al.changed_at DESC, al.id DESC
    LIMIT 1;
  END IF;
  IF v_ata IS NOT NULL AND jsonb_typeof(p_fronts) = 'array' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_fronts) AS f(item)
    WHERE NULLIF(btrim(COALESCE(f.item->>'terminal_id', '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Com o ATA registrado, toda frente de operação precisa de terminal: TBC não é terminal. Escolha o terminal de cada frente.'
      USING ERRCODE = '22023';
  END IF;

  -- O corpo anterior continua dono de revisão, lock, frentes, terminais,
  -- exportação, ADR e status. Como função e wrapper rodam na mesma transação,
  -- as auditorias abaixo ficam sob o mesmo lock da escala.
  v_result := public.save_voyage_escala_terminal_state_v2_legacy_049(
    p_voyage_id,
    p_port,
    p_expected_revision,
    p_fronts,
    p_terminals,
    p_export_expectation,
    p_justification
  );

  -- ADR fechado significa no-op completo. Não completar o payload físico
  -- depois que o corpo anterior devolveu um bloqueio.
  IF COALESCE((v_result->>'blocked')::BOOLEAN, FALSE) THEN
    RETURN v_result;
  END IF;

  -- 477 (02-viagens-adr:13): a Atracação TBC só existe enquanto alguma frente
  -- está em TBC; sem nenhuma, ela sai e não segura a conclusão da escala.
  IF NOT EXISTS (
    SELECT 1 FROM public.voyage_escala_operation_fronts AS f
    WHERE f.voyage_id = p_voyage_id AND f.port = v_port AND f.terminal_id IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.voyage_escala_terminal_state AS s
    WHERE s.voyage_id = p_voyage_id AND s.port = v_port AND s.terminal_id IS NULL
  ) THEN
    DELETE FROM public.voyage_escala_terminal_state
    WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id IS NULL;
    v_result := jsonb_set(v_result, '{terminals}', COALESCE((
      SELECT jsonb_agg(item) FROM jsonb_array_elements(COALESCE(v_result->'terminals', '[]'::jsonb)) AS t(item)
      WHERE NULLIF(t.item->>'terminal_id', '') IS NOT NULL
    ), '[]'::jsonb), true);
    PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);
  END IF;

  v_schedule := p_export_expectation->'schedule';
  IF v_schedule IS NOT NULL THEN
    v_schedule_entity_id := p_voyage_id::TEXT || '::' || upper(btrim(COALESCE(p_port, '')));

    FOREACH v_schedule_field IN ARRAY ARRAY[
      'eta', 'etb', 'ata', 'atb', 'etd', 'atd', 'rtw', 'ces',
      'linked', 'escala_number', 'tem_importacao', 'deleted'
    ] LOOP
      IF v_schedule ? v_schedule_field THEN
        SELECT al.new_value
        INTO v_schedule_old_value
        FROM public.audit_logs AS al
        WHERE al.entity_type = 'voyage_pod_schedule'
          AND al.entity_id = v_schedule_entity_id
          AND al.field_name = v_schedule_field
        ORDER BY al.changed_at DESC, al.id DESC
        LIMIT 1;

        v_schedule_new_value := CASE
          WHEN v_schedule->v_schedule_field IS NULL
               OR v_schedule->v_schedule_field = 'null'::JSONB THEN NULL
          ELSE v_schedule->>v_schedule_field
        END;

        -- O editor sempre envia deleted=false para retirar um soft-delete,
        -- mas isso não deve gerar auditoria a cada salvamento.
        IF v_schedule_field = 'deleted'
           AND v_schedule_new_value = 'false'
           AND v_schedule_old_value IS DISTINCT FROM 'true' THEN
          CONTINUE;
        END IF;
        -- Aguardando é o estado inicial do editor, não uma alteração humana.
        IF v_schedule_field = 'ces'
           AND v_schedule_old_value IS NULL
           AND v_schedule_new_value IN ('waiting', 'missing') THEN
          CONTINUE;
        END IF;

        -- A função histórica pode já ter gravado o snapshot. Comparar com o
        -- último valor torna o reparo idempotente e evita auditorias duplicadas.
        IF v_schedule_old_value IS DISTINCT FROM v_schedule_new_value THEN
          INSERT INTO public.audit_logs (
            entity_type,
            entity_id,
            field_name,
            old_value,
            new_value,
            changed_by,
            changed_at,
            justification,
            actor_role,
            actor_department
          )
          VALUES (
            'voyage_pod_schedule',
            v_schedule_entity_id,
            v_schedule_field,
            v_schedule_old_value,
            v_schedule_new_value,
            auth.uid(),
            clock_timestamp(),
            p_justification,
            v_role,
            v_department
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_voyage_escala_terminal_state_v2_legacy_049(p_voyage_id bigint, p_port text, p_expected_revision integer, p_fronts jsonb, p_terminals jsonb, p_export_expectation jsonb, p_justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_legacy JSONB;
  v_non_tbc JSONB;
  v_port TEXT := upper(btrim(COALESCE(p_port, '')));
  v_port_id BIGINT;
  v_revision INTEGER;
  v_role TEXT;
  v_terminal JSONB;
  v_terminal_id UUID;
BEGIN
  -- S01: mesma permissão do núcleo save_voyage_escala_terminal_state, na
  -- fronteira pública: antes de validar payload, criar porto ou delegar. A
  -- segurança passa a morar na autorização, não só no rollback.
  SELECT up.role INTO v_role
  FROM public.user_profiles AS up
  WHERE up.id = auth.uid() AND up.active = TRUE;

  IF auth.uid() IS NULL OR v_role IS NULL
     OR v_role NOT IN ('admin', 'administrativo', 'operacoes', 'operator', 'documentacao', 'equipamentos', 'financeiro') THEN
    RAISE EXCEPTION 'Usuário ativo sem permissão para editar a escala.'
      USING ERRCODE = '42501';
  END IF;

  IF p_terminals IS NULL OR jsonb_typeof(p_terminals) <> 'array' THEN
    RAISE EXCEPTION 'Payload de Atracacoes invalido.' USING ERRCODE = '22023';
  END IF;

  SELECT p.id INTO v_port_id
  FROM public.ports AS p
  WHERE upper(btrim(p.locode)) = v_port
  LIMIT 1;
  IF v_port_id IS NULL THEN
    INSERT INTO public.ports (name, locode, country)
    VALUES (v_port, v_port, 'Brasil')
    RETURNING id INTO v_port_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'terminal_id', item->>'terminal_id',
    'terminal_atb', item->>'terminal_atb',
    'terminal_atd', item->>'terminal_atd',
    'terminal_rtw', item->>'terminal_rtw'
  )), '[]'::JSONB)
  INTO v_non_tbc
  FROM jsonb_array_elements(p_terminals) AS entries(item)
  WHERE NULLIF(entries.item->>'terminal_id', '') IS NOT NULL;

  -- O RPC legado não pode interpretar NULL com igualdade simples: uma linha
  -- TBC não deve ser considerada removida nem bloquear uma edição que só
  -- altera a expectativa de exportação. O patch abaixo mantém essa regra no
  -- corpo legado, sem duplicar sua implementação nesta migration.
  v_legacy := public.save_voyage_escala_terminal_state(
    p_voyage_id,
    v_port,
    p_expected_revision,
    p_fronts,
    v_non_tbc,
    p_export_expectation,
    p_justification
  );

  IF COALESCE((v_legacy->>'blocked')::BOOLEAN, FALSE) THEN
    RETURN v_legacy;
  END IF;

  SELECT rs.revision INTO v_revision
  FROM public.voyage_escala_revision_state AS rs
  WHERE rs.voyage_id = p_voyage_id AND rs.port = v_port;

  FOR v_terminal IN SELECT value FROM jsonb_array_elements(p_terminals)
  LOOP
    v_terminal_id := NULLIF(v_terminal->>'terminal_id', '')::UUID;
    IF v_terminal_id IS NULL THEN
      INSERT INTO public.voyage_escala_terminal_state (
        voyage_id, port, port_id, terminal_id, terminal_etb, terminal_atb,
        terminal_etd, terminal_atd, terminal_rtw, revision
      ) VALUES (
        p_voyage_id, v_port, v_port_id, NULL,
        NULLIF(v_terminal->>'terminal_etb', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_atb', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_etd', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_atd', '')::TIMESTAMPTZ,
        NULLIF(v_terminal->>'terminal_rtw', '')::INTEGER,
        COALESCE(v_revision, 0)
      )
      ON CONFLICT (voyage_id, port) WHERE terminal_id IS NULL DO UPDATE SET
        terminal_etb = EXCLUDED.terminal_etb,
        terminal_atb = EXCLUDED.terminal_atb,
        terminal_etd = EXCLUDED.terminal_etd,
        terminal_atd = EXCLUDED.terminal_atd,
        terminal_rtw = EXCLUDED.terminal_rtw,
        revision = EXCLUDED.revision,
        updated_at = now();
    ELSE
      UPDATE public.voyage_escala_terminal_state
      SET terminal_etb = NULLIF(v_terminal->>'terminal_etb', '')::TIMESTAMPTZ,
          terminal_etd = NULLIF(v_terminal->>'terminal_etd', '')::TIMESTAMPTZ,
          revision = COALESCE(v_revision, revision),
          updated_at = now()
      WHERE voyage_id = p_voyage_id AND port = v_port AND terminal_id = v_terminal_id;
    END IF;
  END LOOP;

  -- O status da viagem deixa de depender do atd documental do POD. A função
  -- é criada na migration de alertas seguinte e existe antes de qualquer
  -- chamada operacional desta RPC.
  PERFORM public.refresh_voyage_status_from_terminal_scales(p_voyage_id);

  RETURN jsonb_set(
    v_legacy,
    '{terminals}',
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'terminal_id', s.terminal_id,
        'terminal_etb', s.terminal_etb,
        'terminal_atb', s.terminal_atb,
        'terminal_etd', s.terminal_etd,
        'terminal_atd', s.terminal_atd,
        'terminal_rtw', s.terminal_rtw
      ) ORDER BY s.terminal_atb NULLS LAST, s.terminal_etb NULLS LAST, s.terminal_id NULLS LAST)
      FROM public.voyage_escala_terminal_state AS s
      WHERE s.voyage_id = p_voyage_id AND s.port = v_port
    ), '[]'::JSONB),
    TRUE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_department_signoff(p_voyage_id bigint, p_port text, p_department text, p_signed boolean, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_report_id UUID;
  v_currently_signed BOOLEAN;
  v_justification TEXT := NULLIF(btrim(p_justification), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN
    RAISE EXCEPTION 'Departamento invalido: %.', p_department USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', p_department) THEN
    RAISE EXCEPTION 'Sign-off pertence ao departamento %.', p_department USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar o sign-off departamental.' USING ERRCODE = '42501';
  END IF;

  SELECT signed_at IS NOT NULL INTO v_currently_signed
  FROM public.agency_departure_report_department_signoffs
  WHERE report_id = v_report_id AND department = p_department
  FOR UPDATE;
  v_currently_signed := COALESCE(v_currently_signed, FALSE);

  -- Sem mudanca: idempotente, sem evento nem exigencia de justificativa.
  IF v_currently_signed = p_signed THEN
    RETURN jsonb_build_object('report_id', v_report_id, 'unchanged', TRUE);
  END IF;

  IF p_signed THEN
    -- Assinar exige todas as secoes do departamento resolvidas.
    IF EXISTS (
      SELECT 1 FROM (VALUES
        ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'),
        ('vazios_embarcados'), ('vazios_descarregados')
      ) AS all_sections(section)
      WHERE public.agency_report_section_owner(all_sections.section) = p_department
        AND COALESCE((
          SELECT so.state FROM public.agency_departure_report_signoffs so
          WHERE so.report_id = v_report_id AND so.section = all_sections.section
        ), 'pending') = 'pending'
    ) THEN
      RAISE EXCEPTION 'Departamento % tem seções pendentes: resolva-as antes de assinar.', p_department
        USING ERRCODE = '23514';
    END IF;
  ELSE
    -- Reabrir um sign-off ja dado exige justificativa.
    IF v_justification IS NULL THEN
      RAISE EXCEPTION 'Reabrir o sign-off departamental exige justificativa.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.agency_departure_report_department_signoffs
    (report_id, department, signed_by, signed_at)
  VALUES (v_report_id, p_department, auth.uid(), CASE WHEN p_signed THEN now() ELSE NULL END)
  ON CONFLICT (report_id, department) DO UPDATE SET
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  INSERT INTO public.audit_logs
    (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_department_signoff',
          p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_department,
          'signed', v_currently_signed::TEXT, p_signed::TEXT, auth.uid(), v_justification);

  IF p_signed THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_department_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_department
      AND status <> 'closed';
  END IF;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_department_signoff_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_department text, p_signed boolean, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_report RECORD;
  v_current BOOLEAN;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  IF p_department NOT IN ('operacoes', 'documentacao', 'equipamentos') THEN RAISE EXCEPTION 'Departamento invalido.' USING ERRCODE = '22023'; END IF;
  IF v_role NOT IN ('administrativo', p_department) THEN RAISE EXCEPTION 'Sign-off pertence ao departamento %.', p_department USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar o sign-off departamental.' USING ERRCODE = '42501'; END IF;
  SELECT signed_at IS NOT NULL INTO v_current FROM public.agency_departure_report_department_signoffs
  WHERE report_id = p_report_id AND department = p_department FOR UPDATE;
  v_current := COALESCE(v_current, FALSE);
  IF v_current = p_signed THEN RETURN jsonb_build_object('report_id', p_report_id, 'unchanged', TRUE); END IF;
  -- B5: assinar exige todas as seções do departamento resolvidas, como no
  -- caminho legado; antes a trava existia só na tela.
  IF p_signed AND EXISTS (
    SELECT 1 FROM (VALUES
      ('datas'), ('carga_descarregada'), ('carga_carregada'), ('veiculos'),
      ('vazios_embarcados'), ('vazios_descarregados')
    ) AS all_sections(section)
    WHERE public.agency_report_section_owner(all_sections.section) = p_department
      AND COALESCE((
        SELECT so.state FROM public.agency_departure_report_signoffs so
        WHERE so.report_id = p_report_id AND so.section = all_sections.section
      ), 'pending') = 'pending'
  ) THEN
    RAISE EXCEPTION 'Departamento % tem seções pendentes: resolva-as antes de assinar.', p_department
      USING ERRCODE = '23514';
  END IF;
  IF NOT p_signed AND v_current AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Reabrir o sign-off departamental exige justificativa.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agency_departure_report_department_signoffs (report_id, department, signed_by, signed_at)
  VALUES (p_report_id, p_department, auth.uid(), CASE WHEN p_signed THEN now() ELSE NULL END)
  ON CONFLICT (report_id, department) DO UPDATE SET signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_department_signoff', p_report_id::TEXT || '::' || p_department, 'signed', v_current::TEXT, p_signed::TEXT, auth.uid(), v_justification);
  IF p_signed THEN
    UPDATE public.alerts
    SET status = 'closed', closed_at = now()
    WHERE type = 'agency_report_department_pending'
      AND entity_type = 'agency_departure_report'
      AND entity_id = public.agency_report_alert_entity_id(
        v_report.voyage_id,
        v_report.port,
        (SELECT d.code FROM public.depots AS d WHERE d.id = v_report.terminal_id),
        p_department
      )
      AND status <> 'closed';
  END IF;
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_section_observation(p_voyage_id bigint, p_port text, p_section text, p_observation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report_id UUID;
  v_observation TEXT := NULLIF(btrim(COALESCE(p_observation, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Seção pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);
  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar a observação.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.agency_departure_report_signoffs (report_id, section, department, observation)
  VALUES (v_report_id, p_section, v_owner, v_observation)
  ON CONFLICT (report_id, section) DO UPDATE SET
    observation = EXCLUDED.observation;

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_section_observation_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_section text, p_observation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report RECORD;
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023'; END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN RAISE EXCEPTION 'Seção pertence ao departamento %.', v_owner USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar a observação.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.agency_departure_report_signoffs (report_id, section, department, observation)
  VALUES (p_report_id, p_section, v_owner, NULLIF(btrim(COALESCE(p_observation, '')), ''))
  ON CONFLICT (report_id, section) DO UPDATE SET observation = EXCLUDED.observation;
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_signoff(p_voyage_id bigint, p_port text, p_section text, p_state text, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_report_id UUID;
  v_current TEXT;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles
  WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo'
                        WHEN 'operator' THEN 'documentacao'
                        ELSE v_role END;

  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Secao invalida.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Seção pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('pending', 'confirmed', 'nothing_to_declare') THEN
    RAISE EXCEPTION 'Estado invalido.' USING ERRCODE = '22023';
  END IF;

  v_report_id := public.ensure_agency_departure_report(p_voyage_id, p_port);

  IF EXISTS (
    SELECT 1 FROM public.agency_departure_reports
    WHERE id = v_report_id AND status = 'closed'
  ) THEN
    RAISE EXCEPTION 'ADR fechado: reabra antes de alterar sign-offs.' USING ERRCODE = '42501';
  END IF;

  -- Estado atual da secao: decide se ha transicao e se exige justificativa.
  SELECT state INTO v_current
  FROM public.agency_departure_report_signoffs
  WHERE report_id = v_report_id AND section = p_section
  FOR UPDATE;
  v_current := COALESCE(v_current, 'pending');

  -- Sem mudanca: nao grava evento nem exige justificativa (idempotente).
  IF v_current = p_state THEN
    RETURN jsonb_build_object('report_id', v_report_id, 'unchanged', TRUE);
  END IF;

  -- Alterar uma decisao ja registrada exige justificativa; a primeira saida de
  -- "pending" nao (a UI faz a confirmacao explicita).
  IF v_current <> 'pending' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Alterar uma decisão já registrada exige justificativa.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (v_report_id, p_section, p_state, v_owner, auth.uid(),
          CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET
    state = EXCLUDED.state,
    department = EXCLUDED.department,
    signed_by = EXCLUDED.signed_by,
    signed_at = EXCLUDED.signed_at;

  -- Historico da transicao (de->para + justificativa quando aplicavel).
  INSERT INTO public.audit_logs
    (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_signoff',
          p_voyage_id || '::' || upper(btrim(p_port)) || '::' || p_section,
          'state', v_current, p_state, auth.uid(), v_justification);

  RETURN jsonb_build_object('report_id', v_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_signoff_by_report_id(p_report_id uuid, p_voyage_id bigint, p_port text, p_section text, p_state text, p_justification text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role TEXT;
  v_owner TEXT;
  v_current TEXT;
  v_report RECORD;
  v_justification TEXT := NULLIF(btrim(COALESCE(p_justification, '')), '');
BEGIN
  SELECT role INTO v_role FROM public.user_profiles WHERE id = auth.uid() AND active = TRUE;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501'; END IF;
  v_role := CASE v_role WHEN 'admin' THEN 'administrativo' WHEN 'operator' THEN 'documentacao' ELSE v_role END;
  v_owner := public.agency_report_section_owner(p_section);
  IF v_owner IS NULL OR p_state NOT IN ('pending', 'confirmed', 'nothing_to_declare') THEN
    RAISE EXCEPTION 'Secao ou estado invalido.' USING ERRCODE = '22023';
  END IF;
  IF v_role NOT IN ('administrativo', v_owner) THEN
    RAISE EXCEPTION 'Seção pertence ao departamento %.', v_owner USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_report FROM public.agency_departure_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR v_report.voyage_id <> p_voyage_id OR upper(btrim(v_report.port)) <> upper(btrim(p_port))
     OR v_report.terminal_id IS NULL THEN
    RAISE EXCEPTION 'report_id nao pertence a ADR terminalizado da escala %::%.', p_voyage_id, upper(btrim(p_port)) USING ERRCODE = '23514';
  END IF;
  IF v_report.status = 'closed' THEN RAISE EXCEPTION 'ADR fechado: reabra antes de alterar sign-offs.' USING ERRCODE = '42501'; END IF;

  SELECT state INTO v_current FROM public.agency_departure_report_signoffs
  WHERE report_id = p_report_id AND section = p_section FOR UPDATE;
  v_current := COALESCE(v_current, 'pending');
  IF v_current = p_state THEN RETURN jsonb_build_object('report_id', p_report_id, 'unchanged', TRUE); END IF;
  IF v_current <> 'pending' AND v_justification IS NULL THEN
    RAISE EXCEPTION 'Alterar uma decisão já registrada exige justificativa.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agency_departure_report_signoffs
    (report_id, section, state, department, signed_by, signed_at)
  VALUES (p_report_id, p_section, p_state, v_owner, auth.uid(), CASE WHEN p_state = 'pending' THEN NULL ELSE now() END)
  ON CONFLICT (report_id, section) DO UPDATE SET state = EXCLUDED.state, department = EXCLUDED.department,
    signed_by = EXCLUDED.signed_by, signed_at = EXCLUDED.signed_at;
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('agency_departure_report_signoff', p_report_id::TEXT || '::' || p_section, 'state', v_current, p_state, auth.uid(), v_justification);
  RETURN jsonb_build_object('report_id', p_report_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_agency_report_terminal(p_voyage_id bigint, p_port text, p_terminal text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text := public._portal_actor_role();
BEGIN
  IF v_role IS NULL OR v_role NOT IN ('administrativo', 'operacoes') THEN
    RAISE EXCEPTION 'Terminal pertence ao departamento operações.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._set_agency_report_terminal_impl_20260920(p_voyage_id, p_port, p_terminal);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_container_dates(p_container_id bigint, p_discharge_date date, p_return_date date, p_reason text DEFAULT NULL::text, p_keep_discharge boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old record;
  v_touched text[];
  v_request uuid := gen_random_uuid();
  v_role text := public.current_actor_role();
  v_discharge date := p_discharge_date;
BEGIN
  IF v_actor IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa.' USING ERRCODE = '42501';
  END IF;
  -- O conjunto do container compartilhado antes da linha (211).
  PERFORM public._lock_container_date_sets(ARRAY[p_container_id]);
  SELECT c.id, c.bl_id, c.container_number, c.discharge_date, c.return_date INTO v_old
  FROM public.bl_containers AS c WHERE c.id = p_container_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container % não encontrado.', p_container_id USING ERRCODE = 'P0002';
  END IF;
  -- 504 (ADR 0094, B4): o B/L cancelado é somente leitura. Sem esta recusa, a
  -- data ia só aos B/Ls irmãos ativos (380) e a ficha dizia que salvou.
  IF EXISTS (SELECT 1 FROM public.bls WHERE id = v_old.bl_id AND cancelled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'B/L % cancelado: somente leitura. Reative para corrigir.', v_old.bl_id USING ERRCODE = '42501';
  END IF;
  -- Só a devolução muda (210): a descarga é a gravada, lida sob a trava.
  IF p_keep_discharge THEN
    v_discharge := v_old.discharge_date;
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NOT NULL AND p_return_date < v_discharge THEN
    RAISE EXCEPTION 'Devolução anterior à descarga.' USING ERRCODE = '22023';
  END IF;
  IF p_return_date IS NOT NULL AND v_discharge IS NULL THEN
    RAISE EXCEPTION 'Informe a descarga antes da devolução.' USING ERRCODE = '22023';
  END IF;
  IF ((v_old.discharge_date IS NOT NULL AND v_discharge IS NULL)
      OR (v_old.return_date IS NOT NULL AND p_return_date IS NULL))
     AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo para remover a data.' USING ERRCODE = '22023';
  END IF;

  v_touched := public._apply_container_dates_core(p_container_id, v_discharge, p_return_date, false);

  IF cardinality(v_touched) > 0 THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification, actor_role, actor_department)
    VALUES ('bl', v_old.bl_id, 'container_dates',
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_old.discharge_date, 'return_date', v_old.return_date)::text,
      jsonb_build_object('container', v_old.container_number, 'discharge_date', v_discharge, 'return_date', p_return_date, 'propagated_bl_ids', v_touched)::text,
      v_actor, COALESCE(v_reason, 'Edição das datas do container'), v_role, v_role);
  END IF;

  RETURN jsonb_build_object(
    'container_id', p_container_id,
    'propagated_bl_ids', to_jsonb(v_touched),
    'demurrage', CASE WHEN cardinality(v_touched) > 0 THEN public._after_container_dates(v_request, v_touched, v_actor) ELSE '{}'::jsonb END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_import_batch_ce_master(p_batch_id bigint, p_ce_master text, p_changed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_normalized text := public.canonical_manifesto_numero(p_ce_master);
  v_old_value text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para editar CE Master.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_batch FROM public.import_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote de importação % não encontrado', p_batch_id
      USING ERRCODE = 'P0002';
  END IF;

  v_old_value := NULLIF(btrim(COALESCE(v_batch.ce_master, '')), '');
  IF v_old_value IS NOT DISTINCT FROM v_normalized THEN
    RETURN;
  END IF;

  -- 396 (F-49): o lote guarda só o Nº que a rota aceitou.
  IF v_normalized IS NOT NULL THEN
    IF v_normalized !~ '^[A-Z0-9]{13}$' THEN
      RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
        USING ERRCODE = 'P0012';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.manifestos_mercante m
                   WHERE m.numero = v_normalized AND m.voyage_id = v_batch.voyage_id) THEN
      RAISE EXCEPTION 'O Nº de Manifesto Mercante % não está cadastrado em uma rota desta Viagem: informe-o na rota antes.', v_normalized
        USING ERRCODE = '22023';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.manifestos_mercante m
                WHERE m.numero = public.canonical_manifesto_numero(v_old_value) AND m.voyage_id = v_batch.voyage_id) THEN
    RAISE EXCEPTION 'O Nº de Manifesto Mercante % continua cadastrado na rota: tire o número da rota antes.', v_old_value
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.import_batches SET ce_master = v_normalized WHERE id = p_batch_id;

  -- 404 (F-24): `import_batch` (singular) é a linha semântica com o id da
  -- Viagem; `import_batches` fica só para o gatilho, com o id do lote.
  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  VALUES ('import_batch', COALESCE(v_batch.voyage_id::text, p_batch_id::text), 'ce_master',
    v_old_value, v_normalized, p_changed_by, 'Atualizacao manual de CE Master');
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_voyage_route_ce_master(p_voyage_id bigint, p_pol text, p_pod text, p_ce_master text, p_changed_by uuid, p_cargo_mode text DEFAULT 'container'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_norm text := public.canonical_manifesto_numero(p_ce_master);
  v_pol text := upper(btrim(COALESCE(p_pol, '')));
  v_pod text := upper(btrim(COALESCE(p_pod, '')));
  v_mode text := lower(btrim(COALESCE(p_cargo_mode, 'container')));
  v_old text;
  v_old_manifesto public.manifestos_mercante%ROWTYPE;
  v_linked integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão ativa para editar o Nº de Manifesto Mercante.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.voyages WHERE id = p_voyage_id) THEN
    RAISE EXCEPTION 'Viagem % não encontrada', p_voyage_id USING ERRCODE = 'P0002';
  END IF;
  IF v_norm IS NOT NULL AND v_norm !~ '^[A-Z0-9]{13}$' THEN
    RAISE EXCEPTION 'Nº de Manifesto Mercante inválido: "%". O número tem 13 caracteres, letras ou dígitos (ex.: 1226501860578).', p_ce_master
      USING ERRCODE = 'P0012';
  END IF;

  -- 396 (F-49): a mesma trava das importações da Viagem (387). "Informar"
  -- espera a planilha de CE da mesma Viagem em vez de cruzar com ela (23505).
  PERFORM public._lock_import_voyages(ARRAY[p_voyage_id]);
  -- 217: a rota é travada antes de ler o número antigo.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    format('route_ce_master:%s:%s:%s:%s', p_voyage_id, v_pol, v_pod, v_mode), 0));

  SELECT ce_master INTO v_old FROM public.voyage_route_ce_master
    WHERE voyage_id = p_voyage_id AND pol = v_pol AND pod = v_pod AND cargo_mode = v_mode
    FOR UPDATE;

  -- Troca ou limpeza (215): o Manifesto antigo com B/L não muda por aqui.
  IF public.canonical_manifesto_numero(v_old) IS NOT NULL
     AND public.canonical_manifesto_numero(v_old) IS DISTINCT FROM v_norm THEN
    SELECT * INTO v_old_manifesto FROM public.manifestos_mercante
      WHERE numero = public.canonical_manifesto_numero(v_old) AND voyage_id = p_voyage_id
      FOR UPDATE;
    IF FOUND THEN
      SELECT count(*) INTO v_linked FROM public.bls WHERE manifesto_mercante_id = v_old_manifesto.id;
      IF v_linked > 0 THEN
        RAISE EXCEPTION 'O Manifesto Mercante % tem % B/L(s) vinculado(s): para trocar o número, use Ver B/Ls → Mover; para tirar o número, Ver B/Ls → Desvincular.',
          v_old_manifesto.numero, v_linked USING ERRCODE = '22023';
      END IF;
      DELETE FROM public.manifestos_mercante WHERE id = v_old_manifesto.id;
    END IF;
  END IF;

  -- Fonte única (ADR 0078, item 6): o Manifesto da rota.
  IF v_norm IS NOT NULL THEN
    PERFORM public._upsert_route_manifesto(p_voyage_id, v_pol, v_pod,
      CASE WHEN v_mode = 'vazios' THEN 'vazio' ELSE 'carga' END, v_norm);
  END IF;

  PERFORM set_config('vela.route_manifest_mirror', 'on', true);
  INSERT INTO public.voyage_route_ce_master(voyage_id, pol, pod, cargo_mode, ce_master, updated_by, updated_at)
  VALUES (p_voyage_id, v_pol, v_pod, v_mode, v_norm, p_changed_by, now())
  ON CONFLICT (voyage_id, pol, pod, cargo_mode)
  DO UPDATE SET ce_master = EXCLUDED.ce_master, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM set_config('vela.route_manifest_mirror', 'off', true);

  IF COALESCE(v_old, '') IS DISTINCT FROM COALESCE(v_norm, '') THEN
    INSERT INTO public.audit_logs(entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
    VALUES ('voyage', p_voyage_id::text, 'ce_master', NULLIF(v_old, ''), v_norm, p_changed_by,
            CASE WHEN v_mode = 'vazios' THEN 'Nº de Manifesto Mercante por rota (vazios)'
                 ELSE 'Nº de Manifesto Mercante por rota' END);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_cod_adjustment(p_adjustment_id bigint, p_actor uuid DEFAULT NULL::uuid, p_resulting_document_id bigint DEFAULT NULL::bigint, p_resulting_document_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_adjustment record;
BEGIN
  -- O autor é quem está logado (ADR 0085, regra base 2; migration 241).
  PERFORM public._assert_actor_is_caller(p_actor);
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() OR (p_actor IS NOT NULL AND p_actor <> auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão para liquidar ajuste de COD.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_adjustment FROM public.cod_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF v_adjustment.applied_correction_id IS NOT NULL AND v_adjustment.status = 'settled' THEN
    RETURN jsonb_build_object('adjustment_id', p_adjustment_id, 'status', 'settled', 'offset_amount_brl', 0,
      'correction_id', v_adjustment.applied_correction_id, 'refund_id', CASE WHEN v_adjustment.resulting_document_type = 'refund' THEN v_adjustment.resulting_document_id END);
  END IF;
  IF v_adjustment.status = 'pending' AND v_adjustment.action IN ('refund_overpayment', 'offset_open_balance')
    AND EXISTS (SELECT 1 FROM public.bl_receivables r JOIN public.invoice_corrections c ON c.receivable_id = r.id
      WHERE r.bl_id = v_adjustment.bl_id AND r.source = 'local_charges'
      AND c.created_at >= v_adjustment.created_at
      AND c.corrected_total_brl <= v_adjustment.new_destination_value_brl) THEN
    RAISE EXCEPTION 'A correção do B/L já tratou este valor. Revise o ajuste de COD e a restituição existente.' USING ERRCODE = '22023';
  END IF;
  RETURN public.settle_cod_adjustment_legacy_130(p_adjustment_id, p_actor, p_resulting_document_id, p_resulting_document_type);
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_cod_adjustment_legacy_130(p_adjustment_id bigint, p_actor uuid DEFAULT NULL::uuid, p_resulting_document_id bigint DEFAULT NULL::bigint, p_resulting_document_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_adjustment RECORD;
  v_actor UUID := COALESCE(p_actor, auth.uid());
  v_invoice_id BIGINT;
  v_offset NUMERIC(14,2) := 0;
  v_refund_id BIGINT;
  v_document_type TEXT := NULLIF(lower(btrim(COALESCE(p_resulting_document_type, ''))), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_financeiro_user() THEN
    RAISE EXCEPTION 'Apenas Financeiro, Administrativo ou Admin pode liquidar ajustes de COD.'
      USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NOT NULL AND p_actor <> auth.uid() THEN
    RAISE EXCEPTION 'O ator da liquidação deve ser o usuário autenticado.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_adjustment
  FROM public.cod_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ajuste de COD % não encontrado.', p_adjustment_id USING ERRCODE = 'P0002';
  END IF;
  IF v_adjustment.status <> 'pending' THEN
    RAISE EXCEPTION 'Ajuste de COD % não está pendente (status=%).', p_adjustment_id, v_adjustment.status
      USING ERRCODE = '22023';
  END IF;
  IF v_adjustment.action IN ('complementary_invoice', 'cancel_and_reissue', 'manual_charge_review') THEN
    IF p_resulting_document_id IS NULL OR v_document_type IS DISTINCT FROM 'invoice' THEN
      RAISE EXCEPTION 'A ação % exige o ID de uma invoice emitida para concluir o ajuste.', v_adjustment.action
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_resulting_document_id IS NOT NULL OR v_document_type IS NOT NULL THEN
    RAISE EXCEPTION 'A ação % não aceita vínculo manual de documento.', v_adjustment.action
      USING ERRCODE = '22023';
  END IF;

  SELECT i.id INTO v_invoice_id
  FROM public.invoices AS i
  WHERE i.bl_id = v_adjustment.bl_id
    AND i.status NOT IN ('cancelled', 'obsolete', 'covered')
  ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_invoice_id IS NULL THEN
    SELECT i.id INTO v_invoice_id
    FROM public.invoices AS i
    JOIN public.invoice_bls AS ib ON ib.invoice_id = i.id
    WHERE ib.bl_id = v_adjustment.bl_id
      AND i.status NOT IN ('cancelled', 'obsolete', 'covered')
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF p_resulting_document_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.invoices AS resulting
      WHERE resulting.id = p_resulting_document_id
        AND COALESCE(resulting.status, 'issued') NOT IN ('cancelled', 'obsolete', 'covered')
        AND (resulting.bl_id = v_adjustment.bl_id OR EXISTS (
          SELECT 1
          FROM public.invoice_bls AS resulting_link
          WHERE resulting_link.invoice_id = resulting.id
            AND resulting_link.bl_id = v_adjustment.bl_id
        ))
    ) THEN
      RAISE EXCEPTION 'O documento % não pertence ao B/L % ou não está ativo.',
        p_resulting_document_id, v_adjustment.bl_id USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.cod_adjustments AS linked
      WHERE linked.id <> p_adjustment_id
        AND linked.resulting_document_id = p_resulting_document_id
    ) THEN
      RAISE EXCEPTION 'O documento % já está vinculado a outro ajuste de COD.', p_resulting_document_id
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Não foi encontrada fatura ativa para o B/L %.', v_adjustment.bl_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_adjustment.offset_amount_brl > 0 THEN
    v_offset := public.apply_cod_open_balance_offset(
      v_invoice_id, v_adjustment.bl_id, v_adjustment.offset_amount_brl, v_actor
    );
  END IF;

  IF v_adjustment.action = 'refund_overpayment' THEN
    IF v_adjustment.refund_amount_brl <= 0 THEN
      RAISE EXCEPTION 'Ajuste de COD sem excedente para restituir.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.invoice_refunds (
      invoice_id, payment_id, cod_adjustment_id, amount_brl, status,
      registered_by, notes
    ) VALUES (
      v_invoice_id, NULL, p_adjustment_id, v_adjustment.refund_amount_brl,
      'pending', v_actor, 'Crédito de COD; abatimento aplicado antes da restituição.'
    )
    RETURNING id INTO v_refund_id;
  END IF;

  UPDATE public.cod_adjustments
  SET status = 'settled',
      resulting_document_id = CASE
        WHEN v_refund_id IS NOT NULL THEN v_refund_id
        WHEN p_resulting_document_id IS NOT NULL THEN p_resulting_document_id
        ELSE v_invoice_id
      END,
      resulting_document_type = CASE
        WHEN v_refund_id IS NOT NULL THEN 'refund'
        WHEN p_resulting_document_type IS NOT NULL THEN v_document_type
        ELSE 'invoice'
      END
  WHERE id = p_adjustment_id;

  INSERT INTO public.audit_logs (
    entity_type, entity_id, field_name, old_value, new_value, changed_by,
    changed_at, justification
  ) VALUES (
    'cod_adjustment', p_adjustment_id::TEXT, 'status', 'pending', 'settled',
    v_actor, now(), 'Liquidação financeira de ajuste de COD'
  );

  RETURN jsonb_build_object(
    'adjustment_id', p_adjustment_id,
    'invoice_id', v_invoice_id,
    'refund_id', v_refund_id,
    'offset_amount_brl', v_offset,
    'status', 'settled'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_demurrage_dunning_claim(p_invoice_id bigint, p_attempt_discriminator integer, p_outcome text, p_reason text DEFAULT NULL::text, p_communication_id bigint DEFAULT NULL::bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text := left(NULLIF(btrim(p_reason), ''), 500);
  v_failures integer;
  v_invoice record;
  v_message text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Executor server-only.' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_attempt_discriminator IS NULL OR p_attempt_discriminator < 1 THEN
    RAISE EXCEPTION 'Invoice e posição da régua são obrigatórios.' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('sent', 'partial', 'failed', 'refused', 'paused') THEN
    RAISE EXCEPTION 'Desfecho da cobrança inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT di.id, di.doc_number, di.customer_id, c.name AS customer_name, di.dunning_suspended_reason
    INTO v_invoice
  FROM public.demurrage_invoices AS di
  LEFT JOIN public.customers AS c ON c.id = di.customer_id
  WHERE di.id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Demurrage invoice % não encontrada.', p_invoice_id USING ERRCODE = 'P0002';
  END IF;

  IF p_outcome = 'paused' THEN
    -- A fatura pausada não foi cobrada neste Comunicado: sai dele, para voltar
    -- em outra composição na mesma etapa sem colidir com o índice único
    -- (fatura, tentativa). O registro do Comunicado e das tentativas fica.
    IF p_communication_id IS NOT NULL THEN
      DELETE FROM public.customer_communication_dunning_invoices
      WHERE communication_id = p_communication_id
        AND demurrage_invoice_id = p_invoice_id
        AND attempt_discriminator = p_attempt_discriminator;
    END IF;
    UPDATE public.demurrage_dunning_claims
    SET released_at = COALESCE(released_at, now()), last_error = COALESCE(v_reason, last_error)
    WHERE demurrage_invoice_id = p_invoice_id AND attempt_discriminator = p_attempt_discriminator;
    RETURN FOUND;
  END IF;

  IF p_outcome = 'sent' THEN
    -- O alerta de falha repetida fecha quando a cobrança sai. O de recusa
    -- definitiva só fecha pela pessoa (é o que retoma a fatura suspensa).
    IF v_invoice.dunning_suspended_reason IS NULL THEN
      BEGIN
        PERFORM public.resolve_alert_item('cobranca_demurrage_recusada', 'demurrage_invoice', p_invoice_id::text,
          'demurrage_dunning', jsonb_build_object('attempt_discriminator', p_attempt_discriminator));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Alerta cobranca_demurrage_recusada da invoice % nao fechado: %', p_invoice_id, SQLERRM;
      END;
    END IF;
    RETURN true;
  END IF;

  IF p_outcome = 'partial' THEN
    IF v_reason IS NOT NULL THEN
      v_message := 'Invoice ' || v_invoice.doc_number || ' (Cliente ' || COALESCE(v_invoice.customer_name, v_invoice.customer_id::text)
        || '): a cobrança saiu para parte dos contatos; o provedor recusou em definitivo os demais (' || v_reason || '). Corrija o e-mail do contato.';
    END IF;
  ELSE
    UPDATE public.demurrage_dunning_claims
    SET failure_count = failure_count + 1,
        last_error = COALESCE(v_reason, last_error),
        released_at = CASE WHEN p_outcome = 'failed' THEN COALESCE(released_at, now()) ELSE released_at END
    WHERE demurrage_invoice_id = p_invoice_id AND attempt_discriminator = p_attempt_discriminator
    RETURNING failure_count INTO v_failures;
    IF NOT FOUND THEN
      RETURN false;
    END IF;

    IF p_outcome = 'refused' THEN
      -- 1E.1 (D6): a claim fica consumida e a fatura sai da Régua até a pessoa
      -- corrigir o contato e resolver o alerta com justificativa.
      UPDATE public.demurrage_invoices
      SET dunning_suspended_reason = 'Cobrança recusada pelo provedor: ' || COALESCE(v_reason, 'recusa definitiva')
      WHERE id = p_invoice_id AND dunning_suspended_reason IS NULL;
      v_message := 'Invoice ' || v_invoice.doc_number || ' (Cliente ' || COALESCE(v_invoice.customer_name, v_invoice.customer_id::text)
        || '): o provedor recusou a cobrança em definitivo (' || COALESCE(v_reason, 'sem motivo') || '). A Régua suspendeu esta Invoice; '
        || 'corrija o contato do Cliente e resolva este alerta com justificativa para retomar.';
    ELSIF v_failures >= 3 THEN
      -- 2.5: falha passageira repetida (rede, tempo esgotado, 5xx, configuração do provedor).
      v_message := 'Invoice ' || v_invoice.doc_number || ' (Cliente ' || COALESCE(v_invoice.customer_name, v_invoice.customer_id::text)
        || '): ' || v_failures || ' falhas seguidas no envio da cobrança (' || COALESCE(v_reason, 'sem motivo') || '). '
        || 'A Régua segue tentando a cada rodada; o alerta fecha quando a cobrança sair.';
    END IF;
  END IF;

  IF v_message IS NOT NULL THEN
    -- Falha no alerta não desfaz a decisão da claim.
    BEGIN
      PERFORM public.upsert_alert_item(
        'cobranca_demurrage_recusada', 'demurrage_invoice', p_invoice_id::text, v_message, 'demurrage_dunning',
        jsonb_build_object('invoice_id', p_invoice_id, 'customer_id', v_invoice.customer_id,
          'attempt_discriminator', p_attempt_discriminator, 'outcome', p_outcome,
          'failure_count', v_failures, 'reason', v_reason),
        '/demurrage'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Alerta cobranca_demurrage_recusada da invoice % nao gravado: %', p_invoice_id, SQLERRM;
    END;
  END IF;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_customer_with_audit(p_customer_id bigint, p_updates jsonb, p_changed_by uuid, p_justification text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_before public.customers%ROWTYPE;
  v_after public.customers%ROWTYPE;
  v_invalid_key TEXT;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_active_user()
     OR p_changed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Usuário sem permissão para editar o Cliente.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Usuário sem permissão para editar cliente.' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(BTRIM(COALESCE(p_justification, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Justificativa obrigatoria para editar cliente.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_updates) <> 'object' OR p_updates = '{}'::JSONB THEN
    RETURN FALSE;
  END IF;

  SELECT key INTO v_invalid_key
  FROM jsonb_object_keys(p_updates) AS key
  WHERE key NOT IN ('name', 'trade_name', 'address', 'city', 'state', 'zip', 'notes', 'cnpj_cpf')
  LIMIT 1;

  IF v_invalid_key IS NOT NULL THEN
    RAISE EXCEPTION 'Campo de cliente nao editavel: %.', v_invalid_key USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente % não encontrado.', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  -- 436: o CNPJ só muda por aqui, com justificativa. O gatilho
  -- `portal_protect_customer_cnpj` segue recusando o Cliente com convite ou
  -- Conta de Portal (esse vai por `portal_admin_change_cnpj`), e
  -- `canonicalize_customer_cnpj` normaliza e valida o documento.
  UPDATE public.customers SET
    cnpj_cpf = CASE WHEN p_updates ? 'cnpj_cpf' THEN p_updates->>'cnpj_cpf' ELSE cnpj_cpf END,
    name = CASE WHEN p_updates ? 'name' THEN p_updates->>'name' ELSE name END,
    trade_name = CASE WHEN p_updates ? 'trade_name' THEN NULLIF(p_updates->>'trade_name', '') ELSE trade_name END,
    address = CASE WHEN p_updates ? 'address' THEN NULLIF(p_updates->>'address', '') ELSE address END,
    city = CASE WHEN p_updates ? 'city' THEN NULLIF(p_updates->>'city', '') ELSE city END,
    state = CASE WHEN p_updates ? 'state' THEN NULLIF(p_updates->>'state', '') ELSE state END,
    zip = CASE WHEN p_updates ? 'zip' THEN NULLIF(p_updates->>'zip', '') ELSE zip END,
    notes = CASE WHEN p_updates ? 'notes' THEN NULLIF(p_updates->>'notes', '') ELSE notes END
  WHERE id = p_customer_id
  RETURNING * INTO v_after;

  INSERT INTO public.audit_logs (entity_type, entity_id, field_name, old_value, new_value, changed_by, justification)
  SELECT 'customer', p_customer_id::TEXT, changed.field_name, changed.old_value, changed.new_value,
    p_changed_by, BTRIM(p_justification)
  FROM (VALUES
    ('cnpj_cpf', v_before.cnpj_cpf, v_after.cnpj_cpf),
    ('name', v_before.name, v_after.name),
    ('trade_name', v_before.trade_name, v_after.trade_name),
    ('address', v_before.address, v_after.address),
    ('city', v_before.city, v_after.city),
    ('state', v_before.state, v_after.state),
    ('zip', v_before.zip, v_after.zip),
    ('notes', v_before.notes, v_after.notes)
  ) AS changed(field_name, old_value, new_value)
  WHERE p_updates ? changed.field_name
    AND changed.old_value IS DISTINCT FROM changed.new_value;

  RETURN TRUE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_depot_terminal_port()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.tipo = 'depot' AND NEW.port_id IS NOT NULL THEN
    RAISE EXCEPTION 'Depot comum não pode ter porto brasileiro.' USING ERRCODE = '23514';
  END IF;
  IF NEW.tipo = 'terminal_portuario'
     AND NEW.port_id IS NULL
     AND (TG_OP = 'INSERT' OR OLD.tipo <> 'terminal_portuario' OR OLD.port_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Novo terminal portuário exige porto brasileiro.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_vehicle_relationships()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  container_bl_id TEXT;
  bl_voyage_id BIGINT;
BEGIN
  NEW.chassis := upper(trim(NEW.chassis));
  NEW.brand := trim(NEW.brand);
  NEW.model := trim(NEW.model);

  IF NEW.chassis = '' THEN
    RAISE EXCEPTION 'Chassi obrigatório';
  END IF;

  IF NEW.brand = '' THEN
    RAISE EXCEPTION 'Marca obrigatória';
  END IF;

  IF NEW.model = '' THEN
    RAISE EXCEPTION 'Modelo obrigatório';
  END IF;

  SELECT bl_id
    INTO container_bl_id
  FROM public.bl_containers
  WHERE id = NEW.container_id;

  IF container_bl_id IS NULL THEN
    RAISE EXCEPTION 'Container não encontrado';
  END IF;

  IF container_bl_id <> NEW.bl_id THEN
    RAISE EXCEPTION 'BL não pertence ao container informado';
  END IF;

  SELECT voyage_id
    INTO bl_voyage_id
  FROM public.bls
  WHERE id = NEW.bl_id;

  IF bl_voyage_id IS NULL THEN
    RAISE EXCEPTION 'BL não encontrado';
  END IF;

  IF bl_voyage_id <> NEW.voyage_id THEN
    RAISE EXCEPTION 'BL não pertence à viagem informada';
  END IF;

  RETURN NEW;
END;
$function$;

