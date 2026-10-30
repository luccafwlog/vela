# Manual do Operador

Fonte do Manual do Operador do Vela, escrito a partir do comportamento atual do
sistema ([plano](../plans/2026-10-26-manual-do-operador.md)). O manual diz como
agir; a regra continua no documento de módulo.

O mapeamento que deu origem à matriz (números, quem faz o quê pelo código,
sumário final proposto e divergências) está no
[relatório de 2026-10-26](../archive/reports/2026-10-26-mapeamento-manual-do-operador.md).

## Catálogo de situações

[`situacoes/`](situacoes/README.md) lista, por capítulo, os objetivos de quem
usa o Vela ("Quero fazer…") e as situações comuns fora do caminho normal
("Aconteceu…"), cada uma ligada às regras desta matriz. É a pauta da redação de
cada capítulo.

## Matriz de cobertura

[`cobertura/`](cobertura/) liga cada regra de negócio do código ao lugar do
manual que a explica. Há um arquivo por área do sistema. Cada linha traz a
regra como o operador a vê, o destino no manual, os setores envolvidos e os
itens do código que a implementam.

`npm run manual:coverage` (banco local preparado, ver
[WORKFLOW.md](../../WORKFLOW.md#testes-de-integração); roda também no job `db`
do CI) extrai o inventário do sistema e falha quando:

- um item do sistema não tem lugar na matriz;
- a matriz cita um item que deixou de existir;
- uma linha usa um destino fora da legenda abaixo.

Os itens são citados entre crases pelo identificador do inventário:

| Prefixo | Item |
|---|---|
| `rota:` | Tela com endereço próprio (Vela e Portal) |
| `funcao:` | Função do banco que a tela pode chamar |
| `gatilho:` | Regra que o banco executa sozinho ao gravar um registro |
| `restricao:` | O que o banco recusa gravar (valor, combinação de campos) |
| `unico:` | O que o banco não deixa repetir |
| `politica:` | Quem pode gravar diretamente numa tabela |
| `rotina:` | Rotina por horário |
| `servidor:` | Função de servidor (e-mail, Portal, Itaú, alertas…) |
| `alerta:` | Tipo de alerta do catálogo |
| `email:` | Modelo de e-mail |
| `permissao:` | Linha da matriz "O que cada setor pode" |
| `parametro:` | Parâmetro do sistema |
| `arquivo:` | Área de arquivos enviados |

Mensagens de erro do banco são citadas pelo texto exato, na seção Mensagens.

### Destinos

| Código | Onde |
|---|---|
| `Op 1` | O Vela e o Portal Fwlog: entrar, perfil, menu, como o Vela fala, rotina diária e Painel, relatórios, quando o sistema falha |
| `Op 2` | Equipes, o que cada perfil pode e não pode, cancelar e excluir, a quem passar |
| `Op 3` | O caminho de uma Viagem do começo ao fim |
| `Op 4` | Viagens, Escalas, datas do navio, Chegadas e Saídas, Line-Up, cadastros de apoio |
| `Op 5` | Importação: arquivo de B/L, CE Mercante, Baplie e demais importações |
| `Op 6` | A ficha do B/L |
| `Op 7` | Revisão |
| `Op 8` | Equipamentos: containers, veículos, Vazios, Granito, Demurrage operacional |
| `Op 9` | ADR de Saída |
| `Op 10` | Desbloqueio de CE |
| `Op 11` | Cadastro do Cliente e Central de Informações |
| `Op 12` | Portal: conta do Cliente e o que ele vê |
| `Op 13` | E-mails que o Cliente recebe |
| `Op 14` | Suporte ao Cliente |
| `Op 15` | Gatilhos e rotinas por horário |
| `Op 16` | Alertas |
| `Op 17` | Financeiro visto pela operação |
| `Ap. A` | Glossário |
| `Ap. B` | Mensagens do sistema |
| `Ap. C` | Status e cores |
| `Ap. D` | "Quero fazer… → onde fica" |
| `Fin` | Volume do Financeiro |
| `Adm` | Volume do Administrativo |
| `Fora` | Sem efeito na operação, com o motivo na seção "Itens sem efeito na operação" |

### Setores

`Todos`, `Adm` (Administrativo), `Fin` (Financeiro), `Ope` (Operações), `Doc`
(Documentação), `Equ` (Equipamentos), `Sistema` (o sistema faz sozinho) e
`Cliente` (pelo Portal). A coluna diz quem o sistema deixa fazer e quem ele
avisa, não uma divisão de trabalho que o código não aplica.

## Atualizações da matriz

A matriz foi lida na `staging` em `9839364` (2026-10-26) e é mantida em dia com
o sistema. Cada mudança cita a data e a migration na própria linha.

- **Correções decididas pelo dono** (lotes 1 a 11 do
  [plano](../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md)): a linha da
  divergência corrigida diz "Corrigida no sistema em 2026-10-27" e as regras
  descrevem o comportamento novo.
- **Staging até `c3be255` (2026-10-27)**, revisada contra as decisões do dono
  sem conflito:
  - Baplie: CNTCG e TCG lidos como Taicang e o fim de mensagem do Baplie 1.5
    da COSCO sem aviso (migration `465`; CEB-060, CEB-061).
  - Desbloqueio de CE: prazo da tarde às 12:00 do próximo dia útil, linha do
    prazo no Portal, "Consulte o SISCARGA" e resposta e rodapé dos avisos em
    importacao@fwlog.com.br (migration `466`; DCE-017, DCE-031, DCE-090 a
    DCE-092, POR-099).
  - Faturamento: individual coberta aparece no detalhe do Portal como "Paga ·
    coberta pela fatura X" (POR-073) e **Fatura desatualizada** passou a
    Crítico (migration `467`; catálogo de alertas).
  - Viagem › Rotas e Manifestos: rota com omissão com "(Omitida)",
    "(Transbordo)" e "(Destino Final)" (VIA-053, CEB-043).
  - Veículos: **Esta viagem não terá veículos** e o alerta crítico **Planilha
    de Veículos pendente** de Equipamentos (migration `468`; EQU-128, EQU-129,
    catálogo de alertas, contagens de ACE-119 e ALE-D13).
  - Telemetria: recusas do banco já explicadas na tela deixam de ir ao Sentry;
    sem efeito na operação.
- **Alterar, excluir e isentar as Taxas Locais do B/L** (pedido do dono de
  2026-10-28, [ADR 0111](../adr/0111-alterar-excluir-e-isentar-taxas-locais-do-bl.md),
  [plano](../archive/plans/2026-10-28-alterar-taxa-calculada-do-bl.md)):
  - Lote 1 (migration `491`): alterar valor por unidade ou total, excluir e
    desfazer taxa, por qualquer setor com justificativa; marcas **Alterada** e
    **Excluída**; bloco **Histórico das taxas**; a alteração sobrevive aos
    recálculos e só se perde com a troca de tabela; excluir cobrança manual
    deixa de ser só do Administrativo (TAX-076, TAX-082, TAX-083, TAX-085,
    TAX-090, TAX-093 a TAX-100, ACE-098 e as mensagens novas).
  - Lote 2 (migration `492`): **Isentar Taxas Locais** e **Retirar
    isenção** na ficha, por qualquer setor com justificativa; o B/L isento à
    mão fica Isento em todo recálculo e sem ação nas taxas; o Desbloqueio de
    CE considera o Financeiro atendido (TAX-101 a TAX-104, DCE-011, ACE-128,
    `permissao:isentar-taxas-locais` e as mensagens novas).
  - Lote 3 (migration `493`): as ações valem no B/L faturado e passam pela
    correção da fatura (reemissão, abatimento e Restituição, Fatura
    desatualizada); a confirmação diz o efeito antes de gravar e o Histórico
    das taxas guarda o efeito; Origem **Alterado** no detalhe da fatura do
    Vela, sem a marca no Portal (FAT-173 a FAT-176, REC-102, POR-131, TAX-077,
    TAX-100 e as mensagens novas; saiu a mensagem provisória do B/L faturado).
  - Lote 4 (migration `494`): a alteração aparece fora da ficha do B/L:
    filtro, coluna do Exportar e avisos da Validação, aviso da consolidada e do
    Recalcular da Revisão, lista **B/Ls com taxa alterada** na ficha do
    Cliente, Histórico de ações legível e aviso de divergência pela parte do
    B/L (TAX-105, TAX-106, FAT-177, FAT-178, CLI-108 e a mensagem nova).
  - Lote 5 (migration `495`): o diálogo **Taxas alteradas à mão serão
    afetadas** (**Gravar mesmo assim**) na ficha, na correção de container, no
    COD e em Veículos; a seção **Taxas alteradas à mão** nas prévias de B/L e
    Manifesto BB e a pergunta no Baplie; o alerta **Taxa alterada à mão mudou**
    (BLR-150, CEB-099, EQU-130, VIA-145, ALE-086 e a marca interna da
    simulação).
  - Revisão da PR luccafwlog/vela#1080 (migration `497`): a confirmação do
    efeito na fatura segue a mesma ordem da correção (consolidada, saldo do
    B/L, Portal sem Liberação; FAT-175); **Revisar alteração** não repete e
    **Voltar** no meio não abre a confirmação (TAX-095); o **Gravar mesmo
    assim** passa a valer também para o peso de contêiner e o COC/SOC da
    correção de container (BLR-150), para o SOC/COC do arquivo de B/L, o B/L
    que passa a dividir o container e toda gravação do Baplie (CEB-099), para
    os veículos selecionados de outras páginas (EQU-130) e para **Reverter
    para transbordo** (VIA-145).
  - Decisão do dono de 2026-10-28 (migration `498`): taxa com total alterado
    cuja quantidade vai a zero sai da cobrança, com a alteração guardada; a
    prévia pede o **Gravar mesmo assim** e, sem ele, abre o alerta (BLR-150,
    ALE-086).
- **Disparo de Comunicados por Viagem escolhida** (revisão da comunicação
  manual de 2026-10-30; tela, sem migration): Navio / Viagem passa a ser a
  Viagem escolhida na lista e obrigatória, POL e POD viram listas com
  **Todos**, a conferência mostra o Porto, os B/Ls sem Cliente e o motivo da
  lista vazia, e o lote conta "Enviando N de M…" (CLI-059, CLI-066, CLI-068 e
  a mensagem da tela). Na **Cobertura de viagens**, a coluna **Sem Cliente**
  mostra os B/Ls sem Cliente como pendência, com os consignatários e o atalho
  para a Revisão no detalhe da linha (CLI-080).
- **Recusa da carga solta em outra Viagem** (decisão do dono de 2026-10-28,
  pergunta P1 da situação S6.03; migration `500`): a prévia e a gravação do
  Manifesto BB e do B/L avulso mandam excluir o B/L na outra Viagem e importar
  de novo, como o arquivo de B/L de container, em vez de corrigir a Viagem
  pela ficha (BLR-053 e a mensagem do banco).
- **Recusa do banco na omissão, no transbordo e no COD** (decisão do dono de
  2026-10-28, pergunta P4 da situação S4.21; tela, sem migration): **Omitir
  escala**, **Complementar**, **Reverter omissão**, **Marcar COD** e **Reverter
  para transbordo** recusados mostram o motivo do banco, pelo mesmo tradutor
  das outras telas; "Verifique se algum B/L está em COD." só complementa a
  recusa por B/L em COD (VIA-070, VIA-058, VIA-064 e as mensagens).
- **Conferência do capítulo-piloto contra o código** (2026-10-28, sem mudança
  no sistema): linhas que descreviam outra coisa que o código faz. O Baplie
  nunca cria escala (VIA-052, desde a migration `418`); todos os setores mudam
  terminal, ATB, ATD, Restow e frentes da atracação (ACE-085, como a ACE-120);
  o botão que recusa o diálogo das taxas alteradas à mão é **Voltar** (VIA-145);
  sem carga solta e sem próxima escala a tela mostra "—" (VIA-008, VIA-009); a
  conferência do LOCODE e a criação do porto não valem na escala nova só de
  importação (VIA-033); o resultado do CE lista os Retidos e os Pulados por B/L
  (CEB-019); **Remover CE** com fatura emitida é recusado pela própria ação
  (BLR-107); a importação de B/L sem usuário ativo mostra "Usuario sem
  permissao ativa." (ALE-065).
- **Defeitos corrigidos depois da conferência do piloto** (decisão do dono de
  2026-10-29, PR luccafwlog/vela#1092; telas, e a migration `505` para o
  motivo da exclusão): escala nova só de importação com LOCODE brasileiro novo
  ou fora do formato (VIA-033); **Adicionar navio** não apaga datas da Viagem
  existente (VIA-106); mesmo dia não tira a hora e escala só de exportação não
  vira importação (VIA-107, VIA-113); confirmação de **Não escala** por equipe
  e recusa da trava sem gravação parcial (VIA-108); ETA com hora vencido e
  filtro **Período** pelo dia (VIA-009); motivo da recusa de navio na tela
  (VIA-011, VIA-106); mensagem dos vazios de exportação (EQU-077); datas da
  prévia do B/L em dd/mm/aaaa e motivo da exclusão em português
  (`delete_record_block_reason`).
- **Efeito de importação que espera tabela de cobrança** (2026-10-29, sem
  mudança no sistema): o B/L sem tabela de cobrança já tem o cálculo em
  revisão, e a fatura dele não sai sozinha quando a tabela é cadastrada; sai ao
  importar de novo a planilha do CE ou ao recalcular o B/L (BLR-138, TAX-015;
  regra em
  [manifesto-edi.md](../modules/manifesto-edi.md), item 20 dos efeitos de
  importação).
- **Excluir Cliente** (2026-10-29, sem mudança no sistema): a matriz e a
  [Segurança](../operations/seguranca.md#modelo-de-permissões-por-perfil) davam
  a exclusão de Cliente ao Administrativo sem dizer que a Trava de exclusão
  recusa todo Cliente com CNPJ, que é obrigatório; Cliente se desativa (ACE-088).
