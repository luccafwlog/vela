-- Cenário de demonstração do Manual do Operador (dados fictícios), aplicado
-- por preparar.sh depois do seed da auditoria visual. Só o que vem antes dos
-- procedimentos: câmbio do dia, Clientes e liberação de faturamento. A
-- Viagem, as escalas e as importações são feitas pela tela, nas capturas.
begin;

insert into public.exchange_rate_reference (id, ptax, roe, effective_date, quote_date, source)
values (1, 5.3420, 5.6892, current_date, current_date, 'manual')
on conflict (id) do update set ptax = excluded.ptax, roe = excluded.roe, effective_date = excluded.effective_date, quote_date = excluded.quote_date;

insert into public.customers (id, cnpj_cpf, name, trade_name, city, state) values
  (9001, '41.823.657/0001-36', 'ATLANTICO IMPORTADORA LTDA', 'Atlântico Importadora', 'Vitória', 'ES'),
  (9002, '52.934.768/0001-36', 'MAQUINAS HORIZONTE LTDA', 'Máquinas Horizonte', 'Serra', 'ES');

insert into public.customer_contacts (customer_id, name, email, is_primary) values
  (9001, 'Juliana Prado', 'documentos@atlantico-importadora.example', true),
  (9002, 'Roberto Faria', 'importacao@maquinas-horizonte.example', true);

-- A Atlântico tem faturamento liberado sem Portal; a Máquinas Horizonte não,
-- para o manual mostrar o B/L esperando a Revisão.
insert into public.customer_billing_portal_releases (customer_id, justification, granted_by, review_at)
values (9001, 'Cenário do manual: Cliente com faturamento liberado.', 'a0000000-0000-4000-8000-000000000001', now() + interval '30 days');

-- Dois Pix que entraram na conta e não deram baixa sozinhos, para a aba
-- Pix recebidos da Conciliação PIX (24.4): um do QR estático de uma fatura que
-- não está aberta e um com a chave digitada pelo Cliente. Os motivos são os que
-- a consulta do Itaú grava (migration 552).
insert into public.itau_pix_receipts (end_to_end_id, txid, amount_brl, paid_at, status, reason, raw) values
  ('E60701190202611031020MANUALDEMO01', 'INV20260099', 2731.40, now() - interval '3 hours', 'received',
   'Sem baixa automática: Nenhuma fatura aberta com este identificador: a fatura pode já estar paga (Pix em duplicidade) ou o QR é de outro ambiente na mesma conta.',
   '{"infoPagador": "Taxas locais B/L CSC45810A02K00"}'::jsonb),
  ('E60701190202611031105MANUALDEMO02', '', 1180.00, now() - interval '2 hours', 'received', null,
   '{"infoPagador": "Maquinas Horizonte - pagamento taxas"}'::jsonb);

-- ADR fechado da XIN PU DONG / 012S (Viagem concluída do seed) em Salvador, no
-- TECON SSA, para a aba Prazo do ADR da Administração (25.9): ATD há 44 dias,
-- Operações e Documentação assinaram no prazo de 72 h e Equipamentos, depois.
insert into public.agency_departure_reports (voyage_id, port, terminal, terminal_id, terminal_port_id, status, closed_at, closed_by, closed_snapshot)
select 11, 'BRSSA', d.name, d.id, d.port_id, 'closed', now() - interval '40 days', 'a0000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'header', jsonb_build_object(
      'unifiedAtd', to_char(now() - interval '44 days', 'YYYY-MM-DD'),
      'deadlineDate', to_char(now() - interval '41 days', 'YYYY-MM-DD'),
      'deadlineAt', to_char(((now() - interval '44 days') + interval '72 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'departmentSignoffs', jsonb_build_array(
      jsonb_build_object('department', 'operacoes', 'signed_at', to_char((now() - interval '43 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      jsonb_build_object('department', 'documentacao', 'signed_at', to_char((now() - interval '42 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      jsonb_build_object('department', 'equipamentos', 'signed_at', to_char((now() - interval '40 days 12 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
from public.depots d join public.ports p on p.id = d.port_id
where p.locode = 'BRSSA' and d.name = 'TECON SSA';

commit;
