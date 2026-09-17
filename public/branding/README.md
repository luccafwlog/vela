# Assets de marca

Três marcas convivem neste repositório e **não** compartilham assets. Trocar um
arquivo por outro coloca a marca errada na frente do público errado.

| Marca | O que é | Assets |
|---|---|---|
| **Vela** | O sistema interno, usado pela equipe | `vela-*` |
| **Fwlog** | A empresa que atende o cliente (Portal e e-mails) | `fwlog-logo*.png` |
| **Transhipping** | A entidade jurídica e financeira (faturas, recibos, documentos) | `transhipping-logo*.png`, `tr-logo.png` |

O cliente não deve ter visibilidade do nome Vela. Os assets `vela-*` atendem o
sistema interno. Os assets `fwlog-*` atendem o Portal do Cliente e as comunicações/e-mails.
Documentos fiscais, faturas e recibos mantêm a identidade e titularidade da Transhipping (`tr-logo.png` e `transhipping-logo*.png`).

## Arquivos Vela

| Arquivo | Uso |
|---|---|
| `vela-mark.svg` | Símbolo sobre fundo claro. Ao lado do nome, no lockup. |
| `vela-mark-dark.svg` | Símbolo sobre fundo escuro (topbar, tela de TV). |
| `vela-icon.svg` | Ícone com plaquinha, para 32px e acima. |
| `vela-icon-16.svg` | Ícone com plaquinha, geometria própria de 16px. |
| `vela-icon-{16,32,180,192,512}.png` | Rasterizações do ícone, para favicon e ícone de app. |

## Arquivos Fwlog

| Arquivo | Uso |
|---|---|
| `fwlog-logo.png` | Logo sobre fundo claro (cards e telas de autenticação). |
| `fwlog-logo-white.png` | Logo sobre fundo escuro ou azul (header do Portal do Cliente, topo de e-mails transacionais). **Toda vez que o fundo for azul/navy, deve ser utilizada esta logo branca**, pois a logo padrão fica ilegível. |


## Duas regras que não são preferência estética

**O ícone de 16px é um desenho diferente, não o de 32px reduzido.** O vão entre
as duas velas precisa cair em cima da grade de pixels; reduzido, ele fica pela
metade em dois pixels e o navegador borra os dois. Por isso `vela-icon-16.svg`
existe separado, com coordenadas inteiras numa `viewBox` de 16. O de 32 é
exatamente o dobro dele, então as duas versões nunca desalinham.

**O nome "Vela" não é imagem.** No app ele é texto HTML com
`font-family: var(--app-font-display)` (Syne, já carregado por `src/fonts.css`).
Assim ele herda tema, tamanho e acessibilidade, e não depende de um arquivo. Um
lockup em arquivo único só seria necessário para uso externo ou impressão — e
nesse caso a palavra precisa ser convertida em contorno antes, senão o arquivo
depende da fonte estar instalada em quem abrir.

## Paleta

Herdada de `src/index.css`, não inventada: navy `#152238`, topbar `#0e1825`,
ouro `#d4882e`, papel `#f4f1ea`. Na variante escura, `#eef2ff`, `#f59e0b` e
`#60a5fa`.
