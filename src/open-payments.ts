// Requests the wallet may already have paid survive a page reload here, so the
// app keeps the pay button locked and can finish registering the payment.
export interface SavedPayment { id: string; fundingTxid?: string }
export type PaymentKind = 'swap' | 'liquidity' | 'poolCreation'
type SavedPayments = Partial<Record<PaymentKind, SavedPayment>>

const STORAGE_KEY = 'inscrib3.open-payments'

export function loadSavedPayments(): SavedPayments {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? parsed as SavedPayments : {}
  } catch { return {} }
}

export function savePayment(kind: PaymentKind, payment: SavedPayment | null): void {
  const next = loadSavedPayments()
  if (payment) next[kind] = payment
  else delete next[kind]
  // Blocked storage only means the lock lasts until reload instead of across it.
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { return }
}
