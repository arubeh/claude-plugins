'use strict';
// SessionStart: cgc 運用ルール（圧縮版）の注入 + graph 鮮度チェック。
// 仕様は plugins/cgc-guard/README.md「コンポーネント仕様 5」。
// stale / 破損を検知したら detached 再 index を起動し、その旨を additionalContext で伝える
// （#7 教訓のバックストップ: 前セッションで index が死んでいてもここで必ず回収する）。

const fs = require('fs');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const U = require('./lib/util');

// claudecode/rules/mcp-tools.md の cgc 節の圧縮移植。常時注入されるため最小限に保つ。
const RULES = `## cgc-guard: コード編集の必須手順

この PJ は cgc (Code Graph Context) が有効。コード（.rs/.ts/.py 等）の編集・削除の前に必ず:

1. \`mcp__cgc__context(<symbol>)\` → \`mcp__cgc__impact(<symbol>)\` で影響範囲（呼び出し元・関連テスト・リスク）を確認する
2. 編集ツール呼び出し直前のメッセージに「[cgc-check] symbol=<name> risk=<LOW|MEDIUM|HIGH|CRITICAL> callers=<N>」を 1 行出力する
3. リネームは grep+sed ではなく \`mcp__cgc__rename\` を使う

impact 未確認の編集は PreToolUse フックが deny する。waiver（typo・コメント・フォーマット・module/use 等の宣言追加・既存シンボルを変えない純粋追加・cgc 未インデックスのファイル）は
「[cgc-skip reason=<理由>]」を 1 行出力してから編集する。docs/設定ファイル（.md/.json/.yml 等）はゲート対象外。

注意: cgc は call graph に強いが type reference（型参照）に弱い。型シンボルで callers が不自然に少ない/0 件のときは
\`rg "<Symbol>"\` で参照を確認してから risk を評価する（rg を使っても [cgc-check] は省略しない）。
graph が stale（context の返す path が現存しない等）なら \`cgc index .\` → \`mcp__cgc__reload_graph\`（/cgc-refresh スキルで定型化済み）。`;

function main() {
  const input = U.readHookInput();
  const proj = U.projectDir(input);
  if (!U.isParticipating(proj) || !U.cgcAvailable()) return; // 未参加 PJ では無言

  const status = checkFreshness(proj);
  let note = '';
  if (status !== 'fresh') {
    triggerReindex(proj);
    note =
      status === 'corrupt'
        ? '\n\n⚠ graph.json の破損を検知したため再インデックスを開始しました。impact 利用前に mcp__cgc__reload_graph を実行してください。'
        : '\n\n⚠ graph が最新コミットより古いため再インデックスを開始しました。impact 利用前に mcp__cgc__reload_graph を実行してください。';
  }
  U.emitContext('SessionStart', RULES + note);
}

// graph の鮮度: 'fresh' | 'stale' | 'corrupt'
function checkFreshness(proj) {
  // 破損検知。cgc #210 以降の graph.json は gzip（magic 0x1f 0x8b）、
  // それ以前はプレーン JSON — 両形式を受け付ける。
  try {
    const f = U.graphFile(proj);
    const st = fs.statSync(f);
    if (st.size < 2) return 'corrupt';
    const fd = fs.openSync(f, 'r');
    const head = Buffer.alloc(2);
    const tailLen = Math.min(64, st.size);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, head, 0, 2, 0);
    fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
    fs.closeSync(fd);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      // gzip スナップショット: 途中 kill の truncate は解凍で必ず例外に
      // なる（~1MB 規模なら数 ms）。解凍結果が JSON 形であることも確認。
      const body = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
      if (!body.startsWith('{') || !body.trimEnd().endsWith('}')) return 'corrupt';
    } else if (head.toString('utf8', 0, 1) !== '{' || !tail.toString('utf8').trimEnd().endsWith('}')) {
      // プレーン JSON（pre-#210 バイナリ）: 先頭/末尾バイトの安価な判定。
      return 'corrupt';
    }
  } catch {
    return 'corrupt';
  }
  // stale 検知: graph.meta.json の last_indexed_commit と HEAD の比較
  try {
    const meta = U.readJsonSafe(U.metaFile(proj), null);
    const last = meta && meta.last_indexed_commit;
    if (!last) return 'fresh'; // メタ無し（旧 cgc）→ 判定不能は fresh 扱い（fail-open）
    const r = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: proj, timeout: 3000, encoding: 'utf8', windowsHide: true,
    });
    if (r.error || r.status !== 0) return 'fresh'; // git 不在/非リポは判定不能
    if (r.stdout.trim() && r.stdout.trim() !== String(last).trim()) return 'stale';
  } catch { /* fail-open */ }
  return 'fresh';
}

function triggerReindex(proj) {
  try {
    const runner = path.join(__dirname, 'post-edit-index.js');
    const child = spawn(process.execPath, [runner, '--run', proj], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
  } catch { /* fail-open */ }
}

main();
