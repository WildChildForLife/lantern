# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/WildChildForLife/lantern/security/advisories/new)
rather than opening a public issue.

Include what you did, what happened, and what you expected. A proof of concept helps. You should get a
first response within a week.

## What Lantern exposes

Lantern is a local-first tool, and the threat model follows from that.

- **It reads your agent CLI session logs** — Claude Code, Codex CLI and opencode, whichever you enable
  — which contain everything you and the agent said, including anything sensitive that ended up in a
  prompt. Treat a running instance as equivalent to read access to those logs.
- **It ships an in-app terminal and can start agent sessions.** Anyone who can reach the port can run
  commands as the user running Lantern. Only Claude Code is driven interactively; the other sources are
  read-only, which limits what they add to this but not what they expose.
- **It binds to `localhost` by default.** That default is the security boundary.

If you expose it beyond localhost:

- always set `--password`,
- consider `--terminal-disabled`,
- prefer a private network (Tailscale, WireGuard, an SSH tunnel) over a public port,
- put TLS in front of it — the password is sent to the server, so plain HTTP over an untrusted network
  leaks it.

## Optional AI classification

Topic classification shells out to the `claude` CLI on the machine running Lantern, using your existing
Claude Code login. It sends **conversation titles and project paths** — not conversation contents — and
only when you press the button. It is never triggered automatically.
