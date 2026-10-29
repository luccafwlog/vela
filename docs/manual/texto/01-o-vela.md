O Vela é o sistema interno da Fwlog: é nele que as equipes cadastram as Viagens, recebem a documentação do armador, cobram as Taxas Locais e acompanham cada navio até a carga ser liberada. O Cliente usa outro sistema, o Portal Fwlog, que lê os mesmos dados. Este capítulo mostra como entrar, como o Vela se organiza e como ele fala com você: as cores, os avisos e as janelas que aparecem em todas as telas.

::: aprende
- entrar e sair do Vela, e entender quando ele pede para entrar de novo;
- achar as telas pelo menu e ler o Painel, o ponto de partida do dia;
- reconhecer as cores, as confirmações e o vocabulário das ações;
- buscar, filtrar, exportar e usar os Relatórios;
- saber o que fazer quando uma tela não abre ou algo dá errado.
:::

## 1.1 Entrar e sair

**Quem faz:** {{Todas as equipes}}

::: lado
1. Abra o Vela no navegador. A tela **Acesso interno** pede **E-mail** e **Senha**.
2. Entre com o e-mail e a senha que o {{Administrativo}} criou para você.

::: tela entrada
A tela de entrada do Vela.
:::
:::

Não existe cadastro aberto nem "esqueci a senha" no Vela: quem cria os usuários e redefine senhas é o {{Administrativo}}. A senha precisa ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número; você mesmo a troca em **Meu perfil**.

Para sair, use **Sair** no menu da conta (no canto direito do alto ou, com o menu na lateral, no pé dele). A saída vale para todas as suas sessões: as outras abas saem na hora, e outros computadores em até uma hora.

O Vela também pede para entrar de novo sozinho:

- depois de **8 horas** sem ninguém mexer no Vela numa aba aberta daquele navegador. Como no **Sair**, essa saída vale também para os outros computadores: uma aba esquecida aberta derruba a sua sessão em outro lugar;
- quando o {{Administrativo}} desativa o seu usuário ou troca o seu e-mail ou a sua senha.

::: atencao
O Vela e o Portal Fwlog são sistemas separados, com entradas separadas. Você pode estar dentro dos dois no mesmo navegador, e sair de um não tira você do outro.
:::

## 1.2 O menu e a barra do alto

**Quem faz:** {{Todas as equipes}}

O menu fica no alto da tela e agrupa as telas pelo assunto: **Painel**, **Viagens**, **Importação** (Baplie EDI, BLs, Desbloqueio de CE, Containers, Veículos, Vazios IMP, Revisão), **Exportação** (Granito, Vazios EXP), **Clientes**, **Alertas**, **Financeiro** (Taxas Locais, Demurrage, Conciliação PIX), **Relatórios** e **Admin**, que só o {{Administrativo}} vê.

O número ao lado de um item conta o que está pendente no Vela inteiro, de todas as equipes: os alertas ativos, os B/Ls pendentes de Revisão, os B/Ls com taxa em revisão. O de **Alertas** se atualiza sozinho a cada minuto; os outros, quando você mexe no assunto ou recarrega a página.

Na barra do alto ficam também:

- **o sino**, com as notificações internas que chegaram para você. Clicar numa notificação abre a tela onde a pendência se resolve;
- **a faixa de avisos**, com os containers que passaram do prazo livre de devolução e a cotação do dólar do dia (PTAX), usada nas cobranças em dólar;
- **o menu da conta**, com o seu nome.

::: tela menu-conta
O menu da conta: Meu perfil, a posição do menu, Sair e a versão do Vela.
:::

No menu da conta, **Posição do menu** deixa o menu no alto ou na lateral, como você preferir, naquele navegador. A **Versão**, no pé, copia o código da versão do Vela: cole-o quando pedir ajuda ao suporte técnico.

## 1.3 O Painel: por onde começar o dia

**Quem faz:** {{Todas as equipes}}

O Vela abre no **Painel**. Ele responde às duas perguntas do começo do dia: o que está pendente e quais navios estão chegando.

::: tela painel-topo
O Painel: os atalhos no alto e um cartão de alertas por setor.
:::

- **Os cartões por setor** (Documentação, Equipamentos, Operações e Administrativo) mostram quantos alertas cada equipe tem abertos. Clique no da sua equipe para ver a lista (capítulo 20). O {{Financeiro}} não tem cartão próprio: os alertas dele contam no do {{Administrativo}} e chegam pelo sino. Um cartão **Sem setor** junta os alertas antigos, de antes da divisão por equipe.
- **O Line Up**, logo abaixo, mostra os navios atracados, os que estão chegando e a carga de cada porto (capítulo 5).
- **Chegadas e Saídas** e **Tela TV** abrem a programação dos navios (capítulo 5).

O Painel se atualiza sozinho a cada minuto e meio.

## 1.4 Como o Vela fala

**Quem faz:** {{Todas as equipes}}

O Vela usa as mesmas cores e as mesmas janelas em todas as telas. Conhecendo-as, você lê qualquer tela.

| Cor | Quer dizer |
|---|---|
| Âmbar | Pede ação: algo pendente, aguardando ou em aberto. |
| Vermelho | Venceu, falhou ou bloqueia. |
| Verde | Concluído ou pago (**Paga** vem com ✓). |
| Cinza | Encerrado sem efeito: cancelado, isento, inativo. |
| Azul | Só informa. |

A cor sempre vem com um texto. Um "—" discreto quer dizer que não há dado, não que houve erro.

**A janela de confirmação.** Toda ação que grava, envia algo a alguém ou tira um registro de circulação abre uma janela antes. Ela diz o que vai acontecer, quais registros são afetados e quais ficam de fora e por quê. **Voltar** fecha sem fazer nada. O botão de confirmar fica vermelho quando a ação é perigosa.

**O motivo obrigatório.** Excluir, cancelar, reativar, reverter e revogar pedem um motivo, que fica gravado no histórico junto com a ação. Sem motivo, o botão de confirmar não liga.

**O nome do botão é o efeito.** O Vela usa sempre as mesmas palavras:

| Botão | O que faz |
|---|---|
| **Excluir** | Apaga. Só para erro de cadastro, sem nada oficial ligado. |
| **Cancelar** | Registra que o fato deixou de valer. O registro continua visível, como cancelado. |
| **Desativar** | Tira um cadastro das listas de escolha, sem apagar. |
| **Reativar** | Desfaz um cancelamento ou uma desativação. |
| **Reverter** | Desfaz uma marcação, como a omissão de uma escala. |
| **Remover** | Tira de um vínculo, sem apagar. |

::: atencao
Quando o Vela recusa uma ação, a mensagem diz o motivo com as palavras da regra, por exemplo "Somente o Administrativo cancela viagem.". Leia o motivo antes de tentar de novo.
:::

## 1.5 Buscar, filtrar e exportar

**Quem faz:** {{Todas as equipes}}

As listas do Vela (B/Ls, Containers, Clientes, faturas) funcionam do mesmo jeito:

- **Os filtros ficam no endereço da página.** Copie o link e mande a um colega: ele abre a mesma lista, com os mesmos filtros.
- **A busca aceita vários números de uma vez.** Cole uma coluna de B/Ls ou de containers, e a lista traz todos.
- **A caixa do cabeçalho seleciona tudo o que o filtro achou,** em todas as páginas, não só a página da tela. Há seleção em Veículos, Vazios IMP e Desbloqueio de CE e, para o {{Administrativo}}, em B/Ls, Containers e Clientes.
- **Exportar** (em Clientes, **Exportar base**) baixa uma planilha com tudo o que o filtro achou.

### Relatórios

**Relatórios**, no menu, reúne os números da operação em quatro abas: **Operacional** (B/Ls, containers, peso), **Financeiro** (faturas emitidas e pagas), **Por Cliente** e **Demurrage**. O período, a Viagem e o Cliente valem para todas as abas.

::: tela relatorios
Relatórios, na aba Operacional.
:::

**Exportar planilha** leva o recorte inteiro para o Excel, com uma aba que registra os filtros usados.

## 1.6 Quando algo dá errado

**Quem faz:** {{Todas as equipes}}

| Você vê | O que fazer |
|---|---|
| **Acesso restrito** | A tela não é da sua equipe. Se precisar dela, fale com o {{Administrativo}}. |
| **Página não encontrada** | O link está errado ou é antigo. Volte ao Painel e navegue pelo menu. |
| **Sem conexão no momento** | A internet caiu. A lista não está vazia: clique em **Tentar novamente** quando a conexão voltar. |
| **Não foi possível exibir esta tela** | Um erro nessa tela. O resto do Vela continua funcionando: recarregue a página. |
| **Acesso ainda não liberado** | O seu usuário está desativado ou ainda não foi liberado. Procure o {{Administrativo}}. |

Fora o Painel, o número de Alertas e o sino, o Vela não atualiza as telas sozinho. O que você grava aparece na hora na sua tela; o que um colega gravou aparece quando você reabre ou recarrega a página.

::: atencao
Se o problema continuar, leve ao suporte técnico o que aparece na tela e a versão do Vela, copiada no menu da conta ([1.2](#12-o-menu-e-a-barra-do-alto)).
:::
