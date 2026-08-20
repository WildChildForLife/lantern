/**
 * The oldest Node Lantern runs on.
 *
 * drizzle-orm's node-sqlite adapter uses StatementSync.setReturnArrays(), which
 * is only available in Node.js >=24.0.0.
 *
 * @see https://nodejs.org/api/sqlite.html#statementsetreturnarraysenabled
 */
const MINIMUM_MAJOR = 24;

/**
 * What to print when Node is too old to run on, or `null` when it is not.
 *
 * The version alone is a requirement, not an answer — somebody reading this has
 * a Node they did not choose on purpose, usually the one their distribution or
 * their `nvm` default gave them. Both ways out are printed because which one
 * applies depends on how they got the Node they have.
 */
export const describeOutdatedNode = (version: string): string | null => {
  const major = Number.parseInt(version.replace(/^v/u, ""), 10);

  if (Number.isNaN(major) || major >= MINIMUM_MAJOR) {
    return null;
  }

  // Padded rather than spaced by hand: the left-hand column is built from
  // MINIMUM_MAJOR, so its width changes the day that constant does.
  const routes: readonly (readonly [string, string])[] = [
    [`nvm install ${MINIMUM_MAJOR} && nvm use ${MINIMUM_MAJOR}`, "if you use nvm"],
    ["https://nodejs.org/en/download", "to install it yourself"],
  ];
  const column = Math.max(...routes.map(([command]) => command.length));

  return [
    `Lantern needs Node.js ${MINIMUM_MAJOR} or newer, and this one is ${version}.`,
    "",
    ...routes.map(([command, when]) => `  ${command.padEnd(column)}   ${when}`),
    "",
    "Homebrew's lantern-viewer brings its own Node, if you would rather not keep",
    "one up to date yourself.",
  ].join("\n");
};

/** Stops before anything else runs when the Node underneath cannot run it. */
export const checkNodeVersion = (): void => {
  const problem = describeOutdatedNode(process.version);

  if (problem === null) {
    return;
  }

  process.stderr.write(`${problem}\n`);
  process.exit(1);
};
