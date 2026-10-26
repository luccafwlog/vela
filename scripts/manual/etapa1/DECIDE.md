# Transformar divergências em decisões fáceis

O dono do Vela (sistema interno de uma agência marítima; o Cliente usa o
Portal Fwlog) vai decidir divergências numa página. Ele conhece a operação,
não o código. Para cada divergência do seu lote (JSON de entrada), escreva um
cartão de decisão.

Leia, se precisar confirmar algo, a linha da divergência no arquivo de
cobertura (`/home/user/vela/docs/manual/cobertura/<area>.md`, seção
Divergências, e as regras que ela cita) e o código. Só leitura: não edite nada
no repositório, não faça commit. O banco local é só leitura:
`PGPASSWORD=postgres psql -h 127.0.0.1 -U postgres -d vela_test -At -c "..."`.

## Saída

Grave um arquivo JSON (array, mesma ordem da entrada) no caminho que o pedido
indicar. Cada elemento:

```json
{
  "key": "<igual à entrada>",
  "titulo": "frase curta do problema, até 80 caracteres",
  "caso": "caso hipotético simples, 2 a 4 frases, com nomes fictícios (Cliente Atlântica Importações, navio MSC Aurora, B/L MSCU1234567, operadora Paula da Documentação…), em linguagem de tela, mostrando o que a pessoa faz e o que acontece",
  "hoje": "uma frase: o que o sistema faz hoje",
  "impacto": "alto | medio | baixo",
  "opcoes": [
    {"id": "A", "texto": "o que fazer, em uma frase", "efeito": "o que muda para quem usa, em uma frase"},
    {"id": "B", "texto": "...", "efeito": "..."}
  ],
  "recomendada": "A",
  "porque": "uma ou duas frases do porquê da recomendação"
}
```

## Regras

- **Linguagem do dono**: nomes de tela, botão e status como aparecem no Vela;
  nada de RPC, tabela, migration, gatilho, função, código em inglês. Português
  do Brasil, com acentos, frases curtas.
- **Opções reais e distintas**, 2 ou 3, sempre incluindo, quando fizer sentido,
  "corrigir o sistema para seguir a regra registrada" e "manter o sistema como
  está e corrigir a regra/documento". Se a divergência for só um texto de tela
  errado, uma opção é "corrigir o texto da tela".
- **Recomendação** pensada para um sistema que vai abrir a Clientes reais nas
  próximas semanas: prefira o que protege o Cliente, o dinheiro e a clareza da
  operação; prefira a correção menor quando o efeito é o mesmo.
- **Impacto**: alto = afeta Cliente, cobrança ou dinheiro, ou trava a operação;
  médio = confunde a equipe ou gera retrabalho; baixo = texto, rótulo,
  documentação.
- Não invente comportamento: o "hoje" tem de bater com a divergência e o código.
- Valide o JSON (`python3 -c "import json;json.load(open('ARQ'))"`) antes de
  terminar e responda só com o caminho e quantos cartões gravou.
