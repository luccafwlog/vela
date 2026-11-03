# 0116 — O Vela gera o EDI Mercante de importação a partir da Viagem e dos B/Ls

Status: aceito — 2026-11-02 (pedido do responsável na
[issue #560](https://github.com/luccafwlog/vela/issues/560): substituir o
sistema externo que lê os B/Ls e gera o EDI). Implementada no botão
**Gerar EDI Mercante** da aba **Rotas e Manifestos** da Viagem
(`src/components/voyages/MercanteEdiModal.tsx`, `src/services/mercanteEdi.ts`).

Reverte, só quanto à geração do EDI Mercante, a remoção registrada junto da
[ADR 0025](./0025-bl-fonte-documental-unica-container-atd-pol.md): o B/L
continua a fonte documental única da carga de container e não volta a existir
importação de Manifesto CNTR.

## Contexto

A agência manifesta a carga de importação no Siscomex Mercante enviando um
arquivo EDI por rota (POL → POD) da Viagem. Até aqui, o arquivo era gerado por
um sistema externo que recebe os B/Ls de container (ou o Manifesto de carga
solta), lê de novo os mesmos documentos que o Vela já importou e monta o EDI.
Isso duplica a leitura dos B/Ls e não aproveita o que o Vela sabe a mais: o
IMO de cada contêiner vem do Baplie, enquanto o sistema externo aplica a
declaração de carga perigosa do B/L a todos os contêineres dele.

Os três EDIs de importação da GREEN GUANGZHOU V.6 (Viagem 169 de produção),
o manual do EDI Mercante (versão 3.6) e as tabelas oficiais do Mercante
(portos e terminais) foram comparados com os dados que o Vela grava. Com três
correções na leitura do B/L (lista de NCM, CNPJ do consignatário fora do
padrão e total de volumes com unidade de duas palavras), o arquivo gerado pelo
Vela repete o do sistema externo em todos os campos numéricos e códigos dos
133 B/Ls. As diferenças restantes são o IMO (o do Baplie, por decisão), a
ordem e o tamanho dos NCM e a limpeza do texto livre.

## Decisão

1. Cada linha de **Rotas e Manifestos** com contêiner (Carga **CNTR** ou
   **CNTR/BB**) e cada linha **VAZIOS** oferecem **Gerar EDI Mercante**. O
   botão abre uma prévia com navio, viagem, rota no Mercante, encerramento,
   operação, terminal e contagens, os **Impedimentos** e os **Avisos**. O
   arquivo só é baixado; o envio ao Mercante continua fora do Vela, e a
   geração não grava nada.
2. O arquivo de carga tem o registro M5 (manifesto), um C5 por B/L de
   contêiner ativo da rota e um I5 por contêiner, no layout do manual 3.6. O de
   vazios tem um M5 e um V5 por contêiner vazio da rota (substitui a planilha
   de três colunas). Os B/Ls de carga solta e misto ficam fora do arquivo de
   contêiner (aviso) e entram no arquivo **parcial de carga solta** (item 8).
3. Fontes: cadastro da Viagem (navio, IMO, armador, número), ATD do POL
   (encerramento) e ETA do POD (operação) da rota, terminal da frente de
   importação do POD com a modalidade do arquivo (carga cheia ou vazio) ou a
   exceção de terminal do B/L, campos do B/L (partes, CNPJ, emissão, descrição, NCM,
   volumes, CBM, Type of Movement), Frete & Despesas do B/L e os contêineres
   do B/L. IMO, classe e UN de cada contêiner são os que o Baplie aplicou ao
   contêiner, não a declaração do B/L.
4. O CNPJ da agência no manifesto é o da Transhipping (`src/config/company.ts`).
   Dos componentes de frete, só o THD sai no C5 (código `017`, em reais,
   collect); o frete básico é o Ocean Freight do B/L. Só frete e THD são
   manifestados: outra despesa do B/L fica fora do arquivo, com aviso
   (decisão do dono de 2026-11-02, na revisão da PR).
5. Códigos do Mercante que o Vela não guarda ficam em tabelas fixas no código
   (`src/services/mercanteEdiTables.ts`): armador (CSSC = `CN001321`),
   terminal (TVV = `BRVIX004`, PORTMAC = `BRVIX006`), porto quando o código
   difere (CNTAC → CNTAG, CNTAO → CNQIN), UF do porto brasileiro, de→para do
   tipo de contêiner (14 tipos, confirmados pelo responsável) e moeda. Os
   portos e terminais são conferidos nas tabelas oficiais do Mercante
   (`src/services/mercanteTableCodes.ts`).
6. Dado obrigatório ausente ou sem código no Mercante é **impedimento**: o
   arquivo não é baixado até a correção no Vela (cadastro da Viagem, datas da
   rota, frente de operação ou ficha do B/L). Texto truncado, contêiner sem
   lacre e Viagem sem Baplie são **avisos**.
7. Nome do arquivo: `FWL_MERCANTE_<AAAAMMDDHHMM>_<sigla>.TXT`, o padrão do
   sistema externo com a sigla do navio e da viagem no fim (GREEN GUANGZHOU
   V.6 → `GG6`).

8. **Carga solta: arquivo parcial** (decisão do dono, 2026-11-03). O Vela
   provavelmente nunca terá todos os dados do manifesto de carga solta (o
   Manifesto BB e o B/L avulso não trazem endereço das partes, data de emissão,
   frete nem Type of Movement), mas um EDI com os dados básicos (nº do B/L,
   consignatário, embarcador, notify…) já adianta o trabalho. As linhas **BB**
   e **CNTR/BB** ganham **Gerar EDI Mercante da carga solta**: um arquivo por
   rota com os B/Ls de carga solta e mistos (C5 + I5 tipo 1 para contêiner, 2
   para item de carga solta e 4 para veículo fora de contêiner). Ali o dado que
   falta não impede: sai em branco e a prévia o lista em **A completar**, por
   B/L e campo, para a equipe preencher antes de enviar. Só a rota sem B/L de
   carga solta impede. O código do tipo de embalagem (tabela 71 do Siscomex)
   não existe no Vela e sai sempre em branco. A rota CNTR/BB gera, portanto,
   dois arquivos: o de contêiner e o parcial de carga solta.

## Consequências

- O operador deixa de subir os B/Ls no sistema externo para os manifestos de
  contêiner e de vazios. Na carga solta, o Vela entrega um arquivo parcial que
  a equipe completa (item 8).
- Armador, terminal ou tipo de contêiner novo exige mudar a tabela no código;
  se ficar frequente, o código Mercante vira campo do cadastro.
- Decisões ainda em aberto na issue #560 (registro no
  Histórico, Viagem sem ATD/ETA, BL à ordem, outros terminais) não bloqueiam a
  geração: cada uma aparece hoje como impedimento ou aviso.
- Regra vigente: [Manifestos & EDI § EDI Mercante](../modules/manifesto-edi.md#edi-mercante).
