# claude-plugins はサブスク内で動くか（2026-06-15 課金改定の影響棚卸し）

> **目的**: 2026-06-15 の Claude 課金改定（対話的＝サブスク／プログラム的＝Agent SDK 月次クレジット分離）で、本リポジトリの 3 プラグイン（acdp-browser / arag-memory / cgc-guard）が **サブスク枠内で動くか**を実スキャンで確認した記録。
> **判定軸（裏取り済み）**: 課金プールは「重い／並列か」ではなく **「どう起動したか（起動経路）」**で決まる。対話セッション内＝サブスク（A）、SDK / `claude -p` / GitHub Actions / Managed Agents / scheduled workflows ＝ SDK クレジット（B）。出典は acode 本体 `docs/subscription-billing-change-2026-06-15.md`（@ClaudeDevs 公式投稿を x-search で裏取り）。
> **スキャン日**: 2026-06-13

## 結論

**3 プラグインとも、それ自体は Claude（LLM）API を一切呼ばない。** したがって**プラグイン由来の API 課金は発生しない**。サブスク／SDK クレジットのどちらに乗るかは「プラグインを動かしている Claude セッションの起動経路」だけで決まり、プラグイン自身は中立。

→ **対話的 Claude Code セッションで使う限り 100% サブスク枠内（A）。**

## 実スキャン根拠（2026-06-13）

| 調査 | 結果 |
|------|------|
| hooks の実体 | 全て `node "${CLAUDE_PLUGIN_ROOT}/bin/*.js"` の**ローカルスクリプト**（下表） |
| bin/hooks 内の外部 API / LLM 呼び出し（`fetch`/`http(s)`/`api.anthropic`/`api.openai`/`api.x.ai`/`httpx`/`axios`/embed API/`api_key`） | **検出ゼロ** |
| Agent SDK / `@anthropic-ai/sdk` / `claude -p` / `--print` 呼び出し | **検出ゼロ**（README の「Claude Code」言及のみ） |
| MCP サーバーの計算 | すべてローカル（arag=オフライン hybrid RAG、cgc=ローカルコードグラフ Rust、acdp=ローカル CDP ブラウザ操作） |

### 登録フック一覧（すべてローカル node・LLM 非依存）

| プラグイン | イベント | スクリプト | 役割 |
|-----------|---------|-----------|------|
| arag-memory | SessionStart / UserPromptSubmit | `bin/recall.js` | 過去知識を**ローカル BM25/Vector** で検索し additionalContext 注入 |
| arag-memory | SessionEnd | `bin/session-end.js` | capture（ローカル arag へ書き込み・global 昇格） |
| cgc-guard | SessionStart | `bin/session-start.js` | cgc グラフ準備 |
| cgc-guard | PreToolUse (Edit/Write/NotebookEdit/Bash) | `bin/pre-edit-gate.js` | 影響未確認の編集を deny（ローカルグラフ参照） |
| cgc-guard | PostToolUse (同上 / mcp__cgc__*) | `bin/post-edit-index.js` / `record-evidence.js` | 再インデックス・証跡記録 |

> 「headless」という語が acdp-browser に頻出するが、これは **Chromium のヘッドレス起動**であって `claude -p`（headless モード）とは無関係。混同しないこと。

## 課金プールの帰属（プラグインを動かす"セッションの起動経路"で決まる）

プラグイン自身は LLM を呼ばないが、**フックの additionalContext 注入や MCP ツール結果は、それを動かしている Claude セッションのトークンを消費する**。そのトークンがどのプールに乗るかは起動経路次第:

| プラグインの使われ方 | プール | 理由 |
|--------------------|--------|------|
| 対話的 Claude Code セッションで利用（通常運用） | **サブスク（A）** | recall 注入・cgc ゲート・MCP ツール結果は対話セッションのトークン＝サブスク枠 |
| `claude -p` / GitHub Actions / scheduled で利用 | **SDK クレジット（B）** | その駆動セッションが programmatic だから。プラグインのせいではなくセッションの起動経路 |
| acdp-browser を CI の E2E で `claude -p` 駆動 | **SDK クレジット（B）** | ブラウザ操作自体は Claude 課金ゼロ。課金されるのは駆動する Claude セッションのトークンのみ |

### 注意点（運用上）

- フックは**毎セッション/毎プロンプトで additionalContext を注入**するため、対話セッションでもサブスク側のトークン消費を**わずかに増やす**（recall シードや cgc ゲート分）。サブスク週次上限を食う方向ではあるが、API 課金には倒れない。
- arag-memory の埋め込み/検索は**オフライン・ローカル**（外部 embedding API を呼ばない）。LLM 課金ゼロを実機 grep で確認済み。
- 仮に将来プラグインが外部 LLM API を呼ぶ機能を足す場合は、それは Claude サブスクとは無関係の**そのプロバイダの API 課金**になる（本スキャン時点では該当なし）。

## 補足: 各プロジェクトの GitHub Actions（CI/Release）は Claude 課金と別軸

各プロジェクト（例: arag）が使う **GitHub Actions の CI/Release は、Claude のサブスク/API 課金とは無関係**。混同しやすいので切り分けを明記する。**課金の軸は2つ独立**:

| 課金の軸 | 何に対して課金 | 通常の CI/Release は？ |
|---------|--------------|---------------------|
| ① Claude サブスク / API（Pro/Max・Agent SDK クレジット） | Claude のトークン消費 | **消費しない**（Claude を呼ばないため） |
| ② GitHub Actions の分課金 | Actions ランナーの実行時間 | こちらだけ関係（GitHub 側・Claude と無関係） |

### 判定方法（CI が ① に該当するかの一発チェック）

ワークフロー YAML に **`anthropics/claude-code-action` / `claude -p` / Agent SDK 呼び出しが含まれるか**だけを見る。

- **含まれない**（cargo/npm の build・test・lint・artifact 配布など普通の CI）→ **Claude 課金ゼロ**。①の対象外。気にするのは ②（GitHub Actions 分）だけ。
  - 実例 arag: `ci.yml`=`cargo fmt/clippy/test/build`、`release.yml`=`cargo build` + `softprops/action-gh-release`。使う action は checkout / rust-toolchain / rust-cache / upload・download-artifact / action-gh-release のみ。**Claude を一切呼ばない → サブスク内かどうかを問う以前に Claude 課金が発生しない**。
- **含まれる**（CI に Claude Code Action を組み込んだ）→ それは前掲「programmatic 経路（GitHub Actions）」に該当し **SDK クレジット（B）を消費**する。これが唯一の地雷。

### ②（GitHub Actions 分課金）の目安

これは各プロジェクトの `.claude/rules/ci-release.md` が扱う軸:

- **Public リポ** → Actions 無料（分課金枠なし）
- **Private + GitHub Free** → 月 2,000 分まで無料・超過は課金。**macOS ランナーは Linux の 10倍単価**（Release の 3 OS ビルド等は頻度低なので許容、毎 PR の macOS は要注意）

## まとめ（一言）

**claude-plugins も、各プロジェクトの通常の GitHub Actions CI/Release も、Claude サブスク内で完結する（そもそも Claude を呼ばない）。**プラグインや CI が Claude の API 課金を生むことはない。SDK クレジット（B）に乗るのは「`claude -p`・CI に Claude Code Action を足す・scheduled で Claude を駆動するとき」だけで、それは acode 本体と同じく**起動経路の問題**であってプラグイン/CI 自体の問題ではない。

## 引用元 / 参照

- 判定軸と一次裏取り: acode 本体 `D:\dev\acode\docs\subscription-billing-change-2026-06-15.md`（@ClaudeDevs 公式投稿を x-search で確認）
  - https://x.com/i/status/2054610152817619388 — interactive セッション内の subagents/parallel/Task/Workflow はサブスク上限内
  - https://x.com/ClaudeDevs/status/2052069321355182447 — 判定軸＝起動経路（interactive=サブスク / programmatic=credit）
  - https://x.com/ClaudeDevs/status/2065080005328249086 — Managed Agents / scheduled workflows は programmatic 扱い

---

*作成: 2026-06-13 / 本リポジトリ実スキャン（hooks.json・bin/*.js・MCP 構成）と acode 本体の課金棚卸しに基づく。プラグイン自身の LLM API 呼び出しは検出ゼロ。*
