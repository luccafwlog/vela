# 0078 — Importações e CE Mercante: regras de entrada, correção e efeitos

Status: aceito — 2026-10-09 (decisões do dono). Implementação pendente no
[plano de correção das importações](../plans/2026-10-09-correcao-importacoes-ce-mercante.md).

Supersede parcialmente a [ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md)
(item 5, a parte dos itens 3 e 9 sobre recebível sem fatura e o "desvio
aceito" da unicidade CE × B/L) e a
[ADR 0020](./0020-ce-mercante-gatilho-calculo-taxas-locais.md) quanto ao canal
e à forma da emissão pelo CE. Estende a
[ADR 0017](./0017-bl-fonte-ingestao-correcao-autoridade-compartilhada.md) à
carga solta e a [ADR 0077](./0077-fatura-emitida-nao-muda-de-valor.md) à
mudança de rateio de container compartilhado e à Invoice de Demurrage.

## Contexto

A [revisão das importações e do CE Mercante de 2026-10-09](../archive/audits/2026-10-09-revisao-importacoes-ce-mercante.md)
confirmou 25 problemas-raiz e listou as decisões de negócio que nenhuma regra
fixava, ou em que regras vigentes se contradiziam (seção 6 do relatório). O dono
decidiu cada uma em 2026-10-09, a partir de um caso reproduzido no ambiente de
teste. Os identificadores `D-xx` abaixo são os da seção 6; `D-23` nasceu na
própria rodada de decisões.

## Decisão

### CE Mercante

1. **Portas do CE (D-03, D-02).** O CE entra pela planilha de CE Mercante e é
   corrigido ou removido pela ficha do B/L. O Manifesto BB deixa de gravar CE:
   a coluna sai do modelo e, se vier num arquivo antigo, é ignorada com aviso
   na prévia (na prática, o CE da carga solta chega depois, pelo Mercante).
2. **Corrigir pela ficha (D-02).** A ação **Corrigir CE Mercante** vale para
   qualquer usuário ativo, com as regras da planilha (15 dígitos, unicidade,
   Manifesto Mercante) e motivo obrigatório gravado no Histórico.
3. **Unicidade (D-04).** Um CE só pode estar em um B/L não cancelado, somando
   B/Ls de carga e de Granito. Todas as portas e a reativação recusam a
   repetição, nomeando o B/L que já tem o CE. B/L cancelado libera o CE. Não
   existe caso legítimo de CE compartilhado.
4. **Troca de CE já gravado (D-01).** A prévia da planilha mostra "CE atual →
   CE novo" com a situação do B/L (faturado, comunicado, desbloqueado). A troca
   exige confirmação com motivo, que vai ao Histórico. A fatura não muda. Se o
   Comunicado de CE e Taxas já foi enviado, abre pendência de **reenvio**: o
   Cliente precisa receber o Comunicado de novo. Se havia Desbloqueio de CE
   conferido, abre alerta.
5. **Remover o CE (D-05).** A ação **Remover CE Mercante** na ficha vale para
   qualquer usuário, com motivo, e só sem fatura viva; com fatura emitida, a
   orientação é o Administrativo cancelar a fatura antes. Importações nunca
   removem CE. Comunicado já enviado abre a pendência de reenvio.
6. **Emissão pelo CE (D-07).** CE e cálculo (com as taxas do dia do CE) são
   gravados juntos, tudo ou nada; a emissão sai logo em seguida, em lotes
   conduzidos pela tela, com progresso e **Retomar**. O emitente registrado é
   **"Sistema — CE Mercante"**; o CE fica em nome de quem importou. O emitente
   não aparece na fatura enviada ao Cliente. A tela termina com o resultado por
   B/L: faturada, retida ou bloqueada, com o motivo. Planilhas chegam a ~400
   B/Ls e devem caber com folga.
7. **Manifesto Mercante (D-08).**
   - Número de **13 caracteres, letras ou dígitos em qualquer posição**
     (exemplos reais: `1226501860578`, `1226B01849909`), guardado em
     maiúsculas, sem espaços nem separadores; a comparação usa essa forma.
   - Cadastro único: **Informar Nº** e a planilha de CE gravam e leem o mesmo
     Manifesto Mercante. A coluna **Vinculada** da escala mantém a regra própria.
   - **Mover / Desvincular** B/Ls em lote na Viagem (Rotas e Manifestos) e na
     ficha, com busca, **Colar lista de B/Ls**, confirmação e motivo; também
     pela planilha, que move os B/Ls depois de confirmação na prévia.
   - Mudança de POD ou de Viagem desvincula o B/L automaticamente.
   - Na planilha: linha sem CE é **erro** e bloqueia, nomeando as linhas; B/L
     cancelado é ignorado com aviso; mais de uma aba com dados é recusada.
8. **CE de Granito (D-19).** Continua sem cálculo nem emissão automáticos; o
   cálculo do Granito é feito pela Validação.

### Rastro e permissões

9. **Rastro (D-06).** Toda importação registra, no Histórico de cada registro
   alterado, quem fez, data e hora, o tipo de importação, o contexto (Nº de
   Manifesto, Viagem e rota), o valor anterior e o novo, e o motivo quando
   houver. Não se guarda lote, arquivo nem linha. A criação de Manifesto
   Mercante e o vínculo do B/L passam a constar, e o evento duplicado do CE
   sai.
10. **Permissões (D-20).** Todas as importações ficam abertas a qualquer
    Departamento ativo, com o rastro do item 9.

### Faturamento e documentos

11. **Container compartilhado (D-09).** Clientes diferentes não dividem
    container FCL (só veículos LCL, que não pagam Taxas Locais nem Demurrage);
    a importação recusa container FCL em B/Ls de Clientes diferentes. Para B/Ls
    do mesmo Cliente, cada um é faturado com o rateio do container. Quando o
    conjunto muda depois do faturamento (irmão que chega ou é excluído), a
    fatura emitida segue a ADR 0077: sem pagamento, cancelada e reemitida
    automaticamente; com pagamento, a diferença segue o item 4 da ADR 0077.
12. **Recebível sem fatura (D-14).** Só fatura emitida trava o cancelamento e
    a exclusão do B/L. Cancelar ou excluir um B/L sem fatura anula o cálculo e o
    recebível, com registro no Histórico; o recebível sem fatura não aparece
    como pagável no Portal.
13. **Documento congelado (D-21).** Na emissão, a fatura grava razão social,
    CNPJ, **endereço do Cliente**, Viagem, navio, POL e POD; a impressão no Vela
    e no Portal usa essa cópia.

### Reimportações

14. **Carga solta (D-10).** Mesmo contrato do B/L de container: CNPJ diferente
    vira Troca de Consignatário com aceite; os campos do documento, inclusive
    POD, atualizam como correção (B/L faturado pede a confirmação de
    faturamento, e a fatura segue a ADR 0077); B/L de outra Viagem é recusado na
    prévia. A ausência do CE ou do CNPJ no arquivo nunca apaga.
15. **Omissão de Escala (D-22).** Mudar o POD por reimportação ou pela ficha é
    correção; COD nasce só pelo trâmite da Omissão de Escala. A reimportação não
    altera o POD de B/L em COD (os demais campos atualizam, com aviso). B/L com
    POD no porto omitido importado depois da omissão entra como afetado, com
    disposição **Transbordo** (o padrão), herdando o registro global; COD só se o
    operador marcar.
16. **Veículos no arquivo do B/L (D-17).** Sem aba VIN, os veículos não mudam.
    Com aba VIN, ela vale, mas a prévia alerta os conflitos (entram, saem,
    mudam) e pede confirmação; o local de desova dos que continuam é preservado;
    um alerta registra o B/L e as mudanças. Chassi que está em outro B/L recusa
    só a linha.

17. **B/L de container reimportado (D-11).** Laden on Board ilegível ou vazio
    não altera a data gravada (aviso na prévia); todos os portos do cadastro são
    reconhecidos pelo nome, e POD desconhecido recusa a linha; a confirmação de
    faturamento passa a ser por B/L, na linha da prévia; o NCM do documento
    vence quando declarado (ADR 0057 mantida); não existe Cliente pessoa física,
    e CPF continua recusado.

### Fila de efeitos, datas e Demurrage

18. **Processamento automático (D-12).** Depois da correção das tarefas da
    fila, o acumulado roda em simulação; o Administrativo aprova o que estiver
    certo e o resto é descartado com registro. Depois, o `import-effects-runner`
    fica sempre ligado. A ligação em produção é ato do dono, depois do ensaio em
    Preview.
19. **Datas de container (D-13).**
    - Célula ou coluna de devolução vazia não mexe na data gravada; remover é
      caso isolado, pela edição do container, com motivo. A prévia mostra
      "antes → depois".
    - A descarga é a data informada pelo terminal, pela planilha (ou pela edição
      do container, para correção). A ATA não preenche a descarga.
    - A chave da planilha é **B/L + container**; um arquivo pode ter várias
      viagens. A data vale para todos os B/Ls que dividem aquele container na
      mesma Viagem. Datas diferentes para o mesmo container no arquivo recusam
      as linhas.
    - Mudança de datas que altera Invoice de Demurrage emitida: sem pagamento,
      cancelada e reemitida automaticamente (ou só cancelada, se o valor for
      zero); com pagamento, a diferença segue o item 4 da ADR 0077. Abre alerta
      e a Régua de Cobrança para de cobrar a fatura até a situação se resolver.
20. **Demurrage de container compartilhado (D-23).** B/Ls do mesmo Cliente
    ligados por container compartilhado recebem **uma única Invoice de
    Demurrage** com todos os containers do grupo, cada caixa uma vez, emitida
    quando todos estiverem devolvidos.

### Baplie

21. **Marcas físicas (D-15).**
    - IMO, OOG e SOC do Baplie valem para todos os B/Ls ativos que dividem o
      container (Part Lot sempre tem as mesmas características); cancelados são
      ignorados.
    - Perfil IMO/OOG corrigido à mão com justificativa (o armador confirma fora
      do Baplie) não é sobrescrito; o Baplie diferente vira **Divergente**, como
      já ocorre com SOC/COC.
    - O Baplie é sempre completo: marca ausente ou container ausente apaga as
      marcas que vieram do Baplie anterior, depois de confirmação na prévia.
      Marcas do B/L ou manuais continuam protegidas.
    - Containers fora das escalas da Viagem, de outro operador (NAD) ou em
      transbordo (8249) são ignorados com aviso, sem bloquear o arquivo; OOG só
      com excesso de dimensão maior que zero; carga em quantidade limitada (LQ)
      é carga normal, sem THD de IMO; Baplie de outro navio ou viagem é
      bloqueado; dígito verificador errado gera aviso; a divergência SOC/COC
      ganha a ação **Vale o B/L**, com motivo.

### Demais importações

22. **Leitura de planilhas (D-16).** Duas colunas para o mesmo campo bloqueiam;
    linhas e abas ocultas são ignoradas com aviso (o filtro indica importar só o
    visível); CSV Windows-1252 é aceito com aviso.
23. **Veículos (D-17).** Na página Veículos, **Mover para outro B/L** e
    **Excluir** valem para qualquer usuário, com motivo, mesmo com CE no B/L; o
    efeito na cobrança segue a ADR 0077. A busca do B/L "parecido" sai: B/L
    inexistente recusa a linha. O local de desova da planilha só preenche vazio;
    divergência pede confirmação. Mesmo chassi em outra Viagem é erro (salvo
    registro anterior em B/L ou Viagem cancelados). Tipos ISO equivalentes
    (40HQ = 40HC), lacre sem zeros à esquerda e lacre opcional para flat rack e
    plataforma.
24. **Base de Clientes (D-18).** Vincula só os B/Ls pendentes de Cliente,
    mostrados na prévia, como vínculo por documento; a Revisão é liberada e o
    faturamento segue. B/L rejeitado nunca é vinculado pela Base: recebe o
    Cliente manualmente na Revisão. Razão social diferente pede confirmação.
25. **Granito e vazios (D-19).** A reimportação de Granito atualiza por número
    de B/L na Viagem, preservando CE e Cliente; a de Vazios de Importação da
    mesma rota substitui o manifesto preservando a natureza; o recadastro de
    vazios pelo Baplie preserva a natureza; o Embarque de Vazios atualiza por
    container e preserva as unidades manuais.

## Consequências

- O CE passa a ter duas portas com a mesma validação no banco (planilha e ficha)
  e uma regra de unicidade imposta; a correção pela ficha deixa rastro.
- Toda alteração de valor em fatura emitida por correção posterior, inclusive de
  Demurrage e de rateio, segue um mecanismo só (ADR 0077).
- As importações deixam de apagar dado por ausência, exceto no Baplie, que é
  sempre completo e pede confirmação.
- O `import-effects-runner` só é ligado depois das correções da fila, do ensaio
  em Preview e da aprovação do acumulado.

## Diferença de fatura paga

Quando uma fatura já paga passa a valer menos (itens 11, 14, 16, 19 e 23), vale
o item 4 da ADR 0077: abate-se o saldo ainda aberto da própria fatura e o
excedente vira **restituição**. Não há crédito para abater em outra fatura
(decisão do dono, 2026-10-09).

## Evidência

Casos reproduzidos em banco local (PostgreSQL 16, replay das migrations) e nas
checagens `it.fails` descritas na seção 7 do relatório da revisão. Nenhum dos
comportamentos decididos está implementado nesta data.
