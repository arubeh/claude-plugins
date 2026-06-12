'use strict';
// 編集前ゲート（PreToolUse: Edit|Write|NotebookEdit|Bash）。
// impact 証跡なしのコード編集を deny し、是正手順を理由文で返す → Claude が自動是正。
// 仕様は plugins/cgc-guard/README.md「コンポーネント仕様 2」。
//
// allow（無言 exit 0）の条件 — どれか 1 つで素通り（fail-open 優先）:
//   未参加 PJ / cgc 不在 / mode=off / 非コードファイル / テストファイル (#189) /
//   新規ファイル Write / 承認済みファイル (#189) /
//   直近 assistant メッセージに [cgc-skip] or [cgc-check] / 証跡あり /
//   transcript に最近の cgc tool_use あり (#185) / deny 上限到達（降格）
//
// deny 時は理由コード [reason=...] を必ず含める (#185-3):
//   MARKER_AND_EVIDENCE_MISSING — 証跡もマーカーも見つからない
//   EVIDENCE_TTL_EXPIRED       — 証跡はあるが TTL 切れ
//   EVIDENCE_FILE_MISMATCH     — 新しい証跡はあるが対象ファイルに紐づかない

const fs = require('fs');
const path = require('path');
const U = require('./lib/util');

function main() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);

  if (!U.isParticipating(proj) || !U.cgcAvailable()) return; // fail-open

  const cfg = U.loadGuardConfig(proj);
  if (cfg.mode === 'off') return;

  const target = resolveTarget(input);
  if (!target) return;
  if (!U.isCodeFile(target)) return; // docs/設定 waiver
  if (cfg.excludeTests && U.isTestPath(target)) return; // テスト編集は対象外 (#189-1)
  if (input.tool_name === 'Write' && !exists(target)) return; // 新規ファイルは既存シンボルへの影響なし

  const ttlFileMs = cfg.fileTtlMinutes * 60 * 1000;
  const ttlSessionMs = cfg.sessionTtlMinutes * 60 * 1000;
  const approvalTtlMs = cfg.approvalTtlMinutes * 60 * 1000;
  const base = path.basename(String(target)).toLowerCase();

  // 一度確認を通したファイルは TTL 内は再確認不要 (#189-4)。
  if (U.isApproved(proj, input.session_id, base, approvalTtlMs)) return;

  // 直近 assistant メッセージのマーカー（waiver / 自己申告の impact 実施証跡）。
  // ハーネスによっては text が transcript に残らないため best-effort (#185)。
  const lastText = U.lastAssistantText(input.transcript_path);
  if (/\[cgc-skip\b/.test(lastText)) return;
  if (/\[cgc-check\]/.test(lastText)) {
    U.recordApproval(proj, input.session_id, base, approvalTtlMs);
    return;
  }

  // record-evidence.js が記録した mcp__cgc__* 実行証跡。
  // evidenceScope='dir' (v0.3.0) では同一ディレクトリの別ファイルへの証跡も
  // 編集を許可する — 機械的な複数ファイル一括編集（全パーサーへ 1 行追加等）で
  // ファイルごとに context+impact を強要する儀式コストをなくす。
  const now = Date.now();
  const ev = U.readJsonSafe(U.evidenceFile(proj, input.session_id), { entries: [] });
  const entries = Array.isArray(ev.entries) ? ev.entries : [];
  const targetDir = normDir(path.dirname(String(target)));
  const matchesTarget = (p) =>
    p.toLowerCase().endsWith(base) ||
    (cfg.evidenceScope === 'dir' && normDir(path.dirname(p)) === targetDir);
  const fileHit = entries.some(
    (e) => now - e.ts < ttlFileMs && Array.isArray(e.paths) && e.paths.some(matchesTarget)
  );
  const sessionHit = entries.some((e) => now - e.ts < ttlSessionMs);
  if (fileHit || sessionHit) {
    U.recordApproval(proj, input.session_id, base, approvalTtlMs);
    return;
  }

  // フォールバック (#185): hooks.json の matcher 不一致や text 非永続化で
  // 上の 2 経路が共倒れする環境向けに、transcript の tool_use エントリから
  // context/impact 実行（TTL 内）を直接検出する。tool_use エントリは
  // assistant text と違い確実に永続化される（実測済み）。
  if (U.recentCgcToolUse(input.transcript_path, ttlFileMs)) {
    U.recordApproval(proj, input.session_id, base, approvalTtlMs);
    return;
  }

  // 無限ループ防止: 同一ファイルへの deny は連続 denyMax 回まで。超えたら降格 allow。
  const stateFile = U.denyStateFile(proj, input.session_id);
  const state = U.readJsonSafe(stateFile, {});
  const rec = state[base] && now - state[base].ts < ttlFileMs ? state[base] : { count: 0 };
  rec.count += 1;
  rec.ts = now;
  state[base] = rec;
  U.writeJsonSafe(stateFile, state);
  if (rec.count > cfg.denyMax) return; // フェイルセーフ降格

  // 理由コード (#185-3): 何が足りなかったかを明示し、無駄な再試行をなくす。
  const hasFreshEvidence = entries.some((e) => now - e.ts < ttlFileMs);
  const reason = entries.length === 0
    ? 'MARKER_AND_EVIDENCE_MISSING'
    : hasFreshEvidence
      ? 'EVIDENCE_FILE_MISMATCH'
      : 'EVIDENCE_TTL_EXPIRED';

  const message =
    `[cgc-guard] ${target} はインデックス済みコードの可能性があります。編集前に影響範囲を確認してください。` +
    `\n[reason=${reason} deny=${rec.count}/${cfg.denyMax}]` +
    `\n(1) mcp__cgc__context(<対象シンボル>) → mcp__cgc__impact(<対象シンボル>) を実行し、` +
    `次のメッセージに「[cgc-check] symbol=<name> risk=<LOW|MEDIUM|HIGH|CRITICAL> callers=<N>」を1行出力してから編集を再実行する。` +
    `\n(2) typo・コメント・フォーマット等の軽微変更、または cgc 未インデックスのファイルであれば、` +
    `次のメッセージに「[cgc-skip reason=<理由>]」を1行出力してから再実行する。` +
    `\n(型シンボルで impact が空振りする場合は rg で参照を確認してから [cgc-check] を出すこと)`;

  // risk 段階化 (v0.3.0): セッション内の impact でこのファイル/ディレクトリの
  // risk が denyRiskFloor 未満（既定: LOW/MEDIUM）と判明している場合、証跡 TTL が
  // 切れていても deny せず warn に降格する。リスクはコードの性質であって
  // TTL より長持ちする。HIGH/CRITICAL・未知（未計測）は従来どおり deny。
  if (knownRiskBelowFloor(entries, cfg, matchesTarget)) {
    U.emitWarn(
      message.replace(
        '編集前に影響範囲を確認してください。',
        `影響範囲は既知の低リスク (denyRiskFloor=${cfg.denyRiskFloor}) のため編集は許可。`
      ) + '\n[reason=RISK_DEMOTED]'
    );
    return;
  }

  // 小規模リポは deny を warn に降格 (#189-3): 儀式コスト > 便益になりやすい。
  if (effectiveMode(cfg, proj) === 'warn') {
    U.emitWarn(
      message.replace(
        '編集前に影響範囲を確認してください。',
        '影響範囲が未確認です (warn モードのため編集は許可)。'
      )
    );
    return;
  }

  U.emitDeny(message);
}

// 区切り・大文字小文字を正規化したディレクトリ比較キー。
function normDir(p) {
  return String(p).replace(/\//g, '\\').toLowerCase();
}

const RISK_ORDER = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

// このファイル（dir スコープ時は同ディレクトリ）に対するセッション内の
// impact 計測値が、すべて denyRiskFloor 未満なら true。
// 1 件でも floor 以上が観測されていれば false（deny 維持）。未計測も false。
function knownRiskBelowFloor(entries, cfg, matchesTarget) {
  const floor = RISK_ORDER[cfg.denyRiskFloor];
  if (floor === undefined || floor <= 0) return false; // 'LOW' = 常時 deny（従来動作）
  const risks = entries
    .filter((e) => e.risk && Array.isArray(e.paths) && e.paths.some(matchesTarget))
    .map((e) => RISK_ORDER[e.risk])
    .filter((r) => r !== undefined);
  return risks.length > 0 && risks.every((r) => r < floor);
}

// mode 解決: 明示設定が最優先。deny のままでも graph.json が小さい
// リポでは warn に自動降格する（smallRepoWarnBytes=0 で無効化可能）。
function effectiveMode(cfg, proj) {
  if (cfg.mode === 'warn') return 'warn';
  if (cfg.smallRepoWarnBytes > 0) {
    try {
      const st = fs.statSync(U.graphFile(proj));
      if (st.size < cfg.smallRepoWarnBytes) return 'warn';
    } catch { /* graph 不在は isParticipating で弾かれている */ }
  }
  return 'deny';
}

// ゲート対象のファイルパスを解決する。Bash は rm / git rm のみ対象（README v1 スコープ）。
function resolveTarget(input) {
  const ti = input.tool_input || {};
  if (input.tool_name === 'Bash') {
    const cmd = String(ti.command || '');
    if (!/(^|[;&|]\s*)(git\s+rm|rm|del|Remove-Item)\b/.test(cmd)) return null;
    const paths = U.extractCodePaths(cmd);
    return paths.length ? paths[0] : null;
  }
  return ti.file_path || ti.notebook_path || null;
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

main();
