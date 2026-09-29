"use client";
import React from "react";

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  open = false,
  onClose,
}) {
  return (
    <aside
      className={`fixed md:static inset-y-0 left-0 z-40 w-[17.5rem] h-screen bg-surface border-r border-rule flex flex-col select-none transition-transform duration-200 ${
        open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-5 border-b border-rule bg-[#f7faf9]">
        <div className="w-10 h-10 rounded-xl bg-ink text-white flex items-center justify-center flex-shrink-0 shadow-[0_6px_18px_rgba(23,35,43,0.14)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-serif text-xl leading-none text-ink">DocuPulse</p>
          <p className="text-[0.68rem] uppercase tracking-[0.16em] text-accent mt-1 font-semibold">Research room</p>
        </div>
        <button
          type="button"
          className="md:hidden w-8 h-8 rounded-sm text-muted hover:bg-paper hover:text-ink"
          onClick={onClose}
          aria-label="Close sidebar"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="px-3 pt-4 pb-2">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-ink text-white text-sm font-medium shadow-[0_5px_14px_rgba(23,35,43,0.12)] hover:bg-accent focus-visible:outline-accent"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Chat
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pt-5 pb-2">
        <p className="text-[0.68rem] uppercase tracking-[0.16em] font-semibold text-muted">Recent</p>
        <span className="text-[0.68rem] text-muted">{sessions.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-0.5">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted px-3 py-6 leading-relaxed">
            No chats yet. Start a new chat to begin asking questions.
          </p>
        ) : (
          [...sessions].reverse().map((session) => (
            <div
              key={session.id}
              onClick={() => onSelectSession(session.id)}
              title={session.name}
              className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer border transition-colors ${
                session.id === activeSessionId
                  ? "bg-accent-soft border-[#a9d9d3] text-ink"
                  : "border-transparent text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              <svg
                width="13" height="13" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                className="flex-shrink-0"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="flex-1 truncate text-sm">{session.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                title="Delete conversation"
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-bad hover:bg-bad-soft rounded-md w-6 h-6 text-base leading-none"
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2.5 px-4 py-4 border-t border-rule bg-[#f7faf9]">
        <div className="w-8 h-8 rounded-lg bg-accent text-white text-[0.65rem] font-semibold flex items-center justify-center flex-shrink-0">
          DP
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-ink truncate">Workspace</span>
          <span className="text-xs text-muted">
            {sessions.length} {sessions.length === 1 ? "conversation" : "conversations"}
          </span>
        </div>
      </div>
    </aside>
  );
}
