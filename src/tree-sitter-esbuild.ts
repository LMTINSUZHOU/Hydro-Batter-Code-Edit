import type { Plugin } from 'esbuild';

const NODE_ONLY_MODULES = /^(?:fs\/promises|module)$/;

export const treeSitterBrowserEsbuildPlugin: Plugin = {
    name: 'hydro-batter-tree-sitter-browser',
    setup(build) {
        build.onResolve({ filter: NODE_ONLY_MODULES }, (args) => {
            if (!args.importer.includes('web-tree-sitter')) return undefined;
            return { path: args.path, namespace: 'hydro-batter-tree-sitter-empty' };
        });
        build.onLoad({ filter: /.*/, namespace: 'hydro-batter-tree-sitter-empty' }, (args) => ({
            contents: args.path === 'fs/promises'
                ? 'export async function readFile() { throw new Error("Node fs is unavailable in the browser"); }'
                : 'export function createRequire() { throw new Error("Node require is unavailable in the browser"); }',
            loader: 'js',
        }));
    },
};
