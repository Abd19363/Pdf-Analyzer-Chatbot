"use client";

import React, { useState, useRef } from "react";
import { uploadPdfFile } from "../utils/uploadPdf";

export default function HeaderUploader({
  onUploadSuccess,
  disabled = false,
  maxDocs = 20,
  uploadedCount = 0,
  onNotify,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  const handleUpload = async (file) => {
    if (!file) return;
    setIsUploading(true);
    try {
      await uploadPdfFile(file, {
        onUploadSuccess,
        onNotify,
        disabled,
        uploadedCount,
        maxDocs,
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (!disabled && !isUploading) setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (!disabled && !isUploading && e.dataTransfer.files?.[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) {
      handleUpload(e.target.files[0]);
    }
  };

  return (
    <div className="flex items-center">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,application/pdf"
        className="hidden"
        disabled={disabled || isUploading}
      />

      {isUploading ? (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold px-3.5 py-1.5 rounded-full shadow-sm">
          <div className="w-3.5 h-3.5 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin-slow" />
          <span>Uploading...</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => !disabled && fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          disabled={disabled}
          title={disabled ? `Session limit reached (${maxDocs}/${maxDocs})` : "Upload PDF (drag & drop or click · Max 10 MB)"}
          className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-semibold transition-all duration-150 shadow-sm ${
            disabled
              ? "bg-slate-200 text-slate-400 cursor-not-allowed"
              : isDragging
              ? "bg-blue-700 text-white outline-2 outline-dashed outline-blue-300 outline-offset-2"
              : "bg-blue-600 hover:bg-blue-700 text-white hover:-translate-y-0.5 hover:shadow-md hover:shadow-blue-200 active:scale-[0.97]"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <span>{disabled ? "Limit Reached" : "Upload PDF"}</span>
          <span className="bg-white/25 text-white text-[0.65rem] font-bold px-1.5 py-0.5 rounded-full">
            {uploadedCount}/{maxDocs}
          </span>
        </button>
      )}
    </div>
  );
}
