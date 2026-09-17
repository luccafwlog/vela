# Editor de escala e planejamento por terminal

## Decisão aprovada

Implementar o modelo visual A validado no protótipo `codex/prototype-escala-modal`, preservando o contexto da viagem e tornando explícitos os efeitos operacionais da escala. O protótipo foi usado para validar a hierarquia da tela; seus componentes descartáveis não serão promovidos para produção.

## Propósito e escopo

Corrigir o fluxo de criação/edição de escalas na aba Visão geral da viagem, com foco em três problemas observados:

1. a criação de uma escala registra o valor padrão `Aguardando` como se fosse alteração de BLs/CEs;
2. o planejamento renderiza uma atracação TBC vazia, sem terminal nem datas;
3. o modal mistura declaração de operação, BLs/CEs, frentes e datas em uma coluna despadronizada.

O escopo inclui a persistência da auditoria, a projeção dos status da escala, a tabela de planejamento e o modal de escala. Não inclui alteração do modelo de BL/CE, criação automática de carga, nem mudança das regras de ADR já existentes.

## Modelo de domínio

### Operação da escala

O usuário escolhe um dos três modos:

- somente importação;
- importação + exportação;
- somente exportação.

Quando exportação estiver ativa, o usuário escolhe uma ou ambas as cargas: granito e embarque de vazios. A seleção continua persistindo `tem_exportacao`, `has_granite`, `has_empty`, quantidades de CNTR/movimentos e portos de descarga. Esses valores têm efeito operacional: habilitam o planejamento de exportação, criam as frentes de exportação correspondentes e alimentam rota, indicadores, Line-Up e ADR. Não são apenas marcadores visuais.

Para embarque de vazios, o modal exibirá `Quantidade de CNTR vazios` e `Movimentos`. Ambos continuam opcionais, com valores nulos quando não informados, mantendo o contrato atual de `containers_qty` e `movements_qty`.

### Frentes operacionais

“Frente” é um termo interno para uma combinação de sentido e tipo de carga que pode receber um terminal. A UI usará rótulos de negócio, por exemplo:

- `Importação · carga cheia`;
- `Importação · carga solta`;
- `Importação · veículos`;
- `Importação · vazios`;
- `Exportação · granito`;
- `Exportação · vazios`.

As frentes de importação são derivadas da expectativa de importação e dos dados existentes de BLs/manifestos. A escala marcada para importação cria a expectativa de `carga cheia`; BLs de carga solta/veículos e manifestos de vazios adicionam seus tipos. As frentes de exportação são derivadas da declaração de exportação e das cargas selecionadas. Frentes persistidas previamente continuam sendo respeitadas para compatibilidade histórica.

Cada frente terá um seletor de terminal próprio. Não haverá mais dois campos genéricos chamados “frente de importação” e “frente de exportação”.

### Status de BLs e CEs

O status exibido na coluna de importação deve vir do status POD quando houver importação. O status de exportação permanece separado para os consumidores que precisam dele e não deve substituir o status POD de uma escala que também tenha importação.

Na criação de uma escala, `Aguardando`/`waiting` é estado padrão implícito. O primeiro salvamento não deve gerar evento de alteração de CE de `NULL` para `waiting`. Uma alteração posterior para `Recebido`, `Lançando`, `Em aprovação` ou `Aprovado`, bem como uma mudança entre estados já persistidos, continua auditável.

## Anatomia das telas

### Planejamento por escala

- Manter a tabela principal com escala, operação, ETA, ATA, ATD derivado, BLs/CEs, número e vínculo.
- Não renderizar a linha secundária de “Atracações” quando todos os estados forem TBC e não houver ETB, ATB, ETD, ATD ou Restow preenchidos.
- Quando existir terminal atribuído ou alguma data de terminal, mostrar uma linha secundária compacta com o código do terminal e suas datas.
- O estado pendente de terminal permanece acessível no modal e pode ser representado na linha principal por um indicador compacto, sem inventar uma atracação vazia.

### Modal de escala

Manter o modal A como um editor único, com corpo rolável e rodapé fixo sem sobreposição:

1. resumo da escala: porto, viagem, operação e estado resumido;
2. chegada ao porto: ETA, ATA e ATD derivado;
3. operação da escala: seleção de modo em opções estruturadas, sem checkbox solto;
4. cargas de exportação: granito/vazios e, quando vazios estiver ativo, quantidades;
5. BLs e CEs: status POD, vínculo e número Mercante;
6. terminais por operação: uma linha por frente, com terminal próprio;
7. datas por terminal: somente para terminais atribuídos ou com dados preenchidos;
8. justificativa: somente quando uma alteração terminalizada existente exigir auditoria;
9. ações fixas: cancelar e salvar.

Todos os campos devem compartilhar altura, raio, tipografia e espaçamento. Grades de duas/três colunas devem colapsar para uma coluna em viewport estreito. O bloco de datas de terminal deve usar o mesmo alinhamento de labels e inputs em todas as linhas.

## Fluxos e invariantes

### Criação sem alteração de BLs/CEs

1. O modal inicializa BLs/CEs com `waiting` para edição.
2. O usuário salva a escala sem tocar no status.
3. A transação salva a escala e seus terminais/frentes.
4. A auditoria não registra `ces: NULL → waiting`.
5. A tabela mostra `Aguardando`, mas a linha do tempo não mostra uma alteração de CE.

### Criação com exportação

1. O usuário escolhe um modo com exportação.
2. Seleciona granito, vazios ou ambos.
3. Se vazios estiver selecionado, pode informar CNTR e movimentos.
4. A projeção mostra as frentes correspondentes, cada uma com terminal próprio.
5. A persistência mantém a declaração de exportação e os dados de planejamento.

### Estado TBC

- TBC sem qualquer data é estado pendente, não atracação visível no planejamento.
- TBC com alguma data preenchida continua visível para não esconder dado operacional.
- Terminal atribuído sem datas aparece como terminal pendente, com campos disponíveis no modal.

## Alterações técnicas previstas

- `src/components/shared/VoyageScheduleModals.tsx`: reorganizar a composição do formulário, substituir checkboxes por seleção de modo/opções de carga, incluir quantidades de vazios e renderizar frentes por operação.
- `src/components/voyages/VoyageVisaoTab.tsx`: filtrar atracações completamente vazias e alinhar a apresentação das linhas secundárias.
- `src/services/voyageRouteSchedules.ts`: impedir que o status de exportação substitua o status POD de uma escala com importação; manter `exportCeStatus` separado.
- `src/index.css`: criar uma variação específica e consistente para o editor de escala, preservando o comportamento geral do componente Modal.
- Nova migration sequencial: ajustar a auditoria do RPC terminalizado para ignorar somente a inicialização implícita `ces NULL → waiting`.
- Testes de serviço, contrato SQL e comportamento do modal para cobrir os fluxos acima.

## Testes e validação

- Teste puro da projeção: status POD tem precedência em escala de importação + exportação.
- Teste puro da projeção: exportação sem importação pode usar o status de exportação.
- Teste de contrato SQL: o RPC não audita `NULL → waiting`, mas audita `waiting → received`.
- Teste de comportamento: selecionar vazios exibe CNTR e movimentos.
- Teste de comportamento: selecionar cada modo mostra as frentes de negócio correspondentes.
- Teste de comportamento: TBC sem datas não renderiza linha de atracação no planejamento.
- Validação manual no viewport desktop e estreito, incluindo rolagem do modal e rodapé fixo.

## Fora de escopo

- Reclassificar dados históricos já gravados como `Recebido`.
- Remover registros antigos de auditoria.
- Alterar a regra de bloqueio de exportação quando houver carga vinculada.
- Alterar o conteúdo ou a autorização dos ADRs.

## Critérios de aceite

- Criar uma escala sem tocar em BLs/CEs não gera evento “Status de CE alterado — Aguardando”.
- A coluna BLs e CEs não mostra `Recebido` em uma escala sem BL por causa de um status de exportação.
- TBC vazio não aparece como uma atracação completa na tabela.
- O modal apresenta campos com dimensões e alinhamentos consistentes.
- O usuário consegue declarar exportação, selecionar vazios e informar quantidade de CNTR/movimentos.
- O usuário entende qual carga cada terminal representa sem precisar conhecer o termo técnico “frente”.
