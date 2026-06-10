---
name: e2e
description: E2Eテストを生成・実行する。Playwright, Cypress, Selenium 等を自動検出し、ユーザージャーニーをテストする。Use when user asks for E2E or /e2e.
---

# E2E スキル

E2Eテストの生成・保守・実行。プロジェクトに適したE2Eフレームワークを自動検出する（Playwright, Cypress, Selenium 等）。

## 使い方

```
/e2e
/e2e ログインフロー
```

## 実行内容

1. テストジャーニー生成（ユーザーフロー用のE2Eテスト作成）
2. E2Eテスト実行（プロジェクトのフレームワークで実行）
3. 失敗時のアーティファクト取得（ログ、スクリーンショット等）
4. レポート生成・不安定テストの特定

## ベストプラクティス

- クリティカルなユーザージャーニーをテスト
- レスポンス/イベントの完了を待機（固定タイムアウトでなく）
- 振る舞いをテスト（実装詳細でなく）
- Web UI: Page Object Model、`data-testid` のセレクター推奨
- API: リクエスト/レスポンススキーマ検証、認証フロー含む

## クイックコマンド例

**Playwright:** `npx playwright test` / `npx playwright test --headed` / `npx playwright show-report`  
**Cypress:** `npx cypress run` / `npx cypress open`
