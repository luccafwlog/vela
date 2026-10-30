#!/usr/bin/env bash
# Baixa as dependências remotas de um teste ou check Deno para o cache, com até
# 3 tentativas, e escreve na saída o lock que os passos seguintes devem usar.
#
# Uso: lock=$(scripts/deno-cache.sh <lock> <argumentos do deno cache>)
#
# O esm.sh serve, conforme a borda do CDN, dois builds do mesmo arquivo:
# 2026-10-30, `tslib@2.8.1/denonext/tslib.mjs` de 2025-11-20 (o do lock) e o
# recompilado em 2026-10-21, que só muda a minificação (parênteses em volta de
# funções). O lock aceita um hash por URL, então o CI falhava conforme a borda.
# Só os builds conferidos em KNOWN_BUILDS passam: com o outro, o script grava uma
# cópia temporária do lock com esse hash e os passos seguintes usam a cópia.
# Hash ou URL fora da lista continuam falhando (`--frozen`).
set -uo pipefail

lock="$1"
shift

# URL | hash no lock | hash do outro build conferido
KNOWN_BUILDS=(
  "https://esm.sh/tslib@2.8.1/denonext/tslib.mjs|c38da5dd6da6281964435002ce204cd586634fe3bdfb24a0ee116f48cf3292e9|ebce3cd5facb654623020337f867b426ba95f71596ba87acc9e6c6f4e55905ca"
)

current="$lock"
for attempt in 1 2 3; do
  if output=$(npx --yes deno@2.9.6 cache --lock="$current" --frozen "$@" 2>&1); then
    echo "$output" >&2
    echo "$current"
    exit 0
  fi
  echo "$output" >&2
  specifier=$(echo "$output" | sed -n 's/^ *Specifier: //p' | head -1)
  actual=$(echo "$output" | sed -n 's/^ *Actual: //p' | head -1)
  for entry in "${KNOWN_BUILDS[@]}"; do
    IFS='|' read -r url hash_a hash_b <<<"$entry"
    if [ "$specifier" = "$url" ] && { [ "$actual" = "$hash_a" ] || [ "$actual" = "$hash_b" ]; }; then
      alternate=$(mktemp --suffix=.lock)
      expected=$([ "$actual" = "$hash_a" ] && echo "$hash_b" || echo "$hash_a")
      sed "s/$expected/$actual/" "$current" > "$alternate"
      echo "Build conhecido de $url servido pela borda; usando o lock com o hash dele." >&2
      current="$alternate"
      continue 2
    fi
  done
  [ "$attempt" = 3 ] && exit 1
  echo "Download das dependências falhou ($attempt/3); nova tentativa em 10 s." >&2
  sleep 10
done
exit 1
