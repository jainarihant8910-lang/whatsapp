const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
for (const file of ['index.js','server.js','database.js','run.js','public/app.js']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) throw new Error('Missing file: ' + file);
  const result = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(result.stdout || ''); console.error(result.stderr || ''); process.exit(result.status || 1); }
}
console.log('Syntax checks passed for all application files.');