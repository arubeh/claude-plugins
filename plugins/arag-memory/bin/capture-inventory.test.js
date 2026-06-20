'use strict';
// capture-inventory.js の純粋関数テスト（`node --test bin/capture-inventory.test.js`）。
// 発火ゲート decideInventory と transcript の user 発話カウントを中心に検証。

const test = require('node:test');
const assert = require('node:assert');
const C = require('./capture-inventory');

const userLine = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const userToolResult = () => JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'out' }] } });
const asstText = (text) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const sysLine = () => JSON.stringify({ type: 'system', content: 'noise' });

// 健全な既定値（'run' になる）を作るヘルパー。各テストで 1 項目だけ崩す。
const base = (over = {}) => ({
  participating: true,
  enabled: true,
  stopHookActive: false,
  alreadyInventoried: false,
  draftsExist: false,
  userTurns: 5,
  minTurns: 4,
  ...over,
});

test('decideInventory: 既定条件では run', () => {
  assert.strictEqual(C.decideInventory(base()), 'run');
});

test('decideInventory: 未参加は no-op', () => {
  assert.strictEqual(C.decideInventory(base({ participating: false })), 'skip:not-participating');
});

test('decideInventory: opt-out(disabled) は発火しない', () => {
  assert.strictEqual(C.decideInventory(base({ enabled: false })), 'skip:disabled');
});

test('decideInventory: stop_hook_active 中はループ防止で通す', () => {
  assert.strictEqual(C.decideInventory(base({ stopHookActive: true })), 'skip:stop-hook-active');
});

test('decideInventory: 同一セッションで既に棚卸し済みなら通す', () => {
  assert.strictEqual(C.decideInventory(base({ alreadyInventoried: true })), 'skip:already-done');
});

test('decideInventory: 下書きが既にあれば過干渉しない', () => {
  assert.strictEqual(C.decideInventory(base({ draftsExist: true })), 'skip:drafts-exist');
});

test('decideInventory: 薄いセッション(user 発話 < minTurns)は触らない', () => {
  assert.strictEqual(C.decideInventory(base({ userTurns: 3, minTurns: 4 })), 'skip:thin');
  // ちょうど minTurns に達したら発火する（境界）
  assert.strictEqual(C.decideInventory(base({ userTurns: 4, minTurns: 4 })), 'run');
});

test('decideInventory: 優先順位 — 未参加は他条件より先に no-op', () => {
  assert.strictEqual(
    C.decideInventory(base({ participating: false, enabled: false, stopHookActive: true })),
    'skip:not-participating'
  );
});

test('countUserTurns: 実ユーザー発話だけ数える（tool_result/assistant/system は除外）', () => {
  const tx = [
    userLine('最初の依頼'),
    asstText('対応します'),
    userToolResult(),          // tool_result（配列 content）→ 除外
    sysLine(),                  // system → 除外
    userLine('次の依頼'),
    asstText('やりました'),
    userLine('  '),            // 空白のみ → 除外
    'こわれた行',               // JSON でない → 除外
  ].join('\n');
  assert.strictEqual(C.countUserTurns(tx), 2);
});

test('countUserTurns: 空入力は 0', () => {
  assert.strictEqual(C.countUserTurns(''), 0);
  assert.strictEqual(C.countUserTurns(null), 0);
});

test('isRealUserLine: 文字列 content の user 行だけ true', () => {
  assert.strictEqual(C.isRealUserLine(userLine('hi')), true);
  assert.strictEqual(C.isRealUserLine(userToolResult()), false);
  assert.strictEqual(C.isRealUserLine(asstText('x')), false);
  assert.strictEqual(C.isRealUserLine('not json'), false);
});

test('inventoryEnabled: 既定 ON・明示 off で OFF', () => {
  const save = process.env.ARAG_CAPTURE_INVENTORY;
  try {
    delete process.env.ARAG_CAPTURE_INVENTORY;
    assert.strictEqual(C.inventoryEnabled(), true);
    for (const v of ['0', 'false', 'off', 'no', 'OFF']) {
      process.env.ARAG_CAPTURE_INVENTORY = v;
      assert.strictEqual(C.inventoryEnabled(), false, `${v} は OFF`);
    }
    process.env.ARAG_CAPTURE_INVENTORY = '1';
    assert.strictEqual(C.inventoryEnabled(), true);
  } finally {
    if (save === undefined) delete process.env.ARAG_CAPTURE_INVENTORY;
    else process.env.ARAG_CAPTURE_INVENTORY = save;
  }
});

test('minTurns: 既定 4・正の整数のみ採用', () => {
  const save = process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS;
  try {
    delete process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS;
    assert.strictEqual(C.minTurns(), 4);
    process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS = '8';
    assert.strictEqual(C.minTurns(), 8);
    process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS = '0';
    assert.strictEqual(C.minTurns(), 4, '0/不正は既定 4');
    process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS = 'xyz';
    assert.strictEqual(C.minTurns(), 4);
  } finally {
    if (save === undefined) delete process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS;
    else process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS = save;
  }
});

test('INVENTORY_REASON: 「何も無ければ作らない」逃げ道を必ず含む（ゴミ capture 防止）', () => {
  assert.ok(/記録不要/.test(C.INVENTORY_REASON));
  assert.ok(/capture-draft\.js/.test(C.INVENTORY_REASON));
});
