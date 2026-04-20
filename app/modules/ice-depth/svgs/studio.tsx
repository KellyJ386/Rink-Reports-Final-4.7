/**
 * Bundled studio-rink backdrop. Reference proportions 170 × 75 ft (smaller
 * practice rink). Simpler lines — just center, boards, and one face-off circle.
 */
export function StudioRinkSvg() {
  return (
    <g>
      <rect
        x="0.5"
        y="0.5"
        width="169"
        height="74"
        rx="20"
        ry="20"
        fill="#f5fbff"
        stroke="#1e293b"
        strokeWidth="1"
      />
      {/* center red line */}
      <line x1="85" y1="1" x2="85" y2="74" stroke="#e11d48" strokeWidth="1" />
      {/* center face-off circle */}
      <circle cx="85" cy="37.5" r="12" fill="none" stroke="#2563eb" strokeWidth="0.75" />
      <circle cx="85" cy="37.5" r="0.8" fill="#2563eb" />
      {/* simple end dots */}
      <circle cx="20" cy="37.5" r="0.8" fill="#e11d48" />
      <circle cx="150" cy="37.5" r="0.8" fill="#e11d48" />
    </g>
  )
}

export const STUDIO_VIEWBOX = '0 0 170 75'
