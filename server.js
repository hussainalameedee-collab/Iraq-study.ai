require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const OWNER_USERNAME = process.env.OWNER_USERNAME || 'حسين العميدي';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

const GIGACHAT_CREDENTIALS = process.env.GIGACHAT_CREDENTIALS;
const GIGACHAT_SCOPE =
  process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
const MODEL = process.env.GIGACHAT_MODEL || 'GigaChat';

const SUPABASE_URL =
  (process.env.SUPABASE_URL || '').replace(/\/+$/, '');

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'iraqstudy.sid',
  secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error(
      'إعدادات Supabase ناقصة في إعدادات الخادم.'
    );
    error.status = 503;
    throw error;
  }
}

async function supabaseRequest(table, query = '', options = {}) {
  requireSupabase();

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  if (options.returnRepresentation) {
    headers.Prefer = 'return=representation';
  }

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`,
    {
      method: options.method || 'GET',
      headers,
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
    console.error('Supabase error:', response.status, data);

    const error = new Error(
      'تعذر الاتصال بقاعدة بيانات Supabase.'
    );
    error.status = 502;
    throw error;
  }

  return data;
}
// ===============================
// الجزء 2: الحسابات والصلاحيات
// ===============================

function normalizeUsername(username) {
  return String(username || '').trim();
}

function publicUser(user) {
  const premiumUntil = user.premium_until || null;
  const isPermanent = Boolean(user.premium) && !premiumUntil;

  const premiumActive =
    Boolean(user.premium) &&
    (isPermanent || new Date(premiumUntil).getTime() > Date.now());

  return {
    id: user.id || null,
    username: user.username,
    role: user.role || 'user',
    premium: premiumActive,
    premiumUntil: premiumActive ? premiumUntil : null,
    createdAt: user.created_at || null
  };
}

async function findUserByUsername(username) {
  const query =
    `username=ilike.${encodeURIComponent(username)}&select=*&limit=1`;

  const rows = await supabaseRequest('users', query);

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function findUserById(id) {
  if (!id) return null;

  const query =
    `id=eq.${encodeURIComponent(id)}&select=*&limit=1`;

  const rows = await supabaseRequest('users', query);

  return Array.isArray(rows) ? rows[0] || null : null;
}

async function logActivity(username, action, details = '') {
  try {
    await supabaseRequest('activity', '', {
      method: 'POST',
      body: {
        username: String(username || 'غير معروف'),
        action: String(action || ''),
        details: String(details || '')
      }
    });
  } catch (error) {
    console.error('Activity logging failed:', error.message);
  }
}

async function currentUser(req) {
  if (req.session?.isOwner) {
    return {
      id: null,
      username: OWNER_USERNAME,
      role: 'owner',
      premium: true,
      premiumUntil: null,
      createdAt: null
    };
  }

  const userId = req.session?.userId;

  if (!userId) return null;

  const user = await findUserById(userId);

  if (!user) {
    req.session.userId = null;
    req.session.username = null;
    req.session.role = null;
    return null;
  }

  const result = publicUser(user);

  // تحديث حالة البريميوم إذا انتهت مدته
  if (user.premium && !result.premium) {
    await supabaseRequest(
      'users',
      `id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'PATCH',
        body: {
          premium: false,
          premium_until: null
        }
      }
    );
  }

  return result;
}

async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'يرجى تسجيل الدخول أولاً.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

async function requireOwner(req, res, next) {
  try {
    const user = await currentUser(req);

    if (!user || user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'هذه الصلاحية للمالك فقط.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

// معلومات الحساب الحالي
app.get('/api/auth/me', async (req, res, next) => {
  try {
    const user = await currentUser(req);

    res.json({
      success: true,
      user: user || null
    });
  } catch (error) {
    next(error);
  }
});

// إنشاء حساب جديد
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 40) {
      return res.status(400).json({
        success: false,
        message: 'اسم الحساب لازم يكون من 3 إلى 40 حرفاً.'
      });
    }

    if (password.length < 8 || password.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور لازم تكون 8 أحرف على الأقل.'
      });
    }

    if (
      username.toLowerCase() === OWNER_USERNAME.trim().toLowerCase()
    ) {
      return res.status(409).json({
        success: false,
        message: 'اسم الحساب محجوز.'
      });
    }

    const existingUser = await findUserByUsername(username);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'اسم الحساب مستخدم مسبقاً.'
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const created = await supabaseRequest('users', 'select=*', {
      method: 'POST',
      returnRepresentation: true,
      body: {
        username,
        password_hash: passwordHash,
        role: 'user',
        premium: false,
        premium_until: null
      }
    });

    const user = Array.isArray(created) ? created[0] : null;

    if (!user) {
      throw new Error('لم يتم إرجاع بيانات الحساب الجديد.');
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    await logActivity(username, 'register', 'إنشاء حساب جديد');

    req.session.save((sessionError) => {
      if (sessionError) return next(sessionError);

      res.status(201).json({
        success: true,
        message: 'تم إنشاء الحساب بنجاح.',
        user: publicUser(user)
      });
    });
  } catch (error) {
    if (error.status) return next(error);

    if (error.message?.includes('duplicate key')) {
      return res.status(409).json({
        success: false,
        message: 'اسم الحساب مستخدم مسبقاً.'
      });
    }

    next(error);
  }
});

// تسجيل الدخول
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'اكتب اسم الحساب وكلمة المرور.'
      });
    }

    // دخول المالك من متغيرات البيئة
    if (
      username.toLowerCase() === OWNER_USERNAME.trim().toLowerCase() &&
      OWNER_PASSWORD &&
      password === OWNER_PASSWORD
    ) {
      req.session.isOwner = true;
      req.session.userId = null;
      req.session.username = OWNER_USERNAME;
      req.session.role = 'owner';

      await logActivity(OWNER_USERNAME, 'login', 'دخول المالك');

      return req.session.save((sessionError) => {
        if (sessionError) return next(sessionError);

        res.json({
          success: true,
          message: 'تم تسجيل دخول المالك.',
          user: {
            id: null,
            username: OWNER_USERNAME,
            role: 'owner',
            premium: true,
            premiumUntil: null,
            createdAt: null
          }
        });
      });
    }

    const user = await findUserByUsername(username);

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        success: false,
        message: 'اسم الحساب أو كلمة المرور غير صحيحة.'
      });
    }

    req.session.isOwner = false;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;

    await logActivity(user.username, 'login', 'تسجيل دخول');

    req.session.save((sessionError) => {
      if (sessionError) return next(sessionError);

      res.json({
        success: true,
        message: 'تم تسجيل الدخول بنجاح.',
        user: publicUser(user)
      });
    });
  } catch (error) {
    next(error);
  }
});

// تسجيل الخروج
app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const username = req.session?.username || 'غير معروف';

    await logActivity(username, 'logout', 'تسجيل خروج');

    req.session.destroy((error) => {
      if (error) return next(error);

      res.clearCookie('iraqstudy.sid');

      res.json({
        success: true,
        message: 'تم تسجيل الخروج.'
      });
    });
  } catch (error) {
    next(error);
  }
});
// ===============================
// الجزء 3: البريميوم ولوحة المالك
// ===============================

// تفعيل كود بريميوم
app.post('/api/premium/redeem', requireAuth, async (req, res, next) => {
  let claimedCode = null;

  try {
    if (req.user.role === 'owner') {
      return res.json({
        success: true,
        message: 'حساب المالك لديه جميع الصلاحيات.',
        durationText: 'دائم',
        premiumUntil: null
      });
    }

    const code = String(req.body.code || '').trim();

    if (!code) {
      return res.status(400).json({
        success: false,
        message: 'اكتب كود البريميوم أولاً.'
      });
    }

    const codeRows = await supabaseRequest(
      'premium_codes',
      `code=eq.${encodeURIComponent(code)}&select=*&limit=1`
    );

    const premiumCode = Array.isArray(codeRows)
      ? codeRows[0]
      : null;

    if (
      !premiumCode ||
      premiumCode.revoked ||
      premiumCode.used_by
    ) {
      return res.status(400).json({
        success: false,
        message: 'الكود غير صالح أو مستخدم مسبقاً.'
      });
    }

    if (
      !premiumCode.is_permanent &&
      (!Number.isInteger(Number(premiumCode.duration_days)) ||
        Number(premiumCode.duration_days) < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: 'مدة هذا الكود غير صحيحة.'
      });
    }

    const now = new Date();
    const currentlyPremium =
      req.user.premium &&
      (!req.user.premiumUntil ||
        new Date(req.user.premiumUntil).getTime() > now.getTime());

    let premiumUntil = null;

    if (!premiumCode.is_permanent) {
      const startTime = currentlyPremium && req.user.premiumUntil
        ? Math.max(now.getTime(), new Date(req.user.premiumUntil).getTime())
        : now.getTime();

      premiumUntil = new Date(
        startTime + Number(premiumCode.duration_days) * 86400000
      ).toISOString();
    }

    // حجز الكود للمستخدم الحالي حتى لا يُستخدم مرتين
    const claimTime = new Date().toISOString();

    const claimResult = await supabaseRequest(
      'premium_codes',
      `code=eq.${encodeURIComponent(code)}&used_by=is.null&revoked=eq.false&select=code`,
      {
        method: 'PATCH',
        returnRepresentation: true,
        body: {
          used_by: req.user.id,
          used_at: claimTime
        }
      }
    );

    if (!Array.isArray(claimResult) || claimResult.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'تم استخدام الكود للتو أو لم يعد متاحاً.'
      });
    }

    claimedCode = {
      code,
      userId: req.user.id,
      claimTime
    };

    try {
      await supabaseRequest(
        'users',
        `id=eq.${encodeURIComponent(req.user.id)}`,
        {
          method: 'PATCH',
          body: {
            premium: true,
            premium_until: premiumUntil
          }
        }
      );
    } catch (error) {
      // محاولة إعادة الكود إذا فشل تحديث حساب المستخدم
      try {
        await supabaseRequest(
          'premium_codes',
          `code=eq.${encodeURIComponent(code)}&used_by=eq.${encodeURIComponent(req.user.id)}&used_at=eq.${encodeURIComponent(claimTime)}`,
          {
            method: 'PATCH',
            body: {
              used_by: null,
              used_at: null
            }
          }
        );
      } catch (rollbackError) {
        console.error('Premium code rollback failed:', rollbackError.message);
      }

      claimedCode = null;
      throw error;
    }

    await logActivity(
      req.user.username,
      'premium_redeem',
      premiumCode.is_permanent
        ? 'تفعيل بريميوم دائم'
        : `تفعيل بريميوم لمدة ${premiumCode.duration_days} يوم`
    );

    res.json({
      success: true,
      message: 'تم تفعيل البريميوم بنجاح!',
      durationText: premiumCode.is_permanent
        ? 'دائم'
        : `${premiumCode.duration_days} يوم`,
      premiumUntil
    });
  } catch (error) {
    next(error);
  }
});

// جلب الحسابات للمالك
app.get('/api/admin/users', requireOwner, async (req, res, next) => {
  try {
    const rows = await supabaseRequest(
      'users',
      'select=id,username,role,premium,premium_until,created_at&order=created_at.desc'
    );

    const users = [{
      id: null,
      username: OWNER_USERNAME,
      role: 'owner',
      premium: true,
      premiumUntil: null,
      createdAt: null
    }];

    for (const user of rows || []) {
      users.push(publicUser(user));
    }

    res.json({
      success: true,
      users
    });
  } catch (error) {
    next(error);
  }
});

// جلب سجل النشاطات للمالك
app.get('/api/admin/activity', requireOwner, async (req, res, next) => {
  try {
    const rows = await supabaseRequest(
      'activity',
      'select=id,username,action,details,created_at&order=created_at.desc&limit=200'
    );

    const activity = (rows || []).map((item) => ({
      id: item.id,
      username: item.username,
      action: item.action,
      details: item.details || '',
      createdAt: item.created_at
    }));

    res.json({
      success: true,
      activity
    });
  } catch (error) {
    next(error);
  }
});

// منح البريميوم أو إلغاؤه من لوحة المالك
app.post('/api/admin/premium', requireOwner, async (req, res, next) => {
  try {
    const username = normalizeUsername(req.body.username);
    const enabled = req.body.enabled === true;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: 'اسم الحساب مطلوب.'
      });
    }

    if (
      username.toLowerCase() === OWNER_USERNAME.trim().toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        message: 'لا يمكن تغيير بريميوم حساب المالك.'
      });
    }

    const user = await findUserByUsername(username);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'الحساب غير موجود.'
      });
    }

    await supabaseRequest(
      'users',
      `id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'PATCH',
        body: enabled
          ? {
              premium: true,
              premium_until: null
            }
          : {
              premium: false,
              premium_until: null
            }
      }
    );

    await logActivity(
      OWNER_USERNAME,
      enabled ? 'premium_granted' : 'premium_revoked',
      `${username}: ${enabled ? 'منح بريميوم دائم' : 'إلغاء البريميوم'}`
    );

    res.json({
      success: true,
      message: enabled
        ? `تم منح ${username} بريميوم دائم.`
        : `تم إلغاء بريميوم ${username}.`
    });
  } catch (error) {
    next(error);
  }
});
// ===============================
// الجزء 4: الذكاء الاصطناعي وتشغيل الموقع
// ===============================

// الحصول على رمز الوصول من GigaChat
async function getGigaChatToken() {
  if (!GIGACHAT_CREDENTIALS) {
    throw new Error('إعدادات GigaChat ناقصة في إعدادات Vercel.');
  }

  const response = await fetch(
    'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${GIGACHAT_CREDENTIALS}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        RqUID: crypto.randomUUID()
      },
      body: new URLSearchParams({
        scope: GIGACHAT_SCOPE
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    console.error('GigaChat token error:', data);
    throw new Error('تعذر الاتصال بخدمة GigaChat.');
  }

  return data.access_token;
}

// حل السؤال باستخدام الذكاء الاصطناعي
app.post('/api/solve', requireAuth, async (req, res, next) => {
  try {
    const question = String(req.body.question || '').trim();
    const subject = String(req.body.subject || 'عام').trim();
    const grade = String(req.body.grade || 'غير محدد').trim();
    const mode = String(req.body.mode || 'solve').trim();

    if (!question) {
      return res.status(400).json({
        success: false,
        message: 'اكتب السؤال أولاً.'
      });
    }

    if (question.length > 12000) {
      return res.status(400).json({
        success: false,
        message: 'السؤال طويل جداً، اختصره وحاول مجدداً.'
      });
    }

    const isPremium = Boolean(req.user.premium) ||
      req.user.role === 'owner';

    const premiumModes = [
      'image',
      'simplify',
      'summarize'
    ];

    if (premiumModes.includes(mode) && !isPremium) {
      return res.status(403).json({
        success: false,
        message: 'هذه الميزة متاحة لمشتركي البريميوم فقط.',
        premiumRequired: true
      });
    }

    const token = await getGigaChatToken();

    const modeInstructions = {
      solve: 'حل السؤال بدقة وبخطوات واضحة وفق المنهج العراقي.',
      image: 'حل السؤال الدراسي الظاهر في النص المرسل. إذا لم يتضمن النص السؤال، اطلب من المستخدم كتابة محتوى الصورة.',
      simplify: 'بسّط خطوات الحل واشرح كل خطوة بلغة عربية سهلة.',
      summarize: 'لخّص الموضوع الدراسي بنقاط منظمة مع أهم التعاريف والقوانين.'
    };

    const instruction = modeInstructions[mode] || modeInstructions.solve;

    const response = await fetch(
      'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                'أنت مساعد StudyAI-Iraq، مختص بمساعدة الطلاب في المنهج العراقي. ' +
                'أجب بالعربية الواضحة، وتحقق من الحسابات والمعلومات. ' +
                'لا تخترع معلومات أو أرقام صفحات. إذا كانت المعطيات غير كافية، وضّح ذلك. ' +
                'التزم بطلب المستخدم التالي: ' + instruction
            },
            {
              role: 'user',
              content:
                `المادة: ${subject}\n` +
                `الصف: ${grade}\n` +
                `السؤال أو الموضوع:\n${question}`
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('GigaChat completion error:', data);
      throw new Error('تعذر الحصول على إجابة من الذكاء الاصطناعي.');
    }

    const answer = data.choices?.[0]?.message?.content;

    if (!answer) {
      throw new Error('وصل رد فارغ من الذكاء الاصطناعي.');
    }

    await logActivity(
      req.user.username,
      'solve',
      `المادة: ${subject} | الصف: ${grade} | الوضع: ${mode}`
    );

    res.json({
      success: true,
      answer
    });
  } catch (error) {
    next(error);
  }
});

// الصفحة الرئيسية والملفات الثابتة
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// التعامل مع الأخطاء
app.use((error, req, res, next) => {
  console.error('Server error:', error.message);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error.status || 500).json({
    success: false,
    message: error.status
      ? error.message
      : 'حدث خطأ في الخادم. حاول مرة أخرى.'
  });
});

// تشغيل محلي، مع التصدير لدوال Vercel
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`StudyAI-Iraq running on port ${PORT}`);
  });
}

module.exports = app;