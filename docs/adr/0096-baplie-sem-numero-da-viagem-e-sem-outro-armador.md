# 0096 — Baplie: contagem do trailer só avisa, número da viagem não é conferido e não há "outro armador"

Status: aceito — 2026-10-22 (decisões do responsável). Implementada na
migration `409` e no leitor e na prévia do Baplie.

Supersede parcialmente a [ADR 0095](./0095-importacoes-regras-da-revisao.md)
(decisões 13, 14 e 16) e, por ela, o item 21 da
[ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)
na parte do "outro armador".

## Contexto

O Baplie da COSCO do GREEN ITAPOA (arquivos 1.5 e 2.2, TDT com viagem
`260911000000`, operadores COS e COT) era recusado: o número de viagem do
armador não é o da Viagem no Vela, o 1.5 declara no UNT um segmento a menos do
que traz, e os 341 containers do operador COT saíam como "de outro armador" —
entre eles os 93 de Sepetiba, que sumiam da prévia.

## Decisão

1. **Contagem do trailer só avisa.** UNT ou UNZ com contagem diferente do que
   chegou é aviso; os containers lidos entram. Falta de UNT ou UNZ continua
   erro de arquivo (arquivo cortado).
2. **O número de viagem do Baplie não é conferido.** Nem a prévia nem
   `import_baplie_file_atomic` comparam o número do TDT com o da Viagem, e a
   confirmação "este Baplie é da viagem escolhida" deixa de existir. O nome do
   navio continua conferido; arquivo sem navio só avisa ("O arquivo não diz o
   navio").
3. **Não há regra de "outro armador".** Todo container do arquivo entra no
   staging, nas marcas e na conciliação, seja qual for o operador. Sai o campo
   "Códigos do armador no Baplie" de Nova Viagem/Editar.

## Consequências

- Os dois arquivos do GREEN ITAPOA importam inteiros (811 containers, BRVIX e
  BRSEP).
- Em navio compartilhado, container de outro armador aparece na conciliação
  como "No Baplie, sem B/L"; a operação desmarca o porto ou trata a divergência.
- `_baplie_other_carrier` passa a responder sempre falso. `carriers.baplie_codes`
  e `_baplie_carrier_codes` ficam sem uso até uma migration que os retire.
