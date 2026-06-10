---
name: arag-consolidate
description: arag 記憶の定期メンテナンス（local の磨き直しと誤り/誤昇格の監査）。raw に溜まった知識を棚卸しし、検証済みを active に、誤りを retracted に、陳腐を down-weight する。global への昇格は SessionEnd で自動化済みのため本スキルは local の curation と撤回監査が主務。週次など低頻度で実行する。
---

# arag-consolidate — 記憶の定期メンテナンス

arag 学習ループの **periodic & selective consolidation**（§1.5 / Phase 3）。**continuous rewriting は禁止**（過剰蒸留は劣化する／raw > 蒸留）。**全社昇格は SessionEnd で自動**化済み（§1.6⑤）なので、本スキルは **local の磨き直し**と**誤り/誤昇格の撤回監査**を担う。

## いつ

- 週次など低頻度・別セッションで。毎会話ではやらない（劣化＆コスト）。

## やること

1. **raw の棚卸し**：`./.arag/` に溜まった provisional 知識を確認し、検証できたものを `status=active` の蒸留 doc にまとめる。低価値・陳腐・重複は除外（down-weight）。
2. **誤りの撤回**：間違っていた知識は `status=retracted`（理由つき）にし、蒸留 doc には含めない。hard delete はしない（撤回ログを残す）。
3. **誤昇格の監査**：global（`_global`）に自動昇格された項目を見て、汎用でなかった/誤りのものは `/feedback` 経由で `retracted`。`origin_project` で由来を辿れる。
4. **関連づけの鮮度**：`arag graph-build`（local・必要なら global）を実行し、共起グラフ/コミュニティ（#34/#39）を再計算（write で破棄されるため）。
5. **劣化検知（任意）**：既知 fact の golden set で `arag eval`（P@K/R@K/MRR/nDCG）を計測し、recall/hit を経時で追う（§1.6⑥）。

## 原則

- 作り直しは curated ストアに対して（raw は archive・ニードルテスト元として温存／§7）。
- 高リスク・矛盾・低信頼の訂正は人間ゲート（HITL）。訂正は逆に精度を下げうるので慎重に（§1.6⑦）。
