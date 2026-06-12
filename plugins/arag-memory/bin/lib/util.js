'use strict';
// arag-memory 共有ユーティリティ（依存ゼロ・Node 組み込みのみ）
// 設計の根拠は docs/arag-learning-loop-plan.md（§0 同時書き込み / §1.7 レイテンシ / §1.8 二層 / §1.6⑤ scope）。

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const GLOBAL_PROJECT = '_global'; // 全PJ統一の単一 global ストア（§1.6⑤）

// ---- パス解決 -------------------------------------------------------------

// 作業中プロジェクトのルート。フック stdin の cwd か CLAUDE_PROJECT_DIR を使う。
function projectDir(hookInput) {
  return (
    (hookInput && hookInput.cwd) ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
}

function localDataDir(proj) {
  return path.join(proj, '.arag');
}
function draftFile(proj) {
  return path.join(localDataDir(proj), '_drafts', 'pending.jsonl');
}
function recentFile(proj) {
  return path.join(localDataDir(proj), '_recent.json'); // SessionStart 用の安価な記憶マップ
}
function pendingNoticeFile(proj) {
  return path.join(localDataDir(proj), '_pending-notice.json'); // 昇格通知の引き継ぎ
}

// ---- 参加判定（未参加 PJ では全機能 no-op：オプトアウトガード §0.1）---------

function isParticipating(proj) {
  try {
    if (fs.existsSync(path.join(proj, '.arag-disabled'))) return false;
    return fs.existsSync(localDataDir(proj)); // arag init 済みのみ参加
  } catch {
    return false;
  }
}

// arag MCP は meta.json（=1件以上 add 済みインデックス）が無いとハードエラーで落ちる。
// 一方フック側の search は空でも graceful。よって MCP 起動可否は meta.json で判定する。
function hasLocalIndex(proj) {
  try {
    return fs.existsSync(path.join(localDataDir(proj), 'meta.json'));
  } catch {
    return false;
  }
}

// global（`--project _global`）の data-dir 候補。新既定 `~/.acode/arag/projects/`、
// 旧 `~/.local/share/rag/projects/` を fallback（arag paths.rs と整合）。
function globalDataDirCandidates() {
  const home = os.homedir();
  return [
    path.join(home, '.acode', 'arag', 'projects', GLOBAL_PROJECT),
    path.join(home, '.local', 'share', 'rag', 'projects', GLOBAL_PROJECT),
  ];
}

function hasGlobalIndex() {
  return globalDataDirCandidates().some((d) => {
    try {
      return fs.existsSync(path.join(d, 'meta.json'));
    } catch {
      return false;
    }
  });
}

// ---- arag バイナリ実行 ----------------------------------------------------

function resolveAragBin() {
  if (process.env.ARAG_BIN) return process.env.ARAG_BIN;
  // arag CLAUDE.md の .mcp.json 規約に合わせ ~/.acode/bin/arag を候補に
  const home = os.homedir();
  const cand = [
    path.join(home, '.acode', 'bin', process.platform === 'win32' ? 'arag.exe' : 'arag'),
  ];
  for (const c of cand) {
    try { if (fs.existsSync(c)) return c; } catch { /* noop */ }
  }
  return 'arag'; // PATH に委ねる
}

// arag CLI をワンショット実行。timeoutMs 超過や失敗は {ok:false} を返す（fail-open は呼び出し側）。
function runArag(args, { cwd, timeoutMs = 1500, input } = {}) {
  try {
    const r = spawnSync(resolveAragBin(), args, {
      cwd,
      input,
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (r.error || r.status !== 0) {
      return { ok: false, stdout: r.stdout || '', stderr: r.stderr || String(r.error || `exit ${r.status}`) };
    }
    return { ok: true, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e) };
  }
}

// ANSI エスケープ除去（テキストフォールバック整形用）
function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
}

// bm25 高速パス検索（モデル非ロード・~100ms／§1.7）。
// arag #56 の `-f json` を使い構造化結果を得る。未対応(旧 arag)なら ANSI 除去テキストへ
// フォールバック（前方・後方互換）。`--project` はグローバル指定のためサブコマンド前に置く。
function searchBm25(query, { cwd, project, topK = 5, timeoutMs = 1500 } = {}) {
  const args = [];
  if (project) args.push('--project', project);
  args.push('search', '-m', 'bm25', '-k', String(topK), '-f', 'json', query);
  const r = runArag(args, { cwd, timeoutMs });
  if (!r.ok) return { ok: false, hits: [], stderr: r.stderr };
  try {
    const parsed = JSON.parse(r.stdout);
    const hits = Array.isArray(parsed) ? parsed : (parsed.results || parsed.hits || []);
    return { ok: true, hits, text: '' };
  } catch {
    // 旧 arag（search に -f json 無し）→ ANSI 除去テキストをそのまま返す（fail-open）
    return { ok: true, hits: [], text: stripAnsi(r.stdout).trim() };
  }
}

// ---- アトミック mkdir ロック（flock 相当・Windows 対応／§0）------------------
// mkdir はどの OS でも原子的。既存なら EEXIST で待ち、stale はタイムアウトで奪う。

function acquireLock(lockPath, { timeoutMs = 5000, staleMs = 60000, pollMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockPath, { recursive: false });
      try { fs.writeFileSync(path.join(lockPath, 'pid'), String(process.pid)); } catch { /* noop */ }
      return () => { try { fs.rmSync(lockPath, { recursive: true, force: true }); } catch { /* noop */ } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // stale ロックの奪取
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch { /* レース：消えたら次ループで取れる */ }
      if (Date.now() > deadline) return null; // 取得失敗（呼び出し側で skip）
      sleepSync(pollMs);
    }
  }
}

function sleepSync(ms) {
  // 依存ゼロの同期 sleep（短時間のみ）。Atomics.wait を使う。
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

// ---- 秘密情報スクラブ（capture 前／§1.5 秘密除外・security.md と同原則）-------

const SECRET_PATTERNS = [
  // key=value / key: value 形式の秘密
  { re: /\b((?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|client[_-]?secret|authorization|bearer)\s*[:=]\s*)("?[^\s"']+"?)/gi, repl: '$1«REDACTED»' },
  // よくあるトークン接頭辞
  { re: /\b(sk|pk|rk|ghp|gho|ghu|ghs|xox[baprs])[-_][A-Za-z0-9]{8,}\b/g, repl: '«REDACTED-TOKEN»' },
  // AWS アクセスキー
  { re: /\bAKIA[0-9A-Z]{16}\b/g, repl: '«REDACTED-AWS»' },
  // 秘密鍵ブロック
  { re: /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, repl: '«REDACTED-PRIVATE-KEY»' },
  // メールアドレス（PII）
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, repl: '«REDACTED-EMAIL»' },
];

function scrubSecrets(text) {
  if (!text) return text;
  let out = String(text);
  for (const { re, repl } of SECRET_PATTERNS) out = out.replace(re, repl);
  return out;
}

// ---- recall フロア & セッション内既出抑制（#14 / arag#81 の plugin 側）---------
// 小コーパスで BM25 上位が常に同じ無関係文書になり、recall が「ノイズ垂れ流し」になる
// のを止める。フロア＝関連度の低い注入を出さない（ゼロ注入＞無関係注入）。既出抑制＝
// 同一セッションで一度出した文書を以後は出さない（アラーム疲れの回避）。

// `ARAG_RECALL_MIN_SCORE`（`RAG_` fallback）→ 関連度フロア（number|null）。未設定/不正は null。
function recallFloor() {
  return parseFloor(process.env.ARAG_RECALL_MIN_SCORE || process.env.RAG_RECALL_MIN_SCORE);
}
function parseFloor(v) {
  if (v == null || String(v).trim() === '') return null;
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
}
// score がフロア未満のヒットを落とす純粋関数（floor=null は素通し＝従来挙動）。
function applyFloor(hits, floor) {
  if (floor == null) return hits || [];
  return (hits || []).filter((h) => typeof h.score === 'number' && h.score >= floor);
}

// セッション内既出抑制の有効可否（既定 ON・`ARAG_RECALL_SESSION_DEDUP=0/false/off/no` で OFF）。
function sessionDedupEnabled() {
  const v = (process.env.ARAG_RECALL_SESSION_DEDUP || '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}
function recallSeenFile(proj) {
  return path.join(localDataDir(proj), '_recall-seen.json'); // セッション単位の既出文書集合
}
// hits を「既出キー集合 seen に無いもの」だけへ絞る純粋関数（#14・テスト容易）。
// keyOf(h) がキー（falsy のヒットは抑制対象外＝常に残す）。返り値 {kept, keys}
// （keys=新たに採用した非 falsy キー列。呼び出し側が seen に積み増す）。
function dedupAgainstSeen(hits, seen, keyOf) {
  const set = seen instanceof Set ? seen : new Set(seen || []);
  const kept = [];
  const keys = [];
  for (const h of hits || []) {
    const k = keyOf(h);
    if (!k) { kept.push(h); continue; }
    if (set.has(k)) continue;
    kept.push(h);
    keys.push(k);
  }
  return { kept, keys };
}

// ---- JSON I/O ヘルパ -------------------------------------------------------

function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonSafe(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // temp→rename で原子的に書く
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

// フック stdin（JSON）を読む。空なら {}。
function readHookInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// SessionStart / UserPromptSubmit のコンテキスト注入用 JSON を stdout へ。
function emitContext(eventName, additionalContext) {
  if (!additionalContext) { process.stdout.write(''); return; }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext },
  }));
}

// ANSI 色（色付き通知用）。
const color = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

module.exports = {
  GLOBAL_PROJECT,
  projectDir, localDataDir, draftFile, recentFile, pendingNoticeFile,
  isParticipating, hasLocalIndex, hasGlobalIndex,
  resolveAragBin, runArag, searchBm25,
  acquireLock, sleepSync,
  scrubSecrets,
  recallFloor, parseFloor, applyFloor,
  sessionDedupEnabled, recallSeenFile, dedupAgainstSeen,
  readJsonSafe, writeJsonSafe, readHookInput, emitContext,
  color,
};
