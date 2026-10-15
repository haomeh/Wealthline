import { GlobalWorkerOptions, getDocument, PasswordException, PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';
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
export type BankPageProgress = { completed: number; total: number };
type LoadingTask = ReturnType<typeof getDocument>;
type SharedWorker = { worker: PDFWorker; tasks: Map<LoadingTask, AbortSignal>; idle?: ReturnType<typeof setTimeout>; closed: boolean };
// Starting a PDF.js worker costs far more than reading a statement's text, so every statement
// document opened with an AbortSignal shares one worker: the files of one import, and the type
// detection, card and bank steps of it. Aborting a signal destroys only its own documents; the
// worker closes when nothing else uses it, at once after an abort and otherwise after a short wait.
// A worker that does not finish destroying an aborted document in time is retired: new documents
// get a new worker, and it is terminated once only aborted documents remain on it.
const WORKER_IDLE_MS = 3000, WARM_IDLE_MS = 15000, ABORT_DESTROY_WAIT_MS = 1000;
let shared: SharedWorker | undefined;
// Every worker not yet closed: the shared one, and a retired one that open documents still use.
const open = new Set<SharedWorker>();
const listening = new WeakSet<AbortSignal>();
function closeWorker(worker: SharedWorker) {
    if (worker.closed) return;
    worker.closed = true;
    clearTimeout(worker.idle);
    open.delete(worker);
    if (shared === worker) shared = undefined;
    worker.worker.destroy();
}
function idleWorker(worker: SharedWorker, wait = WORKER_IDLE_MS) {
    if (worker.tasks.size || worker.closed) return;
    clearTimeout(worker.idle);
    worker.idle = setTimeout(() => { if (!worker.tasks.size) closeWorker(worker); }, wait);
}
function abortDocuments(signal: AbortSignal) {
    for (const worker of [...open]) {
        const own = [...worker.tasks].filter(([, owner]) => owner === signal).map(([task]) => task);
        if (!own.length) { idleWorker(worker, 0); continue; }
        let ended = false;
        void Promise.allSettled(own.map(task => task.destroy())).then(() => { ended = true; });
        setTimeout(() => {
            if (ended) return;
            // The worker did not answer: drop these documents and stop handing the worker to new ones.
            for (const task of own) worker.tasks.delete(task);
            if (shared === worker) shared = undefined;
            // Terminating it would also stop imports still reading, which then never settle; it closes when they end.
            if ([...worker.tasks.values()].every(owner => owner.aborted)) closeWorker(worker);
        }, ABORT_DESTROY_WAIT_MS);
    }
}
function currentWorker(): SharedWorker {
    if (shared && !shared.closed) { clearTimeout(shared.idle); return shared; }
    const worker: SharedWorker = { worker: new PDFWorker({ verbosity: 0 }), tasks: new Map(), closed: false };
    shared = worker;
    open.add(worker);
    // A worker that fails to start is not used for later documents.
    worker.worker.promise.catch(() => { if (shared === worker) shared = undefined; idleWorker(worker, 0); });
    return worker;
}
function sharedWorker(signal: AbortSignal): SharedWorker {
    if (!listening.has(signal)) { listening.add(signal); signal.addEventListener('abort', () => abortDocuments(signal), { once: true }); }
    return currentWorker();
}
/** Starts the shared worker while the user is still choosing files; it closes if no document follows. */
export function warmStatementWorker() {
    idleWorker(currentWorker(), WARM_IDLE_MS);
}
/** Shared loading/resource boundary. Consumers own page processing and always destroy in finally. */
export function openStatementDocument(mode: StatementDocumentMode, bytes: Uint8Array, password: string | readonly string[], signal?: AbortSignal) {
    if (mode !== 'bank' && mode !== 'credit-card')
        throw new Error('不支援的帳單文件模式');
    if (bytes.byteLength > 20 * 1024 * 1024)
        throw new Error(BANK_PDF_ERRORS.size);
    const worker = signal && !signal.aborted ? sharedWorker(signal) : undefined;
    let task: LoadingTask;
    try { task = getDocument({ data: new Uint8Array(bytes), password: '', BinaryDataFactory: LocalBinaryData, useWorkerFetch: false, useWasm: false, stopAtErrors: true, verbosity: 0, ...(worker && { worker: worker.worker }) }); }
    catch (e) { if (worker) idleWorker(worker); throw e; }
    task.onPassword = statementPasswordHandler(password);
    if (worker && signal) {
        worker.tasks.set(task, signal);
        const destroy = task.destroy.bind(task);
        let ending: Promise<void> | undefined;
        // Destroying the document keeps the shared worker for the next document.
        task.destroy = () => ending ??= destroy().finally(() => { worker.tasks.delete(task); idleWorker(worker, signal.aborted ? 0 : WORKER_IDLE_MS); });
    }
    return task;
}
/** Raw pages are memory-only: do not persist/log them or PDF metadata. Bank mode has no OCR/card filter. */
export type StatementPdf = Awaited<ReturnType<typeof openStatementDocument>['promise']>;
export type StatementPageText = Awaited<ReturnType<typeof readStatementText>>;
/**
 * `withDocument` runs on the still open document after every page is read, with each page's text, so a
 * caller can go on (classify, read card lines) without opening and reading the file again. It handles its
 * own errors: anything it throws is reported as a bank reading error.
 */
export async function readBankDocument<T = never>(bytes: Uint8Array, password: string | readonly string[], signal: AbortSignal, onPageProgress?: (progress: BankPageProgress) => void, withDocument?: (pdf: StatementPdf, texts: readonly StatementPageText[], pages: readonly BankPage[]) => Promise<T>): Promise<{
    pages: BankPage[];
    mode: 'bank';
    extra?: T;
}> {
    if (signal.aborted)
        throw new Error('已取消解析');
    let task: ReturnType<typeof openStatementDocument> | undefined;
    let stage: BankImportStage = 'open', failed = false, cleanupFailure: string | undefined;
    const pages: BankPage[] = [], texts: StatementPageText[] = [];
    let extra: T | undefined;
    const cancel = () => { void task?.destroy().catch(() => {}); };
    try {
        task = openStatementDocument('bank', bytes, password, signal);
        signal.addEventListener('abort', cancel, { once: true });
        const pdf = await task.promise;
        if (pdf.numPages > 100)
            throw new Error(BANK_PDF_ERRORS.pages);
        if (signal.aborted)
            throw new Error('已取消解析');
        onPageProgress?.({ completed: 0, total: pdf.numPages });
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
                if (withDocument) texts.push(text);
                onPageProgress?.({ completed: n, total: pdf.numPages });
            }
            finally {
                page.cleanup();
            }
        }
        if (!chars)
            throw new Error(BANK_PDF_ERRORS.noText);
        if (withDocument) extra = await withDocument(pdf, texts, pages);
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
    return { pages, mode: 'bank', ...(withDocument && { extra }) };
}
