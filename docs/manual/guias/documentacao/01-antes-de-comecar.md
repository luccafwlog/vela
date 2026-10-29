O Vela é o sistema interno da Fwlog; o Cliente usa o Portal Fwlog, que lê os mesmos dados. A {{Documentação}} é quem faz a documentação de cada Viagem andar: sobe os arquivos do armador, garante que cada B/L tem o Cliente certo, libera o Portal, acompanha os avisos ao Cliente e cuida do Desbloqueio de CE.

## 1.1 Entrar e se orientar

::: passos
1. Abra o Vela no navegador e entre com o **E-mail** e a **Senha** que o {{Administrativo}} criou para você. Esqueceu a senha? Peça a ele uma nova; a troca da sua senha fica em **Meu perfil**.
2. O menu, no alto, agrupa as telas: **Painel**, **Viagens**, **Importação** (Baplie EDI, BLs, Desbloqueio de CE, Containers, Veículos, Vazios IMP, Revisão), **Exportação**, **Clientes**, **Alertas**, **Financeiro** e **Relatórios**. O número ao lado de um item conta o que está pendente.
3. O **sino**, na barra do alto, traz as notificações que chegaram para você. Clicar numa delas abre a tela onde a pendência se resolve.
4. Para sair, use **Sair** no menu da conta, com o seu nome.
:::

O Vela não atualiza as telas sozinho, fora o Painel, o número de Alertas e o sino: o que um colega gravou aparece quando você recarrega a página.

## 1.2 Painel

O Vela abre no **Painel**, o ponto de partida do dia.

::: tela painel-topo
O Painel: os atalhos no alto e um cartão de alertas por setor.
:::

- O cartão **Documentação** mostra quantos alertas a sua equipe tem abertos. Clique nele para abrir a fila já no seu setor (seção 8.1).
- O **Line Up**, logo abaixo, mostra os navios atracados e os que estão chegando.
- **Chegadas e Saídas** abre a programação que o Cliente vê no Portal (seção 2.3).

## 1.3 Como o Vela fala

| Cor | Quer dizer |
|---|---|
| Âmbar | Pede ação: pendente, aguardando, em aberto. |
| Vermelho | Venceu, falhou ou bloqueia. |
| Verde | Concluído ou pago. |
| Cinza | Encerrado sem efeito: cancelado, isento, inativo. |

Toda ação que grava ou envia algo abre uma janela de confirmação antes, dizendo o que vai acontecer; **Voltar** fecha sem fazer nada. Cancelar, excluir e reverter pedem um motivo, que fica no histórico. Quando o Vela recusa, a mensagem diz o motivo: leia antes de tentar de novo.

Nas listas, os filtros ficam no endereço da página (copie o link e o colega abre o mesmo recorte), a busca aceita vários números colados de uma vez e **Exportar** baixa uma planilha com tudo o que o filtro achou.

## 1.4 O dia a dia da Documentação

Quase tudo acontece em resposta a um arquivo que chega ou a uma fila que pede ação.

| Quando | Você faz | Seção |
|---|---|---|
| Chega o B/L do armador | Importa os B/Ls na Viagem | 3.2 e 3.3 |
| Chega o Baplie | Importa o Baplie e confere a conciliação | 3.4 |
| Chega a planilha de CE Mercante | Importa o CE: as faturas saem sozinhas | 3.5 |
| A Revisão tem B/Ls | Cadastra ou vincula o Cliente e convida para o Portal | 4.2 a 4.4 |
| O Provisionamento tem Clientes aguardando | Convida e acompanha a ativação | 5.4 |
| O Cliente pede o Desbloqueio de CE | Analisa os documentos, registra o original e exporta para a ZPT | 7.3 a 7.6 |
| O navio sai do terminal | Confere e assina a parte da Documentação no ADR | 2.5 |

Comece o dia pelo **Painel** e pela fila de **Alertas** da Documentação; depois a **Revisão**, o **Desbloqueio de CE** (aba **Solicitações** e cartão **Aptos, não exportados**) e a **Cobertura de viagens**. Às 8h chega por e-mail o **Resumo do Portal**, com os convites que esperam ativação.

::: atencao
A ordem dos arquivos importa: importe todos os B/Ls da Viagem antes do CE Mercante. A fatura sai logo depois do CE, e um B/L que chega depois muda a divisão da cobrança do container.
:::
