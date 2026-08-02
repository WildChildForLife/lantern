import { createFileRoute } from "@tanstack/react-router";
import { TopicsPage } from "@/web/app/topics/page";
import { ProtectedRoute } from "../components/ProtectedRoute";

const RouteComponent = () => {
  return (
    <ProtectedRoute>
      <TopicsPage />
    </ProtectedRoute>
  );
};

export const Route = createFileRoute("/topics")({
  component: RouteComponent,
});
