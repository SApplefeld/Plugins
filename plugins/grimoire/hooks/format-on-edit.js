#!/usr/bin/env node
// PostToolUse hook: format C# files after Edit/Write.
// Deterministic enforcement of the mechanical layer of the house style,
// leaving the csharp-style skill to carry what a formatter can't.
// Guarded: silently does nothing when no formatter is installed.
// Cross-platform: Node core modules only. Never blocks: always exits 0.

'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');

function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

function tryFormat(filePath) {
    // Formatter candidates, in preference order. First success wins.
    const candidates = [
        { cmd: 'csharpier', args: ['format', filePath] },
        { cmd: 'dotnet', args: ['csharpier', 'format', filePath] },
        { cmd: 'dotnet-csharpier', args: [filePath] }
    ];

    for (const c of candidates) {
        try {
            const result = spawnSync(c.cmd, c.args, {
                stdio: 'ignore',
                timeout: 15000,
                shell: process.platform === 'win32'
            });
            if (result.status === 0) return true;
        } catch {
            // Candidate unavailable - try the next.
        }
    }
    return false;
}

function main() {
    // Parse Hook Payload.
    let payload = {};
    try {
        payload = JSON.parse(readStdin() || '{}');
    } catch {
        return;
    }

    // Resolve Target File.
    const input = payload.tool_input || {};
    const filePath = input.file_path || input.filePath || '';
    if (!filePath || !filePath.toLowerCase().endsWith('.cs')) return;
    if (!fs.existsSync(filePath)) return;

    // Format the File (silent on every failure path).
    tryFormat(filePath);
}

try {
    main();
} catch {
    // Never break a session over a formatter.
}
process.exit(0);
