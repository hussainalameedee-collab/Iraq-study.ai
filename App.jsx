import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000';
const subjects = ['اللغة العربية','اللغة الإنجليزية','الرياضيات','الفيزياء','الكيمياء','الأحياء','الاجتماعيات','التربية الإسلامية'];

async function request(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : {'Content-Type':'application/json'},
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ، حاول مرة أخرى');
  return data;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [question, setQuestion] = useState('');
  const [grade, setGrade] = useState('السادس الإعدادي');
  const [subject, setSubject] = useState('الرياضيات');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState([]);
  const [target, setTarget] = useState('');
  const [days, setDays] = useState(30);
  const [activity, setActivity] = useState([]);
  const [ownerOpen, setOwnerOpen] = useState(false);

  async function refreshMe() {
    try { const d = await request('/api/me'); setUser(d.user); }
    catch { setUser(null); }
  }
  useEffect(() => { refreshMe(); }, []);

  async function auth(e) {
    e.preventDefault(); setMessage('');
    try {
      if (mode === 'register') await request('/api/register', {username, password});
      const data = await request('/api/login', {username, password});
      setUser(data.user); setMessage('تم تسجيل الدخول بنجاح');
    } catch (err) { setMessage(err.message); }
  }
  async function logout() {
    try { await request('/api/logout', {}); } catch {}
    setUser(null); setAnswer(''); setMessage('تم تسجيل الخروج');
  }
  async function ask(e) {
    e.preventDefault(); setBusy(true); setMessage(''); setAnswer('');
    try {
      const d = await request('/api/ask', {question, grade, subject});
      setAnswer(d.answer || 'لم تصل إجابة.'); 
      if (d.sources?.length) setAnswer(v => `${v}\n\nالمصادر:\n${d.sources.map(s => s.title || s.url).join('\n')}`);
    } catch (err) { setMessage(err.message); }
    finally { setBusy(false); }
  }
  async function loadOwner() {
    try {
      const [u,a] = await Promise.all([request('/api/owner/users'), request('/api/owner/activity')]);
      setUsers(u.users); setActivity(a.activity); setOwnerOpen(true);
    } catch (err) { setMessage(err.message); }
  }
  async function premium(action) {
    try {
      const d = await request('/api/owner/premium', {username:target, action, days:Number(days)});
      setMessage(d.message); await loadOwner();
    } catch (err) { setMessage(err.message); }
  }

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">✳</span><div><h1>iraq study <em>.ai</em></h1><p>مساعدك الدراسي للمنهج العراقي</p></div></div>
      {user && <div className="userbar"><span>{user.username}</span><span className={user.premium ? 'premium-pill' : 'free-pill'}>{user.role === 'owner' ? 'OWNER' : user.premium ? 'PREMIUM' : 'FREE'}</span><button className="ghost small" onClick={logout}>خروج</button></div>}
    </header>

    {!user ? <section className="auth-card panel">
      <div className="eyebrow">مساحة تعلّم ذكية</div><h2>{mode === 'login' ? 'أهلاً بعودتك' : 'أنشئ حسابك'}</h2>
      <p className="muted">دخول بسيط باسم مستخدم وكلمة مرور، بدون بريد إلكتروني.</p>
      <form onSubmit={auth} className="stack">
        <label>اسم المستخدم<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" minLength={3} required placeholder="اكتب اسم المستخدم"/></label>
        <label>كلمة المرور<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode==='login'?'current-password':'new-password'} minLength={8} required placeholder="8 أحرف على الأقل"/></label>
        <button className="primary" type="submit">{mode==='login'?'تسجيل الدخول':'إنشاء الحساب'}</button>
      </form>
      <button className="text-button" onClick={()=>{setMode(mode==='login'?'register':'login');setMessage('')}}>{mode==='login'?'ليس لديك حساب؟ أنشئ حساباً':'لديك حساب؟ سجّل الدخول'}</button>
      {message && <p className="notice">{message}</p>}
    </section> : <>
      <section className="hero">
        <div><div className="eyebrow">STUDY SMARTER</div><h2>خلّ نفهم السؤال، <span>مو بس نحلّه.</span></h2><p>حلول مرتبة خطوة بخطوة، مع مساحة لإضافة المصادر الرسمية والشرح التعليمي.</p></div>
        <div className="hero-orb"><span>ع</span><i></i></div>
      </section>
      <section className="workspace">
        <form className="panel question-panel" onSubmit={ask}>
          <div className="section-heading"><div><div className="eyebrow">المساعد الدراسي</div><h3>شنو سؤالك اليوم؟</h3></div><span className="status-dot">متصل</span></div>
          <div className="selectors">
            <label>الصف<select value={grade} onChange={e=>setGrade(e.target.value)}>{['الأول المتوسط','الثاني المتوسط','الثالث المتوسط','الرابع الإعدادي','الخامس الإعدادي','السادس الإعدادي'].map(x=><option key={x}>{x}</option>)}</select></label>
            <label>المادة<select value={subject} onChange={e=>setSubject(e.target.value)}>{subjects.map(x=><option key={x}>{x}</option>)}</select></label>
          </div>
          <label>السؤال<textarea value={question} onChange={e=>setQuestion(e.target.value)} required rows={5} placeholder="اكتب السؤال هنا، واذكر المطلوب إذا تحتاج شرحاً معيناً..."/></label>
          <div className="submit-row"><span className="muted tiny">يفضّل ذكر رقم الفصل أو الموضوع</span><button className="primary" disabled={busy}>{busy?'جاري التفكير…':'حل السؤال ←'}</button></div>
          {message && <p className="notice">{message}</p>}
          {answer && <div className="answer"><div className="answer-title">✦ الإجابة</div><p>{answer}</p></div>}
        </form>
        <aside className="side-column">
          <div className="panel feature-card"><div className="feature-icon blue">▧</div><h3>حل من صورة</h3><p>صوّر السؤال أو ارفع صورة واضحة من الكتاب.</p><button className="secondary" onClick={()=>setMessage(user.premium?'صلاحية Premium فعّالة؛ يلزم ربط مزود يدعم تحليل الصور.':'ميزة Premium — تحتاج ترقية حسابك لتستخدم تصوير الأسئلة.')}>فتح الميزة <span>↗</span></button><span className="feature-tag">PREMIUM</span></div>
          <div className="panel feature-card"><div className="feature-icon gold">◎</div><h3>مصادر موثوقة</h3><p>بحث عن شرح إضافي من الكتب والفيديوهات التعليمية.</p><a className="secondary link-button" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${grade} ${subject} شرح المنهج العراقي`)}`} target="_blank" rel="noreferrer">ابحث في YouTube ↗</a><span className="feature-tag neutral">مصادر تعليمية</span></div>
          {user.role==='owner' && <div className="panel owner-card"><div><div className="eyebrow">CONTROL CENTER</div><h3>لوحة المالك</h3><p className="muted">إدارة الحسابات ومدة Premium.</p></div><button className="primary" onClick={loadOwner}>فتح لوحة التحكم</button></div>}
        </aside>
      </section>
      {ownerOpen && user.role==='owner' && <section className="panel owner-panel">
        <div className="section-heading"><div><div className="eyebrow">OWNER ONLY</div><h3>إدارة الحسابات وPremium</h3></div><button className="ghost" onClick={()=>setOwnerOpen(false)}>إغلاق</button></div>
        <div className="premium-form">
          <label>اسم المستخدم<input value={target} onChange={e=>setTarget(e.target.value)} placeholder="اسم الحساب المستهدف"/></label>
          <label>مدة Premium بالأيام<input type="number" min="1" max="3650" value={days} onChange={e=>setDays(e.target.value)}/></label>
          <button className="primary" onClick={()=>premium('grant')}>منح Premium</button><button className="danger" onClick={()=>premium('revoke')}>سحب Premium</button>
        </div>
        <h4>الحسابات</h4><div className="table-wrap"><table><thead><tr><th>المستخدم</th><th>النوع</th><th>Premium</th><th>ينتهي في</th></tr></thead><tbody>{users.map(u=><tr key={u.username}><td>{u.username}</td><td>{u.role}</td><td>{u.premium?'فعّال':'غير فعّال'}</td><td>{u.premium_until?new Date(u.premium_until).toLocaleString():'—'}</td></tr>)}</tbody></table></div>
        <h4>آخر النشاطات</h4><div className="activity-list">{activity.slice(0,12).map((a,i)=><div className="activity-row" key={i}><b>{a.username}</b><span>{a.action} {a.details}</span><time>{new Date(a.created_at).toLocaleString()}</time></div>)}</div>
      </section>}
    </>}
    <footer>iraq study <em>.ai</em><span>صُمّم للتعلّم والفهم</span></footer>
  </main>;
}
