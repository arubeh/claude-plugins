# issue-flow 参照: 複数 Issue 並列モード（worktree）

`/issue-flow` で複数 Issue を指定したときの worktree 並列実行の詳細。SKILL.md の Phase 0 / Phase 4 / 注意事項から参照される。
**単一 Issue モードでは本ファイルの内容は不要**（worktree を使わず cwd で実行）。

## モード切替の条件

| 起動形式 | モード |
|---------|--------|
| `/issue-flow #41` | 単一モード（worktree なし、cwd で実行） |
| `/issue-flow #41 #42 #43` | 並列モード（各 Issue が worktree） |
| `/issue-flow --all-open` | 並列モード（open Issue 全部） |
| `/issue-flow --parallel=N #41 #42 ...` | 並列モード（並列度 N に制限） |

## 大規模並列の委譲フック（上乗せ・既定挙動は不変）

複数 Issue モードは Workflow の才能（多数の独立サブタスクの大規模ファンアウト）が活きる入口。**素朴 worktree 並列（本ファイル）と `/orchestrate`(Workflow) の線引き**は次のとおり:

| 対象 Issue 数 | 使うもの |
|--------------|---------|
| **概ね 10 件未満** | 本ファイルの素朴 worktree 並列（既定並列度 5）。軽量・低コスト |
| **概ね 10 件以上**（`--all-open` で大量にヒット等） | 定義済み workflow **`issue-batch`** への委譲を**推奨第1候補で提案**（`AskUserQuestion`）。承認後 `/orchestrate issue-batch` で起動し `{issues: [{number, title, body}], base}` を渡す。plan→実装+PR を `pipeline()` でバリアなく流し、各 Issue は別 worktree（別ブランチ・別 PR）で並列処理する |

判定は Step A のブランチ名決定前に対象 Issue 数で自動的に行う。`.claude/rules/workflow-orchestration.md` の**判定基準**（数十の独立サブタスク）に準拠。委譲には Workflow のオプトインが必要なため、ユーザー承認のうえ起動する。**閾値未満なら従来どおり下記の素朴並列のまま**。

> Workflow に委譲した場合も worktree は同じ `.claude/worktrees/` 配下（`agent-<id>/`）に集約されるため、Phase 0 の自動掃除規約はそのまま効く。

## 実行フロー

```
Step A: 事前準備
  ├─ 各 Issue のブランチ名を決定（issue-analyzer を並列起動）
  ├─ git worktree add .claude/worktrees/<branch-name> -b <branch> main
  └─ 並列度ゲート（既定 5、--parallel=N で調整）

Step B: Phase 1 並列（全 Issue）
  ├─ 各 worktree で 3並列 agent 群 → architect-reviewer（条件付き）
  └─ ユーザー確認（★バッチ UI★ 一覧で承認/却下）

Step C: Phase 2 並列（承認済み Issue のみ）
  └─ 各 worktree で tdd-guide（level 並列）を実行

Step D: Phase 3 並列
  └─ 各 worktree でレビュー agent 群 → バッチ提示 → 承認

Step E: Phase 4 並列
  └─ 各 worktree で doc-updater → commit → pr-creator

Step F: クリーンアップ & レポート
  ├─ 成功 PR を最大 5 分 polling (30s × 10)
  │   ├─ MERGED 検出 → git worktree remove
  │   └─ timeout → worktree 残す（次回起動時 Phase 0 で自動掃除）
  ├─ Phase 4 失敗: worktree 残存（調査用パスを報告）
  └─ PR URL 一覧と失敗 Issue 一覧を出力
```

## worktree 管理

- **配置**: リポジトリ内 `.claude/worktrees/`。issue-flow 並列モードは `.claude/worktrees/<branch-name>/` (例: `fix/#190-...`) に配置。Claude Code ランタイムの `Agent({ isolation: "worktree" })` は `.claude/worktrees/agent-<id>/` (auto-prefix) に配置するため、**両系統とも同じ親 dir 配下** に集まり Phase 0 で一括掃除できる
- **作成**: `git worktree add .claude/worktrees/<branch> -b <branch> main`（main 最新を起点に切る）
- **削除タイミング = PR マージ後** (PR 作成のみでは削除しない、レビュー指摘の fixup を支援するため)
  - **Phase 4 末尾の polling**: PR 作成成功後、最大 5 分 (30s × 10) `gh pr view <N> --json state -q .state` を polling し `MERGED` を検出したら locked であれば `git worktree unlock` 後 `git worktree remove --force <path>` + `git branch -D <branch>`。timeout は worktree 残す
  - **Phase 0 の自動掃除**: 起動時に `git worktree list --porcelain` を取り、各 worktree のブランチ → `gh pr list --head <branch> --state merged` で MERGED PR があれば unlock + remove --force + branch -D (前回 timeout 分 / 手動マージ / 他スキル生成の `agent-*` 後始末)
  - **Phase 4 失敗 / PR 作成失敗 / マージされなかった (closed) PR**: worktree 残してユーザーに報告
- **`.gitignore`**: `.claude/worktrees/` 配下の **worktree 内容を git に取り込まないこと**。`.claude/worktrees/.gitignore` に `*` (および `!.gitignore`) を置いて配下を全て ignore する運用 (skeleton 自体は repo に残す)。起動時に `.claude/worktrees/.gitignore` が無ければ警告
- **再開時の再利用**: Phase 0 再開検出で worktree が残っていればそれを使い、なければ再作成

## Phase 0: マージ済み worktree 自動掃除 (毎起動時、無条件)

`/issue-flow` を起動するたびに最初に実行する。前回 Phase 4 で polling timeout になった分、別経路でマージされた worktree、および **他スキル / Agent isolation (`Agent({ isolation: "worktree" })`) 経由で `.claude/worktrees/agent-*` 配下に作られた worktree** も含めて回収する。

**重要 — locked 対応**: Claude Code ランタイムは agent isolation worktree を `claude agent <id>` の理由で `git worktree lock` する。`git worktree remove --force` だけでは locked を貫通できないため、**`git worktree unlock` を先に呼んでから `--force` で remove** する 2 段構え必須。

```bash
git worktree list --porcelain | awk '
  BEGIN { RS=""; FS="\n" }
  {
    path=""; branch=""; locked=0
    for (i=1; i<=NF; i++) {
      if ($i ~ /^worktree /)              { path = substr($i, 10) }
      else if ($i ~ /^branch refs\/heads\//) { branch = substr($i, 19) }
      else if ($i ~ /^locked/)            { locked = 1 }
    }
    if (path && branch) print path "\t" branch "\t" locked
  }
' | while IFS=$'\t' read -r path branch locked; do
  # main checkout や `.claude/worktrees/` `.cursor/worktrees/` 配下以外は対象外
  case "$path" in
    *.claude/worktrees/*|*.cursor/worktrees/*) ;;
    *) continue ;;
  esac
  if gh pr list --head "$branch" --state merged --json number -q '.[0].number' 2>/dev/null | grep -q .; then
    # locked (Claude Code agent isolation) の場合は先に unlock
    [ "$locked" = "1" ] && git worktree unlock "$path" 2>/dev/null
    if git worktree remove --force "$path" 2>/dev/null; then
      echo "cleaned: $path (merged: $branch)"
      # ローカルブランチも削除 (リモートは PR merge 時に自動削除済の前提)
      git branch -D "$branch" 2>/dev/null || true
    fi
  fi
done
```

掃除結果は冒頭で `N 件のマージ済み worktree を掃除しました` 形式で簡潔に報告。0 件なら無報告。

**スコープ**: `.claude/worktrees/<branch-name>/` (issue-flow 並列モードが作成) と `.claude/worktrees/agent-<id>/` (Agent isolation が作成) の **両方** を対象とする。後者は他スキル (例: `/fix-impl` の並列 fix-impl agent) や `Agent({ isolation: "worktree" })` 経由で生成され、Claude Code ランタイム側では「変更ありなら自動削除しない」設計のため `/issue-flow` 起動時にまとめて回収する責務を本スキルが負う。

## 並列度の既定値

- 既定: **5 Issue 同時実行**（`--parallel=N` で 1〜10 の範囲で上書き）
- 2〜3 より少ないと並列化の意味が薄い。10 を超えると CPU/メモリ/ディスク逼迫

## ビルドキャッシュ共有（強く推奨）

worktree 毎にフルビルドが走ると並列化の効果が大幅に削がれるため、言語に応じて共有を推奨:

| 言語 | 推奨設定 |
|------|---------|
| Rust | `CARGO_TARGET_DIR=<parent-repo>/target` を各 worktree の env で統一 |
| Node (pnpm) | 自動共有（global store）、追加設定不要 |
| Node (npm/yarn) | 親リポの `node_modules` を symlink するか pnpm 移行を検討 |
| Python (uv) | global cache を使うため自動共有 |
| Python (poetry/pip) | 親の `.venv` を共有（activate パス調整） |

キャッシュ共有が未設定のまま並列モード起動を検出した場合、警告してユーザー判断に委ねる。

## ユーザー確認のバッチ UI

Phase 1 完了後、全 Issue の結果を 1 枚に集約して承認を取る:

```
■ Phase 1 結果サマリ（5 Issue）

  #41 ✓ PASS   UndoStack         / 5 ステップ, 3 レベル
  #42 ✓ PASS   Spring animation  / 4 ステップ, 2 レベル
  #43 ⚠ 指摘   InterpolatedColor / architect 指摘 1 件
  #44 ✓ PASS   decompile         / 7 ステップ, 4 レベル
  #45 ✗ FAIL   asset_manage      / 依存グラフ矛盾

  Phase 2 に進める Issue を選択:
  [a] 全承認   [s] 承認済のみ進行   [1] 個別選択   [q] 中止
```

Phase 3 完了後も同形式で PR 作成承認を取る。単一モード（1 Issue）は従来通り個別確認。

## 失敗時の独立性

- **Phase 1 失敗**（architect FAIL 等）: 該当 Issue はスキップ、他 Issue は続行
- **Phase 2 失敗**（TDD/build error）: リトライ 2 回、駄目なら worktree 残して失敗報告、他 Issue は続行
- **Phase 3 失敗**（reviewer FAIL）: 該当 Issue は Phase 4 スキップ、worktree 残す
- **Phase 4 失敗**（PR 作成失敗）: worktree 残してエラー出力

失敗 Issue の再開は単一モード `/issue-flow #<number>` で個別に行う。残っている worktree があれば Phase 0 再開検出が cwd をそこに切り替えて復旧する。

## チェックポイントの衝突

各 Issue の GitHub コメントは独立しているため、並列モードでも書き込み競合なし。`branch=` フィールドに worktree 内ブランチ名を記録するので、単一/並列どちらのモードで再開しても同じブランチで復旧できる。

## Phase 4 Step 4-4: PR マージ待ち polling (並列モードのみ)

worktree が `.claude/worktrees/<branch>/` 配下にある場合のみ実行 (単一モードの cwd は対象外)。

```bash
PR_NUM=<作成された PR 番号>
WT_PATH=<該当 worktree のパス>
BRANCH=<該当ブランチ名>
for i in $(seq 1 10); do
  state=$(gh pr view "$PR_NUM" --json state -q .state 2>/dev/null)
  if [ "$state" = "MERGED" ]; then
    # locked (Claude Code agent isolation) なら先に unlock
    git worktree unlock "$WT_PATH" 2>/dev/null
    git worktree remove --force "$WT_PATH" \
      && git branch -D "$BRANCH" 2>/dev/null \
      && echo "merged & cleaned: $WT_PATH (branch=$BRANCH)"
    break
  fi
  if [ "$state" = "CLOSED" ]; then
    echo "closed without merge: keep worktree at $WT_PATH"
    break
  fi
  sleep 30
done
# timeout (state がまだ OPEN) → worktree 残す。次回起動時 Phase 0 が回収する
```

**設計理由**:
- レビューで fixup commit が必要になっても worktree が残っているので即座に追加 push 可能
- 5 分以内に merge される PR (squash merge を即座に実行する典型ケース) は即時クリーンアップされる
- 5 分超のものは Phase 0 の自動掃除で回収されるためゴミは溜まらない

## 並列モード限定の注意事項

- **`.claude/worktrees/.gitignore` に `*` (および必要なら `!.gitignore`) が置かれていること** を起動時に確認 (未配置なら警告)。`.cursor/worktrees/` を併用するプロジェクトでは同様の skeleton を `.cursor/worktrees/` 側にも配置
- **ビルドキャッシュ共有** の設定を事前に検討（Rust の `CARGO_TARGET_DIR` 等）。未設定だと並列化の効果が大幅に減る
- 既定並列度 5、`--parallel=N` で 1〜10 の範囲で上書き可能
- 並列実行中に 1 Issue が落ちても他は続行、失敗 Issue の worktree は残す
- worktree のクリーンアップは **2 段防御**: (1) Phase 4 末尾で PR を最大 5 分 polling し MERGED 検出時に削除 (2) 次回 `/issue-flow` 起動時の Phase 0 で `gh pr list --head <branch> --state merged` を再チェックして自動削除。手動マージや polling timeout 分も次回起動時に回収される
- 想定外で残った worktree は `git worktree list` で確認し、不要なら `git worktree remove --force <path>` で手動削除
