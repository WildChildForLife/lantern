# Lantern

[![CI](https://github.com/WildChildForLife/lantern/actions/workflows/ci.yml/badge.svg)](https://github.com/WildChildForLife/lantern/actions/workflows/ci.yml)
[![CodeQL](https://github.com/WildChildForLife/lantern/actions/workflows/codeql.yml/badge.svg)](https://github.com/WildChildForLife/lantern/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/lantern-viewer.svg)](https://www.npmjs.com/package/lantern-viewer)
[![Container](https://img.shields.io/badge/ghcr.io-lantern-blue.svg)](https://github.com/WildChildForLife/lantern/pkgs/container/lantern)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> Find the conversation you forgot you started.

Lantern is a self-hosted dashboard for your agent CLI sessions. It reads the logs Claude Code already
writes to `~/.claude/projects/` — and, optionally, Codex CLI's rollouts in `~/.codex/sessions/` and
opencode's storage in `~/.local/share/opencode/` — then groups every conversation by **what it is
about**, not by which folder it happened to start in.

If you run a lot of Claude Code sessions across a lot of projects and machines, the folder view stops
helping: one directory ends up holding thirty unrelated conversations. Lantern gives you topics, a
searchable list of everything, and a board view of the lot.

<p align="center">
  <img src="docs/screenshots/topics.jpg" alt="Topics grouped by subject, each with an icon and a conversation count" width="100%">
</p>

## What it does

- **Topics instead of folders.** Conversations are clustered by subject, each topic with its own icon,
  colour and count. Grouping is local and deterministic by default: no model call, no network, no cost.
- **Optional AI naming.** One button hands the conversation titles to the Claude Code CLI you are
  already signed in to and gets back proper topic names like _Home Network_ or _Orders API_. Results
  are cached per session, nothing runs in the background, and each pass reports the usage it drew.
- **Every session in one place.** A flat, filterable list across every project — and every machine, if
  you point Lantern at more than one log directory.
- **More than one CLI.** Claude Code, Codex CLI and opencode sessions sit side by side, grouped into
  the same workspace when they ran in the same repo. Pick which CLIs to read in settings. Claude Code
  stays the interactive one; other sources are read-only.
- **Honest costs.** A CLI that records what a turn cost is believed; one that does not is estimated
  and marked `~`; a model with no price table reads `—` rather than `$0.00`.
- **Three layouts.** Rows, cards, or a full-width board with one column per topic, newest first.
- **Pick up where you left off.** Copy a conversation id to resume it from a terminal, or tick
  conversations off as done once you have dealt with them.
- **A full session viewer.** Live conversation log viewing, search, cost and token breakdowns, git
  integration, an in-app terminal, and PWA support for phones.

<p align="center">
  <img src="docs/screenshots/topic-table.jpg" alt="Board view with one column per topic" width="100%">
</p>

## Install

### Docker

```bash
docker run -d --name lantern \
  -p 127.0.0.1:3400:3400 \
  -v "$HOME/.claude:/root/.claude:ro" \
  -v lantern_cache:/root/.lantern \
  ghcr.io/wildchildforlife/lantern:latest
```

Or with Compose, which is the same thing plus a password:

```bash
curl -O https://raw.githubusercontent.com/WildChildForLife/lantern/main/docker-compose.yml
echo "LANTERN_PASSWORD=pick-something" > .env
docker compose up -d
```

Images are published for `linux/amd64` and `linux/arm64`, so a Raspberry Pi or an Apple Silicon
machine works the same way.

### npm

```bash
npx lantern-viewer --port 3400
```

Or install it properly:

```bash
npm install -g lantern-viewer
lantern --port 3400
```

### From source

```bash
git clone https://github.com/WildChildForLife/lantern.git
cd lantern
pnpm install
pnpm build
node dist/main.js --port 3400
```

Then open <http://localhost:3400>.

> **Requirements:** Node.js 24 or newer for the npm and source installs. Claude Code itself must be
> installed and signed in for the optional AI topic naming; everything else works without it.

## Usage

```bash
node dist/main.js [options]
```

| Option                      | Environment                 | Description                                               | Default     |
| --------------------------- | --------------------------- | --------------------------------------------------------- | ----------- |
| `-p, --port <port>`         | `PORT`                      | Port to listen on                                         | `3000`      |
| `-h, --hostname <hostname>` | `HOSTNAME`                  | Hostname to bind                                          | `localhost` |
| `-P, --password <password>` | `LANTERN_PASSWORD`          | Require a password. **Set this if you bind to `0.0.0.0`** | (none)      |
| `--claude-dir <path>`       | `LANTERN_CLAUDE_DIR`        | Path to the Claude directory to read                      | `~/.claude` |
| `-e, --executable <path>`   | `LANTERN_CLAUDE_EXECUTABLE` | Path to the `claude` executable                           | auto        |
| `--terminal-disabled`       | `LANTERN_TERMINAL_DISABLED` | Turn off the in-app terminal                              | enabled     |
| `--terminal-shell <path>`   | `LANTERN_TERMINAL_SHELL`    | Shell used by terminal sessions                           | login shell |
| `--api-only`                | `LANTERN_API_ONLY`          | Serve the API without the web UI                          | off         |
| `-v, --verbose`             | `LANTERN_VERBOSE`           | Verbose debug logging                                     | off         |
| `--source <id>`             | `LANTERN_SOURCES`           | Agent CLI to read; repeat for more. Scopes one run        | stored      |

> **Security:** Lantern ships an in-app terminal. Binding to anything other than `localhost` without
> `--password` hands a remote shell to whoever finds the port. Use `--terminal-disabled` and a
> password, or keep it behind a VPN such as Tailscale.

Lantern keeps its cache, push keys and schedules in `~/.lantern/`. Deleting that directory costs
nothing but a rebuild on the next start.

### Reading logs from more than one machine

Lantern lists whatever lives under the Claude directory it reads. To pull in sessions from another
machine, symlink or mount that machine's project directories into `~/.claude/projects/`:

```bash
ln -s /mnt/c/Users/you/.claude/projects/my-project ~/.claude/projects/win-my-project
```

Directories on filesystems without inotify (a Windows drive mounted into WSL, for instance) are picked
up on restart rather than live.

<p align="center">
  <img src="docs/screenshots/conversations.jpg" alt="Every conversation across every project, newest first" width="100%">
</p>

## How grouping works

**By default, locally.** Lantern takes the title Claude wrote for each conversation, drops the words
that say nothing (`fix`, `add`, `error`, `the`), and repeatedly carves off the largest group of
conversations sharing a word. Leftovers fall back to the folder they were started in, then to any topic
they mention, and anything still homeless lands in _Uncategorized_. It costs nothing and re-runs on
every request, so new conversations are grouped as they appear.

**Optionally, with Claude.** Keyword clustering names topics after words, which is sometimes clumsy.
Press **Sort N new** and Lantern batches the titles through `claude -p` and stores the answer per
session. It reuses your existing Claude Code login — there is no API key to configure and no separate
bill — and only classifies conversations it has not seen before. Nothing runs automatically.

## Development

```bash
pnpm install
pnpm gatecheck check   # format, lint, typecheck and tests over the diff
pnpm test
pnpm build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and house rules, and [AGENTS.md](AGENTS.md) for
the architecture (Hono + Effect-TS backend, Vite + TanStack Router frontend, SQLite cache).

## Privacy

Lantern reads your session logs locally and sends them nowhere. The only outbound traffic is the
optional topic classification, which goes through your own Claude Code CLI when you press the button.
See [PRIVACY.md](PRIVACY.md).

## Licence

[MIT](LICENSE) — © 2026 Lantern contributors.
