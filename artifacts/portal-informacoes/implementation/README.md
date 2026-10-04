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

### Ajustes de apresentação em 2026-10-04

- `operation-return-desktop.png` e `operation-return-mobile.png`: link “Onde devolver” com ícone e texto em uma linha; na tabela fica na coluna Devolução, separado do número do container.
- `internal-depots-adjusted-mobile.png`: aba Depots sem o card explicativo e sem a lista de portos do cadastro.

Capturas dos componentes reais `PortalOperacao` e `ClientesInformacoes`, com CSS original e hooks substituídos por fixtures locais. Chromium/Playwright verificou viewports de 1440 e 390 pixels, ausência de erros de runtime e de overflow horizontal no celular. Não verifica autenticação, RPCs ou persistência remota.
