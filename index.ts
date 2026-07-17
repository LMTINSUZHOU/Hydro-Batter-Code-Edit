import {
    Context, Handler, NotFoundError, param, Schema, SystemModel, Types, UiContextBase,
} from 'hydrooj';
import { readFileSync } from 'node:fs';
import { BatterEditorConfig, DEFAULT_EDITOR_CONFIG } from './types';
import { treeSitterBrowserEsbuildPlugin } from './src/tree-sitter-esbuild';

declare module 'hydrooj' {
    interface SystemKeys {
        'hydro-batter-code-edit.enabled': boolean;
        'hydro-batter-code-edit.completion': boolean;
        'hydro-batter-code-edit.templates': boolean;
        'hydro-batter-code-edit.formatting': boolean;
        'hydro-batter-code-edit.diagnostics': boolean;
        'hydro-batter-code-edit.autosave': boolean;
        'hydro-batter-code-edit.autosaveDelay': number;
        'hydro-batter-code-edit.diagnosticsDelay': number;
        'hydro-batter-code-edit.draftRetentionDays': number;
    }

    interface UiContextBase {
        hydroBatterCodeEdit?: BatterEditorConfig & { version: string };
    }
}

export const name = 'hydro-batter-code-edit';
export const version = '1.2.0';

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

const settingSchema = Schema.object({
    'hydro-batter-code-edit': Schema.object({
        enabled: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.enabled)
            .description('Enable Monaco editor enhancements'),
        completion: Schema.boolean().default(DEFAULT_EDITOR_CONFIG.completion)
            .description('Enable competitive-programming completions'),
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

function getPublicConfig(): BatterEditorConfig & { version: string } {
    return {
        version,
        enabled: getBoolean('hydro-batter-code-edit.enabled', DEFAULT_EDITOR_CONFIG.enabled),
        completion: getBoolean('hydro-batter-code-edit.completion', DEFAULT_EDITOR_CONFIG.completion),
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
            'Draft saved at {0}': 'Draft saved at {0}',
            '{0} diagnostics': '{0} diagnostics',
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
            'Draft saved at {0}': '草稿已于 {0} 保存',
            '{0} diagnostics': '{0} 个诊断',
            Cancel: '取消',
        });
    });

    if (process.env.HYDRO_CLI) return;

    ctx.Route(
        'hydro_batter_code_edit_tree_sitter_asset',
        '/hydro-batter-code-edit/wasm/:name',
        TreeSitterAssetHandler,
    );

    ctx.effect(() => {
        Object.defineProperty(UiContextBase, 'hydroBatterCodeEdit', {
            configurable: true,
            enumerable: true,
            get: getPublicConfig,
        });
        return () => {
            delete (UiContextBase as UiContextBase & {
                hydroBatterCodeEdit?: BatterEditorConfig & { version: string };
            }).hydroBatterCodeEdit;
        };
    });
}
