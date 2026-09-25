# 0072 — Toda escrita é confirmada com o que faz e a consequência

Status: aceito — 2026-09-24. Implementação parcial (ver nota).

> **Nota de implementação — 2026-09-25.** Em luccafwlog/vela#764 o diálogo
> (`ConfirmDialog`, `useConfirmWithReason`) ganhou registros afetados, lista
> sob demanda, bloqueados com motivo, consequência, reversibilidade, motivo
> obrigatório e o botão Voltar, e passou a ser usado nas ações de exclusão e
> cancelamento. A prévia vem do banco que executa (`p_dry_run`). Pendente,
> no [plano da política de exclusão](../plans/2026-09-24-politica-de-exclusao.md): antes/depois em Salvar, diálogo nas demais escritas e motivo
> gravado nas exclusões que não passam por `delete_records` (vazios, tarifas,
> locais).

## Contexto

Na revisão da [auditoria de exclusão de dados](../archive/audits/2026-09-24-revisao-exclusao-de-dados.md),
o dono do negócio constatou que o usuário não sabe, pela tela, o que uma ação
faz: a mesma palavra tem efeitos diferentes (achado A7) e a tela chegou a
mostrar sucesso de exclusão que não aconteceu (achado A1). O vocabulário das
ações foi fixado em `CONTEXT.md` ("Ações sobre registros"); falta a tela
explicar cada ação antes de executá-la.

O risco conhecido de confirmar tudo é o usuário aprender a clicar sem ler.
A decisão responde a isso exigindo que o diálogo mostre informação específica
daquela ação, não uma pergunta genérica.

## Decisão

1. **Alcance.** Toda ação que grava ou altera dado, envia algo a alguém
   (e-mail, Portal, comunicado) ou tira um registro de circulação abre um
   diálogo de confirmação antes de executar. Busca, filtros, ordenação, abas e
   navegação não abrem.
2. **Conteúdo obrigatório.** O diálogo diz:
   - o que será feito, com o termo do vocabulário, e em quais registros,
     incluindo o que vai junto em cascata;
   - a consequência visível: onde muda, se o cliente ou o Portal vê, se
     recalcula, emite ou envia algo;
   - se dá para desfazer e como;
   - um campo de **motivo obrigatório** em Excluir, Cancelar, Reativar,
     Reverter e Revogar, gravado junto com a ação.
3. **Salvar edição** mostra cada campo alterado, com valor anterior e novo,
   e o efeito da alteração.
4. **Importação.** A prévia que antecede "Confirmar importação" vale como o
   diálogo quando mostra o que entra, o que muda, o que sai e as
   consequências. Não se abre um segundo diálogo depois dela.
5. **Ação em massa** mostra totais por tipo de registro, os itens bloqueados
   com o motivo, e a lista completa sob demanda. Um motivo vale para o lote.
6. O botão que fecha sem executar se chama **Voltar**.

## Consequências

- **Positivas:** o usuário decide sabendo o efeito; o motivo passa a existir
  em toda ação que tira ou devolve algo; a mensagem de sucesso só pode
  repetir o que o diálogo prometeu, o que expõe falsos sucessos.
- **Negativas / custos:** toda tela de escrita muda; a consequência exibida
  precisa vir do mesmo lugar que executa a ação (prévia calculada pelo
  servidor quando a cascata ou o recálculo é decidido no banco), senão o
  diálogo promete uma coisa e o banco faz outra; mais um clique em edições
  rotineiras.
- **Em aberto:** a ordem de adoção por tela acompanha a revisão das regras de
  exclusão tela a tela.
