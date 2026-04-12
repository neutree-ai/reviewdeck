import "./app.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewDeck, type SubPatch } from "./components/review/ReviewDeck";
import { fetchPatches, submitReview } from "./data";

function App() {
  const [patches, setPatches] = useState<SubPatch[] | null>(null);
  const [error, setError] = useState<string>();
  const token = new URLSearchParams(window.location.search).get("token") ?? undefined;

  useEffect(() => {
    if (!token) {
      setError("No review token provided. Open a review URL with ?token=... to view patches.");
      return;
    }
    fetchPatches({ token })
      .then(setPatches)
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <span className="font-[family-name:var(--font-mono)] text-sm text-muted-foreground">
          {error}
        </span>
      </div>
    );
  }

  if (!patches) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3">
        <div className="animate-pulse-dot size-2 rounded-full bg-primary" />
        <span className="font-[family-name:var(--font-mono)] text-xs tracking-widest text-muted-foreground">
          LOADING
        </span>
      </div>
    );
  }

  return (
    <div className="h-screen">
      <ReviewDeck
        patches={patches}
        onSubmit={(submission) => submitReview(submission, { token })}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
