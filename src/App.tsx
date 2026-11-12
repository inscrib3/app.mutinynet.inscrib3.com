import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { firstFormError, MAX_WALLET_AMOUNT, MIN_PROTOCOL_FEE_BPS, parseDisplayAmount, rawAmount, validateAssetForm, validatePoolForm, type AssetFormInput, type PoolFormInput } from './form-validation'
import { loadSavedPayments, savePayment, type PaymentKind, type SavedPayment } from './open-payments'
import { describeWalletError, errorMessage, MISSING_WALLET, WALLET_INSTALL_URL, type WalletIssue } from './wallet-issues'

const API = import.meta.env.VITE_API_URL ?? '/api'
const NETWORK = import.meta.env.VITE_NETWORK ?? 'mutinynet'
if (NETWORK !== 'mutinynet' && NETWORK !== 'mainnet') throw new Error('VITE_NETWORK must be mutinynet or mainnet')
const NETWORK_LABEL = NETWORK === 'mainnet' ? 'MAINNET' : 'MUTINYNET'
const WALLET_NETWORK = NETWORK === 'mainnet' ? 'bitcoin' : 'mutinynet'
const APP_NETWORK_NAME = NETWORK === 'mainnet' ? 'Mainnet' : 'Mutinynet (testnet)'
const SWITCH_NETWORK_LABEL = NETWORK === 'mainnet' ? 'Switch to Mainnet' : 'Switch to testnet'
// Every Arkade output the wallet funds carries at least this many sats (the API's DUST).
const DUST_SATS = 330n
const OPEN_REQUEST_STATUSES: ReadonlyArray<SwapRequest['status']> = ['pending-funding', 'funded', 'sweeping']
const EMPTY_ASSET_FORM = { name: '', ticker: '', supply: '', decimals: '0', icon: '' }
const ASSET_FIELD_LABELS: Record<keyof AssetFormInput, string> = { name: 'Name', ticker: 'Ticker', supply: 'Initial supply', decimals: 'Decimals', icon: 'Icon URL' }
const POOL_FIELD_LABELS: Partial<Record<keyof PoolFormInput, string>> = { quoteAssetId: 'Quote asset', baseAmount: 'Initial base reserve', quoteAmount: 'Initial quote reserve', feeBps: 'Total fee', protocolFeeBps: 'Protocol fee' }
const DEFAULT_POOL_FORM ={ id: '', name: '', baseAssetId: 'btc', quoteAssetId: '', baseAmount: '', quoteAmount: '', feeBps: '100', protocolFeeBps: String(MIN_PROTOCOL_FEE_BPS) }
const DOCS_URL = 'https://docs.inscrib3.com/app/overview'
const SOURCE_URL = 'https://github.com/inscrib3/app.mutinynet.inscrib3.com'

interface DeploymentInfo {
  ok: boolean
  network: 'mutinynet' | 'mainnet'
  platformTreasuryAddress: string
  poolCreationFeeSats: string
  ammContractGeneration: 'amm-v2'
  maxSwapBatch: number
  maxLiquidityBatch: number
}

interface NetworkInfo {
  network: string
  displayName: string
  isTestnet: boolean
  arkServerUrl: string
}

interface AssetInfo {
  assetId: string
  amount: number
  displayAmount: number
  metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string }
  controlAssetId?: string
}

interface AssetRisk { assetId: string; controlled: boolean; controlAssetId?: string; supply?: string; metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string } }
interface CatalogAsset { assetId: string; controlAssetId?: string; supply?: string; metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string } }
interface PageResult<T> { items: T[]; total: number; nextCursor?: string }
interface CursorPage<T> { items: T[]; nextCursor?: string }
type PriceTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '24h' | '7d' | '30d'
interface PricePoint { recordedAt: number; baseReserve: string; quoteReserve: string; txid: string }
interface PriceHistory { poolId: string; timeframe: PriceTimeframe; baseAssetId: string; quoteAssetId: string; priceUnit: 'raw-reserves'; points: PricePoint[] }

interface BalanceInfo { available: number; total: number }

interface Pool {
  id: string
  name: string
  baseAssetId: string
  quoteAssetId: string
  lpAssetId: string
  feeBps: number
  protocolFeeBps: number
  treasuryAddress: string
  creationFeeSats: string
  accruedBaseFees?: string
  accruedQuoteFees?: string
  baseReserve?: string
  quoteReserve?: string
  lpSupply?: string
  available: boolean
  error?: string
  baseAssetInfo?: AssetRisk
  quoteAssetInfo?: AssetRisk
  swaps24h?: number
  liquidityEvents24h?: number
  activity24h?: number
  onFire?: boolean
  contractGeneration: 'amm-v1' | 'amm-v2'
  lifecycle: 'active' | 'withdraw-only' | 'closed'
  swapEnabled: boolean
  depositEnabled: boolean
  withdrawalEnabled: boolean
}

interface Quote {
  outputAmount: string
  inputAmount?: string
  requestedOutputAmount?: string
  priceImpactBps: number
  poolTxid: string
  protocolFeeBps: number
  lpFeeBps: number
  carrierFeeSats: string
  rewardPoints: string
}

interface SwapRequest {
  id: string
  poolId?: string
  status: 'pending-funding' | 'funded' | 'sweeping' | 'settled' | 'refunded' | 'failed'
  contractAddress: string
  sellAssetId?: string
  sellAmount?: string
  fundingSats: string
  rewardPoints?: string
  fundingTxid?: string
  settlementTxid?: string
  error?: string
  createdAt?: number
}

interface LiquidityRequest extends Omit<SwapRequest, 'fundingSats'> {
  kind: 'deposit' | 'withdraw'
  baseAmount: string
  quoteAmount: string
  lpAmount: string
}
type ActivityEvent = (SwapRequest & { activityType: 'swap' }) | (LiquidityRequest & { activityType: 'deposit' | 'withdraw' })
interface PointsSummary { identityKey: string; total: string; poolPoints: string; swapPoints: string; referralPoints: string; referralCode: string; referredUsers: number; rank?: number; participants: number; portableToMainnet: true }
interface LeaderboardEntry { rank: number; identityKey: string; address: string; total: string; poolPoints: string; swapPoints: string }

interface IssueAssetResult { arkTxId: string; assetId: string }
interface IssueAssetInput {
  amount: number
  controlAssetId?: string
  metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string }
}
interface PoolAssetIssuance {
  key: string
  control: IssueAssetResult
  lp?: IssueAssetResult
  ledger?: IssueAssetResult
}
interface PoolCreation {
  id: string
  pool: Pool
  baseAmount: string
  quoteAmount: string
  bootstrapAddress: string
  bootstrapSats: string
  status: 'awaiting-funding' | 'opened'
  fundingTxid?: string
  openingTxid?: string
}

type Page = 'swap' | 'pools' | 'pool' | 'create' | 'activity'

function routeFromLocation(): { page: Page; poolId?: string } {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts[0] === 'pools' && parts[1]) return { page: 'pool', poolId: decodeURIComponent(parts[1]) }
  if (parts[0] === 'pools') return { page: 'pools' }
  if (parts[0] === 'create') return { page: 'create' }
  if (parts[0] === 'activity') return { page: 'activity' }
  return { page: 'swap' }
}

function pathForPage(page: Page, poolId?: string): string {
  if (page === 'pools') return '/pools'
  if (page === 'pool' && poolId) return `/pools/${encodeURIComponent(poolId)}`
  if (page === 'create') return '/create'
  if (page === 'activity') return '/activity'
  return '/'
}

function poolSlug(firstTicker: string, secondTicker: string): string {
  return [firstTicker, secondTicker]
    .map((ticker) => ticker.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .sort()
    .join('-')
    .slice(0, 64)
}

interface ArkadeProvider {
  isArkade: true
  connect(): Promise<string[]>
  getAddress(): Promise<string>
  getNetwork(): Promise<NetworkInfo>
  getBalance(): Promise<BalanceInfo>
  getAssets(): Promise<AssetInfo[]>
  sendToAddress(address: string, amount: number): Promise<string>
  sendAsset(address: string, assets: Array<{ assetId: string; amount: number }>, bitcoinAmount?: number): Promise<string>
  issueAsset(input: IssueAssetInput): Promise<IssueAssetResult>
  // Planned wallet method (arkade_switchNetwork); older wallets don't have it.
  switchNetwork?(network: string): Promise<void>
  on(event: string, callback: () => void): void
  off(event: string, callback: () => void): void
}

declare global { interface Window { arkade?: ArkadeProvider } }

const short = (value: string, edge = 5) => value.length > edge * 2 ? `${value.slice(0, edge)}…${value.slice(-edge)}` : value
const comma = (value: string | bigint) => BigInt(value).toLocaleString()

function ratio(numerator: bigint, denominator: bigint, precision = 8): string {
  if (denominator === 0n) return '—'
  const scale = 10n ** BigInt(precision)
  const scaled = (numerator * scale) / denominator
  const whole = scaled / scale
  const fraction = (scaled % scale).toString().padStart(precision, '0').replace(/0+$/, '')
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString()
}

function maxBigInt(a: bigint, b: bigint): bigint { return a > b ? a : b }

function walletNumber(value: bigint, name: string): number {
  if (value < 0n || value > MAX_WALLET_AMOUNT) throw new Error(`${name} exceeds the wallet safe integer range`)
  return Number(value)
}

function assertProviderAmounts(assets: AssetInfo[], balance: BalanceInfo): void {
  if (!Number.isSafeInteger(balance.available) || balance.available < 0) throw new Error('Wallet returned an unsafe BTC balance')
  for (const asset of assets) {
    if (!Number.isSafeInteger(asset.amount) || asset.amount < 0) throw new Error(`Wallet returned an unsafe amount for ${asset.assetId}`)
  }
}

async function assertWalletNetwork(provider: ArkadeProvider): Promise<void> {
  const current = await provider.getNetwork()
  if (current.network !== WALLET_NETWORK) throw new Error(`Switch Inscrib3 Wallet to ${NETWORK_LABEL} before continuing.`)
}

function isSpentVtxoError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /VTXO_ALREADY_SPENT|VTXO[^\n]*already spent/i.test(message)
}

async function issueAssetWithRetry(provider: ArkadeProvider, input: IssueAssetInput, onRetry: () => void): Promise<IssueAssetResult> {
  try { return await provider.issueAsset(input) }
  catch (cause) {
    if (!isSpentVtxoError(cause)) throw cause
    onRetry()
    // Consecutive issuances can briefly select the VTXO consumed by the
    // previous one. After the rejection, let the wallet/indexer refresh and
    // request approval again with fresh coin selection.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 750))
    return provider.issueAsset(input)
  }
}

function displayAmount(value: string | bigint, decimals: number, precision = 6): string {
  const raw = BigInt(value)
  if (decimals === 0) return raw.toLocaleString()
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = (raw % scale).toString().padStart(decimals, '0').slice(0, precision).replace(/0+$/, '')
  return fraction ? `${whole.toLocaleString()}.${fraction}` : whole.toLocaleString()
}

function editableAmount(value: string | bigint, decimals: number): string {
  const raw = BigInt(value)
  if (decimals === 0) return raw.toString()
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = (raw % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`)
  return body
}

function TokenMark({ label, warm = false }: { label: string; warm?: boolean }) {
  return <span className={`token-mark ${warm ? 'warm' : ''}`}>{label.slice(0, 1).toUpperCase()}</span>
}

function Spinner() { return <span className="spinner" aria-hidden="true" /> }

const PRICE_TIMEFRAMES: PriceTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '24h', '7d', '30d']

function normalizedPrice(point: PricePoint, baseDecimals: number, quoteDecimals: number): number {
  return (Number(point.baseReserve) / Number(point.quoteReserve)) * 10 ** (quoteDecimals - baseDecimals)
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  if (Math.abs(value) < 0.00000001) return value.toExponential(6)
  return value.toLocaleString(undefined, { maximumSignificantDigits: 10 })
}

function formatChartTime(timestamp: number, timeframe: PriceTimeframe): string {
  const date = new Date(timestamp)
  if (timeframe === '1m' || timeframe === '5m') return date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
  if (timeframe === '7d' || timeframe === '30d') return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatChartTooltipTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function PriceChart({ pool, baseTicker, quoteTicker, baseDecimals, quoteDecimals }: {
  pool: Pool; baseTicker: string; quoteTicker: string; baseDecimals: number; quoteDecimals: number
}) {
  const [timeframe, setTimeframe] = useState<PriceTimeframe>('4h')
  const [points, setPoints] = useState<PricePoint[]>([])
  const [chartError, setChartError] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const load = () => api<PriceHistory>(`/v1/pools/${encodeURIComponent(pool.id)}/prices?timeframe=${timeframe}`, { signal: controller.signal })
      .then((history) => { setPoints(Array.isArray(history.points) ? history.points : []); setChartError('') })
      .catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setChartError(cause instanceof Error ? cause.message : String(cause)) })
    void load()
    const refresh = window.setInterval(() => void load(), 15_000)
    return () => { controller.abort(); window.clearInterval(refresh) }
  }, [pool.id, timeframe])

  const series = points.map((point) => ({ ...point, price: normalizedPrice(point, baseDecimals, quoteDecimals) }))
    .filter((point) => Number.isFinite(point.price))
  const prices = series.map((point) => point.price)
  const latest = prices.at(-1)
  const first = prices[0]
  const change = first && latest !== undefined ? ((latest - first) / first) * 100 : 0
  const min = prices.length ? Math.min(...prices) : 0
  const max = prices.length ? Math.max(...prices) : 0
  const spread = max - min || Math.max(Math.abs(max) * 0.02, 1e-12)
  const firstTime = series[0]?.recordedAt ?? 0
  const lastTime = series.at(-1)?.recordedAt ?? firstTime
  const coordinates = series.map((point) => {
    const x = firstTime === lastTime ? 300 : 18 + ((point.recordedAt - firstTime) / (lastTime - firstTime)) * 564
    const y = 162 - ((point.price - (min - spread * 0.08)) / (spread * 1.16)) * 144
    return { x, y }
  })
  const chartPoints = coordinates.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const lastCoordinate = coordinates.at(-1)
  const hoveredCoordinate = hoveredIndex === null ? undefined : coordinates[hoveredIndex]
  const hoveredPoint = hoveredIndex === null ? undefined : series[hoveredIndex]
  const emptyMessage = timeframe === '30d'
    ? 'No recorded price history for this pool yet.'
    : 'No price updates in this timeframe. Try a longer range.'

  return <section className="price-chart">
    <div className="price-chart-head">
      <div><span>DISPLAY PRICE · DECIMALS APPLIED</span><div><h3>{baseTicker} per {quoteTicker}</h3>{latest !== undefined && <b>{formatPrice(latest)}</b>}<em className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</em></div></div>
      <div className="price-timeframes">{PRICE_TIMEFRAMES.map((value) => <button key={value} className={timeframe === value ? 'active' : ''} onClick={() => setTimeframe(value)}>{value.toUpperCase()}</button>)}</div>
    </div>
    <div className="price-chart-canvas" onPointerMove={(event) => {
      if (!coordinates.length) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const contentWidth = Math.max(bounds.width - 28, 1)
      const chartX = Math.min(600, Math.max(0, ((event.clientX - bounds.left - 14) / contentWidth) * 600))
      let nearest = 0
      for (let index = 1; index < coordinates.length; index += 1) {
        if (Math.abs(coordinates[index]!.x - chartX) < Math.abs(coordinates[nearest]!.x - chartX)) nearest = index
      }
      setHoveredIndex(nearest)
    }} onPointerLeave={() => setHoveredIndex(null)}>
      {prices.length ? <svg viewBox="0 0 600 180" role="img" aria-label={`${baseTicker} per ${quoteTicker} price chart`} preserveAspectRatio="none">
        <defs><linearGradient id={`price-fill-${pool.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity=".24" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
        {[36, 72, 108, 144].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} className="chart-grid" />)}
        {prices.length > 1 && <polygon points={`18,180 ${chartPoints} 582,180`} fill={`url(#price-fill-${pool.id})`} />}
        <polyline points={chartPoints} className="chart-line" />
      </svg> : <div className="chart-empty">{chartError || emptyMessage}</div>}
      {prices.length > 0 && <div className="chart-overlay" aria-hidden="true">
        {lastCoordinate && <span className="chart-marker chart-last" style={{ left: `${lastCoordinate.x / 6}%`, top: `${lastCoordinate.y / 1.8}%` }} />}
        {hoveredCoordinate && hoveredPoint && <>
          <span className="chart-hover-guide" style={{ left: `${hoveredCoordinate.x / 6}%` }} />
          <span className="chart-marker chart-hover-marker" style={{ left: `${hoveredCoordinate.x / 6}%`, top: `${hoveredCoordinate.y / 1.8}%` }} />
          <div className="chart-tooltip" style={{
            left: `${hoveredCoordinate.x / 6}%`, top: `${hoveredCoordinate.y / 1.8}%`,
            transform: hoveredCoordinate.x > 450
              ? hoveredCoordinate.y < 60 ? 'translate(calc(-100% - 12px), 12px)' : 'translate(calc(-100% - 12px), calc(-100% - 10px))'
              : hoveredCoordinate.y < 60 ? 'translate(12px, 12px)' : 'translate(12px, calc(-100% - 10px))',
          }}><span>{baseTicker} per {quoteTicker}</span><b>{formatPrice(hoveredPoint.price)}</b><small>{formatChartTooltipTime(hoveredPoint.recordedAt)}</small></div>
        </>}
      </div>}
    </div>
    <div className="price-chart-foot"><span>{series[0] ? formatChartTime(series[0].recordedAt, timeframe) : '—'}</span><span>Normalized using {baseTicker} ({baseDecimals}) and {quoteTicker} ({quoteDecimals}) decimals</span><span>{series.at(-1) ? formatChartTime(series.at(-1)!.recordedAt, timeframe) : '—'}</span></div>
  </section>
}

// Empty fields stay quiet; the submit button already says what is missing.
function FieldError({ message, value }: { message?: string; value: string }) {
  if (!message || value.trim() === '') return null
  return <span className="field-error" role="alert">{message}</span>
}

interface RequestProgress { status: SwapRequest['status']; fundingTxid?: string; settlementTxid?: string; error?: string }

function describeRequest(noun: string, request: RequestProgress): { title: string; detail: string } {
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

function RequestNotice({ noun, request, busy, onDismiss, onRetryRegistration }: {
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

function isRequestLocked(request: RequestProgress | null): boolean {
  return request !== null && (OPEN_REQUEST_STATUSES.includes(request.status) || request.status === 'failed')
}

// The server reports fundingTxid only after registering the payment; until then keep the one the wallet returned.
function withKnownFundingTxid<T extends { fundingTxid?: string }>(next: T, known: { fundingTxid?: string } | null | undefined): T {
  return { ...next, fundingTxid: next.fundingTxid ?? known?.fundingTxid }
}

// A request without a payment id was never paid as far as this browser knows, so it is not worth restoring.
async function restoreOpenRequest<T extends RequestProgress>(path: string, saved: SavedPayment | undefined): Promise<T | null> {
  if (!saved) return null
  try {
    const current = withKnownFundingTxid(await api<T>(path), saved)
    if (current.status === 'pending-funding' && !current.fundingTxid) return null
    return isRequestLocked(current) ? current : null
  } catch { return null }
}

async function restoreFundedPoolCreation(saved: SavedPayment | undefined): Promise<PoolCreation | null> {
  if (!saved?.fundingTxid) return null
  try {
    const creation = await api<PoolCreation>(`/v1/pool-creations/${encodeURIComponent(saved.id)}`)
    return creation.status === 'awaiting-funding' ? { ...creation, fundingTxid: saved.fundingTxid } : null
  } catch { return null }
}

function App() {
  const initialRoute = routeFromLocation()
  const initialParams = new URLSearchParams(window.location.search)
  const [referralCode] = useState(() => {
    const incoming = initialParams.get('ref')?.toLowerCase()
    if (incoming && /^[a-z0-9]{12}$/.test(incoming)) { window.localStorage.setItem('inscrib3-referral', incoming); return incoming }
    const stored = window.localStorage.getItem('inscrib3-referral')?.toLowerCase()
    if (stored && /^[a-z0-9]{12}$/.test(stored)) return stored
    window.localStorage.removeItem('inscrib3-referral')
    return ''
  })
  const [page, setPage] = useState<Page>(initialRoute.page)
  const initialSwapMode = initialRoute.page === 'swap' && ['deposit', 'withdraw'].includes(initialParams.get('mode') ?? '') ? initialParams.get('mode') as 'deposit' | 'withdraw' : 'swap'
  const [mode, setMode] = useState<'swap' | 'deposit' | 'withdraw'>(initialSwapMode)
  const [pools, setPools] = useState<Pool[]>([])
  const [poolResults, setPoolResults] = useState<Pool[]>([])
  const [poolResultTotal, setPoolResultTotal] = useState(0)
  const [poolCursor, setPoolCursor] = useState<string | undefined>()
  const [poolId, setPoolId] = useState(initialRoute.poolId ?? '')
  const [address, setAddress] = useState('')
  const [assets, setAssets] = useState<AssetInfo[]>([])
  const [btcBalance, setBtcBalance] = useState(0)
  const [sellAssetId, setSellAssetId] = useState('btc')
  const [amount, setAmount] = useState('')
  const [receiveAmount, setReceiveAmount] = useState('')
  const [quoteMode, setQuoteMode] = useState<'input' | 'output'>('input')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [showPairModal, setShowPairModal] = useState(false)
  const [modalSellAssetId, setModalSellAssetId] = useState('')
  const [modalBuyAssetId, setModalBuyAssetId] = useState('')
  const [poolSearch, setPoolSearch] = useState(initialRoute.page === 'pools' ? initialParams.get('q') ?? '' : '')
  const [tokenSearch, setTokenSearch] = useState('')
  const [catalogAssets, setCatalogAssets] = useState<CatalogAsset[]>([])
  const [linkCopied, setLinkCopied] = useState(false)
  const [slippage, setSlippage] = useState(50)
  const [showSettings, setShowSettings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [walletIssue, setWalletIssue] = useState<WalletIssue | null>(null)
  const [walletNetwork, setWalletNetwork] = useState<NetworkInfo | null>(null)
  const [showSwitchSteps, setShowSwitchSteps] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [request, setRequest] = useState<SwapRequest | null>(null)
  const [liquidityAmount, setLiquidityAmount] = useState('')
  const [liquidityRequest, setLiquidityRequest] = useState<LiquidityRequest | null>(null)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [activityCursor, setActivityCursor] = useState<string | undefined>()
  const [createMode, setCreateMode] = useState<'asset' | 'pool'>(initialRoute.page === 'create' && initialParams.get('mode') === 'pool' ? 'pool' : 'asset')
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM)
  const [issuedAsset, setIssuedAsset] = useState<IssueAssetResult | null>(null)
  const [poolForm, setPoolForm] = useState(DEFAULT_POOL_FORM)
  const [poolCreation, setPoolCreation] = useState<PoolCreation | null>(null)
  const [poolAssetIssuance, setPoolAssetIssuance] = useState<PoolAssetIssuance | null>(null)
  const [creationStep, setCreationStep] = useState('')
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null)
  const [paymentsRestored, setPaymentsRestored] = useState(false)
  const [points, setPoints] = useState<PointsSummary | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])

  const pool = pools.find((p) => p.id === poolId)
  const sellAsset = assets.find((a) => a.assetId === sellAssetId)
  const buyAssetId = pool ? (sellAssetId === pool.baseAssetId ? pool.quoteAssetId : pool.baseAssetId) : ''
  const buyAsset = assets.find((a) => a.assetId === buyAssetId)
  const sellPoolInfo = pool?.baseAssetId === sellAssetId ? pool.baseAssetInfo : pool?.quoteAssetId === sellAssetId ? pool.quoteAssetInfo : undefined
  const buyPoolInfo = pool?.baseAssetId === buyAssetId ? pool.baseAssetInfo : pool?.quoteAssetId === buyAssetId ? pool.quoteAssetInfo : undefined
  const sellDecimals = sellPoolInfo?.metadata?.decimals ?? sellAsset?.metadata?.decimals ?? (sellAssetId === 'btc' ? 8 : 0)
  const buyDecimals = buyPoolInfo?.metadata?.decimals ?? buyAsset?.metadata?.decimals ?? (buyAssetId === 'btc' ? 8 : 0)
  const sellTicker = sellAssetId === 'btc' ? 'BTC' : sellPoolInfo?.metadata?.ticker ?? sellAsset?.metadata?.ticker ?? (pool?.name.split('/')[sellAssetId === pool?.quoteAssetId ? 1 : 0]?.trim() || 'ASSET')
  const buyTicker = !buyAssetId ? 'SELECT' : buyAssetId === 'btc' ? 'BTC' : buyPoolInfo?.metadata?.ticker ?? buyAsset?.metadata?.ticker ?? (pool?.name.split('/')[buyAssetId === pool?.quoteAssetId ? 1 : 0]?.trim() || 'ASSET')
  const raw = rawAmount(amount, sellDecimals)
  const receiveRaw = rawAmount(receiveAmount, buyDecimals)
  const sellAmountCheck = parseDisplayAmount(amount, sellDecimals)
  const walletOnWrongNetwork = walletNetwork !== null && walletNetwork.network !== WALLET_NETWORK
  const walletReady = Boolean(address) && !walletOnWrongNetwork
  const swapLocked = isRequestLocked(request)
  const liquidityLocked = isRequestLocked(liquidityRequest)
  const poolOpeningPending = poolCreation?.status === 'awaiting-funding' && Boolean(poolCreation.fundingTxid)
  const baseAsset = assets.find((asset) => asset.assetId === pool?.baseAssetId)
  const quoteAsset = assets.find((asset) => asset.assetId === pool?.quoteAssetId)
  const lpAsset = assets.find((asset) => asset.assetId === pool?.lpAssetId)
  const baseDecimals = pool?.baseAssetInfo?.metadata?.decimals ?? baseAsset?.metadata?.decimals ?? (pool?.baseAssetId === 'btc' ? 8 : 0)
  const quoteDecimals = pool?.quoteAssetInfo?.metadata?.decimals ?? quoteAsset?.metadata?.decimals ?? (pool?.quoteAssetId === 'btc' ? 8 : 0)
  const lpDecimals = lpAsset?.metadata?.decimals ?? baseDecimals
  const liquidityRaw = rawAmount(liquidityAmount, mode === 'withdraw' ? lpDecimals : baseDecimals)
  const liquidityPreview = (() => {
    if (!pool?.baseReserve || !pool.quoteReserve || !pool.lpSupply || !liquidityRaw) return null
    if (mode === 'deposit') return {
      base: liquidityRaw, quote: (liquidityRaw * BigInt(pool.quoteReserve)) / BigInt(pool.baseReserve),
      lp: (liquidityRaw * BigInt(pool.lpSupply)) / BigInt(pool.baseReserve),
    }
    if (mode === 'withdraw') return {
      base: (BigInt(pool.baseReserve) * liquidityRaw) / BigInt(pool.lpSupply),
      quote: (BigInt(pool.quoteReserve) * liquidityRaw) / BigInt(pool.lpSupply), lp: liquidityRaw,
    }
    return null
  })()
  const controlledPoolAssets = pool ? [pool.baseAssetInfo, pool.quoteAssetInfo].filter((info): info is AssetRisk => Boolean(info?.controlled)) : []
  const selectedCreationAssets = [poolForm.baseAssetId, poolForm.quoteAssetId]
    .filter((id) => id && id !== 'btc').map((id) => assets.find((asset) => asset.assetId === id)).filter((asset): asset is AssetInfo => Boolean(asset))
  const controlledCreationAssets = selectedCreationAssets.filter((asset) => asset.controlAssetId)
  const tokenIds = [...new Set(pools.filter((item) => item.available).flatMap((item) => [item.baseAssetId, item.quoteAssetId]))]
  const modalBuyOptions = tokenIds.filter((candidate) => candidate !== modalSellAssetId
    && pools.some((item) => item.available && [item.baseAssetId, item.quoteAssetId].includes(modalSellAssetId)
      && [item.baseAssetId, item.quoteAssetId].includes(candidate)))

  function tokenDetails(assetId: string) {
    const walletAsset = assets.find((item) => item.assetId === assetId)
    const catalogAsset = catalogAssets.find((item) => item.assetId === assetId)
    const poolInfo = pools.flatMap((item) => [item.baseAssetInfo, item.quoteAssetInfo]).find((info) => info?.assetId === assetId)
    const ticker = assetId === 'btc' ? 'BTC' : poolInfo?.metadata?.ticker ?? walletAsset?.metadata?.ticker ?? catalogAsset?.metadata?.ticker ?? short(assetId || 'TOKEN')
    const decimals = assetId === 'btc' ? 8 : poolInfo?.metadata?.decimals ?? walletAsset?.metadata?.decimals ?? catalogAsset?.metadata?.decimals ?? 0
    return { ticker, decimals, name: assetId === 'btc' ? 'Native Bitcoin' : poolInfo?.metadata?.name ?? walletAsset?.metadata?.name ?? catalogAsset?.metadata?.name ?? short(assetId, 10), controlled: poolInfo?.controlAssetId ?? walletAsset?.controlAssetId ?? catalogAsset?.controlAssetId }
  }

  function walletBalance(assetId: string): bigint {
    if (assetId === 'btc') return BigInt(btcBalance)
    return BigInt(assets.find((item) => item.assetId === assetId)?.amount ?? 0)
  }

  function updatePoolPair(baseAssetId: string, quoteAssetId: string) {
    const baseTicker = baseAssetId ? tokenDetails(baseAssetId).ticker : ''
    const quoteTicker = quoteAssetId ? tokenDetails(quoteAssetId).ticker : ''
    const name = baseTicker && quoteTicker ? `${baseTicker} / ${quoteTicker}` : ''
    const legacyPair = pools.some((item) => item.lifecycle !== 'active' && [item.baseAssetId, item.quoteAssetId].includes(baseAssetId)
      && [item.baseAssetId, item.quoteAssetId].includes(quoteAssetId))
    const id = baseTicker && quoteTicker ? `${poolSlug(baseTicker, quoteTicker)}${legacyPair ? '-v2' : ''}` : ''
    setPoolForm((current) => ({ ...current, baseAssetId, quoteAssetId, id, name }))
  }

  const creationBaseDetails = poolForm.baseAssetId ? tokenDetails(poolForm.baseAssetId) : undefined
  const creationQuoteDetails = poolForm.quoteAssetId ? tokenDetails(poolForm.quoteAssetId) : undefined
  const creationBaseAmount = creationBaseDetails ? rawAmount(poolForm.baseAmount, creationBaseDetails.decimals) : null
  const creationQuoteAmount = creationQuoteDetails ? rawAmount(poolForm.quoteAmount, creationQuoteDetails.decimals) : null
  const existingPair = poolForm.quoteAssetId ? pools.find((item) => item.lifecycle === 'active' && [item.baseAssetId, item.quoteAssetId].includes(poolForm.baseAssetId)
    && [item.baseAssetId, item.quoteAssetId].includes(poolForm.quoteAssetId)) : undefined
  const poolValidation = validatePoolForm(poolForm, {
    base: creationBaseDetails && { ticker: creationBaseDetails.ticker, decimals: creationBaseDetails.decimals, balance: walletBalance(poolForm.baseAssetId) },
    quote: creationQuoteDetails && { ticker: creationQuoteDetails.ticker, decimals: creationQuoteDetails.decimals, balance: walletBalance(poolForm.quoteAssetId) },
    creationFeeSats: BigInt(deployment?.poolCreationFeeSats ?? '0'),
    existingPairName: existingPair?.name,
  })
  const assetValidation = validateAssetForm(assetForm)
  const initialLiquiditySummary = creationBaseAmount && creationQuoteAmount && creationBaseDetails && creationQuoteDetails
    ? `${displayAmount(creationBaseAmount, creationBaseDetails.decimals, 8)} ${creationBaseDetails.ticker} + ${displayAmount(creationQuoteAmount, creationQuoteDetails.decimals, 8)} ${creationQuoteDetails.ticker}`
    : 'Enter both reserves'
  const bootstrapSummary = (() => {
    if (!poolCreation || !deployment) return null
    const bootstrapSats = BigInt(poolCreation.bootstrapSats)
    const creationFeeSats = BigInt(poolCreation.pool.creationFeeSats)
    const btcLiquidity = poolCreation.pool.baseAssetId === 'btc' ? BigInt(poolCreation.baseAmount) : 0n
    const carrierSats = bootstrapSats - creationFeeSats - btcLiquidity
    const baseDetails = tokenDetails(poolCreation.pool.baseAssetId)
    const quoteDetails = tokenDetails(poolCreation.pool.quoteAssetId)
    const fundedAssets = [
      ...(poolCreation.pool.baseAssetId === 'btc' ? [] : [`${displayAmount(poolCreation.baseAmount, baseDetails.decimals, 8)} ${baseDetails.ticker}`]),
      `${displayAmount(poolCreation.quoteAmount, quoteDetails.decimals, 8)} ${quoteDetails.ticker}`,
    ]
    return { bootstrapSats, carrierSats, total: `${comma(bootstrapSats)} sats + ${fundedAssets.join(' + ')}` }
  })()

  const normalizedTokenSearch = tokenSearch.trim().toLowerCase()
  const matchesTokenSearch = (assetId: string) => {
    if (!normalizedTokenSearch) return true
    const details = tokenDetails(assetId)
    return [assetId, details.ticker, details.name].some((value) => value.toLowerCase().includes(normalizedTokenSearch))
  }
  const filteredTokenIds = tokenIds.filter(matchesTokenSearch)
  const filteredModalBuyOptions = modalBuyOptions.filter(matchesTokenSearch)
  const filteredPools = [...poolResults].sort((a, b) => Number(Boolean(b.onFire)) - Number(Boolean(a.onFire)))
  const onFirePool = pools.filter((item) => item.available && item.onFire)
    .sort((a, b) => (b.activity24h ?? 0) - (a.activity24h ?? 0))[0]
  const onFireBase = onFirePool ? tokenDetails(onFirePool.baseAssetId) : undefined
  const onFireQuote = onFirePool ? tokenDetails(onFirePool.quoteAssetId) : undefined

  function bestPoolForPair(first: string, second: string): Pool | undefined {
    return pools.filter((item) => item.available && [item.baseAssetId, item.quoteAssetId].includes(first) && [item.baseAssetId, item.quoteAssetId].includes(second))
      .sort((a, b) => {
        const liquidityA = BigInt(a.baseReserve ?? '0') * BigInt(a.quoteReserve ?? '0')
        const liquidityB = BigInt(b.baseReserve ?? '0') * BigInt(b.quoteReserve ?? '0')
        return liquidityA === liquidityB ? a.feeBps - b.feeBps : liquidityA > liquidityB ? -1 : 1
      })[0]
  }

  function swapUrl(targetPool: Pool, targetSellAssetId: string, includeAmount = false): string {
    const url = new URL(window.location.href)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    url.searchParams.set('swap', targetPool.id)
    if (targetSellAssetId === targetPool.quoteAssetId) url.searchParams.set('side', 'quote')
    if (includeAmount && quoteMode === 'output' && receiveAmount.trim()) url.searchParams.set('output', receiveAmount.trim())
    else if (includeAmount && amount.trim()) url.searchParams.set('amount', amount.trim())
    return url.toString()
  }

  function replaceSwapUrl(targetPool: Pool, targetSellAssetId: string) {
    window.history.replaceState(null, '', swapUrl(targetPool, targetSellAssetId))
    setLinkCopied(false)
  }

  function navigate(nextPage: Page, nextPoolId?: string) {
    const url = new URL(pathForPage(nextPage, nextPoolId), window.location.origin)
    if (nextPage === 'pools' && poolSearch.trim()) url.searchParams.set('q', poolSearch.trim())
    if (nextPage === 'create' && createMode === 'pool') url.searchParams.set('mode', 'pool')
    window.history.pushState(null, '', `${url.pathname}${url.search}`)
    setPage(nextPage)
    if (nextPage === 'activity') { setActivity([]); setActivityCursor(undefined) }
    if (nextPoolId) setPoolId(nextPoolId)
    setError('')
  }

  function updatePoolSearch(value: string) {
    setPoolSearch(value)
    const url = new URL('/pools', window.location.origin)
    if (value.trim()) url.searchParams.set('q', value.trim())
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  function updateCreateMode(nextMode: 'asset' | 'pool') {
    setCreateMode(nextMode); setError(''); setCreationStep('')
    window.history.replaceState(null, '', nextMode === 'pool' ? '/create?mode=pool' : '/create')
  }

  function updateSwapMode(nextMode: 'swap' | 'deposit' | 'withdraw') {
    setMode(nextMode); setError('')
    if (!liquidityLocked) { setLiquidityAmount(''); setLiquidityRequest(null) }
    const url = new URL(window.location.href)
    url.pathname = '/'
    if (poolId) url.searchParams.set('swap', poolId)
    if (nextMode === 'swap') url.searchParams.delete('mode')
    else url.searchParams.set('mode', nextMode)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  async function copySwapLink() {
    if (!pool) return
    const link = swapUrl(pool, sellAssetId, true)
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const input = document.createElement('textarea')
      input.value = link; input.style.position = 'fixed'; input.style.opacity = '0'
      document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove()
    }
    setLinkCopied(true)
    window.setTimeout(() => setLinkCopied(false), 1800)
  }

  function openPairModal() {
    setModalSellAssetId(sellAssetId || tokenIds[0] || '')
    setModalBuyAssetId(buyAssetId || '')
    setTokenSearch('')
    setShowPairModal(true)
  }

  async function selectModalPayAsset(assetId: string) {
    setModalSellAssetId(assetId)
    if (assetId === modalBuyAssetId) setModalBuyAssetId('')
    try {
      const page = await api<PageResult<Pool>>(`/v1/pools?assetId=${encodeURIComponent(assetId)}&limit=100`)
      setPools((current) => [...new Map([...current, ...page.items].map((item) => [item.id, item])).values()])
    } catch (cause) { setError(errorMessage(cause)) }
  }

  function applyPair() {
    const next = bestPoolForPair(modalSellAssetId, modalBuyAssetId)
    if (!next) return
    replaceSwapUrl(next, modalSellAssetId)
    setPoolId(next.id); setSellAssetId(modalSellAssetId); setAmount(''); setReceiveAmount(''); setQuote(null); setError(''); setShowPairModal(false)
    clearFinishedRequests()
  }

  function switchToPool(target: Pool, history: 'replace' | 'push' = 'replace') {
    const url = swapUrl(target, target.baseAssetId)
    if (history === 'push') window.history.pushState(null, '', url)
    else window.history.replaceState(null, '', url)
    setLinkCopied(false)
    setPoolId(target.id); setSellAssetId(target.baseAssetId); setMode('swap'); setPage('swap')
    setAmount(''); setReceiveAmount(''); setQuote(null); setError('')
    clearFinishedRequests()
  }

  // An open request keeps its status and lock: dropping it would let the user pay twice.
  function clearFinishedRequests() {
    if (!swapLocked) setRequest(null)
    if (!liquidityLocked) setLiquidityRequest(null)
  }

  function setMaxAmount() {
    setQuoteMode('input'); setReceiveAmount(''); setQuote(null)
    if (sellAssetId === 'btc') setAmount(editableAmount(maxBigInt(0n, BigInt(btcBalance) - DUST_SATS), 8))
    else if (sellAsset) setAmount(editableAmount(BigInt(sellAsset.amount), sellDecimals))
  }

  const refreshAssets = useCallback(async () => {
    if (!window.arkade || !address || walletOnWrongNetwork) return
    const [nextAssets, nextBalance] = await Promise.all([window.arkade.getAssets(), window.arkade.getBalance()])
    assertProviderAmounts(nextAssets, nextBalance)
    setAssets(nextAssets); setBtcBalance(nextBalance.available)
  }, [address, walletOnWrongNetwork, setAssets, setBtcBalance])

  const loadWallet = useCallback(async (provider: ArkadeProvider, knownAddress?: string) => {
    const network = await provider.getNetwork()
    const nextAddress = knownAddress ?? await provider.getAddress()
    setWalletNetwork(network); setAddress(nextAddress); setWalletIssue(null); setShowSwitchSteps(false)
    if (network.network !== WALLET_NETWORK) { setAssets([]); setBtcBalance(0); return }
    const [nextAssets, nextBalance] = await Promise.all([provider.getAssets(), provider.getBalance()])
    assertProviderAmounts(nextAssets, nextBalance)
    setAssets(nextAssets); setBtcBalance(nextBalance.available)
  }, [])

  // A locked wallet gets a banner that waits for the unlock; other failures are one-off toasts.
  const showWalletError = useCallback((cause: unknown) => {
    const issue = describeWalletError(cause)
    if (issue.kind === 'locked') setWalletIssue(issue)
    else setToast(`${issue.title}. ${issue.detail}`)
  }, [])

  const refreshPools = useCallback(async () => {
    const page = await api<PageResult<Pool>>('/v1/pools?limit=100')
    setPools(page.items)
    return page.items
  }, [setPools])

  const refreshPoolActivity = useCallback(async () => {
    if (!poolId) return
    const result = await api<CursorPage<ActivityEvent>>(`/v1/pools/${encodeURIComponent(poolId)}/activity?limit=25`)
    setActivity(result.items); setActivityCursor(result.nextCursor)
  }, [poolId, setActivity, setActivityCursor])

  const refreshWalletActivity = useCallback(async () => {
    if (!address) return
    const result = await api<CursorPage<ActivityEvent>>(`/v1/activity?payAddress=${encodeURIComponent(address)}&limit=25`)
    setActivity(result.items); setActivityCursor(result.nextCursor)
  }, [address, setActivity, setActivityCursor])

  const refreshPoints = useCallback(async () => {
    if (!address) return
    const [summary, leaders] = await Promise.all([
      api<PointsSummary>(`/v1/points?address=${encodeURIComponent(address)}`),
      api<{ items: LeaderboardEntry[] }>('/v1/points/leaderboard?limit=5'),
    ])
    setPoints(summary); setLeaderboard(leaders.items)
  }, [address])

  async function loadMoreActivity() {
    if (!activityCursor) return
    const path = page === 'activity'
      ? address ? `/v1/activity?payAddress=${encodeURIComponent(address)}&limit=25&cursor=${encodeURIComponent(activityCursor)}` : undefined
      : poolId ? `/v1/pools/${encodeURIComponent(poolId)}/activity?limit=25&cursor=${encodeURIComponent(activityCursor)}` : undefined
    if (!path) return
    const result = await api<CursorPage<ActivityEvent>>(path)
    setActivity((current) => [...current, ...result.items]); setActivityCursor(result.nextCursor)
  }

  const openPoolDetail = useCallback((target: Pool) => {
    window.history.pushState(null, '', pathForPage('pool', target.id))
    setPoolId(target.id); setPage('pool'); setError('')
  }, [setPoolId, setPage, setError])

  useEffect(() => {
    const onPopState = () => {
      const route = routeFromLocation()
      const params = new URLSearchParams(window.location.search)
      setPage(route.page)
      const nextPoolId = route.poolId ?? ''
      if (nextPoolId) setPoolId(nextPoolId)
      if (route.page === 'pools') setPoolSearch(params.get('q') ?? '')
      if (route.page === 'create') setCreateMode(params.get('mode') === 'pool' ? 'pool' : 'asset')
      if (route.page === 'swap') setMode(['deposit', 'withdraw'].includes(params.get('mode') ?? '') ? params.get('mode') as 'deposit' | 'withdraw' : 'swap')
      setError('')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    Promise.all([api<DeploymentInfo>('/health'), api<PageResult<Pool>>('/v1/pools?limit=100')]).then(([info, page]) => {
      if (info.network !== NETWORK) throw new Error(`This app expects ${NETWORK_LABEL}, but the API is configured for ${info.network}.`)
      if (!/^[1-9]\d*$/.test(info.poolCreationFeeSats)) throw new Error('The API returned an invalid pool creation fee.')
      setDeployment(info)
      setPools(page.items)
      const route = routeFromLocation()
      const params = new URLSearchParams(window.location.search)
      const linked = params.get('swap') ? page.items.find((item) => item.id === params.get('swap') && item.available) : undefined
      const requestedPoolId = route.poolId
      const routed = requestedPoolId ? page.items.find((item) => item.id === requestedPoolId) : undefined
      const first = linked ?? routed
      if (first) {
        setPoolId(first.id)
        setSellAssetId(linked && params.get('side') === 'quote' ? first.quoteAssetId : first.baseAssetId)
        if (linked && params.get('output')) { setReceiveAmount(params.get('output')!); setQuoteMode('output') }
        else if (linked && params.get('amount')) setAmount(params.get('amount')!)
      }
    }).catch((cause: unknown) => setError(errorMessage(cause)))
  }, [])

  useEffect(() => {
    if (page !== 'pools') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ limit: '100' })
      if (poolSearch.trim()) query.set('q', poolSearch.trim())
      api<PageResult<Pool>>(`/v1/pools?${query}`, { signal: controller.signal }).then((result) => {
        setPoolResults(result.items); setPoolResultTotal(result.total); setPoolCursor(result.nextCursor)
      }).catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(errorMessage(cause)) })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [page, poolSearch])

  useEffect(() => {
    if (!showPairModal) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ limit: '100' })
      if (tokenSearch.trim()) query.set('q', tokenSearch.trim())
      api<PageResult<CatalogAsset>>(`/v1/assets?${query}`, { signal: controller.signal }).then((result) => setCatalogAssets(result.items))
        .catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(errorMessage(cause)) })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [showPairModal, tokenSearch])

  // For list buttons on pages without an inline error area: a failure shows as a toast.
  function runWithToast(task: () => Promise<unknown>) {
    void task().catch((cause: unknown) => setToast(errorMessage(cause)))
  }

  async function loadMorePools() {
    if (!poolCursor) return
    const query = new URLSearchParams({ limit: '20', cursor: poolCursor })
    if (poolSearch.trim()) query.set('q', poolSearch.trim())
    const result = await api<PageResult<Pool>>(`/v1/pools?${query}`)
    setPoolResults((current) => [...current, ...result.items]); setPoolCursor(result.nextCursor); setPoolResultTotal(result.total)
  }

  useEffect(() => {
    const provider = window.arkade
    if (!provider || !address) return
    const sync = () => void loadWallet(provider).catch(showWalletError)
    provider.on('accountChanged', sync)
    provider.on('networkChanged', sync)
    return () => { provider.off('accountChanged', sync); provider.off('networkChanged', sync) }
  }, [address, loadWallet, showWalletError])

  // The unlock listener must call the current connect(), not the one from the render that subscribed.
  const latestConnect = useRef(connect)
  useEffect(() => { latestConnect.current = connect })
  const waitingForUnlock = walletIssue?.kind === 'locked'
  useEffect(() => {
    const provider = window.arkade
    if (!provider || !waitingForUnlock) return
    const resume = () => void latestConnect.current()
    provider.on('unlock', resume)
    return () => provider.off('unlock', resume)
  }, [waitingForUnlock])

  useEffect(() => {
    const saved = loadSavedPayments()
    void Promise.all([
      restoreOpenRequest<SwapRequest>(`/v1/swaps/${saved.swap?.id}`, saved.swap),
      restoreOpenRequest<LiquidityRequest>(`/v1/liquidity/${saved.liquidity?.id}`, saved.liquidity),
      restoreFundedPoolCreation(saved.poolCreation),
    ]).then(([swapRequest, openLiquidity, fundedPool]) => {
      if (swapRequest) setRequest(swapRequest)
      if (openLiquidity) { setLiquidityRequest(openLiquidity); setToast('A liquidity request is still in progress. Open Add or Remove on the swap page to follow it.') }
      if (fundedPool) { setPoolCreation(fundedPool); setToast('A funded pool has not opened yet. Go to Create → Create pool and click Retry opening.') }
    }).finally(() => setPaymentsRestored(true))
  }, [])

  useEffect(() => {
    if (!paymentsRestored) return
    const remember = (kind: PaymentKind, open: { id: string; fundingTxid?: string } | null) => savePayment(kind, open && { id: open.id, fundingTxid: open.fundingTxid })
    remember('swap', swapLocked ? request : null)
    remember('liquidity', liquidityLocked ? liquidityRequest : null)
    remember('poolCreation', poolOpeningPending ? poolCreation : null)
  }, [paymentsRestored, request, swapLocked, liquidityRequest, liquidityLocked, poolCreation, poolOpeningPending])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 6_000)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!address) return
    const initial = window.setTimeout(() => void refreshPoints().catch(() => undefined), 0)
    const refresh = window.setInterval(() => void refreshPoints().catch(() => undefined), 15_000)
    return () => { window.clearTimeout(initial); window.clearInterval(refresh) }
  }, [address, refreshPoints])

  const quoteRequestAmount = quoteMode === 'input' ? raw : receiveRaw
  useEffect(() => {
    if (!pool || !quoteRequestAmount || !sellAssetId || !buyAssetId || !pool.available) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const query = quoteMode === 'input'
        ? `sellAssetId=${encodeURIComponent(sellAssetId)}&amount=${quoteRequestAmount}`
        : `buyAssetId=${encodeURIComponent(buyAssetId)}&outputAmount=${quoteRequestAmount}`
      api<Quote>(`/v1/pools/${pool.id}/quote?${query}`, { signal: controller.signal })
        .then((next) => {
          setQuote(next)
          if (quoteMode === 'input') setReceiveAmount(editableAmount(next.outputAmount, buyDecimals))
          else if (next.inputAmount) setAmount(editableAmount(next.inputAmount, sellDecimals))
        }).catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(errorMessage(cause)) })
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [pool, quoteRequestAmount, quoteMode, sellAssetId, buyAssetId, sellDecimals, buyDecimals])

  useEffect(() => {
    if (!request || ['settled', 'refunded', 'failed'].includes(request.status)) return
    const timer = window.setInterval(() => {
      api<SwapRequest>(`/v1/swaps/${request.id}`).then((next) => {
        setRequest((current) => withKnownFundingTxid(next, current))
        if (next.status === 'settled') { setAmount(''); setReceiveAmount(''); setQuote(null); setQuoteMode('input') }
        if (next.status === 'settled' || next.status === 'refunded') { void refreshAssets(); void refreshPools(); void refreshPoints() }
      }).catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [request, refreshAssets, refreshPools, refreshPoints])

  useEffect(() => {
    if (!liquidityRequest || ['settled', 'refunded', 'failed'].includes(liquidityRequest.status)) return
    const timer = window.setInterval(() => {
      api<LiquidityRequest>(`/v1/liquidity/${liquidityRequest.id}`).then((next) => {
        setLiquidityRequest((current) => withKnownFundingTxid(next, current))
        if (next.status === 'settled') setLiquidityAmount('')
        if (next.status === 'settled' || next.status === 'refunded') { void refreshAssets(); void refreshPools() }
      }).catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [liquidityRequest, refreshAssets, refreshPools])

  useEffect(() => {
    if (page !== 'pool' || !poolId) return
    void Promise.all([
      api<CursorPage<ActivityEvent>>(`/v1/pools/${encodeURIComponent(poolId)}/activity?limit=25`).then((result) => { setActivity(result.items); setActivityCursor(result.nextCursor) }),
      api<Pool>(`/v1/pools/${encodeURIComponent(poolId)}`).then((next) => setPools((current) => [...new Map([...current, next].map((item) => [item.id, item])).values()])),
    ]).catch((cause: unknown) => setError(errorMessage(cause)))
    const timer = window.setInterval(() => void refreshPoolActivity().catch(() => undefined), 15_000)
    return () => window.clearInterval(timer)
  }, [page, poolId, refreshPoolActivity])

  useEffect(() => {
    if (page !== 'activity' || !address) return
    const initial = window.setTimeout(() => void refreshWalletActivity().catch((cause: unknown) => setError(errorMessage(cause))), 0)
    const refresh = window.setInterval(() => void refreshWalletActivity().catch(() => undefined), 15_000)
    return () => { window.clearTimeout(initial); window.clearInterval(refresh) }
  }, [page, address, refreshWalletActivity])

  async function connect() {
    const provider = window.arkade
    if (!provider) { setWalletIssue(MISSING_WALLET); return }
    setConnecting(true); setWalletIssue(null)
    try {
      // A locked wallet opens its own unlock window (older versions answer
      // "Wallet is locked", which shows the unlock banner instead).
      const [connected] = await provider.connect()
      setPoints(null); setLeaderboard([])
      await loadWallet(provider, connected)
    } catch (cause) { showWalletError(cause) }
    finally { setConnecting(false) }
  }

  async function switchWalletNetwork() {
    const provider = window.arkade
    if (!provider?.switchNetwork) { setShowSwitchSteps(true); return }
    try { await provider.switchNetwork(WALLET_NETWORK) } catch (cause) {
      if (describeWalletError(cause).kind === 'rejected') setToast(`Network switch declined in Inscrib3 Wallet. This app needs ${APP_NETWORK_NAME}.`)
      else showWalletError(cause)
    }
  }

  function requireWallet() {
    return address ? switchWalletNetwork() : connect()
  }

  async function createAsset() {
    if (!walletReady) return requireWallet()
    const valid = assetValidation.valid
    if (!window.arkade || !valid) return
    setBusy(true); setError(''); setIssuedAsset(null); setCreationStep('Approve asset issuance in Inscrib3 Wallet')
    try {
      await assertWalletNetwork(window.arkade)
      const result = await window.arkade.issueAsset({
        amount: walletNumber(valid.supply, 'asset supply'),
        metadata: { name: valid.name, ticker: valid.ticker, decimals: valid.decimals, ...(valid.icon ? { icon: valid.icon } : {}) },
      })
      setIssuedAsset(result); setCreationStep('Asset created'); setAssetForm(EMPTY_ASSET_FORM); await refreshAssets()
    } catch (cause) { setError(errorMessage(cause)); setCreationStep('') }
    finally { setBusy(false) }
  }

  async function createPool() {
    if (!walletReady) return requireWallet()
    if (!window.arkade || !deployment) { if (!deployment) setError('Deployment configuration is not available.'); return }
    const valid = poolValidation.valid
    if (!valid || !creationBaseDetails || !poolForm.id || !poolForm.name) return
    const { baseAmount, quoteAmount, feeBps, protocolFeeBps } = valid
    const baseDecimals = creationBaseDetails.decimals
    const safeBase = walletNumber(baseAmount, 'initial base reserve'); const safeQuote = walletNumber(quoteAmount, 'initial quote reserve')
    setBusy(true); setError(''); setPoolCreation(null)
    let fundingTxid: string | undefined
    try {
      await assertWalletNetwork(window.arkade)
      setCreationStep('Checking pair availability')
      const candidates = await api<PageResult<Pool>>(`/v1/pools?assetId=${encodeURIComponent(poolForm.baseAssetId)}&limit=100`)
      const duplicate = candidates.items.find((candidate) => candidate.lifecycle === 'active' && [candidate.baseAssetId, candidate.quoteAssetId].includes(poolForm.baseAssetId)
        && [candidate.baseAssetId, candidate.quoteAssetId].includes(poolForm.quoteAssetId))
      if (duplicate) throw new Error(`A pool already exists for this pair (${duplicate.name}).`)
      const stem = poolForm.name.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 9) || 'POOL'
      const issuanceKey = JSON.stringify([WALLET_NETWORK, address, poolForm.id, stem, baseAmount.toString(), baseDecimals])
      let issued = poolAssetIssuance?.key === issuanceKey ? poolAssetIssuance : null
      let control = issued?.control
      if (!control) {
        setCreationStep('1/5 · Issue the pool control asset')
        control = await issueAssetWithRetry(window.arkade, { amount: 1, metadata: { ticker: `${stem}-CTRL`.slice(0, 16), decimals: 0 } },
          () => setCreationStep('1/5 · Refresh wallet state and retry control asset'))
        issued = { key: issuanceKey, control }
        setPoolAssetIssuance(issued)
      }
      let lp = issued?.lp
      if (!lp) {
        setCreationStep('2/5 · Issue LP tokens')
        lp = await issueAssetWithRetry(window.arkade, { amount: safeBase, controlAssetId: control.assetId, metadata: { ticker: `${stem}-LP`.slice(0, 16), decimals: baseDecimals } },
          () => setCreationStep('2/5 · Refresh wallet state and retry LP tokens'))
        issued = { ...issued!, lp }
        setPoolAssetIssuance(issued)
      }
      let ledger = issued?.ledger
      if (!ledger) {
        setCreationStep('3/5 · Issue the covenant ledger asset')
        ledger = await issueAssetWithRetry(window.arkade, { amount: safeBase, controlAssetId: control.assetId, metadata: { ticker: `${stem}-LEDGER`.slice(0, 16), decimals: 0 } },
          () => setCreationStep('3/5 · Refresh wallet state and retry ledger asset'))
        issued = { ...issued!, ledger }
        setPoolAssetIssuance(issued)
      }
      setCreationStep('4/5 · Register the atomic bootstrap')
      const creation = await api<PoolCreation>('/v1/pools', { method: 'POST', body: JSON.stringify({
        id: poolForm.id, name: poolForm.name, baseAssetId: poolForm.baseAssetId, quoteAssetId: poolForm.quoteAssetId,
        lpAssetId: lp.assetId, lpLedgerAssetId: ledger.assetId, controlAssetId: control.assetId,
        feeBps, protocolFeeBps, payAddress: address, baseAmount: baseAmount.toString(), quoteAmount: quoteAmount.toString(),
        ...(referralCode ? { referralCode } : {}),
      }) })
      setPoolCreation(creation)
      setCreationStep('4/5 · Fund liquidity, carriers, and creation fee atomically')
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const fundingAssets = [
        ...(poolForm.baseAssetId === 'btc' ? [] : [{ assetId: poolForm.baseAssetId, amount: safeBase }]),
        { assetId: poolForm.quoteAssetId, amount: safeQuote }, { assetId: lp.assetId, amount: safeBase },
        { assetId: ledger.assetId, amount: safeBase }, { assetId: control.assetId, amount: 1 },
      ]
      fundingTxid = await window.arkade.sendAsset(creation.bootstrapAddress, fundingAssets, walletNumber(BigInt(creation.bootstrapSats), 'bootstrap satoshis'))
      setPoolCreation({ ...creation, fundingTxid })
      await openFundedPool(creation, fundingTxid)
    } catch (cause) { setError(fundingTxid ? paymentSentMessage(fundingTxid, cause, 'Click Retry opening below; do not create this pool again') : errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function openFundedPool(creation: PoolCreation, fundingTxid: string) {
    setCreationStep('5/5 · Open the covenant pool')
    const opened = await api<PoolCreation>(`/v1/pool-creations/${encodeURIComponent(creation.id)}/open`, { method: 'POST', body: JSON.stringify({ fundingTxid }) })
    setPoolCreation(opened); setCreationStep('Pool opened'); setPoolForm(DEFAULT_POOL_FORM); setPoolAssetIssuance(null)
    await Promise.all([refreshAssets(), refreshPools(), refreshPoints()])
  }

  async function retryPoolOpening() {
    if (!poolCreation?.fundingTxid) return
    const { fundingTxid } = poolCreation
    setBusy(true); setError('')
    try { await openFundedPool(poolCreation, fundingTxid) }
    catch (cause) { setError(paymentSentMessage(fundingTxid, cause, 'Try again in a moment; do not create this pool again')) }
    finally { setBusy(false) }
  }

  function reverse() {
    if (!pool) return
    const nextSellAssetId = sellAssetId === pool.baseAssetId ? pool.quoteAssetId : pool.baseAssetId
    replaceSwapUrl(pool, nextSellAssetId)
    setSellAssetId(nextSellAssetId)
    const previousPay = amount
    setAmount(receiveAmount)
    setReceiveAmount(previousPay)
    setQuoteMode('input')
    setQuote(null)
    clearFinishedRequests()
  }

  async function swap() {
    if (!walletReady) return requireWallet()
    if (!pool || !raw || !quote || !window.arkade || swapBlocker) return
    setBusy(true); setError(''); setRequest(null)
    let fundingTxid: string | undefined
    try {
      await assertWalletNetwork(window.arkade)
      const minOutput = quoteMode === 'output' && receiveRaw
        ? receiveRaw
        : (BigInt(quote.outputAmount) * BigInt(10_000 - slippage)) / 10_000n
      const intent = await api<SwapRequest>(`/v1/pools/${pool.id}/swaps`, {
        method: 'POST', body: JSON.stringify({ payAddress: address, sellAssetId, sellAmount: raw.toString(), minOutput: minOutput.toString(),
          ...(referralCode ? { referralCode } : {}) }),
      })
      setRequest(intent)
      const fundingSats = walletNumber(BigInt(intent.fundingSats), 'swap BTC funding')
      fundingTxid = sellAssetId === 'btc'
        ? await window.arkade.sendToAddress(intent.contractAddress, fundingSats)
        : await window.arkade.sendAsset(intent.contractAddress, [{ assetId: sellAssetId, amount: walletNumber(raw, 'asset funding') }], fundingSats)
      setRequest(await registerFunding<SwapRequest>(`/v1/swaps/${intent.id}`, fundingTxid))
    } catch (cause) { reportFundingFailure(cause, fundingTxid, setRequest) }
    finally { setBusy(false) }
  }

  // Once the wallet has paid, the request must stay open (and the button locked) so nobody pays twice.
  function reportFundingFailure<T extends { fundingTxid?: string }>(cause: unknown, fundingTxid: string | undefined, updateRequest: (update: (current: T | null) => T | null) => void) {
    if (!fundingTxid) { updateRequest(() => null); setError(errorMessage(cause)); return }
    updateRequest((current) => current && { ...current, fundingTxid })
    setError(paymentSentMessage(fundingTxid, cause, 'Click Retry registration below; do not pay again'))
  }

  function registerFunding<T>(requestPath: string, txid: string): Promise<T> {
    return api<T>(`${requestPath}/funding`, { method: 'POST', body: JSON.stringify({ txid }) })
  }

  async function retryRegistration<T extends { id: string; fundingTxid?: string }>(requestPath: string, open: T, setOpen: (value: T) => void) {
    if (!open.fundingTxid) return
    setBusy(true); setError('')
    try { setOpen(await registerFunding<T>(requestPath, open.fundingTxid)) }
    catch (cause) { setError(paymentSentMessage(open.fundingTxid, cause, 'Try again in a moment; do not pay again')) }
    finally { setBusy(false) }
  }

  function paymentSentMessage(fundingTxid: string, cause: unknown, nextStep: string): string {
    return `Payment ${short(fundingTxid, 7)} was sent, but the app could not register it: ${errorMessage(cause)}. ${nextStep}.`
  }

  async function submitLiquidity() {
    if (!walletReady) return requireWallet()
    if (!pool || !liquidityRaw || !liquidityPreview || !window.arkade || mode === 'swap' || liquidityBlocker) return
    setBusy(true); setError(''); setLiquidityRequest(null)
    let fundingTxid: string | undefined
    try {
      await assertWalletNetwork(window.arkade)
      const intent = mode === 'deposit'
        ? await api<LiquidityRequest>(`/v1/pools/${pool.id}/deposits`, { method: 'POST', body: JSON.stringify({ payAddress: address, baseAmount: liquidityRaw.toString() }) })
        : await api<LiquidityRequest>(`/v1/pools/${pool.id}/withdrawals`, { method: 'POST', body: JSON.stringify({ payAddress: address, lpAmount: liquidityRaw.toString() }) })
      setLiquidityRequest(intent)
      const fundingAssets = mode === 'deposit'
        ? [...(pool.baseAssetId === 'btc' ? [] : [{ assetId: pool.baseAssetId, amount: walletNumber(BigInt(intent.baseAmount), 'base funding') }]), { assetId: pool.quoteAssetId, amount: walletNumber(BigInt(intent.quoteAmount), 'quote funding') }]
        : [{ assetId: pool.lpAssetId, amount: walletNumber(BigInt(intent.lpAmount), 'LP funding') }]
      fundingTxid = await window.arkade.sendAsset(intent.contractAddress, fundingAssets, mode === 'deposit'
        ? walletNumber(depositFundingSats(pool, BigInt(intent.baseAmount)), 'deposit BTC funding')
        : undefined)
      setLiquidityRequest(await registerFunding<LiquidityRequest>(`/v1/liquidity/${intent.id}`, fundingTxid))
    } catch (cause) { reportFundingFailure(cause, fundingTxid, setLiquidityRequest) }
    finally { setBusy(false) }
  }

  const balance = sellAssetId === 'btc' ? displayAmount(BigInt(btcBalance), 8, 8) : sellAsset ? displayAmount(BigInt(sellAsset.amount), sellDecimals, 4) : '0'
  const walletActionLabel = !address ? 'Connect Inscrib3 Wallet' : walletOnWrongNetwork ? SWITCH_NETWORK_LABEL : null
  const baseTicker = pool?.baseAssetId === 'btc' ? 'BTC' : baseAsset?.metadata?.ticker ?? pool?.baseAssetInfo?.metadata?.ticker ?? 'BASE'
  const quoteTicker = pool?.quoteAssetId === 'btc' ? 'BTC' : quoteAsset?.metadata?.ticker ?? pool?.quoteAssetInfo?.metadata?.ticker ?? 'QUOTE'
  const swapBlocker = describeSwapBlocker()
  const liquidityBlocker = describeLiquidityBlocker()
  const assetFormBlocker = firstFormError(assetValidation.errors, ASSET_FIELD_LABELS)
  const poolFormBlocker = !paymentsRestored ? 'Checking unfinished payments…'
    : poolOpeningPending ? 'Finish opening your funded pool first'
    : deployment ? firstFormError(poolValidation.errors, POOL_FIELD_LABELS) : 'Pool creation is unavailable right now'

  function describeSwapBlocker(): string | null {
    if (!paymentsRestored) return 'Checking unfinished payments…'
    if (request && swapLocked) return request.status === 'failed' ? 'Dismiss the failed swap to retry' : 'Swap in progress…'
    if (!pool) return 'Select a token pair'
    if (!pool.available) return 'Pool unavailable'
    if (!pool.swapEnabled) return 'Legacy pool · swaps disabled during migration'
    const typedAmount = quoteMode === 'input' ? sellAmountCheck : parseDisplayAmount(receiveAmount, buyDecimals)
    if ('error' in typedAmount) return typedAmount.error
    if (raw && raw > walletBalance(sellAssetId)) return `Insufficient ${sellTicker} balance`
    if (!quote) return 'Finding best price…'
    if (raw && swapFundingSats(raw, quote) > walletBalance('btc')) return sellAssetId === 'btc' ? 'Insufficient BTC balance (network fee included)' : 'Not enough BTC for the network fee'
    return null
  }

  // Mirrors the API's swapFundingSats: the BTC the wallet sends with a swap.
  function swapFundingSats(sellAmount: bigint, swapQuote: Quote): bigint {
    return DUST_SATS + (sellAssetId === 'btc' ? sellAmount : BigInt(swapQuote.carrierFeeSats))
  }

  function describeLiquidityBlocker(): string | null {
    if (!paymentsRestored) return 'Checking unfinished payments…'
    if (liquidityRequest && liquidityLocked) return liquidityRequest.status === 'failed' ? 'Dismiss the failed request to retry' : 'Request in progress…'
    if (!pool?.available) return 'Pool unavailable'
    if (mode === 'deposit' && !pool.depositEnabled) return 'Legacy pool · deposits disabled during migration'
    if (mode === 'withdraw' && !pool.withdrawalEnabled) return 'Withdrawals unavailable'
    const typedAmount = parseDisplayAmount(liquidityAmount, mode === 'withdraw' ? lpDecimals : baseDecimals)
    if ('error' in typedAmount) return typedAmount.error
    if (!liquidityPreview) return 'Pool reserves unavailable'
    const shortTicker = liquidityShortfallTicker(pool, liquidityPreview)
    if (shortTicker) return `Insufficient ${shortTicker} balance`
    return null
  }

  function liquidityShortfallTicker(target: Pool, preview: { base: bigint; quote: bigint; lp: bigint }): string | null {
    if (mode === 'withdraw') return preview.lp > walletBalance(target.lpAssetId) ? 'LP' : null
    if (preview.base > walletBalance(target.baseAssetId)) return baseTicker
    if (preview.quote > walletBalance(target.quoteAssetId)) return quoteTicker
    if (depositFundingSats(target, preview.base) > walletBalance('btc')) return 'BTC (network fee included)'
    return null
  }

  function depositFundingSats(target: Pool, baseAmount: bigint): bigint {
    return DUST_SATS + (target.baseAssetId === 'btc' ? baseAmount : 0n)
  }

  return (
    <div className="app-shell">
      <header>
        <button className="brand" onClick={() => navigate('swap')} aria-label="Inscrib3 app home"><img src="/logo.svg" alt="" /><span>INSCRIB3</span><small>APP</small></button>
        <nav>{(['swap', 'pools', 'create', 'activity'] as const).map((item) => <button key={item} className={page === item || (item === 'pools' && page === 'pool') ? 'active' : ''} onClick={() => { navigate(item); if (item === 'pools') runWithToast(refreshPools) }}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}<a className="nav-docs" href={DOCS_URL} target="_blank" rel="noreferrer">Docs ↗</a></nav>
        <div className="header-actions"><span className="network"><i /> {NETWORK_LABEL}</span>{address && <button className="points-chip" onClick={() => navigate('activity')} title="Your portable points"><span>◆</span>{points ? comma(points.total) : '—'} PTS</button>}{address ? <span className={`wallet-address${walletOnWrongNetwork ? ' wrong-network' : ''}`} title={address}>{short(address, 4)}</span> : <button className="wallet-small" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}</button>}</div>
      </header>

      {toast && <div className="toast error-toast" role="alert"><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss notification">×</button></div>}

      {walletOnWrongNetwork && walletNetwork ? <div className="wallet-banner" role="alert">
        <div><b>Switch Inscrib3 Wallet to {APP_NETWORK_NAME}</b><span>Your wallet is on {walletNetwork.displayName}. This app runs on {APP_NETWORK_NAME}.</span>
          {showSwitchSteps && <span>This wallet version can't switch from here. Open Inscrib3 Wallet, go to Settings → Network and choose {APP_NETWORK_NAME}. This page updates by itself.</span>}</div>
        <button className="wallet-small" onClick={() => void switchWalletNetwork()}>{SWITCH_NETWORK_LABEL}</button>
      </div> : walletIssue && <div className="wallet-banner" role="alert">
        <div><b>{walletIssue.title}</b><span>{walletIssue.detail}</span></div>
        {walletIssue.kind === 'missing'
          ? <a className="wallet-small" href={WALLET_INSTALL_URL} target="_blank" rel="noreferrer">Install wallet</a>
          : <button className="wallet-small" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Try again'}</button>}
      </div>}

      <main>
        {page === 'swap' ? <>
        <section className="intro">
          <span className="eyebrow"><i /> PROGRAMMABLE BITCOIN / AMM</span>
          <h1>Native liquidity.<br /><em>Built on Bitcoin.</em></h1>
          <p>Swap BTC and Arkade assets through covenant-enforced liquidity. No bridges, no wrapped Bitcoin, no custody.</p>
        </section>

        {onFirePool && onFireBase && onFireQuote && <section className="fire-route-banner">
          <div className="fire-route-icon" aria-hidden="true">🔥</div>
          <div className="marks"><TokenMark label={onFireBase.ticker} /><TokenMark label={onFireQuote.ticker} warm /></div>
          <div className="fire-route-copy"><span>ON FIRE · TRENDING POOL</span><h2>{onFireBase.ticker} / {onFireQuote.ticker}</h2><p>{onFirePool.activity24h ?? 0} settled actions in the last 24 hours · {onFirePool.feeBps / 100}% total fee</p></div>
          <button className="secondary" disabled={pool?.id === onFirePool.id && mode === 'swap'} onClick={() => switchToPool(onFirePool)}>{pool?.id === onFirePool.id && mode === 'swap' ? 'Active pair' : 'Switch to this pool'}</button>
        </section>}

        {pool?.available && <PriceChart key={`swap-${pool.id}`} pool={pool} baseTicker={baseTicker} quoteTicker={quoteTicker} baseDecimals={baseDecimals} quoteDecimals={quoteDecimals} />}

        <section className="workspace" id="swap">
          <div className="swap-card">
            <div className="card-head"><div><h2>{mode === 'swap' ? 'Swap assets' : mode === 'deposit' ? 'Add liquidity' : 'Remove liquidity'}</h2><span>Covenant-enforced constant-product pool</span></div>{mode === 'swap' && <button className="icon-button" onClick={() => setShowSettings(!showSettings)} aria-label="Swap settings">⚙</button>}</div>
            <div className="mode-tabs">{(['swap', 'deposit', 'withdraw'] as const).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => updateSwapMode(item)}>{item === 'swap' ? 'Swap' : item === 'deposit' ? 'Add' : 'Remove'}</button>)}</div>
            {mode === 'swap' && <>
              {showSettings && <div className="settings"><span>Max slippage</span><div>{[10, 50, 100].map((v) => <button className={slippage === v ? 'selected' : ''} key={v} onClick={() => setSlippage(v)}>{v / 100}%</button>)}</div></div>}
              <div className="asset-box">
              <div className="asset-top"><label>You pay</label><button className="balance" onClick={setMaxAmount} disabled={swapLocked}>Balance: {balance} <b>MAX</b></button></div>
              <div className="asset-main">
                <input value={amount} onChange={(event) => { setQuoteMode('input'); setAmount(event.target.value); setReceiveAmount(''); setQuote(null); setRequest(null); setError('') }} placeholder="0" inputMode="decimal" aria-label="Amount to sell" disabled={swapLocked} />
                <button className="token-select" onClick={openPairModal}><TokenMark label={sellTicker} /><span>{sellTicker}</span><small>⌄</small></button>
              </div>
              <div className="asset-foot"><span>{sellAssetId ? tokenDetails(sellAssetId).name : 'Select a pool'}</span><span>Arkade asset</span></div>
              </div>

              <div className="switch-row"><span /><button onClick={reverse} disabled={swapLocked} aria-label="Reverse swap direction">↓</button><span /></div>

              <div className="asset-box receive">
              <div className="asset-top"><label>You receive</label><span>{quoteMode === 'output' ? 'Exact output' : 'Estimated'}</span></div>
              <div className="asset-main"><input value={receiveAmount} onChange={(event) => { setQuoteMode('output'); setReceiveAmount(event.target.value); setAmount(''); setQuote(null); setRequest(null); setError('') }} placeholder="0" inputMode="decimal" aria-label="Amount to receive" disabled={swapLocked} /><button className="token-select" onClick={openPairModal}><TokenMark label={buyTicker} warm /><span>{buyTicker}</span><small>⌄</small></button></div>
              <div className="asset-foot"><span>{buyAssetId ? tokenDetails(buyAssetId).name : '—'}</span><span>{quoteMode === 'output' ? `Quoted output: ${quote ? displayAmount(quote.outputAmount, buyDecimals) : '—'}` : `Minimum: ${quote ? displayAmount((BigInt(quote.outputAmount) * BigInt(10_000 - slippage)) / 10_000n, buyDecimals) : '—'}`}</span></div>
              </div>

              {quote && <div className="route-details">
              <div><span>Route</span><b>{sellTicker} <i>→</i> {buyTicker}</b></div>
              <div><span>Total fee</span><b>{(pool!.feeBps / 100).toFixed(2)}%</b></div>
              <div><span>LP fee</span><b>{((pool!.feeBps - pool!.protocolFeeBps) / 100).toFixed(2)}%</b></div>
              <div><span>Protocol fee</span><b>{(pool!.protocolFeeBps / 100).toFixed(2)}%</b></div>
              <div><span>Points earned</span><b className="points-earned">+{comma(quote.rewardPoints ?? '1')} PTS</b></div>
              {BigInt(quote.carrierFeeSats) > 0n && <div><span>Carrier fee</span><b>{comma(quote.carrierFeeSats)} sats</b></div>}
              <div><span>Price impact</span><b className={quote.priceImpactBps > 300 ? 'danger' : 'positive'}>{(quote.priceImpactBps / 100).toFixed(2)}%</b></div>
              <div><span>Slippage protection</span><b>{(slippage / 100).toFixed(2)}%</b></div>
              </div>}

              <button className="primary" onClick={() => void swap()} disabled={busy || connecting || (walletReady && swapBlocker !== null)}>{busy && <Spinner />}{walletActionLabel ?? swapBlocker ?? 'Review & swap'}</button>
            </>}

            {mode !== 'swap' && <>
              <div className="asset-box">
                <div className="asset-top"><label>{mode === 'deposit' ? 'Base amount to add' : 'LP tokens to burn'}</label><span>Raw-unit exact</span></div>
                <div className="asset-main">
                  <input value={liquidityAmount} onChange={(event) => { setLiquidityAmount(event.target.value); setLiquidityRequest(null); setError('') }} placeholder="0" inputMode="decimal" aria-label="Liquidity amount" disabled={liquidityLocked} />
                  <div className="token-select static"><TokenMark label={mode === 'deposit' ? baseTicker : 'LP'} /><span>{mode === 'deposit' ? baseTicker : 'LP'}</span></div>
                </div>
                <div className="asset-foot"><span>{mode === 'deposit' ? `Balance: ${pool?.baseAssetId === 'btc' ? displayAmount(BigInt(btcBalance), 8, 8) : baseAsset ? displayAmount(BigInt(baseAsset.amount), baseDecimals) : '0'}` : `Balance: ${lpAsset ? displayAmount(BigInt(lpAsset.amount), lpDecimals) : '0'}`}</span><span>{mode === 'deposit' ? 'Pool ratio is fixed at funding' : 'Pro-rata redemption'}</span></div>
              </div>
              <div className="liquidity-preview">
                <div><span>{mode === 'deposit' ? 'Required quote' : 'Base received'}</span><b>{liquidityPreview ? displayAmount(mode === 'deposit' ? liquidityPreview.quote : liquidityPreview.base, mode === 'deposit' ? quoteDecimals : baseDecimals) : '—'} {mode === 'deposit' ? quoteTicker : baseTicker}</b></div>
                <div><span>{mode === 'deposit' ? 'LP received' : 'Quote received'}</span><b>{liquidityPreview ? displayAmount(mode === 'deposit' ? liquidityPreview.lp : liquidityPreview.quote, mode === 'deposit' ? lpDecimals : quoteDecimals) : '—'} {mode === 'deposit' ? 'LP' : quoteTicker}</b></div>
              </div>
              <button className="primary" onClick={() => void submitLiquidity()} disabled={busy || connecting || (walletReady && liquidityBlocker !== null)}>{busy && <Spinner />}{walletActionLabel ?? liquidityBlocker ?? (mode === 'deposit' ? 'Fund liquidity deposit' : 'Fund LP withdrawal')}</button>
            </>}
            {error && <div className="notice error"><b>Transaction unavailable</b><span>{error}</span></div>}
            {mode === 'swap' && request && <RequestNotice noun="Swap" request={request} busy={busy} onDismiss={() => setRequest(null)} onRetryRegistration={() => void retryRegistration(`/v1/swaps/${request.id}`, request, setRequest)} />}
            {mode !== 'swap' && liquidityRequest && <RequestNotice noun="Liquidity request" request={liquidityRequest} busy={busy} onDismiss={() => setLiquidityRequest(null)} onRetryRegistration={() => void retryRegistration(`/v1/liquidity/${liquidityRequest.id}`, liquidityRequest, setLiquidityRequest)} />}
            {controlledPoolAssets.length > 0 && <div className="notice asset-risk"><b>Controlled asset supply</b><span>{controlledPoolAssets.map((info) => `${info.assetId === pool?.baseAssetId ? baseTicker : quoteTicker}: ${short(info.controlAssetId ?? '', 8)}`).join(' · ')}. Holders of these control assets may authorize additional issuance, which can affect pool value.</span></div>}
            <p className="security"><span>◇</span> Your wallet funds a covenant-bound request. The coordinator cannot redirect your payout.</p>
          </div>

          <aside>
            <div className="panel pool-panel" id="pools">
              <div className="panel-head"><span>AUTOMATIC ROUTE</span><div className="panel-actions"><button className="share-link" onClick={() => void copySwapLink()}>{linkCopied ? 'Copied' : 'Copy link'}</button><button className="change-pair" onClick={openPairModal}>Change pair</button></div></div>
               <div className="pair"><div className="marks"><TokenMark label={sellTicker} /><TokenMark label={buyTicker} warm /></div><div><div className="pair-title-row"><h3>{pool?.name ?? 'No pool configured'}</h3>{pool?.lifecycle === 'withdraw-only' && <span className="fire-badge">Legacy · withdraw only</span>}{pool?.onFire && <span className="fire-badge" title={`${pool.activity24h ?? 0} settled operations in the last 24 hours`}>🔥 On fire</span>}</div><p><i className={pool?.available ? 'online' : ''} /> {pool?.available ? 'Pool readable' : 'Unavailable'} · {pool?.feeBps ?? 0} bps{pool?.onFire ? ` · ${pool.activity24h} actions / 24h` : ''}</p></div></div>
              <div className="pool-stats"><div><span>Base reserve</span><b>{pool?.baseReserve ? comma(pool.baseReserve) : '—'}</b></div><div><span>Quote reserve</span><b>{pool?.quoteReserve ? comma(pool.quoteReserve) : '—'}</b></div><div><span>LP supply</span><b>{pool?.lpSupply ? comma(pool.lpSupply) : '—'}</b></div></div>
              <div className="pool-foot"><span>{pool?.protocolFeeBps ? 'Covenant fee vault active' : 'LP fees only'}</span>{pool ? <button className="pool-detail-link" onClick={() => openPoolDetail(pool)}>Pool details →</button> : <span>Up to {deployment?.maxSwapBatch ?? 16} swaps / sweep</span>}</div>
            </div>

            <div className="panel how-panel">
              <span className="panel-label">HOW IT WORKS</span>
              <ol><li><b>1</b><div><strong>Fund a standing swap</strong><span>Your assets enter a payout-bound contract.</span></div></li><li><b>2</b><div><strong>Requests are batched</strong><span>Up to {deployment?.maxSwapBatch ?? 16} swaps update the pool atomically.</span></div></li><li><b>3</b><div><strong>Receive automatically</strong><span>The bought asset lands directly in your wallet.</span></div></li></ol>
              <a className="panel-doc-link" href="https://docs.inscrib3.com/app/swaps" target="_blank" rel="noreferrer">Read the swap guide ↗</a>
            </div>
          </aside>
        </section>
        </> : page === 'pools' ? <section className="view-page">
          <div className="view-heading"><div><span className="eyebrow"><i /> LIVE LIQUIDITY</span><h1>Pools</h1><p>Current covenant reserves and AMM identifiers.</p></div><button className="secondary" onClick={() => runWithToast(refreshPools)}>Refresh</button></div>
          <div className="pool-search-row">
            <label className="search-field"><span aria-hidden="true">⌕</span><input type="search" value={poolSearch} onChange={(event) => updatePoolSearch(event.target.value)} placeholder="Search by pool, ticker or asset ID" aria-label="Search pools" />{poolSearch && <button type="button" onClick={() => updatePoolSearch('')} aria-label="Clear pool search">×</button>}</label>
            <span>{filteredPools.length} of {poolResultTotal} pools</span>
          </div>
          {filteredPools.length === 0 ? <div className="empty-state search-empty">No pools match “{poolSearch.trim()}”.</div> : <div className="pool-grid">{filteredPools.map((item) => {
            const walletBase = assets.find((asset) => asset.assetId === item.baseAssetId)
            const walletQuote = assets.find((asset) => asset.assetId === item.quoteAssetId)
            const itemBaseTicker = item.baseAssetId === 'btc' ? 'BTC' : walletBase?.metadata?.ticker ?? item.baseAssetInfo?.metadata?.ticker ?? 'ASSET'
            const itemQuoteTicker = item.quoteAssetId === 'btc' ? 'BTC' : walletQuote?.metadata?.ticker ?? item.quoteAssetInfo?.metadata?.ticker ?? 'ASSET'
            const itemBaseDecimals = item.baseAssetId === 'btc' ? 8 : walletBase?.metadata?.decimals ?? item.baseAssetInfo?.metadata?.decimals ?? 0
            const itemQuoteDecimals = item.quoteAssetId === 'btc' ? 8 : walletQuote?.metadata?.decimals ?? item.quoteAssetInfo?.metadata?.decimals ?? 0
            return <article className="pool-card" key={item.id}>
              <div className="pool-card-title"><div className="marks"><TokenMark label={itemBaseTicker} /><TokenMark label={itemQuoteTicker} warm /></div><div className="pool-title-content"><div className="pool-title-row"><h2>{item.name}</h2>{item.onFire && <span className="fire-badge" title={`${item.activity24h ?? 0} settled operations in the last 24 hours`}>🔥 On fire</span>}</div><span className={item.available ? 'live' : 'offline'}>{item.available ? 'Active' : 'Unavailable'}{item.onFire ? ` · ${item.swaps24h ?? 0} swaps · ${item.liquidityEvents24h ?? 0} liquidity updates / 24h` : ''}</span></div></div>
              <div className="reserve-list"><div><span>{itemBaseTicker} reserve</span><b>{item.baseReserve ? displayAmount(item.baseReserve, itemBaseDecimals, 8) : '—'} {itemBaseTicker}</b></div><div><span>{itemQuoteTicker} reserve</span><b>{item.quoteReserve ? displayAmount(item.quoteReserve, itemQuoteDecimals, 6) : '—'} {itemQuoteTicker}</b></div><div><span>LP supply</span><b>{item.lpSupply ? displayAmount(item.lpSupply, itemBaseDecimals, 8) : '—'} LP</b></div><div><span>LP / protocol fee</span><b>{((item.feeBps - item.protocolFeeBps) / 100).toFixed(2)}% / {(item.protocolFeeBps / 100).toFixed(2)}%</b></div><div><span>Accrued {itemBaseTicker} fees</span><b>{item.accruedBaseFees ? displayAmount(item.accruedBaseFees, itemBaseDecimals, 8) : '0'} {itemBaseTicker}</b></div><div><span>Accrued {itemQuoteTicker} fees</span><b>{item.accruedQuoteFees ? displayAmount(item.accruedQuoteFees, itemQuoteDecimals, 6) : '0'} {itemQuoteTicker}</b></div></div>
              <div className="id-list"><div><span>Quote asset</span><code>{short(item.quoteAssetId, 10)}</code></div><div><span>LP asset</span><code>{short(item.lpAssetId, 10)}</code></div></div>
              {(item.baseAssetInfo?.controlled || item.quoteAssetInfo?.controlled) && <div className="pool-risk"><b>Controlled supply</b><span>{[item.baseAssetInfo, item.quoteAssetInfo].filter((info) => info?.controlled).map((info) => short(info!.controlAssetId ?? '', 8)).join(' · ')}</span></div>}
              {item.error && <p className="pool-error">{item.error}</p>}
               <div className="pool-card-actions"><button className="secondary" onClick={() => openPoolDetail(item)}>View details</button><button className="secondary" onClick={() => switchToPool(item, 'push')}>Trade this pool</button></div>
             </article>
           })}</div>}
           {poolCursor && <button className="secondary load-more" onClick={() => runWithToast(loadMorePools)}>Load more pools</button>}
        </section> : page === 'pool' ? <section className="view-page pool-detail-page">
          {!pool ? <div className="empty-state">Pool not found.</div> : (() => {
            const base = tokenDetails(pool.baseAssetId)
            const quoteToken = tokenDetails(pool.quoteAssetId)
            const baseReserve = BigInt(pool.baseReserve ?? '0')
            const quoteReserve = BigInt(pool.quoteReserve ?? '0')
            const quotePerBase = ratio(quoteReserve * 10n ** BigInt(base.decimals), baseReserve * 10n ** BigInt(quoteToken.decimals))
            const basePerQuote = ratio(baseReserve * 10n ** BigInt(quoteToken.decimals), quoteReserve * 10n ** BigInt(base.decimals))
            return <>
              <div className="pool-detail-hero">
                <button className="back-link" onClick={() => navigate('pools')}>← All pools</button>
                <div className="pool-detail-title"><div className="marks"><TokenMark label={base.ticker} /><TokenMark label={quoteToken.ticker} warm /></div><div><span className="eyebrow"><i /> POOL DETAIL</span><div className="pool-title-row"><h1>{pool.name}</h1>{pool.lifecycle === 'withdraw-only' && <span className="fire-badge">Legacy · withdraw only</span>}{pool.onFire && <span className="fire-badge" title={`${pool.activity24h ?? 0} settled operations in the last 24 hours`}>🔥 On fire</span>}</div><p><span className={pool.available ? 'live-dot' : 'offline-dot'} /> {pool.available ? pool.lifecycle : 'Pool unavailable'} · {pool.contractGeneration} · {pool.feeBps} bps total fee</p></div></div>
                <button className="primary compact" onClick={() => switchToPool(pool, 'push')}>{pool.swapEnabled ? 'Trade this pool' : 'Manage withdrawal'}</button>
              </div>

              <div className="metric-grid">
                <div><span>{quoteToken.ticker} per {base.ticker}</span><b>{quotePerBase}</b><small>Spot price from current reserves</small></div>
                <div><span>{base.ticker} per {quoteToken.ticker}</span><b>{basePerQuote}</b><small>Inverse spot price</small></div>
                <div><span>24h activity</span><b>{pool.activity24h ?? 0}</b><small>{pool.swaps24h ?? 0} swaps · {pool.liquidityEvents24h ?? 0} liquidity</small></div>
                <div><span>LP supply</span><b>{displayAmount(pool.lpSupply ?? '0', base.decimals, 8)}</b><small>{pool.lpAssetId ? short(pool.lpAssetId, 8) : '—'}</small></div>
              </div>

              <PriceChart key={`detail-${pool.id}`} pool={pool} baseTicker={base.ticker} quoteTicker={quoteToken.ticker} baseDecimals={base.decimals} quoteDecimals={quoteToken.decimals} />

              <div className="detail-columns">
                {([{ assetId: pool.baseAssetId, details: base, info: pool.baseAssetInfo, reserve: pool.baseReserve, warm: false }, { assetId: pool.quoteAssetId, details: quoteToken, info: pool.quoteAssetInfo, reserve: pool.quoteReserve, warm: true }] as const).map((token) => <article className="token-detail-card" key={token.assetId}>
                  <div className="token-detail-head"><TokenMark label={token.details.ticker} warm={token.warm} /><div><h2>{token.details.name}</h2><span>{token.details.ticker}</span></div></div>
                  <dl><div><dt>Pool reserve</dt><dd>{displayAmount(token.reserve ?? '0', token.details.decimals, 8)} {token.details.ticker}</dd></div>{(token.assetId === 'btc' || token.info?.supply) && <div><dt>Total supply</dt><dd>{token.assetId === 'btc' ? '21,000,000 BTC max' : displayAmount(token.info!.supply!, token.details.decimals, 8)}</dd></div>}<div><dt>Issuance</dt><dd>{token.info?.controlled ? 'Controlled / reissuable' : token.assetId === 'btc' ? 'Native Bitcoin' : 'No control asset'}</dd></div><div><dt>Asset ID</dt><dd><code title={token.assetId}>{short(token.assetId, 10)}</code></dd></div></dl>
                </article>)}
              </div>

              <div className="activity-section-heading"><div><span className="eyebrow"><i /> LIVE FEED</span><h2>Pool activity</h2><p>Swap, liquidity additions and removals for this pool.</p></div><button className="secondary" onClick={() => runWithToast(refreshPoolActivity)}>Refresh</button></div>
              <div className="activity-panel">
                <div className="activity-head"><span>Type</span><span>Amount</span><span>Status</span><span>Transaction</span></div>
                {activity.length === 0 ? <div className="empty-state">No activity for this pool yet.</div> : activity.map((item) => {
                  const isSwap = item.activityType === 'swap'
                  const sold = isSwap && item.sellAssetId ? tokenDetails(item.sellAssetId) : undefined
                  const amountText = isSwap ? `${displayAmount(item.sellAmount ?? '0', sold?.decimals ?? 0)} ${sold?.ticker ?? 'ASSET'}` : item.activityType === 'deposit' ? `${displayAmount(item.baseAmount, base.decimals)} ${base.ticker} + ${displayAmount(item.quoteAmount, quoteToken.decimals)} ${quoteToken.ticker}` : `${displayAmount(item.lpAmount, base.decimals)} LP`
                  return <div className="activity-row" key={`${item.activityType}-${item.id}`}><div><span className={`activity-icon ${item.activityType}`}>{isSwap ? '↔' : item.activityType === 'deposit' ? '+' : '−'}</span><div><b>{isSwap ? 'Swap' : item.activityType === 'deposit' ? 'Add liquidity' : 'Remove liquidity'}</b><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : short(item.id)}</small></div></div><code>{amountText}</code><span className={`status-pill ${item.status}`}>{item.status.replace('-', ' ')}</span><code title={item.settlementTxid ?? item.fundingTxid ?? ''}>{item.settlementTxid || item.fundingTxid ? short(item.settlementTxid ?? item.fundingTxid!, 7) : '—'}</code></div>
                })}
              </div>
              {activityCursor && <button className="secondary load-more" onClick={() => runWithToast(loadMoreActivity)}>Load more activity</button>}
            </>
          })()}
        </section> : page === 'create' ? <section className="view-page create-page">
          <div className="view-heading"><div><span className="eyebrow"><i /> PERMISSIONLESS ASSETS</span><h1>Create</h1><p>Issue an Arkade asset or open a covenant-enforced liquidity pool from your own wallet.</p></div></div>
          <div className="create-tabs"><button className={createMode === 'asset' ? 'active' : ''} onClick={() => updateCreateMode('asset')}>Create asset</button><button className={createMode === 'pool' ? 'active' : ''} onClick={() => updateCreateMode('pool')}>Create pool</button></div>
          {createMode === 'asset' ? <div className="create-layout">
            <article className="create-card">
              <div className="card-head"><div><h2>Issue a new asset</h2><span>Non-custodial issuance through Inscrib3 Wallet</span></div></div>
              <div className="form-grid">
                <label><span>Name</span><input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="My Arkade Asset" /><FieldError message={assetValidation.errors.name} value={assetForm.name} /></label>
                <label><span>Ticker</span><input value={assetForm.ticker} onChange={(e) => setAssetForm({ ...assetForm, ticker: e.target.value.toUpperCase() })} placeholder="ASSET" maxLength={16} /><FieldError message={assetValidation.errors.ticker} value={assetForm.ticker} /></label>
                <label><span>Initial supply</span><input value={assetForm.supply} onChange={(e) => setAssetForm({ ...assetForm, supply: e.target.value })} placeholder="1000000" inputMode="decimal" /><FieldError message={assetValidation.errors.supply} value={assetForm.supply} /></label>
                <label><span>Decimals</span><input value={assetForm.decimals} onChange={(e) => setAssetForm({ ...assetForm, decimals: e.target.value })} placeholder="0" inputMode="numeric" /><FieldError message={assetValidation.errors.decimals} value={assetForm.decimals} /></label>
                <label className="wide"><span>Icon URL <small>optional</small></span><input value={assetForm.icon} onChange={(e) => setAssetForm({ ...assetForm, icon: e.target.value })} placeholder="https://…" /><FieldError message={assetValidation.errors.icon} value={assetForm.icon} /></label>
              </div>
              <button className="primary" disabled={busy || connecting || (walletReady && assetFormBlocker !== null)} onClick={() => void createAsset()}>{busy && <Spinner />}{walletActionLabel ?? assetFormBlocker ?? 'Review asset issuance'}</button>
              {creationStep && <div className="creation-progress"><i className={issuedAsset ? 'done' : ''} /><span>{creationStep}</span></div>}
              {issuedAsset && <div className="result-box"><span>Asset ID</span><code>{issuedAsset.assetId}</code><span>Issuance transaction</span><code>{issuedAsset.arkTxId}</code></div>}
            </article>
            <aside className="create-info"><span className="panel-label">WHAT HAPPENS</span><h3>Your keys issue the asset</h3><p>The wallet shows an approval before signing. Supply and metadata are submitted directly to Arkade; the AMM backend never receives your keys or assets.</p><ul><li>Raw amounts stay integer-exact</li><li>Metadata is immutable for this issuance</li><li>The asset appears in Inscrib3 Wallet</li></ul></aside>
          </div> : <div className="create-layout">
            <article className="create-card pool-create-card">
              <div className="card-head"><div><h2>Open a liquidity pool</h2><span>Default fee: 0.70% LP + 0.30% protocol</span></div></div>
              <div className="form-grid">
                <label><span>Pool slug <small>derived from tickers</small></span><input value={poolForm.id} placeholder="Select both assets" readOnly /></label>
                <label><span>Display name <small>derived from the pair</small></span><input value={poolForm.name} placeholder="Select both assets" readOnly /></label>
                <label><span>Base asset</span><select value={poolForm.baseAssetId} onChange={(e) => updatePoolPair(e.target.value, poolForm.quoteAssetId)}><option value="btc">BTC · native</option>{assets.map((item) => <option key={item.assetId} value={item.assetId}>{item.metadata?.ticker ?? short(item.assetId)}</option>)}</select></label>
                <label><span>Quote asset</span><select value={poolForm.quoteAssetId} onChange={(e) => updatePoolPair(poolForm.baseAssetId, e.target.value)}><option value="">Select asset</option>{assets.filter((item) => item.assetId !== poolForm.baseAssetId).map((item) => <option key={item.assetId} value={item.assetId}>{item.metadata?.ticker ?? short(item.assetId)}</option>)}</select><FieldError message={poolValidation.errors.quoteAssetId} value={poolForm.quoteAssetId} /></label>
                <label><span>Initial base reserve <small>{creationBaseDetails ? `${creationBaseDetails.ticker} display units · ${creationBaseDetails.decimals} decimals` : 'select an asset'}</small></span><input value={poolForm.baseAmount} onChange={(e) => setPoolForm({ ...poolForm, baseAmount: e.target.value })} placeholder={poolForm.baseAssetId === 'btc' ? '0.002' : '100'} inputMode="decimal" /><FieldError message={poolValidation.errors.baseAmount} value={poolForm.baseAmount} /></label>
                <label><span>Initial quote reserve <small>{creationQuoteDetails ? `${creationQuoteDetails.ticker} display units · ${creationQuoteDetails.decimals} decimals` : 'select an asset'}</small></span><input value={poolForm.quoteAmount} onChange={(e) => setPoolForm({ ...poolForm, quoteAmount: e.target.value })} placeholder="100" inputMode="decimal" /><FieldError message={poolValidation.errors.quoteAmount} value={poolForm.quoteAmount} /></label>
                <label><span>Total fee · bps</span><input value={poolForm.feeBps} onChange={(e) => setPoolForm({ ...poolForm, feeBps: e.target.value })} inputMode="numeric" /><FieldError message={poolValidation.errors.feeBps} value={poolForm.feeBps} /></label>
                <label><span>Protocol fee · min {MIN_PROTOCOL_FEE_BPS} bps</span><input value={poolForm.protocolFeeBps} onChange={(e) => setPoolForm({ ...poolForm, protocolFeeBps: e.target.value })} inputMode="numeric" /><FieldError message={poolValidation.errors.protocolFeeBps} value={poolForm.protocolFeeBps} /></label>
              </div>
              <div className="fee-summary">
                <div><span>Initial liquidity</span><b title={initialLiquiditySummary}>{initialLiquiditySummary}</b></div>
                <div><span>Raw amounts sent to API</span><b title={creationBaseAmount && creationQuoteAmount ? `${creationBaseAmount} / ${creationQuoteAmount}` : undefined}>{creationBaseAmount && creationQuoteAmount ? `${comma(creationBaseAmount)} / ${comma(creationQuoteAmount)}` : 'Converted automatically'}</b></div>
                <div><span>Creation fee · included</span><b>{deployment ? `${comma(deployment.poolCreationFeeSats)} sats` : 'Unavailable'}</b></div>
                <div><span>Technical carriers</span><b>{bootstrapSummary ? `${comma(bootstrapSummary.carrierSats)} sats` : 'Calculated by API'}</b></div>
                <div><span>Total bootstrap funding</span><b title={bootstrapSummary?.total}>{bootstrapSummary?.total ?? 'Returned before payment'}</b></div>
                <div><span>Stable Treasury Vault</span><code title={deployment?.platformTreasuryAddress}>{deployment ? short(deployment.platformTreasuryAddress, 8) : 'Unavailable'}</code></div>
              </div>
              {controlledCreationAssets.length > 0 && <div className="notice asset-risk"><b>Reissuable asset warning</b><span>{controlledCreationAssets.map((asset) => `${asset.metadata?.ticker ?? short(asset.assetId)} · control ${short(asset.controlAssetId!, 8)}`).join(' · ')}. Additional supply may be issued by the control holder.</span></div>}
              <button className="primary" disabled={busy || connecting || (walletReady && poolFormBlocker !== null)} onClick={() => void createPool()}>{busy && <Spinner />}{walletActionLabel ?? poolFormBlocker ?? (poolAssetIssuance ? 'Resume pool creation' : 'Issue pool assets & open pool')}</button>
              {creationStep && <div className="creation-progress"><i className={poolCreation?.status === 'opened' ? 'done' : ''} /><span>{creationStep}</span></div>}
              {poolOpeningPending && <button className="secondary" disabled={busy} onClick={() => void retryPoolOpening()}>Retry opening</button>}
              {poolCreation && <div className="result-box"><span>Status</span><b>{poolCreation.status}</b>{poolCreation.status === 'opened' && <><span>Points earned</span><b className="points-earned">+10 PTS</b></>}<span>Bootstrap covenant</span><code>{poolCreation.bootstrapAddress}</code>{poolCreation.openingTxid && <><span>Opening transaction</span><code>{poolCreation.openingTxid}</code></>}</div>}
            </article>
            <aside className="create-info"><span className="panel-label">ONE ATOMIC FUNDING</span><h3>Permissionless, not custodial</h3><p>Inscrib3 issues the control, LP, and ledger assets, then funds liquidity, technical carriers, and the fixed creation fee in one bootstrap payment. The contract opens and distributes everything atomically.</p><ul><li>BTC remains native and unwrapped</li><li>The creation fee reaches the stable Treasury Vault</li><li>Protocol fee is at least 0.30% and below the total fee</li></ul><a className="panel-doc-link" href="https://docs.inscrib3.com/app/pools-liquidity" target="_blank" rel="noreferrer">Pool and liquidity guide ↗</a></aside>
          </div>}
          {error && <div className="notice error create-error"><b>Creation unavailable</b><span>{error}</span></div>}
        </section> : <section className="view-page">
          <div className="view-heading"><div><span className="eyebrow"><i /> WALLET HISTORY</span><h1>My activity</h1><p>Your portable score, swaps, deposits, and withdrawals across the platform.</p></div>{address && <button className="secondary" onClick={() => runWithToast(() => Promise.all([refreshWalletActivity(), refreshPoints()]))}>Refresh</button>}</div>
          {!address ? <div className="empty-state activity-connect-state"><div className="activity-connect-icon">◇</div><h2>Connect your wallet</h2><p>Connect Inscrib3 Wallet to view your score and activity across every pool.</p><button className="secondary" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}</button></div> : <>
          <div className="points-dashboard">
            <section className="points-score-card"><span>YOUR SCORE</span><div><b>{points ? comma(points.total) : '—'}</b><em>PTS</em></div><p>{points?.rank ? `Rank #${points.rank} of ${points.participants}` : 'Complete an eligible action to enter the ranking'}</p><small>Mutinynet points will migrate to Mainnet with the same wallet identity.</small><a href="https://docs.inscrib3.com/app/points" target="_blank" rel="noreferrer">Migration details ↗</a></section>
            <section className="points-breakdown"><div><span>POOL CREATION</span><b>{points ? comma(points.poolPoints) : '—'}</b><small>10 points per opened pool</small></div><div><span>SWAPS</span><b>{points ? comma(points.swapPoints) : '—'}</b><small>At least 1 point · scales with protocol fee sats</small></div></section>
            <section className="referral-card"><div><span>REFERRALS</span><b>{points ? comma(points.referralPoints) : '—'} PTS</b><small>{points?.referredUsers ?? 0} referred wallets · +1 per opened pool or settled swap</small></div>{points && <><code>{`${window.location.origin}/?ref=${points.referralCode}`}</code><div><button onClick={() => window.open(`https://x.com/intent/post?text=${encodeURIComponent(`Try Inscrib3 App on Mutinynet and earn portable points: ${window.location.origin}/?ref=${points.referralCode}`)}`, '_blank', 'noopener,noreferrer')}>Share on X</button><button onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/?ref=${points.referralCode}`); window.open('https://discord.com/channels/@me', '_blank', 'noopener,noreferrer') }}>Copy for Discord</button></div></>}</section>
            <section className="points-leaderboard"><div className="points-board-head"><span>TOP PLAYERS</span><small>LIVE</small></div>{leaderboard.length ? leaderboard.map((item) => <div className={item.identityKey === points?.identityKey ? 'current' : ''} key={item.identityKey}><i>#{item.rank}</i><code>{short(item.address, 5)}</code><b>{comma(item.total)} PTS</b></div>) : <p>No scores yet.</p>}</section>
          </div>
          <div className="activity-panel">
            <div className="activity-head"><span>Type</span><span>Amount</span><span>Status</span><span>Transaction</span></div>
            {activity.length === 0 ? <div className="empty-state">No activity for this wallet yet.</div> : activity.map((item) => {
              const isSwap = item.activityType === 'swap'
              const sold = item.activityType === 'swap' && item.sellAssetId ? tokenDetails(item.sellAssetId) : undefined
              const activityPool = pools.find((candidate) => candidate.id === item.poolId)
              const activityBase = activityPool ? tokenDetails(activityPool.baseAssetId) : undefined
              const activityQuote = activityPool ? tokenDetails(activityPool.quoteAssetId) : undefined
              const amountText = isSwap
                ? `${displayAmount(item.sellAmount ?? '0', sold?.decimals ?? 0)} ${sold?.ticker ?? 'ASSET'}`
                : item.activityType === 'deposit'
                  ? `${displayAmount(item.baseAmount, activityBase?.decimals ?? 0)} ${activityBase?.ticker ?? 'BASE'} + ${displayAmount(item.quoteAmount, activityQuote?.decimals ?? 0)} ${activityQuote?.ticker ?? 'QUOTE'}`
                  : `${displayAmount(item.lpAmount, activityBase?.decimals ?? 0)} LP`
              return <div className="activity-row" key={`${item.activityType}-${item.id}`}>
                <div><span className={`activity-icon ${item.activityType}`}>{item.activityType === 'swap' ? '↔' : item.activityType === 'deposit' ? '+' : '−'}</span><div><b>{item.activityType === 'swap' ? 'Swap' : item.activityType === 'deposit' ? 'Add liquidity' : 'Remove liquidity'}</b><small>{activityPool?.name ?? item.poolId} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : short(item.id)}</small></div></div>
                <code>{amountText}</code><span className={`status-pill ${item.status}`}>{item.status.replace('-', ' ')}</span>
                <code title={item.settlementTxid ?? item.fundingTxid ?? ''}>{item.settlementTxid || item.fundingTxid ? short(item.settlementTxid ?? item.fundingTxid!, 7) : '—'}</code>
              </div>
            })}
          </div></>}
          {activityCursor && <button className="secondary load-more" onClick={() => runWithToast(loadMoreActivity)}>Load more activity</button>}
        </section>}
      </main>

      {showPairModal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowPairModal(false) }}>
        <section className="pair-modal" role="dialog" aria-modal="true" aria-labelledby="pair-modal-title">
          <div className="modal-head"><div><span className="eyebrow"><i /> ROUTE</span><h2 id="pair-modal-title">Select tokens</h2><p>Choose the assets you want to swap. The app selects the deepest active pool automatically.</p></div><button onClick={() => setShowPairModal(false)} aria-label="Close token selector">×</button></div>
          <label className="search-field modal-search"><span aria-hidden="true">⌕</span><input type="search" value={tokenSearch} onChange={(event) => setTokenSearch(event.target.value)} placeholder="Search by token, name or asset ID" aria-label="Search tokens" autoFocus />{tokenSearch && <button type="button" onClick={() => setTokenSearch('')} aria-label="Clear token search">×</button>}</label>
          <div className="pair-picker">
            <div><span className="picker-label">YOU PAY</span><div className="token-list">{filteredTokenIds.map((assetId) => { const details = tokenDetails(assetId); return <button key={assetId} className={modalSellAssetId === assetId ? 'selected' : ''} onClick={() => void selectModalPayAsset(assetId)}><TokenMark label={details.ticker} /><span><b>{details.ticker}</b><small>{details.name}</small></span>{details.controlled && <em>Controlled</em>}</button> })}{filteredTokenIds.length === 0 && <p className="no-routes">No tokens match your search.</p>}</div></div>
            <div><span className="picker-label">YOU RECEIVE</span><div className="token-list">{filteredModalBuyOptions.map((assetId) => { const details = tokenDetails(assetId); return <button key={assetId} className={modalBuyAssetId === assetId ? 'selected' : ''} onClick={() => setModalBuyAssetId(assetId)}><TokenMark label={details.ticker} warm /><span><b>{details.ticker}</b><small>{details.name}</small></span>{details.controlled && <em>Controlled</em>}</button> })}{filteredModalBuyOptions.length === 0 && <p className="no-routes">{tokenSearch ? 'No available routes match your search.' : 'Select a pay token to see available routes.'}</p>}</div></div>
          </div>
          <div className="modal-route">{bestPoolForPair(modalSellAssetId, modalBuyAssetId) ? <><span>Best route</span><b>{bestPoolForPair(modalSellAssetId, modalBuyAssetId)!.name} · {bestPoolForPair(modalSellAssetId, modalBuyAssetId)!.feeBps} bps</b></> : <><span>Route</span><b>No active pool for this pair</b></>}</div>
          <button className="primary" disabled={!bestPoolForPair(modalSellAssetId, modalBuyAssetId)} onClick={applyPair}>Use this pair</button>
        </section>
      </div>}

      <footer><button className="footer-brand" onClick={() => navigate('swap')}><img src="/logo.svg" alt="" /> INSCRIB3 / APP</button><div className="footer-links"><a href={DOCS_URL} target="_blank" rel="noreferrer">Documentation</a><a href={SOURCE_URL} target="_blank" rel="noreferrer">Open source</a></div><span><i /> {NETWORK_LABEL} / experimental software</span></footer>
    </div>
  )
}

export default App
