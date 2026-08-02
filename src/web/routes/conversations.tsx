import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ConversationsPage } from "@/web/app/conversations/page";
import { ProtectedRoute } from "../components/ProtectedRoute";

const conversationsSearchSchema = z.object({
  topic: z.string().optional(),
});

const RouteComponent = () => {
  const { topic } = Route.useSearch();

  return (
    <ProtectedRoute>
      <ConversationsPage topic={topic} />
    </ProtectedRoute>
  );
};

export const Route = createFileRoute("/conversations")({
  validateSearch: conversationsSearchSchema,
  component: RouteComponent,
});
