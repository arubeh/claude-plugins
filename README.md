# claude-plugins

arubeh の **Claude Code プラグイン marketplace**（クローズド配布）。
リポジトリ自身が marketplace を兼ねる（`.claude-plugin/marketplace.json`）。**このリポに read 権限がある人だけ**が追加・インストールできる＝公開 marketplace には載せないクローズド配布。

## 収録プラグイン

| プラグイン | 説明 |
|-----------|------|
| [`arag-memory`](plugins/arag-memory/) | arag を記憶バックエンドにした Claude Code 継続学習ループ。recall/capture を二層（フック＋MCP）で行い、汎用知識は全PJ共通 global へ自動昇格。インストール=オプトイン・未参加PJでは no-op。 |

---

## インストール方法 A：プライベート marketplace（GitHub 権限あり）

1. （初回のみ）GitHub 認証。プライベートリポへのアクセスに必要:

   ```bash
   gh auth login        # HTTPS / Login with a web browser
   gh auth status       # 認証確認
   ```

2. Claude Code で marketplace を追加 → プラグインをインストール（`/plugin` はスラッシュコマンド）:

   ```
   /plugin marketplace add arubeh/claude-plugins
   /plugin install arag-memory@claude-plugins
   ```

   - marketplace 名 `claude-plugins` は `marketplace.json` の `name`。プラグインは `arag-memory@claude-plugins` で参照。
   - 無効化は `/plugin disable arag-memory@claude-plugins`、削除は `/plugin uninstall arag-memory@claude-plugins`。

3. 更新:

   ```
   /plugin marketplace update claude-plugins
   ```

> **プライベートリポの自動更新**: バックグラウンド更新を効かせる場合は環境変数 `GITHUB_TOKEN`（または `GH_TOKEN`）を設定する（対話プロンプトをブロックしないため）。

---

## インストール方法 B：ZIP 配布（GitHub 権限なし）

GitHub にアクセスできない相手へは ZIP で配れる。`/plugin marketplace add` は **ローカルパスも受け付ける**ため、解凍したフォルダをそのまま marketplace として登録できる。

### 配布する側（ZIP を作る）

リポジトリのルートで、追跡ファイルだけをクリーンに固める:

```bash
git archive --format=zip --prefix=claude-plugins/ -o claude-plugins.zip HEAD
```

`git archive` なら `.gitignore` 対象や `.arag/` ストア等が混入せず、`HEAD` の追跡ファイルだけが入る。`--prefix` で解凍時に `claude-plugins/` フォルダができる。生成した `claude-plugins.zip` を渡す。

### 受け取る側（GitHub 不要）

```
# 1. ZIP を任意の「永続フォルダ」に解凍（例: ~/claude-plugins）
# 2. Claude Code で：
/plugin marketplace add ~/claude-plugins
/plugin install arag-memory@claude-plugins
```

### ZIP 配布の注意点

- **解凍先を消さない／動かさない**: marketplace はパス参照で登録されるため、フォルダを移動・削除すると壊れる。
- **`/plugin marketplace update` は効かない**: git remote が無いので自動更新不可。更新時は新しい ZIP を再配布し、`/plugin marketplace remove claude-plugins` → 再 `add` する。
- **`arag` バイナリ本体は別**: `arag-memory` は `arag 0.6.0+` が PATH（または `~/.acode/bin/arag`）にある前提。ZIP にはプラグインだけで arag 実体は入らないので別途用意が必要。

---

## ローカル開発（配布せず手元で試す）

marketplace を経由せず、プラグインディレクトリを直接読み込む:

```bash
claude --plugin-dir /path/to/claude-plugins/plugins/arag-memory
```

---

## arag-memory の使い方

プラグインごとの詳細は各 README を参照:

- [plugins/arag-memory/README.md](plugins/arag-memory/README.md) — できること・前提・スキル一覧
