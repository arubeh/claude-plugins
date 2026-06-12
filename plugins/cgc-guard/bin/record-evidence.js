'use strict';
// 証跡記録（PostToolUse: mcp__cgc__*）。
// 「impact/context を見た」事実とレスポンス中のファイルパスを .cgc/tmp/evidence-<sid>.json に
// 記録する。pre-edit-gate.js がこれを参照して allow/deny を判定する。
// 仕様は plugins/cgc-guard/README.md「コンポーネント仕様 3」。

const U = require('./lib/util');

const KEEP_MS = 30 * 60 * 1000; // 証跡保持期間
const MAX_ENTRIES = 50;
const MAX_PATHS = 80;

// 証跡として意味のあるツールのみ（read 系の網羅は不要。ゲートの TTL 判定に使うものだけ）。
// #185: プラグイン経由ではツール名が mcp__plugin_<plugin>_cgc__* に名前空間化される。
// 旧正規表現 (^mcp__cgc__) はこれに一切マッチせず、証跡が常に空 → ゲートが
// 規定手順を踏んでも deny する主因だった。両形式を許容する。
const RELEVANT =
  /^mcp__(?:plugin_[A-Za-z0-9_-]+_)?cgc__(context|impact|find_callers|find_callees|affected_tests|reload_graph)$/;

function main() {
  const input = U.readHookInput();
  if (!RELEVANT.test(String(input.tool_name || ''))) return;
  const proj = U.projectDir(input);
  if (!U.isParticipating(proj)) return;

  const ti = input.tool_input || {};
  const blob =
    JSON.stringify(input.tool_response || '') + ' ' + JSON.stringify(ti);
  const paths = U.extractCodePaths(blob).slice(0, MAX_PATHS);

  const file = U.evidenceFile(proj, input.session_id);
  const now = Date.now();
  const ev = U.readJsonSafe(file, { entries: [] });
  const entries = (Array.isArray(ev.entries) ? ev.entries : []).filter(
    (e) => now - e.ts < KEEP_MS
  );
  // impact レスポンスの "Risk: LOW|MEDIUM|HIGH|CRITICAL" を抽出 (v0.3.0)。
  // pre-edit-gate の risk 段階化（LOW/MEDIUM 既知ファイルは deny→warn）に使う。
  const riskMatch = /Risk:\s*(LOW|MEDIUM|HIGH|CRITICAL)/.exec(
    JSON.stringify(input.tool_response || '')
  );
  entries.push({
    ts: now,
    tool: input.tool_name,
    symbol: ti.symbol || ti.name || ti.function_name || '',
    risk: riskMatch ? riskMatch[1] : '',
    paths,
  });
  U.writeJsonSafe(file, { entries: entries.slice(-MAX_ENTRIES) });
}

main();
