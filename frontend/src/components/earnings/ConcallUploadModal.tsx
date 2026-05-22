'use client';

import React, { useCallback, useRef, useState } from 'react';
import { parseFileToText } from '@/lib/concall-file-parser';

interface FileStatus {
  name: string;
  size: number;
  kind: string;
  status: 'queued' | 'parsing' | 'parsed' | 'error';
  chars?: number;
  error?: string;
  text?: string;
}

interface Props {
  accentColor: string;
  bg: string;
  panel: string;
  panelBorder: string;
  panelBorder2: string;
  textColor: string;
  mutedColor: string;
  mono: string;
  processing: boolean;
  existingText?: string;
  onClose: () => void;
  onSubmit: (combinedText: string) => void;
}

// PATCH 0683 — added xlsx + xls so the Concall AI uploader accepts Excel
// financial sheets (same files the InlineValuationPanel below uses for the
// P/E + P/S + EV/EBITDA report). Single drop zone, both pipelines fed.
const ALLOWED_EXTS = ['txt', 'md', 'csv', 'pdf', 'docx', 'pptx', 'xlsx', 'xls'] as const;

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function ConcallUploadModal({
  accentColor,
  bg,
  panel,
  panelBorder,
  panelBorder2,
  textColor,
  mutedColor,
  mono,
  processing,
  existingText = '',
  onClose,
  onSubmit,
}: Props) {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [pasteText, setPasteText] = useState(existingText);
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptString = ALLOWED_EXTS.map((e) => `.${e}`).join(',');

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    setGlobalError(null);
    const arr = Array.from(newFiles);
    const queued: FileStatus[] = arr.map((f) => {
      const e = extOf(f.name);
      const supported = (ALLOWED_EXTS as readonly string[]).includes(e);
      return {
        name: f.name,
        size: f.size,
        kind: e || 'unknown',
        status: supported ? 'queued' : 'error',
        error: supported ? undefined : `Unsupported type .${e || '?'} — use TXT / MD / CSV / PDF / DOCX / PPTX / XLSX / XLS`,
      };
    });
    setFiles((prev) => [...prev, ...queued]);
    // Parse only the supported ones
    const supportedFiles = arr.filter((_, i) => queued[i].status === 'queued');
    if (supportedFiles.length === 0) return;
    parseFilesOnClient(supportedFiles);
  }, []);

  // PATCH 0684 — was POSTing all files to /api/concall/parse, which hit
  // Vercel's 4.5 MB multipart body cap (HTTP 413) whenever the user dropped
  // 3+ concall PDFs or a typical financial workbook. Now parses entirely in
  // the browser using the same xlsx / pdf.js / mammoth / JSZip helpers the
  // Auto-Val panel already uses. No upload → no size limit.
  const parseFilesOnClient = async (supportedFiles: File[]) => {
    setParsing(true);
    setGlobalError(null);

    // PATCH 0685 — broadcast the same File[] to any sibling component
    // (specifically the InlineValuationPanel mounted at the bottom of the
    // earnings-analysis page) so a single drop feeds BOTH pipelines:
    //   - this modal's concall narrative analysis
    //   - the Auto-Val P/E + P/S + EV/EBITDA fair-value report
    // Detail carries the raw File[] (NOT the parsed text) because the
    // Auto-Val side needs the xlsx binary, not a CSV stringification.
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mc:concall-files-uploaded', {
            detail: { files: supportedFiles },
          }),
        );
      }
    } catch {
      // Best-effort; do not block concall parsing if event dispatch fails.
    }

    // Mark all queued files as parsing
    setFiles((prev) =>
      prev.map((s) =>
        supportedFiles.some((f) => f.name === s.name) && s.status === 'queued'
          ? { ...s, status: 'parsing' }
          : s,
      ),
    );

    const collectedTexts: string[] = [];
    for (const file of supportedFiles) {
      const result = await parseFileToText(file);
      setFiles((prev) =>
        prev.map((s) => {
          if (s.name !== file.name || s.status !== 'parsing') return s;
          if (result.error) return { ...s, status: 'error', error: result.error };
          return { ...s, status: 'parsed', chars: result.chars, kind: result.kind };
        }),
      );
      if (!result.error && result.text.length > 0) {
        collectedTexts.push(`=== ${file.name} ===\n\n${result.text}`);
      }
    }

    const combined = collectedTexts.join('\n\n').trim();
    // Stash full combined text on the FIRST parsed entry so submit() can pick
    // it up (mirrors the previous server-flow contract).
    if (combined.length > 0) {
      setFiles((prev) => {
        const first = prev.find((s) => s.status === 'parsed');
        if (!first) return prev;
        return prev.map((s) => (s === first ? { ...s, text: combined } : s));
      });
    }
    setParsing(false);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  };

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((s) => s.name !== name));

  const totalChars =
    files
      .filter((s) => s.status === 'parsed')
      .reduce((a, b) => a + (b.chars || 0), 0) + pasteText.trim().length;

  const canSubmit = !parsing && !processing && totalChars >= 100;

  const submit = () => {
    if (!canSubmit) return;
    const fileText =
      files.find((s) => s.status === 'parsed' && s.text)?.text || '';
    const combined = [fileText, pasteText.trim()].filter(Boolean).join('\n\n').trim();
    if (combined.length < 100) return;
    onSubmit(combined);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: panel,
          border: `1px solid ${panelBorder}`,
          borderRadius: 10,
          padding: 20,
          width: '100%',
          maxWidth: 720,
          maxHeight: '90vh',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: textColor, margin: 0, textTransform: 'uppercase', letterSpacing: 1 }}>
            Upload Concall / Investor Materials
          </h3>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: mutedColor, fontSize: 18, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
        <div style={{ fontSize: 11, color: mutedColor, marginBottom: 14, lineHeight: 1.5 }}>
          Drop transcripts, investor presentations, press releases, prepared remarks, or your
          Excel financial workbook. Multiple files are combined before extraction.
          Supported: TXT · MD · CSV · PDF · DOCX · PPTX · XLSX · XLS. You can also paste raw text
          below alongside the files.
        </div>

        {/* Drag-drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? accentColor : panelBorder2}`,
            borderRadius: 8,
            padding: 22,
            background: dragOver ? `${accentColor}15` : bg,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <div style={{ fontSize: 13, color: textColor, fontWeight: 600, marginBottom: 4 }}>
            {dragOver ? 'Drop to upload' : 'Click or drag files here'}
          </div>
          <div style={{ fontSize: 10, color: mutedColor }}>
            TXT · MD · CSV · PDF · DOCX · PPTX · XLSX · XLS · multi-select supported
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={acceptString}
            onChange={onFileInput}
            style={{ display: 'none' }}
          />
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {files.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: bg,
                  border: `1px solid ${panelBorder}`,
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontSize: 11,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                  <div style={{ color: textColor, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name}
                  </div>
                  <div style={{ color: mutedColor, fontFamily: mono, fontSize: 10 }}>
                    {f.kind.toUpperCase()} · {fmtSize(f.size)}
                    {f.status === 'parsed' && f.chars !== undefined ? ` · ${f.chars.toLocaleString()} chars extracted` : ''}
                    {f.status === 'parsing' ? ' · parsing…' : ''}
                    {f.status === 'queued' ? ' · queued' : ''}
                    {f.status === 'error' && f.error ? ` · ${f.error}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 3,
                      letterSpacing: 0.5,
                      textTransform: 'uppercase',
                      color:
                        f.status === 'parsed'
                          ? '#10b981'
                          : f.status === 'error'
                            ? '#fb923c'
                            : f.status === 'parsing'
                              ? accentColor
                              : mutedColor,
                      background:
                        f.status === 'parsed'
                          ? '#10b98120'
                          : f.status === 'error'
                            ? '#fb923c20'
                            : f.status === 'parsing'
                              ? `${accentColor}20`
                              : `${mutedColor}20`,
                    }}
                  >
                    {f.status}
                  </span>
                  <button
                    onClick={() => removeFile(f.name)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: mutedColor,
                      fontSize: 14,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Paste text */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, color: mutedColor, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
            Or paste text (combined with uploaded files)
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste prepared remarks, Q&A excerpt, or any transcript text…"
            style={{
              width: '100%',
              minHeight: 140,
              padding: 10,
              background: bg,
              color: textColor,
              border: `1px solid ${panelBorder}`,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: mono,
              resize: 'vertical',
              lineHeight: 1.5,
            }}
          />
        </div>

        {globalError && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#fb923c' }}>
            ⚠ {globalError}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
          <div style={{ fontSize: 10, color: mutedColor, fontFamily: mono }}>
            {totalChars.toLocaleString()} chars total
            {parsing ? ' · parsing files…' : ''}
            {processing ? ' · rebuilding snapshot…' : ''}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 14px',
                fontSize: 11,
                color: textColor,
                background: 'transparent',
                border: `1px solid ${panelBorder2}`,
                borderRadius: 5,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit}
              style={{
                padding: '8px 14px',
                fontSize: 11,
                fontWeight: 700,
                color: bg,
                background: accentColor,
                border: 'none',
                borderRadius: 5,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                opacity: canSubmit ? 1 : 0.45,
              }}
            >
              Extract & Rebuild
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
