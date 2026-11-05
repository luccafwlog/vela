# Guia rápido do Financeiro

Guia em PDF (A4, 9 páginas) para o setor Financeiro, pedido pelo dono em
2026-11-05, em duas partes. A **Parte 1, o dia a dia**, é o caminho feliz:
a conferência entre as baixas do Vela e o extrato do Itaú, primeiro pelo
Histórico de baixas e depois por Pix recebidos, e o acompanhamento de Taxas
Locais e Demurrage, tela por tela e com capturas reais. A **Parte 2, ações
pontuais**, começa com o que provoca cada ação (alerta no sino ou pedido de
outra equipe). Depois vêm, com as telas, dar baixa num Pix sem baixa, registrar
um pagamento, cancelar uma baixa, devolver dinheiro (restituição), decidir um
Pix em análise, preparar o cancelamento financeiro de um B/L pago a pedido do
Administrativo e cancelar uma fatura. Os casos raros ficam no Manual do
Operador (capítulos 22 a 24).

| Arquivo | O que é |
| --- | --- |
| `guia-rapido-financeiro.pdf` | O PDF para distribuir. |
| `guia-rapido-financeiro.html` | A fonte do texto. A identidade visual é própria e, a pedido do dono, diferente da do Vela, do Manual do Operador e do material do Portal. |
| `telas/<id>.png` e `telas/<id>.json` | As capturas, com a caixa de cada elemento marcado. |
| `telas/posicoes.json` | Onde fica cada número sobre a tela, escolhido à mão em espaço livre. |
| `capturar.mjs` | Prepara o estado financeiro no cenário de demonstração e tira as capturas. |
| `gerar.mjs` | Injeta as marcações no HTML e imprime o PDF (Chromium, A4). Precisa de rede para as fontes do Google Fonts (Fraunces e Source Sans 3). |

## Como refazer

As capturas usam o Vela local com o cenário de demonstração do manual, só
com dados fictícios; nada toca o Supabase de produção. Suba o ambiente como em
[scripts/manual/pdf/README.md](../../scripts/manual/pdf/README.md) ("Como
gerar", passos 1 a 3) e depois:

```bash
npm run manual:cenario   # reinicie o sb-shim depois
npm run manual:capture
node artifacts/guia-rapido-financeiro/capturar.mjs
node artifacts/guia-rapido-financeiro/gerar.mjs
```

`capturar.mjs` cria uma pessoa do setor Financeiro, de quem são as telas, e a
conta de integração "API ITAÚ", que faz a baixa automática como na produção.
Liga a cobrança pelo Itaú e emite pela tela as faturas e a Invoice de
Demurrage do exemplo. Por fim, simula dois Pix do Itaú pela mesma função que a
Edge Function `itau-pix` chama. `--so id1,id2` refaz só essas capturas, sem
preparar o estado de novo. Se o Chromium da versão do Playwright do projeto não
estiver baixado, aponte outro com `MANUAL_BROWSER_EXECUTABLE_PATH`.

Quando uma dessas telas mudar, refaça as capturas, confira a posição dos
números em `telas/posicoes.json` e o texto do HTML, e gere o PDF de novo.

Este guia é um material avulso, fora do Manual do Operador. O dono não adotou
o guia do Financeiro de `docs/manual/guias/` em 2026-11-03. O texto segue a
`staging` de 2026-11-05, já com os cartões de total e a hora no **Pago em**
(PR luccafwlog/vela#1221).
