import { describe, expect, it } from 'vitest';
import {
    appendJudgeMessage,
    createJudgeState,
    finishJudgeState,
    selectPlaygroundLanguages,
} from '../src/playground';

describe('standalone playground', () => {
    it('selects one enabled Hydro judge language for C++, Python and Java', () => {
        const selected = selectPlaygroundLanguages({
            cc: { display: 'C++14', monaco: 'cpp', execute: './foo' },
            'cc.cc17': { display: 'C++17', monaco: 'cpp', execute: './foo' },
            'cc.cc20': { display: 'C++20', monaco: 'cpp', execute: './foo' },
            'cc.cc23': { display: 'C++23 disabled', monaco: 'cpp', execute: './foo', disabled: true },
            py: { display: 'Python', monaco: 'python', execute: 'python foo.py' },
            'py.py3': { display: 'Python 3', monaco: 'python', execute: 'python3 foo.py' },
            'py.remote': { display: 'Remote Python', monaco: 'python', execute: 'python', remote: true },
            java: { display: 'Java', monaco: 'java', execute: 'java Main' },
            javascript: { display: 'Node.js', monaco: 'javascript', execute: 'node main.js' },
        });

        expect(selected).toEqual([
            { family: 'cpp', key: 'cc.cc20', display: 'C++20', monaco: 'cpp', extension: 'cc' },
            { family: 'python', key: 'py.py3', display: 'Python 3', monaco: 'python', extension: 'py' },
            { family: 'java', key: 'java', display: 'Java', monaco: 'java', extension: 'java' },
        ]);
    });

    it('collects compiler messages and sandbox output without a record document', () => {
        const state = createJudgeState();
        appendJudgeMessage(state, { compilerText: 'warning: demo' });
        appendJudgeMessage(state, {
            case: { status: 1, time: 14, memory: 4096, message: 'hello\n' },
        });
        appendJudgeMessage(state, { status: 1, time: 14, memory: 4096 });

        expect(finishJudgeState('0123456789abcdef01234567', state)).toEqual({
            rid: '0123456789abcdef01234567',
            status: 1,
            statusText: 'Finished',
            time: 14,
            memory: 4096,
            output: 'hello',
            compilerText: 'warning: demo',
            judgeText: '',
        });
    });
});
