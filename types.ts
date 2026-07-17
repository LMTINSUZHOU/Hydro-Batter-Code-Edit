export interface BatterEditorConfig {
    enabled: boolean;
    completion: boolean;
    lspEnabled: boolean;
    templates: boolean;
    formatting: boolean;
    diagnostics: boolean;
    autosave: boolean;
    autosaveDelay: number;
    diagnosticsDelay: number;
    draftRetentionDays: number;
}

export const DEFAULT_EDITOR_CONFIG: BatterEditorConfig = {
    enabled: true,
    completion: true,
    lspEnabled: true,
    templates: true,
    formatting: true,
    diagnostics: true,
    autosave: true,
    autosaveDelay: 1000,
    diagnosticsDelay: 350,
    draftRetentionDays: 7,
};
