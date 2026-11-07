/**
 * Open the developer WeChat card from the top-right button.
 * Guarantees: the id is copied as plain text, and the card starts closed.
 * Does not guarantee: the visitor's clipboard permission is granted.
 */
(function devChat() {
  const button = document.getElementById('btnDev');
  if (!button) return;
  const pop = document.createElement('div');
  pop.className = 'dev-pop';
  pop.hidden = true;
  const label = document.createElement('p');
  label.textContent = '微信';
  const idLine = document.createElement('p');
  const id = document.createElement('strong');
  id.textContent = 'zhcmason';
  idLine.append(id);
  pop.append(label, idLine);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '复制微信号';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ghost';
  close.textContent = '关闭';
  const row = document.createElement('div');
  row.className = 'row';
  row.append(copy, close);
  pop.append(row);
  document.body.append(pop);

  button.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
  });
  close.addEventListener('click', () => {
    pop.hidden = true;
  });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('zhcmason');
      copy.textContent = '已复制';
    } catch (_) {
      copy.textContent = '请手动复制 zhcmason';
    }
  });
})();
