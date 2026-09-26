# 0073 — Cadastro de referência usado só se desativa

Status: aceito — 2026-09-24. Implementado em 2026-09-25 (ver nota).

> **Nota de implementação — 2026-09-25.** Implementada nas PRs
> luccafwlog/vela#763, #767 e #768 (migrations 087, 088, 091 e 092), aplicadas
> em produção. Tarifa usada só se desativa: um trigger por tabela recusa a
> exclusão com mensagem legível; item e override ganharam Desativar; mudar o
> estado ativo é do Administrativo. Cliente com CNPJ volta bloqueado em
> `delete_records` ("desative em vez de excluir"); `deactivate_customer`
> corta o Portal (`current_portal_customer_id`) e o B/L com CNPJ de cliente
> desativado vai para a Revisão. Desvio aceito: tarifa e acordo de Demurrage
> contam como usados quando já estão em vigor, porque o cálculo não guarda o
> id da tarifa. Pendente: verificação por papel no Preview; ver o
> [plano da política de exclusão](../plans/2026-09-24-politica-de-exclusao.md).

Complementa a [ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md), que
trata dos dados de viagem, para os cadastros que a operação usa como
referência. Usa o vocabulário de `CONTEXT.md` ("Ações sobre registros").

## Contexto

A [revisão da exclusão de dados](../archive/audits/2026-09-24-revisao-exclusao-de-dados.md)
mostrou tarifas com regras diferentes: tabela de Taxas Locais só se inativa;
item e override só se excluem, com botão para qualquer usuário e banco
restrito ao Administrativo (achado A1); tarifas e acordos de Demurrage têm
Ativo e Excluir lado a lado; excluir uma tarifa de Granito tira a referência
das cobranças que ela gerou, sem bloqueio. O valor faturado não muda, porque
é congelado na emissão (ADR 0038), mas a origem dele se perde.

## Decisão

1. **Tarifas** (tabela e item de Taxas Locais, override de cliente, tarifa
   e acordo de Demurrage, tarifa de Granito): excluir só a que nunca foi
   usada em cálculo; a que já foi usada só se desativa. Desativada, não entra
   em cálculos novos e continua explicando os antigos.
2. O banco bloqueia a exclusão de tarifa usada em todos os casos, inclusive
   Granito, e a tela traduz o bloqueio numa mensagem legível.
3. Item de taxa e override de cliente ganham a ação Desativar.
4. Excluir, desativar e reativar tarifas é do Administrativo; os demais não
   veem essas ações.
5. **Cliente** segue a mesma regra: excluir só o que não tem B/L, fatura,
   comunicação nem disputa, numa operação única no banco que leva contatos
   e overrides (achados A1 e A2); com histórico, Desativar. As duas ações são
   do Administrativo. Ter conta do Portal provisionada conta como uso: os
   eventos de provisionamento são somente inclusão, e o cliente com CNPJ só
   se desativa (decidido em 2026-09-24, na implementação da Fase 2).
6. **Cliente desativado** sai das listas de escolha e perde o acesso ao
   Portal. Desativar é bloqueado enquanto houver fatura ou recebível em
   aberto: o Financeiro quita ou cancela antes. Um B/L novo com o CNPJ de
   cliente desativado não se vincula sozinho: entra na Revisão com esse
   motivo, e o Administrativo decide se reativa.
7. **Convite do Portal** se revoga ("Revogar convite"), não se cancela.
8. **Local, terminal, depot e serviço do depot** seguem a regra do item 1,
   com as ações do Administrativo; "Inativar" passa a Desativar e o bloqueio
   do banco vira mensagem legível.
9. **Navio, porto e armador** continuam sem ação de excluir ou desativar na
   tela; erro se corrige. Se um dia ganharem essas ações, seguem o item 1.

## Consequências

- **Positivas:** todo valor cobrado mantém a origem; some o falso sucesso de
  exclusão em Taxas Locais.
- **Negativas / custos:** item e override precisam de estado ativo; a FK da
  tarifa de Granito deixa de zerar a referência; tabelas que hoje qualquer
  usuário ativa ou desativa passam ao Administrativo; cliente ganha estado
  desativado e a sessão do Portal passa a depender dele.
