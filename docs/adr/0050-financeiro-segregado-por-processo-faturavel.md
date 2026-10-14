# ADR 0050 — Financeiro segregado por processo faturável

Status: aceito — 2026-08-18

## Contexto

O menu Financeiro misturava o cadastro de valores de Taxas Locais com a
operação de invoices. A empresa tem dois processos faturáveis distintos:
Taxas Locais, de responsabilidade de Documentação, e Demurrage, de
responsabilidade de Equipamentos. Ambos emitem e liquidam invoices, mas não
compartilham persistência nem regras de cálculo.

## Decisão

- `/taxas-locais` é a operação de Taxas Locais: validação, invoices, ledger,
  pagamentos e impressão.
- `/taxas-locais/tabelas` é o cadastro de tabelas e overrides, com as abas
  Tabelas e Overrides. POD e modo de carga continuam filtros internos.
- `/demurrage` permanece a operação de Demurrage e `/demurrage/taxas` permanece
  seu cadastro.
- O dropdown Financeiro contém Taxas Locais, Demurrage e Conciliação PIX.
  Relatórios é um link de primeiro nível logo depois dele.
- `/faturamento` permanece como redirect compatível. `invoice`, `customer`,
  `tab=pendencias` e demais parâmetros são preservados; `tab=demurrage` segue
  para `/demurrage` e é consumido como seletor de módulo.
- A faixa agregada de Demurrage que existia na operação legada foi removida;
  `/demurrage` permanece a única superfície de métricas, emissão, pagamento e
  impressão desse processo.

"Departamento dono" descreve a responsabilidade do processo e não cria uma
nova barreira de leitura ou escrita. As policies, grants, RPCs e gates de
autorização existentes permanecem a fronteira efetiva.

## Consequências

O nome da tela passa a refletir a natureza da cobrança, enquanto os nomes de
services, componentes de billing, colunas e RPCs permanecem ancorados no
vocabulário do banco. Deep links antigos continuam abrindo a operação correta;
links de cadastro apontam diretamente para a sub-rota de tabelas.
