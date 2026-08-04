import { Trans } from "@lingui/react";
import { SettingsIcon } from "lucide-react";
import { type FC, useState } from "react";
import { SettingsControls } from "@/web/components/SettingsControls";
import { SourcesSettings } from "@/web/components/SourcesSettings";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/web/components/ui/dialog";

/**
 * Settings, from anywhere.
 *
 * They used to live only in the session sidebar, which meant the topics,
 * conversations and projects screens — where most of the time is spent — had no
 * way to reach them. Picking an agent CLI in particular is answered once at
 * first run and then unreachable, so it needs a door on every screen that has a
 * header.
 */
export const SettingsButton: FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        className="flex items-center gap-1.5 h-7 px-2 rounded transition-colors hover:bg-muted text-muted-foreground hover:text-foreground"
        aria-label="Settings"
      >
        <SettingsIcon className="w-3.5 h-3.5" />
      </DialogTrigger>
      <DialogContent className="max-w-md sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Trans id="settings.dialog.title" message="Settings" />
          </DialogTitle>
          <DialogDescription>
            <Trans
              id="settings.dialog.description"
              message="Which agent CLIs Lantern reads, and how it behaves."
            />
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-sm font-medium leading-none">
            <Trans id="settings.dialog.sources" message="Agent CLIs to read" />
          </h3>
          <SourcesSettings />
        </section>

        <section className="space-y-3 border-t border-border/40 pt-4">
          {/* No project in scope on the screens this opens from; the controls
              that need one hide themselves rather than guess. */}
          <SettingsControls openingProjectId="" />
        </section>
      </DialogContent>
    </Dialog>
  );
};
