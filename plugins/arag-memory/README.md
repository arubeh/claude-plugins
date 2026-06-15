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

capture は一時ファイルでなく **`./.arag/_captured/<type>_<slug(title)>.md` に永続書き出し**（§7 の **raw アーカイブ**・監査用）したうえで、**`arag add-text --batch`（arag#69・JSONL 一括）または `arag add-text --id <type>_<slug(title)> --source <出典> --metadata <JSON> -`** で取り込む（v0.2.0 / arag#66、id のコンテンツ由来化は v0.2.2 / #5、kill 耐性・raw 名の stable id 化・batch 取込は v0.2.3 / #7）。id・raw ファイル名ともセッション非依存のため、**同じ知識は別セッション・別 PJ から再キャプチャされても upsert / 同名上書きで 1 件に収束**する。frontmatter は本文に入れず metadata で渡すためノイズチャンク化せず、`source` には Issue/PR 等の本来の出典が載る（arag 側で added_at / channel / added_by / host も自動記録）。global 昇格は同項目を `--project _global` で add-text し、**昇格前に既存 global と正規化タイトルが一致する項目はスキップ**する（旧形式 id の遺産との二重化防止・スキップは色付きサマリに表示）。**フォールバックは 3 段**: batch 非対応 arag では per-item add-text、add-text 非対応の旧 arag では `arag add`（fail-open 原則）。

### 早期 kill 耐性（v0.2.3 / #7）

Claude Code はセッション終了時に SessionEnd フックを hooks.json の timeout を待たず**プロセスツリーごと kill することがある**（実測: per-item 取込 4 件中 1 件で死亡 ×2 セッション → 残り 3 件が検索不能・pending 未クリアで raw 重複が蓄積）。対策:

- **kill 窓の最小化**: `add-text --batch` で local 全件 / global 昇格分を各 1 プロセスに畳む（モデルロード × N を排除。実測 4 件 ~9s → batch 部 ~2s）
- **再実行の冪等化**: 途中 kill で下書きが残っても、次セッションの再実行が stable id upsert・raw 同名上書き・global 重複ガードで同じ結果に収束する

## recall ノイズ抑制（v0.2.4 / arag#81）

小コーパスでは BM25 上位が常に同じ無関係文書になり、recall が「ノイズ垂れ流し」になりやすい（無関係注入が続くと 📚 ブロックを読み飛ばす習慣がつく＝アラーム疲れ）。**ゼロ注入のほうが無関係注入より価値が高い**ため、UserPromptSubmit の recall に 2 段の抑制を入れた（いずれも fail-open）:

- **語彙ゲート**（v0.2.9・**既定 ON**・`ARAG_RECALL_GATE=0` で OFF）: プロンプトの有意語（ASCII 長さ≥3 / CJK 2-gram）とヒット本文（section + preview）の重なりが**ゼロ**のヒットを落とす。**英語のツール質問に日本語マニュアルが注入される**ような cross-language の無関係注入（主症状）を直接排除する。スコアに依存しないため corpus 間で移植可能。同言語で BM25 が拾った関連ヒット（語が重なる）は落とさない＝過剰ドロップなし。有意語が 0 個（短い/記号のみ）のクエリ・本文が取れないヒットは素通し（fail-open）。
  - **限界**: 語の意味までは見ないため (a) 日本語の同言語インシデント一致（"エンジニアリング" vs "エンジニア" の n-gram 重複）、(b) 一般語のトークン衝突（クエリ "ci-fix" の `fix` が DataClasys の `terminal_fix` と一致）は残りうる。依存ゼロでは BM25 を超えられないため範囲外で、相対フロア（下記）や warm デーモン時の hybrid 意味検索で部分緩和する。
- **相対フロア**（v0.2.9・**既定 OFF**・`ARAG_RECALL_MIN_RATIO`、`RAG_` fallback・0<r≤1）: top スコアの r 倍未満のヒットを落とす。同言語の弱い裾を絞る。絶対フロアと違い corpus 非依存。閾値は推測で既定 ON にしない（運用で較正）。
- **関連度フロア（絶対）**: `ARAG_RECALL_MIN_SCORE`（既定 OFF）。score がこの値未満のヒットを注入前に落とす。全件が閾値未満なら 📚 ブロックを出さない。閾値は運用（bm25 シード）で較正する。arag 本体側にも `arag search --min-score` / 同名 env がある（arag#81）。
- **セッション内既出抑制**: 既定 ON（`ARAG_RECALL_SESSION_DEDUP=0` で OFF）。同一セッション（`session_id`）で一度注入した文書（`source` 単位）を以後のプロンプトでは出さない。状態は `./.arag/_recall-seen.json`（直近 200 キー）。`session_id` が取れない場合は跨セッション過剰抑制を避けるため抑制しない。

抑制の順序は `絶対フロア → 相対フロア → 語彙ゲート → scope 横断 dedup → 既出抑制 → 予約枠マージ`。注入の偏り（同一文書独占）やスコア分布は arag 本体の `ARAG_RECALL_LOG=1` + `arag recall-stats`（arag#83）で計測でき、各閾値の較正に使える。

## Claude ネイティブ・ファイルメモリの同期（v0.2.5 / arag#82）

Claude Code は `~/.claude/projects/<encoded>/memory/*.md`（frontmatter 付き）に独自の記憶を書く（arag-memory の capture とは別系統）。これが育つ一方で arag(global) が枯れると recall が効かない（capture 枯渇）。対策として SessionEnd で **opt-in 同期**を入れた:

- `ARAG_SYNC_CLAUDE_MEMORY=1`（**既定 OFF**）のとき、SessionEnd で当該プロジェクトのファイルメモリ `.md` を読み、**秘密スクラブ後**に `arag --project _global add-text` で global へ冪等 upsert する（id=`claude-mem:<name>`・`MEMORY.md` 索引は除外）。ネイティブ記憶を共有 global へ流すのは明示同意（env）を要するため既定 OFF。
- arag CLI の `arag sync-claude-memory`（arag#82）はファイル直読みで scrub しないため、フックは**自前で読み→`scrubSecrets`→既存 add-text 経路**で取り込む（capture と同じ秘密除外・kill 耐性・flock を再利用）。

## 動作確認済み（arag 0.6.0・実データ）

- capture（秘密スクラブ）→ SessionEnd で local 保存＋`scope=org`×`known` の global 自動昇格＋色付き通知＋`_pending-notice` 引き継ぎ（mkdir ロックで直列化）。
- recall は arag 0.6.0 の `-f json`（#56）で local/global 両引き、見出し優先表示。未参加 PJ で no-op、arag 不在で fail-open。

## 既知の TODO / 要検証

- **SessionEnd の色付き通知の即時表示**はホスト依存。確実な可視化は**次回 SessionStart での再掲**（`_pending-notice.json`）で担保。実機で stderr 即時表示の挙動を確認すること。
- **UserPromptSubmit の `additionalContext` 注入**形式は実機（live Claude Code セッション）で最終確認推奨（SessionStart と同形式を使用）。
- warm `/api/search`（`arag serve`）経由の意味検索シードは v1 では未配線（フックは bm25・モデルは MCP）。必要になれば追加（§1.7）。
- arag のプロセス間書き込みロックが入れば（arag #57）、mkdir ロックは簡素化できる。
