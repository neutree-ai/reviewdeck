import "./app.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewDeck, type SubPatch } from "./components/review/ReviewDeck";
import { fetchPatches, submitReview } from "./data";

function App() {
  const [patches, setPatches] = useState<SubPatch[]>([]);
  const token = new URLSearchParams(window.location.search).get("token") ?? undefined;

  useEffect(() => {
    fetchPatches({ token }).then(setPatches);
  }, [token]);

  if (patches.length === 0) {
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
      <ReviewDeck patches={patches} onSubmit={(submission) => submitReview(submission, { token })} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
