export const meta = {
  name: 'issue-batch',
  description: '複数 Issue を一括で 4フェーズ開発する決定論版。Issue ごとに plan→実装+PR を pipeline（バリアなし）で流し、各 Issue は独立 worktree（別ブランチ・別 PR）で並列処理する。/issue-flow --all-open の大規模版（最終検証・復帰はハーネス）。',
  phases: [
    { title: 'Plan', detail: 'Issue ごとに分析・実装計画を作成（軽量・worktree なし）' },
    { title: 'Deliver', detail: 'Issue ごとに worktree で実装→自己レビュー→PR 作成' },
  ],
}

// args: { issues: [{number, title, body?, level?}], base?: "main" }
// level: 依存レベル（0 が依存なし）。大スコープ分解の依存グラフから渡す。
//   省略時は全 Issue を同一レベル＝独立扱い（純 pipeline）。
//   レベル指定時はレベル昇順に処理し、レベル間にバリアを置く（依存違反を防ぐ）。
const issues = (args && args.issues) ? args.issues : []
const base = (args && args.base) ? args.base : 'main'

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'branch', 'steps'],
  properties: {
    number: { type: 'integer' },
    branch: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } },
  },
}

const DELIVER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'status'],
  properties: {
    number: { type: 'integer' },
    status: { type: 'string', enum: ['PR_CREATED', 'FAILED'] },
    prUrl: { type: 'string' },
    branch: { type: 'string' },
    failureReason: { type: 'string' },
  },
}

if (issues.length === 0) {
  log('対象 Issue が渡されていません。')
  return { result: 'NO_ISSUES', delivered: [], failed: [] }
}
log(`${issues.length} Issue を pipeline で一括処理（各 Issue は独立 worktree）`)

const planPrompt = (iss) =>
  `Issue #${iss.number}「${iss.title}」の実装計画を立てよ。現コードベースを調査し、` +
  `ブランチ名（<type>/#${iss.number}-<slug>）・実装ステップ・影響ファイルを返せ。\n` +
  (iss.body ? `Issue 本文:\n${iss.body}` : '')

const deliverPrompt = (iss, plan) =>
  `Issue #${iss.number}「${iss.title}」を実装し PR まで作成せよ。\n` +
  `ブランチ: ${plan && plan.branch ? plan.branch : `feat/#${iss.number}`}（${base} から作成）\n` +
  (plan && plan.steps ? `計画ステップ:\n${plan.steps.join('\n')}\n` : '') +
  `手順: 1) ブランチ作成 2) TDD で実装 3) テスト green 確認 4) 自己レビュー（品質/セキュリティ）` +
  ` 5) commit 6) push 7) \`gh pr create\`（本文に Closes #${iss.number}）。\n` +
  `規約: CLAUDE.md / coding-style に従う。\`.github/**\` は自動生成しない（ci-release ゲート）。` +
  `cgc が有効なら編集前に impact を確認（mcp-tools）。機密情報は PR 本文に転記しない。\n` +
  `完了したら number / status / prUrl / branch を返せ。失敗時は status=FAILED と failureReason。`

// 1 Issue の plan→deliver チェーン（pipeline の 1 行ぶん）
const runChain = (levelIssues) => pipeline(
  levelIssues,
  (iss) => agent(planPrompt(iss), { label: `plan:#${iss.number}`, phase: 'Plan', schema: PLAN_SCHEMA, model: 'haiku' }),
  (plan, iss) => agent(deliverPrompt(iss, plan), {
    label: `deliver:#${iss.number}`, phase: 'Deliver', schema: DELIVER_SCHEMA, isolation: 'worktree',
  })
)

// --- 依存レベル昇順に処理（レベル内は pipeline、レベル間はバリア）---
// 各 Issue は別ブランチ・別 PR を作るため Deliver は isolation:'worktree' 必須。
// pipeline なのでレベル内では速い Issue は遅い Issue を待たずに先へ進む。
const levels = [...new Set(issues.map(i => (i.level !== undefined ? i.level : 0)))].sort((a, b) => a - b)
let results = []
for (const lv of levels) {
  const levelIssues = issues.filter(i => (i.level !== undefined ? i.level : 0) === lv)
  if (levels.length > 1) log(`Level ${lv}: ${levelIssues.length} Issue を処理（前レベル完了済み）`)
  const levelResults = await runChain(levelIssues)
  results = results.concat(levelResults)
}

const out = results.filter(Boolean)
const delivered = out.filter(r => r.status === 'PR_CREATED')
const failed = out.filter(r => r.status !== 'PR_CREATED')
log(`PR 作成 ${delivered.length} 件 / 失敗 ${failed.length} 件`)
return { result: failed.length === 0 ? 'ALL_DELIVERED' : 'PARTIAL', delivered, failed }
