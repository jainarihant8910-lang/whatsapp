require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const db = require('./platform-db');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { execFile } = require('child_process');
const puppeteer = require('puppeteer');

const AUTH_ROOT = path.join(__dirname, '.wwebjs_auth');
const clients = new Map();
const starting = new Set();
const retries = new Map();
const generations = new Map();
const manualStops = new WeakSet();
const restartTimers = new Map();
const startupPromises = new Map();

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-sync',
  '--disable-features=Translate,BackForwardCache,MediaRouter',
  '--window-size=1280,900'
];

function browserDependenciesHint() {
  return 'Chromium is unavailable or could not launch. First run: npx puppeteer browsers install chrome';
}

function chromiumDiagnostic() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ].filter(Boolean);
  let managed = '';
  try {
    const p = puppeteer.executablePath();
    if (p) managed = fs.existsSync(p) ? 'Puppeteer Chrome: ' + p : 'Puppeteer Chrome path not found: ' + p;
  } catch (e) {
    managed = 'Puppeteer executable path unavailable: ' + e.message;
  }
  const found = candidates.filter(p => { try { return fs.existsSync(p); } catch { return false; } });
  let runtime = '';
  try {
    const p = puppeteer.executablePath();
    if (p && fs.existsSync(p)) {
      try {
        const version = execFileSync(p, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore','pipe','pipe'] }).trim();
        runtime += 'Chrome test launch: ' + version;
      } catch (e) {
        runtime += 'Chrome test launch failed: ' + String(e.message || e).split('\\n')[0];
      }
      try {
        const missing = execFileSync('bash', ['-lc', 'ldd ' + JSON.stringify(p) + ' 2>/dev/null | grep "not found" || true'], { encoding: 'utf8', timeout: 10000 }).trim();
        if (missing) runtime += '\\nMissing shared libraries:\\n' + missing;
      } catch {}
    }
  } catch {}
  return [managed, found.length ? 'System Chrome/Chromium: ' + found.join(', ') : 'No system Chrome/Chromium executable detected.', runtime].filter(Boolean).join('\n');
}

function profilePath(businessId) {
  return path.join(AUTH_ROOT, 'session-business-' + businessId);
}

function clearChromiumLocks(businessId) {
  const profile = profilePath(businessId);
  if (!fs.existsSync(profile)) return;

  // First stop only Chromium processes using THIS WhatsApp profile.
  try {
    const ps = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
    const pids = ps
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)
      .filter(x => x.includes('--user-data-dir=' + profile) || x.includes('--user-data-dir="' + profile + '"'))
      .map(x => Number(x.split(/\s+/)[0]))
      .filter(Number.isInteger)
      .filter(x => x > 1 && x !== process.pid);

    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }

    if (pids.length) {
      try { execFileSync('sleep', ['1']); } catch {}
      for (const pid of pids) {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
    }
  } catch {}

  // Remove Chromium's stale singleton markers only after the process is stopped.
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { fs.rmSync(path.join(profile, name), { force: true, recursive: true }); } catch {}
  }
}

function now() {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: false
  }).format(d);
  return { date, time };
}

function parse(body) {
  const lines = String(body || '')
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);

  if (lines.length < 2) return null;

  const items = [];
  for (const line of lines.slice(1)) {
    const m = line.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (m) items.push({ quantity: Number(m[1]), item: m[2].trim() });
  }

  return items.length ? { deliveredTo: lines[0], items } : null;
}

async function phone(message, client, businessId) {
  const from = String(message.from || '');
  if (!from || from.endsWith('@g.us')) return null;

  if (from.endsWith('@c.us')) {
    return db.normalizePhone(from.replace('@c.us', ''));
  }

  if (from.endsWith('@lid')) {
    const lid = from.replace('@lid', '');
    const old = await db.lid(businessId, lid);
    if (old) return old;

    try {
      const contact = await message.getContact();
      const p = db.normalizePhone(contact?.number || contact?.id?.user || '');
      if (p) {
        await db.saveLid(businessId, lid, p);
        return p;
      }
    } catch {}

    try {
      const result = await client.getContactLidAndPhone([from]);
      const p = db.normalizePhone(result?.[0]?.pn || result?.[0]?.phone || '');
      if (p) {
        await db.saveLid(businessId, lid, p);
        return p;
      }
    } catch {}

    return null;
  }

  return null;
}

function scheduleRestart(businessId, generation, delay = 5000) {
  if (restartTimers.has(businessId)) return;
  const timer = setTimeout(async () => {
    restartTimers.delete(businessId);
    if (generations.get(businessId) !== generation || clients.has(businessId) || starting.has(businessId)) return;
    try { await startBusiness(businessId); } catch (e) { console.error('WhatsApp automatic restart failed for business', businessId, e.message); }
  }, delay);
  restartTimers.set(businessId, timer);
}

async function startBusiness(businessId, force = false) {
  await db.ready;

  if (starting.has(businessId) && !force) return startupPromises.get(businessId);
  if (starting.has(businessId) && force) {
    const pending = startupPromises.get(businessId);
    const old = clients.get(businessId);
    if (old) {
      manualStops.add(old);
      try { await old.destroy(); } catch {}
      if (clients.get(businessId) === old) clients.delete(businessId);
    }
    // Invalidate callbacks belonging to the old startup before creating a new one.
    generations.set(businessId, (generations.get(businessId) || 0) + 1);
    starting.delete(businessId);
    if (pending) {
      // The old promise will time out/resolve from its own callbacks; do not reuse it.
    }
  }
  if (clients.has(businessId) && !force) return;

  if (force) {
    const old = clients.get(businessId);
    if (old) {
      manualStops.add(old);
      try { await old.destroy(); } catch {}
      clients.delete(businessId);
    }
    starting.delete(businessId);
    retries.delete(businessId);
    const timer = restartTimers.get(businessId);
    if (timer) { clearTimeout(timer); restartTimers.delete(businessId); }
  }

  const generation = (generations.get(businessId) || 0) + 1;
  generations.set(businessId, generation);

  starting.add(businessId);

  // startAll() uses this promise to avoid starting several Chromium processes
  // at the same instant. It resolves as soon as this session reaches a useful
  // milestone (QR, authenticated, ready, error) or after a safety timeout.
  let startupResolved = false;
  let resolveStartup;
  const startupPromise = new Promise(resolve => { resolveStartup = resolve; });
  const finishStartup = value => {
    if (startupResolved) return;
    startupResolved = true;
    clearTimeout(startupTimeout);
    if (startupPromises.get(businessId) === startupPromise) startupPromises.delete(businessId);
    resolveStartup(value);
  };
  const startupTimeout = setTimeout(() => finishStartup('timeout'), 25000);

  await db.setWa(businessId, 'STARTING', 'Starting WhatsApp…', null);

  // Recover from a crashed Chromium process before creating a new one.
  clearChromiumLocks(businessId);

  for (const dir of [
    path.join(__dirname, 'data', 'chrome-config', String(businessId)),
    path.join(__dirname, 'data', 'chrome-cache', String(businessId)),
    path.join(__dirname, 'data', 'chrome-crashpad', String(businessId))
  ]) fs.mkdirSync(dir, { recursive: true });

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'business-' + businessId,
      dataPath: AUTH_ROOT
    }),
    puppeteer: {
      headless: true,
      dumpio: String(process.env.WHATSAPP_DEBUG_BROWSER || '').toLowerCase() === 'true',
      args: CHROME_ARGS,
      protocolTimeout: 180000,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(__dirname, 'data', 'chrome-config', String(businessId)),
        XDG_CACHE_HOME: path.join(__dirname, 'data', 'chrome-cache', String(businessId)),
        CHROME_CRASHPAD_HANDLER_DATABASE: path.join(__dirname, 'data', 'chrome-crashpad', String(businessId))
      }
    },
    qrMaxRetries: 10
  });

  clients.set(businessId, client);

  client.on('qr', async qr => {
    if (generations.get(businessId) !== generation) return;
    try {
      const data = await qrcode.toDataURL(qr, { width: 360, margin: 1 });
      if (generations.get(businessId) !== generation) return;
      await db.setWa(
        businessId,
        'WAITING_FOR_QR',
        'Scan this QR code with WhatsApp.',
        data
      );
      console.log('WhatsApp QR generated for business', businessId);
      finishStartup('qr');
    } catch (e) {
      if (generations.get(businessId) !== generation) return;
      await db.setWa(businessId, 'ERROR', 'Could not create QR: ' + e.message, null).catch(() => {});
    }
  });

  // Puppeteer/Chromium can close while a restart is in progress. The error
  // event must be handled so a TargetCloseError cannot terminate Node.
  client.on('error', err => {
    const message = String(err?.message || err);
    console.error('WhatsApp client error for business', businessId, message);
    if (generations.get(businessId) !== generation) return;
    if (/Target closed|Protocol error|browser process/i.test(message)) {
      db.setWa(businessId, 'DISCONNECTED', 'WhatsApp browser stopped. Reconnecting…', null).catch(() => {});
      finishStartup('client-error');
      scheduleRestart(businessId, generation);
    }
  });

  client.on('authenticated', () => {
    db.setWa(businessId, 'AUTHENTICATED', 'WhatsApp authenticated. Opening session…', null)
      .catch(console.error);
    finishStartup('authenticated');
  });

  client.on('ready', () => {
    if (generations.get(businessId) !== generation) return;
    starting.delete(businessId);
    retries.delete(businessId);
    db.setWa(businessId, 'CONNECTED', 'WhatsApp is connected.', null).catch(console.error);
    console.log('WhatsApp ready for business', businessId);
    finishStartup('ready');
  });

  client.on('auth_failure', message => {
    if (generations.get(businessId) !== generation) return;
    starting.delete(businessId);
    db.setWa(businessId, 'AUTH_FAILURE', String(message), null).catch(console.error);
    console.error('WhatsApp authentication failed for business', businessId, message);
    finishStartup('auth-failure');
  });

  client.on('change_state', state => {
    if (generations.get(businessId) !== generation) return;
    if (state !== 'CONNECTED') {
      db.setWa(businessId, 'DISCONNECTED', 'WhatsApp state: ' + state, null).catch(console.error);
    }
  });

  client.on('disconnected', async reason => {
    const manual = manualStops.has(client);
    manualStops.delete(client);

    if (generations.get(businessId) === generation) {
      clients.delete(businessId);
      starting.delete(businessId);
      await db.setWa(
        businessId,
        'DISCONNECTED',
        manual ? 'WhatsApp disconnected. Starting a fresh session…' : 'Disconnected: ' + reason,
        null
      ).catch(() => {});
    }

    // A manual reconnect already starts the replacement client. Do not start
    // another one from the old client's disconnected event.
    finishStartup(manual ? 'manual-disconnect' : 'disconnected');
    if (!manual && generations.get(businessId) === generation) scheduleRestart(businessId, generation);
  });

  client.on('message', async message => {
    try {
      if (message.fromMe) return;

      const parsed = parse(message.body);
      if (!parsed) return;

      const senderPhone = await phone(message, client, businessId);
      if (!senderPhone) return;

      const allowed = await db.sender(businessId, senderPhone);
      if (!allowed) return;

      const whatsappMessageId = message.id?._serialized || message.id?.id;
      if (!whatsappMessageId) return;

      const t = now();
      const order = await db.createOrder({
        businessId,
        date: t.date,
        time: t.time,
        deliveredTo: parsed.deliveredTo,
        senderId: allowed.id,
        whatsappMessageId,
        whatsappFrom: message.from,
        body: message.body,
        senderPhone,
        items: parsed.items
      });

      if (order.confirmation_sent) return;

      const reply =
        'Order #' + order.id + ' ' +
        (order.status === 'SUCCESS'
          ? 'accepted successfully.'
          : order.status === 'PARTIAL'
            ? 'partially accepted.'
            : 'could not be fulfilled.') +
        ' Accepted: ' + order.accepted_items +
        ' item(s). Rejected: ' + order.rejected_items + ' item(s).';

      try {
        const sent = await message.reply(reply);
        await db.confirmationSent(
          businessId,
          order.id,
          sent?.id?._serialized || ''
        );
      } catch (e) {
        await db.confirmationPending(businessId, order.id);
        console.error('Confirmation failed:', e.message);
      }
    } catch (e) {
      console.error('WhatsApp message error:', e);
    }
  });

  let initAttempt = retries.get(businessId) || 0;
  const initialize = async () => {
    try {
      await client.initialize();
      if (generations.get(businessId) !== generation) return;
      retries.delete(businessId);
    } catch (e) {
      const msg = String(e?.message || e);
      const launchFailure = /Failed to launch the browser process|Could not find expected browser|ENOENT|libatk|libnss|libgbm/i.test(msg);
      const conflict = /already running|userDataDir|user data directory|Singleton/i.test(msg);

      try { await client.destroy(); } catch {}
      if (clients.get(businessId) === client) clients.delete(businessId);

      if (conflict && initAttempt < 2) {
        initAttempt += 1;
        retries.set(businessId, initAttempt);
        console.warn('WhatsApp profile is locked; recovering attempt', initAttempt);
        clearChromiumLocks(businessId);
        starting.delete(businessId);
        return startBusiness(businessId, true);
      }

      starting.delete(businessId);
      const shown = launchFailure ? msg + '\n\n' + browserDependenciesHint() + '\n' + chromiumDiagnostic() : msg;
      await db.setWa(businessId, 'ERROR', shown, null).catch(() => {});
      console.error('WhatsApp initialization failed for business', businessId, shown);
      finishStartup('init-error');
      // Do not auto-retry browser launch failures. Repeated Chromium crashes can
      // create overlapping sessions and detached-frame errors. The web UI's
      // Reconnect button performs a single explicit retry.
    }
  };

  initialize().catch(async e => {
    starting.delete(businessId);
    if (clients.get(businessId) === client) clients.delete(businessId);
    await db.setWa(businessId, 'ERROR', String(e?.message || e), null).catch(() => {});
    finishStartup('init-error');
    console.error('WhatsApp initialization error:', e);
  });

  return startupPromise;
}

async function startAll() {
  await db.ready;
  // Do not start every tenant's Chromium session at server boot. A small
  // Codespace can run out of memory/CPU when several WhatsApp Web browsers
  // are opened together. The web app starts the requested business lazily.
  if (String(process.env.WHATSAPP_START_ALL || '').toLowerCase() !== 'true') {
    console.log('WhatsApp startup mode: lazy (business starts when its web session is opened)');
    return;
  }

  const rows = await db.all('SELECT id FROM businesses ORDER BY id');
  for (const business of rows) {
    try {
      const milestone = await startBusiness(business.id);
      console.log('WhatsApp startup milestone for business', business.id, milestone || 'already-running');
    } catch (e) {
      console.error('WhatsApp startup failed for business', business.id, e.message);
    }
    await new Promise(resolve => setTimeout(resolve, 8000));
  }
}

process.on('unhandledRejection', reason => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', error => {
  console.error('Uncaught exception:', error);
});

module.exports = { startBusiness, startAll, clients };

if (require.main === module) startAll();
