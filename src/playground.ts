export const PLAYGROUND_TASK_META = 'hydro-batter-playground';
export const PLAYGROUND_RESULT_EVENT = 'hydro-batter/playground/result';
export const PLAYGROUND_SENTINEL_PID = Number.MAX_SAFE_INTEGER;
export const PLAYGROUND_DATA_URL = '/hydro-batter-code-edit/playground-data';

export type PlaygroundFamily = 'cpp' | 'python' | 'java';

export interface HydroLanguageConfig {
    disabled?: boolean;
    hidden?: boolean;
    remote?: boolean;
    display?: string;
    monaco?: string;
    highlight?: string;
    compile?: string;
    execute?: string;
}

export interface PlaygroundLanguage {
    family: PlaygroundFamily;
    key: string;
    display: string;
    monaco: PlaygroundFamily;
    extension: string;
}

const FAMILY_METADATA: Record<PlaygroundFamily, {
    defaultDisplay: string;
    extension: string;
    preference: RegExp[];
}> = {
    cpp: {
        defaultDisplay: 'C++',
        extension: 'cc',
        preference: [
            /^cc\.cc2[036]$/i,
            /^cc\.cc17$/i,
            /^cc\.cc14$/i,
            /^cc$/i,
            /^cpp/i,
        ],
    },
    python: {
        defaultDisplay: 'Python 3',
        extension: 'py',
        preference: [
            /^py\.py3$/i,
            /^python3$/i,
            /^py$/i,
            /^py\.pypy3$/i,
            /^pypy3$/i,
        ],
    },
    java: {
        defaultDisplay: 'Java',
        extension: 'java',
        preference: [/^java$/i],
    },
};

function familyOf(key: string, config: HydroLanguageConfig): PlaygroundFamily | null {
    const monaco = String(config.monaco || config.highlight || '').split(/\s+/)[0].toLowerCase();
    if (monaco === 'cpp' || /^(cc|cpp)(\.|$)/i.test(key)) return 'cpp';
    if (monaco === 'python' || /^(py|python|pypy)(\.|\d|$)/i.test(key)) return 'python';
    if (monaco === 'java' || /^java(\.|$)/i.test(key)) return 'java';
    return null;
}

function preferenceScore(family: PlaygroundFamily, key: string): number {
    const index = FAMILY_METADATA[family].preference.findIndex((pattern) => pattern.test(key));
    return index < 0 ? FAMILY_METADATA[family].preference.length + 100 : index;
}

/** Select one practical, enabled Hydro judge language for every supported editor family. */
export function selectPlaygroundLanguages(
    languages: Record<string, HydroLanguageConfig>,
): PlaygroundLanguage[] {
    const candidates: Record<PlaygroundFamily, Array<{ key: string; config: HydroLanguageConfig }>> = {
        cpp: [],
        python: [],
        java: [],
    };
    for (const [key, config] of Object.entries(languages || {})) {
        if (!config || config.disabled || config.hidden || config.remote || !config.execute) continue;
        const family = familyOf(key, config);
        if (family) candidates[family].push({ key, config });
    }
    return (Object.keys(candidates) as PlaygroundFamily[]).flatMap((family) => {
        const selected = candidates[family]
            .sort((left, right) => preferenceScore(family, left.key) - preferenceScore(family, right.key))[0];
        if (!selected) return [];
        const metadata = FAMILY_METADATA[family];
        return [{
            family,
            key: selected.key,
            display: selected.config.display || metadata.defaultDisplay,
            monaco: family,
            extension: metadata.extension,
        }];
    });
}

export interface PlaygroundJudgeState {
    compilerTexts: string[];
    judgeTexts: string[];
    cases: Array<{
        status?: number;
        time?: number;
        memory?: number;
        message?: string;
    }>;
    status?: number;
    time?: number;
    memory?: number;
}

export interface PlaygroundRunResult {
    rid: string;
    status: number;
    statusText: string;
    time: number;
    memory: number;
    output: string;
    compilerText: string;
    judgeText: string;
}

export function createJudgeState(): PlaygroundJudgeState {
    return { compilerTexts: [], judgeTexts: [], cases: [] };
}

function formatJudgeText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    const message = String((value as { message?: unknown }).message || '');
    const params = (value as { params?: unknown }).params;
    if (!Array.isArray(params)) return message;
    return params.reduce<string>((text, param, index) => (
        text.replaceAll(`{${index}}`, String(param))
    ), message);
}

export function appendJudgeMessage(state: PlaygroundJudgeState, body: Record<string, any>): void {
    if (typeof body.compilerText === 'string') state.compilerTexts.push(body.compilerText);
    const judgeText = formatJudgeText(body.message);
    if (judgeText) state.judgeTexts.push(judgeText);
    if (body.case && typeof body.case === 'object') state.cases.push(body.case);
    if (Array.isArray(body.cases)) state.cases.push(...body.cases.filter((item) => item && typeof item === 'object'));
    if (Number.isFinite(body.status)) state.status = body.status;
    if (Number.isFinite(body.time)) state.time = body.time;
    if (Number.isFinite(body.memory)) state.memory = body.memory;
}

const STATUS_TEXT: Record<number, string> = {
    0: 'Waiting',
    1: 'Finished',
    2: 'Wrong Answer',
    3: 'Time Limit Exceeded',
    4: 'Memory Limit Exceeded',
    5: 'Output Limit Exceeded',
    6: 'Runtime Error',
    7: 'Compile Error',
    8: 'System Error',
    9: 'Cancelled',
    31: 'Configuration Error',
};

export function finishJudgeState(rid: string, state: PlaygroundJudgeState): PlaygroundRunResult {
    const status = state.status ?? state.cases.at(-1)?.status ?? 8;
    const time = state.time ?? Math.max(0, ...state.cases.map((item) => Number(item.time) || 0));
    const memory = state.memory ?? Math.max(0, ...state.cases.map((item) => Number(item.memory) || 0));
    const compilerText = state.compilerTexts.join('\n').trim();
    const judgeText = state.judgeTexts.join('\n').trim();
    const output = state.cases
        .map((item) => typeof item.message === 'string' ? item.message : '')
        .filter(Boolean)
        .join('\n')
        .trimEnd();
    return {
        rid,
        status,
        statusText: STATUS_TEXT[status] || 'Finished',
        time,
        memory,
        output,
        compilerText,
        judgeText,
    };
}
