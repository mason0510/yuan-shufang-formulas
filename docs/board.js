/**
 * Load and post public notes on the board page only.
 * Guarantees: names and text are inserted with textContent, never HTML.
 * Does not guarantee: two fast posts both stick, or the list is newer than a few seconds.
 */
(function board() {
  const list = document.getElementById('commentList');
  const form = document.getElementById('commentForm');
  const status = document.getElementById('commentStatus');
  if (!list || !form) return;
  const api = 'https://ysf-api.tap365.org/v1/comments';
  const authApi = 'https://progress.tap365.org';
  let accountName = '';

  /**
   * Use the logged-in account name when this browser has a session.
   * Guarantees: a successful /me fills and locks the name field.
   * Does not guarantee: an expired token still resolves. The field stays editable then.
   */
  function loadAccount() {
    const token = localStorage.getItem('ysf_auth_token') || '';
    const input = document.getElementById('commentName');
    if (!token || !input) return;
    fetch(authApi + '/v1/auth/me', {
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((user) => {
        accountName = ((user && user.name) || '').trim();
        if (!accountName) return;
        input.value = accountName;
        input.readOnly = true;
        status.textContent = '署名用登录名：' + accountName;
      })
      .catch(() => {});
  }

  /**
   * Attach the session when this browser is logged in.
   * Guarantees: a saved token is sent as a bearer header. No token means no Authorization header.
   * Does not guarantee: the token is still valid.
   */
  function authHeaders(json) {
    const headers = {};
    if (json) headers['Content-Type'] = 'application/json';
    const token = localStorage.getItem('ysf_auth_token') || '';
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }

  /**
   * Draw the notes. A delete control is added only when the API marks the note as mine.
   * Guarantees: names and text use textContent.
   * Does not guarantee: a guest note can be removed.
   */
  function render(items) {
    list.replaceChildren();
    const rows = (items || []).slice().reverse();
    if (!rows.length) {
      const li = document.createElement('li');
      li.textContent = '还没有留言。';
      list.appendChild(li);
      return;
    }
    rows.forEach((item) => {
      const li = document.createElement('li');
      const who = document.createElement('strong');
      who.textContent = (item && item.name) || '访客';
      const body = document.createElement('div');
      body.textContent = (item && item.text) || '';
      li.append(who, body);
      if (item && item.mine && item.id) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'ghost';
        del.textContent = '删除';
        del.addEventListener('click', () => remove(item.id, del));
        li.append(del);
      }
      list.appendChild(li);
    });
  }

  /**
   * Delete one note owned by the logged-in account.
   * Guarantees: the request sends the note id and the session token.
   * Does not guarantee: the note still exists.
   */
  async function remove(id, button) {
    button.disabled = true;
    status.textContent = '';
    try {
      const r = await fetch(api, {
        method: 'DELETE',
        mode: 'cors',
        headers: authHeaders(true),
        body: JSON.stringify({ id: id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data && data.error && data.error.message) || r.statusText);
      render(data.comments);
    } catch (err) {
      status.textContent = err && err.message ? err.message : '没删掉';
      button.disabled = false;
    }
  }

  function load() {
    fetch(api, { method: 'GET', mode: 'cors', cache: 'no-store', headers: authHeaders(false) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => render(data && data.comments))
      .catch(() => {
        status.textContent = '留言暂时读不到。';
      });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = accountName || document.getElementById('commentName').value.trim();
    const text = document.getElementById('commentText').value.trim();
    if (!text) return;
    const button = document.getElementById('commentSend');
    button.disabled = true;
    status.textContent = '';
    try {
      const r = await fetch(api, {
        method: 'POST',
        mode: 'cors',
        headers: authHeaders(true),
        body: JSON.stringify({ name, text }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data && data.error && data.error.message) || r.statusText);
      document.getElementById('commentText').value = '';
      render(data.comments);
    } catch (err) {
      status.textContent = err && err.message ? err.message : '没留下';
    } finally {
      button.disabled = false;
    }
  });

  load();
  loadAccount();
})();
