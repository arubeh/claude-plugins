'use strict';
// pre-edit-gate / record-evidence / util のスモークテスト。
// 実行: node plugins/cgc-guard/test/smoke.js
// CI 基盤なしでも回せる依存ゼロの assert ベース。フックは stdin JSON →
// stdout JSON の純関数に近いので、子プロセスで主要パスを検証する。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'bin', 'pre-edit-gate.js');
const U = require(path.join(ROOT, 'bin', 'lib', 'util.js'));

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgc-guard-smoke-'));
  fs.mkdirSync(path.join(dir, '.cgc'), { recursive: true });
  // 参加判定 = graph.json あり。小規模 warn 降格を避けるため十分大きく。
  fs.writeFileSync(path.join(dir, '.cgc', 'graph.json'), 'x'.repeat(300000));
  return dir;
}

function runGate(input, env = {}) {
  const r = spawnSync(process.execPath, [GATE], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CGC_BIN: process.execPath, ...env }, // cgcAvailable を満たすダミー
  });
  assert.strictEqual(r.status, 0, `gate exited ${r.status}: ${r.stderr}`);
  if (!r.stdout.trim()) return null;
  return JSON.parse(r.stdout);
}

function decision(out) {
  if (!out || !out.hookSpecificOutput) return undefined;
  return out.hookSpecificOutput.permissionDecision;
}

function writeTranscript(proj, entries) {
  const p = path.join(proj, 'transcript.jsonl');
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

// ---- util 単体 ----------------------------------------------------------------

assert.ok(U.isTestPath('crates/foo/tests/integration.rs'));
assert.ok(U.isTestPath('src/app.test.ts'));
assert.ok(U.isTestPath('pkg/conftest.py'));
assert.ok(!U.isTestPath('src/app.ts'));

{
  // recentCgcToolUse: プラグイン名前空間の tool_use を検出し、TTL を尊重する。
  const proj = tmpProject();
  const fresh = new Date().toISOString();
  const staleTs = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const tp = writeTranscript(proj, [
    { type: 'assistant', timestamp: fresh, message: { content: [
      { type: 'tool_use', name: 'mcp__plugin_cgc-guard_cgc__impact' },
    ] } },
  ]);
  assert.ok(U.recentCgcToolUse(tp), 'namespaced tool_use must count as evidence');
  const tpStale = writeTranscript(proj, [
    { type: 'assistant', timestamp: staleTs, message: { content: [
      { type: 'tool_use', name: 'mcp__cgc__context' },
    ] } },
  ]);
  assert.ok(!U.recentCgcToolUse(tpStale, 10 * 60 * 1000), 'stale tool_use must not count');
}

// ---- gate: deny + 理由コード ----------------------------------------------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's1',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), 'deny');
  assert.ok(
    /\[reason=MARKER_AND_EVIDENCE_MISSING deny=1\/2\]/.test(
      out.hookSpecificOutput.permissionDecisionReason
    ),
    'deny must carry a reason code'
  );
}

// ---- gate: transcript tool_use フォールバックで allow + 承認が永続化 -------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [
    { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [
      { type: 'tool_use', name: 'mcp__plugin_cgc-guard_cgc__context' },
    ] } },
  ]);
  const input = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's2',
    transcript_path: tp,
  };
  assert.strictEqual(decision(runGate(input)), undefined, 'fallback evidence must allow');
  // 承認記録により、transcript が空になっても TTL 内は通る (#189-4)。
  const emptyTp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  input.transcript_path = emptyTp;
  assert.strictEqual(decision(runGate(input)), undefined, 'approval must persist');
}

// ---- gate: テストファイルは既定で対象外 (#189-1) ---------------------------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'tests', 'integration.rs') },
    cwd: proj,
    session_id: 's3',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), undefined, 'test files must bypass the gate');
}

// ---- gate: 小規模リポは warn に降格 (#189-3) -------------------------------------

{
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc', 'graph.json'), '{}'); // tiny graph
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's4',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), 'allow', 'small repo must downgrade to warn');
  assert.ok(/warn モード/.test(out.hookSpecificOutput.permissionDecisionReason));
}

// ---- gate: .cgc-guard.json mode=off ---------------------------------------------

{
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc-guard.json'), JSON.stringify({ mode: 'off' }));
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's5',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), undefined, 'mode=off must disable the gate');
}

// ---- gate: deny 上限超過で降格 allow ---------------------------------------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const input = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's6',
    transcript_path: tp,
  };
  assert.strictEqual(decision(runGate(input)), 'deny');
  assert.strictEqual(decision(runGate(input)), 'deny');
  assert.strictEqual(decision(runGate(input)), undefined, '3rd attempt must degrade to allow');
}

// ---- record-evidence: 名前空間付きツール名で証跡が記録される ----------------------

{
  const proj = tmpProject();
  const REC = path.join(ROOT, 'bin', 'record-evidence.js');
  const r = spawnSync(process.execPath, [REC], {
    input: JSON.stringify({
      tool_name: 'mcp__plugin_cgc-guard_cgc__impact',
      tool_input: { target: 'main' },
      tool_response: 'TARGET: main (callers of ' + proj.replace(/\\/g, '\\\\') + '\\\\src\\\\main.rs:1)',
      cwd: proj,
      session_id: 's7',
    }),
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const ev = JSON.parse(
    fs.readFileSync(path.join(proj, '.cgc', 'tmp', 'evidence-s7.json'), 'utf8')
  );
  assert.strictEqual(ev.entries.length, 1, 'namespaced tool must be recorded');
  assert.strictEqual(ev.entries[0].tool, 'mcp__plugin_cgc-guard_cgc__impact');
}

console.log('smoke: all assertions passed');
