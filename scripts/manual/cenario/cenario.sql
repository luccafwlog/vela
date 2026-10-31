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

commit;
