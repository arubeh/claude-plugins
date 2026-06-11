'use strict';
// 編集前ゲート（PreToolUse: Edit|Write|NotebookEdit|Bash）。
// impact 証跡なしのコード編集を deny し、是正手順を理由文で返す → Claude が自動是正。
// 仕様は plugins/cgc-guard/README.md「コンポーネント仕様 2」。
//
// allow（無言 exit 0）の条件 — どれか 1 つで素通り（fail-open 優先）:
//   未参加 PJ / cgc 不在 / 非コードファイル / 新規ファイル Write /
//   直近 assistant メッセージに [cgc-skip] or [cgc-check] / 証跡あり / deny 3 回目（降格）

const fs = require('fs');
const path = require('path');
const U = require('./lib/util');

const TTL_FILE_MS = 10 * 60 * 1000;    // ファイルレベル証跡の有効期間
const TTL_SESSION_MS = 5 * 60 * 1000;  // セッションレベル証跡（緩和ノブ）
const DENY_MAX = 2;                    // 同一ファイル連続 deny 上限（3 回目は降格 allow）

function main() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);

  if (!U.isParticipating(proj) || !U.cgcAvailable()) return; // fail-open

  const target = resolveTarget(input);
  if (!target) return;
  if (!U.isCodeFile(target)) return; // docs/設定 waiver
  if (input.tool_name === 'Write' && !exists(target)) return; // 新規ファイルは既存シンボルへの影響なし

  // 直近 assistant メッセージのマーカー（waiver / 自己申告の impact 実施証跡）
  const lastText = U.lastAssistantText(input.transcript_path);
  if (/\[cgc-skip\b/.test(lastText)) return;
  if (/\[cgc-check\]/.test(lastText)) return;

  // record-evidence.js が記録した mcp__cgc__* 実行証跡
  const now = Date.now();
  const ev = U.readJsonSafe(U.evidenceFile(proj, input.session_id), { entries: [] });
  const entries = Array.isArray(ev.entries) ? ev.entries : [];
  const base = path.basename(String(target)).toLowerCase();
  const fileHit = entries.some(
    (e) => now - e.ts < TTL_FILE_MS && Array.isArray(e.paths) && e.paths.some((p) => p.endsWith(base))
  );
  const sessionHit = entries.some((e) => now - e.ts < TTL_SESSION_MS);
  if (fileHit || sessionHit) return;

  // 無限ループ防止: 同一ファイルへの deny は連続 DENY_MAX 回まで。超えたら降格 allow。
  const stateFile = U.denyStateFile(proj, input.session_id);
  const state = U.readJsonSafe(stateFile, {});
  const rec = state[base] && now - state[base].ts < TTL_FILE_MS ? state[base] : { count: 0 };
  rec.count += 1;
  rec.ts = now;
  state[base] = rec;
  U.writeJsonSafe(stateFile, state);
  if (rec.count > DENY_MAX) return; // フェイルセーフ降格

  U.emitDeny(
    `[cgc-guard] ${target} はインデックス済みコードの可能性があります。編集前に影響範囲を確認してください。` +
    `\n(1) mcp__cgc__context(<対象シンボル>) → mcp__cgc__impact(<対象シンボル>) を実行し、` +
    `次のメッセージに「[cgc-check] symbol=<name> risk=<LOW|MEDIUM|HIGH|CRITICAL> callers=<N>」を1行出力してから編集を再実行する。` +
    `\n(2) typo・コメント・フォーマット等の軽微変更、または cgc 未インデックスのファイルであれば、` +
    `次のメッセージに「[cgc-skip reason=<理由>]」を1行出力してから再実行する。` +
    `\n(型シンボルで impact が空振りする場合は rg で参照を確認してから [cgc-check] を出すこと)`
  );
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
