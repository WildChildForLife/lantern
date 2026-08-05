import { Trans } from "@lingui/react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import type { FC } from "react";
import { StatusBadge } from "./SettingsSection";

/**
 * A colour per CLI, so the tiles are told apart before they are read.
 *
 * A monogram rather than a vendor logo: shipping someone else's mark means
 * shipping their trademark, and a wrong or stale one is worse than none.
 */
const TILE_STYLES: Record<string, { readonly initial: string; readonly accent: string }> = {
  "claude-code": { initial: "C", accent: "bg-orange-500/15 text-orange-500 border-orange-500/30" },
  codex: { initial: "◇", accent: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  opencode: { initial: "◈", accent: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  "qwen-code": { initial: "◆", accent: "bg-teal-500/15 text-teal-400 border-teal-500/30" },
};

const FALLBACK = { initial: "•", accent: "bg-muted text-muted-foreground border-border" };

export type SourceTileProps = {
  readonly id: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly supported: boolean;
  readonly interactive: boolean;
  readonly sessions: number;
  readonly projects: number;
  readonly unsupportedLabel: string;
  readonly disabled: boolean;
  readonly onToggle: (next: boolean) => void;
};

/**
 * One agent CLI, as a card rather than a row in a list.
 *
 * Which CLIs Lantern reads is the setting the rest of the app hangs off, and it
 * read as just another checkbox among a dozen. A tile that can be pointed at
 * matches how much it decides.
 */
export const SourceTile: FC<SourceTileProps> = ({
  id,
  displayName,
  enabled,
  supported,
  interactive,
  sessions,
  projects,
  unsupportedLabel,
  disabled,
  onToggle,
}) => {
  const style = TILE_STYLES[id] ?? FALLBACK;
  const selectable = supported || enabled;

  return (
    <button
      type="button"
      disabled={disabled || !selectable}
      onClick={() => onToggle(!enabled)}
      aria-pressed={enabled}
      className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors
        ${enabled ? "border-primary/60 bg-primary/5" : "border-border/60 bg-transparent"}
        ${selectable && !disabled ? "hover:border-primary/40 cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
    >
      <span
        className={`flex size-11 items-center justify-center rounded-md border text-lg font-semibold ${style.accent}`}
        aria-hidden="true"
      >
        {style.initial}
      </span>

      <span className="text-sm font-medium leading-tight">{displayName}</span>

      {supported ? (
        <StatusBadge tone="good">
          <CheckIcon className="size-3" />
          <Trans id="sources.status.ready" message="Ready" />
        </StatusBadge>
      ) : (
        <StatusBadge tone="bad">
          <TriangleAlertIcon className="size-3" />
          <Trans id="sources.status.unavailable" message="Unavailable" />
        </StatusBadge>
      )}

      <span className="text-[11px] leading-snug text-muted-foreground">
        {supported ? (
          <Trans
            id="sources.stats"
            message="{sessionCount} conversations across {projectCount} projects"
            values={{ sessionCount: sessions, projectCount: projects }}
          />
        ) : (
          unsupportedLabel
        )}
        {interactive ? null : (
          <>
            {" · "}
            <Trans id="sources.read_only" message="read-only" />
          </>
        )}
      </span>
    </button>
  );
};
