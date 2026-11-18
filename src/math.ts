// Integer-exact AMM arithmetic shared by the swap, liquidity, and pool flows.

// Every Arkade output the wallet funds carries at least this many sats (the API's DUST).
export const DUST_SATS = 330n

export function maxBigInt(a: bigint, b: bigint): bigint { return a > b ? a : b }

// Returns a/b * 10^(aScale - bScale) as a Number with up to 18 fractional digits,
// dividing in BigInt so the intermediate never overflows Number's safe range.
export function decimalRatio(a: string | bigint, b: string | bigint, aScale: number, bScale: number): number {
  const numerator = BigInt(a)
  const denominator = BigInt(b)
  if (denominator === 0n) return NaN
  if (numerator === 0n) return 0
  const PRECISION = 18n
  let scaled: bigint
  if (aScale >= bScale) {
    scaled = (numerator * 10n ** (PRECISION + BigInt(aScale - bScale))) / denominator
  } else {
    scaled = (numerator * 10n ** PRECISION) / (denominator * 10n ** BigInt(bScale - aScale))
  }
  return Number(scaled) / 10 ** 18
}

export interface LiquidityPreview { base: bigint; quote: bigint; lp: bigint }

// Constant-product preview for a single-asset deposit or pro-rata LP redemption.
export function previewLiquidity(mode: 'deposit' | 'withdraw', amount: bigint, baseReserve?: string, quoteReserve?: string, lpSupply?: string): LiquidityPreview | null {
  if (!baseReserve || !quoteReserve || !lpSupply) return null
  const base = BigInt(baseReserve)
  const quote = BigInt(quoteReserve)
  const lp = BigInt(lpSupply)
  if (base === 0n || lp === 0n) return null
  if (mode === 'deposit') {
    return { base: amount, quote: (amount * quote) / base, lp: (amount * lp) / base }
  }
  return { base: (base * amount) / lp, quote: (quote * amount) / lp, lp: amount }
}

// The output the swap contract guarantees: the quote minus the slippage
// tolerance, rounded down. The API rejects a minimum of zero.
export function minimumSwapOutput(quotedOutput: bigint, slippageBps: number): bigint {
  return (quotedOutput * BigInt(10_000 - slippageBps)) / 10_000n
}

// Mirrors the API's swapFundingSats: the BTC the wallet sends with a swap.
export function swapFundingSats(sellAmount: bigint, sellAssetId: string, carrierFeeSats: string | bigint): bigint {
  return DUST_SATS + (sellAssetId === 'btc' ? sellAmount : BigInt(carrierFeeSats))
}

// The BTC carrier a deposit sends: dust plus the base reserve when it is native BTC.
export function depositFundingSats(baseAssetId: string, baseAmount: bigint): bigint {
  return DUST_SATS + (baseAssetId === 'btc' ? baseAmount : 0n)
}
