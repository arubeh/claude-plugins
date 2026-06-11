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

PreToolUse(Edit|Write|NotebookEdit) で発火。判定フロー:

```
対象 = tool_input.file_path
1. 参加判定 NG                          → allow（無言・fail-open）
2. 対象が非コード（.md/.json/.yml/.toml 等の拡張子 denylist）→ allow（waiver: ドキュメント・設定）
3. 対象が新規ファイル（fs 不在 + Write）  → allow（既存シンボルへの影響なし。impact は参照側で取れる）
4. 直近の assistant メッセージに [cgc-skip reason=...] マーカー → allow（明示 waiver: typo/コメント/フォーマット）
5. 証跡あり（下記 record-evidence: TTL 内 + 対象ファイル一致 or セッションレベル一致）→ allow
6. それ以外 → deny:
   permissionDecision: "deny"
   reason: 「<file> の編集前に mcp__cgc__context(<推定symbol>) と mcp__cgc__impact を実行し、
           [cgc-check] symbol=... risk=... callers=N を出力してから再実行してください。
           軽微変更（typo/コメント/フォーマット）なら [cgc-skip reason=...] を出力して再実行。」
```

- **無限ループ防止**: deny の是正手段（impact 実行 or `[cgc-skip]`）はどちらも次回判定で必ず allow に到達する。同一ファイルへの deny は連続 2 回まで、3 回目は警告付き allow に降格（フェイルセーフ）。
- **削除のゲート**: ファイル削除は Bash (`rm`/`git rm`) 経由が主。v1 では PreToolUse(Bash) に `rm|git rm` パターンマッチを追加し、対象がインデックス済みコードなら同じ証跡判定を行う（v1 スコープに含めるが、誤検知が多ければ警告注入へ降格可）。
- 証跡の一致判定 v1: **ファイルレベル一致**（証跡の paths に対象ファイルが含まれる）を優先し、無ければ **セッションレベル TTL**（直近 5 分以内に何らかの impact 実行あり）で allow。厳しすぎる場合の調整ノブとして実装する。

### 3. record-evidence.js（証跡記録）

PostToolUse(matcher: `mcp__cgc__context|mcp__cgc__impact|mcp__cgc__reload_graph`) で発火。
`tool_input`（symbol）と `tool_response` に含まれるファイルパスを抽出し、
`.cgc/tmp/evidence-<session_id>.json` に追記（TTL 10 分・最大 50 件・サイズ上限あり）。
`.cgc/tmp/` は `.cgc/.gitignore` 対象に追加する。

### 4. post-edit-index.js（差分 index 自動化）

PostToolUse(Edit|Write|NotebookEdit) で発火。**フック本体は ~50ms で即 return** し、実処理は detached 子プロセスに委譲:

```
フック本体（同期・即時）:
  参加判定 NG / 対象が非コード → exit 0
  debounce: .cgc/tmp/index.lock の mtime が 30 秒以内 → exit 0
  lock 更新 → spawn(detached, stdio:ignore) で cgc index <project_root> → exit 0
```

`cgc mcp start --watch` が動いていれば watch と二重になるが、`cgc index` は増分・冪等なので無害
（同時実行は lock で 1 本に制限）。watch が拾えない大規模レイアウト変更・MCP 未起動時のカバーが主目的。

**git 由来の外部変更**: PostToolUse(Bash) で `git (pull|checkout|merge|rebase|reset)` にマッチしたら
同じ detached index を即時トリガし、additionalContext で「graph を更新中。次の impact 前に
mcp__cgc__reload_graph を推奨」と 1 行注入する。

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
