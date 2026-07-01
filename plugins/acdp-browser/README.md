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

---

## セットアップ（最短）

1. **acdp バイナリを導入**（arubeh-installer 経由）。`~/.acode/bin/acdp`
   （Windows: `%USERPROFILE%\.acode\bin\acdp.exe`）に入っていれば OK。確認:

   ```bash
   acdp --version
   ```

2. **プラグインを入れる**（marketplace 経由 or `--plugin-dir`）。これだけで MCP に
   `browser_*` ツールが生える。**特別な設定は不要**で、既定の **headed モード**
   （隔離した Chromium を可視ウィンドウで起動）で即使える。

3. Claude に「このページを開いて」等と頼めば `browser_navigate` が走り、ブラウザが立ち上がる。

> バイナリが無い環境では **0 tools の空 MCP サーバ**として静かに接続する（"failed" を出さない fail-open）。
> 導入後、次セッションから有効になる。

---

## 2 つの動かし方

acdp には大きく **2 系統**のバックエンドがある。用途で選ぶ。

| | 隔離ブラウザ（既定） | 拡張機能（実ブラウザ） |
|---|---|---|
| mode | `headed` / `headless` | `extension` |
| 何を操作するか | acdp が**新規に起動する**まっさらな Chromium | あなたが**今ログインしている実ブラウザ**のタブ |
| ログイン状態 | 無し（毎回ゼロから） | 有り（Cookie・SSO・MFA 済みセッションをそのまま使う） |
| 拡張機能 | 不要 | **必要**（Chrome/Edge に読み込んでペアリング） |
| 主な用途 | 一般の UI テスト・CI・再現性重視 | 認証が重くて隔離プロファイルでは入れないサイト |

**迷ったら headed（既定）でよい。** ログイン済みの実ブラウザを操作する必要が出たときだけ
extension に切り替える。

---

## 使い方 A: 拡張機能を使わない（headed / headless）

acdp が隔離 Chromium を自前で起動する。拡張機能のインストールもペアリングも不要。

- **headed（既定）**: ウィンドウが見える。対話利用・操作の目視向け。**設定ファイルすら不要**。
- **headless**: ウィンドウを出さない。CI・バックグラウンド向け。

headless にするには、プロジェクトルートに `.acdp.json` を置く（`/acdp-mode headless` でも可）:

```json
{ "mode": "headless" }
```

→ `/mcp` で acdp を reconnect（または Claude Code 再起動）すれば反映。
headed に戻すには `.acdp.json` を消す（または `{ "mode": "headed" }`）→ 再接続。

---

## 使い方 B: 拡張機能を使う（extension）

### 仕組み（先にこれを理解すると詰まらない）

extension モードは「acdp（サーバー）」と「ブラウザ拡張（クライアント）」の
**2 つが WebSocket でつながって**動く。**どっちが待ち受けてどっちが繋ぎに行くか**が重要:

```
 Claude Code ──(stdio)──> mcp-guard.js ──spawn──> acdp --backend extension
                                                        │
                                          ws://127.0.0.1:9333 で「待ち受け」(サーバー)
                                                        ▲
                                                        │ 拡張が繋ぎに行く(クライアント)
                                  Chrome/Edge の拡張機能 ┘
                                          │ chrome.debugger で attach
                                          ▼
                              あなたのログイン済みタブ（実ブラウザ）
```

- **acdp 側が WS サーバー**として `127.0.0.1:9333` を**待ち受ける**。
- **拡張機能が WS クライアント**として、その 9333 に**自分から接続しに行く**。
- 繋がると、Claude が呼んだ `browser_*` が acdp → 拡張 → `chrome.debugger` の順で
  中継され、**あなたの実ブラウザのタブ**で実行される。
- つまり「backend が動いていて、そこに拡張を後付けで繋ぐ」という構図。**順番は
  acdp（待ち受け）が先、拡張（接続）が後**。

> **だから手動で `acdp --backend extension` を叩いてはいけない。** プラグインが MCP 接続時に
> 既に acdp を 9333 で起動済みなので、手動起動は二重になり
> `bind ... (os error 10048)`（ポート使用中）で必ず失敗する（→ トラブルシュート参照）。

### いつ acdp（backend）が起動するか

| タイミング | 何が起きる |
|---|---|
| **MCP 接続時**（セッション開始 / `/mcp` reconnect） | mcp-guard が `.acdp.json` を読み、`mode: extension` なら `acdp --backend extension --ext-port 9333` を子プロセスとして起動 → **9333 で待ち受け開始**。セッション中ずっと生存。 |
| **拡張がペアリング** | 拡張（WS クライアント）が 9333 に接続。接続が成立すると拡張のバッジが緑になる。 |
| **最初の `browser_*` 呼び出し** | ここで初めて実タブに `chrome.debugger` で attach（ブラウザ駆動は遅延）。attach 中は「○○ がこのブラウザをデバッグしています」バナーが出る（正常）。 |

### 初回セットアップ手順

1. **拡張を書き出す**（初回のみ。acdp 更新後も再実行推奨）:

   ```bash
   acdp extension install      # ~/.acode/extension に 8 ファイル書き出される
   ```

2. **拡張を読み込む**（操作したいログイン済み Chrome / Edge で・初回のみ）:
   `chrome://extensions`（Edge: `edge://extensions`）を開く → 右上の **デベロッパーモード** を ON →
   **「パッケージ化されていない拡張機能を読み込む」** → `~/.acode/extension` フォルダを選択。
   （更新後にコードを入れ替えたら拡張カードの **↻** で再読み込み）

3. **モードを切り替える**: プロジェクトルートに `.acdp.json` を置く（`/acdp-mode extension` でも可）:

   ```json
   { "mode": "extension" }
   ```

4. **MCP を再接続する**（`/mcp` → acdp を reconnect、または Claude Code 再起動）。
   → ここで acdp が `ws://127.0.0.1:9333` で**待ち受けを開始**する。

5. **ペアリングする**（初回のみ）: 拡張アイコンを右クリック →「オプション」を開き、

   - **WS URL**: `ws://127.0.0.1:9333`
   - **token**: `~/.acode/acdp-ext-token` の中身（次節「token の確認」参照）

   を貼り付けて **「保存して接続」** → バッジが**緑（接続済み）**になれば完了。

6. **動作確認**: Claude に `browser_navigate` を呼ばせ、**そのログイン済み実ブラウザ**の
   タブで開けば成功（attach バナーが出る）。

**2 回目以降は手順 3〜4 だけ**。token もペアリング設定も永続化されているので、
拡張は acdp 起動後に自動再接続する。headless / headed に戻すには `.acdp.json` を
書き換え（または削除）→ 再接続。

### token の確認（何か / いつ設定されたか）

token は初回の extension 起動時に `~/.acode/acdp-ext-token` へ**自動生成・永続化**され、
以降は毎回そのファイルから読まれて acdp に `ACDP_EXT_TOKEN` で渡される。

```bash
# token の値（拡張のオプションに貼る文字列）
cat ~/.acode/acdp-ext-token

# いつ生成されたか（birth time）
stat -c '%w' ~/.acode/acdp-ext-token      # Linux/macOS/Git Bash
```

**token の優先順**（上が勝つ）:

1. 環境変数 `ACDP_EXT_TOKEN`
2. `.acdp.json` / `~/.acode/acdp.json` の `extToken`
3. `~/.acode/acdp-ext-token`（無ければその場で 64 hex を生成して保存）

固定値にしたい場合のみ 1 か 2 で上書きする。通常は 3 の自動値のままで良い。

⚠️ extension モードはログイン済みブラウザを操作するため、Cookie が反映された画面内容・
フォーム値が AX snapshot / スクリーンショット / CDP 結果に含まれ、**LLM に渡り得る**。
信頼できる localhost の acdp とのみペアリングし、token を漏らさないこと。**CI では使わない。**

### トラブルシュート（extension）

- **`bind ... (os error 10048)` / ポート使用中**: acdp を**手動起動した**のが原因。
  プラグインが MCP 接続時に既に 9333 で起動している。手動の `acdp --backend extension` は不要。
  どのプロセスが握っているかは `netstat -ano | findstr 9333`（PowerShell）で確認できる。
- **バッジが緑にならない / すぐ切れる**: WS URL の port が acdp の待ち受け（既定 9333）と一致しているか、
  token が `~/.acode/acdp-ext-token` の値と一致しているか確認。acdp は最後にペアリングした拡張だけを保持（後勝ち）。
- **token が変わった気がする**: `ACDP_EXT_TOKEN` や `.acdp.json` の `extToken` で上書きしていないか確認（それらがファイルより優先される）。
- **操作が効かない**: 対象タブで debugger バナーが出ているか（= attach 成功か）を見る。
- **acdp プロセスが複数残っている**: 過去セッション/reconnect の取り残し。全 acdp を kill →
  `/mcp` で reconnect すれば現役 1 本に戻る（9333 を LISTEN しているものだけが現役）。

---

## 設定リファレンス（`.acdp.json`）

`mcp-guard.js` が読み込み、対応する acdp CLI フラグに変換する。
**プロジェクトの `.acdp.json` がユーザー `~/.acode/acdp.json` をキー単位で上書き**し、
さらに環境変数 `ACDP_MODE` が最優先。

```jsonc
{
  "mode": "extension",              // "headed"(既定) | "headless" | "extension"
  "extPort": 9333,                  // extension のみ。省略時 9333
  "headed": true,                   // extension のみ。操作対象タブを前面化
  "extToken": "…",                  // 任意。token を固定したいとき（通常は不要）
  "args": ["--no-cdp-error-dump"]   // 任意の追加フラグをそのまま透過
}
```

| キー | 効果 | 既定 |
|---|---|---|
| `mode` | バックエンド選択 | `headed` |
| `extPort` | extension の WS 待ち受けポート | `9333` |
| `headed` | (extension時) 操作対象タブを前面化 | `false` |
| `extToken` | ペアリング token を固定 | 自動生成ファイル |
| `args` | acdp へ透過する追加 CLI フラグ | なし |

mode の優先順: `ACDP_MODE` 環境変数 > プロジェクト `.acdp.json` > `~/.acode/acdp.json` > `headed`。
不正な mode 値は `headed` 扱い（fail-open）。**どの変更も MCP 再接続で反映**。

> このリポ（プラグイン開発元）では `.acdp.json` は**コミットしない**（各自のマシン都合の
> モード設定であり、checkout 全員に extension を強制すべきでないため）。`.gitignore` 済み。

---

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
