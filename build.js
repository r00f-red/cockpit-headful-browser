#!/usr/bin/env node
/*
 * SPDX-License-Identifier: MIT
 *
 * Headful Browser - Build script
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { sassPlugin } from 'esbuild-sass-plugin';

const useWasm = os.arch() !== 'x64';

const esbuild = await (async () => {
    try {
        return (await import(useWasm ? 'esbuild-wasm' : 'esbuild')).default;
    } catch (e) {
        if (e.code !== 'ERR_MODULE_NOT_FOUND')
            throw e;
        const require = createRequire(import.meta.url);
        return (await import(require.resolve('esbuild'))).default;
    }
})();

const production = process.env.NODE_ENV === 'production';
const outdir = 'dist';

const parser = (await import('argparse')).default.ArgumentParser();
parser.add_argument('-r', '--rsync', { help: "rsync bundles to ssh target", metavar: "HOST" });
parser.add_argument('-w', '--watch', { action: 'store_true', help: "Enable watch mode", default: process.env.ESBUILD_WATCH === "true" });
const args = parser.parse_args();

if (args.rsync)
    process.env.RSYNC = args.rsync;

function notifyEndPlugin() {
    return {
        name: 'notify-end',
        setup(build) {
            let startTime;
            build.onStart(() => { startTime = new Date(); });
            build.onEnd((result) => {
                const endTime = new Date();
                const time = endTime - startTime;
                if (result.errors.length === 0) {
                    console.log(`${endTime.toTimeString().split(' ')[0]}: Build finished in ${time} ms`);
                } else {
                    console.log(`${endTime.toTimeString().split(' ')[0]}: Build failed with ${result.errors.length} errors`);
                }
            });
        }
    };
}

function watch_dirs(dir, on_change) {
    const callback = (ev, dirPath, fname) => {
        if (ev !== "change" || fname.startsWith('.')) return;
        on_change(path.join(dirPath, fname));
    };

    fs.watch(dir, {}, (ev, fname) => callback(ev, dir, fname));
    const d = fs.opendirSync(dir);
    let dirent;
    while ((dirent = d.readSync()) !== null) {
        if (dirent.isDirectory())
            watch_dirs(path.join(dir, dirent.name), on_change);
    }
    d.closeSync();
}

// Create dist directory
if (!fs.existsSync(outdir)) {
    fs.mkdirSync(outdir, { recursive: true });
}

const context = await esbuild.context({
    ...!production ? { sourcemap: "linked" } : {},
    bundle: true,
    entryPoints: ['./src/index.tsx'],
    // Mark Cockpit libraries as external - they are provided by Cockpit at runtime
    external: [
        'cockpit',
        'cockpit-dark-theme',
        'patternfly/*',
        '*.woff',
        '*.woff2',
        '*.jpg',
        '*.svg',
        '../../assets*'
    ],
    legalComments: 'external',
    loader: {
        ".ts": "tsx",
        ".tsx": "tsx",
        ".js": "jsx",
        ".scss": "css"
    },
    minify: production,
    outdir,
    metafile: true,
    target: ['es2020'],
    plugins: [
        {
            name: 'copy-assets',
            setup(build) {
                build.onEnd(() => {
                    try {
                        fs.copyFileSync('./src/manifest.json', './dist/manifest.json');
                        fs.copyFileSync('./src/index.html', './dist/index.html');
                    } catch (e) {
                        console.error('Failed to copy assets:', e.message);
                    }
                });
            }
        },
        sassPlugin({
            loadPaths: ['node_modules'],
            filter: /\.scss/,
            quietDeps: true,
        }),
        notifyEndPlugin(),
    ]
});

try {
    const result = await context.rebuild();
    if (result.errors.length > 0) {
        process.exit(1);
    }
} catch (e) {
    if (!args.watch) process.exit(1);
}

if (args.watch) {
    const on_change = async path => {
        console.log("change detected:", path);
        await context.cancel();
        try { await context.rebuild(); } catch (e) {}
    };

    watch_dirs('src', on_change);
    await new Promise(() => {});
}

context.dispose();
