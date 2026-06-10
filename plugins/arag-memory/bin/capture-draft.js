'use strict';
// 会話中の下書き追記（capture の入口・モデル依存部／§1.5）。
// モデルが「残す価値あり」と判断した知識 1 項目を JSON で渡すと、秘密スクラブして
// pending.jsonl に追記する。実際の arag 書き込みは SessionEnd がまとめて行う（毎ターン書かない）。
//
// 使い方（モデルが Bash 経由で）:
//   echo '{"type":"decision","title":"...","body":"...","scope":"org","confidence":"known"}' \
//     | node "${CLAUDE_PLUGIN_ROOT}/bin/capture-draft.js"
//   または引数で:
//   node capture-draft.js '{"type":"lesson","title":"...","body":"..."}'
//
// フィールド: type(decision|lesson|domain|postmortem|feedback) / title / body /
//   scope(project|org) / confidence(known|inferred|uncertain) / epistemic / source / slug
// 既定: scope=project, confidence=inferred, status=provisional, date=今日（呼び出し側で埋める）

const fs = require('fs');
const path = require('path');
const U = require('./lib/util');

function readItem() {
  const arg = process.argv[2];
  if (arg) { try { return JSON.parse(arg); } catch { return null; } }
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function main() {
  const proj = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (!U.isParticipating(proj)) {
    process.stderr.write('arag-memory: この PJ は未参加（.arag 無し / .arag-disabled）。下書きしません。\n');
    process.exit(0);
  }
  const item = readItem();
  if (!item || !item.title) {
    process.stderr.write('arag capture-draft: title を含む JSON 項目が必要です。\n');
    process.exit(1);
  }

  // 秘密スクラブ（書く前に除外・多層防御の1層目）
  item.title = U.scrubSecrets(item.title);
  if (item.body) item.body = U.scrubSecrets(item.body);

  // 既定値
  item.scope = item.scope === 'org' ? 'org' : 'project';
  item.confidence = item.confidence || 'inferred';
  item.status = item.status || 'provisional';

  const file = U.draftFile(proj);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(item) + '\n');
  } catch (e) {
    process.stderr.write('arag capture-draft 失敗: ' + e + '\n');
    process.exit(1);
  }
  const promote = item.scope === 'org' && item.confidence === 'known';
  process.stdout.write(
    `下書き追記: [${item.type || 'lesson'}/${item.scope}] ${item.title}` +
    (promote ? ' （SessionEnd で global へ自動昇格対象）' : '') + '\n'
  );
}

main();
