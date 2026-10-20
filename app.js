const P = window.PRESETS;
const $ = (s) => document.querySelector(s);

const state = {
  langs: ['zh'],
  genres: [],
  artists: [],
  styleCards: [],
  moods: new Set(),
  vocal: null,
  structure: null,
  glossary: [],
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

  const structBox = $('#structChips');
  structBox.innerHTML = '';
  for (const t of P.structTpl) {
    structBox.appendChild(chipEl(t.label, state.structure && state.structure.id === t.id, () => {
      state.structure = state.structure && state.structure.id === t.id ? null : t;
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
    const list = P[{ artist: 'artists', style: 'styles', genre: 'genres', glossary: 'glossary' }[key]];
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
  if (state.glossary.length) parts.push(state.glossary.map((g) => g.tag).join(','));
  if (state.vocal) parts.push(state.vocal.tags);
  for (const m of P.moods) if (state.moods.has(m.id)) parts.push(m.tag);
  const seen = [];
  for (const raw of parts.join(',').split(',')) {
    const t = raw.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  return seen.slice(0, 16).join(', ');
}

function buildSystem() {
  const langRule = state.langs.length === 1
    ? P.langs.find((l) => l.id === state.langs[0]).rule
    : `歌词正文以列表第一种语言（${state.langs.map((id) => P.langs.find((l) => l.id === id).label).join('、')}中的第一个）为主，全曲绝大多数行只用主语言，只在所选的这几门语言之间混写，禁止引入任何未选语言。每段至多一行在同一行内跨语言切换（code-switch），外语词嵌在行首或行中、行尾落在主语言以保住押韵（如「Karma 循环往复无休」）；副歌 signature hook 可含一个非主语言的点睛词，歌名用其中任一语言。`;
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
    '- style_tags：全英文风格标签，逗号分隔，含流派、人声性别、乐器、氛围、BPM。可借用 Suno 音乐术语增强控制：速度（adagio/andante/allegro/presto/rubato）、力度（crescendo/pianissimo/fortissimo）、织体（sparse/dense/layering）、人声技巧（falsetto/belt/melisma/crooning）、制作效果（reverb-heavy/tape compression/distorted/filtered）、调性与拍子（minor key/major key/3/4 waltz）。绝对禁止出现任何真实艺人、乐队或品牌名称（平台会屏蔽），用描述性词汇代替。',
    '- lyrics：带 Suno 段落标签的完整歌词，遵守格式铁律：标签行全大写且不含数字与标点（[VERSE] [PRE-CHORUS] [CHORUS] [POST-CHORUS] [BRIDGE] [DANCE BREAK] [OUTRO] [END]），标签行单独成行；每个段落之间空一行且只空一行；可在标签行内用竖线叠加指令，如 [CHORUS | anthemic | stacked harmonies]、[VERSE | whispered vocals | low energy]；最后一行输出 [END] 强制收尾。除括号 ad-lib 行外歌词内不得出现说明性文字：可用单独成行的圆括号句做舞台指令与钩子回响，如 (Listen)、(Drop the bass!)、(Tick, tock, loop inside my head)，每段至多 2-3 行。',
    `歌词语言规则：${langRule}`,
    `曲风写法：${guides.join('；') || '流行歌标准写法'}`,
    `情绪基调：${moodWords}`,
    `结构模板：${P.structs[state.structure ? state.structure.id : state.genres.length ? state.genres[0].struct : 'pop']}`,
    ...(state.glossary.length ? ['用户指定的音乐术语必须原样出现在 style_tags 中：' + state.glossary.map((g) => g.tag).join(', ')] : []),
    ...(remixRule ? [remixRule] : []),
    '每行歌词控制在 6-12 个音节（中文约 6-12 字），人声对齐更自然；每段 4-6 行（Rap/Trap 按写法指南调整），全曲控制在 45 行以内，押韵自然。',
    '歌词厚度要求：为整首歌选定一个贯穿全曲的隐喻域（如轮回/loop/glitch/karma/星轨/深海/潮汐），同一意象从 verse 到 bridge 逐级升级；每行歌词写两个小句（具体画面 + 隐喻或动作），禁止空泛直白陈述；副歌有一句 signature hook 贯穿每次重复（可每次微变）；叙事逐级递进：铺垫→蓄力→爆发→回响→反转或最高潮→收束；段落之间用意象呼应衔接。',
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

function canonTagLine(ln) {
  const m = ln.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (!m) return ln;
  const parts = m[1].split('|').map((p) => p.trim()).filter(Boolean);
  parts[0] = parts[0].replace(/\s*\d+$/, '').toUpperCase();
  return '[' + parts.join(' | ') + (m[2] ? '] ' + m[2] : ']');
}

function normalizeLyrics(text) {
  const lines = text.split('\n');
  const out = [];
  for (const raw of lines) {
    const ln = /^\s*\[[^\]]+\]/.test(raw) ? canonTagLine(raw) : raw;
    if (/^\s*\[[^\]]+\]/.test(ln) && out.length && out[out.length - 1].trim() !== '') {
      out.push('');
    }
    if (ln.trim() === '' && out.length && out[out.length - 1].trim() === '') continue;
    out.push(ln);
  }
  while (out.length && out[0].trim() === '') out.shift();
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

function parseFull(raw) {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object') {
      return {
        title: norm(j.title, ''),
        style_tags: norm(j.style_tags || j.style, ', '),
        lyrics: normalizeLyrics(norm(j.lyrics || j.lyric_lines, '\n')),
      };
    }
  } catch { /* fall through */ }
  const p = extractPartial(raw);
  if (p.lyrics) {
    return { title: p.title, style_tags: p.style_tags, lyrics: normalizeLyrics(p.lyrics) };
  }
  return { title: '', style_tags: '', lyrics: normalizeLyrics(raw.trim()) };
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
let diffOn = false;

function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(['ctx', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(['del', a[i]]); i++; }
    else { out.push(['add', b[j]]); j++; }
  }
  while (i < n) out.push(['del', a[i++]]);
  while (j < m) out.push(['add', b[j++]]);
  return out;
}

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
    ? item.versions.map((v) => ({ lyrics: normalizeLyrics(v.lyrics), note: v.note }))
    : [{ lyrics: normalizeLyrics(item.lyrics), note: '原版' }];
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
  if (verIdx > 0) {
    const d = chipEl('⇄ 看改动', diffOn, () => {
      diffOn = !diffOn;
      if (diffOn) {
        const rows = diffLines(versions[verIdx - 1].lyrics.split('\n'), versions[verIdx].lyrics.split('\n'));
        $('#lyricsOut').innerHTML = rows.map(([t, ln]) => `<span class="d-${t}">${t === 'del' ? '− ' : t === 'add' ? '+ ' : ''}${esc(ln)}</span>`).join('\n');
        toast(`对比 V${verIdx} → V${verIdx + 1}`);
      } else {
        $('#lyricsOut').innerHTML = renderLyrics(state.out.lyrics);
      }
      setLyricsEditable();
      renderVerRow();
    });
    d.title = '对比上一版，看这次重写改了哪些行';
    row.appendChild(d);
  }
}

function setLyricsEditable() {
  $('#lyricsOut').setAttribute('contenteditable', !state.busy && !diffOn ? 'plaintext-only' : 'false');
}

function setOutEditable() {
  const on = !state.busy;
  $('#titleOut').setAttribute('contenteditable', on ? 'true' : 'false');
  $('#tagsOut').setAttribute('contenteditable', on ? 'true' : 'false');
  setLyricsEditable();
}

$('#titleOut').addEventListener('blur', () => {
  if (state.busy) return;
  const t = $('#titleOut').textContent.trim();
  if (!state.out.title) { renderFinal(state.out); return; }
  if (!t) { $('#titleOut').innerHTML = esc(state.out.title); return; }
  if (t !== state.out.title) {
    state.out = { ...state.out, title: t };
    syncHistory();
    toast('歌名已保存进历史 ✎');
  }
});

$('#tagsOut').addEventListener('blur', () => {
  if (state.busy) return;
  const raw = $('#tagsOut').textContent.trim();
  if (!state.out.style_tags) { renderFinal(state.out); return; }
  if (!raw) { $('#tagsOut').innerHTML = esc(state.out.style_tags); return; }
  const seen = [];
  for (const p of raw.split(',')) {
    const t = p.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  const tags = seen.join(', ');
  if (tags !== state.out.style_tags) {
    state.out = { ...state.out, style_tags: tags };
    $('#tagsOut').innerHTML = esc(tags);
    syncHistory();
    toast('风格标签已保存进历史 ✎');
  }
});

$('#lyricsOut').addEventListener('blur', () => {
  if (state.busy) return;
  if (!state.out.lyrics) { renderFinal(state.out); return; }
  const norm = normalizeLyrics($('#lyricsOut').textContent);
  if (!norm) { renderFinal(state.out); toast('歌词被清空了，已还原'); return; }
  $('#lyricsOut').innerHTML = renderLyrics(norm);
  if (norm === state.out.lyrics) return;
  if (!versions.length) resetVersions(state.out.lyrics);
  state.out = { ...state.out, lyrics: norm };
  pushVersion(norm, '手动编辑');
  syncHistory('手动编辑');
  buildRewriteRow();
  renderRhyme();
  updateStats();
  toast('歌词已编辑，记为新版本 ✏️');
});

function renderFinal(res) {
  state.out = res;
  $('#titleOut').innerHTML = res.title ? esc(res.title) : '<span class="placeholder">（无歌名）</span>';
  $('#tagsOut').innerHTML = res.style_tags ? esc(res.style_tags) : '<span class="placeholder">（无风格标签）</span>';
  $('#lyricsOut').innerHTML = res.lyrics ? renderLyrics(res.lyrics) : '<span class="placeholder">（无歌词）</span>';
  buildRewriteRow();
  buildRhymeRow();
  diffOn = false;
  renderRhyme();
  updateStats();
  renderVerRow();
  setOutEditable();
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
  $('#rhymeRow').innerHTML = '';
  $('#rhymeBox').hidden = true;
  $('#rhymeBox').innerHTML = '';
  rhymeOn = false;
  $('#draftsBox').hidden = true;
  $('#draftsBox').innerHTML = '';
  document.querySelector('.output').classList.remove('drafting');
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
  $('#batchBtn').hidden = on;
  setOutEditable();
}

/* ---------- streaming client ---------- */

let lastTps = null;

async function streamChat(messages, params, onContent, signal) {
  const controller = signal || new AbortController();
  if (!signal) state.abort = controller;
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
        if (onContent) onContent(full);
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

/* ---------- batch ×3 ---------- */

async function batchGenerate() {
  if (state.busy) return;
  let theme = $('#theme').value.trim();
  const remix = $('#remixInput').value.trim();
  if (!theme && !remix) { toast('先写个主题、点「随机灵感」，或扔一首歌进 Remix'); return; }
  if (!theme) theme = '把下面这首原作 remix 成一首全新歌曲';

  state.busy = true;
  setBusy(true);
  resetOut();
  lastTps = null;
  $('#status').textContent = '批量生成 ×3…';
  document.querySelector('.output').classList.add('drafting');
  $('#draftsBox').hidden = false;
  $('#draftsBox').innerHTML = '<span class="placeholder">3 首备选并行生成中…</span>';

  const controllers = [];
  state.abort = { abort() { controllers.forEach((c) => c.abort()); } };

  const results = await Promise.all([0, 1, 2].map(async (i) => {
    const c = new AbortController();
    controllers.push(c);
    try {
      const full = await streamChat(
        [{ role: 'system', content: buildSystem() }, { role: 'user', content: buildUser(theme) }],
        { reasoning: 'none', temp: Math.min(1.3, state.params.temp + i * 0.15), maxTok: state.params.maxTok, model: state.params.model },
        null,
        c.signal,
      );
      return parseFull(full);
    } catch { return null; }
  }));

  state.busy = false;
  setBusy(false);
  state.abort = null;

  const drafts = results.filter((d) => d && d.lyrics);
  if (!drafts.length) {
    $('#draftsBox').hidden = true;
    $('#draftsBox').innerHTML = '';
    document.querySelector('.output').classList.remove('drafting');
    toast('批量生成没拿到内容');
    return;
  }
  renderDrafts(drafts);
  toast(`${drafts.length} 首备选就绪，挑一首 ✓`);
}

function renderDrafts(list) {
  const box = $('#draftsBox');
  box.innerHTML = '';
  list.forEach((d) => {
    const lines = d.lyrics.split('\n');
    const preview = lines.slice(0, 10).join('\n') + (lines.length > 10 ? '\n…' : '');
    const card = document.createElement('div');
    card.className = 'draft-card';
    card.innerHTML =
      `<div class="draft-title">${esc(d.title || '（无歌名）')}</div>` +
      `<div class="draft-tags">${esc(d.style_tags || '')}</div>` +
      `<pre class="draft-lyrics">${renderLyrics(preview)}</pre>` +
      `<div class="draft-acts"><button class="ghost pick">✓ 选这首</button><button class="ghost drop">✕ 丢弃</button></div>`;
    card.querySelector('.pick').addEventListener('click', () => chooseDraft(d));
    card.querySelector('.drop').addEventListener('click', () => {
      card.remove();
      if (!box.children.length) {
        box.hidden = true;
        document.querySelector('.output').classList.remove('drafting');
        toast('全部丢弃，回到空状态');
      }
    });
    box.appendChild(card);
  });
}

function chooseDraft(d) {
  $('#draftsBox').hidden = true;
  $('#draftsBox').innerHTML = '';
  document.querySelector('.output').classList.remove('drafting');
  renderFinal(d);
  resetVersions(d.lyrics);
  addHistory(d, $('#theme').value.trim() || d.title || '批量选歌');
  curHistTs = histAll[0].ts;
  toast('已选这首进正式输出 ✦');
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

function spliceRewritten(orig, tag, blockLines, occ = 0) {
  const lines = orig.split('\n');
  const isTag = (ln) => /^\s*\[[^\]]+\]/.test(ln);
  let start = -1;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\[([^\]]+)\]/);
    if (m && m[1] === tag) {
      if (seen === occ) { start = i; break; }
      seen++;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isTag(lines[i])) { end = i; break; }
  }
  const repl = [...blockLines];
  if (end < lines.length && lines[end - 1]?.trim() === '') repl.push('');
  return [...lines.slice(0, start), ...repl, ...lines.slice(end)].join('\n');
}

async function rewriteSection(tag, extra, label, occ = 0) {
  if (state.busy) return 'fail';
  if (!state.out.lyrics) { toast('先生成一首歌'); return 'fail'; }
  state.busy = true;
  setBusy(true);
  lastTps = null;

  const posHint = occ > 0 ? `（${tag.split('|')[0]} 在全文出现多次，要重写的是第 ${occ + 1} 次出现的那一段）` : '';

  const messages = [
    { role: 'system', content: '你是顶级作词人。重写歌词中指定的段落，只输出该段落本身：第一行原样保留段落标签行，随后是该段的新内容，行数与原段相近。括号 ad-lib 行（单独成行的圆括号句）可保留或换成新的。重写后保持原段的隐喻脉络与行密度。禁止输出其他段落，禁止 JSON，禁止解释，禁止 markdown 围栏。' },
    { role: 'user', content: `歌词全文：\n${state.out.lyrics}\n\n只重写 [${tag}] 段落${posHint}：${extra ? '该段内容全部重写，语言和人声标注保持一致。只输出这一段。\n附加要求：' + extra : '该段内容全部重写，语言、押韵风格、人声标注保持一致。只输出这一段。'}` },
  ];

  try {
    const out = await streamChat(
      messages,
      { reasoning: 'none', temp: state.params.temp, maxTok: state.params.maxTok, model: state.params.model },
      (content) => { $('#lyricsOut').innerHTML = renderLyrics(content) + '<span class="caret">▍</span>'; },
    );
    const block = normalizeBlock(out, tag);
    const spliced = block ? spliceRewritten(state.out.lyrics, tag, block, occ) : null;
    const merged = spliced ? normalizeLyrics(spliced) : null;
    if (!merged) {
      toast('没找到对应段落，歌词未改动');
      renderFinal(state.out);
      return 'miss';
    }
    const curTitle = $('#titleOut').textContent.trim();
    const curTags = $('#tagsOut').textContent.trim();
    const updated = {
      title: curTitle && !curTitle.startsWith('（') ? curTitle : state.out.title,
      style_tags: curTags && !curTags.startsWith('（') ? curTags : state.out.style_tags,
      lyrics: merged,
    };
    renderFinal(updated);
    pushVersion(merged, (label || (extra ? '押韵修复 ' : '重写 ')) + tag);
    syncHistory('局部重写 ' + tag);
    toast(`[${tag}] 已重写 ✦`);
    return 'ok';
  } catch (e) {
    if (e.name === 'AbortError') toast('已停止重写');
    else toast('重写失败：' + e.message);
    renderFinal(state.out);
    return e.name === 'AbortError' ? 'abort' : 'fail';
  } finally {
    state.busy = false;
    setBusy(false);
    state.abort = null;
  }
}

function sectionAt(tag, occ) {
  let n = 0;
  for (const s of analyzeLyrics(state.out.lyrics)) {
    if (s.tag === tag) {
      if (n === occ) return s;
      n++;
    }
  }
  return null;
}

async function fixSong() {
  if (state.busy) return;
  if (!state.out.lyrics) { toast('先生成一首歌'); return; }
  const occMap = new Map();
  const targets = [];
  for (const s of analyzeLyrics(state.out.lyrics)) {
    const o = occMap.get(s.tag) || 0;
    occMap.set(s.tag, o + 1);
    if (scoreSection(s).score < 75) targets.push({ tag: s.tag, occ: o, lines: s.lines.length });
  }
  if (!targets.length) { toast('全段可唱性 ≥ 75，不用修复 ✦'); return; }
  let tries = 0;
  let aborted = false;
  for (const t of targets) {
    let lineNote = '';
    for (let round = 1; round <= 3; round++) {
      const cur = sectionAt(t.tag, t.occ);
      if (!cur) break;
      const sc = scoreSection(cur);
      if (sc.score >= 75 && (t.lines < 3 || cur.lines.length >= t.lines - 1)) break;
      toast(`修复 [${t.tag.split('|')[0]}]… ${sc.score} 分 → 目标 75（第 ${round} 次）`);
      const needs = [];
      if (sc.rhyme < 0.65) needs.push('押韵：重写行尾让每行最后一个字都落在同一韵辙里（十三辙：江阳=光霜窗黄上凉伤想响唱，怀来=海爱来开白台，言前=天边前远年见，由求=走酒留旧友秋楼收，灰堆=泪追飞回灰杯，中东=梦风生声灯中钟，人辰=心人真分深音临温），禁止把这些韵辙字表抄进歌词');
      if (sc.syl < 0.9) needs.push('音节：让每个正文行都落在 6-12 音节（中文约 6-12 字），超过 12 的行拆成两行或删掉冗词（拆出的两行行尾也要押同一韵辙），短于 6 的行补足一个具体意象');
      if (cur.lines.length < t.lines - 1) lineNote = `上一轮把段落压到 ${cur.lines.length} 行，重写保持 ${t.lines} 行左右（每行一句，禁止把多句合并成一行）`;
      const st = await rewriteSection(t.tag, `修复到可唱 75 分以上：该段每一行都必须改写成新句子（禁止保留任何原行），押韵与字数同时达标——正文行宁短勿长、每行不超过 12 个字，行数与原段相近。${needs.join('；')}${lineNote ? '；' + lineNote : ''}；保持段落语义、语言、隐喻脉络与括号 ad-lib 行`, '修复 ', t.occ);
      if (st !== 'ok') { aborted = true; break; }
      tries++;
    }
  }
  buildRhymeRow();
  renderRhyme();
  const rest = analyzeLyrics(state.out.lyrics).filter((s) => scoreSection(s).score < 75).length;
  if (aborted) toast(`修复中断：已修 ${tries} 次，还有 ${rest} 段偏低`);
  else toast(rest ? `已修 ${tries} 次，还有 ${rest} 段偏低（可再点一次） 🔧` : `已修 ${tries} 次，全段可唱性 ≥ 75 ✦`);
}

function buildRewriteRow() {
  const row = $('#rewriteRow');
  row.innerHTML = '';
  if (!state.out.lyrics) return;
  const seen = [];
  for (const m of state.out.lyrics.matchAll(/\[([^\]]+)\]/g)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  const secs = analyzeLyrics(state.out.lyrics);
  const scores = new Map(secs.map((s) => [s.tag, scoreSection(s).score]));
  for (const t of seen) {
    const first = t.split('|')[0].trim();
    if (first === 'END') continue;
    const chip = chipEl('重写 ' + first, false, () => rewriteSection(t));
    const sc = scores.get(t);
    if (sc != null) {
      chip.title = sc < 70 ? `可唱性 ${sc} 分，建议重写` : `可唱性 ${sc} 分`;
      if (sc < 70) chip.classList.add('warn');
    } else if (t !== first) chip.title = '重写 ' + t;
    row.appendChild(chip);
  }
}

/* ---------- stats ---------- */

function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/* ---------- rhyme / syllable ---------- */

let rhymeOn = false;

function analyzeLyrics(text) {
  const sections = [];
  let cur = null;
  for (const ln of text.split('\n')) {
    const m = ln.match(/^\s*\[([^\]]+)\]/);
    if (m) { cur = { tag: m[1], lines: [] }; sections.push(cur); continue; }
    if (ln.trim() && cur) cur.lines.push(ln.trim());
  }
  return sections.filter((s) => s.lines.length);
}

function lineUnits(ln) {
  const cjk = (ln.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ucaf2]/g) || []).length;
  const words = (ln.match(/[A-Za-z]+/g) || []).length;
  return cjk + words;
}

function isAdlib(ln) {
  return /^\(\s*\S.*\)$/.test(ln.trim());
}

function scoreSection(s) {
  const body = s.lines.filter((ln) => !isAdlib(ln));
  if (body.length < 2) return { score: 100, rhyme: 1, syl: 1 };
  const groups = new Map();
  for (const ln of body) {
    const k = rhymeKey(ln);
    if (k) groups.set(k, (groups.get(k) || 0) + 1);
  }
  const dom = Math.max(0, ...groups.values());
  const rhyme = dom / body.length;
  const ok = body.filter((ln) => lineUnits(ln) >= 6 && lineUnits(ln) <= 12).length;
  const syl = ok / body.length;
  return { score: Math.round(rhyme * 60 + syl * 40), rhyme, syl };
}

function lastChar(ln) {
  const chars = [...ln.replace(/[^\p{L}\p{N}]/gu, '')];
  return chars.length ? chars[chars.length - 1] : '';
}

// 十三辙押韵分组：中文按韵辙（同韵母），英文按尾词尾音
function rhymeKey(ln) {
  const RHYME = {
    发花: '家花沙茶霞挂话假下夏嫁价化画怕吧爸大嘛麻马码加他她妈答达撒啦啊呀哇啥哪杀拿擦拉巴差牙呀芽崖押鸭驾瓜华雅亚吓夸垮蛙娃滑辣发塔踏乏渣叉炸它',
    梭波: '歌河荷何合课热渴舍策侧勒客特得德则择责测册辙默恶饿鹅哦坐错落果火躲破妥磨魄搏桌国说弱或多我波哥过左作昨错做摸泊伯薄播活夺拖梭罗萝螺骡婆驼魔莫膜漠墨捉琢浊灼烁着泽色涩隔格阁壳喝赫鹤核刻社射涉摄舌折撤扯搓窝卧握佛',
    乜斜: '夜月雪别叶野业切接些写谢姐界解鞋歇蝶猎血越约缺液页耶也邪借街介戒届截洁捷劫节跌叠爹贴铁帖屑裂灭撇瞥阅跃乐却雀学绝决穴',
    姑苏: '雨语旅曲许与处住路步雾暮独读哭触悟苦土兔护误顾墓幕慕努鼓补古虎母谱舞五无湖浮壶胡呼夫珠书梳疏初除储厨炉如鱼去须需组租苏乌铺布福族突图徒途涂凸秃吐土出烛竹逐猪蛛居拘局菊趣取趋虚徐余渔娱愚屿玉域狱绿律虑滤吕缕侣举矩堵睹肚杜赌主住驻筑柱铸输熟赎属术述数殊抒舒叔速束服复腹伏屋物输枢酥粗阻祖组卒',
    怀来: '海爱来外开白台排赖猜拜埋彩呆奶怀带亥腮涯概害帅败霭籁奈买拍迈脉哀埃哉胎才材财灾栽宰再改待代盖采菜碍派麦耐乃抬孩淮槐怪快',
    灰堆: '泪追飞回吹灰杯梅悲醉累美围黑给内雷配悔妹非归菲违肥微威谁北贝倍煤玫没每眉魅碑背催堆对队退推辉挥毁萎尾未位卫魏唯惟',
    遥条: '老好脑早宝抱报道号豪高毛矛貌笑叫桥遥飘浇绕烧少潮苗雕耀妙渺超毫蒿耗浩告刀逃桃淘涛滔劳牢袍跑泡暴爆堡帽庙教交焦骄娇礁乔巧悄描秒钥谣摇尧漂',
    由求: '走酒留旧友秋楼休游愁流舟头投候口手漏透够后厚斗豆瘦守绣袖奏偶藕收柔酬谋筹由油尤邮优悠忧幼有酉诱柚又右佑宥首授受售寿兽囚揪究九久就救刘流牛纽扭钮娄陋舟周州洲帚咒皱沟狗构购勾侯猴抖逗窦',
    寒安: '天暗晚暖岸乱叹伴半淡感蓝南难安山凡慢翻穿干汉弹关弯湾宽软转卷换欢案单看寒残满漫判盼喊斑烂段断短端团官冠观贯灌完万晚玩盘',
    言前: '天边前远年面见连千钱缘眠牵鲜篇言燕电变点念练添田甜店典淀歉浅潜钳迁件建健键剑尖渐剪煎茧扁便遍片骗宴验焰炎盐岩沿严烟',
    江阳: '光霜窗黄上旁凉伤想藏长海洋茫慌狂亮旷莽香汤荒裳乡方房放忘望旺广唱忙浪响当党堂趟烫撞状装庄仗障章张谎脏淌',
    人辰: '心人真分深针沈吟禁今近印音隐临林淋邻尘晨辰神身仁刃任认韧欣辛新春唇纯顺文纹蚊坟纷温本门闷笨奔粉奋份根跟痕恩们森沉陈诊枕甚什忍珍疹怎蹲存纯醇论焚稳',
    中东: '梦风生声成城灯等冷恒朋腾空中钟公冲终融绒痛通送控动洞红翁嗡英盈迎影景静明青清晴星行停灵冰凝东冬忠宗踪总功攻宫弓共供恭鸿洪宏弘蓬篷盟蒙仲众重崇峰锋丰封疯讽奉凤逢登能衡崩绷营井警境镜情请刑型形零凌铃平萍瓶凭屏定令领另应硬映病并兵丙饼名铭命',
  };
  const clean = ln.replace(/[^\p{L}\p{N}]/gu, '');
  if (!clean) return '';
  const last = clean[clean.length - 1];
  if (/[A-Za-z]/.test(last)) {
    const words = clean.match(/[A-Za-z]+/g);
    return 'EN:' + words[words.length - 1].toLowerCase().slice(-2);
  }
  for (const [g, chars] of Object.entries(RHYME)) if (chars.includes(last)) return g;
  return 'ZH:' + last;
}

function buildRhymeRow() {
  const row = $('#rhymeRow');
  row.innerHTML = '';
  if (!state.out.lyrics) {
    rhymeOn = false;
    $('#rhymeBox').hidden = true;
    $('#rhymeBox').innerHTML = '';
    return;
  }
  row.appendChild(chipEl('♫ 押韵 / 音节', rhymeOn, () => {
    rhymeOn = !rhymeOn;
    buildRhymeRow();
    renderRhyme();
  }));
  const low = analyzeLyrics(state.out.lyrics).filter((s) => scoreSection(s).score < 75);
  if (low.length) {
    const fix = chipEl(`🔧 一键修复 ×${low.length}`, false, fixSong);
    fix.title = '把可唱性偏低（<75）的段逐段重写：押韵与音节一起修，每段最多重试 3 次，目标全段 ≥75；同名段按出现次序分别定位';
    row.appendChild(fix);
  }
}

function renderRhyme() {
  const box = $('#rhymeBox');
  if (!rhymeOn || !state.out.lyrics) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const secs = analyzeLyrics(state.out.lyrics);
  const scored = secs.map((s) => ({ s, ...scoreSection(s) }));
  const low = scored.filter((x) => x.score < 75);
  const advice = low.length
    ? `<div class="r-advice">可唱性偏低（<75），点「一键修复」：${low.map((x) => `${esc(x.s.tag)}（${x.score} 分，押韵 ${Math.round(x.rhyme * 100)}%·音节 ${Math.round(x.syl * 100)}%）`).join('、')}</div>`
    : scored.length ? '<div class="r-advice ok">全段可唱性 ≥ 75，不用修复 ✦</div>' : '';
  box.innerHTML = advice + scored.map(({ s, score }) => {
    const letters = new Map();
    const rows = s.lines.map((ln) => {
      if (isAdlib(ln)) {
        return `<div class="r-line"><span class="r-badge adlib">ADLIB</span><span class="r-units">ad-lib</span><span class="r-text">${esc(ln)}</span></div>`;
      }
      const k = rhymeKey(ln);
      if (k && !letters.has(k)) letters.set(k, String.fromCharCode(65 + letters.size));
      return `<div class="r-line"><span class="r-badge">${letters.get(k) || ''}</span><span class="r-units">${lineUnits(ln)} 单位</span><span class="r-text">${esc(ln)}</span></div>`;
    }).join('');
    const lens = s.lines.filter((ln) => !isAdlib(ln)).map(lineUnits);
    const cls = score >= 85 ? 'good' : score < 75 ? 'low' : '';
    return `<div class="r-sec"><div class="r-tag">${esc(s.tag)} · ${s.lines.length} 行${lens.length ? ` · ${Math.min(...lens)}–${Math.max(...lens)} 单位/行` : ''} · <span class="r-score ${cls}">可唱 ${score}</span></div>${rows}</div>`;
  }).join('');
  box.hidden = false;
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
$('#batchBtn').addEventListener('click', batchGenerate);
$('#stopBtn').addEventListener('click', () => { if (state.abort) state.abort.abort(); });

$('#retitleBtn').addEventListener('click', async () => {
  if (state.busy) return;
  if (!state.out.lyrics) { toast('先生成一首歌'); return; }
  state.busy = true;
  setBusy(true);
  lastTps = null;
  const sys = '你是顶级作词人。根据歌词重想一个歌名：简短、有画面感、贴合歌词语言。只输出歌名本身一行，禁止解释、禁止引号。';
  $('#titleOut').innerHTML = '<span class="placeholder">想歌名中…</span>';
  const results = await Promise.all([0, 1, 2].map(async (i) => {
    try {
      const full = await streamChat(
        [
          { role: 'system', content: sys },
          { role: 'user', content: `当前歌名：${state.out.title}\n这是第 ${i + 1} 个候选，意象角度要和常见命名不同（别和当前歌名近似）。\n歌词：\n${state.out.lyrics}` },
        ],
        { reasoning: 'none', temp: 0.85 + i * 0.12, maxTok: 80, model: state.params.model },
        null,
      );
      const t = full.trim().split('\n')[0].replace(/^["'「『]+|["'」』]+$/g, '').trim();
      return t || null;
    } catch { return null; }
  }));
  state.busy = false;
  setBusy(false);
  state.abort = null;
  const titles = [...new Set(results.filter(Boolean))];
  if (!titles.length) { toast('没拿到新歌名'); renderFinal(state.out); return; }
  renderFinal(state.out);
  const box = $('#titleDrafts');
  box.innerHTML = '';
  box.hidden = false;
  for (const t of titles) {
    const b = chipEl(t, false, () => {
      state.out = { ...state.out, title: t };
      $('#titleOut').innerHTML = esc(t);
      box.hidden = true;
      box.innerHTML = '';
      syncHistory();
      toast(`歌名定为「${t}」 🏷`);
    });
    box.appendChild(b);
  }
  box.appendChild(chipEl('✕ 都不选', false, () => {
    box.hidden = true;
    box.innerHTML = '';
    renderFinal(state.out);
    toast('放弃候选，保留原歌名');
  }));
  toast(`${titles.length} 个歌名候选，点一个定下`);
});

$('#restyleBtn').addEventListener('click', async () => {
  if (state.busy) return;
  if (!state.out.lyrics) { toast('先生成一首歌'); return; }
  state.busy = true;
  setBusy(true);
  lastTps = null;
  const hints = [];
  if (state.genres.length) hints.push('曲风参考：' + state.genres.map((g) => g.guide).join('；'));
  if (state.styleCards.length) hints.push('风格参考：' + state.styleCards.map((s) => s.guide).join('；'));
  if (state.vocal) hints.push('人声类型：' + state.vocal.label);
  const moodWords = P.moods.filter((m) => state.moods.has(m.id)).map((m) => m.tag).join(', ');
  if (moodWords) hints.push('情绪：' + moodWords);
  const sys = [
    '你是 Suno 风格标签专家。根据歌词重想一组 style tags（填进 Suno 的 Style of Music 框）。',
    '规则：全英文、逗号分隔，含流派、人声性别、乐器、氛围、BPM；可借用 Suno 音乐术语（adagio/crescendo/sparse/dense/falsetto/belt/reverb-heavy/minor key 等）增强控制。',
    '绝对禁止出现任何真实艺人、乐队或品牌名称（平台会屏蔽），用描述性词汇代替。',
    ...(state.glossary.length ? ['用户指定的音乐术语必须原样出现在标签中：' + state.glossary.map((g) => g.tag).join(', ')] : []),
    '歌词语言参考：' + state.langs.map((id) => P.langs.find((l) => l.id === id).label).join('、'),
    '只输出一行标签本身，禁止解释、禁止引号、禁止 markdown。',
  ].join('\n');
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: `当前标签：${state.out.style_tags}\n${hints.join('\n')}\n歌词：\n${state.out.lyrics}` },
  ];
  try {
    const full = await streamChat(
      messages,
      { reasoning: 'none', temp: Math.min(state.params.temp, 0.9), maxTok: 160, model: state.params.model },
      (content) => { $('#tagsOut').innerHTML = esc(content.trim().split('\n')[0]) + '<span class="caret">▍</span>'; },
    );
    const line = full.trim().split('\n')[0]
      .replace(/^```(?:\w*)?\s*/i, '').replace(/```$/, '')
      .replace(/^["'「『]+|["'」』]+$/g, '').trim();
    const seen = [];
    for (const raw of line.split(',')) {
      const t = raw.trim();
      if (!t || seen.includes(t)) continue;
      if (P.artists.some((a) => t.toLowerCase().includes(a.label.toLowerCase()))) continue;
      seen.push(t);
    }
    const tags = seen.slice(0, 16).join(', ');
    if (!tags) { toast('没拿到新风格'); renderFinal(state.out); return; }
    state.out = { ...state.out, style_tags: tags };
    renderFinal(state.out);
    syncHistory();
    toast('风格已换新 🎼');
  } catch (e) {
    if (e.name === 'AbortError') toast('已停止');
    else toast('风格重写失败：' + e.message);
    renderFinal(state.out);
  } finally {
    state.busy = false;
    setBusy(false);
    state.abort = null;
  }
});

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

/* ---------- scenes: saved recipe presets ---------- */

const SCENES_KEY = 'ilyrics_scenes';
let scenes = (() => { try { return JSON.parse(localStorage.getItem(SCENES_KEY)) || []; } catch { return []; } })();

function saveScenes() {
  localStorage.setItem(SCENES_KEY, JSON.stringify(scenes.slice(0, 20)));
}

function sceneSummary(s) {
  const bits = [];
  if (s.genres && s.genres.length) {
    const g = P.genres.find((x) => x.id === s.genres[0]);
    bits.push((g ? g.label : s.genres[0]) + (s.genres.length > 1 ? ` +${s.genres.length - 1}` : ''));
  }
  if (s.vocal) bits.push(P.vocals.find((v) => v.id === s.vocal)?.label || '');
  if (s.artists && s.artists.length) bits.push(`歌手×${s.artists.length}`);
  if (s.glossary && s.glossary.length) bits.push(`术语×${s.glossary.length}`);
  if (s.moods && s.moods.length) bits.push(`情绪×${s.moods.length}`);
  return bits.filter(Boolean).join(' · ');
}

function renderScenes() {
  const box = $('#sceneList');
  box.innerHTML = '';
  if (!scenes.length) {
    box.innerHTML = '<span class="placeholder">还没存过配方：点 💾 存当前整套设定</span>';
    return;
  }
  for (const s of scenes) {
    const el = document.createElement('div');
    el.className = 'pick-item';
    el.innerHTML = `<span class="sc-name">${esc(s.name)}</span><span class="sc-meta">${esc(sceneSummary(s))}</span><span class="sc-del">✕</span>`;
    el.title = '一键装填这套配方';
    el.addEventListener('click', () => {
      applyScene(s);
      $('#scenePanel').hidden = true;
    });
    el.querySelector('.sc-del').addEventListener('click', (ev) => {
      ev.stopPropagation();
      scenes = scenes.filter((x) => x.ts !== s.ts);
      saveScenes();
      renderScenes();
    });
    box.appendChild(el);
  }
}

function applyScene(s) {
  $('#theme').value = s.theme || '';
  const rem = s.remix || '';
  $('#remixInput').value = rem;
  $('#remixField').hidden = !rem;
  $('#remixBtn').classList.toggle('active', !!rem);
  state.langs = s.langs && s.langs.length ? s.langs : ['zh'];
  state.genres = (s.genres || []).map((id) => P.genres.find((g) => g.id === id)).filter(Boolean);
  state.artists = (s.artists || []).map((id) => P.artists.find((a) => a.id === id)).filter(Boolean);
  state.styleCards = (s.styleCards || []).map((id) => P.styles.find((x) => x.id === id)).filter(Boolean);
  state.vocal = P.vocals.find((v) => v.id === s.vocal) || null;
  state.structure = P.structTpl.find((t) => t.id === s.structure) || null;
  state.glossary = (s.glossary || []).map((id) => P.glossary.find((g) => g.id === id)).filter(Boolean);
  state.moods = new Set(s.moods || []);
  renderChips();
  refreshDropdowns();
  toast(`场景「${s.name}」已装填 🎞`);
}

$('#sceneSaveBtn').addEventListener('click', () => {
  const name = prompt('给这套配方起个名字', $('#theme').value.trim().slice(0, 14) || '未命名配方');
  if (!name || !name.trim()) return;
  scenes.unshift({
    name: name.trim(),
    ts: Date.now(),
    theme: $('#theme').value.trim(),
    remix: $('#remixInput').value.trim() || null,
    langs: [...state.langs],
    genres: state.genres.map((g) => g.id),
    artists: state.artists.map((a) => a.id),
    styleCards: state.styleCards.map((s) => s.id),
    vocal: state.vocal ? state.vocal.id : null,
    structure: state.structure ? state.structure.id : null,
    glossary: state.glossary.map((g) => g.id),
    moods: [...state.moods],
  });
  if (scenes.length > 20) scenes.length = 20;
  saveScenes();
  toast('配方已存进场景库 💾（最多留 20 套）');
});

$('#sceneBtn').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const p = $('#scenePanel');
  p.hidden = !p.hidden;
  if (!p.hidden) renderScenes();
});
document.addEventListener('click', (ev) => {
  if (!$('#scenePanel').hidden && !ev.target.closest('.pick-area')) $('#scenePanel').hidden = true;
});

$('#blindBtn').addEventListener('click', () => {
  const pick = (list, n) => [...list].sort(() => Math.random() - 0.5).slice(0, n);
  $('#theme').value = pick(P.inspirations, 1)[0];
  state.artists = pick(P.artists, 1 + Math.floor(Math.random() * 2));
  state.styleCards = pick(P.styles, 1 + Math.floor(Math.random() * 2));
  state.genres = pick(P.genres, 1 + Math.floor(Math.random() * 2));
  state.moods = new Set(pick(P.moods, Math.floor(Math.random() * 3)));
  state.vocal = pick(P.vocals, 1)[0];
  state.structure = pick(P.structTpl, 1)[0];
  state.glossary = pick(P.glossary, Math.floor(Math.random() * 3));
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
const histState = { page: 0, q: '' };

// 分页大小按历史列表实际可见高度动态计算（一行条目含间距约 44px）
function histPageSize() {
  const h = $('#histList').clientHeight;
  if (!h) return 10;
  return Math.max(6, Math.floor((h - 16) / 44));
}

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
    structure: state.structure ? state.structure.id : null,
    glossary: state.glossary.map((g) => g.id),
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
  const size = histPageSize();
  const pages = Math.max(1, Math.ceil(list.length / size));
  histState.page = Math.min(Math.max(histState.page, 0), pages - 1);
  const slice = list.slice(histState.page * size, (histState.page + 1) * size);

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
        `<span class="t">${hhmm}</span><span class="name">${esc(item.title || item.theme)}${item.album ? `<span class="album">《${esc(item.album)}》</span>` : ''}</span>` +
        `<span class="acts"><button class="hbtn fav${item.fav ? ' on' : ''}">${item.fav ? '★' : '☆'}</button>` +
        `<button class="hbtn rg" title="按原设定再写一首">↻</button>` +
        `<button class="hbtn ab" title="${item.album ? '改专辑名 / 留空移出专辑' : '归入专辑'}">${item.album ? '▣' : '▢'}</button>` +
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
      el.querySelector('.rg').addEventListener('click', (ev) => {
        ev.stopPropagation();
        restore(item);
        generate();
      });
      el.querySelector('.ab').addEventListener('click', (ev) => {
        ev.stopPropagation();
        const name = prompt('专辑名（留空 = 移出专辑）', item.album || '');
        if (name != null) {
          item.album = name.trim() || null;
          saveHistory();
          renderHistory();
        }
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
let histResizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(histResizeT);
  histResizeT = setTimeout(() => renderHistory(), 250);
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
  state.structure = P.structTpl.find((t) => t.id === item.structure) || null;
  state.glossary = (item.glossary || []).map((id) => P.glossary.find((g) => g.id === id)).filter(Boolean);
  state.moods.clear();
  renderChips();
  refreshDropdowns();
  renderFinal({ title: item.title, style_tags: item.style_tags, lyrics: normalizeLyrics(item.lyrics) });
  curHistTs = item.ts;
  restoreVersions(item);
  toast('已回填历史 ✦');
}

$('#histTracklist').addEventListener('click', () => {
  const albums = new Map();
  for (const x of histAll) {
    if (!x.album) continue;
    if (!albums.has(x.album)) albums.set(x.album, []);
    albums.get(x.album).push(x);
  }
  if (!albums.size) { toast('还没有专辑：点条目的 ▢ 归入专辑'); return; }
  const text = [...albums.entries()]
    .map(([name, items]) => `【${name}】\n${items.map((x, i) => `${i + 1}. ${x.title || x.theme} — ${x.style_tags || ''}`).join('\n')}`)
    .join('\n\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ilyrics-tracklist.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
  toast(`${albums.size} 个专辑 tracklist 已导出 ☰`);
});

$('#histExport').addEventListener('click', () => {
  if (!histAll.length) { toast('历史是空的'); return; }
  const blob = new Blob([JSON.stringify(histAll, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ilyrics-history.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
  toast('历史已导出 JSON ⬇');
});

$('#histImportBtn').addEventListener('click', () => $('#histImport').click());

$('#histImport').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try {
    const arr = JSON.parse(await f.text());
    if (!Array.isArray(arr)) throw new Error('不是历史数组');
    const known = new Set(histAll.map((x) => x.ts));
    let added = 0;
    for (const item of arr) {
      if (!item || !item.lyrics || known.has(item.ts)) continue;
      histAll.unshift({ ...item });
      added++;
    }
    if (!added) { toast('没有新条目可导入'); return; }
    histAll.sort((a, b) => b.ts - a.ts);
    saveHistory();
    toast(`导入 ${added} 条历史 ⬆`);
  } catch (e) {
    toast('导入失败：' + e.message);
  }
});

makeDropdown('artist', '#artistBtn', '#artistPanel', '#artistSearch', '#artistGrid', null, { multi: true, arr: 'artists' });
makeDropdown('style', '#styleBtn', '#stylePanel', '#styleSearch', '#styleGrid', null, { multi: true, arr: 'styleCards' });
makeDropdown('genre', '#genreBtn', '#genrePanel', '#genreSearch', '#genreGrid', null, { multi: true, arr: 'genres' });
makeDropdown('glossary', '#termBtn', '#termPanel', '#termSearch', '#termGrid', null, { multi: true, arr: 'glossary' });

/* ---------- data maintenance ---------- */

const PRESETS_KEY = 'ilyrics_presets';
const DATA_TABS = [
  { key: 'inspirations', label: '主题灵感', kind: 'text' },
  { key: 'langs', label: '语言', kind: 'obj' },
  { key: 'artists', label: '歌手', kind: 'obj', guide: true },
  { key: 'styles', label: '风格', kind: 'obj', guide: true },
  { key: 'genres', label: '曲风', kind: 'obj' },
  { key: 'glossary', label: '音乐术语', kind: 'obj', guide: true, tag: true },
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
  else if (key === 'glossary') state.glossary = state.glossary.filter((g) => ids.includes(g.id));
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

/* ---------- keyboard shortcuts ---------- */

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (!$('#settingsPanel').hidden) $('#settingsPanel').hidden = true;
    if (!$('#pickPanel').hidden) $('#pickPanel').hidden = true;
    if (!$('#scenePanel').hidden) $('#scenePanel').hidden = true;
    if (!$('#dataOverlay').hidden) $('#dataOverlay').hidden = true;
    if (state.busy && state.abort) state.abort.abort();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault();
    if (!state.busy) generate();
    return;
  }
  if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'd' || ev.key === 'D')) {
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    $('#diceBtn').click();
  }
});
