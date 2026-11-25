/**
 * 从侧栏按钮打开一张微信卡片。
 * 保证：卡片默认关闭；点击后显示给定标题和图片；点关闭或点遮罩会收起。
 * 不保证：手机能扫截图，也不保证群二维码在图上印的日期之后仍然有效。
 */
function bindWechatCard(button, titleText, imgSrc, imgAlt) {
  if (!button) return;
  const mask = document.createElement('div');
  mask.className = 'dev-mask';
  mask.hidden = true;
  const pop = document.createElement('div');
  pop.className = 'dev-pop';
  const title = document.createElement('p');
  title.textContent = titleText;
  const img = document.createElement('img');
  img.src = imgSrc;
  img.alt = imgAlt;
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
}

bindWechatCard(
  document.getElementById('btnDev'),
  '微信 zhcmason',
  'wechat-qr.jpg',
  '微信二维码 zhcmason'
);
bindWechatCard(
  document.getElementById('btnGroup'),
  '交流群',
  'group-qr.jpg',
  '微信交流群二维码'
);
