import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';
import 'katex/dist/katex.min.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = 'markdown' }: MarkdownRendererProps) {
  const components: Partial<Components> = {
    p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
    h1: ({ children }) => <h1 className="text-2xl font-bold mb-3 mt-4 text-slate-800">{children}</h1>,
    h2: ({ children }) => <h2 className="text-xl font-bold mb-2 mt-3 text-slate-700">{children}</h2>,
    h3: ({ children }) => <h3 className="text-lg font-semibold mb-2 mt-2 text-slate-600">{children}</h3>,
    ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>,
    li: ({ children }) => <li className="mb-1 leading-relaxed">{children}</li>,
    code: ({ inline, children, className, ...props }: any) => {
      if (inline) {
        return <code className="bg-pink-100 text-pink-800 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>;
      }
      return (
        <pre className="bg-slate-900 text-slate-100 p-4 rounded-lg my-4 overflow-x-auto border border-slate-700">
          <code className={className} {...props}>{children}</code>
        </pre>
      );
    },
    strong: ({ children }) => <strong className="font-bold text-slate-900">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-4 bg-blue-50 rounded-r">
        {children}
      </blockquote>
    ),
    a: ({ children, href }) => (
      <a href={href} className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full border-collapse border border-slate-300">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-slate-300 bg-slate-100 px-4 py-2 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-slate-300 px-4 py-2">
        {children}
      </td>
    ),
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm, 
          [remarkMath, {
            singleDollarTextMath: true
          }]
        ]}
        rehypePlugins={[
          [rehypeKatex, {
            strict: false,
            throwOnError: false,
            trust: true,
            output: 'htmlAndMathml',
            displayMode: false,
            fleqn: false,
            minRuleThickness: 0.05,
            maxSize: 500,
            maxExpand: 1000,
            macros: {
              "\\RR": "\\mathbb{R}",
              "\\NN": "\\mathbb{N}",
              "\\ZZ": "\\mathbb{Z}",
              "\\QQ": "\\mathbb{Q}",
              "\\CC": "\\mathbb{C}",
              "\\PP": "\\mathbb{P}",
              "\\EE": "\\mathbb{E}",
              "\\bf": "\\mathbf{#1}",
              "\\vec": "\\boldsymbol{#1}"
            }
          }]
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}