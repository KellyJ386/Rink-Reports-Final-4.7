import zones from './postal-code-zones.json'

type UsRange = { from: string; to: string; timezone: string; comment?: string }
type CaPrefixes = Record<string, string>

const US_RANGES: UsRange[] = (zones.US.ranges as UsRange[]) ?? []
const US_DEFAULT: string = zones.US.default
const CA_PREFIXES: CaPrefixes = (zones.CA.prefixes as CaPrefixes) ?? {}
const CA_DEFAULT: string = zones.CA.default

/**
 * Derive an IANA timezone from a North American postal code.
 *
 * Accepted inputs:
 *   US:  5-digit ZIP ("12345") or ZIP+4 ("12345-6789")
 *   CAN: 6-char FSA+LDU ("K1A 0B1" or "K1A0B1"); only the first letter is used
 *
 * Returns `null` if the input doesn't match either pattern. Callers should fall back
 * to a user-provided timezone or UTC.
 */
export function timezoneFromPostalCode(postalCode: string | null | undefined): string | null {
  if (!postalCode) return null

  const raw = postalCode.trim().toUpperCase()

  // Canadian: starts with a letter, e.g. "K1A 0B1" or "K1A0B1"
  const caMatch = raw.match(/^([A-Z])\d[A-Z]\s*\d[A-Z]\d$/)
  if (caMatch) {
    const prefix = caMatch[1]
    return CA_PREFIXES[prefix] ?? CA_DEFAULT
  }

  // US: 5 digits, optionally followed by -####
  const usMatch = raw.match(/^(\d{5})(?:-\d{4})?$/)
  if (usMatch) {
    const zip = usMatch[1]
    for (const range of US_RANGES) {
      if (zip >= range.from && zip <= range.to) {
        return range.timezone
      }
    }
    return US_DEFAULT
  }

  return null
}
