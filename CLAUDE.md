# CLAUDE.md

## Project Context

arubeh の **Claude Code プラグイン marketplace**（クローズド配布）。
リポジトリ自身が marketplace を兼ねる（`.claude-plugin/marketplace.json`）。リポに read 権限がある人だけが
`/plugin marketplace add arubeh/claude-plugins` で追加できる。インストール手順の詳細は `README.md`。

## フォルダ構成

```
claude-plugins/
├── .claude-plugin/marketplace.json   marketplace 定義（name / plugins 一覧・各 version）
├── plugins/
│   ├── arag-memory/                  arag を記憶バックエンドにした継続学習プラグイン
│   │   ├── .claude-plugin/plugin.json   マニフェスト（version はここと marketplace.json の両方）
│   │   ├── hooks/hooks.json             SessionStart / UserPromptSubmit / SessionEnd
│   │   ├── .mcp.json                    arag(local) + arag-global（mcp-guard 経由）
│   │   ├── bin/                         フック実装（Node・依存ゼロ）
│   │   └── skills/                      /arag-capture /arag-recall /arag-consolidate
│   ├── cgc-guard/                    cgc 連携（編集前 impact ゲート + 差分 index 自動化）
│   │   ├── .claude-plugin/plugin.json   マニフェスト（version 2 箇所同期は arag-memory と同様）
│   │   ├── hooks/hooks.json             SessionStart / PreToolUse / PostToolUse
│   │   ├── .mcp.json                    cgc（mcp-guard 経由・未参加 PJ は 0 tools）
│   │   ├── bin/                         フック実装（Node・依存ゼロ）
│   │   └── skills/                      /cgc-impact /cgc-refresh
│   └── acdp-browser/                 acdp (Browser/CDP) の MCP 提供（フック・スキル無し）
│       ├── .claude-plugin/plugin.json   マニフェスト（version 2 箇所同期は同様）
│       ├── .mcp.json                    acdp（mcp-guard 経由・バイナリ不在は 0 tools）
│       └── bin/mcp-guard.js             起動ガード（.acdp-disabled でオプトアウト）
├── .mcp.json                         このリポで開発するときの MCP（acdp / cgc / arag）
└── README.md                         インストール・配布手順（ユーザー向け）
```

プラグインごとの仕様・動作確認状況・TODO は各プラグインの README（例: `plugins/arag-memory/README.md`）に置く。
CLAUDE.md には書かない。

## 開発ルール

- **バージョンは 2 箇所同期**: プラグイン変更時は `plugins/<name>/.claude-plugin/plugin.json` と
  `.claude-plugin/marketplace.json` の `version` を必ず両方上げる。description を変えた場合も両方揃える。
- **依存ゼロ原則**: フック実装（`bin/`）は Node 組み込みモジュールのみ。npm 依存を追加しない
  （ユーザー環境でのインストールを `claude` 同梱 Node だけで完結させるため）。
- **未参加 PJ では no-op**: プラグインはインストール＝オプトイン。前提が無い環境（arag-memory なら
  `./.arag/` 無し・`.arag-disabled` あり・arag バイナリ不在）では fail-open / no-op を維持すること。
- **動作確認はローカル読み込みで**: marketplace を経由せず
  `claude --plugin-dir <repo>/plugins/<name>` で起動して検証する。

## Tools / MCP

ルートの `.mcp.json` で開発時に使い得る MCP:

- **cgc** — コード構造・依存解析。`bin/*.js` 編集前の影響確認に使える（小規模なので必須ではない）。
- **arag** — プラグインの動作対象そのもの。挙動確認・検索テストに使う。
- **acdp** — ブラウザ自動操作。本リポでは通常不要。

## 回答スタイル

acode 共通の回答スタイル（簡潔・推奨案提示・選択肢化・目的＋現在地）は
親の `D:\dev\acode\CLAUDE.md` に従う。本ファイルでの重複定義はしない。
