# How grouping works

Lantern groups every conversation by **what it is about**, not by which folder it happened to start
in. There are two ways it arrives at a topic, and the first one is always on.

## By default, locally

Lantern takes the title the agent wrote for each conversation, whichever CLI it came from, drops the
words that say nothing (`fix`, `add`, `error`, `the`), and repeatedly carves off the largest group of
conversations sharing a word. Leftovers fall back to the folder they were started in, then to any
topic they mention, and anything still homeless lands in _Uncategorized_. It costs nothing and
re-runs on every request, so new conversations are grouped as they appear.

No model call, no network, no cost, and the same input always gives the same answer.

## Optionally, with Claude Code

Keyword clustering names topics after words, which is sometimes clumsy. Press `t` on the board — or
**Sort N unsorted** in the web UI — and Lantern batches the titles through `claude -p` and stores the
answer per session. It reuses your existing Claude Code login: there is no API key to configure and
no separate bill. Nothing runs automatically.

That pass only ever touches conversations with no topic at all, so it never pays to re-file one it
has already filed — not even when the title changes later. To redo everything, press `T` on the board
or **Redo all** on the web UI's topics page. The web UI can also redo a hand-picked selection: tick
them in the list and press **Sort selected into topics**, which is also how conversations are marked
done in bulk.

This pass is the one Claude Code-specific feature, because `claude` is the CLI Lantern shells out to.
It names topics for conversations from every source, not only Claude Code's own.

## Where the keys are

`t` and `T` on the terminal board are documented in [The board](board.md#sorting-into-topics). The
equivalent buttons live on the web UI's topics page — see [The web UI](web-ui.md).
