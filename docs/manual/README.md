# Manual do Operador

Fonte do Manual do Operador do Vela, escrito a partir do comportamento atual do
sistema ([plano](../plans/2026-10-26-manual-do-operador.md)). O manual diz como
agir; a regra continua no documento de módulo.

## Matriz de cobertura

[`cobertura/`](cobertura/) liga cada regra de negócio do código ao lugar do
manual que a explica. Há um arquivo por área do sistema. Cada linha traz a
regra como o operador a vê, o destino no manual, os setores envolvidos e os
itens do código que a implementam.

`npm run manual:coverage` (banco local preparado, ver
[WORKFLOW.md](../../WORKFLOW.md#testes-de-integração)) extrai o inventário do
sistema e falha quando:

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
