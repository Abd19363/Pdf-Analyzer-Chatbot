"use client";

import React, { useState, useRef, useEffect } from "react";
import { renderMarkdown } from "../utils/markdownRenderer";
import { uploadPdfFile } from "../utils/uploadPdf";
import { apiPost } from "../utils/apiClient";


const SUGGESTIONS = [
  { title: "Overview", prompt: "What is this document about? Summarize its purpose and key sections." },
  { title: "People", prompt: "List every student, author, or contributor named in this document." },
  { title: "Tables", prompt: "Extract all tables and present their data." },
  { title: "Figures", prompt: "Explain the diagrams, figures, and images in this document." },
];

const CONTEXT_OPTIONS = [
  {
    id: "legal",
    label: "Legal Help",
    rolePrompt: "As a Legal Consultant",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: "healthcare",
    label: "Healthcare",
    rolePrompt: "As a Certified Health Professional",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: "government",
    label: "Government Sector Help",
    rolePrompt: "As a Government Sector Consultant",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
];

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="w-1.5 h-1.5 rounded-full bg-muted inline-block animate-bounce-dot"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

function Avatar({ isUser }) {
  if (isUser) {
    return (
      <div className="w-8 h-8 rounded-sm bg-ink text-paper text-[0.65rem] font-semibold flex items-center justify-center flex-shrink-0">
        You
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-sm bg-accent text-white flex items-center justify-center flex-shrink-0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    </div>
  );
}

export default function ChatInterface({
  sessionName = "New Chat",
  messages = [],
  onMessagesChange,
  sessionDocs = [],
  onUploadSuccess,
  onDeleteDoc,
  onInspectDoc,
  onSelectCitation,
  uploadedCount = 0,
  maxDocs = 20,
  onOpenSidebar,
}) {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [selectedContext, setSelectedContext] = useState(CONTEXT_OPTIONS[0].id);
  const [activeDocId, setActiveDocId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [isAttachmentUploading, setIsAttachmentUploading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const attachmentInputRef = useRef(null);

  const handleAttachmentUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsAttachmentUploading(true);
    try {
      await uploadPdfFile(file, {
        onUploadSuccess,
        onNotify: (n) => setNotification(n),
        disabled: docLimitReached,
        uploadedCount,
        maxDocs,
      });
    } finally {
      setIsAttachmentUploading(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(t);
  }, [notification]);

  const activeDoc = sessionDocs.find((d) => d.id === activeDocId) || null;
  const docLimitReached = uploadedCount >= maxDocs;

  const handleSend = async (textToSend) => {
    const query = typeof textToSend === "string" ? textToSend : inputValue;
    if (!query?.trim() || isLoading) return;

    const userMsg = { role: "user", content: query.trim() };
    const updated = [...messages, userMsg];
    onMessagesChange(updated);
    setInputValue("");
    setIsLoading(true);

    try {
      // apiPost logs [REQ] and [RES] automatically to the browser console
      const data = await apiPost("/api/chat", {
        question: query.trim(),
        doc_id: activeDoc?.id || null,
        doc_ids: !activeDoc?.id && sessionDocs.length > 0 ? sessionDocs.map((d) => d.id) : null,
        history: messages.map((m) => ({ role: m.role, content: m.content })),
        context: selectedContext,
      });
      const currentCtx = CONTEXT_OPTIONS.find((c) => c.id === selectedContext);
      onMessagesChange([...updated, {
        role: "assistant",
        content: data.answer,
        citations: data.citations || [],
        rolePrompt: currentCtx?.rolePrompt || "As an Advisor",
      }]);
    } catch (err) {
      onMessagesChange([...updated, {
        role: "assistant",
        content: `The request failed: ${err.message}. Check that the backend is running and the Gemini API key is valid.`,
        citations: [],
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const copyToClipboard = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const docPillCls = (isActive) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium border cursor-pointer ${
      isActive
        ? "bg-accent text-white border-accent"
        : "bg-surface text-muted border-rule hover:border-accent hover:text-accent"
    }`;

  return (
    <main className="flex-1 flex flex-col h-screen bg-paper overflow-hidden">
      <header className="flex items-center gap-3 px-4 sm:px-7 py-3.5 bg-surface/90 backdrop-blur-sm border-b border-rule z-10 flex-shrink-0">
        <button
          type="button"
          className="md:hidden w-9 h-9 rounded-sm border border-rule text-ink hover:bg-paper"
          onClick={onOpenSidebar}
          aria-label="Open conversations"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mx-auto">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-serif text-xl text-ink truncate max-w-xs sm:max-w-md" title={sessionName}>
              {sessionName}
            </h1>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-good-soft text-good text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-good animate-pulse-dot inline-block" />
              {activeDoc ? activeDoc.filename : "All files"}
            </span>
          </div>
          <p className="text-xs text-muted">Evidence-led answers with page-level citations</p>
        </div>
      </header>

      <section
        className="flex-shrink-0 flex items-center gap-2 px-4 sm:px-7 py-2.5 bg-[#f7faf9] border-b border-rule overflow-x-auto"
        aria-label="Attached documents"
      >
        {sessionDocs.length === 0 ? (
          <p className="text-xs text-muted py-0.5">
            No PDFs attached yet. Click the attachment symbol (<strong className="text-accent font-medium">📎</strong>) in the query box below to attach up to {maxDocs} files.
          </p>
        ) : (
          <>
            <button
              type="button"
              className={docPillCls(activeDocId === null)}
              onClick={() => setActiveDocId(null)}
              title="Search all documents"
            >
              All ({sessionDocs.length})
            </button>

            {sessionDocs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  type="button"
                  className={docPillCls(activeDocId === doc.id)}
                  onClick={() => setActiveDocId(doc.id)}
                  title={`Focus: ${doc.filename}`}
                >
                  <span>{doc.filename.length > 22 ? doc.filename.slice(0, 22) + "…" : doc.filename}</span>
                  {doc.total_pages && (
                    <span className="opacity-70">{doc.total_pages}p</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onInspectDoc(doc); }}
                  title="Inspect outline"
                  className="text-muted hover:text-accent hover:bg-accent-soft rounded-sm w-6 h-6 flex items-center justify-center text-xs"
                >
                  i
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteDoc(doc.id); if (activeDocId === doc.id) setActiveDocId(null); }}
                  title="Remove document"
                  className="text-muted hover:text-bad hover:bg-bad-soft rounded-sm w-6 h-6 flex items-center justify-center text-xs"
                >
                  ×
                </button>
              </div>
            ))}
          </>
        )}
      </section>

      {notification && (
        <div className={`flex items-center justify-between gap-3 px-4 sm:px-6 py-2.5 text-sm font-medium border-b flex-shrink-0 ${
          notification.type === "success"
            ? "bg-good-soft border-rule text-good"
            : "bg-bad-soft border-rule text-bad"
        }`}>
          <span>{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-current opacity-60 hover:opacity-100 text-base leading-none"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto reading-pane px-4 sm:px-6 py-8">
        <div className="max-w-[46rem] mx-auto flex flex-col gap-6 min-h-full sm:pl-8">

        {messages.length === 0 ? (
          <div className="flex flex-col justify-center flex-1 gap-8 py-10">
            <div className="relative">
              <div className="absolute -left-8 top-1 w-1 h-14 rounded-full bg-accent" />
              <p className="text-[0.68rem] uppercase tracking-[0.18em] text-accent font-semibold mb-3">Document intelligence</p>
              <h2 className="font-serif text-4xl sm:text-[3.2rem] leading-[1.05] text-ink max-w-xl">
                Start with the big picture.
              </h2>
              <p className="text-sm text-muted leading-relaxed max-w-md mt-3">
                Ask about the whole document, then zoom into names, sections, tables, diagrams, and exact source pages.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
              {SUGGESTIONS.map((item) => (
                <button
                  key={item.title}
                  className="text-left px-4 py-4 bg-surface border border-rule rounded-xl hover:border-[#9fd2cc] hover:bg-accent-soft text-ink transition-colors shadow-[0_2px_8px_rgba(23,35,43,0.03)]"
                  onClick={() => handleSend(item.prompt)}
                >
                  <span className="block text-xs text-accent mb-1">{item.title}</span>
                  <span className="text-sm leading-snug">{item.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={idx}
                className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
              >
                {!isUser && <Avatar isUser={false} />}

                <div
                  className={`max-w-[85%] px-4 py-3 text-sm ${
                    isUser
                      ? "bg-ink text-paper rounded-2xl rounded-br-md shadow-[0_8px_20px_rgba(23,35,43,0.11)]"
                      : "bg-surface border border-rule text-ink rounded-2xl rounded-bl-md shadow-[0_3px_12px_rgba(23,35,43,0.04)]"
                  }`}
                >
                  {isUser ? (
                    <p className="leading-relaxed">{msg.content}</p>
                  ) : (
                    <>
                      {msg.rolePrompt && (
                        <span className="inline-flex items-center gap-1.5 mb-2 px-2 py-0.5 rounded-sm bg-accent-soft text-accent text-[0.7rem] font-medium border border-rule">
                          {msg.rolePrompt}
                        </span>
                      )}

                      {renderMarkdown(msg.content)}

                      {msg.citations?.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-rule">
                          <p className="text-xs text-muted mb-1.5">Sources</p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.citations.map((c, cIdx) => (
                              <button
                                key={cIdx}
                                onClick={() => onSelectCitation(c)}
                                className="px-2 py-1 bg-accent-soft border border-rule text-accent rounded-sm text-xs font-medium hover:border-accent"
                                title="View citation"
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end mt-2">
                        <button
                          onClick={() => copyToClipboard(msg.content, idx)}
                          className="text-xs text-muted hover:text-ink border border-transparent hover:border-rule rounded-sm px-2 py-0.5"
                        >
                          {copiedIndex === idx ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {isUser && <Avatar isUser={true} />}
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <Avatar isUser={false} />
            <div className="bg-surface border border-rule rounded-sm px-4 py-3">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="flex-shrink-0 bg-surface border-t border-rule px-4 sm:px-7 py-3.5">
        <div className="max-w-[46rem] mx-auto sm:pl-8">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[0.68rem] uppercase tracking-[0.14em] text-muted whitespace-nowrap font-semibold">
            Context:
          </span>
          <div className="inline-flex items-center rounded-lg border border-rule bg-paper p-0.5 gap-0.5">
            {CONTEXT_OPTIONS.map((ctx) => {
              const isSelected = selectedContext === ctx.id;
              return (
                <button
                  key={ctx.id}
                  type="button"
                  onClick={() => setSelectedContext(ctx.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    isSelected
                      ? "bg-accent text-white shadow-sm"
                      : "text-muted hover:text-ink hover:bg-surface"
                  }`}
                >
                  {ctx.icon}
                  <span>{ctx.label}</span>
                </button>
              );
            })}
          </div>

          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => onMessagesChange([])}
              className="ml-auto text-xs text-muted hover:text-bad border border-rule hover:border-bad hover:bg-bad-soft rounded-lg px-2.5 py-1.5"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 bg-paper border border-rule rounded-xl px-3 py-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/10 transition-shadow">
          <input
            type="file"
            ref={attachmentInputRef}
            onChange={handleAttachmentUpload}
            accept=".pdf,application/pdf"
            className="hidden"
            disabled={docLimitReached || isAttachmentUploading || isLoading}
          />
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            disabled={docLimitReached || isAttachmentUploading || isLoading}
            title={docLimitReached ? `Session limit reached (${maxDocs}/${maxDocs})` : "Attach PDF"}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-accent hover:bg-accent-soft disabled:opacity-35 disabled:cursor-not-allowed transition-all flex-shrink-0"
          >
            {isAttachmentUploading ? (
              <div className="w-4 h-4 border-2 border-rule border-t-accent rounded-full animate-spin-slow" />
            ) : (
              <PaperclipIcon />
            )}
          </button>

          <input
            ref={inputRef}
            id="chat-input"
            type="text"
            className="flex-1 bg-transparent outline-none text-sm text-ink placeholder:text-muted"
            placeholder={
              activeDoc
                ? `Ask about ${activeDoc.filename}`
                : "Ask about the attached documents"
            }
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
          />
          <button
            id="send-message-btn"
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || isLoading}
            title="Send"
            className="w-9 h-9 flex items-center justify-center rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-35 disabled:cursor-not-allowed flex-shrink-0 shadow-[0_4px_10px_rgba(8,127,120,0.2)]"
          >
            <SendIcon />
          </button>
        </div>
        <p className="text-center text-[0.7rem] text-muted mt-2">
          Enter to send. Verify important answers against the source pages.
        </p>
        </div>
      </div>
    </main>
  );
}
