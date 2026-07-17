import { describe, expect, it } from 'vitest';
import { getAutoImportEdit } from '../src/auto-import';

describe('completion auto imports', () => {
    it('adds and deduplicates C++ headers', () => {
        expect(getAutoImportEdit('using namespace std;\n', 'cpp', 'vector')).toMatchObject({
            start: 0,
            text: '#include <vector>\n',
        });
        expect(getAutoImportEdit('#include <vector>\n', 'cpp', 'vector')).toBeUndefined();
        expect(getAutoImportEdit('#include <bits/stdc++.h>\n', 'cpp', 'priority_queue')).toBeUndefined();
    });

    it('places Python imports after existing imports', () => {
        const code = 'import sys\n\nvalues = []\n';
        expect(getAutoImportEdit(code, 'python', 'deque')).toMatchObject({
            start: 11,
            text: 'from collections import deque\n',
        });
        expect(getAutoImportEdit('from collections import deque\n', 'python', 'deque')).toBeUndefined();
        const encodedScript = '#!/usr/bin/env python3\n# -*- coding: utf-8 -*-\nprint("ok")\n';
        expect(getAutoImportEdit(encodedScript, 'python', 'Counter')).toMatchObject({
            start: 47,
            text: 'from collections import Counter\n',
        });
    });

    it('places Java imports after package/import declarations', () => {
        const code = 'package solution;\n\nimport java.io.*;\n\nclass Main {}\n';
        expect(getAutoImportEdit(code, 'java', 'ArrayList')).toMatchObject({
            start: 37,
            text: 'import java.util.ArrayList;\n',
        });
        expect(getAutoImportEdit('import java.util.*;\n', 'java', 'HashMap')).toBeUndefined();
    });
});
