# Revisão de integração das PRs 845, 846 e 847

Data: 2026-10-05. Revisão estática e simulação local de merge; sem publicação,
merge remoto ou alteração de regras de negócio.

## Resultado

As três PRs são complementares, mas não estão prontas para integração conjunta.
O maior risco de decisão é permitir solicitação de desbloqueio de CE para um
Cliente novo usando o recebimento do Cliente anterior durante a troca de CNPJ.
Há também versões duplicadas de migrations, nove conflitos textuais entre
Informações e Desbloqueio de CE e uma lacuna de atualização da fila após ações
financeiras. A ordem de merge, sozinha, não resolve esses pontos.

| PR | Escopo | Head revisado |
|---|---|---|
| [845](https://github.com/luccafwlog/vela/pull/845) | Central de Informações, devolução e tarifas | `93a00e34fc203cbeda8cff61a8e2236f41d7956b` |
| [846](https://github.com/luccafwlog/vela/pull/846) | Recebimentos, restituições e troca de CNPJ | `b676798c271aa067fc0a0efbc7aa8e12a5e0b54f` |
| [847](https://github.com/luccafwlog/vela/pull/847) | Desbloqueio de CE, documentos e VIP | `f482879034b27567ba3714e02100ec0c72e191c0` |

Base comum: `2edd24ffce45b133342f6f58c376d981f9d203aa` (`main`). Todas estavam
abertas e individualmente mescláveis nessa base; sem comentários/reviews
registrados nos metadados consultados. Isso não atesta integração conjunta.

## 1. Bloqueador: recebimento do CNPJ anterior pode habilitar CE para o novo

**Onde:** troca de Cliente do B/L no Financeiro e solicitação de Desbloqueio de CE
no Portal.

A 846 determina que dinheiro verdadeiro pertence ao Cliente original: devolver,
confirmar a devolução e só então emitir a nova cobrança. Durante a espera,
`invoice_customer_changes.status='pending_refund'`; o recebível antigo continua
existindo, com seus settlements. `_apply_paid_basis_change` corrige o valor
exigível desse recebível para zero; `_finish_invoice_customer_change` só o torna
`void` e arquiva sua origem depois da devolução.

A última definição de `ce_unlock_private.item`, na migration 143 da 847,
considera pago todo recebível não `void` do B/L com status `settled`, saldo zero,
valor original positivo, settlement existente e liquidação maior ou igual ao
original menos correção. Não filtra `x.customer_id=b.customer_id`, não restringe
a origem vigente e não consulta a pendência de troca de Cliente.

Exemplo derivado do código: o Cliente A pagou R$ 100; o B/L passou para B; a
devolução está pendente. O recebível de A conserva R$ 100 de valor original e
settlement, com R$ 100 de correção e saldo zero. Ele satisfaz o teste de pagamento
da 847, embora B ainda não tenha sido cobrado/pago. Isso também ocorre com
recebimento parcial corrigido para zero. Sem pedido anterior ativo, o teste de
`can_submit` pode habilitar B. Cancelar um pedido antigo também pode abrir essa
janela. O bloqueio documental de pedido pertencente a outro Cliente não corrige
a origem financeira de um pedido novo.

**Recomendação:** preservar a decisão da 846 e adaptar a 847: exigir recebível
vigente do Cliente atual, bloquear troca financeira não concluída e avaliar os
requisitos novamente no envio, exportação, registro de envio e confirmação.
Não zerar ou transferir settlements antigos para contornar o bloqueio. Não
basta adicionar apenas um filtro visual. Antes de afirmar pagamento, definir
também o comportamento para ausência de recebível após o filtro.

Fontes: [transição financeira](https://github.com/luccafwlog/vela/blob/b676798c271aa067fc0a0efbc7aa8e12a5e0b54f/supabase/migrations/134_controles_financeiros.sql#L99),
[predicado financeiro do CE](https://github.com/luccafwlog/vela/blob/f482879034b27567ba3714e02100ec0c72e191c0/supabase/migrations/143_ce_unlock_review_fixes.sql#L15)
e trigger de saldo na migration 124 da base. Cenário identificado por análise
estática; não executado em PostgreSQL nesta revisão.

## 2. Bloqueador: números de migrations repetidos

| Versão | 845 | 846 | 847 |
|---|---|---|---|
| 134 | `134_portal_information.sql` | `134_controles_financeiros.sql` | `134_ce_unlock_workflow.sql` |
| 135 | `135_portal_information_review_fixes.sql` | — | `135_ce_unlock_document_integrity.sql` |

Os nomes são diferentes, portanto o Git não aponta conflito. A versão usada
pelo controle de migrations é o prefixo: a coleção precisa de versões únicas.
Um replay por nomes de arquivos não prova que a publicação por histórico do
Supabase será válida. `migrations:check` atualmente verifica operações
destrutivas; seu resultado não substitui a verificação de duplicidade.

**Proposta de sequência, condicionada ao histórico remoto:** 846 fica com 134;
845 passa para 135–136; 847 passa para 137–146, mantendo a ordem interna de seus
dez arquivos. Conferir antes se alguma versão já foi aplicada. As descrições das
PRs dizem que não houve implantação, mas o histórico remoto não foi consultado.
Atualizar referências e expectativas nos documentos/testes. Não renumerar uma
migration já aplicada e não consolidar correções sequenciais em um arquivo único.
Mudanças nesses arquivos protegidos precisam seguir a autorização do repositório.

## 3. Conflitos textuais: 845 × 847

`git merge-tree --write-tree` identificou nove arquivos com conflito. Os pares
845 × 846 e 846 × 847 não tiveram conflito textual.

| Arquivo | Resolução necessária |
|---|---|
| `src/AppPortal.tsx` | Manter rotas e preloads de Informações e Desbloqueio de CE; fallback por último |
| `src/components/layout/PortalLayout.tsx` | Manter ambos os itens de navegação, inclusive no Modo Inspeção |
| `src/services/queryKeys.ts` | Manter os objetos completos `portalInformation` e `ceUnlock`, com fechamento separado |
| `src/services/cacheEffects.ts` | Unir famílias de cache e preservar todas as funções de efeito das duas PRs |
| `src/services/portalRpcContracts.ts` | Unir os dois mapas de RPCs de Inspeção |
| `src/integration/portalInspectionParity.local-pg.test.ts` | Preferir a descoberta de assinaturas via `pg_proc` da 847 e testar também as RPCs da 845 |
| `CONTEXT.md` | Preservar os termos/regras de ambos os módulos |
| `docs/CHANGELOG.md` | Registrar ambas as entregas e seus limites |
| `docs/modules/clientes.md` | Preservar administração de Informações e ficha CE/VIP |

Na comparação, 845 e 847 alteram 18 arquivos em comum; nove foram mesclados
automaticamente. Conferir especialmente `AppInterno`, `PortalOperacao`, títulos,
documentação do Portal e CI. O resultado automático de `PortalOperacao` conserva
o link para solicitar CE; o CI conserva as suítes SQL de Informações e CE.
Não usar resolução global por um dos lados: ela remove funcionalidades válidas.

## 4. Atualização da fila CE após ações financeiras

Os hooks financeiros da 846 usam `afterBlInvoiceBasisAlterada`. A 847 adiciona
`ceUnlock` ao conjunto amplo `FINANCIAL_READ_KEYS`, mas aquela função continua
invalidando somente `INVOICE_BASIS_CACHE_KEYS`. A versão desse catálogo na 846
não contém `ce-unlock`.

**Efeito:** registrar/cancelar baixa, concluir devolução ou tentar reemitir pode
deixar a tela CE com requisitos antigos no mesmo cliente de cache. Os hooks de
CE refazem a consulta ao recuperar foco, e o banco revalida ações, mas isso não
garante atualização imediata na tela.

**Verificação local:** executei a implementação de `afterBlInvoiceBasisAlterada`
da 847 com o catálogo da 846 e um coletor de invalidações. Foram invalidadas 23
famílias; `ce-unlock` não estava entre elas.

**Recomendação:** incluir CE no efeito financeiro efetivamente usado pelos hooks;
preservar também os efeitos de Informações da 845 e os novos consumidores de
restituição/Demurrage da 846. Testar baixa, cancelamento e conclusão da troca de
CNPJ com consulta CE já aberta no mesmo QueryClient. Clientes/browser distintos
exigem refetch ou outro mecanismo de atualização; invalidação local não é broadcast.

## Decisões compatíveis que devem ser preservadas

| Tema | Contrato conjunto recomendado |
|---|---|
| Fatura emitida | Catálogo/tarifas atuais da 845 valem para cálculos aplicáveis e novas emissões; documentos históricos da 846 permanecem preservados |
| Restituição por redução normal | Excedente a devolver não equivale a dívida local: não bloquear todo CE por qualquer restituição; diferenciar da troca de CNPJ |
| Demurrage e avulsa | A 847 exclui essas dívidas do requisito de taxas locais; a 846 exige devolução de seus recebimentos antes da troca de Cliente. São controles de momentos distintos |
| COD | Diferença positiva pendente continua bloqueando CE; excedente por redução segue a regra financeira |
| VIP | Dispensa repetição anual de documentos; não dispensa pagamento nem entrega física, nem transfere documentos entre CNPJs |
| Portos | BRVIX/BRSSA/BRSUA são restrição de Devolução/Taxas Locais na 845; não aplicar esse filtro automaticamente à fila CE da 847 |
| Devolução | Depot/container da 845 e restituição bancária da 846 são operações diferentes; usar rótulos específicos nos manuais |
| Inspeção | Consultar ambos os módulos sem permitir mutações do Portal ou contornar escopo do Cliente |
| Confirmação externa | Mudança financeira posterior pode bloquear novas ações, mas não apaga o fato histórico do desbloqueio já confirmado |

Estas são recomendações de conciliação sustentadas pelas regras das PRs,
não novas decisões aprovadas nem alterações já implementadas.

## Ordem recomendada e condição para merge

1. Conferir o histórico de migrations e reservar versões únicas.
2. Integrar 846 primeiro, fixando a regra financeira de CNPJ.
3. Atualizar 845 sobre a base resultante, renumerar seu bloco e validar tarifas,
   Demurrage e preservação de documentos.
4. Atualizar 847 sobre ambas; resolver os nove conflitos, corrigir a elegibilidade
   na troca de CNPJ e a invalidação financeira. Repetir a verificação de conflitos,
   pois novas correções podem ampliar a sobreposição.
5. Validar a árvore integrada: docs, typecheck, lint, testes, build, migrations,
   catálogo RPC e replay SQL completo em banco descartável. Executar as suítes
   financeiras, `portalInformation`, `portalInspectionParity` e `ceUnlock` sem
   paralelismo de arquivos, conforme WORKFLOW.
6. Acrescentar cenários cruzados: troca de CNPJ com pagamento integral/parcial e
   devolução pendente; devolução concluída com reemissão falha; nova cobrança
   sem pagamento; novo pagamento; redução com excedente; consolidada com outros
   B/Ls; cancelamento de baixa; alterações em pedido CE já existente. Testar
   operações financeiras reais da fixture, sem usar só UPDATE com triggers desativados.
7. Conferir no navegador menu/rotas móveis, ambos os módulos em Inspeção,
   requisitos CE após ação financeira e preservação de documentos históricos.

Publicação é uma etapa posterior: migrations, Edge Functions da 847 e aplicações
compatíveis. O aceite de ZPT, PDF jurídico, Storage/gateway reais e expurgo
continuam pendências da 847; a revisão conjunta não os comprova.

## Limites da evidência

Foram lidos os heads das PRs, diferenças, migrations, hooks, serviços e regras
documentadas; simulados os três pares com o Git; e executada a verificação de
cache descrita acima. Não há funções SQL com o mesmo nome nas migrations novas
dos diferentes pares, segundo extração de declarações CREATE/ALTER FUNCTION;
isso não prova ausência de interação entre tabelas, triggers ou permissões.

Não executei replay SQL, testes de navegador ou build de uma árvore integrada:
a revisão não resolveu nem alterou as branches. PostgreSQL/psql não estavam
disponíveis neste ambiente. Os resultados de testes publicados nos corpos das
PRs são relatos individuais, não resultados produzidos por esta revisão.


Nota de integração — 2026-10-05: o bloco CE 134–143 foi renumerado para 137–146 antes da publicação; ver relatório de integração de 2026-10-05.
