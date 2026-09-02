import { AlertCircle, Home, RefreshCw } from "lucide-react";
import { type FC, type PropsWithChildren, useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/web/components/ui/alert";
import { Button } from "@/web/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/web/components/ui/card";
import { HttpError } from "@/web/lib/api/client";

const errorToString = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * Sends an unauthenticated visitor to the login page.
 *
 * A component of its own so the navigation happens after this has been
 * committed rather than while the fallback is still being rendered. Assigning
 * to `location` during render leaves React mid-render of a tree it is then
 * asked to throw away.
 */
const RedirectToLogin: FC = () => {
  useEffect(() => {
    window.location.href = "/login";
  }, []);

  return null;
};

export const RootErrorBoundary: FC<PropsWithChildren> = ({ children }) => {
  return (
    <ErrorBoundary
      FallbackComponent={({ error, resetErrorBoundary }) => {
        if (error instanceof HttpError && error.status === 401) {
          return <RedirectToLogin />;
        }

        return (
          <div className="flex min-h-screen items-center justify-center p-4">
            <Card className="w-full max-w-2xl">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <AlertCircle className="size-6 text-destructive" />
                  <div>
                    <CardTitle>Something went wrong</CardTitle>
                    <CardDescription>
                      An unexpected error occurred in the application
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>Error Details</AlertTitle>
                  <AlertDescription>
                    <code className="text-xs">{errorToString(error)}</code>
                  </AlertDescription>
                </Alert>

                <div className="flex gap-2">
                  <Button onClick={resetErrorBoundary} variant="default">
                    <RefreshCw />
                    Try Again
                  </Button>
                  <Button
                    onClick={() => {
                      window.location.href = "/";
                    }}
                    variant="outline"
                  >
                    <Home />
                    Go to Home
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }}
    >
      {children}
    </ErrorBoundary>
  );
};
