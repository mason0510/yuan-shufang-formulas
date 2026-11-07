/**
 * open-medical intake.
 * Guarantees: a formula or a clue is posted only after login, and only this account's rows are shown.
 * Does not guarantee: the text joins the tombstone library, or that progress.tap365.org is up.
 */
(function () {
  const AUTH = 'https://progress.tap365.org';
  const TOKEN = 'ysf_auth_token';
  const gate = document.getElementById('gate');
  const form = document.getElementById('giveForm');
  const list = document.getElementById('giveList');
  const gateStatus = document.getElementById('gateStatus');
  const giveStatus = document.getElementById('giveStatus');

  /** Bearer call. Throws with the server message. */
  async function call(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN) || '';
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(AUTH + path, {
      method: method || (body ? 'POST' : 'GET'),
      mode: 'cors',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.error && data.error.message) || r.statusText);
    return data;
  }

  /** True when the four answers are already on the account. */
  function ready(user) {
    return !!(user && user.country && user.occupation && user.interests && user.found_via);
  }

  /** Checked interest labels. */
  function interests() {
    return Array.from(document.querySelectorAll('#gateInterests input:checked')).map((node) => node.value);
  }

  /** Profile fields from the gate. Null when one is missing. */
  function profileBody() {
    const country = document.getElementById('gateCountry').value;
    const occupation = document.getElementById('gateJob').value;
    const found_via = document.getElementById('gateFound').value;
    const picked = interests();
    if (!country || !occupation || !picked.length || !found_via) return null;
    return { country, occupation, interests: picked, found_via };
  }

  /** Show this account's own rows. */
  function paint(items) {
    list.replaceChildren();
    (items || []).forEach((item) => {
      const li = document.createElement('li');
      const kind = item.kind === 'clue' ? '线索' : '方子';
      li.textContent = kind + ' · ' + (item.title || '') + (item.source ? ' · ' + item.source : '');
      list.appendChild(li);
    });
  }

  /** Switch the page between the gate and the intake form. */
  async function showUser(user) {
    const on = ready(user);
    gate.hidden = on;
    form.hidden = !on;
    if (!on) {
      document.getElementById('gateTitle').textContent = user && user.email ? '补全资料后提交' : '注册后提交';
      document.getElementById('gateEmail').hidden = !!(user && user.email);
      document.getElementById('gatePassword').hidden = !!(user && user.email);
      document.getElementById('gateName').hidden = !!(user && user.email);
      document.getElementById('gateLogin').hidden = !!(user && user.email);
      document.getElementById('gateRegister').textContent = user && user.email ? '保存资料' : '注册';
      return;
    }
    document.getElementById('giveWho').textContent = (user.name || user.email) + ' · ' + user.occupation + ' · ' + user.country;
    const data = await call('/v1/contributions');
    paint(data.items);
  }

  document.getElementById('gateRegister').addEventListener('click', async () => {
    gateStatus.textContent = '';
    const profile = profileBody();
    if (!profile) {
      gateStatus.textContent = '请选择国籍、职业、感兴趣的方向，以及你是怎么找到这里的';
      return;
    }
    try {
      const token = localStorage.getItem(TOKEN) || '';
      if (token) {
        const user = await call('/v1/auth/profile', profile);
        await showUser(user);
        return;
      }
      const data = await call('/v1/auth/register', {
        email: document.getElementById('gateEmail').value.trim(),
        password: document.getElementById('gatePassword').value,
        name: document.getElementById('gateName').value.trim(),
        ...profile,
      });
      if (data.token) localStorage.setItem(TOKEN, data.token);
      await showUser(data);
    } catch (err) {
      gateStatus.textContent = err && err.message ? err.message : '没有写成';
    }
  });

  document.getElementById('gateLogin').addEventListener('click', async () => {
    gateStatus.textContent = '';
    try {
      const data = await call('/v1/auth/login', {
        email: document.getElementById('gateEmail').value.trim(),
        password: document.getElementById('gatePassword').value,
      });
      if (data.token) localStorage.setItem(TOKEN, data.token);
      await showUser(data);
    } catch (err) {
      gateStatus.textContent = err && err.message ? err.message : '登录失败';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    giveStatus.textContent = '';
    const send = document.getElementById('giveSend');
    send.disabled = true;
    try {
      await call('/v1/contributions', {
        kind: document.getElementById('giveKind').value,
        title: document.getElementById('giveTitle').value.trim(),
        body: document.getElementById('giveBody').value.trim(),
        source: document.getElementById('giveSource').value.trim(),
      });
      document.getElementById('giveTitle').value = '';
      document.getElementById('giveBody').value = '';
      document.getElementById('giveSource').value = '';
      giveStatus.textContent = '已写入你的库。还不是碑方。';
      const data = await call('/v1/contributions');
      paint(data.items);
    } catch (err) {
      giveStatus.textContent = err && err.message ? err.message : '没有写进库';
    } finally {
      send.disabled = false;
    }
  });

  document.getElementById('giveLogout').addEventListener('click', async () => {
    try { await call('/v1/auth/logout', {}); } catch (_) { /* already gone */ }
    localStorage.removeItem(TOKEN);
    form.hidden = true;
    gate.hidden = false;
    list.replaceChildren();
  });

  const saved = localStorage.getItem(TOKEN);
  if (!saved) return;
  call('/v1/auth/me').then(showUser).catch(() => {
    localStorage.removeItem(TOKEN);
  });
})();
