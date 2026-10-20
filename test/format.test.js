const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// app.js 是浏览器脚本，这里按顶层函数名从源码里抠出纯函数再 eval（函数收尾在行首的 }）
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const names = ['norm', 'canonTagLine', 'normalizeLyrics', 'extractPartial', 'parseFull', 'normalizeBlock', 'spliceRewritten', 'analyzeLyrics', 'lineUnits', 'lastChar', 'scoreSection', 'diffLines'];
eval(names.map((n) => src.match(new RegExp(`^function ${n}\\b[\\s\\S]*?^}`, 'm'))[0]).join('\n'));

test('canonTagLine: 大写化 / 去数字 / 保留竖线修饰词', () => {
  assert.equal(canonTagLine('[verse]'), '[VERSE]');
  assert.equal(canonTagLine('[Verse 2]'), '[VERSE]');
  assert.equal(canonTagLine('[chorus | anthemic | stacked harmonies]'), '[CHORUS | anthemic | stacked harmonies]');
  assert.equal(canonTagLine('[bridge] 尾注'), '[BRIDGE] 尾注');
});

test('normalizeLyrics: 段落间恰好空一行，首尾空行去除', () => {
  const messy = '[verse]\n第一行\n第二行\n\n\n[chorus 1]\n副歌\n[bridge]\n桥段\n\n';
  assert.equal(normalizeLyrics(messy), '[VERSE]\n第一行\n第二行\n\n[CHORUS]\n副歌\n\n[BRIDGE]\n桥段');
  assert.equal(normalizeLyrics('[VERSE]\na\n\n[CHORUS]\nb\n\n[END]'), '[VERSE]\na\n\n[CHORUS]\nb\n\n[END]');
});

test('parseFull: JSON 与非法换行兜底都走规范化', () => {
  const good = JSON.stringify({ title: '月光', style_tags: 'mandopop', lyrics: '[verse]\n啊\n\n[chorus]\n哦\n[END]' });
  assert.equal(parseFull(good).lyrics, '[VERSE]\n啊\n\n[CHORUS]\n哦\n\n[END]');
  const broken = '{"title":"月光","style_tags":"mandopop","lyrics":"[verse]\n啊\n\n[chorus]\n哦\n[END]"}';
  const p = parseFull(broken);
  assert.equal(p.lyrics, '[VERSE]\n啊\n\n[CHORUS]\n哦\n\n[END]');
  assert.equal(p.title, '月光');
});

test('局部重写：带修饰词标签的拼接与原样标签段替换', () => {
  const orig = normalizeLyrics('[verse]\nline1\n\n[chorus | anthemic]\nold1\nold2\n\n[bridge]\nb1\n');
  const block = normalizeBlock('```\n[CHORUS | anthemic]\nnew1\nnew2\n\n[BRIDGE]\n应被截掉\n```', 'CHORUS | anthemic');
  assert.equal(block.join('\n'), '[CHORUS | anthemic]\nnew1\nnew2');
  assert.equal(normalizeLyrics(spliceRewritten(orig, 'CHORUS | anthemic', block)),
    '[VERSE]\nline1\n\n[CHORUS | anthemic]\nnew1\nnew2\n\n[BRIDGE]\nb1');
  assert.equal(normalizeLyrics(spliceRewritten('[VERSE]\na\n\n[CHORUS]\nx\n\n[END]', 'CHORUS', ['[CHORUS]', 'y'])),
    '[VERSE]\na\n\n[CHORUS]\ny\n\n[END]');
});

test('scoreSection: 押韵覆盖率与音节区间打分', () => {
  const perfect = analyzeLyrics('[VERSE]\n月光洒在窗上\n心事沉在心上\n回声落在巷上\n歌声散在风上\n')[0];
  assert.ok(scoreSection(perfect).score >= 70);
  const messy = analyzeLyrics('[VERSE]\naaaaaaaaaaaaaa\nb\nccccccccccccccccccc\ndd\n')[0];
  assert.ok(scoreSection(messy).score < 70);
});

test('diffLines: 重写版本差异标记', () => {
  const rows = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepEqual(rows, [['ctx', 'a'], ['del', 'b'], ['add', 'x'], ['ctx', 'c']]);
});
