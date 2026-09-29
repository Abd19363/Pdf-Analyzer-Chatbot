import React from "react";

export default function DocumentList({
  documents,
  activeDocId,
  onSelectDoc,
  onInspectOutline,
  onDeleteDoc,
}) {
  return (
    <div className="flex flex-col gap-2.5 flex-1 min-h-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
          Indexed Documents ({documents.length})
        </span>
        {documents.length > 0 && (
          <button
            type="button"
            className={`text-[0.7rem] font-semibold rounded-lg px-2 py-1 border transition-all ${
              activeDocId === null
                ? "bg-blue-50 border-blue-200 text-blue-700"
                : "bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600"
            }`}
            onClick={() => onSelectDoc(null)}
          >
            {activeDocId === null ? "● Searching All" : "Search All"}
          </button>
        )}
      </div>

      {documents.length === 0 ? (
        <div className="text-center py-6 px-3 text-slate-400 text-sm">
          <p>No PDFs uploaded yet.</p>
          <p className="mt-1 text-xs">Upload a PDF above to extract headings, tables & diagrams.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto flex flex-col gap-2">
          {documents.map((doc) => {
            const isActive = activeDocId === doc.id;
            return (
              <div
                key={doc.id}
                className={`rounded-xl border p-3 cursor-pointer transition-all ${
                  isActive
                    ? "bg-blue-50 border-blue-200 shadow-sm"
                    : "bg-white border-slate-200 hover:border-blue-200 hover:bg-slate-50"
                }`}
                onClick={() => onSelectDoc(doc.id)}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-sm font-semibold text-slate-700 truncate" title={doc.filename}>
                    📄 {doc.filename}
                  </span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      title="Inspect Document Structure"
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspectOutline(doc);
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      title="Delete document"
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteDoc(doc.id);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {doc.total_pages} Pages
                  </span>
                  <span className="text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">
                    {doc.total_headings} Headings
                  </span>
                  <span className="text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                    {doc.total_tables} Tables
                  </span>
                  <span className="text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                    {doc.total_diagrams} Diagrams
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
