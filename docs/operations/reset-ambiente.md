# Reset do Ambiente de Testes

**Status: suspenso em 2026-06-18. Não execute o script atual.**

O arquivo `supabase/scripts/reset_operational_data.sql` cobre o modelo antigo,
mas não declara a limpeza e a ordem de dependência de ledger, Demurrage,
Granito, Vazios, notificações/disputas do Portal e outras tabelas recentes.
Executá-lo pode falhar por FKs ou produzir um ambiente parcialmente limpo.

## Status dos dados

Este documento foi escrito quando se supunha haver dado a preservar. Desde
2026-09-18 o `CLAUDE.md`, na seção Gotchas, afirma o contrário: o projeto de
produção **não tem dados de negócio** — toda linha é fixture e pode ser
descartada. Quem lê este arquivo deve conferir aquela afirmação antes de
tratar qualquer limpeza como arriscada.

O que continua valendo, independentemente do status dos dados, é o motivo pelo
qual o script está suspenso: ele **não funciona**. Cobre o modelo antigo, não
declara a ordem de dependência das tabelas recentes e pode deixar o ambiente
parcialmente limpo. A suspensão é técnica, não uma medida de proteção de dados.

## Alternativa segura

- Use um projeto Supabase descartável ou uma branch de banco.
- Identifique os dados pelo prefixo e pela viagem de QA.
- Registre os IDs criados durante a validação.
- Remova-os pelos fluxos do produto ou por SQL revisado para aquela fixture.
- Limpeza ampla em produção depende da afirmação "Data status" do `CLAUDE.md`
  estar vigente; se ela tiver sido revogada, trate produção como intocável.

## Consultas de diagnóstico

As consultas abaixo são somente leitura. Elas ajudam a medir o estado do
ambiente, mas não autorizam exclusão.

```sql
SELECT 'import_batches' AS table_name, COUNT(*) AS total
FROM public.import_batches
UNION ALL
SELECT 'bls', COUNT(*)
FROM public.bls
UNION ALL
SELECT 'bl_containers', COUNT(*)
FROM public.bl_containers
UNION ALL
SELECT 'invoices', COUNT(*)
FROM public.invoices
UNION ALL
SELECT 'bl_receivables', COUNT(*)
FROM public.bl_receivables
UNION ALL
SELECT 'ledger_settlements', COUNT(*)
FROM public.ledger_settlements
UNION ALL
SELECT 'demurrage_invoices', COUNT(*)
FROM public.demurrage_invoices
UNION ALL
SELECT 'granite_bls', COUNT(*)
FROM public.granite_bls
UNION ALL
SELECT 'vazios_bookings', COUNT(*)
FROM public.vazios_bookings
UNION ALL
SELECT 'vazios_importacao_containers', COUNT(*)
FROM public.vazios_importacao_containers
UNION ALL
SELECT 'portal_notifications', COUNT(*)
FROM public.portal_notifications
UNION ALL
SELECT 'audit_logs', COUNT(*)
FROM public.audit_logs;
```

Para localizar uma fixture, prefira filtros por viagem, B/L, cliente ou prefixo
de arquivo: a contagem global diz quanto existe, não o que cada linha significa.

## Reativação

O procedimento só pode voltar a ser oficial após:

1. mapear todas as FKs e a ordem de remoção;
2. executar em banco descartável com dados de todos os módulos;
3. provar preservação de usuários e cadastros estruturais;
4. executar uma segunda vez para provar idempotência;
5. documentar restauração ou rollback;
6. registrar a evidência em `docs/operations/validacao.md`.

Até lá, o SQL existente é apenas um registro histórico protegido por aviso.
