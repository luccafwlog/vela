# no-mistakes gate

> **Integração removida em 2026-09-18 por decisão do dono.** O gate não é
> instalado nem executado em nenhuma sessão: o `SessionStart` hook só sincroniza
> as skills, e a skill `/no-mistakes` saiu do catálogo. Os arquivos desta pasta
> ficam apenas como histórico; o texto abaixo descreve a integração como era
> antes da remoção. Registro: [auditoria das skills de 2026-09-18](../../docs/archive/audits/2026-09-18-auditoria-skills.md).

[`no-mistakes`](https://github.com/kunchenguid/no-mistakes) is a local git gate:
push to the `no-mistakes` remote instead of `origin` and it runs an AI-driven
validation pipeline (review → test → docs → lint → push → PR → CI) in a
disposable worktree, forwarding to the real target only when every check passes.
Agents drive it through the `/no-mistakes` skill.

## How it's wired here

It runs in **both Claude Code cloud and local** via the `SessionStart` hook
(`.claude/hooks/session-start.sh`), which on every session:

1. Runs `setup.sh` — installs a **pinned** no-mistakes binary, verified against
   the committed `checksums-<version>.txt` (SHA-256). No `curl | sh` of remote
   code; idempotent and offline-safe (skips silently if the release is
   unreachable or a checksum fails).
2. Runs `no-mistakes init` — gates this repo and installs the version-matched
   `/no-mistakes` agent skill.

The binary and gate live under `$HOME/.no-mistakes` (not committed); only the
installer and pinned checksums are versioned here.

## Usage

```sh
git checkout <feature-branch>   # work, commit
git push no-mistakes            # run the gate; opens a clean PR when green
no-mistakes                     # TUI for the active run
```

Agents: invoke `/no-mistakes` (validate committed work) or
`/no-mistakes <task>` (do the task, then validate).

## Upgrading

Bump `NM_VERSION` in `setup.sh`, replace `checksums-<version>.txt` with the
matching official `checksums.txt` from the
[release](https://github.com/kunchenguid/no-mistakes/releases), and commit both.
