import { short } from './format'
import type { SwapRequest } from './types'

export interface RequestProgress { status: SwapRequest['status']; fundingTxid?: string; settlementTxid?: string; error?: string }

export function describeRequest(noun: string, request: RequestProgress): { title: string; detail: string } {
  switch (request.status) {
    case 'settled': return { title: `${noun} complete`, detail: `Settlement ${short(request.settlementTxid ?? '')}` }
    case 'failed': return { title: `${noun} failed`, detail: request.error ?? 'The request could not be completed.' }
    case 'refunded': return { title: `${noun} refunded`, detail: `Refund ${short(request.settlementTxid ?? '')}. Your funds are back, so you can retry.` }
    case 'funded':
    case 'sweeping': return { title: `${noun} funded`, detail: 'Waiting for the next pool sweep…' }
    case 'pending-funding': return request.fundingTxid
      ? { title: 'Payment sent, not registered yet', detail: `Payment ${short(request.fundingTxid, 7)} reached the contract, but the server has not registered it. Retry registration; do not pay again.` }
      : { title: `${noun} created`, detail: 'Waiting for the wallet payment…' }
  }
}
