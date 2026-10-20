const P = window.PRESETS;
const $ = (s) => document.querySelector(s);

const state = {
  langs: ['zh'],
  genres: [],
  artists: [],
  styleCards: [],
  moods: new Set(),
  vocal: null,
  params: { model: '', temp: 0.9, maxTok: 2400 },
  thinking: true,
  busy: false,
  abort: null,
  out: { title: '', style_tags: '', lyrics: '' },
};

const HISTORY_KEY = 'ilyrics_history';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------- chips ---------- */

function chipEl(label, active, onclick) {
  const b = document.createElement('button');
  b.className = 'chip' + (active ? ' active' : '');
  b.textContent = label;
  b.addEventListener('click', onclick);
  return b;
}

function renderChips() {
  const langBox = $('#langChips');
  langBox.innerHTML = '';
  for (const l of P.langs) {
    langBox.appendChild(chipEl(l.label, state.langs.includes(l.id), () => {
      if (state.langs.includes(l.id)) {
        state.langs = state.langs.filter((x) => x !== l.id);
        if (!state.langs.length) state.langs = ['zh'];
      } else {
        state.langs.push(l.id);
      }
      renderChips();
    }));
  }

  const moodBox = $('#moodChips');
  moodBox.innerHTML = '';
  for (const m of P.moods) {
    moodBox.appendChild(chipEl(m.label, state.moods.has(m.id), () => {
      if (state.moods.has(m.id)) state.moods.delete(m.id);
      else state.moods.add(m.id);
      renderChips();
    }));
  }

  const vocalBox = $('#vocalChips');
  vocalBox.innerHTML = '';
  for (const v of P.vocals) {
    vocalBox.appendChild(chipEl(v.label, state.vocal && state.vocal.id === v.id, () => {
      state.vocal = state.vocal && state.vocal.id === v.id ? null : v;
      renderChips();
    }));
  }

  $('#thinkToggle').classList.toggle('active', state.thinking);
}

/* ---------- dropdowns ---------- */

const dropdownRefreshers = [];
function refreshDropdowns() {
  for (const fn of dropdownRefreshers) fn();
}

function makeDropdown(key, btnId, panelId, searchId, gridId, apply, opts = {}) {
  const multi = !!opts.multi;
  const arr = opts.arr;
  const btn = $(btnId);
  const panel = $(panelId);
  const search = $(searchId);
  const grid = $(gridId);
  const placeholder = btn.textContent.replace(' ▾', '');

  function isActive(item) {
    return multi ? state[arr].some((x) => x.id === item.id)
                 : !!(state[key] && state[key].id === item.id);
  }

  function draw() {
    const q = (search.value || '').trim().toLowerCase();
    grid.innerHTML = '';
    const list = { artist: P.artists, style: P.styles, genre: P.genres }[key];
    for (const item of list) {
      if (q && !item.label.toLowerCase().includes(q) && !item.id.includes(q)) continue;
      const el = chipEl(item.label, isActive(item), () => toggle(item));
      el.classList.add('dd-item');
      el.title = item.label + (item.guide ? ' · ' + item.guide : '');
      grid.appendChild(el);
    }
    let label;
    if (multi) {
      if (!state[arr].length) label = placeholder;
      else {
        label = state[arr][0].label;
        if (state[arr].length > 1) label += ' +' + (state[arr].length - 1);
      }
    } else {
      label = state[key] ? state[key].label : placeholder;
    }
    btn.textContent = label + ' ▾';
    btn.classList.toggle('has', multi ? state[arr].length > 0 : !!state[key]);
  }

  function toggle(item) {
    if (multi) {
      if (state[arr].some((x) => x.id === item.id)) {
        state[arr] = state[arr].filter((x) => x.id !== item.id);
      } else {
        state[arr].push(item);
        if (apply) apply(item);
      }
    } else {
      if (state[key] && state[key].id === item.id) {
        state[key] = null;
      } else {
        state[key] = item;
        if (apply) apply(item);
      }
    }
    draw();
    renderChips();
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      draw();
      search.focus();
    }
  });
  search.addEventListener('input', draw);
  search.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) panel.hidden = true;
  });
  dropdownRefreshers.push(draw);
  draw();
}

$('#thinkToggle').addEventListener('click', () => {
  state.thinking = !state.thinking;
  renderChips();
});

/* ---------- prompt ---------- */

function composeTags() {
  const parts = [];
  if (state.artists.length) parts.push(state.artists.map((a) => a.tags).join(','));
  if (state.styleCards.length) parts.push(state.styleCards.map((s) => s.tags).join(','));
  if (state.genres.length) parts.push(state.genres.map((g) => g.tags).join(','));
  if (state.vocal) parts.push(state.vocal.tags);
  for (const m of P.moods) if (state.moods.has(m.id)) parts.push(m.tag);
  const seen = [];
  for (const raw of parts.join(',').split(',')) {
    const t = raw.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  return seen.slice(0, 12).join(', ');
}

function buildSystem() {
  const langRule = state.langs.length === 1
    ? P.langs.find((l) => l.id === state.langs[0]).rule
    : `歌词正文可在这些语言间自然混写：${state.langs.map((id) => P.langs.find((l) => l.id === id).label).join('、')}。同一段落内保持同一语言，段落间可自然切换，副歌可用任一语言的 hook，歌名用其中任一语言。`;
  const guides = [];
  if (state.artists.length) guides.push('歌手参考：' + state.artists.map((a) => a.guide).join('；'));
  if (state.styleCards.length) guides.push('风格参考：' + state.styleCards.map((s) => s.guide).join('；'));
  if (state.genres.length) guides.push('曲风参考：' + state.genres.map((g) => g.guide).join('；'));
  if (state.vocal) guides.push('人声编排：' + state.vocal.guide);
  const moodWords = P.moods.filter((m) => state.moods.has(m.id)).map((m) => m.tag).join(', ') || '按主题自然定';
  const remixRule = $('#remixInput').value.trim()
    ? 'Remix 改编规则：保留原作的情绪骨架与意象基因，重写全新歌名与歌词；禁止复制原作任何句子，禁止沿用原歌名。'
    : '';
  return [
    '你是顶级作词人，为 Suno AI 生成可直接粘贴的歌词三件套。',
    '输出规则：只输出一个 JSON 对象，禁止输出任何其它文字、禁止 markdown 围栏。',
    'JSON 字段：',
    '- title：歌名，简短有画面感。',
    '- style_tags：全英文风格标签，逗号分隔，含流派、人声性别、乐器、氛围、BPM。绝对禁止出现任何真实艺人、乐队或品牌名称（平台会屏蔽），用描述性词汇代替。',
    '- lyrics：带 Suno 段落标签的完整歌词，段落间用 \\n 分隔，歌词内不得出现任何说明性文字。',
    `歌词语言规则：${langRule}`,
    `曲风写法：${guides.join('；') || '流行歌标准写法'}`,
    `情绪基调：${moodWords}`,
    `结构模板：${P.structs[state.genres.length ? state.genres[0].struct : 'pop']}`,
    ...(remixRule ? [remixRule] : []),
    '每段歌词 4-6 行（Rap/Trap 按写法指南调整），全曲控制在 45 行以内，押韵自然。',
    '再次强调：输出必须是合法 JSON，lyrics 内的换行写成 \\n。',
  ].join('\n');
}

function buildUser(theme) {
  let msg = `主题：${theme}\n请创作一首完整歌曲。`;
  if (state.artists.length) msg += `\n歌手气质参考：${state.artists.map((a) => a.label).join('、')}（仅借鉴气质与写法，标签不得出现艺人名）。`;
  if (state.styleCards.length) msg += `\n风格参考：${state.styleCards.map((s) => s.label).join('、')}。`;
  if (state.genres.length) msg += `\n曲风参考：${state.genres.map((g) => g.label).join('、')}。`;
  if (state.vocal) msg += `\n人声类型：${state.vocal.label}。`;
  const remix = $('#remixInput').value.trim();
  if (remix) msg += `\nRemix 原作歌词（仅供改编参考，禁止复制原句）：\n${remix}`;
  return msg;
}

/* ---------- streaming parse ---------- */

function extractPartial(buf) {
  const out = { title: '', style_tags: '', lyrics: '', done: {} };
  for (const key of ['title', 'style_tags', 'lyrics']) {
    const strRe = new RegExp('"' + key + '"\\s*:\\s*"');
    const arrRe = new RegExp('"' + key + '"\\s*:\\s*\\[');
    const mStr = strRe.exec(buf);
    const mArr = arrRe.exec(buf);
    if (!mStr && !mArr) continue;
    let s = '';
    let closed = false;
    if (mStr) {
      let i = mStr.index + mStr[0].length;
      while (i < buf.length) {
        const c = buf[i];
        if (c === '\\') {
          const n = buf[i + 1];
          if (n === undefined) break;
          if (n === 'n') s += '\n';
          else if (n === 't') s += ' ';
          else if (n === 'u') {
            const hex = buf.slice(i + 2, i + 6);
            if (hex.length < 4) break;
            s += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          } else s += n;
          i += 2;
        } else if (c === '"') {
          closed = true;
          break;
        } else {
          s += c;
          i += 1;
        }
      }
    } else {
      // array form: join quoted items as they stream in
      let i = mArr.index + mArr[0].length;
      while (i < buf.length) {
        if (buf[i] === ']') { closed = true; break; }
        if (buf[i] === '"') {
          i += 1;
          let item = '';
          while (i < buf.length) {
            const q = buf[i];
            if (q === '\\') { i += 2; continue; }
            if (q === '"') { i += 1; break; }
            item += q;
            i += 1;
          }
          if (item) s += (s ? ', ' : '') + item;
          continue;
        }
        i += 1;
      }
    }
    out[key] = s;
    out.done[key] = closed;
  }
  return out;
}

function norm(v, sep) {
  if (Array.isArray(v)) return v.join(sep);
  return typeof v === 'string' ? v : '';
}

function parseFull(raw) {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object') {
      return {
        title: norm(j.title, ''),
        style_tags: norm(j.style_tags || j.style, ', '),
        lyrics: norm(j.lyrics || j.lyric_lines, '\n'),
      };
    }
  } catch { /* fall through */ }
  const p = extractPartial(raw);
  if (p.lyrics) {
    return { title: p.title, style_tags: p.style_tags, lyrics: p.lyrics };
  }
  return { title: '', style_tags: '', lyrics: raw.trim() };
}

/* ---------- render ---------- */

function renderPartial(p, streaming) {
  const caret = streaming ? '<span class="caret">▍</span>' : '';
  $('#titleOut').innerHTML = p.title ? esc(p.title) + caret : '<span class="placeholder">等待生成…</span>';
  $('#tagsOut').innerHTML = p.style_tags ? esc(p.style_tags) + caret : '<span class="placeholder">粘贴进 Suno 的 Style 框</span>';
  $('#lyricsOut').innerHTML = p.lyrics ? renderLyrics(p.lyrics) + caret : '<span class="placeholder">带 [Verse] [Chorus] 标签的完整歌词</span>';
}

function renderLyrics(text) {
  return text.split('\n').map((line) => {
    const m = line.match(/^(\[[^\]]+\]\s*)(.*)$/);
    return m ? `<span class="tag">${esc(m[1])}</span>${esc(m[2])}` : esc(line);
  }).join('\n');
}

function renderFinal(res) {
  state.out = res;
  $('#titleOut').innerHTML = res.title ? esc(res.title) : '<span class="placeholder">（无歌名）</span>';
  $('#tagsOut').innerHTML = res.style_tags ? esc(res.style_tags) : '<span class="placeholder">（无风格标签）</span>';
  $('#lyricsOut').innerHTML = res.lyrics ? renderLyrics(res.lyrics) : '<span class="placeholder">（无歌词）</span>';
  buildRewriteRow();
  updateStats();
}

function resetOut() {
  state.out = { title: '', style_tags: '', lyrics: '' };
  renderPartial({ title: '', style_tags: '', lyrics: '' }, false);
  $('#reasonBox').hidden = true;
  $('#reasonOut').textContent = '';
  $('#rewriteRow').innerHTML = '';
  $('#statsOut').textContent = '';
}

function setBusy(on) {
  document.body.classList.toggle('busy', on);
  const st = $('#status');
  st.hidden = !on;
  st.textContent = on ? 'generating…' : '';
  $('#genBtn').hidden = on;
  $('#stopBtn').hidden = !on;
}

/* ---------- streaming client ---------- */

let lastTps = null;

async function streamChat(messages, params, onContent) {
  const controller = new AbortController();
  state.abort = controller;
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      reasoning_effort: params.reasoning,
      temperature: params.temp,
      max_tokens: params.maxTok,
      model: params.model || undefined,
    }),
    signal: controller.signal,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
    throw new Error(j.error || 'HTTP ' + res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = '';
  let full = '';
  let reason = '';
  const t0 = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = sseBuf.indexOf('\n')) >= 0) {
      const line = sseBuf.slice(0, nl).trim();
      sseBuf = sseBuf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(data); } catch { continue; }
      if (evt.timings && evt.timings.predicted_per_second) {
        lastTps = evt.timings.predicted_per_second;
        $('#status').textContent = 'generating… ' + Math.round(lastTps) + ' tok/s';
      } else if (evt.usage && evt.usage.completion_tokens) {
        lastTps = evt.usage.completion_tokens / ((performance.now() - t0) / 1000);
      }
      const delta = evt.choices && evt.choices[0] && evt.choices[0].delta;
      if (!delta) continue;
      if (delta.content) full += delta.content;
      if (delta.reasoning_content) {
        reason += delta.reasoning_content;
        $('#reasonBox').hidden = false;
        $('#reasonOut').textContent = reason;
      }
      if (full) {
        const secs = (performance.now() - t0) / 1000;
        if (secs > 0.5) {
          lastTps = full.length / 3.5 / secs;
          $('#status').textContent = 'generating… ~' + Math.round(lastTps) + ' tok/s';
        }
        onContent(full);
      }
    }
  }
  if (!full) throw new Error('模型没有返回内容');
  return full;
}

/* ---------- generate ---------- */

async function generate() {
  let theme = $('#theme').value.trim();
  const remix = $('#remixInput').value.trim();
  if (!theme && !remix) { toast('先写个主题、点「随机灵感」，或扔一首歌进 Remix'); return; }
  if (!theme) theme = '把下面这首原作 remix 成一首全新歌曲';
  if (state.busy) return;

  state.busy = true;
  setBusy(true);
  resetOut();
  lastTps = null;

  const messages = [
    { role: 'system', content: buildSystem() },
    { role: 'user', content: buildUser(theme) },
  ];

  try {
    const full = await streamChat(
      messages,
      { reasoning: state.thinking ? 'high' : 'none', temp: state.params.temp, maxTok: state.params.maxTok, model: state.params.model },
      (content) => renderPartial(extractPartial(content), true),
    );
    const parsed = parseFull(full);
    renderFinal(parsed);
    addHistory(parsed, theme);
    toast('生成完成 ✦');
  } catch (e) {
    if (e.name === 'AbortError') toast('已停止生成');
    else toast('生成失败：' + e.message);
  } finally {
    state.busy = false;
    setBusy(false);
    state.abort = null;
  }
}

/* ---------- section rewrite ---------- */

async function rewriteSection(tag) {
  if (state.busy) return;
  if (!state.out.lyrics) { toast('先生成一首歌'); return; }
  state.busy = true;
  setBusy(true);
  lastTps = null;

  const messages = [
    { role: 'system', content: '你是顶级作词人。只重写歌词中指定的段落，其余段落一字不改。输出完整歌词全文（带段落标签，段落间用换行），禁止 JSON，禁止解释，禁止 markdown 围栏。' },
    { role: 'user', content: `歌词全文：\n${state.out.lyrics}\n\n只重写 [${tag}] 段落：该段内容全部重写（保持该段标签行不变、行数相近），其余段落保持完全一致。语言、押韵风格、人声标注保持一致。` },
  ];

  try {
    const full = await streamChat(
      messages,
      { reasoning: 'none', temp: state.params.temp, maxTok: state.params.maxTok, model: state.params.model },
      (content) => { $('#lyricsOut').innerHTML = renderLyrics(content) + '<span class="caret">▍</span>'; },
    );
    const lyrics = full.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    const updated = { title: state.out.title, style_tags: state.out.style_tags, lyrics };
    renderFinal(updated);
    addHistory(updated, $('#theme').value.trim() || '局部重写 ' + tag);
    toast(`[${tag}] 已重写 ✦`);
  } catch (e) {
    if (e.name === 'AbortError') toast('已停止重写');
    else toast('重写失败：' + e.message);
    renderFinal(state.out);
  } finally {
    state.busy = false;
    setBusy(false);
    state.abort = null;
  }
}

function buildRewriteRow() {
  const row = $('#rewriteRow');
  row.innerHTML = '';
  if (!state.out.lyrics) return;
  const seen = [];
  for (const m of state.out.lyrics.matchAll(/\[([^\]]+)\]/g)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  for (const t of seen) {
    row.appendChild(chipEl('重写 ' + t, false, () => rewriteSection(t)));
  }
}

/* ---------- stats ---------- */

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function updateStats() {
  const o = state.out;
  const parts = [];
  if (o.lyrics) {
    const lines = o.lyrics.split('\n').filter((l) => l.trim()).length;
    parts.push(lines + ' 行');
    parts.push(o.lyrics.replace(/\s/g, '').length + ' 字');
    const bpm = (o.style_tags.match(/(\d{2,3})\s*bpm/i) || [])[1];
    if (bpm) parts.push('≈' + fmtDur((lines * 4 * 60) / Number(bpm)));
  }
  if (lastTps) parts.push('~' + Math.round(lastTps) + ' tok/s');
  $('#statsOut').textContent = parts.join(' · ');
}

$('#genBtn').addEventListener('click', generate);
$('#regenBtn').addEventListener('click', generate);
$('#stopBtn').addEventListener('click', () => { if (state.abort) state.abort.abort(); });

$('#diceBtn').addEventListener('click', () => {
  const list = P.inspirations;
  $('#theme').value = list[Math.floor(Math.random() * list.length)];
});
$('#clearBtn').addEventListener('click', () => { $('#theme').value = ''; });
$('#remixBtn').addEventListener('click', () => {
  const on = $('#remixBtn').classList.toggle('active');
  $('#remixField').hidden = !on;
  if (on) $('#remixInput').focus();
});
$('#settingsBtn').addEventListener('click', (ev) => {
  ev.stopPropagation();
  $('#settingsPanel').hidden = !$('#settingsPanel').hidden;
});
document.addEventListener('click', (ev) => {
  if (!$('#settingsPanel').hidden && !ev.target.closest('.settings-wrap')) $('#settingsPanel').hidden = true;
});

$('#blindBtn').addEventListener('click', () => {
  const pick = (list, n) => [...list].sort(() => Math.random() - 0.5).slice(0, n);
  $('#theme').value = pick(P.inspirations, 1)[0];
  state.artists = pick(P.artists, 1 + Math.floor(Math.random() * 2));
  state.styleCards = pick(P.styles, 1 + Math.floor(Math.random() * 2));
  state.genres = pick(P.genres, 1 + Math.floor(Math.random() * 2));
  state.moods = new Set(pick(P.moods, Math.floor(Math.random() * 3)));
  state.vocal = pick(P.vocals, 1)[0];
  renderChips();
  refreshDropdowns();
  toast('盲盒配方已装填 🎰');
});
$('#saveEditBtn').addEventListener('click', () => {
  const title = $('#titleOut').textContent.replace('▍', '').trim();
  const tags = $('#tagsOut').textContent.replace('▍', '').trim();
  if (!state.out.lyrics && !title) { toast('还没有内容可保存'); return; }
  state.out = { title, style_tags: tags, lyrics: state.out.lyrics };
  renderFinal(state.out);
  addHistory(state.out, $('#theme').value.trim() || title || '手动修改');
  toast('修改已保存进历史 ✦');
});

/* ---------- copy ---------- */

async function copyText(text) {
  if (!text) { toast('还没有内容可复制'); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制 ✓');
  } catch {
    toast('复制失败（浏览器限制）');
  }
}

document.querySelectorAll('.copy').forEach((btn) => {
  btn.addEventListener('click', () => {
    const which = btn.dataset.copy;
    copyText(state.out[which === 'tags' ? 'style_tags' : which]);
  });
});

$('#copyAllBtn').addEventListener('click', () => {
  const o = state.out;
  if (!o.lyrics) { toast('还没有内容可复制'); return; }
  copyText(`Title: ${o.title}\n\nStyle: ${o.style_tags}\n\nLyrics:\n${o.lyrics}`);
});

/* ---------- history ---------- */

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveHistory(list) {
  const fav = list.filter((x) => x.fav);
  const rest = list.filter((x) => !x.fav).slice(0, Math.max(0, 20 - fav.length));
  const kept = [...fav, ...rest];
  localStorage.setItem(HISTORY_KEY, JSON.stringify(kept));
  $('#histCount').textContent = kept.length;
  renderHistory(kept);
}

function addHistory(res, theme) {
  const list = loadHistory();
  list.unshift({
    title: res.title,
    style_tags: res.style_tags,
    lyrics: res.lyrics,
    theme,
    remix: $('#remixInput').value.trim() || null,
    langs: state.langs,
    genres: state.genres.map((g) => g.id),
    artists: state.artists.map((a) => a.id),
    styleCards: state.styleCards.map((s) => s.id),
    vocal: state.vocal ? state.vocal.id : null,
    ts: Date.now(),
  });
  saveHistory(list);
}

function downloadTxt(item) {
  const text = `Title: ${item.title || ''}\n\nStyle: ${item.style_tags || ''}\n\nLyrics:\n${item.lyrics || ''}`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(item.title || 'lyrics').replace(/[\\/:*?"<>|]/g, '_')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
  toast('已导出 txt ⬇');
}

function renderHistory(list) {
  const box = $('#histList');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<span class="placeholder">暂无历史</span>';
    return;
  }
  for (const item of list) {
    const el = document.createElement('div');
    el.className = 'hist-item';
    const t = new Date(item.ts);
    const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    el.innerHTML =
      `<span class="t">${hhmm}</span><span class="name">${esc(item.title || item.theme)}</span>` +
      `<span class="acts"><button class="hbtn fav${item.fav ? ' on' : ''}">${item.fav ? '★' : '☆'}</button>` +
      `<button class="hbtn rn">✎</button><button class="hbtn ex">⬇</button><span class="del">✕</span></span>`;
    el.querySelector('.fav').addEventListener('click', (ev) => {
      ev.stopPropagation();
      item.fav = !item.fav;
      saveHistory(list);
    });
    el.querySelector('.rn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const name = prompt('给这首歌起个名字', item.title || item.theme);
      if (name && name.trim()) {
        item.title = name.trim();
        saveHistory(list);
      }
    });
    el.querySelector('.ex').addEventListener('click', (ev) => {
      ev.stopPropagation();
      downloadTxt(item);
    });
    el.querySelector('.del').addEventListener('click', (ev) => {
      ev.stopPropagation();
      saveHistory(list.filter((x) => x.ts !== item.ts));
    });
    el.addEventListener('click', () => restore(item));
    box.appendChild(el);
  }
}

function restore(item) {
  $('#theme').value = item.theme || '';
  const rem = item.remix || '';
  $('#remixInput').value = rem;
  $('#remixField').hidden = !rem;
  $('#remixBtn').classList.toggle('active', !!rem);
  state.langs = item.langs || (item.lang ? [item.lang] : ['zh']);
  state.genres = (item.genres || (item.genre ? [item.genre] : []))
    .map((id) => P.genres.find((g) => g.id === id))
    .filter(Boolean);
  state.artists = (item.artists || (item.artist ? [item.artist] : []))
    .map((id) => P.artists.find((a) => a.id === id))
    .filter(Boolean);
  state.styleCards = (item.styleCards || (item.styleCard ? [item.styleCard] : []))
    .map((id) => P.styles.find((s) => s.id === id))
    .filter(Boolean);
  state.vocal = P.vocals.find((v) => v.id === item.vocal) || null;
  state.moods.clear();
  renderChips();
  refreshDropdowns();
  renderFinal({ title: item.title, style_tags: item.style_tags, lyrics: item.lyrics });
  toast('已回填历史 ✦');
}

makeDropdown('artist', '#artistBtn', '#artistPanel', '#artistSearch', '#artistGrid', null, { multi: true, arr: 'artists' });
makeDropdown('style', '#styleBtn', '#stylePanel', '#styleSearch', '#styleGrid', null, { multi: true, arr: 'styleCards' });
makeDropdown('genre', '#genreBtn', '#genrePanel', '#genreSearch', '#genreGrid', null, { multi: true, arr: 'genres' });

$('#histCount').textContent = loadHistory().length;
renderHistory(loadHistory());
renderChips();
refreshDropdowns();

/* ---------- params ---------- */

async function loadModels() {
  const sel = $('#modelSelect');
  try {
    const r = await fetch('/api/models');
    const j = r.ok ? await r.json() : { models: [] };
    const ids = (j.models || j.data || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
    sel.innerHTML = '';
    if (ids.length) {
      for (const id of ids) sel.appendChild(new Option(id, id));
      state.params.model = sel.value;
    } else {
      sel.appendChild(new Option('服务端默认模型', ''));
    }
  } catch {
    sel.innerHTML = '';
    sel.appendChild(new Option('服务端默认模型', ''));
  }
  sel.addEventListener('change', () => {
    state.params.model = sel.value;
    toast(sel.value ? '模型：' + sel.value : '用服务端默认模型');
  });
}
loadModels();

$('#tempRange').addEventListener('input', (e) => {
  state.params.temp = Number(e.target.value);
  $('#tempVal').textContent = e.target.value;
});
$('#maxTokRange').addEventListener('input', (e) => {
  state.params.maxTok = Number(e.target.value);
  $('#maxTokVal').textContent = e.target.value;
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
