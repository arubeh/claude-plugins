---
name: cgc-refresh
description: cgc graph の stale 復旧を定型化する。context/impact が現存しないパスを返す・list_repositories の path が repo root と合わない・大規模レイアウト変更の後など、graph が古い/壊れている兆候があるときに index → reload → 検証を一括で行う。
---

# cgc-refresh — stale graph の復旧

`cgc mcp start --watch` の増分追従は大規模なレイアウト変更（例: `apps/x/` → `crates/x-cli/`）を検知できず、
graph に古いシンボルが残ることがある。本スキルは復旧手順を定型化する。

## 手順

1. **再インデックス**: Bash で `cgc index .` を実行する（cross-platform CLI。「session の権限外」と判断して skip しない）
2. **リロード**: `mcp__cgc__reload_graph` で in-memory graph を更新する
3. **検証**:
   - `mcp__cgc__list_repositories` の path が現在の repo root と一致すること
   - 直前に stale だったシンボルへ `mcp__cgc__context(<symbol>)` を再実行し、返却 path が現存すること
4. **報告**: 「再 index 完了・graph 整合 OK（repo=<path>）」を 1 行で報告する。検証に失敗した場合は
   `cgc delete` → `cgc index .` の作り直しを提案する

## やってはいけないこと

- waiver「対象ファイルがインデックス未登録」の流用（鮮度の問題は waiver ではない）
- grep / find で代替して終わること（blast radius を見失う）
