const { spawn } = require('child_process');
const http = require('http');
const PORT = Number(process.env.TEST_PORT || 4317);
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore','pipe','pipe'] });
let output = '';
child.stdout.on('data', d => { output += d.toString(); });
child.stderr.on('data', d => { output += d.toString(); });
function requestHealth() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://127.0.0.1:' + PORT + '/api/health', res => {
      let body = ''; res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Health status ' + res.statusCode));
        let data; try { data = JSON.parse(body); } catch { return reject(new Error('Health response was not JSON')); }
        if (!data.success || !data.server || !data.database) return reject(new Error('Health check reported failure: ' + body));
        resolve();
      });
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Health request timed out')));
  });
}
(async () => {
  const deadline = Date.now() + 6 * 60 * 1000;
  try {
    while (Date.now() < deadline) { await requestHealth(); process.stdout.write('.'); await new Promise(r => setTimeout(r, 5000)); }
    console.log('\nSix-minute server soak passed.'); child.kill('SIGTERM'); process.exit(0);
  } catch (e) { console.error('\nSoak failed:', e.message); console.error(output.slice(-5000)); child.kill('SIGTERM'); process.exit(1); }
})();