import { spawnSync } from 'node:child_process';
import {
    chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workspaces: string[] = [];

afterEach(async () => {
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});

describe.skipIf(process.platform !== 'linux')('Linux uninstall script', () => {
    it('supports dry-run, keeps npm dependencies on request, and removes only owned directories', async () => {
        const workspace = await mkdtemp(join(tmpdir(), 'hydro-batter-uninstall-'));
        workspaces.push(workspace);
        const script = join(workspace, 'uninstall.sh');
        await copyFile(resolve(__dirname, '..', 'uninstall.sh'), script);
        await chmod(script, 0o755);
        await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'hydro-batter-code-edit' }));
        await writeFile(join(workspace, 'keep.txt'), 'repository content');
        await mkdir(join(workspace, '.hydro-batter-runtime', 'nix'), { recursive: true });
        await mkdir(join(workspace, 'node_modules', 'pyright'), { recursive: true });

        const dryRun = spawnSync(script, ['--dry-run'], { cwd: workspace, encoding: 'utf8' });
        expect(dryRun.status).toBe(0);
        expect(dryRun.stdout).toContain('Dry run complete');
        expect(existsSync(join(workspace, '.hydro-batter-runtime'))).toBe(true);
        expect(existsSync(join(workspace, 'node_modules'))).toBe(true);

        const keepNpm = spawnSync(script, ['--keep-node-modules'], { cwd: workspace, encoding: 'utf8' });
        expect(keepNpm.status).toBe(0);
        expect(existsSync(join(workspace, '.hydro-batter-runtime'))).toBe(false);
        expect(existsSync(join(workspace, 'node_modules'))).toBe(true);

        await mkdir(join(workspace, '.hydro-batter-runtime', 'cache'), { recursive: true });
        const uninstall = spawnSync(script, [], { cwd: workspace, encoding: 'utf8' });
        expect(uninstall.status).toBe(0);
        expect(existsSync(join(workspace, '.hydro-batter-runtime'))).toBe(false);
        expect(existsSync(join(workspace, 'node_modules'))).toBe(false);
        expect(await readFile(join(workspace, 'keep.txt'), 'utf8')).toBe('repository content');
        expect(existsSync(join(workspace, 'package.json'))).toBe(true);
    });
});
