import { GlobalWorkerOptions, getDocument, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { statementPasswordHandler } from './statements';
import type { BankPage } from './bankStatements/common';
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
        throw new Error('帳單超過 20MB，請拆分後再匯入');
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
    const task = openStatementDocument('bank', bytes, password), cancel = () => { void task.destroy(); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        const pdf = await task.promise;
        if (pdf.numPages > 100)
            throw new Error('帳單超過 100 頁，請拆分後再匯入');
        const pages: BankPage[] = [];
        let chars = 0;
        for (let n = 1; n <= pdf.numPages; n++) {
            if (signal.aborted)
                throw new Error('已取消解析');
            const page = await pdf.getPage(n);
            try {
                const viewport = page.getViewport({ scale: 1 }), text = await page.getTextContent();
                if (signal.aborted)
                    throw new Error('已取消解析');
                const items = text.items.flatMap(i => {
                    if (!('str' in i)) return [];
                    chars += i.str.length;
                    const [x, y] = viewport.convertToViewportPoint(i.transform[4], i.transform[5]);
                    return [{ text: i.str, x, y: viewport.height - y, width: Math.abs(i.width), height: Math.abs(i.height) }];
                });
                if (chars > 500000)
                    throw new Error('帳單文字過多，請拆分後再匯入');
                pages.push({ page: n, width: viewport.width, height: viewport.height, items });
            }
            finally {
                page.cleanup();
            }
        }
        if (!chars)
            throw new Error('此 PDF 沒有可讀取的文字。第一版暫不支援掃描／圖片帳單。');
        return { pages, mode: 'bank' };
    }
    catch (e) {
        if (signal.aborted)
            throw new Error('已取消解析');
        if (e instanceof PasswordException)
            throw new Error('帳單需要密碼，或密碼不正確。請重新輸入。');
        throw new Error(e instanceof Error && /^(帳單超過|帳單文字過多|此 PDF 沒有)/.test(e.message) ? e.message : '無法讀取此 PDF，請確認檔案完整且為支援的文字帳單。');
    }
    finally {
        signal.removeEventListener('abort', cancel);
        await task.destroy();
    }
}
