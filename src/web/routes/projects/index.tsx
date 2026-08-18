import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useViewMode } from "@/lib/atoms/viewMode";

/**
 * Projects are a view mode of the overview now, not a page of their own. Old
 * links keep working and land on the project grouping they asked for.
 */
const RouteComponent = () => {
  const navigate = useNavigate();
  const { setViewMode } = useViewMode();

  useEffect(() => {
    setViewMode("projects");
    void navigate({ to: "/topics", replace: true });
  }, [navigate, setViewMode]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
};

export const Route = createFileRoute("/projects/")({
  component: RouteComponent,
});
