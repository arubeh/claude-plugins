# Git & GitHub ワークフロー

## 基本原則

**1 Issue = 1 ブランチ = 1 PR**

## 開発フロー

```
/issue-create → 3並列事前チェック → 重複なければ作成

/issue-flow #123

Phase 1: 分析+計画 ──── ★3+1並列★
  ├─ issue-analyzer      Issue取得・要件抽出
  ├─ Explore             コードベース調査
  └─ planner             実装計画+依存グラフ
  → architect-reviewer   アーキテクチャ適合性
  ▼ ユーザー確認①

Phase 2: 実装 ──── ★レベル並列★
  └─ tdd-guide           RED → GREEN → REFACTOR

Phase 3: レビュー ── ★最大5並列★
  ├─ code-quality-reviewer  品質
  ├─ security-reviewer      セキュリティ
  ├─ test-verifier          テスト・カバレッジ
  ├─ database-reviewer      DB変更（該当時のみ）
  └─ refactor-checker       不要コード
  ▼ ユーザー確認②

Phase 4: デリバリー
  ├─ doc-updater            ドキュメント更新
  ├─ git commit
  └─ pr-creator             push + PR作成 (Closes #123)
```

---

## ブランチ命名

```
<type>/#<issue番号>-<短い説明>
```

| ラベル | プレフィックス |
|--------|--------------|
| enhancement, feature | `feat/` |
| bug | `fix/` |
| documentation | `docs/` |
| refactor | `refactor/` |
| test | `test/` |
| ラベルなし | `feat/` |

例:
```
feat/#123-add-user-auth
fix/#456-login-error
docs/#789-api-reference
```

---

## コミットメッセージ

```
<type>(#<issue>): <説明>
```

| type | 用途 |
|------|------|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `docs` | ドキュメント |
| `test` | テスト |
| `refactor` | リファクタリング |
| `perf` | パフォーマンス改善 |
| `chore` | 雑務 |
| `ci` | CI/CD |

例:
```bash
feat(#123): ユーザー認証機能を追加
fix(#456): ログインエラーを修正
test(#123): 認証テストを追加
```

複数コミット時は `Refs #123` を本文に含める。

---

## PR 規約

### タイトル
```
<type>(#<issue>): <説明>   ← 70文字以内
```

### 本文テンプレート
```markdown
## Summary
- <変更点>

Closes #<issue番号>

## Test plan
- [ ] 単体テスト通過
- [ ] カバレッジ 80%以上
- [ ] ビルド成功
- [ ] コードレビュー APPROVE
- [ ] セキュリティレビュー SECURE
```

### 必須要素
- `Closes #<issue>` を本文に含める（マージ時に Issue 自動クローズ）
- テストプランを記載

### マージ戦略
- **Squash merge**（推奨） — `gh pr merge <number> --squash`
