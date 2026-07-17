import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskModel = vi.hoisted(() => ({
    add: vi.fn(async (_task: unknown) => undefined),
    deleteMany: vi.fn(async (_query: unknown) => undefined),
}));

vi.mock('hydrooj', () => ({
    TaskModel: taskModel,
}));

import { PLAYGROUND_TASK_META } from '../src/playground';
import { PlaygroundRunner } from '../src/playground-runner';

describe('playground HydroJudge bridge', () => {
    beforeEach(() => {
        taskModel.add.mockClear();
        taskModel.deleteMany.mockClear();
    });

    it('uses an ephemeral judge task and returns raw sandbox output through the process bus', async () => {
        const handlers = new Map<string, Function>();
        const ctx: any = {
            on: (event: string, handler: Function) => { handlers.set(event, handler); },
            effect: (factory: Function) => { factory(); },
            broadcast: async (event: string, result: unknown) => handlers.get(event)?.(result),
        };
        const originalNewTask = vi.fn();
        const originalMessage = vi.fn();
        const connection: any = {
            category: '#judge',
            tasks: {},
            send: vi.fn(),
            newTask: originalNewTask,
            message: originalMessage,
        };
        const runner = new PlaygroundRunner(ctx);
        handlers.get('connection/active')?.(connection);

        const resultPromise = runner.run('system', 7, 'cc.cc20', 'int main() {}', '', {
            timeLimitSeconds: 2,
            memoryLimitMb: 256,
            timeoutMs: 5000,
        });
        await vi.waitFor(() => expect(taskModel.add).toHaveBeenCalledOnce());
        const task = taskModel.add.mock.calls[0][0] as any;
        expect(task).toMatchObject({
            type: 'judge',
            priority: -20,
            domainId: 'system',
            uid: 7,
            lang: 'cc.cc20',
            code: 'int main() {}',
            input: [''],
            data: [{ name: 'input.txt' }, { name: 'output.txt' }],
            meta: { problemOwner: 7, type: PLAYGROUND_TASK_META },
        });

        const judgeTask = connection.newTask(task);
        expect(connection.send).toHaveBeenCalledWith({ task });
        await connection.message({
            key: 'next',
            rid: task.rid.toHexString(),
            case: { status: 1, time: 9, memory: 2048, message: '42\n' },
        });
        await connection.message({
            key: 'end',
            rid: task.rid.toHexString(),
            status: 1,
            time: 9,
            memory: 2048,
        });

        await expect(resultPromise).resolves.toMatchObject({
            status: 1,
            output: '42',
            time: 9,
            memory: 2048,
        });
        await judgeTask;
        expect(originalNewTask).not.toHaveBeenCalled();
        expect(originalMessage).not.toHaveBeenCalled();
        expect(taskModel.deleteMany).toHaveBeenCalled();
    });
});
