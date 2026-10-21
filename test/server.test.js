const { test } = require('node:test');
const assert = require('node:assert');
const { endpoints, authHeaders } = require('../server.js');

test('endpoints: 默认本机 llama.cpp', () => {
  assert.deepEqual(endpoints(), {
    chat: 'http://127.0.0.1:8080/v1/chat/completions',
    models: 'http://127.0.0.1:8080/v1/models',
  });
  assert.deepEqual(endpoints(''), endpoints());
});

test('endpoints: 去尾斜杠 / 自动补协议', () => {
  assert.equal(endpoints('http://127.0.0.1:8080/').chat, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(endpoints('localhost:8080').chat, 'http://localhost:8080/v1/chat/completions');
});

test('endpoints: 已带 /v1 或完整路径不重复拼接', () => {
  const a = endpoints('https://api.openai.com/v1');
  assert.equal(a.chat, 'https://api.openai.com/v1/chat/completions');
  assert.equal(a.models, 'https://api.openai.com/v1/models');
  const b = endpoints('https://api.example.com/v1/chat/completions');
  assert.equal(b.chat, 'https://api.example.com/v1/chat/completions');
  assert.equal(b.models, 'https://api.example.com/v1/models');
});

test('authHeaders: 有 key 才带 Bearer，空白 key 忽略', () => {
  assert.deepEqual(authHeaders(' sk-abc '), { Authorization: 'Bearer sk-abc' });
  assert.deepEqual(authHeaders(''), {});
  assert.deepEqual(authHeaders(undefined), {});
});
