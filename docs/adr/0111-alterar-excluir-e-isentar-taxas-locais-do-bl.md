# 0111 — Alterar, excluir e isentar as Taxas Locais do B/L

Status: aceito, implementada — 2026-10-28 (pedido e decisões do dono, D1 a D14, na
[spec aprovada](../archive/specs/2026-10-28-alterar-taxa-calculada-do-bl-design.md); R1 e
R2 aprovados no [plano](../archive/plans/2026-10-28-alterar-taxa-calculada-do-bl.md)).
Implementação em lotes: lote 1 na migration `491` (alterar, excluir, desfazer,
cobrança manual e Histórico das taxas); lote 2 na `492` (isenção à mão); lote 3
na `493` (B/L faturado); lote 4 na `494` (leituras fora da ficha); lote 5 na
`495` (aviso **Gravar mesmo assim**, prévias e alerta); a `496` só repõe a guarda explícita no invólucro de trava;
a `497` traz as correções da revisão da PR luccafwlog/vela#1080 (prévia do efeito na fatura na mesma ordem
da correção, guarda antes da leitura na cobrança manual, SOC/COC e container que passa a ser dividido na
simulação da decisão 12); a `498`, a taxa alterada que sai da cobrança quando
a quantidade vai a zero (decisão 12).

Supersede o item 11 da [ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md)
(excluir cobrança manual era só do Administrativo). Estende a
[ADR 0077](./0077-fatura-emitida-nao-muda-de-valor.md): a alteração no B/L
faturado passa pela correção automática da fatura, como qualquer correção do
B/L. Mantém a [ADR 0094](./0094-preco-fixo-na-importacao.md) (preço fixo da
importação): a alteração vale por cima do preço da tabela, fixado ou não.

## Contexto

O operador não tinha como cobrar de um B/L um valor diferente da Tabela de
Taxas Locais nem deixar de cobrar uma taxa. A saída era a Condição de Cliente
(vale para todos os B/Ls do Cliente e só o Administrativo cria) ou a cobrança
manual. Qualquer recálculo apagava o que se fizesse nas linhas do cálculo,
porque `charge_calculations` é refeita do zero pelo motor.

## Decisão

1. **Só Taxas Locais (D1).** A Demurrage continua com o Desconto dela.
2. **Alterar o valor por unidade ou pelo total, ou excluir a taxa; a quantidade
   não se altera (D2).** Valor zero não existe: para não cobrar, exclui-se.
3. **Todos os setores, com justificativa de ao menos 10 caracteres e sem
   aprovação (D3, D4).** A regra vale também para excluir cobrança manual. O
   banco confere usuário interno ativo, autor igual a quem está logado e a
   justificativa; as tabelas novas não aceitam escrita direta pela API.
4. **A alteração é do B/L sobre a taxa e sobrevive aos recálculos (D5).** Fica
   em `bl_charge_adjustments`, e o resolvedor das Taxas Locais a aplica em todo
   cálculo. Só se perde quando a tabela da taxa sai do B/L: troca de POD ou de
   modalidade descarta, com registro (R1: no B/L misto, só as alterações da
   tabela que saiu); preço refixado com tabela nova do mesmo escopo passa a
   alteração para a taxa de mesmo nome, base, perfil e moeda, e descarta a que
   não tem par (R2). Item desativado ou linha em revisão deixam a alteração
   guardada, sem descarte.
5. **Total alterado mantém o total quando a quantidade muda (D7)**, com evento
   no histórico; a alteração por unidade acompanha a quantidade nova.
6. **Rastreio no Vela (D10):** marca **Alterada**/**Excluída** na linha com o
   valor da tabela ao lado, bloco **Histórico das taxas** na própria página e o
   mesmo evento na aba Histórico da ficha. Desfazer é **Voltar ao valor da
   tabela** ou **Incluir taxa de novo**, também com justificativa.
7. **Portal (D9):** o Cliente vê só o valor final; a marca, o valor da tabela e
   a justificativa não saem do banco para o Portal.
8. **Vale só para aquele B/L (D11)** e continua com ele na troca de Cliente
   (D13).
9. **Isenção à mão (D12).** **Isentar Taxas Locais**, por qualquer setor com
   justificativa, põe o B/L no estado **Isento** que o sistema já trata, com o
   motivo "Isenção manual: <justificativa>". A decisão fica em
   `bl_local_charge_exemptions` e vale em todo recálculo, inclusive na troca de
   POD ou de modalidade; nada é cobrado, nem as cobranças manuais, e as linhas
   ficam como referência. Enquanto durar, nenhuma taxa se altera, exclui ou
   lança. **Retirar isenção** recalcula com as alterações e exclusões que o B/L
   tinha. Estende a regra de isenção, que até aqui só existia com prova
   positiva (veículo com Movement To LCL); a isenção pelo veículo vale primeiro.
10. **B/L faturado (D8).** Alterar, excluir, voltar ao valor da tabela,
   excluir cobrança manual, isentar e retirar a isenção valem também no B/L
   faturado, parcial ou pago. A fatura emitida não é editada: a ação grava a
   decisão nas linhas e chama a correção automática (origem
   `charge_adjustment`), que reemite a fatura sem pagamento, abate o saldo e
   abre Restituição na paga com valor menor, abre **Fatura desatualizada** na
   paga com valor maior (diferença por Fatura avulsa) ou deixa a correção
   pendente quando a reemissão não sai. Isentar com fatura sem pagamento cancela
   sem sucessora; com pagamento, todo o recebido vira Restituição. A
   confirmação diz o efeito antes de gravar
   (`preview_bl_charge_change_effect`, a mesma ação numa subtransação
   desfeita), e o evento do Histórico das taxas guarda o que a correção fez
   (**Efeito na fatura**). O **Recalcular** e o lançamento ou a edição da
   quantidade de cobrança manual continuam fechados no B/L faturado.
11. **Marca no item da fatura (D9).** O item emitido de linha alterada guarda a
   alteração em `snapshot_payload.charge_adjustment`; o detalhe da fatura no
   Vela mostra a Origem **Alterado**, e `portal_invoice_details` tira a chave
   antes de devolver o item ao Cliente.
12. **Aviso pelo tamanho do efeito (D6).** Antes de gravar uma mudança de
   base (POD, modalidade, peso, containers, marcas IMO/OOG, veículos), a tela
   pergunta ao banco o efeito nas taxas alteradas à mão
   (`preview_bl_charge_adjustment_impact`: a mudança e o recálculo numa
   subtransação desfeita, só para B/Ls com alteração ou isenção). Descarte, ou
   quantidade nova de taxa com total alterado, pede o **Gravar mesmo assim**
   (diálogo **Taxas alteradas à mão serão afetadas**); o resto só aparece na
   seção **Taxas alteradas à mão** das prévias. Confirmado, o aceite
   (`ack_bl_charge_adjustment_impact`) vale 30 minutos para aquele usuário e
   B/L; sem aceite, o mesmo efeito abre o alerta **Taxa alterada à mão mudou**
   (`taxa_alterada_mudou`, Administrativo com aviso ao Financeiro, fecha por
   **Resolver com justificativa**). Migration `495`.
   Quantidade que vai a zero (decisão do dono de 2026-10-28, na revisão da
   PR): a taxa sai da cobrança e a alteração fica guardada, voltando se a taxa
   voltar ao B/L; com total alterado, conta como quantidade nova (pede o
   **Gravar mesmo assim**; sem aceite, evento no Histórico das taxas e
   alerta). Exemplo: THD de 1 container alterado pelo total para R$ 800 e o
   container marcado IMO. Migration `498`.

## Consequências

- `charge_calculations` ganha a situação `excluded` (total zero, fora da
  fatura, do recebível e da emissão) e guarda o valor da tabela de cada linha.
- `resolve_bl_local_charge_items` passa a devolver o valor cobrado; o valor da
  tabela fica em `_resolve_bl_local_charge_items_table`.
- `delete_manual_bl_charge` troca de assinatura (exige justificativa); a
  antiga perde o `EXECUTE`.
- `_calculate_bl_local_charges_impl_106` passa a ser um invólucro (492) que
  aplica a isenção à mão sobre o cálculo da 491
  (`_calculate_bl_local_charges_impl_491`); `_quote_bl_local_charges` devolve
  `exempt` para o B/L isento à mão, e `add_manual_bl_charge` e
  `update_manual_bl_charge` recusam o B/L isento à mão.
- A 493 tira a recusa "B/L faturado" de `_lock_bl_for_charge_change_491` e
  marca a transação (`vela.bl_charge_change`); no B/L faturado o cálculo só
  atualiza as linhas gravadas (`_refresh_billed_bl_charge_lines`), sem apagar
  linha para a qual a fatura aponta. `_record_bl_charge_event` vira invólucro
  que aplica a correção (`_apply_bl_charge_change_to_invoice`).
  `delete_manual_bl_charge` tira a linha da cobrança antes do registro e só a
  apaga quando nenhum item de fatura aponta para ela.
- Ceiling conhecido: alterar uma taxa recalcula o B/L inteiro, que volta a
  **Provisório** as linhas que estavam **Pronto** — o mesmo efeito do
  **Recalcular**.
