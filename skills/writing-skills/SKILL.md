---
name: writing-skills
description: "Use when the user asks to create, refine, validate, or govern a reusable skill and its supporting references."
---

# Writing skills

Maintain this repository's skills in `skills/<name>/`; installation is described
in [the skill catalog](../README.md). Preserve attribution, licenses and existing
invocation policy when editing vendored skills.

## Idioma e autorização

Quando a skill em revisão fizer perguntas, apresentar alternativas ou aguardar
aprovação, conduza essa comunicação em português do Brasil (pt-BR), salvo pedido
explícito em contrário. Preserve comandos, caminhos, identificadores, código e
termos técnicos quando necessário.

Ao manter uma skill que será usada no Vela, preserve ou acrescente instruções
para que a comunicação comece pela linguagem das páginas e fluxos do sistema.
Use `CONTEXT.md` como glossário e descreva ação, efeito visível e conexão entre
áreas antes de explicar a implementação. Isso vale especialmente para skills de
UI, planejamento, revisão, auditoria, handoff e entrevista.

Editar uma skill não autoriza publicar, alterar produção, instalar plugins,
enviar mensagens ou mudar configurações globais. Faça apenas as mudanças no
repositório e nos destinos de sincronização que o pedido abranger.

## Fonte e sincronização

No Vela, skills próprias são editadas somente em skills/<nome>/ no repositório.
Diretórios globais são artefatos materializados, não fontes alternativas:

- não corrija uma cópia em Claude, Codex, Antigravity ou .agents como
  manutenção permanente;
- revise npm run skills:sync -- --dry-run antes de aplicar uma sincronização;
- use o sincronizador para copiar a árvore completa e remover somente
  ownership registrado do Vela;
- rode npm run skills:sync -- --check depois da aplicação;
- preserve skills de sistema, plugins e harnesses, mesmo quando tenham nomes
  parecidos.

Se houver divergência entre o repositório e uma cópia local, investigue a
origem antes de sobrescrever. Não use git reset, git clean ou poda ampla para
resolver a diferença.

Keep `name` and `description` concise: state the capability and the actual task
that benefits from it. Avoid catchall triggers and claims that the skill must
run before every response or edit.

Put purpose, essential invariants and routing in `SKILL.md`. Move substantial
mode-specific examples and procedures to focused references, linked with a clear
reason to read them. Keep a short self-contained skill in one file.

Para uma skill vendorizada, preserve o comportamento de invocação, a licença e
a proveniência; uma adaptação local deve ser deliberada e não fingir ser uma
cópia upstream. Não remova uma propriedade de frontmatter apenas para agradar
um validador que não conhece a política do harness. Registre a incompatibilidade
e preserve a semântica, ou peça uma decisão antes de alterá-la.

Prefer outcomes and decision criteria over fixed rituals. Keep concrete safety
boundaries and project contracts; remove duplicated advice, unavailable tool
requirements and obsolete paths. A skill cannot grant permission to publish,
change production or expand the request.

Validate frontmatter, links and supporting scripts when changed. Review realistic
routing examples: an intended task should select the skill, an adjacent unrelated
task should not. Behavioral experiments or independent review are useful for
complex workflows when authorized; ordinary prose edits need no mandatory
subagent test loop. If the official validator is unavailable or rejects a
harness-supported property, report the exact limitation and run the remaining
equivalent checks; do not claim a clean validation. Do not turn every
hypothetical failure into another rule.

Quando uma alteração muda comportamento, escreva antes uma pequena matriz de
cenários: pedido que deve ativar a skill, pedido próximo que não deve ativá-la,
comportamento obrigatório, comportamento proibido e informação que deve gerar
pergunta. Use pelo menos um exemplo do fluxo do Vela quando a skill conversar
com o usuário. Valide os cenários depois da edição e registre limitações sem
confundir validação estrutural com prova de comportamento.
