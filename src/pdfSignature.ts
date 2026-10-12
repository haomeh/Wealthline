// PDF readers (PDF.js, Acrobat) accept a `%PDF-` header anywhere in the first 1024 bytes.
// Some bank downloads prefix a BOM, blank lines or MIME text. Keep the same window here.
const HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]
export const PDF_HEADER_WINDOW = 1024

export function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, PDF_HEADER_WINDOW) - HEADER.length
  for (let i = 0; i <= end; i++) if (HEADER.every((b, n) => bytes[i + n] === b)) return true
  return false
}

export type NonPdfKind = 'empty' | 'zip' | 'html' | 'image' | 'office' | 'email' | 'text' | 'unknown'

const starts = (bytes: Uint8Array, sig: readonly number[], at = 0) => sig.every((b, n) => bytes[at + n] === b)

/** Coarse type only. Never returns or logs file content. */
export function nonPdfKind(bytes: Uint8Array): NonPdfKind {
  if (!bytes.length) return 'empty'
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) || starts(bytes, [0x50, 0x4b, 0x05, 0x06]) || starts(bytes, [0x52, 0x61, 0x72, 0x21]) || starts(bytes, [0x37, 0x7a, 0xbc, 0xaf])) return 'zip'
  if (starts(bytes, [0xff, 0xd8, 0xff]) || starts(bytes, [0x89, 0x50, 0x4e, 0x47]) || starts(bytes, [0x47, 0x49, 0x46, 0x38]) || (starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) || (starts(bytes, [0x66, 0x74, 0x79, 0x70], 4) && /^(?:heic|heix|hevc|mif1|avif)$/.test(String.fromCharCode(...bytes.slice(8, 12))))) return 'image'
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return 'office'
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, PDF_HEADER_WINDOW)).replace(/^﻿/, '').trimStart().slice(0, 400).toLowerCase()
  if (/^<(?:!doctype\s+html|html|head|body|meta|script|\?xml)/.test(head)) return 'html'
  if (/^(?:received|return-path|from|mime-version|message-id|date|to|subject|delivered-to|x-[a-z-]+):/m.test(head) && /mime-version:|content-type:/.test(head)) return 'email'
  if (/content-type:\s*multipart/.test(head)) return 'email'
  // Mostly printable bytes without a PDF header.
  const sample = bytes.slice(0, 512)
  let printable = 0
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b < 0x7f) || b >= 0x80) printable++
  return printable / sample.length > 0.95 ? 'text' : 'unknown'
}
