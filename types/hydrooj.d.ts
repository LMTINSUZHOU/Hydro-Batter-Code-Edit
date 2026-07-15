export interface SystemKeys {}
export interface UiContextBase {}

export const UiContextBase: Record<string, unknown>;
export const Schema: any;
export const SystemModel: {
    get<K extends keyof SystemKeys>(key: K): SystemKeys[K] | undefined;
};
export type Context = any;
