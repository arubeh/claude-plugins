'use strict';
// util.js の純粋関数テスト（依存ゼロ・`node --test bin/lib/util.test.js` で実行）。
// #P1 mergeReserved / dedupCrossScope / globalReserved と #P2 recallMode / daemonPresent、
// 既存 applyFloor / dedupAgainstSeen を検証する。spawn を伴う searchRecall 等は対象外。

const test = require('node:test');
const assert = require('node:assert');
const U = require('./util');

const hit = (source, score) => ({ source, score });
const keyOf = (h) => (h && h.source ? String(h.source) : '');

test('mergeReserved: local5+global5+reserved2 → local3 + global2', () => {
  const loc = [hit('l1', 5), hit('l2', 4), hit('l3', 3), hit('l4', 2), hit('l5', 1)];
  const glob = [hit('g1', 5), hit('g2', 4), hit('g3', 3), hit('g4', 2), hit('g5', 1)];
  const m = U.mergeReserved(loc, glob, 5, 2);
  assert.strictEqual(m.loc.length, 3, 'local は残り 3 枠');
  assert.strictEqual(m.glob.length, 2, 'global は予約 2 枠');
});

test('mergeReserved: local0+global5 → global が TOP_K を埋める', () => {
  const glob = [hit('g1', 5), hit('g2', 4), hit('g3', 3), hit('g4', 2), hit('g5', 1)];
  const m = U.mergeReserved([], glob, 5, 2);
  assert.strictEqual(m.loc.length, 0);
  assert.strictEqual(m.glob.length, 5, 'local 空なら global で TOP_K');
});

test('mergeReserved: local5+global0 → local が TOP_K を埋める', () => {
  const loc = [hit('l1', 5), hit('l2', 4), hit('l3', 3), hit('l4', 2), hit('l5', 1)];
  const m = U.mergeReserved(loc, [], 5, 2);
  assert.strictEqual(m.loc.length, 5, 'global 空なら local で TOP_K');
  assert.strictEqual(m.glob.length, 0);
});

test('mergeReserved: reserved=0 で従来の local 優先充填にバイト等価', () => {
  const loc = [hit('l1', 5), hit('l2', 4), hit('l3', 3), hit('l4', 2), hit('l5', 1)];
  const glob = [hit('g1', 5), hit('g2', 4)];
  const m = U.mergeReserved(loc, glob, 5, 0);
  assert.strictEqual(m.loc.length, 5);
  assert.strictEqual(m.glob.length, 0, 'reserved=0 は global を出さない（旧挙動）');
});

test('mergeReserved: local 不足分は global が余り枠も埋める', () => {
  const loc = [hit('l1', 5)];
  const glob = [hit('g1', 5), hit('g2', 4), hit('g3', 3), hit('g4', 2), hit('g5', 1)];
  const m = U.mergeReserved(loc, glob, 5, 2);
  assert.strictEqual(m.loc.length, 1);
  assert.strictEqual(m.glob.length, 4, 'local 1 件なら global が 4 件');
});

test('mergeReserved: positiveOnly で score<=0 の global を予約から除外', () => {
  const glob = [hit('g1', 0), hit('g2', -1), hit('g3', 2)];
  const m = U.mergeReserved([], glob, 5, 2);
  assert.deepStrictEqual(m.glob.map((h) => h.source), ['g3'], 'score>0 のみ');
});

test('mergeReserved: positiveOnly=false は score<=0 も通す（opt-out）', () => {
  const glob = [hit('g1', 0), hit('g2', -1)];
  const m = U.mergeReserved([], glob, 5, 2, { positiveOnly: false });
  assert.strictEqual(m.glob.length, 2);
});

test('mergeReserved: score=null（旧 arag フォールバック）は通す', () => {
  const glob = [hit('g1', null), hit('g2', null)];
  const m = U.mergeReserved([], glob, 5, 2);
  assert.strictEqual(m.glob.length, 2, 'null スコアは互換のため残す');
});

test('dedupCrossScope: local 既出 source を global から除く', () => {
  const loc = [hit('a.md', 3), hit('b.md', 2)];
  const glob = [hit('a.md', 5), hit('c.md', 1)];
  const out = U.dedupCrossScope(loc, glob, keyOf);
  assert.deepStrictEqual(out.map((h) => h.source), ['c.md'], 'a.md は local 優先で除外');
});

test('dedupCrossScope: source なし（falsy key）は常に残す', () => {
  const glob = [{ score: 1 }, hit('c.md', 1)];
  const out = U.dedupCrossScope([hit('c.md', 2)], glob, keyOf);
  assert.strictEqual(out.length, 1, 'c.md は除外、key 無しヒットは残る');
  assert.strictEqual(out[0].source, undefined);
});

test('globalReserved: 既定 2 / 明示 0 で opt-out / 不正は 2', () => {
  const save = process.env.ARAG_RECALL_GLOBAL_RESERVED;
  delete process.env.ARAG_RECALL_GLOBAL_RESERVED;
  assert.strictEqual(U.globalReserved(), 2, '未設定は 2');
  process.env.ARAG_RECALL_GLOBAL_RESERVED = '0';
  assert.strictEqual(U.globalReserved(), 0, '明示 0 は opt-out');
  process.env.ARAG_RECALL_GLOBAL_RESERVED = '3';
  assert.strictEqual(U.globalReserved(), 3);
  process.env.ARAG_RECALL_GLOBAL_RESERVED = 'abc';
  assert.strictEqual(U.globalReserved(), 2, '不正値は既定 2');
  if (save === undefined) delete process.env.ARAG_RECALL_GLOBAL_RESERVED;
  else process.env.ARAG_RECALL_GLOBAL_RESERVED = save;
});

test('recallMode: 明示 bm25/hybrid を尊重・auto はデーモン無で bm25', () => {
  const saveMode = process.env.ARAG_RECALL_MODE;
  const saveDaemon = process.env.ARAG_DAEMON;
  process.env.ARAG_RECALL_MODE = 'bm25';
  assert.strictEqual(U.recallMode(), 'bm25');
  process.env.ARAG_RECALL_MODE = 'hybrid';
  assert.strictEqual(U.recallMode(), 'hybrid');
  // auto + デーモン検出無効 → bm25
  process.env.ARAG_RECALL_MODE = 'auto';
  process.env.ARAG_DAEMON = '0';
  assert.strictEqual(U.recallMode(), 'bm25', 'ARAG_DAEMON=0 は検出無効→bm25');
  if (saveMode === undefined) delete process.env.ARAG_RECALL_MODE; else process.env.ARAG_RECALL_MODE = saveMode;
  if (saveDaemon === undefined) delete process.env.ARAG_DAEMON; else process.env.ARAG_DAEMON = saveDaemon;
});

test('daemonPresent: ARAG_DAEMON=0 で常に false', () => {
  const save = process.env.ARAG_DAEMON;
  process.env.ARAG_DAEMON = '0';
  assert.strictEqual(U.daemonPresent(), false);
  process.env.ARAG_DAEMON = 'off';
  assert.strictEqual(U.daemonPresent(), false);
  if (save === undefined) delete process.env.ARAG_DAEMON; else process.env.ARAG_DAEMON = save;
});

test('applyFloor: floor=null は素通し / 数値はフィルタ（既存挙動の回帰）', () => {
  const hits = [hit('a', 0.8), hit('b', 0.1)];
  assert.strictEqual(U.applyFloor(hits, null).length, 2);
  assert.deepStrictEqual(U.applyFloor(hits, 0.5).map((h) => h.source), ['a']);
});
