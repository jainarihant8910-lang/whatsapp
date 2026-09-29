require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const db = require('./platform-db');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const AUTH_ROOT = path.join(__dirname, '.wwebjs_auth');
const clients = new Map();
const starting = new Set();
const retries = new Map();
const generations = new Map();
const manualStops = new WeakSet();

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

async function startBusiness(businessId, force = false) {
  await db.ready;

  if (starting.has(businessId) && !force) return;
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
  }

  const generation = (generations.get(businessId) || 0) + 1;
  generations.set(businessId, generation);

  starting.add(businessId);
  await db.setWa(businessId, 'STARTING', 'Starting WhatsApp…', null);

  // Recover from a crashed Chromium process before creating a new one.
  clearChromiumLocks(businessId);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: 'business-' + businessId,
      dataPath: AUTH_ROOT
    }),
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote'
      ],
      protocolTimeout: 120000
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
    }
  });

  client.on('authenticated', () => {
    db.setWa(businessId, 'AUTHENTICATED', 'WhatsApp authenticated. Opening session…', null)
      .catch(console.error);
  });

  client.on('ready', () => {
    if (generations.get(businessId) !== generation) return;
    starting.delete(businessId);
    retries.delete(businessId);
    db.setWa(businessId, 'CONNECTED', 'WhatsApp is connected.', null).catch(console.error);
    console.log('WhatsApp ready for business', businessId);
  });

  client.on('auth_failure', message => {
    if (generations.get(businessId) !== generation) return;
    starting.delete(businessId);
    db.setWa(businessId, 'AUTH_FAILURE', String(message), null).catch(console.error);
    console.error('WhatsApp authentication failed for business', businessId, message);
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
    if (!manual && generations.get(businessId) === generation) {
      setTimeout(() => {
        if (generations.get(businessId) === generation && !clients.has(businessId)) {
          startBusiness(businessId).catch(console.error);
        }
      }, 5000);
    }
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
      await db.setWa(businessId, 'ERROR', msg, null).catch(() => {});
      console.error('WhatsApp initialization failed for business', businessId, msg);
    }
  };

  initialize().catch(async e => {
    starting.delete(businessId);
    if (clients.get(businessId) === client) clients.delete(businessId);
    await db.setWa(businessId, 'ERROR', String(e?.message || e), null).catch(() => {});
    console.error('WhatsApp initialization error:', e);
  });
}

async function startAll() {
  await db.ready;
  const rows = await db.all('SELECT id FROM businesses');

  for (const business of rows) {
    startBusiness(business.id).catch(console.error);
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
