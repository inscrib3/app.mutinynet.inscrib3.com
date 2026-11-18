// Display formatting shared by the app and launch pages.

export type PriceTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '24h' | '7d' | '30d'
export const PRICE_TIMEFRAMES: PriceTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '24h', '7d', '30d']

export const short = (value: string, edge = 6) => value.length > edge * 2 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value
export const comma = (value: string | bigint) => BigInt(value).toLocaleString()

// Tickers of the control, LP, and ledger assets a new pool issues. They are
// immutable on-chain metadata, so the create page previews exactly these.
export function poolAssetTickers(poolName: string): { stem: string; control: string; lp: string; ledger: string } {
  const stem = poolName.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 9) || 'POOL'
  return {
    stem,
    control: `${stem}-CTRL`.slice(0, 16),
    lp: `${stem}-LP`.slice(0, 16),
    ledger: `${stem}-LEDGER`.slice(0, 16),
  }
}

export function btc(sats: string | bigint): string {
  return `${(Number(BigInt(sats)) / 100_000_000).toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`
}

// Integer-exact ratio, rendered as a string. Eight decimal places normally
// suffice, but BTC-denominated prices can be smaller than one satoshi per
// whole token; do not render those non-zero ratios as zero.
export function ratio(numerator: bigint, denominator: bigint, precision = 8): string {
  if (denominator === 0n) return '—'
  let displayPrecision = precision
  let scale = 10n ** BigInt(displayPrecision)
  let scaled = (numerator * scale) / denominator
  if (scaled === 0n && numerator !== 0n && displayPrecision < 18) {
    displayPrecision = 18
    scale = 10n ** BigInt(displayPrecision)
    scaled = (numerator * scale) / denominator
  }
  if (scaled === 0n && numerator !== 0n) return `< 0.${'0'.repeat(displayPrecision - 1)}1`
  const whole = scaled / scale
  const fraction = (scaled % scale).toString().padStart(displayPrecision, '0').replace(/0+$/, '')
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString()
}

export function displayAmount(value: string | bigint, decimals: number, precision = 6): string {
  const raw = BigInt(value)
  if (decimals === 0) return raw.toLocaleString()
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = (raw % scale).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '')
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString()
}

export function editableAmount(value: string | bigint, decimals: number): string {
  const raw = BigInt(value)
  if (decimals === 0) return raw.toString()
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  if (Math.abs(value) < 0.00000001) {
    const decimalPlaces = Math.min(18, Math.max(8, 6 - Math.floor(Math.log10(Math.abs(value)))))
    const decimal = value.toFixed(decimalPlaces).replace(/0+$/, '').replace(/\.$/, '')
    return decimal === '0' || decimal === '-0' ? value.toExponential(6) : decimal
  }
  return value.toLocaleString(undefined, { maximumSignificantDigits: 10 })
}

export function formatChartTime(timestamp: number, timeframe: PriceTimeframe): string {
  const date = new Date(timestamp)
  if (timeframe === '1m' || timeframe === '5m') return date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
  if (timeframe === '7d' || timeframe === '30d') return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatChartTooltipTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}
