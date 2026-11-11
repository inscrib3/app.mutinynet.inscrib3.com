import { useCallback, useEffect, useState } from 'react'
import './App.css'

const API = import.meta.env.VITE_API_URL ?? '/api'
const NETWORK = import.meta.env.VITE_NETWORK ?? 'mutinynet'
if (NETWORK !== 'mutinynet' && NETWORK !== 'mainnet') throw new Error('VITE_NETWORK must be mutinynet or mainnet')
const NETWORK_LABEL = NETWORK === 'mainnet' ? 'MAINNET' : 'MUTINYNET'
const WALLET_NETWORK = NETWORK === 'mainnet' ? 'bitcoin' : 'mutinynet'
const MAX_WALLET_AMOUNT = 9_007_199_254_740_991n
const DOCS_URL = 'https://docs.inscrib3.com/app/overview'
const SOURCE_URL = 'https://github.com/inscrib3/app.mutinynet.inscrib3.com'

interface DeploymentInfo {
  ok: boolean
  network: 'mutinynet' | 'mainnet'
  platformTreasuryAddress: string
  poolCreationFeeSats: string
}

interface NetworkInfo {
  network: string
  displayName: string
  isTestnet: boolean
  arkServerUrl: string
}

interface ProviderState {
  isConnected: boolean
  isUnlocked: boolean
  network: string | null
  accounts: string[]
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
interface PointsSummary { identityKey: string; total: string; poolPoints: string; swapPoints: string; rank?: number; participants: number; portableToMainnet: true }
interface LeaderboardEntry { rank: number; identityKey: string; address: string; total: string; poolPoints: string; swapPoints: string }

interface IssueAssetResult { arkTxId: string; assetId: string }
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
  getProviderState?(): Promise<ProviderState>
  getAddress(): Promise<string>
  getNetwork(): Promise<NetworkInfo>
  getBalance(): Promise<BalanceInfo>
  getAssets(): Promise<AssetInfo[]>
  sendToAddress(address: string, amount: number): Promise<string>
  sendAsset(address: string, assets: Array<{ assetId: string; amount: number }>, bitcoinAmount?: number): Promise<string>
  issueAsset(input: { amount: number; controlAssetId?: string; metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string } }): Promise<IssueAssetResult>
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

function rawAmount(value: string, decimals: number): bigint | null {
  if (!/^\d*(\.\d*)?$/.test(value) || value === '' || value === '.') return null
  const [whole = '0', fraction = ''] = value.split('.')
  if (fraction.length > decimals) return null
  const raw = `${whole || '0'}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  const amount = BigInt(raw || '0')
  return amount > 0n ? amount : null
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

function PriceChart({ pool, baseTicker, quoteTicker, baseDecimals, quoteDecimals }: {
  pool: Pool; baseTicker: string; quoteTicker: string; baseDecimals: number; quoteDecimals: number
}) {
  const [timeframe, setTimeframe] = useState<PriceTimeframe>('15m')
  const [points, setPoints] = useState<PricePoint[]>([])
  const [chartError, setChartError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const load = () => api<PriceHistory>(`/v1/pools/${encodeURIComponent(pool.id)}/prices?timeframe=${timeframe}`, { signal: controller.signal })
      .then((history) => { setPoints(history.points); setChartError('') })
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

  return <section className="price-chart">
    <div className="price-chart-head">
      <div><span>DISPLAY PRICE · DECIMALS APPLIED</span><div><h3>{baseTicker} per {quoteTicker}</h3>{latest !== undefined && <b>{formatPrice(latest)}</b>}<em className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</em></div></div>
      <div className="price-timeframes">{PRICE_TIMEFRAMES.map((value) => <button key={value} className={timeframe === value ? 'active' : ''} onClick={() => setTimeframe(value)}>{value.toUpperCase()}</button>)}</div>
    </div>
    <div className="price-chart-canvas">
      {prices.length ? <svg viewBox="0 0 600 180" role="img" aria-label={`${baseTicker} per ${quoteTicker} price chart`} preserveAspectRatio="none">
        <defs><linearGradient id={`price-fill-${pool.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity=".24" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
        {[36, 72, 108, 144].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} className="chart-grid" />)}
        {prices.length > 1 && <polygon points={`18,180 ${chartPoints} 582,180`} fill={`url(#price-fill-${pool.id})`} />}
        <polyline points={chartPoints} className="chart-line" />
        {lastCoordinate && <circle cx={lastCoordinate.x} cy={lastCoordinate.y} r="4" className="chart-last" />}
      </svg> : <div className="chart-empty">{chartError || 'Price history starts with the next pool update.'}</div>}
    </div>
    <div className="price-chart-foot"><span>{series[0] ? formatChartTime(series[0].recordedAt, timeframe) : '—'}</span><span>Normalized using {baseTicker} ({baseDecimals}) and {quoteTicker} ({quoteDecimals}) decimals</span><span>{series.at(-1) ? formatChartTime(series.at(-1)!.recordedAt, timeframe) : '—'}</span></div>
  </section>
}

function App() {
  const initialRoute = routeFromLocation()
  const initialParams = new URLSearchParams(window.location.search)
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
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [request, setRequest] = useState<SwapRequest | null>(null)
  const [liquidityAmount, setLiquidityAmount] = useState('')
  const [liquidityRequest, setLiquidityRequest] = useState<LiquidityRequest | null>(null)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [activityCursor, setActivityCursor] = useState<string | undefined>()
  const [createMode, setCreateMode] = useState<'asset' | 'pool'>(initialRoute.page === 'create' && initialParams.get('mode') === 'pool' ? 'pool' : 'asset')
  const [assetForm, setAssetForm] = useState({ name: '', ticker: '', supply: '', decimals: '0', icon: '' })
  const [issuedAsset, setIssuedAsset] = useState<IssueAssetResult | null>(null)
  const [poolForm, setPoolForm] = useState({ id: '', name: '', baseAssetId: 'btc', quoteAssetId: '', baseAmount: '', quoteAmount: '', feeBps: '100', protocolFeeBps: '30' })
  const [poolCreation, setPoolCreation] = useState<PoolCreation | null>(null)
  const [creationStep, setCreationStep] = useState('')
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null)
  const [points, setPoints] = useState<PointsSummary | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])

  const pool = pools.find((p) => p.id === poolId)
  const sellAsset = assets.find((a) => a.assetId === sellAssetId)
  const buyAssetId = pool ? (sellAssetId === pool.baseAssetId ? pool.quoteAssetId : pool.baseAssetId) : ''
  const buyAsset = assets.find((a) => a.assetId === buyAssetId)
  const sellDecimals = sellAsset?.metadata?.decimals ?? (sellAssetId === 'btc' ? 8 : 0)
  const buyDecimals = buyAsset?.metadata?.decimals ?? (buyAssetId === 'btc' ? 8 : 0)
  const sellTicker = sellAssetId === 'btc' ? 'BTC' : sellAsset?.metadata?.ticker ?? (pool?.name.split('/')[sellAssetId === pool?.quoteAssetId ? 1 : 0]?.trim() || 'ASSET')
  const buyTicker = !buyAssetId ? 'SELECT' : buyAssetId === 'btc' ? 'BTC' : buyAsset?.metadata?.ticker ?? (pool?.name.split('/')[buyAssetId === pool?.quoteAssetId ? 1 : 0]?.trim() || 'ASSET')
  const raw = rawAmount(amount, sellDecimals)
  const receiveRaw = rawAmount(receiveAmount, buyDecimals)
  const baseAsset = assets.find((asset) => asset.assetId === pool?.baseAssetId)
  const quoteAsset = assets.find((asset) => asset.assetId === pool?.quoteAssetId)
  const lpAsset = assets.find((asset) => asset.assetId === pool?.lpAssetId)
  const baseDecimals = baseAsset?.metadata?.decimals ?? (pool?.baseAssetId === 'btc' ? 8 : 0)
  const quoteDecimals = quoteAsset?.metadata?.decimals ?? (pool?.quoteAssetId === 'btc' ? 8 : 0)
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
    const ticker = assetId === 'btc' ? 'BTC' : walletAsset?.metadata?.ticker ?? catalogAsset?.metadata?.ticker ?? poolInfo?.metadata?.ticker ?? short(assetId || 'TOKEN')
    const decimals = assetId === 'btc' ? 8 : walletAsset?.metadata?.decimals ?? catalogAsset?.metadata?.decimals ?? poolInfo?.metadata?.decimals ?? 0
    return { ticker, decimals, name: assetId === 'btc' ? 'Native Bitcoin' : walletAsset?.metadata?.name ?? catalogAsset?.metadata?.name ?? poolInfo?.metadata?.name ?? short(assetId, 10), controlled: walletAsset?.controlAssetId ?? catalogAsset?.controlAssetId ?? poolInfo?.controlAssetId }
  }

  function updatePoolPair(baseAssetId: string, quoteAssetId: string) {
    const baseTicker = baseAssetId ? tokenDetails(baseAssetId).ticker : ''
    const quoteTicker = quoteAssetId ? tokenDetails(quoteAssetId).ticker : ''
    const name = baseTicker && quoteTicker ? `${baseTicker} / ${quoteTicker}` : ''
    const id = baseTicker && quoteTicker ? poolSlug(baseTicker, quoteTicker) : ''
    setPoolForm((current) => ({ ...current, baseAssetId, quoteAssetId, id, name }))
  }

  const creationBaseDetails = poolForm.baseAssetId ? tokenDetails(poolForm.baseAssetId) : undefined
  const creationQuoteDetails = poolForm.quoteAssetId ? tokenDetails(poolForm.quoteAssetId) : undefined
  const creationBaseAmount = creationBaseDetails ? rawAmount(poolForm.baseAmount, creationBaseDetails.decimals) : null
  const creationQuoteAmount = creationQuoteDetails ? rawAmount(poolForm.quoteAmount, creationQuoteDetails.decimals) : null
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
    setMode(nextMode); setError(''); setLiquidityAmount(''); setLiquidityRequest(null)
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
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  function applyPair() {
    const next = bestPoolForPair(modalSellAssetId, modalBuyAssetId)
    if (!next) return
    replaceSwapUrl(next, modalSellAssetId)
    setPoolId(next.id); setSellAssetId(modalSellAssetId); setAmount(''); setReceiveAmount(''); setQuote(null); setRequest(null); setError(''); setShowPairModal(false)
  }

  function switchToPool(target: Pool) {
    replaceSwapUrl(target, target.baseAssetId)
    setPoolId(target.id); setSellAssetId(target.baseAssetId); setMode('swap')
    setAmount(''); setReceiveAmount(''); setQuote(null); setRequest(null); setLiquidityRequest(null); setError('')
  }

  function setMaxAmount() {
    setQuoteMode('input'); setReceiveAmount(''); setQuote(null)
    if (sellAssetId === 'btc') setAmount(editableAmount(BigInt(Math.max(0, btcBalance - 330)), 8))
    else if (sellAsset) setAmount(editableAmount(BigInt(sellAsset.amount), sellDecimals))
  }

  const refreshAssets = useCallback(async () => {
    if (!window.arkade || !address) return
    const [nextAssets, nextBalance] = await Promise.all([window.arkade.getAssets(), window.arkade.getBalance()])
    assertProviderAmounts(nextAssets, nextBalance)
    setAssets(nextAssets); setBtcBalance(nextBalance.available)
  }, [address, setAssets, setBtcBalance])

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
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [])

  useEffect(() => {
    if (page !== 'pools') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ limit: '100' })
      if (poolSearch.trim()) query.set('q', poolSearch.trim())
      api<PageResult<Pool>>(`/v1/pools?${query}`, { signal: controller.signal }).then((result) => {
        setPoolResults(result.items); setPoolResultTotal(result.total); setPoolCursor(result.nextCursor)
      }).catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) })
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
        .catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) })
    }, 200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [showPairModal, tokenSearch])

  async function loadMorePools() {
    if (!poolCursor) return
    const query = new URLSearchParams({ limit: '20', cursor: poolCursor })
    if (poolSearch.trim()) query.set('q', poolSearch.trim())
    const result = await api<PageResult<Pool>>(`/v1/pools?${query}`)
    setPoolResults((current) => [...current, ...result.items]); setPoolCursor(result.nextCursor); setPoolResultTotal(result.total)
  }

  useEffect(() => {
    const provider = window.arkade
    if (!provider) return
    const refresh = () => void assertWalletNetwork(provider).then(refreshAssets).catch((cause: unknown) => {
      setAddress(''); setAssets([]); setBtcBalance(0); setError(cause instanceof Error ? cause.message : String(cause))
    })
    provider.on('accountChanged', refresh)
    provider.on('networkChanged', refresh)
    return () => { provider.off('accountChanged', refresh); provider.off('networkChanged', refresh) }
  }, [refreshAssets])

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
        }).catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) })
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [pool, quoteRequestAmount, quoteMode, sellAssetId, buyAssetId, sellDecimals, buyDecimals])

  useEffect(() => {
    if (!request || ['settled', 'refunded', 'failed'].includes(request.status)) return
    const timer = window.setInterval(() => {
      api<SwapRequest>(`/v1/swaps/${request.id}`).then((next) => {
        setRequest(next)
        if (next.status === 'settled') { void refreshAssets(); void refreshPools(); void refreshPoints() }
      }).catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [request, refreshAssets, refreshPools, refreshPoints])

  useEffect(() => {
    if (!liquidityRequest || ['settled', 'refunded', 'failed'].includes(liquidityRequest.status)) return
    const timer = window.setInterval(() => {
      api<LiquidityRequest>(`/v1/liquidity/${liquidityRequest.id}`).then((next) => {
        setLiquidityRequest(next)
        if (next.status === 'settled') { void refreshAssets(); void refreshPools() }
      }).catch(() => undefined)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [liquidityRequest, refreshAssets, refreshPools])

  useEffect(() => {
    if (page !== 'pool' || !poolId) return
    void Promise.all([
      api<CursorPage<ActivityEvent>>(`/v1/pools/${encodeURIComponent(poolId)}/activity?limit=25`).then((result) => { setActivity(result.items); setActivityCursor(result.nextCursor) }),
      api<Pool>(`/v1/pools/${encodeURIComponent(poolId)}`).then((next) => setPools((current) => [...new Map([...current, next].map((item) => [item.id, item])).values()])),
    ]).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    const timer = window.setInterval(() => void refreshPoolActivity().catch(() => undefined), 15_000)
    return () => window.clearInterval(timer)
  }, [page, poolId, refreshPoolActivity])

  useEffect(() => {
    if (page !== 'activity' || !address) return
    const initial = window.setTimeout(() => void refreshWalletActivity().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))), 0)
    const refresh = window.setInterval(() => void refreshWalletActivity().catch(() => undefined), 15_000)
    return () => { window.clearTimeout(initial); window.clearInterval(refresh) }
  }, [page, address, refreshWalletActivity])

  async function connect() {
    setError('')
    if (!window.arkade) {
      const message = 'Inscrib3 Wallet extension was not found.'
      setError(message); setToast(message); return
    }
    setBusy(true)
    try {
      const state = await window.arkade.getProviderState?.()
      if (state && !state.isUnlocked) throw new Error('Inscrib3 Wallet is locked. Open the extension, enter your password, then click Connect wallet again.')
      const [connected] = await window.arkade.connect()
      await assertWalletNetwork(window.arkade)
      const nextAddress = connected ?? await window.arkade.getAddress()
      setPoints(null); setLeaderboard([])
      setAddress(nextAddress)
      const [nextAssets, nextBalance] = await Promise.all([window.arkade.getAssets(), window.arkade.getBalance()])
      assertProviderAmounts(nextAssets, nextBalance)
      setAssets(nextAssets); setBtcBalance(nextBalance.available)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message); setToast(message)
    }
    finally { setBusy(false) }
  }

  async function createAsset() {
    if (!address) return connect()
    if (!window.arkade) return
    const decimals = Number(assetForm.decimals)
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) { setError('Decimals must be between 0 and 18.'); return }
    const supply = rawAmount(assetForm.supply, decimals)
    if (!supply || !assetForm.name.trim() || !assetForm.ticker.trim()) { setError('Name, ticker, and a positive supply are required.'); return }
    setBusy(true); setError(''); setIssuedAsset(null); setCreationStep('Approve asset issuance in Inscrib3 Wallet')
    try {
      await assertWalletNetwork(window.arkade)
      const result = await window.arkade.issueAsset({
        amount: walletNumber(supply, 'asset supply'),
        metadata: { name: assetForm.name.trim(), ticker: assetForm.ticker.trim(), decimals, ...(assetForm.icon.trim() ? { icon: assetForm.icon.trim() } : {}) },
      })
      setIssuedAsset(result); setCreationStep('Asset created'); await refreshAssets()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setCreationStep('') }
    finally { setBusy(false) }
  }

  async function createPool() {
    if (!address) return connect()
    if (!window.arkade || !deployment) { if (!deployment) setError('Deployment configuration is not available.'); return }
    const baseInfo = poolForm.baseAssetId === 'btc' ? undefined : assets.find((item) => item.assetId === poolForm.baseAssetId)
    const quoteInfo = assets.find((item) => item.assetId === poolForm.quoteAssetId)
    const baseDecimals = poolForm.baseAssetId === 'btc' ? 8 : baseInfo?.metadata?.decimals ?? 0
    const quoteDecimals = quoteInfo?.metadata?.decimals ?? 0
    const baseAmount = rawAmount(poolForm.baseAmount, baseDecimals)
    const quoteAmount = rawAmount(poolForm.quoteAmount, quoteDecimals)
    if (!baseAmount || !quoteAmount || !poolForm.id || !poolForm.name || !poolForm.quoteAssetId) { setError('Complete the pool identity, pair, and initial reserves.'); return }
    if (poolForm.baseAssetId === poolForm.quoteAssetId || poolForm.quoteAssetId === 'btc') { setError('The assets must differ and native BTC must remain on the base side.'); return }
    const feeBps = Number(poolForm.feeBps); const protocolFeeBps = Number(poolForm.protocolFeeBps)
    if (!Number.isInteger(feeBps) || !Number.isInteger(protocolFeeBps) || protocolFeeBps < 30 || feeBps <= protocolFeeBps) { setError('Total fee must exceed the protocol fee; protocol fee minimum is 30 bps.'); return }
    const safeBase = walletNumber(baseAmount, 'initial base reserve'); const safeQuote = walletNumber(quoteAmount, 'initial quote reserve')
    setBusy(true); setError(''); setPoolCreation(null)
    try {
      await assertWalletNetwork(window.arkade)
      setCreationStep('Checking pair availability')
      const candidates = await api<PageResult<Pool>>(`/v1/pools?assetId=${encodeURIComponent(poolForm.baseAssetId)}&limit=100`)
      const duplicate = candidates.items.find((candidate) => [candidate.baseAssetId, candidate.quoteAssetId].includes(poolForm.baseAssetId)
        && [candidate.baseAssetId, candidate.quoteAssetId].includes(poolForm.quoteAssetId))
      if (duplicate) throw new Error(`A pool already exists for this pair (${duplicate.name}).`)
      const stem = poolForm.name.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 9) || 'POOL'
      setCreationStep('1/5 · Issue the pool control asset')
      const control = await window.arkade.issueAsset({ amount: 1, metadata: { ticker: `${stem}-CTRL`.slice(0, 16), decimals: 0 } })
      setCreationStep('2/5 · Issue LP tokens')
      const lp = await window.arkade.issueAsset({ amount: safeBase, controlAssetId: control.assetId, metadata: { ticker: `${stem}-LP`.slice(0, 16), decimals: baseDecimals } })
      setCreationStep('3/5 · Issue the covenant ledger asset')
      const ledger = await window.arkade.issueAsset({ amount: safeBase, controlAssetId: control.assetId, metadata: { ticker: `${stem}-LEDGER`.slice(0, 16), decimals: 0 } })
      setCreationStep('4/5 · Register the atomic bootstrap')
      const creation = await api<PoolCreation>('/v1/pools', { method: 'POST', body: JSON.stringify({
        id: poolForm.id, name: poolForm.name, baseAssetId: poolForm.baseAssetId, quoteAssetId: poolForm.quoteAssetId,
        lpAssetId: lp.assetId, lpLedgerAssetId: ledger.assetId, controlAssetId: control.assetId,
        feeBps, protocolFeeBps, payAddress: address, baseAmount: baseAmount.toString(), quoteAmount: quoteAmount.toString(),
      }) })
      setPoolCreation(creation)
      setCreationStep('4/5 · Fund liquidity, carriers, and creation fee atomically')
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
      const fundingAssets = [
        ...(poolForm.baseAssetId === 'btc' ? [] : [{ assetId: poolForm.baseAssetId, amount: safeBase }]),
        { assetId: poolForm.quoteAssetId, amount: safeQuote }, { assetId: lp.assetId, amount: safeBase },
        { assetId: ledger.assetId, amount: safeBase }, { assetId: control.assetId, amount: 1 },
      ]
      const fundingTxid = await window.arkade.sendAsset(creation.bootstrapAddress, fundingAssets, walletNumber(BigInt(creation.bootstrapSats), 'bootstrap satoshis'))
      setCreationStep('5/5 · Open the covenant pool')
      const opened = await api<PoolCreation>(`/v1/pool-creations/${encodeURIComponent(creation.id)}/open`, { method: 'POST', body: JSON.stringify({ fundingTxid }) })
      setPoolCreation(opened); setCreationStep('Pool opened'); await Promise.all([refreshAssets(), refreshPools(), refreshPoints()])
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
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
    setRequest(null)
  }

  async function swap() {
    if (!address) return connect()
    if (!pool || !raw || !quote || !window.arkade) return
    if (raw > MAX_WALLET_AMOUNT) { setError('This wallet version cannot safely send an amount above JavaScript’s safe integer limit.'); return }
    setBusy(true); setError(''); setRequest(null)
    try {
      await assertWalletNetwork(window.arkade)
      const minOutput = quoteMode === 'output' && receiveRaw
        ? receiveRaw
        : (BigInt(quote.outputAmount) * BigInt(10_000 - slippage)) / 10_000n
      const intent = await api<SwapRequest>(`/v1/pools/${pool.id}/swaps`, {
        method: 'POST', body: JSON.stringify({ payAddress: address, sellAssetId, sellAmount: raw.toString(), minOutput: minOutput.toString() }),
      })
      setRequest(intent)
      const fundingSats = walletNumber(BigInt(intent.fundingSats), 'swap BTC funding')
      const fundingTxid = sellAssetId === 'btc'
        ? await window.arkade.sendToAddress(intent.contractAddress, fundingSats)
        : await window.arkade.sendAsset(intent.contractAddress, [{ assetId: sellAssetId, amount: walletNumber(raw, 'asset funding') }], fundingSats)
      const funded = await api<SwapRequest>(`/v1/swaps/${intent.id}/funding`, { method: 'POST', body: JSON.stringify({ txid: fundingTxid }) })
      setRequest(funded)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  async function submitLiquidity() {
    if (!address) return connect()
    if (!pool || !liquidityRaw || !liquidityPreview || !window.arkade || mode === 'swap') return
    const values = [liquidityPreview.base, liquidityPreview.quote, liquidityPreview.lp]
    if (values.some((value) => value > MAX_WALLET_AMOUNT)) { setError('This wallet version cannot safely send this amount.'); return }
    setBusy(true); setError(''); setLiquidityRequest(null)
    try {
      await assertWalletNetwork(window.arkade)
      const intent = mode === 'deposit'
        ? await api<LiquidityRequest>(`/v1/pools/${pool.id}/deposits`, { method: 'POST', body: JSON.stringify({ payAddress: address, baseAmount: liquidityRaw.toString() }) })
        : await api<LiquidityRequest>(`/v1/pools/${pool.id}/withdrawals`, { method: 'POST', body: JSON.stringify({ payAddress: address, lpAmount: liquidityRaw.toString() }) })
      setLiquidityRequest(intent)
      const fundingAssets = mode === 'deposit'
        ? [...(pool.baseAssetId === 'btc' ? [] : [{ assetId: pool.baseAssetId, amount: walletNumber(BigInt(intent.baseAmount), 'base funding') }]), { assetId: pool.quoteAssetId, amount: walletNumber(BigInt(intent.quoteAmount), 'quote funding') }]
        : [{ assetId: pool.lpAssetId, amount: walletNumber(BigInt(intent.lpAmount), 'LP funding') }]
      const txid = await window.arkade.sendAsset(intent.contractAddress, fundingAssets, mode === 'deposit'
        ? walletNumber(pool.baseAssetId === 'btc' ? BigInt(intent.baseAmount) + 330n : 330n, 'deposit BTC funding')
        : undefined)
      setLiquidityRequest(await api<LiquidityRequest>(`/v1/liquidity/${intent.id}/funding`, { method: 'POST', body: JSON.stringify({ txid }) }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }

  const balance = sellAssetId === 'btc' ? displayAmount(BigInt(btcBalance), 8, 8) : sellAsset ? displayAmount(BigInt(sellAsset.amount), sellDecimals, 4) : '0'
  const hasQuoteAmount = quoteMode === 'input' ? raw : receiveRaw
  const buttonText = !address ? 'Connect Inscrib3 Wallet' : !pool ? 'Select a token pair' : !pool.available ? 'Pool unavailable' : !hasQuoteAmount ? 'Enter an amount' : !quote ? 'Finding best price…' : 'Review & swap'
  const baseTicker = pool?.baseAssetId === 'btc' ? 'BTC' : baseAsset?.metadata?.ticker ?? pool?.baseAssetInfo?.metadata?.ticker ?? 'BASE'
  const quoteTicker = pool?.quoteAssetId === 'btc' ? 'BTC' : quoteAsset?.metadata?.ticker ?? pool?.quoteAssetInfo?.metadata?.ticker ?? 'QUOTE'

  return (
    <div className="app-shell">
      <header>
        <button className="brand" onClick={() => navigate('swap')} aria-label="Inscrib3 app home"><img src="/logo.svg" alt="" /><span>INSCRIB3</span><small>APP</small></button>
        <nav>{(['swap', 'pools', 'create', 'activity'] as const).map((item) => <button key={item} className={page === item || (item === 'pools' && page === 'pool') ? 'active' : ''} onClick={() => { navigate(item); if (item === 'pools') void refreshPools() }}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}<a className="nav-docs" href={DOCS_URL} target="_blank" rel="noreferrer">Docs ↗</a></nav>
        <div className="header-actions"><span className="network"><i /> {NETWORK_LABEL}</span>{address && <button className="points-chip" onClick={() => navigate('activity')} title="Your portable points"><span>◆</span>{points ? comma(points.total) : '—'} PTS</button>}<button className="wallet-small" onClick={() => void connect()} disabled={busy}>{address ? short(address, 4) : busy ? 'Loading wallet…' : 'Connect wallet'}</button></div>
      </header>

      {toast && <div className="toast error-toast" role="alert"><span>{toast}</span><button type="button" onClick={() => setToast('')} aria-label="Dismiss notification">×</button></div>}

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
              <div className="asset-top"><label>You pay</label><button className="balance" onClick={setMaxAmount}>Balance: {balance} <b>MAX</b></button></div>
              <div className="asset-main">
                <input value={amount} onChange={(event) => { setQuoteMode('input'); setAmount(event.target.value); setReceiveAmount(''); setQuote(null); setRequest(null); setError('') }} placeholder="0" inputMode="decimal" aria-label="Amount to sell" />
                <button className="token-select" onClick={openPairModal}><TokenMark label={sellTicker} /><span>{sellTicker}</span><small>⌄</small></button>
              </div>
              <div className="asset-foot"><span>{sellAssetId ? tokenDetails(sellAssetId).name : 'Select a pool'}</span><span>Arkade asset</span></div>
              </div>

              <div className="switch-row"><span /><button onClick={reverse} aria-label="Reverse swap direction">↓</button><span /></div>

              <div className="asset-box receive">
              <div className="asset-top"><label>You receive</label><span>{quoteMode === 'output' ? 'Exact output' : 'Estimated'}</span></div>
              <div className="asset-main"><input value={receiveAmount} onChange={(event) => { setQuoteMode('output'); setReceiveAmount(event.target.value); setAmount(''); setQuote(null); setRequest(null); setError('') }} placeholder="0" inputMode="decimal" aria-label="Amount to receive" /><button className="token-select" onClick={openPairModal}><TokenMark label={buyTicker} warm /><span>{buyTicker}</span><small>⌄</small></button></div>
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

              <button className="primary" onClick={() => void swap()} disabled={busy || (!!address && (!raw || !quote || !pool?.available))}>{busy && <Spinner />}{buttonText}</button>
            </>}

            {mode !== 'swap' && <>
              <div className="asset-box">
                <div className="asset-top"><label>{mode === 'deposit' ? 'Base amount to add' : 'LP tokens to burn'}</label><span>Raw-unit exact</span></div>
                <div className="asset-main">
                  <input value={liquidityAmount} onChange={(event) => { setLiquidityAmount(event.target.value); setLiquidityRequest(null); setError('') }} placeholder="0" inputMode="decimal" aria-label="Liquidity amount" />
                  <div className="token-select static"><TokenMark label={mode === 'deposit' ? baseTicker : 'LP'} /><span>{mode === 'deposit' ? baseTicker : 'LP'}</span></div>
                </div>
                <div className="asset-foot"><span>{mode === 'deposit' ? `Balance: ${pool?.baseAssetId === 'btc' ? displayAmount(BigInt(btcBalance), 8, 8) : baseAsset ? displayAmount(BigInt(baseAsset.amount), baseDecimals) : '0'}` : `Balance: ${lpAsset ? displayAmount(BigInt(lpAsset.amount), lpDecimals) : '0'}`}</span><span>{mode === 'deposit' ? 'Pool ratio is fixed at funding' : 'Pro-rata redemption'}</span></div>
              </div>
              <div className="liquidity-preview">
                <div><span>{mode === 'deposit' ? 'Required quote' : 'Base received'}</span><b>{liquidityPreview ? displayAmount(mode === 'deposit' ? liquidityPreview.quote : liquidityPreview.base, mode === 'deposit' ? quoteDecimals : baseDecimals) : '—'} {mode === 'deposit' ? quoteTicker : baseTicker}</b></div>
                <div><span>{mode === 'deposit' ? 'LP received' : 'Quote received'}</span><b>{liquidityPreview ? displayAmount(mode === 'deposit' ? liquidityPreview.lp : liquidityPreview.quote, mode === 'deposit' ? lpDecimals : quoteDecimals) : '—'} {mode === 'deposit' ? 'LP' : quoteTicker}</b></div>
              </div>
              <button className="primary" onClick={() => void submitLiquidity()} disabled={busy || (!!address && (!liquidityRaw || !liquidityPreview || !pool?.available))}>{busy && <Spinner />}{!address ? 'Connect Inscrib3 Wallet' : !liquidityRaw ? 'Enter an amount' : mode === 'deposit' ? 'Fund liquidity deposit' : 'Fund LP withdrawal'}</button>
            </>}
            {error && <div className="notice error"><b>Transaction unavailable</b><span>{error}</span></div>}
            {mode === 'swap' && request && <div className={`notice status ${request.status}`}><b>{request.status === 'settled' ? 'Swap complete' : request.status === 'funded' ? 'Swap funded' : request.status === 'failed' ? 'Swap failed' : request.status === 'refunded' ? 'Swap refunded' : 'Swap request created'}</b><span>{request.status === 'settled' ? `Settlement ${short(request.settlementTxid ?? '')} · +${request.rewardPoints ?? '1'} points` : request.status === 'failed' ? request.error ?? 'The swap could not be completed.' : request.status === 'refunded' ? `Refund ${short(request.settlementTxid ?? '')}` : `Waiting for the next pool sweep… · ${request.rewardPoints ?? '1'} points pending`}</span><i /></div>}
            {mode !== 'swap' && liquidityRequest && <div className={`notice status ${liquidityRequest.status}`}><b>{liquidityRequest.status === 'settled' ? 'Liquidity update complete' : liquidityRequest.status === 'funded' ? 'Request funded' : 'Liquidity request created'}</b><span>{liquidityRequest.status === 'settled' ? `Settlement ${short(liquidityRequest.settlementTxid ?? '')}` : 'Waiting for the next liquidity sweep…'}</span><i /></div>}
            {controlledPoolAssets.length > 0 && <div className="notice asset-risk"><b>Controlled asset supply</b><span>{controlledPoolAssets.map((info) => `${info.assetId === pool?.baseAssetId ? baseTicker : quoteTicker}: ${short(info.controlAssetId ?? '', 8)}`).join(' · ')}. Holders of these control assets may authorize additional issuance, which can affect pool value.</span></div>}
            <p className="security"><span>◇</span> Your wallet funds a covenant-bound request. The coordinator cannot redirect your payout.</p>
          </div>

          <aside>
            <div className="panel pool-panel" id="pools">
              <div className="panel-head"><span>AUTOMATIC ROUTE</span><div className="panel-actions"><button className="share-link" onClick={() => void copySwapLink()}>{linkCopied ? 'Copied' : 'Copy link'}</button><button className="change-pair" onClick={openPairModal}>Change pair</button></div></div>
               <div className="pair"><div className="marks"><TokenMark label={sellTicker} /><TokenMark label={buyTicker} warm /></div><div><div className="pair-title-row"><h3>{pool?.name ?? 'No pool configured'}</h3>{pool?.onFire && <span className="fire-badge" title={`${pool.activity24h ?? 0} settled operations in the last 24 hours`}>🔥 On fire</span>}</div><p><i className={pool?.available ? 'online' : ''} /> {pool?.available ? 'Pool active' : 'Unavailable'} · {pool?.feeBps ?? 0} bps{pool?.onFire ? ` · ${pool.activity24h} actions / 24h` : ''}</p></div></div>
              <div className="pool-stats"><div><span>Base reserve</span><b>{pool?.baseReserve ? comma(pool.baseReserve) : '—'}</b></div><div><span>Quote reserve</span><b>{pool?.quoteReserve ? comma(pool.quoteReserve) : '—'}</b></div><div><span>LP supply</span><b>{pool?.lpSupply ? comma(pool.lpSupply) : '—'}</b></div></div>
              <div className="pool-foot"><span>{pool?.protocolFeeBps ? 'Covenant fee vault active' : 'LP fees only'}</span>{pool ? <button className="pool-detail-link" onClick={() => openPoolDetail(pool)}>Pool details →</button> : <span>Up to 3 swaps / sweep</span>}</div>
            </div>

            <div className="panel how-panel">
              <span className="panel-label">HOW IT WORKS</span>
              <ol><li><b>1</b><div><strong>Fund a standing swap</strong><span>Your assets enter a payout-bound contract.</span></div></li><li><b>2</b><div><strong>Requests are batched</strong><span>Up to four swaps update the pool atomically.</span></div></li><li><b>3</b><div><strong>Receive automatically</strong><span>The bought asset lands directly in your wallet.</span></div></li></ol>
              <a className="panel-doc-link" href="https://docs.inscrib3.com/app/swaps" target="_blank" rel="noreferrer">Read the swap guide ↗</a>
            </div>
          </aside>
        </section>
        </> : page === 'pools' ? <section className="view-page">
          <div className="view-heading"><div><span className="eyebrow"><i /> LIVE LIQUIDITY</span><h1>Pools</h1><p>Current covenant reserves and AMM identifiers.</p></div><button className="secondary" onClick={() => void refreshPools()}>Refresh</button></div>
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
               <div className="pool-card-actions"><button className="secondary" onClick={() => openPoolDetail(item)}>View details</button><button className="secondary" onClick={() => { replaceSwapUrl(item, item.baseAssetId); setPoolId(item.id); setSellAssetId(item.baseAssetId); setAmount(''); setReceiveAmount(''); setQuote(null); setPage('swap') }}>Trade this pool</button></div>
             </article>
           })}</div>}
           {poolCursor && <button className="secondary load-more" onClick={() => void loadMorePools()}>Load more pools</button>}
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
                <div className="pool-detail-title"><div className="marks"><TokenMark label={base.ticker} /><TokenMark label={quoteToken.ticker} warm /></div><div><span className="eyebrow"><i /> POOL DETAIL</span><div className="pool-title-row"><h1>{pool.name}</h1>{pool.onFire && <span className="fire-badge" title={`${pool.activity24h ?? 0} settled operations in the last 24 hours`}>🔥 On fire</span>}</div><p><span className={pool.available ? 'live-dot' : 'offline-dot'} /> {pool.available ? 'Pool active' : 'Pool unavailable'} · {pool.feeBps} bps total fee</p></div></div>
                <button className="primary compact" onClick={() => { replaceSwapUrl(pool, pool.baseAssetId); setSellAssetId(pool.baseAssetId); setAmount(''); setReceiveAmount(''); setQuote(null); setPage('swap') }}>Trade this pool</button>
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

              <div className="activity-section-heading"><div><span className="eyebrow"><i /> LIVE FEED</span><h2>Pool activity</h2><p>Swap, liquidity additions and removals for this pool.</p></div><button className="secondary" onClick={() => void refreshPoolActivity()}>Refresh</button></div>
              <div className="activity-panel">
                <div className="activity-head"><span>Type</span><span>Amount</span><span>Status</span><span>Transaction</span></div>
                {activity.length === 0 ? <div className="empty-state">No activity for this pool yet.</div> : activity.map((item) => {
                  const isSwap = item.activityType === 'swap'
                  const sold = isSwap && item.sellAssetId ? tokenDetails(item.sellAssetId) : undefined
                  const amountText = isSwap ? `${displayAmount(item.sellAmount ?? '0', sold?.decimals ?? 0)} ${sold?.ticker ?? 'ASSET'}` : item.activityType === 'deposit' ? `${displayAmount(item.baseAmount, base.decimals)} ${base.ticker} + ${displayAmount(item.quoteAmount, quoteToken.decimals)} ${quoteToken.ticker}` : `${displayAmount(item.lpAmount, base.decimals)} LP`
                  return <div className="activity-row" key={`${item.activityType}-${item.id}`}><div><span className={`activity-icon ${item.activityType}`}>{isSwap ? '↔' : item.activityType === 'deposit' ? '+' : '−'}</span><div><b>{isSwap ? 'Swap' : item.activityType === 'deposit' ? 'Add liquidity' : 'Remove liquidity'}</b><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : short(item.id)}</small></div></div><code>{amountText}</code><span className={`status-pill ${item.status}`}>{item.status.replace('-', ' ')}</span><code title={item.settlementTxid ?? item.fundingTxid ?? ''}>{item.settlementTxid || item.fundingTxid ? short(item.settlementTxid ?? item.fundingTxid!, 7) : '—'}</code></div>
                })}
              </div>
              {activityCursor && <button className="secondary load-more" onClick={() => void loadMoreActivity()}>Load more activity</button>}
            </>
          })()}
        </section> : page === 'create' ? <section className="view-page create-page">
          <div className="view-heading"><div><span className="eyebrow"><i /> PERMISSIONLESS ASSETS</span><h1>Create</h1><p>Issue an Arkade asset or open a covenant-enforced liquidity pool from your own wallet.</p></div></div>
          <div className="create-tabs"><button className={createMode === 'asset' ? 'active' : ''} onClick={() => updateCreateMode('asset')}>Create asset</button><button className={createMode === 'pool' ? 'active' : ''} onClick={() => updateCreateMode('pool')}>Create pool</button></div>
          {createMode === 'asset' ? <div className="create-layout">
            <article className="create-card">
              <div className="card-head"><div><h2>Issue a new asset</h2><span>Non-custodial issuance through Inscrib3 Wallet</span></div></div>
              <div className="form-grid">
                <label><span>Name</span><input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="My Arkade Asset" /></label>
                <label><span>Ticker</span><input value={assetForm.ticker} onChange={(e) => setAssetForm({ ...assetForm, ticker: e.target.value.toUpperCase() })} placeholder="ASSET" maxLength={16} /></label>
                <label><span>Initial supply</span><input value={assetForm.supply} onChange={(e) => setAssetForm({ ...assetForm, supply: e.target.value })} placeholder="1000000" inputMode="decimal" /></label>
                <label><span>Decimals</span><input value={assetForm.decimals} onChange={(e) => setAssetForm({ ...assetForm, decimals: e.target.value })} placeholder="0" inputMode="numeric" /></label>
                <label className="wide"><span>Icon URL <small>optional</small></span><input value={assetForm.icon} onChange={(e) => setAssetForm({ ...assetForm, icon: e.target.value })} placeholder="https://…" /></label>
              </div>
              <button className="primary" disabled={busy} onClick={() => void createAsset()}>{busy && <Spinner />}{address ? 'Review asset issuance' : 'Connect Inscrib3 Wallet'}</button>
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
                <label><span>Quote asset</span><select value={poolForm.quoteAssetId} onChange={(e) => updatePoolPair(poolForm.baseAssetId, e.target.value)}><option value="">Select asset</option>{assets.filter((item) => item.assetId !== poolForm.baseAssetId).map((item) => <option key={item.assetId} value={item.assetId}>{item.metadata?.ticker ?? short(item.assetId)}</option>)}</select></label>
                <label><span>Initial base reserve <small>{creationBaseDetails ? `${creationBaseDetails.ticker} display units · ${creationBaseDetails.decimals} decimals` : 'select an asset'}</small></span><input value={poolForm.baseAmount} onChange={(e) => setPoolForm({ ...poolForm, baseAmount: e.target.value })} placeholder={poolForm.baseAssetId === 'btc' ? '0.002' : '100'} inputMode="decimal" /></label>
                <label><span>Initial quote reserve <small>{creationQuoteDetails ? `${creationQuoteDetails.ticker} display units · ${creationQuoteDetails.decimals} decimals` : 'select an asset'}</small></span><input value={poolForm.quoteAmount} onChange={(e) => setPoolForm({ ...poolForm, quoteAmount: e.target.value })} placeholder="100" inputMode="decimal" /></label>
                <label><span>Total fee · bps</span><input value={poolForm.feeBps} onChange={(e) => setPoolForm({ ...poolForm, feeBps: e.target.value })} inputMode="numeric" min="31" /></label>
                <label><span>Protocol fee · min 30 bps</span><input value={poolForm.protocolFeeBps} onChange={(e) => setPoolForm({ ...poolForm, protocolFeeBps: e.target.value })} inputMode="numeric" min="30" /></label>
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
              <button className="primary" disabled={busy} onClick={() => void createPool()}>{busy && <Spinner />}{address ? 'Issue pool assets & open pool' : 'Connect Inscrib3 Wallet'}</button>
              {creationStep && <div className="creation-progress"><i className={poolCreation?.status === 'opened' ? 'done' : ''} /><span>{creationStep}</span></div>}
              {poolCreation && <div className="result-box"><span>Status</span><b>{poolCreation.status}</b>{poolCreation.status === 'opened' && <><span>Points earned</span><b className="points-earned">+10 PTS</b></>}<span>Bootstrap covenant</span><code>{poolCreation.bootstrapAddress}</code>{poolCreation.openingTxid && <><span>Opening transaction</span><code>{poolCreation.openingTxid}</code></>}</div>}
            </article>
            <aside className="create-info"><span className="panel-label">ONE ATOMIC FUNDING</span><h3>Permissionless, not custodial</h3><p>Inscrib3 issues the control, LP, and ledger assets, then funds liquidity, technical carriers, and the fixed creation fee in one bootstrap payment. The contract opens and distributes everything atomically.</p><ul><li>BTC remains native and unwrapped</li><li>The creation fee reaches the stable Treasury Vault</li><li>Protocol fee is at least 0.30% and below the total fee</li></ul><a className="panel-doc-link" href="https://docs.inscrib3.com/app/pools-liquidity" target="_blank" rel="noreferrer">Pool and liquidity guide ↗</a></aside>
          </div>}
          {error && <div className="notice error create-error"><b>Creation unavailable</b><span>{error}</span></div>}
        </section> : <section className="view-page">
          <div className="view-heading"><div><span className="eyebrow"><i /> WALLET HISTORY</span><h1>My activity</h1><p>Your portable score, swaps, deposits, and withdrawals across the platform.</p></div>{address && <button className="secondary" onClick={() => { void refreshWalletActivity(); void refreshPoints() }}>Refresh</button>}</div>
          {!address ? <div className="empty-state activity-connect-state"><div className="activity-connect-icon">◇</div><h2>Connect your wallet</h2><p>Connect Inscrib3 Wallet to view your score and activity across every pool.</p><button className="secondary" onClick={() => void connect()}>Connect wallet</button></div> : <>
          <div className="points-dashboard">
            <section className="points-score-card"><span>YOUR SCORE</span><div><b>{points ? comma(points.total) : '—'}</b><em>PTS</em></div><p>{points?.rank ? `Rank #${points.rank} of ${points.participants}` : 'Complete an eligible action to enter the ranking'}</p><small>Mutinynet points will migrate to Mainnet with the same wallet identity.</small><a href="https://docs.inscrib3.com/app/points" target="_blank" rel="noreferrer">Migration details ↗</a></section>
            <section className="points-breakdown"><div><span>POOL CREATION</span><b>{points ? comma(points.poolPoints) : '—'}</b><small>10 points per opened pool</small></div><div><span>SWAPS</span><b>{points ? comma(points.swapPoints) : '—'}</b><small>At least 1 point · scales with protocol fee sats</small></div></section>
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
          {activityCursor && <button className="secondary load-more" onClick={() => void loadMoreActivity()}>Load more activity</button>}
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
