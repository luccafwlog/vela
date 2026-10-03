# Compatibilidade da PR 841 com as PRs 839 e 840

Revisão do head original `bce96266` contra `main` em `d2f794bb`, que contém
as PRs 839 e 840. A publicação e o CI finais são registrados na
[PR 841](https://github.com/luccafwlog/vela/pull/841).

## Conflito resolvido

Não havia conflitos textuais. Havia duas versões de migration duplicadas:
`122` e `123`, já ocupadas pelo faturamento da 839. Somar os arquivos não
resolve a colisão no histórico aplicado pelo Supabase.

A branch recebe a `main` atual; somente as migrations novas da 841 passam a
`131_recovery_authority_and_notification_activity.sql` e
`132_portal_revocation_effective_time.sql`, sem alteração de seu SQL.
A documentação de segurança usa os novos números. O teste
`migrationVersions.test.ts` verifica a unicidade das versões do diretório
ativo, sem incluir migrations arquivadas pelo mock histórico do Vitest.

As migrations mergeadas, conciliação Pix, contratos financeiros e efeitos de
cache das PRs 839 e 840 são preservados. O workflow mantém as suítes financeiras
e acrescenta a suíte de recuperação e notificações.

## Revisão de comportamento e segurança

Foram lidos os 14 arquivos próprios da 841 e os proprietários de sessão,
revogação, cliente de banco e policies necessários para avaliar a combinação.
Os limites de confiança são: navegador com token opaco de uso único,
Edge Function com `service_role`, RPC autorizada e Auth externo à transação SQL.

- Reset aceita somente convite pendente, válido, destinado ao email vigente e
  conta ativa; o lock da conta coordena reset e confirmação de email.
- As três RPCs novas são exclusivas de `service_role`. `PUBLIC`, `anon` e
  `authenticated` não recebem execução direta.
- Confirmação cancela a autoridade de recuperação antiga e revoga sessões na
  mesma transação. Reset em andamento mantém a troca pendente com HTTP 423.
- Notificações exigem destinatário correto e perfil interno ativo, inclusive
  no acesso direto com um JWT ainda válido após desativação.
- Falha ambígua no Auth preserva o marcador de reset para triagem, conforme a
  decisão já documentada na PR original; não foi adicionado desbloqueio por tempo.

Não surgiu decisão de negócio nova necessária à compatibilização. A revisão
usa leitura manual e testes; a infraestrutura e os recursos auxiliares do scan
formal de segurança não estavam disponíveis nesta sessão, portanto não foi
produzido relatório formal/SARIF desse mecanismo.

## Evidência e limites

Replay limpo de 130 migrations em PostgreSQL 16 descartável e asserções de
squash/roteamento de comunicados passaram. O catálogo local resolve 201 RPCs.
Uma reprodução com duas conexões confirmou a espera pelo lock, a recusa de JWT
emitido durante a espera (SQLSTATE 28000) e a remoção de sessões/refresh tokens.

As 39 suítes SQL passaram isoladamente com 206 testes, e a suíte geral teve
3.828 testes aprovados e 291 ignorados pelas condições do ambiente. Os 47 testes
focados de tela, helpers e cache passaram, assim como o teste adicional de
unicidade de migration. O resultado de CI do commit publicado está na PR.
Dois testes SQL atingiram o timeout quando executados junto da suíte geral e
do build; a repetição isolada passou, sem ampliar o timeout.
O banco local usa shims de Auth/Storage/Vault, e as telas usam jsdom: isso não
comprova fluxo real de GoTrue, envio de email ou navegador autenticado.

Publicar migrations 131 e 132 antes de `portal-password-reset` e
`portal-recovery-email-change`. Uma Preview que já aplicou a antiga numeração
122/123 da 841 precisa ter seu histórico e schema reconstruídos antes de servir
como evidência da nova combinação; não confundir esse estado com produção.
