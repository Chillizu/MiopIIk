import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'

export const name = 'mop-learn'
export const inject = ['tools', 'fs', 'sandboxPolicy']

const stringOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

// skill 落点（D12，docs/design/memory-design.md）：项目 .dsh/skills/<name>/，须与 skill-filesystem 发现目录对齐。
const SKILLS_REL_DIR = '.dsh/skills'

export function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: 'mop_learn',
      description:
        'Mint a reusable procedure as a skill: write a SKILL.md (frontmatter name/description + body) under the project .dsh/skills/<name>/ (discovered by skill-filesystem). Land the learn/skill 分流 discipline from D12.',
      parameters: {
        name: { type: 'string', required: true },
        description: { type: 'string', required: true },
        content: { type: 'string', required: true },
      },
      output: stringOutput,
      async execute(args, exec) {
        const name = (args.name || '').trim()
        if (!NAME_RE.test(name))
          throw new Error(
            `mop_learn: invalid skill name "${name}" (kebab-case, no leading hyphen)`,
          )
        if (!(args.description || '').trim())
          throw new Error('mop_learn: description required')
        if (!(args.content || '').trim())
          throw new Error('mop_learn: content required')
        const agent = exec.agent
        const cwd =
          agent &&
          agent.session &&
          agent.session.header &&
          agent.session.header.cwd
        if (!cwd) throw new Error('mop_learn: session cwd unavailable')
        const dir = join(cwd, SKILLS_REL_DIR, name)
        const body = `---\nname: ${name}\ndescription: ${args.description.trim()}\n---\n\n${args.content.trim()}\n`
        const target = await ctx.fs.resolve(join(dir, 'SKILL.md'), { cwd })
        const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
        await ctx.fs.writeText(target, body, undefined, undefined, policy)
        return `skill minted: ${name} -> ${dir}/SKILL.md`
      },
    }),
  )
}
