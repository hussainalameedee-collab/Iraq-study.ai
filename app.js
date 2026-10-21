const $ = (id) => document.getElementById(id);
const API = '';
let authMode = 'login';
let currentUser = null;
let toastTimer;

function showToast(message) {
  const el = $('toast'); el.textContent = message; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}
function openModal(id) { $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).classList.add('hidden'); if (![...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'))) document.body.style.overflow = ''; }
async function api(url, options = {}) {
  const response = await fetch(`${API}${url}`, { credentials: 'same-origin', ...options, headers: { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'حدث خطأ. حاول مرة ثانية.');
  return data;
}
function authOpen(mode = 'login') {
  setAuthMode(mode); $('authError').textContent = ''; $('authPassword').value = ''; openModal('authModal');
}
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('[data-auth-mode]').forEach(b => b.classList.toggle('active', b.dataset.authMode === mode));
  $('authTitle').textContent = mode === 'login' ? 'أهلاً بيك' : 'أنشئ حسابك';
  $('authSubmit').textContent = mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authPassword').placeholder = mode === 'login' ? 'كلمة المرور' : '8 أحرف أو أكثر';
}
function renderUser(user) {
  currentUser = user;
  $('authOpen').classList.toggle('hidden', !!user);
  $('accountBadge').classList.toggle('hidden', !user);
  if (user) $('accountBadge').textContent = (user.username || 'ح').trim().slice(0,1);
  if (!user) return;
  $('accountDetails').innerHTML = `<div>اسم الحساب: <strong>${escapeHtml(user.username)}</strong></div><div style="margin-top:7px">الصلاحية: <strong>${user.role === 'owner' ? 'Owner' : 'مستخدم'}</strong></div><div style="margin-top:7px">حالة Premium: <strong class="${user.premium ? 'status-premium':'status-free'}">${user.role === 'owner' ? 'صلاحيات كاملة' : user.premium ? `مفعّل${user.premiumUntil ? ` لغاية ${new Date(user.premiumUntil).toLocaleDateString('ar')}` : ''}` : 'مجاني'}</strong></div>`;
  $('ownerTools').classList.toggle('hidden', user.role !== 'owner');
  if (user.role === 'owner') loadAdmin();
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function loadMe() {
  try { const data = await api('/api/auth/me'); renderUser(data.user || null); }
  catch { renderUser(null); }
}
async function loadAdmin() {
  try {
    const [usersData, activityData] = await Promise.all([api('/api/admin/users'), api('/api/admin/activity')]);
    const users = usersData.users || [], activity = activityData.activity || [];
    $('statUsers').textContent = users.length;
    $('statPremium').textContent = users.filter(u => u.premium).length;
    $('statActivity').textContent = activity.length;
    $('usersList').innerHTML = users.length ? users.map(u => `<div class="user-item"><strong>${escapeHtml(u.username)}</strong><span>${u.role === 'owner' ? 'Owner' : u.premium ? 'Premium' : 'مجاني'}</span></div>`).join('') : 'لا توجد حسابات بعد.';
    $('activityList').innerHTML = activity.length ? activity.slice(0,35).map(a => `<div class="activity-item"><span>${escapeHtml(a.username)} · ${escapeHtml(a.action)}</span><span>${escapeHtml(new Date(a.createdAt).toLocaleString('ar'))}</span></div>`).join('') : 'لا توجد نشاطات بعد.';
  } catch (e) { $('activityList').textContent = e.message; $('usersList').textContent = e.message; }
}

$('getPremium').addEventListener('click', () => openModal('premiumModal'));
$('authOpen').addEventListener('click', () => authOpen('login'));
$('footerLogin').addEventListener('click', () => authOpen('login'));
$('accountBadge').addEventListener('click', () => { if (currentUser) { renderUser(currentUser); openModal('accountModal'); } });
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.close)));
document.querySelectorAll('[data-auth-mode]').forEach(el => el.addEventListener('click', () => setAuthMode(el.dataset.authMode)));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal:not(.hidden)').forEach(m => closeModal(m.id)); });

$('authForm').addEventListener('submit', async e => {
  e.preventDefault(); $('authError').textContent = '';
  const username = $('authUsername').value.trim(); const password = $('authPassword').value;
  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  $('authSubmit').disabled = true;
  try {
    const data = await api(endpoint, { method:'POST', body: JSON.stringify({ username, password }) });
    renderUser(data.user); closeModal('authModal'); showToast(authMode === 'login' ? 'تم تسجيل الدخول بنجاح.' : 'تم إنشاء حسابك بنجاح.');
    if (currentUser?.role === 'owner') { renderUser(currentUser); openModal('accountModal'); }
  } catch (err) { $('authError').textContent = err.message; }
  finally { $('authSubmit').disabled = false; }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method:'POST', body: JSON.stringify({}) }); }
  catch (e) { showToast(e.message); }
  renderUser(null); closeModal('accountModal'); showToast('تم تسجيل الخروج.');
});

$('premiumForm').addEventListener('submit', async e => {
  e.preventDefault(); $('premiumFeedback').textContent = '';
  try {
    const data = await api('/api/admin/premium', { method:'POST', body: JSON.stringify({ username: $('premiumUsername').value.trim(), days: Number($('premiumDuration').value) }) });
    $('premiumFeedback').textContent = data.message || 'تم تحديث Premium.'; await loadAdmin();
  } catch (err) { $('premiumFeedback').textContent = err.message; }
});
$('revokePremium').addEventListener('click', async () => {
  $('premiumFeedback').textContent = '';
  try {
    const data = await api('/api/admin/premium', { method:'POST', body: JSON.stringify({ username: $('premiumUsername').value.trim(), revoke: true }) });
    $('premiumFeedback').textContent = data.message || 'تم سحب Premium.'; await loadAdmin();
  } catch (err) { $('premiumFeedback').textContent = err.message; }
});

$('studyForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser) { showToast('سجّل الدخول أولاً حتى تستخدم المساعد.'); authOpen('login'); return; }
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const payload = { grade:$('grade').value, subject:$('subject').value, page:$('page').value.trim(), questionNumber:$('questionNumber').value.trim(), task:$('task').value.trim(), mode };
  const btn = $('submitBtn'); btn.disabled = true; btn.innerHTML = '<span>◌</span> جاري تجهيز الإجابة...'; $('result').classList.remove('hidden'); $('answer').textContent = 'لحظة، نجهّز الرد...';
  try { const data = await api('/api/solve', { method:'POST', body:JSON.stringify(payload) }); $('answer').textContent = data.answer; }
  catch (err) { $('answer').textContent = `${err.message}\n\nإذا لم تُضف بيانات خدمة الذكاء الاصطناعي في إعدادات الخادم، فلن تعمل الإجابات حتى إضافتها.`; }
  finally { btn.disabled = false; btn.innerHTML = '<span>✦</span> ابدأ الحل <b>←</b>'; }
});
$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('answer').innerText); $('copyBtn').textContent = 'تم النسخ ✓'; setTimeout(() => $('copyBtn').textContent = 'نسخ الإجابة', 1500); }
  catch { showToast('اضغط مطولاً على النص لنسخه.'); }
});
loadMe();
