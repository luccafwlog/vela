# 0115 — Pix do QR estático é do Vela e o Histórico de baixas lista cada baixa

Status: aceito — 2026-10-30 (pedido do responsável ao achar, no staging, um
Pix do Portal rotulado como ZPT e as baixas manuais fora do Histórico de
baixas). Implementada nas migrations `552` e `553`, na aba **Pix recebidos** e
na aba **Histórico de baixas** da Conciliação PIX.

Estende a [ADR 0100](./0100-todo-pix-recebido-fica-gravado.md): o Pix do QR
estático do Vela deixa o grupo "todo o resto" (decisão 2 da 0100) e ganha
origem e baixa automática próprias. Muda a granularidade do Histórico de
baixas descrita na identidade visual (lote 3), de uma linha por fatura e B/L
para uma linha por baixa e B/L.

## Contexto

Em 2026-10-30, no staging, o responsável deu duas baixas manuais parciais, uma
em cada B/L (R$ 2.469,00 na INV-2026-0002 e R$ 2.469,50 na INV-2026-0003),
consolidou o que sobrou (INV-2026-0005, R$ 1,50) e pagou a consolidada pelo
Portal. O Pix:

- apareceu em **Pix recebidos** com a origem **ZPT** e **Sem baixa**, e precisou
  de baixa manual;
- tinha o identificador `INV20260005`: o staging está com
  `app_settings.pix_provider = 'static'`, então o Portal mostra o QR estático,
  cujo identificador é o número da fatura sem pontuação (ou `VP…` nas versões
  seguintes de cobrança, ou `DEM…` na Invoice de Demurrage). A origem só
  reconhecia `VELA…` (cobrança Itaú); todo o resto com identificador virava
  "ZPT".

O staging e a produção consultam a **mesma conta Itaú**, com a mesma chave: a
produção também gravou esse Pix como "ZPT". As duas numeram as faturas do mesmo
jeito (`INV-2026-0001` existe nas duas, muitas vezes com o mesmo valor).

No **Histórico de baixas**, a tela lia as faturas pagas, cobertas ou
parcialmente pagas e mostrava uma linha por fatura e B/L, com a data da baixa
mais recente e o total pago da fatura. As duas baixas manuais sumiram (as
faturas viraram "Coberta pela consolidada", com o valor pago "—"), a
consolidada repetiu R$ 1,50 em cada B/L e o resumo dizia "3 faturas · R$ 1,50
pagos" para R$ 4.940,00 recebidos. Nada dizia se a baixa foi automática pelo
Itaú ou registrada à mão.

## Decisão

1. **Origem "QR estático do Vela".** O Pix cujo identificador tem o formato do
   QR estático que o banco monta (`INV` ou `DEM` seguido de dígitos, `VP` com 23
   hexadecimais) é do Vela, não da ZPT. A origem é pelo formato, calculada na
   leitura; os Pix já gravados mudam de rótulo sem reescrever linhas.
2. **Baixa automática onde o QR foi emitido.** Com o QR estático ligado neste
   ambiente (`pix_provider = 'static'`), o Pix do QR estático dá baixa sozinho
   pelos mesmos donos do extrato e da baixa automática: uma única fatura aberta
   para o identificador, valor exato da versão do QR (Taxas Locais), valor igual
   ao saldo (avulsa) ou dentro da janela das duas PTAX (Invoice de Demurrage). A
   baixa fica em nome da conta da baixa automática, com o identificador do Pix na
   referência bancária, e aparece como **Baixa automática**. Sem baixa segura
   (fatura já paga, valor diferente, mais de uma fatura), o Pix fica **Sem
   baixa** com o motivo gravado, sem Alerta, e o operador baixa pela aba se
   quiser.
3. **Com a cobrança Itaú ligada, nunca sozinho.** Em produção
   (`pix_provider = 'itau'`), o Pix do QR estático fica **Sem baixa**, com o
   motivo dizendo que o QR pode ser do staging. A baixa automática por número
   de fatura acharia, na produção, a fatura de mesmo número e valor de um teste
   do staging.
4. **Uma linha por baixa e B/L.** O Histórico de baixas lista cada baixa que
   existe (pagamento de fatura de Taxas Locais ou avulsa e Invoice de Demurrage
   paga), em qualquer situação da fatura. Na consolidada, cada B/L tem a linha
   com o que aquela baixa liquidou nele; a fatura coberta pela consolidada
   continua mostrando as baixas que recebeu antes. Situação e saldo são os
   atuais da fatura. O resumo conta baixas e soma o que elas puseram nos B/Ls.
5. **Forma da baixa.** Coluna e filtro **Forma da baixa**: **Automática
   (Itaú)**, **Pelo extrato**, **Manual** (inclusive a baixa de um Pix recebido
   escolhida pelo operador) e **Isenção** (Invoice de Demurrage com desconto
   integral). A forma é decidida no banco (`list_payment_history`), que lê a
   conta da baixa automática, a origem no ledger e os recebimentos do Itaú.
6. O número da fatura abre o detalhe com a baixa da linha escolhida para
   cancelamento, não mais a mais recente da fatura.

## Consequências

- O Pix pago no QR estático deixa de exigir baixa manual no staging; em
  produção nada muda na baixa, só o rótulo do Pix de teste do staging.
- Pix de terceiro que use `INV` ou `DEM` com dígitos na mesma chave apareceria
  como QR estático do Vela; só ganha baixa se casar uma única fatura aberta
  deste ambiente, com o valor exato, e só com o QR estático ligado. Separar de
  vez exige identificador por ambiente no QR estático ou contas Itaú distintas
  (ponytail na migration `552`).
- O staging com a cobrança Itaú ligada emitiria cobranças `VELA…` reais na
  conta da produção, e cada Pix delas iria para análise com Alerta na
  produção ("TXID do Vela sem cobrança"). Ligar o Itaú no staging é decisão do
  dono, fora desta ADR.
- O Histórico de baixas e a planilha ganham linhas: uma consolidada paga por uma
  baixa tem uma linha por B/L, e cada baixa parcial tem a sua. A planilha ganha
  **Forma da baixa**, **Referência bancária** e **Valor da baixa**.
- A leitura do histórico passa a ser uma RPC; filtro, ordem e página continuam
  no navegador sobre a lista inteira (ponytail na migration `553`).

Regra vigente em [Reconciliação PIX](../modules/reconciliacao-pix.md).
