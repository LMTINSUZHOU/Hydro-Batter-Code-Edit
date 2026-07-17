export interface JsonRpcMessage {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
    [key: string]: unknown;
}

export class LspFrameDecoder {
    private buffer = Buffer.alloc(0);

    constructor(private maxBodyBytes = 8 * 1024 * 1024) {}

    push(chunk: Buffer | Uint8Array): JsonRpcMessage[] {
        this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
        const messages: JsonRpcMessage[] = [];
        while (this.buffer.length) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd < 0) {
                if (this.buffer.length > 8192) throw new Error('LSP header exceeds 8 KiB');
                break;
            }
            const header = this.buffer.subarray(0, headerEnd).toString('ascii');
            const match = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)\s*(?:\r\n|$)/i);
            if (!match) throw new Error('LSP response is missing Content-Length');
            const contentLength = Number(match[1]);
            if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > this.maxBodyBytes) {
                throw new Error(`Invalid LSP Content-Length: ${match[1]}`);
            }
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + contentLength;
            if (this.buffer.length < bodyEnd) break;
            const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
            this.buffer = this.buffer.subarray(bodyEnd);
            const parsed = JSON.parse(body);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('LSP payload must be a JSON object');
            }
            messages.push(parsed as JsonRpcMessage);
        }
        return messages;
    }
}

export function encodeLspMessage(message: JsonRpcMessage): Buffer {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    return Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
        body,
    ]);
}

function positionOffset(text: string, position: { line: number; character: number }): number {
    if (!Number.isSafeInteger(position?.line) || !Number.isSafeInteger(position?.character)
        || position.line < 0 || position.character < 0) throw new Error('Invalid LSP position');
    let lineStart = 0;
    for (let line = 0; line < position.line; line += 1) {
        const lineEnd = text.indexOf('\n', lineStart);
        if (lineEnd < 0) throw new Error('LSP position is outside the document');
        lineStart = lineEnd + 1;
    }
    const nextBreak = text.indexOf('\n', lineStart);
    let lineEnd = nextBreak < 0 ? text.length : nextBreak;
    if (lineEnd > lineStart && text[lineEnd - 1] === '\r') lineEnd -= 1;
    if (lineStart + position.character > lineEnd) throw new Error('LSP character is outside the line');
    return lineStart + position.character;
}

export function applyLspContentChanges(current: string, changes: readonly any[]): string {
    if (!Array.isArray(changes) || !changes.length) throw new Error('LSP change list is empty');
    let text = current;
    for (const change of changes) {
        if (typeof change?.text !== 'string') throw new Error('Invalid LSP text change');
        if (!change.range) {
            text = change.text;
            continue;
        }
        const start = positionOffset(text, change.range.start);
        const end = positionOffset(text, change.range.end);
        if (end < start) throw new Error('Invalid LSP change range');
        text = `${text.slice(0, start)}${change.text}${text.slice(end)}`;
    }
    return text;
}
