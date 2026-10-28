# Capítulo 5 — Programação: Chegadas e Saídas, Line-Up, Tela TV e cadastros: situações

Catálogo do capítulo 5 do sumário final (destino `Op 4`: Chegadas e Saídas,
Line-Up e cadastros de apoio). Formato e regras em [README](README.md).
Rascunho de 2026-10-28, montado a partir das regras da matriz; ainda não
conferido pelo dono.

## Quem faz

Qualquer setor publica e edita a programação, importa a planilha de programação
e cria ou edita navio, armador, porto, Local e serviço (ACE-085, ACE-094,
VIA-105). Só o Administrativo desativa ou reativa um Local, terminal ou serviço
(VIA-137) e, ao marcar **Não escala**, tira a escala da Viagem (VIA-108).

## Quero fazer…

| Nº | Objetivo | Regras |
|---|---|---|
| Q5.01 | Publicar a programação de um navio no Portal | VIA-105, VIA-106, VIA-107 |
| Q5.02 | Atualizar as datas de vários navios por planilha | VIA-111, VIA-112, VIA-113 |
| Q5.03 | Corrigir as datas de um navio | VIA-108 |
| Q5.04 | Confirmar a saída ou a chegada que já aconteceu | VIA-104, VIA-109, VIA-110 |
| Q5.05 | Tirar um navio da programação | VIA-017, VIA-114 |
| Q5.06 | Acompanhar o Line Up do Painel e exportar | ACE-031, VIA-116 a VIA-121 |
| Q5.07 | Deixar a Tela TV no monitor | VIA-123, VIA-124, VIA-125 |
| Q5.08 | Cadastrar ou corrigir navio, armador, porto e terminal | VIA-014, VIA-135 a VIA-137, EQU-099, EQU-100 |

## Aconteceu…

### Chegadas e Saídas

#### S5.01 — O navio não aparece em Chegadas e Saídas nem no Portal

- **O que o sistema faz:** mostra só Viagens publicadas e Ativas, e só os
  portos do quadro (origem: Qingdao, Shanghai, Taicang, Ningbo, Nansha;
  chegada: Salvador, Vitória, Pecém).
- **Por quê:** a programação é o que o Cliente vê no Portal.
- **O que você faz:** confira se a chave **Aparece em Chegadas e Saídas** da
  Viagem está ligada e se ela não está Concluída ou Cancelada. Escala em outro
  porto não entra no quadro.
- **Regras:** VIA-017, VIA-103, VIA-114, POR-069.

#### S5.02 — A data aparece em âmbar

- **O que o sistema faz:** marca a previsão que já passou sem data efetiva.
  Só no Vela; no Portal ela aparece como previsão comum.
- **O que você faz:** confirme a data efetiva na célula (S5.07) ou atualize a
  previsão em **Editar**.
- **Regras:** VIA-104.

#### S5.03 — "Viagem … ambígua: N candidatas. Informe o IMO."

- **O que o sistema faz:** não junta nem cria quando o nome do navio casa com
  mais de uma Viagem.
- **O que você faz:** informe o IMO de 7 dígitos.
- **Regras:** VIA-106, VIA-112.

#### S5.04 — Preciso corrigir o nome do navio, a viagem ou o IMO

- **O que o sistema faz:** a edição da programação muda só datas ("Navio,
  viagem e IMO se corrigem em Viagens. Aqui só as datas.").
- **O que você faz:** corrija na edição da Viagem (capítulo 4).
- **Regras:** VIA-108, VIA-015.

#### S5.05 — Marquei "Não escala" num porto que tinha data

- **O que o sistema faz:** pede confirmação. Para o Administrativo, a escala
  sai da Viagem e do Line Up se não tem B/L, ATA, ATD, manifesto nem terminal
  salvo; para os demais setores, ou com vínculo, só a data sai.
- **O que você faz:** se o navio não vai mais ao porto e já tem carga para
  ele, registre a omissão na Viagem (capítulo 4).
- **Regras:** VIA-108, VIA-048.

#### S5.06 — A planilha de programação foi recusada

- **O que o sistema faz:** qualquer erro recusa a planilha inteira: data
  ilegível, Viagem cancelada, navio ambíguo, IMO conflitante, mesma Viagem e
  porto com datas diferentes. IMO como "TBA" é ignorado com aviso. Se outra
  pessoa mudou uma data depois da prévia, recusa tudo.
- **O que você faz:** corrija as linhas apontadas e escolha o arquivo de
  novo; no caso de mudança depois da prévia, refaça a prévia.
- **Regras:** VIA-111, VIA-112, VIA-113.

#### S5.07 — A planilha não apagou a data de um porto

- **O que o sistema faz:** célula vazia ou "X" deixa o porto como está; a
  planilha nunca cancela escala. Porto antes removido volta ao planejamento.
- **O que você faz:** para tirar a data, use **Editar › Não escala** (S5.05).
- **Regras:** VIA-111, VIA-113.

#### S5.08 — Confirmar saída ou chegada foi recusado

- **O que o sistema faz:** recusa data futura, porto sem data programada e data
  já registrada. A saída confirmada é provisória: o primeiro B/L com Laden on
  Board diferente a substitui. A chegada grava o ATA da escala, com todos os
  seus efeitos.
- **O que você faz:** para corrigir saída já registrada, use **Viagens › Rotas
  e Manifestos**; chegada já registrada, a escala da Viagem.
- **Regras:** VIA-109, VIA-110, VIA-128.

### Line Up e Tela TV

#### S5.09 — A Viagem não aparece no Line Up

- **O que o sistema faz:** lista as escalas das 60 Viagens cadastradas por
  último, no filtro **Ativas**; Viagem cancelada nunca entra.
- **O que você faz:** use **Carregar mais viagens** (até 500) ou o filtro
  **Escalas: Concluídas / Todas**.
- **Regras:** VIA-116, VIA-120, VIA-126.

#### S5.10 — "N vazios de importação sem escala no Line Up"

- **O que o sistema faz:** o vazio de um porto que não tem linha não é contado
  em outro porto; aparece abaixo do quadro.
- **O que você faz:** confira o porto do vazio ou a escala da Viagem.
- **Regras:** VIA-121.

#### S5.11 — Gravei e o Line Up (ou a Tela TV) ainda não mudou

- **O que o sistema faz:** o Painel relê a cada 90 segundos e a Tela TV a cada
  30. As telas de outras pessoas se atualizam ao reabrir.
- **O que você faz:** espere a próxima leitura.
- **Regras:** VIA-028, VIA-116, VIA-123.

#### S5.12 — A Tela TV voltou ao login ou mostra "Sem atualização desde"

- **O que o sistema faz:** a TV usa a sessão de um usuário e volta ao login
  depois de 8 horas sem mexer no mouse ou teclado. Se a leitura falha, mantém o
  último quadro e mostra **Sem atualização desde**.
- **O que você faz:** entre de novo com o usuário da TV.
- **Regras:** VIA-123, VIA-125.

### Cadastros de apoio

#### S5.13 — Não acho a tela de navios, armadores ou portos

- **O que o sistema faz:** não há tela própria nem exclusão. Navio e armador
  nascem e mudam pela Viagem, por Chegadas e Saídas e pela planilha; o porto
  brasileiro nasce na primeira escala, com o código como nome.
- **O que você faz:** corrija pela edição da Viagem.
- **Regras:** VIA-033, VIA-135, VIA-136.

#### S5.14 — O terminal não aparece para escolher na escala

- **O que o sistema faz:** oferece só terminais portuários ativos do porto da
  escala. Terminal antigo sem porto aparece com aviso em Locais.
- **O que você faz:** em **Embarque de vazios › Locais**, confira o tipo
  (Terminal portuário), o porto e a situação; reativar é do Administrativo.
- **Regras:** VIA-039, VIA-137, EQU-099, EQU-100, EQU-102.
