/**
 * Resume text extraction (Milestone 3, spec Section 4.1).
 *
 * PDF via pdf-parse v2 (`new PDFParse({data})` → `getText()` gives text +
 * page count); DOCX via mammoth (`extractRawText`). See ADR 004 for why
 * these two were chosen over pdfjs-dist.
 *
 * Limits (spec: "max about 2 MB and 3 pages"):
 *  - size is enforced by multer before this runs (2 MB);
 *  - PDF: more than 3 pages → friendly rejection;
 *  - DOCX has no reliable page count, so a ~1800-word ceiling is used as
 *    the 3-page proxy (~600 words/page);
 *  - scanned/image-only PDFs (almost no extractable text) are rejected
 *    with a friendly message — OCR exists only in offline tooling.
 */
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export const MAX_PAGES_PDF = 3;
export const MAX_WORDS_DOCX = 1800;
/** Below this many non-space characters we assume image-only content. */
export const MIN_TEXT_CHARS = 200;

export class IntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
    /** HTTP status the route layer should use. */
    this.status = 400;
  }
}

function kindOf(mimetype, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (mimetype === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    ext === 'docx' ||
    mimetype ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx';
  return null;
}

async function extractPdf(buffer) {
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
  } catch {
    throw new IntakeError('unparseable', 'We could not read that PDF. Please try exporting it again as a PDF.');
  }
  try {
    const { text, total } = await parser.getText();
    // pdf-parse separates pages with "-- N of M --" markers; drop them.
    const clean = text.replace(/^-- \d+ of \d+ --$/gm, '').trim();
    if (total > MAX_PAGES_PDF) {
      throw new IntakeError(
        'too_many_pages',
        `Your PDF has ${total} pages. Please upload a resume of ${MAX_PAGES_PDF} pages or fewer.`,
      );
    }
    if (clean.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
      throw new IntakeError(
        'scanned_pdf',
        'This looks like a scanned or image-only PDF, and we cannot read its text. ' +
          'Please upload a text-based PDF (e.g. export or "print to PDF" from your editor).',
      );
    }
    return { text: clean, pages: total, kind: 'pdf' };
  } catch (err) {
    if (err instanceof IntakeError) throw err;
    throw new IntakeError('unparseable', 'We could not read that PDF. Please try exporting it again as a PDF.');
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* best effort */
    }
  }
}

async function extractDocx(buffer) {
  let value;
  try {
    ({ value } = await mammoth.extractRawText({ buffer }));
  } catch {
    throw new IntakeError('unparseable', 'We could not read that Word file. Please re-save it as .docx and try again.');
  }
  const clean = (value || '').trim();
  if (clean.replace(/\s/g, '').length < MIN_TEXT_CHARS) {
    throw new IntakeError('empty', 'We could not find any readable text in that file.');
  }
  const words = clean.split(/\s+/).length;
  if (words > MAX_WORDS_DOCX) {
    throw new IntakeError(
      'too_long',
      `That document is about ${words} words — roughly a ${Math.round(words / 600)}-page resume. ` +
        `Please upload a version of ${MAX_PAGES_PDF} pages or fewer.`,
    );
  }
  return { text: clean, pages: null, kind: 'docx' };
}

/**
 * @returns {Promise<{ text: string, pages: number|null, kind: 'pdf'|'docx' }>}
 * @throws {IntakeError} with a user-friendly message on any rejection.
 */
export async function extractText(buffer, { mimetype, filename }) {
  const kind = kindOf(mimetype, filename);
  if (!kind) {
    throw new IntakeError(
      'unsupported_type',
      'Please upload a PDF or DOCX file.',
    );
  }
  if (!buffer || buffer.length === 0) {
    throw new IntakeError('empty', 'The uploaded file is empty.');
  }
  return kind === 'pdf' ? extractPdf(buffer) : extractDocx(buffer);
}
