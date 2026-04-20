import { defaultSchema, type Schema } from 'hast-util-sanitize'

/**
 * rehype-sanitize schema for announcement bodies.
 *
 * Defense in depth: this runs AFTER react-markdown's `skipHtml: true` option,
 * which blocks raw HTML at parse time. Anything HTML-like that still slips
 * through (e.g. protocol-prefixed auto-links) gets filtered here.
 *
 * Explicitly blocked even without raw-HTML parsing: img, picture, source, video,
 * audio, iframe, embed, object, script, style, form, input, button, svg, math,
 * table, thead, tbody, tr, td, th. No product use case for any of them in v1.
 *
 * Link policy: http / https / mailto. No javascript:, tel:, data:, file:.
 * All links render with target="_blank" rel="noopener noreferrer" (enforced by
 * the <a> component in MarkdownRenderer, not by sanitize — attribute-rewriting
 * inside rehype-sanitize is fragile).
 */
export const ANNOUNCEMENT_SCHEMA: Schema = {
  ...defaultSchema,
  tagNames: [
    'p',
    'br',
    'hr',
    'h2',
    'h3',
    'h4',
    'strong',
    'em',
    'u',
    'del',
    'ul',
    'ol',
    'li',
    'a',
    'blockquote',
    'code',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: ['href', 'title'],
    code: [],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
  },
  clobberPrefix: 'user-content-',
}
