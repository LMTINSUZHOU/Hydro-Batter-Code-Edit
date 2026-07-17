import { ObjectId } from 'mongodb';
import { Context, TaskModel } from 'hydrooj';
import {
    appendJudgeMessage,
    createJudgeState,
    finishJudgeState,
    PLAYGROUND_DATA_URL,
    PLAYGROUND_RESULT_EVENT,
    PLAYGROUND_SENTINEL_PID,
    PLAYGROUND_TASK_META,
    PlaygroundRunResult,
} from './playground';

const PATCH_MARKER = Symbol.for('hydro-batter-code-edit.playground-judge-patch');
const COLLECTOR_MARKER = Symbol('hydro-batter-playground-collector');
const PRETEST_CONTEST_ID = new ObjectId('000000000000000000000000');
const DATA_FILES = ['input.txt', 'output.txt'].map((name) => ({
    _id: `hydro-batter-playground/${name}`,
    name,
    size: 1,
    etag: 'hydro-batter-playground-v1',
    lastModified: new Date(0),
}));

interface RunnerOptions {
    timeLimitSeconds: number;
    memoryLimitMb: number;
    timeoutMs: number;
}

interface PendingRun {
    rid: ObjectId;
    resolve(result: PlaygroundRunResult): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
}

interface Collector {
    [COLLECTOR_MARKER]: true;
    next(body: Record<string, any>): Promise<void>;
    end(body: Record<string, any>): Promise<void>;
    reset(): Promise<void>;
    wait: Promise<void>;
}

function isPlaygroundTask(task: any): boolean {
    return task?.meta?.type === PLAYGROUND_TASK_META;
}

function isJudgeConnection(connection: any): boolean {
    return connection?.category === '#judge'
        && typeof connection.newTask === 'function'
        && typeof connection.message === 'function'
        && typeof connection.send === 'function'
        && connection.tasks && typeof connection.tasks === 'object';
}

export class PlaygroundRunner {
    private pending = new Map<string, PendingRun>();
    private patched = new Map<any, () => void>();

    constructor(private ctx: Context) {
        ctx.on('connection/active', (connection: any) => this.patchJudgeConnection(connection));
        ctx.on('connection/close', (connection: any) => this.unpatchJudgeConnection(connection));
        ctx.on(PLAYGROUND_RESULT_EVENT as any, (result: PlaygroundRunResult) => this.receiveResult(result));
        ctx.on('handler/before/JudgeFilesDownload#post' as any, (handler: any) => {
            if (Number(handler.args?.pid) !== PLAYGROUND_SENTINEL_PID) return undefined;
            const files = handler.args?.files instanceof Set
                ? [...handler.args.files]
                : Array.isArray(handler.args?.files) ? handler.args.files : [];
            handler.response.template = null;
            handler.response.body = {
                links: Object.fromEntries(files.map((file: unknown) => [String(file), PLAYGROUND_DATA_URL])),
            };
            return 'after';
        });
        ctx.effect(() => () => this.dispose());
    }

    async run(
        domainId: string,
        uid: number,
        lang: string,
        code: string,
        input: string,
        options: RunnerOptions,
    ): Promise<PlaygroundRunResult> {
        const rid = new ObjectId();
        const key = rid.toHexString();
        let pending!: PendingRun;
        const result = new Promise<PlaygroundRunResult>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(key);
                void TaskModel.deleteMany({ rid }).catch(() => undefined);
                reject(new Error('The Hydro judge did not return a result before the playground timeout.'));
            }, options.timeoutMs);
            pending = { rid, resolve, reject, timer };
            this.pending.set(key, pending);
        });
        try {
            await TaskModel.add({
                type: 'judge',
                priority: -20,
                rid,
                domainId,
                pid: PLAYGROUND_SENTINEL_PID,
                uid,
                lang,
                code,
                input: [input],
                contest: PRETEST_CONTEST_ID,
                config: {
                    type: 'default',
                    time: `${options.timeLimitSeconds}s`,
                    memory: `${options.memoryLimitMb}m`,
                    detail: 'full',
                    cases: [{ input: 'input.txt', output: 'output.txt' }],
                },
                data: DATA_FILES,
                source: `system/${PLAYGROUND_SENTINEL_PID}`,
                trusted: false,
                meta: { problemOwner: uid, type: PLAYGROUND_TASK_META },
            });
        } catch (error) {
            clearTimeout(pending.timer);
            this.pending.delete(key);
            throw error;
        }
        return result.finally(() => TaskModel.deleteMany({ rid }).catch(() => undefined));
    }

    private receiveResult(result: PlaygroundRunResult) {
        if (!result || typeof result.rid !== 'string') return;
        const pending = this.pending.get(result.rid);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(result.rid);
        pending.resolve(result);
    }

    private patchJudgeConnection(connection: any) {
        if (!isJudgeConnection(connection) || connection[PATCH_MARKER]) return;
        const originalNewTask = connection.newTask;
        const originalMessage = connection.message;
        const runner = this;

        const patchedNewTask = async function patchedNewTask(this: any, task: any) {
            if (!isPlaygroundTask(task)) return originalNewTask.call(this, task);
            const rid = task.rid.toHexString();
            const collector = runner.createCollector(rid);
            this.tasks[rid] = collector;
            try {
                this.send({ task });
                await collector.wait;
            } finally {
                delete this.tasks[rid];
            }
        };
        const patchedMessage = async function patchedMessage(this: any, message: any) {
            const collector = this.tasks?.[message?.rid] as Collector | undefined;
            if (!collector?.[COLLECTOR_MARKER]) return originalMessage.call(this, message);
            if (message.key === 'next') await collector.next(message);
            else if (message.key === 'end') await collector.end(message);
        };
        connection.newTask = patchedNewTask;
        connection.message = patchedMessage;
        const restore = () => {
            if (connection.newTask === patchedNewTask) connection.newTask = originalNewTask;
            if (connection.message === patchedMessage) connection.message = originalMessage;
            delete connection[PATCH_MARKER];
            this.patched.delete(connection);
        };
        connection[PATCH_MARKER] = restore;
        this.patched.set(connection, restore);
    }

    private unpatchJudgeConnection(connection: any) {
        this.patched.get(connection)?.();
    }

    private createCollector(rid: string): Collector {
        const state = createJudgeState();
        let finished = false;
        let finish!: () => void;
        const wait = new Promise<void>((resolve) => { finish = resolve; });
        const publish = async (fallback?: string) => {
            if (finished) return;
            finished = true;
            if (fallback) {
                appendJudgeMessage(state, { status: 8, message: fallback });
            }
            try {
                if (typeof (this.ctx as any).parallel === 'function') {
                    await Promise.resolve((this.ctx as any).parallel(
                        PLAYGROUND_RESULT_EVENT,
                        finishJudgeState(rid, state),
                    ));
                }
                await Promise.resolve((this.ctx as any).broadcast(
                    PLAYGROUND_RESULT_EVENT,
                    finishJudgeState(rid, state),
                ));
            } finally {
                finish();
            }
        };
        return {
            [COLLECTOR_MARKER]: true,
            wait,
            async next(body) { appendJudgeMessage(state, body); },
            async end(body) {
                appendJudgeMessage(state, body);
                await publish();
            },
            async reset() {
                await publish('The Hydro judge disconnected while the playground program was running.');
            },
        };
    }

    private dispose() {
        for (const restore of [...this.patched.values()]) restore();
        for (const [rid, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(new Error('The playground runner was stopped.'));
            void TaskModel.deleteMany({ rid: pending.rid }).catch(() => undefined);
        }
        this.pending.clear();
    }
}
