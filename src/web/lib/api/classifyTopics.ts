import { honoClient } from "@/web/lib/api/client";

/**
 * What a classification pass is being asked to cover.
 *
 * A literal union rather than a string: it is what makes the query parameter
 * typecheck against the route without a cast, and what stops a fourth scope
 * being invented at a call site.
 */
export type ClassifyRequest =
  | { readonly kind: "unclassified" }
  | { readonly kind: "all" }
  | { readonly kind: "selection"; readonly sessionIds: readonly string[] };

/**
 * Carries the status rather than a message, so the toast can be written in the
 * user's language instead of echoing an English HTTP reason phrase at them.
 */
export class ClassificationRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Classification request failed with status ${status}`);
    this.name = "ClassificationRequestError";
    this.status = status;
  }
}

export const requestClassification = async (request: ClassifyRequest) => {
  const response =
    request.kind === "selection"
      ? await honoClient.api.conversations.topics.classify.selection.$post({
          // Spread rather than pass: the route's schema infers a mutable array.
          json: { sessionIds: [...request.sessionIds] },
        })
      : await honoClient.api.conversations.topics.classify.$post({
          query: { scope: request.kind },
        });

  if (!response.ok) {
    throw new ClassificationRequestError(response.status);
  }

  return await response.json();
};
