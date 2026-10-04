# Capturas da implementação local

As imagens desta pasta renderizam os componentes implementados, com os estilos,
fontes e componentes visuais atuais do sistema. Os dados do navegador são
fictícios; a persistência e as RPCs foram verificadas separadamente em PostgreSQL
16 descartável. Não são capturas de produção nem prova de login remoto.

- `portal-hub-desktop.png` e `portal-hub-mobile.png`: Central de Informações.
- `portal-{taxas,devolucao,demurrage,agentes,atendimento,tracking}-*.png`:
  seis seções em 1440 e 390 px.
- `portal-devolucao-specific-*.png` e `portal-devolucao-unavailable-*.png`:
  indicação específica e orientação indisponível, sem alternativas gerais.
- `internal-desktop.png` e `internal-mobile.png`: manutenção no Vela.
- `internal-return-desktop.png` e `internal-return-mobile.png`: indicação
  de devolução com justificativa.

`portal-visual-results.json` e `internal-browser-evidence.json` registram
os cenários e limites. Não houve erros de runtime ou transbordamento horizontal
da página; no modal, seleção múltipla e retirada enviaram os payloads esperados
somente aos stubs locais. Os harnesses temporários foram removidos.
