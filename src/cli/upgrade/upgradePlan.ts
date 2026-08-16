import packageJson from "../../../package.json" with { type: "json" };
import { isUpgrade } from "../../lib/version/semver.ts";
import type { InstallSource, PackageManager } from "./installSource.ts";

const PACKAGE = packageJson.name;
const IMAGE = "ghcr.io/wildchildforlife/lantern:latest";
const ISSUES_URL = "https://github.com/WildChildForLife/lantern/issues";

export type UpgradeCommand = { binary: string; args: readonly string[] };

export type UpgradePlan =
  | { kind: "up-to-date"; version: string }
  /** There is a newer release, and the user asked to be told rather than moved. */
  | { kind: "available"; from: string; to: string; binary: string; args: readonly string[] }
  | { kind: "run"; from: string; to: string; binary: string; args: readonly string[] }
  | {
      kind: "refused";
      reason: string;
      /** What the user should run instead, one command per line. */
      commands: readonly string[];
      note: string | null;
    }
  | { kind: "unreachable"; reason: string };

export type UpgradeRequest = {
  source: InstallSource;
  /** The version running now. */
  current: string;
  /** The version on the registry, or null when it could not be asked. */
  latest: string | null;
  dryRun: boolean;
  checkOnly: boolean;
  /** Whether this user can write to the tree the upgrade would replace. */
  rootWritable: boolean;
};

/**
 * The install command each package manager takes.
 *
 * Spelled out rather than templated, because the verbs genuinely differ:
 * `pnpm install -g` and `bun install -g` are not commands, and yarn 2 dropped
 * `yarn global` — which is safe here only because the detector reaches `yarn`
 * through the yarn 1 global root and nothing else.
 */
const installCommand = (manager: PackageManager): UpgradeCommand => {
  const target = `${PACKAGE}@latest`;

  switch (manager) {
    case "npm":
      return { binary: "npm", args: ["install", "-g", target] };
    case "pnpm":
      return { binary: "pnpm", args: ["add", "-g", target] };
    case "bun":
      return { binary: "bun", args: ["add", "-g", target] };
    case "yarn":
      return { binary: "yarn", args: ["global", "add", target] };
    default:
      manager satisfies never;
      return { binary: "npm", args: ["install", "-g", target] };
  }
};

export const commandText = (command: UpgradeCommand): string =>
  [command.binary, ...command.args].join(" ");

const removeCommand = (manager: "apt" | "dnf" | "unknown"): string | null =>
  manager === "unknown" ? null : `sudo ${manager} remove lantern`;

/**
 * Why Lantern will not upgrade this install, and what will.
 *
 * Every branch names a command. A refusal that only says no leaves the user
 * with an out-of-date Lantern and nowhere to go, which is worse than the
 * ENOTEMPTY this is avoiding.
 */
const refuse = (source: InstallSource, latest: string | null): UpgradePlan => {
  switch (source.kind) {
    case "system-package": {
      const remove = removeCommand(source.manager);

      return {
        kind: "refused",
        reason: [
          "Lantern was installed from a .deb or .rpm (/usr/lib/lantern).",
          "",
          "That channel has been retired: no newer version is published there,",
          "so this install will stay where it is.",
          "",
          "Move to npm — the same build, and `lantern upgrade` keeps it current",
          "from then on:",
        ].join("\n"),
        commands: [...(remove === null ? [] : [remove]), `npm install -g ${PACKAGE}`],
        note:
          remove === null
            ? "Remove the system package first, with whatever installed it. Your settings and cache in ~/.lantern survive both steps."
            : "Your settings and cache in ~/.lantern survive both steps.",
      };
    }

    case "homebrew":
      return {
        kind: "refused",
        reason: `Lantern was installed by Homebrew (${source.prefix}).\nUpgrade it with the tool that installed it:`,
        commands: [`brew update && brew upgrade ${PACKAGE}`],
        note: null,
      };

    case "docker":
      return {
        kind: "refused",
        reason: "Lantern is running inside a container. Upgrade the image instead:",
        commands: [`docker pull ${IMAGE}`, "docker compose up -d"],
        note: "Or re-run the `docker run` line you started it with.",
      };

    case "npx-cache":
      return {
        kind: "refused",
        reason: [
          "This is a one-off `npx` run, so there is nothing installed to upgrade" +
            (latest === null ? "." : ` —`),
          ...(latest === null ? [] : [`npx already fetched the latest release (${latest}).`]),
          "",
          "For a permanent install that `lantern upgrade` can keep current:",
        ].join("\n"),
        commands: [`npm install -g ${PACKAGE}`],
        note: null,
      };

    case "git-checkout":
      return {
        kind: "refused",
        reason: `Lantern is running from a git checkout (${source.root}).\nUpgrade it the way you built it:`,
        commands: ["git pull && pnpm install && pnpm build"],
        note: null,
      };

    case "unknown":
      return {
        kind: "refused",
        reason: `Lantern could not work out how it was installed (${source.path}).\nThe npm install is:`,
        commands: [`npm install -g ${PACKAGE}@latest`],
        note: `If you did install it with npm, that is a gap worth closing — please open an issue with the path above: ${ISSUES_URL}`,
      };

    case "npm-global":
      return {
        kind: "refused",
        reason: `Lantern is installed under ${source.root}, which this user cannot write to.\nRun the upgrade with the privileges that installed it:`,
        commands: [`sudo ${commandText(installCommand(source.manager))}`],
        note: null,
      };

    default:
      source satisfies never;
      return {
        kind: "refused",
        reason: "Lantern could not work out how it was installed.\nThe npm install is:",
        commands: [`npm install -g ${PACKAGE}@latest`],
        note: null,
      };
  }
};

/**
 * Decides what `lantern upgrade` should do, without doing any of it.
 *
 * Split from the doing so the cases that are awkward to reach on a developer's
 * own machine — a read-only prefix, a Homebrew install, a beta on the `latest`
 * tag — are settled in tests rather than by spawning a package manager.
 */
export const makeUpgradePlan = (request: UpgradeRequest): UpgradePlan => {
  const { source, current, latest } = request;

  if (source.kind !== "npm-global") {
    return refuse(source, latest);
  }

  if (latest === null) {
    return {
      kind: "unreachable",
      reason: "Lantern could not reach the npm registry to see what has been published.",
    };
  }

  if (!isUpgrade(current, latest)) {
    return { kind: "up-to-date", version: current };
  }

  if (!request.rootWritable) {
    return refuse(source, latest);
  }

  const command = installCommand(source.manager);
  const move = { from: current, to: latest, binary: command.binary, args: command.args };

  return request.checkOnly || request.dryRun
    ? { kind: "available", ...move }
    : { kind: "run", ...move };
};
