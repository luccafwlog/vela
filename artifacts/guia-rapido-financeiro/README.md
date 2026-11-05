# Guia rápido do Financeiro

Guia de três páginas (A4) para o setor Financeiro, pedido pelo dono em
2026-11-05: o que cada tela do menu **Financeiro** mostra (Taxas Locais,
Demurrage, Conciliação PIX), a conferência diária entre as baixas do Vela e o
extrato do Itaú, e o que fazer quando surge um alerta.

- `guia-rapido-financeiro.html`: a fonte. Identidade visual própria, de
  propósito diferente da do Vela, do Manual do Operador e do material do
  Portal (pedido do dono).
- `guia-rapido-financeiro.pdf`: o PDF para distribuir.
- `guia-rapido-financeiro.mjs`: gera o PDF a partir do HTML (Chromium, A4):
  `node artifacts/guia-rapido-financeiro/guia-rapido-financeiro.mjs`. Precisa
  de rede para as fontes do Google Fonts (Fraunces e Source Sans 3).

O texto segue a `staging` de 2026-11-05, já com os cartões de total e a hora
no **Pago em** (PR luccafwlog/vela#1221). Não é o guia do Financeiro em
`docs/manual/guias/`, que o dono não adotou em 2026-11-03: é um material
avulso, e as regras continuam com dono no Manual do Operador (capítulos 20 a
24). Quando uma dessas telas mudar, confira este guia e gere o PDF de novo.
