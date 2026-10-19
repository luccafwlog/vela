# 0091 — Importação com erro é recusada inteira e não grava nada

Status: aceito — 2026-10-19 (decisão do responsável na página do lote 6a da
identidade visual). Implementada no lote 6a
([plano](../plans/2026-10-13-identidade-visual-tela-a-tela.md)).

Estende a [ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md),
que fixou as regras de entrada das importações sem decidir o que acontece com
o resto do arquivo quando parte dele está errada.

## Contexto

Cada importação tinha a sua resposta para o arquivo com erro. Granito pela aba
da Viagem, Vazios de importação, manifesto BB e Veículos ofereciam "forçar a
importação" e gravavam só as linhas válidas. Datas de descarga e devolução,
Base de Clientes, B/Ls de carga solta, programação por planilha e a
conciliação com a ZPT deixavam as linhas com erro de fora sem perguntar.
Datas, Base de Clientes, B/L de container e ZPT gravavam aos poucos (um
registro por vez ou em lotes), então uma falha no meio deixava parte do
arquivo gravada. O extrato do Pix descartava sem aviso o valor que não
conseguia ler. CE Mercante, Baplie e Embarque de vazios já recusavam o arquivo
com erro.

Gravação parcial obriga o operador a descobrir o que entrou, corrigir só o
resto e reimportar sem duplicar, e deixa o sistema num estado que ninguém
conferiu.

## Decisão

1. Uma importação em que qualquer linha, ou qualquer arquivo de um envio com
   vários, tem **erro** é recusada inteira e **não grava nada**. Isso vale para
   todo o sistema. Não existe "forçar a importação" para erro.
2. **Aviso** (dado que não impede a gravação) continua mostrado na prévia e não
   bloqueia; o importador pode pedir que o operador confirme que conferiu.
3. A recusa que só o banco detecta (chassi repetido, B/L não encontrado,
   container ausente) também desfaz tudo: a gravação de uma importação é uma
   transação só, e a tela lista o que foi recusado.
4. **B/L cancelado dentro do arquivo** (manifesto BB, CE Mercante) é aviso: o
   B/L cancelado não é tocado e o resto do arquivo entra. O arquivo do armador
   continua trazendo o B/L, e não há como corrigi-lo.
5. **Passo técnico depois da gravação** (aplicação do IMO/OOG e dos vazios do
   Baplie, emissão das faturas do CE Mercante, cálculo das Taxas Locais do BB e
   do B/L de container): se falhar, a importação fica gravada e o passo é
   retomado, como antes. O arquivo estava certo; a tela diz o que falta.
6. **Linhas sem conteúdo** são ignoradas, com a contagem à vista na prévia:
   linhas da planilha da ZPT sem CE ou sem situação e lançamentos zerados ou
   negativos do extrato do Pix (tarifas e saídas, que não são pagamentos).
   Valor ilegível é erro.
7. Toda importação tem um modelo padrão para baixar; para arquivos que vêm de
   sistemas de fora (Baplie, planilha da ZPT), o modelo é um arquivo de exemplo
   no formato aceito.

## Consequências

- A prévia é a única conferência: o que ela mostra como erro precisa ser
  corrigido no arquivo, que é escolhido de novo.
- Importações que gravavam em laço passaram a gravar numa chamada só (migrations
  novas do lote 6a); a regra por importação fica nos módulos e em
  [Regras de negócio](../operations/regras-de-negocio.md#importações).
- Os testes que afirmavam gravação parcial foram trocados por testes de que
  nada é gravado com erro.
