# Remediação de Clientes, Revisão e Comunicação

## Resultado pretendido

Fechar os achados confirmados da auditoria de Clientes, Revisão e Comunicação:
comunicados operacionais não podem ampliar público nem usar B/Ls ou conteúdo
arbitrários; troca de cliente do B/L deve serializar com o financeiro; revisão
deve persistir CBM de breakbulk, exigir versão e registrar valores reais; saldos
devem usar o ledger canônico e incluir Demurrage; falhas de conferência não
podem virar zero; filas de revisão não podem truncar em 500; a timeline deve
identificar o autor; e a importação deve explicitar alterações em clientes já
cadastrados.

Fica fora de escopo alterar a regra CNPJ/CPF, pois a auditoria deixou essa
decisão de produto pendente, e refatorações sem relação com os achados.

## Fontes de verdade e restrições

- `CONTEXT.md`, `docs/modules/faturamento.md` e
  `docs/operations/seguranca.md` definem público, saldo e fronteiras.
- Escritas sensíveis permanecem em RPCs `SECURITY DEFINER`, com grants mínimos.
- A migration é forward-only, numerada após `067`; migrations aplicadas não são
  editadas.
- O arquivo não rastreado de auditoria de design existente no worktree não faz
  parte deste trabalho.

## Ordem e contratos afetados

1. Criar testes de regressão para RPCs, Edge Function, paginação, saldos,
   estados de erro e preview de importação; observar a falha antes da correção.
2. Adicionar migration para serialização financeira, revisão otimista/auditoria
   derivada, agregado canônico de saldo e fechamento da escrita direta de
   auditoria onde os chamadores tiverem RPC própria.
3. Endurecer `send-customer-communication` e a tela para derivar público,
   exigir B/Ls/âncoras válidos e falhar fechado quando a conferência atual não
   puder ser carregada.
4. Consumir o saldo canônico, paginar filas até o fim, exibir autor na timeline
   e comparar explicitamente clientes existentes no preview da importação.
5. Atualizar documentação viva, executar replay/testes focados e o gate
   completo, revisar o diff, abrir PR e acompanhar o CI do commit até verde.

## Critérios de aceite observáveis

- Um comunicado operacional vazio, fora da caixa do papel ou com âncora/B/L de
  outro cliente é recusado sem envio; erro de conferência bloqueia a ação.
- Pagamento concorrente impede que uma troca de cliente mova obrigação já
  movimentada.
- Revisão sem `updated_at` é recusada; `bb_cbm` salvo reaparece; auditoria não
  aceita entidade/valores inventados pelo navegador.
- Lista e ficha mostram o mesmo saldo pendente de ledger, incluindo Demurrage,
  e erro não aparece como R$ 0,00.
- Mais de 500 itens elegíveis aparecem na revisão.
- Timeline mostra o autor disponível e preview de importação separa inclusões
  de alterações, listando os campos que mudarão.

## Validação, risco e rollback

Rodar testes focados, PostgreSQL local/replay das migrations, `rpc:check`,
`migrations:check`, `docs:check`, typecheck, lint, suíte completa e build. A
migration pode ser revertida somente por outra migration que restaure as
funções/policies anteriores; o código da aplicação é revertível pelo commit.
Riscos principais: deadlock por ordem de locks, divergência entre ledger e
documentos legados e quebra de chamadores de auditoria — todos exigem testes
em banco real descartável.
