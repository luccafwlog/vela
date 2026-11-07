# Retorno do EDI Mercante: códigos e posições

> **Status:** referência · **Atualizado:** 2026-11-07 ·
> **Procedimento:** [Envio do manifesto EDI pelo Mercante](envio-manifesto-mercante.md) ·
> **Regra do arquivo:** [Manifestos & EDI › EDI Mercante](../modules/manifesto-edi.md#edi-mercante)

Consulta para ler o arquivo de retorno do Mercante e diagnosticar o TXT que o
Vela gera. Transcreve os códigos gerais, a tabela de mensagens de erro
EDI/Upload e as posições dos registros usados no diagnóstico, a partir dos
documentos públicos da Receita Federal listados em
[Fontes e versões](#fontes-e-versões).

## Limites desta referência

- **Cópia histórica.** A tabela é uma cópia da versão interna 2.6, de
  23/01/2019, e pode não ser a lista atual nem a lista completa do serviço. Um
  código que não está aqui não deve ser presumido nem inventado. Confira na
  fonte oficial.
- **Retorno, não tela.** Os códigos são do **arquivo de retorno**. As mensagens
  da tela de upload ("Arquivo não está zipado", "Arquivo corrompido",
  "Nenhum CNPJ de agência/empresa de navegação encontrado") não têm
  correspondência comprovada com nenhum código daqui. Por exemplo, "Arquivo
  corrompido" na tela não é o `EA0` do retorno, e a mensagem sobre CNPJ não é
  `EE5`, `EE6`, `EK4` nem `EK5`.
- **Texto da fonte.** As descrições preservam o texto da fonte, inclusive a
  grafia, as maiúsculas e as inconsistências do original. Só as quebras de
  linha do PDF foram juntadas.
- **Posições.** Colunas de largura fixa, contadas a partir de 1, com início e
  fim incluídos. Não confunda o leiaute de **envio** (o TXT do Vela) com o de
  **retorno** (o arquivo do Mercante). Num TXT legado com BOM, conte as
  posições depois dos três bytes `EF BB BF`.

## Fontes e versões

O rótulo do link na página da Receita e a versão impressa no rodapé do
documento não coincidem. Os dois estão registrados, sem renomear um pelo outro.

| Documento | Rótulo do link oficial | Versão no documento | Link |
|---|---|---|---|
| Página EDI/Upload do Mercante | — | — | [gov.br](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante) |
| Leiaute de envio ("Definições dos leiautes esquemáticos EDI/Upload") | v 3.2 | rodapé v3.6, 30/06/2017 | [PDF](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante/layout-edi-mercante-v-3.2/1.pdf) |
| Leiaute do retorno da crítica | v 2.9 | rodapé Versão 3.5, 20/04/2016 | [PDF](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante/layout-retorno-edi-mercante-v-2.9/3.pdf) |
| Mensagens de erro do EDI | versão 1.2 | rodapé Versão 2.6, 23/01/2019 | [PDF](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante/mensagens-de-erro-do-edi-versao-1.2/2.pdf) |
| Perguntas sobre transmissão via EDI (FAQ) | — | sem versão identificada | [PDF](https://www.gov.br/receitafederal/pt-br/assuntos/aduana-e-comercio-exterior/manuais/mercante/topicos/informacoes-aos-transportadores-empresas-agencias-de-navegacao-e-agencias-de-carga-transmissao-de-dados-layout-edi-e-up-load-mercante/perguntas-sobre-transmissao-via-edi/4.pdf) |
| Manual do Assinador Serpro | — | 4.2.0 | [tutorial](https://tutorial.assinadorserpro.estaleiro.serpro.gov.br/html/index.html) |

O módulo chama o leiaute de envio de "Manual do EDI Mercante 3.6", pelo rodapé
([Manifestos & EDI](../modules/manifesto-edi.md#edi-mercante)).

**Divergências e inconsistências conhecidas** (não corrigidas por suposição):

- **Retorno do item de carga (I).** A tabela de colunas põe `TIPO` em 01–02 e
  `TIPO-ITEM-CARGA` em "02 a 02", sobrepostos, e `NR-ITEM` em 03–06. Não há
  coluna livre para o tipo do item. A lista de tipos de registro também difere
  entre o texto (I1, I3, I5, I7, I9, IB, ID, IG, IP) e a tabela (I1, I3, I4,
  I5, I6, I7, I9, ID, IG, IP). Para posições depois do `TIPO`, confira o PDF
  oficial e um retorno real.
- **Descrição de `EMW`.** A descrição de `EMW` difere entre fontes. Esta
  referência transcreve só a da tabela de mensagens; quando a explicação de um
  campo depender dela, prefira a fonte específica daquele campo no leiaute.
- **Ordem e lacunas da tabela.** A tabela de mensagens não segue sempre a
  ordem alfabética (`ELW` vem depois de `ELZ`, `EMW` depois de `EMZ`, `EOA` a
  `EOF` antes de `ENH`, `EOW` depois de `EOZ`, e `EA0` a `EA5` no fim) e tem
  lacunas na sequência. A ordem da fonte foi mantida.
- **`EE0` em dois papéis.** `EE0` aparece como código geral e como mensagem
  específica.

## Códigos gerais de retorno

O retorno tem uma linha por registro enviado (`M5`, `C5`, `I5`, `V5`…). O
código geral está nas posições 03–05 das linhas de manifesto e de
conhecimento, e 07–09 das de vazio e de item
([posições](#retorno-posições-por-registro)).

| Código | Descrição (leiaute do retorno) |
|---|---|
| `000` | Informações do Registro de Manifesto, Conhecimento e Item estão corretas ou Manifesto, Contêiner Vazio, Conhecimento e Item estão corretas. O número do manifesto é informado quando o código geral é `000`; no conhecimento e no item, também o NR-CE-MERCANTE. |
| `XXX` | Existe pelo menos um campo criticado com erro. |
| `EE0` | Não foi possível identificar o Tipo do registro. |

Depois do código geral vêm até **191 ocorrências** de código específico.
Cada ocorrência tem 6 posições: 3 do código (tabela abaixo) e 3 do número da
ocorrência do campo com erro (`000` em campo que não se repete). Ao atingir o
limite, o Mercante usa o `EMD` ("Limite de 191 Códigos de Erros por registro /
linha atingido…").

## Retorno: posições por registro

Fonte: leiaute do retorno (rótulo v 2.9, rodapé Versão 3.5).

| Registro de retorno | Tipo (01–02) | Demais campos | Erros específicos | Chave de identificação |
|---|---|---|---|---|
| Manifesto (M1, M3, M4, M5, M6, M7, M9, MB, ME, MG, MP) | `M5` no LCI | 03–05 código geral · 06–18 número do manifesto · 19–20 espaços | 21–1166 (1ª: 21–23 código, 24–26 ocorrência; 191ª: 1161–1166) | 1167–1218: porto de carregamento (5), porto de descarregamento (5), empresa de navegação (14), embarcação IMO (10), número da viagem (10), data de previsão de atracação (8) |
| Contêiner vazio (V1, V3, V4, V5, V6, V7, V9, VB, VE, VG) | `V5` no LCI | 03–06 número sequencial do item · 07–09 código geral · 10–22 número do manifesto · 23–24 espaços | 25–1170 (1ª: 25–27 e 28–30; 191ª: 1165–1170) | 1171–1226: as seis chaves do manifesto e o número sequencial do item (4) |
| Conhecimento (C1, C3, C4, C5, C6, C7, C8, C9, CB, CC, CE, CG, CH, CP) | `C5` no LCI | 03–05 código geral · 06–18 número do manifesto · 19–20 espaços · 21–35 NR-CE-MERCANTE | 36–1181 (1ª: 36–38 e 39–41; 191ª: 1176–1181) | 1182–1199: número do conhecimento de embarque (18) |
| Item de carga (I…) | `I5` no LCI | 03–06 número sequencial do item · 07–09 código geral · 10–22 número do manifesto · 23–24 espaços · 25–39 NR-CE-MERCANTE ([inconsistência](#fontes-e-versões)) | 40–1185 (1ª: 40–42 e 43–45; 191ª: 1180–1185) | 1186–1207: número do conhecimento e número sequencial do item |

**Como ler uma linha de retorno do `M5`:**

1. As posições 01–02 dizem o registro (`M5`).
2. As posições 03–05 trazem o código geral.
3. Com `000`, as posições 06–18 trazem o número do manifesto.
4. Com `XXX`, leia de 6 em 6 posições a partir da 21: o código e a ocorrência.
5. Procure cada código na [tabela de mensagens](#mensagens-de-erro-ediupload).
6. A chave 1167–1218 confirma a que manifesto a linha se refere.

## M5: posições para diagnóstico

Fonte: leiaute de envio (rótulo v 3.2, rodapé v3.6), registro de manifesto
padrão. A coluna "No TXT do Vela" vem de `buildM5` em
`src/services/mercanteEdi.ts` (**Código**). A linha `M5` do Vela tem 164
posições.

| Colunas | Campo | Descrição na fonte | No TXT do Vela |
|---|---|---|---|
| 01–02 | `TIPO` | Tipo do registro (`M5` = Longo Curso Importação) | `M5` |
| 03–06 | `QTDE-CE` | Quantidade de conhecimentos, NUM (4) | Número de `C5` do arquivo; `0000` no de vazios |
| 07–10 | `QTDE-CONT-VZ` | Quantidade de contêineres vazios, NUM (4); obrigatório quando a quantidade de CE é zero | Número de `V5` no arquivo de vazios; em branco no de carga e no de carga solta |
| 11–24 | `COD-EMP-NAV` | Código da empresa de navegação: 14 numéricos (nacional) ou 8 alfanuméricos à esquerda (estrangeira) | Código Mercante do armador, pelo SCAC do cadastro na tabela fixa do Vela (`src/services/mercanteEdiTables.ts`) |
| 25–38 | `COD-AGEN-NAV` | Código da agência de navegação, ALFA (14) | CNPJ da agência (`src/config/company.ts`), só dígitos |
| 39–46 | `DT-ENC-MANIF` | Data de encerramento do manifesto, AAAAMMDD | ATD do POL da rota |
| 47–54 | `DT-DESCARGA` | Data da operação, AAAAMMDD | ETA do POD |
| 55–59 | `CO-PORTO-ORIG` | Porto de origem (carregamento), ALFA (5) | POL, com o de→para do Mercante |
| 60–64 | `CO-PORTO-DEST` | Porto de destino (descarregamento), ALFA (5) | POD |
| 65–74 | `NR-VIAGEM` | Número da viagem do armador, ALFA (10) | Número da Viagem |
| 75–84 | `COD-IMO` | Código da embarcação (IMO), ALFA (10) | IMO do navio, só dígitos |
| 85–124 | `CO-TERM-CARR` | Terminal de carregamento, 5 × 8 | Em branco (a origem é estrangeira) |
| 125–164 | `CO-TERM-DESC` | Terminal de descarregamento, 5 × 8 | 1ª ocorrência (125–132): terminal da frente de operação do POD |

Pontes úteis no diagnóstico:

- **Quantidade de CE (03–06) diferente do número de `C5`** é a situação
  descrita no `EEJ`. **Quantidade de vazios (07–10) diferente do número de
  `V5`** é a descrita no `EHO`.
- **Agência (25–38) e empresa de navegação (11–24)** são os campos que a tela
  de upload aponta na mensagem sobre CNPJ. A mensagem não tem código EDI
  comprovado ([limites](#limites-desta-referência)).
- **Tipo de registro não reconhecido** volta como `EE0`. Confira se a linha
  começa direto por `M5`, sem BOM nem outro caractere antes.

## C5, I5 e V5: ponte para o diagnóstico

Fonte: leiaute de envio (rótulo v 3.2, rodapé v3.6). Comprimentos das linhas
do Vela (**Código**, `src/services/mercanteEdi.ts`): `C5` com 4104 posições,
`I5` e `V5` com 5000, completadas com espaços.

**C5 (conhecimento)**, campos mais usados:

| Colunas | Campo | Descrição |
|---|---|---|
| 01–02 | `TIPO` | `C5` (ou `C2`) |
| 03–06 | `QTDE-ITENS` | Quantidade de itens de carga |
| 07–24 | `NUMERO-CE` | Número do conhecimento de embarque (18) |
| 25 | `IND-BL-A-ORDEM` | Indicador de BL a ordem |
| 29 | `IND-CONSIG-ESTR` | Indicador de consignatário estrangeiro |
| 30–282 | `IDENT-CONSIGNAT` | Identificação do consignatário |
| 283–312 | `NR-PASS-ESTR` | Número do passaporte estrangeiro |
| 313–367 | `NOM-CONSIG-ESTR` | Nome do consignatário estrangeiro |
| 368–381 | `CNPJ-CPF-CONSIG` | CNPJ / CPF do consignatário |
| 382–634 | `IDENT-EMBARC` | Identificador do embarcador |
| 635–642 | `DT-EMIS-CONHEC` | Data de emissão do conhecimento |
| 643–1148 | `DESCR-MERC` | Descrição da mercadoria |
| 1149–1401 | `OBSERVACOES` | Observações |
| 1402–1414 | `CUBAGEM-M3` | Cubagem em M3, NUM (10,3) |
| 1415–1419 / 1420–1424 | `PORTO-ORIGEM` / `PORTO-DESTINO` | Porto de origem / de destino |
| 1425–1438 / 1439–1691 | `CNPJ / CPF – NOTIFICADA` / `IDENT-P-NOTIFICADA` | Parte a ser notificada |
| 1748–1760 | `VL-FRETE-BASICO` | Valor do frete básico, NUM (11,2) |
| 1761–1763 | `CD-MOEDA-FRETE` | Código da moeda do frete |
| 1764 | `CD-RECOLH-FRETE` | Código de recolhimento do frete |
| 1765–1766 | `MODAL-FRETE` | Modalidade do frete |
| 1767 | `CATEGORIA-CARGA` | Categoria da carga |
| 1768–1769 | `UF-DEST-CARGA` | UF de destino da carga |
| 1770–1777 | `COD-TERM-PORT-DESCARREG` | Terminal portuário de descarregamento |
| 1780 | `IND-BL-SERVICO` | Indicador de BL serviço |
| 3797–4096 | `GR-COMP-FRETE` | Componentes do frete (até 15) |
| 4097–4104 | `CD-TERM-PORTO-CARREG` | Terminal portuário de carregamento |

**I5 (item de carga).** O material transcrito traz as definições dos campos,
mas não a tabela de colunas. Por isso, aqui não há posições do I5; consulte o
PDF oficial.

- Tipo do item: 1 = Contêiner, 2 = Carga Solta, 3 = Granel, 4 = Veículos.
- Número sequencial de 0001 a 9999.
- Peso bruto em kg com 12 posições (9 inteiras e 3 decimais), comum a todos os
  tipos.
- Tipo, número, tara e indicador de uso parcial só no tipo 1.
- Embalagem e quantidade obrigatórias no tipo 2.
- Chassi no tipo 4.
- Marca e contramarca nos tipos 2 e 4.
- Cubagem obrigatória no tipo 1.
- Até 4 lacres no tipo 1, pelo menos um.
- Mensagens ligadas: `EGF`, `EGG`, `EH0` a `EHB`, `EI0` a `EI3`, `EL5`, `EL8`.

**V5 (contêiner vazio):**

| Colunas | Campo | Descrição |
|---|---|---|
| 01–02 | `TIPO` | `V5` |
| 03–06 | `NR-ITEM` | Número sequencial do item, 0001 a 9999 |
| 07–10 | `TIPO-CONTEINER` | Tipo do contêiner (tabela Siscomex) |
| 11–21 | `NR-CONTEINER` | Número do contêiner |
| 22–30 | `PB- TR-CONT` | Peso da tara do contêiner, NUM (06,3) |

Mensagens ligadas: `EHN`, `EHO`, `EHQ`, `EL7`, `EL9`.

## FAQ: o que vale e o que não vale

Resumo da FAQ "Perguntas sobre transmissão via EDI" (sem versão identificada):

- **M5/C5.** Correspondem ao Longo Curso Importação padrão. Deve existir só um
  tipo de tráfego por arquivo enviado.
- **Itens de carga.** A categoria da carga importada é "I". O item de carga é
  obrigatório: 1 contêiner, 2 carga solta, 3 granel, 4 veículos. Conhecimento
  com zero item de carga é inválido.
- **Nota fiscal.** Não é pedida para Passagem e LCI. É o retrato dessa FAQ
  histórica.
- **VAN.** A FAQ descreve a VAN habilitada e a obtenção dos leiautes. Isso não
  nega o upload web validado no GS8. A FAQ não traz o passo do botão **Assinar
  arquivo** nem prova a composição do pacote da Zaptrade
  ([runbook](envio-manifesto-mercante.md#8-upload-web-e-zaptrade)).

## Mensagens de erro EDI/Upload

Fonte: "Sistema MERCANTE — Definições das mensagens de erro de retorno da
crítica EDI/UPLOAD" (rótulo do link: versão 1.2; rodapé: Versão 2.6,
23/01/2019). São 411 códigos, na ordem da fonte. Veja os
[limites](#limites-desta-referência) antes de usar.

| Código | Descrição do erro |
|---|---|
| `EE0` | Arquivo recusado, tipo de registro não pode ser identificado. |
| `EE1` | Quantidade de Conhecimentos informada não é numérica. |
| `EE2` | Quantidade de Conhecimentos informada é igual a zero. |
| `EE3` | Empresa de Navegação / NVOCC com formato inválido ou não informada. |
| `EE4` | Empresa de Navegação / NVOCC não consta do cadastro. |
| `EE5` | Agência de Navegação / Desconsolidadora com formato inválido. |
| `EE6` | Agência de Navegação / Desconsolidadora não consta do cadastro. |
| `EE7` | Data de Emissão do Manifesto inválida. |
| `EE8` | Data de Encerramento do Manifesto é maior que a data limite (Data Corrente para LCI e 10 dias após a Data Corrente para demais tipos de Manifesto) |
| `EE9` | Data de Previsão de Atracação (Operação) do Manifesto inválida. |
| `EEA` | Código do Porto de Carregamento não consta na tabela. |
| `EEB` | Código do Porto de Descarregamento não consta na tabela. |
| `EEC` | Código do Terminal Portuário de Carregamento não consta na tabela. |
| `EED` | Código do Terminal Portuário de Descarregamento não consta na tabela. |
| `EEE` | Número da Viagem não informado. |
| `EEF` | Quantidade de Contêiner de 20 não numérico. |
| `EEG` | Quantidade de Contêiner de 40 não numérico. |
| `EEH` | Código da Embarcação (IMO) não existe na tabela. |
| `EEI` | Código da Embarcação (IMO) do Comboio não existe na tabela. |
| `EEJ` | Quantidade de Conhecimentos informados no Manifesto diferente da quantidade de Conhecimentos enviados. |
| `EEK` | Código da Embarcação (IMO) não informado. |
| `EEL` | Código do Porto de Carregamento não informado. |
| `EEM` | Código do Porto de Descarregamento não informado. |
| `EEN` | Código do Terminal Portuário de Descarregamento não informado. |
| `EEO` | Manifesto já existe no Cadastro. |
| `EEP` | Porto Nacional não está associado a um Serviço de Arrecadação. Entre em contato com o SERARR. |
| `EEQ` | Código da Agência de Navegação / Desconsolidadora não informado. |
| `EER` | Número do CE a ser desconsolidado não encontrado no Cadastro. |
| `EES` | Número do CE informado já foi desconsolidado. |
| `EET` | Soma do Peso dos CE desconsolidados fora do limite informado no desconsolidado. |
| `EEU` | Soma do Frete dos CE desconsolidados menor que o informado no desconsolidado. |
| `EEV` | Código do Porto de Carregamento inválido para o tipo de Tráfego. |
| `EEW` | Código do Porto de Descarregamento inválido para o tipo de Tráfego. |
| `EEX` | Código do Terminal Portuário de Carregamento não é do Porto de Carregamento informado. |
| `EEY` | Código do Terminal Portuário de Descarregamento não é do Porto de Descarregamento informado. |
| `EEZ` | Tipo de Tráfego informado diferente do esperado. |
| `EF0` | Número do Conhecimento de Embarque sem informação. |
| `EF1` | Data de Emissão do Conhecimento inválida. |
| `EF2` | Data de Emissão do Conhecimento maior que a data corrente. |
| `EF3` | Código do Tipo de Embalagem para Carga Solta (tipo item 2) inválido na tabela. |
| `EF4` | Consignatário não existe no cadastro. |
| `EF5` | Quantidade de Veículos não numérico. |
| `EF6` | Peso Bruto não numérico. |
| `EF7` | Peso Bruto não informado (igual a zero). |
| `EF8` | Valor Frete Básico não numérico. |
| `EF9` | Valor Frete Básico não informado (igual a zero). |
| `EFA` | Código da Taxa não existe na tabela. |
| `EFB` | Valor da Taxa não numérico. |
| `EFC` | Valor da Taxa não informado (igual a zero). |
| `EFD` | Valor da Taxa informado sem o respectivo código. |
| `EFE` | Indicador Parcial de Contêiner inválido. |
| `EFF` | Indicador Capacidade de Contêiner inválido. |
| `EFG` | Nenhuma ocorrência de Mercadoria preenchida para o tipo de Item de Carga informado. |
| `EFH` | Estado de Destino Final da Carga inválido. |
| `EFI` | Cubagem informada não numérica. |
| `EFJ` | Cubagem não informada (igual a zero). |
| `EFK` | Valor da Taxa do Componente Frete não informado (igual a zero). |
| `EFL` | Valor da Taxa do Componente Frete não numérico. |
| `EFM` | Código de Recolhimento do Componente Frete inválido. |
| `EFN` | Número de Série da Nota Fiscal não informado. |
| `EFO` | Data Emissão da Nota Fiscal não informada. |
| `EFP` | Data Emissão da Nota Fiscal inválida. |
| `EFQ` | Data Emissão da Nota Fiscal maior que data corrente. |
| `EFR` | Volume da Nota Fiscal não numérico. |
| `EFS` | Volume da Nota Fiscal não informado (igual a zero). |
| `EFT` | Nenhuma Mercadoria foi informada. |
| `EFU` | Existe(m) ocorrência(s) em branco, entre códigos de mercadorias. Preencha em Sequência |
| `EFV` | Peso (em kg) da Tara do Contêiner não numérico. |
| `EFW` | Conhecimento já existe no cadastro. |
| `EFX` | Código da Moeda do Frete não informado. |
| `EFY` | Código da Moeda do Frete não existe na tabela. |
| `EFZ` | Código da Moeda da Taxa do Frete não informado. |
| `EG0` | Código da Moeda da Taxa do Frete não existe na tabela. |
| `EG1` | Código do País de Procedência da Carga não existe na tabela. |
| `EG2` | Código do Porto de Origem do Transporte não existe na Tabela. |
| `EG3` | Número da Declaração de Despacho de Exportação (DDE) não informado. |
| `EG4` | Número da Declaração de Despacho de Exportação (DDE) não numérico. |
| `EG5` | Código do País de Destino Final da Carga não existe na tabela. |
| `EG6` | Código do Porto de Transbordo não existe na tabela. |
| `EG7` | Cód. do País de Procedência da Carga inválido na tabela de países. |
| `EG8` | Cód. do País de Destino Final da Carga inválido para o Tipo de Tráfego informado. |
| `EG9` | Código do Porto de Transbordo inválido para o Tipo de Tráfego informado. |
| `EGA` | Registro de Manifesto de Carga não encontrado. |
| `EGB` | Número do Contêiner não informado. |
| `EGC` | Data de Emissão do Conhecimento maior que a Data de Emissão do Manifesto. |
| `EGD` | Porto ainda não implantado pelo DMM. |
| `EGE` | Número do Conhecimento de Embarque duplicado no Manifesto. |
| `EGF` | Tipo de Item de Carga não informado ou inválido. |
| `EGG` | Número Sequencial do Item de Carga não informado ou inválido. |
| `EGH` | Número do BL contém, brancos ou caracteres especiais em seu conteúdo. |
| `EGI` | Identificação do Embarcador não informado. |
| `EGJ` | Manifesto informado em duplicata no arquivo Van. |
| `EGK` | Código de Recolhimento do Frete não informado ou inválido. |
| `EGL` | Categoria da Carga não informada ou inválida. |
| `EGM` | Modalidade do Frete não informada ou inválida. |
| `EGN` | UF de Destino da Carga não consta na tabela. |
| `EGO` | Indicador BL a Ordem não informado ou inválido. |
| `EGP` | Indicador de Consignatário Estrangeiro não informado ou inválido para o Tipo de Tráfego informado. |
| `EGQ` | Código do Componente do Frete não informado ou inválido na tabela. |
| `EGR` | CNPJ / CPF do Embarcador inválido no cadastro. |
| `EGS` | CNPJ / CPF do Consignatário inválido. |
| `EGT` | Embarcação de Transbordo Nacional não informado ou inválido na tabela. |
| `EGU` | Porto de Destino Final não informado ou inválido na tabela. |
| `EGV` | Identificação do Consignatário não informado. |
| `EGW` | Porto de Transbordo no Exterior inválido na tabela. |
| `EGX` | País de Procedência não informado. |
| `EGY` | Número do Passaporte Estrangeiro não informado, para Indicador Consignatário Estrangeiro igual a ‘S’. |
| `EGZ` | Nome do Consignatário Estrangeiro não informado, para Indicador Consignatário Estrangeiro igual a ‘S’. |
| `EH0` | Tipo de Contêiner não informado. |
| `EH1` | Tipo de Contêiner inválido na Tabela. |
| `EH2` | Número do Contêiner inválido. |
| `EH3` | Peso Bruto (em kg) do Item de Carga não numérico. |
| `EH4` | Peso (em kg) da Tara do Contêiner não informado (igual a zero). |
| `EH5` | Código do Tipo de Embalagem para Carga Solta (Tipo Item 2) não informado. |
| `EH6` | Quantidade de Item para Carga Solta não Numérico. |
| `EH7` | Código do Tipo de Granel (tipo item 3) não informado. |
| `EH8` | Texto Descrição Granel (tipo item 3) não informado. |
| `EH9` | Número do Chassi do Veículo não informado. |
| `EHA` | Nome da Marca (tipo item 2 ou 4) não informado. |
| `EHB` | Nome da Contramarca (tipo item 2 ou 4) não informado. |
| `EHC` | Código de Mercadoria Perigosa inválido na tabela. |
| `EHD` | Código da Classe de Mercadoria Perigosa não informado. |
| `EHE` | Número Lacre do Contêiner não informado. |
| `EHF` | CNPJ / CPF Emitente da Nota Fiscal não informado ou inválido no cadastro (CNPJ / CPF). |
| `EHG` | Inscrição do Emitente da Nota Fiscal não informado ou inválido. |
| `EHI` | Código da Mercadoria do Item não existe na tabela de mercadorias. |
| `EHJ` | Valor da Mercadoria da Nota Fiscal não numérico. |
| `EHK` | Peso Bruto (em kg) do Item de Carga não informado (igual a zero). |
| `EHL` | CNPJ / CPF da parte a ser notificada inválido no cadastro. |
| `EHM` | Identificação da parte a ser notificada não informado. |
| `EHN` | Quantidade de Contêiner Vazio informado não numérico. |
| `EHO` | Quantidade de Contêiner(s) Vazio(s) informada no Manifesto diferente da quantidade de Contêiner(s) Vazio(s) enviada. |
| `EHP` | Soma da Cubagem dos CE Desconsolidados menor que a informada no Desconsolidado. |
| `EHQ` | Número Sequencial do Item Contêiner Vazio inválido. |
| `EHR` | Nome do Navio de Transbordo no Exterior deve ser informado na condição de: Porto de Origem informado no Conhecimento ser diferente do Porto de Carregamento informado no Manifesto. |
| `EHS` | Número da Nota Fiscal não informado ou inválido. |
| `EHT` | Número BL do Primeiro Transporte deve ser informado na condição de: Porto de Origem informado no Conhecimento ser diferente do Porto de Carregamento informado no Manifesto. |
| `EHU` | Nome do Navio do Primeiro Transporte deve ser informado na condição de: Porto de Origem informado no Conhecimento ser diferente do Porto de Carregamento informado no Manifesto. |
| `EHV` | Data Emissão do BL do Primeiro Transporte deve ser informada/válida na condição de: Porto de Origem informado no Conhecimento ser diferente do Porto de Carregamento informado no Manifesto. |
| `EHW` | Número do CE-MERCANTE informado para Associação inexistente na Base MERCANTE. |
| `EHX` | Valor do Frete Total Baldeação não informado ou inválido. |
| `EHY` | Código da Moeda Frete de Baldeação não informada ou inválida na tabela. |
| `EHZ` | Código da Mercadoria do Item diferente de 8 posições numéricas ou diferente de (4 posições numéricas + 4 brancos) ou diferente de (4 posições numéricas + ‘0000’). |
| `EI0` | Quantidade de Item para Carga Solta (tipo item 2) não Informada (igual a zero). |
| `EI1` | Código do Tipo de Granel (tipo item 3) inválido na Tabela. |
| `EI2` | Quantidade de Itens de Carga Informada no Conhecimento diferente da quantidade enviada. |
| `EI3` | Nenhum Item de Carga informado para o Conhecimento enviado. |
| `EI4` | Terminal Portuário de Descarregamento informado no Conhecimento não é um dos Terminais Portuários de Descarregamento informado no Manifesto. |
| `EI5` | Código do Porto de Transbordo no Exterior deve ser informado na condição de: Porto de Origem informado no Conhecimento ser diferente do Porto de Carregamento informado no Manifesto. |
| `EI6` | Código do Porto de Transbordo no Exterior não deve ser informado na condição de : Porto de Origem informado no Conhecimento ser igual ao Porto de Carregamento informado no Manifesto. |
| `EI7` | Nome do Navio de Transbordo no Exterior não deve ser Informado na condição de : Porto de Origem informado no Conhecimento ser igual ao Porto de Carregamento informado no Manifesto. |
| `EI8` | Número do BL Primeiro Transporte não deve ser Informado na condição de Porto de Origem informado no Conhecimento ser igual ao Porto de Carregamento Informado no Manifesto. |
| `EI9` | Nome do Navio Primeiro Transporte não deve ser informado na condição de Porto de Origem informado no Conhecimento ser igual ao Porto de Carregamento Informado no Manifesto. |
| `EIA` | Data de Emissão do Primeiro Transporte não deve ser informado na condição de : Porto de Origem informado no Conhecimento ser igual ao Porto de Carregamento Informado no Manifesto. |
| `EIB` | CNPJ / CPF do Consignatário não deve ser Informado quando indicador de BL A Ordem estiver informado (igual a ‘S’). |
| `EIC` | Indicador de Consignatário Estrangeiro Não deve ser informado (‘N’) quando indicador de BL A Ordem estiver informado (igual a ‘S’). |
| `EID` | Número do Contêiner Convenience informado para a Modalidade de Frete = HH. |
| `EIE` | Contêiner Vazio não existe na Função de Associação de um número de Manifesto existente e previamente informado. |
| `EIF` | Indicador de Inclusão/Associação no Manifesto de Baldeação não informado ou inválido. |
| `EIG` | Número do Manifesto de Baldeação para Associação não informado. |
| `EIH` | Número do Manifesto de Baldeação para Associação não ativo no cadastro. |
| `EII` | Quantidade de Contêiner Vazio informada no Manifesto de Baldeação para associação com Número do Manifesto informado, diferente de zero. |
| `EIJ` | Código da Moeda Frete Baldeação inválida para o tipo de Tráfego do CE-MERCANTE informado. |
| `EIK` | Manifesto e Conhecimento informados já associados. |
| `EIL` | Não Permitido Associação. Porto de Carregamento informado no Manifesto a Associar igual ao Porto de Carregamento de outro Manifesto já Associado a este Conhecimento. |
| `EIM` | Não Permitido Associação. Porto de Descarregamento informado no Manifesto a Associar igual ao Porto de Descarregamento de outro Manifesto já Associado a este Conhecimento. |
| `EIN` | Tipo de Tráfego do Número de Manifesto inválido para associação solicitada. |
| `EIO` | Conhecimento informado com Categoria da Carga inválida para Associação solicitada. |
| `EIP` | Conhecimento informado com Tipo de Tráfego inválido para Associação solicitada. |
| `EIQ` | Tipo de Tráfego do Número de Manifesto Principal inválido. |
| `EIR` | Código de Recolhimento do Componente Frete não informado ou inválido. |
| `EIS` | O Código de Terminal Portuário incompatível para inclusão de Manifesto de Passagem. |
| `EIT` | Terminal Portuário de Carregamento informado no Conhecimento não é um dos Terminais Portuários de Carregamento informado no Manifesto. |
| `EIU` | Nro do CE-MERCANTE informado não existe no Conhecimento Passagem. |
| `EIV` | Nro Manifesto Informado para Associação não existe na Base MERCANTE. |
| `EIW` | Código do Terminal Portuário de Descarregamento do Conhecimento a Associar não pode ser igual aos Terminais Portuários de Carregamento do Manifesto. |
| `EIX` | Código do Terminal Portuário de Carregamento do Conhecimento a Associar não pode ser igual aos Terminais Portuários de Descarregamento do Manifesto. |
| `EIY` | Categoria da Carga informada no Conhecimento incompatível com o Tipo de Tráfego. |
| `EIZ` | Conhecimento Longo Curso Exportação já possui um Manifesto Principal Longo Curso Exportação associado. |
| `EJ0` | Terminal Portuário de Descarregamento X Recinto Alfandegado inconsistentes na tabela MERCANTE. |
| `EJ1` | Descrição de Mercadoria não informada. |
| `EJ2` | NR CE-MASTER Informado já possui isenção ou suspensão. |
| `EJ3` | NR CE-MERCANTE informado já pagou AFRMM. |
| `EJ4` | Agência desconsolidadora não está cadastrada como Agência Sub-estabelecida. |
| `EJ5` | Problema ao transformar o Conhecimento em Conhecimento MASTER. Favor entrar em contato com a Central de Atendimento e Suporte (CAS) informando o Número do CE-MERCANTE o qual deseja Desconsolidar. |
| `EJ6` | Ao menos 1(um) registro de Item de Carga tipo = Solta ou Veículo deve ser informado, quando o Nro Contêiner Ships Convenience no registro do Conhecimento correspondente estiver preenchido. |
| `EJ7` | Indicador de BL Serviço não informado. |
| `EJ8` | Indicador de BL Serviço diferente de ‘S’ ou ‘N’. |
| `EJ9` | Quantidade de Notas Fiscais informada no Conhecimento diferente da quantidade enviada. |
| `EJA` | Conhecimento sem registro de Nota Fiscal. |
| `EJB` | Código de Mercadoria informado no Item de Carga do CE-FILHOTE não existente nos Itens de Carga do Respectivo CE-MASTER. |
| `EJC` | Nro de Contêiner informado no Item de Carga tipo Contêiner do CE-FILHOTE Não existente nos Itens de Carga tipo contêiner do respectivo CE-MASTER. |
| `EJD` | Quantidade de Itens de Carga informado no registro de conhecimento não numérico. |
| `EJE` | Quantidade de Itens de Carga informado no registro de conhecimento igual a zero. |
| `EJF` | Quantidade de Notas Fiscais informada no registro de conhecimento não numérico. |
| `EJG` | Quantidade de Notas Fiscais informada no registro de conhecimento igual a zero. |
| `EJH` | Número CE-MERCANTE Original deve ser preenchido com zeros quando indicador BL Serviço igual a ‘N’. |
| `EJI` | Número CE-MERCANTE Original deve ser maior que zero e válido quando indicador BL Serviço Igual a ‘S’. |
| `EJJ` | Valor do Frete Básico deve ser igual a zero quando Indicador BL Serviço Igual a ‘S’. |
| `EJK` | Código Recolhimento Frete não deve ser informado quando BL Serviço igual a ‘S’. |
| `EJL` | Indicador de BL Serviço não pode ser ‘S’ para Filhote Provisório e Desconsolidado. |
| `EJM` | Número do contêiner informado no item do conhecimento filhote não existe nos itens do seu Respectivo Conhecimento MASTER. |
| `EJN` | Código NCM informado no item do conhecimento filhote não existe nos itens do seu respectivo Conhecimento MASTER. |
| `EJO` | Não é permitido associar. Conhecimento bloqueado pelo Sistema Carga. |
| `EJP` | Número do CE-MASTER já informado no registro de Manifesto (MD) do arquivo de entrada. |
| `EJQ` | CNPJ / CPF do Consignatário deve ser informado quando Indicador de BL Ordem igual a ‘N’ e Indicador de Consignatário Estrangeiro igual a ‘N’. |
| `EJR` | CNPJ / CPF do Consignatário não deve ser preenchido quando Indicador de BL Ordem igual a ‘N’ e Indicador de Consignatário Estrangeiro igual a ‘S’. |
| `EJS` | Não permitido associar Conhecimento pois Manifesto encontra-se no Porto de Destino Final da Carga. |
| `EJT` | Número do CE-MERCANTE Original Informado Não Existente Na Base MERCANTE. |
| `EJU` | Código do Terminal Portuário de Carregamento Não Informado. |
| `EJV` | Código do Porto de Origem não consta na tabela. |
| `EJW` | Código do Porto de Destino não consta na tabela. |
| `EJX` | Código do Porto de Origem não informado. |
| `EJY` | Código do Porto de Destino não informado. |
| `EJZ` | Código do Porto de Origem inválido para o tipo de tráfego. |
| `EK0` | Código do Porto de Destino inválido para o tipo de tráfego. |
| `EK1` | Código do Terminal Portuário de Destino não informado. |
| `EK2` | Código de Terminal Portuário de Origem não pertence ao Porto de Carregamento. |
| `EK3` | Código de Terminal Portuário de Destino não pertence ao Porto de Descarregamento. |
| `EK4` | CNPJ da Agência de Navegação não Ativo no Cadastro (CNPJ). |
| `EK5` | CNPJ da Agência de Navegação inválido no Cadastro (CNPJ). |
| `EK6` | CNPJ da Empresa de Navegação não Ativo no Cadastro (CNPJ). |
| `EK7` | CNPJ da Empresa de Navegação inválido no Cadastro (CNPJ). |
| `EK8` | Tipo de Declaração de Exportação inválida. |
| `EK9` | DV do número da Declaração de Exportação inválido, verifique Parâmetros de Entrada. |
| `EKA` | Tipo de Declaração não Numérico ou igual a zero. |
| `EKB` | Número da Declaração de Exportação não Numérico ou igual a zero. |
| `EKC` | CNPJ do Consignatário não Ativo no Cadastro (CNPJ). |
| `EKD` | CNPJ do Consignatário inválido no Cadastro (CNPJ). |
| `EKE` | CPF do Consignatário não Ativo no Cadastro (CPF). |
| `EKF` | CPF do Consignatário inválido no Cadastro (CPF). |
| `EKG` | Indicador de Entrega no Exterior diferente de ‘S’ ou ‘N’. |
| `EKH` | Indicador de Entrega no Exterior Não deve ser informado quando Indicador de BL A Ordem estiver Informado (Igual a ‘S’). |
| `EKI` | Código do País Destino no Exterior não deve ser Informado quando Indicador de BL A Ordem estiver Informado (Igual a ‘S’). |
| `EKJ` | Número do Passaporte Estrangeiro não pode ser Informado para Indicador de BL A Ordem Informado (Igual a ‘S’). |
| `EKK` | Nome do Consignatário Estrangeiro não pode ser Informado para Indicador de BL A Ordem Informado (Igual a ‘S’). |
| `EKL` | País de Destino no Exterior não pode ter conteúdo quando indicador de entrega No Exterior for igual a ‘N’. |
| `EKM` | Número do Passaporte Estrangeiro não deve ser Informado quando CNPJ ou CPF do Consignatário Nacional for Informado. |
| `EKN` | Nome do Consignatário Estrangeiro Não deve ser Informado quando CNPJ ou CPF do Consignatário Nacional for Informado. |
| `EKO` | Código do País Destino no Exterior deve ser Informado quando Indicador de Entrega no Exterior Informado (Igual a ‘S’). |
| `EKP` | Número de CNPJ ou CPF do Consignatário Nacional não deve ser Informado Quando o Indicador de Entrega no Exterior for Informado (Igual a ‘S’). |
| `EKQ` | Indicador do Consignatário Estrangeiro não deve ser Informado Quando o Indicador de Entrega no Exterior for Informado (Igual a ‘S’). |
| `EKR` | Número do Passaporte Estrangeiro não deve ser informado quando o Indicador de Entrega no Exterior for Informado (Igual a ‘S’). |
| `EKS` | Nome do Consignatário Estrangeiro não tem informação quando o Indicador de Entrega no Exterior for Informado (Igual a ‘S’). |
| `EKT` | Código do País Destino no Exterior Informado está inválido na Tabela SISCOMEX De País Iso-2 (CG). |
| `EKU` | Tipo de registro fora da sequência esperada. |
| `EKV` | Indicador de Contêiner Ships Convenience informado, porém diferente de “S”. |
| `EKW` | Número de Contêiner Ships Convenience não deve ser preenchido quando indicador de Contêiner Ships Convenience diferente de “S”. |
| `EKX` | Tipo de Contêiner Ships Convenience não deve ser preenchido quando indicador de Contêiner Ships Convenience diferente de “S”. |
| `EKY` | Número do Lacre de Contêiner Ships Convenience não deve ser preenchido quando indicador de Contêiner Ships Convenience diferente de “S”. OBS: A mensagem refere-se ao número da ocorrência do contêiner ships convenience (Grupo). |
| `EKZ` | Número de Contêiner Ships Convenience não preenchido, ou preenchido, com formato inválido, para indicador de Contêiner Ships Convenience informado(Igual a “S”). |
| `EL0` | Número de Contêiner Ships Convenience inválido para indicador de Contêiner Ships Convenience informado(Igual a “S”). |
| `EL1` | Tipo de Contêiner Ships Convenience deve ser informado quando indicador de Contêiner Ships Convenience informado(Igual a “S”). |
| `EL2` | Tipo de Contêiner Ships Convenience não consta na Tabela Tipo de Contêiner(Tabela SISCOMEX) para indicador de Contêiner Ships Convenience informado(Igual a “S”). |
| `EL3` | Número do Lacre de Contêiner Ships Convenience deve ser informado quando indicador de Contêiner Ships Convenience informado(Igual a “S”). |
| `EL4` | Número e Tipo de Contêiner Ships Convenience devem ser informados quando indicador de Contêiner Ships Convenience informado(Igual a “S”). |
| `EL5` | Item de Carga (Tipo Contêiner), sem informação de Número do Lacre. |
| `EL6` | Tipo de Declaração de Exportação quando preenchido deve ser 1 ou 2 ou 3, correspondente ao campo Número da Declaração de Exportação. |
| `EL7` | Número do Contêiner duplicata nos Registros de Contêiner Vazio. |
| `EL8` | Número do Contêiner duplicata nos Registros de Item de Carga do mesmo Conhecimento. |
| `EL9` | Nro do Contêiner duplicata entre os Registros; Contêiner Vazio e Item de Carga. |
| `ELA` | Nro do Contêiner duplicata entre os Registros de Item de Carga de Conhecimentos diferentes. |
| `ELB` | Identificação do Consignatário deve ser preenchido, quando Indicador de Entrega no Exterior for Informado (Igual a ‘S’). |
| `ELC` | Indicador da Função de Inclusão/Associação e Tipo Carga do Registro M4, Deve ter sua 2a. posição preenchida obrigatoriamente com ‘1’ ou ‘3’. |
| `ELD` | A segunda posição do campo Indicadores da Função/Associação e Tipo de Carga incompatível com o tráfego do Conhecimento informado, a ser associado. |
| `ELE` | Indicador da Função de Inclusão/Associação e Tipo Carga do Registro M6, Deve ter sua 2a. posição preenchida obrigatoriamente com ‘I’ ou ‘E’ ou ‘P’. |
| `ELF` | Indicador da Função de Inclusão/Associação e Tipo Carga do Registro ME, Deve ter sua segunda posição preenchida obrigatoriamente com ‘E’. |
| `ELG` | O MASTER deste conhecimento filhote não está no seu porto de destino final. |
| `ELH` | Não permitido associar. Existe pelo menos um conhecimento filhote deste MASTER com NIC vinculado. |
| `ELI` | Item de Carga tipo = contêiner ou granel não deve existir para conhecimento com Existência de Ships Convenience. |
| `ELJ` | O conteúdo da Modalidade de Frete = NA (Não se Aplica), não permite a existência de Item de Carga Tipo = Contêiner, para o respectivo Conhecimento. |
| `ELK` | Porto de Transbordo no Exterior deve ser Porto Estrangeiro. |
| `ELL` | CE-MERCANTE Original não deve ser BL Serviço (IN-BL-SERVICO igual a ‘S’). |
| `ELM` | Data de Validade da Agência Desconsolidadora cadastrada como Substabelecida está vencida no cadastro de Subestabelecimento. |
| `ELN` | Agência de Navegação não é cadastrada como Desconsolidadora. |
| `ELO` | Agência Desconsolidadora não representa o NVOCC. |
| `ELP` | Data de validade da representação da Agência Desconsolidadora em relação ao NVOCC, encontra-se vencida. |
| `ELQ` | Empresa não cadastrada como NVOCC. |
| `ELR` | CNPJ / CPF Emitente da Nota Fiscal não Ativo no Cadastro (CNPJ / CPF). |
| `ELS` | Arquivo Incompleto. |
| `ELT` | Indicador de BL Serviço não pode ser ‘N’ para o Tipo de Tráfego informado. |
| `ELU` | CPF não pertence a Agência de Navegação. |
| `ELV` | CPF não pertence a Empresa de Navegação. |
| `ELX` | Empresa de Navegação deve ser nacional quando a Agência de Navegação não for informado. |
| `ELY` | Empresa NVOCC não representa Consignatário do Conhecimento MASTER. |
| `ELZ` | Não pode haver Códigos de Mercadorias repetidos no mesmo Item. |
| `ELW` | Desconsolidação não permitida. CE-MERCANTE já vinculado a DI, DSI ou DTA. |
| `EM0` | Não Permitida a Inclusão de Manifesto de Empresa NVOCC. |
| `EM1` | Para Código de Empresa de Navegação Estrangeira deve-se informar Agência de Navegação com CNPJ válido. |
| `EM2` | Terminal Portuário de Carregamento X Recinto Alfandegado inconsistentes na tabela MERCANTE |
| `EM3` | Código do SERARR inexistente na Tabela. |
| `EM4` | Data de Emissão do Conhecimento não informada. |
| `EM5` | Terminal Portuário de Carregamento não deve ser informado para este tipo de tráfego. |
| `EM6` | Terminal Portuário de Descarregamento não deve ser informado para este tipo de tráfego. |
| `EM7` | Soma dos pesos dos Itens maior que 999.999.999,999 kg. |
| `EM8` | Indisponibilidade de realizar conversão/cotação de moeda estrangeira. |
| `EM9` | CPF não pertence a Agência Desconsolidadora. |
| `EMA` | Não é permitido desconsolidar. Conhecimento bloqueado pelo Sistema Carga. |
| `EMB` | Código NCM do Item é obrigatório se no Conhecimento de Passagem for informado Porto de Destino Nacional. |
| `EMC` | Associação deste Conhecimento não permitida. O conhecimento MASTER do House informado ainda não foi Desunitizado. Faça Associação pelo CE MASTER. |
| `EMD` | Limite de 191 Códigos de Erros por registro / linha atingido. Favor corrija e resubmeta o arquivo. |
| `EME` | Campo Indicador de carga movimentada na estadia inválido, isto é, diferente de "S", de "N" e de branco. |
| `EMF` | Item de Carga ou CE-MERCANTE não encontrado no sistema. |
| `EMG` | Campo Quantidade da carga perigosa diferente de branco e não numérico. |
| `EMH` | Campo Volume da Carga Perigosa diferente de branco e não numérico. |
| `EMI` | Campos de Item Complementar informados já se encontram na Base MERCANTE. |
| `EMJ` | Campo Código ONU da Mercadoria – Número ONU diferente de branco e não numérico. |
| `EMM` | Campo Ficha de Emergência para derramamento inválido, isto é, diferente de "S", de "N", e de branco. |
| `EMO` | Campo Número do Pacote (IMO) diferente de branco e não numérico. |
| `EMP` | Campo Reserva / Número de referência diferente de branco e não numérico. |
| `EMQ` | Campo Peso Líquido - Massa (Kg) diferente de branco e não numérico. |
| `EMS` | Campo Ponto de fulgor (em graus Celsius) diferente de branco e não numérico. |
| `EMT` | Campo Código da prioridade da carga perigosa diferente de branco e não numérico. |
| `EMV` | Campo Temperatura do produto em graus Celsius diferente de branco e não numérico. |
| `EMY` | Campo Indicador de utilização embalagem de madeira inválido, isto é, diferente de "S", de "N" e de branco. |
| `EMZ` | Campo Embalagem de madeira bruta dever ser informado quando Indicador de utilização embalagem de madeira for informado com "S". |
| `EMW` | Campo Embalagem de madeira bruta diferente de 720, 721 ou 722. |
| `EN0` | Campo Número de identificação da mercadoria diferente de branco e não numérico. |
| `EN2` | Campo Indicador de Carga de madeira bruta inválido, isto é, diferente de "S", de "N" e de branco. |
| `EN3` | Campo Indicador de Carga de madeira bruta deve ser informado apenas para Itens Tipo Granel e Carga Solta. |
| `EN4` | Campo Temperatura do contêiner em graus Celsius diferente de branco e não numérico. |
| `EN5` | Campo Temperatura do contêiner em graus Celsius só dever ser informado quando o Item for Tipo Contêiner. |
| `EN7` | Campo Marca da mercadoria só deve ser informado quando o Item for Tipo Contêiner. |
| `EN9` | Campo Contramarca da mercadoria só deve ser informado quando o Item for Tipo Contêiner. |
| `EOA` | Campo Quantidade de volumes diferente de branco e não numérico. |
| `EOB` | Campo Quantidade de volumes só dever ser informado quando o Item for Tipo Contêiner. |
| `EOC` | Campo Indicador de utilização embalagem de madeira se diferente de branco, deve ser informado apenas para Itens Tipo Contêiner, Granel e Carga Solta. |
| `EOD` | Campo Embalagem de madeira bruta deve ser informado apenas para Itens Tipo Contêiner, Granel e Carga Solta. |
| `EOE` | Campo Número de identificação da mercadoria deve ser informado apenas para Itens Tipo Contêiner, Granel e Carga Solta. |
| `EOF` | Campo Descrição completa da marca ou BL deve ser informado apenas para Itens Tipo Contêiner, Granel e Carga Solta. |
| `ENH` | Item do Tipo Veículo não possui informações complementares. Todos os campos complementares não devem ser informados. |
| `ENI` | Tentativa de inclusão de item temporário já cadastrado. |
| `ENJ` | Tentativa de inclusão de item definitivo já cadastrado. |
| `ENK` | Tentativa de inclusão de item provisório já cadastrado. |
| `ENL` | Tentativa de efetivar item provisório não cadastrado. |
| `ENM` | Tentativa de efetivar item provisório já efetivado com mesmo CE-MERCANTE. |
| `ENN` | Tentativa de efetivar item provisório já efetivado com outro CE-MERCANTE. |
| `ENO` | Tentativa de efetivar item temporário não cadastrado. |
| `ENP` | Tentativa de efetivar item temporário já efetivado com mesmo CE-MERCANTE. |
| `ENQ` | Tentativa de efetivar item temporário já efetivado com outro CE-MERCANTE. |
| `ENR` | Dados complementares não encontrados para este item. |
| `ENS` | Tentativa de exclusão de item provisório que já foi efetivado com CE-MERCANTE. |
| `ENT` | Campo Temperatura do contêiner fora do intervalo de –272 a 9726 graus Celsius. |
| `ENU` | Campo Temperatura do produto fora do intervalo de –272 a 9726 graus Celsius. |
| `ENV` | Campo Ponto de fulgor fora do intervalo de –272 a 9726 graus Celsius. |
| `ENX` | Não é possível informar, via EDI / UPLOAD, dados de Item Complementar para CE do Tipo Provisório. |
| `ENY` | CE-MERCANTE não encontrado no sistema. |
| `EOG` | Campo Código NCM de Mercadoria (no Dado Complementar) não informado. |
| `EOH` | Campo Código NCM de Mercadoria (no Dado Complementar) diferente de 8 posições numéricas ou diferente de 4 posições numéricas + 4 brancos. |
| `EOI` | Campo Código IMO da Mercadoria Perigosa não informado ou inválido. |
| `EOJ` | Campo Nome Técnico do Produto deve ser informado quando "Código IMO da Mercadoria Perigosa" for preenchido. |
| `EOK` | Campo Indicador de carga movimentada deve ser informado com "S" ou "N" quando "Código IMO da Mercadoria Perigosa" for preenchido. |
| `EOL` | Campo Marca da Mercadoria só deve ser informado quando o Item for Tipo Contêiner. |
| `EOM` | Campo Marca da Mercadoria não informado para Item do Tipo Contêiner. |
| `EON` | Campo Contramarca da Mercadoria só deve ser informado quando o Item for Tipo Contêiner. |
| `EOO` | Campo Quantidade de Volumes só deve ser informado quando o Item for Tipo Contêiner. |
| `EOP` | Campo Quantidade de Volumes não informado ou inválido para Item do Tipo Contêiner. |
| `EOQ` | Campo Tipo de Embalagem só deve ser informado quando o Item for Tipo Contêiner. |
| `EOR` | Campo Tipo de Embalagem não informado ou inválido para Item do Tipo Contêiner. |
| `EOS` | Campo Indicador de carga movimentada deve ser preenchido com branco quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EOT` | Campo Packing Group deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EOU` | Campo Quantidade de Carga Perigosa deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EOV` | Campo Volume de Carga Perigosa deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EOX` | Campo Código IMO da Mercadoria Perigosa dever ser informado quando dados de Mercadoria Perigosa forem preenchidos. |
| `EOY` | Campo Código ONU da Mercadoria - NÚMERO ONU deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EOZ` | Campo Divisão de Risco deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EOW` | Campo Classe da Mercadoria Perigosa deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO0` | Campo Espécie de Pacotes deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO1` | Campo Indicador Ficha de Emergência para Derramamento deve ser preenchido com branco quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO2` | Campo Nome Técnico do Produto deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO3` | Campo Reserva / Número de Referência deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO4` | Campo Peso Líquido - Massa deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO5` | Campo Identificação do Poluente Marinho deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO6` | Campo Ponto de Fulgor deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO7` | Campo Código da Prioridade da Carga Perigosa deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO8` | Campo Motivo da Prioridade da Carga Perigosa deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EO9` | Campo Temperatura do Produto deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EPA` | Campo Posição de Estivagem deve ser preenchido com brancos quando "Código IMO da Mercadoria Perigosa" não for informado. |
| `EPB` | Não é permitido informar Dado Complementar para Conhecimento Filhote |
| `EPC` | Campo Embalagem de madeira bruta deve ser preenchido com brancos quando "Indicador de utilização embalagem de madeira" não for informado. |
| `EPD` | Código NCM informado não encontrado no Item do Conhecimento. |
| `EPE` | Usuário não autorizado a Incluir ou Alterar Dados Complementares para o Item do Conhecimento informado. |
| `EPF` | Problema ao validar situação de CPF e/ou CNPJ na base. |
| `EPG` | Erro na sub-rotina de acesso ao Cadastro de CPF e/ou CNPJ. |
| `EPH` | Campo Número Sequencial do Item de Carga (no Dado Complementar) não numérico. |
| `EPI` | Campo Número do CE-MERCANTE (no Dado Complementar) não numérico. |
| `EPJ` | Sequencial de identificação de Mercadoria do Dado Complementar a ser alterado não encontrado na base. |
| `EPK` | Campo Tipo de Embalagem informado não existe na tabela. |
| `EQ0` | Campo Nome de Consignatário Estrangeiro LCE é obrigatório. |
| `EQ1` | Campo Endereço do Consignatário Estrangeiro LCE é obrigatório. |
| `EQ2` | Campo Identificação DU-E deve estar em branco quando o campo Tipo de declaração de exportação não for informado. |
| `EQ3` | Campo Identificação RUC deve estar em branco quando o campo Tipo de declaração de exportação não for informado. |
| `EQ4` | Campo Tipo de declaração de exportação deve ser numérico entre valores 1 a 3 e 5 a 7 apenas. |
| `EQ5` | Campo Identificação DU-E só pode ser informado quando o campo Tipo de declaração de exportação for '6'. |
| `EQ6` | Campo Identificação RUC só pode ser informado quando o campo Tipo de declaração de exportação for '7'. |
| `EQ7` | Campo Identificação DU-E é obrigatório para o campo Tipo de declaração de exportação igual a '6'. |
| `EQ8` | Campo Identificação RUC deve estar em branco para o campo Tipo de declaração de exportação igual a '6'. |
| `EQ9` | Campo Identificação DU-E deve estar em branco para o campo Tipo de declaração de exportação igual a '7'. |
| `EQA` | Campo Identificação RUC é obrigatório para o campo Tipo de declaração de exportação igual a '7'. |
| `EQB` | Campo Tipo de declaração de exportação deve ser preenchido entre os valores 1 a 3 e 5 a 7 apenas. |
| `EQC` | Campo Identificação DU-E não possui 14 posições ou no formato inválido. |
| `EQD` | Digito Verificador do Campo Identificação DU-E inválido. |
| `EQE` | Campo Identificação RUC não possui ao menos 12 posições ou no formato inválido. |
| `EQF` | Campos Número da Declaração de Exportação e Identificação DU-E preenchidos. Informe apenas um documento de Exportação, conforme domínio descrito no layout. |
| `EQG` | Campos Número da Declaração de Exportação e Identificação RUC preenchidos. Informe apenas um documento de Exportação, conforme domínio descrito no layout. |
| `EA0` | Conteúdo ou Assinatura Digital corrompida. |
| `EA1` | Conteúdo sem Assinatura Digital. |
| `EA2` | Certificado encontra-se expirado. |
| `EA3` | A Certificação está revogada. |
| `EA4` | Erro no processamento na Assinatura Digital. |
| `EA5` | O Certificado pertence a um CNPJ. |
