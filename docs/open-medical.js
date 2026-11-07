/**
 * open-medical: register first, then the separate submit page.
 * Guarantees: the formula form is only on open-medical-give.html, and only a logged-in account with a finished profile can stay there.
 * Does not guarantee: progress.tap365.org is up, or that a submitted text joins the tombstone library.
 */
(function () {
  const AUTH = 'https://progress.tap365.org';
  const TOKEN = 'ysf_auth_token';
  const GIVE = 'open-medical-give.html';
  const GATE = 'open-medical.html';
  const onGive = !!document.getElementById('giveForm') && !document.getElementById('gate');

  /** Bearer call. Throws with the server message. */
  async function call(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem(TOKEN) || '';
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(AUTH + path, {
      method: body ? 'POST' : 'GET',
      mode: 'cors',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.error && data.error.message) || r.statusText);
    return data;
  }

  /** True when nationality, job, interests, and how they found the site are stored. */
  function ready(user) {
    return !!(user && user.country && user.occupation && user.interests && user.found_via);
  }

  /** Leave the register page once the account can submit. */
  function goGive() {
    location.assign(GIVE);
  }

  /** Send an unfinished or logged-out visitor back to the register prompt. */
  function goGate() {
    location.assign(GATE);
  }

  if (!onGive) {
    const gateStatus = document.getElementById('gateStatus');

    /** Checked interest labels on the register page. */
    function interests() {
      return Array.from(document.querySelectorAll('#gateInterests input:checked')).map((node) => node.value);
    }

    /** Profile fields. Null when one answer is missing. */
    function profileBody() {
      const country = document.getElementById('gateCountry').value;
      const occupation = document.getElementById('gateJob').value;
      const found_via = document.getElementById('gateFound').value;
      const picked = interests();
      if (!country || !occupation || !picked.length || !found_via) return null;
      return { country, occupation, interests: picked, found_via };
    }

    document.getElementById('gate').addEventListener('submit', async (e) => {
      e.preventDefault();
      gateStatus.textContent = '';
      const profile = profileBody();
      const button = document.getElementById('gateRegister');
      if (!profile) {
        gateStatus.textContent = '请再选至少一项感兴趣的方向';
        gateStatus.scrollIntoView({ block: 'nearest' });
        return;
      }
      button.disabled = true;
      button.textContent = '注册中…';
      try {
        const token = localStorage.getItem(TOKEN) || '';
        if (token) {
          await call('/v1/auth/profile', profile);
          goGive();
          return;
        }
        const data = await call('/v1/auth/register', {
          email: document.getElementById('gateEmail').value.trim(),
          password: document.getElementById('gatePassword').value,
          name: document.getElementById('gateName').value.trim(),
          ...profile,
        });
        if (data.token) localStorage.setItem(TOKEN, data.token);
        goGive();
      } catch (err) {
        gateStatus.textContent = err && err.message ? err.message : '没有写成';
        gateStatus.scrollIntoView({ block: 'nearest' });
        button.disabled = false;
        button.textContent = localStorage.getItem(TOKEN) ? '保存资料' : '注册';
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
        if (ready(data)) goGive();
        else gateStatus.textContent = '请把下面的国籍、职业、方向和来源选完，再点注册';
      } catch (err) {
        gateStatus.textContent = err && err.message ? err.message : '登录失败';
      }
    });

    const saved = localStorage.getItem(TOKEN);
    if (!saved) return;
    call('/v1/auth/me').then((user) => {
      if (ready(user)) goGive();
    }).catch(() => {
      localStorage.removeItem(TOKEN);
    });
    return;
  }

  const form = document.getElementById('giveForm');
  const list = document.getElementById('giveList');
  const giveStatus = document.getElementById('giveStatus');

  /** Show this account's own rows on the submit page. */
  function paint(items) {
    list.replaceChildren();
    (items || []).forEach((item) => {
      const li = document.createElement('li');
      const kind = item.kind === 'clue' ? '线索' : '方子';
      li.textContent = kind + ' · ' + (item.title || '') + (item.source ? ' · ' + item.source : '');
      list.appendChild(li);
    });
  }

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
      giveStatus.textContent = '已提交。';
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
    goGate();
  });

  const saved = localStorage.getItem(TOKEN);
  if (!saved) {
    goGate();
    return;
  }
  call('/v1/auth/me').then(async (user) => {
    if (!ready(user)) {
      goGate();
      return;
    }
    document.getElementById('giveWho').textContent = (user.name || user.email) + ' · ' + user.occupation;
    const data = await call('/v1/contributions');
    paint(data.items);
  }).catch(() => {
    localStorage.removeItem(TOKEN);
    goGate();
  });
})();
