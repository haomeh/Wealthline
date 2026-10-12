import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

type TextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>

/** Read PDF text without requiring ReadableStream async iteration on Safari. */
export async function readStatementText(page: PDFPageProxy): Promise<TextContent> {
  // PDF.js uses a separate text source for pure XFA documents.
  if (page.isPureXfa) return page.getTextContent()
  const reader = page.streamTextContent().getReader()
  const text: TextContent = { items: [], styles: Object.create(null), lang: null }
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return text
      text.lang ??= value.lang
      Object.assign(text.styles, value.styles)
      for (const item of value.items) text.items.push(item)
    }
  } finally {
    reader.releaseLock()
  }
}
