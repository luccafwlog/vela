# Revisão extensa da Central de Informações — 2026-10-04

Revisão solicitada pelo usuário após a implementação local. Escopo: interface
do cliente e Modo Inspeção, administração interna, serviços/hooks, invalidadores
existentes, fontes de tarifas, SQL/RLS, identidade física da devolução e exclusão.
O diff anterior e o mockup foram preservados; não houve publicação remota.

Foram realizadas três revisões independentes por domínio, reproduções em
PostgreSQL 16 descartável e testes de comportamento. Uma revisão final
independente conferiu as correções. As migrations históricas e os tipos gerados
não foram editados: ajustes de banco estão na nova migration `135` (renumerada para `137` em 2026-10-06).

| Achado | Reprodução / efeito | Correção |
|---|---|---|
| R01 — Indicação segue registro para outra unidade | Trocar viagem ou número mantém indicação anterior; duas linhas da mesma identidade passam a divergir | Indicação única por viagem + número; leitura por identidade atual |
| R02 — Validação só considera o registro selecionado | Outros B/Ls com POD distinto/SOC aceitam propagação; POD nulo aceita indicação que nasce indisponível | Validar todo grupo e POD não nulo; locks ordenados e identidade novamente conferida |
| R03 — Motivo interno ausente em vínculo tardio | Depots específicos aparecem, mas justificativa fica vazia | Justificativa da indicação física comum |
| R04 — Tarifa não normaliza os dois lados | Tarifa legada 40HC mais nova diverge de 40GP, ou é considerada ausente | Resolver por família vigente usado no catálogo, operação e cálculo financeiro para nova emissão |
| R05 — Dependência de viagem fora do catálogo de exclusão | Preview omite indicação e guard bloqueia exclusão antes do CE | Incluir nova tabela no `voyage_delete_children_spec` sem remover travas de CE |
| R06 — Filtro de B/L fica oculto após trocar POD | Container de outro B/L não aparece no novo porto | Limpar BL/container na troca e oferecer retirada explícita do contexto de B/L |
| R07 — Link de tracking selecionado é antigo | Catálogo atualiza, mas atalho conserva URL da operação em cache | Usar URL atual do catálogo por armador; retirada não reutiliza URL antiga |
| R08 — Falha conserva orientação/ação do cache | Erro da operação ainda permite orientação/copiar dados antigos | Ocultar ações antigas e oferecer nova consulta |
| R09 — Assunto de atendimento pode sobrescrever outro | Alterar Geral para Importação sobrescreve contato distinto | Identidade imutável; criação só de assuntos suportados ausentes |
| R10 — Seleção indisponível fica oculta e não removível | Refetch muda specific para unavailable sem mudar timestamp; ID antigo permanece selecionado | Renovar formulário por disponibilidade/POD/status; preservar rascunho em refetch idêntico |
| R11 — Cadastros oficiais não invalidam novas consultas | Alterações de depot, ownership/POD/viagem ou tarifas deixam catálogo/inspeção antigos | Invalidação nos donos da escrita; refresh em foco/reconexão nas leituras |
| R12 — Falta validação obrigatória de portos | Agente sem portos ou depot publicado sem porto só recebe erro genérico SQL | Validação local específica e texto obrigatório sem espaços vazios |
| R13 — Operação vazia em tracking sem mensagem | Dropdown vazio parece funcional | Estado explícito sem B/L visível |
| R14 — Consulta de devolução carrega todos os cadastros | Agrega tarifas, contatos e agentes para descartar tudo exceto depots | Query de depots e indicação independente desses cadastros |
| R15 — Banco aceita links com host/porta inválidos | API armazena `https://:443`, porta não numérica/fora da faixa e hosts numéricos inválidos; interface descarta o link | Validação compartilhada no banco e CHECKs nos três cadastros; regressão executada antes e depois |

## Validação

As regressões de interface/cache e de banco foram observadas antes das correções.
O banco usa shims de Auth/Storage/cron e JWTs de fixture; isso testa execução SQL,
RLS/ACL e escopo, mas não autenticação remota ou o Supabase em produção.
Capturas anteriores usam componentes reais com dados ilustrativos; não são
prova de login ou persistência remota.

- Suíte geral: **694 arquivos e 3.909 testes aprovados**; 52 arquivos/318 testes condicionais ignorados. Execução com quatro workers, timeout de 15 s e uma repetição permitida.
- Integração PostgreSQL 16: **33 testes aprovados** nas suítes de informações e paridade de inspeção. Inclui vínculo do cliente, acesso direto, ausência de usuário, conta/cliente inativos e sessões revogadas ou com `iat` inválido.
- Build de produção (inclui TypeScript), lint e verificação documental aprovados.
- Verificação de migrations aprovada: 133 arquivos; avisos históricos de operações destrutivas permanecem catalogados. Replay integral em banco novo e catálogo das 203 RPCs de produção também aprovados.
- Revisão independente final das correções concluída; não identificou outro achado acionável no escopo examinado.

As validações de identidade e locks foram conferidas no SQL; não houve ensaio de carga ou execução concorrente de sessões. Nenhuma ação remota ou envio de mensagem foi realizado.
