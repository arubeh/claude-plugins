# acdp-browser

acdp (Browser/CDP) の **MCP 提供プラグイン**。Chrome DevTools Protocol ベースで
Playwright MCP 互換の `browser_*` ツール群を提供し、ブラウザを直接操作して
UI 動作確認・E2E を行えるようにする。`/ui-test` スキルと ui-tester エージェントを同梱。

cgc-guard / arag-memory と同じく、本体機能は外部バイナリ（acdp）が担い、
プラグインは「ユーザー全体への MCP 登録 + 起動ガード + 利用ワークフロー
（スキル・エージェント）」を受け持つ。

## できること

- `browser_navigate` / `browser_snapshot` / `browser_click` / `browser_type` /
  `browser_take_screenshot` 等の Playwright MCP 互換ツール
- `browser_*_by_name` 拡張（CDP `Accessibility.queryAXTree` 直叩きの要素取得）
- スクリーンショット・CDP ログ等の成果物は対象プロジェクトの `test-results/` 配下に出力
- **`/ui-test` スキル**: テスト仕様書（Markdown）を入力に `browser_*` でブラウザを直接操作し、
  PASS/FAIL 判定とスクリーンショット付きレポートを出力
- **ui-tester エージェント**: `/ui-test` から呼ばれる UI テスト実行のサブエージェント
  （仕様書解析 → semantic-first 操作 → 判定レポート）

ツールの詳細は acdp 本体（`pj/a-dev/acdp`）の README を参照。

## 前提

- **acdp バイナリ**: `~/.acode/bin/acdp`（Windows: `%USERPROFILE%\.acode\bin\acdp.exe`）に
  arubeh-installer で導入済みであること。`ACDP_BIN` 環境変数で実体パスを上書き可能。
  どちらも無い場合は PATH 上の `acdp` を 1 回だけ probe する（結果は OS tmp に 1h キャッシュ）。
- バイナリが見つからない環境では **0 tools の空 MCP サーバ**として接続する
  （"failed" 表示を出さない fail-open）。

## オプトアウト

ブラウザ操作はどのプロジェクトでも意味を持つため、cgc-guard のような
「プロジェクト参加」の概念は無く、**バイナリがあれば常時有効**。
特定プロジェクトで無効にしたい場合はプロジェクトルートに `.acdp-disabled`
（空ファイル）を置く。次セッションから 0 tools になる。

## 構成

```
acdp-browser/
├── .claude-plugin/plugin.json   マニフェスト（version は marketplace.json と 2 箇所同期）
├── .mcp.json                    acdp（mcp-guard 経由）
├── bin/mcp-guard.js             起動ガード（バイナリ解決 / .acdp-disabled 判定 / 空サーバ）
├── agents/ui-tester.md          UI テスト実行サブエージェント
└── skills/ui-test/SKILL.md      /ui-test スキル（仕様書ベースの UI テスト）
```

- フックは持たない。
- 利用ワークフロー（`/ui-test`・ui-tester）は本プラグイン同梱（acode テンプレートから移管済み・2026-06）。
- **ツール名の接頭辞**: プラグイン経由の MCP ツールは
  `mcp__plugin_acdp-browser_acdp__browser_*` になる（プロジェクト `.mcp.json` 直接登録時の
  `mcp__acdp__browser_*` と異なる）。agents/ui-tester.md の `tools:` 許可リストは両対応で列挙している。

## 検証状況

- [x] `node --check bin/mcp-guard.js`
- [x] 空サーバ応答（`.acdp-disabled` 配置時に initialize / tools/list が 0 tools を返す）
- [x] 中継起動（バイナリありで initialize が acdp 本体から返る）
- [ ] `claude --plugin-dir` での実セッション確認（/ui-test スキル・ui-tester エージェントの認識含む）
- [ ] `/ui-test` E2E（実プロジェクトでの実走）
