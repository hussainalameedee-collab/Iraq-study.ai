
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'حسين العميدي';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const GIGACHAT_CREDENTIALS = process.env.GIGACHAT_CREDENTIALS;
const GIGACHAT_SCOPE = process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
const MODEL = process.env.GIGACHAT_MODEL || 'GigaChat';

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'iraqstudy.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (_req, res) => {
  res.type('text/css');
  res.sendFile(path.join(__dirname, 'style.css'));
});
app.get('/app.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'app.js'));
});

let db = { users: [], activity: [] };

function loadDb() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      db = {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        activity: Array.isArray(parsed.activity) ? parsed.activity : []
      };
    }
  } catch (err) {
    console.error('Could not read data file:', err.message);
  }
}

function saveDb() {
  try {
    fs.mkdirSync(path.dirname(path.resolve(DATA_FILE)), { recursive: true });
    const temp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(temp, DATA_FILE);
  } catch (err) {
    console.error('Could not save data file:', err.message);
    throw new Error('تعذر حفظ البيانات على الخادم. تحقق من إعدادات التخزين.');
  }
}

function logActivity(username, action, details = '') {
  db.activity.unshift({
    id: crypto.randomUUID(),
    username,
    action,
    details,
    createdAt: new Date().toISOString()
  });
  db.activity = db.activity.slice(0, 500);
  try {
    saveDb();
  } catch (e) {
    console.error(e.message);
  }
}

function publicUser(user) {
  const premiumActive = !!user &&
    !!user.premium &&
    (!user.premiumUntil || new Date(user.premiumUntil).getTime() > Date.now());

  if (user?.role === 'owner') {
    return {
      username: OWNER_USERNAME,
      role: 'owner',
      premium: true,
      premiumUntil: null
    };
  }

  return {
    username: user.username,
    role: 'user',
    premium: premiumActive,
    premiumUntil: premiumActive ? user.premiumUntil : null
  };
}

function currentUser(req) {
  if (req.session?.user?.role === 'owner') {
    return {
      username: OWNER_USERNAME,
      role: 'owner',
      premium: true,
      premiumUntil: null
    };
  }

  if (!req.session?.user?.username) return null;

  const user = db.users.find(
    u => u.username.toLowerCase() === req.session.user.username.toLowerCase()
  );

  if (!user) return null;

  if (
    user.premium &&
    user.premiumUntil &&
    new Date(user.premiumUntil).getTime() <= Date.now()
  ) {
    user.premium = false;
    user.premiumUntil = null;
    try {
      saveDb();
    } catch {}
  }

  return publicUser(user);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'سجّل الدخول أولاً حتى تكمل.' });
  }
  req.user = user;
  next();
}

function requireOwner(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== 'owner') {
    return res.status(403).json({ error: 'هذه الميزة مخصصة للـ Owner فقط.' });
  }
  req.user = user;
  next();
}

function cleanUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validUsername(name) {
  return name.length >= 3 && name.length <= 30 && !/[<>]/.test(name);
}

/* Supabase REST helpers: the service-role key is used only on the server. */
function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error('إعدادات Supabase ناقصة في إعدادات الخادم.');
    err.status = 503;
    throw err;
  }
}

async function supabaseRequest(table, query = '', options = {}) {
  requireSupabase();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`,
    {
      method: options.method || 'GET',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.returnRepresentation
          ? { Prefer: 'return=representation' }
          : {}),
        ...(options.upsert
          ? { Prefer: 'resolution=merge-duplicates,return=representation' }
          : {})
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {})
    }
  );

  const raw = await response.text();
  let data = null;

  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    console.error('Supabase request failed:', response.status, data);
    const err = new Error('تعذر الاتصال بقاعدة بيانات البريميوم.');
    err.status = 502;
    throw err;
  }

  return data;
}

/*
 * The existing login system uses data.json.
 * Before redeeming a code, make sure the matching account exists in
 * Supabase because premium_codes.used_by references public.users.id.
 */
async function getOrCreateSupabaseUser(localUser) {
  const usernameQuery = `username=eq.${encodeURIComponent(localUser.username)}&select=id,username&limit=1`;

  const found = await supabaseRequest('users', usernameQuery);

  if (Array.isArray(found) && found.length) {
    return found[0];
  }

  const id = localUser.id || crypto.randomUUID();

  try {
    const created = await supabaseRequest('users', 'select=id,username', {
      method: 'POST',
      returnRepresentation: true,
      body: {
        id,
        username: localUser.username,
        password_hash: localUser.passwordHash,
        role: 'user',
        premium: !!localUser.premium,
        premium_until: localUser.premiumUntil || null
      }
    });

    if (Array.isArray(created) && created.length) return created[0];
  } catch (err) {
    // Another request may have created the same username concurrently.
    const retry = await supabaseRequest('users', usernameQuery);
    if (Array.isArray(retry) && retry.length) return retry[0];
    throw err;
  }

  const retry = await supabaseRequest('users', usernameQuery);
  if (Array.isArray(retry) && retry.length) return retry[0];

  const err = new Error('تعذر تجهيز حسابك لتفعيل البريميوم.');
  err.status = 500;
  throw err;
}

loadDb();

if (!OWNER_PASSWORD) {
  console.warn('OWNER_PASSWORD is not set. Owner login is disabled until configured in hosting environment.');
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'iraq-study-ai' });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: currentUser(req) });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const username = cleanUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (!validUsername(username)) {
      return res.status(400).json({ error: 'اسم المستخدم لازم يكون بين 3 و30 حرفاً.' });
    }

    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'كلمة المرور لازم تكون 8 أحرف على الأقل.' });
    }

    if (username.toLowerCase() === OWNER_USERNAME.toLowerCase()) {
      return res.status(409).json({ error: 'اسم المستخدم هذا محجوز للـ Owner.' });
    }

    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل. اختَر اسماً آخر.' });
    }

    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'user',
      premium: false,
      premiumUntil: null,
      createdAt: new Date().toISOString()
    };

    db.users.push(user);
    saveDb();

    req.session.user = { username: user.username, role: 'user' };
    logActivity(username, 'إنشاء حساب');

    res.status(201).json({ user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ error: e.message || 'تعذر إنشاء الحساب.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const username = cleanUsername(req.body?.username);
    const password = String(req.body?.password || '');

    if (username.toLowerCase() === OWNER_USERNAME.toLowerCase()) {
      if (!OWNER_PASSWORD) {
        return res.status(503).json({
          error: 'حساب الـ Owner غير مهيّأ بعد. أضف OWNER_PASSWORD في إعدادات الخادم.'
        });
      }

      if (password !== OWNER_PASSWORD) {
        logActivity(username, 'محاولة دخول Owner فاشلة');
        return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
      }

      req.session.user = { username: OWNER_USERNAME, role: 'owner' };
      logActivity(OWNER_USERNAME, 'تسجيل دخول Owner');

      return res.json({ user: publicUser({ role: 'owner' }) });
    }

    const user = db.users.find(
      u => u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      logActivity(username || 'غير معروف', 'محاولة تسجيل دخول فاشلة');
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    req.session.user = { username: user.username, role: 'user' };
    logActivity(user.username, 'تسجيل دخول');

    res.json({ user: publicUser(user) });
  } catch {
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const name = currentUser(req)?.username || 'مستخدم';

  if (req.session) req.session.destroy(() => {});

  logActivity(name, 'تسجيل خروج');
  res.json({ ok: true });
});

/* Redeem a registered, unused Premium code. */
app.post('/api/premium/redeem', requireAuth, async (req, res) => {
  try {
    if (req.user.role === 'owner') {
      return res.status(400).json({
        error: 'حساب الـ Owner لديه Premium بالفعل.'
      });
    }

    const code = String(req.body?.code || '').trim();

    if (!/^\d{6,20}$/.test(code)) {
      return res.status(400).json({
        error: 'اكتب كود بريميوم صحيحاً.'
      });
    }

    const localUser = db.users.find(
      u => u.username.toLowerCase() === req.user.username.toLowerCase()
    );

    if (!localUser) {
      return res.status(401).json({
        error: 'انتهت الجلسة. سجّل الدخول مرة ثانية.'
      });
    }

    // Find the exact code in the database; its numeric range grants nothing.
    const rows = await supabaseRequest(
      'premium_codes',
      `code=eq.${encodeURIComponent(code)}&select=code,duration_days,is_permanent,used_by,used_at,revoked&limit=1`
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        error: 'الكود غير صحيح أو غير مسجّل.'
      });
    }

    const premiumCode = rows[0];

    if (premiumCode.revoked) {
      return res.status(400).json({ error: 'هذا الكود ملغي.' });
    }

    if (premiumCode.used_by || premiumCode.used_at) {
      return res.status(400).json({ error: 'هذا الكود مستخدم من قبل.' });
    }

    const permanent = premiumCode.is_permanent === true;
    const days = Number(premiumCode.duration_days);

    if (!permanent && (!Number.isInteger(days) || days < 1 || days > 36500)) {
      return res.status(400).json({
        error: 'مدة هذا الكود غير صحيحة. تواصل مع المسؤول.'
      });
    }

    const supabaseUser = await getOrCreateSupabaseUser(localUser);

    const now = Date.now();
    const oldExpiry = localUser.premium && localUser.premiumUntil
      ? new Date(localUser.premiumUntil).getTime()
      : 0;

    const startTime = Number.isFinite(oldExpiry) && oldExpiry > now
      ? oldExpiry
      : now;

    const expiresAt = permanent
      ? null
      : new Date(startTime + days * 24 * 60 * 60 * 1000).toISOString();

    /*
     * Atomic conditional update: only one request can claim a code
     * while used_by is still NULL and revoked is false.
     */
    const claimed = await supabaseRequest(
      'premium_codes',
      `code=eq.${encodeURIComponent(code)}&used_by=is.null&used_at=is.null&revoked=eq.false&select=code`,
      {
        method: 'PATCH',
        returnRepresentation: true,
        body: {
          used_by: supabaseUser.id,
          used_at: new Date().toISOString()
        }
      }
    );

    if (!Array.isArray(claimed) || claimed.length !== 1) {
      return res.status(409).json({
        error: 'هذا الكود استُخدم للتو أو لم يعد متاحاً.'
      });
    }

    // Update the existing local account system.
    localUser.premium = true;
    localUser.premiumUntil = expiresAt;

    try {
      saveDb();
    } catch (err) {
      // Do not report successful activation if local persistence failed.
      console.error('Local Premium save failed after code claim:', err.message);
      return res.status(500).json({
        error: 'تم حجز الكود، لكن تعذر حفظ التفعيل. تواصل مع المسؤول.'
      });
    }

    // Keep the corresponding Supabase account's Premium fields in sync.
    await supabaseRequest(
      'users',
      `id=eq.${encodeURIComponent(supabaseUser.id)}`,
      {
        method: 'PATCH',
        body: {
          premium: true,
          premium_until: expiresAt
        }
      }
    );

    const durationText = permanent
      ? 'دائم'
      : days === 1
        ? 'يوم واحد'
        : days === 7
          ? 'أسبوع واحد'
          : days === 30
            ? 'شهر واحد'
            : days === 90
              ? '3 أشهر'
              : days === 180
                ? '180 يوماً'
                : days === 365
                  ? 'سنة واحدة'
                  : `${days} يوم`;

    logActivity(localUser.username, 'تفعيل Premium بالكود', durationText);

    return res.json({
      success: true,
      message: 'تم تفعيل Premium بنجاح!',
      durationText,
      premiumUntil: expiresAt,
      isPermanent: permanent,
      user: publicUser(localUser)
    });
  } catch (err) {
    console.error('Premium redeem error:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'حدث خطأ أثناء تفعيل الكود. حاول مرة أخرى.'
    });
  }
});

app.get('/api/admin/users', requireOwner, (_req, res) => {
  const users = db.users.map(u => ({
    username: u.username,
    role: 'user',
    premium: !!u.premium &&
      (!u.premiumUntil || new Date(u.premiumUntil).getTime() > Date.now()),
    premiumUntil: u.premiumUntil,
    createdAt: u.createdAt
  }));

  if (OWNER_PASSWORD) {
    users.unshift({
      username: OWNER_USERNAME,
      role: 'owner',
      premium: true,
      premiumUntil: null,
      createdAt: null
    });
  }

  res.json({ users });
});

app.get('/api/admin/activity', requireOwner, (_req, res) => {
  res.json({ activity: db.activity.slice(0, 100) });
});

app.post('/api/admin/premium', requireOwner, (req, res) => {
  const username = cleanUsername(req.body?.username);

  if (!username || username.toLowerCase() === OWNER_USERNAME.toLowerCase()) {
    return res.status(400).json({
      error: 'اكتب اسم مستخدم صحيحاً. حساب الـ Owner لديه كل الصلاحيات.'
    });
  }

  const user = db.users.find(
    u => u.username.toLowerCase() === username.toLowerCase()
  );

  if (!user) {
    return res.status(404).json({ error: 'ما لكيت حساب بهذا الاسم.' });
  }

  if (req.body?.revoke) {
    user.premium = false;
    user.premiumUntil = null;
    saveDb();
    logActivity(OWNER_USERNAME, 'سحب Premium', user.username);
    return res.json({ message: `تم سحب Premium من ${user.username}.` });
  }

  const days = Number(req.body?.days);

  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    return res.status(400).json({ error: 'اختَر مدة صحيحة.' });
  }

  user.premium = true;
  user.premiumUntil = days === 0
    ? null
    : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  saveDb();
  logActivity(
    OWNER_USERNAME,
    'منح Premium',
    `${user.username} · ${days === 0 ? 'دائم' : `${days} يوم`}`
  );

  res.json({
    message: `تم منح Premium إلى ${user.username}${days === 0 ? ' بشكل دائم' : ` لمدة ${days} يوم`}.`
  });
});

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  if (!GIGACHAT_CREDENTIALS) {
    const err = new Error(
      'الذكاء الاصطناعي غير مربوط بعد. أضف GIGACHAT_CREDENTIALS في إعدادات الخادم.'
    );
    err.status = 503;
    throw err;
  }

  const response = await fetch(
    'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${GIGACHAT_CREDENTIALS}`,
        RqUID: crypto.randomUUID(),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ scope: GIGACHAT_SCOPE })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    console.error('GigaChat token error:', response.status, JSON.stringify(data));
    const err = new Error(
      'تعذر الاتصال بخدمة الذكاء الاصطناعي. تحقق من بيانات GigaChat وصلاحية الحساب.'
    );
    err.status = 502;
    throw err;
  }

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + 25 * 60 * 1000;

  return cachedToken;
}

app.post('/api/solve', requireAuth, async (req, res) => {
  try {
    const { grade, subject, page, questionNumber, task, mode } = req.body || {};

    if (!grade || !subject || !String(task || '').trim()) {
      return res.status(400).json({
        error: 'اكتب الصف والمادة ونص السؤال أو الموضوع.'
      });
    }

    if (String(task).length > 12000) {
      return res.status(413).json({
        error: 'النص طويل جداً. اختصر السؤال وحاول مرة أخرى.'
      });
    }

    const token = await getAccessToken();

    const systemPrompt =
      'أنت مساعد تعليمي متخصص بمساعدة الطلاب في المنهج العراقي. أجب باللغة العربية الواضحة وبأسلوب مناسب للصف. لا تخترع نصاً من كتاب أو رقم صفحة، ولا تدّعِ أنك تحققت من كتاب رسمي إذا لم يُرفق نصه. إذا كان السؤال ناقصاً، اطلب توضيحاً. للحل: اكتب الخطوات بالتسلسل ثم الجواب النهائي. للتلخيص: استخدم عناوين ونقاطاً وغطِّ الأفكار والتعاريف والقوانين المهمة. كن دقيقاً ولا تخمّن.';

    const userPrompt =
      `الصف: ${grade}\n` +
      `المادة: ${subject}\n` +
      `الصفحة: ${page || 'غير محددة'}\n` +
      `رقم السؤال: ${questionNumber || 'غير محدد'}\n` +
      `الطلب: ${mode === 'summary' ? 'تلخيص موضوع' : 'حل نموذجي مشروح'}\n` +
      `نص السؤال أو الموضوع:\n${String(task).trim()}`;

    const response = await fetch(
      'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        'GigaChat completion error:',
        response.status,
        JSON.stringify(data)
      );
      return res.status(502).json({
        error: 'خدمة الذكاء الاصطناعي لم تكمل الطلب. تحقق من صلاحية الحساب واسم النموذج.'
      });
    }

    const answer = data.choices?.[0]?.message?.content;

    if (!answer) {
      return res.status(502).json({
        error: 'وصل رد فارغ من خدمة الذكاء الاصطناعي. حاول مرة أخرى.'
      });
    }

    logActivity(
      req.user.username,
      mode === 'summary' ? 'طلب تلخيص' : 'طلب حل',
      `${subject} · ${grade}`
    );

    res.json({ answer });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({
      error: err.message || 'حدث خطأ غير متوقع.'
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`iraq study .ai running on port ${PORT}`));
}

module.exports = app;
