export const meta = {
  name: 'review-changes',
  description: '変更 diff を多次元（品質/セキュリティ/テスト/DB/不要コード）で並列レビューし、各指摘を敵対的に検証して確定する。acode の最大5並列レビュー（/code-review・/issue-flow Phase 3）の決定論版。大規模 diff 向け。',
  phases: [
    { title: 'Scope', detail: '変更ファイルリストを算出し DB 変更の有無を判定' },
    { title: 'Review', detail: 'レビュー次元ごとに並列レビュー' },
    { title: 'Verify', detail: '各指摘を敵対的に検証して誤検知を落とす' },
  ],
}

// 任意 args: { base?: string(基準ブランチ, 既定 "main"), refuters?: number(敵対的検証の人数, 既定 1) }
const base = (args && args.base) ? args.base : 'main'
const refuters = (args && args.refuters) ? args.refuters : 1

// --- スキーマ定義 ---
const SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'hasDbChanges'],
  properties: {
    files: { type: 'array', items: { type: 'string' } },
    hasDbChanges: { type: 'boolean' },
  },
}

// acode の指摘構造（SARIF サブセット）に準拠
const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tool', 'result', 'findings'],
  properties: {
    tool: { type: 'string' },
    result: { type: 'string' }, // PASS|FAIL|SKIP|SECURE|VULNERABLE|CLEAN|NEEDS_CLEANUP
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ruleId', 'level', 'message', 'locations'],
        properties: {
          ruleId: { type: 'string' },
          level: { type: 'string', enum: ['error', 'warning', 'note'] },
          message: { type: 'string' },
          locations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file'],
              properties: {
                file: { type: 'string' },
                startLine: { type: 'integer' },
                endLine: { type: 'integer' },
              },
            },
          },
          suggested_patch: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isReal', 'reason'],
  properties: {
    isReal: { type: 'boolean' },
    reason: { type: 'string' },
  },
}

// --- Phase: Scope ---
phase('Scope')
const scope = await agent(
  `\`git diff --name-only ${base}...HEAD\` を実行し、変更ファイル一覧を files に入れて返せ。` +
  `変更ファイルに DB 関連パターン（*.sql / migrations/ / ORM スキーマ / supabase/ 等）が 1 つでもあれば hasDbChanges=true、なければ false。`,
  { label: 'scope', phase: 'Scope', schema: SCOPE_SCHEMA, model: 'haiku' }
)

if (!scope || !scope.files || scope.files.length === 0) {
  log('変更ファイルが見つかりません。レビュー対象なし。')
  return { result: 'NO_CHANGES', confirmed: [], dimensions: [] }
}
const fileList = scope.files.join('\n')
log(`変更 ${scope.files.length} ファイル / DB変更: ${scope.hasDbChanges ? 'あり' : 'なし'}`)

// --- レビュー次元（acode の reviewer エージェントに対応。database は DB 変更がある場合のみ）---
const DIMENSIONS = [
  { key: 'code-quality', agentType: 'code-quality-reviewer', always: true },
  { key: 'security', agentType: 'security-reviewer', always: true },
  { key: 'test', agentType: 'test-verifier', always: true },
  { key: 'database', agentType: 'database-reviewer', always: false },
  { key: 'refactor', agentType: 'refactor-checker', always: true },
].filter(d => d.always || scope.hasDbChanges)

const reviewPrompt = (d) =>
  `あなたは ${d.key} レビュー担当。git diff は実行済み。次の変更ファイルのみをレビューし、` +
  `結果を findings 構造（SARIF サブセット）で返せ。個別に git diff は実行しないこと。\n対象ファイル:\n${fileList}`

const verifyPrompt = (d, f) =>
  `次のレビュー指摘が本物かを敵対的に検証せよ。デフォルトは「反証（isReal=false）」とし、` +
  `コードを実際に確認して確実に本物だと言える場合のみ isReal=true にせよ。\n` +
  `次元: ${d.key} / ruleId: ${f.ruleId} / level: ${f.level}\n指摘: ${f.message}\n` +
  `対象: ${(f.locations || []).map(l => l.file + (l.startLine ? ':' + l.startLine : '')).join(', ')}`

// 1指摘を refuters 人で検証し、過半数が isReal なら確定
const verifyFinding = (d, f) =>
  parallel(Array.from({ length: refuters }, (_, i) => () =>
    agent(verifyPrompt(d, f), { label: `verify:${d.key}#${i}`, phase: 'Verify', schema: VERDICT_SCHEMA })
  )).then(votes => {
    const valid = votes.filter(Boolean)
    const real = valid.filter(v => v.isReal).length
    return { ...f, tool: d.key, verdict: { isReal: real * 2 >= valid.length && valid.length > 0, votes: valid } }
  })

// --- Phase: Review → Verify（pipeline。次元ごとにレビュー完了次第その指摘を検証）---
const results = await pipeline(
  DIMENSIONS,
  (d) => agent(reviewPrompt(d), { label: `review:${d.key}`, phase: 'Review', agentType: d.agentType, schema: FINDINGS_SCHEMA }),
  (review, d) => {
    if (!review) return { dimension: d.key, result: 'ERROR', findings: [] }
    const findings = review.findings || []
    if (findings.length === 0) return { dimension: d.key, result: review.result, findings: [] }
    return parallel(findings.map(f => () => verifyFinding(d, f)))
      .then(verified => ({ dimension: d.key, result: review.result, findings: verified.filter(Boolean) }))
  }
)

// --- 集約 ---
const dimensions = results.filter(Boolean)
const confirmed = dimensions.flatMap(r => r.findings.filter(f => f.verdict && f.verdict.isReal))
const errorCount = confirmed.filter(f => f.level === 'error').length
const hadBadResult = dimensions.some(r => ['FAIL', 'VULNERABLE'].indexOf(r.result) !== -1)
const overall = (errorCount > 0 || hadBadResult) ? 'REQUEST_CHANGES' : 'APPROVE'

log(`確定指摘 ${confirmed.length} 件（error: ${errorCount}） / 総合: ${overall}`)
return { result: overall, dimensions, confirmed }
