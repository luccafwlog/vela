---
name: security-audit-penetration-testing
description: "Use when the user requests a scoped security audit or an authorized penetration test of an accessible target."
metadata:
  trigger_phrases:
    - security audit
    - penetration test
    - pentest
    - vulnerability scan
    - security check
    - verifique vulnerabilidades
    - faça uma auditoria de segurança
    - teste de penetração
  version: "1.1"
  category: Security
  author: Claude Security Framework
---

# Auditoria de segurança e teste de penetração

Realize uma avaliação de segurança com escopo explícito, evidência verificável
e autorização adequada. Auditoria estática, análise de dependências, revisão de
configuração e teste ativo são atividades diferentes; declare qual foi feita.
Esta skill não promete cobertura completa, ausência de vulnerabilidades ou
prontidão para produção.

## Escopo e autorização

Antes de qualquer teste ativo, confirme:

- alvo, ambiente e proprietário;
- autorização explícita e janela de teste;
- ativos, endpoints, contas e dados dentro e fora do escopo;
- métodos permitidos, limites de carga e tratamento de credenciais/dados;
- se o pedido é apenas auditoria/relatório ou também remediação.

Sem autorização, alvo ou ambiente claramente definidos, faça somente análise
local não intrusiva e informe o bloqueio. Nunca teste produção, terceiros ou
serviços externos, use credenciais reais, provoque indisponibilidade, exfiltre
dados ou deixe persistência sem autorização específica. Uma auditoria não
autoriza mudança, commit, deploy ou publicação.

O padrão seguro é análise local, estática e sem tráfego ativo. Teste ativo,
scan externo, tentativa de exploração e validação antes/depois só entram depois
que alvo, ambiente, autorização, janela e limites estiverem confirmados.

Toda comunicação dirigida ao usuário — perguntas, aprovações, recomendações,
achados e relatório — deve ser em português do Brasil (pt-BR), salvo pedido
explícito em contrário. Preserve comandos, caminhos, identificadores, código,
URLs e termos técnicos quando necessário.

Ao descrever impacto no Vela, comece pela página, fluxo, ação ou dado que a
pessoa reconhece — por exemplo, acesso à página `BLs`, vínculo de uma Viagem ou
emissão de uma fatura — e depois explique o endpoint, política, query ou
configuração envolvida. Use `CONTEXT.md` para manter o vocabulário do sistema;
não esconda o risco atrás de jargão de segurança.

## Fluxo de trabalho

### 1. Descoberta controlada

Leia o repositório e as configurações acessíveis para identificar linguagem,
framework, fronteiras de autenticação, dados sensíveis, integrações e comandos
de teste. Use somente ferramentas disponíveis no harness. Não diga que um scan
ou uma detecção automática ocorreu se ele não foi executado.

### 2. Modelo de risco

Relacione os riscos ao contexto real do alvo. OWASP Top 10, CWE/SANS, CVSS e
NIST podem orientar a análise, mas não substituem evidência nem constituem uma
lista exaustiva. Registre premissas, superfícies não avaliadas e limitações.

### 3. Auditoria

Procure vulnerabilidades no código, dependências, configuração, autenticação,
autorização, exposição de segredos, validação de entrada, logs e fronteiras de
dados, conforme o escopo. Para cada achado, registre:

- severidade e justificativa contextual;
- arquivo, linha, endpoint ou componente afetado;
- condição necessária e impacto provável;
- evidência ou reprodução segura, sem ampliar o dano;
- correção recomendada e risco residual.

Não transforme uma hipótese em vulnerabilidade confirmada. Diferencie achado
confirmado, indício, risco aceito, falso positivo e área não verificada.

Para cada risco material, inclua um exemplo hipotético no vocabulário do Vela.
Por exemplo: “Se uma pessoa sem a permissão correta conseguir abrir a ficha de
um B/L por uma URL direta, ela pode visualizar dados do cliente ou alterar uma
decisão de COD?” O exemplo deve explicar o impacto possível; não é prova de que
a falha existe.

### 4. Plano de remediação

Se o usuário pediu apenas a auditoria, entregue os achados e pare. Se pediu
remediação, apresente um plano priorizado antes de editar, com o quê, por quê,
onde, como, impacto, checks e rollback. Aguarde aprovação explícita para
mudanças que não estejam claramente autorizadas.

### 5. Validação segura

Execute testes antes/depois somente em ambiente autorizado e controlado, com
dados descartáveis ou mascarados. A prova deve ser reproduzível e limitada ao
objetivo do achado. Se não houver ambiente, ferramenta, acesso ou teste seguro,
marque a remediação como não verificada; não invente resultado nem declare
100% de mitigação.

### 6. Relatório

Entregue um relatório com resumo executivo, escopo e autorização, método e
ferramentas realmente usadas, achados priorizados, remediações, evidências,
checks executados, limitações, risco residual e timestamp. Preserve relatórios
anteriores; não descarte evidência histórica.

## Limites de atuação

- Auditoria e recomendações não concedem autorização para exploração, correção,
  push, merge, deploy ou alteração de produção.
- Solicitações que misturem segurança com implementação devem separar descoberta,
  decisão, remediação e validação; encaminhe o plano para `writing-plans` ou a
  execução para `executing-plans` quando aplicável.
- Achados de revisão de código recebidos de outra pessoa pertencem ao modo
  `receber` de `vela-code-review`; solicitação de parecer independente pertence
  ao modo `solicitar`.
- Se a correção de segurança mudar o comportamento de uma página, a permissão
  para consultar BLs, a emissão de uma fatura ou a operação de uma Taxa Local,
  separe o risco técnico da decisão de produto. Pergunte ao usuário antes de
  escolher silenciosamente entre bloquear, permitir ou manter o fluxo atual.
- Se a capacidade necessária estiver ausente, registre a lacuna e entregue o
  resultado parcial verificável. Nunca simule um pentest ou uma ferramenta.
