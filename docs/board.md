# The board in your terminal

`lantern` draws the same board the web UI does, without opening a browser. It takes the whole
terminal while it is up, on the same alternate screen `less` and `vim` use, and gives your scrollback
back when you quit.

A bare `lantern` starts the web server behind the board and prints its address before drawing, so one
word gets you both and quitting the board stops both. `lantern --cli-only` — or `lantern browse`,
which is the same thing — draws the board on its own, opening no port at all.

```text
   Lantern  6 topics · 69 conversations · enter: resume here

    ⌕ SEARCH  press / to search titles, projects and topics

   ⌁ Orders API 1/12              ≋ Home Network 6              ▣ Deploy Pipeline 5
   ─────────────────────────────  ────────────────────────────  ───────────────────
   ❯ Add refunds to checkout  2h     Router DHCP leases    1d      Cache the build 3h
     Fix the webhook retry    5h     Split the VLANs       2d      Pin the runner  1d
     Rename the price field   1d     Static leases for NAS 4d
    ↓ 9 more

    t  sort 4 conversations into topics with the AI · T redoes every topic

   /home/you/work/orders-api · claude-code · sonnet · ~$0.42 · 24 messages · 4f2ab8c1
   ←→ topics · ↑↓ rows · / search · PgUp/PgDn page · e change · r reload · ? keys · q quit
```

One column per topic, conversations as rows, newest topic first. The board sits in the middle of the
window: with little to show it gathers in the centre rather than splitting itself between the top and
the bottom edge, and as a column fills up the key line walks down to the gutter and stops there.

A column longer than the screen scrolls rather than being cut off. The list stays still while the
cursor moves through it and only gives once the cursor reaches the end of what is drawn, `↑ N more`
and `↓ N more` say how much is off either end, and the count beside the topic name reads `1/12` — how
far down the column you are, not just how long it is. The key line never moves out of the way for it.

## Keys

| Key           | Does                                                       |
| ------------- | ---------------------------------------------------------- |
| `← →`         | move between topics (`h` `l` also work)                    |
| `↑ ↓`         | move between conversations (`j` `k`), `g`/`G` for the ends |
| `PgUp` `PgDn` | a screenful at a time (`Ctrl-U` / `Ctrl-D` also work)      |
| `/`           | search titles, projects and topics                         |
| `esc`         | clear the search                                           |
| `enter`       | what to do with this conversation                          |
| `R`           | resume here, and come back to the board after              |
| `p`           | show the resume command, without leaving                   |
| `c`           | copy the conversation id                                   |
| `t`           | sort the conversations with no topic yet                   |
| `T`           | throw every topic away and sort again (asks first)         |
| `r`           | re-read the logs · `?` the key list · `q` quit             |

Below about ninety columns the board becomes a topic list on the left and its conversations on the
right; the keys are unchanged.

## Searching

The search bar is always on screen, under the header. `/` puts the cursor in it, `enter` goes back to
the board with the query still showing and still in force, and `esc` clears it.

Naming a topic keeps that whole column — `/network` reads as "show me that one". Anything else
narrows to the conversations that match it, wherever they live, and the matched characters are picked
out in the row.

Matching does more than look for the query inside the title:

- **Several words**, and all of them have to match — though not all in the same place, so
  `refund lantern` finds a refund conversation in the `lantern` project.
- **Characters in order**, not only whole words: `rdhcp` finds "Router DHCP leases".
- **Case is ignored** until the query mixes it. `api` and `API` both find either spelling; `Api` asks
  for that spelling exactly.
- **The closest match goes first.** A whole word beats the same letters scattered about, the start of
  a word beats the middle of one, and a hit in the title counts for more than one in the project path
  every conversation there shares. Recency settles ties.

## Resuming

`R` lends the terminal to the session rather than giving it away: when you leave `claude`, the same
board comes back — same topic, same conversation, same search — with the logs re-read, so you can
resume something else without starting the board again.

A conversation is always resumed **in the directory it ran in** — `claude --resume` looks a session
up by that directory, so anywhere else it reports the conversation as missing. If that folder has
since been deleted, Lantern says so rather than resuming somewhere wrong.

Resuming is Claude Code only, as everywhere else in Lantern — conversations from the other five CLIs
show those actions greyed out, and copying the id still works. Copying uses the terminal's own
clipboard escape sequence first, so it reaches your machine's clipboard even over SSH.

## Showing the command instead

`p` shows the command under the board instead of quitting. Pressing `p` on another conversation
replaces it and blinks so you can see that it changed, and whatever is on show is printed once more
on the way out, so `p` then `q` leaves something behind to paste.

## Sorting into topics

`t` sorts conversations into topics with the configured agent CLI — the same pass the web UI's
buttons start, run against the same local cache. It has a row of its own above the key line, because
it is the one key on the board that spends a CLI call, and it says how many conversations are waiting
so you can see whether there is anything to sort before finding out the expensive way. The board
re-reads the logs when the pass ends, so the new topics appear without pressing `r`.

`T` is the terminal's "Redo all": every stored topic thrown away and everything filed again. It asks
first — only `y` goes ahead — because it spends a pass on conversations that were already filed. When
nothing is waiting to be sorted the row says so and offers `T`, rather than disappearing: a key that
only shows up on the day it becomes relevant is a key nobody knows is there.

See [How grouping works](grouping.md) for what the pass actually does.

## What Enter does

The header shows what `enter` will do; `e` cycles through resuming here, showing the command and
copying the id, and remembers the choice for next time. Enter then does exactly that — there is no
menu in between, and each of the three has its own key as well.

## Options the board reads

The board reads `--claude-dir`, `--executable`, `--source` and `--verbose` — on either side of the
command name, when you spell it as `lantern browse`. The port and bind address mean nothing to the
board itself; with `--cli-only` nothing listens on them at all. See
[Configuration](configuration.md) for the full table.
