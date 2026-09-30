# Evidências da simulação Pix no Vela — 2026-09-30

Escopo: simulação persistida de cobranças vinculadas a faturas do Vela,
comandos financeiros existentes e apresentação dos estados de simulação.
Branch `codex/itau-pix-simulation`, baseada em `origin/main` `615856c5`.
Nova migration autorizada pelo dono; PR deve permanecer em rascunho, sem merge.

## Runtime SQL local

PostgreSQL 16 descartável, `127.0.0.1:55439`, banco `vela_test`, criado para
esta execução com initdb nativo do Windows. Replay integral das migrations com
os shims de Auth/Vault/cron do procedimento local existente. Não é um Supabase
completo: não comprova PostgREST, JWT do gateway, cron hospedado nem pagamento
bancário. Nenhum deploy, migration ou segredo aplicado no Supabase.

`scripts/check-itau-pix-simulation.sql` aprovado com fixtures/configuração
revertidas por ROLLBACK. Provas observadas:

- Modo desligado recusa processamento; habilitação é explícita por fatura.
- Emissão repetida não duplica; valor e revisão mudam no mesmo TXID.
- Recálculo de PTAX usa o RPC do Vela. Recebimento da revisão anterior quita
  Demurrage pelo valor efetivamente pago, mesmo fora das duas fotos do extrato
  manual. Repetição não gera outra baixa.
- Recebimento local usa o ledger existente, zera saldo e não duplica settlement.
- Sexta-feira e segunda-feira marcada como feriado **sintético** levam a terça
  às 14h30; ano sem calendário validado é recusado.
- Alerta das 14h aparece após falha de atualização e resolve após confirmação.
- Corte às 14h30 recusa pagamento; expiração não quita a fatura.
- Renovação permitida conserva TXID; renovação rejeitada recupera com outro
  TXID e vínculo ao anterior, sem duas cobranças ativas.
- Recebimento comunicado tardiamente no TXID anterior quita a fatura e cancela
  a recuperação, preservando o identificador financeiro do pagamento.
- Cancelamento usa o RPC de fatura avulsa do Vela. Falha mantém pendência;
  confirmação impede pagamento. Corrida de pagamento/cancelamento preserva
  recebimento para análise, sem reabrir fatura nem devolver automaticamente.
- Chamadas autenticadas do navegador são recusadas nas funções/tabelas privadas;
  detalhes públicos autorizados conservam escopo e recebem o estado simulado.

`check-squash-replay.sql` também aprovado. Suítes existentes de Demurrage e
bateria financeira: 9 testes aprovados. Paridade/segurança da Inspeção Portal:
7 aprovados. O psql nativo recebeu argumentos em Windows-1252; a execução dessas
suítes usou `PGCLIENTENCODING=WIN1252` e, para asserções de mensagens acentuadas,
uma ponte temporária de decoding, fora do Git. CI Linux usa o procedimento
original, sem essa ponte.

## Testes de aplicação e checks

- Suíte completa Vitest: 675 arquivos aprovados, 41 ignorados; 3716 testes
  aprovados, 227 ignorados. Suítes de integração ignoradas no comando comum
  requerem ambiente controlado; as selecionadas acima foram executadas à parte.
- Documentos React identificam simulação e escondem payload legado; polling
  dos detalhes atualiza caches ao confirmar estado/valor e para no estado final.
  Evidência automatizada de componentes/hooks, sem navegação observada no Vela.
- `docs:check`, `typecheck`, `lint`, `build`, `migrations:check`, `rpc:check` e
  `git diff --check` aprovados nas execuções locais registradas.
- Transporte COB verificado com HTTP fictício: configuração desativada não
  chama o banco; expiração usa criação original; resposta de outro TXID é
  recusada; escrita não tem retry automático; cancelamento e formatos de header
  são explícitos. `deno check` do módulo de transporte aprovado.

## Limites e pendências

A função `itau-pix-simulation` não foi publicada nem observada via HTTP. Seu
`deno check --config supabase/functions/deno.json` encontra TS2353 em
`_shared/telemetry.ts`: `sendDefaultPii` não consta em `DenoOptions` do SDK
Sentry. A mesma falha aparece ao checar a função já existente
`recalc-demurrage-ptax`; não foi alterada telemetria para esconder essa pendência.

O transporte real não está conectado ao processador persistido; consulta
bancária paginada, checkpoint, tratamento de resposta incerta e cron de cinco
minutos ainda precisam ser implementados/validados. Calendário oficial e
material vigente da conta Itaú também estão pendentes. Não afirmar que inserir
um token basta para ativar recebimentos reais. O
[plano vivo](../../plans/2026-09-30-simulacao-itau-pix-no-vela.md) permanece aberto.
