'use strict';
// session-end.js の純粋関数テスト（`node --test bin/session-end.test.js`）。
// #23 transcript 救済スキャン extractSalvageCandidates を中心に検証。

const test = require('node:test');
const assert = require('node:assert');
const S = require('./session-end');

// transcript JSONL 1 行を組み立てるヘルパー
const userLine = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const userToolResult = () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'cmd output' }] } });
const asstText = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text }] } });
const otherLine = () => JSON.stringify({ type: 'system', content: 'noise' });

test('extractSalvageCandidates: 決定句(することにした)を decision として救済', () => {
  const tx = [userLine('hnsw_rs を採用することにした。USearch は Windows 互換性問題があるため。')].join('\n');
  const c = S.extractSalvageCandidates(tx, { max: 3, date: '2026-06-13' });
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].type, 'decision');
  assert.strictEqual(c[0].scope, 'project', 'scope は必ず project（org 昇格させない）');
  assert.strictEqual(c[0].confidence, 'uncertain');
  assert.strictEqual(c[0].salvaged, true);
  assert.strictEqual(c[0].date, '2026-06-13');
  assert.ok(c[0].body.includes('採用することにした'));
});

test('extractSalvageCandidates: 原因句を postmortem、教訓句を lesson に分類', () => {
  const tx = [
    asstText('根本原因は flock のネスト取得によるデッドロックでした。'),
    asstText('教訓: 冪等性テストは状態の全コレクションを assert する。'),
  ].join('\n');
  const c = S.extractSalvageCandidates(tx, { max: 5 });
  const types = c.map((x) => x.type).sort();
  assert.deepStrictEqual(types, ['lesson', 'postmortem']);
});

test('extractSalvageCandidates: 英語の決定/教訓句も拾う', () => {
  const tx = [
    userLine('We decided to use fs4 instead of std file lock for MSRV compatibility.'),
    asstText('lesson learned: always verify transcript_path before building salvage.'),
  ].join('\n');
  const c = S.extractSalvageCandidates(tx, { max: 5 });
  assert.ok(c.length >= 2, '英語の2件を拾う');
});

test('extractSalvageCandidates: tool_result / system / 雑談 は拾わない（高精度）', () => {
  const tx = [
    userToolResult(),
    otherLine(),
    userLine('ありがとう、いい感じだね。次どうしようか。'), // 述語シグナルなし
    asstText('ファイルを読みました。'),
  ].join('\n');
  const c = S.extractSalvageCandidates(tx, { max: 3 });
  assert.strictEqual(c.length, 0, '決定/教訓/原因の述語が無ければ救済しない');
});

test('extractSalvageCandidates: max 件で打ち切り', () => {
  const lines = [];
  for (let i = 0; i < 10; i++) lines.push(userLine(`方針${i}: パターン${i}を採用することにした`));
  const tx = lines.join('\n');
  const c = S.extractSalvageCandidates(tx, { max: 3 });
  assert.strictEqual(c.length, 3);
});

test('extractSalvageCandidates: 同一正規化タイトルは dedup', () => {
  const tx = [
    userLine('hnsw_rs を採用することにした'),
    asstText('hnsw_rs を採用することにした'), // 同一 → 1 件に畳む
  ].join('\n');
  const c = S.extractSalvageCandidates(tx, { max: 5 });
  assert.strictEqual(c.length, 1);
});

test('extractSalvageCandidates: 壊れた JSON 行・空入力は安全に []', () => {
  assert.deepStrictEqual(S.extractSalvageCandidates('', {}), []);
  assert.deepStrictEqual(S.extractSalvageCandidates('not json\n{bad', {}), []);
});

test('extractSalvageCandidates: 秘密はスクラブされ、本文が REDACTED 過多なら捨てる', () => {
  // email だけの本文 → scrub 後ほぼ空 → 捨てる
  const tx = [userLine('原因は a@example.com b@example.com c@example.com でした')].join('\n');
  const c = S.extractSalvageCandidates(tx, { max: 3 });
  // 本文が «REDACTED-EMAIL» 占有なら救済しない
  for (const x of c) assert.ok(!/@example\.com/.test(x.body), '生メールは残らない');
});

test('isMostlyRedacted: REDACTED 占有本文を検出', () => {
  assert.strictEqual(S.isMostlyRedacted('«REDACTED-EMAIL» «REDACTED-EMAIL»'), true);
  assert.strictEqual(S.isMostlyRedacted('hnsw_rs を採用することにした'), false);
});

test('salvageEnabled: 既定 OFF・1/true/on/yes で ON', () => {
  const save = process.env.ARAG_CAPTURE_SALVAGE;
  delete process.env.ARAG_CAPTURE_SALVAGE;
  assert.strictEqual(S.salvageEnabled(), false, '既定 OFF（後方互換）');
  process.env.ARAG_CAPTURE_SALVAGE = '1';
  assert.strictEqual(S.salvageEnabled(), true);
  process.env.ARAG_CAPTURE_SALVAGE = 'on';
  assert.strictEqual(S.salvageEnabled(), true);
  process.env.ARAG_CAPTURE_SALVAGE = '0';
  assert.strictEqual(S.salvageEnabled(), false);
  if (save === undefined) delete process.env.ARAG_CAPTURE_SALVAGE; else process.env.ARAG_CAPTURE_SALVAGE = save;
});
