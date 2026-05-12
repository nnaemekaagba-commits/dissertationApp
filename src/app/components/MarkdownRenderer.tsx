import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  normalizeContent?: boolean;
}

const normalizeRenderContent = (content: string) =>
  content
    .replace(/\\\((.*?)\\\)/gs, '$$$1$$')
    .replace(/\\\[(.*?)\\\]/gs, '$$$1$$')
    .replace(/(?<!\\)\b(sin|cos|tan|cot|sec|csc|log|ln)\b/g, '\\$1')
    .replace(/\\p\b/g, '\\pi')
    .replace(/([A-Za-z])(?=\d)/g, '$1 ')
    .replace(/(?<=\d)([A-Za-z])/g, ' $1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function getTextContent(children: unknown): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(getTextContent).join('');
  if (children === null || children === undefined) return '';
  return String(children);
}

function CodeBlock({ children, className, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || '')?.[1] || 'Text';
  const codeText = getTextContent(children).replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="code-card my-5">
      <div className="code-card-header">
        <div className="code-card-language">
          <span className="code-card-mark">{"</>"}</span>
          <span>{language.charAt(0).toUpperCase() + language.slice(1)}</span>
        </div>
        <button
          type="button"
          className="code-copy-button"
          onClick={handleCopy}
          aria-label="Copy code"
          title="Copy code"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      <pre className="code-card-body">
        <code className={className} {...props}>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownRenderer({ content, className = 'markdown', normalizeContent = false }: MarkdownRendererProps) {
  const renderedContent = normalizeContent ? normalizeRenderContent(content) : content;
  const components: Partial<Components> = {
    p: ({ children }) => <p>{children}</p>,
    h1: ({ children }) => <h1>{children}</h1>,
    h2: ({ children }) => <h2>{children}</h2>,
    h3: ({ children }) => <h3>{children}</h3>,
    h4: ({ children }) => <h4>{children}</h4>,
    ul: ({ children }) => <ul>{children}</ul>,
    ol: ({ children }) => <ol>{children}</ol>,
    li: ({ children }) => <li>{children}</li>,
    pre: ({ children }) => <>{children}</>,
    code: ({ inline, children, className, ...props }: any) => {
      if (inline) {
        return <code className="inline-code" {...props}>{children}</code>;
      }
      return <CodeBlock className={className} {...props}>{children}</CodeBlock>;
    },
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    blockquote: ({ children }) => <blockquote>{children}</blockquote>,
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="markdown-table-wrap">
        <table>
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => <th>{children}</th>,
    td: ({ children }) => <td>{children}</td>,
    hr: () => <hr />,
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
          rehypeHighlight,
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
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
}
