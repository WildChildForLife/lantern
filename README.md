# Lantern

[![CI](https://github.com/WildChildForLife/lantern/actions/workflows/ci.yml/badge.svg)](https://github.com/WildChildForLife/lantern/actions/workflows/ci.yml)
[![CodeQL](https://github.com/WildChildForLife/lantern/actions/workflows/codeql.yml/badge.svg)](https://github.com/WildChildForLife/lantern/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/lantern-viewer.svg)](https://www.npmjs.com/package/lantern-viewer)
[![Container](https://img.shields.io/badge/ghcr.io-lantern-blue.svg)](https://github.com/WildChildForLife/lantern/pkgs/container/lantern)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> Find the conversation you forgot you started.

Lantern reads the logs your agent CLIs already write — Claude Code's `~/.claude/projects/`, and
optionally [five others](#supported-agents) — and groups every conversation by **what it is about**,
not by which folder it happened to start in. It runs where you already are: a terminal.

```console
$ lantern browse
```

```text
 Lantern  6 topics · 69 conversations · enter: resume here

 ⌁ Orders API 12                ≋ Home Network 6              ▣ Deploy Pipeline 5
 ─────────────────────────────  ────────────────────────────  ───────────────────
 ❯ Add refunds to checkout  2h     Router DHCP leases    1d      Cache the build 3h
   Fix the webhook retry    5h     Split the VLANs       2d      Pin the runner  1d
   Rename the price field   1d     Static leases for NAS 4d

  t  sort 4 conversations into topics with the AI · T redoes every topic

 /home/you/work/orders-api · claude-code · sonnet · ~$0.42 · 24 messages · 4f2ab8c1
 ←→ topics · ↑↓ rows · / filter · e change · r reload · ? keys · q quit
```

One column per topic, conversations as rows, newest topic first. Press `R` to resume a conversation
in place and come back to the board when you leave it. No server, no port, no browser.

There is a web UI too — the same data, with a full session viewer, search and cost breakdowns — for
when a terminal is the wrong shape for what you are doing. See [The web UI](#the-web-ui).

## Contents

- [Quick start](#quick-start)
- [Install](#install) · [macOS](#macos) · [Linux](#linux) · [Windows](#windows) ·
  [npm](#npm-any-platform) · [Docker](#docker) · [From source](#from-source) ·
  [Platform support](#platform-support)
- [Commands](#commands)
- [The board in your terminal](#the-board-in-your-terminal) · [Setup](#setup) · [Options](#options)
- [The web UI](#the-web-ui) · [Security](#security)
- [Supported agents](#supported-agents) · [Reading other agent CLIs](#reading-other-agent-clis) ·
  [Reading logs from more than one machine](#reading-logs-from-more-than-one-machine)
- [How grouping works](#how-grouping-works)
- [Development](#development) · [Contributing](#contributing) · [Support](#support)
- [Privacy](#privacy) · [Licence](#licence)

## Quick start

With Node.js 24 or newer already present, nothing to install:

```bash
npx lantern-viewer browse
```

On a first run Lantern reads your logs into its own cache, then draws the board. For a permanent
install — Homebrew, `apt`, `dnf`, the AUR, Docker — see [Install](#install).

## Install

Every package below declares Node 24 as a dependency, so your package manager pulls a runtime in when
one is missing — except where the distribution's own `nodejs` is too old to satisfy it, which is what
the Debian and Ubuntu note below is about. Claude Code itself must be installed and signed in for the
optional AI topic naming — everything else works without it.

### macOS

```bash
brew tap wildchildforlife/tap
brew trust wildchildforlife/tap     # Homebrew gates third-party taps
brew install lantern-viewer
lantern browse                      # or: lantern --port 3400 for the web UI
```

The formula is `lantern-viewer` because homebrew-cask already ships an unrelated
`lantern`. The command it installs is still `lantern`.

Sessions are read from `~/.claude/projects`. Everything works here, the in-app terminal included, on
both Intel and Apple Silicon.

### Linux

Debian and Ubuntu, from the `.deb` on the [latest release](https://github.com/WildChildForLife/lantern/releases/latest).
The package declares `nodejs (>= 24)` and apt enforces it, so a distribution whose own `nodejs` is
older — Ubuntu 22.04 ships 12, Debian 12 ships 18 — must get Node 24 first or the install stops at
`Depends: nodejs (>= 24) but 12.22.9~dfsg-1ubuntu3.6 is to be installed`. This is also the WSL2 case,
since WSL images track those same releases:

```bash
node --version                                                      # skip the next two lines if this is v24 or newer
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

version=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  https://github.com/WildChildForLife/lantern/releases/latest | sed 's#.*/v##')
curl -fsSLO "https://github.com/WildChildForLife/lantern/releases/download/v${version}/lantern_${version}_amd64.deb"
sudo apt install "./lantern_${version}_amd64.deb"                   # swap amd64 for arm64 on a Pi
lantern browse
```

Fedora and RHEL, from the `.rpm`. Check `node --version` first — Fedora 41 still
ships Node 22, and Lantern needs 24. `dnf` does **not** enforce that floor, so an
old Node here installs cleanly and fails at first launch instead:

```bash
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -      # only if node is older than 24

version=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  https://github.com/WildChildForLife/lantern/releases/latest | sed 's#.*/v##')
sudo dnf install "https://github.com/WildChildForLife/lantern/releases/download/v${version}/lantern-${version}-1.x86_64.rpm"
lantern browse
```

Both snippets read the current version off the `releases/latest` redirect, so they stay right after
every release. To pin a version instead, replace `${version}` with the one you want.

Arch, from the AUR — the recipe lives in
[`packaging/aur`](packaging/aur/PKGBUILD) and is not on the AUR itself yet:

```bash
paru -S lantern      # or: yay -S lantern
```

Sessions are read from `~/.claude/projects`. On `x86_64` everything works. On `aarch64` the web UI's
in-app terminal is unavailable — see [Platform support](#platform-support).

If your distribution is not listed, or you would rather not add a package, use
[npm](#npm-any-platform) or [Docker](#docker).

### Windows

```powershell
winget install OpenJS.NodeJS
npx lantern-viewer browse
```

There is no native Windows package yet, so this is the one platform that still needs Node installed
first — [Docker](#docker) avoids that, for the web UI.

Sessions are read from `%USERPROFILE%\.claude\projects`, and Lantern's own cache from
`%USERPROFILE%\.lantern`. The `claude` executable is found on `PATH` with `where`, so if
`where claude` finds nothing, pass `--executable` with the full path.

The web UI's in-app terminal is unavailable on Windows — see
[Platform support](#platform-support). If you want it, run Lantern inside **WSL2** instead and treat
it as a Linux install; sessions written by a Windows Claude Code are then reachable at
`/mnt/c/Users/<you>/.claude`, which you can point at with `--claude-dir`.

### npm (any platform)

Needs Node.js 24 or newer already present:

```bash
npx lantern-viewer browse           # the board
npx lantern-viewer --port 3400      # the web UI
```

### Docker

For the web UI. `lantern browse` wants a terminal, which is not what a detached container has.
Identical on macOS, Linux and Windows apart from the volume syntax.

```bash
docker run -d --name lantern \
  -p 127.0.0.1:3400:3400 \
  -v "$HOME/.claude:/root/.claude:ro" \
  -v lantern_cache:/root/.lantern \
  ghcr.io/wildchildforlife/lantern:latest
```

On Windows PowerShell, swap `$HOME` for `$env:USERPROFILE` and the line continuations for backticks:

```powershell
docker run -d --name lantern `
  -p 127.0.0.1:3400:3400 `
  -v "${env:USERPROFILE}\.claude:/root/.claude:ro" `
  -v lantern_cache:/root/.lantern `
  ghcr.io/wildchildforlife/lantern:latest
```

Or with Compose, which is the same thing plus a password:

```bash
curl -O https://raw.githubusercontent.com/WildChildForLife/lantern/main/docker-compose.yml
echo "LANTERN_PASSWORD=pick-something" > .env
docker compose up -d
```

That mounts Claude Code's logs only. To read Codex or opencode as well, see
[Reading other agent CLIs](#reading-other-agent-clis).

Images are published for `linux/amd64` and `linux/arm64`, so a Raspberry Pi or an Apple Silicon
machine works the same way — except the in-app terminal, which is unavailable on the `arm64` image.

### From source

Any platform, once Node 24 and pnpm are present:

```bash
git clone https://github.com/WildChildForLife/lantern.git
cd lantern
pnpm install
pnpm build
node dist/main.js browse             # or: node dist/main.js --port 3400
```

### Platform support

Everything works everywhere except the web UI's in-app terminal, which needs a prebuilt PTY binary
that `@replit/ruspty` does not publish for every target. Where it is missing, Lantern disables the
terminal and says so in its startup log; nothing else is affected, and `lantern browse` does not use
it.

| Platform                       | Supported | In-app terminal |
| ------------------------------ | --------- | --------------- |
| macOS (Apple Silicon or Intel) | yes       | yes             |
| Linux `x86_64`                 | yes       | yes             |
| Linux `aarch64`                | yes       | no              |
| Windows                        | yes       | no — use WSL2   |

CI runs on Linux only, so macOS and Windows are verified by hand rather than on every commit. Reports
from either are welcome.

## Commands

```bash
lantern browse             # the board, in your terminal
lantern init               # set Lantern up, and remember the answers
lantern [options]          # start the web UI
```

`browse` has a short alias: `lantern b`, and takes `--claude-dir`, `--executable`, `--source` and
`--verbose` from the [options](#options) table. `init` takes `--claude-dir`. Either works on both
sides of the command name — `lantern browse --claude-dir …` and `lantern --claude-dir … browse` mean
the same thing.

## The board in your terminal

`lantern browse` draws the same board the web UI does, without starting a server or opening a
browser. It takes the whole terminal while it is up, on the same alternate screen `less` and `vim`
use, and gives your scrollback back when you quit.

| Key     | Does                                                       |
| ------- | ---------------------------------------------------------- |
| `← →`   | move between topics (`h` `l` also work)                    |
| `↑ ↓`   | move between conversations (`j` `k`), `g`/`G` for the ends |
| `/`     | filter by topic, title or project                          |
| `enter` | what to do with this conversation                          |
| `R`     | resume here, and come back to the board after              |
| `p`     | show the resume command, without leaving                   |
| `c`     | copy the conversation id                                   |
| `t`     | sort the conversations with no topic yet                   |
| `T`     | throw every topic away and sort again (asks first)         |
| `r`     | re-read the logs · `?` the key list · `q` quit             |

### Resuming

`R` lends the terminal to the session rather than giving it away: when you leave `claude`, the same
board comes back — same topic, same conversation, same filter — with the logs re-read, so you can
resume something else without starting `lantern browse` again.

A conversation is always resumed **in the directory it ran in** — `claude --resume` looks a session
up by that directory, so anywhere else it reports the conversation as missing. If that folder has
since been deleted, Lantern says so rather than resuming somewhere wrong.

Resuming is Claude Code only, as everywhere else in Lantern — conversations from the other five CLIs
show those actions greyed out, and copying the id still works. Copying uses the terminal's own
clipboard escape sequence first, so it reaches your machine's clipboard even over SSH.

### Showing the command instead

`p` shows the command under the board instead of quitting. Pressing `p` on another conversation
replaces it and blinks so you can see that it changed, and whatever is on show is printed once more
on the way out, so `p` then `q` leaves something behind to paste.

### Sorting into topics

`t` sorts conversations into topics with the configured agent CLI — the same pass the web UI's
buttons start, run against the same local cache. It has a row of its own above the key line, because
it is the one key on the board that spends a CLI call, and it says how many conversations are waiting
so you can see whether there is anything to sort before finding out the expensive way. The board
re-reads the logs when the pass ends, so the new topics appear without pressing `r`.

`T` is the terminal's "Redo all": every stored topic thrown away and everything filed again. It asks
first — only `y` goes ahead — because it spends a pass on conversations that were already filed. When
nothing is waiting to be sorted the row says so and offers `T`, rather than disappearing: a key that
only shows up on the day it becomes relevant is a key nobody knows is there.

### What Enter does

The header shows what `enter` will do; `e` cycles through resuming here, showing the command and
copying the id, and remembers the choice for next time. Enter then does exactly that — there is no
menu in between, and each of the three has its own key as well.

Below about ninety columns the board becomes a topic list on the left and its conversations on the
right; the keys are unchanged.

## Setup

The first time you run `lantern` at a terminal it walks you through setup: which agent CLIs to read,
where they keep their logs, which port and address to bind, and whether to enable the in-app
terminal. Every question arrives with the answer already detected, so the fast path is Enter a few
times.

The answers go in `~/.lantern/config.json` (and the CLI selection in `~/.lantern/sources/sources.json`,
the same file the settings panel writes). Run `lantern init` again at any point to change them.

Settings sit **below** environment variables in the [options](#options) table: a flag beats an
environment variable, which beats the file, which beats the built-in default. So a container's `PORT`
still wins, and a flag typed on the spot wins over both. Your password is deliberately never written
to the file — set `LANTERN_PASSWORD` or pass `--password`.

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

`lantern browse` reads `--claude-dir`, `--executable`, `--source` and `--verbose`; the rest belong to
the server. The port and bind address are ignored by the board, which listens on nothing.

Rows the wizard writes — port, hostname, `--claude-dir`, `--executable` and the three terminal
options — resolve in this order: the flag, then the environment variable, then
`~/.lantern/config.json`, then the default. An environment variable exported as empty counts as
unset, so it does not shadow the file.

`--password`, `--verbose`, `--source` and `--no-init` have no stored tier: they resolve from the flag
or the environment variable only. Password is deliberate — the wizard never writes one down.

Valid `--source` ids are `claude-code`, `codex`, `opencode`, `qwen-code`, `copilot` and `goose`. Repeat
the flag
for more than one
(`--source claude-code --source codex`), or set `LANTERN_SOURCES` to a comma-separated list. Passing it
scopes a single run without changing what is stored in settings.

Flag-style environment variables are on for `1` or `true` and off otherwise.

Lantern binds `127.0.0.1` by default. `localhost` is treated the same way, because
Node resolves it to `::1` first on a dual-stack machine and that leaves `127.0.0.1`
refused. Pass `::1` for IPv6 loopback, `::` for both, or `0.0.0.0` for every
interface — and read [Security](#security) before you do the last one.

The bind address is **not** read from `HOSTNAME`. Docker and Kubernetes set that
to the container id, so honouring it would leave a container serving on an address
nothing can reach.

## The web UI

`lantern` with no command starts a server and serves the same conversations as a web app, for the
work a terminal is the wrong shape for — reading a long session back, searching message text, or
picking through a cost breakdown.

```bash
lantern --port 3400
```

<p align="center">
  <img src="docs/screenshots/topics.jpg" alt="Topics grouped by subject, each with an icon and a conversation count" width="100%">
</p>

- **Topics instead of folders.** Conversations are clustered by subject, each topic with its own icon,
  colour and count. Grouping is local and deterministic by default: no model call, no network, no cost.
- **Optional AI naming.** One button hands the conversation titles to the Claude Code CLI you are
  already signed in to and gets back proper topic names like _Home Network_ or _Orders API_. Results
  are cached per session, nothing runs in the background, and each pass reports the usage it drew.
  This is the same pass `t` runs on the board.
- **Every session in one place.** A flat, filterable list across every project — and every machine, if
  you point Lantern at more than one log directory.
- **More than one CLI.** Claude Code, Codex CLI, opencode, Qwen Code, GitHub Copilot CLI and goose sessions sit side by side,
  grouped into the same workspace when they ran in the same repo. Pick which CLIs to read in settings.
  Claude Code stays the interactive one; other sources are read-only. See
  [Supported agents](#supported-agents).
- **Honest costs.** A CLI that records what a turn cost is believed; one that does not is estimated
  and marked `~`; a model with no price table reads `—` rather than `$0.00`.
- **Three layouts.** Rows, cards, or a full-width board with one column per topic, newest first.
- **Six languages.** English, Spanish, French, Portuguese, Japanese and Simplified Chinese. Picked up
  from your browser on first load, and changeable in settings. The terminal board is English only.
- **A full session viewer.** Live conversation log viewing, search, cost and token breakdowns, git
  integration, an in-app terminal, and PWA support for phones.

<p align="center">
  <img src="docs/screenshots/topic-table.jpg" alt="Board view with one column per topic" width="100%">
</p>

## Security

> Lantern's web UI ships an in-app terminal. Binding to anything other than `localhost` without
> `--password` hands a remote shell to whoever finds the port. Use `--terminal-disabled` and a
> password, or keep it behind a VPN such as Tailscale. `--terminal-unrestricted` removes the guard
> rails from bash sessions, so treat it as widening that same hole.

None of that applies to `lantern browse`, which opens no port and serves nothing.

The threat model, what a running instance exposes, and how to report a vulnerability privately are all
in [SECURITY.md](SECURITY.md). Please use
[GitHub Security Advisories](https://github.com/WildChildForLife/lantern/security/advisories/new)
rather than a public issue.

Lantern keeps its cache, push keys and schedules in `~/.lantern/` (`%USERPROFILE%\.lantern` on
Windows). Deleting that directory costs nothing but a rebuild on the next start.

## Supported agents

<table>
  <tr>
    <td align="center" width="120">
      <img src="docs/icons/claude-code.svg" width="30" height="30" alt=""><br>
      <b>Claude Code</b>
    </td>
    <td align="center" width="120">
      <img src="docs/icons/codex.svg" width="30" height="30" alt=""><br>
      <b>Codex CLI</b>
    </td>
    <td align="center" width="120">
      <img src="docs/icons/opencode.svg" width="30" height="30" alt=""><br>
      <b>opencode</b>
    </td>
    <td align="center" width="120">
      <img src="docs/icons/qwen-code.svg" width="30" height="30" alt=""><br>
      <b>Qwen Code</b>
    </td>
    <td align="center" width="120">
      <img src="docs/icons/copilot.svg" width="30" height="30" alt=""><br>
      <b>Copilot CLI</b>
    </td>
    <td align="center" width="120">
      <b>G</b><br>
      <b>goose</b>
    </td>
  </tr>
</table>

| Agent CLI       | History Lantern reads       | Verified against | Mode                      |
| --------------- | --------------------------- | ---------------- | ------------------------- |
| **Claude Code** | `~/.claude/projects/`       | `2.1.221`        | Read **and** drive a turn |
| **Codex CLI**   | `~/.codex/sessions/`        | `0.146.0`        | Read-only                 |
| **opencode**    | `~/.local/share/opencode/`  | `1.18.13`        | Read-only — see the note  |
| **Qwen Code**   | `~/.qwen/projects/`         | `0.21.6`         | Read-only                 |
| **Copilot CLI** | `~/.copilot/session-state/` | `1.0.78`         | Read-only                 |

Sessions from every enabled CLI sit in the same topics, the same searchable list and the same board,
and are grouped into one workspace when they ran in the same repo. Pick which to read in settings.
Claude Code stays the only interactive one — starting, resuming and approving a turn go through the
Agent SDK, which the others have no equivalent for.

"Verified against" means that exact version was run and the history it wrote was read back, rather
than inferred from a format description. [`docker/compatibility.md`](docker/compatibility.md) records
how, and what each run turned up. Both of opencode's storage layouts are read: the JSON tree and
the SQLite database a current install writes, and goose's own database. Gemini CLI and cursor-agent are
not read yet.

## Reading other agent CLIs

Codex, opencode, Qwen Code, Copilot CLI and goose are read from wherever those CLIs themselves keep their
history, so pointing Lantern at them is the same gesture as pointing the CLI at them:

| Source        | Default location          | Moved by                              |
| ------------- | ------------------------- | ------------------------------------- |
| `claude-code` | `~/.claude`               | `--claude-dir` / `LANTERN_CLAUDE_DIR` |
| `codex`       | `~/.codex`                | `CODEX_HOME`                          |
| `opencode`    | `~/.local/share/opencode` | `XDG_DATA_HOME`                       |
| `qwen-code`   | `~/.qwen`                 | `HOME` only — see below               |
| `copilot`     | `~/.copilot`              | `HOME` only — see below               |
| `goose`       | `~/.local/share/goose`    | `XDG_DATA_HOME`                       |

`~` here is `$HOME`, or `%USERPROFILE%` on Windows shells that do not set `HOME`. Each row names the
variable that CLI honours itself, so moving its history moves Lantern's view of it. Qwen Code and
Copilot CLI have no such variable — they always write under `$HOME` — so in Docker it is the mount
that moves them.

Enable the ones you want in settings, or scope a single run with `--source`:

```bash
lantern browse --source claude-code --source codex
```

In Docker each one needs its own mount, since only `~/.claude` is mounted by default:

```bash
docker run -d --name lantern \
  -p 127.0.0.1:3400:3400 \
  -v "$HOME/.claude:/root/.claude:ro" \
  -v "$HOME/.codex:/root/.codex:ro" \
  -v "$HOME/.local/share/opencode:/root/.local/share/opencode:ro" \
  -v "$HOME/.qwen:/root/.qwen:ro" \
  -v "$HOME/.copilot:/root/.copilot:ro" \
  -v "$HOME/.local/share/goose:/root/.local/share/goose:ro" \
  -v lantern_cache:/root/.lantern \
  ghcr.io/wildchildforlife/lantern:latest
```

Read-only mounts are deliberate: Lantern only ever reads these directories.

## Reading logs from more than one machine

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

**By default, locally.** Lantern takes the title the agent wrote for each conversation, whichever CLI it
came from, drops the words that say nothing (`fix`, `add`, `error`, `the`), and repeatedly carves off the
largest group of conversations sharing a word. Leftovers fall back to the folder they were started in,
then to any topic they mention, and anything still homeless lands in _Uncategorized_. It costs nothing
and re-runs on every request, so new conversations are grouped as they appear.

**Optionally, with Claude Code.** Keyword clustering names topics after words, which is sometimes
clumsy. Press `t` on the board — or **Sort N unsorted** in the web UI — and Lantern batches the titles
through `claude -p` and stores the answer per session. It reuses your existing Claude Code login:
there is no API key to configure and no separate bill. Nothing runs automatically.

That pass only ever touches conversations with no topic at all, so it never pays to re-file one it has
already filed — not even when the title changes later. To redo everything, press `T` on the board or
**Redo all** on the web UI's topics page. The web UI can also redo a hand-picked selection: tick them
in the list and press **Sort selected into topics**, which is also how conversations are marked done
in bulk.

This pass is the one Claude Code-specific feature, because `claude` is the CLI Lantern shells out to.
It names topics for conversations from every source, not only Claude Code's own.

## Development

```bash
pnpm install
pnpm gatecheck check   # format, lint, typecheck and tests over the diff
pnpm test
pnpm build
```

To work against the bundled fixtures instead of your own conversations:

```bash
node dist/main.js browse --claude-dir ./fixtures/claude-home
node dist/main.js --port 4100 --claude-dir ./fixtures/claude-home
```

The fixture conversations record invented working directories, so `lantern browse` will refuse to
resume any of them — that refusal is the correct behaviour, not a fault. Point it at your own
history to exercise resuming.

`browse` and `init` are built with React, so their sources are `.tsx` and Node cannot run them
directly: `node src/server/main.ts browse` fails on the file extension. Build first —
`pnpm build:backend` is enough for both commands and takes about a second.

[AGENTS.md](AGENTS.md) describes the architecture: a Hono + Effect-TS backend, a Vite + TanStack Router
frontend, an Ink + React terminal UI in `src/cli/`, and a SQLite cache.

## Contributing

Bug reports, ideas and pull requests are all welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the
setup, the quality gate to run before opening a pull request, and the house rules — no `as` casting,
Effect-TS for backend side effects, Hono RPC for API calls, and a preference for pure functions.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Support

- **Something broken, or an idea?** Open an [issue](https://github.com/WildChildForLife/lantern/issues).
- **A vulnerability?** Report it privately — see [Security](#security).
- **What changed?** See the [releases](https://github.com/WildChildForLife/lantern/releases).

## Privacy

Lantern reads your session logs locally and sends them nowhere. The only outbound traffic is the
optional topic classification, which goes through your own Claude Code CLI when you ask for it. See
[PRIVACY.md](PRIVACY.md).

## Licence

[MIT](LICENSE) — © 2026 Lantern contributors.

The agent CLI marks in `docs/icons/` and in the settings panel belong to their respective owners and
are reproduced only to identify which CLI a row or tile stands for. Lantern is not affiliated with,
or endorsed by, any of them. Path data comes from [Simple Icons](https://simpleicons.org) (CC0),
except Codex's, which is the OpenAI mark from Wikimedia Commons.
