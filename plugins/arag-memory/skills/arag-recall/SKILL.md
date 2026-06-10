---
name: arag-recall
description: arag からの深掘り recall（過去の決定・教訓・ドメイン知識を思い出す）。フックの安価な bm25 シード recall では足りないとき、計画前・調査時に MCP arag で意味検索して文脈を補う。Phase/skill の冒頭や「過去どうしたか」を要する場面で使う。
---

# arag-recall — 過去の記憶を深掘りする

arag 学習ループの**入口（任意層・§1.8）**。フック（SessionStart/UserPromptSubmit）が安価な bm25 シードを自動注入するが、**深い意味検索はモデルが MCP で行う**。設計根拠は `docs/arag-learning-loop-plan.md`（§1.7 / §1.8 / §1.6⑤）。

## いつ使うか

- 計画前（実装方針を決める前）に「過去に同種の決定/教訓があったか」を確認したいとき
- 調査中に「なぜ今こうなっているか（過去の根拠）」を知りたいとき
- フックのシード recall に出た断片を、もっと広く深く辿りたいとき

## やり方（MCP・warm で速い）

local（このPJ）と global（全社共通）の両方を引く（§1.6⑤ 両引き）：

1. `mcp__arag__search` / `mcp__arag__ask` … このPJの `./.arag/`（local）
2. `mcp__arag_global__search` / `mcp__arag_global__ask` … 全PJ統一の `_global`（汎用知識）

- まず local を見て、足りなければ global で補完。
- **回答には必ず出典を添える**（どの doc/source 由来か）。古い決定を自信満々に再利用しない（`status=superseded/retracted` に注意）。
- 入れすぎない：注入は要点 2–5 件に絞る（§1.6⑧）。

## 注意

- 未参加 PJ では arag MCP は起動していない（ガードで no-op）。その場合は recall をスキップ。
- 不確実な知識は「未確認」と明示する。確信できないものを既成事実にしない。
