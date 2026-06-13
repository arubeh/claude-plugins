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
// env を渡すと process.env にマージして子へ伝える（#P2: ARAG_DAEMON=1 注入で stale 自己治癒）。
function runArag(args, { cwd, timeoutMs = 1500, input, env } = {}) {
  try {
    const r = spawnSync(resolveAragBin(), args, {
      cwd,
      input,
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
      env: env ? { ...process.env, ...env } : process.env,
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
// recall シード検索（mode 切替可能・#P2）。warm デーモン在なら hybrid（意味検索 ~168ms）、
// 不在なら bm25（~100ms）。`mode==='hybrid'` のときだけ ARAG_DAEMON=1 を注入し、stale な
// daemon.json（プロセス死亡後の残骸）に当たっても arag 側が cold へ自己フォールバック→
// daemon.json 削除し、次回から bm25 へ自然回復させる（毎回の重い cold ロードを防ぐ）。
function searchRecall(query, { cwd, project, topK = 5, timeoutMs = 2500, mode = 'bm25' } = {}) {
  const args = [];
  if (project) args.push('--project', project);
  args.push('search', '-m', mode, '-k', String(topK), '-f', 'json', query);
  const env = mode === 'hybrid' ? { ARAG_DAEMON: '1' } : undefined;
  const r = runArag(args, { cwd, timeoutMs, env });
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

// 後方互換: bm25 固定の旧シグネチャ（session-end の重複判定など既存呼び出し・テスト用に温存）。
function searchBm25(query, opts = {}) {
  return searchRecall(query, { ...opts, mode: 'bm25' });
}

// warm 常駐デーモン(#71)が居そうかを stat+read 1 回(~0.1ms)で判定する（#P2）。
// daemon.json の存在 + endpoint/pipe/socket フィールドの有無で見る。ARAG_DAEMON=0/false/off/no
// は検出無効（false 固定）。例外は false（fail-open）。完全な liveness 検証はせず、stale な
// daemon.json は searchRecall の ARAG_DAEMON=1 注入による arag 側自己治癒に委ねる。
function daemonPresent() {
  if (/^(0|false|off|no)$/i.test(String(process.env.ARAG_DAEMON || ''))) return false;
  try {
    const info = path.join(os.homedir(), '.acode', 'arag', 'daemon', 'daemon.json');
    if (!fs.existsSync(info)) return false;
    const j = JSON.parse(fs.readFileSync(info, 'utf8'));
    return !!(j && (j.endpoint || j.pipe || j.socket));
  } catch {
    return false;
  }
}

// recall シードの検索モード（#P2）。`ARAG_RECALL_MODE=bm25|hybrid|auto`（既定 auto）。
// auto は warm デーモンが居れば hybrid（意味検索・言い換えに強い）、居なければ bm25（§1.7 死守）。
function recallMode() {
  const v = String(process.env.ARAG_RECALL_MODE || 'auto').trim().toLowerCase();
  if (v === 'bm25' || v === 'hybrid') return v;
  return daemonPresent() ? 'hybrid' : 'bm25';
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

// ---- 深い recall ナッジ（#22: 安価シードが 0 件のとき MCP 深掘りを促す）----------
// 安価フック層（bm25/warm hybrid）が 0 件のときだけ、深い意味検索（MCP arag_search/ask）を
// 促す 1 行をモデルに見せる。任意判断頼みだった深い recall を「決定論層がトリガを出す」形に
// 変える。過剰ナッジを避けるためセッション 1 回だけ（rate-limit）・既定 ON・env で opt-out。

// 既定 ON。`ARAG_RECALL_DEEP_NUDGE=0/false/off/no` で無効。
function deepNudgeEnabled() {
  const v = (process.env.ARAG_RECALL_DEEP_NUDGE || '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

// ナッジを出すか（純粋関数・テスト容易）。注入実体が 0 件 かつ 有効 かつ 当該セッション未ナッジ
// のときだけ true。シードに 1 件でもヒットがあれば出さない（過剰ナッジ防止の主条件）。
function shouldDeepNudge({ injected, enabled, alreadyNudged }) {
  return !!enabled && injected === 0 && !alreadyNudged;
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

// ---- global 予約枠つきマージ（#P1: local が TOP_K を独占して global が枯れるのを防ぐ）----
// 現状の「local で TOP_K を埋め、残り枠だけ global」は、ローカルが充実した PJ で global
// （別 PJ 由来の汎用知識）が構造的に出ない。ユーザー要望「global と local の両方から想起」を
// 満たすため、global に最低枠を確保するスコープ横断マージへ置換する。

// global に確保する最低枠（既定 2・`RAG_` fallback）。0 で従来の local 優先充填へ opt-out。
function globalReserved() {
  const raw = process.env.ARAG_RECALL_GLOBAL_RESERVED ?? process.env.RAG_RECALL_GLOBAL_RESERVED ?? '2';
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return String(raw).trim() === '0' ? 0 : 2; // NaN/負は既定 2、明示 0 のみ opt-out
}

// scope 横断 dedup（純粋関数）: global から「local に既出の source キー」を除く（local 優先）。
// 同一文書が local/global 両 index に存在しても 1 度しか出さない。keyOf(falsy) は常に残す。
function dedupCrossScope(locHits, globHits, keyOf) {
  const locKeys = new Set((locHits || []).map(keyOf).filter(Boolean));
  return (globHits || []).filter((h) => {
    const k = keyOf(h);
    return !k || !locKeys.has(k);
  });
}

// 予約枠つきマージ（純粋関数・#P1）。TOP_K のうち最低 min(reserved, 利用可能 global 件数) を
// global に確保し、残りを local 優先で充填、なお余れば global で埋める。両端（local 空 /
// global 空）は従来同様 TOP_K まで片側で埋まる。positiveOnly（既定 ON）は score<=0 の global を
// 予約候補から除外（無関係ノイズの予約混入防止）。reserved=0 で従来の local 優先充填へバイト等価。
// 返り値 { loc, glob }（recall.js の「local→global」表示順を温存）。
function mergeReserved(locHits, globHits, topK, reserved, { positiveOnly = true } = {}) {
  const loc = Array.isArray(locHits) ? locHits : [];
  const globRaw = Array.isArray(globHits) ? globHits : [];
  const glob = positiveOnly ? globRaw.filter((h) => h.score == null || h.score > 0) : globRaw;
  const r = Math.max(0, reserved | 0);
  const g = Math.min(r, glob.length, topK);              // 確保する global 枠
  const locTake = Math.min(loc.length, topK - g);        // local は残りを充填
  const globTake = Math.min(glob.length, topK - locTake); // global は予約枠 + 余り
  return { loc: loc.slice(0, locTake), glob: glob.slice(0, globTake) };
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
  resolveAragBin, runArag, searchBm25, searchRecall, daemonPresent, recallMode,
  acquireLock, sleepSync,
  scrubSecrets,
  recallFloor, parseFloor, applyFloor,
  sessionDedupEnabled, recallSeenFile, dedupAgainstSeen,
  deepNudgeEnabled, shouldDeepNudge,
  globalReserved, dedupCrossScope, mergeReserved,
  readJsonSafe, writeJsonSafe, readHookInput, emitContext,
  color,
};
