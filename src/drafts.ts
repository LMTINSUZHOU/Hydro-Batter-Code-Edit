export const DRAFT_PREFIX = 'hydro-batter-code-edit:draft:v1:';

export interface StorageLike {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface DraftContext {
    userId: string;
    domainId: string;
    problemId: string;
    contestId: string;
    language: string;
}

export interface DraftRecord {
    version: 1;
    code: string;
    language: string;
    updatedAt: number;
    url: string;
}

function encode(value: string): string {
    return encodeURIComponent(value || '-');
}

export function buildDraftKey(context: DraftContext): string {
    return `${DRAFT_PREFIX}${[
        context.userId,
        context.domainId,
        context.problemId,
        context.contestId,
        context.language,
    ].map(encode).join(':')}`;
}

export function readDraft(storage: StorageLike, context: DraftContext): DraftRecord | null {
    try {
        const raw = storage.getItem(buildDraftKey(context));
        if (!raw) return null;
        const value = JSON.parse(raw) as Partial<DraftRecord>;
        if (value.version !== 1 || typeof value.code !== 'string' || typeof value.updatedAt !== 'number') return null;
        return value as DraftRecord;
    } catch {
        return null;
    }
}

export function writeDraft(
    storage: StorageLike,
    context: DraftContext,
    code: string,
    url = '',
    now = Date.now(),
): DraftRecord {
    const record: DraftRecord = {
        version: 1,
        code,
        language: context.language,
        updatedAt: now,
        url,
    };
    storage.setItem(buildDraftKey(context), JSON.stringify(record));
    return record;
}

export function clearDraft(storage: StorageLike, context: DraftContext): void {
    storage.removeItem(buildDraftKey(context));
}

export function cleanupExpiredDrafts(storage: StorageLike, retentionDays: number, now = Date.now()): number {
    const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
    const remove: string[] = [];
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (!key?.startsWith(DRAFT_PREFIX)) continue;
        try {
            const value = JSON.parse(storage.getItem(key) || '') as Partial<DraftRecord>;
            if (typeof value.updatedAt !== 'number' || value.updatedAt < cutoff) remove.push(key);
        } catch {
            remove.push(key);
        }
    }
    remove.forEach((key) => storage.removeItem(key));
    return remove.length;
}
