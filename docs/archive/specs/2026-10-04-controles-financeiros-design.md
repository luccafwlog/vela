# Controles do fluxo financeiro

Estado: implementação local concluída e validada. A nova migration foi incluída após autorização explícita do usuário em 2026-10-04. Nenhuma migration existente foi editada; nenhum ambiente publicado foi alterado.

## Decisões

- CNPJ de B/L com recebimento verdadeiro: devolver ao Cliente original, preservar pagamentos/documentos e emitir para o novo Cliente somente após a confirmação da devolução. A regra foi definida pelo usuário em 2026-10-04.
- A confirmação registra a declaração do Financeiro de que o dinheiro foi devolvido no banco; exige referência do comprovante, favorecido e data. Não executa transferência bancária.
- Baixas manuais pela tela exigem referência bancária e reutilizam chave e conteúdo após timeout. Uma referência não pode financiar dois pagamentos no caminho verificado. Uma tentativa cuja baixa foi cancelada não pode reaparecer como sucesso.
- Restituições excepcionais de avulsa e Demurrage exigem autorização do Administrativo, justificativa e lastro. Financeiro confirma a devolução. Cancelamento integral preserva recebimento/documento/câmbio e cancela a fatura após devolver o total recebido.
- Cancelamento financeiro de um B/L parcialmente pago abate seu saldo e prepara devolução do recebido, preservando os outros B/Ls de uma consolidada. O cancelamento operacional continua na ficha do B/L, pelo Administrativo.
- Recibos discriminam bruto, abatimento de saldo, devolvido, pendente e líquido. Individual coberta recebe data e valores atribuídos aos seus B/Ls, com referência à consolidada.

## Entrega implementada

A [migration 135](../../../supabase/migrations/135_controles_financeiros.sql) contém o SQL validado e autorizado. Ele inclui os contratos das telas já alteradas, autorização no banco, auditoria, preservação de documentos e recuperação de reemissão. O rascunho foi exercitado somente em PostgreSQL descartável.

A confirmação de CNPJ não desfaz a devolução caso a nova emissão encontre uma retenção: persiste `reissue_pending` e permite recuperação. O cálculo que será substituído ganha snapshot nos itens do documento original. Recebíveis anteriores são arquivados, mantendo seus settlements; o novo Cliente recebe um novo recebível sem pagamento herdado.

As APIs anteriores de registro de pagamento ficam compatíveis para os consumidores existentes; o controle de referência bancária é obrigatório no novo caminho usado pela tela. As APIs antigas não deduzem identidade bancária de valor/data/notas iguais: esses dados também podem representar recebimentos legítimos distintos. A conciliação PIX mantém seu controle próprio por TXID.

A antiga liquidação sem comprovante deixa de confirmar restituições. Escrita direta em `invoice_refunds` é retirada do papel autenticado; a leitura permanece autorizada. Devoluções confirmadas e a origem/valor das autorizações ficam protegidos por triggers.

## Validação e diretriz

Ver [manual preparado](../../operations/manual-financeiro.md), [revisão inicial histórica](../audits/2026-10-04-revisao-fluxo-financeiro.md) e [relatório final de execução local](../reports/2026-10-04-correcoes-fluxo-financeiro.md), distinguindo testes locais de implantação e banco real.
