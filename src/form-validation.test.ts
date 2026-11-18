import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstFormError, MAX_WALLET_AMOUNT, parseDisplayAmount, rawAmount, validateAssetForm, validatePoolForm } from './form-validation.ts'

test('parseDisplayAmount converts display units to exact raw integers', () => {
  assert.deepEqual(parseDisplayAmount('1.5', 8), { raw: 150_000_000n })
  assert.deepEqual(parseDisplayAmount('1000', 0), { raw: 1000n })
})

test('parseDisplayAmount rejects invalid input', () => {
  assert.ok('error' in parseDisplayAmount('', 8))
  assert.ok('error' in parseDisplayAmount('abc', 8))
  assert.ok('error' in parseDisplayAmount('1.2.3', 8))
  assert.ok('error' in parseDisplayAmount('1.123456789', 8))
  assert.ok('error' in parseDisplayAmount('0', 8))
  assert.ok('error' in parseDisplayAmount('0.00000000', 8))
  assert.ok('error' in parseDisplayAmount((MAX_WALLET_AMOUNT + 1n).toString(), 0))
})

test('rawAmount returns the raw value or null', () => {
  assert.equal(rawAmount('2.5', 8), 250_000_000n)
  assert.equal(rawAmount('nope', 8), null)
})

test('validateAssetForm accepts a valid asset and rejects bad fields', () => {
  const valid = validateAssetForm({ name: 'Foo', ticker: 'FOO', supply: '1000', decimals: '0', icon: '' })
  assert.deepEqual(valid.valid, { name: 'Foo', ticker: 'FOO', supply: 1000n, decimals: 0 })
  assert.ok('name' in validateAssetForm({ name: '', ticker: 'FOO', supply: '1', decimals: '0', icon: '' }).errors)
  assert.ok('ticker' in validateAssetForm({ name: 'Foo', ticker: 'foo', supply: '1', decimals: '0', icon: '' }).errors)
  assert.ok('decimals' in validateAssetForm({ name: 'Foo', ticker: 'FOO', supply: '1', decimals: '19', icon: '' }).errors)
  assert.ok('icon' in validateAssetForm({ name: 'Foo', ticker: 'FOO', supply: '1', decimals: '0', icon: 'http://x' }).errors)
  assert.ok('supply' in validateAssetForm({ name: 'Foo', ticker: 'FOO', supply: '1.5', decimals: '0', icon: '' }).errors)
})

test('validatePoolForm enforces asset selection and native-base rules', () => {
  const base = { ticker: 'BTC', decimals: 8, balance: 1_000_000n }
  const quote = { ticker: 'FOO', decimals: 0, balance: 5000n }
  const errors = validatePoolForm(
    { baseAssetId: 'btc', quoteAssetId: 'btc', baseAmount: '0.001', quoteAmount: '100', feeBps: '100', protocolFeeBps: '30' },
    { base, quote, creationFeeSats: 10_000n },
  ).errors
  assert.ok('quoteAssetId' in errors)
})

test('validatePoolForm flags an existing pair and over-balance reserves', () => {
  const base = { ticker: 'BTC', decimals: 8, balance: 1_000_000n }
  const quote = { ticker: 'FOO', decimals: 0, balance: 5000n }
  assert.ok('quoteAssetId' in validatePoolForm(
    { baseAssetId: 'btc', quoteAssetId: 'foo', baseAmount: '0.001', quoteAmount: '100', feeBps: '100', protocolFeeBps: '30' },
    { base, quote, creationFeeSats: 10_000n, existingPairName: 'BTC / FOO' },
  ).errors)
  assert.ok('quoteAmount' in validatePoolForm(
    { baseAssetId: 'btc', quoteAssetId: 'foo', baseAmount: '0.001', quoteAmount: '99999', feeBps: '100', protocolFeeBps: '30' },
    { base, quote, creationFeeSats: 10_000n },
  ).errors)
})

test('validatePoolForm requires a protocol fee below the total fee', () => {
  const base = { ticker: 'BTC', decimals: 8, balance: 1_000_000n }
  const quote = { ticker: 'FOO', decimals: 0, balance: 5000n }
  assert.ok('protocolFeeBps' in validatePoolForm(
    { baseAssetId: 'btc', quoteAssetId: 'foo', baseAmount: '0.001', quoteAmount: '100', feeBps: '100', protocolFeeBps: '20' },
    { base, quote, creationFeeSats: 10_000n },
  ).errors)
  assert.ok('protocolFeeBps' in validatePoolForm(
    { baseAssetId: 'btc', quoteAssetId: 'foo', baseAmount: '0.001', quoteAmount: '100', feeBps: '100', protocolFeeBps: '100' },
    { base, quote, creationFeeSats: 10_000n },
  ).errors)
})

test('validatePoolForm accepts a funded pair', () => {
  const base = { ticker: 'BTC', decimals: 8, balance: 1_000_000n }
  const quote = { ticker: 'FOO', decimals: 0, balance: 5000n }
  const result = validatePoolForm(
    { baseAssetId: 'btc', quoteAssetId: 'foo', baseAmount: '0.001', quoteAmount: '100', feeBps: '100', protocolFeeBps: '30' },
    { base, quote, creationFeeSats: 10_000n },
  )
  assert.deepEqual(result.valid, { baseAmount: 100_000n, quoteAmount: 100n, feeBps: 100, protocolFeeBps: 30 })
})

test('firstFormError reports the first field in label order', () => {
  type Fields = { name: string; ticker: string; decimals: string }
  assert.equal(firstFormError<Fields>({ ticker: 'Enter a ticker', decimals: 'Whole number' }, { name: 'Name', ticker: 'Ticker', decimals: 'Decimals' }), 'Ticker: Enter a ticker')
  assert.equal(firstFormError<{ name: string }>({}, { name: 'Name' }), null)
})
