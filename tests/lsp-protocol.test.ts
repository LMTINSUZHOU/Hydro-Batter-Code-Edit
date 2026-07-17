import { describe, expect, it } from 'vitest';
import {
    applyLspContentChanges, encodeLspMessage, LspFrameDecoder,
} from '../src/lsp-protocol';

describe('LSP stdio protocol', () => {
    it('decodes fragmented and consecutive Content-Length frames', () => {
        const first = encodeLspMessage({ jsonrpc: '2.0', id: 1, result: { label: '队列' } });
        const second = encodeLspMessage({ jsonrpc: '2.0', method: 'initialized', params: {} });
        const payload = Buffer.concat([first, second]);
        const decoder = new LspFrameDecoder();
        expect(decoder.push(payload.subarray(0, 13))).toEqual([]);
        expect(decoder.push(payload.subarray(13, first.length + 7))).toEqual([
            { jsonrpc: '2.0', id: 1, result: { label: '队列' } },
        ]);
        expect(decoder.push(payload.subarray(first.length + 7))).toEqual([
            { jsonrpc: '2.0', method: 'initialized', params: {} },
        ]);
    });

    it('applies full and incremental UTF-16 document changes', () => {
        expect(applyLspContentChanges('items = []\nitems.ap', [{
            range: {
                start: { line: 0, character: 8 },
                end: { line: 0, character: 10 },
            },
            text: '{}',
        }])).toBe('items = {}\nitems.ap');
        expect(applyLspContentChanges('😀queue', [{
            range: {
                start: { line: 0, character: 2 },
                end: { line: 0, character: 7 },
            },
            text: 'deque',
        }])).toBe('😀deque');
        expect(applyLspContentChanges('old', [{ text: 'new' }])).toBe('new');
    });

    it('rejects oversized and malformed frames', () => {
        const decoder = new LspFrameDecoder(4);
        expect(() => decoder.push(Buffer.from('Content-Length: 5\r\n\r\n12345'))).toThrow('Invalid LSP Content-Length');
        expect(() => applyLspContentChanges('one', [{
            range: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
            text: 'x',
        }])).toThrow('outside the document');
    });
});
