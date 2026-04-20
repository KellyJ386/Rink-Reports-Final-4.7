/**
 * Bundled NHL-dimension rink backdrop. Reference proportions 200 × 85 ft.
 * Coordinates in the viewBox are feet so overlay points (stored as percentages)
 * resolve cleanly to (viewBox.width * x_pct / 100, viewBox.height * y_pct / 100).
 */
export function NhlRinkSvg() {
  return (
    <g>
      {/* ice surface with rounded corners */}
      <rect
        x="0.5"
        y="0.5"
        width="199"
        height="84"
        rx="28"
        ry="28"
        fill="#f5fbff"
        stroke="#1e293b"
        strokeWidth="1"
      />
      {/* goal lines */}
      <line x1="11" y1="1" x2="11" y2="84" stroke="#e11d48" strokeWidth="0.5" />
      <line x1="189" y1="1" x2="189" y2="84" stroke="#e11d48" strokeWidth="0.5" />
      {/* blue lines */}
      <line x1="75" y1="1" x2="75" y2="84" stroke="#2563eb" strokeWidth="1" />
      <line x1="125" y1="1" x2="125" y2="84" stroke="#2563eb" strokeWidth="1" />
      {/* center red line */}
      <line x1="100" y1="1" x2="100" y2="84" stroke="#e11d48" strokeWidth="1" />
      {/* center face-off circle */}
      <circle cx="100" cy="42.5" r="15" fill="none" stroke="#2563eb" strokeWidth="0.75" />
      <circle cx="100" cy="42.5" r="0.8" fill="#2563eb" />
      {/* end-zone face-off circles */}
      <circle cx="31" cy="22" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      <circle cx="31" cy="63" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      <circle cx="169" cy="22" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      <circle cx="169" cy="63" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      {/* neutral-zone face-off dots */}
      <circle cx="80" cy="22" r="0.8" fill="#e11d48" />
      <circle cx="80" cy="63" r="0.8" fill="#e11d48" />
      <circle cx="120" cy="22" r="0.8" fill="#e11d48" />
      <circle cx="120" cy="63" r="0.8" fill="#e11d48" />
      {/* goal creases (approx) */}
      <path d="M 11 38 a 6 6 0 0 1 0 9 Z" fill="#dbeafe" stroke="#e11d48" strokeWidth="0.4" />
      <path d="M 189 38 a 6 6 0 0 0 0 9 Z" fill="#dbeafe" stroke="#e11d48" strokeWidth="0.4" />
    </g>
  )
}

export const NHL_VIEWBOX = '0 0 200 85'
