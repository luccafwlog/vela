# 0098 — Baplie não cria nem exige escala

Status: aceito — 2026-10-23 (decisão do dono do sistema na revisão da PR
luccafwlog/vela#1043). Implementada na migration `418`, que substitui a criação
de escala da migration `411`.

Supersede parcialmente o item 21 da
[ADR 0078](./0078-importacoes-e-ce-mercante-regras-de-entrada-e-correcao.md)
(container de porto brasileiro fora das escalas da Viagem deixa de ser só
ignorado) e a parte da decisão 13 da
[ADR 0095](./0095-importacoes-regras-da-revisao.md) em que o servidor recusava
o container fora das escalas.

## Contexto

Na revisão manual de 2026-10-22 (GREEN ITAJAI / 11), o Baplie trazia 242
containers com descarga em Sepetiba (BRSEP, apelido de BRIGI), porto sem
escala na Viagem, e só deixava importar os 672 de Vitória. O pedido D1 foi
oferecer o porto desmarcado e, marcado, criar a escala; a migration `411` fez
isso. Na revisão da PR, o dono corrigiu a regra: quem cria escala é Chegadas e
Saídas (a programação de navios, ao informar a data de um porto de destino) ou
o cadastro manual da Escala. O Baplie é complementar: container e carga só
nascem do B/L, e o Baplie não pode exigir escala vinculada aos containers.

## Decisão

1. **O Baplie nunca cria escala.** A gravação ignora o pedido de escala nova
   (`p_file.new_escalas`, da `411`).
2. **Importar o Baplie não depende de escala.** Na Viagem com escalas, o porto
   brasileiro do arquivo que não é escala aparece em "Portos de descarga a
   importar" **desmarcado**. Marcado, os containers dele entram no Baplie sem
   escala e ficam pendentes de conciliação com B/L até a escala ser criada por
   Chegadas e Saídas, pela programação ou à mão. Desmarcado, não entram.
3. **Viagem sem nenhuma escala** continua sem conferência de porto: tudo entra,
   como antes.
4. **Continuam recusados:** container de porto estrangeiro fora das escalas
   (a prévia o ignora, com aviso) e porto de escala omitida (a omissão é
   revertida na Viagem).

## Consequências

- A Viagem pode ter containers no Baplie num porto sem escala; eles não
  aparecem no Line-Up, que tem uma linha por escala (os vazios aparecem no
  aviso "vazios de importação sem escala" do Painel).
- Navegantes continua sendo outro porto que não Itajaí (ADR 0095, decisão 12):
  o Baplie de BRNVT numa Viagem com escala só em BRITJ entra sem escala, não na
  escala de Itajaí.
- O retorno de `import_baplie_file_atomic` troca `escalas_criadas` por
  `portos_sem_escala`.

## Evidência

**Teste local-pg:** `baplieSemEscala.local-pg.test.ts`,
`importacoesTravaEBaplie.local-pg.test.ts` e `portosSeparados.local-pg.test.ts`.
**Teste:** `baplieImport.test.ts` e `BaplieImportModal.test.tsx`.
