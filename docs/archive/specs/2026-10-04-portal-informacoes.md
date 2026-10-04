# Central de Informações do Portal

Desenho aprovado pelo usuário; execução autorizada em 04/10/2026. O mockup em
`artifacts/portal-informacoes/mockup-portal.html` é referência de experiência,
não código de produção nem origem de valores.

## Resultado e identidade visual

O cliente encontra Taxas Locais, Demurrage, depots, agentes, atendimento e
tracking no Portal, com atalhos nas telas de operação e faturamento. Reutilizar
Card, PageHeader, Button, Field, Select, Badge, cores e tipografia existentes.
Não substituir o shell, copiar o CSS do mockup ou introduzir outra biblioteca.
Taxas de exportação e Detention estão fora do escopo. Exportação permanece
somente como assunto de atendimento.

## Fontes oficiais

Taxas vêm de charge_tables/charge_table_items e demurrage_rates. Selecionar
Taxas Locais pelo mesmo resolver do Vela, cuja vigência é informativa; não
criar outro calendário de aplicação. Free time por operação respeita override
do BL, acordo do cliente na data de descarga e tarifa geral, sem números fixos
quando a tarifa está ausente. Não alterar snapshots de faturas existentes.

Informações dos depots complementam o cadastro depots sem alterar suas regras
de terminal portuário. Relação própria associa depots aos portos de devolução.
Contatos de agentes, atendimento e instruções iniciais vêm das páginas FWLOG
fornecidas pelo usuário. Sua manutenção passa a ocorrer no Vela. Nenhuma
planilha, consulta ao WordPress em runtime ou preço hardcoded no frontend.

## Devolução

Sem indicação específica, disponibilizar todos os depots ativos e publicados
do porto de destino. Uma indicação restringe a lista a um ou mais depots por
container; retirada restaura a regra geral. Indicação existente cujos depots
estejam indisponíveis não libera os demais: mostrar orientação de contato.
SOC não exige devolução. Restrições e instruções de cada depot permanecem
visíveis. Container compartilhado entre BLs da mesma viagem recebe a mesma
indicação; sem viagem, a indicação permanece vinculada ao registro informado.
Alterações exigem justificativa e auditoria interna; motivo não é público.

## Contratos

`portal_get_information()` e `portal_get_return_guidance(p_container_id)` usam
identidade autenticada; pares portal_inspect recebem p_customer_id e aplicam
o guard existente. A leitura de uma unidade verifica cliente e gate do CE.
Novas tabelas não concedem leitura direta ao cliente. Funções internas só
aceitam perfil ativo; Equipamentos e Administrativo mantêm depots/indicações;
Administrativo mantém agentes, atendimento e tracking. Outros perfis internos
podem consultar. Dados públicos retornam allowlist sem notas internas.

`internal_get_portal_information()`, `internal_save_portal_information(p_kind,
p_data)`, `internal_get_return_guidance(p_container_id)` e
`set_container_return_instruction(p_container_id,p_depot_ids,p_reason)` são os
contratos de administração. Lista vazia de depots remove a indicação. URLs
aceitam somente HTTP/HTTPS com host e sem credenciais; demais esquemas são
recusados. Tracking usa URL cadastrada do armador e botão para copiar BL,
sem presumir que o armador aceita preenchimento automático.

## Critérios de aceite

Central e atalhos funcionam em Portal e Modo Inspeção. Cada seção distingue
carregamento, indisponibilidade e ausência de cadastro. Busca de devolução usa
somente os containers visíveis ao cliente. A escrita interna invalida caches
afetados; leitura no Portal é atualizada em foco/reconexão. Testar regra geral,
indicação única/múltipla, retirada, depot despublicado, acesso de outro cliente,
SOC e free time negociado. Validar também links externos, erros de serviço,
renderização mobile e identidade visual. Publicação remota é etapa separada.


> Estado: implementada e validada localmente em 2026-10-04; arquivada. Regras
> vigentes em CONTEXT.md e docs/modules/portal-cliente.md. Produção não publicada.
