# Conferência independente de uma área — mapeamento do Manual do Operador

Outra pessoa mapeou uma área do Vela num arquivo de cobertura. Você é a
**conferência independente** (plano em
`/home/user/vela/docs/plans/2026-10-26-manual-do-operador.md`, Etapa 1.2):
uma segunda leitura do código que **não parte do texto do autor como
premissa**. O código decide. Leia também as instruções que o autor seguiu, em
`/tmp/claude-0/-home-user-vela/28856e0b-50c8-5c55-815e-161f0b349494/scratchpad/manual/BRIEF.md`
(formato, destinos, setores, citação dos itens, como ler o banco local).

## O que fazer, nesta ordem

1. **Monte sua própria lista do que a área faz, antes de ler as regras do
   autor.** Percorra as telas, componentes, serviços e funções de servidor da
   área (o seu pedido diz onde começar) e as definições vigentes no banco das
   funções e gatilhos da lista de itens da área. Anote cada comportamento:
   ação e rótulo na tela, condição, bloqueio, efeito, o que muda sozinho
   depois, quem pode.
2. **Compare com o arquivo do autor.**
   - **Regra faltando:** acrescente uma linha nova em Regras, numerada depois
     da última (não renumere as existentes).
   - **Regra errada ou imprecisa** (condição, efeito, rótulo, setor, prazo,
     exceção): corrija a linha no lugar.
   - **Setor errado:** siga a guarda do banco e da tela.
   - **Destino inadequado:** corrija com os códigos da legenda.
   - **Linguagem:** o texto da regra não pode ter termo técnico (tabela, RPC,
     função, trigger, migration, flag, enum, nomes de coluna em inglês); o
     técnico fica só em "Itens do código". Rótulos de tela exatos, em negrito.
   - **Divergência:** confira se é real (documento × código) e se a classe
     (a, b, c) está certa; remova as que não se sustentam e acrescente as que
     achar.
   - **Mensagens:** confira por amostragem (pelo menos 20, ou todas se forem
     poucas) que o texto está exato e que o destino `Fora` só vale para o que
     nunca chega a uma pessoa.
3. **Não apague citações de itens.** Toda citação `tipo:nome` que o autor fez
   continua em algum lugar do arquivo. Ao terminar, rode
   `node /tmp/claude-0/-home-user-vela/28856e0b-50c8-5c55-815e-161f0b349494/scratchpad/manual/selfcheck.mjs <AREA>`
   e confirme que todos os itens continuam citados.
4. Edite **só** o arquivo da sua área. Não faça commit, não rode `npm`, não
   grave no banco (só leitura).

## Ao terminar

Responda com:
- quantas regras você corrigiu e quantas acrescentou, com os números (ex.:
  "corrigidas BLR-012, BLR-040; novas BLR-151 a BLR-158");
- as correções mais relevantes, em uma linha cada (o que estava errado → o que
  o código faz);
- divergências removidas ou acrescentadas;
- o resultado do selfcheck;
- o que você não conseguiu conferir.
