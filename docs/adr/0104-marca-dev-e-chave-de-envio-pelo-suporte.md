# 0104 — Marca Dev e chave de envio que redireciona ao suporte

Status: aceito — 2026-10-27 (decisões do dono; lote 1 do
[plano de correções](../archive/plans/2026-10-27-correcoes-decididas-pelo-dono.md)).
Implementada na migration `469` e nas Edge Functions de e-mail
(`supabase/functions/_shared/email.ts` e `portalEmail.ts`).

Supersede parcialmente a [ADR 0059](./0059-chave-global-de-envio-desligada-por-padrao.md)
(quem muda a chave, o que ela faz desligada e o escopo) e a
[ADR 0085](./0085-modelo-de-permissoes-por-perfil.md) (linhas da chave e do
disparo de Comunicados).

## Contexto

A chave "Envio real de e-mails" (`app_settings.communications_enabled`) é
ferramenta de desenvolvimento e teste do dono, que vai retirá-la antes da
operação com Clientes reais. Até aqui:

- desligada, os Comunicados, a Régua de Cobrança, os avisos do Desbloqueio de
  CE e os avisos de bounce não saíam: a tentativa ficava registrada como
  "simulado", sem chamar o provedor;
- convite, recuperação e redefinição de senha e troca de e-mail de recuperação
  do Portal ignoravam a chave (ADR 0059) e saíam sempre ao destinatário real,
  mesmo nos testes;
- qualquer usuário do Administrativo mudava a chave;
- Financeiro e Operações não liam a chave e viam "Em simulação" com o envio
  ligado (ficha ACE-D01 do mapeamento do Manual do Operador).

## Decisão

1. **Chave ligada:** os e-mails saem normalmente.
2. **Chave desligada:** todo e-mail dirigido a Cliente, inclusive os do Portal,
   é enviado de verdade, mas para `suporte@portalfwlog.com.br` em vez do
   destinatário. O assunto começa com "[Teste → <e-mail do Cliente>]" e o topo da
   mensagem diz quem receberia. E-mail para a própria equipe (resumo diário do
   Portal) não passa pela chave.
3. **O envio redirecionado conta como enviado** em Cobertura, Régua e alertas.
   O estado gravado continua `simulado` (Comunicados) e `simulated` (aviso do
   Desbloqueio de CE), para não reescrever as regras que já tratam esses
   estados como envio feito; a tela os chama de "Redirecionado ao suporte" /
   "Ao suporte". O reenvio do Comunicado de CE e Taxas redirecionado fecha o
   alerta "Reenviar Comunicado de CE e Taxas", como o real.
4. **A supressão conferida é a do Cliente**, como no envio real. Entrega,
   devolução e supressão do endereço do suporte não marcam o contato do
   Cliente: o id do provedor do envio redirecionado ganha o prefixo
   `suporte:`, e o processamento do retorno reconhece essa mensagem e fecha o
   evento sem mexer na tentativa nem abrir alerta.
5. **Marca Dev.** Só a conta do Administrativo com a marca Dev
   (`user_profiles.is_dev`, `is_dev_user()`) liga e desliga a chave. A marca é
   dada só por migration, com a lista de e-mails (hoje
   `lucca.juliatti@fwlog.com.br`, o mesmo em produção e staging); nenhuma tela
   nem usuário logado a muda, e cada mudança entra no Histórico de ações. A
   marca só vale com a conta ativa, no Administrativo e de pessoa. Outras
   permissões especiais podem entrar na marca depois. O e-mail e a senha da
   conta com a marca só são trocados pela própria pessoa: **Editar acesso**
   de outro Administrativo os mostra travados e a Edge Function `admin-users`
   recusa (403) — senão, redefinir a senha e entrar com ela ligaria a chave.
   Desativar e trocar o setor continuam com o Administrativo; nenhum dos dois
   liga a chave (decisão do dono de 2026-10-27, revisão da PR #1070). Esquecida
   a senha, a redefinição é pelo painel do Supabase.
6. **Todos os setores leem a chave** e o intervalo da Régua, disparam
   Comunicado e salvam modelo; editar contatos e Caixas de Comunicação segue
   com Administrativo, Documentação e Equipamentos (ficha ACE-D01, opção A).

## Consequências

- Nenhum e-mail de teste chega a Cliente com a chave desligada, e o fluxo
  testado passa pelo provedor como na operação real; o suporte recebe todos os
  e-mails dos testes.
- Sem credencial do provedor (banco local, testes), a chave desligada só
  registra a tentativa, como a simulação antiga (`ponytail:` em
  `_shared/email.ts`).
- Erro ao ler a chave num e-mail do Portal conta como desligada: o e-mail vai
  ao suporte em vez de arriscar sair para o Cliente.
- A tentativa redirecionada fica fechada com o id `suporte:…`; ligar a chave
  depois não reenvia ao Cliente o que já foi ao suporte.
- Sem ninguém com a marca Dev, a chave fica como está até nova migration.
- Dar Dev a um setor novo exigiria revisar cerca de 200 verificações do
  Administrativo no banco e 76 nas telas; por isso a marca fica sobre o
  Administrativo, não como setor próprio.

Regra vigente: [Clientes § Chave de envio](../modules/clientes.md#chave-de-envio-de-comunicados)
e [Segurança § Modelo de permissões](../operations/seguranca.md#modelo-de-permissões-por-perfil).
