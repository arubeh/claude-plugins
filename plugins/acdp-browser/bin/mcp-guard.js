'use strict';
// MCP 起動ガードラッパー（cgc-guard / arag-memory の mcp-guard.js と同方式）。
// プラグインの .mcp.json はユーザー全体で登録されるため、acdp を使わない環境でも起動を
// 試みる。本ラッパーが利用可否を判定し:
//   - 利用可（acdp バイナリあり + .acdp-disabled 無し）
//     → acdp バイナリを中継（モード設定に応じた CLI フラグを付与）。
//       ブラウザの起動は acdp 側が初回ツール呼び出しまで遅延する。
//   - 利用不可（acdp 不在 / .acdp-disabled）
//     → 空の MCP サーバとして接続（0 tools・"failed" 表示を出さない）。
// cgc と異なりプロジェクト参加の概念は無い（ブラウザ操作はどの PJ でも意味を持つ）ため、
// 判定はバイナリ存在とオプトアウトの 2 点のみ。依存ゼロ（Node 組み込みのみ）。
//
// ---- モード切り替え ----
// acdp は launch（隔離プロファイル起動: headless/headed）と extension（Chrome 拡張経由で
// ログイン済み実ブラウザを駆動）の 2 バックエンドを持つ。どれを使うかを設定で切り替える:
//   優先順: 環境変数 ACDP_MODE > <project>/.acdp.json > ~/.acode/acdp.json > 既定 headed
//   mode: "headless" | "headed"（既定） | "extension"
// 既定を headed にしているのは対話利用（操作を目視できる）優先のため。acdp バイナリ自体の
// 既定（headless）とは異なる点に注意。CI 等では .acdp.json か ACDP_MODE=headless で明示する。
// extension モードのペアリング値（port/token）はセッションを跨いで固定しないと拡張側で
// 毎回再設定が必要になるため、port は既定 9333、token は ~/.acode/acdp-ext-token に
// 自動生成・永続化して ACDP_EXT_TOKEN 環境変数で子プロセスへ渡す。

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const VERSION = '0.4.0';
const DEFAULT_EXT_PORT = 9333;

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

// ---- モード設定（headless / headed / extension）-------------------------------

// プロジェクト .acdp.json がキー単位でユーザー ~/.acode/acdp.json を上書きする。
// どちらも無ければ {}（= 既定 headless）。壊れた JSON は無視（fail-open）。
function loadModeConfig(proj) {
  const userCfg = readJsonSafe(path.join(os.homedir(), '.acode', 'acdp.json'), null) || {};
  const projCfg = readJsonSafe(path.join(proj, '.acdp.json'), null) || {};
  return { ...userCfg, ...projCfg };
}

// extension モードのペアリングトークン。優先順:
// ACDP_EXT_TOKEN 環境変数 > 設定 extToken > ~/.acode/acdp-ext-token（無ければ自動生成・永続化）。
// 永続化に失敗したら null を返し、token フラグを付けず acdp 側の起動時生成に任せる
// （その場合はセッション毎に拡張側で再ペアリングが必要になるが、起動は止めない）。
function resolveExtToken(cfg) {
  if (process.env.ACDP_EXT_TOKEN) return process.env.ACDP_EXT_TOKEN;
  if (typeof cfg.extToken === 'string' && cfg.extToken) return cfg.extToken;
  const file = path.join(os.homedir(), '.acode', 'acdp-ext-token');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch { /* 未作成 → 生成へ */ }
  const token = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, token + '\n', { mode: 0o600 });
    return token;
  } catch { return null; }
}

// 設定から acdp の CLI 引数と追加環境変数を組み立てる。
// 不正な mode 値は既定の headed 扱い（fail-open）。
function buildLaunchSpec(cfg) {
  const args = [];
  const env = {};
  const mode = process.env.ACDP_MODE || cfg.mode || 'headed';
  if (mode === 'extension') {
    args.push('--backend', 'extension');
    const port = Number.isInteger(cfg.extPort) && cfg.extPort > 0 ? cfg.extPort : DEFAULT_EXT_PORT;
    args.push('--ext-port', String(port));
    const token = resolveExtToken(cfg);
    if (token) env.ACDP_EXT_TOKEN = token;
    // extension モードの --headed は「操作対象タブの前面化」の意味
    if (cfg.headed === true) args.push('--headed');
  } else if (mode === 'headless') {
    // acdp バイナリの既定が headless なのでフラグ不要
  } else {
    if (mode !== 'headed') {
      process.stderr.write(`acdp-browser: 不明な mode "${mode}" のため既定の headed で起動します\n`);
    }
    args.push('--headed');
  }
  if (Array.isArray(cfg.args)) {
    for (const a of cfg.args) if (typeof a === 'string') args.push(a);
  }
  return { args, env };
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

  const { args, env } = buildLaunchSpec(loadModeConfig(proj));
  const r = spawnSync(resolveAcdpBin(), args, {
    cwd: proj,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  process.exit(r.status === null ? 1 : r.status);
}

main();
