# 0095 — Importações: regras de entrada, concorrência e rastro da revisão de 2026-10-21

Status: aceito — 2026-10-21 (respostas do responsável às perguntas da
[revisão das importações](../archive/audits/2026-10-21-revisao-importacoes.md)).
Leitura de arquivo e mensagens implementadas na PR luccafwlog/vela#1020; o
restante, pelos lotes do [plano](../archive/plans/2026-10-21-frente-das-importacoes.md),
já executado (migrations `392` a `406`; revisão em
[2026-10-22](../archive/audits/2026-10-22-revisao-pr-1021.md)).

Estende a [ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)
e a [ADR 0092](./0092-importacao-com-erro-e-recusada-inteira.md); muda em parte o
item 9 da 0078 (decisão 3 abaixo). Convive com a
[ADR 0094](./0094-preco-fixo-na-importacao.md), que ficou com preço, cálculo,
faturamento, escrita direta, RPCs antigas, B/L cancelado somente leitura e
carga solta faturada. Os códigos entre parênteses (A2, B1…) são as perguntas
da revisão; F-xx são os achados dela.

## Contexto

A revisão encontrou regras que só o navegador confere, importações da mesma
Viagem sem trava, leitores que inflam ou encolhem números por mil, portos
juntados no banco e separados no leitor, efeitos que ficam órfãos e um
Histórico que não mostra boa parte do que a importação muda. A parte de preço
e faturamento foi resolvida na PR luccafwlog/vela#1019 (ADR 0094); esta ADR
registra o resto.

## Decisão

### Arquivo e leitura

1. **Números.** Com unidade de tonelada, ponto seguido de três casas é decimal
   ("25.350 MT" = 25,35 t); cubagem com vírgula é decimal. Número ambíguo
   bloqueia a linha na prévia nas duas direções (inflar ou encolher), salvo
   quando o próprio arquivo prova o separador ou o operador declara o formato;
   o Manifesto BB no modelo do Vela (`WEIGHT (TON)`, `CBM (M3)`) é sempre
   vírgula decimal com três casas. Número descartado sempre gera aviso.
   (B10a, B10b — F-02, F-30)
2. **Uma aba só.** Planilha com mais de uma aba visível com dados é recusada,
   nomeando as abas, em toda importação por planilha, inclusive Veículos.
   (B19 — F-37)
3. **Hash do arquivo.** Cada importação grava nome, hash, quem e quando; o
   reenvio do mesmo arquivo só avisa. Muda em parte o item 9 da 0078. (B2)
4. **Mensagens.** Recusa do banco aparece em português, com o B/L ou a linha;
   nunca código cru nem inglês. (F-36, B13b)

### Viagem e concorrência

5. **B/L que já está em outra Viagem é recusado sempre**, com mensagem clara.
   Na rolagem, o operador exclui o B/L na Viagem antiga e importa na nova;
   cancelar não basta, porque o B/L cancelado continua com o número (decisão
   confirmada em 2026-10-21, migration `393`). A importação deixa de mover B/L
   entre Viagens. (A2)
6. **Trava por Viagem.** Toda importação de Viagem, inclusive Baplie × Baplie,
   pega a mesma trava no início; a segunda espera. (B4 — F-04, F-11)
7. **Exclusão.** Excluir B/L ou Viagem encerra os efeitos pendentes como
   "descartado: registro excluído", sem alerta; excluir Viagem apaga os vazios
   de importação dela, e o diálogo mostra quantos. (B3a, B3b — F-14, F-33a)
8. **B/L cancelado no arquivo** é aviso e não é tocado (0092) em todo arquivo;
   o aviso orienta a reativar pela ficha (Administrativo) e importar de novo. A
   importação não reativa. (B7, B8)
9. **Refixar o preço** na reimportação de B/L não faturado: a prévia mostra
   "preço do dia da importação → preço de hoje" e o operador marca o aceite; a
   importação leva o pedido ao servidor, que só então refixa (ADR 0094, A2).
10. **Confirmação de faturamento do arquivo de B/L** só existe com fatura
    emitida, e é conferida no servidor; sem ela, nem containers nem os totais
    do B/L mudam. (A6 — F-05, F-27)

### Baplie

11. **Substitui só os PODs marcados**; o resto da Viagem fica. (B1 — F-21)
12. **Portos.** BRNVT ≠ BRITJ e BRREC ≠ BRSUA: `normalize_port_code` deixa de
    juntá-los; o leitor reconhece os códigos de três letras do 1.5; POD fora das
    escalas é aviso visível. (B11a, B11b — F-08)
13. **Sem navio e viagem (TDT):** aceito com confirmação na prévia; Viagem,
    escalas e duplicatas conferidas também no servidor. (B12a — F-16)
14. **Navio compartilhado:** "outro armador" pelo código do armador da Viagem
    (o cadastro guarda os códigos); container de outro código fica fora das
    marcas e da conciliação, com contagem na prévia. (B12b)
15. **Transbordo** (EQD 8249 = 6) entra marcado, aparece na conciliação e não
    leva marcas aos B/Ls. (B12c)
16. **Peso** é o VGM; sem VGM, o WT. Arquivo cortado (sem UNT/UNZ ou contagem
    errada) é erro de arquivo. (B12d — F-09, F-44)
17. **IMO declarado na reimportação do B/L** marca só os containers novos, como
    hoje. (B16)

### CE e Manifesto Mercante

18. CE em B/L em Revisão ou sem tabela fica "aguardando", sem alerta crítico; o
    alerta crítico é só para falha técnica. (B13a — F-13)
19. Remover o CE ou cancelar o B/L tira o B/L do Manifesto Mercante, com rastro;
    reativar ou registrar o CE de novo o recoloca. (B14a — F-49)
20. B/L que muda de rota com CE fora do Manifesto da rota abre o alerta "CE fora
    do Manifesto da rota" para a Documentação. (B14b)

### Vazios

21. O vazio de importação existe uma vez por Viagem; a planilha vale sobre o
    Baplie, que só mostra a diferença. (B15a — F-32)
22. ADR de Saída fechado trava tudo no Embarque de vazios. (B15b)

### ATD, Histórico, efeitos, veículos e LCL

23. A correção manual do ATD do POL vence; B/L cancelado não conta. (B17 — F-48)
24. O Histórico do B/L mostra tudo o que a importação muda, com rótulos sem
    termos técnicos; mudanças da Base de Clientes aparecem na ficha do Cliente
    com origem. (B18 — F-23)
25. Efeito bloqueado é reprocessado no próprio alerta, com justificativa; efeito
    de usuário desativado roda como "Vela (automático)", registrando quem
    iniciou. (B20a, B20b — F-13, F-42)
26. **Veículos só entram pela planilha de Veículos.** A aba VIN do arquivo de
    B/L é ignorada (acaba a exceção `vela.vin_reissue` da ADR 0094); veículos já
    gravados por ela ficam. Chassi que já existe na Viagem é recusado. Um local
    de desova por container físico. (B21 — F-50)
27. **LCL** vem no arquivo de B/L: a importação grava `container_load_type`, e
    "FCL não se divide entre Clientes" respeita o LCL. (B22 — F-50)
28. A Base de Clientes é contingência; o tempo dela (F-54) fica como melhoria.
    (B23)

## Consequências

- Regras que eram só do navegador passam ao servidor (F-15, F-16, F-29).
- `normalize_port_code` muda; dados gravados com a forma juntada são migrados
  sob o "Data status" do AGENTS.md.
- A aba VIN deixa de gravar veículos: a importação de B/L e o alerta
  `bl_vehicles_changed_on_reimport` mudam.
