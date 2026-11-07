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

    /** Names of answers still empty. Used only to build the popup. */
    function missingAnswers() {
      const gaps = [];
      if (!document.getElementById('gateEmail').value.trim()) gaps.push('邮箱');
      if (document.getElementById('gatePassword').value.length < 8) gaps.push('密码至少 8 位');
      if (!document.getElementById('gateCountry').value) gaps.push('国籍');
      if (!document.getElementById('gateJob').value) gaps.push('职业');
      if (!interests().length) gaps.push('感兴趣的方向');
      if (!document.getElementById('gateFound').value) gaps.push('通过什么方式找到这个网站');
      return gaps;
    }

    /** Profile fields. Null when one answer is missing. */
    function profileBody() {
      if (missingAnswers().length) return null;
      return {
        country: document.getElementById('gateCountry').value,
        occupation: document.getElementById('gateJob').value,
        interests: interests(),
        found_via: document.getElementById('gateFound').value,
      };
    }

    /** Popup the missing items. Returns true when the form can be sent. */
    function tellGaps() {
      const gaps = missingAnswers();
      if (!gaps.length) return true;
      alert('还没填完：\n' + gaps.join('\n'));
      return false;
    }

    document.getElementById('gate').addEventListener('submit', async (e) => {
      e.preventDefault();
      const profile = profileBody();
      const button = document.getElementById('gateRegister');
      if (!profile) {
        tellGaps();
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
        alert(err && err.message ? err.message : '没有写成');
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
        else alert('请把国籍、职业、感兴趣的方向，以及你是怎么找到这里的选完，再点注册');
      } catch (err) {
        alert(err && err.message ? err.message : '登录失败');
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
