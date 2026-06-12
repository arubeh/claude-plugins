'use strict';
// recall フック（決定論層・§1.7 低レイテンシ / §1.8 二層の「フック=安価 bm25 シード」）。
//   sessionstart : arag を叩かず、_recent.json（記憶マップ）＋未表示の昇格通知だけ注入（数ms）。
//   userprompt   : プロンプト本文で bm25 を local→global の順に両引き（§1.6⑤）。各 ~100ms・fail-open。
// 深掘りの意味検索はモデルが MCP（warm）で行う。cold `ask`/`hybrid` は critical path で使わない。

const U = require('./lib/util');

const MODE = process.argv[2] || 'userprompt';
const TOP_K = parseInt(process.env.ARAG_TOP_K || '5', 10); // §1.6⑧ 2–5件
const EVENT = MODE === 'sessionstart' ? 'SessionStart' : 'UserPromptSubmit';

function fmtHit(h, origin) {
  const path = require('path');
  // 見出し(=タイトル, arag の section)優先。source はパスなので basename だけ。
  const title = h.section || '';
  const base = h.source ? path.basename(String(h.source)) : '';
  const label = title || base || h.origin_project || '';
  const prev = (h.preview || h.text || '').toString().replace(/\s+/g, ' ').slice(0, 200);
  const tag = origin === 'global' ? '[global]' : '[local]';
  return `- ${tag} ${label ? label + ' — ' : ''}${prev}`;
}

function sessionStart(proj) {
  const lines = [];

  // 1) 前回 SessionEnd が残した「昇格しました」通知を必ず可視化（色付き通知の引き継ぎ）。
  const notice = U.readJsonSafe(U.pendingNoticeFile(proj), null);
  if (notice && Array.isArray(notice.promoted) && notice.promoted.length) {
    lines.push('🟢 前回セッションで以下を global へ自動昇格しました（誤りは /feedback で撤回可）:');
    for (const p of notice.promoted) lines.push(`  - ${p.title || p}`);
    // 表示したら消す
    try { require('fs').rmSync(U.pendingNoticeFile(proj), { force: true }); } catch { /* noop */ }
  }

  // 2) 安価な記憶マップ（直近 capture の見出し）。arag を起動しないので速い。
  const recent = U.readJsonSafe(U.recentFile(proj), null);
  if (recent && Array.isArray(recent.items) && recent.items.length) {
    lines.push('', '🧠 このプロジェクトの最近の記憶（詳細は MCP arag で深掘り可）:');
    for (const it of recent.items.slice(-5)) {
      lines.push(`  - [${it.type || '?'}/${it.scope || 'project'}] ${it.title}`);
    }
  }

  // 3) capture の標準リマインダー（drafting はモデル依存部・§1.5）。常に短く 1 ブロックだけ。
  lines.push(
    '',
    '📝 arag-memory: 会話中に「決定/教訓/ドメイン/原因究明/方針」に当たる知識が出たら capture-draft で下書きすること（ゴミ・秘密は書かない）。詳細は /arag-capture。'
  );

  return lines.join('\n');
}

// 既出抑制のキー: 文書の出典（source）。同一文書の別チャンクも同一キーで畳む。
// source 不明のヒットは抑制対象外（空キー → dedupAgainstSeen が常に残す）。
function hitKey(h) {
  return h && h.source ? String(h.source) : '';
}

function userPrompt(proj, input) {
  const query = (input && (input.prompt || input.user_prompt)) || '';
  if (!query.trim()) return '';
  const out = [];

  // local 優先 → global 補完（§1.6⑤ 両引き）。各々 fail-open。
  const loc = U.searchBm25(query, { cwd: proj, topK: TOP_K, timeoutMs: 1500 });
  const glob = U.searchBm25(query, { cwd: proj, project: U.GLOBAL_PROJECT, topK: TOP_K, timeoutMs: 1500 });

  let locHits = (loc.ok && loc.hits) ? loc.hits.slice(0, TOP_K) : [];
  let globHits = (glob.ok && glob.hits) ? glob.hits.slice(0, Math.max(0, TOP_K - locHits.length)) : [];

  // #14: 関連度フロア（arag#81）。score 未満は注入前に落とす（全件未満なら注入ブロック無し）。
  const floor = U.recallFloor();
  locHits = U.applyFloor(locHits, floor);
  globHits = U.applyFloor(globHits, floor);

  // #14: セッション内既出抑制。同一セッションで一度注入した文書は以後出さない（アラーム疲れ回避）。
  // session_id が無いと跨セッション過剰抑制になるため、その場合は抑制しない（fail-open）。
  const sid = (input && input.session_id) ? String(input.session_id) : '';
  if (sid && U.sessionDedupEnabled()) {
    const state = U.readJsonSafe(U.recallSeenFile(proj), null);
    const seen = (state && state.session === sid && Array.isArray(state.keys)) ? state.keys : [];
    const dl = U.dedupAgainstSeen(locHits, seen, hitKey);
    const dg = U.dedupAgainstSeen(globHits, seen.concat(dl.keys), hitKey);
    locHits = dl.kept;
    globHits = dg.kept;
    // 今回注入したキーを積み増し（肥大防止に直近 200 件へ丸める）。fail-open（書込失敗は無視）。
    const merged = seen.concat(dl.keys, dg.keys).slice(-200);
    U.writeJsonSafe(U.recallSeenFile(proj), { session: sid, keys: merged });
  }

  if (locHits.length || globHits.length) {
    out.push('📚 関連する過去の記憶（arag・出典つきで参照のこと）:');
    for (const h of locHits) out.push(fmtHit(h, 'local'));
    for (const h of globHits) out.push(fmtHit(h, 'global'));
  } else if ((loc.text && loc.text.length) || (glob.text && glob.text.length)) {
    // 旧 arag（-f json 非対応）フォールバック：テキストブロックをそのまま注入
    out.push('📚 関連する過去の記憶（arag）:');
    if (loc.text) out.push('[local]\n' + loc.text);
    if (glob.text) out.push('[global]\n' + glob.text);
  }
  return out.join('\n');
}

function main() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);

  // 未参加 PJ（.arag 無し or .arag-disabled）では何も注入しない。
  if (!U.isParticipating(proj)) { U.emitContext(EVENT, ''); return; }

  let ctx = '';
  try {
    ctx = MODE === 'sessionstart' ? sessionStart(proj) : userPrompt(proj, input);
  } catch {
    ctx = ''; // 例外でもターンを止めない（fail-open）
  }
  U.emitContext(EVENT, ctx);
}

main();
