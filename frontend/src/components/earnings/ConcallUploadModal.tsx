'use client';

import React, { useCallback, useRef, useState } from 'react';

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
    parseFilesOnServer(supportedFiles, queued);
  }, []);

  const parseFilesOnServer = async (supportedFiles: File[], statusEntries: FileStatus[]) => {
    setParsing(true);
    try {
      const fd = new FormData();
      for (const f of supportedFiles) fd.append('files', f);
      // mark in-progress
      setFiles((prev) =>
        prev.map((s) =>
          statusEntries.some((q) => q.name === s.name && q.status === 'queued' && q === s)
            ? { ...s, status: 'parsing' }
            : s,
        ),
      );
      // PATCH 0469 — 60s timeout (PDF parsing can be slow but a hung upload
      // should not leave files in 'parsing' status forever).
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 60_000);
      let res: Response;
      try {
        res = await fetch('/api/concall/parse', { method: 'POST', body: fd, signal: ctl.signal });
      } catch (e: any) {
        clearTimeout(timer);
        const msg = e?.name === 'AbortError' ? 'Parse timed out after 60s' : (e?.message || 'Network error');
        setGlobalError(msg);
        setFiles((prev) => prev.map((s) => s.status === 'parsing' ? { ...s, status: 'error', error: msg } : s));
        return;
      }
      clearTimeout(timer);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const msg = json?.error || `Parse server returned ${res.status}`;
        setGlobalError(msg);
        setFiles((prev) =>
          prev.map((s) =>
            s.status === 'parsing' ? { ...s, status: 'error', error: msg } : s,
          ),
        );
        return;
      }
      // Update each file status from perFile array
      const perFile: Array<{ name: string; chars: number; error?: string; kind: string }> =
        json.perFile || [];
      setFiles((prev) =>
        prev.map((s) => {
          const hit = perFile.find((p) => p.name === s.name);
          if (!hit) return s;
          if (hit.error) return { ...s, status: 'error', error: hit.error };
          return { ...s, status: 'parsed', chars: hit.chars, kind: hit.kind };
        }),
      );
      // Stash full text on the FIRST status entry as a "shared" carrier
      // (all files' text is concatenated server-side already)
      setFiles((prev) => {
        const first = prev.find((s) => s.status === 'parsed');
        if (!first) return prev;
        return prev.map((s) => (s === first ? { ...s, text: json.text } : s));
      });
    } catch (err: any) {
      setGlobalError(err?.message || 'Upload failed');
      setFiles((prev) =>
        prev.map((s) =>
          s.status === 'parsing' ? { ...s, status: 'error', error: err?.message || 'failed' } : s,
        ),
      );
    } finally {
      setParsing(false);
    }
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
