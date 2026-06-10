---
name: arag-capture
description: arag 学習ループの capture（知識を記憶に残す）作法。会話中に「決定/教訓/ドメイン/原因究明/方針」に当たる知識が出たとき、何を・どの scope/confidence で下書きするか、秘密の除外、global 自動昇格の条件を定める。capture すべき知識が発生したら明示コマンドが無くても本スキルに従って下書きする。
---

# arag-capture — 知識を記憶に残す

arag を記憶バックエンドにした学習ループの**出口**。会話中に得た知識を下書きし、SessionEnd フックがまとめて arag へ書き込む（あなたは下書きだけ・書き込みは自動）。設計根拠は `docs/arag-learning-loop-plan.md`（§1.5 / §1.6⑤）。

## いつ下書きするか（capture 基準）

次の 5 種に当たる知識が出たら、その場で 1 項目ずつ下書きする：

| type | 何を書くか |
|------|-----------|
| `decision` | なぜこの技術/方式を選んだか、却下案と理由 |
| `lesson` | やって分かった罠・「次はこうする」 |
| `domain` | 自社固有ルール・ドメイン知識（AI が知らない事実） |
| `postmortem` | バグの根本原因と直し方 |
| `feedback` | ユーザーが示した方針・好み・優先度 |

## 書かないもの（arag を汚す）

- 雑談・あいさつ・相づち / ツールの生出力・ログ・コマンド結果
- コードそのもの（cgc の担当） / 一時的な作業手順・途中メモ
- 捨てた失敗そのもの（ただし「なぜ失敗したか」は `lesson` として残す）

## 秘密情報

API キー・トークン・パスワード・`.env` の値・個人情報は**書かない**。`capture-draft.js` 側でもスクラブするが、まず人が入れないこと（多層防御・security と同原則）。

## scope と confidence（global 昇格を左右する）

- `scope`: `project`（このリポでしか通じない実装・設定名・構造）か `org`（**別のリポジトリでも同じ判断をするか？→Yes** な汎用知識）。**迷ったら `project`**。
- `confidence`: `known`（確実）/ `inferred`（推論）/ `uncertain`（不確実）。
- **`scope=org` かつ `confidence=known`** の項目だけ、SessionEnd で全PJ統一の global へ**自動昇格**される（色付き通知あり）。確信が無ければ `project` か confidence を下げて local に留める。

## 下書きの仕方

1 項目ごとに JSON を `capture-draft.js` に渡す（Bash 経由）：

```bash
echo '{"type":"decision","title":"短い見出し","body":"なぜ/却下案/根拠を数行","scope":"org","confidence":"known","source":"#123","date":"2026-06-09","slug":"linkXxx"}' \
  | node "${CLAUDE_PLUGIN_ROOT}/bin/capture-draft.js"
```

- `title` 必須。`date` は今日の日付、`source` は issue/pr があれば。
- 関連づけたい知識群には共通の **`slug`**（英字主体・単一トークン・2〜24字）を付ける（共起グラフで束ねられる）。
- 実際の arag 書き込み・global 昇格・graph 更新は **SessionEnd が自動**で行う。毎ターン書かない。

## 注意

- 未参加 PJ（`./.arag/` 無し or `.arag-disabled`）では下書きは no-op になる。
- 誤って覚えた/昇格した知識は `/feedback` から `status=retracted` で撤回する（hard delete しない）。
