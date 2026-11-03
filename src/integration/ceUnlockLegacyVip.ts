// Solicitação VIP aberta antes da migration 580 (ADR 0119). Desde então o B/L
// coberto pelos dois anuais VIP não entra em solicitação: o rascunho e o envio
// o recusam. As solicitações VIP já abertas continuam em produção (Aplicar
// renovação VIP, exportação, conclusão, expurgo) e seguem testadas por este
// fixture, que grava a solicitação como o rascunho e o envio de antes gravavam.

/**
 * SQL que cria a solicitação VIP (`source = 'vip_annual'`) do Cliente com os
 * B/Ls dados, e o id dela. Enviada: cada B/L aponta o anual que o cobre hoje,
 * com os eventos `draft` e `submit` do Cliente, e a conclusão é reavaliada.
 * Rascunho: só os B/Ls e o evento `draft`. Rodar como superusuário.
 */
export function legacyVipRequest(
  customer: number,
  blIds: readonly string[],
  actor: string,
  state: 'draft' | 'submitted' = 'submitted',
): { id: string; sql: string } {
  const id = crypto.randomUUID()
  const bls = blIds.map((bl) => `'${bl}'`).join(',')
  const sent = state === 'submitted'
  return {
    id,
    sql: `INSERT INTO public.ce_unlock_requests(id,customer_id,source,state,created_by) VALUES('${id}',${customer},'vip_annual','${state}','${actor}');
      INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,payload) VALUES(${customer},'${id}','draft','${actor}','{}');
      INSERT INTO public.ce_unlock_request_bls(request_id,bl_id,ce_at_request,termo_document_id,procuracao_document_id)
        SELECT '${id}',b.id,b.ce_mercante,
          ${sent ? `ce_unlock_private.annual_for_bl(${customer},'termo',b.id),ce_unlock_private.annual_for_bl(${customer},'procuracao',b.id)` : 'NULL,NULL'}
        FROM public.bls b WHERE b.id IN(${bls});
      ${sent ? `INSERT INTO public.ce_unlock_events(customer_id,request_id,action,actor_id,payload) VALUES(${customer},'${id}','submit','${actor}','{}');
      DO $legacy$ BEGIN PERFORM ce_unlock_private.refresh_completion('${id}'); END $legacy$;` : ''}`,
  }
}
