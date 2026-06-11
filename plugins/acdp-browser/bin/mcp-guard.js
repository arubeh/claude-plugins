'use strict';
// MCP 起動ガードラッパー（cgc-guard / arag-memory の mcp-guard.js と同方式）。
// プラグインの .mcp.json はユーザー全体で登録されるため、acdp を使わない環境でも起動を
// 試みる。本ラッパーが利用可否を判定し:
//   - 利用可（acdp バイナリあり + .acdp-disabled 無し）
//     → acdp バイナリを中継（acdp は引数なしで MCP サーバとして起動する）。
//       ブラウザの起動は acdp 側が初回ツール呼び出しまで遅延する。
//   - 利用不可（acdp 不在 / .acdp-disabled）
//     → 空の MCP サーバとして接続（0 tools・"failed" 表示を出さない）。
// cgc と異なりプロジェクト参加の概念は無い（ブラウザ操作はどの PJ でも意味を持つ）ため、
// 判定はバイナリ存在とオプトアウトの 2 点のみ。依存ゼロ（Node 組み込みのみ）。

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const VERSION = '0.1.0';

// ---- acdp バイナリ解決（cgc-guard の resolveCgcBin / cgcAvailable と同方式）----

function resolveAcdpBin() {
  if (process.env.ACDP_BIN) return process.env.ACDP_BIN;
  const home = os.homedir();
  const cand = path.join(home, '.acode', 'bin', process.platform === 'win32' ? 'acdp.exe' : 'acdp');
  try { if (fs.existsSync(cand)) return cand; } catch { /* noop */ }
  return 'acdp'; // PATH に委ねる
}

function readJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonSafe(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

// ~/.acode/bin に実体があれば即 true、無ければ PATH 上を 1 回だけ probe して
// 結果を OS tmp にキャッシュ（1h）。セッション毎の余計な spawn を避けるため。
function acdpAvailable() {
  const bin = resolveAcdpBin();
  if (bin !== 'acdp') return true; // 実体パスを確認済み
  const cache = path.join(os.tmpdir(), 'acdp-browser-bin-probe.json');
  const cached = readJsonSafe(cache, null);
  if (cached && Date.now() - cached.ts < 3600_000) return !!cached.ok;
  let ok = false;
  try {
    const r = spawnSync(bin, ['--version'], { timeout: 1500, encoding: 'utf8', windowsHide: true });
    ok = !r.error;
  } catch { ok = false; }
  writeJsonSafe(cache, { ts: Date.now(), ok });
  return ok;
}

// ---- 空 MCP サーバ（0 tools・接続だけ成立させて "failed" 表示を防ぐ）----------

function runEmptyMcpServer(reason) {
  const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();

  function handle(msg) {
    if (!msg || typeof msg.method !== 'string') return;
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id != null;
    switch (msg.method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'acdp-browser (inactive)', version: VERSION },
            instructions: `acdp ツール（browser_*）は現在無効です（${reason}）。`,
          },
        });
        break;
      case 'tools/list':
        send({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } });
        break;
      case 'resources/list':
        send({ jsonrpc: '2.0', id: msg.id, result: { resources: [] } });
        break;
      case 'prompts/list':
        send({ jsonrpc: '2.0', id: msg.id, result: { prompts: [] } });
        break;
      case 'ping':
        send({ jsonrpc: '2.0', id: msg.id, result: {} });
        break;
      default:
        if (hasId) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
  }
}

// ---- main --------------------------------------------------------------------

function main() {
  const proj = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (fs.existsSync(path.join(proj, '.acdp-disabled'))) {
    runEmptyMcpServer('.acdp-disabled によりこのプロジェクトではオプトアウト済み');
    return;
  }
  if (!acdpAvailable()) {
    runEmptyMcpServer('acdp バイナリが見つかりません。arubeh-installer で導入すると次セッションから有効化されます');
    return;
  }

  const r = spawnSync(resolveAcdpBin(), [], {
    cwd: proj,
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exit(r.status === null ? 1 : r.status);
}

main();
