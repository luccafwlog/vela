# Plano — pendências da frente financeira

Estado: vivo, aguardando as decisões abaixo. Origem: o
[plano de correções da frente financeira](../archive/plans/2026-10-21-correcoes-frente-financeira.md),
executado na PR luccafwlog/vela#1019 (migrations `354` a `377`), com as
decisões da [ADR 0093](../adr/0093-tabela-vinculada-ao-bl-e-coerencia-financeira.md).
Os itens daqui não foram alterados no código: dependem de uma regra que o
responsável ainda não decidiu.

## Itens retidos

| Item | O que falta | Pergunta |
|---|---|---|
| F-32 e 2f | `bb_cbm` sozinho muda a modalidade do B/L faturado sem correção; a reimportação de carga solta que muda B/L faturado reemite sem confirmação; container que vira misto falha por `mixed_bl_terminal_conflict` | 5 |
| 2e | Somente leitura do B/L cancelado também em `bl_containers` e `vehicles` | 4 |
| Planilha de CE (F-29) | Modo diferido recusa o arquivo inteiro quando o cálculo falha | 3 |
| F-54 (parte) | Recálculo sobrescreve o ROE manual do B/L | 10 |
| F-46 (parte) | Linha em dólar da avulsa: quantidade × unitário em R$ ≠ total | 13 |
| 2a (medição) | Desempenho da Base de Clientes com o gatilho de `bls.customer_id`, medido só em Postgres local | — |

Cada item, quando decidido, entrega migration, suíte local-pg que reproduz o
achado antes e passa depois, e a atualização do módulo dono, como no plano de
origem.

## Perguntas ao responsável (não decididas)

1. **Fechar toda a escrita direta (I-03)?** `bl_containers`, `baplie_containers`,
   `vehicles`, `vazios_*` e `granite_*` aceitam escrita direta de usuário ativo;
   o front só grava direto em `bl_containers.unpacking_location`,
   `vazios_importacao_containers.natureza`, `voyages`/`vessels`/`carriers` e
   `vazios_export_*`. As tabelas novas do lote 0 já nascem fechadas.
2. **Revogar as RPCs da 1b:** quem estiver com aba aberta de antes do deploy
   precisa recarregar; algum script externo usa essas RPCs? (antes do merge)
3. **Planilha de CE sem câmbio ou sem tabela (F-29):** hoje o modo diferido
   recusa o arquivo inteiro quando o cálculo falha (`288`:42-44); a ADR 0092,
   item 5, sugere gravar o CE e deixar o Alerta. Confirmar que o CE é gravado.
4. **B/L cancelado no arquivo de B/L e na planilha de datas (F-28):** aviso,
   erro ou grava a data da caixa?
5. **Carga solta faturada (F-32):** a reimportação deve pedir confirmação,
   conferida no servidor, antes de capturar `bb_cbm`, volumes e máquinas?
6. **POD mudado depois do CE e antes da emissão** (reimportação com aceite,
   COD ou ficha): a decisão 1 vincula à tabela do POD novo; a decisão 3 diz que
   depois do CE tabela e data ficam fixas. Qual vale, e a data de referência
   (ETA do POD) muda? **Hoje (migrations `354`/`355`):** a tabela segue a
   decisão 1 (revincula ao POD novo); a data e o preço congelados no CE ficam.
7. **B/L que muda de Viagem pela reimportação com aceite:** mantém tabela e
   data de referência? Hoje mantém a tabela se o POD e o modo não mudam, e o
   preço congelado no CE fica.
8. **CE trocado por planilha nova:** o "dia do CE" é o do primeiro CE ou o do
   novo? Hoje é o do primeiro (o congelamento não se refaz).
9. **Reimportar arquivo idêntico** recalcula o B/L não faturado com o câmbio do
   dia e muda o provisório sem mudança nenhuma: deve ser no-op?
10. **ROE manual do B/L (F-54):** o recálculo sobrescreve o ROE manual. Ele deve
    prevalecer sobre o câmbio do dia até alguém tirá-lo? (não alterado)
11. **Pix com TXID de outro sistema na mesma chave (decisão 16):** a decisão fala
    em "Pix sem TXID do Vela". Hoje só o Pix sem TXID vira "Pix recebido sem
    baixa"; o de TXID de terceiro continua ignorado, como antes. Deve entrar
    também?
12. **Número da fatura (F-43):** o plano diz "5 dígitos". Foi mantido
    `INV-AAAA-0001` (quatro dígitos) e, a partir de 10.000, todos os dígitos,
    sem truncar. Passar a `INV-AAAA-00001` para todas?
13. **Linha em dólar da avulsa (F-46):** o total em R$ é o total em US$ × ROE,
    arredondado uma vez (como a taxa local em dólar); o unitário em R$ (duas
    casas) × quantidade pode diferir em centavos. Fechar a linha exige
    converter o unitário antes, o que muda o total cobrado em centavos. Manter
    a conversão do total ou converter o unitário?

## Ao concluir

Mover este plano para `docs/archive/plans/`, retirar a linha de
[`README.md`](README.md) e registrar a entrega no
[CHANGELOG](../CHANGELOG.md).
