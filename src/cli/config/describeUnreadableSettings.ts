/**
 * What to print when the settings file cannot be understood.
 *
 * Losing a settings file costs a port and a directory, not a launch — so this
 * says what was dropped and carries on, rather than reading like the stop it is
 * not. The path is spelled out because the file is somewhere nobody browses to
 * by accident, and both ways out are given: the file is usually one hand-edited
 * comma away from working, but deleting it is the answer for anybody who no
 * longer remembers what was in it.
 */
export const describeUnreadableSettings = (configPath: string): string =>
  [
    `Your Lantern settings could not be read, so this run uses the defaults.`,
    "",
    `  ${configPath}`,
    "",
    "Fix the JSON in that file to get your settings back, or delete it to start",
    "over from the defaults.",
  ].join("\n");
