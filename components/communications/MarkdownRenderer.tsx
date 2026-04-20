'use client'

import ReactMarkdown from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

import { ANNOUNCEMENT_SCHEMA } from '@/lib/communications/sanitize'

/**
 * Announcement body renderer.
 *
 * Security layers (defense in depth):
 *   1. react-markdown option skipHtml: true        → blocks raw HTML at parse
 *   2. rehype-sanitize with ANNOUNCEMENT_SCHEMA    → filters the AST
 *   3. `a` override below                          → forces target + rel on every link
 *
 * Why we override `a` here rather than in the sanitize schema: rehype-sanitize's
 * attribute-rewriting surface is fragile (hast-util-sanitize removes unknown
 * attributes, and injecting target/rel through `attributes.a = [['target', 'x']]`
 * is quirky). A React component override is obvious, testable, and impossible
 * to bypass from the markdown side.
 *
 * Link behavior: open in new tab, suppress opener/referrer leakage.
 *
 * Rejected features (documented in COMMUNICATIONS.md):
 *   - images / uploads / embeds
 *   - tables
 *   - raw HTML of any kind
 *   - @mentions
 *   - custom emoji / reactions
 */
export function MarkdownRenderer({ children }: { children: string }) {
  return (
    <div className="markdown-body prose prose-sm max-w-none">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, ANNOUNCEMENT_SCHEMA]]}
        components={{
          a: ({ href, children: linkChildren, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { children?: ReactNode }) => (
            <a
              {...rest}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {linkChildren}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
