import { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
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
  onCopyContent?: (text: string, source: 'code') => void;
  onLinkClick?: (label: string, href: string) => void;
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

const inlineDataImagePattern = /!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/g;

function CodeBlock({ children, className, onCopyContent, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || '')?.[1] || 'Text';
  const codeText = getTextContent(children).replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      onCopyContent?.(codeText, 'code');
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

export function MarkdownRenderer({ content, className = 'markdown', normalizeContent = false, onCopyContent, onLinkClick }: MarkdownRendererProps) {
  const containsInlineImage = content.includes('data:image/');
  const renderedContent = normalizeContent && !containsInlineImage ? normalizeRenderContent(content) : content;
  const inlineDataImages = Array.from(renderedContent.matchAll(inlineDataImagePattern)).map((match, index) => ({
    id: `${index}-${match[1] || 'generated-image'}`,
    alt: match[1] || 'Generated image',
    src: match[2],
  }));
  const markdownContent = inlineDataImages.length > 0
    ? renderedContent.replace(inlineDataImagePattern, '').replace(/\n{3,}/g, '\n\n').trim()
    : renderedContent;
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
      return <CodeBlock className={className} onCopyContent={onCopyContent} {...props}>{children}</CodeBlock>;
    },
    strong: ({ children }) => <strong>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
    blockquote: ({ children }) => <blockquote>{children}</blockquote>,
    a: ({ children, href }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          if (href) {
            onLinkClick?.(getTextContent(children), href);
          }
        }}
      >
        {children}
      </a>
    ),
    img: ({ src, alt }) => (
      <img
        src={src || ''}
        alt={alt || 'Generated image'}
        className="my-4 max-w-full rounded-lg border border-slate-200 shadow-sm"
        loading="lazy"
      />
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
        urlTransform={(url) => (
          url.startsWith('data:image/') ? url : defaultUrlTransform(url)
        )}
        components={components}
      >
        {markdownContent}
      </ReactMarkdown>
      {inlineDataImages.map((image) => (
        <img
          key={image.id}
          src={image.src}
          alt={image.alt}
          className="my-4 max-w-full rounded-lg border border-slate-200 shadow-sm"
          loading="lazy"
        />
      ))}
    </div>
  );
}
