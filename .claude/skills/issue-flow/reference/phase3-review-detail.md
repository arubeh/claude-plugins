# issue-flow 参照: Phase 3 レビュー詳細

SKILL.md の Phase 3 から参照される。reviewer の出力契約（SARIF サブセット）・判定 UI・`--auto-fix` の完全仕様。
**Phase 3 を実行する段階で読む**（Phase 1/2 では不要）。

## 指摘の構造化ブロック (SARIF サブセット)

各 reviewer はレポート末尾に以下のフェンス付きブロックを必ず 1 個出力する。親エージェント (issue-flow) はこれを集約して `--auto-fix` 判定とユーザー提示の整形に使う。

````
```findings
{
  "tool": "<reviewer-name>",
  "result": "PASS|FAIL|SKIP|SECURE|VULNERABLE|CLEAN|NEEDS_CLEANUP",
  "findings": [
    {
      "ruleId": "<short-stable-id>",
      "level": "error|warning|note",
      "locations": [{"file": "<path>", "startLine": <int>, "endLine": <int>}],
      "message": "<指摘内容を 1-2 行で>",
      "suggested_patch": "<該当時のみ。unified diff 形式の最小 patch>"
    }
  ]
}
```
````

**severity 対応** (各 reviewer 既存の語彙との互換マッピング):

| reviewer 内部表記 | SARIF `level` | auto-fix 候補 |
|------------------|--------------|--------------|
| CRITICAL / VULNERABLE 該当 | `error` | ✓ |
| HIGH / NEEDS_CLEANUP 該当 | `warning` | ✗ (提示のみ) |
| MEDIUM / 改善提案 | `note` | ✗ (提示のみ) |

**`ruleId` の指針**: reviewer 名 + 観点で短く安定したキー (例: `security/sql-injection`, `quality/function-too-long`, `test/missing-coverage`)。同じ問題には同じ ID を付け、再レビュー時に dedupe 可能にする。

**`suggested_patch` の指針**: 自明で局所的な修正のみ記載。アーキテクチャ判断や設計変更を伴うものは記載せず `message` の説明に留める。

## 判定とユーザー提示

- 全 reviewer の `result` が PASS / SECURE / CLEAN → ユーザー確認後 Phase 4 へ
- いずれか FAIL / VULNERABLE → 集約した findings を severity 順 (`error` → `warning` → `note`) で提示し、ユーザーに方針を選ばせる:

```
■ Phase 3 レビュー結果

  error   3件 (security/sql-injection, quality/function-too-long ×2)
  warning 5件
  note    2件

  対応方針:
  [m] 手動で修正する (推奨)
  [a] error のみ自動修正を試行 (--auto-fix 1-shot)
  [i] 一部の指摘を無視して PR 作成
  [s] 後回しにして別 Issue 化
```

- database-reviewer SKIP → DB変更なし（正常、findings ブロックは空配列で出力）

## `--auto-fix` (オプトイン・1-shot・suggest/apply 分離)

**前提**: AI reviewer の指摘には客観 oracle がない (build error と異なる category) ため、自動ループは原則禁止。`--auto-fix` は明示オプトインの **1 回限り** の試行として提供する。

**起動条件** (全て満たす場合のみ):
- ユーザーが `[a]` を選択した、または `/issue-flow --auto-fix #N` で起動された
- 対象 findings の `level == "error"` のみ (warning/note は対象外)
- `suggested_patch` が存在する findings、または auto-fix 可能と reviewer が明示した findings

**実行フロー**:

1. **patch 生成**: tdd-guide を fix モードで起動。渡すデータ = 対象 findings 配列、変更対象ファイルリスト、ブランチ名。tdd-guide は `suggested_patch` を起点に修正を生成する (RED→GREEN フェーズはスキップ、既存テストを green に保つことのみ要求)
2. **post-fix 検証**: 修正後に build / lint / test を実行 (objective oracle)。失敗時は patch を破棄し findings をユーザーに戻す
3. **diff 提示**: 検証パス時は `git diff --staged` を提示し、ユーザーに `[y] apply / [n] discard / [e] edit` を選ばせる
4. **apply**: ユーザー承認時のみコミット候補としてステージング維持。それ以外は `git restore --staged --worktree` で破棄

**重要な制約**:
- **再レビューはユーザー指示時のみ**: auto-fix 後に reviewer を自動再走しない (修正版への新規 hallucinated 指摘でユーザー戻し品質が下がるため)。`/issue-flow --re-review` で明示再走可能
- **2 回目の auto-fix は禁止**: 1 回失敗したら必ずユーザーに戻す。多段ループ化しない
- **対象 reviewer の限定**: code-quality / security / refactor-checker のみ。test-verifier の FAIL は実コードの不具合なので tdd-guide 通常モードに戻す。database-reviewer の FAIL は破壊的変更を含む可能性が高いため対象外
