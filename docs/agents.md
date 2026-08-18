# Agent CLIs

<table>
  <tr>
    <td align="center" width="120">
      <img src="icons/claude-code.svg" width="30" height="30" alt=""><br>
      <b>Claude Code</b>
    </td>
    <td align="center" width="120">
      <img src="icons/codex.svg" width="30" height="30" alt=""><br>
      <b>Codex CLI</b>
    </td>
    <td align="center" width="120">
      <img src="icons/opencode.svg" width="30" height="30" alt=""><br>
      <b>opencode</b>
    </td>
    <td align="center" width="120">
      <img src="icons/qwen-code.svg" width="30" height="30" alt=""><br>
      <b>Qwen Code</b>
    </td>
    <td align="center" width="120">
      <img src="icons/copilot.svg" width="30" height="30" alt=""><br>
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
| **goose**       | `~/.local/share/goose/`     | `1.45.0`         | Read-only                 |

Sessions from every enabled CLI sit in the same topics, the same searchable list and the same board,
and are grouped into one workspace when they ran in the same repo. Pick which to read in settings.
Claude Code stays the only interactive one — starting, resuming and approving a turn go through the
Agent SDK, which the others have no equivalent for.

"Verified against" means that exact version was run and the history it wrote was read back, rather
than inferred from a format description. [`docker/compatibility.md`](../docker/compatibility.md)
records how, and what each run turned up. Both of opencode's storage layouts are read: the JSON tree
and the SQLite database a current install writes, and goose's own database. Gemini CLI and
cursor-agent are not read yet.

## Reading other agent CLIs

Codex, opencode, Qwen Code, Copilot CLI and goose are read from wherever those CLIs themselves keep
their history, so pointing Lantern at them is the same gesture as pointing the CLI at them:

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

Directories on filesystems without inotify (a Windows drive mounted into WSL, for instance) are
picked up on restart rather than live.
