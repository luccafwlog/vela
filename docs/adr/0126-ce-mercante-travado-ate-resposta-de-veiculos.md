# 0126 — CE Mercante de container travado até Equipamentos responder sobre veículos

Status: aceito — 2026-11-06 (decisão do dono, com os times de Documentação e
Equipamentos). Implementada nas migrations `595` e `596`.

## Contexto

O B/L de veículo em LCL é isento de Taxas Locais
([Taxas Locais § Movimento e Isenção](../modules/taxas-locais.md#movimento-e-isenção-de-taxas-locais)),
mas o sistema só sabe que há veículo quando Equipamentos importa a planilha de
Veículos. Quando a Documentação vincula o CE Mercante antes, a fatura sai pelo
CE e o B/L de veículo é cobrado cheio.

A migration `468` (decisão do dono de 2026-10-27) abriu em D-5 do primeiro ETA
brasileiro o alerta crítico "Planilha de Veículos pendente" para Equipamentos,
com a declaração "Esta viagem não terá veículos". O alerta só avisava; não
segurava o CE nem a emissão. Em 2026-11-05/06, o dono, a Documentação e
Equipamentos concluíram que avisar não basta: a ordem do processo precisa ser
garantida pelo sistema.

## Decisão

1. **Resposta em D-7.** Sete dias antes do primeiro ETA brasileiro, a viagem
   ativa com B/L de container ou misto e sem veículo importado abre o alerta
   **Declaração de veículos pendente** (Normal, Equipamentos). Equipamentos
   responde na tela Veículos: "Esta viagem terá veículos" ou "Esta viagem não
   terá veículos". Quem responde é Equipamentos; a Documentação só sente a
   trava (decisão do dono, 2026-11-06).
2. **"Não terá veículos"** fecha o alerta, libera o CE Mercante e nenhum outro
   alerta de veículos é emitido para a viagem.
3. **"Terá veículos"** fecha o alerta de D-7 e trava o primeiro CE Mercante de
   todo B/L de container ou misto da viagem. A trava sai com o primeiro veículo
   importado na viagem: o sistema não sabe quantos veículos ou containers são
   esperados, e um basta.
4. **D-5.** Sem veículo importado, a viagem que respondeu "terá veículos" ou
   que não respondeu recebe o crítico **Planilha de Veículos ausente** (o tipo
   da `468`, renomeado). A viagem sem resposta passa do alerta Normal ao
   crítico em D-5 (decisão do dono, 2026-11-06); a gravidade é do tipo, por
   isso a passagem troca o alerta de D-7 pelo crítico.
5. **Regra do CE.** A partir desta decisão, o primeiro CE Mercante de B/L de
   container ou misto só é vinculado na viagem declarada sem veículos ou na
   viagem com veículo importado. Viagem sem resposta também trava, mesmo antes
   de D-7.
6. **Fora da trava** (decisões do dono, 2026-11-06): B/L de carga solta, porque
   a planilha de Veículos casa veículo com container; viagem concluída ou
   cancelada; e a correção ou remoção de CE já vinculado, que não é vinculação
   nova.
7. **Viagens em andamento no dia da publicação.** A trava vale na hora para
   toda viagem ativa sem resposta e sem veículo, inclusive as que chegam nos
   dias seguintes: a resposta é um clique, e os dois times são avisados no dia
   (decisão do dono, 2026-11-06).
8. **Trocar a resposta** exige motivo; desfazer também. Veículo importado na
   viagem declarada "não terá" desfaz a declaração sozinho, como na `468`; a
   resposta "terá" continua.
9. **Quem pode responder** (decisão do dono de 2026-11-06, na revisão da PR,
   migration `596`): só Equipamentos e o Administrativo respondem, trocam e
   desfazem a resposta, no banco e na tela, como em Responder Disputa. A
   Documentação não solta a própria trava. Importar, mover e excluir veículos
   continuam de qualquer setor: o veículo importado é fato e libera o CE.

## Consequências

- A Documentação não consegue mais vincular CE de container antes de
  Equipamentos responder; a prévia da planilha de CE Mercante diz o que falta.
  O CE Mercante pendente de D-5 continua cobrando a Documentação; com a viagem
  travada, a saída é Equipamentos responder ou importar a planilha.
- A trava fica no banco (prévia e gatilho em `bls`), não só na tela.
- A viagem respondida passa a ter um filho a mais na exclusão; a lista
  `voyage_delete_children_spec` o leva junto. Antes, a viagem declarada "sem
  veículos" (`468`) não se excluía.

## Onde está a regra

[Manifestos & EDI § CE Mercante](../modules/manifesto-edi.md#ce-mercante) e
[§ /veiculos](../modules/manifesto-edi.md#veiculos);
[Operação e Suporte § Alertas](../modules/operacao-suporte.md#alertas-e-notificações-internas).
