# 0126 — Consulta de CNPJ na BrasilAPI no Novo cliente

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
   trocar de CNPJ, o que a consulta anterior pôs e ninguém mexeu é trocado ou
   limpo. Situação diferente de ATIVA aparece no texto sob o CNPJ; não recusa.
6. **Uma consulta por CNPJ na sessão** (cache do React Query, sem nova
   tentativa automática).

## Consequências

- Sem conta, sem segredo e sem custo; o limite de uso da BrasilAPI não é
  publicado. ponytail: sem cache no servidor nem limite por usuário; se o uso
  bater no limite do fornecedor, guardar a resposta por CNPJ no servidor ou
  trocar por um fornecedor com plano pago, só em `_shared/cnpjLookup.ts`.
- A base pública da Receita pode estar atrasada e vem em maiúsculas sem
  acento; o operador confere antes de cadastrar.
- A Revisão (cadastro do Cliente a partir do B/L) não usa a consulta; pode
  passar a usar o mesmo hook (`useCnpjLookup`).
