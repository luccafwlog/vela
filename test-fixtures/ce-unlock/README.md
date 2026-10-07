# Exemplos de planilha ZPT — Desbloqueio de CE

- `zpt-five-columns-v2-example.xlsx` — layout atual `zpt-5-v2` (a partir de 2026-10-07).
  Cinco colunas com os mesmos cabeçalhos do "Exportar Tela" da ZPT, nesta ordem: `BL`,
  `Financeiro`, `Term. Devolucao`, `Procuracao`, `BL Entrega`; valores `Sim`/`Não`.
  Gerado em Node pela mesma função `zptRows` usada pela Edge Function `ce-unlock-export`
  (o handler Deno em si não foi executado para gerar o arquivo). Os BLs são fictícios.
- `zpt-five-columns-example.xlsx` — layout antigo `zpt-5-v1` (BL, Termo, Procuração,
  Entrega de BL, Pagamento das taxas), gerado em 2026-10-04 pela Edge Function real
  em Deno com autenticação/HTTP simulados. Mantido porque lotes antigos continuam
  sendo baixados nesse layout.

Nenhuma das amostras representa homologação pela ZPT: o modelo de importação da aba
"Planilha desbloqueio" ainda não foi fornecido, então o primeiro upload real é o teste.
