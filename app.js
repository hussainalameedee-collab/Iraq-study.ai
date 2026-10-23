const $ = (id) => document.getElementById(id);
const API = '';
let authMode = 'login';
let currentUser = null;
let toastTimer;

function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function openModal(id) {
  $(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  $(id).classList.add('hidden');
  if (![...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'))) {
    document.body.style.overflow = '';
  }
}

async function api(url, options = {}) {
  const response = await fetch(`${API}${url}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || data.message || 'حدث خطأ. حاول مرة ثانية.');
  }

  return data;
}

function authOpen(mode = 'login') {
  setAuthMode(mode);
  $('authError').textContent = '';
  $('authPassword').value = '';
  openModal('authModal');
}

function setAuthMode(mode) {
  authMode = mode;

  document.querySelectorAll('[data-auth-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.authMode === mode);
  });

  $('authTitle').textContent = mode === 'login' ? 'أهلاً بيك' : 'أنشئ حسابك';
  $('authSubmit').textContent = mode === 'login' ? 'تسجيل الدخول' : 'إنشاء حساب';
  $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authPassword').placeholder = mode === 'login' ? 'كلمة المرور' : '8 أحرف أو أكثر';
}

function renderUser(user) {
  currentUser = user;

  $('authOpen').classList.toggle('hidden', !!user);
  $('accountBadge').classList.toggle('hidden', !user);

  if (user) {
    $('accountBadge').textContent = (user.username || 'ح').trim().slice(0, 1);
  }

  if (!user) return;

  $('accountDetails').innerHTML = `
    <div>اسم الحساب: <strong>${escapeHtml(user.username)}</strong></div>
    <div style="margin-top:7px">الصلاحية: <strong>${user.role === 'owner' ? 'Owner' : 'مستخدم'}</strong></div>
    <div style="margin-top:7px">حالة Premium:
      <strong class="${user.premium ? 'status-premium' : 'status-free'}">
        ${user.role === 'owner' ? 'صلاحيات كاملة' : user.premium ? `مفعّل${user.premiumUntil ? ` لغاية ${new Date(user.premiumUntil).toLocaleDateString('ar')}` : ''}` : 'مجاني'}
      </strong>
    </div>`;

  $('ownerTools').classList.toggle('hidden', user.role !== 'owner');

  if (user.role === 'owner') loadAdmin();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

async function loadMe() {
  try {
    const data = await api('/api/auth/me');
    renderUser(data.user || null);
  } catch {
    renderUser(null);
  }
}

async function loadAdmin() {
  try {
    const [usersData, activityData] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/activity')
    ]);

    const users = usersData.users || [];
    const activity = activityData.activity || [];

    $('statUsers').textContent = users.length;
    $('statPremium').textContent = users.filter(user => user.premium).length;
    $('statActivity').textContent = activity.length;

    $('usersList').innerHTML = users.length
      ? users.map(user => `
          <div class="user-item">
            <strong>${escapeHtml(user.username)}</strong>
            <span>${user.role === 'owner' ? 'Owner' : user.premium ? 'Premium' : 'مجاني'}</span>
          </div>`).join('')
      : 'لا توجد حسابات بعد.';

    $('activityList').innerHTML = activity.length
      ? activity.slice(0, 35).map(item => `
          <div class="activity-item">
            <span>${escapeHtml(item.username)} · ${escapeHtml(item.action)}</span>
            <span>${escapeHtml(new Date(item.createdAt).toLocaleString('ar'))}</span>
          </div>`).join('')
      : 'لا توجد نشاطات بعد.';
  } catch (error) {
    $('activityList').textContent = error.message;
    $('usersList').textContent = error.message;
  }
}

$('getPremium').addEventListener('click', () => openModal('premiumModal'));
$('authOpen').addEventListener('click', () => authOpen('login'));
$('footerLogin').addEventListener('click', () => authOpen('login'));

$('accountBadge').addEventListener('click', () => {
  if (currentUser) {
    renderUser(currentUser);
    openModal('accountModal');
  }
});

document.querySelectorAll('[data-close]').forEach(element => {
  element.addEventListener('click', () => closeModal(element.dataset.close));
});

document.querySelectorAll('[data-auth-mode]').forEach(element => {
  element.addEventListener('click', () => setAuthMode(element.dataset.authMode));
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.modal:not(.hidden)').forEach(modal => closeModal(modal.id));
  }
});

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('authError').textContent = '';

  const username = $('authUsername').value.trim();
  const password = $('authPassword').value;
  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';

  $('authSubmit').disabled = true;

  try {
    const data = await api(endpoint, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    renderUser(data.user);
    closeModal('authModal');

    showToast(authMode === 'login' ? 'تم تسجيل الدخول بنجاح.' : 'تم إنشاء حسابك بنجاح.');

    if (currentUser?.role === 'owner') {
      renderUser(currentUser);
      openModal('accountModal');
    }
  } catch (error) {
    $('authError').textContent = error.message;
  } finally {
    $('authSubmit').disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({})
    });
  } catch (error) {
    showToast(error.message);
  }

  renderUser(null);
  closeModal('accountModal');
  showToast('تم تسجيل الخروج.');
});

$('premiumForm').addEventListener('submit', async event => {
  event.preventDefault();
  $('premiumFeedback').textContent = '';

  try {
    const data = await api('/api/admin/premium', {
      method: 'POST',
      body: JSON.stringify({
        username: $('premiumUsername').value.trim(),
        days: Number($('premiumDuration').value)
      })
    });

    $('premiumFeedback').textContent = data.message || 'تم تحديث Premium.';
    await loadAdmin();
  } catch (error) {
    $('premiumFeedback').textContent = error.message;
  }
});

$('revokePremium').addEventListener('click', async () => {
  $('premiumFeedback').textContent = '';

  try {
    const data = await api('/api/admin/premium', {
      method: 'POST',
      body: JSON.stringify({
        username: $('premiumUsername').value.trim(),
        revoke: true
      })
    });

    $('premiumFeedback').textContent = data.message || 'تم سحب Premium.';
    await loadAdmin();
  } catch (error) {
    $('premiumFeedback').textContent = error.message;
  }
});

/*
 * IRQ PREMIUM CODE
 *
 * This frontend calls the server to validate and redeem a code.
 * The server must validate the code against the database, verify that
 * it is unused, and atomically mark it as used while granting Premium.
 * A code's number range alone must never grant Premium.
 */

(function setupPremiumCodeRedemption() {
  const codeInput = $('irqPremiumCode');
  const useButton = $('irqUseCode');
  const feedback = $('irqCodeFeedback');
  const celebration = $('premiumCelebration');
  const durationText = $('irqPremiumDuration');
  const fireworks = $('irqFireworks');

  if (!codeInput || !useButton || !feedback || !celebration || !durationText || !fireworks) {
    return;
  }

  let busy = false;
  let celebrationTimer = null;

  function setCodeFeedback(message, type = '') {
    feedback.textContent = message;
    feedback.className = type;
  }

  function getPremiumDuration(data) {
    if (typeof data.durationText === 'string' && data.durationText.trim()) {
      return data.durationText;
    }

    if (data.permanent === true) {
      return 'تم تفعيل البريميوم الدائم لحسابك.';
    }

    const expiry = data.expiresAt || data.expires_at || data.premiumUntil;

    if (expiry) {
      const date = new Date(expiry);

      if (!Number.isNaN(date.getTime())) {
        return `البريميوم مفعّل لغاية ${date.toLocaleDateString('ar')}.`;
      }
    }

    if (Number.isFinite(Number(data.days)) && Number(data.days) > 0) {
      return `تم تفعيل البريميوم لمدة ${Number(data.days)} يوم.`;
    }

    return 'تم تفعيل البريميوم لحسابك بنجاح.';
  }

  function showPremiumCelebration(data) {
    window.clearTimeout(celebrationTimer);
    fireworks.replaceChildren();

    for (let index = 0; index < 24; index++) {
      const particle = document.createElement('span');
      particle.className = 'irq-firework';
      particle.style.setProperty('--x', `${4 + Math.random() * 92}%`);
      particle.style.setProperty('--delay', `${Math.random() * 0.5}s`);
      fireworks.appendChild(particle);
    }

    durationText.textContent = getPremiumDuration(data);
    celebration.classList.remove('hidden');

    celebrationTimer = window.setTimeout(() => {
      celebration.classList.add('hidden');
      fireworks.replaceChildren();
    }, 2000);
  }

  async function redeemPremiumCode() {
    if (busy) return;

    const code = codeInput.value.trim();

    if (!code) {
      setCodeFeedback('أدخل كود البريميوم أولاً.', 'error');
      codeInput.focus();
      return;
    }

    if (!currentUser) {
      setCodeFeedback('سجّل الدخول إلى حسابك أولاً حتى نفعّل البريميوم.', 'error');
      authOpen('login');
      return;
    }

    busy = true;
    useButton.disabled = true;
    useButton.textContent = 'CHECKING...';
    setCodeFeedback('جاري التحقق من الكود...', '');

    try {
      const data = await api('/api/premium/redeem', {
        method: 'POST',
        body: JSON.stringify({ code })
      });

      if (data.success !== true) {
        throw new Error(data.message || 'لم يتم قبول الكود.');
      }

      setCodeFeedback('تم تفعيل البريميوم بنجاح!', 'success');
      codeInput.value = '';

      showPremiumCelebration(data);

      // Refresh account information from the server after redemption.
      await loadMe();
    } catch (error) {
      setCodeFeedback(
        error.message || 'تعذر التحقق من الكود. حاول مرة ثانية.',
        'error'
      );
    } finally {
      busy = false;
      useButton.disabled = false;
      useButton.textContent = 'USE CODE';
    }
  }

  useButton.addEventListener('click', redeemPremiumCode);

  codeInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      redeemPremiumCode();
    }
  });
})();

$('studyForm').addEventListener('submit', async event => {
  event.preventDefault();

  if (!currentUser) {
    showToast('سجّل الدخول أولاً حتى تستخدم المساعد.');
    authOpen('login');
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;

  const payload = {
    grade: $('grade').value,
    subject: $('subject').value,
    page: $('page').value.trim(),
    questionNumber: $('questionNumber').value.trim(),
    task: $('task').value.trim(),
    mode
  };

  const button = $('submitBtn');
  button.disabled = true;
  button.innerHTML = '<span>◌</span> جاري تجهيز الإجابة...';

  $('result').classList.remove('hidden');
  $('answer').textContent = 'لحظة، نجهّز الرد...';

  try {
    const data = await api('/api/solve', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    $('answer').textContent = data.answer;
  } catch (error) {
    $('answer').textContent =
      `${error.message}\n\nإذا لم تُضف بيانات خدمة الذكاء الاصطناعي في إعدادات الخادم، فلن تعمل الإجابات حتى إضافتها.`;
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> ابدأ الحل <b>←</b>';
  }
});

$('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('answer').innerText);
    $('copyBtn').textContent = 'تم النسخ ✓';

    setTimeout(() => {
      $('copyBtn').textContent = 'نسخ الإجابة';
    }, 1500);
  } catch {
    showToast('اضغط مطولاً على النص لنسخه.');
  }
});

loadMe();