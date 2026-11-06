# 0127 — Consulta de CNPJ na BrasilAPI no Novo cliente

> **Situação atual (2026-11-06).** Estendida a pedido do dono: na Revisão, o
> CNPJ já cadastrado vira o vínculo ao Cliente existente e a Receita só é
> consultada para CNPJ sem cadastro; o botão de cadastrar espera a resposta da
> consulta (a Edge Function desiste em 6 s), porque o cadastro feito durante a
> busca saía sem o perfil da Receita. **Completar pela Receita**, em Clientes,
> só para o Administrativo, preenche os campos vazios dos Clientes cadastrados
> antes desta ADR, pela mesma função e com o Histórico do Cliente. Regras em
> [Clientes](../modules/clientes.md#completar-pela-receita).

Status: aceito — 2026-11-05 (pedido do dono). Implementada na Edge Function
`cnpj-lookup`.

## Contexto

No **Novo cliente** a equipe digitava à mão razão social, nome fantasia e
endereço, que saem na fatura. Esses dados são públicos na Receita Federal. Em
2026-11-05 o dono pediu que o cadastro os buscasse pelo CNPJ e escolheu a
BrasilAPI (`brasilapi.com.br`): gratuita, sem conta nem chave, com a base
pública da Receita e o CNPJ alfanumérico aceito no endereço da consulta.

## Decisão

1. **Pela Edge Function, não pelo navegador.** A CSP do Vela só libera
   `connect-src` para o próprio Supabase e serviços listados; abrir a
   BrasilAPI no navegador ampliaria essa lista. A função `cnpj-lookup` faz a
   chamada, e trocar de fornecedor muda só `_shared/cnpjLookup.ts`.
2. **Só equipe interna.** A função exige sessão com perfil interno ativo
   (`portal_current_role`); conta do Portal e sessão anônima recebem 403.
3. **Lista positiva.** A resposta leva só razão social, nome fantasia, CEP,
   endereço numa linha, cidade, UF e situação cadastral. Sócios, telefone e
   e-mail da Receita não passam.
4. **Nunca bloqueia o cadastro.** Fornecedor fora do ar, lento (mais de 6 s),
   com limite ou com resposta estranha vira `indisponivel` com HTTP 200: a
   tela avisa e o operador preenche à mão. A queda do fornecedor não vai ao
   Sentry como erro do Vela; o log registra o motivo, sem o CNPJ.
5. **Só campos vazios.** A tela preenche o campo vazio ou que ainda guarda o
   valor de uma consulta anterior; o que o operador digitou não muda. Ao
   trocar de CNPJ, o que a consulta anterior pôs e ninguém mexeu é limpo na
   hora, antes da nova resposta: cadastrar nesse intervalo não grava o CNPJ
   novo com o endereço do anterior. Situação diferente de ATIVA aparece no texto sob o CNPJ; não recusa.
6. **Uma consulta por CNPJ na sessão** (cache do React Query, sem nova
   tentativa automática).

## Consequências

- Sem conta, sem segredo e sem custo; o limite de uso da BrasilAPI não é
  publicado. ponytail: sem cache no servidor nem limite por usuário; se o uso
  bater no limite do fornecedor, guardar a resposta por CNPJ no servidor ou
  trocar por um fornecedor com plano pago, só em `_shared/cnpjLookup.ts`.
- A base pública da Receita pode estar atrasada e vem em maiúsculas sem
  acento; o operador confere antes de cadastrar.
- Na Revisão (grupo da Revisão e **Completar cadastro** na ficha do B/L em
  revisão, 2026-11-05, pedido do dono) a consulta vale para o CNPJ aceito
  pelo formulário (um dos lidos no B/L) e só para Cliente novo. A razão
  social já vem do manifesto: vazia, recebe a da Receita uma vez por CNPJ;
  diferente (sem contar caixa, acento e pontuação), aparece "Na Receita: …"
  com **Usar a razão social da Receita**, sem troca automática
  (`src/components/review/ReceitaNameNote.tsx`). O formulário da Revisão
  não tem campos de endereço: o nome fantasia, o endereço, a cidade, a UF e
  o CEP da Receita aparecem no mesmo aviso e vão em `p_profile` de
  `complete_review_customer_group` (migration 596, mesmo dia), que os grava
  só no Cliente que ela cria; o já cadastrado não muda.
