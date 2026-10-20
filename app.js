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

/* ---------- versions ---------- */

let versions = [];
let verIdx = 0;
let curHistTs = null;

function syncHistory(note) {
  const h = histAll.find((x) => x.ts === curHistTs);
  if (h) {
    h.title = state.out.title || h.title;
    h.style_tags = state.out.style_tags || h.style_tags;
    h.lyrics = versions[verIdx] ? versions[verIdx].lyrics : state.out.lyrics;
    h.versions = versions.map((v) => ({ lyrics: v.lyrics, note: v.note }));
    h.verIdx = verIdx;
  } else {
    addHistory(state.out, note || $('#theme').value.trim() || '局部重写');
    curHistTs = histAll[0].ts;
  }
  saveHistory();
}

function restoreVersions(item) {
  const vs = item.versions && item.versions.length
    ? item.versions.map((v) => ({ lyrics: v.lyrics, note: v.note }))
    : [{ lyrics: item.lyrics, note: '原版' }];
  versions = vs;
  verIdx = item.verIdx != null ? Math.min(Math.max(item.verIdx, 0), vs.length - 1) : 0;
  state.out = { ...state.out, lyrics: versions[verIdx].lyrics };
  $('#lyricsOut').innerHTML = renderLyrics(versions[verIdx].lyrics);
  buildRewriteRow();
  renderVerRow();
}

function resetVersions(lyrics) {
  versions = lyrics ? [{ lyrics, note: '原版' }] : [];
  verIdx = 0;
  renderVerRow();
}

function pushVersion(lyrics, note) {
  if (!versions.length) return;
  versions.push({ lyrics, note });
  verIdx = versions.length - 1;
  renderVerRow();
}

function renderVerRow() {
  const row = $('#verRow');
  row.innerHTML = '';
  if (versions.length < 2) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  versions.forEach((v, i) => {
    const b = chipEl(`V${i + 1} · ${v.note}`, i === verIdx, () => {
      if (i === verIdx) return;
      verIdx = i;
      state.out = { ...state.out, lyrics: versions[i].lyrics };
      renderFinal(state.out);
      renderVerRow();
      syncHistory();
      toast(`切到 V${i + 1}（${v.note}）`);
    });
    b.title = `切换到 V${i + 1}：${v.note}`;
    row.appendChild(b);
  });
}

function renderFinal(res) {
  state.out = res;
  $('#titleOut').innerHTML = res.title ? esc(res.title) : '<span class="placeholder">（无歌名）</span>';
  $('#tagsOut').innerHTML = res.style_tags ? esc(res.style_tags) : '<span class="placeholder">（无风格标签）</span>';
  $('#lyricsOut').innerHTML = res.lyrics ? renderLyrics(res.lyrics) : '<span class="placeholder">（无歌词）</span>';
  buildRewriteRow();
  updateStats();
  sunoStep = 0;
  setSunoBtnLabel();
}

function resetOut() {
  state.out = { title: '', style_tags: '', lyrics: '' };
  renderPartial({ title: '', style_tags: '', lyrics: '' }, false);
  $('#reasonBox').hidden = true;
  $('#reasonOut').textContent = '';
  $('#rewriteRow').innerHTML = '';
  $('#statsOut').textContent = '';
  resetVersions('');
  curHistTs = null;
  sunoStep = 0;
  setSunoBtnLabel();
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
    resetVersions(parsed.lyrics);
    addHistory(parsed, theme);
    curHistTs = histAll[0].ts;
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

function normalizeBlock(raw, tag) {
  let text = raw.trim().replace(/^```(?:\w*)?\s*/i, '').replace(/```$/, '');
  const lines = text.split('\n').map((l) => l.trimEnd());
  const startIdx = lines.findIndex((l) => l.includes(`[${tag}]`));
  const kept = startIdx >= 0 ? lines.slice(startIdx) : lines;
  while (kept.length && kept[0].trim() === '') kept.shift();
  // 若模型多输出了后续段落，截到下一个标签行为止
  for (let i = 1; i < kept.length; i++) {
    if (/^\s*\[[^\]]+\]/.test(kept[i])) { kept.length = i; break; }
  }
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
  if (!kept.length) return null;
  if (!/^\s*\[[^\]]+\]/.test(kept[0])) kept.unshift(`[${tag}]`);
  return kept;
}

function spliceRewritten(orig, tag, blockLines) {
  const lines = orig.split('\n');
  const isTag = (ln) => /^\s*\[[^\]]+\]/.test(ln);
  const start = lines.findIndex((ln) => {
    const m = ln.match(/^\s*\[([^\]]+)\]/);
    return m && m[1] === tag;
  });
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isTag(lines[i])) { end = i; break; }
  }
  const repl = [...blockLines];
  if (end < lines.length && lines[end - 1]?.trim() === '') repl.push('');
  return [...lines.slice(0, start), ...repl, ...lines.slice(end)].join('\n');
}

async function rewriteSection(tag) {
  if (state.busy) return;
  if (!state.out.lyrics) { toast('先生成一首歌'); return; }
  state.busy = true;
  setBusy(true);
  lastTps = null;

  const messages = [
    { role: 'system', content: '你是顶级作词人。重写歌词中指定的段落，只输出该段落本身：第一行原样保留段落标签行，随后是该段的新内容，行数与原段相近。禁止输出其他段落，禁止 JSON，禁止解释，禁止 markdown 围栏。' },
    { role: 'user', content: `歌词全文：\n${state.out.lyrics}\n\n只重写 [${tag}] 段落：该段内容全部重写，语言、押韵风格、人声标注保持一致。只输出这一段。` },
  ];

  try {
    const out = await streamChat(
      messages,
      { reasoning: 'none', temp: state.params.temp, maxTok: state.params.maxTok, model: state.params.model },
      (content) => { $('#lyricsOut').innerHTML = renderLyrics(content) + '<span class="caret">▍</span>'; },
    );
    const block = normalizeBlock(out, tag);
    const merged = block ? spliceRewritten(state.out.lyrics, tag, block) : null;
    if (!merged) {
      toast('没找到对应段落，歌词未改动');
      renderFinal(state.out);
      return;
    }
    const curTitle = $('#titleOut').textContent.trim();
    const curTags = $('#tagsOut').textContent.trim();
    const updated = {
      title: curTitle && !curTitle.startsWith('（') ? curTitle : state.out.title,
      style_tags: curTags && !curTags.startsWith('（') ? curTags : state.out.style_tags,
      lyrics: merged,
    };
    renderFinal(updated);
    pushVersion(merged, '重写 ' + tag);
    syncHistory('局部重写 ' + tag);
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

/* ---------- theme picker ---------- */

function renderPickList() {
  const q = $('#pickSearch').value.trim().toLowerCase();
  const box = $('#pickList');
  box.innerHTML = '';
  const list = P.inspirations.filter((s) => !q || s.toLowerCase().includes(q));
  if (!list.length) {
    box.innerHTML = '<span class="placeholder">没有匹配的灵感</span>';
    return;
  }
  for (const s of list) {
    const el = document.createElement('div');
    el.className = 'pick-item';
    el.textContent = s;
    el.addEventListener('click', () => {
      $('#theme').value = s;
      $('#pickPanel').hidden = true;
      $('#theme').focus();
    });
    box.appendChild(el);
  }
}

$('#themePickBtn').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const p = $('#pickPanel');
  p.hidden = !p.hidden;
  if (!p.hidden) {
    $('#pickSearch').value = '';
    renderPickList();
    $('#pickSearch').focus();
  }
});
$('#pickSearch').addEventListener('input', renderPickList);
document.addEventListener('click', (ev) => {
  if (!$('#pickPanel').hidden && !ev.target.closest('.pick-area')) $('#pickPanel').hidden = true;
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

/* ---------- Suno staged copy ---------- */

let sunoStep = 0;
function setSunoBtnLabel() {
  $('#copyAllBtn').textContent =
    sunoStep === 0 ? '⧉ Suno 第一步：复制 Style'
    : sunoStep === 1 ? '⧉ Suno 第二步：复制 Lyrics'
    : '⧉ Suno 复制完成 · 点一下重来';
}

$('#copyAllBtn').addEventListener('click', async () => {
  const o = state.out;
  if (!o.lyrics) { toast('还没有内容可复制'); return; }
  if (sunoStep >= 2) {
    sunoStep = 0;
    setSunoBtnLabel();
    toast('从头再来：先复制 Style');
    return;
  }
  const step0HasTags = sunoStep === 0 && !!o.style_tags;
  try {
    await navigator.clipboard.writeText(step0HasTags ? o.style_tags : o.lyrics);
    if (step0HasTags) {
      sunoStep = 1;
      toast('已复制 Style 标签 → 粘贴进 Suno 的 Styles 框，再点一下复制歌词 ✓');
    } else {
      sunoStep = 2;
      toast('已复制歌词 → 粘贴进 Suno 的 Lyrics 框 ✓');
    }
    setSunoBtnLabel();
  } catch {
    toast('复制失败（浏览器限制）');
  }
});

/* ---------- history ---------- */

let histAll = loadHistory();
const HIST_PAGE = 10;
const histState = { page: 0, q: '' };

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}

function saveHistory() {
  const fav = histAll.filter((x) => x.fav);
  const rest = histAll.filter((x) => !x.fav).slice(0, Math.max(0, 100 - fav.length));
  localStorage.setItem(HISTORY_KEY, JSON.stringify([...fav, ...rest]));
  histAll = loadHistory();
  histState.page = 0;
  renderHistory();
}

function histFiltered() {
  const q = histState.q.trim().toLowerCase();
  if (!q) return histAll;
  return histAll.filter((x) => `${x.title || ''} ${x.theme || ''}`.toLowerCase().includes(q));
}

function dateLabel(ts) {
  const t = new Date(ts);
  const md = `${t.getMonth() + 1}月${t.getDate()}日`;
  return t.getFullYear() === new Date().getFullYear() ? md : `${t.getFullYear()}年${md}`;
}

function addHistory(res, theme) {
  histAll.unshift({
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
  saveHistory();
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

function renderHistory() {
  const list = histFiltered();
  const pages = Math.max(1, Math.ceil(list.length / HIST_PAGE));
  histState.page = Math.min(Math.max(histState.page, 0), pages - 1);
  const slice = list.slice(histState.page * HIST_PAGE, (histState.page + 1) * HIST_PAGE);

  const box = $('#histList');
  box.innerHTML = '';
  if (!slice.length) {
    box.innerHTML = `<span class="placeholder">${histState.q ? '没有匹配的历史' : '暂无历史'}</span>`;
  } else {
    let lastDate = '';
    for (const item of slice) {
      const d = dateLabel(item.ts);
      if (d !== lastDate) {
        lastDate = d;
        const hd = document.createElement('div');
        hd.className = 'hist-date';
        hd.textContent = d;
        box.appendChild(hd);
      }
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
        saveHistory();
      });
      el.querySelector('.rn').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const name = prompt('给这首歌起个名字', item.title || item.theme);
        if (name && name.trim()) {
          item.title = name.trim();
          saveHistory();
        }
      });
      el.querySelector('.ex').addEventListener('click', (ev) => {
        ev.stopPropagation();
        downloadTxt(item);
      });
      el.querySelector('.del').addEventListener('click', (ev) => {
        ev.stopPropagation();
        histAll = histAll.filter((x) => x.ts !== item.ts);
        saveHistory();
      });
      el.addEventListener('click', () => restore(item));
      box.appendChild(el);
    }
  }

  $('#histPageText').textContent = `${histState.page + 1} / ${pages}`;
  $('#histPrev').disabled = histState.page <= 0;
  $('#histNext').disabled = histState.page >= pages - 1;
  $('#histCount').textContent = histAll.length;
}

$('#histPrev').addEventListener('click', () => {
  histState.page--;
  renderHistory();
});
$('#histNext').addEventListener('click', () => {
  histState.page++;
  renderHistory();
});
$('#histSearch').addEventListener('input', (e) => {
  histState.q = e.target.value;
  histState.page = 0;
  renderHistory();
});

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
  curHistTs = item.ts;
  restoreVersions(item);
  toast('已回填历史 ✦');
}

makeDropdown('artist', '#artistBtn', '#artistPanel', '#artistSearch', '#artistGrid', null, { multi: true, arr: 'artists' });
makeDropdown('style', '#styleBtn', '#stylePanel', '#styleSearch', '#styleGrid', null, { multi: true, arr: 'styleCards' });
makeDropdown('genre', '#genreBtn', '#genrePanel', '#genreSearch', '#genreGrid', null, { multi: true, arr: 'genres' });

/* ---------- data maintenance ---------- */

const PRESETS_KEY = 'ilyrics_presets';
const DATA_TABS = [
  { key: 'inspirations', label: '主题灵感', kind: 'text' },
  { key: 'langs', label: '语言', kind: 'obj' },
  { key: 'artists', label: '歌手', kind: 'obj', guide: true },
  { key: 'styles', label: '风格', kind: 'obj', guide: true },
  { key: 'genres', label: '曲风', kind: 'obj' },
  { key: 'moods', label: '情绪', kind: 'obj', tag: true },
  { key: 'vocals', label: '人声', kind: 'obj', tag: true },
];

let currentDataTab = 'inspirations';

const DEFAULTS = {};
for (const t of DATA_TABS) DEFAULTS[t.key] = structuredClone(P[t.key]);

try {
  const saved = JSON.parse(localStorage.getItem(PRESETS_KEY)) || {};
  for (const t of DATA_TABS) if (Array.isArray(saved[t.key])) P[t.key] = saved[t.key];
} catch {}

function dataTab() {
  return DATA_TABS.find((t) => t.key === currentDataTab);
}

function persistData(key) {
  const o = JSON.parse(localStorage.getItem(PRESETS_KEY)) || {};
  o[key] = P[key];
  localStorage.setItem(PRESETS_KEY, JSON.stringify(o));
}

function pruneTo(key) {
  if (key === 'inspirations') return;
  const ids = P[key].map((x) => x.id);
  if (key === 'langs') state.langs = state.langs.filter((id) => ids.includes(id));
  else if (key === 'artists') state.artists = state.artists.filter((a) => ids.includes(a.id));
  else if (key === 'styles') state.styleCards = state.styleCards.filter((s) => ids.includes(s.id));
  else if (key === 'genres') state.genres = state.genres.filter((g) => ids.includes(g.id));
  else if (key === 'moods') state.moods = new Set([...state.moods].filter((id) => ids.includes(id)));
  else if (key === 'vocals' && state.vocal && !ids.includes(state.vocal.id)) state.vocal = null;
}

function refreshAll() {
  persistData(currentDataTab);
  renderChips();
  refreshDropdowns();
  renderDataTabs();
  renderDataList();
}

function renderDataTabs() {
  const box = $('#dataTabs');
  box.innerHTML = '';
  for (const t of DATA_TABS) {
    box.appendChild(chipEl(`${t.label} ${P[t.key].length}`, currentDataTab === t.key, () => {
      currentDataTab = t.key;
      renderDataTabs();
      renderDataList();
    }));
  }
}

function renderDataList() {
  const tab = dataTab();
  const list = P[currentDataTab];
  const box = $('#dataList');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = '<span class="placeholder">暂无条目</span>';
    return;
  }
  list.forEach((item, idx) => {
    const label = tab.kind === 'text' ? item : item.label;
    const extra = (tab.guide || tab.tag) ? (item.guide || item.tag || '') : '';
    const row = document.createElement('div');
    row.className = 'data-row';
    row.innerHTML =
      `<span class="dl-name">${esc(label)}</span>` +
      (extra ? `<span class="dl-guide">${esc(extra)}</span>` : '') +
      `<span class="dl-acts"><button class="hbtn rn">✎</button><button class="hbtn del">✕</button></span>`;
    row.querySelector('.rn').addEventListener('click', () => {
      const name = prompt('名称', label);
      if (name === null) return;
      if (!name.trim()) { toast('名称不能为空'); return; }
      if (tab.kind === 'text') {
        list[idx] = name.trim();
      } else {
        const next = { ...item, label: name.trim() };
        if (tab.guide) {
          const g = prompt('提示（留空则删除）', item.guide || '');
          if (g === null) return;
          if (g.trim()) next.guide = g.trim();
          else delete next.guide;
        }
        if (tab.tag) {
          const tg = prompt('英文 tag（留空则删除）', item.tag || '');
          if (tg === null) return;
          if (tg.trim()) next.tag = tg.trim();
          else delete next.tag;
        }
        list[idx] = next;
      }
      refreshAll();
      toast('已更新 ✎');
    });
    row.querySelector('.del').addEventListener('click', () => {
      list.splice(idx, 1);
      if (tab.kind === 'obj') pruneTo(currentDataTab);
      refreshAll();
      toast('已删除 ✕');
    });
    box.appendChild(row);
  });
}

$('#dataAddBtn').addEventListener('click', () => {
  const input = $('#dataAdd');
  const label = input.value.trim();
  if (!label) { toast('先写一条内容'); return; }
  const tab = dataTab();
  if (tab.kind === 'text') {
    P[currentDataTab].push(label);
  } else {
    const item = { id: 'c' + Date.now().toString(36), label };
    if (tab.guide) {
      const g = prompt('提示（可留空）', '');
      if (g === null) return;
      if (g.trim()) item.guide = g.trim();
    }
    if (tab.tag) {
      const tg = prompt('英文 tag（可留空）', '');
      if (tg === null) return;
      if (tg.trim()) item.tag = tg.trim();
    }
    P[currentDataTab].push(item);
  }
  input.value = '';
  refreshAll();
  toast('已添加 ＋');
});
$('#dataAdd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#dataAddBtn').click();
});

$('#dataRestore').addEventListener('click', () => {
  const tab = dataTab();
  if (!confirm(`把「${tab.label}」恢复为内置默认？自定义内容会清空`)) return;
  P[currentDataTab] = structuredClone(DEFAULTS[currentDataTab]);
  pruneTo(currentDataTab);
  refreshAll();
  toast('已恢复默认 ↺');
});

$('#dataBtn').addEventListener('click', () => {
  $('#dataOverlay').hidden = false;
  renderDataTabs();
  renderDataList();
});
$('#dataClose').addEventListener('click', () => {
  $('#dataOverlay').hidden = true;
});
$('#dataOverlay').addEventListener('click', (ev) => {
  if (ev.target === $('#dataOverlay')) $('#dataOverlay').hidden = true;
});

renderHistory();
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
