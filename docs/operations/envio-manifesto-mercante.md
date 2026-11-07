# Envio do manifesto EDI pelo Mercante (upload web)

> **Status:** ativo · **Atualizado:** 2026-11-07 · **Origem:** manual operacional
> validado de 05/11/2026 (Vela / Fwlog), atualizado para o exportador sem BOM ·
> **Regra do arquivo:** [Manifestos & EDI › EDI Mercante](../modules/manifesto-edi.md#edi-mercante) ·
> **Códigos de retorno:** [Retorno do EDI Mercante](mercante-retorno-edi.md)

Roteiro para transmitir ao Siscomex Mercante, pelo navegador, o TXT que o Vela
gera em **Gerar EDI Mercante**. Assinar, enviar e conferir o processamento
acontecem no Mercante, com o Assinador Serpro. O Vela gera e baixa o arquivo
e, na volta, importa o arquivo de retorno, que grava o número do manifesto e
os CEs. Como o arquivo é montado, o que impede o download e cada
aviso estão no [módulo](../modules/manifesto-edi.md#edi-mercante); este
documento diz como agir.

## Resumo do passo a passo

Os passos 1 a 10 seguem o envio validado no canal web (GS8, produção,
05/11/2026). O passo 11 usa a importação do Retorno no Vela.

**No Vela (precisa da conta Dev)**

1. Abra **Viagens**, depois a Viagem, e vá à aba **Rotas e Manifestos**.
2. Escolha a linha certa:
   - **CNTR**: carga em contêiner.
   - **VAZIOS**: contêineres vazios.
   - **BB**: carga solta e B/Ls mistos. Esse arquivo sai **parcial** e precisa
     ser completado antes do envio.
3. Clique no ícone **Gerar EDI Mercante** da linha. Se a janela listar
   **Impedimentos**, corrija na origem (ficha do B/L, escala ou cadastro) e
   gere de novo.
4. Clique em **Baixar arquivo**. Anote qual linha gerou o TXT, porque o nome
   do arquivo não diz se é de carga, vazios ou carga solta.

**Preparar o arquivo**

5. Confira se o TXT começa direto por `M5`. Um arquivo antigo pode trazer três
   bytes invisíveis no início (o BOM). Nesse caso, remova só esses três bytes
   numa cópia.
6. Compacte o TXT em **ZIP**. O ZIP deve ter só o TXT, sem pasta interna e sem
   senha.

**No Mercante**

7. Com o **Assinador Serpro aberto**, acesse **Arquivos → Manifesto pela
   Internet → Upload de Arquivos Mercante** e confira se o Assinador aparece
   como **ONLINE**.
8. Clique em **Assinar arquivo** e selecione o **ZIP**. O responsável escolhe
   o certificado e digita o PIN.
9. Quando o botão virar **Enviar**, clique **uma vez** e **anote o
   protocolo**.

**Conferir e fechar**

10. Baixe o arquivo de retorno em **Download de Arquivo Retorno** ou consulte
    o manifesto no Mercante:
    - **000** quer dizer aceito, e o retorno traz o número do manifesto.
    - **XXX** ou **EE0** quer dizer que há erro. Corrija no Vela, gere de novo,
      faça um novo ZIP e assine de novo.
11. **Importe o retorno no Vela.** Na Viagem, aba **Importação**, clique em
    **CE Mercante** e escolha o arquivo de retorno (`.TXT`). O Vela lê do
    arquivo o número do manifesto e o CE de cada B/L, mostra a prévia e grava
    os dois depois da confirmação, sem digitar nada.
    - O retorno de **vazios** não tem CE e é recusado.
    - O número do manifesto de vazios é informado na importação de **Vazios
      IMP** ou em **Rotas e Manifestos**, na linha **VAZIOS**.

Detalhes em [Importar o retorno no Vela](#importar-o-retorno-no-vela).

> **Não se aplica ao upload web.** Não assine o TXT fora da página. Não anexe
> nem envie `.p7s`. Não compacte um `.p7s`. Não envie TXT solto. O upload web
> validado recebe um **ZIP que contém somente o TXT, na raiz**, e a assinatura
> é feita no botão **Assinar arquivo** da própria página, com o Assinador
> Serpro **ONLINE**. A orientação inicial de assinar o TXT à parte e compactar
> o `.p7s` foi corrigida depois que a tela de produção foi consultada
> ([seção 8](#8-upload-web-e-zaptrade)).

## Situação do exportador: TXT sem BOM

- **Staging.** A PR [#1232](https://github.com/luccafwlog/vela/pull/1232),
  "EDI Mercante: exportar TXT sem BOM", entrou na `staging` em 05/11/2026 às
  20:27 de Brasília (commit de merge `1f8ff49c`). Desde então,
  `src/services/mercanteEdi.ts` grava o TXT sem BOM: o primeiro caractere é o
  `M` do registro `M5`.
- **Main.** A #1232 chegou à `main` pela promoção
  [#1233](https://github.com/luccafwlog/vela/pull/1233) (`staging` → `main`),
  com merge em 05/11/2026 às 23:51 de Brasília (commit `70ae5f85`). É a primeira
  promoção cujo merge contém `1f8ff49c`; a anterior, #1231 (16:39), não o
  contém. **Código:** conferido por ancestralidade git em 2026-11-07
  (`git merge-base --is-ancestor 1f8ff49c origin/main`), e o
  `src/services/mercanteEdi.ts` da `main` já traz o comentário "Sem BOM".
- **Produção.** Merge na `main` não prova implantação. A publicação de
  produção sai da `main` pelo Cloudflare Pages
  ([serviços externos](servicos-externos.md#cloudflare-pages-produção)), mas
  esta conferência não verificou que o deploy desse commit concluiu nem qual
  build o operador está usando. Por isso, confira o início do arquivo
  ([seção 3, passo 1](#3-preparar-o-zip)).
- **Nota de compatibilidade (BOM legado).** Um TXT exportado antes da mudança,
  ou de um build que ainda não a tenha, pode começar pelos bytes `EF BB BF`
  (BOM UTF-8). No teste GS8, o TXT exportado tinha esse BOM, e a cópia enviada
  foi preparada removendo **somente** esses três bytes, com o restante
  preservado byte a byte. **O teste não isolou se remover o BOM é
  obrigatório.** O que ele provou é que o arquivo sem BOM foi aceito pelo
  upload web.

## 1. Antes de começar

- Confirme a viagem, os B/Ls e que o manifesto ainda está pendente de envio.
  Na aba **Rotas e Manifestos** da Viagem, a coluna **Nº de manifesto
  Mercante** mostra "A informar" enquanto a rota não tem número. Se a Zaptrade
  ou outro operador já fez a transmissão, confira o retorno ou consulte o
  manifesto no Mercante antes de tentar de novo.
- Abra o Mercante com o perfil habilitado para a agência ou a empresa
  responsável e deixe o Assinador Serpro em execução. Tenha disponível o
  certificado do responsável. A seleção do certificado e o PIN são feitos pelo
  operador autorizado, quando o Assinador pedir. O certificado, o PIN e
  qualquer credencial nunca entram neste documento, no Vela nem em mensagem.
- Exporte o TXT da rota no Vela ([seção 2](#2-exportar-o-txt-no-vela)). Guarde
  o original e use uma cópia para qualquer ajuste.
- No arquivo de carga, confira o `M5`:
  - **Quantidade de conhecimentos** (posições 03–06) igual ao número de linhas
    `C5`.
  - Cada `C5` seguido dos seus `I5`.
  - B/Ls, dados da viagem e portos revisados.

  No arquivo de vazios, a quantidade de vazios (posições 07–10) é igual ao
  número de linhas `V5`. As posições estão na
  [referência](mercante-retorno-edi.md#m5-posições-para-diagnóstico). Essa
  checagem estrutural ajuda a achar problema de exportação; a validação de
  negócio é do Mercante, no processamento.

## 2. Exportar o TXT no Vela

### Onde fica

**Código:** `src/pages/Viagens.tsx`, `src/components/voyages/VoyageCard.tsx`,
`src/components/voyages/VoyageManifestosTab.tsx`,
`src/components/voyages/MercanteEdiModal.tsx`.

1. No menu, grupo das viagens, abra **Viagens** (`/viagens`) e abra a Viagem.
   A ficha fica em `/viagens/<id da Viagem>`; a aba pode ser aberta direto com
   `?tab=manifestos`.
2. Na ficha, abra a aba **Rotas e Manifestos**. O bloco **Rotas da viagem** tem
   uma linha por rota POL → POD e natureza. A coluna **Carga** diz a natureza:
   **CNTR** (contêiner), **BB** (carga solta, com os B/Ls mistos) ou
   **VAZIOS**.
3. Na última coluna, os botões são só ícone; o nome aparece ao passar o mouse.

**Pré-condições** (**Código:** `VoyageManifestosTab.tsx`, `VoyageCard.tsx`):

- **Conta Dev.** Só a conta Dev (marca Dev) vê os botões de EDI Mercante
  (decisão do dono de 2026-11-03). Para os demais, os botões não aparecem. Sem
  a conta Dev, peça a exportação a quem a tem.
- **Viagem cancelada.** Os botões ficam desabilitados, e o banco recusa o
  registro com "Viagem cancelada não gera EDI Mercante."
- **Rota sem POL.** Os botões ficam desabilitados na linha cujo POL está vazio
  ou é `-`.
- **Botão de cada linha.** A linha CNTR só tem o botão com B/L. A linha BB só
  tem o botão com B/L. A linha VAZIOS só tem o botão com pelo menos um
  contêiner vazio.

### Qual botão gera cada arquivo

| Arquivo | Linha | Botão (nome ao passar o mouse) | Título da janela | Registros | O que entra |
|---|---|---|---|---|---|
| **Carga** (contêiner) | **CNTR** | **Gerar EDI Mercante** (ícone de arquivo com seta para baixo) | `EDI Mercante · <rota>` | `M5` + um `C5` por B/L + um `I5` por contêiner do B/L | B/Ls ativos de contêiner da rota, na ordem do número do B/L. B/L de carga solta ou misto fica fora, com o aviso "Fora deste arquivo: … vai no EDI Mercante da carga solta (botão da mesma linha)." Esse B/L sai pela linha BB. |
| **Vazios** | **VAZIOS** | **Gerar EDI Mercante** (mesmo ícone) | `EDI Mercante de vazios · <rota>` | `M5` sem conhecimento + um `V5` por contêiner vazio | Contêineres vazios da rota. |
| **Carga solta (parcial)** | **BB** | **Gerar EDI Mercante da carga solta (parcial, a equipe completa)** (ícone de arquivo com lápis) | `EDI Mercante de carga solta · <rota>` | `M5` + um `C5` por B/L + um `I5` por item | B/Ls ativos de carga solta e mistos da rota. Cada item vira um `I5`: tipo 1 para o contêiner do misto, tipo 2 para a carga solta, tipo 4 para o veículo fora de contêiner. |

Na rota com contêiner e carga solta há duas linhas, CNTR e BB, e cada uma gera
o seu arquivo e o seu manifesto
([ADR 0123](../adr/0123-manifesto-mercante-separado-por-natureza.md)).

### A janela de prévia

A janela mostra:

- **Navio e viagem**, **Rota no Mercante**, **Encerramento (ATD no POL)**,
  **Operação (ETA no POD)**, **Terminal de descarga** e **Conteúdo** (as
  contagens).
- As listas **Impedimentos**, **A completar** e **Avisos**, cada uma com a
  quantidade e o B/L ou contêiner de cada item.

A frase de estado diz o que fazer:

| Frase na janela | Significado | O que fazer |
|---|---|---|
| "O arquivo não pode ser baixado enquanto houver impedimento." | **Baixar arquivo** fica desabilitado. | Corrija na origem: a ficha do B/L, a escala ou o cadastro, conforme a mensagem. Feche e gere de novo. |
| "Arquivo parcial: complete os itens de "A completar" antes de enviar ao Mercante." | Só no arquivo de carga solta. O download é liberado, mas o arquivo tem campos em branco. | Não envie o arquivo como saiu ([limitações](#limitações)). |
| "Pronto para baixar. O envio ao Mercante continua fora do Vela." | Sem impedimento. Os **Avisos** não impedem. | Leia os avisos e baixe. |

### Baixar arquivo e nome do arquivo

1. Clique em **Baixar arquivo**. Enquanto grava, o botão mostra
   "Registrando…".
2. O Vela primeiro registra o arquivo no Histórico da Viagem e só então baixa
   o `.TXT`. Se o registro falhar, nada é baixado e a janela mostra a recusa,
   por exemplo "Não foi possível registrar o arquivo no Histórico da Viagem;
   nada foi baixado. Tente de novo." (**Código:** `MercanteEdiModal.tsx`;
   migration `600`).
3. O nome do arquivo é `FWL_MERCANTE_<número com 6 dígitos>_<sigla>.TXT`, por
   exemplo `FWL_MERCANTE_000123_GG6.TXT` (número fictício). O número é o
   sequencial do Vela. A sigla junta as iniciais do navio e o número da
   viagem: GREEN GUANGZHOU V.6 → `GG6` (**Código:** `mercanteFileTag` em
   `src/services/mercanteEdi.ts`; `register_mercante_edi_file` na migration
   `600`).
4. **O nome não diz a natureza nem a rota.** Para saber qual arquivo é qual,
   anote o nome que cada linha baixou. O Histórico da Viagem (bloco **Linha do
   tempo**, aba **Visão geral**) mostra cada um como "EDI Mercante gerado · POL
   → POD", com o nome, a natureza (contêiner, carga solta (arquivo parcial) ou
   vazios), o conteúdo e quem gerou.
5. Gerar de novo cria outro número. Envie o arquivo mais recente da rota e da
   natureza certas, e só depois de conferir que ninguém transmitiu o anterior.

Arquivos baixados antes da migration `600` tinham no nome o instante da
geração (`FWL_MERCANTE_<AAAAMMDDHHMM>_<sigla>`), como o do teste GS8.

### Qual arquivo selecionar

- **Manifesto da carga em contêiner:** o TXT baixado na linha **CNTR**.
- **Manifesto de vazios:** o TXT baixado na linha **VAZIOS**.
- **Manifesto de carga solta, inclusive os B/Ls mistos:** o TXT baixado na
  linha **BB**, depois de completado ([limitações](#limitações)).
- Um ZIP por arquivo. Não junte dois TXT no mesmo ZIP.

### Limitações

- **Só a conta Dev exporta.** Os demais usuários não veem os botões.
- **O Vela não envia nem assina.** Não há integração com o Mercante, com o
  Assinador nem com a Zaptrade. O arquivo de retorno do manifesto de carga
  volta ao Vela pela importação de **CE Mercante**, que grava o número do
  manifesto e os CEs ([importar o retorno](#importar-o-retorno-no-vela)). O
  retorno de vazios não é importado: o número dos vazios é digitado.
- **Arquivo parcial de carga solta.** O que o Vela não tem (data de emissão,
  frete, Type of Movement, terminal…) sai em branco e aparece em **A
  completar**. O Vela não edita o TXT.
  - Completar exige uma cópia controlada fora do Vela, com cada campo na sua
    posição fixa.
  - Use uma ferramenta que não apague espaços nem troque as quebras de linha
    CRLF.
  - Este runbook não tem procedimento validado para essa edição. Nenhum envio
    web de arquivo parcial completado foi registrado.
- **Canal validado.** O envio web validado (GS8) foi de um TXT de Longo Curso
  Importação com 12 conhecimentos. O envio web dos arquivos de vazios e de
  carga solta não foi registrado neste runbook.
- **Fora desta fase.** Retificação de manifesto ou de CE já registrado
  ([módulo](../modules/manifesto-edi.md#edi-mercante)).

## 3. Preparar o ZIP

1. **Confira o início do TXT.** O arquivo deve começar direto pelo tipo do
   registro: `M5` no Longo Curso Importação. O exportador atual não grava BOM
   ([situação do exportador](#situação-do-exportador-txt-sem-bom)).
   - Se o TXT for legado e começar por `EF BB BF`, prepare uma cópia removendo
     só esses três bytes. Preserve o resto byte a byte, inclusive os espaços
     de preenchimento e as quebras de linha.
   - Use uma ferramenta que mostre os bytes, como um visualizador
     hexadecimal. Um editor que regrava o arquivo inteiro pode cortar espaços
     do fim da linha e deslocar campos.
   - Ao contar posições num arquivo com BOM, comece depois dos três bytes.
2. **Compacte.** No Windows, selecione o próprio TXT e use a opção de
   compactar em arquivo ZIP. Dê ao pacote um nome identificável, só com
   letras, números, ponto, hífen ou sublinhado, por exemplo
   `FWL_MERCANTE_000123_GG6.zip` (número fictício). O teste GS8 usou
   `FWL_MERCANTE_202611051123_GS8_UPLOAD_WEB.zip`, do formato de nome anterior
   à migration `600`.
3. **Abra o ZIP antes de enviar.** Ele deve ter só o TXT, na raiz, sem pasta
   interna e sem senha.

## 4. Assinar e enviar pelo Mercante

1. Acesse **Arquivos → Manifesto pela Internet → Upload de Arquivos
   Mercante**.
2. Na tela **Manifesto - Upload de Arquivos**, confira se o status do
   Assinador Serpro aparece como **ONLINE**.
   - Se aparecer **OFFLINE**, inicie o aplicativo e verifique se ele está
     rodando em segundo plano.
   - No primeiro uso, a tela pode pedir a autorização da integração com o
     Assinador.
3. Clique em **Assinar arquivo**, na própria página, e selecione o **ZIP que
   contém o TXT**. Conclua a seleção do certificado e a autenticação no
   Serpro, se forem pedidas.
4. Confira o nome do arquivo na tela. Quando o botão mudar para **Enviar**,
   clique uma vez.
5. Guarde o número de protocolo, o nome do ZIP e a identificação da viagem.
   - Se a tela ficar em **Enviando...**, aguarde a resposta.
   - Antes de qualquer nova tentativa, confira se já existe retorno ou
     manifesto registrado.

## 5. Confirmar o lançamento

O protocolo identifica o envio. A confirmação do processamento vem do arquivo
de retorno ou da consulta ao manifesto no Mercante.

1. **Baixe o retorno.** Acesse **Arquivos → Manifesto pela Internet → Download
   de Arquivo Retorno**. Use o protocolo quando a tela oferecer essa busca.
   Guarde o arquivo de retorno junto ao registro operacional.
2. **Leia o retorno.** Os códigos e as posições estão na
   [referência](mercante-retorno-edi.md). Leia os códigos específicos e as
   ocorrências antes de preparar uma correção.

   | Código geral | Significado |
   |---|---|
   | **000** | Aceito. No registro `M5`, vem com o número do manifesto. |
   | **XXX** | Há pelo menos um campo criticado. |
   | **EE0** | O tipo de registro não pôde ser identificado. |

3. **Confira o manifesto.** Consulte o manifesto registrado e confira os
   conhecimentos vinculados. Registre o número do manifesto no controle
   operacional. Se o processo exigir vinculação à escala, confira essa etapa
   separadamente.
4. **Importe o retorno no Vela** ([abaixo](#importar-o-retorno-no-vela)).

### Importar o retorno no Vela

**Código:** `src/services/retornoMercante.ts`, `src/services/ceMercanteImport.ts`,
`src/components/shared/CeMercanteImportModal.tsx`,
`src/components/shared/VoyageImportActions.tsx`. A regra fica no
[módulo](../modules/manifesto-edi.md#manifesto-mercante).

O arquivo de retorno do manifesto **de carga** (contêiner ou carga solta),
`RETFWL….TXT`, entra no Vela pela mesma importação da planilha de CE.

1. Abra a importação de CE:
   - Na Viagem, aba **Importação**, botão **CE Mercante**.
   - Ou, na tela **B/Ls** (`/bls`), no menu **Importar**, item **CE
     Mercante**.
2. Na janela **Importar CE Mercante**, escolha o `.TXT` do retorno no lugar da
   planilha.
   - O campo **Nº de Manifesto Mercante** some.
   - O aviso "Manifesto Mercante <número>, lido do Retorno" mostra o número e
     a rota do Mercante.
   - Cada conhecimento (`C5`) vira uma linha B/L + CE.
3. Confira a **Prévia** e a conferência com o que já está gravado:
   - Trocar um CE ou mudar um B/L de manifesto pede confirmação com motivo.
   - A gravação é tudo ou nada.
   - Com o CE gravado, as faturas seguem como na planilha.
4. O número aparece na coluna **Nº de manifesto Mercante** da linha da rota,
   em **Rotas e Manifestos**, e o CE na ficha de cada B/L.

O Vela recusa:

- Arquivo sem `M5`.
- Arquivo com mais de um manifesto: importe um retorno por manifesto.
- Arquivo com `C5` sem o número do B/L.
- Retorno de vazios, que só tem `V5` e nenhum CE.

São erros de linha, como na planilha: `C5` de outro manifesto, CE fora de 15
dígitos e B/L ou CE repetidos.

O manifesto de **vazios** recebe o número digitado:

- Na importação de **Vazios IMP**, um número por rota.
- Ou em **Rotas e Manifestos**, linha **VAZIOS**, com **Informar Nº de
  Manifesto Mercante**.

O retorno com crítica (`XXX` ou `EE0`) não tem o que importar: corrija e
envie de novo ([erros](#6-erros-e-o-que-fazer)).

Ainda não há registro de um retorno do upload web importado no Vela (o do GS8
ficou sem conferência). A leitura foi conferida nos retornos de contêiner,
carga solta e vazios do GREEN GUANGZHOU V.6 (comentário de
`src/services/retornoMercante.ts`).

> **Referência do teste GS8 em produção** (**Runtime**, 05/11/2026, upload
> web, Longo Curso Importação).
>
> - O protocolo informado pelo operador foi **1105112539061**.
> - A consulta ao Mercante mostrou o manifesto **1226502047331**, e os
>   **12 B/Ls** exibidos coincidiram com o TXT do Vela.
> - A conferência do GS8 foi feita **pela consulta ao manifesto**. O arquivo
>   de retorno desse teste **ficou sem conferência**.

## 6. Erros e o que fazer

As mensagens da coluna "Sintoma" são da tela do Mercante. Nenhuma delas tem
correspondência comprovada com um código EDI da tabela de mensagens: não
atribua código a mensagem de tela sem prova
([referência](mercante-retorno-edi.md#limites-desta-referência)).

| Sintoma | O que conferir |
|---|---|
| Arquivo não está zipado | Confirme que selecionou um ZIP que abre normalmente e tem o TXT na raiz. Evite TXT ou `.p7s` solto, RAR, 7z e ZIP com senha. |
| Arquivo corrompido | Abra o ZIP, confira a única entrada e repita a validação do TXT. Use a assinatura integrada da página do Mercante. Evite enviar um ZIP com um `.p7s` gerado à parte. |
| Nenhum CNPJ de agência/empresa de navegação encontrado | Confira primeiro o conteúdo do ZIP. Depois, no `M5` do TXT, confira as posições 25 a 38 (código da agência) e 11 a 24 (código da empresa de navegação). No GG6, o CNPJ da agência estava no campo esperado, com dígitos verificadores válidos, e a mensagem apareceu mesmo assim. O erro, sozinho, não justifica trocar o CNPJ. |
| Assinador offline ou botão **Enviar** indisponível | Confira se o Assinador está em execução, se a integração foi autorizada e se a assinatura do ZIP terminou. O pedido de certificado ou PIN é atendido pelo operador. |
| Tela parada em **Enviando...** ou protocolo não anotado | Consulte o retorno ou procure o manifesto pelos dados da viagem ou de um B/L. Só repita o envio depois de verificar a tentativa anterior. |
| Retorno com crítica (**XXX** ou **EE0**) | Registre o código, a ocorrência e o protocolo. Corrija o dado na origem, isto é, no Vela, e gere o arquivo de novo. Use cópia controlada só para o que o Vela não preenche. Qualquer alteração do TXT exige um novo ZIP e uma nova assinatura na página. |

No Vela, o dado do manifesto se corrige na ficha do B/L, bloco **Dados do
manifesto**. Datas, terminal e IMO se corrigem na Viagem, na escala ou no
cadastro, conforme a mensagem de impedimento
([módulo](../modules/manifesto-edi.md#edi-mercante)).

## 7. Assinador Serpro

**Fonte:** manual do Assinador Serpro, versão 4.2.0, seção 12, e o
[tutorial oficial](https://tutorial.assinadorserpro.estaleiro.serpro.gov.br/html/index.html).

- O Assinador precisa estar instalado, em execução e autorizado a conversar
  com o navegador. O certificado e o PIN são tratados pelo operador, no
  computador dele.
- **Para testar a ligação do Assinador com sistemas integrados**, o manual
  indica a página de demonstração
  `https://www.frameworkdemoiselle.gov.br/v3/signer/demoNovo/`. Pelo resultado,
  o operador instala o Assinador, inicia o aplicativo ou atualiza uma versão
  anterior à 4, conforme os links do tutorial para o sistema operacional.
- A aba **Manutenção** do Assinador ("Reiniciar o Assinador") altera
  configurações e autorizações. O manual diz para usá-la só sob orientação
  técnica.
- O estado **ONLINE** na tela do Mercante e a assinatura do ZIP pelo botão
  **Assinar arquivo** vêm do relato operacional do GS8, não do manual
  genérico. O manual explica a assinatura atachada de arquivos no próprio
  Assinador, mas isso não valida assinar o TXT fora da página nem enviar um ZIP
  com `.p7s` pelo upload web.
- Nunca desabilite proteções do navegador ou do sistema, nunca exporte o
  certificado e nunca compartilhe o PIN.

## 8. Upload web e Zaptrade

- **Upload web (GS8).** A orientação inicial de assinar o TXT fora do Mercante
  e compactar só o `.p7s` foi corrigida depois que a tela de produção foi
  consultada. O upload web validado no GS8 recebe o **ZIP com o TXT** e assina
  na página. A aceitação do GS8 foi confirmada pela consulta ao manifesto
  ([seção 5](#5-confirmar-o-lançamento)).
- **Zaptrade (GG6).** O GG6 foi aceito pela VAN Zaptrade, com código **000** e
  manifesto **1226502020077**. Essa aceitação comprova o resultado pela VAN. A
  composição exata do pacote que a Zaptrade transmitiu não foi verificada.
- **FAQ antiga.** A FAQ "Perguntas sobre transmissão via EDI" (sem versão
  identificada) descreve a VAN habilitada. Ela não torna a VAN obrigatória para
  o canal web validado, não traz o passo do botão **Assinar arquivo** e não
  prova a composição do pacote da Zaptrade.

## Incertezas registradas

| Ponto | Situação |
|---|---|
| Remover o BOM é obrigatório no upload web? | Não isolado. O GS8 foi enviado sem BOM e aceito; não houve envio web com BOM para comparar. |
| O arquivo de retorno do GS8 trouxe `000`? | Não conferido. A aceitação foi verificada pela consulta ao manifesto. |
| O que a Zaptrade transmitiu no GG6? | Não verificado. Só o resultado (`000`, manifesto 1226502020077) é conhecido. |
| Causa da mensagem "Nenhum CNPJ de agência/empresa de navegação encontrado" | Não identificada. O CNPJ da agência estava correto no `M5`. |
| O deploy de produção já tem a #1232? | O merge na `main` foi conferido (#1233, 05/11/2026 23:51); o deploy não. |
| Envio web de vazios e do arquivo parcial de carga solta | Sem registro de envio neste runbook. |

## Fontes

- Manual operacional de envio de manifesto EDI pelo Mercante, versão de
  05/11/2026 (Vela / Fwlog), base deste documento.
- Receita Federal:
  [página EDI/Upload do Mercante](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante),
  [leiaute de envio, incluindo o M5](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante/layout-edi-mercante-v-3.2/1.pdf#page=11)
  e [leiaute do retorno](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante/layout-retorno-edi-mercante-v-2.9/3.pdf).
  As versões e as divergências entre rótulo e rodapé estão na
  [referência](mercante-retorno-edi.md#fontes-e-versões).
- [Tutorial do Assinador Serpro](https://tutorial.assinadorserpro.estaleiro.serpro.gov.br/html/index.html).
- Código do Vela citado em cada seção. Decisões:
  [ADR 0116](../adr/0116-edi-mercante-gerado-pelo-vela.md),
  [ADR 0123](../adr/0123-manifesto-mercante-separado-por-natureza.md) e
  [ADR 0129](../adr/0129-edi-mercante-registrado-correcao-na-ficha-e-estrangeiro.md).
