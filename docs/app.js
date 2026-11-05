
const LS = {
  key: 'ysf_api_key',
  base: 'ysf_base_url',
  model: 'ysf_model',
};

const defaults = {
  baseUrl: 'https://ca.chainfuel.tap365.org/v1',
  model: 'grok-4.7-build-fast',
};

const chatEl = document.getElementById('chat');
const inputEl = document.getElementById('input');
const formEl = document.getElementById('composer');
const dlg = document.getElementById('settings');

let formulas = null;
let systemPrompt = '';
let history = [];

function cfg() {
  return {
    baseUrl: (localStorage.getItem(LS.base) || defaults.baseUrl).replace(/\/$/, ''),
    model: localStorage.getItem(LS.model) || defaults.model,
    apiKey: localStorage.getItem(LS.key) || '',
  };
}

function addMsg(role, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function loadSettingsForm() {
  const c = cfg();
  document.getElementById('baseUrl').value = c.baseUrl;
  document.getElementById('model').value = c.model;
  document.getElementById('apiKey').value = c.apiKey;
}

document.getElementById('btnSettings').onclick = () => {
  loadSettingsForm();
  dlg.showModal();
};

document.getElementById('saveSettings').onclick = (e) => {
  e.preventDefault();
  localStorage.setItem(LS.base, document.getElementById('baseUrl').value.trim());
  localStorage.setItem(LS.model, document.getElementById('model').value.trim());
  localStorage.setItem(LS.key, document.getElementById('apiKey').value.trim());
  dlg.close();
  addMsg('sys', '设置已保存到本机浏览器。');
};

document.getElementById('btnClear').onclick = () => {
  history = [];
  chatEl.innerHTML = '';
  addMsg('sys', '对话已清空。直接描述病人情况即可开参考方。');
};

async function bootstrap() {
  addMsg('sys', '正在加载验方库…');
  const [fRes, sRes] = await Promise.all([
    fetch('formulas.json'),
    fetch('system.md'),
  ]);
  formulas = await fRes.json();
  systemPrompt = await sRes.text();
  chatEl.innerHTML = '';
  addMsg('bot', `验方库已加载 ${formulas.count} 首。\n请发送：年龄/性别、主诉、体质（胖瘦寒热）、经带胎产、药房有无药。\n我将按碑方编号加减开出参考方。`);
  if (!cfg().apiKey) {
    loadSettingsForm();
    dlg.showModal();
  }
}

function extractText(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text' && c.text) parts.push(c.text);
        if (c.type === 'text' && c.text) parts.push(c.text);
      }
    }
  }
  return parts.join('\n').trim() || JSON.stringify(data).slice(0, 400);
}

async function askGrok(userText) {
  const c = cfg();
  if (!c.apiKey) {
    loadSettingsForm();
    dlg.showModal();
    throw new Error('请先在设置中填写 CHAINFUEL_GROK_API_KEY');
  }
  history.push({ role: 'user', content: userText });
  const input = history.map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch(c.baseUrl + '/responses', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + c.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: c.model,
      instructions: systemPrompt,
      input,
      max_output_tokens: 2048,
      reasoning: { effort: 'low' },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && (data.error.message || JSON.stringify(data.error))) || res.statusText;
    throw new Error('API ' + res.status + ': ' + msg);
  }
  const text = extractText(data);
  history.push({ role: 'assistant', content: text });
  return text;
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = '';
  addMsg('user', text);
  const thinking = document.createElement('div');
  thinking.className = 'msg bot';
  thinking.textContent = '辨证开方中…';
  chatEl.appendChild(thinking);
  try {
    const reply = await askGrok(text);
    thinking.textContent = reply;
  } catch (err) {
    thinking.textContent = '出错：' + (err && err.message ? err.message : String(err));
  }
});

bootstrap().catch((err) => {
  chatEl.innerHTML = '';
  addMsg('bot', '加载失败：' + err.message);
});
