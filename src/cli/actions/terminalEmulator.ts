import { shellEscape } from "../../lib/shell/shellEscape.ts";

export type EmulatorLaunch = {
  binary: string;
  args: string[];
};

export type LaunchParams = {
  /** The shell command to run in the new window, already escaped. */
  command: string;
  cwd: string;
};

/**
 * Windows Terminal reads `;` as a separator between the commands it should
 * open, so an unescaped one in the command *we* want run is taken as a second
 * pane — and reported as a missing file.
 */
const escapeForWindowsTerminal = (command: string): string => command.replaceAll(";", "\\;");

/** What `TERM_PROGRAM` says, mapped to the binary that reopens the same thing. */
const BY_TERM_PROGRAM: Record<string, string> = {
  WezTerm: "wezterm",
  "iTerm.app": "osascript",
  Apple_Terminal: "osascript",
  ghostty: "ghostty",
  kitty: "kitty",
  alacritty: "alacritty",
  konsole: "konsole",
};

const LINUX_CANDIDATES = [
  "wezterm",
  "kitty",
  "ghostty",
  "alacritty",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "xterm",
];

/**
 * Terminals worth trying, best first.
 *
 * The one the user is already sitting in comes first: reopening the same
 * emulator is the least surprising thing a "new window" can do.
 */
export const candidateBinaries = (
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): string[] => {
  const candidates: string[] = [];

  // The terminal the user is in comes first, ahead of any platform default —
  // reopening the same application is the least surprising thing a "new
  // window" can do, and that is the whole point of looking at TERM_PROGRAM.
  const current = env["TERM_PROGRAM"];
  const fromCurrent = current === undefined ? undefined : BY_TERM_PROGRAM[current];
  if (fromCurrent !== undefined) {
    candidates.push(fromCurrent);
  }

  // A WSL session's windows are Windows windows, whatever the platform says.
  if (env["WSL_DISTRO_NAME"] !== undefined) {
    candidates.push("wt.exe");
  }

  if (platform === "darwin") {
    candidates.push("osascript");
  } else if (platform === "win32") {
    candidates.push("wt.exe", "cmd.exe");
  } else {
    candidates.push(...LINUX_CANDIDATES);
  }

  return [...new Set(candidates)];
};

/**
 * Keeps the window alive once the conversation ends.
 *
 * A window that closes the instant `claude` exits takes the last thing it
 * printed with it, which is usually the part worth reading.
 */
const withTrailingShell = (command: string): string => `${command}; exec \${SHELL:-/bin/sh}`;

/**
 * Turns a terminal binary into the exact argv that opens a window running the
 * command, in the right directory.
 *
 * Returns null for anything not listed, so the caller falls back to printing
 * the command rather than guessing at flags.
 */
export const buildEmulatorLaunch = (
  binary: string,
  params: LaunchParams,
  context?: { wsl?: boolean | undefined },
): EmulatorLaunch | null => {
  const inner = withTrailingShell(params.command);

  switch (binary) {
    case "wezterm":
      return { binary, args: ["start", "--cwd", params.cwd, "--", "sh", "-c", inner] };
    case "kitty":
      return { binary, args: ["--directory", params.cwd, "sh", "-c", inner] };
    case "ghostty":
      return { binary, args: [`--working-directory=${params.cwd}`, "-e", "sh", "-c", inner] };
    case "alacritty":
      return { binary, args: ["--working-directory", params.cwd, "-e", "sh", "-c", inner] };
    case "gnome-terminal":
      return { binary, args: [`--working-directory=${params.cwd}`, "--", "sh", "-c", inner] };
    case "xfce4-terminal":
      return { binary, args: [`--working-directory=${params.cwd}`, "-x", "sh", "-c", inner] };
    case "konsole":
      return { binary, args: ["--workdir", params.cwd, "-e", "sh", "-c", inner] };
    case "xterm":
      return { binary, args: ["-e", "sh", "-c", `cd ${shellEscape(params.cwd)} && ${inner}`] };
    case "osascript":
      // Terminal.app takes no command line argument for this; AppleScript is
      // the documented way in.
      return {
        binary,
        args: [
          `tell application "Terminal" to do script ${JSON.stringify(
            `cd ${shellEscape(params.cwd)} && ${params.command}`,
          )}`,
        ].flatMap((script) => ["-e", script]),
      };
    case "wt.exe":
      // Inside WSL both the directory and the command are POSIX, and Windows
      // Terminal can run neither directly — `wsl.exe` is the way back into the
      // distribution they belong to. Started from Windows itself there is no
      // distribution in the picture and no POSIX shell to reach.
      return context?.wsl === true
        ? {
            binary,
            args: [
              "wsl.exe",
              "--cd",
              params.cwd,
              "--",
              "sh",
              "-c",
              escapeForWindowsTerminal(inner),
            ],
          }
        : {
            binary,
            args: ["-d", params.cwd, "cmd.exe", "/k", escapeForWindowsTerminal(params.command)],
          };
    case "cmd.exe":
      // `/d` sets the new window's directory; every other recipe honours cwd and
      // this one has to as well, or the conversation resumes in the wrong repo.
      return { binary, args: ["/c", "start", "", "/d", params.cwd, "cmd", "/k", params.command] };
    default:
      return null;
  }
};

/**
 * Renders the user's own `browse.terminalCommand` template.
 *
 * Run through a shell rather than split into argv: the escape hatch exists for
 * setups this file does not know about, and those tend to need pipes and
 * `&&`.
 */
export const applyTerminalTemplate = (
  template: string,
  params: LaunchParams,
  options: { platform: NodeJS.Platform },
): EmulatorLaunch => {
  const rendered = template
    .replaceAll("{{command}}", shellEscape(params.command))
    .replaceAll("{{cwd}}", shellEscape(params.cwd));

  return options.platform === "win32"
    ? { binary: "cmd.exe", args: ["/c", rendered] }
    : { binary: "sh", args: ["-c", rendered] };
};
