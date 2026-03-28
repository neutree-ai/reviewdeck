import { createRoot } from "react-dom/client";
import { ReviewDeck } from "reviewdeck-ui";

function getSessionId(): string {
  const match = window.location.pathname.match(/^\/review\/([^/]+)/);
  return match?.[1] ?? "";
}

function getReviewToken(): string {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

createRoot(document.getElementById("root")!).render(
  <ReviewDeck
    sessionId={getSessionId()}
    reviewToken={getReviewToken()}
    serverUrl={window.location.origin}
  />,
);
