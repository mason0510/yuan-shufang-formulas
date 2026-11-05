const LS = {
  key: 'ysf_api_key',
  base: 'ysf_base_url',
  model: 'ysf_model',
  style: 'ysf_api_style',
  upstream: 'ysf_upstream_base',
  preset: 'ysf_preset',
};

const DEMO_KEY = 'sk-7ad4e48c969f1d8bef21173bc51e6cd45f62266f8d198c703dcb44aff2d1e538';
const PROXY_BASE = 'https://ysf-api.tap365.org/v1';
const CHAINFUEL_UPSTREAM = 'https://ca.chainfuel.tap365.org';

const PRESETS = {
  chainfuel: {
    label: 'ChainFuel 演示',
    baseUrl: PROXY_BASE,
    upstreamBase: CHAINFUEL_UPSTREAM,
    model: 'grok-4.7-build-fast',
    apiStyle: 'responses',
    apiKey: DEMO_KEY,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    upstreamBase: '',
    model: 'gpt-4o-mini',
    apiStyle: 'chat',
    apiKey: '',
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    upstreamBase: '',
    model: 'deepseek-chat',
    apiStyle: 'chat',
    apiKey: '',
  },
  custom: {
    label: '自定义',
    baseUrl: PROXY_BASE,
    upstreamBase: '',
    model: '',
    apiStyle: 'chat',
    apiKey: '',
  },
};

const DOSE_RISK =
  '【计量/用量风险】药味克数若使用错误可伤身甚至危及生命；剂量须由有资质中医师当面辨证后调整；严禁自行照方抓药或擅自加减。本输出仅为参考方，不构成处方。';

const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const formEl = document.getElementById('composer');
const dlg = document.getElementById('settings');

let formulas = null;
let systemPrompt = '';
let history = [];

function cfg() {
  const preset = localStorage.getItem(LS.preset) || 'chainfuel';
  const d = PRESETS[preset] || PRESETS.chainfuel;
  let baseUrl = (localStorage.getItem(LS.base) || d.baseUrl).replace(/\/$/, '');
  // Old Pages pointed browser straight at ChainFuel (CORS blocked). Auto-migrate.
  if (/ca\.chainfuel\.tap365\.org/i.test(baseUrl)) {
    baseUrl = PROXY_BASE.replace(/\/$/, '');
    localStorage.setItem(LS.base, baseUrl);
    if (!localStorage.getItem(LS.upstream)) {
      localStorage.setItem(LS.upstream, CHAINFUEL_UPSTREAM);
    }
  }
  return {
    preset,
    baseUrl,
    upstreamBase: (localStorage.getItem(LS.upstream) || d.upstreamBase || '').replace(/\/$/, ''),
    model: localStorage.getItem(LS.model) || d.model,
    apiStyle: localStorage.getItem(LS.style) || d.apiStyle || 'chat',
    apiKey: localStorage.getItem(LS.key) || (preset === 'chainfuel' ? DEMO_KEY : ''),
  };
}

function agentAvatar() {
  const img = document.createElement('img');
  img.className = 'avatar';
  img.src = 'yuan-shufang.png';
  img.alt = '中医袁淑芳';
  return img;
}

function addBotBubble(text, thinking) {
  const row = document.createElement('div');
  row.className = 'bot-row';
  row.appendChild(agentAvatar());
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap';
  const div = document.createElement('div');
  div.className = thinking ? 'msg bot thinking' : 'msg bot';
  div.textContent = text;
  wrap.appendChild(div);
  if (!thinking) {
    const risk = document.createElement('div');
    risk.className = 'dose-risk';
    risk.textContent = DOSE_RISK;
    wrap.appendChild(risk);
  }
  row.appendChild(wrap);
  chatEl.appendChild(row);
  chatEl.scrollTop = chatEl.scrollHeight;
  return { row, wrap, div };
}

function addMsg(role, text) {
  if (role === 'bot') {
    addBotBubble(text, false);
  } else {
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.textContent = text;
    chatEl.appendChild(div);
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

function applyPresetToForm(name) {
  const p = PRESETS[name] || PRESETS.custom;
  document.getElementById('preset').value = name;
  document.getElementById('baseUrl').value = p.baseUrl;
  document.getElementById('upstreamBase').value = p.upstreamBase || '';
  document.getElementById('model').value = p.model;
  document.getElementById('apiStyle').value = p.apiStyle;
  document.getElementById('apiKey').value =
    name === 'chainfuel' ? (localStorage.getItem(LS.key) || DEMO_KEY) : (localStorage.getItem(LS.key) || '');
}

function loadSettingsForm() {
  const c = cfg();
  document.getElementById('preset').value = c.preset in PRESETS ? c.preset : 'custom';
  document.getElementById('baseUrl').value = c.baseUrl;
  document.getElementById('upstreamBase').value = c.upstreamBase;
  document.getElementById('model').value = c.model;
  document.getElementById('apiStyle').value = c.apiStyle;
  document.getElementById('apiKey').value = c.apiKey;
}

document.getElementById('preset').addEventListener('change', (e) => {
  applyPresetToForm(e.target.value);
});

document.getElementById('btnSettings').onclick = () => {
  loadSettingsForm();
  dlg.showModal();
};

document.getElementById('saveSettings').onclick = (e) => {
  e.preventDefault();
  localStorage.setItem(LS.preset, document.getElementById('preset').value);
  localStorage.setItem(LS.base, document.getElementById('baseUrl').value.trim());
  localStorage.setItem(LS.upstream, document.getElementById('upstreamBase').value.trim());
  localStorage.setItem(LS.model, document.getElementById('model').value.trim());
  localStorage.setItem(LS.style, document.getElementById('apiStyle').value);
  localStorage.setItem(LS.key, document.getElementById('apiKey').value.trim());
  dlg.close();
  addMsg('sys', '设置已保存到本机浏览器（Key 不会上传到本站仓库）。');
};

document.getElementById('btnClear').onclick = () => {
  history = [];
  chatEl.innerHTML = '';
  addMsg('sys', '对话已清空。请用患者自述补充初诊信息；信息不足时我会先问诊，再给参考方，并附计量风险提示。');
};

document.querySelectorAll('.example').forEach((btn) => {
  btn.addEventListener('click', () => {
    inputEl.value = btn.getAttribute('data-fill') || '';
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  });
});

/**
 * Count formulas actually present in the loaded library.
 * Guarantees: returns formulas.length, ignoring a stale count field.
 * Does not guarantee: the stone text has more readable lines than this file.
 */
function loadedFormulaCount(data) {
  const list = data && Array.isArray(data.formulas) ? data.formulas : [];
  return list.length;
}

async function bootstrap() {
  addMsg('sys', '正在加载验方库…');
  // v=120 bypasses the cached 40-formula file from the previous Pages deploy.
  const [fRes, sRes] = await Promise.all([
    fetch('formulas.json?v=120', { cache: 'no-store' }),
    fetch('system.md?v=120', { cache: 'no-store' }),
  ]);
  if (!fRes.ok) throw new Error('验方库 HTTP ' + fRes.status);
  formulas = await fRes.json();
  systemPrompt = await sRes.text();
  const n = loadedFormulaCount(formulas);
  chatEl.innerHTML = '';
  addMsg(
    'bot',
    `验方库已加载 ${n} 首。\n\n【初诊流程】信息不全时我先问诊，不急着开方。请尽量用自己的话说明：年龄性别、主诉、体质（胖瘦寒热）、经带胎产、病程、现用药、药房清单。\n\n【重要】本站可输出参考方，但仅供专业辨证参考；须有资质医师把关后抓药；不可自行照方抓药；急危重症请立刻就医。`,
  );
  if (!cfg().apiKey) {
    loadSettingsForm();
    dlg.showModal();
  }
}

function extractResponsesText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if ((c.type === 'output_text' || c.type === 'text') && c.text) parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractChatText(data) {
  const choice = data.choices && data.choices[0];
  if (!choice) return '';
  const content = choice.message && choice.message.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c.text || c.content || ''))
      .join('\n')
      .trim();
  }
  return '';
}

function networkErrorMessage(err) {
  const msg = (err && err.message) || String(err);
  if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
    return (
      '网络/CORS 失败：' +
      msg +
      '。请确认 Base URL 指向 CORS 代理（演示默认已配置），或自建可跨域的 OpenAI 兼容接口；设置里可切换「模型供应商」。'
    );
  }
  return msg;
}

async function callApi(style, c, payload) {
  const path = style === 'chat' ? '/chat/completions' : '/responses';
  const headers = {
    Authorization: 'Bearer ' + c.apiKey,
    'Content-Type': 'application/json',
  };
  // When using our proxy, allow overriding the real upstream.
  if (c.baseUrl.includes('yuan-shufang-cors') && c.upstreamBase) {
    headers['X-Upstream-Base'] = c.upstreamBase;
  }
  let res;
  try {
    res = await fetch(c.baseUrl + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
  } catch (err) {
    throw new Error(networkErrorMessage(err));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data && data.error && (data.error.message || JSON.stringify(data.error))) ||
      res.statusText ||
      'unknown';
    throw new Error('API ' + res.status + ' (' + style + '): ' + msg);
  }
  const text = style === 'chat' ? extractChatText(data) : extractResponsesText(data);
  if (!text) throw new Error('API 返回空内容（' + style + '）');
  return text;
}

async function askModel(userText) {
  const c = cfg();
  if (!c.apiKey) {
    loadSettingsForm();
    dlg.showModal();
    throw new Error('请先在「模型供应商」设置中填写 API Key');
  }
  if (!c.model) throw new Error('请先填写 Model 名称');

  history.push({ role: 'user', content: userText });
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const preferred = c.apiStyle === 'responses' ? 'responses' : 'chat';
  const fallback = preferred === 'responses' ? 'chat' : 'responses';

  const payloads = {
    responses: {
      model: c.model,
      instructions: systemPrompt,
      input: history.map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: 2048,
    },
    chat: {
      model: c.model,
      messages,
      max_tokens: 2048,
      temperature: 0.4,
    },
  };

  try {
    const text = await callApi(preferred, c, payloads[preferred]);
    history.push({ role: 'assistant', content: text });
    return text;
  } catch (err1) {
    try {
      const text = await callApi(fallback, c, payloads[fallback]);
      history.push({ role: 'assistant', content: text });
      return text + '\n\n（已自动回退到 API 风格：' + fallback + '）';
    } catch (err2) {
      history.pop();
      throw new Error(err1.message + ' | 回退失败：' + err2.message);
    }
  }
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  addMsg('user', text);
  const pending = addBotBubble('初诊辨证中…', true);
  try {
    const reply = await askModel(text);
    pending.div.classList.remove('thinking');
    pending.div.textContent = reply;
    const risk = document.createElement('div');
    risk.className = 'dose-risk';
    risk.textContent = DOSE_RISK;
    pending.wrap.appendChild(risk);
  } catch (err) {
    pending.div.classList.remove('thinking');
    pending.div.textContent = '出错：' + (err && err.message ? err.message : String(err));
  }
});

bootstrap().catch((err) => {
  chatEl.innerHTML = '';
  addMsg('bot', '加载失败：' + err.message);
});


// --- support counter + flowers (server-backed) ---
(function supportCounter() {
  const API = 'https://ysf-api.tap365.org/v1/support';
  const MINE = 'ysf_support_mine_v1';
  const el = document.getElementById('supportCount');
  const btn = document.getElementById('btnSupport');
  if (!el || !btn) return;

  // Drop legacy fake localStorage total if present; never trust it for display.
  try { localStorage.removeItem('ysf_support_total_v1'); } catch (_) {}

  const overlay = document.getElementById('wanOverlay');
  const closeBtn = document.getElementById('wanClose');

  /**
   * Play the petal overlay for this visitor's flower.
   * Guarantees: overlay unhides and petals spawn.
   * Does not guarantee: tying to 10000, page-load, or GET count.
   */
  function celebrateSupport() {
    if (!overlay) return;
    overlay.hidden = false;
    const petals = overlay.querySelector('.wan-petals');
    petals.innerHTML = '';
    const glyphs = ['🌸', '🌺', '🌼', '💐', '🌹', '🌷'];
    for (let i = 0; i < 28; i += 1) {
      const p = document.createElement('span');
      p.className = 'wan-petal';
      p.textContent = glyphs[i % glyphs.length];
      p.style.left = Math.round(Math.random() * 100) + '%';
      p.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      p.style.animationDuration = (3.2 + Math.random() * 2.4) + 's';
      p.style.animationDelay = (Math.random() * 0.9) + 's';
      p.style.fontSize = (16 + Math.round(Math.random() * 16)) + 'px';
      petals.appendChild(p);
    }
  }

  /**
   * Hide the thank-you overlay. Does not change the server count.
   */
  function hideSupportFx() {
    if (overlay) overlay.hidden = true;
  }

  if (closeBtn) closeBtn.addEventListener('click', hideSupportFx);
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideSupportFx();
  });

  /**
   * Render the public total. Does not open the overlay at any threshold.
   */
  function setCount(n) {
    if (typeof n === 'number' && Number.isFinite(n)) el.textContent = String(n);
    else el.textContent = '—';
  }

  /**
   * Mark this browser as already sent. Button stays clickable so the
   * thank-you overlay can replay without a second POST.
   */
  function markMine() {
    btn.textContent = '已送过花，谢谢';
    btn.disabled = false;
  }

  if (localStorage.getItem(MINE) === '1') markMine();

  fetch(API, { method: 'GET', mode: 'cors' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((data) => setCount(data && data.count))
    .catch(() => setCount(null));

  btn.addEventListener('click', async () => {
    if (localStorage.getItem(MINE) === '1') {
      markMine();
      celebrateSupport();
      return;
    }
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '送出中…';
    try {
      const r = await fetch(API, { method: 'POST', mode: 'cors' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data && data.error && data.error.message) || r.statusText);
      setCount(data.count);
      localStorage.setItem(MINE, '1');
      markMine();
      celebrateSupport();
    } catch (_) {
      btn.textContent = prev;
      btn.disabled = false;
      // Keep displayed total from last successful GET; do not invent a number.
    }
  });
})();
