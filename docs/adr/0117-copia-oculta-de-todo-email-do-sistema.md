# 0117 — Cópia oculta de todo e-mail do sistema

Status: aceito — 2026-11-03 (pedido do dono, que escolheu a opção que inclui os
e-mails com link de acesso). Implementada em `sendEmail`
(`supabase/functions/_shared/email.ts`).

## Contexto

Todo e-mail que o Vela e o Portal enviam passa por `sendEmail`: convite,
reenvio, recuperação de senha, troca do Email de Recuperação, senha alterada,
avisos de bounce e do Desbloqueio de CE, Comunicados, cobrança de Demurrage e o
resumo diário da equipe. O dono pediu cópia oculta de todos eles para
`lucca.juliatti@fwlog.com.br`.

Foram oferecidas duas opções: (a) cópia de todos, menos os quatro e-mails com
link de uso único (convite, reenvio, recuperação de senha e confirmação da troca
do Email de Recuperação); (b) cópia de todos. O dono escolheu (b).

## Decisão

- `sendEmail` manda o endereço em `bcc` em todo envio ao provedor, também no
  e-mail redirecionado ao suporte com a chave de envio desligada (ADR 0104). O
  destinatário não vê a cópia.
- O endereço vem do secret `EMAIL_BCC_ADDRESS`; sem ele, vale
  `lucca.juliatti@fwlog.com.br`. O valor `off` desliga a cópia sem publicar as
  funções. Quando o destinatário é o próprio endereço da cópia, ela não vai.
- Os e-mails de login da equipe interna saem pelo Supabase Auth, fora do
  código, e não levam a cópia.

## Consequências

- **Risco aceito:** a caixa da cópia recebe os links de uso único do Portal.
  Quem a ler pode ativar a conta, trocar a senha ou trocar o Email de
  Recuperação de qualquer Cliente antes dele. A proteção dessa caixa passa a
  fazer parte da segurança do Portal ([segurança](../operations/seguranca.md)).
- **Retorno do provedor:** o webhook liga o aviso ao envio pelo id do e-mail e
  toma o primeiro endereço do "Para" como destinatário. Se a caixa da cópia
  devolver ou marcar a mensagem como spam e o provedor avisar com o mesmo id, o
  bounce ou a reclamação pode cair no endereço do Cliente e suprimi-lo. Não foi
  conferido como a MillionSend avisa a cópia oculta; confira na staging antes de
  depender disso, e libere o endereço do Cliente se acontecer.
- Cada envio conta dois destinatários no provedor.
