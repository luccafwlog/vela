# Manual de faturamento, pagamentos e correções

Edição atualizada em 2026-10-04, após as correções locais e a inclusão autorizada da migration 135. **Esta edição não comprova implantação.** Use os novos procedimentos no ambiente publicado somente depois da aplicação conjunta de banco e telas. A integração bancária real não foi exercitada.

## 1. Quem faz e onde

| Ação | Onde | Responsável |
|---|---|---|
| Conferir Cliente/CNPJ, CE, carga e pendências | Ficha do B/L / Revisão | Documentação autorizada |
| Consultar documentos, saldo e recebimentos | Taxas Locais → detalhe da fatura | Equipe com leitura autorizada |
| Registrar pagamento manual local ou conciliar PIX local | Detalhe / Conciliação PIX | Administrativo |
| Emitir avulsa | Taxas Locais → Gerar fatura avulsa | Financeiro ou Administrativo |
| Autorizar restituição excepcional de avulsa/Demurrage | Detalhe → Restituição excepcional | Administrativo |
| Confirmar devolução já realizada no banco | Detalhe → Confirmar devolução | Financeiro ou Administrativo |
| Preparar cancelamento financeiro de B/L com pagamento | Detalhe → Ajustes pela correção do B/L | Administrativo |
| Cancelar baixa, fatura ou B/L; reativar B/L | Detalhe / Conciliação / ficha do B/L | Administrativo |
| Operar pagamento/desconto de Demurrage | Demurrage | Financeiro ou Administrativo, conforme a ação |
| Consultar e pagar documentos próprios | Portal Fwlog | Cliente autenticado |

## 2. Regras essenciais

- **Fatura é cobrança; baixa registra recebimento; recibo documenta o recebimento.** Confira o banco antes de registrar. Comprovante enviado pelo Cliente precisa de conferência.
- **Cancelar baixa** corrige um lançamento falso ou atribuído incorretamente. **Restituir** devolve dinheiro realmente recebido. Não use uma ação para substituir a outra.
- Total e itens emitidos ficam preservados. Confira o **saldo atual**, os ajustes e as restituições; o total original pode ser diferente do valor líquido recebido.
- Individual e consolidada podem representar os mesmos recebíveis. **Não some as duas como dívidas independentes.** Coberta significa quitação pela consolidada; Obsoleta indica que a consolidada perdeu validade por quitação individual.
- Cancelar uma fatura não cancela o B/L. Cancelar o B/L não executa transferência bancária. Excluir não substitui cancelamento.
- Um QR retirado da tela pode ter sido copiado antes. Confira PIX recebido em cobrança antiga antes de encerrar o caso.
- Uma restituição **Pendente** ainda não é dinheiro devolvido. Execute a transferência no banco, confira o favorecido e só depois confirme no Vela.
- Fechar alerta não paga, restitui, emite ou corrige nada. Encerre somente após resolver a causa.

## 3. Fluxo normal

1. Confira Cliente/CNPJ, viagem, carga, CE, cálculo e pendências do B/L.
2. Verifique a emissão individual. Consolide somente recebíveis elegíveis do Cliente correto. Leia a retenção quando a emissão não ocorrer.
3. Disponibilize a cobrança válida, com saldo e QR atuais.
4. Após conferir o recebimento no banco, concilie o PIX ou registre manualmente **valor, método, data e referência bancária única**. Use banco/conta/identificador da transação quando necessário para distinguir referências.
5. Confirme a baixa e reabra o detalhe: confira pagamento, saldo, B/Ls, individuais cobertas e restituições.
6. Emita o recibo quando houver quitação. Para documento restituído ou cancelado, o recibo serve como histórico do recebido e devolvido; confira o líquido.

## 4. Cobrança, pagamento e conciliação

| Situação | O que o usuário deve fazer | Resultado a conferir |
|---|---|---|
| Sem CE ou Cliente/CNPJ não reconciliado | Corrigir na ficha/Revisão. Não usar avulsa para contornar emissão das taxas locais | Vínculo correto e emissão liberada ou retenção identificada |
| Cálculo, condição do Cliente ou câmbio bloqueia emissão | Corrigir a causa indicada. Não usar câmbio estimado para encaixar pagamento | Cálculo elegível e conversão válida |
| Portal não pronto | Regularizar o Portal; se cabível, Administrativo concede a Liberação | Gate aberto e fatura emitida |
| CE existe e a fatura não saiu | Resolver a retenção; Administrativo usa Emitir fatura na ficha quando cabível | Uma cobrança válida, sem emissão duplicada |
| Reemissão pendente | Corrigir a causa e tentar reemitir pela ação disponível | Sucessora vinculada ou encerramento justificado |
| Serviço adicional eventual | Gerar avulsa para Cliente correto, com descrição/contexto exigidos | Cobrança adicional rastreável |
| Emissão em lote falhou | Consultar os documentos efetivamente emitidos antes de repetir | Repetir apenas as pendências |
| PIX com TXID e valor compatíveis | Importar, revisar e confirmar na Conciliação PIX | Uma baixa para a transação e saldo atualizado |
| TED/recebimento fora do extrato | Administrativo registra no detalhe, com referência única do banco | Valor verdadeiro e uma baixa no histórico |
| Pagamento parcial | Registrar só o recebido e cobrar o saldo restante | Saldo positivo; não presumir quitação |
| Sobrou R$ 0,01 | Regularizar o centavo pelo procedimento financeiro aplicável | Saldo efetivamente zerado |
| Recebimento manual local acima do saldo | Registrar o valor integral recebido; conferir o aviso e a restituição automática do excedente | Bruto correto, saldo zero e excedente Pendente |
| PIX divergente do valor da cobrança | Conferir QR/versão, extrato e documento; tratar a exceção | Associação autoritativa válida; não forçar candidata |
| TXID ausente, ambíguo ou sem candidata | Usar Pendências PIX; escolher candidata somente quando segura. Sem candidata segura, investigar com banco/Cliente | Destinação documentada, sem associação por mera semelhança de valor/CNPJ |
| Mesma linha/TXID reapareceu | Conferir o histórico antes de confirmar novamente | Uma única baixa |
| Baixa manual parece repetida | Conferir extrato e referência. Mesmo valor/método/data pode representar duas transações distintas | Uma baixa por referência bancária real |
| Timeout ou resposta perdida ao registrar | Conferir o histórico; se necessário, usar Tentar novamente, mantendo a tentativa congelada. Para corrigir dados após conferir, use Encerrar tentativa após conferir | Mesma chave/conteúdo; uma baixa. Referência já registrada exige conferir o lançamento existente |
| Tentativa antiga cuja baixa foi cancelada | Conferir o extrato e iniciar nova operação somente se cabível | Tentativa antiga não reaparece como sucesso |
| Uma linha invalidou o lote PIX | Corrigir/separar a linha e consultar o histórico antes de reenviar | Lote transacional; nenhuma baixa parcial de lote rejeitado |
| QR antigo de fatura cancelada foi pago | Conferir sucessora, Cliente, composição dos B/Ls e valor histórico | Aproveitamento somente quando compatível; excedente vira restituição |
| QR antigo após troca de CNPJ, composição ou quitação | Tratar como exceção com Financeiro/Administrativo | Não transferir o pagamento para outro Cliente por semelhança |
| Baixa falsa ou na fatura errada | Administrativo seleciona **Baixa a cancelar**, confere valor/data/ID, informa motivo e confirma. Depois registra/concilia corretamente, se necessário | Apenas a baixa escolhida desfeita; saldos recalculados |
| Banco bloqueou cancelamento de baixa | Conferir correções/restituições que dependem do recebimento | Preservar lastro; não apagar restituição para contornar a trava |

## 5. Alterações de B/L, valores e CNPJ

| Situação | O que fazer | Como o sistema trata |
|---|---|---|
| B/L corrigido sem pagamento | Corrigir os dados reais pelo fluxo autorizado e conferir reemissão | Cancela/reemite quando valor ou Cliente muda; nova emissão usa câmbio vigente |
| Edição não mudou preço nem Cliente | Conferir cálculo/documento | Não reemite por mudança sem efeito financeiro |
| Redução após pagamento local | Corrigir a base do B/L e conferir os ajustes | Preserva fatura, abate primeiro saldo e prepara restituição do que ultrapassar o saldo |
| Aumento após pagamento local | Conferir diferença aprovada e emitir avulsa para o complemento | Preserva recebimento/fatura original; não cria complemento automaticamente |
| Tabela/condição estava errada | Corrigir a regra futura; tratar a diferença emitida com Administrativo. Não basta editar tabela e presumir recálculo do documento | Fatura emitida não é sobrescrita. Redução de base e cancelamento têm ações próprias; complemento usa avulsa |
| Container compartilhado, viagem/POD, SOC/COC, IMO/OOG ou veículos alterados | Conferir todos os B/Ls afetados, inclusive vizinhos da viagem de destino | Rateio e correções podem alcançar outros B/Ls |
| Falha ao aplicar correção | Resolver a causa e usar Tentar aplicar correção | Pendência preservada; retry não duplica o ajuste |
| Avulsa ou Demurrage do B/L já recebeu dinheiro e o CNPJ precisa mudar | Primeiro autorizar devolução integral pelo fluxo excepcional e confirmar ao Cliente original. Depois corrigir o vínculo e emitir o documento novo para o novo Cliente | Troca fica bloqueada enquanto esses recebimentos não forem devolvidos; documentos anteriores conservam o Cliente original |
| CNPJ mudou sem recebimento | Vincular o Cliente correto e conferir cancelamento/reemissão | Nova cobrança para o novo Cliente |
| **CNPJ mudou após recebimento verdadeiro** | **Devolver ao Cliente original e emitir para o novo Cliente.** Financeiro executa a devolução e confirma com comprovante | Prepara restituição vinculada ao original; nova cobrança aguarda devolução. Documentos/pagamentos antigos são preservados; dinheiro não é herdado pelo novo Cliente |
| Troca de CNPJ dentro de consolidada | Conferir o B/L alterado, sua restituição e os demais B/Ls | Devolução atribuída ao B/L alterado; demais recebíveis preservados |
| Devolveu, mas nova fatura não saiu | Corrigir retenção cadastral/Portal e usar Tentar emitir para o novo Cliente | Devolução continua confirmada; reemissão permanece pendente até recuperação |
| Quer mudar a pessoa jurídica editando cadastro antigo | Usar o Cliente correto no vínculo do B/L | Não reutilizar cadastro de outra empresa para substituir devedor |

**Exemplo:** fatura de R$ 600 corrigida para R$ 500:

| Recebido | Saldo após correção | Restituição |
|---|---|---|
| R$ 200 | R$ 300 | R$ 0 |
| R$ 499,99 | R$ 0,01 | R$ 0 |
| R$ 550 | R$ 0 | R$ 50 |
| R$ 600 | R$ 0 | R$ 100 |

O documento original continua em R$ 600. O recibo distingue recebido, abatido, devolvido, pendente e líquido.

## 6. Cancelamento e restituição

| Situação | Procedimento | Resultado esperado |
|---|---|---|
| Baixa falsa gerou excedente automático ainda não devolvido | Administrativo confere que não houve recebimento nem devolução e cancela a baixa selecionada | Excedente pendente acompanha a reversão, com auditoria. Devolução já confirmada não pode ser retirada |
| Cancelar fatura sem recebimento/ajuste | Administrativo confere dependências e cancela com motivo | Documento cancelado preservado; conferir cobrança ativa e Portal |
| Individual pertence a consolidada aberta | Tratar primeiro a consolidada e conferir individuais | Banco impede cancelamento isolado inconsistente |
| Cancelar cobrança local com recebimento verdadeiro, inclusive parcial | Administrativo seleciona o B/L em Ajustes pela correção do B/L, justifica e usa Preparar cancelamento financeiro. Financeiro devolve e confirma; Administrativo cancela o B/L na ficha | Abate saldo e restitui o recebido desse B/L; demais B/Ls preservados. Preparar cobrança não cancela operacionalmente o B/L |
| Cancelar B/L integralmente pago | Administrativo cancela com motivo e confere a restituição gerada | Recebimento preservado; restituição integral pendente precisa ser devolvida e confirmada |
| Cancelar B/L com pendências locais/Demurrage | Resolver cada obrigação e dependência antes do cancelamento | B/L Cancelado e em leitura; não aceita novas faturas |
| Reativar B/L cancelado por engano | Administrativo usa Reativar e confere operação/faturamento | Faturas canceladas não são reativadas junto |
| Apagar CE para desfazer faturamento | Não usar; corrigir o documento pelo fluxo autorizado | Com fatura emitida, apagar CE é bloqueado |
| Restituição automática pendente | Financeiro confere origem/valor/Cliente original, devolve no banco e guarda comprovante. Em Confirmar devolução, informa referência, favorecido e data; confere e confirma | Devolução confirmada, auditada e refletida no líquido; botão não transfere dinheiro |
| Exceção de avulsa/Demurrage | Administrativo usa Restituição excepcional: valor, finalidade e motivo. Financeiro devolve e confirma | Valor limitado ao recebido ainda disponível, descontadas autorizações/devoluções anteriores |
| Cancelamento integral de avulsa/Demurrage com pagamento | Autorizar finalidade Cancelamento com devolução integral e devolver todo recebido disponível | Fatura cancelada após confirmação integral; recebimento e valores históricos preservados |
| Autorização excepcional errada, dinheiro ainda não devolvido | Administrativo usa Cancelar autorização e justifica; nova devolução exige nova autorização | Valor reservado liberado; histórico/motivo preservados. Ajuste automático de B/L segue sua origem e não é apagado por essa ação |
| Devolução confirmada por engano ou para conta errada | Abrir atendimento com Administrativo/Financeiro e suporte; preservar os dois comprovantes | Confirmação não pode ser apagada/reescrita. Exige apuração e regularização assistida, sem fabricar baixa falsa |
| Dinheiro já devolvido antes do registro | Administrativo autoriza o caso com motivo/evidências; Financeiro registra a devolução efetiva no fluxo aplicável | Valor/documento original e comprovante reconciliados; não cancelar baixa verdadeira |

## 7. Demurrage e recibos

| Situação | Procedimento |
|---|---|
| Pagar Demurrage | Conferir data e valor elegível no histórico. Registrar no fluxo de Demurrage/conciliação autorizado; quitação congela valor/data/câmbio |
| Pagamento de Demurrage parcial ou acima do valor elegível | Manter a exceção de conciliação e encaminhar ao Financeiro com extrato, documento, data e valor. O contrato de baixa de Demurrage exige quitação compatível; não usar avulsa fictícia ou alterar câmbio para encaixar o recebimento |
| Valor de cotação antiga | Conferir a janela de fotos financeiras aceitas. Valor fora da janela exige revisão; não alterar PTAX para encaixar comprovante |
| Desconto antes de pagar | Aplicar pelo fluxo de desconto, com justificativa/aprovação; desconto em USD antes da conversão. Desconto integral elimina QR de valor positivo |
| Ajuste/devolução depois de pagar | Usar Restituição excepcional no detalhe, com autorização do Administrativo e confirmação pelo Financeiro; não desfazer recebimento verdadeiro |
| Disputa aberta | Tratar a disputa. Régua de cobrança pausa; recálculo cambial pode continuar |
| Baixa de Demurrage falsa | Administrativo cancela pelo histórico, com motivo. Restituição que depende da baixa impede a retirada do lastro |
| Recibo local de fatura corrigida/restituída | Conferir bruto recebido, abatimento, devolvido, pendente e líquido. Pendência ainda não reduz o líquido recebido |
| Recibo de individual Coberta | Usar data e valores atribuídos aos B/Ls do documento; referência identifica a consolidada que recebeu |
| Recibo de Demurrage | Aguardar consulta das restituições antes de imprimir; conferir bruto, pendente, devolvido e líquido |
| Documento cancelado após devolução | Recibo registra o histórico do recebimento/devolução; não apresenta dinheiro devolvido como valor líquido retido |
| Baixa cancelada depois de emitir recibo | Registrar no atendimento que o recibo anterior ficou obsoleto; emitir documentação correta após conferir o caso |

Não há recibo de quitação para pagamento local parcial. Guarde os comprovantes bancários junto do atendimento; o Vela registra a confirmação declarada pelo responsável, sem verificar automaticamente a transferência no banco.

## 8. Encerramento do caso

Registre Cliente/CNPJ original e atual, B/L/viagem, faturas anterior/nova, emitido, recebido, saldo, restituição, datas, TXID/referência, motivo, responsáveis e comprovantes. Na consolidada, liste os B/Ls.

Encerre somente após conferir documento válido, saldo correto, uma baixa por recebimento, devoluções comprovadas, vínculos corretos, pendências resolvidas e visibilidade adequada no Portal. Permissão ausente ou confirmação errada deve seguir ao responsável/suporte com essas evidências.

Referências: [Faturamento](../modules/faturamento.md), [Conciliação PIX](../modules/reconciliacao-pix.md), [Demurrage](../modules/demurrage.md), [revisão inicial](../archive/audits/2026-10-04-revisao-fluxo-financeiro.md), [decisões implementadas](../archive/specs/2026-10-04-controles-financeiros-design.md) e [relatório de validação](../archive/reports/2026-10-04-correcoes-fluxo-financeiro.md).


### Saldo da nova cobrança após troca de CNPJ

O recebível original é arquivado como `void`, com pagamentos/settlements
preservados. A nova cobrança começa sem reaproveitar os recebimentos devolvidos
do Cliente anterior. Isso vale também se o B/L voltar ao mesmo CNPJ em uma
correção posterior. A baixa da nova fatura financia seu próprio recebível.
