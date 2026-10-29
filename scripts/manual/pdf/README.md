# PDF do Manual do Operador

Gerador do PDF do Manual do Operador (Etapa 2 do
[plano](../../../docs/plans/2026-10-26-manual-do-operador.md)). O texto fica em
[`docs/manual/texto/`](../../../docs/manual/texto/README.md); as imagens saem
do Vela local, com o cenário de demonstração; o PDF sai em `artifacts/manual/`,
fora do Git.

| Arquivo | O que é |
|---|---|
| `manual.css` | Aparência impressa (A4) aprovada nas páginas-modelo de 2026-10-28: cores, letra e estados da [identidade visual](../../../docs/identidade-visual.md), cores das equipes, cabeçalho corrido, aba da parte, blocos, quadros fixos, "Aconteceu…", cartões de mensagem, tabela de referência e guia de bolso. |
| `fonte.mjs` | Lê o `manual.json` e o Markdown de cada capítulo e apêndice e monta o HTML (blocos `:::`, etiquetas de equipe, imagens marcadas, citações de regras). |
| `pagina.js` | Roda na página antes da impressão: fatos da ficha, passos numerados, cartões e ícones. |
| `gerar.mjs` | `npm run manual:build`: capa, sumário, aberturas e capítulos, paginados pelo Chromium em duas passadas (a segunda escreve no sumário a página que a primeira leu do PDF). |
| `conferir.mjs` | `npm run manual:check`: termos técnicos proibidos, capturas citadas e regras citadas que existem na matriz. Roda também no CI, no job `quality`. |
| `capturas.mjs` | As telas do manual, em ordem: cada captura executa o procedimento como o operador faria e devolve o recorte e as marcações. |
| `capturar.mjs` | `npm run manual:capture [-- --so id1,id2]`: roda as capturas e grava `artifacts/manual/imagens/<id>.png` e `<id>.json`. |

O cenário (navio, Viagem, Clientes, B/Ls, CE e Baplie fictícios) fica em
[`scripts/manual/cenario/`](../cenario/): `cenario.json`, o SQL do que vem
antes dos procedimentos e o gerador dos arquivos de importação.

## Como gerar

1. Banco local com todas as migrations: `sudo scripts/setup-local-pg.sh` (ou
   `--reset` depois de migration nova).
2. Banco de demonstração e arquivos do cenário: `npm run manual:cenario`
   (recria `manual_demo` a partir do `vela_test`, com o seed da auditoria
   visual e o cenário).
3. Emulador do Supabase e Vela em modo de desenvolvimento, em dois terminais:

   ```bash
   PGDATABASE=manual_demo PGPASSWORD=postgres node scripts/design-audit/sb-shim.cjs
   VITE_SUPABASE_URL=http://127.0.0.1:5173/sb-proxy VITE_SUPABASE_ANON_KEY=local-anon npx vite --port 5173 --strictPort
   ```

4. Capturas, conferência e PDF:

   ```bash
   npm run manual:capture
   npm run manual:check
   npm run manual:build
   ```

As capturas dependem umas das outras (a Viagem criada na primeira é a das
seguintes): rode a lista inteira sobre um cenário recém-preparado; `--so`
serve para refazer uma tela isolada quando o estado já está pronto. Se o
Chromium da versão do Playwright do projeto não estiver baixado, aponte
outro com `MANUAL_BROWSER_EXECUTABLE_PATH`. O login padrão é o usuário
fictício do `seed_audit.sql` (`VELA_EMAIL` e `VELA_PASSWORD` trocam). Nada
disso toca o Supabase de produção.

## Limites conhecidos

- O servidor de desenvolvimento do Vite pode reotimizar uma biblioteca na
  primeira vez que a tela a carrega ("Outdated Optimize Dep"); reinicie o
  `vite` e rode as capturas de novo.
- Se a tela mudar (rótulo, campo ou botão), a captura falha ao achar o
  elemento e grava `<id>.erro.png`: é o aviso de que o capítulo envelheceu.
- As funções de servidor (e-mail, Portal, Itaú) e as rotinas por horário não
  rodam no ambiente local; o efeito delas é descrito a partir das regras.
