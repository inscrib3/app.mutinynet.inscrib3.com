export const MAX_WALLET_AMOUNT = 9_007_199_254_740_991n
const MAX_DECIMALS = 18
const MAX_FEE_BPS = 9_999
export const MIN_PROTOCOL_FEE_BPS = 30
const TICKER_PATTERN = /^[A-Z0-9]+$/

export type AmountCheck = { raw: bigint } | { error: string }

export function parseDisplayAmount(value: string, decimals: number): AmountCheck {
  const text = value.trim()
  if (text === '') return { error: 'Enter an amount' }
  if (!/^\d*(\.\d*)?$/.test(text) || text === '.') return { error: 'Use digits and one decimal point only' }
  const [whole = '', fraction = ''] = text.split('.')
  if (fraction.length > decimals) return { error: decimals === 0 ? 'Whole numbers only' : `At most ${decimals} decimal places` }
  const raw = BigInt(`${whole}${fraction.padEnd(decimals, '0')}` || '0')
  if (raw === 0n) return { error: 'Must be greater than 0' }
  if (raw > MAX_WALLET_AMOUNT) return { error: 'Too large for the wallet to send' }
  return { raw }
}

export function rawAmount(value: string, decimals: number): bigint | null {
  const check = parseDisplayAmount(value, decimals)
  return 'raw' in check ? check.raw : null
}

export interface AssetFormInput { name: string; ticker: string; supply: string; decimals: string; icon: string }
export type FormErrors<T> = Partial<Record<keyof T, string>>
// Labels are listed in form order, so the first field with a problem is the one reported.
export function firstFormError<T>(errors: FormErrors<T>, labels: Partial<Record<keyof T, string>>): string | null {
  for (const key of Object.keys(labels) as Array<keyof T>) {
    const message = errors[key]
    if (message) return `${labels[key]}: ${message}`
  }
  return null
}

export interface ValidAsset { name: string; ticker: string; supply: bigint; decimals: number; icon?: string }

export function validateAssetForm(form: AssetFormInput): { errors: FormErrors<AssetFormInput>; valid?: ValidAsset } {
  const errors: FormErrors<AssetFormInput> = {}
  const name = form.name.trim()
  const ticker = form.ticker.trim()
  const icon = form.icon.trim()
  if (!name) errors.name = 'Enter a name'
  if (!ticker) errors.ticker = 'Enter a ticker'
  else if (!TICKER_PATTERN.test(ticker)) errors.ticker = 'Letters and numbers only, no spaces'
  const decimals = /^\d+$/.test(form.decimals.trim()) ? Number(form.decimals) : NaN
  if (!(decimals >= 0 && decimals <= MAX_DECIMALS)) errors.decimals = `Whole number from 0 to ${MAX_DECIMALS}`
  const supply = errors.decimals ? undefined : parseDisplayAmount(form.supply, decimals)
  if (supply && 'error' in supply) errors.supply = supply.error
  if (icon && !isHttpsUrl(icon)) errors.icon = 'Must be an https:// link'
  if (Object.keys(errors).length > 0 || !supply || !('raw' in supply)) return { errors }
  return { errors, valid: { name, ticker, supply: supply.raw, decimals, ...(icon ? { icon } : {}) } }
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

export interface PoolFormInput { baseAssetId: string; quoteAssetId: string; baseAmount: string; quoteAmount: string; feeBps: string; protocolFeeBps: string }
export interface PoolSide { ticker: string; decimals: number; balance: bigint }
export interface PoolFormContext {
  base?: PoolSide
  quote?: PoolSide
  creationFeeSats: bigint
  existingPairName?: string
}
export interface ValidPool { baseAmount: bigint; quoteAmount: bigint; feeBps: number; protocolFeeBps: number }

export function validatePoolForm(form: PoolFormInput, context: PoolFormContext): { errors: FormErrors<PoolFormInput>; valid?: ValidPool } {
  const errors: FormErrors<PoolFormInput> = {}
  if (!form.quoteAssetId) errors.quoteAssetId = 'Select a quote asset'
  else if (form.quoteAssetId === 'btc') errors.quoteAssetId = 'Native BTC must be the base asset'
  else if (form.quoteAssetId === form.baseAssetId) errors.quoteAssetId = 'Pick two different assets'
  else if (context.existingPairName) errors.quoteAssetId = `A pool already exists for this pair (${context.existingPairName})`

  // BTC funding also pays the fixed creation fee, so it has to fit in the same balance.
  const baseExtraSats = form.baseAssetId === 'btc' ? context.creationFeeSats : 0n
  const baseAmount = checkReserve(form.baseAmount, context.base, baseExtraSats)
  const quoteAmount = checkReserve(form.quoteAmount, context.quote, 0n)
  if ('error' in baseAmount) errors.baseAmount = baseAmount.error
  if ('error' in quoteAmount) errors.quoteAmount = quoteAmount.error

  const feeBps = parseBps(form.feeBps)
  const protocolFeeBps = parseBps(form.protocolFeeBps)
  if (feeBps === null) errors.feeBps = `Whole number from 1 to ${MAX_FEE_BPS}`
  if (protocolFeeBps === null || protocolFeeBps < MIN_PROTOCOL_FEE_BPS) errors.protocolFeeBps = `At least ${MIN_PROTOCOL_FEE_BPS} bps`
  else if (feeBps !== null && protocolFeeBps >= feeBps) errors.protocolFeeBps = 'Must be lower than the total fee'

  if (Object.keys(errors).length > 0 || !('raw' in baseAmount) || !('raw' in quoteAmount) || feeBps === null || protocolFeeBps === null) return { errors }
  return { errors, valid: { baseAmount: baseAmount.raw, quoteAmount: quoteAmount.raw, feeBps, protocolFeeBps } }
}

function checkReserve(value: string, side: PoolSide | undefined, extraRequired: bigint): AmountCheck {
  if (!side) return { error: 'Select the asset first' }
  const check = parseDisplayAmount(value, side.decimals)
  if ('error' in check) return check
  if (check.raw + extraRequired > side.balance) {
    return { error: extraRequired > 0n ? `More than your ${side.ticker} balance (creation fee included)` : `More than your ${side.ticker} balance` }
  }
  return check
}

function parseBps(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null
  const bps = Number(value)
  return bps >= 1 && bps <= MAX_FEE_BPS ? bps : null
}
