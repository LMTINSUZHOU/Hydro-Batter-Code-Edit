import { describe, expect, it } from 'vitest';
import { getCompletionSnippets, getTemplates, normalizeLanguage } from '../src/catalog';

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
});
