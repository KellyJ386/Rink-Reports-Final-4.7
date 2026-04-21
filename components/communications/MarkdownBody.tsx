'use client'

import Markdown from 'react-markdown'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeOptions } from 'rehype-sanitize'

// Restricted element set: prose only. No images, no code blocks, no arbitrary HTML.
const sanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  tagNames: ['h2', 'h3', 'h4', 'p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'br'],
  attributes: {
    a: ['href'],
  },
  protocols: {
    href: ['https', 'http', 'mailto'],
  },
}

const rehypePlugins = [[rehypeSanitize, sanitizeSchema]] as Parameters<typeof Markdown>[0]['rehypePlugins']

type Props = { body: string; className?: string }

export function MarkdownBody({ body, className }: Props) {
  return (
    <div className={className ?? 'prose prose-sm max-w-none'}>
      <Markdown rehypePlugins={rehypePlugins}>{body}</Markdown>
    </div>
  )
}
