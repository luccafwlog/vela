# 0124 — Veículo LCL na Demurrage: free time de 30 dias e cobrança suspensa

Status: aceito — 2026-11-05 (decisão do dono). Implementada na migration `593`.

## Contexto

O B/L de veículo LCL (modalidade container, com veículo e Movement To com
`LCL` ou `CFS`) já tinha duas regras próprias: as Taxas Locais isentas
([Taxas Locais § Movimento e Isenção](../modules/taxas-locais.md#movimento-e-isenção-de-taxas-locais))
e o Desbloqueio de CE só com o B/L original ([0118](./0118-desbloqueio-do-veiculo-lcl-so-com-o-bl-original.md)).
Na Demurrage ele seguia a regra de qualquer container: free time do B/L, do
acordo do Cliente ou da tarifa, e a Invoice emitida sozinha quando o grupo
voltava todo.

O dono definiu, em 2026-11-05, que os B/Ls e containers de veículo LCL têm
sempre free time fixo de 30 dias e, por padrão, ficam isentos da cobrança de
Demurrage, salvo emissão manual pelo operador. Perguntado, detalhou: o free
time de 30 dias é o que o Cliente vê; se o operador decidir cobrar, o cálculo
usa os 30 dias; a cobrança já nasce suspensa e só acontece pela mão do
operador. Para o Cliente, muda só o free time de 30 dias, e não aparece
Invoice de Demurrage que o operador não tenha emitido. Para ver e cobrar esses
casos, escolheu uma divisão nova, Veículo LCL, na aba Containers.

## Decisão

1. **Quem é veículo LCL.** A mesma regra da isenção das Taxas Locais, lida dos
   dados atuais do B/L (`_bl_is_lcl_vehicle`): modalidade container, ao menos
   um veículo no B/L e Movement To com `LCL` ou `CFS`. Sem Movimento declarado
   não é LCL (prova positiva).
2. **Free time fixo de 30 dias.** Vale acima da condição do B/L, do acordo do
   Cliente e da tarifa, no cálculo da Invoice, na classificação da aba
   Containers, no status gravado do container, na aba B/Ls do Portal e na
   Consulta de container do site. As diárias P1/P2 e as faixas seguem a
   precedência de sempre. A Condição de Demurrage do B/L recusa free time
   próprio no B/L de veículo LCL e continua aceitando as diárias.
3. **Cobrança suspensa.** O container de veículo LCL passado dos 30 dias não
   entra em nenhuma emissão automática (gravação de datas, CE, troca de
   Cliente, rotina de 15 minutos). Fica na divisão **Veículo LCL** da aba
   Containers, fora de Correndo, A emitir, Esperando e Travado, dos cartões em
   US$, de Por Cliente, da Exposição, da planilha do armador e do Alerta de
   Demurrage travada. A divisão mostra o US$ se cobrado e, com tudo devolvido,
   o **Gerar Invoice**, com confirmação. Sem Cliente, sem tarifa, sem CE ou com
   o Gate do Portal fechado, mostra o que falta para cobrar.
4. **Container dividido.** A suspensão vale quando todo B/L ativo do mesmo
   Cliente com o container na Viagem é de veículo LCL. Container que divide B/L
   com outra carga do Cliente é cobrado como sempre; o free time segue o B/L da
   linha que a emissão escolhe (âncora primeiro), como a condição do B/L. No
   grupo misto, a emissão automática e o **Gerar Invoice** em A emitir cobram
   só os outros containers, o que a linha mostra; o de veículo LCL vai para a
   divisão Veículo LCL, onde o Gerar Invoice o cobra (autorizado pelo dono em
   2026-11-05, depois da revisão da PR).
5. **Depois do Gerar Invoice.** A Invoice emitida à mão é uma Invoice como as
   outras (Régua, Portal, baixa, Disputa). Cancelada pelo sistema (datas, SOC,
   divisão do container, troca de CNPJ), é reemitida sozinha, porque o
   operador já decidiu cobrar. Cancelada à mão, o container volta a esperar o
   Gerar Invoice na divisão Veículo LCL.
6. **Cancelar o B/L.** O container de veículo LCL com a cobrança suspensa não
   segura o cancelamento do B/L ("Demurrage correndo ou a emitir" nem
   "Demurrage travada"). Cancelado, o B/L sai da aba.
7. **Dispensa.** O container de veículo LCL também pode ter a cobrança
   dispensada, o que o tira da divisão Veículo LCL.

## Consequências

- A regra de quem é veículo LCL agora vive em três lugares no banco: o cálculo
  das Taxas Locais, `ce_unlock_private.documents_dispensed` (0118) e
  `_bl_is_lcl_vehicle`. Mudar a isenção do veículo exige mudar os três.
- O status gravado passa a reagir também a Movement To, modalidade e veículos
  do B/L (gatilhos da `593`). Os containers de veículo LCL ainda fora em
  2026-11-05 passam a contar 30 dias na próxima gravação ou na rotina diária
  do status; Invoices já emitidas não mudam.
- A ficha do B/L e a ficha do Cliente repetem a regra na prévia do navegador
  (`src/services/demurrage/lclVehicle.ts`); a classificação do banco é quem
  decide.
- Depois de 30 dias o container aparece em atraso no Portal e na Consulta de
  container, como qualquer container fora do free time; o que não aparece é
  Invoice.
