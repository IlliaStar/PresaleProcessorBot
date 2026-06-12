#!/usr/bin/env node
/**
 * bot-dev-start.js — Start local bot dev environment: kill port 3978, then launch bot + tunnel.
 *
 * Usage: node scripts/bot-dev-start.js
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const BOT_DIR = path.resolve(__dirname, '../microsoft-teams-bot');

// Kill anything on port 3978
try {
  const netstatOut = execSync(
    'netstat -ano 2>&1 | findstr ":3978" | findstr LISTENING',
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
  const lines = netstatOut.split('\n').filter(Boolean);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && !isNaN(parseInt(pid))) {
      execSync(`powershell -Command "Stop-Process -Id ${pid} -Force"`, { stdio: 'pipe' });
      console.error(`Killed PID ${pid} on port 3978`);
    }
  }
} catch { /* nothing on port 3978 */ }

// Start bot + tunnel (this is a long-running process — will replace this process)
const { spawn } = require('child_process');
const child = spawn('npm', ['run', 'start:dev:inner'], {
  cwd: BOT_DIR,
  stdio: 'inherit',
  shell: true,
});

console.log(JSON.stringify({ status: 'started', port: 3978, dir: BOT_DIR }));

child.on('exit', (code) => {
  process.exit(code || 0);
});