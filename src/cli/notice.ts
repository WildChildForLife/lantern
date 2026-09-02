/**
 * Says something to the reader once, however many times it comes up.
 *
 * Settings are loaded more than once on some launches — the wizard reads them,
 * and a wizard somebody backed out of is followed by another read — and each of
 * those reads finds the same broken file and has the same thing to say about
 * it. One launch is one problem, so the first telling is the one that gets
 * printed and the rest are dropped.
 *
 * Deduplicated on the finished message, which carries the path, so two
 * different files are still two different notices. That does mean two genuinely
 * separate problems that happen to read identically would collapse into one —
 * fine while every caller says something naming what it is about, and the
 * reason this is not the right tool for anything that legitimately repeats.
 *
 * The writer is a parameter so the remembering can be tested without a process
 * to write to; `noticeOnce` below is the one that talks to a terminal.
 */
export const makeNoticeOnce = (write: (line: string) => void) => {
  const said = new Set<string>();

  return (message: string): void => {
    if (said.has(message)) {
      return;
    }

    said.add(message);
    write(`${message}\n`);
  };
};

/**
 * The process-wide notice writer.
 *
 * stderr, like every other thing Lantern says on the way up: `lantern | tee` is
 * still somebody at a terminal, and a redirected stdout is not a reason to keep
 * a lost preference quiet.
 */
export const noticeOnce = makeNoticeOnce((line) => {
  process.stderr.write(line);
});
