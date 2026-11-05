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
  document.getElementById('apiKey').value = localStorage.getItem(LS.key) || (name === 'chainfuel' ? DEMO_KEY : '');
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
    fetch('system.md?v=123', { cache: 'no-store' }),
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
  // ChainFuel preset carries DEMO_KEY, so 开方 does not open settings first.
}

/**
 * Join text parts from a Responses/Chat content array.
 * Guarantees: returns a string, empty when content is missing.
 * Does not guarantee: the provider used a text field.
 */
function textOfParts(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => {
      if (typeof c === 'string') return c;
      if (!c) return '';
      return c.text || c.reasoning_text || c.content || '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * Split a Responses payload into the hidden reasoning trace and the answer.
 * Guarantees: reasoning items are not dropped; message text is the answer.
 * Does not guarantee: the model returned a reasoning item.
 */
function splitResponses(data) {
  const reasoning = [];
  const answer = [];
  let sawMessage = false;
  for (const item of data.output || []) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'reasoning') {
      const t = [textOfParts(item.summary), textOfParts(item.content)].filter(Boolean).join('\n');
      if (t) reasoning.push(t);
    } else if (item.type === 'message') {
      sawMessage = true;
      const t = textOfParts(item.content);
      if (t) answer.push(t);
    }
  }
  if (!sawMessage && typeof data.output_text === 'string' && data.output_text) {
    answer.push(data.output_text.trim());
  }
  return { reasoning: reasoning.join('\n\n').trim(), answer: answer.join('\n\n').trim() };
}

/**
 * Split a Chat Completions payload. Reasoning may sit beside content.
 * Guarantees: reasoning_content/reasoning is kept separate from the answer.
 * Does not guarantee: every provider uses those field names.
 */
function splitChat(data) {
  const choice = data.choices && data.choices[0];
  const message = (choice && choice.message) || {};
  const reasoning = message.reasoning_content || message.reasoning || '';
  return {
    reasoning: String(reasoning || '').trim(),
    answer: textOfParts(message.content),
  };
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

/**
 * Pull one SSE event into reasoning and answer fragments.
 * Guarantees: a delta is not also copied from a later full-text event when saw* is set.
 * Does not guarantee: every provider uses these field names.
 */
function takeSseData(json, seen) {
  const out = { reasoning: '', answer: '' };
  if (!json || typeof json !== 'object') return out;
  if (json.error && (json.error.message || json.error)) {
    throw new Error(json.error.message || JSON.stringify(json.error));
  }
  const delta = json.choices && json.choices[0] && json.choices[0].delta;
  if (delta) {
    const reason = delta.reasoning_content || delta.reasoning || '';
    const answer = typeof delta.content === 'string' ? delta.content : '';
    if (reason) {
      seen.reason = true;
      out.reasoning += reason;
    }
    if (answer) {
      seen.answer = true;
      out.answer += answer;
    }
    return out;
  }
  const typ = json.type || '';
  const piece = typeof json.delta === 'string' ? json.delta : '';
  if (piece && /reasoning/i.test(typ)) {
    seen.reason = true;
    out.reasoning += piece;
    return out;
  }
  if (piece && /output_text|text\.delta/i.test(typ)) {
    seen.answer = true;
    out.answer += piece;
    return out;
  }
  if (seen.reason || seen.answer) return out;
  const split = json.output || json.response ? splitResponses(json.response || json) : splitChat(json);
  if (split.reasoning) out.reasoning += split.reasoning;
  if (split.answer) out.answer += split.answer;
  return out;
}

/**
 * Read a streaming or one-shot completion and report each fragment.
 * Guarantees: onDelta is called with 'reason' or 'answer' before the function returns the joined text.
 * Does not guarantee: the proxy flushed each chunk. A buffered body still arrives in one read.
 */
async function callApi(style, c, payload, onDelta) {
  const path = style === 'chat' ? '/chat/completions' : '/responses';
  const headers = {
    Authorization: 'Bearer ' + c.apiKey,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (c.baseUrl.includes('yuan-shufang-cors') && c.upstreamBase) {
    headers['X-Upstream-Base'] = c.upstreamBase;
  }
  const body = Object.assign({ stream: true }, payload);
  let res;
  try {
    res = await fetch(c.baseUrl + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(networkErrorMessage(err));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg =
      (data && data.error && (data.error.message || JSON.stringify(data.error))) ||
      res.statusText ||
      'unknown';
    throw new Error('API ' + res.status + ' (' + style + '): ' + msg);
  }
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const split = { reasoning: '', answer: '' };
  const emit = (kind, text) => {
    if (!text) return;
    if (kind === 'reason') split.reasoning += text;
    else split.answer += text;
    if (onDelta) onDelta(kind, text);
  };
  if (!res.body || ctype.includes('application/json')) {
    const data = await res.json();
    const parsed = style === 'chat' ? splitChat(data) : splitResponses(data);
    emit('reason', parsed.reasoning);
    emit('answer', parsed.answer);
  } else {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const seen = { reason: false, answer: false };
    const consume = (block) => {
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim());
      for (const line of dataLines) {
        if (!line || line === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(line);
        } catch (_) {
          continue;
        }
        const part = takeSseData(json, seen);
        emit('reason', part.reasoning);
        emit('answer', part.answer);
      }
    };
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      buf += dec.decode(step.value, { stream: true });
      const blocks = buf.split('\n\n');
      buf = blocks.pop();
      blocks.forEach(consume);
    }
    if (buf.trim()) consume(buf);
  }
  if (!split.answer && !split.reasoning) throw new Error('API 返回空内容（' + style + '）');
  if (!split.answer) split.answer = split.reasoning;
  return split;
}

/**
 * Ask for a reasoning summary, then retry once without that field if the
 * provider rejects it. Does not guarantee a reasoning trace came back.
 */
function withReasoning(style, payload) {
  const next = Object.assign({}, payload);
  if (style === 'chat') next.reasoning_effort = 'medium';
  else next.reasoning = { effort: 'medium', summary: 'auto' };
  return next;
}

async function askModel(userText, onDelta) {
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

  /**
   * Call one style. A 400 that mentions reasoning is retried without that field.
   * Guarantees: either a split result or a thrown error. Does not change history.
   */
  async function callStyle(style) {
    try {
      return await callApi(style, c, withReasoning(style, payloads[style]), onDelta);
    } catch (err) {
      if (!/400|unknown|unrecognized|reasoning/i.test(err.message)) throw err;
      return await callApi(style, c, payloads[style], onDelta);
    }
  }

  try {
    const split = await callStyle(preferred);
    history.push({ role: 'assistant', content: split.answer });
    return split;
  } catch (err1) {
    try {
      const split = await callStyle(fallback);
      split.answer += '\n\n（已自动回退到 API 风格：' + fallback + '）';
      history.push({ role: 'assistant', content: split.answer });
      return split;
    } catch (err2) {
      history.pop();
      throw new Error(err1.message + ' | 回退失败：' + err2.message);
    }
  }
}

/**
 * Append one streamed fragment onto the open bubble.
 * Guarantees: reasoning and answer stay in separate nodes and grow as chunks arrive.
 * Does not guarantee: the first chunk arrives before the model has finished thinking upstream.
 */
function appendStream(pending, state, kind, text) {
  pending.div.classList.remove('thinking');
  if (pending.div.textContent === '初诊辨证中…') pending.div.textContent = '';
  if (kind === 'reason') {
    if (!state.reasonBody) {
      const box = document.createElement('details');
      box.className = 'reason';
      box.open = true;
      const sum = document.createElement('summary');
      sum.textContent = '辨证思路';
      state.reasonBody = document.createElement('div');
      state.reasonBody.className = 'reason-body';
      box.append(sum, state.reasonBody);
      pending.div.appendChild(box);
    }
    state.reasonBody.textContent += text;
  } else {
    if (!state.answerEl) {
      state.answerEl = document.createElement('div');
      state.answerEl.className = 'answer';
      pending.div.appendChild(state.answerEl);
    }
    state.answerEl.textContent += text;
  }
  chatEl.scrollTop = chatEl.scrollHeight;
}

/**
 * Attach the dose warning once the reply has finished.
 * Does not change the reply text.
 */
function finishReply(pending) {
  if (pending.wrap.querySelector('.dose-risk')) return;
  const risk = document.createElement('div');
  risk.className = 'dose-risk';
  risk.textContent = DOSE_RISK;
  pending.wrap.appendChild(risk);
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  addMsg('user', text);
  const pending = addBotBubble('初诊辨证中…', true);
  try {
    const state = { reasonBody: null, answerEl: null };
    await askModel(text, (kind, chunk) => appendStream(pending, state, kind, chunk));
    finishReply(pending);
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

  let shown = null;

  /**
   * Render the public total. Ignores a smaller poll result so a slow GET
   * cannot roll back a click that just incremented.
   * Does not open the overlay at any threshold.
   */
  function setCount(n) {
    if (typeof n === 'number' && Number.isFinite(n)) {
      if (shown !== null && n < shown) return;
      shown = n;
      el.textContent = String(n);
    } else if (shown === null) {
      el.textContent = '—';
    }
  }

  /**
   * Pull the shared total. A failed poll keeps the last number.
   * Does not increment the counter.
   */
  function refreshCount() {
    fetch(API, { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => setCount(data && data.count))
      .catch(() => {
        if (shown === null) setCount(null);
      });
  }

  /**
   * After a counted click, leave the button ready for another one.
   * Does not remember a one-time lock.
   */
  function readyAgain() {
    btn.textContent = '再送一朵';
    btn.disabled = false;
  }

  if (localStorage.getItem(MINE) === '1') readyAgain();

  refreshCount();
  setInterval(refreshCount, 8000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshCount();
  });

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '送出中…';
    try {
      const r = await fetch(API, { method: 'POST', mode: 'cors' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data && data.error && data.error.message) || r.statusText);
      setCount(data.count);
      localStorage.setItem(MINE, '1');
      readyAgain();
      celebrateSupport();
    } catch (_) {
      btn.textContent = prev;
      btn.disabled = false;
    }
  });
})();
