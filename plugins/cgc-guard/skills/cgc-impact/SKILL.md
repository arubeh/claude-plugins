---
name: cgc-impact
description: cgc でシンボル/ファイルの影響範囲（blast radius）を深掘りする。context + impact + affected_tests を引いてリスク評価（LOW〜CRITICAL・callers 数・影響テスト）を報告し、[cgc-check] マーカーを出力する。大きめの変更前・リファクタ前・「この関数を変えたら何が壊れるか」を問われた場面で使う。
---

# cgc-impact — 影響範囲の深掘り

cgc-guard の編集前ゲートが要求する「影響理解」を定型化した手動深掘りスキル。
引数: `<symbol>`（関数/クラス名）または `<file>`（その場合は主要シンボルを特定してから実行）。

## 手順

1. **シンボル特定**: 引数がファイルパスなら `mcp__cgc__find_code` / Read で変更対象のシンボル名を特定する
2. **全景**: `mcp__cgc__context(<symbol>)` — 定義・型・周辺コード
3. **影響**: `mcp__cgc__impact(<symbol>)` — 呼び出し元・呼び出し先・関連テスト・リスクレベル
4. **テスト**: `mcp__cgc__affected_tests(<symbol>)` — 変更後に回すべきテスト
5. **型シンボルの空振り対策**: callers が不自然に少ない/0 件、または対象が型（class/struct/interface/enum/trait）なら
   `rg "\b<Symbol>\b"` で参照位置を確認し、結果を risk 評価に反映する（cgc は type reference に弱い）
6. **報告**: 以下を簡潔に出力する

```
[cgc-check] symbol=<name> risk=<LOW|MEDIUM|HIGH|CRITICAL> callers=<N>
- 影響範囲: <呼び出し元の要約（モジュール単位）>
- 影響テスト: <affected_tests の結果>
- 注意点: <壊れやすい箇所・rg フォールバックで見つけた型参照など>
```

## 注意

- `[cgc-check]` マーカーは省略しない（編集前ゲートの allow 条件・監査証跡）
- context の返す path が現存しない（stale graph）場合は `/cgc-refresh` を先に実行する
- リネームを行う場合は grep+sed ではなく `mcp__cgc__rename` を使う
