# Configuration

Setup is optional. Everything Lantern needs has a default, so `lantern browse` goes straight to the
board on a fresh machine and never stops to ask a question.

## The setup wizard

What the offer covers is the web UI, which has more to decide: the first time you run `lantern` with
no command at a terminal it walks you through which agent CLIs to read, where they keep their logs,
which port and address to bind, and whether to enable the in-app terminal. Every question arrives
with the answer already detected, so the fast path is Enter a few times.

The answers go in `~/.lantern/config.json` (and the CLI selection in
`~/.lantern/sources/sources.json`, the same file the settings panel writes). Run `lantern init` at any
point to change them — or to answer the questions up front, before ever starting the server.

Nothing prompts without a terminal attached, so Docker, CI and `npx … | tee` start straight up.
`--no-init` or `LANTERN_NO_INIT=1` turns the offer off for good.

## Options

| Option                      | Environment                     | Description                                                 | Default     |
| --------------------------- | ------------------------------- | ----------------------------------------------------------- | ----------- |
| `-p, --port <port>`         | `PORT`                          | Port to listen on                                           | `3000`      |
| `-h, --hostname <hostname>` | `LANTERN_HOSTNAME`              | Address to bind                                             | `127.0.0.1` |
| `-P, --password <password>` | `LANTERN_PASSWORD`              | Require a password. **Set this if you bind to `0.0.0.0`**   | (none)      |
| `--claude-dir <path>`       | `LANTERN_CLAUDE_DIR`            | Path to the Claude directory to read                        | `~/.claude` |
| `-e, --executable <path>`   | `LANTERN_CLAUDE_EXECUTABLE`     | Path to the `claude` executable                             | auto        |
| `--terminal-disabled`       | `LANTERN_TERMINAL_DISABLED`     | Turn off the in-app terminal                                | enabled     |
| `--terminal-shell <path>`   | `LANTERN_TERMINAL_SHELL`        | Shell used by terminal sessions                             | login shell |
| `--terminal-unrestricted`   | `LANTERN_TERMINAL_UNRESTRICTED` | Drop the restricted shell flags from bash terminal sessions | restricted  |
| `--api-only`                | `LANTERN_API_ONLY`              | Serve the API without the web UI                            | off         |
| `-v, --verbose`             | `LANTERN_VERBOSE`               | Verbose debug logging                                       | off         |
| `--source <id>`             | `LANTERN_SOURCES`               | Agent CLI to read; repeat for more. Scopes one run          | stored      |
| `--no-init`                 | `LANTERN_NO_INIT`               | Never offer the setup wizard on a first launch              | offered     |
| (none)                      | `NO_UPDATE_NOTIFIER`            | Never mention that a new version exists                     | mentioned   |
| (none)                      | `LANTERN_NO_UPDATE_NOTIFIER`    | The same thing, under Lantern's own name                    | mentioned   |

`lantern browse` reads `--claude-dir`, `--executable`, `--source` and `--verbose`; the rest belong to
the server. The port and bind address are ignored by the board, which listens on nothing.

Flag-style environment variables are on for `1` or `true` and off otherwise.

## How a setting is resolved

Settings sit **below** environment variables: a flag beats an environment variable, which beats the
file, which beats the built-in default. So a container's `PORT` still wins, and a flag typed on the
spot wins over both. Your password is deliberately never written to the file — set
`LANTERN_PASSWORD` or pass `--password`.

Rows the wizard writes — port, hostname, `--claude-dir`, `--executable` and the three terminal
options — resolve in this order: the flag, then the environment variable, then
`~/.lantern/config.json`, then the default. An environment variable exported as empty counts as
unset, so it does not shadow the file.

`--password`, `--verbose`, `--source` and `--no-init` have no stored tier: they resolve from the flag
or the environment variable only. Password is deliberate — the wizard never writes one down. The two
update-notifier variables are the other way around: no flag, and the stored form is
`"updateNotifier": false` in `~/.lantern/config.json`. Any non-empty value turns them on.

## Choosing which agent CLIs to read

Valid `--source` ids are `claude-code`, `codex`, `opencode`, `qwen-code`, `copilot` and `goose`.
Repeat the flag for more than one (`--source claude-code --source codex`), or set `LANTERN_SOURCES`
to a comma-separated list. Passing it scopes a single run without changing what is stored in
settings. See [Agent CLIs](agents.md) for where each one keeps its history.

## Binding

Lantern binds `127.0.0.1` by default. `localhost` is treated the same way, because Node resolves it
to `::1` first on a dual-stack machine and that leaves `127.0.0.1` refused. Pass `::1` for IPv6
loopback, `::` for both, or `0.0.0.0` for every interface — and read
[SECURITY.md](../SECURITY.md) before you do the last one.

The bind address is **not** read from `HOSTNAME`. Docker and Kubernetes set that to the container id,
so honouring it would leave a container serving on an address nothing can reach.

## When a new version appears

Lantern says so in one line at startup, and nothing more:

```text
Lantern 0.4.0 is available (you have 0.3.0). Run `lantern upgrade`.
```

- Read from a cache, so it never delays a launch. The registry is asked at most once a day, in the
  background.
- Silent where you could not act on it: no terminal attached, CI, Docker, a `.deb`/`.rpm` install, a
  git checkout.
- Off entirely — line and request — with `NO_UPDATE_NOTIFIER=1`, `LANTERN_NO_UPDATE_NOTIFIER=1`, or
  `"updateNotifier": false` in `~/.lantern/config.json`.
- Cached in `~/.lantern/update-check.json`.

## Where Lantern keeps its own files

`~/.lantern/` (`%USERPROFILE%\.lantern` on Windows) holds the cache, push keys and schedules.
Deleting that directory costs nothing but a rebuild on the next start.
