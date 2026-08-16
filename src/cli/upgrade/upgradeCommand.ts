import { z } from "zod";
import packageJson from "../../../package.json" with { type: "json" };
import { fetchLatestVersion } from "../update/latestVersion.ts";
import { detectInstallSource, isWritable } from "./detectInstall.ts";
import type { InstallSource } from "./installSource.ts";
import { runUpgradeCommand } from "./runUpgradeCommand.ts";
import { commandText, makeUpgradePlan, type UpgradePlan } from "./upgradePlan.ts";

/**
 * `upgrade` declares its own flags, and only its own.
 *
 * The opposite of `src/cli/commandOptions.ts`: `--check` and `--dry-run` exist
 * nowhere else, so the subcommand's own `opts()` is the whole story and reading
 * the root's would only let an unrelated flag through.
 */
const upgradeOptionsSchema = z.object({
  check: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export type UpgradeCommandOptions = z.infer<typeof upgradeOptionsSchema>;

export const parseUpgradeOptions = (raw: unknown): UpgradeCommandOptions => {
  const result = upgradeOptionsSchema.safeParse(raw);

  return result.success ? result.data : {};
};

const indent = (commands: readonly string[]): string =>
  commands.map((command) => `  ${command}`).join("\n");

/** What the user reads. Kept pure so the wording is settled in tests. */
export const renderUpgradePlan = (plan: UpgradePlan): string => {
  switch (plan.kind) {
    case "up-to-date":
      return `Lantern ${plan.version} is the latest release.`;

    case "available":
      return [
        `Lantern ${plan.to} is available (you have ${plan.from}).`,
        "",
        indent([commandText({ binary: plan.binary, args: plan.args })]),
      ].join("\n");

    case "run":
      return `Upgrading Lantern ${plan.from} → ${plan.to}.`;

    case "refused":
      return [
        plan.reason,
        "",
        indent(plan.commands),
        "",
        ...(plan.note === null ? [] : [plan.note]),
        "Nothing was changed.",
      ].join("\n");

    case "unreachable":
      return `${plan.reason}\nNothing was changed.`;

    default:
      plan satisfies never;
      return "";
  }
};

/**
 * What to do when the package manager gives up.
 *
 * The child owned the terminal, so its error text went to the user and not to
 * Lantern. Naming the two failures that actually happen — a tree the package
 * manager could not replace because this process is running out of it — is
 * worth more than a generic "it failed".
 */
const remediation = (binary: string, command: string, code: number): string =>
  [
    `The upgrade did not finish (${binary} exited ${code}).`,
    "",
    "If it mentioned ENOTEMPTY or EPERM, the package manager could not replace a",
    "tree Lantern is running from. Close this process and run it again:",
    "",
    indent([command]),
  ].join("\n");

const needsRegistry = (source: InstallSource): boolean =>
  source.kind === "npm-global" || source.kind === "npx-cache";

/**
 * Upgrades Lantern where it was installed, or says what would.
 *
 * Plain output rather than an Ink screen: this has to work over `ssh host
 * lantern upgrade` and inside a script, and the package manager writes to the
 * same terminal while it runs — two things an alternate-screen render cannot
 * share.
 */
export const runUpgrade = async (options: UpgradeCommandOptions): Promise<number> => {
  const source = await detectInstallSource();
  const latest = needsRegistry(source) ? await fetchLatestVersion() : null;
  const rootWritable = source.kind === "npm-global" ? await isWritable(source.root) : true;

  const plan = makeUpgradePlan({
    source,
    current: packageJson.version,
    latest,
    dryRun: options.dryRun === true,
    checkOnly: options.check === true,
    rootWritable,
  });

  process.stdout.write(`${renderUpgradePlan(plan)}\n`);

  if (plan.kind === "refused" || plan.kind === "unreachable") {
    return 1;
  }

  if (plan.kind !== "run") {
    return 0;
  }

  const command = commandText({ binary: plan.binary, args: plan.args });
  const code = await runUpgradeCommand(plan.binary, plan.args);

  if (code !== 0) {
    process.stderr.write(`\n${remediation(plan.binary, command, code)}\n`);

    return code;
  }

  // Deliberately the last thing this build does: the new version is on disk,
  // but this process is still the old one, and re-executing it would run code
  // from a tree that was replaced underneath it.
  process.stdout.write(
    `\nUpgraded to ${plan.to}. Run \`lantern --version\` to confirm, then start it again.\n`,
  );

  return 0;
};
