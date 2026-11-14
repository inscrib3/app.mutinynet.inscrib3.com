import { useCallback, useEffect, useState } from 'react'
import { parseDisplayAmount } from './form-validation'

const API = import.meta.env.VITE_API_URL ?? '/api'

export type LaunchPhase = 'preparing' | 'curve' | 'graduating' | 'pool' | 'rescued' | 'failed'
export type LaunchSort = 'newest' | 'graduating' | 'trending'

export interface Launch {
  id: string
  name: string
  ticker: string
  description: string
  iconUrl?: string
  creatorAddress: string
  creatorFeeAddress: string
  assetId?: string
  curveAddress?: string
  poolId?: string
  protocolGeneration: 'curve-v1'
  poolGeneration: 'launch-amm-v1'
  phase: LaunchPhase
  decimals: number
  economics: { supply: string; virtualBtc: string; graduationThreshold: string; reservedTokens: string; creatorFeeBps: number; protocolFeeBps: number }
  realBtcReserve: string
  tokenReserve: string
  volumeBtc: string
  tradeCount: number
  trades24h: number
  volumeBtc24h: string
  onFire: boolean
  progressBps: number
  sellableTokens: string
  createdAt: number
}

interface Page<T> { items: T[]; total: number; nextCursor?: string }
interface Simulation {
  protocolGeneration: 'curve-v1'
  supply: string
  virtualBtc: string
  graduationThreshold: string
  reservedTokens: string
  sellableTokens: string
  creatorFeeBps: number
  protocolFeeBps: number
  quote?: { outputAmount: string; spentAmount: string; refundAmount: string; creatorFee: string; protocolFee: string; next: { realBtcReserve: string; tokenReserve: string }; graduates: boolean }
}
interface LaunchQuoteResponse {
  venue: 'curve' | 'pool'
  creatorFeeBps: number
  protocolFeeBps: number
  quote: { outputAmount: string; spentAmount: string; refundAmount: string; creatorFee: string; protocolFee: string; graduates: boolean; next: { realBtcReserve: string; tokenReserve: string } }
}
interface LaunchTrade { id: string; venue: 'curve' | 'pool'; side: 'buy' | 'sell'; payAddress: string; inputAmount: string; outputAmount: string; txid: string; createdAt: number }
interface LaunchRequest { id: string; launchId: string; venue: 'curve' | 'pool'; side: 'buy' | 'sell'; contractAddress: string; inputAmount: string; minOutput: string; fundingSats: string; rewardPoints: string; fundingTxid?: string; settlementTxid?: string; status: 'pending-funding' | 'funded' | 'settling' | 'settled' | 'refunded' | 'failed'; error?: string }
interface BootstrapResponse { launchId: string; contractAddress: string; fundingSats: string; fundingTxid?: string; settlementTxid?: string; status: 'awaiting-funding' | 'funded' | 'opening' | 'opened' | 'refunded' | 'failed'; error?: string }
type LaunchPriceTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '24h' | '7d' | '30d'
interface LaunchPricePoint { txid: string; venue: 'curve' | 'pool'; btcReserve: string; pricingBtcReserve: string; tokenReserve: string; recordedAt: number }
interface LaunchPriceHistory { launchId: string; timeframe: LaunchPriceTimeframe; priceUnit: 'raw-reserves'; points: LaunchPricePoint[] }
type FundContract = (address: string, side: 'buy' | 'sell' | 'bootstrap', input: bigint, sats: bigint, tokenAssetId?: string, controlAssetId?: string, popup?: Window) => Promise<string>

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

const compact = (value: string | bigint) => BigInt(value).toLocaleString()
const short = (value: string, edge = 6) => value.length > edge * 2 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value
const btc = (sats: string) => `${(Number(sats) / 100_000_000).toLocaleString(undefined, { maximumFractionDigits: 8 })} BTC`
const LAUNCH_DUST_SATS = 330n

function displayUnits(value: string | bigint, decimals: number, precision = 8): string {
  const raw = BigInt(value)
  if (decimals === 0) return raw.toLocaleString()
  const scale = 10n ** BigInt(decimals); const whole = raw / scale
  const fraction = (raw % scale).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '')
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString()
}

function editableUnits(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString()
  const scale = 10n ** BigInt(decimals); const whole = value / scale
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

function LaunchMark({ launch }: { launch: Pick<Launch, 'ticker' | 'iconUrl'> }) {
  return launch.iconUrl
    ? <img className="launch-icon" src={launch.iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
    : <span className="launch-icon launch-icon-fallback">{launch.ticker.slice(0, 2)}</span>
}

function PhasePill({ phase }: { phase: LaunchPhase }) {
  return <span className={`launch-phase ${phase}`}>{phase === 'curve' ? 'Bonding curve' : phase === 'pool' ? 'Graduated' : phase}</span>
}

const LAUNCH_PRICE_TIMEFRAMES: LaunchPriceTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '24h', '7d', '30d']

function launchPrice(point: LaunchPricePoint, decimals: number): number {
  return (Number(point.pricingBtcReserve) / Number(point.tokenReserve)) * 10 ** decimals / 100_000_000
}

function chartPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  if (Math.abs(value) < 0.00000001) {
    const decimalPlaces = Math.min(18, Math.max(8, 6 - Math.floor(Math.log10(Math.abs(value)))))
    const decimal = value.toFixed(decimalPlaces).replace(/0+$/, '').replace(/\.$/, '')
    return decimal === '0' || decimal === '-0' ? value.toExponential(6) : decimal
  }
  return value.toLocaleString(undefined, { maximumSignificantDigits: 10 })
}

function chartTime(timestamp: number, timeframe: LaunchPriceTimeframe): string {
  const date = new Date(timestamp)
  if (timeframe === '1m' || timeframe === '5m') return date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
  if (timeframe === '7d' || timeframe === '30d') return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function LaunchPriceChart({ launch }: { launch: Launch }) {
  const [timeframe, setTimeframe] = useState<LaunchPriceTimeframe>('4h')
  const [points, setPoints] = useState<LaunchPricePoint[]>([])
  const [chartError, setChartError] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = () => request<LaunchPriceHistory>(`/v1/launches/${encodeURIComponent(launch.id)}/prices?timeframe=${timeframe}`, { signal: controller.signal })
      .then((history) => { setPoints(Array.isArray(history.points) ? history.points : []); setChartError('') })
      .catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setChartError(cause instanceof Error ? cause.message : String(cause)) })
    void load()
    const refresh = window.setInterval(() => void load(), 15_000)
    return () => { controller.abort(); window.clearInterval(refresh) }
  }, [launch.id, timeframe])

  const series = points.map((point) => ({ ...point, price: launchPrice(point, launch.decimals) })).filter((point) => Number.isFinite(point.price))
  const prices = series.map((point) => point.price); const latest = prices.at(-1); const first = prices[0]
  const change = first && latest !== undefined ? ((latest - first) / first) * 100 : 0
  const min = prices.length ? Math.min(...prices) : 0; const max = prices.length ? Math.max(...prices) : 0
  const spread = max - min || Math.max(Math.abs(max) * 0.02, 1e-12)
  const firstTime = series[0]?.recordedAt ?? 0; const lastTime = series.at(-1)?.recordedAt ?? firstTime
  const coordinates = series.map((point) => ({
    x: firstTime === lastTime ? 300 : 18 + ((point.recordedAt - firstTime) / (lastTime - firstTime)) * 564,
    y: 162 - ((point.price - (min - spread * 0.08)) / (spread * 1.16)) * 144,
  }))
  const line = coordinates.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const lastCoordinate = coordinates.at(-1); const hoveredCoordinate = hoveredIndex === null ? undefined : coordinates[hoveredIndex]
  const hoveredPoint = hoveredIndex === null ? undefined : series[hoveredIndex]
  const displayInSats = latest !== undefined && latest > 0 && latest < 0.00000001
  const displayUnit = displayInSats ? 'sats' : 'BTC'
  const displayPrice = (value: number) => chartPrice(value * (displayInSats ? 100_000_000 : 1))
  const graduationIndex = series.findIndex((point, index) => point.venue === 'pool' && series.slice(0, index).some((earlier) => earlier.venue === 'curve'))
  const graduationCoordinate = graduationIndex >= 0 ? coordinates[graduationIndex] : undefined
  const emptyMessage = launch.phase === 'preparing' ? 'The price chart appears after the first settled trade.' : 'No price updates in this timeframe. Try a longer range.'

  return <section className="price-chart launch-price-chart">
    <div className="price-chart-head"><div><span>CONTINUOUS PRICE · CURVE → PERMANENT POOL</span><div><h3>{displayUnit} per {launch.ticker}</h3>{latest !== undefined && <b>{displayPrice(latest)}</b>}<em className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</em></div></div>
      <div className="price-timeframes">{LAUNCH_PRICE_TIMEFRAMES.map((value) => <button key={value} className={timeframe === value ? 'active' : ''} onClick={() => setTimeframe(value)}>{value.toUpperCase()}</button>)}</div></div>
    <div className="price-chart-canvas" onPointerMove={(event) => {
      if (!coordinates.length) return
      const bounds = event.currentTarget.getBoundingClientRect(); const contentWidth = Math.max(bounds.width - 28, 1)
      const x = Math.min(600, Math.max(0, ((event.clientX - bounds.left - 14) / contentWidth) * 600)); let nearest = 0
      for (let index = 1; index < coordinates.length; index += 1) if (Math.abs(coordinates[index]!.x - x) < Math.abs(coordinates[nearest]!.x - x)) nearest = index
      setHoveredIndex(nearest)
    }} onPointerLeave={() => setHoveredIndex(null)}>
      {prices.length ? <svg viewBox="0 0 600 180" role="img" aria-label={`${launch.ticker} launch price chart`} preserveAspectRatio="none">
        <defs><linearGradient id={`launch-price-fill-${launch.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity=".24" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
        {[36, 72, 108, 144].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} className="chart-grid" />)}
        {prices.length > 1 && <polygon points={`18,180 ${line} 582,180`} fill={`url(#launch-price-fill-${launch.id})`} />}<polyline points={line} className="chart-line" />
      </svg> : <div className="chart-empty">{chartError || emptyMessage}</div>}
      {prices.length > 0 && <div className="chart-overlay" aria-hidden="true">
        {graduationCoordinate && <><span className="launch-graduation-line" style={{ left: `${graduationCoordinate.x / 6}%` }} /><span className="launch-graduation-label" style={{ left: `${graduationCoordinate.x / 6}%` }}>GRADUATED</span></>}
        {lastCoordinate && <span className="chart-marker chart-last" style={{ left: `${lastCoordinate.x / 6}%`, top: `${lastCoordinate.y / 1.8}%` }} />}
        {hoveredCoordinate && hoveredPoint && <><span className="chart-hover-guide" style={{ left: `${hoveredCoordinate.x / 6}%` }} /><span className="chart-marker chart-hover-marker" style={{ left: `${hoveredCoordinate.x / 6}%`, top: `${hoveredCoordinate.y / 1.8}%` }} />
          <div className="chart-tooltip" style={{ left: `${hoveredCoordinate.x / 6}%`, top: `${hoveredCoordinate.y / 1.8}%`, transform: hoveredCoordinate.x > 450 ? 'translate(calc(-100% - 12px), calc(-100% - 10px))' : 'translate(12px, calc(-100% - 10px))' }}>
            <span>{hoveredPoint.venue === 'curve' ? 'Bonding curve' : 'Permanent pool'}</span><b>{displayPrice(hoveredPoint.price)} {displayUnit}</b><small>{new Date(hoveredPoint.recordedAt).toLocaleString()}</small><small>{btc(hoveredPoint.btcReserve)} · {compact(hoveredPoint.tokenReserve)} {launch.ticker}</small>
          </div></>}
      </div>}
    </div>
    <div className="price-chart-foot"><span>{series[0] ? chartTime(series[0].recordedAt, timeframe) : '—'}</span><span>{displayInSats ? `Marginal spot shown in sats · settlement uses whole sats · ${launch.decimals} token decimals` : `Virtual BTC prices the curve; real BTC prices the pool · ${launch.decimals} token decimals`}</span><span>{series.at(-1) ? chartTime(series.at(-1)!.recordedAt, timeframe) : '—'}</span></div>
  </section>
}

export function LaunchesPage({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const [items, setItems] = useState<Launch[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<LaunchSort>('newest')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController(); const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ limit: '100', sort }); if (search.trim()) query.set('q', search.trim())
      setLoading(true)
      request<Page<Launch>>(`/v1/launches?${query}`, { signal: controller.signal })
        .then((page) => { setItems(page.items); setTotal(page.total); setError('') })
        .catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) })
        .finally(() => setLoading(false))
    }, 200)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [search, sort])

  return <section className="view-page launches-page">
    <div className="view-heading"><div><span className="eyebrow"><i /> BITCOIN-NATIVE LAUNCHES</span><h1>Launches</h1><p>Fixed-supply assets that begin on a BTC bonding curve and graduate into locked liquidity.</p></div><button className="primary compact" onClick={onCreate}>Create a launch</button></div>
    <div className="launch-toolbar">
      <label className="search-field"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search launch, ticker or asset ID" />{search && <button onClick={() => setSearch('')} aria-label="Clear search">×</button>}</label>
      <div className="launch-sort">{(['newest', 'trending', 'graduating'] as const).map((value) => <button key={value} className={sort === value ? 'active' : ''} onClick={() => setSort(value)}>{value}</button>)}</div>
    </div>
    <div className="launch-count">{loading ? 'Loading launches…' : `${items.length} of ${total} launches`}</div>
    {error ? <div className="notice error"><b>Launches unavailable</b><span>{error}</span></div> : items.length === 0 && !loading ? <div className="empty-state launch-empty"><h2>The curve is being prepared</h2><p>No validated launches are indexed yet. Contracts remain gated until funded curve, graduation, locker and recovery tests pass.</p><button className="secondary" onClick={onCreate}>Preview launch economics</button></div> : <div className="launch-grid">{items.map((launch) => <button className="launch-card" key={launch.id} onClick={() => onOpen(launch.id)}>
      <div className="launch-card-head"><LaunchMark launch={launch} /><div><h2>{launch.name}</h2><span>${launch.ticker}</span></div><div className="launch-card-badges">{launch.onFire && <span className="fire-badge" title={`${launch.trades24h} settled trades in the last 24 hours`}>🔥 On fire</span>}<PhasePill phase={launch.phase} /></div></div>
      <p>{launch.description || 'No description provided.'}</p>
      <div className="launch-metrics"><div><span>Raised</span><b>{btc(launch.realBtcReserve)}</b></div><div><span>Trades · 24h</span><b>{launch.trades24h.toLocaleString()}</b></div><div><span>Volume · 24h</span><b>{btc(launch.volumeBtc24h)}</b></div></div>
      <div className="launch-progress"><div><span>Graduation</span><b>{(launch.progressBps / 100).toFixed(2)}%</b></div><i><span style={{ width: `${launch.progressBps / 100}%` }} /></i></div>
      <div className="launch-card-foot"><code>{launch.assetId ? short(launch.assetId, 8) : 'Asset preparing'}</code><span>View launch →</span></div>
    </button>)}</div>}
  </section>
}

export function LaunchDetailPage({ id, onBack, tradingEnabled, walletAddress, walletBalance, walletBalancesAvailable, popupWallet, refreshWallet, connectWallet, prepareFunding, fundContract, referralCode }: {
  id: string; onBack: () => void; tradingEnabled: boolean; walletAddress: string; walletBalance: (assetId: string) => bigint; walletBalancesAvailable: boolean; popupWallet: boolean; refreshWallet: () => Promise<void>;
  connectWallet: () => void; prepareFunding?: () => Window; fundContract: FundContract; referralCode?: string
}) {
  const [launch, setLaunch] = useState<Launch | null>(null); const [trades, setTrades] = useState<LaunchTrade[]>([]); const [error, setError] = useState('')
  const [side, setSide] = useState<'buy' | 'sell'>('buy'); const [amount, setAmount] = useState(''); const [quote, setQuote] = useState<LaunchQuoteResponse | null>(null); const [quoteBusy, setQuoteBusy] = useState(false); const [quoteError, setQuoteError] = useState('')
  const [tradeRequest, setTradeRequest] = useState<LaunchRequest | null>(null); const [tradeBusy, setTradeBusy] = useState(false)
  const [reloadCount, setReloadCount] = useState(0)
  useEffect(() => { const controller = new AbortController(); Promise.all([
    request<Launch>(`/v1/launches/${encodeURIComponent(id)}`, { signal: controller.signal }),
    request<{ items: LaunchTrade[] }>(`/v1/launches/${encodeURIComponent(id)}/activity?limit=10`, { signal: controller.signal }),
  ]).then(([next, activity]) => { setLaunch(next); setTrades(activity.items) }).catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) }); return () => controller.abort() }, [id, reloadCount])
  // A finished trade changes reserves and activity, so the page reloads them.
  const applyTradeRequest = useCallback((next: LaunchRequest) => {
    setTradeRequest(next)
    if (next.status === 'settled' || next.status === 'refunded') { setReloadCount((count) => count + 1); void refreshWallet() }
  }, [refreshWallet])
  function clearTradeForm() { setAmount(''); setQuote(null); setQuoteError(''); setQuoteBusy(false) }
  useEffect(() => {
    if (!launch || !['curve', 'pool'].includes(launch.phase) || amount.trim() === '') return
    const parsed = parseDisplayAmount(amount, side === 'buy' ? 8 : launch.decimals)
    if (!('raw' in parsed)) return
    const controller = new AbortController(); let active = true
    const timer = window.setTimeout(() => {
      setQuoteBusy(true)
      void request<LaunchQuoteResponse>(`/v1/launches/${encodeURIComponent(id)}/quote?side=${side}&amount=${parsed.raw}`, { signal: controller.signal })
        .then((next) => { if (active) setQuote(next) })
        .catch((cause: unknown) => { if (active && (cause as Error).name !== 'AbortError') setQuoteError(cause instanceof Error ? cause.message : String(cause)) })
        .finally(() => { if (active) setQuoteBusy(false) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [amount, id, launch, side])
  useEffect(() => {
    if (!tradeRequest || !['funded', 'settling'].includes(tradeRequest.status)) return
    const timer = window.setInterval(() => request<LaunchRequest>(`/v1/launch-requests/${tradeRequest.id}`).then(applyTradeRequest).catch(() => undefined), 3_000)
    return () => window.clearInterval(timer)
  }, [applyTradeRequest, tradeRequest])
  async function trade() {
    if (!walletAddress) { connectWallet(); return }
    const parsed = launch ? parseDisplayAmount(amount, side === 'buy' ? 8 : launch.decimals) : { error: 'Launch unavailable' }
    if (!launch?.assetId || !quote || !('raw' in parsed)) { setError('Enter an amount and wait for the current quote before funding.'); return }
    let walletPopup: Window | undefined
    try { walletPopup = prepareFunding?.() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return }
    setTradeBusy(true); setError(''); let fundingTxid: string | undefined; let fundingStarted = false
    try {
      const intent = await request<LaunchRequest>(`/v1/launches/${encodeURIComponent(id)}/trades`, { method: 'POST', body: JSON.stringify({
        payAddress: walletAddress, side, inputAmount: parsed.raw.toString(), minOutput: quote.quote.outputAmount, ...(referralCode ? { referralCode } : {}),
      }) });
      setTradeRequest(intent)
      fundingStarted = true
      fundingTxid = await fundContract(intent.contractAddress, side, BigInt(intent.inputAmount), BigInt(intent.fundingSats), launch.assetId, undefined, walletPopup)
      setTradeRequest({ ...intent, fundingTxid }); clearTradeForm()
      applyTradeRequest(await request<LaunchRequest>(`/v1/launch-requests/${intent.id}/funding`, { method: 'POST', body: JSON.stringify({ txid: fundingTxid }) }))
    } catch (cause) {
      if (!fundingStarted && walletPopup && !walletPopup.closed) walletPopup.close()
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(fundingTxid ? `Payment ${short(fundingTxid, 7)} was sent. Do not pay again; retry registration or refund after synchronization. ${message}` : message)
    } finally { setTradeBusy(false) }
  }
  async function refundTrade() {
    if (!tradeRequest) return; setTradeBusy(true); setError('')
    try { applyTradeRequest(await request<LaunchRequest>(`/v1/launch-requests/${tradeRequest.id}/refund`, { method: 'POST' })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setTradeBusy(false) }
  }
  if (error && !launch) return <section className="view-page"><button className="back-link" onClick={onBack}>← All launches</button><div className="notice error"><b>Launch unavailable</b><span>{error}</span></div></section>
  if (!launch) return <section className="view-page"><div className="empty-state">Reading the launch…</div></section>
  const curveOpen = launch.phase === 'curve'
  const tradeInProgress = Boolean(tradeRequest && !['settled', 'refunded', 'failed'].includes(tradeRequest.status))
  const inputDecimals = side === 'buy' ? 8 : launch.decimals
  const outputDecimals = side === 'buy' ? launch.decimals : 8
  const inputTicker = side === 'buy' ? 'BTC' : launch.ticker
  const outputTicker = side === 'buy' ? launch.ticker : 'BTC'
  const inputAssetId = side === 'buy' ? 'btc' : launch.assetId ?? ''
  const amountCheck = parseDisplayAmount(amount, inputDecimals)
  const inputRaw = 'raw' in amountCheck ? amountCheck.raw : null
  const inputBalance = walletAddress && inputAssetId ? walletBalance(inputAssetId) : 0n
  const btcWalletBalance = walletAddress ? walletBalance('btc') : 0n
  const balanceBlocker = !walletAddress || !inputRaw ? null
    : !walletBalancesAvailable ? null
    : side === 'buy' && inputRaw + LAUNCH_DUST_SATS > btcWalletBalance ? 'Insufficient BTC balance (330 sat carrier included)'
      : side === 'sell' && inputRaw > inputBalance ? `Insufficient ${launch.ticker} balance`
        : side === 'sell' && btcWalletBalance < LAUNCH_DUST_SATS ? 'At least 330 sats are required for the trade carrier' : null
  const setMax = () => {
    setQuote(null); setQuoteError(''); setQuoteBusy(false)
    setAmount(editableUnits(side === 'buy' ? (btcWalletBalance > LAUNCH_DUST_SATS ? btcWalletBalance - LAUNCH_DUST_SATS : 0n) : inputBalance, inputDecimals))
  }
  // Connecting needs no quote; funding a trade does.
  const tradeButtonDisabled = tradeBusy || (Boolean(walletAddress) && (!quote || tradeInProgress || Boolean(balanceBlocker)))
  const tradeButtonLabel = tradeBusy ? 'Waiting for wallet…' : !walletAddress ? 'Connect wallet' : balanceBlocker ?? (quoteBusy ? 'Finding best price…' : !quote ? 'Enter an amount' : 'Review & fund trade')
  return <section className="view-page launch-detail-page">
    <div className="launch-detail-hero"><button className="back-link" onClick={onBack}>← All launches</button><div className="launch-detail-title"><LaunchMark launch={launch} /><div><span className="eyebrow"><i /> {launch.protocolGeneration ?? 'CURVE-V1'}</span><h1>{launch.name}</h1><p>${launch.ticker} · created by <code>{short(launch.creatorAddress, 8)}</code></p></div></div><div className="launch-card-badges">{launch.onFire && <span className="fire-badge" title={`${launch.trades24h} settled trades in the last 24 hours`}>🔥 On fire</span>}<PhasePill phase={launch.phase} /></div></div>
    <div className="metric-grid"><div><span>Graduation</span><b>{(launch.progressBps / 100).toFixed(2)}%</b><small>{btc(launch.realBtcReserve)} of {btc(launch.economics.graduationThreshold)}</small></div><div><span>Available on curve</span><b>{displayUnits(launch.sellableTokens, launch.decimals)}</b><small>{launch.ticker} · {launch.decimals} decimals</small></div><div><span>Activity · 24h</span><b>{btc(launch.volumeBtc24h)}</b><small>{launch.trades24h.toLocaleString()} settled trades</small></div><div><span>Total fee</span><b>{((launch.economics.creatorFeeBps + launch.economics.protocolFeeBps) / 100).toFixed(2)}%</b><small>{launch.economics.creatorFeeBps / 100}% creator · {launch.economics.protocolFeeBps / 100}% protocol</small></div></div>
    <LaunchPriceChart launch={launch} />
    <div className="launch-detail-grid"><article className="token-detail-card"><div className="token-detail-head"><LaunchMark launch={launch} /><div><h2>Launch terms</h2><span>Immutable economics snapshot</span></div></div><dl><div><dt>Total supply</dt><dd>{displayUnits(launch.economics.supply, launch.decimals)} {launch.ticker}</dd></div><div><dt>Reserved for pool</dt><dd>{displayUnits(launch.economics.reservedTokens, launch.decimals)} {launch.ticker}</dd></div><div><dt>Virtual BTC</dt><dd>{btc(launch.economics.virtualBtc)}</dd></div><div><dt>Asset ID</dt><dd><code>{launch.assetId ? short(launch.assetId, 10) : 'Preparing'}</code></dd></div><div><dt>Protocol</dt><dd><code>{launch.protocolGeneration}</code></dd></div></dl></article>
      <article className="launch-trade-card">
        <span className="panel-label">{curveOpen ? 'CURVE TRADE' : launch.phase === 'pool' ? 'PERMANENT POOL TRADE' : 'LAUNCH STATUS'}</span>
        <h2>{curveOpen || launch.phase === 'pool' ? `Trade ${launch.ticker}` : 'Trading is not open'}</h2>
        <p>Enter display units. The app converts them into exact integer amounts before creating a wallet-reviewed funding contract.</p>
        {(curveOpen || launch.phase === 'pool') && <>
          <div className="launch-side-tabs"><button className={side === 'buy' ? 'active' : ''} onClick={() => { setSide('buy'); clearTradeForm() }}>Buy</button><button className={side === 'sell' ? 'active' : ''} onClick={() => { setSide('sell'); clearTradeForm() }}>Sell</button></div>
          <div className="launch-swap-box">
            <div className="launch-swap-top"><span>You pay</span><button type="button" onClick={setMax} disabled={!walletAddress || !walletBalancesAvailable || tradeInProgress}>Balance: {walletAddress && walletBalancesAvailable ? displayUnits(inputBalance, inputDecimals) : '—'} {walletBalancesAvailable && <b>MAX</b>}</button></div>
            <div className="launch-swap-main"><input value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); setQuoteError(''); setQuoteBusy(false); setError('') }} inputMode="decimal" placeholder="0" disabled={tradeInProgress} aria-label={`Amount of ${inputTicker} to pay`} /><span className="launch-token"><i>{inputTicker.slice(0, 1)}</i>{inputTicker}</span></div>
            <small>{side === 'buy' ? 'BTC display units · 8 decimals' : `${launch.name} · ${launch.decimals} decimals`}</small>
          </div>
          <div className="launch-swap-arrow">↓</div>
          <div className="launch-swap-box output">
            <div className="launch-swap-top"><span>You receive</span><em>{quoteBusy ? 'Finding price…' : quote ? 'Exact quote' : 'Enter an amount'}</em></div>
            <div className="launch-swap-main"><b>{quote ? displayUnits(quote.quote.outputAmount, outputDecimals, outputDecimals) : '0'}</b><span className="launch-token"><i>{outputTicker.slice(0, 1)}</i>{outputTicker}</span></div>
            <small>{side === 'buy' ? `${launch.name} · ${launch.decimals} decimals` : 'Native Bitcoin'}</small>
          </div>
          {amount && 'error' in amountCheck && <div className="launch-field-error">{amountCheck.error}</div>}
          {balanceBlocker && <div className="launch-field-error">{balanceBlocker}</div>}
          {quoteError && <div className="launch-field-error">{quoteError}</div>}
          {popupWallet && <div className="launch-popup-note">The connected Inscrib3 Wallet window shows every funding request for explicit approval.</div>}
          {quote && <div className="launch-quote-result"><div><span>Input sent to contract</span><b>{compact(inputRaw ?? 0n)} raw units</b></div><div><span>Total fees</span><b>{compact(BigInt(quote.quote.creatorFee) + BigInt(quote.quote.protocolFee))} sats</b></div>{BigInt(quote.quote.refundAmount) > 0n && <div><span>Final-fill refund</span><b>{displayUnits(quote.quote.refundAmount, 8)} BTC</b></div>}{quote.quote.graduates && <strong>This buy reaches graduation.</strong>}</div>}
        </>}
        {tradingEnabled ? <button className="primary" onClick={() => void trade()} disabled={tradeButtonDisabled}>{tradeButtonLabel}</button> : <button className="primary launch-disabled" disabled>Wallet trading disabled until funded validation</button>}
        {tradeRequest && <div className="launch-request-status"><b>{tradeRequest.status.replace('-', ' ')}</b><span>{tradeRequest.settlementTxid ? short(tradeRequest.settlementTxid, 7) : tradeRequest.fundingTxid ? short(tradeRequest.fundingTxid, 7) : short(tradeRequest.contractAddress, 7)}</span>{['funded', 'failed'].includes(tradeRequest.status) && <button className="secondary" onClick={() => void refundTrade()} disabled={tradeBusy}>Request refund</button>}</div>}
        <small>Never fund an address shown outside a wallet transaction preview.</small>
      </article></div>
    {error && <div className="notice error"><b>Quote unavailable</b><span>{error}</span></div>}<div className="notice asset-risk"><b>Experimental launch</b><span>Names and tickers are not unique. Verify the asset ID, fee policy, holder concentration and wallet transaction before signing.</span></div>
    <div className="activity-section-heading"><div><span className="eyebrow"><i /> INDEXED SETTLEMENTS</span><h2>Launch activity</h2><p>Verified curve and graduated-pool trades.</p></div></div><div className="activity-panel"><div className="activity-head"><span>Side</span><span>Input → output</span><span>Venue</span><span>Transaction</span></div>{trades.length === 0 ? <div className="empty-state">No indexed trades yet.</div> : trades.map((trade) => <div className="activity-row" key={trade.id}><div><span className="activity-icon">↔</span><div><b>{trade.side === 'buy' ? 'Buy' : 'Sell'} {launch.ticker}</b><small>{new Date(trade.createdAt).toLocaleString()}</small></div></div><code>{trade.side === 'buy' ? `${displayUnits(trade.inputAmount, 8)} BTC → ${displayUnits(trade.outputAmount, launch.decimals)} ${launch.ticker}` : `${displayUnits(trade.inputAmount, launch.decimals)} ${launch.ticker} → ${displayUnits(trade.outputAmount, 8)} BTC`}</code><span className="status-pill settled">{trade.venue}</span><code title={trade.txid}>{short(trade.txid, 7)}</code></div>)}</div>
  </section>
}

// Fields the curve simulation depends on; editing one makes the shown simulation stale.
const SIMULATED_FIELDS: Array<keyof typeof DEFAULT_FORM> = ['supply', 'virtualBtc', 'graduationThreshold', 'creatorFeeBps', 'protocolFeeBps', 'buyAmount']
const DEFAULT_FORM = { id: '', name: '', ticker: '', description: '', supply: '1000000000', decimals: '0', virtualBtc: '1000000', graduationThreshold: '9000000', creatorFeeBps: '70', protocolFeeBps: '30', buyAmount: '100000' }

export function CreateLaunchPage({ onBack, tradingEnabled, walletAddress, connectWallet, issueAsset, fundContract, onOpened, referralCode }: {
  onBack: () => void; tradingEnabled: boolean; walletAddress: string; popupWallet: boolean; connectWallet: () => void;
  issueAsset: (input: { amount: bigint; metadata: { name?: string; ticker: string; decimals: number } }) => Promise<{ assetId: string }>;
  fundContract: FundContract; onOpened: (id: string) => void; referralCode?: string
}) {
  const [form, setForm] = useState(DEFAULT_FORM); const [simulation, setSimulation] = useState<Simulation | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState('')
  const [simulating, setSimulating] = useState(false)
  const field = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [key]: event.target.value })
    if (SIMULATED_FIELDS.includes(key)) setSimulation(null)
  }
  async function simulate() {
    setSimulating(true); setError('')
    try { setSimulation(await request<Simulation>('/v1/launches/simulate', { method: 'POST', body: JSON.stringify({ supply: form.supply, virtualBtc: form.virtualBtc,
      graduationThreshold: form.graduationThreshold, creatorFeeBps: form.creatorFeeBps, protocolFeeBps: form.protocolFeeBps, ...(form.buyAmount ? { buyAmount: form.buyAmount } : {}) }) })) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setSimulation(null) } finally { setSimulating(false) }
  }
  async function createLaunch() {
    if (!walletAddress) { connectWallet(); return }
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(form.id)) { setError('Launch ID must be 2–64 lowercase letters, numbers or hyphens.'); return }
    if (!form.name.trim() || !/^[A-Za-z0-9]{1,16}$/.test(form.ticker)) { setError('Enter a name and a 1–16 character alphanumeric ticker.'); return }
    if (!/^[1-9]\d*$/.test(form.supply)) { setError('Supply must be a positive integer.'); return }
    const decimals = Number(form.decimals); if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) { setError('Decimals must be 0 through 18.'); return }
    setBusy(true); setError(''); const key = `inscrib3:launch:${walletAddress}:${form.id}`
    let saved: { controlAssetId?: string; assetId?: string; fundingTxid?: string } = {}
    try { saved = JSON.parse(localStorage.getItem(key) ?? '{}') as typeof saved } catch { /* start clean */ }
    try {
      setProgress('1/4 · Issue unique non-reissuable control token')
      saved.controlAssetId ??= (await issueAsset({ amount: 1n, metadata: { ticker: `${form.ticker.toUpperCase()}-CTRL`, decimals: 0 } })).assetId
      localStorage.setItem(key, JSON.stringify(saved))
      setProgress('2/4 · Issue fixed, non-reissuable token supply')
      saved.assetId ??= (await issueAsset({ amount: BigInt(form.supply), metadata: { name: form.name.trim(), ticker: form.ticker.toUpperCase(), decimals } })).assetId
      localStorage.setItem(key, JSON.stringify(saved))
      setProgress('3/4 · Bind immutable launch terms')
      const created = await request<{ launch: Launch; bootstrap: BootstrapResponse }>('/v1/launches', {
        method: 'POST', body: JSON.stringify({ id: form.id, name: form.name.trim(), ticker: form.ticker.toUpperCase(), description: form.description,
          decimals, supply: form.supply, virtualBtc: form.virtualBtc, graduationThreshold: form.graduationThreshold,
          creatorFeeBps: form.creatorFeeBps, protocolFeeBps: form.protocolFeeBps, creatorAddress: walletAddress,
          assetId: saved.assetId, controlAssetId: saved.controlAssetId, ...(referralCode ? { referralCode } : {}) }),
      })
      setProgress('4/4 · Fund and atomically open the curve')
      saved.fundingTxid ??= created.bootstrap.fundingTxid ?? await fundContract(created.bootstrap.contractAddress, 'bootstrap', BigInt(form.supply), BigInt(created.bootstrap.fundingSats), saved.assetId, saved.controlAssetId)
      localStorage.setItem(key, JSON.stringify(saved))
      await request(`/v1/launches/${encodeURIComponent(form.id)}/open`, { method: 'POST', body: JSON.stringify({ fundingTxid: saved.fundingTxid }) })
      localStorage.removeItem(key); setProgress('Launch opened'); onOpened(form.id)
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : String(cause)}${saved.fundingTxid ? ` Payment ${short(saved.fundingTxid, 7)} is saved; retry without paying again.` : ''}`) }
    finally { setBusy(false) }
  }
  return <section className="view-page create-launch-page">
    <div className="view-heading"><div><span className="eyebrow"><i /> CURVE-V1</span><h1>Create launch</h1><p>Model fixed-supply curve economics before any wallet transaction exists.</p></div><button className="secondary" onClick={onBack}>Back to launches</button></div>
    <div className="create-layout"><article className="create-card"><div className="card-head"><div><h2>Launch configuration</h2><span>All monetary fields below are integer raw units or satoshis</span></div></div>
      <div className="form-grid"><label><span>Launch ID</span><input value={form.id} onChange={field('id')} placeholder="my-bitcoin-asset" /></label><label><span>Name</span><input value={form.name} onChange={field('name')} placeholder="My Bitcoin Asset" /></label><label><span>Ticker</span><input value={form.ticker} onChange={field('ticker')} placeholder="TOKEN" maxLength={16} /></label><label><span>Decimals</span><input value={form.decimals} onChange={field('decimals')} inputMode="numeric" /></label><label className="wide"><span>Description</span><textarea value={form.description} onChange={field('description')} placeholder="What is this launch?" /></label><label><span>Fixed supply</span><input value={form.supply} onChange={field('supply')} inputMode="numeric" /></label><label><span>Initial buy · sats</span><input value={form.buyAmount} onChange={field('buyAmount')} inputMode="numeric" /></label><label><span>Virtual BTC · sats</span><input value={form.virtualBtc} onChange={field('virtualBtc')} inputMode="numeric" /></label><label><span>Graduation threshold · sats</span><input value={form.graduationThreshold} onChange={field('graduationThreshold')} inputMode="numeric" /></label><label><span>Creator fee · bps</span><input value={form.creatorFeeBps} onChange={field('creatorFeeBps')} inputMode="numeric" /></label><label><span>Protocol fee · bps</span><input value={form.protocolFeeBps} onChange={field('protocolFeeBps')} inputMode="numeric" /></label></div>
      <button className="primary" onClick={() => void simulate()} disabled={busy || simulating}>{simulating ? 'Calculating…' : 'Simulate exact curve'}</button>{error && <div className="notice error"><b>{progress ? 'Launch action failed' : 'Invalid economics'}</b><span>{error}</span></div>}
      {simulation && <div className="launch-simulation"><div><span>Sellable on curve</span><b>{compact(simulation.sellableTokens)}</b></div><div><span>Reserved for pool</span><b>{compact(simulation.reservedTokens)}</b></div><div><span>Initial buy output</span><b>{simulation.quote ? compact(simulation.quote.outputAmount) : '—'}</b></div><div><span>Initial buy fees</span><b>{simulation.quote ? `${compact(BigInt(simulation.quote.creatorFee) + BigInt(simulation.quote.protocolFee))} sats` : '—'}</b></div></div>}
      {progress && <div className="creation-progress">{progress}</div>}{tradingEnabled ? <button className="primary" onClick={() => void createLaunch()} disabled={busy || simulating}>{busy ? 'Waiting for wallet…' : !walletAddress ? 'Connect wallet' : 'Issue assets & open launch'}</button> : <button className="primary launch-disabled" disabled>Wallet launch disabled until funded validation</button>}
    </article><aside className="create-info"><span className="panel-label">RELEASE GATE</span><h3>No unvalidated funding addresses</h3><p>The simulator uses the same integer arithmetic intended for the covenant. Asset issuance and funding remain unavailable until the complete path passes emulator and funded Mutinynet tests.</p><ul><li>Buy and sell symmetry</li><li>Final partial fill and refund</li><li>Permissionless graduation</li><li>Permanent liquidity lock</li><li>Timed recovery without stranded funds</li></ul></aside></div>
  </section>
}
