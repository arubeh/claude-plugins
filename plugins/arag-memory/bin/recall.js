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

  // #P2: warm デーモン在なら hybrid（意味検索・言い換えに強い）、不在なら bm25（§1.7 死守）。
  const mode = U.recallMode();
  // local 優先 → global 補完（§1.6⑤ 両引き）。各々 fail-open。timeout は cold hybrid 退避に余裕を持たせる。
  const loc = U.searchRecall(query, { cwd: proj, topK: TOP_K, timeoutMs: 2500, mode });
  const glob = U.searchRecall(query, { cwd: proj, project: U.GLOBAL_PROJECT, topK: TOP_K, timeoutMs: 2500, mode });

  let locHits = (loc.ok && loc.hits) ? loc.hits : [];
  let globHits = (glob.ok && glob.hits) ? glob.hits : [];

  // #14: 関連度フロア（arag#81）。score 未満は注入前に落とす（既定 OFF=全件素通し）。
  const floor = U.recallFloor();
  locHits = U.applyFloor(locHits, floor);
  globHits = U.applyFloor(globHits, floor);

  // 相対フロア（補・既定OFF）。top スコア比未満を落とす（同言語の弱い裾を絞る env ノブ）。
  const ratio = U.recallMinRatio();
  locHits = U.applyRelativeFloor(locHits, ratio);
  globHits = U.applyRelativeFloor(globHits, ratio);

  // 語彙ゲート（主・既定ON）。クエリと本文の有意語の重なりがゼロのヒットを落とす。
  // 英語クエリ↔日本語コーパス等の無関係注入（主症状）を直接排除。ARAG_RECALL_GATE=0 で opt-out。
  if (U.recallGateEnabled()) {
    locHits = U.applyRelevanceGate(locHits, query);
    globHits = U.applyRelevanceGate(globHits, query);
  }

  // #P1: scope 横断 dedup（同一文書が local/global 両方にあれば local を優先して 1 度だけ）。
  globHits = U.dedupCrossScope(locHits, globHits, hitKey);

  // #14/#22: セッション状態（既出キー + ナッジ履歴）を一度だけ読む。session_id が無いと
  // 跨セッション過剰抑制になるため dedup も rate-limit もスキップする（fail-open）。
  const sid = (input && input.session_id) ? String(input.session_id) : '';
  const dedup = sid && U.sessionDedupEnabled();
  let seen = [];
  let alreadyNudged = false;
  if (sid) {
    const state = U.readJsonSafe(U.recallSeenFile(proj), null);
    if (state && state.session === sid) {
      if (Array.isArray(state.keys)) seen = state.keys;
      alreadyNudged = !!state.nudged;
    }
  }
  if (dedup) {
    locHits = U.dedupAgainstSeen(locHits, seen, hitKey).kept;
    globHits = U.dedupAgainstSeen(globHits, seen, hitKey).kept;
  }

  // #P1: global 予約枠つきマージ。local が TOP_K を独占して global（別 PJ 由来の汎用知識）が
  // 枯れるのを防ぐ。reserved=0 で従来の local 優先充填へ opt-out。
  const merged = U.mergeReserved(locHits, globHits, TOP_K, U.globalReserved());
  locHits = merged.loc;
  globHits = merged.glob;

  const injected = locHits.length + globHits.length;
  // #22: 安価シードが 0 件なら深い MCP recall を促す（セッション 1 回・opt-out・要 session_id）。
  const doNudge = !!sid && U.shouldDeepNudge({ injected, enabled: U.deepNudgeEnabled(), alreadyNudged });

  // セッション状態を書き戻す（実際に注入した最終列のキーを積み増し + ナッジ履歴）。
  if (sid) {
    const injectedKeys = [...locHits, ...globHits].map(hitKey).filter(Boolean);
    const keys = (dedup ? seen.concat(injectedKeys) : seen).slice(-200);
    U.writeJsonSafe(U.recallSeenFile(proj), { session: sid, keys, nudged: alreadyNudged || doNudge });
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
  // #22: 深い recall ナッジ（自動検索 0 件のときだけ・セッション 1 回）。任意判断だった
  // 深い意味検索を「決定論層が促す」形にし、出典つき回答の入口へ誘導する。
  if (doNudge) {
    out.push(
      '💡 過去記憶の自動検索は0件でした。関連しそうなら深掘りを: ' +
      'mcp__arag__search / mcp__arag__ask（このPJ）と mcp__arag_global__search（全社共通）。出典付きで回答してください。'
    );
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
