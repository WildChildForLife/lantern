/**
 * What to print when the settings file is there but gave nothing up.
 *
 * Losing a settings file costs a port and a directory, not a launch — so this
 * says what was dropped and carries on, rather than reading like the stop it is
 * not. The path is spelled out because the file is somewhere nobody browses to
 * by accident.
 *
 * It stops short of naming the fault. The two ways to reach this are a file
 * that will not parse and a file that will not open, and the advice for one is
 * wrong for the other — telling somebody whose file is owned by root to check
 * their commas would send them looking in the wrong place. "Open it and see" is
 * true of both, and the file itself will make which one obvious.
 */
export const describeUnreadableSettings = (configPath: string): string =>
  [
    `Your Lantern settings could not be read, so this run uses the defaults.`,
    "",
    `  ${configPath}`,
    "",
    "Open that file to see why — bad JSON and a file Lantern is not allowed to",
    "read both land here. Deleting it starts again from the defaults.",
  ].join("\n");
