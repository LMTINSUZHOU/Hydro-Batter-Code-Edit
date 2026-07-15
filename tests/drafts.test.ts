import { describe, expect, it } from 'vitest';
import {
    buildDraftKey, cleanupExpiredDrafts, clearDraft, DraftContext, readDraft, StorageLike, writeDraft,
} from '../src/drafts';

class MemoryStorage implements StorageLike {
    private values = new Map<string, string>();
    get length() { return this.values.size; }
    key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
    getItem(key: string) { return this.values.get(key) ?? null; }
    setItem(key: string, value: string) { this.values.set(key, value); }
    removeItem(key: string) { this.values.delete(key); }
}

const context: DraftContext = {
    userId: '2', domainId: 'system', problemId: 'P1000', contestId: 'normal', language: 'cpp',
};

describe('local drafts', () => {
    it('isolates, stores and clears drafts', () => {
        const storage = new MemoryStorage();
        expect(buildDraftKey(context)).toContain('P1000');
        writeDraft(storage, context, 'int main() {}', '/p/P1000', 123);
        expect(readDraft(storage, context)?.code).toBe('int main() {}');
        clearDraft(storage, context);
        expect(readDraft(storage, context)).toBeNull();
    });

    it('removes expired and malformed drafts', () => {
        const storage = new MemoryStorage();
        writeDraft(storage, context, 'old', '', 1);
        storage.setItem('hydro-batter-code-edit:draft:v1:broken', '{');
        expect(cleanupExpiredDrafts(storage, 7, 10 * 24 * 60 * 60 * 1000)).toBe(2);
        expect(storage.length).toBe(0);
    });
});
