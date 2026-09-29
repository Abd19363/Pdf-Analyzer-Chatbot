import { apiPost } from "./apiClient";

const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

export function readPdfMagicBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error("Cannot read file"));
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
}

export async function uploadPdfFile(file, { sessionId, onUploadSuccess, onNotify, disabled = false, uploadedCount = 0, maxDocs = 20 } = {}) {
  if (!file) return false;
  if (disabled || uploadedCount >= maxDocs) {
    onNotify?.({ type: "error", message: `Limit reached: Maximum ${maxDocs} PDF files per session.` });
    return false;
  }
  const isPdfExt = file.name.toLowerCase().endsWith(".pdf");
  const isPdfMime = file.type === "application/pdf" || file.type === "";
  if (!isPdfExt || !isPdfMime) {
    onNotify?.({ type: "error", message: "Only PDF files are accepted." });
    return false;
  }
  if (file.size > MAX_SIZE_BYTES) {
    onNotify?.({ type: "error", message: `File too large. Max ${MAX_SIZE_MB} MB allowed.` });
    return false;
  }
  if (file.size === 0) {
    onNotify?.({ type: "error", message: "File is empty (0 bytes)." });
    return false;
  }
  try {
    const header = await readPdfMagicBytes(file);
    const pdfMagic = [0x25, 0x50, 0x44, 0x46]; // %PDF
    if (!pdfMagic.every((b, i) => header[i] === b)) {
      onNotify?.({ type: "error", message: `"${file.name}" is corrupted or not a valid PDF.` });
      return false;
    }
  } catch {
    onNotify?.({ type: "error", message: `Could not read "${file.name}".` });
    return false;
  }

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("session_id", sessionId);
    // apiPost handles logging (REQ / RES) automatically via apiClient
    const data = await apiPost("/api/upload", formData);
    onNotify?.({ type: "success", message: "File uploaded successfully" });
    if (onUploadSuccess) onUploadSuccess(data.document, sessionId);
    return true;
  } catch (err) {
    onNotify?.({ type: "error", message: `Upload error: ${err.message}` });
    return false;
  }
}
