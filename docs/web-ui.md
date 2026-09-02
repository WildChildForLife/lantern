# The web UI

`lantern` with no command starts a server and serves the same conversations as a web app, for the
work a terminal is the wrong shape for — reading a long session back, searching message text, or
picking through a cost breakdown. It prints the address and then draws
[the board](board.md) over it, so both are running from the one word; quitting the board stops the
server too.

```bash
lantern --port 3400
```

`--server-only` leaves the board out, which is what a container, a service file or anything else
without a terminal wants. Lantern falls back to it on its own when there is no terminal to draw on,
so a plain `lantern` still works unattended.

```bash
lantern --server-only --port 3400
```

<p align="center">
  <img src="screenshots/topics.jpg" alt="Topics grouped by subject, each with an icon and a conversation count" width="100%">
</p>

- **Topics instead of folders.** Conversations are clustered by subject, each topic with its own icon,
  colour and count. Grouping is local and deterministic by default: no model call, no network, no
  cost. See [How grouping works](grouping.md).
- **Optional AI naming.** One button hands the conversation titles to the Claude Code CLI you are
  already signed in to and gets back proper topic names like _Home Network_ or _Orders API_. Results
  are cached per session, nothing runs in the background, and each pass reports the usage it drew.
  This is the same pass `t` runs on the board.
- **Every session in one place.** A flat, filterable list across every project — and every machine, if
  you point Lantern at more than one log directory.
- **More than one CLI.** Claude Code, Codex CLI, opencode, Qwen Code, GitHub Copilot CLI and goose
  sessions sit side by side, grouped into the same workspace when they ran in the same repo. Pick
  which CLIs to read in settings. Claude Code stays the interactive one; other sources are read-only.
  See [Agent CLIs](agents.md).
- **Honest costs.** A CLI that records what a turn cost is believed; one that does not is estimated
  and marked `~`; a model with no price table reads `—` rather than `$0.00`.
- **Three layouts.** Rows, cards, or a full-width board with one column per topic, newest first.
- **Six languages.** English, Spanish, French, Portuguese, Japanese and Simplified Chinese. Picked up
  from your browser on first load, and changeable in settings. The terminal board is English only.
- **A full session viewer.** Live conversation log viewing, search, cost and token breakdowns, git
  integration, an in-app terminal, and PWA support for phones.

<p align="center">
  <img src="screenshots/topic-table.jpg" alt="Board view with one column per topic" width="100%">
</p>

<p align="center">
  <img src="screenshots/conversations.jpg" alt="Every conversation across every project, newest first" width="100%">
</p>

## Security

> Lantern's web UI ships an in-app terminal. Binding to anything other than `localhost` without
> `--password` hands a remote shell to whoever finds the port. Use `--terminal-disabled` and a
> password, or keep it behind a VPN such as Tailscale. `--terminal-unrestricted` removes the guard
> rails from bash sessions, so treat it as widening that same hole.

None of that applies to `lantern --cli-only` (or `lantern browse`), which opens no port and serves
nothing.

If you have run `lantern init` and told it to bind beyond `localhost`, that answer is stored, and a
bare `lantern` now starts a server where `lantern browse` started none. Check `~/.lantern/config.json`
before the first run of a version with this in it, or use `--cli-only` to open no port at all.

The threat model, what a running instance exposes, and how to report a vulnerability privately are all
in [SECURITY.md](../SECURITY.md). Binding and password options are in
[Configuration](configuration.md#binding).

## Ports and addresses

Lantern binds `127.0.0.1:3000` by default. See [Configuration](configuration.md) for the full options
table, how a setting is resolved, and why the bind address is not read from `HOSTNAME`.

## More than one terminal

One web server serves them all. A second `lantern` sees the one already listening, opens its board
against it and starts no server of its own — so you can run as many as you have terminals, and
quitting one leaves the rest alone. The board reads the cache directly rather than over HTTP, so it
loses nothing by not having a server behind it.

`lantern --server-only` is the exception: it asked for a server, has no board to fall back to, and
says so rather than starting a second one. Pass `--port` if a genuinely separate web UI is what you
want.
