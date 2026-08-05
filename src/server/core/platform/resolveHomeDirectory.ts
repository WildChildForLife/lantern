/**
 * The user's home directory, taken from whichever variable the platform sets.
 *
 * Unix-like systems set `HOME`. Windows sets `USERPROFILE` and leaves `HOME`
 * unset unless a POSIX layer such as Git Bash or WSL adds it, so reading `HOME`
 * alone resolved to the filesystem root there and Lantern looked for `.claude`
 * in `C:\` — finding nothing, while Claude Code wrote to the real profile.
 *
 * `HOME` wins when both are set: under Git Bash or WSL it is the one the user's
 * own tooling agrees on, and overriding it is how someone points Lantern at a
 * different profile.
 */
export const resolveHomeDirectory = (
  home: string | undefined,
  userProfile: string | undefined,
): string | undefined => {
  if (home !== undefined && home !== "") {
    return home;
  }
  if (userProfile !== undefined && userProfile !== "") {
    return userProfile;
  }
  return undefined;
};
