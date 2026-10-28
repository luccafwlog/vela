# Dicas contextuais no Portal do Cliente

Estado: **proposta, não aprovada.** Nada aqui está implementado. Nasceu com o
[guia de onboarding do cliente](../../artifacts/portal-onboarding-cliente/README.md)
(rascunho de 2026-10-28) e espera a decisão do responsável antes de virar plano.

## Problema

O guia em PDF explica o Portal uma vez, fora dele. Quatro dúvidas que o guia
responde não têm resposta na própria tela, e o cliente que não leu o guia só
descobre falando com a equipe:

1. Depois de pagar o Pix, a fatura continua **Emitida** por alguns minutos. O
   aviso de que a baixa leva de 1 a 5 minutos existe só no documento impresso
   (`PIX_SETTLEMENT_NOTE`, `src/components/shared/InvoiceDocumentKit.tsx`); o
   bloco Pix da tela (`PortalPixPaymentBlock`) não o mostra.
2. A lista de BLs e Containers sem nenhum B/L diz “Nenhum B/L encontrado para
   os filtros atuais.” (`src/pages/PortalOperacao.tsx`), mas o motivo mais comum
   no começo é outro: o B/L só aparece com o CE Mercante registrado
   ([gate de CE](../operations/regras-de-negocio.md#gate-de-ce-mercante-no-portal)).
3. O valor em reais da Invoice de Demurrage muda nos dias úteis até o
   pagamento ([Demurrage](../modules/demurrage.md)), e o detalhe não diz que o
   QR de outro dia pode cobrar outro valor.
4. TED, depósito ou Pix fora da cobrança do Portal não dão baixa sozinhos, e o
   Portal não diz o que fazer com o comprovante.

## Proposta

Texto fixo no lugar onde a dúvida nasce, sem balão, tour guiado nem
“não mostrar de novo”. Segue a [identidade visual](../identidade-visual.md):
a dica é texto de apoio (12/16, cor de apoio), uma vez por tela, sem cor de
estado, porque não pede ação (regra 5). Vale igual no Modo Inspeção, que usa
as mesmas telas.

| Tela | Onde | Quando aparece | Texto proposto |
|---|---|---|---|
| Detalhe da fatura de Taxas Locais e da avulsa | Sob “Pague com Pix”, no bloco Pagamento | Com o QR na tela | “Pago pelo QR ou pelo código, a baixa é automática em 1 a 5 minutos, sem comprovante. Atualize a página para ver a fatura paga.” |
| Detalhe da Invoice de Demurrage | Sob “Pague com Pix” | Com o QR na tela | “O valor em reais segue o câmbio dos dias úteis. Pague pelo QR desta tela no dia do pagamento.” |
| BLs e Containers, aba B/Ls | Descrição do estado vazio | Lista vazia **sem** filtro ativo | “Os B/Ls da sua empresa aparecem aqui depois que o CE Mercante é registrado.” Com filtro ativo, o texto atual continua. |
| Faturas | Linha de apoio sob a descrição da página | Sempre | “Pagou por TED ou depósito? Envie o comprovante para [endereço a confirmar].” |

A primeira e a segunda linhas reaproveitam o `pixNote` que o bloco já aceita
(hoje usado só para “o QR cobra o saldo” na parcial); as duas notas precisam
conviver na parcial.

## Fora do escopo

- Dica nas telas de acesso (login, ativação, recuperação): elas já têm
  `PortalAccessHelp` e não podem variar por CNPJ.
- Guardar no navegador quais dicas o cliente já viu, ou gravar isso no banco.
- Qualquer mudança de regra: as dicas só descrevem o que o sistema já faz.

## Decisões em aberto

1. Endereço que recebe comprovante de TED ou depósito (mesma pergunta do guia).
2. Se a linha de Faturas deve existir enquanto não houver esse endereço.
3. Aprovação dos textos e do lugar de cada dica, tela a tela, como pede a
   identidade visual.

## Verificação quando implementar

Teste de tela para cada dica no caso em que aparece e no caso em que não
aparece (estado vazio com e sem filtro; Pix com e sem QR; parcial com as duas
notas), nos testes existentes de `PortalOperacao`, `PortalInvoiceDetailModal`
e `PortalDemurrageDetailModal`.
