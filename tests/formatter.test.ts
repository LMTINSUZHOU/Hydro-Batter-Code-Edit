import { describe, expect, it } from 'vitest';
import { formatCode } from '../src/formatter';

describe('fallback formatter', () => {
    it('indents brace languages without changing strings', () => {
        const input = '#include <stdio.h>  \nint main(){\nprintf("}");\nif(1){\nreturn 0;\n}\n}\n';
        expect(formatCode(input, 'c', 4)).toBe(
            '#include <stdio.h>\nint main(){\n    printf("}");\n    if(1){\n        return 0;\n    }\n}\n',
        );
    });

    it('uses a conservative whitespace-only format for Python', () => {
        const input = 'def solve():  \n  print(1)\t\n\n';
        expect(formatCode(input, 'python')).toBe('def solve():\n  print(1)\n');
    });
});
