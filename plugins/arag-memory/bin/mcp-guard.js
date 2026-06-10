'use strict';
// MCP 起動ガードラッパー（§0.1 / §1.8）。
// プラグインの .mcp.json はユーザー全体で登録されるため、学習ループを使わない PJ でも
// 起動を試みる。さらに arag mcp は meta.json（=add 済みインデックス）が無いとハードエラーで
// 落ちる。そこで本ラッパーが起動可否を判定し:
//   - 起動可（index あり）→ `arag mcp start`（local）/ `arag mcp start --project _global`（global）を exec
//   - 起動不可（未参加 / index 無し / .arag-disabled）→ **空の MCP サーバ**として接続（0 tools）
//     ＝ 即 exit すると MCP クライアントが "failed" と表示するため、ハンドシェイクには応答する。
// これで「使う PJ では本物のツール・使わない PJ では静かに 0 tools（エラー表示なし）」になる。

const { spawnSync } = require('child_process');
const U = require('./lib/util');

// 起動不可時の最小 MCP サーバ（newline 区切り JSON-RPC 2.0）。接続だけして 0 tools。
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
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();

  function handle(msg) {
    if (!msg || typeof msg.method !== 'string') return; // 応答や不正は無視
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id') && msg.id != null;
    switch (msg.method) {
      case 'initialize':
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'arag-memory (inactive)', version: '0.1.0' },
            instructions: `arag インデックスが無いため arag ツールは現在無効です（${reason}）。arag init + 取り込み後に有効化されます。`,
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
      // notifications（initialized 等）は無視
    }
  }
}

function main() {
  const mode = process.argv[2] === 'global' ? 'global' : 'local';
  const proj = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // 起動可否：local は CWD の .arag/meta.json、global は CWD と無関係に global index の有無。
  let canStart;
  let reason;
  if (mode === 'global') {
    canStart = U.hasGlobalIndex();
    reason = 'global インデックス未作成';
  } else {
    canStart = U.isParticipating(proj) && U.hasLocalIndex(proj);
    reason = U.isParticipating(proj) ? 'このPJは未取り込み' : 'このPJは未参加(.arag 無し/.arag-disabled)';
  }

  if (!canStart) {
    runEmptyMcpServer(reason); // 接続のみ・0 tools（failed を出さない）
    return;
  }

  const args = [];
  if (mode === 'global') args.push('--project', U.GLOBAL_PROJECT); // グローバル指定はサブコマンド前
  args.push('mcp', 'start');

  // 常駐 stdio サーバ：stdio を継承してそのまま中継し、子の終了コードで終わる。
  const r = spawnSync(U.resolveAragBin(), args, { cwd: proj, stdio: 'inherit', windowsHide: true });
  process.exit(r.status === null ? 1 : r.status);
}

main();
