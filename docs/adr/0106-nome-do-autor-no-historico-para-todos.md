# 0106 — Nome do autor no Histórico para todos e leitura fechada da Administração

Status: aceito — 2026-10-27 (decisões do dono, fichas ACE-D16, opção A, e
ACE-D06, opção B com o alcance escolhido em 2026-10-27; lote 7 do
[plano de correções](../plans/2026-10-27-correcoes-decididas-pelo-dono.md)).
Implementada na migration `475`.

Supersede parcialmente a [ADR 0085](./0085-modelo-de-permissoes-por-perfil.md)
(exceção "/admin e usuários, inclusive leitura").

## Contexto

A ADR 0085 deixou a Administração e o cadastro de usuários só com o
Administrativo, "inclusive leitura". No banco, isso valia só para a lista de
usuários. Disso saíram duas divergências no mapeamento do Manual do Operador:

- **ACE-D16.** Os Históricos (B/L, Viagem, Cliente) buscavam o nome do autor no
  cadastro de usuários. Para os demais setores a busca voltava vazia e a coluna
  **Por** mostrava "—", com a explicação "O registro não guarda o autor", embora
  o autor estivesse gravado. O ADR de Saída já mostrava o nome a todos por uma
  função própria.
- **ACE-D06.** O Histórico de ações, as falhas de entrega e o Prazo do ADR
  eram lidos por todos fora das telas.

O Histórico de ações lê a mesma tabela (`audit_logs`) que os Históricos de
cada assunto, e o Prazo do ADR lê os mesmos registros do ADR de Saída. Os dois
são usados por todos os setores.

## Decisão

1. Todo usuário interno ativo vê o **nome** de quem fez cada registro do
   Histórico, pela função `get_user_display_names`, que devolve só o id e o
   nome. E-mail, setor e situação do usuário continuam leitura do
   Administrativo.
2. Ficam só com o Administrativo, no banco:
   - as falhas de entrega dos alertas (`alert_notification_failures`);
   - as linhas de Usuário do Histórico de ações (`audit_logs` de
     `entity_type = 'user_profile'`: setor, situação, tipo de conta, senha).
3. Os demais assuntos do Histórico de ações e o Prazo do ADR seguem lidos por
   todos, porque são os dados das telas de cada assunto. Fechar tudo exigiria
   passar as telas que leem `audit_logs` para funções do banco. O dono decidiu
   não fazer isso agora.

## Consequências

- A coluna **Por** dos Históricos mostra o nome para todos os setores; "—"
  fica para o registro que não guarda autor.
- Quem não é do Administrativo não lê, por nenhum caminho, as falhas de entrega
  nem a trilha de acesso dos usuários.
- A leitura direta de `user_profiles` pelas telas de Histórico saiu; elas usam
  `fetchUserDisplayNames` (`src/services/userNames.ts`).
