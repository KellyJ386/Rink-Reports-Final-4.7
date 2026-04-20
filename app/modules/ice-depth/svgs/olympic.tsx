/**
 * Bundled Olympic-dimension rink backdrop. Reference proportions 200 × 100 ft
 * (wider than NHL). Same corner radius, blue lines closer to center by the
 * international standard.
 */
export function OlympicRinkSvg() {
  return (
    <g>
      <rect
        x="0.5"
        y="0.5"
        width="199"
        height="99"
        rx="28"
        ry="28"
        fill="#f5fbff"
        stroke="#1e293b"
        strokeWidth="1"
      />
      {/* goal lines */}
      <line x1="13" y1="1" x2="13" y2="99" stroke="#e11d48" strokeWidth="0.5" />
      <line x1="187" y1="1" x2="187" y2="99" stroke="#e11d48" strokeWidth="0.5" />
      {/* blue lines — 22.86 m (~75 ft) from goal in IIHF */}
      <line x1="75" y1="1" x2="75" y2="99" stroke="#2563eb" strokeWidth="1" />
      <line x1="125" y1="1" x2="125" y2="99" stroke="#2563eb" strokeWidth="1" />
      {/* center red line */}
      <line x1="100" y1="1" x2="100" y2="99" stroke="#e11d48" strokeWidth="1" />
      {/* center face-off circle */}
      <circle cx="100" cy="50" r="15" fill="none" stroke="#2563eb" strokeWidth="0.75" />
      <circle cx="100" cy="50" r="0.8" fill="#2563eb" />
      {/* end-zone face-off circles */}
      <circle cx="33" cy="27" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      <circle cx="33" cy="73" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      <circle cx="167" cy="27" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      <circle cx="167" cy="73" r="15" fill="none" stroke="#e11d48" strokeWidth="0.5" />
      {/* neutral-zone dots */}
      <circle cx="80" cy="27" r="0.8" fill="#e11d48" />
      <circle cx="80" cy="73" r="0.8" fill="#e11d48" />
      <circle cx="120" cy="27" r="0.8" fill="#e11d48" />
      <circle cx="120" cy="73" r="0.8" fill="#e11d48" />
      {/* goal creases */}
      <path d="M 13 45 a 6 6 0 0 1 0 9 Z" fill="#dbeafe" stroke="#e11d48" strokeWidth="0.4" />
      <path d="M 187 45 a 6 6 0 0 0 0 9 Z" fill="#dbeafe" stroke="#e11d48" strokeWidth="0.4" />
    </g>
  )
}

export const OLYMPIC_VIEWBOX = '0 0 200 100'
