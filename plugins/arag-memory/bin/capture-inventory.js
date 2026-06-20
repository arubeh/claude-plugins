'use strict';
// Stop フック（capture の強制トリガ・§1.5 の「モデル依存」を決定論層へ寄せる）。
//
// 背景: capture の下書き（capture-draft.js）は会話中にモデルが自発的に叩く設計で、
// forcing function が SessionStart のリマインダー 1 行とモデルの自発性しか無かった。
// 実運用ではモデルが下書きを忘れ続け、参加 PJ でも local が空のまま（capture 率 ≒ 0）。
//
// 対策（オプション A）: セッション終了前に「未下書きの知識が無いか」を必ず 1 回モデルに
// 問う強制ステップを足す。ただし SessionEnd / PreCompact はモデルがもう動けない（前者は
// 会話完了後・後者は要約されて消える）ため、**モデルにもう 1 ターン取らせられる唯一の
// フックは Stop** だけ。Stop で `{"decision":"block","reason":...}` を返すと会話が続行され、
// モデルが棚卸し→capture-draft を実行できる。
//
// 暴走・ナッジ疲れ対策（ゲート）:
//   - 未参加 PJ は no-op
//   - stop_hook_active（既にこのフックで継続中）なら通す＝ループ防止
//   - セッション 1 回だけ（_capture-inventory.json にフラグ）
//   - 下書きが既にあれば通す（モデルは capture できている＝過干渉しない）
//   - 実質中身の薄いセッション（user 発話 < しきい値）は通す（瑣末な Q&A をナッジしない）
//   - 既定 ON・`ARAG_CAPTURE_INVENTORY=0/false/off/no` で opt-out
// すべて fail-open（例外時は stop を許可＝会話を止めない）。

const fs = require('fs');
const path = require('path');
const U = require('./lib/util');

// セッション単位の「棚卸し済み」フラグ（recall の _recall-seen.json とは別ファイル。
// recall.js が _recall-seen.json を毎ターン上書きするため相乗りすると消えるので分離する）。
function inventoryFlagFile(proj) {
  return path.join(U.localDataDir(proj), '_capture-inventory.json');
}

// 既定 ON。`ARAG_CAPTURE_INVENTORY=0/false/off/no` で無効（従来＝forcing なし挙動へ）。
function inventoryEnabled() {
  const v = (process.env.ARAG_CAPTURE_INVENTORY || '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

// 棚卸しを発火させる user 発話数の下限（既定 4）。これ未満の薄いセッションは触らない。
function minTurns() {
  const n = parseInt(process.env.ARAG_CAPTURE_INVENTORY_MIN_TURNS || '4', 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

// transcript JSONL 1 行が「実ユーザー発話」か（純粋）。type==='user' かつ content が
// 非空文字列のものだけ数える。配列 content（tool_result 等）や非 user 行は除外する。
function isRealUserLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return false; }
  if (o.type !== 'user') return false;
  const c = o.message && o.message.content;
  return typeof c === 'string' && c.trim().length > 0;
}

// transcript 全文から実ユーザー発話数を数える純粋関数（テスト容易）。
function countUserTurns(transcriptText) {
  let n = 0;
  for (const line of String(transcriptText || '').split(/\r?\n/)) {
    if (line.trim() && isRealUserLine(line)) n++;
  }
  return n;
}

// 下書き pending.jsonl に有効な行が 1 つ以上あるか。
function draftsExist(proj) {
  try {
    const raw = fs.readFileSync(U.draftFile(proj), 'utf8');
    return raw.split(/\r?\n/).some((l) => l.trim());
  } catch {
    return false;
  }
}

// 発火判定の純粋関数（テスト容易）。'run' なら棚卸しを強制、それ以外は skip 理由を返す。
function decideInventory(s) {
  if (!s.participating) return 'skip:not-participating';
  if (!s.enabled) return 'skip:disabled';
  if (s.stopHookActive) return 'skip:stop-hook-active';
  if (s.alreadyInventoried) return 'skip:already-done';
  if (s.draftsExist) return 'skip:drafts-exist';
  if (s.userTurns < s.minTurns) return 'skip:thin';
  return 'run';
}

// モデルへ返す棚卸し指示（Stop の block reason）。「何も無ければ作らず止めてよい」を明示し、
// フックを満たすためのゴミ capture を防ぐ（arag-capture の固有名詞テスト・秘密除外も再掲）。
const INVENTORY_REASON = [
  '🧠 arag-memory 記憶の棚卸し（セッション終了前の強制チェック・このセッションで1回のみ）。',
  '',
  'この会話で「決定 / 教訓 / ドメイン知識 / 原因究明 / 方針」に当たり、将来のセッションで思い出す価値がある知識は出ましたか？',
  '',
  '- 出た → それぞれ /arag-capture の基準に従って下書きしてください。コマンドは:',
  '    echo \'{"type":"decision|lesson|domain|postmortem|feedback","title":"...","body":"...","scope":"project|org","confidence":"known|inferred|uncertain"}\' | node "${CLAUDE_PLUGIN_ROOT}/bin/capture-draft.js"',
  '  （秘密・このセッション限りの瑣末・既知の自明事は書かない。scope=org=全PJ共通へ昇格は固有名詞テストに合格させ汎用表現へ書き直してから。下書きは SessionEnd で arag にまとめて書き込まれます）',
  '- 何も無い → 何も下書きせず「記録不要」とだけ述べて停止して構いません（フックを満たすために無理に作らないこと）。',
].join('\n');

function main() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);
  const sid = (input && input.session_id) ? String(input.session_id) : '';

  // 参加判定。未参加なら何も出さず stop 許可。
  if (!U.isParticipating(proj)) return;

  // 既出判定（このセッションで棚卸し済みか）。
  let alreadyInventoried = false;
  if (sid) {
    const flag = U.readJsonSafe(inventoryFlagFile(proj), null);
    alreadyInventoried = !!(flag && flag.session === sid);
  }

  // user 発話数（transcript から）。読めなければ 0（薄いとみなし発火しない＝安全側）。
  let userTurns = 0;
  if (input && input.transcript_path) {
    try { userTurns = countUserTurns(fs.readFileSync(input.transcript_path, 'utf8')); } catch { userTurns = 0; }
  }

  const decision = decideInventory({
    participating: true,
    enabled: inventoryEnabled(),
    stopHookActive: !!(input && input.stop_hook_active),
    alreadyInventoried,
    draftsExist: draftsExist(proj),
    userTurns,
    minTurns: minTurns(),
  });

  if (decision !== 'run') return; // stop 許可（何も出力しない）

  // フラグを立ててから block（再発火を防ぐ＝セッション1回）。
  if (sid) U.writeJsonSafe(inventoryFlagFile(proj), { session: sid });
  process.stdout.write(JSON.stringify({ decision: 'block', reason: INVENTORY_REASON }));
}

// 純粋関数はテスト用に公開（フック実行は直接起動時のみ）。
module.exports = {
  inventoryFlagFile,
  inventoryEnabled,
  minTurns,
  isRealUserLine,
  countUserTurns,
  draftsExist,
  decideInventory,
  INVENTORY_REASON,
};

if (require.main === module) {
  try { main(); } catch (e) {
    // fail-open: 何が起きても stop を止めない。
    try { process.stderr.write('arag capture-inventory error: ' + e + '\n'); } catch {}
  }
}
