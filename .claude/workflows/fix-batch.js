export const meta = {
  name: 'fix-batch',
  description: 'fix 系 Issue を大量に一括実装する決定論版。影響ファイルの競合でグループ分割し、各グループを独立 worktree で隔離して並列（グループ内は直列）実装し、グループ専用ブランチへコミットする。/fix-impl の「最大5件」上限を超えて全件を実装し、グループブランチのマージ・PR 作成・最終検証はハーネスが行う。',
  phases: [
    { title: 'Group', detail: '影響ファイルの競合で Issue をグループ分割' },
    { title: 'Implement', detail: '非競合グループは独立 worktree で並列・グループ内は直列で TDD 実装' },
  ],
}

// args: { issues: [{number, title, files:[...], body?, label?}], base?: "main" }
// files は各 Issue の影響ファイル（呼び出し側＝/fix-impl が収集時に算出して渡す）
const issues = (args && args.issues) ? args.issues : []
const base = (args && args.base) ? args.base : 'main'

const IMPL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'status'],
  properties: {
    number: { type: 'integer' },
    status: { type: 'string', enum: ['DONE', 'FAILED'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    failureReason: { type: 'string' },
  },
}

if (issues.length === 0) {
  log('対象 fix Issue が渡されていません。')
  return { result: 'NO_ISSUES', implemented: [], failed: [] }
}

// --- Phase: Group（union-find で「ファイルを共有する Issue」を同一グループに）---
phase('Group')
const parent = issues.map((_, i) => i)
const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
const union = (a, b) => { parent[find(a)] = find(b) }

// ファイル → 最初に出現した Issue index。以降同じファイルを持つ Issue を union
const fileOwner = {}
issues.forEach((iss, idx) => {
  (iss.files || []).forEach(f => {
    if (fileOwner[f] === undefined) fileOwner[f] = idx
    else union(idx, fileOwner[f])
  })
})

const groupsMap = {}
issues.forEach((iss, idx) => {
  const root = find(idx)
  if (!groupsMap[root]) groupsMap[root] = []
  groupsMap[root].push(iss)
})
const groups = Object.keys(groupsMap).map(k => groupsMap[k])
log(`${issues.length} Issue を ${groups.length} グループに分割（非競合グループは並列・グループ内は直列）`)

// 各グループ（互いにファイル素）を独立 worktree で隔離して並列実装する。グループ内 Issue は
// 同じファイルを触りうるため同一 worktree で直列実装し、変更をグループ専用ブランチへコミットする。
// マージバック（グループブランチ→バッチブランチ）と PR・最終検証はハーネス（/fix-impl）が行う。
const GROUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['branch', 'issues'],
  properties: {
    branch: { type: 'string' },                 // このグループの変更をコミットしたブランチ名
    issues: { type: 'array', items: IMPL_SCHEMA },
  },
}

const groupPrompt = (grp, idx) => {
  const branch = `fix-batch/group-${idx}`
  return (
    `あなたは隔離された git worktree 内にいる。まずグループ専用ブランチを作成して作業せよ:\n` +
    `  git checkout -b ${branch}\n\n` +
    `次の fix Issue を **この順序で直列に** TDD（RED→GREEN→REFACTOR）で実装せよ` +
    `（同一グループ＝同じファイルを触りうるため直列。後続は先行の変更を前提に進める）:\n` +
    grp.map(iss => `  #${iss.number}「${iss.title}」 files: ${(iss.files || []).join(', ') || '(未指定)'}`).join('\n') +
    grp.map(iss => iss.body ? `\n\n#${iss.number} 本文:\n${iss.body}` : '').join('') +
    `\n\nこのグループのファイルスコープ外は触らないこと（他グループとの衝突回避）。\n` +
    `規約: CLAUDE.md / coding-style に従う。\`.github/**\` は自動生成しない（ci-release ゲート）。` +
    `cgc が有効なら編集前に impact を確認（mcp-tools）。\n` +
    `各 Issue 完了ごとに \`fix(#<番号>): <要約>\` でこの worktree のブランチへコミットせよ。\n` +
    `**push も PR も作らないこと**（マージ・PR はハーネスが集約する）。\n` +
    `全 Issue 完了後、branch（"${branch}"）と各 Issue の number/status/filesChanged/summary を返せ。`
  )
}

// --- Phase: Implement（グループ間は並列・各グループは独立 worktree・グループ内は直列）---
phase('Implement')
const groupResults = await parallel(groups.map((grp, idx) =>
  () => agent(groupPrompt(grp, idx), {
    label: `fix:g${idx}(${grp.map(i => '#' + i.number).join(',')})`,
    phase: 'Implement',
    isolation: 'worktree',
    schema: GROUP_SCHEMA,
  })
))

const okGroups = groupResults.filter(Boolean)
const all = okGroups.flatMap(g => (g.issues || []))
const implemented = all.filter(r => r.status === 'DONE')
const failed = all.filter(r => r.status !== 'DONE')
const branches = okGroups.map(g => g.branch).filter(Boolean)
log(`実装完了 ${implemented.length} 件 / 失敗 ${failed.length} 件 / マージ対象ブランチ ${branches.length} 本`)
// branches を /fix-impl がバッチブランチへ順次マージする（グループは互いに素なので基本クリーン）。
return { result: failed.length === 0 ? 'ALL_DONE' : 'PARTIAL', implemented, failed, branches }
