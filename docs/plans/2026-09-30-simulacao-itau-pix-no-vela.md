# Integração Itaú Pix no Vela com simulação

Estado em 2026-09-30: nova migration autorizada explicitamente pelo dono;
simulação implementada em branch isolada, com replay no Postgres 16 local.
Manter PR em rascunho, sem merge. Não publicar funções, aplicar migrations em
produção ou ativar o Itaú real nesta etapa.

Evidência desta execução e limitações:
[relatório histórico](../archive/reports/2026-09-30-simulacao-itau-pix-no-vela.md).

## Resultado esperado

Testar emissão, atualização por PTAX, expiração, cancelamento e conciliação
pelos fluxos de faturamento do Vela, com um simulador que conserva o estado das
cobranças. As regras aprovadas estão no
[plano de preparação do acesso](2026-09-30-preparacao-acesso-itau-pix.md#regras-de-cobrança-aprovadas-em-2026-09-30).
O sandbox observado devolve exemplos inconsistentes e não substitui essa prova.

## Desenho mínimo

- Reutilizar os serviços de faturamento e os registros financeiros existentes.
  Não criar um segundo livro de pagamentos. A confirmação automática deve
  aplicar as mesmas permissões, validações e efeitos financeiros da conciliação.
- Guardar cobranças, revisões confirmadas, TXIDs antigos, recebimentos
  identificados pelo endToEndId e trabalho pendente no backend. Uma restrição
  impede mais de uma cobrança ativa para a mesma fatura/processo.
- Registrar a intenção na transação que altera a fatura. Um processador executa
  chamadas ao provedor fora da transação e confirma o resultado. Em falha ou
  timeout, consultar o estado antes de repetir; não presumir que houve falha no
  banco. Reprocessamento deve ser idempotente.
- Usar dois modos explícitos: simulação e Itaú. Cobranças simuladas não podem
  produzir quitação de faturas reais nem ser apresentadas como Pix pagável.
  O modo real fica desativado sem configuração completa e validação de acesso.
- Simulador conserva revisão, valor, expiração, cancelamento e recebimentos;
  permite injetar falha e controlar relógio nos testes. Nenhuma credencial real
  é necessária para executá-lo.
- Processador consulta recebimentos a cada cinco minutos quando ativado em
  ambiente autorizado. Guardar progresso e sobrepor períodos para recuperar
  interrupções; deduplicar por endToEndId e percorrer páginas.
- Calendário recebe os feriados oficiais aplicáveis a Vitória/ES. Ausência de
  calendário válido não deve silenciosamente calcular prazo sem feriados.
  Ponto facultativo não vira feriado automaticamente.
- Exibir emissão/cancelamento pendentes e falhas nas telas existentes; atualizar
  as famílias de cache afetadas após confirmação. Gerar Alertas pelo mecanismo
  existente. Segredos e transporte mTLS ficam exclusivamente no backend.

## Etapas e evidência

1. Conferir os donos atuais: `billingLedger.ts`,
   `demurrage/demurrageInvoices.ts`, `reconciliacao.ts`, RPCs de emissão,
   cancelamento e confirmação e `recalc-demurrage-ptax`. Identificar as últimas
   definições SQL antes de alterar contratos.
2. Criar nova migration, sem editar migrations históricas: persistência de
   cobranças/revisões/trabalho pendente/recebimentos, restrições, RLS e comandos
   internos. Propor alterações nos donos existentes por novas definições SQL.
   Não liberar comandos financeiros ao navegador por concessão ampla.
3. Implementar o simulador e o processador no backend, usando o mesmo contrato
   de operações do transporte Itaú. Configuração real incompleta deve falhar
   antes de qualquer chamada; não usar valores fictícios como credenciais.
4. Ligar os fluxos de faturas, PTAX, cancelamento e consulta de recebimentos.
   Reutilizar Alertas e efeitos de cache. Preservar a transição do Pix estático
   enquanto o modo real permanecer desativado.
5. Executar os cenários abaixo em ambiente controlado, verificar isolamento e
   atualizar documentação viva com o comportamento efetivamente entregue.

| Cenário | Resultado exigido |
|---|---|
| Emitir Taxas Locais e Demurrage | COB vinculada à fatura; execução repetida não duplica |
| Nova PTAX | Mesmo TXID, revisão e valor atualizados após confirmação |
| Pagamento da revisão anterior durante atualização | Quita pelo valor efetivamente aceito; mantém revisão auditável |
| Sexta e segunda-feira feriado | Próximo dia útil às 14h30 em Vitória |
| PTAX ainda não refletida às 14h | Alerta deduplicado para a equipe |
| Corte às 14h30 | Simulador recusa novo pagamento; fatura não vira paga por expirar |
| Taxas Locais abertas | Renova quando permitido; não declara validade infinita |
| Renovação rejeitada ou resposta incerta | Recupera somente com confirmação; incerteza gera Alerta |
| Cancelamento com falha e repetição | Pendente até confirmação; depois QR deixa de ser pagável |
| Pagamento concorrente ao cancelamento | Preserva recebimento; análise sem devolução automática |
| Consulta repetida, páginas e falha intermediária | Sem dupla quitação, sem perder recebimentos |
| Usuário ou cliente sem permissão | Não acessa cobranças alheias nem confirma recebimentos |

Checks obrigatórios: `npm run docs:check`, `npm run typecheck`, `npm run lint`,
`npm test`, `npm run build`, `npm run migrations:check`, `npm run rpc:check` e
`git diff --check`; replay e verificações de autorização em Postgres controlado
conforme `WORKFLOW.md`. Testes de texto SQL não comprovam execução nem RLS.

## Limite da entrega

A migration `114_itau_pix_simulation.sql` mantém configuração desligada por
padrão. Cada fatura de fixture é habilitada explicitamente pelo backend via
`enroll_pix_simulation`; a emissão nas telas continua normal nas demais faturas.
Alterações e cancelamentos das faturas habilitadas registram intenção na mesma
transação. O processamento está em `run_pix_simulation`; `pay_pix_simulation`
recebe somente pagamentos fictícios pelo backend. Os RPCs financeiros atuais
continuam responsáveis por gravar a baixa. O histórico confirmado do Pix é uma
prova adicional para a revisão paga da Demurrage, sem ampliar a tolerância dos
extratos manuais.

Revisão de 2026-09-30 (incorporada à migration `114`, ainda não aplicada): após o corte, a
Demurrage aberta recebe nova cobrança na mesma fatura, na mesma execução, e a
recuperação de Taxas Locais também confirma na hora; recusa de baixa (ex.: Pix
acima do saldo após baixa parcial) e resposta incerta vão para `pix_review`,
tratado pelo Administrativo e resolvido quando o reprocessamento conclui; a
cobrança em análise não é alterada pelo trigger; o processador não espera
fatura travada por outra transação, evitando deadlock com edição e recálculo
da PTAX. Decisão registrada: com a API Itaú, a Conciliação PIX vira tela de
monitoramento.

O módulo `itauPixTransport.ts` prepara criação, consulta, alteração e cancelamento
de COB com fetch mTLS fornecido pelo backend, ativação e validação explícitas.
Ele ainda não está conectado ao processador persistido. O modo real permanece
indisponível nesta entrega: falta ligar consulta bancária paginada, checkpoint,
confirmação de comandos e recuperação de respostas incertas. Não basta colocar
um token para transformar a simulação em operação real.

Permanecem pendentes: validação do transporte/headers/limites com a conta Itaú;
calendário de Vitória/ES a partir de 2028 e conferência de 2027 com a publicação oficial (2026 enviado pelo dono e 2027 derivado das mesmas leis estão na migration `114`; pontos facultativos não contam; segundo o dono, os feriados municipais já cobrem os estaduais do ES);
ligação do transporte real ao processamento e agendamento de cinco minutos em
ambiente autorizado. A função de simulação contém bloqueio adicional contra o
projeto produtivo do Vela e nenhum cron novo é criado pela migration.

Simulação integrada e código preparado não comprovam autenticação Itaú,
pagamento bancário, limites de expiração ou aceitação do transporte na conta.
Validar esses pontos com material vigente antes de ativar. Atualizar o manual
de serviços externos com nomes e locais da configuração, nunca seus valores.
Arquivar este plano somente após concluir implementação e checks.
