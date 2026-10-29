No Vela, cada pessoa pertence a uma equipe, e a equipe decide o que ela pode fazer. A regra geral é generosa: quase tudo da operação é de qualquer equipe. O que fica reservado a algumas equipes é pouco, e tem um motivo: mexe em dinheiro, apaga algo oficial ou fala com o Cliente em nome da Fwlog. Este capítulo mostra essas exceções e a quem pedir quando o botão não aparece para você.

::: aprende
- quais são as equipes do Vela e o que quase todas podem fazer;
- o que é reservado a algumas equipes, e por quê;
- a quem passar cada pedido;
- como o Vela registra quem fez o quê.
:::

## 2.1 As equipes

O Vela tem cinco equipes, e cada pessoa pertence a uma só:

| Equipe | No dia a dia |
|---|---|
| {{Documentação}} | B/L, CE Mercante, Revisão, Portal do Cliente, Desbloqueio de CE. |
| {{Operações}} | Escalas, terminais e atracação. |
| {{Equipamentos}} | Containers, veículos, vazios, Granito e Demurrage. |
| {{Financeiro}} | Pagamentos, conciliação do Pix e restituições. |
| {{Administrativo}} | Usuários, cancelamentos e exclusões, e cobre qualquer equipe que faltar. |

A coluna da direita é a rotina, não uma trava: o Vela deixa qualquer equipe importar arquivos, cadastrar Viagens, editar escalas, emitir faturas e muito mais. Quem cria os usuários e escolhe a equipe de cada um é o {{Administrativo}}.

::: atencao
Quem aparece em **Usuários** como "Documentação · setor antigo Operador" vale como Documentação em tudo, mas não recebe o resumo diário do Portal. O {{Administrativo}} troca essas pessoas para Documentação em **Admin** › **Usuários**.
:::

## 2.2 O que é reservado a algumas equipes

**Quem faz:** a equipe indicada em cada ação

Estas são as ações que o Vela reserva. Para as outras equipes, o botão não aparece ou fica apagado; e se o pedido chegar ao Vela por outro caminho, ele recusa.

| Ação | Quem faz |
|---|---|
| Criar usuários, mudar a equipe, ativar e desativar | {{Administrativo}} |
| Cancelar e reativar Viagem e B/L; excluir Viagem, B/L e container | {{Administrativo}} |
| Cancelar fatura e cancelar pagamento registrado | {{Administrativo}} |
| Corrigir tabela de cobrança já usada; editar Condição de Cliente | {{Administrativo}} |
| Desativar e reativar cadastros (tabela de cobrança, Local, serviço, tarifa) | {{Administrativo}} |
| Liberação de faturamento sem Portal; desativar Cliente | {{Administrativo}} |
| Registrar pagamento, confirmar restituição, conciliar o Pix | {{Financeiro}} e {{Administrativo}} |
| Informar a cotação do dólar (PTAX) | {{Financeiro}}, {{Equipamentos}} e {{Administrativo}} |
| Responder ao Cliente na Disputa de Demurrage | {{Equipamentos}} e {{Administrativo}} |
| Convidar o Cliente para o Portal e cuidar da conta dele | {{Documentação}} e {{Administrativo}} |
| Gerir o Desbloqueio de CE | {{Documentação}} e {{Administrativo}} |
| Editar contatos do Cliente; cadastrar Cliente pelo **Novo cliente** | {{Documentação}}, {{Equipamentos}} e {{Administrativo}} |
| Remover uma atracação ou trocar o terminal dela | {{Operações}} e {{Administrativo}} |

No ADR de Saída, cada equipe assina a sua parte: {{Operações}} a escala, {{Documentação}} a carga e os vazios descarregados, {{Equipamentos}} a carga carregada, os veículos e o embarque de vazios. O {{Administrativo}} pode assinar por qualquer uma (capítulo 11).

As outras equipes trazem o Cliente pela base de Clientes ou pela Revisão. O {{Administrativo}} vê a lista ação por ação em **Admin** › **Usuários**, no quadro **O que cada setor pode** (escolha **Todas as ações** para ver todas).

::: tela matriz-setores
O quadro O que cada setor pode, na Administração.
:::

::: atencao
Esconder um botão não é o que protege o Vela: quem confere a equipe é o próprio sistema, a cada gravação. Por isso, mesmo que um link leve você a uma ação que não é sua, ela será recusada.
:::

## 2.3 A quem passar cada pedido

**Quem faz:** {{Todas as equipes}}

Quando o botão não aparece para você, ou o Vela diz que a ação é de outra equipe, peça a quem pode:

| Você precisa… | Peça a |
|---|---|
| cancelar uma Viagem ou um B/L, ou excluir uma Viagem, um B/L ou um container | {{Administrativo}} |
| cancelar uma fatura | {{Administrativo}} |
| registrar que um pagamento chegou | {{Financeiro}} |
| devolver dinheiro ao Cliente | {{Financeiro}} |
| ativar o Portal de um Cliente | {{Documentação}} |
| liberar o faturamento de um Cliente sem Portal | {{Administrativo}} |
| informar o câmbio do dia | {{Financeiro}} ou {{Equipamentos}} |
| reativar um usuário ou trocar a sua equipe | {{Administrativo}} |

Os alertas já chegam à equipe certa: cada equipe recebe no sino os alertas pelos quais responde (capítulo 20). O {{Financeiro}} recebe também os avisos de dinheiro, como um Pix que não pôde ser conciliado.

## 2.4 Quem fez o quê

Tudo o que se grava no Vela fica no histórico com o nome de quem fez, a equipe dele naquele momento e a hora. O que o sistema faz sozinho aparece como **Sistema**. Ninguém altera nem apaga o histórico, e todas as equipes veem o nome de quem fez cada registro.

Ninguém grava em nome de outra pessoa, nem o {{Administrativo}}: o Vela sempre registra quem está de fato usando o sistema. Por isso, não use o usuário de um colega.
