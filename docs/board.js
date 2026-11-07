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
      list.appendChild(li);
    });
  }

  function load() {
    fetch(api, { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => render(data && data.comments))
      .catch(() => {
        status.textContent = '留言暂时读不到。';
      });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('commentName').value.trim();
    const text = document.getElementById('commentText').value.trim();
    if (!text) return;
    const button = document.getElementById('commentSend');
    button.disabled = true;
    status.textContent = '';
    try {
      const r = await fetch(api, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
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
})();
