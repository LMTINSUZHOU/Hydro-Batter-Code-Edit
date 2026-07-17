import {
    Context, Handler, NotFoundError, param, PRIV, Schema, SettingModel, SystemModel, Types, UiContextBase,
} from 'hydrooj';
import { readFileSync } from 'node:fs';
import { BatterEditorConfig, DEFAULT_EDITOR_CONFIG } from './types';
import {
    PLAYGROUND_DATA_URL, PlaygroundLanguage, selectPlaygroundLanguages,
} from './src/playground';
import { PlaygroundRunner } from './src/playground-runner';
import { treeSitterBrowserEsbuildPlugin } from './src/tree-sitter-esbuild';
import {
    getAvailableLspLanguages, LspConnectionHandler,
} from './src/lsp-gateway';

declare module 'hydrooj' {
    interface SystemKeys {
        'hydro-batter-code-edit.enabled': boolean;
        'hydro-batter-code-edit.completion': boolean;
        'hydro-batter-code-edit.lspEnabled': boolean;
        'hydro-batter-code-edit.lspClangdCommand': string;
        'hydro-batter-code-edit.lspCppCompilerCommand': string;
        'hydro-batter-code-edit.lspPyrightCommand': string;
        'hydro-batter-code-edit.lspJdtlsCommand': string;
        'hydro-batter-code-edit.lspMaxSessions': number;
        'hydro-batter-code-edit.lspMaxSessionsPerUser': number;
        'hydro-batter-code-edit.lspMaxDocumentBytes': number;
        'hydro-batter-code-edit.lspIdleTimeout': number;
        'hydro-batter-code-edit.templates': boolean;
        'hydro-batter-code-edit.formatting': boolean;
        'hydro-batter-code-edit.diagnostics': boolean;
        'hydro-batter-code-edit.autosave': boolean;
        'hydro-batter-code-edit.autosaveDelay': number;
        'hydro-batter-code-edit.diagnosticsDelay': number;
        'hydro-batter-code-edit.draftRetentionDays': number;
        'hydro-batter-code-edit.playgroundEnabled': boolean;
        'hydro-batter-code-edit.playgroundTimeLimit': number;
        'hydro-batter-code-edit.playgroundMemoryLimit': number;
        'hydro-batter-code-edit.playgroundRunsPerMinute': number;
        'hydro-batter-code-edit.playgroundMaxInputBytes': number;
        'hydro-batter-code-edit.playgroundTimeout': number;
        'limit.codelength': number;
    }

    interface UiContextBase {
        hydroBatterCodeEdit?: BatterEditorConfig & { version: string; lspLanguages: string[] };
    }
}

export const name = 'hydro-batter-code-edit';
export const version = '1.4.0-pre.1';

let playgroundRunner: PlaygroundRunner | undefined;

const TREE_SITTER_ASSETS: Record<string, string> = {
    'web-tree-sitter.wasm': require.resolve('web-tree-sitter/web-tree-sitter.wasm'),
    'tree-sitter-cpp.wasm': require.resolve('tree-sitter-cpp/tree-sitter-cpp.wasm'),
    'tree-sitter-python.wasm': require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    'tree-sitter-java.wasm': require.resolve('tree-sitter-java/tree-sitter-java.wasm'),
};

class TreeSitterAssetHandler extends Handler {
    noCheckPermView = true;

    @param('name', Types.Filename)
    async get(domainId: string, assetName: string) {
        const assetPath = TREE_SITTER_ASSETS[assetName];
        if (!assetPath) throw new NotFoundError(assetName);
        this.response.type = 'application/wasm';
        this.response.addHeader('Cache-Control', 'public, max-age=31536000, immutable');
        this.response.body = readFileSync(assetPath);
    }
}

class PlaygroundDataHandler extends Handler {
    noCheckPermView = true;

    async get() {
        this.response.type = 'text/plain; charset=utf-8';
        this.response.addHeader('Cache-Control', 'public, max-age=31536000, immutable');
        this.response.body = '\n';
    }
}

function getPlaygroundLanguages(): PlaygroundLanguage[] {
    return selectPlaygroundLanguages(SettingModel.langs || {});
}

class PlaygroundHandler extends Handler {
    private languages: PlaygroundLanguage[] = [];

    async prepare() {
        if (!getBoolean('hydro-batter-code-edit.playgroundEnabled', true)) {
            throw new NotFoundError('hydro_batter_playground');
        }
        this.languages = getPlaygroundLanguages();
    }

    async get() {
        this.response.body = {};
        const response = this.response.body as Record<string, any>;
        this.response.template = 'hydro_batter_playground.html';
        response.page_name = 'hydro_batter_playground';
        response.playground = {
            endpoint: this.url('hydro_batter_playground'),
            languages: this.languages,
            timeLimitSeconds: getNumber('hydro-batter-code-edit.playgroundTimeLimit', 2),
            memoryLimitMb: getNumber('hydro-batter-code-edit.playgroundMemoryLimit', 256),
            maxInputBytes: getNumber('hydro-batter-code-edit.playgroundMaxInputBytes', 262144),
        };
    }

    @param('lang', Types.Name)
    @param('code', Types.String)
    @param('stdin', Types.String, true)
    async post(domainId: string, lang: string, code: string, input = '') {
        this.response.template = null;
        const language = this.languages.find((item) => item.key === lang);
        const maxCodeBytes = Number(SystemModel.get('limit.codelength')) || 128 * 1024;
        const maxInputBytes = getNumber('hydro-batter-code-edit.playgroundMaxInputBytes', 262144);
        if (!language) {
            this.response.status = 400;
            this.response.body = { ok: false, error: 'This language is not available in the Hydro judge configuration.' };
            return;
        }
        if (!code.trim() || Buffer.byteLength(code, 'utf8') > maxCodeBytes) {
            this.response.status = 400;
            this.response.body = { ok: false, error: `Code must contain 1 to ${maxCodeBytes} UTF-8 bytes.` };
            return;
        }
        if (Buffer.byteLength(input, 'utf8') > maxInputBytes) {
            this.response.status = 400;
            this.response.body = { ok: false, error: `Input must not exceed ${maxInputBytes} UTF-8 bytes.` };
            return;
        }
        await this.limitRate(
            'hydro_batter_playground',
            60,
            getNumber('hydro-batter-code-edit.playgroundRunsPerMinute', 10),
            '{{user}}',
        );
        if (!playgroundRunner) {
            this.response.status = 503;
            this.response.body = { ok: false, error: 'The playground runner is not ready.' };
            return;
        }
        try {
            const result = await playgroundRunner.run(
                domainId,
                this.user._id,
                language.key,
                code.replace(/\r\n/g, '\n'),
                input.replace(/\r\n/g, '\n'),
                {
                    timeLimitSeconds: getNumber('hydro-batter-code-edit.playgroundTimeLimit', 2),
                    memoryLimitMb: getNumber('hydro-batter-code-edit.playgroundMemoryLimit', 256),
                    timeoutMs: getNumber('hydro-batter-code-edit.playgroundTimeout', 45000),
                },
            );
            this.response.body = { ok: true, result };
        } catch (error) {
            this.response.status = 503;
            this.response.body = {
                ok: false,
                error: error instanceof Error ? error.message : 'The Hydro judge could not run this program.',
            };
        }
    }
}

const settingSchema = Schema.object({
    'hydro-batter-code-edit': Schema.object({
        enabled: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.enabled)
            .description('Enable Monaco editor enhancements'),
        completion: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.completion)
            .description('Enable competitive-programming completions'),
        lspEnabled: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.lspEnabled)
            .description('Enable clangd, Pyright and JDT language servers'),
        lspClangdCommand: Schema.string().default('clangd')
            .description('clangd executable path or command name'),
        lspCppCompilerCommand: Schema.string().default('auto')
            .description('Trusted C++ compiler used by clangd to discover GCC/libstdc++ headers; auto or an executable path'),
        lspPyrightCommand: Schema.string().default('bundled')
            .description('Pyright executable path, command name, or bundled'),
        lspJdtlsCommand: Schema.string().default('jdtls')
            .description('JDT LS wrapper executable path or command name'),
        lspMaxSessions: Schema.number().min(1).max(64).step(1).default(8)
            .description('Maximum concurrent LSP sessions per Hydro process'),
        lspMaxSessionsPerUser: Schema.number().min(1).max(8).step(1).default(2)
            .description('Maximum concurrent LSP sessions per user'),
        lspMaxDocumentBytes: Schema.number().min(16384).max(4194304).step(1024).default(524288)
            .description('Maximum document size sent to a language server'),
        lspIdleTimeout: Schema.number().min(30000).max(3600000).step(1000).default(300000)
            .description('Idle LSP session timeout in milliseconds'),
        templates: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.templates)
            .description('Enable code templates'),
        formatting: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.formatting)
            .description('Enable document formatting'),
        diagnostics: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.diagnostics)
            .description('Enable lightweight code diagnostics'),
        autosave: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.autosave)
            .description('Autosave code drafts in the browser'),
        autosaveDelay: Schema.number().min(200).max(30000).step(100)
            .default(DEFAULT_EDITOR_CONFIG.autosaveDelay)
            .description('Autosave delay in milliseconds'),
        diagnosticsDelay: Schema.number().min(100).max(10000).step(50)
            .default(DEFAULT_EDITOR_CONFIG.diagnosticsDelay)
            .description('Diagnostics debounce in milliseconds'),
        draftRetentionDays: Schema.number().min(1).max(365).step(1)
            .default(DEFAULT_EDITOR_CONFIG.draftRetentionDays)
            .description('Local draft retention in days'),
        playgroundEnabled: Schema.boolean().default(true)
            .description('Show the standalone online IDE and enable sandboxed self-test runs'),
        playgroundTimeLimit: Schema.number().min(1).max(10).step(1).default(2)
            .description('Standalone IDE execution time limit in seconds'),
        playgroundMemoryLimit: Schema.number().min(64).max(1024).step(64).default(256)
            .description('Standalone IDE execution memory limit in MiB'),
        playgroundRunsPerMinute: Schema.number().min(1).max(60).step(1).default(10)
            .description('Maximum standalone IDE runs per user per minute'),
        playgroundMaxInputBytes: Schema.number().min(1024).max(1048576).step(1024).default(262144)
            .description('Maximum standalone IDE standard-input size in bytes'),
        playgroundTimeout: Schema.number().min(10000).max(120000).step(1000).default(45000)
            .description('Maximum time to wait for the Hydro judge result in milliseconds'),
    }).extra('family', 'setting_hydro_batter_code_edit'),
});

function getBoolean(key: keyof import('hydrooj').SystemKeys, fallback: boolean): boolean {
    const value = SystemModel.get(key);
    return typeof value === 'boolean' ? value : fallback;
}

function getNumber(key: keyof import('hydrooj').SystemKeys, fallback: number): number {
    const value = SystemModel.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getPublicConfig(): BatterEditorConfig & { version: string; lspLanguages: string[] } {
    return {
        version,
        enabled: getBoolean('hydro-batter-code-edit.enabled', DEFAULT_EDITOR_CONFIG.enabled),
        completion: getBoolean('hydro-batter-code-edit.completion', DEFAULT_EDITOR_CONFIG.completion),
        lspEnabled: getBoolean('hydro-batter-code-edit.lspEnabled', DEFAULT_EDITOR_CONFIG.lspEnabled),
        lspLanguages: getAvailableLspLanguages(),
        templates: getBoolean('hydro-batter-code-edit.templates', DEFAULT_EDITOR_CONFIG.templates),
        formatting: getBoolean('hydro-batter-code-edit.formatting', DEFAULT_EDITOR_CONFIG.formatting),
        diagnostics: getBoolean('hydro-batter-code-edit.diagnostics', DEFAULT_EDITOR_CONFIG.diagnostics),
        autosave: getBoolean('hydro-batter-code-edit.autosave', DEFAULT_EDITOR_CONFIG.autosave),
        autosaveDelay: getNumber('hydro-batter-code-edit.autosaveDelay', DEFAULT_EDITOR_CONFIG.autosaveDelay),
        diagnosticsDelay: getNumber('hydro-batter-code-edit.diagnosticsDelay', DEFAULT_EDITOR_CONFIG.diagnosticsDelay),
        draftRetentionDays: getNumber('hydro-batter-code-edit.draftRetentionDays', DEFAULT_EDITOR_CONFIG.draftRetentionDays),
    };
}

export function apply(ctx: Context) {
    const ui = (global as any).Hydro?.ui;
    const esbuildPlugins = ui && (ui.esbuildPlugins ||= []);
    if (esbuildPlugins && !esbuildPlugins.some((plugin: { name?: string }) => plugin.name === treeSitterBrowserEsbuildPlugin.name)) {
        esbuildPlugins.push(treeSitterBrowserEsbuildPlugin);
        ctx.effect(() => () => {
            const index = esbuildPlugins.indexOf(treeSitterBrowserEsbuildPlugin);
            if (index >= 0) esbuildPlugins.splice(index, 1);
        });
    }

    ctx.inject(['setting'], (child: Context) => {
        child.setting.SystemSetting(settingSchema);
    });

    ctx.inject(['i18n'], (child: Context) => {
        child.i18n.load('en', {
            setting_hydro_batter_code_edit: 'Batter Code Editor',
            'Batter editor: insert template': 'Batter editor: insert template',
            'Batter editor: format document': 'Batter editor: format document',
            'Batter editor: save local draft': 'Batter editor: save local draft',
            'Batter editor: restore local draft': 'Batter editor: restore local draft',
            'Batter editor: clear local draft': 'Batter editor: clear local draft',
            'Choose a code template': 'Choose a code template',
            'Local draft restored': 'Local draft restored',
            'Local draft saved': 'Local draft saved',
            'Local draft cleared': 'Local draft cleared',
            'No local draft was found': 'No local draft was found',
            'No template is available for this language': 'No template is available for this language',
            'Completion ready': 'Completion ready',
            'Syntax analysis ready': 'Syntax analysis ready',
            'Language server ready': 'Language server ready',
            'Draft saved at {0}': 'Draft saved at {0}',
            '{0} diagnostics': '{0} diagnostics',
            hydro_batter_playground: 'Online IDE',
            'Online IDE': 'Online IDE',
            'Write, run and test a standalone program without creating a submission.': 'Write, run and test a standalone program without creating a submission.',
            'There is no cloud save. The last closed state is kept only in this browser.': 'There is no cloud save. The last closed state is kept only in this browser.',
            'Reset to template': 'Reset to template',
            'Format code': 'Format code',
            'Run code': 'Run code',
            'Source code': 'Source code',
            'Source code editor': 'Source code editor',
            'Standard input': 'Standard input',
            'Enter the data passed to standard input': 'Enter the data passed to standard input',
            'Program output': 'Program output',
            'Ready to run': 'Ready to run',
            'Run the program to see its output here.': 'Run the program to see its output here.',
            'No runnable language is configured': 'No runnable language is configured',
            'Enable a C++, Python 3 or Java language in the Hydro language settings and connect HydroJudge.': 'Enable a C++, Python 3 or Java language in the Hydro language settings and connect HydroJudge.',
            'Running…': 'Running…',
            'Queued for HydroJudge': 'Queued for HydroJudge',
            'Compiling and running in the isolated judge sandbox…': 'Compiling and running in the isolated judge sandbox…',
            'Run failed': 'Run failed',
            'Program execution failed.': 'Program execution failed.',
            'Compiler output': 'Compiler output',
            'The program finished without output.': 'The program finished without output.',
            'Replace the current code with the default template?': 'Replace the current code with the default template?',
            'No formatter is available for this language.': 'No formatter is available for this language.',
            'Enter some code before running.': 'Enter some code before running.',
            'Standard input is too large.': 'Standard input is too large.',
            Cancel: 'Cancel',
        });
        child.i18n.load('zh', {
            setting_hydro_batter_code_edit: 'Batter 代码编辑器',
            'Batter editor: insert template': 'Batter 编辑器：插入模板',
            'Batter editor: format document': 'Batter 编辑器：格式化文档',
            'Batter editor: save local draft': 'Batter 编辑器：保存本地草稿',
            'Batter editor: restore local draft': 'Batter 编辑器：恢复本地草稿',
            'Batter editor: clear local draft': 'Batter 编辑器：清除本地草稿',
            'Choose a code template': '选择代码模板',
            'Local draft restored': '已恢复本地草稿',
            'Local draft saved': '本地草稿已保存',
            'Local draft cleared': '本地草稿已清除',
            'No local draft was found': '没有找到本地草稿',
            'No template is available for this language': '该语言暂无可用模板',
            'Completion ready': '补全已就绪',
            'Syntax analysis ready': '语法分析已就绪',
            'Language server ready': '语言服务器已就绪',
            'Draft saved at {0}': '草稿已于 {0} 保存',
            '{0} diagnostics': '{0} 个诊断',
            hydro_batter_playground: '在线 IDE',
            'Online IDE': '在线 IDE',
            'Write, run and test a standalone program without creating a submission.': '编写、运行并自测独立程序，不会生成提交记录。',
            'There is no cloud save. The last closed state is kept only in this browser.': '不提供云端保存；仅在本浏览器保留上次关闭页面时的状态。',
            'Reset to template': '重置为模板',
            'Format code': '格式化',
            'Run code': '运行代码',
            'Source code': '源代码',
            'Source code editor': '源代码编辑器',
            'Standard input': '标准输入',
            'Enter the data passed to standard input': '输入传给程序标准输入的数据',
            'Program output': '程序输出',
            'Ready to run': '等待运行',
            'Run the program to see its output here.': '运行程序后，输出会显示在这里。',
            'No runnable language is configured': '没有可运行的语言',
            'Enable a C++, Python 3 or Java language in the Hydro language settings and connect HydroJudge.': '请在 Hydro 语言设置中启用 C++、Python 3 或 Java，并连接 HydroJudge。',
            'Running…': '运行中…',
            'Queued for HydroJudge': '已进入 HydroJudge 队列',
            'Compiling and running in the isolated judge sandbox…': '正在隔离的评测沙箱中编译并运行…',
            'Run failed': '运行失败',
            'Program execution failed.': '程序运行失败。',
            'Compiler output': '编译器输出',
            'The program finished without output.': '程序运行结束，没有产生输出。',
            'Replace the current code with the default template?': '确定用默认模板替换当前代码吗？',
            'No formatter is available for this language.': '当前语言没有可用的格式化器。',
            'Enter some code before running.': '请先输入代码。',
            'Standard input is too large.': '标准输入内容过大。',
            Cancel: '取消',
        });
    });

    if (process.env.HYDRO_CLI) return;

    ctx.Route(
        'hydro_batter_code_edit_tree_sitter_asset',
        '/hydro-batter-code-edit/wasm/:name',
        TreeSitterAssetHandler,
    );
    ctx.Connection(
        'hydro_batter_code_edit_lsp',
        '/hydro-batter-code-edit/lsp/:language',
        LspConnectionHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route(
        'hydro_batter_playground_data',
        PLAYGROUND_DATA_URL,
        PlaygroundDataHandler,
        PRIV.PRIV_JUDGE,
    );
    ctx.Route(
        'hydro_batter_playground',
        '/playground',
        PlaygroundHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.injectUI(
        'Nav',
        'hydro_batter_playground',
        { prefix: 'hydro_batter_playground' },
        PRIV.PRIV_USER_PROFILE,
        () => getBoolean('hydro-batter-code-edit.playgroundEnabled', true),
    );
    playgroundRunner = new PlaygroundRunner(ctx);
    ctx.effect(() => () => { playgroundRunner = undefined; });

    ctx.effect(() => {
        Object.defineProperty(UiContextBase, 'hydroBatterCodeEdit', {
            configurable: true,
            enumerable: true,
            get: getPublicConfig,
        });
        return () => {
            delete (UiContextBase as UiContextBase & {
                hydroBatterCodeEdit?: BatterEditorConfig & { version: string; lspLanguages: string[] };
            }).hydroBatterCodeEdit;
        };
    });
}
