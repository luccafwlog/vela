# 0045 — Inspeção do Portal por núcleo compartilhado e invólucro interno

> **Situação atual (2026-10-14).** A Inspeção do Portal vale como decidida e está implementada, salvo o histórico de eventos para Operações (abaixo). A [ADR 0083](./0083-decisoes-da-revisao-geral-da-documentacao.md) (item 18) confirma esta decisão: Operações vê o console completo, porque a leitura interna é global. Correção pendente no [plano de correções](../plans/2026-10-14-correcoes-decididas-na-revisao-geral.md): o console de provisionamento ainda mascara para Operações os campos que esta ADR mandou abrir (`portal_list_provisioning_console` com `v_full_access` sem `operacoes`, migration `103`; a regressão veio da migration arquivada `325`).
> Pela [ADR 0085](./0085-modelo-de-permissoes-por-perfil.md) (item D12), não vale mais que o histórico de eventos (`portal_list_provisioning_events`) fique fora do alcance de Operações: Operações vê o Histórico, como o resto do console. Correção pendente no [plano do modelo de permissões](../plans/2026-10-14-modelo-de-permissoes-por-perfil.md).
> Regra vigente em [Portal do Cliente](../modules/portal-cliente.md), seção "Inspeção do Portal", e em [Segurança](../operations/seguranca.md), seção "Modelo de permissões por perfil".

Status: supersedida parcialmente — 2026-08-13; o histórico para Operações mudou pela ADR 0085 em 2026-10-14

## Contexto

Atendimento precisa verificar o que um Cliente vê no Portal sem entrar na conta
do cliente, sem criar sessão de Portal para o usuário interno e sem permitir
ações em nome dele. A fidelidade deve vir da mesma lógica de leitura, não de
duas telas mantidas em paralelo.

O usuário interno ativo já possui leitura global conforme a ADR 0044. A
Inspeção acrescenta uma projeção na linguagem do Portal e expõe, como o cliente
vê, `customer_portal_accounts.contact_email`. Isso é uma ampliação real da
superfície de leitura e fica explícito nesta decisão.

## Decisão

Adotamos a **Inspeção do Portal**, permanente e somente leitura, na rota interna
`/clientes/portal/inspecao/:customerId/*`. O acesso usa
`is_active_read_user()`, preserva a identidade interna e registra a abertura em
`portal_inspection_events`. Não há login como cliente nem conta de Portal para
uso interno.

Cada leitura escopada por Cliente possui um núcleo privado parametrizado por
`customer_id`. A RPC normal mantém sua assinatura e resolve a identidade por
`current_portal_customer_id()`; a RPC `portal_inspect_*` recebe o Cliente e
passa pelo guard interno. Os dois invólucros delegam ao mesmo núcleo. Núcleos
não têm grant externo; invólucros de inspeção revogam `PUBLIC` e `anon` e
concedem execução somente a `authenticated`. O guard e `portal_open_inspection`
seguem a mesma regra.

`portal_get_session_overview_v2` é exceção deliberada: atualiza
`last_login_at`, portanto não pode ser parametrizada sem registrar um login
falso do cliente. `portal_open_inspection` fornece o overview equivalente sem
essa escrita. `portal_ship_schedule` permanece leitura direta porque não é
escopada por Cliente.

O frontend injeta um `PortalScope` com modo, Cliente, overview e `basePath`.
`PortalLayout`, dashboard, billing, operação, perfil e sino são os mesmos nos
dois modos; todos os destinos usam o `basePath`, mantendo a inspeção nas
sub-rotas internas. Uma faixa persistente identifica o Cliente, a situação da
conta quando necessário e oferece saída da inspeção.

As ações de escrita do cliente permanecem visíveis para preservar fidelidade,
mas ficam desabilitadas no modo inspeção. O cliente de chamadas também recusa
qualquer RPC de escrita nesse modo, evitando escrita cruzada se houver sessão de
Portal residual na aba. Nenhuma RPC `portal_inspect_*` é criada para escritas.

O console de provisionamento passa a ser descobrível por Equipamentos e a
mostrar seu histórico sem acionar o self-heal gravável. Operações, que já
acessava o console com os campos sensíveis mascarados, passa a ver os mesmos
campos completos que os demais perfis leitores — sem essa mudança seria o
único perfil restante com `v_full_access = false`, contrariando a mesma linha
da ADR 0044 aplicada a Equipamentos aqui. A edição continua sujeita às
permissões existentes; o histórico de eventos (`portal_list_provisioning_events`)
permanece fora do alcance de Operações, que já o mantém desabilitado na tela.

## Consequências

- A paridade cliente/inspeção é estrutural: divergência exige alterar o núcleo
  compartilhado. Um teste de contrato SQL verifica a delegação; a igualdade de
  resultados fica como validação de integração sob demanda.
- A inspeção alcança Clientes com conta pendente ou desativada, e a faixa deixa
  essa situação evidente.
- A auditoria registra o uso pela ferramenta, não cada chamada direta à API.
  Um usuário interno ativo que chamar uma RPC diretamente pode consultar sem
  gerar evento; esse limite é aceito e fica registrado para futura evolução.
- O cliente não é informado da existência da inspeção por ora. Essa dívida de
  transparência permanece aberta.
- A exceção de `contact_email` e a ampliação do console para Equipamentos são
  superfícies adicionais de leitura deliberadamente documentadas.

## Relações

Estende a [ADR 0044](./0044-leitura-interna-global-departamento-restringe-escrita.md)
quanto à leitura interna e preserva as regras de autenticação da
[ADR 0013](./0013-portal-auth-identificador-resolvido-e-excecao-anon.md).

## Nota editorial — S11 (2026-09-07)

`portal_list_disputes()` era a única leitura fora do padrão (sem núcleo nem
invólucro de inspeção; falha `PGRST202` na aba de faturamento da Inspeção). A
migration `013_portal_disputes_inspection.sql` extraiu
`_portal_list_disputes_core(bigint)` e criou os dois invólucros, sem alterar a
decisão acima. Paridade provada em
`src/integration/portalInspectionParity.local-pg.test.ts`.
