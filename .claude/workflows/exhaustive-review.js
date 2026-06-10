export const meta = {
  name: 'exhaustive-review',
  description: '徹底監査用の決定論レビュー。複数の探索視点で finder を回し、新規の指摘が K ラウンド連続でゼロになるまで掘り続ける（loop-until-dry）。各指摘は多視点の敵対的検証パネルで確定する。「網羅的に監査して」級のリクエスト向け。予算ガードで暴走を防ぐ。',
  phases: [
    { title: 'Scope', detail: '監査対象ファイルを算出' },
    { title: 'Hunt', detail: '複数視点の finder を新規ゼロが続くまで反復' },
    { title: 'Verify', detail: '新規指摘を多視点パネルで敵対的に確定' },
  ],
}

// args: { scope?: "diff"|"all"|<path>, base?: "main", dryRounds?: 2, refuters?: 3, maxRounds?: 8 }
//   scope="diff"（既定）: base...HEAD の変更ファイルのみ監査
//   scope="all"        : 追跡ファイル全体を監査（リポジトリ全体監査・diff 非依存）
//   scope=<path>       : 指定ディレクトリ配下を監査（段階導入: サブディレクトリ先行）
const scope = (args && args.scope) ? args.scope : 'diff'
const base = (args && args.base) ? args.base : 'main'
const dryRounds = (args && args.dryRounds) ? args.dryRounds : 2
const refuters = (args && args.refuters) ? args.refuters : 3
const maxRounds = (args && args.maxRounds) ? args.maxRounds : 8

const SCOPE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['files'],
  properties: { files: { type: 'array', items: { type: 'string' } } },
}
const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['ruleId', 'level', 'message', 'file'],
        properties: {
          ruleId: { type: 'string' },
          level: { type: 'string', enum: ['error', 'warning', 'note'] },
          message: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
        },
      },
    },
  },
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['isReal', 'reason'],
  properties: { isReal: { type: 'boolean' }, reason: { type: 'string' } },
}

// --- Phase: Scope ---
phase('Scope')
const scopeCmd =
  scope === 'all' ? '`git ls-files` を実行し追跡ファイル全件'
  : scope === 'diff' ? `\`git diff --name-only ${base}...HEAD\` を実行し変更ファイル`
  : `\`git ls-files -- ${scope}\` を実行し ${scope} 配下のファイル`
const scopeResult = await agent(
  `${scopeCmd}の一覧を取得し、ソースコードに該当するもの（生成物・ロックファイル・バイナリ・node_modules 等は除外）を files に入れて返せ。`,
  { label: 'scope', phase: 'Scope', schema: SCOPE_SCHEMA, model: 'haiku' }
)
if (!scopeResult || !scopeResult.files || scopeResult.files.length === 0) {
  log(`監査対象ファイルが見つかりません（scope=${scope}）。`)
  return { result: 'NO_FILES', confirmed: [] }
}
const fileList = scopeResult.files.join('\n')
log(`監査対象 ${scopeResult.files.length} ファイル（scope=${scope}）`)

// finder の探索視点（互いに盲目なほど網羅性が上がる）
const FINDER_LENSES = [
  'correctness（境界条件・null・例外・競合）',
  'security（注入・認可・シークレット・OWASP）',
  'data-flow（状態の不変条件・副作用・順序依存）',
  'resource（リーク・未解放・N+1・無制限ループ）',
]
// 検証パネルの視点（finder と別の角度で反証を試みる）
const VERIFY_LENSES = ['correctness', 'security', 'reproducibility']

const key = (f) => `${f.file}::${f.ruleId}::${f.line || 0}`
const finderPrompt = (lens) =>
  `あなたは ${lens} 視点の監査担当。次のファイル群を読み、潜在バグ/脆弱性を findings で列挙せよ。` +
  `他視点が見るものは無視し、自分の視点に集中せよ。\n対象:\n${fileList}`
const verifyPrompt = (f, lens) =>
  `次の指摘が本物かを ${lens} の視点で敵対的に検証せよ。デフォルトは反証（isReal=false）。` +
  `コードを実際に確認し確実に本物のときだけ isReal=true。\n` +
  `ruleId: ${f.ruleId} / level: ${f.level} / file: ${f.file}:${f.line || ''}\n指摘: ${f.message}`

// --- Phase: Hunt → Verify（loop-until-dry）---
const seen = new Set()
const confirmed = []
let dry = 0
let round = 0
while (dry < dryRounds && round < maxRounds) {
  // 予算ガード: budget.total 未設定時は remaining()=Infinity なので total を必ず確認
  if (budget.total && budget.remaining() < 60000) {
    log(`予算残 ${Math.round(budget.remaining() / 1000)}k で打ち切り（round ${round}）。未探索の視点が残っている可能性あり。`)
    break
  }
  round++
  phase('Hunt')
  const found = (await parallel(FINDER_LENSES.map((lens, i) => () =>
    agent(finderPrompt(lens), { label: `hunt:r${round}:${i}`, phase: 'Hunt', schema: FINDINGS_SCHEMA, model: 'haiku' })
  ))).filter(Boolean).flatMap(r => r.findings || [])

  const fresh = found.filter(f => !seen.has(key(f)))
  if (fresh.length === 0) { dry++; log(`round ${round}: 新規ゼロ（dry ${dry}/${dryRounds}）`); continue }
  dry = 0
  fresh.forEach(f => seen.add(key(f)))
  log(`round ${round}: 新規 ${fresh.length} 件 → 敵対検証`)

  phase('Verify')
  const judged = await parallel(fresh.map(f => () =>
    parallel(VERIFY_LENSES.map(lens => () =>
      agent(verifyPrompt(f, lens), { label: `verify:${f.ruleId}:${lens}`, phase: 'Verify', schema: VERDICT_SCHEMA })
    )).then(votes => {
      const valid = votes.filter(Boolean)
      const real = valid.filter(v => v.isReal).length
      return { finding: f, isReal: real * 2 >= valid.length && valid.length > 0, votes: valid.length, agree: real }
    })
  ))
  confirmed.push(...judged.filter(v => v.isReal).map(v => ({ ...v.finding, panel: `${v.agree}/${v.votes}` })))
}

if (round >= maxRounds && dry < dryRounds) {
  log(`maxRounds(${maxRounds}) 到達で打ち切り。さらに新規指摘が出る可能性あり（dry 未達）。`)
}
const errorCount = confirmed.filter(f => f.level === 'error').length
log(`確定指摘 ${confirmed.length} 件（error: ${errorCount}） / ラウンド ${round}`)
return { result: errorCount > 0 ? 'REQUEST_CHANGES' : 'APPROVE', confirmed, rounds: round }
