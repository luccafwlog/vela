# 0037 — Usuário interno é criado pelo administrador com senha definida, sem convite

> **Situação atual (2026-10-13).** Decisão vigente e implementada pela Edge Function `admin-users` (criar, trocar e-mail ou senha, desativar). "Administrador" é hoje o perfil Administrativo: o papel `admin` saiu e usuário interno não se exclui ([ADR 0074](./0074-usuarios-retencao-e-backup-diario.md)).
> Esta decisão supersede parcialmente a [ADR 0019](./0019-politica-de-senha-e-signup-fechado.md) quanto ao usuário interno criado pelo dashboard. A "ADR 0018" citada abaixo para o convite do Portal é engano (a 0018 trata da busca de viagem);
> o convite está em [Portal do Cliente](../modules/portal-cliente.md), Provisionamento operacional. A migration `223` citada abaixo é da cadeia arquivada (`supabase/migrations_archive/`), anterior à consolidação da ADR 0062.
> Regra vigente: [Operação e Suporte](../modules/operacao-suporte.md), tela `/admin`; política de senha em [Segurança](../operations/seguranca.md).

Status: aceito
- Data: 2026-08-05

## Contexto

`user_profiles.id` é chave estrangeira de `auth.users(id)`, e a tela
`/admin/usuarios` só fazia `SELECT` e `UPDATE`. Criar um usuário interno exigia
o dashboard do Supabase, e o produto já convivia com o estado intermediário:
o `ProtectedRoute` tem uma tela para "perfil não provisionado". O login interno
também não oferecia recuperação de senha.

O Portal do Cliente resolve o mesmo problema por convite com token e e-mail
(ADR 0018, `portal-invite-send`), com supressão de bounce, expiração e
reenvio.

## Decisão

Para o **sistema interno**, o administrador cria o usuário informando nome,
e-mail, setor e senha, e pode alterar e-mail ou senha a qualquer momento. Não há
convite, token nem envio de e-mail. O usuário entra imediatamente
(`email_confirm: true`) e pode trocar a própria senha, mediante revalidação da
senha atual.

O setor é obrigatório no cadastro e continua sendo a coluna `role`: os papéis já
funcionam como departamento no sign-off do ADR
(`223_agency_report_department_signoff.sql`).

A escrita privilegiada mora na Edge Function `admin-users`, que reserva o
`service_role` para as operações de autenticação e usa o cliente do chamador
para escrever em tabela, preservando RLS e o autor na auditoria.

## Consequências

- O administrador conhece a senha inicial de cada pessoa. Aceitável para um time
  interno pequeno, onde a entrega é presencial; é o custo de não depender de
  e-mail.
- Não existe autoatendimento de "esqueci minha senha" no login interno: quem
  esquece pede ao administrador uma senha nova.
- O Portal do Cliente **não** muda: o fluxo de convite da ADR 0018 continua
  valendo para o cliente externo, e a divergência entre os dois é deliberada.
- Toda criação, troca de setor, ativação/desativação e redefinição de senha
  passa a aparecer no Log de Ações.
