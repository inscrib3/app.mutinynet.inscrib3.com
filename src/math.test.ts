import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decimalRatio, depositFundingSats, DUST_SATS, maxBigInt, minimumSwapOutput, previewLiquidity, swapFundingSats } from './math.ts'

test('minimumSwapOutput applies slippage and rounds down, reaching zero for dust outputs', () => {
  assert.equal(minimumSwapOutput(10_000n, 50), 9_950n)
  assert.equal(minimumSwapOutput(1n, 50), 0n)
  assert.equal(minimumSwapOutput(1n, 0), 1n)
})

test('decimalRatio divides two integer strings without intermediate Number overflow', () => {
  assert.equal(decimalRatio('1', '2', 0, 0), 0.5)
  assert.equal(decimalRatio('2', '1', 0, 0), 2)
  assert.equal(decimalRatio('0', '5', 0, 0), 0)
  assert.ok(Number.isNaN(decimalRatio('1', '0', 0, 0)))
})

test('decimalRatio applies the scale exponent difference', () => {
  assert.equal(decimalRatio('1', '1', 8, 0), 100_000_000)
  assert.equal(decimalRatio('1', '1', 0, 8), 1e-8)
})

test('decimalRatio keeps a small relative difference that Number division would flatten', () => {
  // Both reserves sit beyond Number's safe range; their ratio is not exactly 1.
  const result = decimalRatio('10000000000000001', '10000000000000000', 0, 0)
  assert.ok(result > 1)
  // The naive Number division collapses to exactly 1.
  assert.equal(Number('10000000000000001') / Number('10000000000000000'), 1)
})

test('previewLiquidity deposit and withdraw follow the constant-product ratio', () => {
  assert.deepEqual(previewLiquidity('deposit', 100n, '1000', '2000', '500'), { base: 100n, quote: 200n, lp: 50n })
  assert.deepEqual(previewLiquidity('withdraw', 50n, '1000', '2000', '500'), { base: 100n, quote: 200n, lp: 50n })
})

test('previewLiquidity rejects empty or unseeded pools', () => {
  assert.equal(previewLiquidity('deposit', 100n, '0', '2000', '500'), null)
  assert.equal(previewLiquidity('deposit', 100n, undefined, '2000', '500'), null)
  assert.equal(previewLiquidity('deposit', 100n, '1000', '2000', undefined), null)
})

test('swapFundingSats includes dust plus the native side or the carrier fee', () => {
  assert.equal(swapFundingSats(1000n, 'btc', '0'), DUST_SATS + 1000n)
  assert.equal(swapFundingSats(1000n, 'asset', '500'), DUST_SATS + 500n)
})

test('depositFundingSats includes dust plus the base reserve only when native', () => {
  assert.equal(depositFundingSats('btc', 1000n), DUST_SATS + 1000n)
  assert.equal(depositFundingSats('asset', 1000n), DUST_SATS)
})

test('maxBigInt picks the larger value', () => {
  assert.equal(maxBigInt(1n, 2n), 2n)
  assert.equal(maxBigInt(-5n, -10n), -5n)
})
