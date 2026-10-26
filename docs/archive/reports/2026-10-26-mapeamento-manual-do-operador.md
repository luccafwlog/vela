# 2026-10-26 — Mapeamento do sistema para o Manual do Operador

Relatório de execução da Etapa 1 do
[plano do Manual do Operador](../../plans/2026-10-26-manual-do-operador.md).
Nasce histórico: registra o que foi lido, conferido e encontrado nesta data. A
matriz de cobertura viva fica em [`docs/manual/cobertura/`](../../manual/README.md);
a regra vigente de cada tela continua no documento de módulo.

## 1. Resumo

- **Nada do sistema ficou sem lugar no manual.** Os 2.253 itens que o código e
  o banco expõem (telas, funções que as telas chamam, regras automáticas,
  restrições, rotinas, funções de servidor, alertas, e-mails, linhas da matriz
  de permissões e mensagens de erro) estão citados na matriz de cobertura.
  `npm run manual:coverage` confere isso contra o banco local e passou.
- **1.560 regras** foram escritas como o operador as vê, cada uma com o
  destino no manual, os setores envolvidos e o código que a implementa. Mais
  **1.493 linhas de mensagens**, com o texto exato e quando aparecem, e
  **419 imagens** planejadas.
- **Cada área teve uma conferência independente**: outra leitura do código,
  sem partir do texto já escrito. Ela corrigiu **250 regras** e acrescentou
  **38**. Um em cada seis textos da primeira passada estava impreciso, e essa
  é a medida do valor da segunda leitura.
- **Quem faz o quê saiu do código** (seção 4), e não de suposição: setor único
  por usuário, a matriz "O que cada setor pode" conferida linha a linha contra
  o banco, as restrições que a matriz não mostra, os cartões do Painel e os
  alertas que cada setor recebe.
- **197 divergências** entre o código e a documentação. As
  **79 da classe a** (documento defasado) foram corrigidas nos
  documentos vivos nesta entrega. As **118 das classes b e c** dependem
  de decisão do dono (seção 6). Doze pontos, destacados na seção 6.1, afetam o
  Cliente ou a rotina logo na abertura.

O que o dono aprova para fechar a Etapa 1: a lista "fora do manual" (seção 7),
as decisões das divergências (seção 6) e o sumário final (seção 5).

## 2. Ambiente e método

- **Ponto de partida:** `staging` em `9839364` (2026-10-26, depois do merge da
  luccafwlog/vela#1065). Branch de trabalho `claude/wonderful-pasteur-ot9ni3`.
- **Banco:** Postgres 16 local, recriado do zero por
  `scripts/setup-local-pg.sh --reset` com as 461 migrations da cadeia ativa
  (a última é a `464`). O estado final de cada regra é a última definição de
  cada função, gatilho, restrição e política.
- **Inventário** (`npm run manual:inventory`): rotas de `AppInterno.tsx` e
  `AppPortal.tsx`; funções de servidor; modelos de e-mail; linhas de
  `permissionMatrix.ts`; funções executáveis pela tela ou chamadas pelo código;
  funções de gatilho com as tabelas em que estão ligadas; restrições `CHECK`;
  índices únicos; políticas de escrita; rotinas de `cron.job`; o catálogo de
  alertas; parâmetros de `app_settings`; áreas de arquivos; e o texto de cada
  `RAISE EXCEPTION` literal.
- **Mapeamento por área:** 13 áreas, cada uma com uma lista fechada de itens.
  Regra escrita a partir do código; documentação usada só como mapa.
- **Conferência independente:** uma leitura nova por área, que monta a própria
  lista do que a área faz antes de comparar com o texto do autor e corrige no
  lugar.
- **Correção da documentação:** cada divergência da classe a foi reconferida no
  código antes de o documento mudar. ADR e arquivo histórico não foram tocados.
- **Evidência:** **Código** (leitura estática do código e das definições no
  banco local). Nada foi executado em tela, nenhuma função foi chamada e nada
  foi gravado no banco. O material antigo de 2026-10-15 serviu só de
  referência de redação.

## 3. Números

### 3.1 Inventário do sistema

| Item | Quantidade |
|---|---|
| Telas com endereço próprio (Vela e Portal) | 63 |
| Funções do banco que a tela pode chamar | 360 |
| Regras automáticas (funções de gatilho) | 237 |
| Restrições de valor | 287 |
| Regras de "não pode repetir" | 89 |
| Políticas de quem grava direto | 75 |
| Rotinas por horário | 16 |
| Funções de servidor | 24 |
| Tipos de alerta (50 ativos) | 55 |
| Modelos de e-mail | 19 |
| Linhas da matriz "O que cada setor pode" | 39 |
| Parâmetros do sistema | 7 |
| Áreas de arquivos | 3 |
| Mensagens de erro do banco | 979 |
| **Total** | **2.253** |

### 3.2 Por área

| Área | Regras | Mensagens | Imagens | Conferência: corrigidas / novas | Divergências a / b / c |
|---|---|---|---|---|---|
| [Entrada, navegação, usuários e permissões](../../manual/cobertura/01-acesso-admin.md) | 127 | 121 | 40 | 18 / 5 | 5 / 9 / 3 |
| [Viagens e ADR de Saída](../../manual/cobertura/02-viagens-adr.md) | 144 | 144 | 44 | 21 / 2 | 7 / 10 / 0 |
| [B/L e Revisão](../../manual/cobertura/03-bl-revisao.md) | 149 | 116 | 41 | 13 / 2 | 4 / 8 / 0 |
| [CE Mercante e Baplie](../../manual/cobertura/04-ce-baplie.md) | 98 | 111 | 26 | 26 / 2 | 4 / 9 / 0 |
| [Equipamentos](../../manual/cobertura/05-equipamentos.md) | 127 | 189 | 32 | 27 / 5 | 11 / 2 / 0 |
| [Clientes e Comunicados](../../manual/cobertura/06-clientes-comunicacao.md) | 107 | 98 | 24 | 9 / 5 | 4 / 13 / 1 |
| [Portal](../../manual/cobertura/07-portal.md) | 130 | 67 | 41 | 21 / 1 | 3 / 10 / 0 |
| [Desbloqueio de CE](../../manual/cobertura/08-desbloqueio-ce.md) | 109 | 96 | 31 | 19 / 4 | 9 / 8 / 0 |
| [Taxas Locais](../../manual/cobertura/09a-taxas-locais.md) | 92 | 57 | 25 | 26 / 2 | 4 / 13 / 1 |
| [Faturamento](../../manual/cobertura/09b-faturamento.md) | 172 | 176 | 34 | 23 / 2 | 9 / 7 / 0 |
| [Recebimento](../../manual/cobertura/10-recebimento.md) | 101 | 119 | 30 | 17 / 2 | 7 / 4 / 1 |
| [Demurrage](../../manual/cobertura/11-demurrage.md) | 119 | 153 | 32 | 15 / 3 | 7 / 5 / 1 |
| [Alertas e rotinas](../../manual/cobertura/12-alertas-rotinas.md) | 85 | 46 | 19 | 15 / 3 | 5 / 13 / 0 |
| **Total** | **1.560** | **1.493** | **419** | **250 / 38** | **79 / 111 / 7** |

## 4. Quem faz o quê, pelo código

O detalhe, com cada linha da matriz conferida contra a guarda do banco, está em
[Entrada, navegação, usuários e permissões § Quem faz o quê](../../manual/cobertura/01-acesso-admin.md#quem-faz-o-quê).

- **Um setor por usuário.** O banco aceita um único setor: Administrativo,
  Financeiro, Operações, Documentação, Equipamentos e o antigo Operador, que
  conta como Documentação. Quem precisa agir como dois setores só consegue com
  dois usuários ou com o Administrativo, que passa em todas as guardas.
- **Quase tudo é de qualquer setor.** Criar e editar Viagem, escala e
  programação, importar arquivos, cadastrar Cliente, emitir e corrigir fatura,
  gerar Invoice de Demurrage, dar desconto e autorizar restituição são
  permitidos aos cinco setores. Onde o código não distingue setores, o manual
  diz "qualquer setor".
- **As 39 linhas da matriz batem com o banco.** A conferência achou restrições
  que a matriz não mostra. Exemplo: quem não é do Administrativo não vê o nome
  de outra pessoa como autor nos históricos do B/L, do Cliente e da Viagem.

| Equipe | Só ela (com o Administrativo) | Assina no ADR de Saída | Recebe |
|---|---|---|---|
| Documentação | Provisionar o Portal (convite, conta, suspensão, e-mail de recuperação); gerir o Desbloqueio de CE. Com Equipamentos: contatos, Caixas de Comunicação e Comunicados | Carga descarregada e Vazios descarregados | 38 tipos de alerta no sino; cartão Documentação no Painel; resumo diário do Portal |
| Equipamentos | Responder, reabrir e anexar na Disputa de Demurrage. Com o Financeiro: Informar PTAX e ROE manual. Com a Documentação: contatos e Comunicados | Carga carregada, Veículos e Embarque de vazios | Disputa de Demurrage, PIX sem conciliação segura e as pendências do ADR da própria seção; cartão Equipamentos |
| Operações | Nenhuma linha exclusiva na matriz; na atracação, terminal, ATB, ATD e frentes | Escala | Exportação pendente pós-ATD, datas pendentes e as pendências do ADR da seção Escala; cartão Operações |
| Financeiro | Baixa manual, confirmar restituição, liquidar Ajuste de COD, conciliar Pix. Com Equipamentos: Informar PTAX e ROE manual | Nada | 4 tipos no sino; sem cartão próprio no Painel (contam no cartão Administrativo) |
| Administrativo | Usuários, cancelar e excluir com motivo, Liberação de faturamento, cancelar fatura e baixa, ligar o envio real de e-mails, corrigir tabela já usada | Qualquer seção (cobre quem faltar) | 16 tipos e os críticos sem destinatário; cartão Administrativo; resumo diário do Portal |

## 5. Sumário final proposto

A matriz de cobertura usa os códigos do sumário do plano (`Op 1` a `Op 17`).
O volume de regras pede dividir alguns capítulos. A tabela diz de onde vem cada
capítulo final; os códigos da matriz não mudam.

| Destino na matriz | Regras |
|---|---|
| `Op 1` | 95 |
| `Op 2` | 140 |
| `Op 3` | 4 |
| `Op 4` | 163 |
| `Op 5` | 194 |
| `Op 6` | 160 |
| `Op 7` | 54 |
| `Op 8` | 207 |
| `Op 9` | 55 |
| `Op 10` | 74 |
| `Op 11` | 105 |
| `Op 12` | 179 |
| `Op 13` | 103 |
| `Op 14` | 75 |
| `Op 15` | 338 |
| `Op 16` | 120 |
| `Op 17` | 391 |
| `Ap. A` | 26 |
| `Ap. B` | 56 |
| `Ap. C` | 44 |
| `Ap. D` | 21 |
| `Fin` | 317 |
| `Adm` | 115 |
| `Fora` | 2 |

**Manual do Operador — sumário final proposto**

| Parte | Capítulo | Vem de |
|---|---|---|
| I. Entendendo o Vela | 1. O Vela e o Portal Fwlog: entrar, sessão e inatividade, menu, como o Vela fala, rotina diária e Painel, relatórios, quando o sistema falha | `Op 1` |
| | 2. Equipes, permissões e a quem passar | `Op 2` |
| | 3. O caminho de uma Viagem, do começo ao fim | `Op 3` |
| II. Operação | 4. Viagens e Escalas: criar, datas do navio, atracação, omissão, transbordo e COD, cancelar | `Op 4` (área Viagens) |
| | 5. Programação: Chegadas e Saídas, Line-Up, Tela TV e cadastros de apoio | `Op 4` (Chegadas e Saídas, Line-Up, cadastros) |
| | 6. Importação da documentação: arquivo de B/L, carga solta, CE Mercante, Manifesto, Baplie e o que acontece depois | `Op 5` |
| | 7. A ficha do B/L | `Op 6` |
| | 8. Revisão | `Op 7` |
| | 9. Containers, datas e a Demurrage na operação | `Op 8` (containers e datas) |
| | 10. Veículos, Vazios, Embarque de vazios, Locais e Granito | `Op 8` (demais) |
| | 11. ADR de Saída | `Op 9` |
| | 12. Desbloqueio de CE | `Op 10` |
| III. O Cliente | 13. Cadastro do Cliente, contatos e Central de Informações | `Op 11` |
| | 14. Portal: a conta do Cliente | `Op 12` (conta e acesso) |
| | 15. Portal: o que o Cliente vê e faz | `Op 12` (telas do Cliente) |
| | 16. E-mails e Comunicados | `Op 13` |
| | 17. Suporte ao Cliente | `Op 14` |
| IV. O sistema sozinho | 18. O que muda sozinho depois de cada ação | `Op 15` (gatilhos) |
| | 19. Rotinas por horário | `Op 15` (rotinas) |
| | 20. Alertas e Notificações Internas | `Op 16` |
| V. Financeiro visto pela operação | 21. Taxas Locais: como o sistema calcula, adicionar e alterar taxa | `Op 17` (Taxas Locais) |
| | 22. A fatura: o que segura, como sai, como se corrige e se cancela | `Op 17` (Faturamento) |
| | 23. Demurrage: free time, Invoice, PTAX, desconto e Disputa | `Op 17` (Demurrage) |
| | 24. Pagamento e restituição: o que a operação precisa saber | `Op 17` (Recebimento) |
| Apêndices | A. Glossário · B. Mensagens do sistema · C. Status e cores · D. "Quero fazer… → onde fica" · E. Índice remissivo | `Ap. A` a `Ap. D` |
| À parte | Guia de bolso por equipe | `Op 1`, `Op 2` |

As regras com destino `Fin` e `Adm` ficam para os volumes do Financeiro e do
Administrativo. O operador as encontra como "quem faz e como pedir" nos
capítulos 2 e 21 a 24.

## 6. Divergências para decisão do dono

As divergências da classe a já foram corrigidas na documentação (seção 8).
Aqui estão as das classes **b** (o código diverge da decisão registrada:
possível defeito ou texto de tela errado) e **c** (os documentos se
contradizem e o código não resolve). Nenhuma foi corrigida no código: cada
decisão vira tarefa própria, e o manual descreve o que o sistema faz hoje, com
o aviso "comportamento em revisão" enquanto a decisão não vem.

### 6.1 As que afetam o Cliente ou a rotina logo na abertura

| Nº | O que acontece hoje | Por que pesa |
|---|---|---|
| [Portal POR-D13](../../manual/cobertura/07-portal.md#divergências) | Trocar o e-mail de recuperação pelo atendimento ou **Liberar endereço bloqueado** deixa o Portal pronto, mas não emite as faturas que estavam retidas por falta de Portal. A Validação segue dizendo "Conta do Portal não ativa" | Cliente fica sem fatura sem ninguém perceber |
| [Demurrage DEM-D13](../../manual/cobertura/11-demurrage.md#divergências) | A Invoice de Demurrage sai sem o gate do Portal e sem CE Mercante, e o Cliente é notificado de uma fatura que não consegue abrir | Contato do Cliente sobre fatura invisível |
| [Desbloqueio de CE 13](../../manual/cobertura/08-desbloqueio-ce.md#divergências) | Depois que um B/L do pedido vai para a ZPT, ninguém consegue cancelar o pedido; a mensagem manda confirmar um tratamento externo que nenhuma tela registra | Pedido preso sem saída |
| [Desbloqueio de CE 1](../../manual/cobertura/08-desbloqueio-ce.md#divergências) | A confirmação da entrega do B/L original diz que "o prazo do cliente recomeça a partir de agora"; o prazo não funciona assim | Promessa errada ao Cliente |
| [Desbloqueio de CE 4](../../manual/cobertura/08-desbloqueio-ce.md#divergências) | A ficha e o Portal dizem que os documentos anuais VIP "cobrem todos os pedidos até 31/12"; a cobertura é por B/L e não retroage | Expectativa errada do Cliente VIP |
| [Recebimento 11](../../manual/cobertura/10-recebimento.md#divergências) e [12](../../manual/cobertura/10-recebimento.md#divergências) | A baixa pelo extrato não tira da análise o Pix de Taxas Locais; a devolução de Pix pago em duplicidade é recusada quando a fatura não recebeu nada | Financeiro trava em casos reais de pagamento |
| [B/L BLR-D06](../../manual/cobertura/03-bl-revisao.md#divergências) e [Portal POR-D12](../../manual/cobertura/07-portal.md#divergências) | A ficha do B/L oferece **Enviar convite do Portal** a todos os setores; os que não podem recebem um erro em inglês. Conta Ativa com e-mail devolvido aparece como "Não visível no Portal" | Convite falha na frente da equipe e o estado do Portal engana |
| [Clientes D02](../../manual/cobertura/06-clientes-comunicacao.md#divergências) e [D03](../../manual/cobertura/06-clientes-comunicacao.md#divergências) | A Cobertura de viagens não conta envio simulado nem parcial e conta B/L cancelado | Quadro de Comunicados mostra pendência que não existe |
| [Faturamento FAT-D15](../../manual/cobertura/09b-faturamento.md#divergências) | O alerta manda usar **Tentar aplicar correção**, que não existe na fatura sem pagamento | Operador procura um botão que não há |
| [Taxas Locais TAX-D01](../../manual/cobertura/09a-taxas-locais.md#divergências) e [TAX-D03](../../manual/cobertura/09a-taxas-locais.md#divergências) | Textos de tela dizem que a Condição de Cliente vale pela chegada do navio e que o dólar é convertido na emissão; o sistema fixa os dois na importação do B/L | Explicação errada de preço ao Cliente |
| [Alertas ALE-D05](../../manual/cobertura/12-alertas-rotinas.md#divergências) e [ALE-D18](../../manual/cobertura/12-alertas-rotinas.md#divergências) | Vários alertas técnicos não têm **Resolver** nem levam a uma tela; dispensar ou resolver mostra só "Falha ao…" sem o motivo | Fila de Alertas sem caminho de solução |
| [Acesso ACE-D15](../../manual/cobertura/01-acesso-admin.md#divergências) | A inatividade de 8 horas é contada por aba: uma aba esquecida derruba a pessoa enquanto ela trabalha em outra | Saídas inesperadas no dia a dia |

### 6.2 Todas as divergências das classes b e c, por área

#### Entrada, navegação, usuários e permissões

Arquivo: [`01-acesso-admin.md`](../../manual/cobertura/01-acesso-admin.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| ACE-D01 | b | Uma pessoa do Financeiro (ou de Operações) abre Clientes › Comunicação com o envio real ligado. O banco só deixa Administrativo, Documentação e Equipamentos lerem a configuração do sistema; para os demais a tela usa o padrão e mostra **Em simulação**, e o ponto da Régua de Cobrança da Demurrage é calculado com 7 dias mesmo que o intervalo seja outro | Abrir a leitura da configuração a todo usuário ativo (a gravação continua do Administrativo) ou, se a restrição for querida, a tela dizer "sem acesso" em vez de "Em simulação" |
| ACE-D02 | b | Documentação corrige o ATB de uma atracação na ficha da Viagem. O banco recusa: "Somente Operações/Admin podem editar terminais da escala."; o terminal do ADR antigo também é só de Operações e Administrativo | Decidir: incluir a linha na matriz e na ADR 0085, ou abrir a gravação a todos |
| ACE-D03 | b | Alguém de Operações lê "Recebe os alertas do próprio setor: 3 tipos" na matriz. O sino de Operações e de Equipamentos também recebe "ADR — departamento pendente" e "ADR — prazo vencido" da própria seção (a entrega soma o setor do item), e esses itens contam nos cartões do Painel | Mostrar na matriz que Ope e Equ recebem também as pendências do ADR da própria seção |
| ACE-D03b | b | Um usuário desativado digita e-mail e senha certos na tela de entrada. O login passa, o perfil não carrega, aparece por instantes **Acesso ainda não liberado** e o Vela volta à tela de entrada sem mensagem; a frase "Credenciais inválidas ou usuário sem permissão ativa." não aparece nesse caso | Mostrar na tela de entrada que o acesso está desativado (ou manter a tela "Acesso ainda não liberado" até a pessoa clicar em Sair) |
| ACE-D04 | b | Pela API, uma pessoa do Financeiro inclui um e-mail de contato num Cliente. `ensure_customer_contact_email` aceita qualquer usuário ativo (nenhuma tela a usa hoje) | Restringir a função aos três setores ou tirá-la do alcance da API |
| ACE-D06 | c | ADR 0085 diz que `/admin` é do Administrativo "inclusive leitura". Só a lista de usuários é recusada no banco; Histórico de ações, falhas de entrega e Prazo do ADR são de leitura de todos pela API | Decidir se a leitura dessas abas fica global (e corrigir a ADR com banner) ou se fecha no banco |
| ACE-D08 | b | Exportar a planilha do relatório de Demurrage. As colunas **Emissao** e **Vencimento** saem em AAAA-MM-DD; o Financeiro sai com a coluna "Invoice" | Formatar as datas em dd/mm/aaaa e usar os rótulos da tela nas quatro planilhas |
| ACE-D12 | b | O Administrativo reativa um usuário com motivo e depois filtra o Histórico de ações por Assunto **Usuário**. Saem duas linhas: **Usuário reativado** (assunto Usuário, sem motivo) e **Registro reativado** (assunto "Outro registro", com o registro como número curto), que é a que guarda o motivo; o filtro Usuário não mostra a linha do motivo | Levar a reativação de usuário para o assunto Usuário, com o nome, ou gravar o motivo na linha da troca de situação |
| ACE-D13 | b | Uma pessoa com o setor antigo "Operador" (que vale como Documentação) espera o resumo diário do Portal. A função de servidor do resumo filtra só os setores Administrativo e Documentação gravados; o Operador fica de fora, embora receba os alertas da Documentação | Incluir o legado no filtro do resumo, ou passar os usuários Operador para Documentação |
| ACE-D14 | c | Uma pessoa do Financeiro importa a base de Clientes com um e-mail novo para um Cliente já cadastrado. O e-mail entra como contato do Cliente (vira principal se o Cliente não tiver principal com e-mail) e um contato desativado com o mesmo e-mail é reativado | Decidir se a importação da base pode mexer em contatos de Cliente já cadastrado e registrar a exceção na matriz, ou restringir essa parte aos três setores |
| ACE-D15 | b | Uma pessoa trabalha no Vela numa aba e deixou outra aba do Vela aberta, sem uso, desde a manhã. Cada aba conta a própria inatividade; quando a aba esquecida completa 8 horas, ela encerra a sessão da pessoa inteira (a saída do Vela vale para todas as sessões), e a aba em uso volta à tela de entrada no meio do trabalho | Contar a atividade de todas as abas juntas, ou fazer a saída por inatividade valer só para aquela aba |
| ACE-D16 | c | Uma pessoa da Documentação abre o Histórico de um B/L em que o Financeiro mexeu. A coluna **Por** mostra "—" ("O registro não guarda o autor"), embora o autor esteja gravado; na ficha do Cliente aparece "Usuário interno". Só o Administrativo, que lê os perfis de todos, vê os nomes | Decidir se os nomes dos autores são leitura de todos; se forem, buscar o nome por uma função aberta (como o ADR de Saída já faz) e, enquanto não, não dizer "O registro não guarda o autor" quando ele está gravado |

#### Viagens e ADR de Saída

Arquivo: [`02-viagens-adr.md`](../../manual/cobertura/02-viagens-adr.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| 2 | b | Documentação abre a escala de Vitória e escolhe o terminal da frente de carga cheia; ou Equipamentos registra o ATB. O banco recusa ("Somente Operações/Admin podem editar terminais da escala.") e a janela mostra só "Falha ao salvar a escala."; os campos aparecem para todos. Remover uma Atracação (inclusive mover a única frente de um terminal para outro) é só do Administrativo. | Dono decide: abrir terminal, ATB, ATD e Restow a todos (como a matriz) ou registrar a restrição a Operações e Administrativo na matriz e esconder os campos na tela; e dizer se Operações pode trocar terminal de frente sem o Administrativo. |
| 3 | b | Operador omite a escala e lê, na confirmação, que só o Administrativo reverte; ao reverter, lê que "os registros de transbordo" serão removidos. Qualquer setor reverte a omissão (com justificativa), e a reversão só marca a omissão como revertida, mantendo o histórico. | Corrigir os dois textos da tela. |
| 4 | b | Viagem com todos os B/Ls pagos não mostra **Faturamento encerrado**; o título do selo diz "quitados ou isentos". O selo aparece só quando todos os B/Ls estão isentos de Taxas Locais; B/L pago não conta. | Dono decide: calcular "quitado ou isento" de verdade ou trocar o texto do selo. |
| 5 | b | Operador cadastra a Viagem do navio "ZYHY JIN QU" ou "M/V GREEN PECEM". O cadastro do navio grava o nome canônico ("ZHONG YUAN HAI YUN JIN QU", "GREEN PECEM"); ao editar uma Viagem, o navio achado pelo IMO recebe o nome digitado, o que muda o nome em todas as Viagens desse navio. | Dono decide se o nome cadastrado pode ser trocado pelo canônico e se a edição de uma Viagem pode renomear o navio de todas. |
| 6 | b | Duas pessoas salvam a mesma escala; ou o Administrativo tenta remover uma Atracação travada por CE. No conflito, o aviso no canto diz "Falha ao salvar a escala." e a janela diz "A escala foi atualizada por outra pessoa…". A trava da Atracação ("Atracação travada: …") chega à janela com a mesma mensagem de conflito, em vez do motivo. | Mostrar o motivo das recusas do banco na janela da escala e separar conflito de versão das demais recusas. |
| 7 | b | Equipamentos tenta assinar no instante em que outra pessoa fecha o ADR. A aba não mostra nenhuma mensagem: as recusas de resolução, observação, assinatura e reabertura só vão para o monitoramento técnico; só o fechamento tem aviso ("Falha ao fechar o ADR. Tente novamente."). | Mostrar a recusa na aba ADR. |
| 10 | b | Painel com mais de 60 Viagens: a faixa do Line Up mostra "40 de 75 escalas". Quando há mais Viagens que a janela carregada, o segundo número é o total de Viagens, não de escalas. | Corrigir o contador. |
| 13 | b | Operador salva a escala de Vitória ainda com a frente de carga cheia em TBC; depois atribui o terminal, registra ATB e ATD e salva de novo. A primeira gravação criou uma Atracação TBC sem datas, que nunca é apagada nem pode ser preenchida pela janela. Ela conta como Atracação sem ATD: a escala não fica concluída ("Aguardando o ATD de TBC.") e a Viagem não passa sozinha a Concluída (VIA-143). Leitura do código, não observado em tela. | Apagar a Atracação TBC vazia quando nenhuma frente fica em TBC (ou ignorar TBC sem datas no recálculo do status e no ATD da escala) e cobrir com teste. |
| 14 | b | Navio passou por Vitória (ATD registrado) e o armador omitiu Salvador, a última escala pendente. A omissão não recalcula o status: a Viagem continua Ativa, em Chegadas e Saídas e no Portal, até alguém salvar alguma escala dela. Excluir escala e reverter omissão também não recalculam (o recálculo só roda ao salvar escala e ao reativar). | Recalcular o status da Viagem em `omit_voyage_escala`, `revert_voyage_omission` e `delete_escala`. |
| 15 | b | Viagem com uma só escala brasileira (Vitória); o armador a omite. A janela "Omitir escala de BRVIX" oferece como Porto de Transbordo o próprio BRVIX, e o banco aceita a omissão com descarga no mesmo porto omitido. | Recusar Porto de Transbordo igual ao porto omitido (tela e banco) e orientar a cadastrar a escala de descarga antes. |

#### B/L e Revisão

Arquivo: [`03-bl-revisao.md`](../../manual/cobertura/03-bl-revisao.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| BLR-D01 | b | O Administrativo cancela pela ficha um B/L com Revisão **Pendente** e depois abre a **Revisão**. O B/L continua na fila e no número do item **Revisão** do menu: a fila e o número só olham a Revisão Pendente, e cancelar não muda a Revisão. As ações da fila sobre ele (vincular Cliente, informar peso, salvar) são recusadas, porque o B/L cancelado é somente leitura. | Decidir se o B/L cancelado sai da fila e do número do menu, como já sai dos Alertas, ou aparece marcado como Cancelado e sem ações; registrar no módulo. |
| BLR-D02 | b | Em **BLs** › **Mais filtros** › **Faturamento**, escolher **Cancelado**. O filtro procura uma situação financeira "cancelado" que nenhuma ação grava. A lista vem sempre vazia, mesmo com B/Ls cancelados, porque o cancelamento do B/L é outra marca (data, autor e motivo). | Trocar a opção por um filtro de B/L cancelado ou retirá-la. |
| BLR-D03 | b | B/L com fatura emitida: na ficha, **Mais ações** › **Cancelar B/L**. O aviso diz "O B/L <nº> não pode ser cancelado agora: ... O Financeiro cancela ou estorna antes.". Mas cancelar fatura é só do Administrativo; o Financeiro só registra baixa ou Restituição. | Corrigir o texto do aviso na ficha para dizer quem faz o quê. |
| BLR-D04 | b | Reimportar o Manifesto BB com um B/L que estava Pendente por peso ausente, agora com peso. A gravação refaz a Revisão (Pendente vira sem pendência, ou ganha pendência nova), preservando a nota escrita. A prévia, porém, diz "CE Mercante, Cliente vinculado, Revisão e observações ficam como estão.". | Corrigir o texto da prévia: a Revisão é refeita; a nota escrita fica. |
| BLR-D05 | b | Na Viagem, aba **Importação**, procurar o Manifesto BB na **Importação rápida**. A Importação rápida não oferece o Manifesto BB; ele só abre por **BLs** › **Importar** › **Manifesto de carga solta (BB)**. | Decidir se o BB volta à Importação rápida da Viagem ou corrigir o catálogo. |
| BLR-D06 | b | Uma pessoa do Operacional, do Equipamento ou do Financeiro abre a ficha de B/L cujo Cliente não tem Portal ativo e clica **Enviar convite do Portal** (ou marca o convite ao cadastrar o Cliente pela ficha). O botão aparece para todos os setores. O envio só aceita Documentação e Administrativo, e a tela mostra, em inglês, "Edge Function returned a non-2xx status code". A Revisão esconde a ação corretamente ("O convite do Portal é enviado pela Documentação ou pelo Administrativo."). | Esconder o botão e a caixa de convite fora desses setores, como na Revisão, e traduzir a recusa. |
| BLR-D07 | b | Salvar **Detalhes do B/L** num B/L cancelado (o formulário continua editável) ou num B/L cujo Cliente foi desativado. O sistema recusa, e a tela mostra só "Falha ao salvar alterações do B/L.", sem o motivo. Só a recusa de faturamento e o conflito de versão têm texto próprio. | Mostrar o motivo do sistema e desativar o formulário em B/L cancelado. |
| BLR-D12 | b | Reimportar o arquivo de B/L de contêiner (ou o Manifesto BB) de um B/L com Cliente e Taxas Locais calculadas, ainda sem fatura, cujo consignatário no arquivo passou a ser um CNPJ não cadastrado. Na prévia do arquivo de B/L, o cartão da troca mostra "Impedimento: Cliente do novo consignatário não está cadastrado; cadastre-o antes de reimportar para a fatura acompanhar." sempre que o B/L tem fatura viva ou qualquer valor a receber não anulado (todo B/L calculado com Cliente tem um), e a troca não é enviada. A gravação só recusa quando o B/L está faturado (fatura viva, situação faturado ou pago, ou valor a receber com baixa). No Manifesto BB a prévia não impede, mas o texto diz "Com fatura ou recebível a troca é recusada". | Alinhar a prévia do arquivo de B/L e o texto da prévia do BB à regra da migration `379`, ou registrar a decisão de manter a prévia mais restrita. |

#### CE Mercante e Baplie

Arquivo: [`04-ce-baplie.md`](../../manual/cobertura/04-ce-baplie.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| CEB-D01 | b | Na Viagem, **Rotas e Manifestos › Ver B/Ls**, a Documentação marca um B/L ainda sem CE e clica **Mover** para 1226501860578 (ou usa **Mover para um manifesto** na ficha de um B/L sem CE). O B/L é vinculado ao Manifesto: nem a tela nem o servidor conferem o CE em Mover. Ele fica no Manifesto sem CE. | Decisão do dono: recusar Mover de B/L sem CE (servidor e tela) ou registrar a exceção na regra 21. |
| CEB-D02 | b | Em **Baplie EDI › SOC/COC diverge**, o operador clica **Vale o B/L**. A janela diz "O valor do B/L passa a correção manual: o próximo Baplie não o troca.". No SOC/COC a origem continua a do B/L e só aquele par de valores fica resolvido: Baplie novo com outro valor volta a divergir e a reimportação do B/L ainda troca o SOC/COC. A frase só é verdadeira para IMO/OOG. | Texto próprio para SOC/COC na janela (tarefa de tela). O manual descreve o comportamento do código. |
| CEB-D03 | b | A planilha de CE troca o CE de um B/L cujo Comunicado de CE e Taxas já foi enviado; a conferência mostra "Comunicado será reenviado". Nada reenvia sozinho: abre o alerta **Reenviar Comunicado de CE e Taxas**, e o envio automático não repete um Comunicado de CE e Taxas já enviado na Viagem. Alguém precisa reenviar. | Trocar a nota da conferência por "reenvio do Comunicado fica pendente (alerta)". |
| CEB-D04 | b | Viagem com Baplie; um B/L cancelado tem um container que não está no Baplie (ou é o único B/L de um cheio do Baplie). Baplie EDI ignora o B/L cancelado e pode dizer **Baplie e B/Ls conferem**, mas o alerta **Cobertura Baplie / B/L** conta containers e rotas de todos os B/Ls da Viagem, cancelados inclusive, e fica aberto com "1 container diverge…". | Alinhar o alerta à regra da tela (excluir B/L cancelado e recalcular no cancelamento). |
| CEB-D05 | b | Planilha de CE com B/Ls de Cliente com Portal ativo. O servidor devolve, por B/L, se ele está visível no Portal, mas a tabela **Conferência com o que já está gravado** não mostra essa informação. | Mostrar a nota de Portal na conferência ou tirar da documentação. |
| CEB-D06 | b | Ficha do B/L › **Detalhes do B/L** › **Manifesto Mercante**: dica "Mudar o POD ou a Viagem do B/L desvincula o Manifesto.". Mudar o POL também desvincula (gatilho de mudança de rota). | Incluir o POL na dica (texto de tela). |
| CEB-D10 | b | Planilha de CE com um B/L de Cliente sem Portal e outro com a fatura cancelada por uma pessoa. **Resultado: emissão das faturas** só conta os **retidos**, sem listar quais; B/L pulado (fatura cancelada aguardando **Emitir**, sem CE, cancelado) entra só em **processados**, sem motivo em lugar nenhum. | Listar retidos (Conta do Portal não ativa) e pulados com o motivo. |
| CEB-D12 | b | A Documentação importa um Manifesto BB com a coluna CE preenchida; o aviso diz que o CE "entra pela planilha de CE Mercante ou pela ficha do B/L". Ela abre a ficha do B/L, que está sem CE. A ficha não grava o primeiro CE: sem CE, o campo só mostra o traço e a dica "O CE entra pela importação de CE Mercante, que também vincula o Manifesto."; **Corrigir CE** só existe para B/L com CE e o servidor recusa B/L sem CE. Os dois avisos estão em `src/services/breakbulkManifestParser.ts` e `src/services/breakbulkImport.ts`. | Tirar "ou pela ficha do B/L" dos dois avisos do Manifesto BB (texto de tela). |
| CEB-D13 | b | Viagem com Baplie em que um container declarado num B/L vem no Baplie como vazio. Baplie EDI lista o container em **Em B/L, fora do Baplie** ("O B/L declara um container que o Baplie não mostra a bordo"), embora ele esteja na lista **Containers do Baplie** como **Vazio**, **Fora da conciliação**; o alerta **Cobertura Baplie / B/L** também o conta. | Decisão do dono: tratar cheio/vazio como divergência própria, com texto certo, ou considerar presente o container que o Baplie traz vazio. |

#### Equipamentos

Arquivo: [`05-equipamentos.md`](../../manual/cobertura/05-equipamentos.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| EQU-D7 | b | A planilha de datas traz uma linha de B/L cancelado. A linha não é recusada: o B/L cancelado fica igual, a data vai aos B/Ls ativos que dividem o container, e a linha conta como "container atualizado". | Decidir se a prévia recusa a linha do B/L cancelado ou só deixa de contá-la como atualizada. |
| EQU-D11 | b | Com a Viagem cancelada, alguém marca vazios como **Cama** em Vazios IMP ou lança uma linha de serviço no Embarque de vazios dela. As duas gravações passam: só a natureza do vazio e a linha de serviço ficam sem a trava da Viagem Cancelada (containers, veículos, lotes de vazios, Embarque e unidades, e Granito são recusados). | Decidir se a trava da Viagem Cancelada vale também para a natureza do vazio de importação e para as linhas de serviço do Embarque, e aplicá-la no banco. |

#### Clientes e Comunicados

Arquivo: [`06-clientes-comunicacao.md`](../../manual/cobertura/06-clientes-comunicacao.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| D01 | b | **Novo cliente** com um contato adicional só com nome e telefone: a confirmação lista "Fulano (sem e-mail)" e diz "2 contatos". O banco grava só contatos com e-mail; o adicional sem e-mail some sem aviso. | Recusar na tela contato sem e-mail (ou gravá-lo desativado) e não listá-lo na confirmação. |
| D02 | b | Chave de envio desligada: a régua registra o NOA como simulado e o alerta "Comunicado NOA pendente" fecha. A **Cobertura de viagens** só conta Comunicado Enviado: mostra "0 de N" e, no detalhe, "Não devido" para o NOA já simulado; Parcial também não conta. | Decidir como a Cobertura mostra simulado e parcial (ex.: "Simulado em …") para bater com a régua e os alertas. |
| D03 | b | B/L cancelado pelo **Cancelar B/L** numa Viagem. A Cobertura lê o B/L cancelado (filtra só a situação financeira cancelada): o Cliente conta em Clientes, em "Sem CE ou fatura" e aparece "Bloqueado · sem B/L na viagem". | Tirar da Cobertura o B/L cancelado, como a conferência e a régua. |
| D04 | b | Rodapé da Cobertura. Diz "a próxima rodada automática (a cada 15 minutos…)"; a rodada é nos minutos ímpares (a cada 2 minutos) e também pelo evento. | Corrigir o texto do rodapé. |
| D05 | b | Escala com ETA daqui a 20 dias, Cobertura aberta. NOA e NOR mostram "0 de N" para todo Cliente com carga, antes da janela; o rodapé promete "—" quando "o marco da escala ainda não chegou". | Contar como devido só quando a janela abriu (ou corrigir o rodapé). |
| D07 | b | **Cadastrar cliente pela Revisão** com o e-mail digitado pela pessoa. O e-mail entra como contato "Contato manifesto", origem "Capturado do B/L", mesmo digitado na Revisão. | Gravar o e-mail digitado com origem "Cadastrado pela equipe". |
| D08 | b | CNPJ "00.000.000/0000-00". A tela recusa CNPJ de caractere repetido; o banco aceita "00000000000000" como válido. | Alinhar o banco à tela (recusar caractere repetido). |
| D09 | b | B/L faturado, mensagem ao desvincular. O banco diz "Use Trocar Cliente."; o botão da ficha do B/L chama **Trocar**. | Trocar o texto para "Use Trocar.". |
| D10 | c | Financeiro ou Operações importa a Base de Clientes (ou cadastra Cliente pela Revisão) com e-mails novos. A Base cria e reativa contatos e muda o principal, e a Revisão inclui contato, para qualquer setor ativo. | Dono decide se incluir e-mail pela Base e pela Revisão conta como "editar contatos". |
| D12 | b | Modo **Institucional**: dica "Cliente com contato e B/L com ETA nos últimos 12 meses" e vazio "é preciso ter contato com e-mail". O Cliente Comunicável depende só do ETA; Cliente sem contato aparece na conferência, bloqueado ("Sem contato elegível"). | Ajustar a dica e o vazio da tela à regra. |
| D13 | b | Pessoa do Financeiro ou de Operações abre **Comunicação com Clientes** com o envio real ligado. Esses setores não leem a chave (a leitura é só de Administrativo, Documentação e Equipamentos) e a tela usa o valor padrão: o bloco **Canal de envio** mostra "Em simulação" (CLI-103). | Liberar a leitura da chave a todo usuário interno ativo, ou a tela dizer que o estado não está disponível para o perfil. |
| D14 | b | Cliente com um único contato, o principal, que teve bounce (o reparo tira as caixas dele e, ao abrir a aba, o sistema o põe de volta nelas) ou foi marcado como spam; a Documentação tenta corrigir o telefone ou trocar o e-mail dele na ficha. A tela recusa **Salvar contatos** ("A caixa "Documentação e Operação" não pode ficar sem nenhum contato ativo e elegível vinculado."), e o e-mail trocado na tela não libera o contato; é preciso cadastrar outro contato nas caixas (CLI-106). O mesmo vale no Perfil do Portal. | Alinhar a tela ao banco: aceitar a gravação com aviso e deixar o alerta registrar a caixa; reavaliar o bloqueio quando o e-mail do contato muda. |
| D15 | b | Base de Clientes com o CNPJ de um Cliente desativado que tem B/Ls pendentes desse CNPJ. A prévia conta e lista esses B/Ls em "B/Ls vinculados"; na gravação o vínculo vira sugestão (B/L sem Cliente, nota "Cliente desativado: reative o cliente ou escolha outro."), mas o resultado soma "N B/Ls vinculados automaticamente" e o Histórico do B/L recebe "Vínculo por documento pela Base de Clientes". A Base também atualiza o cadastro e reativa contatos do Cliente desativado sem aviso. Leitura do código, não executado. | Avisar na prévia que o Cliente está desativado (ou recusar a linha) e não contar a sugestão como vínculo. |
| D18 | b | Cliente com o único contato ativo devolvido (bounce) e um contato antigo desativado com e-mail válido. O processamento do bounce abre "Cliente sem contato alternativo" (conta só contatos ativos); o detector de 15 minutos conta também o desativado e fecha o alerta, sem contato ativo para receber (CLI-089). Leitura do código, não executado. | O detector contar só contatos ativos, como o processamento do bounce. |

#### Portal

Arquivo: [`07-portal.md`](../../manual/cobertura/07-portal.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| POR-D01 | b | A Documentação clica **Enviar convite** para um e-mail na lista de bloqueio (ou de Cliente desativado, ou conta Suspensa); também ao suspender uma conta que mudou de situação. O painel mostra "Edge Function returned a non-2xx status code"; o motivo do servidor ("Endereço suprimido por bounce/complaint. Informe outro.", "Cliente desativado não recebe convite.", "Conta ativa usa recuperação de senha.", "A conta não está numa situação que permita esta ação.") não é lido. O mesmo vale na Revisão e na ficha do B/L. O servidor responde 422 e 409. | Ler o corpo da resposta como a troca assistida já faz (`assistedPortalEmailChange`); corrigir os códigos 431/421 para 422/409 no documento. |
| POR-D02 | b | Operações reverte uma omissão de escala; a Documentação confere o B/L do Cliente pela **Espiadinha**. No Modo Inspeção a aba BLs ainda mostra **Informações de Transbordo** da omissão revertida (e traria dados de navio no COD): o invólucro de inspeção usa o núcleo sem o filtro de omissão vigente que o invólucro do Cliente aplica. O Cliente não vê o bloco. | Aplicar o filtro de omissão vigente (e a regra do COD) no núcleo, para Cliente e inspeção lerem o mesmo. |
| POR-D03 | b | O Cliente usa **Refazer consolidada** e depois abre a consolidada desfeita pelo filtro **Cancelada**. A lista mostra "Cancelada", mas o detalhe mostra "Substituída por outra fatura", sem fatura nova, porque toda fatura desfeita usa o mesmo estado da substituída. | Distinguir no detalhe a consolidada desfeita pelo Cliente (motivo "Desfeita pelo cliente pelo portal.") da substituída. |
| POR-D04 | b | O Cliente abre o link de redefinição depois de 1 hora (ou já usado) e envia a nova senha. A tela mostra "Falha ao redefinir senha. Tente novamente em instantes." — o "Link inválido ou expirado. Solicite uma nova recuperação." do servidor não é lido; só a falta de código mostra "Link de recuperação inválido ou expirado.". | Tratar a resposta 410 como a confirmação de e-mail já faz e levar a **Pedir um novo link**. |
| POR-D05 | b | O Cliente pede a troca do E-mail de recuperação pela sexta vez no mesmo dia. O servidor recusa por limite diário (5 em 24 horas, "Limite de pedidos de troca de email atingido. Tente novamente amanhã."), mas a tela mostra a mensagem do limite de senha ("Muitas tentativas com a senha atual…"). | Distinguir as duas recusas na tela e registrar o limite diário no módulo. |
| POR-D06 | b | O Cliente clica, no sino, a notificação "Disputa registrada". Nada abre: o destino gravado é o endereço interno `/demurrage`, e o sino só navega para endereços do Portal. | Gravar o destino da disputa no Portal (`/portal/billing?tab=demurrage&disputas=1`). |
| POR-D07 | b | O Cliente erra a verificação de segurança no login, ou fica sem rede. Mostra "CNPJ ou senha inválidos…": a mensagem própria da verificação e a de rede nunca aparecem no login. | Manter o aviso "comportamento em revisão" no manual até a correção. |
| POR-D11 | b | A Documentação abre pela **Espiadinha** o detalhe de uma consolidada emitida e sem pagamento do Cliente. **Refazer consolidada** aparece e responde ao clique (não é apagado nem tem a dica); depois da confirmação "Desfazer fatura consolidada", a tela recusa por dentro e mostra "Falha ao desfazer a fatura.", sem mudar nada. As demais ações do Cliente ficam apagadas. | Apagar **Refazer consolidada** no Modo Inspeção com a mesma dica das outras ações. |
| POR-D12 | b | O Cliente tem conta Ativa, mas o E-mail de recuperação foi devolvido; a Documentação abre a ficha do B/L dele. O bloco **Portal** diz "Não visível no Portal" ("Conta do Portal não está ativa/provisionada"), embora o Cliente entre e veja o B/L, e oferece **Enviar convite do Portal**; o envio é recusado ("Conta ativa usa recuperação de senha.", mostrado como texto técnico). O mesmo botão aparece para conta Suspensa e para setores sem permissão de convite. | Separar "o Cliente vê o B/L" (conta Ativa e CE) de "Portal pronto para faturar"; mostrar o convite só nas situações que aceitam convite e aos setores que provisionam, e levar os demais casos ao Provisionamento. |
| POR-D13 | b | O e-mail de recuperação do Cliente foi devolvido e há faturas retidas pelo Portal; a Documentação troca o e-mail pelo atendimento (ou libera o endereço bloqueado). O Portal fica pronto e o alerta de Revisão do Portal fecha, mas as faturas retidas não são emitidas: só a ativação, a confirmação do e-mail pelo Cliente e a concessão da Liberação reprocessam. A Validação segue em **Conta do Portal não ativa** sem **Emitir**, e a Liberação não é oferecida porque o Portal está pronto. | Decidir se a troca assistida e a liberação do endereço também reprocessam as retidas (como a confirmação pelo Cliente); se não, a Validação deve deixar de mostrar "Conta do Portal não ativa" para Cliente com Portal pronto e oferecer **Emitir**. |

#### Desbloqueio de CE

Arquivo: [`08-desbloqueio-ce.md`](../../manual/cobertura/08-desbloqueio-ce.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| 1 | b | Andamento dos B/Ls → marcar a caixa B/L original (um B/L ou **Registrar entrega de N B/Ls**). A confirmação diz "o prazo do cliente recomeça a partir de agora", mas o prazo só nasce se os outros três requisitos já estão cumpridos e, com o B/L exportado, não se move | Trocar o texto da confirmação ("se for o último requisito, o prazo começa agora") |
| 2 | b | Ficha do Cliente VIP → aba Desbloqueio de CE e VIP → Solicitações de desbloqueio. Só lista solicitações comuns; as VIP não aparecem. A coluna B/Ls também mostra o B/L que passou para outra solicitação | Decidir se a ficha mostra as VIP; tirar da lista o B/L que mudou de solicitação |
| 3 | b | Limpeza diária: termo anual de 2026, vencido, com anual de 2027 aprovado, que cobriu um B/L já conciliado como "Desbloqueado". O anual fica até um ano depois do fim da vigência: o código só considera "conferido" a confirmação externa antiga, que nenhuma ação atual cria | Decidir se a conciliação "Desbloqueado" libera o anual; ajustar o código ou o documento |
| 4 | b | Ficha do Cliente → Condição VIP ("Termo de devolução e procuração anuais cobrem todos os pedidos deste CNPJ até 31/12 do ano aprovado."); Portal → Documentos anuais VIP ("cobrem todos os pedidos até 31/12 do ano aprovado"); diálogo Habilitar VIP ("precisam estar aprovados e vigentes"). A cobertura é por B/L, pelo vínculo do CE dentro da vigência; continua depois de 31/12 e não cobre o CE vinculado antes | Ajustar os três textos à regra do vínculo do CE |
| 5 | b | Modo Inspeção aberto por Financeiro, Operações ou Equipamentos → Desbloqueio de CE → solicitação ou Documentos anuais. A lista de documentos vem vazia para esses setores | Mandar os documentos para todos os setores também na Inspeção |
| 11 | b | Detalhe → Recusar documento com a chave de envio desligada. A confirmação diz "O cliente recebe o motivo no Portal e por e-mail"; com a chave desligada o e-mail só é simulado | Ajustar o texto ("no Portal e, com o envio ligado, por e-mail") |
| 13 | b | Vela → solicitação com um B/L já exportado (também depois de **Reconferir CE**) → **Cancelar pedido**. Recusa sempre com "Pedido com B/L já exportado para a ZPT: confirme o tratamento externo antes de cancelar"; não existe ação que registre esse tratamento, então a solicitação nunca mais se cancela | Decidir: trocar a mensagem por "não pode ser cancelado depois de exportado" ou dar uma ação para o tratamento externo |
| 17 | b | Andamento dos B/Ls sem nenhuma linha (com ou sem filtro). A explicação diz "B/Ls com CE aparecem aqui conforme os quatro requisitos são atendidos." | Trocar o texto ("Todo B/L com CE aparece aqui, com ou sem solicitação") |

#### Taxas Locais

Arquivo: [`09a-taxas-locais.md`](../../manual/cobertura/09a-taxas-locais.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| TAX-D01 | b | Operador cadastra Condição de Cliente e lê a ajuda do modal e o subtítulo da lista para saber quando ela vale. O cálculo escolhe a Condição pelo dia do primeiro cálculo do B/L (importação, horário de Brasília); a ETA não entra. Mas a ajuda do modal diz "data de referência (ETA da escala do POD; sem ela, ETA da viagem ou a data do cálculo)" e o bloco da lista diz "o valor negociado vale quando a chegada do navio no POD cai na vigência". | Corrigir os dois textos da tela para "dia em que o B/L entrou no Vela". |
| TAX-D02 | b | Administrativo edita a vigência de uma Condição para cobrir B/Ls importados antes. Só os B/Ls cujo preço fixado já usava essa Condição são reprecificados; os outros não a recebem. O modal diz "recalcula os B/Ls deste Cliente na vigência". | Corrigir o texto da consequência no modal de edição da Condição. |
| TAX-D03 | b | Operador cadastra item em dólar ou recalcula B/L pela Validação ou pela Revisão. O câmbio é o fixado no primeiro cálculo e o recálculo usa o preço fixado. A tela diz "Convertido em reais pelo ROE na emissão da fatura" (item), "(convertido pelo ROE na emissão)" (Emitir fatura) e "definido pela tabela e pelas regras atuais do B/L" / "com a tabela e as regras vigentes" (recálculo). | Ajustar os quatro textos para "câmbio e preço fixados quando o B/L entrou". |
| TAX-D04 | b | Operador cadastra tabela e escolhe Modo de carga **Granito**. O formulário oferece Granito e grava; nenhum B/L usa a tabela. | Tirar Granito do formulário (o filtro já não oferece). |
| TAX-D07 | b | Operador escolhe **Categoria na fatura** (Taxa base ou Outra cobrança) no item. Nada lê a categoria além da regra de item repetido: a fatura não muda. | Decidir se a categoria some do formulário ou passa a agrupar a fatura. |
| TAX-D08 | b | Administrativo exclui uma taxa manual; depois alguém procura no Histórico do B/L quem excluiu. Ou o operador aceita refixar o preço e abre o Histórico. O Histórico só mostra eventos de linha de taxa que ainda existe: a exclusão (e a linha excluída) some. O refixar aparece como "Dado do B/L" com o conteúdo técnico antes → depois. | Ligar os eventos de taxa ao B/L, não à linha, e dar texto ao refixar. |
| TAX-D09 | b | Operador abre a aba Faturamento de B/L cancelado. A ficha ainda oferece **Calcular taxas** e **Adicionar cobrança manual**; o sistema recusa e a tela mostra só a falha genérica. | Esconder as ações no B/L cancelado. |
| TAX-D11 | b | Operador abre a ficha do Cliente, aba Financeiro; ou desativa uma condição que já não existe. O bloco **Tarifas do cliente** usa "Regras gerais (overrides)" e "Nenhum override cadastrado.", lista também condições desativadas e encerradas sem dizer a situação. A aba Condições de Cliente responde "O override não foi alterado: sem permissão ou override inexistente.". | Trocar o rótulo e mostrar a situação. |
| TAX-D13 | c | Operador de qualquer setor edita o POD ou o modo de uma tabela já usada. A edição é livre e não recalcula; os B/Ls vinculados deixam de usá-la no próximo cálculo, sem correção de fatura. | Decidir se mudar modo ou POD de tabela usada vira correção do Administrativo ou se fica travado. |
| TAX-D14 | b | B/L misto cuja tabela de container não tem taxa por B/L. Só a primeira taxa por B/L da tabela de carga solta (na Ordem de exibição) é cobrada; as demais taxas por B/L dessa tabela saem sem aviso, porque a marca "já cobrou taxa por B/L" também é ligada pela própria taxa de carga solta. Quando a de container tem alguma, todas as de carga solta saem. O comentário do código diz que "a taxa da tabela de carga solta é preservada para evitar perda de receita". | Decidir se a carga solta cobra taxa por B/L quando a de container não tem nenhuma e, se cobrar, se são todas ou só uma; alinhar código, módulo e ajuda do campo. |
| TAX-D15 | b | Operador recalcula na Revisão um B/L que já foi faturado. A tela diz "Fatura já emitida para … — cancele e reemita para corrigir." | Trocar o texto pela orientação de corrigir o B/L. |
| TAX-D16 | b | Operador abre a ficha de um B/L de carga solta sem peso, ou de B/L cuja tabela tem THD com perfil Todos ou item por TEU, para saber por que a linha está em revisão. O cálculo produz o motivo certo ("Peso de carga solta ausente…", "Item THD cadastrado com perfil de carga 'any'…", "Base de aplicacao nao suportada…"), mas a linha é gravada sem valor unitário e a guarda de preço ausente troca o motivo por "Tarifa BRL sem valor unitário vigente." (ou USD). Ficha, Validação e Conferência mostram só esse texto. Leitura do código; não executado. | Fazer a guarda ignorar as linhas de revisão que já têm motivo, e conferir com teste local. |
| TAX-D17 | b | Operador digita **Peso carga solta (t)** num B/L de container (vira misto) na ficha, ou a carga solta ou o container sai de um B/L misto. A troca de modalidade põe as taxas em **Não calculado**, e o recálculo do fim da gravação pula B/L **Não calculado**: as linhas antigas ficam, com **Calcular taxas**, até alguém calcular, a Validação ou a Revisão recalcular, ou o CE ser gravado. Leitura do código; não executado. | Recalcular também quando a modalidade muda, ou dizer na ficha que a troca de modalidade pede **Calcular taxas**. |
| TAX-D18 | b | Administrativo tenta excluir ou desativar uma Condição de Cliente que o sistema recusa. A aba **Condições de Cliente** mostra o texto bruto do erro, com o código na frente (e detalhe ou dica, quando o banco manda): "P0001 Esta tarifa já foi usada…". A aba **Tabelas** usa a leitura padrão, sem código. | Usar na aba Condições a mesma leitura de erro da aba Tabelas. |

#### Faturamento

Arquivo: [`09b-faturamento.md`](../../manual/cobertura/09b-faturamento.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| FAT-D09 | b | Um B/L ainda não faturado é cancelado na ficha; o operador abre a **Validação**. O B/L cancelado continua na fila (como "Cálculo sem linhas", com **Recalcular**), porque a consulta da Validação não filtra cancelados. | Tirar os B/Ls cancelados da Validação (ou mostrá-los só com "Incluir faturados e isentos", com motivo próprio). |
| FAT-D10 | b | O Administrativo cancela a fatura de um B/L; depois a Documentação vincula de novo o Cliente pela ficha (ou resolve o B/L na Revisão). A tela tenta faturar sozinha depois do vínculo e chama a mesma emissão do **Emitir**, que não confere se a última fatura foi cancelada por uma pessoa: a fatura pode sair de novo sem ninguém clicar **Emitir**. Os caminhos do servidor (CE, Liberação, Portal, fila) respeitam a regra. | Aplicar no faturamento automático da tela a mesma checagem do servidor (pular B/L cuja última fatura foi cancelada por pessoa). |
| FAT-D11 | b | O operador procura uma fatura em **Buscar fatura ou B/L**. O campo sugere "Ex.: FAT-2026-0018". | Trocar o exemplo para `INV-2026-0018`. |
| FAT-D12 | b | Na consolidada, um B/L com saldo mas sem CE Mercante. A lista mostra o B/L como "Sim" (pode consolidar); a emissão é recusada pela falta de CE. A tela vazia diz "Este Cliente não tem B/L com saldo aberto e CE Mercante…". | Marcar como não elegível ("sem CE Mercante") o B/L sem CE na lista da consolidada. |
| FAT-D13 | b | Confirmações de **Emitir** na Validação e de **Emitir consolidada**. Dizem "pagamentos seguem o fluxo próprio de estorno". | Trocar o texto das duas confirmações. |
| FAT-D15 | b | Fatura sem pagamento; o B/L é corrigido e a reemissão ficaria bloqueada (terminal em conflito, valor a revisar, Portal fechado). O operador abre a fatura pelo alerta **Fatura desatualizada**. O alerta manda "use Tentar aplicar correção", mas o botão só existe no bloco **Ajustes pela correção do B/L**, que o detalhe mostra só em individual ou consolidada paga ou parcialmente paga; na fatura sem pagamento só há **Resolver com justificativa**, e o bloco diz "a correção do B/L reemite esta fatura sozinha", o que não aconteceu. A lista de correções pendentes do detalhe também ignora B/L que está só em consolidada. Sem o botão, a correção só volta a rodar quando o B/L muda de novo (`InvoiceDetailModal.tsx`, `StaleInvoiceResolutionPanel.tsx`, `get_invoice_correction_summary_legacy_134`). | Mostrar a correção pendente e **Tentar aplicar correção** também no detalhe da fatura sem pagamento (e para B/L de consolidada) e ajustar o texto de "Aguardando reemissão". |
| FAT-D16 | b | Na **Validação**, a **Conferência do cálculo** de um B/L com cobrança manual. O grupo **Lançamentos manuais** diz "Fora de tabela: valor digitado na operação.", mas a cobrança manual é sempre um item manual da tabela do B/L, com valor do preço fixado, da Condição do Cliente ou da tabela; a pessoa só informa a quantidade (`conferenciaCalculo.ts`, `add_manual_bl_charge`). | Trocar o texto do grupo para algo como "Itens manuais da tabela: quantidade informada na operação". |

#### Recebimento

Arquivo: [`10-recebimento.md`](../../manual/cobertura/10-recebimento.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| 1 | c | Financeiro quer dar baixa manual num Pix em análise e copia o **Identificador do Pix** da lista **Pix em análise** para a **Referência bancária**. Em Pendências (Pix em análise, Exceções do extrato, Cobranças aguardando o Itaú) e em Conciliar extrato, **Identificador do Pix** é o identificador da **cobrança** (`VELA…`, a coluna Identificador do extrato); na aba Pix recebidos, **Identificador do Pix** é o identificador do próprio Pix e o `VELA…` se chama **Identificador da cobrança**. Só a baixa com o identificador do próprio Pix (o da aba Pix recebidos) tira o Pix da análise (REC-028, REC-029). | Na lista Pix em análise, mostrar o identificador do Pix (com copiar) e o da cobrança com o nome **Identificador da cobrança**. |
| 3 | b | Um Pix falha três vezes ao ser gravado pela consulta do Itaú. Abre o Alerta **PIX sem conciliação segura** mandando dar baixa manual, mas o Pix não aparece em **Pix em análise** nem em **Pix recebidos** (REC-022); se for Pix de fora do Vela, também abre Alerta. | Listar essas falhas em Pendências (ou gravá-las como Pix recebido em análise) para o Financeiro ter onde tratar. |
| 7 | b | Baixa manual com valor acima do saldo gera restituição pendente. Abre o Alerta **Restituição pendente** para qualquer restituição a devolver de fatura (excedente, Pix em duplicidade, restituição excepcional, troca de CNPJ, cancelamento financeiro) e de Invoice de Demurrage (REC-081). | Atualizar o texto da regra do alerta na tela (catálogo das Regras dos alertas). Reclassificada de a para b na correção da documentação (2026-10-26): o texto defasado está no código (`src/services/alertRulesCatalog.ts`), não num documento. |
| 11 | b | Pix de cobrança do Vela de uma fatura de Taxas Locais fica em análise (por exemplo, sem a conta de integração configurada) e o Financeiro concilia o extrato do Itaú, que traz o mesmo identificador da cobrança. O extrato quita a fatura e só depois grava nela o identificador conciliado; a conferência que tira o Pix da análise roda no momento em que a fatura passa a **Paga**, ainda sem o identificador, e não roda de novo quando ele é gravado. O Pix segue em **Pix em análise** com o Alerta aberto, embora a aba Pix recebidos já o mostre com baixa; é preciso **Marcar como tratado** (REC-028). Na Invoice de Demurrage o extrato grava tudo junto e o Pix sai da análise. Leitura do código, não executado. | Gravar o identificador na mesma mudança que quita a fatura, ou disparar o fechamento também na gravação do identificador; teste local-pg do caso pelo extrato. |
| 12 | b | Pix em duplicidade de uma fatura **Cancelada** sem baixa, de uma individual **Coberta** ou de consolidada substituída: o Financeiro devolve o dinheiro e tenta **Confirmar devolução realizada**. A confirmação exige que a soma das restituições não canceladas da fatura não passe do que ela recebeu; essas faturas não receberam nada, então a confirmação é recusada ("Restituição sem lastro no valor recebido."), o Pix fica em análise e o Alerta não fecha (REC-020, REC-083). Na avulsa em cancelamento com devolução integral, a restituição do Pix em duplicidade somada à do cancelamento também passa do recebido e trava as duas. Leitura do código, não executado; o teste existente só cobre fatura Paga. | Excluir a restituição do Pix em duplicidade da conta do lastro (ela tem lastro no próprio Pix) e cobrir os quatro casos em teste local-pg. |

#### Demurrage

Arquivo: [`11-demurrage.md`](../../manual/cobertura/11-demurrage.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| DEM-D01 | b | O Cliente anexa um PDF na Disputa pelo Portal; Equipamentos abre **Demurrage → Disputas** para analisar. A conversa interna não traz anexos (nem o nome do arquivo); no Portal aparece só o nome, sem abrir. Nenhuma tela baixa o arquivo guardado. | Listar os anexos com link de download na aba Disputas (e no Portal); até lá, o manual não promete leitura do anexo. |
| DEM-D05 | b | Às 22h de um dia útil, com a PTAX do dia já aplicada, o Financeiro abre **Demurrage**. O aviso "PTAX de hoje não obtida do BCB" aparece (o "último dia útil" é calculado pela data UTC, que já virou); e um desconto ou baixa feitos hoje escondem o aviso mesmo sem a PTAX do dia, porque vale a última foto de qualquer tipo. | Usar a data de Brasília e só fotos de recálculo; tratar como defeito. |
| DEM-D06 | b | Invoice de US$ 1.000 com desconto de 10%. O Vela mostra "USD a cobrar" US$ 900 e o e-mail da Régua US$ 900; o Portal mostra "Total US$" e "Total em dólar" US$ 1.000 ao lado do R$ já com desconto. | Mostrar o USD líquido (ou os dois) no Portal; decisão do dono sobre o rótulo. |
| DEM-D08 | b | Uma Invoice é cancelada e reemitida porque as datas mudaram. A Invoice nova não guarda referência à cancelada; só o Histórico da cancelada diz "cancelada para reemissão automática". | Decidir se a Invoice reemitida deve citar a anterior. |
| DEM-D09 | b | Uma Invoice antiga ficou no estado "vencida". O detalhe a trata como emitida, mas nenhuma aba a lista (Faturas lista só emitidas), o cartão "Aguardando pagamento" e **Por Cliente** não a somam, e o filtro do Portal "Emitida" não a inclui. | Baixo impacto (nenhuma ação produz mais esse estado); incluir "vencida" nas listas ou migrar os registros. |
| DEM-D13 | c | Invoice de Demurrage emitida para B/L ainda sem CE Mercante, de Cliente sem Conta do Portal ativa. A emissão não passa pelo Gate de faturamento do Portal nem exige CE: a Invoice nasce emitida, fica fora do Portal e da Régua até o CE, mas o Cliente já recebe a notificação "Nova fatura de demurrage" de uma fatura que não consegue abrir. | Decisão do dono: se o gate e o CE valem para a Invoice de Demurrage; no mínimo, segurar a notificação até a Invoice aparecer no Portal. |

#### Alertas e rotinas

Arquivo: [`12-alertas-rotinas.md`](../../manual/cobertura/12-alertas-rotinas.md#divergências).

| Nº | Classe | Caso e o que o sistema faz | Recomendação |
|---|---|---|---|
| ALE-D03 | b | Em **Regras de alertas**, "PIX sem conciliação segura" diz **Responsável: Administrativo · Financeiro**; o Financeiro filtra **Alertas** por setor e não acha. Idem "Fatura desatualizada" e "Restituição pendente"; "Caixa de comunicação sem destinatário", "Cliente sem contato alternativo", "Cliente sem contato principal" e "Portal do Cliente — exceção de fatura" dizem **Documentação · Administrativo**. O item é gravado só com o setor do catálogo (Administrativo nos três primeiros, Documentação nos outros quatro); o segundo setor só recebe a notificação. Não existe setor responsável Financeiro. | Corrigir `responsibleDepartments` na tela de Regras para o setor do item. Reclassificada de a para b na correção da documentação (2026-10-26): o texto defasado está no código (`src/services/alertRulesCatalog.ts`), não num documento. |
| ALE-D04 | b | Em **Regras de alertas**, as três regras da Revisão de B/L dizem **Registro: B/L**. Abrem um alerta por Cliente (ou consignatário sem Cliente), com contagem de B/Ls. | Corrigir o registro dessas regras para Cliente. Reclassificada de a para b na correção da documentação (2026-10-26): o texto defasado está no código (`src/services/alertRulesCatalog.ts`), não num documento. |
| ALE-D05 | b | Alerta "Usuário interno com e-mail devolvido" na fila: não há **Resolver**, a coluna **Registro** mostra um código e a notificação abre **Alertas**; a tela de Regras promete **Abrir Usuários**. O mesmo vale para Tabela de cobrança faltando (promete **Abrir tabelas de Taxas Locais**), Consulta de Pix do Itaú parada (**Abrir Conciliação**), Falha na atualização da PTAX Demurrage e Calendário de feriados (**Abrir Demurrage**), e o Recebimento Itaú com falha. O endereço gravado pela rotina é apagado (`clear_alert_item_destination`) e `alertEntityLink` não tem tela para esses registros; o rótulo do registro também não é traduzido. | Mapear em `alertEntityLink` e `alertRecord` esses registros para as telas que a Regras já cita. |
| ALE-D06 | b | Alerta de B/L reaberto hoje aparece na fila com **Aberto em** de meses atrás. **Aberto em** é a data de criação do alerta do registro, reaproveitado a cada reabertura; a data da ocorrência atual não aparece. | Mostrar a data da ocorrência corrente (abertura ou reabertura do item). |
| ALE-D07 | b | Operador dispensa com motivo "ok". A tela e a função aceitam; o banco recusa (mínimo de 3 caracteres) e a fila mostra só "Falha ao dispensar alerta.", sem dizer que o motivo é curto. | Validar 3 caracteres na tela e na função, com mensagem clara. |
| ALE-D08 | b | Depois de "Resolver com justificativa", o colega quer ver por que o alerta foi fechado. Autor e justificativa são gravados no histórico do alerta, mas nenhuma tela o mostra (nem **Histórico de ações**). | Decidir onde o histórico do alerta é consultado (alertas resolvidos ou Histórico de ações). |
| ALE-D10 | b | **Regras de alertas**, "Comunicado sem destinatário": "Aparece na rodada automática (a cada 15 minutos)". A rodada dos Comunicados roda a cada 2 minutos e logo depois de eventos (migration `458`). | Atualizar o texto. Reclassificada de a para b na correção da documentação (2026-10-26): o texto defasado está no código (`src/services/alertRulesCatalog.ts`), não num documento. |
| ALE-D11 | b | **Regras de alertas**, "Falha na atualização da PTAX Demurrage" fala só da falha da rotina. Também abre às 14h de dia útil, com o Itaú ligado, quando a PTAX do dia não chegou às cobranças Pix da Demurrage (registro próprio, fecha pela rodada do Itaú). | Acrescentar o segundo caso ao texto. Reclassificada de a para b na correção da documentação (2026-10-26): o texto defasado está no código (`src/services/alertRulesCatalog.ts`), não num documento. |
| ALE-D12 | b | "Caixa de comunicação sem destinatário" e "Cliente sem contato principal": **Resolver** abre a lista de Clientes, não a ficha. Esses dois alertas não guardam o CNPJ do Cliente, e o link só abre a ficha com o CNPJ. | Gravar o CNPJ nesses dois produtores. |
| ALE-D13 | b | **Admin › Usuários**, "O que cada setor pode", linha "Recebe os alertas do próprio setor": Operações 3 tipos, Equipamentos 2. Operações e Equipamentos recebem também os dois tipos do ADR (pelo item do próprio departamento): 5 e 4 tipos. | Contar audiência mais setor do item na matriz. Reclassificada de a para b na correção da documentação (2026-10-26): o texto defasado está no código (contagem da matriz em `src/services/permissionMatrix.ts` e no teste). |
| ALE-D16 | b | **Regras de alertas**, "Restituição pendente": fala só de fatura de Taxas Locais. Também abre para Invoice de Demurrage com restituição pendente (registro **Invoice Demurrage**, **Ver Demurrage**). | Acrescentar a Invoice de Demurrage ao texto. Reclassificada de a para b na correção da documentação (2026-10-26): o texto defasado está no código (`src/services/alertRulesCatalog.ts`), não num documento. |
| ALE-D17 | b | Operador deixa o Vela aberto o dia todo e confia no número do item **Alertas** do menu. O número é lido quando o Vela abre e só é relido depois de ações do próprio usuário que invalidam a contagem; não há releitura por tempo (a consulta tem `staleTime` de 60 s, sem `refetchInterval`, e o app não relê ao voltar à janela). Alertas abertos pela rodada ou por colegas não aparecem no número até recarregar. | Dar à contagem do menu um `refetchInterval` (como o sino e o Painel) ou corrigir o documento. |
| ALE-D18 | b | Duas pessoas dispensam o mesmo alerta ao mesmo tempo; a segunda vê só "Falha ao dispensar alerta.". Em **Alertas**, a dispensa e a resolução com justificativa só mostram o texto da recusa quando o erro é da própria tela; a recusa do banco chega como objeto, não como `Error`, e a tela troca o motivo ("Item de alerta não está ativo.", restrição do motivo, "Sem permissão.") pela mensagem genérica. O **Reprocessar** da mesma tela usa `userFacingErrorMessage` e mostra o motivo. | Passar o erro da dispensa e da resolução por `userFacingErrorMessage`/`toError`. |

### 6.3 Outras perguntas que o código não responde

- **ZPT:** o glossário precisa de uma definição dada pelo dono; o código só
  mostra a exportação e a aba "Planilha desbloqueio".
- **Feriados:** o prazo do Desbloqueio de CE não conta feriados (simplificação
  marcada no código), e o Vela não tem tela de cadastro de feriados; o alerta
  "Calendário de feriados pendente" manda pedir à equipe técnica.
- **Mensagens com termo técnico ou sem acento:** várias mensagens que chegam ao
  operador citam nomes internos (`business_holidays`, `cron.job_run_details`,
  "Edge Function") ou vêm sem acento ("Usuario sem permissao…"). O manual vai
  explicá-las como estão; reescrevê-las é decisão do dono.
- **Exportação de Containers:** a planilha não traz Descarga nem Devolução, e
  Revisão e Situação financeira saem em códigos internos.
- **Supressão por reclamação:** nenhuma tela libera o contato de Cliente
  marcado como spam; hoje o caminho é trocar o e-mail.
- **Faixas de plausibilidade da planilha de veículos** (300 a 60.000 kg, 1 a
  300 m³) não foram calibradas com dados reais.
- **Modelos de planilha sem tela** (`manifesto-bb-modelo`, `imo-oog-modelo`,
  `vazios-modelo`) e painéis montados no código que nenhuma tela usa: ficam ou
  saem.
- **Linha do Tempo da importação:** pela leitura do código, a rota guardada no
  evento de importação nunca é preenchida (BLR-069); não testado.

## 7. Fora do manual (para aprovação)

Só pode ficar fora o que não tem efeito na operação nem na tela. Cada linha
abaixo diz o motivo. As mensagens com destino `Fora` são as que nunca chegam a
uma pessoa (rotina interna, recusa que outra conferência anterior torna
inalcançável); cada uma tem o motivo no arquivo da área.

| Área | Itens sem efeito (linhas) | Mensagens com destino Fora |
|---|---|---|
| [Entrada, navegação, usuários e permissões](../../manual/cobertura/01-acesso-admin.md#itens-sem-efeito-na-operação) | 1 | 5 |
| [Viagens e ADR de Saída](../../manual/cobertura/02-viagens-adr.md#itens-sem-efeito-na-operação) | 15 | 42 |
| [B/L e Revisão](../../manual/cobertura/03-bl-revisao.md#itens-sem-efeito-na-operação) | 8 | 49 |
| [CE Mercante e Baplie](../../manual/cobertura/04-ce-baplie.md#itens-sem-efeito-na-operação) | 5 | 27 |
| [Equipamentos](../../manual/cobertura/05-equipamentos.md#itens-sem-efeito-na-operação) | 7 | 21 |
| [Clientes e Comunicados](../../manual/cobertura/06-clientes-comunicacao.md#itens-sem-efeito-na-operação) | 6 | 39 |
| [Portal](../../manual/cobertura/07-portal.md#itens-sem-efeito-na-operação) | 12 | 22 |
| [Desbloqueio de CE](../../manual/cobertura/08-desbloqueio-ce.md#itens-sem-efeito-na-operação) | 1 | 2 |
| [Taxas Locais](../../manual/cobertura/09a-taxas-locais.md#itens-sem-efeito-na-operação) | 1 | 7 |
| [Faturamento](../../manual/cobertura/09b-faturamento.md#itens-sem-efeito-na-operação) | 15 | 30 |
| [Recebimento](../../manual/cobertura/10-recebimento.md#itens-sem-efeito-na-operação) | 7 | 45 |
| [Demurrage](../../manual/cobertura/11-demurrage.md#itens-sem-efeito-na-operação) | 17 | 43 |
| [Alertas e rotinas](../../manual/cobertura/12-alertas-rotinas.md#itens-sem-efeito-na-operação) | 9 | 19 |
| **Total** | **104** | **351** |

#### Entrada, navegação, usuários e permissões

| Item | Motivo |
|---|---|
| `funcao:current_user_role` | Devolve o setor do próprio usuário, mas nenhuma tela, função ou regra de acesso a usa; as regras usam `current_actor_role` e os demais conferidores. Não muda nada que o operador veja. |

#### Viagens e ADR de Saída

| Item | Motivo |
|---|---|
| `funcao:agency_report_deadline_date` | Cálculo antigo do prazo do ADR (três dias úteis), sem nenhum chamador: o prazo vigente é ATD + 72 horas, calculado na tela e nos alertas. |
| `funcao:reorder_vessel_schedules` | Reordenava a programação antiga de navios; nenhuma tela a chama e a programação atual ordena sozinha pela menor ETA. |
| `politica:vessel_schedules.vessel_schedules_insert_active_global` | Permissão sobre a programação antiga de navios, que nenhuma tela grava desde que Chegadas e Saídas passou a usar a própria Viagem. |
| `politica:vessel_schedules.vessel_schedules_update_active_global` | Idem: programação antiga, sem tela. |
| `politica:ended_vessels.ended_vessels_insert_active_global` | Registro antigo de "navio encerrado"; "Encerrar navio" não existe mais e nenhuma tela grava nele. |
| `gatilho:update_updated_at_column` | Carimbo de data de atualização da programação antiga de navios, sem tela. |
| `gatilho:trg_voyage_schedule_snapshot` | Mantém uma cópia interna da agenda dentro da Viagem que nenhuma tela, alerta ou Comunicado lê (as telas leem o Histórico). |
| `restricao:agency_departure_report_occurrences.agency_departure_report_occurrences_body_check` | Texto obrigatório das antigas Ocorrências do ADR; nenhuma tela registra Ocorrência desde que a Observação por seção a substituiu. |
| `restricao:voyage_escala_operation_fronts.voyage_escala_operation_fronts_check1` | Coerência interna entre sentido e origem da frente, que a tela preenche sozinha. |
| `restricao:voyage_escala_operation_fronts.voyage_escala_operation_fronts_source_check` | Origem da frente (dados da importação ou declaração de exportação), preenchida pelo sistema. |
| `restricao:voyage_escala_operation_fronts.voyage_escala_operation_fronts_port_check` | Porto gravado em maiúsculas e sem espaços, normalizado pelo sistema. |
| `restricao:voyage_escala_operation_fronts.voyage_escala_operation_fronts_revision_check` | Contador interno de versões da escala, nunca negativo. |
| `restricao:voyage_escala_revision_state.voyage_escala_revision_state_port_check` | Porto gravado em maiúsculas e sem espaços, normalizado pelo sistema. |
| `restricao:voyage_escala_terminal_state.voyage_escala_terminal_state_port_check` | Porto gravado em maiúsculas e sem espaços, normalizado pelo sistema. |
| `restricao:voyage_escala_terminal_state.voyage_escala_terminal_state_revision_check` | Contador interno de versões da Atracação, nunca negativo. |

#### B/L e Revisão

| Item | Motivo |
|---|---|
| `funcao:list_import_effects` | Consulta do andamento dos passos pós-importação. Só o painel de resultado de importação a usa, e nenhuma tela monta esse painel (ver BLR-D10). O operador acompanha o passo bloqueado pelo Alerta (BLR-140). |
| `gatilho:app_settings_block_removal` | Guarda técnica que impede apagar a configuração única do sistema; nenhuma tela apaga essa configuração. |
| `gatilho:prevent_import_effect_attempt_mutation` | Mantém sem alteração o registro de cada tentativa dos passos pós-importação; esse registro não aparece em nenhuma tela. |
| `gatilho:validate_bl_breakbulk_item_parent` | Confere que o item de carga solta pertence a um B/L com modalidade válida. As importações sempre gravam o B/L antes do item e a modalidade só tem três valores, então a recusa não chega ao operador. |
| `restricao:import_batches.import_batches_status_check` | Situação interna do registro de importação (em processamento, concluída, parcial, com falha); nenhuma tela a mostra. O que o operador vê do registro está em BLR-069. |
| `restricao:import_effect_attempts.import_effect_attempts_error_code_chk`, `restricao:import_effect_attempts.import_effect_attempts_error_message_chk`, `restricao:import_effect_attempts.import_effect_attempts_worker_chk` | Limites de tamanho do registro técnico de cada tentativa; não aparecem em tela. |
| `restricao:import_pending_effects.import_pending_effects_source_snapshot_chk` | Formato interno da fotografia guardada com cada passo pós-importação. |
| Mensagens com destino `Fora` (seção Mensagens) | Guardas de rotinas internas, de etapas que a tela nunca aciona do jeito recusado, ou textos que a tela troca por outro. O motivo de cada uma está na própria linha. |

#### CE Mercante e Baplie

| Item | Motivo |
|---|---|
| `funcao:find_manifesto_mercante` | Consulta auxiliar do banco (procura um Manifesto pelo número já normalizado) que nenhuma tela usa; o operador encontra o Manifesto na aba Rotas e Manifestos. |
| `gatilho:trg_manifestos_mercante_updated_at` | Carimbo técnico da data de atualização do cadastro de Manifesto; não aparece em tela nem no Histórico. |
| `politica:baplie_containers.baplie_containers_insert_active_global`, `politica:baplie_containers.baplie_containers_update_active_global` | Os usuários não têm permissão de gravar direto no Baplie (só de ler); estas políticas de gravação ficam sem uso. A regra que vale é a CEB-006: o Baplie só muda pela importação. |
| `politica:baplie_reconciliation_resolutions.baplie_reconciliation_resolutions_insert_acti_global`, `politica:baplie_reconciliation_resolutions.baplie_reconciliation_resolutions_update_acti_global` | Mesma situação: a resolução de divergência só é gravada por **Vale o B/L** (CEB-085). |
| `politica:manifestos_mercante.manifestos_mercante_insert_policy`, `politica:manifestos_mercante.manifestos_mercante_update_policy` | Mesma situação: o cadastro de Manifesto só muda pela planilha de CE, por Informar, Mover e pela importação de vazios (CEB-006, CEB-044, CEB-049). |

#### Equipamentos

| Item | Motivo |
|---|---|
| `funcao:count_distinct_containers` | Contagem de containers distintos que nenhuma tela chama; as telas contam pela própria lista (EQU-002). |
| `gatilho:guard_granite_financial_status` | Impede o B/L de Granito de ficar "pronto para faturar"; desde 2026-10-19 o Granito não tem cobrança e nenhuma tela lê nem grava essa situação. |
| `politica:bl_containers.bl_containers_insert_active_global` | Regra de quem insere container direto, sem efeito: o usuário não tem permissão de inclusão direta; containers só entram pela importação (EQU-005). |
| `politica:granite_bls.granite_bls_insert_active_global`, `politica:granite_bls.granite_bls_update_active_global`, `politica:granite_manifests.granite_manifests_insert_active_global`, `politica:granite_manifests.granite_manifests_update_active_global` | Regras de gravação direta sem efeito: o usuário só tem leitura direta; o Granito entra e muda só pela importação (EQU-117). |
| `politica:vazios_bookings.vazios_bookings_insert_active_global`, `politica:vazios_bookings.vazios_bookings_update_active_global`, `politica:vazios_manifests.vazios_manifests_insert_active_global`, `politica:vazios_manifests.vazios_manifests_update_active_global` | Regras de gravação direta sem efeito: unidades embarcadas e seus lotes só mudam pela planilha e pelas ações Adicionar, Editar e Excluir (EQU-081 a EQU-084). |
| `politica:vazios_importacao_containers.vazios_importacao_containers_insert_active_global`, `politica:vazios_importacao_manifests.vazios_importacao_manifests_insert_active_global`, `politica:vazios_importacao_manifests.vazios_importacao_manifests_update_active_global` | Regras de gravação direta sem efeito: vazios de importação só entram pela planilha ou pelo Baplie; a única gravação direta é a natureza (EQU-063). |
| `politica:vehicles.vehicles_insert_active_global`, `politica:vehicles.vehicles_update_active_global` | Regras de gravação direta sem efeito: veículos entram pela planilha e mudam só por Excluir e Mover (EQU-058). |

#### Clientes e Comunicados

| Item | Motivo |
|---|---|
| `restricao:customer_communication_templates.customer_communication_templates_subject_template_check`, `restricao:customer_communication_templates.customer_communication_templates_body_html_template_check`, `restricao:customer_communication_templates.customer_communication_templates_body_text_template_check`, `unico:customer_communication_templates.customer_communication_templates_kind_unique` | Catálogo de modelos guardado no banco que nenhum envio lê: os e-mails saem dos modelos do código (CLI-090 a CLI-096). Ver D06. |
| `politica:customer_contact_preferences.customer_contact_preferences_edit`, `restricao:customer_contact_preferences.customer_contact_preferences_source_check` | Preferências antigas por Natureza, sem leitor desde que os destinatários passaram a sair das Caixas de Comunicação; nenhuma tela grava nelas. |
| `gatilho:touch_customer_contact_updated_at` | Carimbo técnico de atualização do contato; o rastro visível está nas Alterações do cadastro e no Histórico. |
| `restricao:customer_communication_attempts.customer_communication_attempts_recipient_key_check`, `restricao:customer_communication_attempts.customer_communication_attempts_retry_count_check` | Campos técnicos da tentativa (chave do destinatário e contador de novas tentativas do provedor), não exibidos. |
| `funcao:refresh_customer_reconciliation_queue_for_bl` | Nenhuma tela a chama; a fila de conciliação é atualizada sozinha pelas ações que mudam o vínculo (CLI-030). |
| `gatilho:guard_granite_link_to_deactivated_customer` | O Granito não tem Cliente: nenhuma importação ou tela grava Cliente no Granito, então a recusa não tem como aparecer. |

#### Portal

| Item | Motivo |
|---|---|
| `rotina:cleanup-provision-rate-limit` | Limpa diariamente o registro de tentativas do provisionamento antigo de contas do Portal (senha definida pelo operador), aposentado; nada grava mais nesse registro. |
| `funcao:get_customer_portal_account` | Leitura interna da conta do Portal sem uso em nenhuma tela; o console mostra os mesmos dados por outro caminho (POR-018). |
| `funcao:register_portal_login_abuse` | Caminho alternativo para abrir o alerta de abuso de login, sem uso; o alerta abre pelo login (POR-005). |
| `funcao:portal_resolve_login` | Resolvedor antigo de login por e-mail ou CNPJ, sem permissão de uso nem chamador desde que o login passou a ser resolvido no servidor (POR-003). |
| `restricao:portal_email_events.portal_email_events_attempt_count_check` | Integridade técnica da fila de avisos do provedor de e-mail; nunca chega à tela. |
| `restricao:portal_email_events.portal_email_events_lease_worker_check` | Integridade técnica da fila de avisos do provedor de e-mail; nunca chega à tela. |
| `restricao:portal_email_events.portal_email_events_payload_object_check` | Integridade técnica da fila de avisos do provedor de e-mail; nunca chega à tela. |
| `restricao:portal_email_events.portal_email_events_processing_result_object_check` | Integridade técnica da fila de avisos do provedor de e-mail; nunca chega à tela. |
| `restricao:portal_email_events.portal_email_events_single_attempt_check` | Garante que um aviso do provedor se liga a um envio do Portal ou a um Comunicado, não aos dois; técnica, nunca chega à tela. |
| `restricao:portal_email_event_attempts.portal_email_event_attempts_attempt_no_check` | Integridade técnica do registro de processamento dos avisos do provedor; nunca chega à tela. |
| `restricao:portal_email_event_attempts.portal_email_event_attempts_result_check` | Integridade técnica do registro de processamento dos avisos do provedor; nunca chega à tela. |
| `restricao:portal_email_event_attempts.portal_email_event_attempts_worker_id_check` | Integridade técnica do registro de processamento dos avisos do provedor; nunca chega à tela. |

#### Desbloqueio de CE

| Item | Motivo |
|---|---|
| `unico:ce_unlock_documents.ce_unlock_documents_storage_path_key` | Cada arquivo recebe um nome interno único na área de arquivos; o operador nunca vê nem escolhe esse nome, e nenhuma ação dele pode repeti-lo. |

#### Taxas Locais

| Item | Motivo |
|---|---|
| `restricao:granite_bls.granite_bls_charge_status_check` | Situação das taxas do B/L de Granito. Desde que o Granito deixou de ter Taxa Local, a importação grava sempre "não calculado" e nenhuma tela mostra ou usa esse estado. |

#### Faturamento

| Item | Motivo |
|---|---|
| `funcao:backfill_invoice_receivable_links` | Manutenção técnica de recomposição de vínculos antigos; só o Administrativo, sem tela nem rotina. |
| `funcao:backfill_local_charge_receivables` | Manutenção técnica de recomposição de recebíveis antigos; só o Administrativo, sem tela nem rotina. |
| `funcao:run_billing_for_import_batch` | Rotina antiga de lote de cálculo por manifesto; nenhuma tela nem rotina a chama. |
| `funcao:list_billing_runs` | Leitura da rotina antiga de lote; sem tela. |
| `funcao:get_billing_run_details` | Leitura da rotina antiga de lote; sem tela. |
| `restricao:billing_runs.billing_runs_status_check` | Situação da rotina antiga de lote; sem tela. |
| `restricao:billing_runs.billing_runs_trigger_source_check` | Origem da rotina antiga de lote; sem tela. |
| `restricao:billing_run_logs.billing_run_logs_level_check` | Nível do registro da rotina antiga de lote; sem tela. |
| `restricao:billing_batches.billing_batches_status_check` | Registro interno que agrupa a emissão de vários B/Ls (FAT-094); nenhuma tela o mostra. |
| `restricao:exchange_rate_reference_history.exchange_rate_reference_history_metadata_check` | Formato técnico do histórico do câmbio. |
| `funcao:obsolete_consolidated_invoice` | Marcar consolidada como obsoleta à mão não tem botão; a consolidada fica obsoleta sozinha (FAT-073) e se cancela por **Cancelar fatura** (FAT-151). |
| `funcao:mark_bls_ready_and_create_invoice` | Emissão em lote de vários B/Ls numa fatura; nenhuma tela chama (FAT-066). |
| `gatilho:classify_granite_invoice` | Fatura de Granito desligada; nenhuma fatura de Granito pode ser criada (FAT-170). |
| `gatilho:prevent_duplicate_active_invoice_granite_bl_link` | Fatura de Granito desligada (FAT-170). |
| `unico:invoice_granite_bls.invoice_granite_bls_invoice_id_granite_bl_id_key` | Vínculo de fatura de Granito, desligado (FAT-170). |

#### Recebimento

| Item | Motivo |
|---|---|
| `politica:invoice_refunds.invoice_refunds_insert_financeiro` | Permissão de gravar restituição direto, sem efeito: o usuário não tem acesso de gravação à lista de restituições; toda restituição nasce pelas ações da tela (REC-079 a 092). |
| `politica:invoice_refunds.invoice_refunds_update_financeiro` | Idem: a mudança de situação de restituição só acontece pelas ações de confirmar e cancelar autorização. |
| `funcao:get_invoice_pending_refund` | Consulta antiga do total a devolver, sem chamada no Vela e sem acesso de leitura para o usuário; o detalhe da fatura usa `funcao:list_invoice_details`. |
| `funcao:list_invoice_refunds` | Consulta antiga das restituições, sem chamada no Vela e sem acesso de leitura para o usuário; a tela usa `funcao:list_invoice_refunds_with_evidence`. |
| `funcao:list_local_pix_candidates` | Consulta antiga do extrato (só Taxas Locais), sem chamada no Vela; substituída por `funcao:list_pix_txid_candidates`. |
| `unico:ledger_settlements.idx_ledger_settlements_payment_receivable` | Integridade interna da distribuição de uma baixa entre os B/Ls (uma parcela por B/L por baixa); o operador não vê nem provoca. |
| `unico:ledger_settlements.idx_ledger_settlements_one_unpaid_receivable` | Integridade de parcelas sem baixa, só da carga histórica; nenhuma ação atual as cria. |

#### Demurrage

| Item | Motivo |
|---|---|
| `gatilho:capture_demurrage_calculation_snapshot` | Guarda uma cópia técnica de cada cálculo para auditoria interna; nenhuma tela a mostra (o que o operador vê é a foto de valores, DEM-060). |
| `gatilho:prevent_demurrage_calculation_snapshot_mutation` | Impede alterar essas cópias técnicas; nenhuma tela as edita. |
| `restricao:demurrage_calculation_snapshots.demurrage_calculation_snapshots_calculation_version_check` | Forma da cópia técnica do cálculo, sem tela. |
| `restricao:demurrage_calculation_snapshots.demurrage_calculation_snapshots_event_kind_check` | Forma da cópia técnica do cálculo, sem tela. |
| `restricao:demurrage_calculation_snapshots.demurrage_calculation_snapshots_input_hash_check` | Forma da cópia técnica do cálculo, sem tela. |
| `restricao:demurrage_calculation_snapshots.demurrage_calculation_snapshots_input_snapshot_check` | Forma da cópia técnica do cálculo, sem tela. |
| `restricao:demurrage_calculation_snapshots.demurrage_calculation_snapshots_result_snapshot_check` | Forma da cópia técnica do cálculo, sem tela. |
| `unico:demurrage_calculation_snapshots.demurrage_calculation_snapshots_identity_idx` | Evita cópia técnica repetida do mesmo cálculo. |
| `restricao:demurrage_mutation_requests.demurrage_mutation_requests_operation_check` | Controle técnico contra gravação repetida da mesma ação (pagamento, desconto, cancelamento); o operador não vê. |
| `restricao:demurrage_dunning_claims.demurrage_dunning_claims_attempt_discriminator_check` | Numeração interna das tentativas da Régua; o efeito visível está em DEM-085 e DEM-094. |
| `restricao:demurrage_dunning_claims.demurrage_dunning_claims_counters_check` | Contadores internos de falha e retomada da Régua. |
| `restricao:customer_communication_dunning_groups.customer_communication_dunning_grou_attempt_discriminator_check` | Numeração interna do e-mail agrupado da Régua. |
| `restricao:customer_communication_dunning_invoices.customer_communication_dunning_invo_attempt_discriminator_check` | Numeração interna da participação da Invoice no e-mail agrupado. |
| `unico:exchange_rate_reference_history.exchange_rate_reference_history_identity_idx` | Evita registrar duas vezes a mesma cotação no histórico da referência cambial; sem tela. |
| `unico:demurrage_dispute_attachments.demurrage_dispute_attachments_storage_path_key` | Cada arquivo guardado tem um endereço único gerado pelo sistema. |
| `gatilho:set_updated_at` | Carimbo da data da última alteração; não aparece como regra. |
| `gatilho:touch_demurrage_invoice_updated_at` | Carimbo da data da última alteração da Invoice. |

#### Alertas e rotinas

| Item | Motivo |
|---|---|
| `funcao:list_alert_queue` | Nenhuma tela chama: é o atalho da primeira página da fila, igual a `funcao:list_alert_queue_page` com página 0. |
| `politica:alerts.alerts_insert_active_global` | O usuário interno só tem leitura sobre os alertas; sem permissão de gravar na tabela, a política não chega a ser usada. Toda abertura passa pelas regras do sistema (ALE-027). |
| `politica:alerts.alerts_update_active_global` | Mesmo motivo: o usuário interno não altera alerta diretamente. |
| `gatilho:suppress_normal_portal_alert_events` | Nenhum produtor grava hoje "Fatura criada no portal" nem "Consolidada obsoleta (portal)"; o gatilho só garantiria que nascessem fechados. |
| `gatilho:reject_deleted_agency_report_deadline_alert` | Só age em alerta de prazo do ADR gravado no formato antigo; os alertas do ADR atuais são gravados no formato novo e não passam por ele. |
| `gatilho:sync_legacy_alert_item_lifecycle` | Só age sobre alerta do formato antigo que tenha item; os produtores atuais fecham a linha antiga sem item (ALE-028). |
| `gatilho:resolve_invoice_alerts_on_status_change` | Fecha itens de "Pagamento inválido" e "Cancelamento bloqueado", tipos aposentados que nada abre. |
| `restricao:edge_job_kicks.edge_job_kicks_function_check` | Confere o nome técnico da rotina chamada pelo evento; os gatilhos usam nomes fixos. |
| `alerta:invoice_cancel_blocked`, `alerta:invoice_overdue`, `alerta:invoice_payment_invalid`, `alerta:review_customer_email_missing`, `alerta:review_granite_customer_unlinked` | Tipos aposentados no catálogo: nada os abre, **Regras de alertas** não os lista e o nome só serve para item antigo continuar legível. |

## 8. Documentação corrigida (classe a)

79 divergências da classe a foram corrigidas: cada uma reconferida no código antes de o documento mudar, sem tocar ADR nem o arquivo histórico. Uma divergência pode ter mudado mais de um documento. Nos arquivos de área, a linha da divergência traz "Corrigida no documento em 2026-10-26".

| Documento | Divergências corrigidas |
|---|---|
| `manifesto-edi.md` | 14 |
| `CONTEXT.md` | 13 |
| `desbloqueio-ce.md` | 8 |
| `operacao-suporte.md` | 8 |
| `demurrage.md` | 7 |
| `reconciliacao-pix.md` | 6 |
| `regras-de-negocio.md` | 6 |
| `manual-financeiro.md` | 5 |
| `clientes.md` | 4 |
| `taxas-locais.md` | 4 |
| `viagens.md` | 4 |
| `faturamento.md` | 3 |
| `chegadas-saidas.md` | 2 |
| `portal-cliente.md` | 2 |
| `granito.md` | 1 |
| `seguranca.md` | 1 |

Reclassificadas de a para b, porque o texto defasado está no próprio código e não num documento (estão na seção 6.2):

- Recebimento 7: texto está no código (alertRulesCatalog.ts): vira classe b
- Alertas e rotinas ALE-D03: texto está no código (alertRulesCatalog.ts)
- Alertas e rotinas ALE-D04: texto está no código (alertRulesCatalog.ts)
- Alertas e rotinas ALE-D10: texto está no código (alertRulesCatalog.ts)
- Alertas e rotinas ALE-D11: texto está no código (alertRulesCatalog.ts)
- Alertas e rotinas ALE-D13: contagem está no código e no teste (permissionMatrix.ts)
- Alertas e rotinas ALE-D16: texto está no código (alertRulesCatalog.ts)

## 9. Limitações e próximos passos

- **Leitura, não execução.** Tudo é **Código**: nenhuma tela foi aberta e
  nenhuma função foi chamada. Achados que só a execução confirma estão marcados
  nos arquivos de área ("só leitura do código"). As imagens da Etapa 2 vão
  executar os procedimentos do caminho normal.
- **O que só existe em produção** não foi visto: duração das sessões e captcha
  configurados no painel, a cadência das duas rotinas agendadas à mão
  (`ce-unlock-notify-email` e `ce-unlock-cleanup`), entrega real de e-mail e o
  webhook do provedor, a consulta do Itaú.
- **O check de cobertura roda contra o banco local**, como o `rpc:check`, e não
  junto do `docs:check`, porque o inventário sai do banco com todas as
  migrations. Entrar no CI é a Etapa 4 do plano.
- **Mensagens de tela** (textos que não vêm do banco) estão nas seções
  Mensagens de cada área, mas não são um item do inventário: a completude delas
  depende da leitura das telas, não do check.
- **Próximo passo:** com as decisões das seções 5 a 7, a Etapa 2 (projeto
  gráfico, cenário de demonstração, imagens por script e capítulo-piloto).
