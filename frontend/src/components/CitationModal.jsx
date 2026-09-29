import React from "react";
import { renderMarkdown } from "../utils/markdownRenderer";

export default function CitationModal({ citation, onClose }) {
  if (!citation) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-surface border border-rule overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-rule">
          <div className="min-w-0">
            <h3 className="font-serif text-xl text-ink">Source</h3>
            <p className="text-xs text-muted mt-1">
              Page {citation.page}
              {citation.type ? ` · ${citation.type}` : ""}
              {citation.heading ? ` · ${citation.heading}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-sm text-muted hover:text-ink hover:bg-paper text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <div className="bg-paper border border-rule p-4 text-sm text-ink">
            {renderMarkdown(citation.content_snippet)}
          </div>
        </div>
      </div>
    </div>
  );
}
