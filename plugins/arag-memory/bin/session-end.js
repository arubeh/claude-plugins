'use strict';
// SessionEnd フック（capture の出口・§1.5 / §1.6⑤ / §0）。会話末に1回・背景実行。
//   1. 下書き pending.jsonl を読む（モデルが capture-draft.js で会話中に追記したもの）
//   2. 秘密スクラブ（多層防御）
//   3. local `./.arag/` へ flock 単一ライターで `arag add`
//   4. scope=org かつ confidence=known の項目を global(_global) へ flock で自動昇格（origin_project 付与）
//   5. 記憶マップ更新＋昇格通知を残す＋色付きサマリを出力
//   6. 下書きをクリア
// 毎ターンは書かない（重い全再構築は critical path 外）。
//
// ★ 早期 kill 耐性（#7）: Claude Code はセッション終了時に本フックを hooks.json の
// timeout を待たずプロセスツリーごと kill することがある（実測: 4 件中 1 件取込済みで死亡
// ×2 セッション）。対策は「kill 窓の最小化」と「再実行の冪等化」の 2 本柱:
//   - kill 窓の最小化: arag が `add-text --batch` (arag#69) に対応していれば、local 全件
//     /global 昇格分を各 1 プロセスの JSONL 一括取込で流す（N 回 spawn のモデルロード × N を畳む）
//   - 再実行の冪等化: index は stable id の upsert で収束、raw アーカイブ `_captured/` も
//     stable id 名で上書きされ重複バッチが発生しない。途中 kill されても下書きが残る限り
//     次セッションの SessionEnd が同じ結果に収束する

const fs = require('fs');
const path = require('path');
const os = require('os');
const U = require('./lib/util');

function parseDrafts(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const items = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { items.push(JSON.parse(t)); } catch { /* 壊れた行は捨てる */ }
  }
  return items;
}

// 1 項目を arag 取込用の Markdown doc に整形（本文に provenance を埋める）。
function toDoc(item, originProject) {
  const meta = [
    `type: ${item.type || 'lesson'}`,
    `date: ${item.date || ''}`,
    `source: ${item.source || ''}`,
    `status: ${item.status || 'provisional'}`,
    `scope: ${item.scope || 'project'}`,
    `confidence: ${item.confidence || 'inferred'}`,
    `epistemic: ${item.epistemic || 'inferred'}`,
    item.scope === 'org' ? `origin_project: ${originProject}` : null,
    item.slug ? `slug: ${item.slug}` : null,
  ].filter(Boolean).join('\n');
  const title = U.scrubSecrets(item.title || '(untitled)');
  const body = U.scrubSecrets(item.body || '');
  return `---\n${meta}\n---\n\n# ${title}\n\n${body}\n`;
}

// ファイル名用スラグ（英数＋日本語のみ・最大40字）。
function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

// add-text 用のコンテンツ由来安定 id（#5）。セッション等の実行文脈を含めないことで、
// 同じ知識が別セッション・別PJで再キャプチャされても同一 id → upsert で 1 件に収束する。
// （#7 で _captured/ の raw アーカイブ名もこの id に統一。再実行は同名上書き = 冪等）
function stableId(it) {
  return `${it.type || 'lesson'}_${slugify(U.scrubSecrets(it.title || ''))}`;
}

// タイトル正規化（重複ガード用）: 空白・主要な句読点/記号を除去して小文字化。
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s　]+/gu, '')
    .replace(/[。、，．.,!?！？「」『』()（）\[\]#*\-_:：;；]/gu, '');
}

// global 昇格前の重複ガード（#5）: 既存 global に正規化タイトルが一致する知識があれば
// 取り込みをスキップする。同一 id は add-text の upsert が収束させるため、ここで防ぐのは
// 旧形式 id（セッション依存/ id なし）の遺産や type 違い同名による二重化。
// 検索失敗・旧 arag（json 非対応）は fail-open（取り込む）。
function isDupInGlobal(it, { cwd }) {
  const title = U.scrubSecrets(it.title || '');
  const want = normTitle(title);
  if (!want) return false;
  const r = U.searchBm25(title, { cwd, project: U.GLOBAL_PROJECT, topK: 3, timeoutMs: 5000 });
  if (!r.ok) return false;
  return (r.hits || []).some((h) => {
    const firstLine = String(h.preview || h.text || '').split(/\r?\n/)[0].replace(/^#\s*/, '');
    return normTitle(firstLine) === want;
  });
}

// 永続 raw ストア（§7 raw アーカイブ）`./.arag/_captured/` へ capture doc を書き出す。
// 一時ファイルにしないことで arag の source が安定パスになり、再インデックス/監査もできる。
// ファイル名は stable id（#7）: フックが途中 kill され次セッションで再実行されても
// 同名上書きとなり、セッション id 違いの同一内容 raw が蓄積しない。
function writeCapturedFiles(proj, items, originProject) {
  const dir = path.join(U.localDataDir(proj), '_captured');
  fs.mkdirSync(dir, { recursive: true });
  return items.map((it) => {
    const file = path.join(dir, `${stableId(it)}.md`);
    fs.writeFileSync(file, toDoc(it, originProject));
    return { file, item: it };
  });
}

// arag CLI の対応機能を 1 回だけ probe する。help 出力に "add-text" (arag#66) /
// "add-text --batch" (arag#69) が含まれるかで判定（バージョン文字列に依存しない）。
let cliCaps = null;
function aragCliCaps() {
  if (cliCaps === null) {
    const r = U.runArag(['help'], { timeoutMs: 5000 });
    const txt = (r.stdout || '') + (r.stderr || '');
    cliCaps = { addText: /add-text/.test(txt), batch: /add-text --batch/.test(txt) };
  }
  return cliCaps;
}

// 1 項目を `arag add-text` 用ペイロードに分解する（arag#66）。
// frontmatter を本文に入れず metadata(JSON) で渡すことでノイズチャンク化を防ぎ、
// id（コンテンツ由来・セッション非依存 #5）で再取込時に upsert、source に本来の出典
// （Issue/PR 等）を載せて検索結果から辿れるようにする。
function toAddTextPayload(c, originProject) {
  const it = c.item;
  const metadata = {
    type: it.type || 'lesson',
    date: it.date || '',
    source: it.source || '',
    status: it.status || 'provisional',
    scope: it.scope || 'project',
    confidence: it.confidence || 'inferred',
    epistemic: it.epistemic || 'inferred',
  };
  if (it.scope === 'org') metadata.origin_project = originProject;
  if (it.slug) metadata.slug = it.slug;
  // #23: 救済由来は弱い知識の印を残す（recall/consolidate が識別して要精査扱いにする）。
  if (it.salvaged) metadata.salvaged = true;
  const title = U.scrubSecrets(it.title || '(untitled)');
  const body = U.scrubSecrets(it.body || '');
  return {
    id: stableId(it),
    text: `# ${title}\n\n${body}\n`,
    metadata,
    source: it.source || path.join('_captured', path.basename(c.file)),
    tags: [metadata.type, metadata.scope],
  };
}

// flock 下で arag へ取り込む。経路は能力に応じて 3 段:
//   1. `add-text --batch` (arag#69): 全件を 1 プロセス・JSONL 一括 upsert。kill 窓最小（#7 の本命）
//   2. `add-text` per-item (arag#66): 1 件ずつ spawn（batch 非対応 / batch 失敗時の部分回収）
//   3. `arag add <file>` : 旧 arag 用フォールバック（fail-open 原則）
function aragAddTexts(captured, { cwd, project, originProject }) {
  if (!captured.length) return { ok: true, count: 0 };
  const caps = aragCliCaps();
  if (!caps.addText) {
    return aragAddFiles(captured.map((c) => c.file), { cwd, project });
  }
  const lockName = project ? `arag-global-${project}` : 'arag-local';
  const release = U.acquireLock(path.join(os.tmpdir(), lockName + '.lock'), { timeoutMs: 8000 });
  if (!release) return { ok: false, count: 0, reason: 'lock-timeout' };
  try {
    const payloads = captured.map((c) => toAddTextPayload(c, originProject));

    if (caps.batch) {
      // JSONL 一括（オール・オア・ナッシング）。失敗時は per-item へ落として部分回収を試みる
      const jsonl = payloads
        .map((p) => JSON.stringify({ text: p.text, id: p.id, source: p.source, metadata: p.metadata, tags: p.tags }))
        .join('\n') + '\n';
      const args = [];
      if (project) args.push('--project', project); // グローバル指定はサブコマンド前
      args.push('add-text', '--batch');
      const r = U.runArag(args, { cwd, input: jsonl, timeoutMs: 60000 });
      if (r.ok) return { ok: true, count: payloads.length };
    }

    let count = 0;
    for (const p of payloads) {
      const args = [];
      if (project) args.push('--project', project);
      args.push(
        'add-text',
        '--id', p.id,
        '--source', p.source,
        '--metadata', JSON.stringify(p.metadata),
        '--tags', p.tags.join(','),
        '-'
      );
      const r = U.runArag(args, { cwd, input: p.text, timeoutMs: 60000 }); // 全再構築のため長め
      if (r.ok) count++;
    }
    return { ok: true, count };
  } finally {
    release();
  }
}

// flock（mkdir ロック）下で `arag [--project P] add <file>...` する。
// （旧 arag 用フォールバック経路。add-text 対応バイナリでは aragAddTexts が使われる）
function aragAddFiles(files, { cwd, project }) {
  if (!files.length) return { ok: true, count: 0 };
  // ロック対象は data-dir 単位。local は ./.arag、global は _global を共有ロック名で代表。
  const lockName = project ? `arag-global-${project}` : 'arag-local';
  const release = U.acquireLock(path.join(os.tmpdir(), lockName + '.lock'), { timeoutMs: 8000 });
  if (!release) return { ok: false, count: 0, reason: 'lock-timeout' };
  try {
    let count = 0;
    for (const f of files) {
      const args = [];
      if (project) args.push('--project', project); // グローバル指定はサブコマンド前
      args.push('add', f);
      const r = U.runArag(args, { cwd, timeoutMs: 60000 }); // 全再構築のため長め
      if (r.ok) count++;
    }
    return { ok: true, count };
  } finally {
    release();
  }
}

// ---- Claude ネイティブ・ファイルメモリの同期（#15 / arag#82 の plugin 側）--------
// Claude Code は ~/.claude/projects/<encoded>/memory/*.md に独自の記憶を書く（arag とは
// 別系統）。capture が細いと recall(global) が枯れるため、SessionEnd で opt-in 同期する。
// arag CLI `sync-claude-memory` はファイル直読みで scrub できないため、ここでは
// フック側で読み→秘密スクラブ→既存 add-text 経路で upsert する（秘密除外を担保）。

// 絶対パスを Claude の projects 配下ディレクトリ名へ符号化（: \ / → -）。arag CLI と同規則。
function claudeMemoryDir(proj) {
  const encoded = String(proj).replace(/[:\\/]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded, 'memory');
}

// .md の frontmatter（name/description/type）と本文を分解する軽量パーサ（arag CLI と同形式）。
function parseMemoryMd(content) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  let name = null, description = null, type = null, body = text.trim();
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (m) {
    body = m[2].trim();
    for (const line of m[1].split('\n')) {
      const t = line.trim();
      let mm;
      if (name == null && (mm = t.match(/^name:\s*(.+)$/))) name = mm[1].trim().replace(/^"|"$/g, '');
      else if (description == null && (mm = t.match(/^description:\s*(.+)$/))) description = mm[1].trim().replace(/^"|"$/g, '');
      else if (type == null && (mm = t.match(/^type:\s*(.+)$/))) type = mm[1].trim().replace(/^"|"$/g, '');
    }
  }
  return { name, description, type, body };
}

// メモリディレクトリから add-text payload 群を組み立てる（MEMORY.md 索引は除外・秘密スクラブ済み）。
// id=`claude-mem:<name>` で冪等。本文が空なら除外。テスト容易なよう dir を引数で受ける。
function buildMemoryPayloads(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const files = names
    .filter((n) => n.toLowerCase().endsWith('.md') && n.toLowerCase() !== 'memory.md')
    .sort();
  const payloads = [];
  for (const n of files) {
    let content;
    try { content = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { continue; }
    const p = parseMemoryMd(content);
    if (!p.body.trim()) continue;
    const nm = p.name || n.replace(/\.md$/i, '');
    const title = U.scrubSecrets(nm);
    const body = U.scrubSecrets(p.body);
    payloads.push({
      id: `claude-mem:${nm}`,
      text: `# ${title}\n\n${body}\n`,
      source: path.join(dir, n),
      metadata: {
        origin: 'claude-memory',
        name: nm,
        type: p.type || null,
        description: p.description ? U.scrubSecrets(p.description) : null,
      },
      tags: p.type ? [p.type] : [],
    });
  }
  return payloads;
}

// payload 群を flock 下で arag へ upsert する（batch 優先・per-item フォールバック）。
function upsertPayloads(payloads, { cwd, project }) {
  if (!payloads.length) return { ok: true, count: 0 };
  if (!aragCliCaps().addText) return { ok: false, count: 0, reason: 'old-arag' };
  const lockName = project ? `arag-global-${project}` : 'arag-local';
  const release = U.acquireLock(path.join(os.tmpdir(), lockName + '.lock'), { timeoutMs: 8000 });
  if (!release) return { ok: false, count: 0, reason: 'lock-timeout' };
  try {
    if (aragCliCaps().batch) {
      const jsonl = payloads.map((p) => JSON.stringify(p)).join('\n') + '\n';
      const args = [];
      if (project) args.push('--project', project);
      args.push('add-text', '--batch');
      const r = U.runArag(args, { cwd, input: jsonl, timeoutMs: 60000 });
      if (r.ok) return { ok: true, count: payloads.length };
    }
    let count = 0;
    for (const p of payloads) {
      const args = [];
      if (project) args.push('--project', project);
      args.push('add-text', '--id', p.id, '--source', p.source, '--metadata', JSON.stringify(p.metadata), '--tags', p.tags.join(','), '-');
      const r = U.runArag(args, { cwd, input: p.text, timeoutMs: 60000 });
      if (r.ok) count++;
    }
    return { ok: true, count };
  } finally {
    release();
  }
}

// Claude ファイルメモリ → arag(_global) を同期（#15・opt-in）。戻り値 {ok, count}。
function syncClaudeFileMemory(proj) {
  const payloads = buildMemoryPayloads(claudeMemoryDir(proj));
  return upsertPayloads(payloads, { cwd: proj, project: U.GLOBAL_PROJECT });
}

// ---- #23: transcript 救済スキャン（capture 取りこぼしの安全網・opt-in・local 限定）----
// pending が空のときだけ、会話 transcript を高精度シグナルでスキャンし、モデルが下書きし
// 損ねた決定/教訓/原因を弱い知識（confidence=uncertain・scope=project・salvaged）として救済。
// 質はモデル下書きに劣るため絶対に global 昇格させない（scope=project 固定）。

// 既定 OFF。`ARAG_CAPTURE_SALVAGE=1/true/on/yes` で有効化。
function salvageEnabled() {
  return /^(1|true|on|yes)$/i.test(String(process.env.ARAG_CAPTURE_SALVAGE || '').trim());
}

// 高精度シグナル: 「名詞句/目的語(5字以上) + 決定・教訓・原因の述語」を要求し、雑談の
// 動詞単体ヒットを排除する（検証パネルの修正版）。日本語 + 英語。
const SALVAGE_SIGNALS = [
  { re: /[^。\n]{5,}?(?:することにした|に決めた|を採用した|を廃止した|を禁止する|はNGとなった)/u, type: 'decision' },
  { re: /(?:根本原因は|失敗の原因は|原因は)[^。\n]{5,}/u, type: 'postmortem' },
  { re: /(?:教訓[：:]|学んだこと[：:]|反省[：:])[^。\n]{5,}/u, type: 'lesson' },
  { re: /方針[：:][^。\n]{5,}?(?:とする|にする|を守る)/u, type: 'decision' },
  { re: /(?:we|I)\s+(?:decided|will use|will avoid|must not|should not)\s+[A-Za-z][^.\n]{5,}/i, type: 'decision' },
  { re: /(?:root cause|lesson learned|key insight)[：:]\s*[^.\n]{10,}/i, type: 'lesson' },
  { re: /(?:pitfall|gotcha|known issue)[：:]\s*[^.\n]{10,}/i, type: 'lesson' },
];

// transcript JSONL 1 行から user/assistant の発話テキストを取り出す（純粋）。
// user: content が文字列なら採用（tool_result 配列は無視）。assistant: content 配列の
// text ブロックを連結（thinking/tool_use は除外）。それ以外の行は ''。
function lineToText(line) {
  let o;
  try { o = JSON.parse(line); } catch { return ''; }
  if (o.type !== 'user' && o.type !== 'assistant') return '';
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  }
  return '';
}

// REDACTED が本文を占有していないか（email 等の過剰 redaction で本文が壊れた救済を捨てる）。
function isMostlyRedacted(body) {
  const stripped = String(body || '').replace(/«REDACTED[^»]*»/g, '').trim();
  return stripped.length < 10;
}

// transcript 全文から救済候補を抽出する純粋関数（#23・テスト容易）。
// 末尾最大 400 行の user/assistant text をシグナル走査し、ヒット文を弱い知識へ整形。
// 同一正規化タイトルで dedup、max 件で打ち切り。秘密はスクラブ。
function extractSalvageCandidates(transcriptText, { max = 3, date = '' } = {}) {
  const lines = String(transcriptText || '').split(/\r?\n/).filter((l) => l.trim());
  const tail = lines.slice(-400);
  const out = [];
  const seenTitles = new Set();
  for (const line of tail) {
    const text = lineToText(line);
    if (!text) continue;
    for (const sig of SALVAGE_SIGNALS) {
      const m = text.match(sig.re);
      if (!m) continue;
      const sentence = m[0].replace(/\s+/g, ' ').trim().slice(0, 280);
      const body = U.scrubSecrets(sentence);
      if (isMostlyRedacted(body) || body.length < 10) continue;
      const title = body.slice(0, 60);
      const key = title.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      out.push({
        type: sig.type,
        title,
        body,
        scope: 'project', // 絶対に org にしない（global 昇格ゲートに乗せない）
        confidence: 'uncertain',
        status: 'provisional',
        epistemic: 'inferred',
        date,
        salvaged: true,
      });
      if (out.length >= max) return out;
    }
  }
  return out;
}

// transcript_path を読んで救済候補を返す（I/O 版）。読めなければ []（fail-open）。
function extractSalvageCandidatesFromFile(transcriptPath, { max = 3 } = {}) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return []; }
  const date = new Date().toISOString().slice(0, 10);
  return extractSalvageCandidates(raw, { max, date });
}

function main() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);
  if (!U.isParticipating(proj)) return;

  // #15: Claude ネイティブ・ファイルメモリの global 同期（opt-in）。capture 枯渇(arag#82)対策。
  // 既定 OFF: ネイティブ記憶を共有 global へ流すのは明示同意（環境変数）を要する。
  if (/^(1|true|on|yes)$/i.test(String(process.env.ARAG_SYNC_CLAUDE_MEMORY || '').trim())) {
    try {
      const r = syncClaudeFileMemory(proj);
      if (r.ok && r.count > 0) {
        process.stderr.write(U.color.cyan(`🔁 Claude メモリ同期: global へ ${r.count} 件 upsert\n`));
      }
    } catch { /* fail-open: 同期失敗は capture 本体を止めない */ }
  }

  const file = U.draftFile(proj);
  let items = parseDrafts(file);
  // #23: pending が空のときだけ transcript 救済（opt-in）。下書きがあれば一切起動しない。
  let salvaged = false;
  if (!items.length && salvageEnabled() && input.transcript_path) {
    try {
      const cand = extractSalvageCandidatesFromFile(input.transcript_path, { max: 3 });
      if (cand.length) {
        items = cand;
        salvaged = true;
      }
    } catch { /* fail-open: 救済失敗は capture 本体を止めない */ }
  }
  if (!items.length) return;

  const originProject = path.basename(proj);

  // 永続 raw（§7）へ書き出し → local には全件、global には scope=org && confidence=known のみ
  // を同じファイルから add（§1.6⑤ 自動昇格ゲート）。
  const captured = writeCapturedFiles(proj, items, originProject);
  const promoteCandidates = captured.filter(
    (c) => c.item.scope === 'org' && c.item.confidence === 'known'
  );
  // 昇格前の重複ガード（#5）: 既存 global と正規化タイトルが一致する項目は昇格しない。
  const dupSkipped = promoteCandidates.filter((c) => isDupInGlobal(c.item, { cwd: proj }));
  const promoteCaptured = promoteCandidates.filter((c) => !dupSkipped.includes(c));
  const promoteItems = promoteCaptured.map((c) => c.item);

  const locRes = aragAddTexts(captured, { cwd: proj, originProject });
  const globRes = aragAddTexts(promoteCaptured, {
    cwd: proj,
    project: U.GLOBAL_PROJECT,
    originProject,
  });

  // 記憶マップ（SessionStart 用）更新
  const recent = U.readJsonSafe(U.recentFile(proj), { items: [] });
  for (const it of items) {
    recent.items.push({ type: it.type, scope: it.scope || 'project', title: U.scrubSecrets(it.title || '') });
  }
  recent.items = recent.items.slice(-30);
  U.writeJsonSafe(U.recentFile(proj), recent);

  // 昇格通知（次回 SessionStart で色付き再掲）
  if (globRes.ok && globRes.count > 0) {
    U.writeJsonSafe(U.pendingNoticeFile(proj), {
      promoted: promoteItems.slice(0, globRes.count).map((it) => ({ title: U.scrubSecrets(it.title || ''), type: it.type })),
      at: input.session_id || '',
    });
  }

  // 色付きサマリ（即時表示はホスト依存のため best-effort・SessionStart 再掲が確実な経路）
  const { color } = U;
  const parts = [];
  if (salvaged) {
    parts.push(color.yellow(`🛟 救済モード: pending 空のため transcript から ${items.length} 件を弱い知識(uncertain/local)として救済（consolidate で要精査）`));
  }
  parts.push(color.cyan(`🗃  arag capture: local ${locRes.count}/${captured.length} 件保存`));
  if (promoteCaptured.length) {
    parts.push(color.green(`⬆️  global 昇格 ${globRes.count}/${promoteCaptured.length} 件 (scope=org・confidence=known)`));
    for (const it of promoteItems.slice(0, globRes.count)) parts.push(color.green(`     • ${it.title || ''}`));
  }
  if (dupSkipped.length) {
    parts.push(color.yellow(`↩️  global 重複スキップ ${dupSkipped.length} 件 (既存と同一タイトル)`));
    for (const c of dupSkipped) parts.push(color.yellow(`     • ${U.scrubSecrets(c.item.title || '')}`));
  }
  process.stderr.write(parts.join('\n') + '\n');

  // 下書きクリア
  try { fs.rmSync(file, { force: true }); } catch { /* noop */ }
}

// 純粋関数はテスト用に公開（フック実行は直接起動時のみ）。
module.exports = {
  claudeMemoryDir,
  parseMemoryMd,
  buildMemoryPayloads,
  extractSalvageCandidates,
  salvageEnabled,
  isMostlyRedacted,
};

if (require.main === module) {
  try { main(); } catch (e) { try { process.stderr.write('arag session-end error: ' + e + '\n'); } catch {} }
}
