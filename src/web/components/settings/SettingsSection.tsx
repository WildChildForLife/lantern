import type { FC, ReactNode } from "react";

/**
 * One group of settings under a heading.
 *
 * The panel used to be a single unbroken column of a dozen unrelated controls,
 * where finding the one you wanted meant reading all of them. Headings turn
 * that into a scan.
 */
export const SettingsSection: FC<{
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}> = ({ title, description, children }) => (
  <section className="space-y-3 pb-1">
    <div className="space-y-0.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {description === undefined ? null : (
        <p className="text-xs text-muted-foreground/80">{description}</p>
      )}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
);

/**
 * A short status word, coloured by whether it is good news.
 *
 * Used for things the user cannot change and needs to read at a glance —
 * whether a CLI was found, whether Lantern can read it. Colour carries the
 * meaning but never alone: the word says the same thing for anyone who cannot
 * separate the two.
 */
export const StatusBadge: FC<{ readonly tone: "good" | "bad" | "muted"; children: ReactNode }> = ({
  tone,
  children,
}) => {
  const toneClass =
    tone === "good"
      ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
      : tone === "bad"
        ? "text-red-600 dark:text-red-400 bg-red-500/10"
        : "text-muted-foreground bg-muted";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
};
