import remarkMath from 'remark-math-extended'
import type { StreamdownProps } from 'streamdown'

type PluggableList = NonNullable<StreamdownProps['remarkPlugins']>

type MdNode = {
  type: string
  children?: MdNode[]
  position?: { start: { offset?: number } }
  data?: Record<string, unknown>
}

/**
 * A paragraph that is only a one-line `$$…$$` is a formula on its own line, as models write it;
 * the math syntax takes only a `$$` fence on lines of its own as display math. It works on the
 * parsed tree, so code is left as it is.
 */
function remarkDisplayLines() {
  return (tree: MdNode, file: { value: unknown }) => {
    const source = String(file.value)
    const visit = (node: MdNode) => {
      const only = node.children?.[0]
      if (node.type === 'paragraph' && node.children?.length === 1 && only?.type === 'inlineMath') {
        const at = only.position?.start.offset
        if (at !== undefined && source.startsWith('$$', at)) {
          // `<pre><code class="language-math">` is display math to rehype-katex, and survives
          // a sanitizer that drops the `math-display` class.
          node.data = { ...node.data, hName: 'pre' }
          only.data = {
            ...only.data,
            hProperties: { className: ['language-math', 'math-display'] },
          }
        }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}

/**
 * Math in Markdown, written the ways models and documents write it: `$…$` and `\(…\)` inline,
 * `$$…$$` and `\[…\]` for a formula on its own line. Code is left as it is, and `\$` is a dollar
 * sign. The tree it makes is the one `rehype-katex` typesets.
 */
export const remarkMathSyntax: { plugins: PluggableList } = {
  plugins: [[remarkMath, { singleDollarTextMath: true }], remarkDisplayLines],
}
