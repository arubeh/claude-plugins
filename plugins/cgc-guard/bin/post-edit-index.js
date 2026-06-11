'use strict';
// 差分インデックス自動化（PostToolUse: Edit|Write|NotebookEdit|Bash）。
// 仕様は plugins/cgc-guard/README.md「コンポーネント仕様 4」。
//
// #7 教訓（フックは timeout を待たず process tree ごと kill され得る）への対策:
//   - フック本体（hook モード）は state 確認と detached spawn のみで即 return（kill 窓なし）
//   - 実処理（--run モード）はフックの process tree 外で走る detached node 子プロセス
//   - cgc index はソースから再導出する冪等処理 → 途中死しても次回実行で収束
//   - 取りこぼしは session-start.js の鮮度チェックが回収（バックストップ）

const { spawn, spawnSync } = require('child_process');
const U = require('./lib/util');

const DEBOUNCE_MS = 30 * 1000;       // 編集起点の再 index 間隔
const LOCK_STALE_MS = 10 * 60 * 1000; // index 実行ロックの stale 判定

function main() {
  if (process.argv[2] === '--run') {
    runIndex(process.argv[3]);
    return;
  }
  hookMode();
}

// ---- hook モード（同期・即 return）-----------------------------------------

function hookMode() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);
  if (!U.isParticipating(proj) || !U.cgcAvailable()) return;

  let force = false;
  if (input.tool_name === 'Bash') {
    // git 由来の外部変更（pull/checkout 等）は debounce を無視して即時再 index
    const cmd = String((input.tool_input || {}).command || '');
    if (!/\bgit\s+(pull|checkout|switch|merge|rebase|reset)\b/.test(cmd)) return;
    force = true;
  } else {
    const file = (input.tool_input || {}).file_path || (input.tool_input || {}).notebook_path;
    if (!U.isCodeFile(file)) return;
  }

  const now = Date.now();
  const stamp = U.readJsonSafe(U.indexStampFile(proj), { ts: 0 });
  if (!force && now - stamp.ts < DEBOUNCE_MS) return; // debounce
  try {
    const fs = require('fs');
    const st = fs.statSync(U.indexLockDir(proj));
    if (now - st.mtimeMs < LOCK_STALE_MS) return; // index 実行中
  } catch { /* ロック無し → 続行 */ }

  // detached 子プロセスへ委譲（stdio 切断 + unref でフック kill の影響を受けない）
  try {
    const child = spawn(process.execPath, [__filename, '--run', proj], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch { return; } // fail-open

  if (force) {
    U.emitContext(
      'PostToolUse',
      '[cgc-guard] git による外部変更を検知し、cgc graph の再インデックスを開始しました。' +
      '次に mcp__cgc__impact / context を使う前に mcp__cgc__reload_graph を実行してください。'
    );
  }
}

// ---- --run モード（detached 実行体）----------------------------------------

function runIndex(proj) {
  if (!proj || !U.isParticipating(proj)) return;
  const release = U.acquireLock(U.indexLockDir(proj), { timeoutMs: 0, staleMs: LOCK_STALE_MS });
  if (!release) return; // 先行 index が実行中
  try {
    const r = spawnSync(U.resolveCgcBin(), ['index', proj], {
      cwd: proj,
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      stdio: 'ignore',
    });
    U.writeJsonSafe(U.indexStampFile(proj), {
      ts: Date.now(),
      ok: !r.error && r.status === 0,
    });
  } finally {
    release();
  }
}

main();
