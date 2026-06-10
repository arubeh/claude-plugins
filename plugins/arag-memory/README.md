# arag-memory（Claude Code プラグイン）

arag を**記憶バックエンド**にした Claude Code の継続学習ループ。**入れた人だけ**学習が走る（インストール=オプトイン・未導入ならフック非発火）。設計の全体像と根拠は acode 本体の `docs/arag-learning-loop-plan.md`。

## これは何をするか

| タイミング | 動き | 経路 |
|-----------|------|------|
| **SessionStart** | 直近の記憶マップ＋前回の昇格通知を注入（arag を起動せず数ms） | フック `recall.js` |
| **UserPromptSubmit** | プロンプト本文で bm25 シード recall を local→global で両引き注入（各~100ms・timeout/fail-open） | フック `recall.js` |
| **会話中** | 「決定/教訓/ドメイン/原因/方針」を下書きへ追記（秘密はスクラブ） | skill `/arag-capture` → `capture-draft.js` |
| **SessionEnd** | 下書きを local `./.arag/` へ書き込み＋`scope=org`かつ`confidence=known`を **global へ自動昇格**（コンテンツ由来の安定 id upsert＋同一タイトルの昇格前重複ガード #5）＋**色付き通知**（全て mkdir ロックで単一ライター直列化） | フック `session-end.js` |
| **モデルの深掘り** | warm な MCP `arag`/`arag-global` で意味検索（任意層） | `.mcp.json` 2 サーバ |
| **週次など** | local 磨き直し・誤昇格の撤回監査・graph-build | skill `/arag-consolidate` |

二層構造：**決定論層（フック・bm25 シード＝必ず走る「忘れない保証」）＋ 任意層（モデルが MCP で深掘り＝warm・高品質）**。

## 前提

- **arag** バイナリが使えること（`ARAG_BIN` で明示、無ければ `~/.acode/bin/arag` か PATH）。v0.5.0+ 想定。
- **Node.js**（Claude Code 同梱のものでよい）。依存パッケージはゼロ（組み込みのみ）。
- 記憶を貯めたいプロジェクトで一度だけ **`arag init`**（`./.arag/` 作成）。global は初回のみ `arag init --project _global`。
  - `./.arag/` が無い PJ、または `.arag-disabled` がある PJ では全機能 **no-op**（MCP も起動しない）。

## インストール（開発時）

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/arag-memory
```

有効化はユーザー全体単位。per-project の MCP 設定は不要（CWD の `./.arag/` を実行時に解決）。

## 構成

```
arag-memory/
├── .claude-plugin/plugin.json   マニフェスト
├── hooks/hooks.json             SessionStart / UserPromptSubmit / SessionEnd
├── .mcp.json                    arag(local) + arag-global の 2 サーバ（mcp-guard 経由）
├── bin/
│   ├── lib/util.js              arag 実行・mkdir ロック・秘密スクラブ・参加判定・パス
│   ├── recall.js                recall 注入（SessionStart / UserPromptSubmit）
│   ├── capture-draft.js         会話中の下書き追記（モデルが呼ぶ）
│   ├── session-end.js           flush → local 書き込み＋global 自動昇格＋通知
│   └── mcp-guard.js             未参加 PJ で no-op、参加時のみ arag mcp start
└── skills/
    ├── arag-capture/SKILL.md     何を・どの scope で下書きするか
    ├── arag-recall/SKILL.md      MCP で深掘り recall
    └── arag-consolidate/SKILL.md 定期メンテ・撤回監査
```

## 永続 raw ストア

capture は一時ファイルでなく **`./.arag/_captured/<date>_<sid>_<i>_<slug>.md` に永続書き出し**（§7 の **raw アーカイブ**・監査用）したうえで、**`arag add-text --id <type>_<slug(title)> --source <出典> --metadata <JSON> -`** で取り込む（v0.2.0 / arag#66、id のコンテンツ由来化は v0.2.2 / #5）。id がセッション非依存のため、**同じ知識は別セッション・別 PJ から再キャプチャされても upsert で 1 件に収束**する（raw アーカイブ名は従来どおりセッション付きで履歴保持）。frontmatter は本文に入れず metadata で渡すためノイズチャンク化せず、`source` には Issue/PR 等の本来の出典が載る（arag 側で added_at / channel / added_by / host も自動記録）。global 昇格は同項目を `--project _global` で add-text し、**昇格前に既存 global と正規化タイトルが一致する項目はスキップ**する（旧形式 id の遺産との二重化防止・スキップは色付きサマリに表示）。**旧 arag（add-text 非対応）では従来の `arag add` へ自動フォールバック**する。

## 動作確認済み（arag 0.6.0・実データ）

- capture（秘密スクラブ）→ SessionEnd で local 保存＋`scope=org`×`known` の global 自動昇格＋色付き通知＋`_pending-notice` 引き継ぎ（mkdir ロックで直列化）。
- recall は arag 0.6.0 の `-f json`（#56）で local/global 両引き、見出し優先表示。未参加 PJ で no-op、arag 不在で fail-open。

## 既知の TODO / 要検証

- **SessionEnd の色付き通知の即時表示**はホスト依存。確実な可視化は**次回 SessionStart での再掲**（`_pending-notice.json`）で担保。実機で stderr 即時表示の挙動を確認すること。
- **UserPromptSubmit の `additionalContext` 注入**形式は実機（live Claude Code セッション）で最終確認推奨（SessionStart と同形式を使用）。
- warm `/api/search`（`arag serve`）経由の意味検索シードは v1 では未配線（フックは bm25・モデルは MCP）。必要になれば追加（§1.7）。
- arag のプロセス間書き込みロックが入れば（arag #57）、mkdir ロックは簡素化できる。
