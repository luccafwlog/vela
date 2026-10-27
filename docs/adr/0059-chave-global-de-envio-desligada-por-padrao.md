# ADR 0059 — Chave global de envio de Comunicados, desligada por padrão

> **Situação atual (2026-10-27).** Pela [ADR 0104](./0104-marca-dev-e-chave-de-envio-pelo-suporte.md)
> (migration `469`): desligada, a chave não registra simulação sem enviar: todo
> e-mail dirigido a Cliente, inclusive o transacional do Portal, sai para
> `suporte@portalfwlog.com.br`, com o Cliente no assunto. Só a conta do
> Administrativo com a marca Dev muda a chave; todos os setores a leem. O texto
> abaixo é o registro da decisão original. Regra vigente:
> [Clientes § Chave de envio](../modules/clientes.md#chave-de-envio-de-comunicados).

Status: supersedida parcialmente — 2026-10-27 pela [ADR 0104](./0104-marca-dev-e-chave-de-envio-pelo-suporte.md); aceito em 2026-08-27.

## Contexto

O canal de Comunicado ao Cliente (ADR 0058) envia e-mail em massa a clientes
reais, a partir de uma tela operada por três perfis internos. O sistema está em
desenvolvimento e teste, e um disparo indevido é irreversível.

O projeto não tem tabela de configuração global: não existe hoje um lugar onde
uma chave desse tipo possa morar.

## Decisão

- Existe **uma** chave que habilita ou silencia todo o canal de Comunicado.
- A chave nasce **desligada**. Ligar é ato deliberado do perfil
  `administrativo`, registrado em `audit_logs`.
- **Ligar exige guarda própria.** A permissão `customer_communications` da ADR
  0060 é do módulo, não da chave: ela é concedida também a `documentacao` e
  `equipamentos`, e sozinha deixaria qualquer um dos três ligar o envio real.
  A escrita da chave é restrita a `administrativo` e verificada **no servidor**
  — a ausência do botão na tela não é a guarda. A leitura fica com os três
  perfis, porque a faixa permanente depende dela.
- O escopo é **todo** o canal — manual e automático. Não há meio-termo que
  deixe o disparo manual passar.
- A chave **não afeta** o email transacional do Portal: convite, reenvio,
  recuperação de senha e alteração de email continuam saindo normalmente.
- Com a chave desligada, a tela de Comunicação **funciona inteira** — filtros,
  recorte, conferência, prévia — e o disparo é registrado como **simulado**, com
  essa marca visível no histórico, em vez de enviado.
- Enquanto desligada, a tela exibe faixa permanente informando o estado.

## Consequências

O estado seguro é o estado inicial: um deploy novo, um ambiente novo ou uma
restauração nascem sem capacidade de enviar e-mail a cliente. A capacidade só
aparece por decisão registrada de alguém — e por decisão de `administrativo`,
não de qualquer um dos três perfis que operam o módulo. Sem essa separação a
chave protegeria contra o engano, mas não contra quem pode clicar.

O registro simulado permite validar o fluxo completo — recorte, preferências,
conferência, idempotência, histórico — sem tocar em cliente real, o que é
exatamente o que o desenvolvimento precisa. Em troca, o histórico passa a
conter comunicados que nunca saíram; eles são marcados, e qualquer leitura
precisa distinguir enviado de simulado.

A faixa permanente é requisito, não enfeite: um operador que confere quarenta
destinatários, clica em enviar e acredita ter enviado é pior desfecho do que a
tela não existir.

Restringir o escopo ao envio automático foi considerado e descartado: durante o
desenvolvimento, é justamente o disparo manual que alguém aciona por engano.
Especificação funcional em
[`../archive/specs/2026-08-27-comunicacao-email-clientes-design.md`](../archive/specs/2026-08-27-comunicacao-email-clientes-design.md).
