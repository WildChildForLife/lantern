# Lantern

[![CI](https://github.com/WildChildForLife/lantern/actions/workflows/ci.yml/badge.svg)](https://github.com/WildChildForLife/lantern/actions/workflows/ci.yml)
[![CodeQL](https://github.com/WildChildForLife/lantern/actions/workflows/codeql.yml/badge.svg)](https://github.com/WildChildForLife/lantern/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/lantern-ccv.svg)](https://www.npmjs.com/package/lantern-ccv)
[![Container](https://img.shields.io/badge/ghcr.io-lantern-blue.svg)](https://github.com/WildChildForLife/lantern/pkgs/container/lantern)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> Find the conversation you forgot you started.

Lantern is a self-hosted dashboard for your Claude Code sessions. It reads the JSONL logs Claude Code
already writes to `~/.claude/projects/` and groups every conversation by **what it is about** — not by
which folder it happened to be started in.

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
  -v lantern_cache:/root/.claude-code-viewer \
  ghcr.io/wildchildforlife/lantern:latest
```

Or with Compose, which is the same thing plus a password:

```bash
curl -O https://raw.githubusercontent.com/WildChildForLife/lantern/main/docker-compose.yml
echo "CCV_PASSWORD=pick-something" > .env
docker compose up -d
```

Images are published for `linux/amd64` and `linux/arm64`, so a Raspberry Pi or an Apple Silicon
machine works the same way.

### npm

```bash
npx lantern-ccv --port 3400
```

Or install it properly:

```bash
npm install -g lantern-ccv
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

| Option                      | Environment    | Description                                               | Default     |
| --------------------------- | -------------- | --------------------------------------------------------- | ----------- |
| `-p, --port <port>`         | `PORT`         | Port to listen on                                         | `3000`      |
| `-h, --hostname <hostname>` | `HOSTNAME`     | Hostname to bind                                          | `localhost` |
| `-P, --password <password>` | `CCV_PASSWORD` | Require a password. **Set this if you bind to `0.0.0.0`** | (none)      |
| `--claude-dir <path>`       | —              | Path to the Claude directory to read                      | `~/.claude` |
| `-e, --executable <path>`   | —              | Path to the `claude` executable                           | auto        |
| `--terminal-disabled`       | —              | Turn off the in-app terminal                              | enabled     |
| `--api-only`                | —              | Serve the API without the web UI                          | off         |

> **Security:** Lantern ships an in-app terminal. Binding to anything other than `localhost` without
> `--password` hands a remote shell to whoever finds the port. Use `--terminal-disabled` and a
> password, or keep it behind a VPN such as Tailscale.

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
