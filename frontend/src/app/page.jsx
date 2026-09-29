"use client";

import React, { useState, useEffect, useCallback, startTransition } from "react";
import SessionSidebar from "../components/SessionSidebar";
import ChatInterface from "../components/ChatInterface";
import OutlineModal from "../components/OutlineModal";
import CitationModal from "../components/CitationModal";
import { summarizeQueryToTitle } from "../utils/titleSummarizer";
import { apiGet, apiDelete } from "../utils/apiClient";

const MAX_DOCS_PER_SESSION = 20;
const SESSIONS_KEY = "docupulse_sessions";
const ACTIVE_KEY = "docupulse_active_session";

function makeSession(name = "New Chat") {
  return {
    id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    messages: [],
    uploadedDocIds: [],
    createdAt: Date.now(),
  };
}

function loadSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
    return raw.map((s) => ({
      ...s,
      uploadedDocIds: Array.isArray(s.uploadedDocIds) ? s.uploadedDocIds : [],
    }));
  } catch {
    return [];
  }
}

function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [allDocuments, setAllDocuments] = useState([]);
  const [inspectDoc, setInspectDoc] = useState(null);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Bootstrap sessions from localStorage
  useEffect(() => {
    const stored = loadSessions();
    if (stored.length === 0) {
      const first = makeSession("New Chat");
      startTransition(() => {
        setSessions([first]);
        setActiveSessionId(first.id);
      });
      saveSessions([first]);
    } else {
      startTransition(() => setSessions(stored));
      const saved = localStorage.getItem(ACTIVE_KEY);
      const valid = stored.find((s) => s.id === saved);
      startTransition(() => setActiveSessionId(valid ? saved : stored[stored.length - 1].id));
    }
  }, []);

  // Persist active session id
  useEffect(() => {
    if (activeSessionId) localStorage.setItem(ACTIVE_KEY, activeSessionId);
  }, [activeSessionId]);

  // Fetch backend documents
  const fetchDocuments = useCallback(async () => {
    try {
      const documents = await apiGet("/api/documents");
      startTransition(() => setAllDocuments(documents));
    } catch (e) { console.error("Fetch docs:", e); }
  }, []);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  // Docs that belong strictly to this session. Each chat has its own files and limit.
  const sessionDocs =
    activeSession?.uploadedDocIds && activeSession.uploadedDocIds.length > 0
      ? allDocuments.filter((d) => activeSession.uploadedDocIds.includes(d.id))
      : [];

  // Mutate one session
  const patchSession = useCallback((id, patch) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, ...patch } : s));
      saveSessions(next);
      return next;
    });
  }, []);

  /* ── Session CRUD ── */
  const handleNewSession = () => {
    const s = makeSession("New Chat");
    setSessions((prev) => { const n = [...prev, s]; saveSessions(n); return n; });
    setActiveSessionId(s.id);
  };

  const handleSelectSession = (id) => {
    setActiveSessionId(id);
    setSidebarOpen(false);
  };

  const handleDeleteSession = (id) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = makeSession("New Chat");
        saveSessions([fresh]);
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      saveSessions(next);
      if (activeSessionId === id) setActiveSessionId(next[next.length - 1].id);
      return next;
    });
  };

  /* ── Document callbacks ── */
  const handleUploadSuccess = (newDoc, sessionId) => {
    fetchDocuments();
    if (newDoc?.id && sessionId) {
      setSessions((prev) => {
        const next = prev.map((s) => {
          if (s.id === sessionId) {
            const currentIds = s.uploadedDocIds || [];
            if (!currentIds.includes(newDoc.id)) {
              return { ...s, uploadedDocIds: [...currentIds, newDoc.id] };
            }
          }
          return s;
        });
        saveSessions(next);
        return next;
      });
    }
  };

  const handleDeleteDoc = async (docId) => {
    try {
      await apiDelete(`/api/documents/${docId}`);
      setAllDocuments((prev) => prev.filter((d) => d.id !== docId));
      setSessions((prev) => {
        const next = prev.map((s) => ({
          ...s,
          uploadedDocIds: (s.uploadedDocIds || []).filter((id) => id !== docId),
        }));
        saveSessions(next);
        return next;
      });
    } catch (e) {
      console.error("Delete doc:", e);
    }
  };

  /* ── Messages ── */
  const handleMessagesChange = (newMessages, suggestedTitle = null) => {
    if (!activeSessionId) return;
    const current = sessions.find((s) => s.id === activeSessionId);
    let sessionName = current?.name || "New Chat";
    if (suggestedTitle && typeof suggestedTitle === "string" && suggestedTitle.trim()) {
      sessionName = suggestedTitle.trim();
    } else if (sessionName === "New Chat" || sessionName === "New conversation") {
      const firstUserMsg = newMessages.find((m) => m.role === "user");
      if (firstUserMsg?.content) {
        sessionName = summarizeQueryToTitle(firstUserMsg.content);
      }
    }
    patchSession(activeSessionId, { messages: newMessages, name: sessionName });
  };

  const uploadedCount = activeSession?.uploadedDocIds?.length || 0;

  return (
      <div className="flex h-screen bg-paper overflow-hidden">
        {sidebarOpen && (
          <button
            type="button"
            className="fixed inset-0 z-30 bg-ink/25 md:hidden"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          onDeleteSession={handleDeleteSession}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <div className="flex-1 min-w-0 flex flex-col h-screen overflow-hidden">
          <ChatInterface
            key={activeSessionId}
            sessionId={activeSessionId}
            sessionName={activeSession?.name || "New Chat"}
            messages={activeSession?.messages || []}
            onMessagesChange={handleMessagesChange}
            sessionDocs={sessionDocs}
            onUploadSuccess={handleUploadSuccess}
            onDeleteDoc={handleDeleteDoc}
            onInspectDoc={(doc) => setInspectDoc(doc)}
            onSelectCitation={(c) => setSelectedCitation(c)}
            uploadedCount={uploadedCount}
            maxDocs={MAX_DOCS_PER_SESSION}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        </div>

        {inspectDoc && (
          <OutlineModal doc={inspectDoc} onClose={() => setInspectDoc(null)} />
        )}
        {selectedCitation && (
          <CitationModal citation={selectedCitation} onClose={() => setSelectedCitation(null)} />
        )}
      </div>
    );
}