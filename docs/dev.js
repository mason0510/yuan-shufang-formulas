/**
 * Open the developer WeChat card from the link under 开源仓库.
 * Guarantees: the card starts closed and shows the QR image plus the id zhcmason.
 * Does not guarantee: a phone can scan a screenshot of this card.
 */
(function devChat() {
  const button = document.getElementById('btnDev');
  if (!button) return;
  const mask = document.createElement('div');
  mask.className = 'dev-mask';
  mask.hidden = true;
  const pop = document.createElement('div');
  pop.className = 'dev-pop';
  const title = document.createElement('p');
  title.textContent = '微信 zhcmason';
  const img = document.createElement('img');
  img.src = 'wechat-qr.jpg';
  img.alt = '微信二维码 zhcmason';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ghost';
  close.textContent = '关闭';
  pop.append(title, img, close);
  mask.append(pop);
  document.body.append(mask);

  function shut() {
    mask.hidden = true;
  }
  button.addEventListener('click', () => {
    mask.hidden = false;
  });
  close.addEventListener('click', shut);
  mask.addEventListener('click', (e) => {
    if (e.target === mask) shut();
  });
})();
