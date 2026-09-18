---
name: grilling
description: "Use when the user wants to stress-test a plan, decision, or idea through a structured interview, with optional explicit persistence of confirmed decisions."
---

# Entrevista e decisões

Esta é a entrada canônica para entrevistas estruturadas no Vela. Ela combina o
motor de rounds e frontier com dois modos de saída:

- **sem persistência** — entrevista, confirma entendimento e não altera arquivos,
  issues, configuração ou código;
- **persistência confirmada** — além da entrevista, registra somente decisões
  duráveis que o usuário confirmou explicitamente no artefato vivo apropriado.

A persistência nunca é presumida. Se o usuário não disser que quer registrar a
decisão, conduza o modo sem persistência. Se a intenção estiver ambígua,
pergunte em português do Brasil antes de escrever o primeiro documento.

## Roteamento

- Use esta skill quando o trabalho precisa de perguntas dependentes para
  estressar uma ideia, plano ou decisão.
- Use o modo **sem persistência** quando a conversa deve apenas esclarecer ou
  testar o raciocínio.
- Use o modo **persistência confirmada** quando o usuário pedir que as decisões
  sobrevivam à sessão em `CONTEXT.md`, ADR, plano, spec ou issue.
- Use `wayfinder` quando a iniciativa ainda é grande, nebulosa e depende de um
  mapa de decisões e tickets entre sessões.
- Use `writing-plans` quando as decisões estão fechadas e falta produzir um
  plano executável; use `executing-plans` quando o plano já existe.
- Não transforme uma entrevista em implementação. Código, mudança de
  configuração, execução de issue ou handoff exigem o workflow correspondente.

## Idioma e linguagem do sistema

Conduza perguntas, recomendações, alternativas, confirmações e encerramento em
português do Brasil (pt-BR), salvo pedido explícito em contrário. Preserve
comandos, caminhos, labels, identificadores, código, citações e termos técnicos
quando necessário.

Quando o assunto for o Vela, use primeiro o vocabulário de `CONTEXT.md` e da
interface: página, ação, campo, coluna, filtro, estado e consequência no fluxo.
Não faça a pessoa traduzir uma pergunta de código para descobrir qual mudança
de Viagem, B/L, Escala ou outra entidade está sendo discutida.

## Método de entrevista

Modele o assunto como uma **árvore de decisões**: cada decisão abre os pontos
que dependem dela. Trabalhe em **rounds**. A **frontier** contém as perguntas
cujos pré-requisitos já foram resolvidos; são as perguntas que podem ser feitas
agora sem adivinhar respostas ainda não ouvidas.

1. Faça toda a frontier disponível em um round.
2. Numere cada pergunta e apresente uma recomendação com o motivo.
3. Espere as respostas antes de avançar.
4. Recalcule a frontier depois de cada resposta; uma pergunta dependente de
   outra ainda aberta fica para o round seguinte.

Use este formato:

```text
❓ **Q1** — **<título da pergunta>**: <corpo da pergunta, com alternativas quando necessário>

➡️ **Recomendação:** <resposta recomendada e seu motivo>
```

Descobrir fatos é responsabilidade do agente. Quando a pergunta depender de
filesystem, código ou ferramenta, consulte o ambiente atual em vez de pedir ao
usuário um fato que pode ser verificado. Se a capacidade necessária não
existir, declare a lacuna; nunca invente subagente, resultado ou fato. As
decisões continuam sendo do usuário.

## Persistência confirmada

Depois que o usuário confirmar uma decisão, classifique-a antes de editar:

- **`CONTEXT.md`:** termo de domínio, definição ou regra de negócio canônica;
- **ADR nova ou nota editorial:** decisão arquitetural, de segurança, dados ou
  contrato durável que afeta trabalhos futuros;
- **plano, spec ou issue:** escolha específica desta tarefa, detalhe de
  implementação, aceite ou pendência;
- **nenhum documento:** preferência temporária, hipótese rejeitada, decisão não
  confirmada ou opt-out explícito.

No modo de persistência:

1. Leia as fontes relevantes antes de editar; para mudanças documentais amplas,
   siga `CLAUDE.md`, `docs/README.md` e `docs/CONVENCOES.md`.
2. Mantenha decisões ainda abertas somente na conversa.
3. Após cada confirmação, atualize apenas o documento vivo necessário e informe
   ao usuário o arquivo e a seção alterados.
4. Preserve histórico, não crie `glossary.md` genérico, não duplique decisões e
   não registre hipótese como decisão aceita.
5. Se o usuário retirar a autorização de persistência, pare de editar e continue
   sem escrita, se ele desejar.

## Encerramento

A entrevista termina quando a frontier estiver vazia, as ramificações relevantes
tiverem sido visitadas e nada material permanecer silenciosamente assumido.
Resuma decisões, pendências e próximos encaminhamentos em pt-BR. Peça
confirmação de entendimento compartilhado antes de qualquer handoff.

Não execute código, altere configuração, publique, faça commit, envie mensagem
ou crie issue por conta própria. No modo sem persistência, não altere documentos;
no modo de persistência, altere somente o artefato explicitamente autorizado e
após a confirmação da decisão correspondente.
