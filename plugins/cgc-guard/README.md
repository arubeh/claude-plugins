# cgc-guard プラグイン

> **状態: Phase 1 実装済み・スモークテスト合格、Phase 2 marketplace 登録済み v0.1.0（2026-06-11）**。本 README が仕様の単一ソース。
> 残: `/plugin install cgc-guard@arubeh-plugins` 後の実セッション検証（deny → Claude の自動是正挙動）→ acode 撤去（Phase 3）。

cgc (Code Graph Context) 連携を acode テンプレート埋め込みから外出しした Claude Code プラグイン。
2 つの自動化を提供する:

1. **編集前ゲート** — コード変更（追加・更新・削除）の前に cgc で影響範囲（blast radius）を理解していることを強制する
2. **差分インデックス自動化** — コードを改変するたびに cgc グラフへ差分を自動適用し、impact が常に新鮮なグラフを引くようにする

加えて、acode の `claudecode/rules/mcp-tools.md` に書かれていた cgc 運用ノウハウ（stale 検知・rg フォールバック・waiver・`[cgc-check]` マーカー）を SessionStart 注入ルールとスキルとして移植する。

## 決定事項（2026-06-11 確定）

| 論点 | 決定 |
|------|------|
| ゲート強度 | **deny で自動是正**（impact 未実行の Edit/Write を deny し、理由文で context+impact 実行を指示 → Claude が自動是正。ユーザーの手は止めない） |
| 差分 index 方式 | **PostToolUse トリガ + SessionStart 鮮度チェック**。ただし過去不具合（arag-memory #7: フック早期 kill）への対策を必須要件とする（下記「#7 教訓への対策」） |
| Cursor 側 | **残す**。`cursor/rules/mcp-tools.mdc` の cgc 節は維持（Cursor にプラグイン機構が無いため）。撤去は claudecode 側のみ |
| プラグイン名 | **cgc-guard** |

## 全体像

```
レイヤ              仕組み                            実装
─────────────────────────────────────────────────────────────────
MCP 提供          .mcp.json → mcp-guard.js          cgc mcp start --watch を起動
                                                     （cgc 不在/未参加 PJ は no-op）
ルール注入        SessionStart hook                  cgc 運用ルール圧縮版を additionalContext 注入
                                                     + graph 鮮度チェック（stale なら再 index 指示）
編集前ゲート      PreToolUse(Edit|Write|NotebookEdit) impact 証跡が無ければ deny + 是正指示
証跡記録          PostToolUse(mcp__cgc__context など) 「impact を見た」事実を state file に記録
差分 index        PostToolUse(Edit|Write|NotebookEdit) detached で cgc index . （debounce+lock）
外部変更追従      PostToolUse(Bash: git pull 等)      再 index + reload_graph 案内
深掘り            skills: /cgc-impact /cgc-refresh    手動の影響調査・stale 復旧
```

## ファイル構成（実装予定）

```
plugins/cgc-guard/
├── .claude-plugin/plugin.json     マニフェスト（version は marketplace.json と 2 箇所同期）
├── .mcp.json                      cgc MCP（mcp-guard.js 経由）
├── hooks/hooks.json               SessionStart / PreToolUse / PostToolUse
├── bin/                           依存ゼロ（Node 組み込みのみ）
│   ├── mcp-guard.js               cgc バイナリ・参加判定 → cgc mcp start --watch
│   ├── session-start.js           ルール注入 + graph 鮮度チェック
│   ├── pre-edit-gate.js           編集前ゲート（deny / fail-open / waiver）
│   ├── record-evidence.js         mcp__cgc__* の実行証跡を記録
│   ├── post-edit-index.js         差分 index トリガ（即時 return + detached spawn）
│   └── lib/util.js                共通（参加判定・lock・JSON 入出力）
├── skills/
│   ├── cgc-impact/SKILL.md        /cgc-impact <symbol|file>: context+impact+affected-tests → リスク報告
│   └── cgc-refresh/SKILL.md       /cgc-refresh: stale 復旧（cgc index . → reload_graph → 検証）
└── README.md                      このファイル
```

エージェントは v1 では作らない（既存の acode 側に cgc 専用エージェント実体は無く、移行対象が無い）。
大規模リファクタ前の読み取り専用 impact 調査エージェント（haiku）は v2 候補。

## 参加判定（git リポは自動参加・`.cgc-disabled` でオプトアウト）

**MCP（mcp-guard.js）**: 以下を満たすとき `cgc mcp start` へパススルーする（v0.1.1 で自動参加化）:

- `cgc` バイナリが PATH または `~/.acode/bin/` に存在する
- `.cgc-disabled` ファイルが**存在しない**（明示オプトアウト）
- `.cgc/graph.json` が存在する、**または** プロジェクトが git リポ（`.git` あり）

`.cgc/graph.json` が無くても git リポなら起動を中継する。`cgc mcp start` の起動時自動インデックスが
`.cgc/` を新規作成してグラフを構築するため、事前の `cgc index .` は不要。
非 git フォルダ（ホームディレクトリ等）は誤って丸ごとスキャンしないよう inactive（空サーバ）に倒す。
この場合の参加方法は従来どおり `cgc index .` を 1 回実行する。

**フック（gate / session-start / record-evidence / post-edit-index）**: 従来どおり
`.cgc/graph.json` の存在を参加条件とする（fail-open）。初回セッションでは MCP の自動インデックスが
graph.json を作成した時点から（フックは呼び出しごとに再判定するため）セッション途中でも有効化される。
SessionStart のルール注入だけは graph 生成前に発火し得るため初回セッションでは入らないことがあるが、
同等のポリシーは MCP の SERVER_INSTRUCTIONS が配信する。

## コンポーネント仕様

### 1. mcp-guard.js（MCP 提供）

`.mcp.json` の cgc エントリは `node ${CLAUDE_PLUGIN_ROOT}/bin/mcp-guard.js` を起動し、参加判定を通れば
`cgc mcp start --watch` へ exec/spawn パススルーする。不参加なら空応答サーバ（arag-memory の
`fix(arag-memory): MCP guard を index 有無で判定し未起動時は空サーバで接続` と同方式）。

v0.1.1: graph.json 不在でも git リポなら中継する（上記「参加判定」参照）。`cgc mcp start` は
既定で起動時に内部 `cgc index` を実行し（`--no-auto-index` で抑止可・cgc CLI 側機能）、
`.cgc/` ディレクトリ・`.cgc/.gitignore`・graph.json を自動生成するため、新規 PJ でも
Claude Code を開くだけで cgc が有効になる。

これにより init-project が生成する `.mcp.json` から cgc エントリを撤去できる（プラグインが MCP のオーナーになる。
重複登録は `360f64c`（arag の重複削除）と同じ問題を起こすため、acode 撤去フェーズで必ず消す）。

### 2. pre-edit-gate.js（編集前ゲート: deny 自動是正）

PreToolUse(Edit|Write|NotebookEdit) で発火。判定フロー (0.4.1):

```
対象 = tool_input.file_path
1. 参加判定 NG / mode=off               → allow（無言・fail-open）
2. 対象が非コード（.md/.json/.yml/.toml 等の拡張子 denylist）→ allow（waiver: ドキュメント・設定）
2b. 対象がテストファイル（tests/・*_test.*・*.test.*・*.spec.*）→ allow（#189、excludeTests=false で無効化）
3. 対象が新規ファイル（fs 不在 + Write）  → allow（既存シンボルへの影響なし。impact は参照側で取れる）
3c. 対象が graph に未インデックス（v0.4.0: graph.json の path 集合に無いと確認できる）→ allow
    （新規作成直後・未追跡ファイルの偽陽性 deny を解消。判定不能＝graph 読めない/相対パス graph/
     リポ外 のときは protective に false＝ゲート継続。詳細は下記「未インデックス waiver」）
3d. module/use 宣言だけの純粋追加（v0.4.0: 既存行を一字一句保ったまま Rust の mod/use 行のみ追加）
    → allow（既存シンボルへの影響なし＝callers=0 確定。他言語の宣言追加は従来どおり [cgc-skip]）
3e. 本番ファイル内のインラインなテスト追加（v0.4.3: 既存内容を 1 文字も変えない単一挿入で、
    挿入片が Rust `#[test]`/`#[cfg(test)]`/`#[tokio::test]`・Python `def test_`・JS/TS の
    `describe(`/`it(`/`test('...')` を含む）→ allow（excludeTests=false で無効化）。
    パス基準の 2b では捕捉できない `build.rs` 内 `#[cfg(test)] mod tests` 追記等の儀式コストを
    解消。既存内容の完全保存を必須にするため本番コード変更や呼び出し挿入は従来どおり deny。
3b. 承認済み（同一セッションで一度ゲートを通過、approvalTtlMinutes 内）→ allow（#189）
    v0.4.1: evidenceScope='dir'（既定）では承認を**ディレクトリ単位**で持続させる。
    同一 dir のどれか 1 ファイルで impact を確認すれば、その dir 内の別ファイル編集は
    approvalTtlMinutes 内は再確認不要（多ファイル改修の儀式コスト削減・#225 関連。
    git 操作による再インデックスは evidence/承認を失効させない＝直前確認は引き継がれる）。
    新しいディレクトリの初回タッチは従来どおり impact 必須。'file' で従来のファイル単位。
4. 直近の assistant メッセージに [cgc-skip reason=...] / [cgc-check] マーカー → allow
   （注: 近年のハーネスは assistant text を transcript にほぼ永続化しないため best-effort。#185）
5. 証跡あり（下記 record-evidence: TTL 内 + 対象ファイル一致 or セッションレベル一致）→ allow
5b. transcript の tool_use エントリに TTL 内の mcp cgc context/impact 実行あり → allow
   （#185 フォールバック: tool_use エントリは text と違い確実に永続化される）
6. それ以外 → deny（mode=warn / 小規模リポは allow + 注意喚起に降格）:
   permissionDecision: "deny"
   reason: 「<file> の編集前に … [reason=<理由コード> deny=N/M] …」
```

- **理由コード（#185）**: deny 文に `[reason=...]` を必ず含める。
  `MARKER_AND_EVIDENCE_MISSING`（証跡もマーカーも無い）/ `EVIDENCE_TTL_EXPIRED`（証跡が古い）/
  `EVIDENCE_FILE_MISMATCH`（新しい証跡はあるが対象ファイルに紐づかない）。無駄な再試行の試行錯誤を防ぐ。
- **無限ループ防止**: deny の是正手段（impact 実行 or `[cgc-skip]`）はどちらも次回判定で必ず allow に到達する。同一ファイルへの deny は連続 denyMax（既定 2）回まで、超過で警告付き allow に降格（フェイルセーフ）。
- **削除のゲート**: ファイル削除は Bash (`rm`/`git rm`) 経由が主。v1 では PreToolUse(Bash) に `rm|git rm` パターンマッチを追加し、対象がインデックス済みコードなら同じ証跡判定を行う（v1 スコープに含めるが、誤検知が多ければ警告注入へ降格可）。
- 証跡の一致判定 v1: **ファイルレベル一致**（証跡の paths に対象ファイルが含まれる）を優先し、無ければ **セッションレベル TTL**（直近 5 分以内に何らかの impact 実行あり）で allow。厳しすぎる場合の調整ノブとして実装する。

#### 設定: `.cgc-guard.json`（#189: ゲート強度のプロジェクト単位調整）

プロジェクトルートに置く。無ければ既定値。

```json
{
  "mode": "deny",            // "deny" | "warn"（注意喚起のみ・編集は許可）| "off"
  "excludeTests": true,       // tests/・*_test.*・*.test.*・*.spec.* をゲート対象外に
  "smallRepoWarnBytes": 131072, // graph.json がこのサイズ未満なら deny→warn に自動降格。0 で無効
  "fileTtlMinutes": 10,       // ファイルレベル証跡の有効期間
  "sessionTtlMinutes": 5,     // セッションレベル証跡の有効期間
  "approvalTtlMinutes": 60,   // 一度通過したファイルの承認持続時間
  "denyMax": 2                // 同一ファイル連続 deny 上限
}
```

caller 閾値による自動 allow（#189 提案 2）は、ゲート内から cgc を同期 spawn する
コストが PreToolUse の時間予算に合わないため見送り（将来 record-evidence が
impact 応答から callers 数を抽出して証跡に同梱する形で再検討）。

#### 未インデックス waiver（v0.4.0: graph メンバーシップ照合）

v0.3.x まで参加判定は「リポに `.cgc/graph.json` があるか」だけで、個々のファイルが
**実際に graph のノードか**は見ていなかった。そのため新規作成直後・未追跡のファイルまで
「インデックス済みの可能性」と推測して deny する偽陽性があった（オオカミ少年化 →
`[cgc-skip]` の機械的乱発 → ゲート形骸化）。v0.4.0 で graph の path 集合と照合し、
**確実に未インデックスと分かるファイルだけ** waiver する（`util.isConfirmedUnindexed`）。

- **キャッシュ**: graph.json は大きく毎フックで gunzip+parse すると PreToolUse の時間予算に
  合わないため、`(size, mtime)` をキーに正規化 path 集合を `.cgc/tmp/indexed-paths.json` へ
  キャッシュする。再 index で graph.json が更新されると stamp が変わり自動で再構築される
  （新規ファイルが index された瞬間からゲート対象に戻る＝自己修復）。
- **gzip 対応**: cgc #210+ の gzip スナップショットと旧プレーン JSON の両形式を読む。
- **安全方向（最重要）**: 判定を誤って「インデックス済みファイルを未インデックス扱い」すると
  ゲートが無効化される。これを防ぐため、次のときは **false（＝判定不能 → 従来どおりゲート継続）**
  に倒す: graph が読めない/壊れている / 空 / **project root 配下の絶対パスが 1 つも無い**
  （相対パス形式の旧 graph 等で全件 waiver する事故の防止）/ 対象がリポ外。
  waiver は「確実に未インデックス」と言い切れるときだけ発火する。

#### 宣言追加 waiver（v0.4.0: module/use の純粋追加）

既存内容を一字一句保ったまま Rust の `mod` / `use`（`pub` / `pub(crate)` 含む）宣言行だけを
足す Edit は、既存シンボルへの影響が無い（必ず callers=0）ため impact 分析が無意味。
行マルチセット差分で「既存行が全て残り、追加行が宣言行のみ」を確認できたら素通りさせる
（`util.isDeclarationOnlyAddition`）。行途中への挿入も扱えるよう substring 比較ではなく
行集合の包含で判定する。Rust 以外の言語の宣言追加・判断が必要な純粋追加は従来どおり
`[cgc-skip]` を使う（deny 文言・SessionStart ルールにも明記）。

### 3. record-evidence.js（証跡記録）

PostToolUse(matcher: `mcp__cgc__.*|mcp__plugin_.*_cgc__.*`) で発火。プラグイン経由の
MCP はツール名が `mcp__plugin_cgc-guard_cgc__*` に名前空間化されるため、素の
`mcp__cgc__*` だけにマッチする旧 matcher では一度も発火しなかった（#185 の主因）。
`tool_input`（symbol）と `tool_response` に含まれるファイルパスを抽出し、
`.cgc/tmp/evidence-<session_id>.json` に追記（TTL 10 分・最大 50 件・サイズ上限あり）。
`.cgc/tmp/` は `.cgc/.gitignore` 対象に追加する。

### 4. post-edit-index.js（差分 index 自動化）

PostToolUse(Edit|Write|NotebookEdit) で発火。**フック本体は ~50ms で即 return** し、実処理は detached 子プロセスに委譲:

```
フック本体（同期・即時）:
  参加判定 NG / 対象が非コード → exit 0
  watcher 生存 (.cgc/tmp/watcher.heartbeat が 30 秒以内) → exit 0  # v0.4.2: 二重 reindex 回避
  debounce: .cgc/tmp/index.lock の mtime が 30 秒以内 → exit 0
  lock 更新 → spawn(detached, stdio:ignore) で cgc index <project_root> → exit 0
```

**v0.4.2: 二重 reindex の回避**。`cgc mcp start --watch`（既定 ON）の内蔵 watcher が live なら、
編集 / git 変更はその watcher が増分でメモリへ反映し graph.json も更新する。よって hook の
full `cgc index` は **skip** する（graph.json の二重書き込み＝verbatim/plain の path-twin ノードの
温床を回避し、無駄な全走査も削減）。live 判定は cgc #228 で watcher が ~5s ごとに更新する
`.cgc/tmp/watcher.heartbeat` の鮮度で行う。heartbeat 不在（旧 cgc / watch 無効 / MCP 未起動）の
ときだけ従来どおり full index でカバーする（後方互換・安全側フォールバック）。

**git 由来の外部変更**: PostToolUse(Bash) で `git (pull|checkout|merge|rebase|reset)` にマッチした場合も、
watcher が live なら同様に skip（watcher が外部変更を拾う）。watcher 不在のときだけ detached index を
即時トリガし、additionalContext で「graph を更新中。次の impact 前に mcp__cgc__reload_graph を推奨」と
1 行注入する。

#### #7 教訓への対策（必須要件）

arag-memory #7（v0.2.3 で修正）: Claude Code はフックを hooks.json の timeout を待たず
**プロセスツリーごと kill することがある**。重い処理をフック内で直接やると部分書き込みが残り、
再実行が非冪等だと状態が壊れて蓄積する（実測あり）。cgc-guard では:

1. **kill 窓の排除**: フック本体は state 更新と detached spawn のみ（<100ms）。重い `cgc index` は
   フックのプロセスツリー外で走る → フック kill の影響を受けない
2. **冪等性**: `cgc index` はソースからの再導出で本質的に冪等。途中で死んでも次回実行が同じ結果に収束する
3. **バックストップ**: SessionStart 鮮度チェックが「前セッションで index が死んだ/走らなかった」ケースを
   必ず回収する（#7 の「次セッションの再実行で収束」と同じ回復経路）
4. **破損検知**: graph.json が JSON として壊れていたら（atomic write でない場合に detached index が
   OS シャットダウン等で死ぬと起こり得る）、session-start.js が検知して再 index を指示する

⚠ **要検証**: cgc が graph.json を atomic write（tmp+rename）しているか。非 atomic なら cgc 本体に
Issue を立てる（プラグイン側の破損検知は atomic でも保険として実装する）。

### 5. session-start.js（ルール注入 + 鮮度チェック）

SessionStart で発火（参加 PJ のみ）。additionalContext として注入:

1. **cgc 運用ルール圧縮版**（`claudecode/rules/mcp-tools.md` の cgc 節を ~30 行に圧縮して移植）:
   編集前 context+impact 必須 / `[cgc-check]` マーカー / waiver 3 種 / rename は `mcp__cgc__rename` /
   型参照は rg フォールバック（cgc は call graph に強く type reference に弱い）
2. **鮮度チェック結果**: graph build 時刻 vs `git log -1 --format=%ct`・graph.json の パス整合・破損検知。
   stale なら「`cgc index .` → `mcp__cgc__reload_graph` を実行してから作業開始」を注入

### 6. skills

- **/cgc-impact `<symbol|file>`** — context + impact + affected_tests を引き、リスク評価
  （LOW/MEDIUM/HIGH/CRITICAL・callers 数・影響テスト）を報告して `[cgc-check]` マーカーを出力する手動深掘り。
  型シンボルで空振りした場合の rg フォールバック手順を内包。
- **/cgc-refresh** — stale 復旧の定型: `cgc index .` → `mcp__cgc__reload_graph` →
  `list_repositories` で整合検証 → 結果報告。

## acode からの撤去（移行プラン）

**原則: プラグインの動作確認が取れてから撤去する**（撤去先行は禁止）。

### Phase 1: プラグイン実装・ローカル検証

`claude --plugin-dir <repo>/plugins/cgc-guard` で起動して検証（リポ規約どおり marketplace 非経由）。
検証項目は下記チェックリスト。

### Phase 2: marketplace 登録

`plugins/cgc-guard/.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` の version を
**2 箇所同期**で追加（v0.1.0）。

### Phase 3: acode 撤去（claudecode 側のみ・Cursor 側は残す）

| ファイル | 撤去内容 |
|---------|---------|
| `claudecode/rules/mcp-tools.md` | cgc 節（L11-110 相当）を削除し「cgc 連携は cgc-guard プラグインが提供（インストール: `/plugin marketplace add arubeh/claude-plugins`）」の 1 行ポインタへ。基本原則・acdp 節は残す |
| `CLAUDE.md` | L111「MCP ツールの優先利用」の cgc 詳細・L155/158 の cgc 手順をプラグインポインタへ縮約 |
| `init-project.sh` / `init-project.ps1` | ① 生成 CLAUDE.md テンプレ（heredoc）の cgc 節を「cgc-guard プラグイン推奨」1 行に差し替え ② `.mcp.json` マージから cgc エントリを削除（**プラグインと重複登録になるため必須**。acdp/arag の扱いは現状維持） ③ 生成 AGENTS.md テンプレの cgc 節は**残す**（Cursor 用） |
| `claudecode/workflows/fix-batch.js` `issue-batch.js` | 「cgc が有効なら編集前に impact を確認（mcp-tools）」→「（cgc-guard プラグインの注入ルールに従う）」へ文言修正 |
| `claudecode/skills/orchestrate/SKILL.md` / `rules/workflow-orchestration.md` | mcp-tools.md 参照の cgc 部分をプラグイン参照へ |
| `README.md`（acode） | 「グラフDB解析 (cgc MCP)」節をプラグインのインストール手順へ差し替え |
| **残すもの** | `cursor/rules/mcp-tools.mdc`・`AGENTS.md` の cgc 記述（Cursor 用・ユーザー決定）。`docs/arag-learning-loop-plan.md` の cgc 言及（歴史文書） |

### Phase 4: 動作確認チェックリスト

スモークテスト（フック単体に hook 入力 JSON を stdin 投入・2026-06-11 実施）で確認済み = [x]:

- [x] 未参加 PJ（`.cgc/` 無し）で全フックが無言 no-op（gate / session-start は無言。MCP は v0.1.0 時点で inactive 空サーバ応答 → v0.1.1 で git リポなら自動参加に変更）
- [ ] v0.1.1: `.cgc/` 無しの git リポで MCP 起動 → 自動インデックスで `.cgc/graph.json` が生成され cgc ツールが使える
- [ ] v0.1.1: 非 git フォルダ（`.cgc/` 無し）では MCP が inactive 空サーバ応答のまま
- [x] `.cgc-disabled` でオプトアウトできる（gate 素通り・MCP inactive）
- [x] impact 未実行のコード Edit が deny され、是正手順（context+impact → `[cgc-check]` / `[cgc-skip]`）が理由文で返る
- [x] 同一ファイル deny 3 回目でフェイルセーフ降格 allow（無限ループしない）
- [x] `.md` 編集・新規ファイル Write がゲートを素通りする
- [x] `[cgc-skip reason=...]` / `[cgc-check]` マーカー waiver が機能する（**直近 assistant メッセージのみ**有効。古いマーカーの再利用は deny）
- [x] mcp__cgc__impact の証跡記録 → 同一ファイル編集が allow（ファイルレベル一致）
- [x] 編集後に detached index が走り（stamp 更新・`last_indexed_commit` が HEAD に追随）、30 秒 debounce で多重起動しない。フック本体は即 return
- [x] graph.json 破損（truncate）検知 → 再 index 自動起動 + reload_graph 案内が注入される
- [x] meta の `last_indexed_commit` ≠ HEAD（stale）検知 → 同上
- [x] Bash `git checkout/pull` 等で debounce 無視の即時再 index + reload_graph 案内
- [x] Bash `git rm <code file>` がゲート対象、`ls` 等は素通り
- [x] 参加 PJ で mcp-guard が本物の `cgc mcp start` へパススルー（initialize 応答確認）

実セッション検証（`claude --plugin-dir` / Phase 2 前に実施）:

- [ ] deny 後、Claude が reason に従い context+impact → `[cgc-check]` → 再編集へ**自動是正**する（往復回数の確認）
- [ ] SessionStart ルール注入が実セッションの additionalContext として効いている
- [ ] hooks.json の matcher（`mcp__cgc__.*` 含む）が実セッションで発火する
- [ ] セッション強制終了後、次セッションの鮮度チェックが回収する
- [ ] acode 撤去後、init-project で生成した PJ + プラグインで一連のフローが動く（.mcp.json に cgc 重複が無い）

## 要検証 / TODO

- [ ] cgc の graph.json 書き込みが atomic（tmp+rename）か確認。非 atomic なら cgc 本体に Issue
- [ ] PreToolUse の `permissionDecision: deny` 後、Claude が reason に従って自動是正する実機挙動の確認
- [ ] `mcp__cgc__impact` の tool_response からファイルパス一覧を安定抽出できるか（証跡のファイルレベル一致の成立性）
- [ ] 大規模リポでの `cgc index .` 所要時間 → debounce 30 秒の妥当性調整
- [ ] Bash 削除ゲート（`rm|git rm`）の誤検知率 → 高ければ警告注入へ降格
- [ ] `[cgc-check]` マーカーの transcript 監査が引き続き成立するか（ルール注入版でもマーカー規約は維持）
