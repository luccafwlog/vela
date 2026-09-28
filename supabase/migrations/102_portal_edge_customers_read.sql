-- portal-invite-send lê name e cnpj_cpf pela relação aninhada de customers.
-- Manter o grant somente de leitura exclusivo ao service_role do runtime.
GRANT SELECT ON TABLE public.customers TO service_role;
