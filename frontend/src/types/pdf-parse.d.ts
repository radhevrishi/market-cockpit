// Minimal type shim for pdf-parse — the npm package ships JS only.
// We only use the default export to extract `.text` from a PDF buffer.
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages?: number;
    numrender?: number;
    info?: Record<string, unknown>;
    metadata?: unknown;
    version?: string;
  }
  function pdfParse(buffer: Buffer | Uint8Array, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
