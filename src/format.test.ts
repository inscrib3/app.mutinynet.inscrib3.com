import { test } from 'node:test'
import assert from 'node:assert/strict'
import { btc, comma, displayAmount, editableAmount, formatPrice, poolAssetTickers, ratio, short } from './format.ts'

test('poolAssetTickers derives the issued tickers from the pool name', () => {
  assert.deepEqual(poolAssetTickers('BTC / HFSP'), { stem: 'BTCHFSP', control: 'BTCHFSP-CTRL', lp: 'BTCHFSP-LP', ledger: 'BTCHFSP-LEDGER' })
  assert.deepEqual(poolAssetTickers('LONGTICKER / OTHER'), { stem: 'LONGTICKE', control: 'LONGTICKE-CTRL', lp: 'LONGTICKE-LP', ledger: 'LONGTICKE-LEDGER' })
  assert.equal(poolAssetTickers('/ ').stem, 'POOL')
})

test('ratio renders integer-exact fractions as strings', () => {
  assert.equal(ratio(1n, 2n), '0.5')
  assert.equal(ratio(0n, 2n), '0')
  assert.equal(ratio(1n, 0n), '—')
  assert.equal(ratio(1n, 3n), '0.33333333')
  assert.equal(ratio(1n, 3n, 18), '0.333333333333333333')
})

test('ratio does not render a sub-satoshi ratio as zero', () => {
  assert.equal(ratio(1n, 1_000_000_000n), '0.000000001')
})

test('displayAmount converts raw units to display units', () => {
  assert.equal(displayAmount(150_000_000n, 8), '1.5')
  assert.equal(displayAmount(150_000_000n, 8, 8), '1.5')
  assert.equal(displayAmount(1n, 8, 8), '0.00000001')
  assert.equal(displayAmount(1000n, 0), (1000n).toLocaleString())
})

test('editableAmount produces a lossless editable string', () => {
  assert.equal(editableAmount(150_000_000n, 8), '1.5')
  assert.equal(editableAmount(1000n, 0), '1000')
  assert.equal(editableAmount(1n, 8), '0.00000001')
})

test('formatPrice formats small, large, and non-finite values', () => {
  assert.equal(formatPrice(0), '0')
  assert.equal(formatPrice(0.5), '0.5')
  assert.equal(formatPrice(Number.NaN), '—')
  assert.equal(formatPrice(1e-10), '0.0000000001')
})

test('short truncates long identifiers around the middle', () => {
  assert.equal(short('abcdefghij', 3), 'abc…hij')
  assert.equal(short('abc'), 'abc')
})

test('comma and btc format counts and satoshis', () => {
  assert.equal(comma(5n), '5')
  assert.equal(comma(1234567n), (1234567n).toLocaleString())
  assert.equal(btc(100_000_000n), '1 BTC')
  assert.equal(btc('50000000'), '0.5 BTC')
})
