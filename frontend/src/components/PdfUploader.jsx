import React, { useState, useRef, useEffect } from "react";
import { apiPost } from "../utils/apiClient";


const MAX_SIZE_MB = 10;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const PROCESSING_STEPS = [
  "Validating PDF file structure & signature...",
  "Extracting hierarchical headings & text blocks...",
  "Detecting tables & serializing to Markdown...",
  "Scanning embedded diagrams & figures...",
  "Generating 768-dim embeddings & storing in PostgreSQL...",
];

/** Reads the first 4 bytes of a File and returns them as a Uint8Array */
function readPdfMagicBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(new Uint8Array(e.target.result));
    reader.onerror = () => reject(new Error("Cannot read file"));
    reader.readAsArrayBuffer(file.slice(0, 4));
  });
}


export default function PdfUploader({ onUploadSuccess, disabled = false, maxDocs = 20, uploadedCount = 0 }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isInvalidDrag, setIsInvalidDrag] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const fileInputRef = useRef(null);

  // Auto-dismiss success banner after 5 seconds
  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const validateAndUpload = async (file) => {
    setErrorMessage("");
    setSuccessMessage("");

    if (!file) return;

    if (disabled || uploadedCount >= maxDocs) {
      setErrorMessage(`❌ Session limit reached: Maximum ${maxDocs} PDF files per session. Start a new session to upload more.`);
      return;
    }

    // 1. Extension + MIME type check
    const isPdfExt = file.name.toLowerCase().endsWith(".pdf");
    const isPdfMime = file.type === "application/pdf" || file.type === "";
    if (!isPdfExt || !isPdfMime) {
      setErrorMessage(
        `❌ Invalid file type: "${file.name}". Only PDF documents (.pdf) are accepted.`
      );
      return;
    }

    // 2. File size check (client-side early rejection)
    if (file.size > MAX_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setErrorMessage(
        `❌ File too large: "${file.name}" is ${sizeMb} MB. Maximum allowed size is ${MAX_SIZE_MB} MB. ` +
        `Please compress or split the PDF before uploading.`
      );
      return;
    }

    if (file.size === 0) {
      setErrorMessage(`❌ The file "${file.name}" is empty (0 bytes). Please select a valid PDF.`);
      return;
    }

    // 3. PDF magic-bytes check — read first 4 bytes to catch disguised / corrupted files
    try {
      const header = await readPdfMagicBytes(file);
      const pdfMagic = [0x25, 0x50, 0x44, 0x46]; // %PDF
      const isValidHeader = pdfMagic.every((byte, i) => header[i] === byte);
      if (!isValidHeader) {
        setErrorMessage(
          `❌ "${file.name}" does not appear to be a valid PDF — its file header is incorrect. ` +
          `The file may be corrupted or is another format renamed as .pdf.`
        );
        return;
      }
    } catch {
      setErrorMessage(`❌ Could not read "${file.name}". The file may be corrupted or inaccessible.`);
      return;
    }

    setIsUploading(true);
    setCurrentStep(0);

    // Simulated progress transitions for high responsiveness
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev < PROCESSING_STEPS.length - 1) return prev + 1;
        return prev;
      });
    }, 1200);

    try {
      const formData = new FormData();
      formData.append("file", file);

      // apiPost logs [REQ] / [RES] to the browser console automatically
      const data = await apiPost("/api/upload", formData);

      clearInterval(stepInterval);
      setCurrentStep(PROCESSING_STEPS.length);
      setSuccessMessage(`✓ Successfully analyzed & indexed "${file.name}"!`);
      if (onUploadSuccess) {
        onUploadSuccess(data.document);
      }
    } catch (err) {
      clearInterval(stepInterval);
      setErrorMessage(`Error processing PDF: ${err.message}`);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const item = e.dataTransfer.items[0];
      if (item.kind === "file" && item.type !== "application/pdf" && !item.type.includes("pdf")) {
        setIsInvalidDrag(true);
      } else {
        setIsInvalidDrag(false);
      }
    }
  };

  const handleDragLeave = () => {
    setIsDragging(false);
    setIsInvalidDrag(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    setIsInvalidDrag(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      validateAndUpload(file);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndUpload(e.target.files[0]);
    }
  };

  const progressPercent = Math.round(((currentStep + 1) / PROCESSING_STEPS.length) * 100);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Upload Document</span>
        <span className="text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
          PDF Only
        </span>
      </div>

      <div
        className={`rounded-2xl border-2 border-dashed p-6 text-center cursor-pointer transition-all ${disabled
            ? "opacity-60 cursor-not-allowed border-slate-200 bg-slate-50"
            : isInvalidDrag
              ? "border-rose-300 bg-rose-50"
              : isDragging
                ? "border-blue-400 bg-blue-50"
                : "border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/50"
          }`}
        onDragOver={(e) => !disabled && handleDragOver(e)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => !disabled && handleDrop(e)}
        onClick={() => !isUploading && !disabled && fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".pdf,application/pdf"
          className="hidden"
        />

        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white flex items-center justify-center shadow-md shadow-blue-100">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>

        <p className={`text-sm font-semibold ${isInvalidDrag ? "text-rose-600" : "text-slate-700"}`}>
          {isInvalidDrag ? "Non-PDF file detected! Drop cancelled." : "Drag & drop your PDF here"}
        </p>
        <p className="text-xs text-slate-400 mt-1">or click to browse from device</p>
        <p className="text-[0.7rem] text-slate-400 mt-2 font-medium">PDF only · Max {MAX_SIZE_MB} MB</p>
      </div>

      {errorMessage && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage("")}
            className="text-rose-400 hover:text-rose-700 font-bold"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-700">
          <span>{successMessage}</span>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="text-emerald-400 hover:text-emerald-700 font-bold"
            aria-label="Dismiss success"
          >
            ✕
          </button>
        </div>
      )}

      {isUploading && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="flex items-center justify-between text-sm font-semibold text-blue-700 mb-2">
            <span>Analyzing Document...</span>
            <span>{progressPercent}%</span>
          </div>

          <div className="h-1.5 rounded-full bg-blue-100 overflow-hidden mb-3">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            {PROCESSING_STEPS.map((step, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 text-xs ${idx === currentStep
                    ? "text-blue-700 font-semibold"
                    : idx < currentStep
                      ? "text-emerald-600"
                      : "text-slate-400"
                  }`}
              >
                <span>{idx < currentStep ? "✓" : idx === currentStep ? "●" : "○"}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
