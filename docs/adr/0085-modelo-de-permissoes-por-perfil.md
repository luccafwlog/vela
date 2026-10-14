# 0085 — Modelo de permissões por perfil

Status: aceito — 2026-10-14 (decisões do dono). Implementação pendente: a
correção de código de cada item está no
[plano do modelo de permissões](../plans/2026-10-14-modelo-de-permissoes-por-perfil.md).

Fixa a regra de partida das permissões dos cinco Departamentos internos
(Administrativo, Financeiro, Operações, Documentação e Equipamentos) e a lista
fechada das exceções. Supersede parcialmente as ADRs
[0045](./0045-inspecao-do-portal.md) (Histórico do console para Operações),
[0046](./0046-escrita-interna-global-com-rastro-obrigatorio.md) (lista de
exceções), [0071](./0071-ce-mercante-como-trava-de-exclusao.md) (item 9, quem
cancela a fatura), [0073](./0073-cadastro-usado-so-se-desativa.md) (item 6,
quem cancela a fatura) e [0077](./0077-fatura-emitida-nao-muda-de-valor.md)
(item 7 e exceções controladas: quem emite e quem autoriza a Restituição).
Confirma a leitura global da [ADR 0044](./0044-leitura-interna-global-departamento-restringe-escrita.md).
A matriz vigente, ação por ação, está em
[Segurança](../operations/seguranca.md#modelo-de-permissões-por-perfil).

## Contexto

A ADR 0046 (2026-08-13) abriu a escrita interna a todo Departamento ativo, com
rastro, e listou três exceções. Depois dela, ADRs, decisões em planos e
migrations foram acrescentando restrições, e algumas foram criadas sem
decisão nenhuma. Em 2026-10-14 o modelo não tinha um desenho único:

- a lembrança do dono era "todo perfil faz tudo, exceto cancelar faturas e
  registrar restituições"; nenhuma ADR dizia isso;
- o banco restringia por perfil cerca de 60 RPCs de escrita; parte tinha ADR,
  parte só um comentário de migration e parte nada;
- documentos vivos se contradiziam sobre quem cancela fatura, quem lança a
  Restituição, quem lê a Conciliação PIX e quem emite a avulsa;
- em quatro casos a tela escondia a ação, mas o banco aceitava a escrita
  direta pela API.

O inventário
([relatório](../archive/reports/2026-10-14-modelo-de-permissoes-por-perfil.md))
leu a definição mais recente de cada RPC, policy, grant e gatilho da cadeia
ativa, os gates da tela e as Edge Functions. Classificou cada restrição como
intencional (com decisão registrada), acidental (o código restringe sem
decisão), falha de segurança (a tela esconde, o banco permite) ou contradição
entre documentos. Cada falha de segurança foi refeita por um verificador
independente no Postgres 16 local, como o perfil citado. O dono decidiu os
casos em lotes por domínio.

## Decisão

### Regra base

1. **Escrita global com rastro.** Todo Departamento interno ativo escreve dado
   interno. Toda escrita registra o autor e o Departamento congelado no
   instante do evento; ações automáticas assinam `sistema`. A leitura interna é
   global (ADR 0044), salvo a área `/admin`.
2. **O autor é sempre quem está logado.** Nenhum perfil registra uma escrita em
   nome de outro usuário. Cai a exceção que deixava o Administrativo informar
   outro autor em quatro RPCs (migration `106`, `_assert_actor_is_caller`).
3. **Exceções da própria base** (união da ADR 0046 com a regra que o dono
   lembrava):
   - excluir registro operacional — Administrativo, com motivo e respeitando a
     Trava de exclusão;
   - provisionamento do Portal — Administrativo e Documentação;
   - `/admin` e administração de usuários — Administrativo, inclusive leitura;
   - cancelar fatura e Invoice de Demurrage — Administrativo;
   - baixa manual e registro da Restituição — Financeiro e Administrativo.

   Fora do Faturamento, a base não muda as exceções aceitas abaixo. Dentro do
   Faturamento, os demais Departamentos fazem todo o resto.

### Exceções aceitas

Qualquer restrição por perfil que não esteja nesta lista é acidental e se
corrige a favor da base.

| Ação | Quem | Motivo | Origem |
|---|---|---|---|
| Excluir registro operacional (viagem, escala, atracação, B/L, container, cadastro, taxa manual) | Administrativo, com motivo e Trava | "O registro prova que sumiu; não traz de volta." | ADR 0046; ADR 0071, itens 8 e 11 |
| Excluir veículo, unidade manual e linha de serviço de vazios (antes do ADR de Saída fechado), remover o CE Mercante sem fatura viva | Qualquer Departamento, com motivo | Aberturas decididas: custo interno sem Cliente, ou correção com a fatura ainda por emitir | ADR 0071, item 4; ADR 0078, itens 5 e 23 |
| Provisionar o Portal (convite, conta, Email de Recuperação, endereço bloqueado, análise) | Administrativo e Documentação | Única família de escritas cujo erro sai da empresa: convite ao e-mail errado expõe dado de um Cliente a outro, e o rastro não desfaz a exposição | ADR 0046 |
| Trocar o CNPJ do Portal | Administrativo | O mesmo motivo do provisionamento, com efeito maior | Plano arquivado de 2026-08-13 |
| `/admin` e usuários | Administrativo, inclusive leitura | Única exceção à leitura global | ADR 0046 |
| Cancelar fatura, Invoice de Demurrage e baixa | Administrativo, com motivo | Cancelar tira a fatura do Portal do Cliente; documento fiscal cancelado não se reativa | ADR 0071, item 13; item D1 abaixo |
| Baixa manual (fatura local e Invoice de Demurrage) e conciliar Pix | Financeiro e Administrativo | Registrar dinheiro que entrou no banco é trabalho do Financeiro | Itens D4 e D5 abaixo |
| Registrar a Restituição (confirmar a devolução com comprovante, favorecido e data) | Financeiro e Administrativo | Idem, para o dinheiro que saiu | ADR 0077, exceções controladas; item D2 abaixo |
| Liquidar Ajuste de COD | Financeiro e Administrativo | A liquidação do ajuste é ato do Financeiro | ADR 0051, decisão 3 |
| Preparar cancelamento financeiro de B/L em fatura paga | Administrativo | É um cancelamento parcial de fatura paga | ADR 0077, exceções controladas |
| Cancelar e reativar Viagem e B/L | Administrativo, com motivo | Não registrado na origem, que exige motivo e rastro | ADR 0071, itens 8 e 9 |
| Desativar e reativar Cliente, tarifa, Local, terminal e serviço | Administrativo | Não registrado na origem | ADR 0073, itens 4, 5 e 8 |
| Comunicados e edição de contatos e caixas | Administrativo, Documentação e Equipamentos | O Comunicado é redação operacional dirigida ao Cliente; o Financeiro fica fora por decisão | ADR 0060; nota de 2026-09-18 da ADR 0046 |
| Ligar a chave global de envio | Administrativo | Envio real em massa a Clientes é irreversível; a permissão de Comunicados sozinha deixaria três perfis ligá-lo | ADR 0059 |
| Conceder e revogar a Liberação de faturamento sem Portal | Administrativo | A Liberação é a decisão registrada que dispensa a trava do Portal | ADR 0070 |
| Responder, reabrir e anexar na Dispute de Demurrage | Equipamentos e Administrativo | Equipamentos é dono da disputa; o Administrativo responde como cobertura | Migration `081` (decisão R13 de 2026-09-23) |
| Informar PTAX | Financeiro, Administrativo e Equipamentos | Equipamentos opera a tela de Demurrage | Decisão do dono de 2026-09-29 (migration `110`) |
| Gravar a referência cambial (ROE) | Só o job do BCB e o Informar PTAX | O ROE decide o valor da Invoice de Demurrage | ADR 0083, item 14 |
| Intervalo da Régua de Cobrança | Administrativo | Para não virar decisão de cada operador | Spec arquivada de comunicação com Clientes (2026-08-27) |
| Gerir o Desbloqueio de CE (pedidos, documentos, exportação ZPT, conciliação) | Administrativo e Documentação | Aprova documento do Cliente perante a agência | Item D11 abaixo |
| Assinar e observar seção do ADR de Saída | Departamento dono; o Administrativo cobre | Responsabilidade, não permissão (ADR 0046); a cobertura fecha o ADR na ausência do dono, e o rastro mostra quem assinou | ADR 0046; item D13 abaixo |
| Desativar ou rebaixar o último Administrativo ativo; excluir perfil interno | Ninguém | Sem Administrativo ninguém abre `/admin`; o perfil é o autor gravado no rastro | ADR 0083, itens 2 e 3; ADR 0074 |

### Itens decididos neste lote

- **D1. Cancelar fatura** (local e Invoice de Demurrage): só Administrativo.
  Resolve a contradição entre o item 9 e o item 13 da ADR 0071 e o item 6 da
  ADR 0073, que diziam "o Financeiro cancela antes".
- **D2. Restituição.** Um único registro com dois passos. Autorizar (valor e
  justificativa, na avulsa e na Invoice de Demurrage) é de qualquer
  Departamento. Registrar a devolução é do Financeiro e do Administrativo.
  Quem autoriza pode cancelar a autorização enquanto pendente, com motivo.
- **D3. Emitir fatura fora do automático** (ficha do B/L, Validação, fatura
  consolidada, Invoice de Demurrage) e as correções da fatura emitida (Tentar
  reemitir, Tentar aplicar correção, Resolver fatura desatualizada): qualquer
  Departamento. A fatura avulsa já era de todos (ADR 0083, item 9).
- **D4. Baixa manual** (fatura local e Invoice de Demurrage): Financeiro e
  Administrativo. **Desconto de Demurrage**: qualquer Departamento, porque só
  altera o valor e não registra baixa nem Restituição.
- **D5. Conciliação PIX:** leitura para todos; conciliar (vincular, confirmar,
  tratar exceção, marcar recebimento Itaú) é do Financeiro e do
  Administrativo, como a baixa.
- **D6. Tarifas e acordos de Demurrage e taxas de Granito:** qualquer
  Departamento cria e edita, como as Taxas Locais (decisão R6 de 2026-09-23,
  "preços seguem editáveis por todos").
- **D7. Central de Informações do Portal:** qualquer Departamento publica.
- **D8. Reabrir ADR de Saída fechado:** qualquer Departamento, com motivo e
  registro no Histórico.
- **D9. Reverter omissão de escala:** qualquer Departamento, com motivo,
  simétrico a omitir.
- **D10. Reprocessar efeito de importação:** qualquer Departamento, como as
  importações (ADR 0078, item 10).
- **D11. Desbloqueio de CE:** leitura para todos, inclusive Equipamentos;
  gestão do Administrativo e da Documentação. Aceita a matriz que a spec do
  Desbloqueio chamava de proposta.
- **D12. Histórico do console do Portal:** Operações vê, como o resto do
  console (ADR 0083, item 18).
- **D13. ADR de Saída:** o Departamento dono assina; o Administrativo cobre
  qualquer seção.

### Falhas de segurança corrigidas a favor da regra

O banco aceitava pela API o que a regra decidida proíbe. Todas confirmadas por
execução no Postgres 16 local como o perfil citado; correção aprovada pelo
dono:

1. **Valores de cobrança.** Qualquer perfil ativo alterava os itens de uma
   Invoice de Demurrage emitida ou paga (`demurrage_invoice_items`) e os
   valores do cálculo de Taxas Locais do B/L (`charge_calculations`), que a
   emissão copia para a fatura. Só as RPCs passam a escrever essas tabelas.
2. **Contatos do Cliente.** Financeiro e Operações trocavam o e-mail do
   contato principal e criavam outro principal (`customer_contacts`),
   redirecionando Comunicados e Régua sem o histórico de contatos. Só a RPC
   passa a escrever a tabela.
3. **Situação financeira do B/L.** Qualquer perfil ativo marcava um B/L não
   faturado como faturado (`bls.financial_status`), e ele nunca seria
   cobrado. Só o faturamento passa a mudar a coluna.
4. **Exclusão direta.** O Administrativo apagava pela API a escala de
   exportação que "Excluir escala" recusa pela Trava, e navio, armador, porto
   e tabela sem uso, tudo sem motivo. A exclusão passa a existir só pela RPC.

## Alternativas rejeitadas

- **Base = ADR 0046 como estava:** cancelar fatura e registrar Restituição
  voltariam a ser restrições comuns, sujeitas a decisão própria.
- **Base = a regra lembrada, literal:** abriria a todos a exclusão, o
  provisionamento do Portal e a administração de usuários.
- Onde o dono contrariou a recomendação: emissão manual, consolidada e de
  Invoice de Demurrage só do Administrativo (D3, ficou qualquer Departamento);
  Central de Informações só do Administrativo e de Equipamentos para depots
  (D7, ficou qualquer Departamento); reabrir ADR de Saída só do Administrativo
  (D8, ficou qualquer Departamento com motivo).
- O dono revisou, no mesmo dia, a primeira resposta sobre baixa manual e
  Conciliação PIX ("qualquer setor") para Financeiro e Administrativo.

## Consequências

- A matriz em [Segurança](../operations/seguranca.md#modelo-de-permissões-por-perfil)
  é a única lista de quem faz o quê; os módulos apontam para ela.
- Uma restrição nova por perfil exige ADR. Sem ela, o revisor a trata como
  defeito.
- A correção de código é grande e toca RPCs, policies, gatilhos e telas;
  fica no [plano do modelo de permissões](../plans/2026-10-14-modelo-de-permissoes-por-perfil.md),
  com teste de RLS por perfil para cada falha de segurança.
- A tela continua a esconder o que o perfil não pode fazer, e o banco
  continua sendo a fronteira.
