# BR Code/Pix estático — conferência normativa

Data da conferência: 2026-09-10.

## Fontes primárias

- [Instrução Normativa BCB nº 769/2026](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?numero=769&tipo=Instru%C3%A7%C3%A3o+Normativa+BCB), que divulga o Manual de Padrões para Iniciação do Pix versão 2.10.0.
- [Manual de Padrões para Iniciação do Pix versão 2.10.0](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf), seções 2.5–2.6 e exemplo de QR Code estático.
- [Manual BR Code versão 2.0.1](https://www.bcb.gov.br/content/estabilidadefinanceira/spb_docs/ManualBRCode.pdf), tabela 1 e exemplo de estrutura TLV.

## Regras aplicadas

- O payload MPM é uma árvore TLV de ID, tamanho e valor, com pelo menos um Merchant Account Information na faixa 26–51 e GUI obrigatório.
- No Pix estático, o template 26 contém `00` (`br.gov.bcb.pix`) e `01` (chave Pix); `02` é infoAdicional e `03` é FSS quando usados. O txid não pertence ao template 26.
- O txid estático fica em `62-05`, usa `***` quando não há identificador, aceita apenas letras e dígitos no contexto Pix e tem limite de 25 caracteres.
- `54` é opcional, usa decimal sem expoente e possui limite de 13 caracteres no BR Code. `52`, `53=986`, `58=BR`, `59` e `60` são validados pelo decoder do subconjunto Pix emitido pela aplicação.
- O CRC usa polinômio `0x1021`, inicial `0xFFFF` e é calculado sobre o payload até `6304`, sem incluir os quatro nibbles do CRC.

## Evidência no repositório

`src/lib/pixDecoder.ts` implementa uma leitura TLV e CRC independente do
builder, com vetor oficial do Manual Pix (`...63041D3D`), rejeição de CRC
adulterado, txid inválido/longo e campo 05 indevido no Merchant Account.
`034_pix_static_payload_normative_fixes.sql` e `src/lib/pix.ts` mantêm o txid
somente em `62-05`, limitam-no a 25 caracteres e falham para valor que não cabe
em `54`. A integração local também executa o builder SQL e passa o resultado
pelo decoder independente.

O decoder cobre deliberadamente o QR Code Pix estático gerado pelo sistema;
QR Codes dinâmicos, compostos, Pix Automático e regras de consulta ao DICT
continuam fora desse contrato e não são declarados conformes por esta prova.
