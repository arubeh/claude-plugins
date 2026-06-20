'use strict';
// pre-edit-gate / record-evidence / util のスモークテスト。
// 実行: node plugins/cgc-guard/test/smoke.js
// CI 基盤なしでも回せる依存ゼロの assert ベース。フックは stdin JSON →
// stdout JSON の純関数に近いので、子プロセスで主要パスを検証する。

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'bin', 'pre-edit-gate.js');
const U = require(path.join(ROOT, 'bin', 'lib', 'util.js'));

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cgc-guard-smoke-'));
  fs.mkdirSync(path.join(dir, '.cgc'), { recursive: true });
  // 参加判定 = graph.json あり。小規模 warn 降格を避けるため十分大きく。
  fs.writeFileSync(path.join(dir, '.cgc', 'graph.json'), 'x'.repeat(300000));
  return dir;
}

function runGate(input, env = {}) {
  const r = spawnSync(process.execPath, [GATE], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CGC_BIN: process.execPath, ...env }, // cgcAvailable を満たすダミー
  });
  assert.strictEqual(r.status, 0, `gate exited ${r.status}: ${r.stderr}`);
  if (!r.stdout.trim()) return null;
  return JSON.parse(r.stdout);
}

function decision(out) {
  if (!out || !out.hookSpecificOutput) return undefined;
  return out.hookSpecificOutput.permissionDecision;
}

function writeTranscript(proj, entries) {
  const p = path.join(proj, 'transcript.jsonl');
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

// ---- util 単体 ----------------------------------------------------------------

assert.ok(U.isTestPath('crates/foo/tests/integration.rs'));
assert.ok(U.isTestPath('src/app.test.ts'));
assert.ok(U.isTestPath('pkg/conftest.py'));
assert.ok(!U.isTestPath('src/app.ts'));

{
  // recentCgcToolUse: プラグイン名前空間の tool_use を検出し、TTL を尊重する。
  const proj = tmpProject();
  const fresh = new Date().toISOString();
  const staleTs = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const tp = writeTranscript(proj, [
    { type: 'assistant', timestamp: fresh, message: { content: [
      { type: 'tool_use', name: 'mcp__plugin_cgc-guard_cgc__impact' },
    ] } },
  ]);
  assert.ok(U.recentCgcToolUse(tp), 'namespaced tool_use must count as evidence');
  const tpStale = writeTranscript(proj, [
    { type: 'assistant', timestamp: staleTs, message: { content: [
      { type: 'tool_use', name: 'mcp__cgc__context' },
    ] } },
  ]);
  assert.ok(!U.recentCgcToolUse(tpStale, 10 * 60 * 1000), 'stale tool_use must not count');
}

// ---- gate: deny + 理由コード ----------------------------------------------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's1',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), 'deny');
  assert.ok(
    /\[reason=MARKER_AND_EVIDENCE_MISSING deny=1\/2\]/.test(
      out.hookSpecificOutput.permissionDecisionReason
    ),
    'deny must carry a reason code'
  );
}

// ---- gate: transcript tool_use フォールバックで allow + 承認が永続化 -------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [
    { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [
      { type: 'tool_use', name: 'mcp__plugin_cgc-guard_cgc__context' },
    ] } },
  ]);
  const input = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's2',
    transcript_path: tp,
  };
  assert.strictEqual(decision(runGate(input)), undefined, 'fallback evidence must allow');
  // 承認記録により、transcript が空になっても TTL 内は通る (#189-4)。
  const emptyTp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  input.transcript_path = emptyTp;
  assert.strictEqual(decision(runGate(input)), undefined, 'approval must persist');
}

// ---- gate: テストファイルは既定で対象外 (#189-1) ---------------------------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'tests', 'integration.rs') },
    cwd: proj,
    session_id: 's3',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), undefined, 'test files must bypass the gate');
}

// ---- gate: 小規模リポは warn に降格 (#189-3) -------------------------------------

{
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc', 'graph.json'), '{}'); // tiny graph
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's4',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), 'allow', 'small repo must downgrade to warn');
  assert.ok(/warn モード/.test(out.hookSpecificOutput.permissionDecisionReason));
}

// ---- gate: .cgc-guard.json mode=off ---------------------------------------------

{
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc-guard.json'), JSON.stringify({ mode: 'off' }));
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's5',
    transcript_path: tp,
  });
  assert.strictEqual(decision(out), undefined, 'mode=off must disable the gate');
}

// ---- gate: deny 上限超過で降格 allow ---------------------------------------------

{
  const proj = tmpProject();
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  const input = {
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
    cwd: proj,
    session_id: 's6',
    transcript_path: tp,
  };
  assert.strictEqual(decision(runGate(input)), 'deny');
  assert.strictEqual(decision(runGate(input)), 'deny');
  assert.strictEqual(decision(runGate(input)), undefined, '3rd attempt must degrade to allow');
}

// ---- record-evidence: 名前空間付きツール名で証跡が記録される ----------------------

{
  const proj = tmpProject();
  const REC = path.join(ROOT, 'bin', 'record-evidence.js');
  const r = spawnSync(process.execPath, [REC], {
    input: JSON.stringify({
      tool_name: 'mcp__plugin_cgc-guard_cgc__impact',
      tool_input: { target: 'main' },
      tool_response: 'TARGET: main (callers of ' + proj.replace(/\\/g, '\\\\') + '\\\\src\\\\main.rs:1)',
      cwd: proj,
      session_id: 's7',
    }),
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const ev = JSON.parse(
    fs.readFileSync(path.join(proj, '.cgc', 'tmp', 'evidence-s7.json'), 'utf8')
  );
  assert.strictEqual(ev.entries.length, 1, 'namespaced tool must be recorded');
  assert.strictEqual(ev.entries[0].tool, 'mcp__plugin_cgc-guard_cgc__impact');
}

// ---- v0.3.0: evidenceScope='dir' — 同一ディレクトリの証跡で一括編集を許可 -------

{
  const proj = tmpProject();
  fs.mkdirSync(path.join(proj, '.cgc', 'tmp'), { recursive: true });
  // 同じディレクトリの「別ファイル」への新鮮な impact 証跡。
  fs.writeFileSync(
    path.join(proj, '.cgc', 'tmp', 'evidence-dir1.json'),
    JSON.stringify({
      entries: [
        { ts: Date.now(), tool: 'mcp__cgc__impact', symbol: 'walk', risk: 'LOW',
          paths: [path.join(proj, 'src', 'other_parser.rs')] },
      ],
    })
  );
  const out = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(proj, 'src', 'edit_me.rs') },
    cwd: proj,
    session_id: 'dir1',
  });
  assert.strictEqual(
    decision(out), undefined,
    'same-directory evidence must allow the edit (batch-edit waiver)'
  );
}

// ---- #225: dir スコープ承認 — 1ファイルで確認すれば同dirの兄弟は承認TTL内素通り ----

{
  const proj = tmpProject();
  // fileA をフォールバック証跡(tool_use)で通す → ディレクトリ単位の承認が記録される。
  const tp = writeTranscript(proj, [
    { type: 'assistant', timestamp: new Date().toISOString(), message: { content: [
      { type: 'tool_use', name: 'mcp__cgc__impact' },
    ] } },
  ]);
  const dir = path.join(proj, 'crates', 'p', 'src');
  assert.strictEqual(
    decision(runGate({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, 'a.rs') },
      cwd: proj, session_id: 'dirapp', transcript_path: tp,
    })),
    undefined, 'first edit passes via tool_use evidence and records dir approval'
  );

  // 兄弟ファイル b.rs を「証跡なし・空 transcript」で編集 → dir 承認で素通り。
  // ファイル単位承認だった頃は b.rs 初回として deny されていた摩擦をここで解消。
  const emptyTp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  assert.strictEqual(
    decision(runGate({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, 'b.rs') },
      cwd: proj, session_id: 'dirapp', transcript_path: emptyTp,
    })),
    undefined, 'sibling file in an approved directory must bypass via dir-scoped approval (#225)'
  );

  // 別ディレクトリの初回は依然 deny（gate を弱めていない）。
  assert.strictEqual(
    decision(runGate({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(proj, 'crates', 'q', 'src', 'c.rs') },
      cwd: proj, session_id: 'dirapp', transcript_path: emptyTp,
    })),
    'deny', 'a different directory must still require its own impact check'
  );
}

// ---- v0.3.0: risk 段階化 — 既知 LOW は TTL 切れ後も warn、CRITICAL は deny -------

{
  const stale = Date.now() - 20 * 60 * 1000; // fileTtl(10分) 超過・KEEP(30分) 内
  const mkEvidence = (sid, risk, proj) => {
    fs.mkdirSync(path.join(proj, '.cgc', 'tmp'), { recursive: true });
    fs.writeFileSync(
      path.join(proj, '.cgc', 'tmp', `evidence-${sid}.json`),
      JSON.stringify({
        entries: [
          { ts: stale, tool: 'mcp__cgc__impact', symbol: 's', risk,
            paths: [path.join(proj, 'src', 'low_risk.rs')] },
        ],
      })
    );
  };

  const projLow = tmpProject();
  mkEvidence('risk1', 'LOW', projLow);
  const outLow = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(projLow, 'src', 'low_risk.rs') },
    cwd: projLow,
    session_id: 'risk1',
  });
  assert.notStrictEqual(
    decision(outLow), 'deny',
    'known-LOW file must demote to warn after TTL expiry'
  );

  const projHigh = tmpProject();
  mkEvidence('risk2', 'CRITICAL', projHigh);
  const outHigh = runGate({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(projHigh, 'src', 'low_risk.rs') },
    cwd: projHigh,
    session_id: 'risk2',
  });
  assert.strictEqual(
    decision(outHigh), 'deny',
    'known-CRITICAL file must stay denied'
  );
}

// ---- session-start: gzip graph.json (cgc #210+) を破損扱いしない -----------------

{
  const zlib = require('zlib');
  const SS = path.join(ROOT, 'bin', 'session-start.js');
  const runSessionStart = (proj) => {
    const r = spawnSync(process.execPath, [SS], {
      input: JSON.stringify({ cwd: proj, session_id: 'ss1' }),
      encoding: 'utf8',
      env: { ...process.env, CGC_BIN: process.execPath },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout;
  };
  const json = '{"version":1,"nodes":[],"edges":[]}';

  // gzip スナップショット → 破損ノート無し
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc', 'graph.json'), zlib.gzipSync(Buffer.from(json)));
  assert.ok(
    !runSessionStart(proj).includes('破損'),
    'gzip graph must not be treated as corrupt'
  );

  // 途中 kill で truncate された gzip → corrupt（解凍が例外になる）
  const proj2 = tmpProject();
  const gz = zlib.gzipSync(Buffer.from(json));
  fs.writeFileSync(path.join(proj2, '.cgc', 'graph.json'), gz.subarray(0, gz.length - 6));
  assert.ok(runSessionStart(proj2).includes('破損'), 'truncated gzip must be corrupt');

  // プレーン JSON（pre-#210 バイナリ）も従来どおり受理
  const proj3 = tmpProject();
  fs.writeFileSync(path.join(proj3, '.cgc', 'graph.json'), json);
  assert.ok(!runSessionStart(proj3).includes('破損'), 'plain JSON graph must stay valid');
}

// ---- 点1: graph メンバーシップで未インデックスファイルを waiver ------------------

{
  const proj = tmpProject();
  // 小規模 warn 降格を無効化し、deny 維持を純粋に検証する。
  fs.writeFileSync(path.join(proj, '.cgc-guard.json'), JSON.stringify({ smallRepoWarnBytes: 0 }));
  // 実 graph: Repository ノード（rooted 判定用）+ src/main.rs の実ノード。
  fs.writeFileSync(path.join(proj, '.cgc', 'graph.json'), JSON.stringify({
    version: 1,
    nodes: [
      { id: 1, kind: 'Repository', name: 'p', path: proj },
      { id: 2, kind: 'Function', name: 'f', path: path.join(proj, 'src', 'main.rs') },
    ],
    edges: [],
  }));

  // util 単体: 既知ファイルは未インデックスでない / 未知ファイルは未インデックス。
  assert.ok(
    !U.isConfirmedUnindexed(proj, path.join(proj, 'src', 'main.rs')),
    'indexed file must NOT be confirmed-unindexed'
  );
  assert.ok(
    U.isConfirmedUnindexed(proj, path.join(proj, 'src', 'brand_new.rs')),
    'unindexed file must be confirmed-unindexed'
  );
  // セパレータ揺れ（/ と \）でも一致すること。
  assert.ok(
    !U.isConfirmedUnindexed(proj, proj + '/src/main.rs'),
    'separator variation must still match the indexed path'
  );

  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  // gate: 未インデックスファイルの編集は証跡なしでも allow。
  assert.strictEqual(
    decision(runGate({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(proj, 'src', 'brand_new.rs') },
      cwd: proj, session_id: 'idx1', transcript_path: tp,
    })),
    undefined, 'editing an unindexed file must bypass the gate'
  );
  // gate: インデックス済みファイルは従来どおり deny（waiver でゲートを弱めない）。
  assert.strictEqual(
    decision(runGate({
      tool_name: 'Edit',
      tool_input: { file_path: path.join(proj, 'src', 'main.rs') },
      cwd: proj, session_id: 'idx2', transcript_path: tp,
    })),
    'deny', 'indexed file must still be gated'
  );
}

// 相対パス形式の graph（project root 配下の絶対パスが 1 つも無い）は判定不能扱い。
{
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc', 'graph.json'), JSON.stringify({
    version: 1,
    nodes: [{ id: 1, kind: 'Function', name: 'f', path: 'src/main.rs' }], // 相対パス
    edges: [],
  }));
  assert.ok(
    !U.isConfirmedUnindexed(proj, path.join(proj, 'src', 'whatever.rs')),
    'a graph without project-rooted absolute paths must be treated as undetermined (no mass-waiver)'
  );
}

// gzip graph.json（cgc #210+）でもメンバーシップ判定が成立する。
{
  const zlib = require('zlib');
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc', 'graph.json'), zlib.gzipSync(Buffer.from(JSON.stringify({
    version: 1,
    nodes: [
      { id: 1, kind: 'Repository', name: 'p', path: proj },
      { id: 2, kind: 'Function', name: 'f', path: path.join(proj, 'src', 'main.rs') },
    ],
    edges: [],
  }))));
  assert.ok(
    !U.isConfirmedUnindexed(proj, path.join(proj, 'src', 'main.rs')),
    'gzip graph: indexed file recognized'
  );
  assert.ok(
    U.isConfirmedUnindexed(proj, path.join(proj, 'src', 'brand_new.rs')),
    'gzip graph: unindexed file recognized'
  );
}

// ---- 点2: module/use 宣言の純粋追加は impact 不要で素通り ------------------------

{
  // util 単体。
  assert.ok(U.isDeclarationOnlyAddition({
    tool_name: 'Edit',
    tool_input: { old_string: 'mod a;\nmod b;', new_string: 'mod a;\nmod ai;\nmod b;' },
  }), 'inserting a mod declaration must be declaration-only');
  assert.ok(U.isDeclarationOnlyAddition({
    tool_name: 'Edit',
    tool_input: { old_string: 'use x::y;', new_string: 'use x::y;\npub use a::b;' },
  }), 'adding a pub use must be declaration-only');
  assert.ok(!U.isDeclarationOnlyAddition({
    tool_name: 'Edit',
    tool_input: { old_string: 'mod a;', new_string: 'mod a;\nlet x = call();' },
  }), 'adding a statement must NOT be declaration-only');
  assert.ok(!U.isDeclarationOnlyAddition({
    tool_name: 'Edit',
    tool_input: { old_string: 'fn f() {}', new_string: 'fn g() {}' },
  }), 'modifying existing code must NOT be declaration-only');
  assert.ok(!U.isDeclarationOnlyAddition({
    tool_name: 'Write',
    tool_input: { old_string: 'mod a;', new_string: 'mod a;\nmod b;' },
  }), 'only Edit is eligible (Write overwrites wholesale)');

  // gate: インデックス済みファイルでも宣言追加なら証跡なしで allow。
  const proj = tmpProject();
  fs.writeFileSync(path.join(proj, '.cgc-guard.json'), JSON.stringify({ smallRepoWarnBytes: 0 }));
  fs.writeFileSync(path.join(proj, '.cgc', 'graph.json'), JSON.stringify({
    version: 1,
    nodes: [
      { id: 1, kind: 'Repository', name: 'p', path: proj },
      { id: 2, kind: 'Module', name: 'lib', path: path.join(proj, 'src', 'lib.rs') },
    ],
    edges: [],
  }));
  const tp = writeTranscript(proj, [{ type: 'user', message: { content: [] } }]);
  assert.strictEqual(
    decision(runGate({
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(proj, 'src', 'lib.rs'),
        old_string: 'mod a;',
        new_string: 'mod a;\npub mod ai;',
      },
      cwd: proj, session_id: 'decl1', transcript_path: tp,
    })),
    undefined, 'declaration-only addition to an indexed file must bypass the gate'
  );
}

// ---- #225 follow-up: isWatcherLive — heartbeat 鮮度で二重 reindex を回避 -------

{
  const proj = tmpProject();
  fs.mkdirSync(path.join(proj, '.cgc', 'tmp'), { recursive: true });
  // heartbeat 不在 → not live（従来動作にフォールバック）
  assert.ok(!U.isWatcherLive(proj), 'no heartbeat → watcher not live');
  // fresh heartbeat → live（hook は full index を skip すべき）
  fs.writeFileSync(U.watcherHeartbeatFile(proj), String(Date.now()));
  assert.ok(U.isWatcherLive(proj), 'fresh heartbeat → watcher live');
  // stale heartbeat（既定 30s 超）→ not live
  const stale = Date.now() - 120000;
  fs.utimesSync(U.watcherHeartbeatFile(proj), new Date(stale), new Date(stale));
  assert.ok(!U.isWatcherLive(proj), 'stale heartbeat → watcher not live');
}

console.log('smoke: all assertions passed');
