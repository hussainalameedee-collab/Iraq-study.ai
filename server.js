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

app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(session({ name:'iraqstudy.sid', secret:SESSION_SECRET, resave:false, saveUninitialized:false, cookie:{ httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV === 'production', maxAge:7*24*60*60*1000 } }));
app.get('/', (_req,res) => res.sendFile(path.join(__dirname,'index.html')));
app.get('/index.html', (_req,res) => res.sendFile(path.join(__dirname,'index.html')));
app.get('/style.css', (_req,res) => { res.type('text/css'); res.sendFile(path.join(__dirname,'style.css')); });
app.get('/app.js', (_req,res) => { res.type('application/javascript'); res.sendFile(path.join(__dirname,'app.js')); });

let db = { users: [], activity: [] };
function loadDb() {
  try { if (fs.existsSync(DATA_FILE)) { const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); db = { users:Array.isArray(parsed.users)?parsed.users:[], activity:Array.isArray(parsed.activity)?parsed.activity:[] }; } }
  catch (err) { console.error('Could not read data file:', err.message); }
}
function saveDb() {
  try { fs.mkdirSync(path.dirname(path.resolve(DATA_FILE)), { recursive:true }); const temp = `${DATA_FILE}.tmp`; fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode:0o600 }); fs.renameSync(temp, DATA_FILE); }
  catch (err) { console.error('Could not save data file:', err.message); throw new Error('تعذر حفظ البيانات على الخادم. تحقق من إعدادات التخزين.'); }
}
function logActivity(username, action, details='') {
  db.activity.unshift({ id:crypto.randomUUID(), username, action, details, createdAt:new Date().toISOString() });
  db.activity = db.activity.slice(0, 500);
  try { saveDb(); } catch (e) { console.error(e.message); }
}
function publicUser(user) {
  const premiumActive = !!user && !!user.premium && (!user.premiumUntil || new Date(user.premiumUntil).getTime() > Date.now());
  if (user?.role === 'owner') return { username:OWNER_USERNAME, role:'owner', premium:true, premiumUntil:null };
  return { username:user.username, role:'user', premium:premiumActive, premiumUntil:premiumActive ? user.premiumUntil : null };
}
function currentUser(req) {
  if (req.session?.user?.role === 'owner') return { username:OWNER_USERNAME, role:'owner', premium:true, premiumUntil:null };
  if (!req.session?.user?.username) return null;
  const user = db.users.find(u => u.username.toLowerCase() === req.session.user.username.toLowerCase());
  if (!user) return null;
  if (user.premium && user.premiumUntil && new Date(user.premiumUntil).getTime() <= Date.now()) { user.premium = false; user.premiumUntil = null; try { saveDb(); } catch {} }
  return publicUser(user);
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error:'سجّل الدخول أولاً حتى تكمل.' });
  req.user = user; next();
}
function requireOwner(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== 'owner') return res.status(403).json({ error:'هذه الميزة مخصصة للـ Owner فقط.' });
  req.user = user; next();
}
function cleanUsername(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
function validUsername(name) { return name.length >= 3 && name.length <= 30 && !/[<>]/.test(name); }

loadDb();
if (!OWNER_PASSWORD) console.warn('OWNER_PASSWORD is not set. Owner login is disabled until configured in hosting environment.');

app.get('/api/health', (_req,res) => res.json({ ok:true, service:'iraq-study-ai' }));
app.get('/api/auth/me', (req,res) => res.json({ user:currentUser(req) }));
app.post('/api/auth/register', async (req,res) => {
  try {
    const username = cleanUsername(req.body?.username); const password = String(req.body?.password || '');
    if (!validUsername(username)) return res.status(400).json({ error:'اسم المستخدم لازم يكون بين 3 و30 حرفاً.' });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error:'كلمة المرور لازم تكون 8 أحرف على الأقل.' });
    if (username.toLowerCase() === OWNER_USERNAME.toLowerCase()) return res.status(409).json({ error:'اسم المستخدم هذا محجوز للـ Owner.' });
    if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(409).json({ error:'اسم المستخدم مستخدم بالفعل. اختَر اسماً آخر.' });
    const user = { id:crypto.randomUUID(), username, passwordHash:await bcrypt.hash(password, 12), role:'user', premium:false, premiumUntil:null, createdAt:new Date().toISOString() };
    db.users.push(user); saveDb(); req.session.user = { username:user.username, role:'user' }; logActivity(username,'إنشاء حساب');
    res.status(201).json({ user:publicUser(user) });
  } catch (e) { res.status(500).json({ error:e.message || 'تعذر إنشاء الحساب.' }); }
});
app.post('/api/auth/login', async (req,res) => {
  try {
    const username = cleanUsername(req.body?.username); const password = String(req.body?.password || '');
    if (username.toLowerCase() === OWNER_USERNAME.toLowerCase()) {
      if (!OWNER_PASSWORD) return res.status(503).json({ error:'حساب الـ Owner غير مهيّأ بعد. أضف OWNER_PASSWORD في إعدادات الخادم.' });
      if (password !== OWNER_PASSWORD) { logActivity(username,'محاولة دخول Owner فاشلة'); return res.status(401).json({ error:'اسم المستخدم أو كلمة المرور غير صحيحة.' }); }
      req.session.user = { username:OWNER_USERNAME, role:'owner' }; logActivity(OWNER_USERNAME,'تسجيل دخول Owner'); return res.json({ user:publicUser({ role:'owner' }) });
    }
    const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) { logActivity(username || 'غير معروف','محاولة تسجيل دخول فاشلة'); return res.status(401).json({ error:'اسم المستخدم أو كلمة المرور غير صحيحة.' }); }
    req.session.user = { username:user.username, role:'user' }; logActivity(user.username,'تسجيل دخول'); res.json({ user:publicUser(user) });
  } catch (e) { res.status(500).json({ error:'حدث خطأ أثناء تسجيل الدخول.' }); }
});
app.post('/api/auth/logout', (req,res) => { const name = currentUser(req)?.username || 'مستخدم'; if (req.session) req.session.destroy(() => {}); logActivity(name,'تسجيل خروج'); res.json({ ok:true }); });

app.get('/api/admin/users', requireOwner, (_req,res) => {
  const users = db.users.map(u => ({ username:u.username, role:'user', premium:!!u.premium && (!u.premiumUntil || new Date(u.premiumUntil).getTime()>Date.now()), premiumUntil:u.premiumUntil, createdAt:u.createdAt }));
  if (OWNER_PASSWORD) users.unshift({ username:OWNER_USERNAME, role:'owner', premium:true, premiumUntil:null, createdAt:null });
  res.json({ users });
});
app.get('/api/admin/activity', requireOwner, (_req,res) => res.json({ activity:db.activity.slice(0,100) }));
app.post('/api/admin/premium', requireOwner, (req,res) => {
  const username = cleanUsername(req.body?.username);
  if (!username || username.toLowerCase() === OWNER_USERNAME.toLowerCase()) return res.status(400).json({ error:'اكتب اسم مستخدم صحيحاً. حساب الـ Owner لديه كل الصلاحيات.' });
  const user = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(404).json({ error:'ما لكيت حساب بهذا الاسم.' });
  if (req.body?.revoke) { user.premium = false; user.premiumUntil = null; saveDb(); logActivity(OWNER_USERNAME,'سحب Premium',user.username); return res.json({ message:`تم سحب Premium من ${user.username}.` }); }
  const days = Number(req.body?.days);
  if (!Number.isInteger(days) || days < 0 || days > 3650) return res.status(400).json({ error:'اختَر مدة صحيحة.' });
  user.premium = true; user.premiumUntil = days === 0 ? null : new Date(Date.now() + days*24*60*60*1000).toISOString();
  saveDb(); logActivity(OWNER_USERNAME,'منح Premium',`${user.username} · ${days === 0 ? 'دائم' : `${days} يوم`}`);
  res.json({ message:`تم منح Premium إلى ${user.username}${days === 0 ? ' بشكل دائم' : ` لمدة ${days} يوم`}.` });
});

let cachedToken = null, tokenExpiresAt = 0;
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;
  if (!GIGACHAT_CREDENTIALS) { const err = new Error('الذكاء الاصطناعي غير مربوط بعد. أضف GIGACHAT_CREDENTIALS في إعدادات الخادم.'); err.status = 503; throw err; }
  const response = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', { method:'POST', headers:{ Authorization:`Bearer ${GIGACHAT_CREDENTIALS}`, RqUID:crypto.randomUUID(), 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({ scope:GIGACHAT_SCOPE }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) { console.error('GigaChat token error:',response.status,JSON.stringify(data)); const err = new Error('تعذر الاتصال بخدمة الذكاء الاصطناعي. تحقق من بيانات GigaChat وصلاحية الحساب.'); err.status=502; throw err; }
  cachedToken = data.access_token; tokenExpiresAt = Date.now() + 25*60*1000; return cachedToken;
}
app.post('/api/solve', requireAuth, async (req,res) => {
  try {
    const { grade, subject, page, questionNumber, task, mode } = req.body || {};
    if (!grade || !subject || !String(task || '').trim()) return res.status(400).json({ error:'اكتب الصف والمادة ونص السؤال أو الموضوع.' });
    if (String(task).length > 12000) return res.status(413).json({ error:'النص طويل جداً. اختصر السؤال وحاول مرة أخرى.' });
    const token = await getAccessToken();
    const systemPrompt = `أنت مساعد تعليمي متخصص بمساعدة الطلاب في المنهج العراقي. أجب باللغة العربية الواضحة وبأسلوب مناسب للصف. لا تخترع نصاً من كتاب أو رقم صفحة، ولا تدّعِ أنك تحققت من كتاب رسمي إذا لم يُرفق نصه. إذا كان السؤال ناقصاً، اطلب توضيحاً. للحل: اكتب الخطوات بالتسلسل ثم الجواب النهائي. للتلخيص: استخدم عناوين ونقاطاً وغطِّ الأفكار والتعاريف والقوانين المهمة. كن دقيقاً ولا تخمّن.`;
    const userPrompt = `الصف: ${grade}\nالمادة: ${subject}\nالصفحة: ${page || 'غير محددة'}\nرقم السؤال: ${questionNumber || 'غير محدد'}\nالطلب: ${mode === 'summary' ? 'تلخيص موضوع' : 'حل نموذجي مشروح'}\nنص السؤال أو الموضوع:\n${String(task).trim()}`;
    const response = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json', Accept:'application/json' }, body:JSON.stringify({ model:MODEL, temperature:0.2, messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}] }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { console.error('GigaChat completion error:',response.status,JSON.stringify(data)); return res.status(502).json({ error:'خدمة الذكاء الاصطناعي لم تكمل الطلب. تحقق من صلاحية الحساب واسم النموذج.' }); }
    const answer = data.choices?.[0]?.message?.content;
    if (!answer) return res.status(502).json({ error:'وصل رد فارغ من خدمة الذكاء الاصطناعي. حاول مرة أخرى.' });
    logActivity(req.user.username, mode === 'summary' ? 'طلب تلخيص' : 'طلب حل', `${subject} · ${grade}`);
    res.json({ answer });
  } catch (err) { console.error(err); res.status(err.status || 500).json({ error:err.message || 'حدث خطأ غير متوقع.' }); }
});
app.get('*', (_req,res) => res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT, () => console.log(`iraq study .ai running on port ${PORT}`));
