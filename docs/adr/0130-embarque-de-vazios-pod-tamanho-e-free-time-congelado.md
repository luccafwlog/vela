# 0130 — Embarque de vazios com porto de descarga, Nº do manifesto da rota, preço por tamanho e free time congelado

Status: aceito — 2026-11-06 (decisões do dono sobre a
[revisão do Embarque de vazios](../archive/audits/2026-11-06-revisao-embarque-de-vazios.md)).
Implementada na migration `606`. Estende a
[ADR 0033](./0033-embarque-vazios-unidades-importadas-servicos-lancados.md) e
a [ADR 0113](./0113-embarque-de-vazios-opera-num-terminal.md).

## Contexto

A revisão de 2026-11-06 encontrou estas lacunas no Embarque de vazios:

- **Sem porto de descarga.** A Unidade embarcada não tinha porto de descarga
  (POD). As colunas `vazios_bookings.pol/pod` existiam desde a migration `053`
  e nada as gravava nem lia. A
  [spec do Manifesto Mercante](../archive/specs/2026-09-17-manifesto-mercante-design.md)
  já apontava que, sem porto, a rota de exportação dos vazios não fecha.
- **Sem preço por tamanho.** O catálogo real cobra armazenagem por tamanho de
  container (ZIRAN: 20' a R$ 1,58 e 40' a R$ 3,14 por dia). O banco só aceitava
  uma linha de armazenagem por (embarque, depot, condição), sem tamanho, e
  **Lançar armazenagem** escolhia ao acaso entre os dois serviços.
- **Free time lido na hora.** O free time vinha do cadastro em cada leitura.
  Trocar o free time de um depot mudava a armazenagem de todo embarque com ADR
  aberto.
- **Quantidades contadas à mão.** Handling e transporte eram contados à mão,
  embora saiam das unidades de cada local.
- **Embarque direto sem conferência de porto.** O Embarque direto aceitava
  terminal de outro porto.

## Decisão

1. **POD obrigatório.** Toda Unidade embarcada tem porto de descarga: coluna
   **POD** na planilha e campo na janela da unidade. O POD é gravado em LOCODE
   (o nome do porto também é aceito) e não pode ser o porto do embarque.
   O POL é o porto do embarque, gravado pelo banco.
2. **O Vela só registra o Nº do Manifesto Mercante.** Os vazios embarcam já
   manifestados. O Vela registra o número de cada rota de exportação (porto do
   embarque → POD) e não gera o EDI. O número fica no cadastro único de
   Manifestos Mercante (`manifestos_mercante`, natureza vazio), pela mesma
   gravação de **Rotas e Manifestos** (`set_voyage_route_ce_master`).
   Enquanto a rota tem unidade no Embarque, o número fica. A rota sem unidade
   perde o número, como na importação.
3. **Preço por tamanho.** O serviço do catálogo pode cobrar só um tamanho, 20'
   ou 40'; sem tamanho, vale para qualquer um. A linha recebe o tamanho do
   serviço. A armazenagem passa a ser única por (embarque, depot, condição,
   tamanho). A unidade conta na linha do seu tamanho quando o embarque tem
   essa linha; senão, conta na linha sem tamanho. O tamanho vem do tipo do
   container: 2 = 20', 4 = 40' (45G1 é 40' HC).
4. **Quantidade sugerida.** Para os serviços que não são armazenagem, a
   janela da linha sugere a quantidade pelas unidades do local, do tamanho do
   serviço quando ele tem um, e mostra a divisão por condição e por tamanho.
   A pessoa aplica com **Usar N**. Ninguém lança a linha por ela: o sistema
   não presume que o serviço aconteceu, como na ADR 0033.
5. **Free time congelado.** A linha de armazenagem guarda o free time do
   depot para a condição no momento do lançamento. Depois disso, mudar o
   cadastro não muda a linha. A linha lançada antes desta ADR, sem free time
   gravado, segue o cadastro.
6. **Terminal do porto.** O Embarque direto só sai de um terminal portuário
   do porto do embarque. O Depot continua sem porto.

## Consequências

- **No ADR de Saída**, o Embarque de vazios ganha:
  - o POD na listagem e o quadro **Vazios por porto de descarga** (unidades,
    TEU e Nº do Manifesto Mercante);
  - a rota da linha como "origem → destino" e o tamanho da linha;
  - rótulos que dizem o que contam: **Unidades com armazenagem**,
    **Embarque direto**, **Depots** e **Dias cobráveis**.

  O anexo lista só as unidades com dia cobrável, com os dias no depot, o free
  time e os dias cobráveis. Retratos fechados antes desta ADR continuam
  impressos como eram.
- **Mais uma coluna obrigatória.** A planilha de Unidades embarcadas passa a
  ter oito colunas, e o POD entra nas obrigatórias.
- **As gravações de unidade à mão mudam de assinatura.**
  `create_manual_vazios_booking` e `update_manual_vazios_booking` ganham
  `p_pod`. A assinatura antiga sai, então o SPA anterior não grava unidade à
  mão depois da migration.
- **Manifestos de exportação ficam fora de Vazios de importação.** O filtro
  **Manifesto Mercante** de **Vazios de importação** só oferece os manifestos
  com POD brasileiro. A rota de exportação para porto estrangeiro não é rota
  de importação.
- **Unidades antigas.** Unidade gravada antes da `606` sem POD continua até a
  próxima edição dela, que pede o POD. A produção não tinha Embarque de vazios
  em 2026-11-06.

## Alternativas consideradas

- **Gerar o EDI Mercante de exportação no Vela.** Rejeitada pelo dono: os
  vazios já estão manifestados quando embarcam.
- **Guardar o Nº da rota numa tabela própria do Embarque.** Rejeitada: o Nº de
  Manifesto Mercante tem um dono, `manifestos_mercante`. Uma tabela paralela
  daria dois números para a mesma rota de cabotagem, que é rota de exportação
  num porto e de importação no seguinte.
- **Decidir o tamanho da armazenagem pelo catálogo na hora da conta.**
  Rejeitada: a quantidade de uma linha lançada mudaria quando alguém mexesse
  no catálogo. As linhas do embarque decidem a divisão; o catálogo só decide
  a **Armazenagem a lançar**.
- **Lançar handling e transporte sozinhos.** Rejeitada: é o cálculo
  automático que a ADR 0033 tirou. A sugestão faz a conta, e a pessoa
  confirma.

Regra vigente: [Manifestos & EDI § `/embarquevazios`](../modules/manifesto-edi.md#embarquevazios),
[§ `/embarquevazios/depots`](../modules/manifesto-edi.md#embarquevaziosdepots)
e [Viagens § Agency Departure Report (ADR)](../modules/viagens.md#agency-departure-report-adr).
