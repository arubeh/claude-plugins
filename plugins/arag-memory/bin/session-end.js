'use strict';
// SessionEnd フック（capture の出口・§1.5 / §1.6⑤ / §0）。会話末に1回・背景実行。
//   1. 下書き pending.jsonl を読む（モデルが capture-draft.js で会話中に追記したもの）
//   2. 秘密スクラブ（多層防御）
//   3. local `./.arag/` へ flock 単一ライターで `arag add`
//   4. scope=org かつ confidence=known の項目を global(_global) へ flock で自動昇格（origin_project 付与）
//   5. 記憶マップ更新＋昇格通知を残す＋色付きサマリを出力
//   6. 下書きをクリア
// 毎ターンは書かない（重い全再構築は critical path 外）。

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

// 永続 raw ストア（§7 raw アーカイブ）`./.arag/_captured/` へ capture doc を書き出す。
// 一時ファイルにしないことで arag の source が安定パスになり、再インデックス/監査もできる。
function writeCapturedFiles(proj, items, originProject, sessionId) {
  const dir = path.join(U.localDataDir(proj), '_captured');
  fs.mkdirSync(dir, { recursive: true });
  const sid = String(sessionId || 's').slice(0, 8);
  return items.map((it, i) => {
    const name = `${it.date || 'undated'}_${sid}_${i}_${slugify(it.title)}.md`;
    const file = path.join(dir, name);
    fs.writeFileSync(file, toDoc(it, originProject));
    return { file, item: it };
  });
}

// arag が `add-text` (arag#66・v0.7.0 より後) に対応しているか 1 回だけ probe する。
// help 出力（stderr）に "add-text" が含まれるかで判定（バージョン文字列に依存しない）。
let addTextSupport = null;
function supportsAddText() {
  if (addTextSupport === null) {
    const r = U.runArag(['help'], { timeoutMs: 5000 });
    addTextSupport = /add-text/.test((r.stdout || '') + (r.stderr || ''));
  }
  return addTextSupport;
}

// 1 項目を `arag add-text` 用ペイロードに分解する（arag#66）。
// frontmatter を本文に入れず metadata(JSON) で渡すことでノイズチャンク化を防ぎ、
// id（_captured ファイル名 base・安定）で再取込時に upsert、source に本来の出典
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
  const title = U.scrubSecrets(it.title || '(untitled)');
  const body = U.scrubSecrets(it.body || '');
  return {
    id: path.basename(c.file, '.md'),
    text: `# ${title}\n\n${body}\n`,
    metadata,
    source: it.source || path.join('_captured', path.basename(c.file)),
    tags: [metadata.type, metadata.scope],
  };
}

// flock 下で `arag [--project P] add-text --id .. --source .. --metadata .. -` する
// （本文は stdin・コマンドライン長制限回避）。旧 arag（add-text 非対応）は従来の
// `arag add` 経路へ自動フォールバック（fail-open 原則）。
function aragAddTexts(captured, { cwd, project, originProject }) {
  if (!captured.length) return { ok: true, count: 0 };
  if (!supportsAddText()) {
    return aragAddFiles(captured.map((c) => c.file), { cwd, project });
  }
  const lockName = project ? `arag-global-${project}` : 'arag-local';
  const release = U.acquireLock(path.join(os.tmpdir(), lockName + '.lock'), { timeoutMs: 8000 });
  if (!release) return { ok: false, count: 0, reason: 'lock-timeout' };
  try {
    let count = 0;
    for (const c of captured) {
      const p = toAddTextPayload(c, originProject);
      const args = [];
      if (project) args.push('--project', project); // グローバル指定はサブコマンド前
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

function main() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);
  if (!U.isParticipating(proj)) return;

  const file = U.draftFile(proj);
  const items = parseDrafts(file);
  if (!items.length) return;

  const originProject = path.basename(proj);

  // 永続 raw（§7）へ書き出し → local には全件、global には scope=org && confidence=known のみ
  // を同じファイルから add（§1.6⑤ 自動昇格ゲート）。
  const captured = writeCapturedFiles(proj, items, originProject, input.session_id);
  const promoteCaptured = captured.filter(
    (c) => c.item.scope === 'org' && c.item.confidence === 'known'
  );
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
  parts.push(color.cyan(`🗃  arag capture: local ${locRes.count}/${captured.length} 件保存`));
  if (promoteCaptured.length) {
    parts.push(color.green(`⬆️  global 昇格 ${globRes.count}/${promoteCaptured.length} 件 (scope=org・confidence=known)`));
    for (const it of promoteItems.slice(0, globRes.count)) parts.push(color.green(`     • ${it.title || ''}`));
  }
  process.stderr.write(parts.join('\n') + '\n');

  // 下書きクリア
  try { fs.rmSync(file, { force: true }); } catch { /* noop */ }
}

try { main(); } catch (e) { try { process.stderr.write('arag session-end error: ' + e + '\n'); } catch {} }
