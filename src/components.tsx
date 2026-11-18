import { api } from './api'
import { type PriceTimeframe } from './format'
import { decimalRatio } from './math'
import { PriceChart, type ChartPoint } from './PriceChart'
import { describeRequest, type RequestProgress } from './requests'
import type { Pool, PriceHistory } from './types'

export function TokenMark({ label, warm = false }: { label: string; warm?: boolean }) {
  return <span className={`token-mark ${warm ? 'warm' : ''}`}>{label.slice(0, 1).toUpperCase()}</span>
}

export function Spinner() { return <span className="spinner" aria-hidden="true" /> }

// Empty fields stay quiet; the submit button already says what is missing.
export function FieldError({ message, value }: { message?: string; value: string }) {
  if (!message || value.trim() === '') return null
  return <span className="field-error" role="alert">{message}</span>
}

export function RequestNotice({ noun, request, busy, onDismiss, onRetryRegistration }: {
  noun: string; request: RequestProgress; busy: boolean; onDismiss: () => void; onRetryRegistration: () => void
}) {
  const { title, detail } = describeRequest(noun, request)
  const paymentUnregistered = request.status === 'pending-funding' && Boolean(request.fundingTxid)
  return <div className={`notice status ${request.status}`}>
    <b>{title}</b><span>{detail}</span>
    {request.status === 'failed' && <button type="button" className="notice-dismiss" onClick={onDismiss}>Dismiss</button>}
    {paymentUnregistered && <button type="button" className="notice-dismiss" onClick={onRetryRegistration} disabled={busy}>Retry registration</button>}
    {request.status !== 'failed' && !paymentUnregistered && <i />}
  </div>
}

export function PoolPriceChart({ pool, baseTicker, quoteTicker, baseDecimals, quoteDecimals }: {
  pool: Pool; baseTicker: string; quoteTicker: string; baseDecimals: number; quoteDecimals: number
}) {
  const load = (timeframe: PriceTimeframe, signal: AbortSignal): Promise<ChartPoint[]> =>
    api<PriceHistory>(`/v1/pools/${encodeURIComponent(pool.id)}/prices?timeframe=${timeframe}`, { signal })
      .then((history) => (Array.isArray(history.points) ? history.points : [])
        .map((point) => ({ recordedAt: point.recordedAt, price: decimalRatio(point.baseReserve, point.quoteReserve, quoteDecimals, baseDecimals) })))
  return <PriceChart
    gradientId={`price-fill-${pool.id}`}
    unitTicker={baseTicker}
    perTicker={quoteTicker}
    satsMode="btc"
    footerNormal={`Normalized using ${baseTicker} (${baseDecimals}) and ${quoteTicker} (${quoteDecimals}) decimals`}
    footerSats="Marginal spot shown in sats · settlement uses whole sats"
    emptyMessage={(timeframe) => timeframe === '30d' ? 'No recorded price history for this pool yet.' : 'No price updates in this timeframe. Try a longer range.'}
    showGraduation={false}
    ariaLabel={`${baseTicker} per ${quoteTicker} price chart`}
    load={load}
  />
}
