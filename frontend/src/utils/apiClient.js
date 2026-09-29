/**
 * apiClient.js — Centralized API wrapper with frontend traceback logging.
 *
 * Every request and response (including errors) is logged to the browser
 * console with a short correlation ID so you can match them visually.
 *
 * Usage — replace direct fetch() calls with:
 *   import { apiPost, apiGet } from "@/utils/apiClient";
 *   const data = await apiPost("/api/chat", { question, context });
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Tiny ID generator for correlating REQ / RES pairs in the console ─────────
let _seq = 0;
function reqId() {
  return `FE-${(++_seq).toString().padStart(4, "0")}`;
}

// ── Console group helpers ─────────────────────────────────────────────────────
const styles = {
  req:    "color:#4fc3f7;font-weight:bold",
  res:    "color:#81c784;font-weight:bold",
  err:    "color:#ef5350;font-weight:bold",
  label:  "color:#b0bec5",
  value:  "color:#fff0",        // transparent — let the browser render the obj
};

function logRequest(id, method, url, body) {
  console.groupCollapsed(`%c[REQ ${id}]%c ${method} ${url}`, styles.req, styles.label);
  console.log("%cTimestamp :", styles.label, new Date().toISOString());
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      console.log("%cBody      :", styles.label, "<FormData — binary/multipart>");
    } else {
      console.log("%cBody      :", styles.label, body);
    }
  }
  console.groupEnd();
}

function logResponse(id, method, url, status, data, latencyMs) {
  const isOk = status >= 200 && status < 300;
  const style = isOk ? styles.res : styles.err;
  const tag   = isOk ? "RES" : "ERR";
  console.groupCollapsed(
    `%c[${tag} ${id}]%c ${method} ${url} — ${status} (${latencyMs.toFixed(0)} ms)`,
    style, styles.label
  );
  console.log("%cTimestamp :", styles.label, new Date().toISOString());
  console.log("%cStatus    :", styles.label, status);
  console.log("%cLatency   :", styles.label, `${latencyMs.toFixed(1)} ms`);
  console.log("%cBody      :", styles.label, data);
  console.groupEnd();
}

function logNetworkError(id, method, url, error, latencyMs) {
  console.groupCollapsed(
    `%c[NET ${id}]%c ${method} ${url} — NETWORK ERROR (${latencyMs.toFixed(0)} ms)`,
    styles.err, styles.label
  );
  console.log("%cTimestamp :", styles.label, new Date().toISOString());
  console.error("%cError     :", styles.label, error);
  console.groupEnd();
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────
/**
 * @param {string} path         - API path, e.g. "/api/chat"
 * @param {object} [options]    - fetch options (method, body, headers…)
 * @returns {Promise<any>}      - Parsed JSON response body
 * @throws  {Error}             - Network errors or non-2xx responses
 */
export async function apiFetch(path, options = {}) {
  const id       = reqId();
  const method   = (options.method || "GET").toUpperCase();
  const url      = `${API_BASE}${path}`;
  const t0       = performance.now();

  logRequest(id, method, url, options.body ?? null);

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        // Do NOT set Content-Type for FormData — let the browser add the boundary
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
    });
  } catch (networkErr) {
    logNetworkError(id, method, url, networkErr, performance.now() - t0);
    throw networkErr;
  }

  const latency = performance.now() - t0;

  // Try to parse JSON; fall back to text
  let data;
  try {
    data = await response.json();
  } catch {
    data = await response.text().catch(() => null);
  }

  logResponse(id, method, url, response.status, data, latency);

  if (!response.ok) {
    const message = data?.detail || data?.message || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.data   = data;
    throw err;
  }

  return data;
}

// ── Convenience helpers ───────────────────────────────────────────────────────
export const apiGet  = (path, opts = {}) => apiFetch(path, { ...opts, method: "GET" });
export const apiPost = (path, body, opts = {}) =>
  apiFetch(path, {
    ...opts,
    method: "POST",
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
export const apiDelete = (path, opts = {}) => apiFetch(path, { ...opts, method: "DELETE" });
