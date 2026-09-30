# Preparação do acesso à API Recebimentos Pix do Itaú

**Estado:** saída mTLS comprovada; consulta periódica escolhida; acesso Itaú pendente.
**Atualizado em:** 2026-09-30.

## Objetivo e limite

Preparar o acesso bancário do Vela, com etapas e evidências atualizadas conforme
o Itaú fornecer os materiais. As regras comerciais de Taxas Locais e Demurrage
não bloqueiam essa preparação; precisam ser definidas antes de ativar seus
respectivos comportamentos. A [spec de cobrança](../spec/2026-08-25-integracao-itau-pix.md)
continua separada deste plano.

O trabalho atual documenta a preparação. O dono autorizou uma prova temporária
no Supabase produtivo, executada e removida conforme registrado abaixo, e testes
no sandbox Itaú. Não houve uso de credenciais produtivas Itaú, emissão real de
cobranças, cadastro de webhook ou alteração DNS. Essas ações dependem de
autorização para o alvo e efeito concretos.

## Fontes disponíveis

- Pasta local: `C:\Users\Lucca\Downloads\Integração ITAÚ`.
  Não versionar e-mails, anexos ou credenciais.
- E-mail de boas-vindas da empresa, de 2026-07-07, protocolo IT-000205325:
  informa credenciais produtivas e token temporário de ativação de 7 dias.
- `Boas Vindas -  Obter Certificado e Solicitar Access Token.eml`:
  procedimento de CSR, certificado/client_secret e access_token.
- `Boas Vindas  - Webhook PIX Recebimentos QrCode.eml`:
  callback mTLS, cadeia pública e sufixo `/pix`.
- OpenAPI `itau_ep9_api_regulatorio_pix_v2_externo_c9cac62ac3.json` e
  collection `itau_ep9_api_regulatorio_pix_v2_externo_c9cac62ac3-2_27.2-collection.json`:
  versão 2.27.2. A coleção antiga do fornecedor não é base de decisão.
- [API Recebimentos Pix](https://devportal.itau.com.br/nossas-apis/itau-ep9-api-regulatorio-pix-v2-externo),
  [autenticação](https://devportal.itau.com.br/autenticacao-documentacao) e
  [sandbox](https://devportal.itau.com.br/sandbox-como-comecar), consultados na
  sessão autenticada em 2026-09-30.

**Evidência documental:** procedimento conhecido, ativação atual não comprovada.
O prazo original do token de julho passou; não se tentou utilizá-lo. Existência
O dono confirmou abaixo que certificado/client_secret ainda não foram gerados. A planilha com
token legado não deve ser usada como fonte de credenciais; se ativo, avaliar
revogação com o dono. Nenhum valor sensível entra neste documento.

**Atualização do dono em 2026-09-30:** certificado e client_secret ainda não
foram gerados. Próxima dependência: material de ativação vigente, pois o prazo
de 7 dias informado no e-mail de julho passou. O dono obtém a renovação pelo
canal oficial Itaú; não enviar valores na conversa. Não houve tentativa de
usar o token antigo. Depois, definir custódia, gerar chave/CSR com identidade
confirmada e executar a ativação específica autorizada.

## Cinco etapas de acesso

| Etapa | Disponível | Pendente | Prova para concluir |
|---|---|---|---|
| 1. Material de ativação | Fluxo de client_id e token temporário nos e-mails | Dono confirmar certificado existente ou obter token vigente no canal Itaú já utilizado | Data, validade, ambiente e responsável registrados sem valores |
| 2. Chave privada e CSR | Procedimento do fornecedor | Definir custódia e gerar CSR com identidade confirmada pelo dono | CSR inspecionado e correspondência com chave verificada localmente |
| 3. Certificado e client_secret | Procedimento de envio do CSR e retorno | Ativação autorizada com material vigente | Cadeia, prazo e correspondência com chave verificados; segredo no destino aprovado |
| 4. OAuth e consumo da API | client_credentials com mTLS; access_token de 300 segundos | Validar runtime, cabeçalhos, escopos, armazenamento e renovação | Token obtido e consulta autorizada concluída no ambiente identificado; renovação testada |
| 5. Consulta periódica | GET `/pix` na OpenAPI 2.27.2; decisão do dono em 2026-09-30 | Validar escopos, limites, paginação, janela e agendamento | Consulta autorizada, retomada após falha e deduplicação comprovadas; job observado no alvo |

Dono do Vela: materiais, conta e ações junto ao Itaú. Equipe técnica:
preparação, configuração e evidências. Uma etapa só muda para concluída com
data, ambiente, cenário e resultado. Aplicar os labels de
[evidência](../CONVENCOES.md#labels-de-evidência): Código, Teste, Runtime e Suspeita.

## Preparação técnica antes do token

Os itens de entrada/callback abaixo são a avaliação original e ficam adiados
pela decisão de consulta periódica. A prova de saída está concluída; custódia,
CSR, ativação e configuração permanente continuam pendentes.

1. Conferir inventário de certificados existente sem expor segredos.
2. Verificar suporte mTLS de saída no runtime **hospedado** de Supabase Edge
   Functions. Uma API Deno disponível localmente não comprova suporte hospedado.
3. Verificar terminação mTLS de entrada para o webhook. Cloudflare Pages
   hospeda os SPAs; isso não comprova que atende esse receptor. Se necessário,
   comparar gateway/backend mínimo, custo e operação antes de escolher ou publicar.
4. Definir custódia após escolher o runtime. Registrar nomes e locais de
   segredos por ambiente no manual de serviços externos, nunca seus valores.
   Nenhum segredo Itaú foi criado ou aprovado nesta etapa.
5. Preparar procedimento de CSR e ativação com TLS validado. Não copiar
   `curl -k` dos e-mails antigos; preservar quebras de linha PEM e verificar
   cadeia e correspondência da chave. Ativação será ação explícita do dono.
6. Preparar obtenção/renovação de token baseada em `expires_in`, margem antes
   da expiração e recuperação limitada de falhas; acompanhar validade e rotação
   do certificado separadamente. Não repetir escritas financeiras automaticamente
   sem contrato de idempotência. Logs nunca contêm segredos ou tokens.
7. Preparar callback que autentica, persiste de forma durável e responde em
   até 5 segundos; confirmar recebimento somente após persistência. Processamento
   financeiro posterior pertence ao plano de cobrança.

Fronteira prevista: backend autorizado → OAuth/mTLS → Itaú; Itaú → receptor
mTLS → persistência durável → processamento posterior. Navegadores do Vela e
Portal não recebem segredos bancários. IP allowlist não substitui mTLS.

## Avaliação de infraestrutura mTLS

Consulta documental e de código em 2026-09-30, seguida da prova hospedada abaixo.

| Caminho | Evidência | Decisão / limite |
|---|---|---|
| Saída por Supabase Edge Functions | Código público e prova hospedada com certificado público de teste | Caminho comprovado para saída mTLS; compatibilidade específica com Itaú ainda pendente |
| Entrada por Cloudflare Access | A documentação permite CA externa e política Service Auth com certificado válido; exige Zero Trust pay-as-you-go ou Enterprise | Candidata gerenciada; o Free registrado no manual não cobre esse recurso. Confirmar plano real, custo e proteção do receptor antes de escolher |
| Entrada por Cloudflare API Shield com CA Itaú | BYOCA exige Enterprise | Alternativa dependente de contratação; não é requisito para seguir com a preparação |
| Backend com terminação TLS própria | HTTPS/TLS nativo permite validar certificados clientes | Alternativa se as plataformas existentes não atenderem; acrescenta hospedagem, atualizações e operação. Não provisionado |

Fontes: código Supabase fixado no commit
[`57459345bdd5401dfd6a7c87339857cf5c0da6a2`](https://github.com/supabase/edge-runtime/blob/57459345bdd5401dfd6a7c87339857cf5c0da6a2/ext/runtime/js/denoOverrides.js)
e [cliente HTTP](https://github.com/supabase/edge-runtime/blob/57459345bdd5401dfd6a7c87339857cf5c0da6a2/vendor/deno_fetch/22_http_client.js);
[Access mTLS](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/),
[BYOCA](https://developers.cloudflare.com/ssl/client-certificates/byo-ca/) e
[HTTPS nativo](https://nodejs.org/api/https.html).
Essas fontes comprovam mecanismos disponíveis, não a configuração do Vela.

Próxima prova, antes de usar material bancário: em ambiente de teste controlado,
usar CA e certificados sintéticos para validar saída com certificado cliente,
recusa sem certificado e recusa com CA incorreta. Registrar versão do runtime,
ambiente e resultado. Para entrada, verificar a cadeia aceita e garantir que o
receptor não possa ser acessado contornando o gateway: autenticar o encaminhamento
por mecanismo próprio, remover cabeçalhos de identidade fornecidos pelo chamador
e recusar chamadas diretas. Simular falha de persistência, duplicatas e resposta
em até 5 segundos. Teste sintético não comprova compatibilidade final com Itaú.

O desenho permanece aberto até essas provas e a escolha do custo/operador.
Não criar serviço novo nem contratar plano somente para antecipar essa decisão.

### Ambiente para a prova hospedada

Inventário consultado pela CLI Supabase 2.109.1 em 2026-09-30:
`Vela` (`fgmkhbzhaeebrsizwccx`) é o projeto produtivo identificado no
WORKFLOW. A listagem de branches retornou somente `main`, apontando para esse
mesmo projeto; nenhuma Preview isolada estava disponível. O outro projeto
acessível, `Demurrage Manager`, não foi confirmado como descartável e não foi
utilizado. Docker, Deno e OpenSSL não foram encontrados no PATH desta sessão.

Antes de executar a prova, o dono precisa indicar um projeto de teste existente
ou autorizar criar uma Preview isolada, com eventual custo. Não publicar a
função de diagnóstico em `main`. A prova precisa de um servidor TLS controlado
e alcançável pelo runtime hospedado; sua hospedagem também precisa ser definida.
O teste usará somente certificados de teste, endpoint fixo, acesso restrito,
timeout e resultados sem PEM/chaves. Ao terminar, remover função, certificados
e receptor temporários. O inventário acima precede a autorização e execução abaixo.

### Resultado da prova de saída — 2026-09-30

O dono autorizou usar produção para esta prova, dispensando a Preview.
Foi publicada somente a função temporária `vela-mtls-proof-20260930`, sem
alterar tabelas, registros, funções existentes ou credenciais bancárias.
Em vez de provisionar receptor próprio, usou-se o servidor público
`client.badssl.com` e o certificado/chave públicos de teste disponíveis no
[badssl](https://badssl.com/download/). Esse material não foi gerado pelo Vela
nem fornecido pelo Itaú; não serve para autenticação bancária.

**Runtime observado:** `supabase-edge-runtime-1.76.0`, compatível com Deno
v2.1.4, projeto `fgmkhbzhaeebrsizwccx`. Cliente `Deno.createHttpClient({cert,
key})`, verificação TLS ativa, destinos fixos e timeout de 10 segundos por chamada.
Função sem verificação JWT da plataforma, protegida por token aleatório
temporário próprio; chamada sem esse token retornou 403.

| Cenário | Resultado observado |
|---|---|
| Servidor mTLS sem certificado cliente | HTTP 400 |
| Mesmo servidor com certificado cliente de teste | HTTP 200 |
| Servidor self-signed, com validação TLS ativa | Conexão recusada: `UnknownIssuer` |
| Função removida após prova | CLI confirmou exclusão; chamada retornou HTTP 404 |

**Evidência Runtime:** saída mTLS funciona neste runtime hospedado. Não comprova
STS, escopos, cadeia/certificado Itaú, webhook de entrada, nem recusa de um
certificado cliente assinado por CA incorreta (cenário não executado).
Nenhum segredo Supabase foi enviado ao badssl. Material local temporário
removido após execução; somente resultados e procedimento permanecem aqui.

## Consulta periódica escolhida — 2026-09-30

O dono escolheu consultar os recebimentos pelo Supabase para evitar nova
contratação agora. Não habilitar Access pago, Worker, DNS ou webhook para esta
fase. Isso evita uma nova assinatura; consumo Supabase e condições/tarifas
Itaú continuam sujeitos aos respectivos contratos, sem promessa de custo zero.

Fluxo previsto: agendamento Supabase → Edge Function → OAuth/mTLS → GET `/pix`
→ persistência de recebimentos → conciliação posterior. A OpenAPI Itaú 2.27.2
local prevê GET `/pix` e consulta GET `/cob/{txid}`; permissões reais ainda não
foram exercitadas. O intervalo de 5 minutos é exemplo, não decisão final:
confirmar limites, atraso aceitável e janela suportada antes de ativar o job.

**Conferência no portal autenticado, 2026-09-30:** a visão geral da API 2.27.2
descreve consultas individuais e por lista como mecanismos de conciliação,
inclusive listagem de transações de um período. Apresenta webhook para quem
precisa de confirmação imediata; a seção
[restrições de uso](https://devportal.itau.com.br/nossas-apis/itau-ep9-api-regulatorio-pix-v2-externo#heading-3)
não exige webhook para consultar. Exige habilitação no portal e certificado
dinâmico ativado para todas as APIs e limita consultas regulatórias a até
2 anos retroativos. Os requisitos de callback mTLS e resposta em 5 segundos
se aplicam ao webhook. Não há nessa seção um limite numérico de frequência;
ela sustenta o caminho por consultas, mas não confirma um intervalo de 5 minutos
nem chamadas ilimitadas. Não confundir retenção consultável de 2 anos com
tamanho máximo de uma janela de requisição.

Requisitos para o plano de implementação:

**Contrato local inspecionado em 2026-09-30:** GET `/pix` referencia `inicio`
e `fim` obrigatórios em RFC3339 e também marca `txid` como obrigatório (26 a
35 caracteres alfanuméricos). Validar se a implementação exige esse filtro;
não assumir consulta global por período. Se confirmado, o desenho deve
consultar os TXIDs das cobranças acompanhadas, com avaliação do volume de
chamadas antes de fixar frequência. Paginação: `paginacao.paginaAtual` tem
default 0 e `paginacao.itensPorPagina`, default 100; teto não informado nesses
parâmetros. Filtros opcionais incluem `txIdPresente`, `devolucaoPresente`, CPF
e CNPJ. Não usar dados pessoais desnecessários como filtros de conciliação.

- Consultar por períodos e percorrer todas as páginas; guardar progresso somente
  após persistência bem-sucedida. Sobrepor uma janela entre consultas e prever
  revisão de períodos anteriores para capturar disponibilização tardia.
- Deduplicar recebimentos pelo identificador bancário `endToEndId`; associar por
  TXID e validar valor, conta e cobrança antes de qualquer quitação. As regras
  pendentes de cobrança continuam necessárias para conciliação financeira.
- Impedir execuções sobrepostas, limitar retentativas com espera e retomar após
  indisponibilidade. Monitorar última consulta concluída e atraso acumulado;
  nenhuma resposta vazia ou falha de API deve ser tratada como pagamento.
- Provar paginação, duplicatas, falha entre páginas, reinício, token expirado,
  limites de chamadas e pagamento disponível com atraso. O sandbox mockado não
  comprova esses comportamentos persistentes.

Próximo passo de acesso: obter material de ativação vigente e definir custódia
no backend. O dono confirmou que certificado/client_secret ainda não foram
gerados. A autorização de testes no Supabase não autoriza usar credenciais
produtivas Itaú. Não existe job de consulta implantado nesta preparação.

## Receptor webhook — alternativa futura, fora da fase atual

**Alternativa não escolhida para esta fase:** Cloudflare Access com mTLS → Worker
mínimo → Edge Function Supabase → persistência durável. Reutiliza Cloudflare
e Supabase; não exige um servidor próprio. É um desenho documental, ainda não
configurado ou comprovado com o Itaú.

1. Host dedicado proposto: `pix-webhook.vela.app.br`, separado dos SPAs.
   Cadastrar no Itaú a URL base somente depois da validação; o caminho final
   recebe o sufixo `/pix` acrescentado pelo banco.
2. Access no host inteiro, ação **Service Auth**, certificado válido na cadeia
   Itaú vigente. Sem login interativo, Bypass ou token Cloudflare exigido do
   Itaú. Restringir identidade adicional quando documentada pelo banco; não
   inventar um Common Name nem confiar em qualquer CA pública genérica.
3. Worker aceita somente POST no caminho previsto, limita tamanho, usa destino
   Supabase fixo e não segue redirects. Desabilitar `workers.dev` e URLs de
   preview que permitiriam contornar Access; provar a ordem Access → Worker.
4. Worker reconstrói os cabeçalhos de saída e acrescenta autenticação interna
   própria. Proposta de nome: `ITAU_WEBHOOK_FORWARD_SECRET`, mesmo valor nos
   secrets do Worker e da Edge Function, sem chave `service_role` no Worker.
   Nenhum segredo foi criado. Supabase recusa acesso direto sem esse segredo;
   não aceita cabeçalhos de certificado enviados pelo chamador como prova.
5. Supabase valida formato, registra a notificação com deduplicação e confirma
   somente após persistir. Worker devolve a confirmação após esse resultado,
   dentro de 5 segundos; falha de persistência não recebe sucesso. Conciliação
   ocorre depois e valida os dados bancários; o recebimento sozinho não quita
   fatura. Retentativas do Itaú ainda precisam de confirmação.

Fontes: [Access mTLS / Service Auth](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/)
e [desativação de workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).
O recurso Access mTLS exige Zero Trust pago ou Enterprise; o plano Free
registrado no manual não basta. A autorização anterior de recursos temporários
de teste não foi tratada como contratação permanente ou cadastro bancário.

**Prova de entrada a executar:** certificado de teste confiável aceito; ausente
ou assinado por outra CA recusado; header forjado e chamada direta ao Supabase
recusados; URLs alternativas inacessíveis; duplicata sem efeito repetido;
falha de persistência sem confirmação; latência total até 5 segundos.
Depois, repetir com cadeia vigente e entrega real do Itaú autorizada.

Retomar essa alternativa somente se a necessidade de notificação imediata
justificar a infraestrutura adicional; não enfraquecer mTLS para caber no Free.

## Contratos conhecidos e lacunas

| Tema | Documentado | Falta validar |
|---|---|---|
| Ativação | CSR para obter certificado/client_secret; certificado de 1 ano | Material vigente e procedimento aplicável à conta |
| OAuth | `https://sts.itau.com.br/api/oauth/token`, client_credentials e mTLS | Cabeçalhos e escopos da conta: OpenAPI usa `auth`; guia sandbox usa `Authorization` |
| API atual | `https://pix-pj.api.itau.com/regulatorio-pix/v2` na API reference | Divergência com hostname abreviado na visão geral |
| Sandbox | OAuth 200 e consultas GET /pix executadas; resultados abaixo | Mock não comprova filtros, paginação ou comportamento produtivo |
| Callback | Itaú acrescenta `/pix`; resposta em até 5 segundos | Runtime/domínio, cadeia efetiva, retentativas e entrega |
| CA pública | ZIP em `C:\Users\Lucca\Downloads\ca_cert_952123c440.zip`, com `ca-cert` e `CARoot (1).crt` | Inspeção de identidade/validade e instalação no receptor |

Sandbox valida formatos e respostas; não comprova alteração persistida da
mesma cobrança, expiração, reativação, pagamento ou entrega de webhook.
Não presumir disponibilidade de homologação com estado para esta conta.

## Registro de progresso

### Sequência COB no sandbox — 2026-09-30

Executada com OAuth sandbox e `Authorization: Bearer`, no sandbox path
confirmado anteriormente. Todas as chamadas usaram o TXID sintético
`VelaSandbox20260930TesteCob001`; chave Pix exclusivamente do exemplo público
da documentação, sem emissão ou pagamento produtivo.

| Chamada | Entrada | Resultado Runtime sandbox |
|---|---|---|
| PUT /cob/{txid} | Valor 100.00, expiração 3600 segundos | 201, retorno com valor/expiração enviados e revisão 0, mas TXID diferente do solicitado |
| GET /cob/{txid} | Mesmo TXID da requisição | 200, outro TXID de exemplo, valor 100.00, expiração 86400 e criação em 2025 |
| GET /cob/{txid}/qrcode | Mesmo TXID da requisição | 500, erro virtual do sandbox (`api-hom.itau`); endpoint não validado com sucesso |
| PATCH /cob/{txid} | Valor 125.00 e expiração 7200 na mesma requisição | 200, valor/expiração enviados e revisão 1; TXID do retorno igual ao retornado pelo PUT, diferente do solicitado |
| GET /cob/{txid} após PATCH | Mesmo TXID da requisição | 200, mesmo exemplo anterior ao PATCH: 100.00, 86400 segundos e revisão 0 |

PUT e PATCH retornaram também `pixCopiaECola`, mas não houve leitura do QR por
aplicativo pagador ou teste da location. A criação do retorno PATCH mudou em
relação ao PUT; não inferir alteração da origem de contagem da expiração no
ambiente real. Esses testes comprovam respostas de contrato do mock, não
identidade/persistência da COB, revisão real, pagamento ou comportamento de
expiração. O 500 é observado no sandbox, sem atribuir falha ao ambiente produtivo.

### Consultas sandbox executadas — 2026-09-30

URL confirmada na API reference autenticada:
`https://sandbox.devportal.itau.com.br/itau-ep9-api-regulatorio-pix-v2-externo/v2`.
OAuth sandbox renovado para a execução; GET `/pix` usou
`Authorization: Bearer` e TLS validado, sem certificado de produção.

| Cenário | Resultado Runtime sandbox |
|---|---|
| Período 2026-09-29T00:00:00Z a 2026-09-30T00:00:00Z, sem TXID | HTTP 200, `parametros` e `pix`, 5 itens de exemplo |
| Mesmo período, página 1 com 1 item por página | HTTP 200, mas retorno manteve página 0, tamanho 100 e os mesmos 5 itens |
| Datas `invalido` | HTTP 400, `PixConsultaInvalida`, violações de `inicio` e `fim` |
| Consulta sem token | HTTP 401 |

O mock retornou horários de 2020 apesar do período de 2026 e declarou total
de 2 itens para uma lista com 5. Logo, não comprova filtragem, paginação ou
consistência de totais reais. A aceitação sem TXID afasta a exigência no
sandbox, mas não resolve a inconsistência de path na OpenAPI para produção.
Auth via `Authorization` comprovada somente no sandbox; não generalizar para
o header `auth` documentado na API produtiva. Testes não alteraram Vela ou
dados bancários e nenhum token/credencial foi versionado.

**Registro anterior à consulta acima:** após o dono fornecer credenciais identificadas para
sandbox, POST `/api/oauth/jwt` no host sandbox retornou HTTP 200, token Bearer
e `expires_in=300`. Credenciais e token não foram gravados no repositório.
O User-Agent com acento exportado pela collection foi recusado localmente
pelo cliente HTTP antes do envio; usado User-Agent ASCII no teste concluído.
Consulta GET `/pix` ainda não executada: a collection exporta `baseUrl` com
placeholder, inclusive em Requests Sandbox, e requer confirmar a rota real
no console. Não inferir endpoint produtivo para usar credenciais sandbox.
Além disso, o TXID aparece como variável de path na collection, embora a rota
seja `/pix` sem essa variável: inconsistência documental a validar, não prova
de que consultas globais sejam proibidas.

**Registro anterior — preparação da execução:** a collection 2.27.2 orienta gerar
credenciais sandbox uma vez por usuário no bloco de credenciais da API
reference e gerar token válido por 5 minutos. Token também pode ser obtido
por POST `https://sandbox.devportal.itau.com.br/api/oauth/jwt`, formulário
`grant_type=client_credentials`, `client_id` e `client_secret` de sandbox.
Sem certificado para esse ambiente. As credenciais na collection são
placeholders, não credenciais utilizáveis. O `baseUrl` exportado contém
placeholder de ambiente; confirmar a URL efetiva no console antes de chamar.

Nesta tentativa, duas leituras da aba autenticada falharam por timeout;
o guia público retornou somente a navegação, sem o console autenticado.
Nenhuma requisição sandbox foi executada, nem credencial gerada. Próximo passo:
restabelecer a aba e obter credenciais exclusivamente de sandbox pelo fluxo
do portal. Não reutilizar material de produção ou token legado. Testar consulta
com e sem TXID, paginação e parâmetros inválidos; respostas mockadas não
comprovam exigências nem paginação do ambiente produtivo.

Após cada contato ou execução, acrescentar uma linha e atualizar a etapa.
Registrar e-mails por nome/data, materiais sensíveis somente por metadados
e local seguro. Não anexar respostas OAuth, chaves ou dumps privados.

| Data | Origem / ambiente | Ação ou material | Resultado / evidência | Próximo passo |
|---|---|---|---|---|
| 2026-09-30 | E-mails locais e portal autenticado | Conferência do onboarding e guias; download da CA pública | Evidência documental; nenhum acesso produtivo executado | Validar runtime mTLS de saída e receptor de entrada |
| 2026-09-30 | Código público Supabase e documentação Cloudflare | Avaliação dos caminhos mTLS | Código: cliente TLS exposto; documentação: Access pago ou BYOCA Enterprise. Runtime do Vela não comprovado | Prova sintética hospedada e escolha do receptor/custo |
| 2026-09-30 | CLI Supabase autenticada, somente leitura | Listagem de projetos e branches do Vela | Runtime: inventário retornou somente main no Vela; sem Preview isolada disponível | Dono indicar ambiente descartável ou autorizar sua criação e receptor de teste |
| 2026-09-30 | Supabase Vela, produção autorizada pelo dono | Prova temporária de saída mTLS contra badssl | Runtime: sem cliente 400, com cliente 200, servidor não confiável recusado; função removida e 404 confirmado | Definir receptor de entrada e custódia do material Itaú |
| 2026-09-30 | Decisão do dono nesta conversa | Escolhida consulta periódica, sem nova contratação agora | Decisão documental; webhook adiado, nenhum job criado | Custódia e material Itaú vigente; validar acesso e limites de consulta |
| 2026-09-30 | OpenAPI 2.27.2 e inventário da pasta local | Resolvidas referências dos parâmetros GET /pix; listados nomes de arquivos sem ler segredos | Documental: txid marcado obrigatório, paginação 0/100; sem arquivo de certificado/chave entre os arquivos da pasta | Confirmar material vigente com dono e validar exigência de TXID no ambiente autorizado |
| 2026-09-30 | Sandbox Itaú, credenciais fornecidas pelo dono | OAuth e consultas por período, paginação, datas inválidas e ausência de token | Runtime sandbox: OAuth 200/300s; consulta sem TXID 200; datas inválidas 400; sem token 401; mock ignorou paginação | Novo material de ativação e validação específica na conta real autorizada |

## Regras de cobrança aprovadas em 2026-09-30

Estas decisões não são implementação entregue. A preparação do código e dos
testes está descrita no [plano de simulação](2026-09-30-simulacao-itau-pix-no-vela.md).

- Substituir QR estático por cobrança dinâmica e conciliar automaticamente.
- Demurrage: uma cobrança ativa por processo, atualizada no mesmo TXID quando
  aplicada nova PTAX; corte às 14h30 do próximo dia útil, com sexta → segunda
  confirmado. Usar COB imediata para controlar horário.
- Alerta às 14h se a PTAX vigente ainda não estiver refletida na cobrança.
- Taxas Locais: manter pagável enquanto a fatura estiver aberta, renovando a
  expiração da mesma COB quando possível. Limites técnicos reais ainda não
  comprovados.
- Pagamento aceito durante troca de PTAX quita pelo valor da revisão paga.
- Próximo dia útil considera fins de semana e feriados nacionais, estaduais do
  Espírito Santo e municipais de Vitória, no fuso America/Sao_Paulo. O Vela
  calcula a prorrogação; não presumir comportamento automático do Itaú.
- Cancelar a fatura também solicita cancelamento da COB. Até a confirmação do
  banco, mostrar cancelamento pendente e reprocessar falhas. Pagamento concluído
  antes da confirmação deve ser preservado para análise, sem devolução automática.
- Se não for possível renovar a COB expirada, emitir recuperação com novo TXID
  somente após consultar recebimentos e confirmar que a anterior não está
  pagável. Preservar todos os TXIDs vinculados; incerteza gera Alerta e impede
  nova emissão.
- Conciliação por consulta a cada cinco minutos, sujeita à validação dos limites
  reais da API. Webhook adiado, sem contratação adicional nesta fase.

## Critérios de conclusão

- **Preparado para ativar:** runtime e custódia definidos, suporte mTLS
  comprovado tecnicamente, procedimento revisado e checks preparados; restam
  etapas dependentes do material vigente e de autorização.
- **Acesso operacional:** autenticação e consulta real autorizada observadas,
  renovação testada, certificado acompanhado e consulta periódica com
  recuperação/deduplicação validada no alvo. Webhook não é requisito desta fase.
- **Cobrança disponível:** fora deste plano; depende de regras comerciais,
  implementação e validação próprias.

Estado atual: materiais identificados; os dois primeiros critérios ainda
não foram atingidos. Ao concluir, arquivar este plano no mesmo change e manter
procedimentos operacionais no manual de serviços externos.
