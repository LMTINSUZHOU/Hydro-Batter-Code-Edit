import { describe, expect, it } from 'vitest';
import {
    getCompletionSnippets, getCompletionSymbols, getTemplates, normalizeLanguage,
} from '../src/catalog';

describe('template catalog', () => {
    it('normalizes Hydro and Monaco language aliases', () => {
        expect(normalizeLanguage('cc.cc17')).toBe('cpp');
        expect(normalizeLanguage('py.py3')).toBe('python');
        expect(normalizeLanguage('cs')).toBe('csharp');
    });

    it('provides complete entry-point templates', () => {
        expect(getTemplates('cpp')[0].body).toContain('int main()');
        expect(getTemplates('java')[0].body).toContain('public class Main');
        expect(getTemplates('python')[0].body).toContain('def solve()');
    });

    it('includes competitive-programming completions', () => {
        const prefixes = getCompletionSnippets('cpp').map((item) => item.prefix);
        expect(prefixes).toContain('main');
        expect(prefixes).toContain('bsearch');
        expect(prefixes).toContain('modpow');
    });

    it('completes C++ standard library symbols by prefix', () => {
        expect(getCompletionSymbols('cpp', 'qu').map((item) => item.label)).toEqual(['queue']);
        expect(getCompletionSymbols('cpp', 'pri').map((item) => item.label)).toContain('priority_queue');
    });

    it('completes Python built-ins and standard library symbols', () => {
        expect(getCompletionSymbols('python', 'pri').map((item) => item.label)).toContain('print');
        expect(getCompletionSymbols('python', 'deq').map((item) => item.label)).toContain('deque');
        expect(getCompletionSymbols('python', 'qu').map((item) => item.label)).toContain('queue');
    });

    it('completes Java collection types case-insensitively', () => {
        expect(getCompletionSymbols('java', 'Pri').map((item) => item.label)).toContain('PriorityQueue');
        expect(getCompletionSymbols('java', 'Arr').map((item) => item.label)).toEqual([
            'ArrayDeque', 'ArrayList', 'Arrays',
        ]);
    });
});
