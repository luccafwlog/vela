# 0074 — Usuário não se exclui; retenção definida; backup diário sem PITR

Status: aceito — 2026-09-24. Implementação pendente.

> **Nota editorial — 2026-09-25.** O dono do negócio decidiu **não anonimizar**
> dados pessoais: o item 3 fica só com os expurgos por prazo (auditoria 5 anos,
> eventos e tentativas do Portal 1 ano). A rotina de guarda preserva, na
> auditoria, as marcas de escala (`voyage_pod_schedule`, `voyage_pol_schedule`),
> que são dado operacional. O custo de anonimizar na trilha imutável, descrito
> em Consequências, deixa de existir. Implementação em luccafwlog/vela#769
> (migrations 093 e 094).

Fecha os pontos gerais da
[revisão da exclusão de dados](../archive/audits/2026-09-24-revisao-exclusao-de-dados.md)
que não pertencem a uma tela: usuário interno, papel legado, prazos de guarda
(achado A10) e recuperação do banco (achado A6). Complementa as
[ADR 0071](./0071-ce-mercante-como-trava-de-exclusao.md) e
[ADR 0073](./0073-cadastro-usado-so-se-desativa.md).

## Contexto

Usuário interno já só se desativa, mas sem regra escrita. O papel `admin`
sobrevive como legado que o código traduz para `administrativo`
(`src/hooks/useAuth.tsx`), o que alimenta a confusão entre Admin e
Administrativo. Dados pessoais de contatos, contas do Portal e usuários
desativados ficam guardados sem prazo, e a auditoria copia esses dados a cada
alteração. O backup lógico cifrado em R2 existe como procedimento
([backup-r2.md](../operations/backup-r2.md)), mas não está agendado em
produção, e o PITR não foi contratado.

## Decisão

1. **Usuário interno nunca é excluído**, só desativado: ele é o autor gravado
   na trilha de auditoria e nos eventos.
2. **O papel `admin` é removido.** Todo usuário `admin` passa a
   `administrativo`, e o valor sai da lista de papéis aceitos.
3. **Prazos de guarda:**
   - auditoria (`audit_logs`): 5 anos;
   - eventos e tentativas do Portal: 1 ano;
   - contatos, contas do Portal e usuários desativados: dados pessoais
     anonimizados 2 anos após a desativação.
   O expurgo e a anonimização são feitos por rotina do banco; o app não
   apaga nada disso.
4. **Sem PITR.** A recuperação do banco é o backup lógico diário, que passa a
   ser agendado em produção. Recuperar uma exclusão pontual continua sendo
   pela cópia na auditoria (ADR 0071).

## Consequências

- **Positivas:** o "quem fez" nunca se perde; um papel a menos; dados
  pessoais deixam de ficar para sempre.
- **Negativas / custos:** uma falha grave do banco pode perder até um dia de
  dados, a janela entre dois backups; o backup só serve se a restauração for
  testada. Os prazos foram adotados pelo dono do negócio sem parecer jurídico
  ou contábil registrado; se esse parecer vier diferente, esta ADR recebe nota
  editorial. A anonimização precisa alcançar também as cópias em `audit_logs`,
  o que conflita com a trilha imutável e exige uma exceção controlada da
  rotina de retenção.
- **Pré-requisito:** o agendamento do backup diário e a atualização do
  [manual de serviços externos](../operations/servicos-externos.md) entram
  na implementação.
