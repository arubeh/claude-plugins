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

test('shouldDeepNudge: 0件 かつ 有効 かつ 未ナッジ のときだけ true (#22)', () => {
  assert.strictEqual(U.shouldDeepNudge({ injected: 0, enabled: true, alreadyNudged: false }), true);
  assert.strictEqual(U.shouldDeepNudge({ injected: 2, enabled: true, alreadyNudged: false }), false, 'ヒットあれば出さない');
  assert.strictEqual(U.shouldDeepNudge({ injected: 0, enabled: false, alreadyNudged: false }), false, '無効なら出さない');
  assert.strictEqual(U.shouldDeepNudge({ injected: 0, enabled: true, alreadyNudged: true }), false, 'セッション既ナッジは出さない(rate-limit)');
});

test('deepNudgeEnabled: 既定 ON・0/false/off/no で OFF (#22)', () => {
  const save = process.env.ARAG_RECALL_DEEP_NUDGE;
  delete process.env.ARAG_RECALL_DEEP_NUDGE;
  assert.strictEqual(U.deepNudgeEnabled(), true, '未設定は ON');
  process.env.ARAG_RECALL_DEEP_NUDGE = '0';
  assert.strictEqual(U.deepNudgeEnabled(), false);
  process.env.ARAG_RECALL_DEEP_NUDGE = 'off';
  assert.strictEqual(U.deepNudgeEnabled(), false);
  if (save === undefined) delete process.env.ARAG_RECALL_DEEP_NUDGE; else process.env.ARAG_RECALL_DEEP_NUDGE = save;
});

// ---- 関連度ゲート（語彙ゲート + 相対フロア）-----------------------------------

test('recallGateEnabled: 既定 ON・0/false/off/no で OFF', () => {
  const save = process.env.ARAG_RECALL_GATE;
  delete process.env.ARAG_RECALL_GATE;
  assert.strictEqual(U.recallGateEnabled(), true, '未設定は ON');
  for (const v of ['0', 'false', 'off', 'no']) {
    process.env.ARAG_RECALL_GATE = v;
    assert.strictEqual(U.recallGateEnabled(), false, `${v} は OFF`);
  }
  process.env.ARAG_RECALL_GATE = '1';
  assert.strictEqual(U.recallGateEnabled(), true, '1 は ON');
  if (save === undefined) delete process.env.ARAG_RECALL_GATE; else process.env.ARAG_RECALL_GATE = save;
});

test('extractQueryTerms: ASCII は長さ≥3・小文字化・重複なし', () => {
  const t = U.extractQueryTerms('CI-fix Commit ci a loop');
  assert.deepStrictEqual(t.ascii.sort(), ['commit', 'fix', 'loop'], 'ci(2文字)/a は除外・重複なし');
});

test('extractQueryTerms: CJK は 2-gram に分解', () => {
  const t = U.extractQueryTerms('暗号化');
  assert.deepStrictEqual(t.cjk, ['暗号', '号化'], '連続ランの 2-gram');
});

test('extractQueryTerms: 記号のみ/短すぎは有意語ゼロ', () => {
  const t = U.extractQueryTerms('?? - / ci');
  assert.strictEqual(t.ascii.length, 0);
  assert.strictEqual(t.cjk.length, 0);
});

test('applyRelevanceGate: 英語クエリ↔日本語ヒットは重なりゼロで落とす（主症状）', () => {
  const hits = [
    { source: 'manual.md', section: 'バックアップ手順', preview: 'clasyslog のサイズが大きくなる場合' },
    { source: 'a.md', section: 'CI', preview: 'run ci-fix until green commit push' },
  ];
  const kept = U.applyRelevanceGate(hits, 'ci-fix commit push loop');
  assert.deepStrictEqual(kept.map((h) => h.source), ['a.md'], '日本語マニュアルは落ち英語ヒットは残る');
});

test('hitMatchesQuery: ASCII は語トークン一致（suffix への部分一致は不可・terminal_fix は可）', () => {
  const terms = U.extractQueryTerms('ci-fix');
  assert.strictEqual(U.hitMatchesQuery({ preview: 'this is a suffix and prefix' }, terms), false, 'suffix の fix には誤一致しない');
  assert.strictEqual(U.hitMatchesQuery({ preview: 'FORCING_TERMINAL_FIX flag' }, terms), true, '区切りで分かれた fix トークンは一致（語の真の重なり）');
});

test('applyRelevanceGate: 同言語の関連ヒットは残す（過剰ドロップなし）', () => {
  const hits = [{ source: 'm.md', section: '暗号化監視', preview: '暗号化監視の設定を行う' }];
  const kept = U.applyRelevanceGate(hits, '暗号化監視 設定');
  assert.strictEqual(kept.length, 1, 'CJK 2-gram が重なるので残る');
});

test('applyRelevanceGate: 有意語ゼロのクエリは素通し（fail-open）', () => {
  const hits = [{ source: 'm.md', section: 'x', preview: 'y' }];
  assert.strictEqual(U.applyRelevanceGate(hits, '?? ci').length, 1);
});

test('applyRelevanceGate: 本文が取れないヒットは残す（fail-open）', () => {
  const hits = [{ source: 'm.md' }];
  assert.strictEqual(U.applyRelevanceGate(hits, 'loop fix').length, 1);
});

test('recallMinRatio: 0<r<=1 のみ採用・それ以外は null（OFF）', () => {
  const save = process.env.ARAG_RECALL_MIN_RATIO;
  delete process.env.ARAG_RECALL_MIN_RATIO;
  assert.strictEqual(U.recallMinRatio(), null, '未設定は null');
  process.env.ARAG_RECALL_MIN_RATIO = '0.5';
  assert.strictEqual(U.recallMinRatio(), 0.5);
  for (const v of ['0', '-1', '1.5', 'abc']) {
    process.env.ARAG_RECALL_MIN_RATIO = v;
    assert.strictEqual(U.recallMinRatio(), null, `${v} は範囲外/不正→null`);
  }
  if (save === undefined) delete process.env.ARAG_RECALL_MIN_RATIO; else process.env.ARAG_RECALL_MIN_RATIO = save;
});

test('applyRelativeFloor: null は素通し / top×ratio 未満を落とす', () => {
  const hits = [hit('a', 6), hit('b', 2), hit('c', 0.5)];
  assert.strictEqual(U.applyRelativeFloor(hits, null).length, 3, 'null は素通し');
  assert.deepStrictEqual(U.applyRelativeFloor(hits, 0.5).map((h) => h.source), ['a'], 'top6×0.5=3 未満を落とす');
});

test('applyRelativeFloor: top が非正なら素通し / score なしは残す', () => {
  assert.strictEqual(U.applyRelativeFloor([hit('a', -1), hit('b', -2)], 0.5).length, 2, 'top<=0 は無意味→素通し');
  assert.strictEqual(U.applyRelativeFloor([{ source: 'a' }, hit('b', 6)], 0.5).length, 2, 'score なしは残す');
});
