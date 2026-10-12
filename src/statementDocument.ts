import { GlobalWorkerOptions, getDocument, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { statementPasswordHandler } from './statements';
import { BANK_PDF_ERRORS, bankStatementErrorMessage, type BankImportStage } from './bankStatementErrors';
import type { BankPage } from './bankStatements/common';
import { readStatementText } from './statementText';
GlobalWorkerOptions.workerSrc = workerUrl;
// Both document modes use local assets; no remote character-map/font fetches.
const maps = import.meta.glob('/node_modules/pdfjs-dist/cmaps/*.bcmap', { eager: true, query: '?url&no-inline', import: 'default' }) as Record<string, string>;
const fonts = import.meta.glob('/node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}', { eager: true, query: '?url&no-inline', import: 'default' }) as Record<string, string>;
class LocalBinaryData {
    async fetch({ kind, filename }: {
        kind: string;
        filename: string;
    }) {
        const url = kind === 'cMapUrl' ? maps[`/node_modules/pdfjs-dist/cmaps/${filename}`]
            : kind === 'standardFontDataUrl' ? fonts[`/node_modules/pdfjs-dist/standard_fonts/${filename}`] : undefined;
        if (!url) throw new Error('Unsupported PDF character map');
        const response = await fetch(url);
        if (!response.ok) throw new Error('Unable to load character map');
        return new Uint8Array(await response.arrayBuffer());
    }
}
export type StatementDocumentMode = 'bank' | 'credit-card';
/** Shared loading/resource boundary. Consumers own page processing and always destroy in finally. */
export function openStatementDocument(mode: StatementDocumentMode, bytes: Uint8Array, password: string | readonly string[]) {
    if (mode !== 'bank' && mode !== 'credit-card')
        throw new Error('不支援的帳單文件模式');
    if (bytes.byteLength > 20 * 1024 * 1024)
        throw new Error(BANK_PDF_ERRORS.size);
    const task = getDocument({ data: new Uint8Array(bytes), password: '', BinaryDataFactory: LocalBinaryData, useWorkerFetch: false, useWasm: false, stopAtErrors: true, verbosity: 0 });
    task.onPassword = statementPasswordHandler(password);
    return task;
}
/** Raw pages are memory-only: do not persist/log them or PDF metadata. Bank mode has no OCR/card filter. */
export async function readBankDocument(bytes: Uint8Array, password: string | readonly string[], signal: AbortSignal): Promise<{
    pages: BankPage[];
    mode: 'bank';
}> {
    if (signal.aborted)
        throw new Error('已取消解析');
    let task: ReturnType<typeof openStatementDocument> | undefined;
    let stage: BankImportStage = 'open', failed = false, cleanupFailure: string | undefined;
    const pages: BankPage[] = [];
    const cancel = () => { void task?.destroy().catch(() => {}); };
    try {
        task = openStatementDocument('bank', bytes, password);
        signal.addEventListener('abort', cancel, { once: true });
        const pdf = await task.promise;
        if (pdf.numPages > 100)
            throw new Error(BANK_PDF_ERRORS.pages);
        let chars = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
            if (signal.aborted)
                throw new Error('已取消解析');
            stage = 'page';
            const page = await pdf.getPage(n);
            try {
                stage = 'text';
                const viewport = page.getViewport({ scale: 1 }), text = await readStatementText(page);
                if (signal.aborted)
                    throw new Error('已取消解析');
                const items = text.items.flatMap(i => {
                    if (!('str' in i)) return [];
                    chars += i.str.length;
                    const [x, y] = viewport.convertToViewportPoint(i.transform[4], i.transform[5]);
                    return [{ text: i.str, x, y: viewport.height - y, width: Math.abs(i.width), height: Math.abs(i.height) }];
                });
                if (chars > 500000)
                    throw new Error(BANK_PDF_ERRORS.textLimit);
                pages.push({ page: n, width: viewport.width, height: viewport.height, items });
            }
            finally {
                page.cleanup();
            }
        }
        if (!chars)
            throw new Error(BANK_PDF_ERRORS.noText);
    }
    catch (e) {
        failed = true;
        if (signal.aborted)
            throw new Error('已取消解析');
        if (e instanceof PasswordException) {
            const hasPassword = typeof password === 'string' ? password.split(',').some(p => p.trim()) : password.some(p => p.length > 0);
            throw new Error(hasPassword ? BANK_PDF_ERRORS.passwordIncorrect : BANK_PDF_ERRORS.passwordRequired);
        }
        throw new Error(bankStatementErrorMessage(e, stage));
    }
    finally {
        signal.removeEventListener('abort', cancel);
        // A teardown error must not replace the original failure or leak raw PDF errors.
        try { await task?.destroy(); }
        catch (e) {
            if (!failed && !signal.aborted)
                cleanupFailure = bankStatementErrorMessage(e, 'cleanup');
        }
    }
    if (signal.aborted) throw new Error('已取消解析');
    if (cleanupFailure) throw new Error(cleanupFailure);
    return { pages, mode: 'bank' };
}
