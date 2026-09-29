import React from "react";

export default function OutlineModal({ doc, onClose }) {
  if (!doc) return null;

  const outline = doc.outline || [];

  const stats = [
    { value: doc.total_pages, label: "Pages" },
    { value: doc.total_headings, label: "Headings" },
    { value: doc.total_tables, label: "Tables" },
    { value: doc.total_diagrams, label: "Diagrams" },
  ];

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
            <h3 className="font-serif text-xl text-ink">Outline</h3>
            <p className="text-xs text-muted mt-1 truncate">{doc.filename}</p>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-rule border border-rule mb-5">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-paper px-3 py-3 text-center">
                <div className="font-serif text-2xl text-ink">{stat.value ?? 0}</div>
                <div className="text-xs text-muted mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>

          <h4 className="text-sm font-medium text-ink mb-2.5">Headings</h4>

          {outline.length === 0 ? (
            <p className="text-sm text-muted">
              No headings detected. Body text is split by paragraph.
            </p>
          ) : (
            <div className="flex flex-col gap-px bg-rule border border-rule">
              {outline.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between gap-3 px-3 py-2 bg-surface ${
                    item.level === 1
                      ? "font-medium text-sm text-ink"
                      : "text-[0.8rem] text-muted pl-7"
                  }`}
                >
                  <span className="min-w-0 truncate">{item.title}</span>
                  <span className="text-xs text-muted whitespace-nowrap">p. {item.page}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
