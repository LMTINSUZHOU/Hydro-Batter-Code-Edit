import { describe, expect, it } from 'vitest';
import { diagnoseCode } from '../src/diagnostics';

describe('code diagnostics', () => {
    it('finds bracket errors but ignores brackets in strings and comments', () => {
        const code = `int main() {
    // unmatched: ]
    const char* text = "(";
    if (true) {
}
`;
        const diagnostics = diagnoseCode(code, 'cpp');
        expect(diagnostics.filter((item) => item.code === 'unclosed-delimiter')).toHaveLength(1);
        expect(diagnostics.some((item) => item.code === 'unmatched-closing-delimiter')).toBe(false);
    });

    it('detects full-width punctuation and merge conflicts', () => {
        const diagnostics = diagnoseCode('<<<<<<< HEAD\nint main（） {}\n=======\n>>>>>>> branch', 'cpp');
        expect(diagnostics.some((item) => item.code === 'merge-conflict')).toBe(true);
        expect(diagnostics.some((item) => item.code === 'full-width-punctuation')).toBe(true);
    });

    it('warns about common language-specific problems', () => {
        const java = diagnoseCode('public class Solution {\n    void solve() {}\n}', 'java');
        expect(java.some((item) => item.code === 'missing-entry-point')).toBe(true);
        expect(java.some((item) => item.code === 'java-main-class')).toBe(true);

        const python = diagnoseCode('def solve():\n \tprint(1)\n', 'python');
        expect(python.some((item) => item.code === 'mixed-indentation')).toBe(true);
    });
});
