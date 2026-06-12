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
- **`/acdp-mode` スキル**: バックエンドモード（headless / headed / extension）の切り替え（後述）

ツールの詳細は acdp 本体（`pj/a-dev/acdp`）の README を参照。

## モード切り替え（headless / headed / extension）

acdp は 3 つのモードで動かせる。mcp-guard.js が設定を読み、対応する CLI フラグ付きで
acdp を起動する:

| mode | 動作 | 用途 |
|---|---|---|
| `headed`（既定） | 隔離 Chromium を可視ウィンドウで起動（`--headed`） | 対話利用・操作の目視 |
| `headless` | 隔離 Chromium をヘッドレス起動 | CI・バックグラウンド実行 |
| `extension` | **Chrome 拡張経由でログイン済み実ブラウザを操作**（`--backend extension`） | MFA/SSO 等の高認証サイト |

※ プラグインの既定は **headed**（対話利用優先）。acdp バイナリ単体の既定（headless）とは異なる。

### 設定方法（優先順）

1. 環境変数 `ACDP_MODE`（`headless` / `headed` / `extension`）
2. プロジェクトルートの `.acdp.json`
3. ユーザー既定 `~/.acode/acdp.json`
4. どれも無ければ `headed`

`.acdp.json` の例（プロジェクト側がユーザー側をキー単位で上書き）:

```jsonc
{
  "mode": "extension",
  "extPort": 9333,                  // extension のみ。省略時 9333
  "headed": true,                   // extension のみ。操作対象タブを前面化
  "args": ["--no-cdp-error-dump"]   // 任意の追加フラグをそのまま透過
}
```

切り替えは `/acdp-mode` スキルでも行える。**反映には MCP の再接続
（`/mcp` → reconnect か Claude Code 再起動）が必要**。不正な mode 値は既定の headed 扱い（fail-open）。

### 切り替え手順

#### headed ↔ headless（隔離ブラウザの表示/非表示）

既定は headed（ウィンドウ表示）。CI 等でヘッドレスにしたい場合:

1. プロジェクトルートに `.acdp.json` を書く（`/acdp-mode headless` でも可）:

   ```json
   { "mode": "headless" }
   ```

2. MCP を再接続する（`/mcp` → acdp を reconnect、または Claude Code 再起動）
3. `browser_navigate` 実行時に Chrome ウィンドウが出なければ OK。
   headed に戻すには `.acdp.json` を削除（または `"mode": "headed"`）→ 再接続。

#### extension（ログイン済み実ブラウザを操作）— 初回セットアップ

1. **拡張を書き出す**（初回のみ。acdp 更新後は再実行 → 拡張カードの ↻）:

   ```bash
   acdp extension install      # ~/.acode/extension に書き出される
   ```

2. **拡張を読み込む**（操作したいログイン済み Chrome / Edge で・初回のみ）:
   `chrome://extensions`（Edge: `edge://extensions`）→ デベロッパーモード ON →
   「パッケージ化されていない拡張機能を読み込む」→ `~/.acode/extension` を選択
3. **モードを切り替える**: プロジェクトルートに `.acdp.json` を書く（`/acdp-mode extension` でも可）:

   ```json
   { "mode": "extension" }
   ```

4. **MCP を再接続する** → acdp が `ws://127.0.0.1:9333` で待ち受けを開始する
5. **ペアリングする**（初回のみ）: 拡張の「オプション」を開き、
   WS URL `ws://127.0.0.1:9333` と token（`~/.acode/acdp-ext-token` の中身）を貼り付けて
   「保存して接続」→ バッジが緑（接続済み）になれば完了
6. **動作確認**: `browser_navigate` 等が実ブラウザのタブに対して動くこと
   （attach 中は「デバッグしています」バナーが出るのが正常）

2 回目以降は手順 3〜4 だけ（token は永続化済みのため拡張は自動再接続する）。
headless に戻すには `.acdp.json` を削除 → 再接続。

⚠️ extension モードはログイン済みブラウザを操作するため、Cookie が反映された画面内容・
フォーム値がスナップショット/スクリーンショットに含まれ得る。CI では使わないこと。

#### token を自分で固定したい場合（任意）

既定では token は `~/.acode/acdp-ext-token` に自動生成・永続化され、`ACDP_EXT_TOKEN`
環境変数で acdp に渡される（通常はこのままで OK）。固定値にしたい場合のみ
環境変数 `ACDP_EXT_TOKEN` か `.acdp.json` の `extToken` で上書きする。

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
├── bin/mcp-guard.js             起動ガード（バイナリ解決 / .acdp-disabled 判定 / 空サーバ /
│                                 モード設定の読み込みと CLI フラグ組み立て）
├── agents/ui-tester.md          UI テスト実行サブエージェント
├── skills/ui-test/SKILL.md      /ui-test スキル（仕様書ベースの UI テスト）
└── skills/acdp-mode/SKILL.md    /acdp-mode スキル（headless / headed / extension 切り替え）
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
- [x] モード設定 → CLI フラグ組み立て（headless/headed/extension・ACDP_MODE 上書き・
      extPort/headed/args 透過・不正 mode の headless フォールバック・token 自動生成 64 hex）
- [x] `acdp extension install`（acdp 本体側）が `~/.acode/extension` に拡張一式を書き出す
- [ ] `claude --plugin-dir` での実セッション確認（/ui-test・/acdp-mode スキルの認識含む）
- [ ] `/ui-test` E2E（実プロジェクトでの実走）
- [ ] extension モードの実走（拡張ペアリング → browser_* がログイン済みブラウザに効く）
