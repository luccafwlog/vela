# ADR 0061 — Conciliação de cliente tem casa única: a Revisão

> **Nota editorial — 2026-09-18 · supersedida parcialmente.** A Revisão permanece dona da conciliação; captura de contato usa ensure_customer_contact_email e caixas, sem reintroduzir purpose como roteador.
> Rastreabilidade: [ADR 0064](./0064-caixas-de-comunicacao-e-auditoria-de-contatos.md); [migration ativa 008](../../supabase/migrations/008_portal_contact_boxes.sql).
> O texto original abaixo preserva o contexto da decisão; este cabeçalho delimita sua aplicação atual.

Status: supersedida parcialmente — 2026-08-31

## Contexto

A conciliação de cliente — decidir a qual cliente cadastrado pertence o nome/CNPJ
que veio no manifesto — hoje é decidida em dois lugares com efeitos diferentes:

- na **Revisão**, ao vincular o cliente ao B/L (`save_bl_review`), que sincroniza
  a fila de conciliação como efeito;
- na **Validação**, pelos botões Aprovar/Rejeitar da expansão do B/L
  (`approve_customer_reconciliation`), que além de vincular o cliente importa o
  e-mail do manifesto como contato financeiro e registra quem aprovou.

A Validação é a fila operacional de faturamento: o operador está ali para
entender por que um B/L não fatura, não para fazer cadastro de cliente. Decidir a
conciliação no meio dessa fila, sem a ficha do cliente à vista, é decidir com
menos informação do que a Revisão oferece — e produz dois caminhos com efeitos
distintos para a mesma decisão, sem que a diferença seja visível a quem clica.

## Decisão

- A conciliação de cliente é decidida **apenas na Revisão**. A expansão do B/L na
  Validação exibe o estado da conciliação (cliente do manifesto, CNPJ, sugestão,
  tipo de detecção) e aponta para a Revisão; não decide.
- A Revisão passa a produzir o efeito completo que a Validação produzia: vincular
  o cliente **e** importar o e-mail do manifesto como contato financeiro do
  cliente, quando houver.
- A remoção dos botões da Validação só ocorre **depois** que a Revisão fizer o
  efeito completo. Enquanto isso não acontecer, os botões permanecem: perder a
  captura do contato é regressão de produto, não simplificação de tela.
- A Revisão passa a aceitar endereçamento por B/L, para que o apontamento da
  Validação chegue ao item certo e não a uma fila para o operador procurar à mão.

## Consequências

- Some do produto um caminho de decisão; quem usava a Validação para conciliar
  passa a atravessar a Revisão, que exige mais contexto e entrega mais efeito.
- A fila de conciliação (`customer_reconciliation_queue`) continua existindo como
  registro e como fonte do que a Validação exibe; o que sai é a decisão sobre ela
  a partir daquela tela.

## Nota editorial — 2026-09-01

A decisão está executada. A condição que ela impunha para a remoção dos botões
foi cumprida antes dela: a migration `370` (issue #639, item 1) deu à Revisão o
efeito completo — vincular o cliente **e** capturar o e-mail do manifesto como
contato financeiro, pela mesma função que o Aprovar da Validação usava
(`capture_manifest_financial_contact`), com `approved_by` registrando o revisor.
O endereçamento por B/L (`/revisao?bl=`, item 2) saiu antes, na #640.

Com isso a expansão da Validação perdeu Aprovar/Rejeitar e passou a exibir a
conciliação com um link para a Revisão. Os wrappers de cliente das RPCs
`approve_customer_reconciliation` e `reject_customer_reconciliation` saíram
junto; as RPCs seguem no banco como registro e caminho do histórico, sem
consumidor no cliente.

## Relação com decisões anteriores

Estende a ADR 0006 (Revisão e reconciliação como gate financeiro), tornando
explícito que a decisão de conciliação pertence à Revisão. Não altera a ADR 0054
nem os motivos de bloqueio: um B/L sem cliente vinculado continua bloqueado pelo
mesmo motivo, mudando apenas onde o bloqueio é resolvido.
