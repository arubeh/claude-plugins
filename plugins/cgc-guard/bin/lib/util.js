'use strict';
// cgc-guard 共有ユーティリティ（依存ゼロ・Node 組み込みのみ）。
// 設計の単一ソースは plugins/cgc-guard/README.md。
// arag-memory の lib/util.js と同じ原則: fail-open / 未参加 PJ では no-op / 原子的 I/O。

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ---- パス解決 -------------------------------------------------------------

function projectDir(hookInput) {
  return (
    (hookInput && hookInput.cwd) ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
}

function cgcDir(proj) { return path.join(proj, '.cgc'); }
function graphFile(proj) { return path.join(cgcDir(proj), 'graph.json'); }
function metaFile(proj) { return path.join(cgcDir(proj), 'graph.meta.json'); }
// state 置き場。.cgc/.gitignore は `*` なので自動的に ignore される。
function tmpDir(proj) { return path.join(cgcDir(proj), 'tmp'); }
function evidenceFile(proj, sessionId) {
  return path.join(tmpDir(proj), `evidence-${sanitizeId(sessionId)}.json`);
}
function denyStateFile(proj, sessionId) {
  return path.join(tmpDir(proj), `deny-${sanitizeId(sessionId)}.json`);
}
function indexStampFile(proj) { return path.join(tmpDir(proj), 'index.stamp.json'); }
function indexLockDir(proj) { return path.join(tmpDir(proj), 'index.lock'); }

function sanitizeId(s) {
  return String(s || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

// ---- 参加判定（インストール＝オプトイン。未参加 PJ では全フック no-op）-------
// 参加 = `.cgc/graph.json` あり（= cgc index . 実行済み）かつ `.cgc-disabled` 無し。

function isParticipating(proj) {
  try {
    if (fs.existsSync(path.join(proj, '.cgc-disabled'))) return false;
    return fs.existsSync(graphFile(proj));
  } catch {
    return false;
  }
}

// ---- cgc バイナリ解決 -------------------------------------------------------

function resolveCgcBin() {
  if (process.env.CGC_BIN) return process.env.CGC_BIN;
  const home = os.homedir();
  const cand = path.join(home, '.acode', 'bin', process.platform === 'win32' ? 'cgc.exe' : 'cgc');
  try { if (fs.existsSync(cand)) return cand; } catch { /* noop */ }
  return 'cgc'; // PATH に委ねる
}

// cgc が実行可能か。~/.acode/bin に実体があれば即 true、無ければ PATH 上を 1 回だけ
// probe して結果を OS tmp にキャッシュ（1h）。フック毎の spawn を避けるため。
function cgcAvailable() {
  const bin = resolveCgcBin();
  if (bin !== 'cgc') return true; // 実体パスを確認済み
  const cache = path.join(os.tmpdir(), 'cgc-guard-bin-probe.json');
  const cached = readJsonSafe(cache, null);
  if (cached && Date.now() - cached.ts < 3600_000) return !!cached.ok;
  let ok = false;
  try {
    const r = spawnSync(bin, ['--version'], { timeout: 1500, encoding: 'utf8', windowsHide: true });
    ok = !r.error;
  } catch { ok = false; }
  writeJsonSafe(cache, { ts: Date.now(), ok });
  return ok;
}

// ---- コードファイル判定 ------------------------------------------------------
// ゲート/差分 index の対象はコードのみ。docs/設定は waiver（README「コンポーネント仕様 2」）。

const CODE_EXTS = new Set([
  'rs', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'java', 'rb',
  'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'swift', 'kt', 'kts', 'scala',
  'vue', 'svelte', 'ipynb',
]);

function isCodeFile(p) {
  if (!p) return false;
  const ext = path.extname(String(p)).slice(1).toLowerCase();
  return CODE_EXTS.has(ext);
}

// テキストからコード拡張子を持つ path 風トークンを抽出（証跡の paths 用）。
function extractCodePaths(text) {
  const out = new Set();
  const re = /[A-Za-z0-9_./\\:-]+\.(?:rs|tsx?|jsx?|mjs|cjs|py|go|java|rb|cc?|cpp|h|hpp|cs|php|swift|kts?|scala|vue|svelte)\b/g;
  let m;
  const s = String(text || '');
  while ((m = re.exec(s)) !== null) {
    out.add(m[0].replace(/\\\\/g, '\\').toLowerCase());
    if (out.size >= 200) break;
  }
  return [...out];
}

// ---- transcript 末尾から最後の assistant テキストを取る -----------------------
// waiver マーカー（[cgc-skip] / [cgc-check]）は「直近の assistant メッセージ」内のみ
// 有効。古いマーカーの再利用を防ぐため raw tail 全体は検索しない。

function lastAssistantText(transcriptPath, maxBytes = 262144) {
  try {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
    const st = fs.statSync(transcriptPath);
    const start = Math.max(0, st.size - maxBytes);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    let last = '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      let obj;
      try { obj = JSON.parse(t); } catch { continue; }
      if (!obj || obj.type !== 'assistant') continue;
      const content = obj.message && obj.message.content;
      if (!Array.isArray(content)) continue;
      const texts = content.filter((c) => c && c.type === 'text' && c.text).map((c) => c.text);
      if (texts.length) last = texts.join('\n');
    }
    return last;
  } catch {
    return '';
  }
}

// ---- アトミック mkdir ロック（arag-memory と同方式）---------------------------

function acquireLock(lockPath, { timeoutMs = 0, staleMs = 600000, pollMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { recursive: false });
      try { fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid)); } catch { /* noop */ }
      return () => { try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch { /* noop */ } };
    } catch (e) {
      if (e.code === 'ENOENT') {
        // 親 dir 不在 → 作って再試行
        try { fs.mkdirSync(path.dirname(lockPath), { recursive: true }); continue; } catch { return null; }
      }
      if (e.code !== 'EEXIST') return null;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch { /* レース：消えたら次ループで取れる */ }
      if (Date.now() >= deadline) return null;
      sleepSync(pollMs);
    }
  }
}

function sleepSync(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

// ---- JSON I/O / フック入出力 -------------------------------------------------

function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonSafe(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function emitContext(eventName, additionalContext) {
  if (!additionalContext) { process.stdout.write(''); return; }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext },
  }));
}

function emitDeny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

module.exports = {
  projectDir, cgcDir, graphFile, metaFile, tmpDir,
  evidenceFile, denyStateFile, indexStampFile, indexLockDir,
  isParticipating, resolveCgcBin, cgcAvailable,
  isCodeFile, extractCodePaths, lastAssistantText,
  acquireLock, sleepSync,
  readJsonSafe, writeJsonSafe, readHookInput, emitContext, emitDeny,
};
