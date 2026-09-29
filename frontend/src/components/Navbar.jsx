import React from "react";

export default function Navbar({ activeDocName }) {
  return (
    <header className="flex items-center gap-3 px-5 py-3 bg-surface border-b border-rule">
      <div className="w-9 h-9 rounded-sm bg-accent text-white flex items-center justify-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div className="min-w-0">
        <h1 className="font-serif text-lg text-ink">DocuPulse</h1>
        <p className="text-xs text-muted truncate">
          {activeDocName ? activeDocName : "All documents"}
        </p>
      </div>
    </header>
  );
}
