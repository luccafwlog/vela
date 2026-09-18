# Revisão de interface antes da entrega

Leia esta referência no modo avaliar ou antes de entregar uma implementação de
interface. Ela adapta critérios de revisão para a aplicação web do Vela.

## Ordem de revisão

1. **Fluxo** — a pessoa entende em que página está, qual é a ação principal,
   quais dados precisa informar e o que acontece depois?
2. **Estados** — carregando, vazio, erro, sucesso, desabilitado, foco e
   conteúdo parcial estão previstos e são distinguíveis?
3. **Acessibilidade** — teclado, foco, nomes dos controles, contraste, leitura
   assistiva e movimento reduzido funcionam no caminho principal?
4. **Layout** — a composição preserva hierarquia, leitura, responsividade e
   conteúdo essencial nas larguras relevantes?
5. **Consistência** — a tela reutiliza tokens, componentes, ícones, espaçamento
   e padrões das páginas vizinhas?
6. **Desempenho** — feedback aparece cedo, imagens não provocam saltos e efeitos
   não prejudicam interação ou carregamento?
7. **Polimento** — alinhamento óptico, superfícies, tipografia e movimento
   reforçam o fluxo sem virar decoração.

## Checklist rápido

- [ ] A página, a seção e a ação principal estão claras.
- [ ] Botões, campos, dropdowns, modais e links têm estados e nomes coerentes.
- [ ] A ordem do teclado acompanha a ordem visual e o foco é visível.
- [ ] Contraste e significado não dependem somente de cor.
- [ ] Erros explicam causa e correção; sucesso confirma a próxima etapa.
- [ ] A tela continua utilizável em viewport estreito e amplo, sem zoom
      desabilitado ou rolagem horizontal acidental.
- [ ] Tabelas e gráficos têm leitura alternativa quando necessário.
- [ ] Movimento pode ser reduzido e não bloqueia interação.
- [ ] Tokens e componentes existentes foram preservados ou a exceção foi
      justificada.
- [ ] A verificação distingue o que foi observado do que ainda precisa ser
      conferido no navegador ou com tecnologia assistiva.

## Formato de achados

Para uma avaliação, prefira:

| Prioridade | Página/controle/estado | Evidência observada | Efeito no fluxo | Recomendação |
| --- | --- | --- | --- | --- |

Use a prioridade proporcional ao impacto. P0 deve representar bloqueio grave ou
risco crítico; P1, problema importante no caminho principal; P2, melhoria
relevante sem bloqueio; P3, refinamento ou consistência. Não atribua prioridade
alta somente porque uma preferência visual não foi atendida.

Para uma implementação já feita, informe também quais viewports, estados,
interações e verificações foram realmente testados.
