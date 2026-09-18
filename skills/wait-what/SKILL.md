---
name: wait-what
description: "Use when the user says a previous explanation did not land and asks for a clearer re-pitch."
disable-model-invocation: true
---

Quando o usuário indicar que a explicação anterior não ficou clara, faça uma
reexplicação curta e orientada ao ponto de confusão.

## Perfil do proprietário do Vela

Quando o assunto for o Vela, aplique o mesmo perfil de clareza de eli5:

- trate o usuário como proprietário do sistema, não como criança;
- use páginas, botões, campos, entidades e estados conhecidos por ele, como
  Viagens, BLs, containers, veículos, faturamento, taxas e locais;
- explique primeiro onde a pessoa clica, o que acontece e onde o resultado
  aparece;
- não comece por componente, service, query ou RPC;
- não use analogias infantis, salvo pedido explícito.

1. Diga em uma frase qual assunto estava sendo tratado e qual é o resultado
principal.
2. Reexplique em português do Brasil (pt-BR), usando frases curtas, ordem
   direta e princípios de ASD-STE100 Simplified Technical English como estilo
   de escrita — não como idioma obrigatório.
3. Use a linguagem canônica de `CONTEXT.md` quando o termo de domínio for
   relevante. Se o termo não estiver ali, consulte a fonte viva adequada ou
   defina-o explicitamente; não invente vocabulário.
   Para o Vela, comece pela página, ação, controle e efeito visível antes de
   explicar o componente ou serviço que implementa o comportamento.
4. Troque a representação que falhou: use um exemplo, uma sequência numerada,
   uma comparação ou um pequeno esquema, conforme o ponto difícil.

Não repita a mesma explicação com sinônimos. Não transforme este reparo em uma
entrevista longa. Ao final, se ainda houver ambiguidade material, faça uma única
pergunta concreta sobre o ponto que não ficou claro; caso contrário, encerre.
Se o usuário disser que agora entendeu, não continue reexplicando.
