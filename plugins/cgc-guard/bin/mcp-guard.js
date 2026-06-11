'use strict';
// MCP 起動ガードラッパー（arag-memory の mcp-guard.js と同方式）。
// プラグインの .mcp.json はユーザー全体で登録されるため、cgc を使わない PJ でも起動を
// 試みる。本ラッパーが参加判定し:
//   - 参加（graph.json あり + cgc バイナリあり + .cgc-disabled 無し）→ `cgc mcp start` を中継
//     （--watch は cgc 既定で ON: セッション中の増分追従はこれが担う）
//   - 不参加 → 空の MCP サーバとして接続（0 tools・"failed" 表示を出さない）

const { spawnSync } = require('child_process');
const U = require('./lib/util');

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
            serverInfo: { name: 'cgc-guard (inactive)', version: '0.1.0' },
            instructions: `cgc ツールは現在無効です（${reason}）。プロジェクトで \`cgc index .\` を実行すると次セッションから有効化されます。`,
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

function main() {
  const proj = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  if (!U.cgcAvailable()) {
    runEmptyMcpServer('cgc バイナリが見つかりません');
    return;
  }
  if (!U.isParticipating(proj)) {
    runEmptyMcpServer('このPJは未参加 (.cgc/graph.json 無し、または .cgc-disabled)');
    return;
  }

  const r = spawnSync(U.resolveCgcBin(), ['mcp', 'start'], {
    cwd: proj,
    stdio: 'inherit',
    windowsHide: true,
  });
  process.exit(r.status === null ? 1 : r.status);
}

main();
