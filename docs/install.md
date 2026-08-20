# Install

One npm package behind three front doors, all kept current by `lantern upgrade`:

- **npm** — needs Node 24 already installed
- **Homebrew** — brings Node with it
- **Docker** — ships its own

Only the optional AI topic naming needs Claude Code installed and signed in. There is no setup step
to run afterwards — `lantern` works straight out of the box.

## npm (any platform)

Needs Node.js 24 or newer already present:

```bash
npm install -g lantern-viewer       # permanent, upgradeable with `lantern upgrade`
lantern

npx lantern-viewer                  # or run once, without installing
npx lantern-viewer --server-only --port 3400
```

`pnpm`, `yarn` and `bun` work too; `lantern upgrade` uses whichever one put it there.

## macOS

```bash
brew tap wildchildforlife/tap
brew trust wildchildforlife/tap     # Homebrew gates third-party taps
brew install lantern-viewer
lantern                             # or: lantern --server-only --port 3400 for the web UI alone
```

The formula is `lantern-viewer` — homebrew-cask already ships an unrelated `lantern` — but the
command it installs is `lantern`. Reads `~/.claude/projects`. Everything works on Intel and Apple
Silicon, in-app terminal included.

## Linux

Node 24 first: Ubuntu 24.04 and Debian 12 ship 18, Fedora 41 ships 22, and Lantern will not start
on those.

```bash
node --version                                                      # skip the next two lines if this is v24 or newer
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -   # or rpm.nodesource.com/setup_24.x for dnf
sudo apt install -y nodejs

npm install -g lantern-viewer
lantern
```

Or [linuxbrew](https://docs.brew.sh/Homebrew-on-Linux), which brings its own Node:

```bash
brew install wildchildforlife/tap/lantern-viewer
```

Reads `~/.claude/projects`. On `aarch64` the web UI's in-app terminal is unavailable — see
[Platform support](#platform-support).

### Coming from the `.deb` or `.rpm`?

Retired after v0.3.0, along with the AUR recipe. `apt` enforced a `nodejs (>= 24)` dependency no
current release satisfies, so the install failed outright. Same build, from npm:

```bash
sudo apt remove lantern      # or: sudo dnf remove lantern
npm install -g lantern-viewer
```

`~/.lantern` survives both steps, and `lantern upgrade` prints these two lines on a package install.

## Windows

```powershell
winget install OpenJS.NodeJS
npx lantern-viewer browse
```

`npm install -g lantern-viewer` instead, for an install `lantern upgrade` can keep current.
[Docker](#docker) skips Node altogether, for the web UI.

Reads `%USERPROFILE%\.claude\projects`, caches in `%USERPROFILE%\.lantern`. `claude` is found with
`where`; if that finds nothing, pass `--executable`.

The in-app terminal is unavailable here — see [Platform support](#platform-support). For it, run
Lantern in **WSL2** as a Linux install and point `--claude-dir` at `/mnt/c/Users/<you>/.claude`.

## Docker

For the web UI. The board wants a terminal, which is not what a detached container has, so Lantern
starts the server alone there without being told to. Identical on macOS, Linux and Windows apart from
the volume syntax.

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
[Reading other agent CLIs](agents.md#reading-other-agent-clis).

Images are published for `linux/amd64` and `linux/arm64`, so a Raspberry Pi or an Apple Silicon
machine works the same way — except the in-app terminal, which is unavailable on the `arm64` image.

## From source

Any platform, once Node 24 and pnpm are present:

```bash
git clone https://github.com/WildChildForLife/lantern.git
cd lantern
pnpm install
pnpm build
node dist/main.js browse             # or: node dist/main.js --port 3400
```

See [dev.md](dev.md) if you intend to change anything.

## Platform support

Everything works everywhere except the web UI's in-app terminal, which needs a prebuilt PTY binary
that `@replit/ruspty` does not publish for every target. Where it is missing, Lantern disables the
terminal and says so in its startup log; nothing else is affected, and the board does not use it.

| Platform                       | Supported | In-app terminal |
| ------------------------------ | --------- | --------------- |
| macOS (Apple Silicon or Intel) | yes       | yes             |
| Linux `x86_64`                 | yes       | yes             |
| Linux `aarch64`                | yes       | no              |
| Windows                        | yes       | no — use WSL2   |

CI runs on Linux only, so macOS and Windows are verified by hand rather than on every commit. Reports
from either are welcome.
