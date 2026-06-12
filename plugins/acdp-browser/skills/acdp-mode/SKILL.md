---
name: acdp-mode
description: acdp ブラウザバックエンドのモード（headless / headed / extension=Chrome 拡張経由でログイン済み実ブラウザを操作）を切り替える。.acdp.json を書き換え、extension モードでは拡張のインストール（acdp extension install）とペアリング手順まで案内する。
---

# acdp モード切り替えスキル

acdp（`browser_*` ツール）の動作モードを切り替えます。設定はプロジェクトルートの
`.acdp.json` に書き込み、**MCP サーバーの再接続（`/mcp` の reconnect か Claude Code 再起動）で反映**されます。

## モード一覧

| mode | 動作 | 用途 |
|---|---|---|
| `headed`（既定） | 隔離 Chromium を可視ウィンドウで起動 | 対話利用・操作の目視 |
| `headless` | 隔離 Chromium をヘッドレス起動 | CI・バックグラウンド実行 |
| `extension` | Chrome 拡張経由で**ログイン済みの実ブラウザ**を操作 | MFA/SSO 等で隔離プロファイルでは認証できないサイト |

## 使い方

```
/acdp-mode              # 現在のモードを表示し、選択肢で切り替え
/acdp-mode headed       # 直接指定
/acdp-mode extension
/acdp-mode headless
```

## 実行内容

### 1. 現状確認

- プロジェクトルートの `.acdp.json` を読む（無ければ既定 = headed）
- `~/.acode/acdp.json`（ユーザー既定）と環境変数 `ACDP_MODE` があれば優先順位
  （`ACDP_MODE` > プロジェクト > ユーザー > headed）と合わせて報告する

### 2. モード書き込み

引数でモードが指定されていなければ `AskUserQuestion` で選択肢提示（現在のモードを明記）。
プロジェクトルートに `.acdp.json` を書く:

```json
{ "mode": "extension" }
```

extension モードの追加キー（必要時のみ）:

```json
{
  "mode": "extension",
  "extPort": 9333,        // 省略時 9333
  "headed": true          // 操作対象タブを前面化（既定: 背面のまま）
}
```

token は書かない（`~/.acode/acdp-ext-token` に自動生成・永続化される。
固定したい場合のみ環境変数 `ACDP_EXT_TOKEN`）。

### 3. extension モードの追加セットアップ案内

extension モードへ切り替えた場合は、以下を案内する（初回のみ必要）:

1. **拡張の書き出し**: `acdp extension install` を実行（`~/.acode/extension` に書き出される）
2. **拡張の読み込み**: `chrome://extensions`（Edge: `edge://extensions`）→ デベロッパーモード ON →
   「パッケージ化されていない拡張機能を読み込む」→ `~/.acode/extension` を選択
3. **ペアリング**: 拡張の「オプション」に WS URL（`ws://127.0.0.1:9333`）と
   token（`~/.acode/acdp-ext-token` の中身）を貼り付けて「保存して接続」
4. MCP 再接続後、`browser_navigate` 等が実ブラウザに対して動くことを確認

⚠️ extension モードはログイン済みブラウザを操作するため、Cookie・セッション情報が
スナップショット/スクリーンショットに含まれ得る。CI では使わないこと。

### 4. 反映

どのモードでも最後に必ず「**MCP の再接続（`/mcp` → acdp を reconnect、または Claude Code 再起動）
で反映される**」ことを伝えて終了する。設定ファイルを書いただけでは現行セッションの
バックエンドは切り替わらない。
