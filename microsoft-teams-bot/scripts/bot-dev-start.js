#!/usr/bin/env node
// Kills any process on port 3978, then starts bot + devtunnel via concurrently.
const { execSync } = require('child_process');
const path = require('path');

const PORT = 3978;
const ROOT = path.join(__dirname, '..');

function killPort(port) {
  try {
    const result = execSync(
      `netstat -ano | findstr :${port}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const pids = [...new Set(
      result.split('\n')
        .map(line => line.trim().split(/\s+/).pop())
        .filter(pid => /^\d+$/.test(pid) && pid !== '0')
    )];
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
        console.log(`Killed PID ${pid} on port ${port}`);
      } catch {
        // already gone
      }
    }
  } catch {
    // nothing on the port
  }
}

killPort(PORT);

console.log('\n## Dev Environment Started');
console.log(`- Port: ${PORT}`);
console.log('- n8n: http://localhost:5678');
console.log('- Bot: https://tidy-river-mfkpvdl-3978.euw.devtunnels.ms/api/messages\n');

const { concurrently } = require(path.join(ROOT, 'node_modules', 'concurrently'));

const { result } = concurrently(
  [
    { command: `"${path.join(ROOT, 'node_modules', '.bin', 'nodemon.cmd')}" index.js`, name: 'bot', prefixColor: 'green' },
    { command: 'devtunnel host tidy-river-mfkpvdl.euw', name: 'tunnel', prefixColor: 'magenta' },
  ],
  { cwd: ROOT }
);

result.then(
  () => process.exit(0),
  () => process.exit(1),
);
