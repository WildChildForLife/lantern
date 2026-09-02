/**
 * Says something to the reader once, however many times it comes up.
 *
 * The settings file is opened two or three times on a single launch — the
 * update notice reads it, the wizard asks whether it exists, the options are
 * loaded from it — and each read is entitled to complain about a file it could
 * not parse. One launch is one problem, so the first complaint is the one that
 * gets printed and the rest are dropped.
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
