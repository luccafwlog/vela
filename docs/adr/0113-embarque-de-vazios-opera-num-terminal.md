# 0113 — O Embarque de vazios opera num terminal

Status: aceito — 2026-10-30 (decisão do dono: "Cada embarque de vazios tem um
terminal onde ele vai operar. É preciso, na hora de criar o embarque de vazios,
atrelar qual terminal ele está sendo operado. E isso tem que conversar
diretamente com a frente de operação e com a ADR. Isso é obrigatório.").
Implementada na migration `520`.

Estende a [ADR 0109](./0109-frente-de-operacao-exige-terminal-ate-o-ata.md)
(o terminal é da frente de operação) e a
[ADR 0033](./0033-embarque-vazios-unidades-importadas-servicos-lancados.md)
(o Embarque de vazios, um por escala). Mantém a
[ADR 0082](./0082-governanca-documental-dono-unico-e-adr-historica.md): o
terminal continua tendo um dono só, a frente.

## Contexto

O Embarque de vazios era gravado só com Viagem e porto. O terminal onde os
vazios embarcam é da frente de operação **Vazios EXP** da escala, que nasce da
declaração de exportação e pode ficar em TBC até o ATA. Nada ligava o embarque
a essa frente: dava para criar o embarque, importar unidades e lançar custos num
porto sem a frente Vazios EXP. Nesse caso a seção **Embarque de vazios** não
caía no ADR de Saída de terminal nenhum, e a trava do ADR fechado não pegava o
embarque quando só os ADRs por terminal estavam fechados. A tela também não
mostrava terminal nenhum.

## Decisão

1. **O embarque opera num terminal, e ele é obrigatório na criação.** A janela
   **Novo embarque** pede **Terminal** junto da Viagem e do porto. O banco
   recusa embarque novo sem a frente Vazios EXP com terminal na escala.
2. **O terminal é o da frente Vazios EXP.** O embarque não ganha coluna de
   terminal. Se a frente já tem terminal, o embarque usa esse, e a janela não
   oferece outro: a troca é na edição da escala. Se a frente está em TBC ou não
   existe, o terminal escolhido vai para ela pela mesma gravação da escala, que
   cria a frente, a Atracação e o ADR de Saída do terminal e aplica as travas
   de ADR fechado e de ATA.
3. **Com embarque na escala, a frente Vazios EXP fica.** Ela não volta para TBC
   nem sai (tirar vazios da exportação ou excluir a escala), enquanto o
   embarque existir. Trocar o terminal da frente continua valendo; o embarque e
   o ADR de Saída acompanham.
4. **Embarque antigo sem terminal continua.** A tela mostra **Sem terminal** e
   pede o terminal, que vai para a frente pelo mesmo caminho da criação. A
   migration não apaga nem reescreve embarque.

## Consequências

- O embarque sempre cai no ADR de Saída de um terminal, e a trava do ADR
  fechado sempre o alcança.
- A primeira importação de planilha de unidades numa escala sem embarque e sem
  frente com terminal é recusada; na tela a importação acontece dentro de um
  embarque já criado.
- Um porto sem terminal portuário ativo no cadastro de Locais não recebe
  embarque até o terminal ser cadastrado.
- Continua um embarque por escala e, portanto, um terminal por escala para os
  vazios de exportação. Vazios de uma escala embarcando por dois terminais
  exigiriam outra decisão.

Regra vigente: [Manifestos & EDI § `/embarquevazios`](../modules/manifesto-edi.md#embarquevazios)
e [Viagens § Escala, Atracação e datas](../modules/viagens.md#escala-atracação-e-datas).
