# Redesenho da aba Disparo

Origem dos mockups do canvas de design da aba `/clientes/comunicacao?tab=disparo`.
São artefatos de design estáticos e nada aqui entra no build.

A página **Proposta** (os quatro primeiros artboards) foi implementada em
`src/pages/ClientesComunicacao.tsx`: duas colunas, modo segmentado, modelo em
lista de rádio, público em faixa fixa, filtros numa linha só e a composição
colapsando numa faixa-resumo depois de conferir. A página **Alternativas** segue
sendo o que sempre foi: duas direções consideradas e não escolhidas.

Ao mudar a tela, mude o artboard no mesmo commit — um mockup que descreve outra
tela é pior que nenhum, porque convida a cobrar do código algo que nunca foi
decidido.

## Artboards

| Arquivo | Estado retratado |
| --- | --- |
| `Main.dc.html` | Modo Carga com o modelo NOA — o caso mais comum |
| `Livre.dc.html` | Modo Carga com o modelo Livre e o editor de mensagem aberto |
| `Institucional.dc.html` | Modo Institucional |
| `Conferencia.dc.html` | Depois de conferir: composição colapsada, lista de destinatários |
| `AltBarraComando.dc.html` | Alternativa não escolhida — barra de comando no padrão de `/viagens` |
| `AltEtapas.dc.html` | Alternativa não escolhida — wizard por etapa |

`canvas.json` posiciona os artboards, separa proposta e alternativas em duas
páginas e carrega as notas do canvas.

## Sistema de design

Os tokens (cores, raio, altura de controle e fontes) vivem em `src/index.css`,
que é a fonte única: eles mudaram depois destes artboards e podem mudar de novo,
inclusive por densidade (o Vela com mouse usa controles mais baixos). Ao alterar
um artboard, leia o valor no CSS na hora, em vez de copiá-lo de um artboard ou
deste arquivo.

## Regerar e republicar

O `.html` publicado é gerado e está no `.gitignore`. Para atualizar o canvas,
edite os `.dc.html`, resemeie com o helper da skill `/design` e republique no
mesmo artifact.
