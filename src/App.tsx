import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { api } from './api'
import { TokenMark } from './components'
import type { RequestProgress } from './requests'
import { firstFormError, MAX_WALLET_AMOUNT, MIN_PROTOCOL_FEE_BPS, parseDisplayAmount, rawAmount, validateAssetForm, validatePoolForm, type AssetFormInput, type PoolFormInput } from './form-validation'
import { comma, displayAmount, editableAmount, poolAssetTickers, short } from './format'
import { DUST_SATS, depositFundingSats, exactOutputSellAmount, maxBigInt, minimumSwapOutput, previewLiquidity, swapFundingSats } from './math'
import { loadSavedPayments, savePayment, type PaymentKind, type SavedPayment } from './open-payments'
import { describeWalletError, errorMessage, WALLET_INSTALL_URL, type WalletIssue } from './wallet-issues'
import { CreateLaunchPage, LaunchDetailPage, LaunchesPage, type Launch } from './launches'
import { connectWithPwaWallet } from './pwa-wallet'
import { ActivityPage } from './pages/ActivityPage'
import { CreatePage } from './pages/CreatePage'
import { FaucetPage } from './pages/FaucetPage'
import { LeaderboardPage } from './pages/LeaderboardPage'
import { PoolDetailPage } from './pages/PoolDetailPage'
import { PoolsPage } from './pages/PoolsPage'
import { SwapPage } from './pages/SwapPage'
import type { ActivityEvent, RefundKind, RefundProof, AssetInfo, AssetRisk, BalanceInfo, CatalogAsset, CursorPage, DeploymentInfo, IssueAssetInput, IssueAssetResult, LeaderboardEntry, LeaderboardPage as LeaderboardResult, LiquidityRequest, NetworkInfo, Page, PageResult, PointsSummary, Pool, PoolAssetIssuance, PoolCreation, PoolEligibility, Quote, SwapRequest, WalletActivityEvent } from './types'
import { useAutomaticLanguage } from './localization'

const NETWORK = import.meta.env.VITE_NETWORK ?? 'mutinynet'
if (NETWORK !== 'mutinynet' && NETWORK !== 'mainnet') throw new Error('VITE_NETWORK must be mutinynet or mainnet')
const NETWORK_LABEL = NETWORK === 'mainnet' ? 'MAINNET' : 'MUTINYNET'
const WALLET_NETWORK = NETWORK === 'mainnet' ? 'bitcoin' : 'mutinynet'
const APP_NETWORK_NAME = NETWORK === 'mainnet' ? 'Mainnet' : 'Mutinynet (testnet)'
const SWITCH_NETWORK_LABEL = NETWORK === 'mainnet' ? 'Switch to Mainnet' : 'Switch to testnet'
const OPEN_REQUEST_STATUSES: ReadonlyArray<SwapRequest['status']> = ['pending-funding', 'funded', 'sweeping']
const EMPTY_ASSET_FORM = { name: '', ticker: '', supply: '', decimals: '0', icon: '' }
const ASSET_FIELD_LABELS: Record<keyof AssetFormInput, string> = { name: 'Name', ticker: 'Ticker', supply: 'Initial supply', decimals: 'Decimals', icon: 'Icon URL' }
const POOL_FIELD_LABELS: Partial<Record<keyof PoolFormInput, string>> = { quoteAssetId: 'Quote asset', baseAmount: 'Initial base reserve', quoteAmount: 'Initial quote reserve', feeBps: 'Total fee', protocolFeeBps: 'Protocol fee' }
const DEFAULT_POOL_FORM ={ id: '', name: '', baseAssetId: 'btc', quoteAssetId: '', baseAmount: '', quoteAmount: '', feeBps: '100', protocolFeeBps: String(MIN_PROTOCOL_FEE_BPS) }
const DOCS_URL = 'https://docs.inscrib3.com/app/overview'
const SOURCE_URL = 'https://github.com/inscrib3/app.mutinynet.inscrib3.com'

function routeFromLocation(): { page: Page; poolId?: string; launchId?: string } {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts[0] === 'launches' && parts[1] === 'create') return { page: 'launch-create' }
  if (parts[0] === 'launches' && parts[1]) return { page: 'launch', launchId: decodeURIComponent(parts[1]) }
  if (parts[0] === 'launches') return { page: 'launches' }
  if (parts[0] === 'pools' && parts[1]) return { page: 'pool', poolId: decodeURIComponent(parts[1]) }
  if (parts[0] === 'pools') return { page: 'pools' }
  if (parts[0] === 'create') return { page: 'create' }
  if (parts[0] === 'faucet' && NETWORK === 'mutinynet') return { page: 'faucet' }
  if (parts[0] === 'leaderboard') return { page: 'leaderboard' }
  if (parts[0] === 'activity') return { page: 'activity' }
  return { page: 'swap' }
}

function pathForPage(page: Page, entityId?: string): string {
  if (page === 'launches') return '/launches'
  if (page === 'launch' && entityId) return `/launches/${encodeURIComponent(entityId)}`
  if (page === 'launch-create') return '/launches/create'
  if (page === 'pools') return '/pools'
  if (page === 'pool' && entityId) return `/pools/${encodeURIComponent(entityId)}`
  if (page === 'create') return '/create'
  if (page === 'faucet') return '/faucet'
  if (page === 'leaderboard') return '/leaderboard'
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
  isPwa?: true
  connect(): Promise<string[]>
  isConnected?(): Promise<boolean>
  getAddress(): Promise<string>
  getXOnlyPublicKey(): Promise<string>
  getPointsPublicKey(): Promise<string>
  signMessage(message: string): Promise<{ message: string; signature: string; address: string }>
  getNetwork(): Promise<NetworkInfo>
  getBalance(): Promise<BalanceInfo>
  getAssets(): Promise<AssetInfo[]>
  sendToAddress(address: string, amount: number): Promise<string>
  sendAsset(address: string, assets: Array<{ assetId: string; amount: number }>, bitcoinAmount?: number): Promise<string>
  issueAsset(input: IssueAssetInput): Promise<IssueAssetResult>
  // Planned wallet method (arkade_switchNetwork); older wallets don't have it.
  switchNetwork?(network: string): Promise<void>
  on(event: string, callback: (data?: unknown) => void): void
  off(event: string, callback: (data?: unknown) => void): void
}

declare global { interface Window { arkade?: ArkadeProvider } }
type WalletMode = 'extension' | 'pwa'

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

async function waitForWalletAssets(provider: ArkadeProvider, required: Array<{ assetId: string; amount: bigint }>, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const assets = await provider.getAssets()
    const ready = required.every((item) => {
      const available = assets.filter((asset) => asset.assetId === item.assetId)
        .reduce((total, asset) => total + BigInt(asset.amount), 0n)
      return available >= item.amount
    })
    if (ready) return
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_500))
  }
  throw new Error('Issued assets are not spendable in the wallet yet. Wait a moment and retry; the saved asset IDs will be reused and no assets will be issued twice.')
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

const READING_BALANCES = 'Reading wallet balance…'

function App() {
  useAutomaticLanguage()

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
  const [onFireLaunch, setOnFireLaunch] = useState<Launch | null>(null)
  const [poolResults, setPoolResults] = useState<Pool[]>([])
  const [poolResultTotal, setPoolResultTotal] = useState(0)
  const [poolCursor, setPoolCursor] = useState<string | undefined>()
  const [poolId, setPoolId] = useState(initialRoute.poolId ?? '')
  const [launchId, setLaunchId] = useState(initialRoute.launchId ?? '')
  const [address, setAddress] = useState('')
  const [identityKey, setIdentityKey] = useState('')
  const [walletMode, setWalletMode] = useState<WalletMode | null>(null)
  const [assets, setAssets] = useState<AssetInfo[]>([])
  const [btcBalance, setBtcBalance] = useState(0)
  // False until the wallet has reported balances, so pages show a reading state instead of 0.
  const [balancesLoaded, setBalancesLoaded] = useState(false)
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
  const [faucetCopied, setFaucetCopied] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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
  const [activity, setActivity] = useState<WalletActivityEvent[]>([])
  const [activityCursor, setActivityCursor] = useState<string | undefined>()
  const [createMode, setCreateMode] = useState<'asset' | 'pool'>(initialRoute.page === 'create' && initialParams.get('mode') === 'pool' ? 'pool' : 'asset')
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM)
  const [issuedAsset, setIssuedAsset] = useState<IssueAssetResult | null>(null)
  const [poolForm, setPoolForm] = useState(DEFAULT_POOL_FORM)
  const [poolCreation, setPoolCreation] = useState<PoolCreation | null>(null)
  const [poolEligibility, setPoolEligibility] = useState<{ pair: string; result: PoolEligibility } | null>(null)
  const [poolAssetIssuance, setPoolAssetIssuance] = useState<PoolAssetIssuance | null>(null)
  const [creationStep, setCreationStep] = useState('')
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null)
  const [paymentsRestored, setPaymentsRestored] = useState(false)
  const [points, setPoints] = useState<PointsSummary | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [leaderboardQuery, setLeaderboardQuery] = useState(initialRoute.page === 'leaderboard' ? initialParams.get('q') ?? '' : '')
  const [globalLeaderboard, setGlobalLeaderboard] = useState<LeaderboardEntry[]>([])
  const [globalLeaderboardTotal, setGlobalLeaderboardTotal] = useState(0)
  const [globalLeaderboardOffset, setGlobalLeaderboardOffset] = useState<number | undefined>()
  const [globalLeaderboardLoading, setGlobalLeaderboardLoading] = useState(false)
  const [globalLeaderboardError, setGlobalLeaderboardError] = useState('')

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
  // Exact output guarantees the typed output, so slippage tolerance raises the input instead.
  const swapSellAmount = raw && quoteMode === 'output' ? exactOutputSellAmount(raw, slippage) : raw
  const receiveRaw = rawAmount(receiveAmount, buyDecimals)
  const sellAmountCheck = parseDisplayAmount(amount, sellDecimals)
  const walletOnWrongNetwork = walletNetwork !== null && walletNetwork.network !== WALLET_NETWORK
  const walletReady = Boolean(address) && !walletOnWrongNetwork
  const popupWallet = walletMode === 'pwa'
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
  const liquidityPreview = (mode === 'deposit' || mode === 'withdraw') && liquidityRaw
    ? previewLiquidity(mode, liquidityRaw, pool?.baseReserve, pool?.quoteReserve, pool?.lpSupply)
    : null
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
    btcBalance: walletBalance('btc'),
    creationFeeSats: BigInt(deployment?.poolCreationFeeSats ?? '0'),
    existingPairName: existingPair?.name,
  })
  const poolPairKey = `${poolForm.baseAssetId}:${poolForm.quoteAssetId}`
  useEffect(() => {
    if (!poolForm.baseAssetId || !poolForm.quoteAssetId) return
    const pair = `${poolForm.baseAssetId}:${poolForm.quoteAssetId}`
    const controller = new AbortController()
    void api<PoolEligibility>(`/v1/pool-eligibility?baseAssetId=${encodeURIComponent(poolForm.baseAssetId)}&quoteAssetId=${encodeURIComponent(poolForm.quoteAssetId)}`, { signal: controller.signal })
      .then((result) => setPoolEligibility({ pair, result }))
      .catch((cause: unknown) => {
        if ((cause as Error).name !== 'AbortError') setPoolEligibility({ pair, result: { eligible: false, reason: `Unable to verify pool eligibility: ${errorMessage(cause)}` } })
      })
    return () => controller.abort()
  }, [poolForm.baseAssetId, poolForm.quoteAssetId])
  const assetValidation = validateAssetForm(assetForm)
  const initialLiquiditySummary = creationBaseAmount && creationQuoteAmount && creationBaseDetails && creationQuoteDetails
    ? `${displayAmount(creationBaseAmount, creationBaseDetails.decimals, 8)} ${creationBaseDetails.ticker} + ${displayAmount(creationQuoteAmount, creationQuoteDetails.decimals, 8)} ${creationQuoteDetails.ticker}`
    : 'Enter both reserves'
  // Describes the payment being made; once the pool opened or was refunded the
  // form is reset, and the result box below reports that creation instead.
  const bootstrapSummary = (() => {
    if (!poolCreation || !deployment || poolCreation.status !== 'awaiting-funding') return null
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

  function navigate(nextPage: Page, entityId?: string) {
    const url = new URL(pathForPage(nextPage, entityId), window.location.origin)
    if (nextPage === 'pools' && poolSearch.trim()) url.searchParams.set('q', poolSearch.trim())
    if (nextPage === 'create' && createMode === 'pool') url.searchParams.set('mode', 'pool')
    if (nextPage === 'leaderboard' && leaderboardQuery.trim()) url.searchParams.set('q', leaderboardQuery.trim())
    window.history.pushState(null, '', `${url.pathname}${url.search}`)
    setPage(nextPage)
    setMobileMenuOpen(false)
    if (nextPage === 'activity') { setActivity([]); setActivityCursor(undefined) }
    if (nextPage === 'pool' && entityId) setPoolId(entityId)
    if (nextPage === 'launch' && entityId) setLaunchId(entityId)
    setError('')
  }

  function updatePoolSearch(value: string) {
    setPoolSearch(value)
    const url = new URL('/pools', window.location.origin)
    if (value.trim()) url.searchParams.set('q', value.trim())
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }

  async function copyFaucetAddress() {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setFaucetCopied(true)
    window.setTimeout(() => setFaucetCopied(false), 1_800)
  }

  function updateLeaderboardQuery(value: string) {
    setLeaderboardQuery(value)
    const url = new URL('/leaderboard', window.location.origin)
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
    setAssets(nextAssets); setBtcBalance(nextBalance.available); setBalancesLoaded(true)
  }, [address, walletOnWrongNetwork, setAssets, setBtcBalance])

  const loadWallet = useCallback(async (provider: ArkadeProvider, knownAddress?: string) => {
    const network = await provider.getNetwork()
    const nextAddress = knownAddress ?? await provider.getAddress()
    const [nextWalletKey, nextIdentityKey] = await Promise.all([provider.getXOnlyPublicKey(), provider.getPointsPublicKey()])
    if (!/^[0-9a-f]{64}$/i.test(nextWalletKey) || !/^[0-9a-f]{64}$/i.test(nextIdentityKey)) throw new Error('Wallet returned an invalid identity public key')
    setWalletMode(provider.isPwa ? 'pwa' : 'extension'); setWalletNetwork(network); setAddress(nextAddress); setIdentityKey(nextIdentityKey.toLowerCase()); setWalletIssue(null); setShowSwitchSteps(false)
    if (network.network !== WALLET_NETWORK) { setAssets([]); setBtcBalance(0); return }
    const identityPath = `/v1/points/identity?address=${encodeURIComponent(nextAddress)}&walletKey=${encodeURIComponent(nextWalletKey)}&identityKey=${encodeURIComponent(nextIdentityKey)}`
    const registration = await api<{ registered: boolean; message: string }>(identityPath)
    if (!registration.registered) {
      const proof = await provider.signMessage(registration.message)
      await api('/v1/points/identity', { method: 'POST', body: JSON.stringify({ address: nextAddress, walletKey: nextWalletKey,
        identityKey: nextIdentityKey, message: proof.message, signature: proof.signature, signingAddress: proof.address }) })
    }
    const [nextAssets, nextBalance, summary, leaders] = await Promise.all([
      provider.getAssets(), provider.getBalance(),
      api<PointsSummary>(`/v1/points?address=${encodeURIComponent(nextAddress)}&identityKey=${encodeURIComponent(nextIdentityKey)}`),
      api<{ items: LeaderboardEntry[] }>('/v1/points/leaderboard?limit=5'),
    ])
    assertProviderAmounts(nextAssets, nextBalance)
    setAssets(nextAssets); setBtcBalance(nextBalance.available); setBalancesLoaded(true); setPoints(summary); setLeaderboard(leaders.items)
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
    const result = await api<CursorPage<WalletActivityEvent>>(`/v1/activity?payAddress=${encodeURIComponent(address)}&limit=25`)
    setActivity(result.items); setActivityCursor(result.nextCursor)
  }, [address, setActivity, setActivityCursor])

  const refreshPoints = useCallback(async () => {
    if (!address || !identityKey) return
    const [summary, leaders] = await Promise.all([
      api<PointsSummary>(`/v1/points?address=${encodeURIComponent(address)}&identityKey=${encodeURIComponent(identityKey)}`),
      api<{ items: LeaderboardEntry[] }>('/v1/points/leaderboard?limit=5'),
    ])
    setPoints(summary); setLeaderboard(leaders.items)
  }, [address, identityKey])

  const loadMoreLeaderboard = useCallback(async () => {
    if (globalLeaderboardOffset === undefined || globalLeaderboardLoading) return
    setGlobalLeaderboardLoading(true); setGlobalLeaderboardError('')
    try {
      const query = leaderboardQuery.trim() ? `&q=${encodeURIComponent(leaderboardQuery.trim())}` : ''
      const result = await api<LeaderboardResult>(`/v1/points/leaderboard?limit=25&offset=${globalLeaderboardOffset}${query}`)
      setGlobalLeaderboard((current) => [...current, ...result.items]); setGlobalLeaderboardTotal(result.total); setGlobalLeaderboardOffset(result.nextOffset)
    } catch (cause) { setGlobalLeaderboardError(cause instanceof Error ? cause.message : 'Leaderboard unavailable') }
    finally { setGlobalLeaderboardLoading(false) }
  }, [globalLeaderboardLoading, globalLeaderboardOffset, leaderboardQuery])

  async function loadMoreActivity() {
    if (!activityCursor) return
    const path = page === 'activity'
      ? address ? `/v1/activity?payAddress=${encodeURIComponent(address)}&limit=25&cursor=${encodeURIComponent(activityCursor)}` : undefined
      : poolId ? `/v1/pools/${encodeURIComponent(poolId)}/activity?limit=25&cursor=${encodeURIComponent(activityCursor)}` : undefined
    if (!path) return
    const result = await api<CursorPage<WalletActivityEvent>>(path)
    setActivity((current) => [...current, ...result.items]); setActivityCursor(result.nextCursor)
  }

  const openPoolDetail = useCallback((target: Pool) => {
    window.history.pushState(null, '', pathForPage('pool', target.id))
    setPoolId(target.id); setPage('pool'); setError('')
  }, [setPoolId, setPage, setError])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileMenuOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [mobileMenuOpen])

  useEffect(() => {
    const onPopState = () => {
      const route = routeFromLocation()
      const params = new URLSearchParams(window.location.search)
      setPage(route.page)
      setMobileMenuOpen(false)
      const nextPoolId = route.poolId ?? ''
      if (nextPoolId) setPoolId(nextPoolId)
      if (route.launchId) setLaunchId(route.launchId)
      if (route.page === 'pools') setPoolSearch(params.get('q') ?? '')
      if (route.page === 'leaderboard') setLeaderboardQuery(params.get('q') ?? '')
      if (route.page === 'create') setCreateMode(params.get('mode') === 'pool' ? 'pool' : 'asset')
      if (route.page === 'swap') setMode(['deposit', 'withdraw'].includes(params.get('mode') ?? '') ? params.get('mode') as 'deposit' | 'withdraw' : 'swap')
      setError('')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (page !== 'leaderboard') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setGlobalLeaderboardLoading(true); setGlobalLeaderboardError('')
      const query = leaderboardQuery.trim() ? `&q=${encodeURIComponent(leaderboardQuery.trim())}` : ''
      void api<LeaderboardResult>(`/v1/points/leaderboard?limit=25${query}`, { signal: controller.signal })
        .then((result) => { setGlobalLeaderboard(result.items); setGlobalLeaderboardTotal(result.total); setGlobalLeaderboardOffset(result.nextOffset) })
        .catch((cause) => { if (!controller.signal.aborted) setGlobalLeaderboardError(cause instanceof Error ? cause.message : 'Leaderboard unavailable') })
        .finally(() => { if (!controller.signal.aborted) setGlobalLeaderboardLoading(false) })
    }, 250)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [leaderboardQuery, page])

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
    const load = () => api<PageResult<Launch>>('/v1/launches?sort=trending&limit=100')
      .then((page) => setOnFireLaunch(page.items.find((item) => item.onFire) ?? null))
      .catch(() => undefined)
    void load()
    const refresh = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(refresh)
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
    const syncAccounts = (data?: unknown) => {
      if (Array.isArray(data) && data.length === 0) {
        setAddress(''); setIdentityKey(''); setAssets([]); setBtcBalance(0); setBalancesLoaded(false); setWalletMode(null); setWalletNetwork(null)
        if (provider.isPwa) window.arkade = undefined
        return
      }
      sync()
    }
    provider.on('accountChanged', sync)
    provider.on('accountsChanged', syncAccounts)
    provider.on('networkChanged', sync)
    return () => { provider.off('accountChanged', sync); provider.off('accountsChanged', syncAccounts); provider.off('networkChanged', sync) }
  }, [address, loadWallet, showWalletError, walletMode])

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
  }, [address, identityKey, refreshPoints])

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
    let provider = window.arkade?.isArkade === true ? window.arkade : undefined
    setConnecting(true); setWalletIssue(null)
    try {
      if (provider?.isPwa && provider.isConnected) {
        try { await provider.isConnected() }
        catch { window.arkade = undefined; provider = undefined }
      }
      if (!provider) {
        const session = await connectWithPwaWallet(WALLET_NETWORK)
        const pwaProvider = session.provider as unknown as ArkadeProvider
        window.arkade = pwaProvider
        const [connected] = session.accounts
        if (!connected) throw new Error('Wallet returned no active account')
        const expectedPrefix = NETWORK === 'mainnet' ? 'ark1' : 'tark1'
        if (!connected.toLowerCase().startsWith(expectedPrefix)) {
          throw new Error(`The wallet popup returned an address for another network. Open Inscrib3 Wallet, switch to ${APP_NETWORK_NAME}, and try again.`)
        }
        setPoints(null); setLeaderboard([])
        await loadWallet(pwaProvider, connected)
        return
      }
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

  async function sendWalletBtc(addressToPay: string, amount: bigint, label: string): Promise<string> {
    const safeAmount = walletNumber(amount, label)
    if (!window.arkade) throw new Error('Connect Inscrib3 Wallet first.')
    await assertWalletNetwork(window.arkade)
    return window.arkade.sendToAddress(addressToPay, safeAmount)
  }

  async function sendWalletAssets(addressToPay: string, assetsToPay: Array<{ assetId: string; amount: number }>, bitcoinAmount: number | undefined): Promise<string> {
    if (!window.arkade) throw new Error('Connect Inscrib3 Wallet first.')
    await assertWalletNetwork(window.arkade)
    return window.arkade.sendAsset(addressToPay, assetsToPay, bitcoinAmount)
  }

  async function issueLaunchAsset(input: { amount: bigint; metadata: { name?: string; ticker: string; decimals: number } }): Promise<IssueAssetResult> {
    if (!window.arkade || !walletReady) throw new Error('Connect Inscrib3 Wallet on the correct network first.')
    await assertWalletNetwork(window.arkade)
    return issueAssetWithRetry(window.arkade, { amount: walletNumber(input.amount, 'launch asset supply'), metadata: input.metadata }, () => undefined)
  }

  async function fundLaunchContract(contractAddress: string, side: 'buy' | 'sell' | 'bootstrap', input: bigint,
    fundingSats: bigint, tokenAssetId?: string, controlAssetId?: string): Promise<string> {
    if (!walletReady) throw new Error('Connect Inscrib3 Wallet on the correct network first.')
    if (side === 'buy') return sendWalletBtc(contractAddress, fundingSats, 'launch buy funding')
    if (!window.arkade) throw new Error('Connect Inscrib3 Wallet first.')
    if (!tokenAssetId) throw new Error('Launch token asset ID is missing.')
    if (side === 'bootstrap' && !controlAssetId) throw new Error('Launch control asset ID is missing.')
    const required = side === 'sell'
      ? [{ assetId: tokenAssetId, amount: input }]
      : [{ assetId: tokenAssetId, amount: input }, { assetId: controlAssetId!, amount: 1n }]
    await assertWalletNetwork(window.arkade)
    await waitForWalletAssets(window.arkade, required)
    const assets = side === 'sell'
      ? [{ assetId: tokenAssetId, amount: walletNumber(input, 'launch token funding') }]
      : [{ assetId: tokenAssetId, amount: walletNumber(input, 'launch token supply') }, { assetId: controlAssetId!, amount: 1 }]
    return sendWalletAssets(contractAddress, assets, walletNumber(fundingSats, 'launch contract satoshis'))
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
      setCreationStep('Checking asset eligibility')
      const eligibility = await api<PoolEligibility>(`/v1/pool-eligibility?baseAssetId=${encodeURIComponent(poolForm.baseAssetId)}&quoteAssetId=${encodeURIComponent(poolForm.quoteAssetId)}`)
      setPoolEligibility({ pair: `${poolForm.baseAssetId}:${poolForm.quoteAssetId}`, result: eligibility })
      if (!eligibility.eligible) throw new Error(eligibility.reason ?? 'This asset pair cannot be used in a generic pool.')
      setCreationStep('Checking pair availability')
      const candidates = await api<PageResult<Pool>>(`/v1/pools?assetId=${encodeURIComponent(poolForm.baseAssetId)}&limit=100`)
      const duplicate = candidates.items.find((candidate) => candidate.lifecycle === 'active' && [candidate.baseAssetId, candidate.quoteAssetId].includes(poolForm.baseAssetId)
        && [candidate.baseAssetId, candidate.quoteAssetId].includes(poolForm.quoteAssetId))
      if (duplicate) throw new Error(`A pool already exists for this pair (${duplicate.name}).`)
      const tickers = poolAssetTickers(poolForm.name)
      const issuanceKey = JSON.stringify([WALLET_NETWORK, address, poolForm.id, tickers.stem, baseAmount.toString(), baseDecimals])
      let issued = poolAssetIssuance?.key === issuanceKey ? poolAssetIssuance : null
      let control = issued?.control
      if (!control) {
        setCreationStep('1/5 · Issue the pool control asset')
        control = await issueAssetWithRetry(window.arkade, { amount: 1, metadata: { ticker: tickers.control, decimals: 0 } },
          () => setCreationStep('1/5 · Refresh wallet state and retry control asset'))
        issued = { key: issuanceKey, control }
        setPoolAssetIssuance(issued)
      }
      let lp = issued?.lp
      if (!lp) {
        setCreationStep('2/5 · Issue LP tokens')
        lp = await issueAssetWithRetry(window.arkade, { amount: safeBase, controlAssetId: control.assetId, metadata: { ticker: tickers.lp, decimals: baseDecimals } },
          () => setCreationStep('2/5 · Refresh wallet state and retry LP tokens'))
        issued = { ...issued!, lp }
        setPoolAssetIssuance(issued)
      }
      let ledger = issued?.ledger
      if (!ledger) {
        setCreationStep('3/5 · Issue the covenant ledger asset')
        ledger = await issueAssetWithRetry(window.arkade, { amount: safeBase, controlAssetId: control.assetId, metadata: { ticker: tickers.ledger, decimals: 0 } },
          () => setCreationStep('3/5 · Refresh wallet state and retry ledger asset'))
        issued = { ...issued!, ledger }
        setPoolAssetIssuance(issued)
      }
      setCreationStep('4/5 · Register the atomic bootstrap')
      const creation = await api<PoolCreation>('/v1/pools', { method: 'POST', body: JSON.stringify({
        id: poolForm.id, name: poolForm.name, baseAssetId: poolForm.baseAssetId, quoteAssetId: poolForm.quoteAssetId,
        lpAssetId: lp.assetId, lpLedgerAssetId: ledger.assetId, controlAssetId: control.assetId,
        feeBps, protocolFeeBps, payAddress: address, baseAmount: baseAmount.toString(), quoteAmount: quoteAmount.toString(),
        identityKey, ...(referralCode ? { referralCode } : {}),
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

  // Refunds return funds to the payer; the API requires the payer's signature to start one.
  async function signRefund(kind: RefundKind, id: string): Promise<RefundProof> {
    if (!window.arkade) throw new Error('Connect Inscrib3 Wallet first.')
    await assertWalletNetwork(window.arkade)
    const { message } = await api<{ message: string }>(`/v1/refund-proof-message?type=${kind}&id=${encodeURIComponent(id)}`)
    const walletKey = await window.arkade.getXOnlyPublicKey()
    const signed = await window.arkade.signMessage(message)
    return { walletKey, message: signed.message, signature: signed.signature, signingAddress: signed.address }
  }

  async function refundPoolCreation() {
    if (!poolCreation?.fundingTxid) return
    const { fundingTxid } = poolCreation
    setBusy(true); setError('')
    try {
      const proof = await signRefund('pool-creation', poolCreation.id)
      const refunded = await api<PoolCreation>(`/v1/pool-creations/${encodeURIComponent(poolCreation.id)}/refund`, { method: 'POST', body: JSON.stringify({ fundingTxid, proof }) })
      setPoolCreation(refunded); setCreationStep('Bootstrap refunded to your wallet'); setPoolAssetIssuance(null)
      await refreshAssets()
    } catch (cause) { setError(paymentSentMessage(fundingTxid, cause, 'Try again in a moment')) }
    finally { setBusy(false) }
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
    if (!pool || !raw || !quote || swapBlocker) return
    if (!window.arkade) return
    setBusy(true); setError(''); setRequest(null)
    let fundingTxid: string | undefined
    try {
      await assertWalletNetwork(window.arkade)
      const minOutput = swapMinimumOutput(quote)
      const intent = await api<SwapRequest>(`/v1/pools/${pool.id}/swaps`, {
        method: 'POST', body: JSON.stringify({ payAddress: address, sellAssetId, sellAmount: swapSellAmount!.toString(), minOutput: minOutput.toString(),
          identityKey, ...(referralCode ? { referralCode } : {}) }),
      })
      setRequest(intent)
      const fundingSats = walletNumber(BigInt(intent.fundingSats), 'swap BTC funding')
      fundingTxid = sellAssetId === 'btc'
        ? await sendWalletBtc(intent.contractAddress, BigInt(intent.fundingSats), 'swap BTC funding')
        : await sendWalletAssets(intent.contractAddress, [{ assetId: sellAssetId, amount: walletNumber(BigInt(intent.sellAmount!), 'asset funding') }], fundingSats)
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
    if (!pool || !liquidityRaw || !liquidityPreview || mode === 'swap' || liquidityBlocker) return
    if (!window.arkade) return
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
      fundingTxid = await sendWalletAssets(intent.contractAddress, fundingAssets, mode === 'deposit'
        ? walletNumber(depositFundingSats(pool.baseAssetId, BigInt(intent.baseAmount)), 'deposit BTC funding')
        : undefined)
      setLiquidityRequest(await registerFunding<LiquidityRequest>(`/v1/liquidity/${intent.id}`, fundingTxid))
    } catch (cause) { reportFundingFailure(cause, fundingTxid, setLiquidityRequest) }
    finally { setBusy(false) }
  }

  const readingBalances = Boolean(address) && !walletOnWrongNetwork && !balancesLoaded
  const balance = readingBalances ? '…' : sellAssetId === 'btc' ? displayAmount(BigInt(btcBalance), 8, 8) : sellAsset ? displayAmount(BigInt(sellAsset.amount), sellDecimals, 4) : '0'
  const walletActionLabel = !address ? 'Connect Inscrib3 Wallet' : walletOnWrongNetwork ? SWITCH_NETWORK_LABEL : null
  const baseTicker = pool?.baseAssetId === 'btc' ? 'BTC' : baseAsset?.metadata?.ticker ?? pool?.baseAssetInfo?.metadata?.ticker ?? 'BASE'
  const quoteTicker = pool?.quoteAssetId === 'btc' ? 'BTC' : quoteAsset?.metadata?.ticker ?? pool?.quoteAssetInfo?.metadata?.ticker ?? 'QUOTE'
  const swapBlocker = describeSwapBlocker()
  const liquidityBlocker = describeLiquidityBlocker()
  const assetFormBlocker = firstFormError(assetValidation.errors, ASSET_FIELD_LABELS)
  const currentPoolEligibility = poolEligibility?.pair === poolPairKey ? poolEligibility.result : null
  const poolFormBlocker = !paymentsRestored ? 'Checking unfinished payments…'
    : poolOpeningPending ? 'Finish opening your funded pool first'
    : poolForm.baseAssetId && poolForm.quoteAssetId && !currentPoolEligibility ? 'Checking whether this pair is eligible…'
    : currentPoolEligibility && !currentPoolEligibility.eligible ? currentPoolEligibility.reason ?? 'This pair is reserved for the launch market'
    : readingBalances ? READING_BALANCES
    : deployment ? firstFormError(poolValidation.errors, POOL_FIELD_LABELS) : 'Pool creation is unavailable right now'

  function swapMinimumOutput(swapQuote: Quote): bigint {
    return quoteMode === 'output' && receiveRaw ? receiveRaw : minimumSwapOutput(BigInt(swapQuote.outputAmount), slippage)
  }

  function describeSwapBlocker(): string | null {
    if (!paymentsRestored) return 'Checking unfinished payments…'
    if (request && swapLocked) return request.status === 'failed' ? 'Dismiss the failed swap to retry' : 'Swap in progress…'
    if (!pool) return 'Select a token pair'
    if (!pool.available) return 'Pool unavailable'
    if (!pool.swapEnabled) return 'Legacy pool · swaps disabled during migration'
    const typedAmount = quoteMode === 'input' ? sellAmountCheck : parseDisplayAmount(receiveAmount, buyDecimals)
    if ('error' in typedAmount) return typedAmount.error
    if (readingBalances) return READING_BALANCES
    if (swapSellAmount && swapSellAmount > walletBalance(sellAssetId)) return `Insufficient ${sellTicker} balance`
    if (!quote) return 'Finding best price…'
    if (swapMinimumOutput(quote) <= 0n) return `Amount too small: the minimum ${buyTicker} received rounds to zero`
    if (swapSellAmount && swapFundingSats(swapSellAmount, sellAssetId, quote.carrierFeeSats) > walletBalance('btc')) return sellAssetId === 'btc' ? 'Insufficient BTC balance (network fee included)' : 'Not enough BTC for the network fee'
    return null
  }

  function describeLiquidityBlocker(): string | null {
    if (!paymentsRestored) return 'Checking unfinished payments…'
    if (liquidityRequest && liquidityLocked) return liquidityRequest.status === 'failed' ? 'Dismiss the failed request to retry' : 'Request in progress…'
    if (!pool?.available) return 'Pool unavailable'
    if (mode === 'deposit' && !pool.depositEnabled) return 'Legacy pool · deposits disabled during migration'
    if (mode === 'withdraw' && !pool.withdrawalEnabled) return 'Withdrawals unavailable'
    const typedAmount = parseDisplayAmount(liquidityAmount, mode === 'withdraw' ? lpDecimals : baseDecimals)
    if ('error' in typedAmount) return typedAmount.error
    if (readingBalances) return READING_BALANCES
    if (!liquidityPreview) return 'Pool reserves unavailable'
    const zeroTicker = liquidityZeroTicker(liquidityPreview)
    if (zeroTicker) return `Amount too small: the ${zeroTicker} ${mode === 'withdraw' ? 'returned' : 'required'} rounds to zero`
    const shortTicker = liquidityShortfallTicker(pool, liquidityPreview)
    if (shortTicker) return `Insufficient ${shortTicker} balance`
    return null
  }

  // The API rejects a deposit or withdrawal in which any amount rounds to zero.
  function liquidityZeroTicker(preview: { base: bigint; quote: bigint; lp: bigint }): string | null {
    if (mode === 'withdraw') {
      if (preview.base <= 0n) return baseTicker
      return preview.quote <= 0n ? quoteTicker : null
    }
    if (preview.quote <= 0n) return quoteTicker
    return preview.lp <= 0n ? 'LP' : null
  }

  function liquidityShortfallTicker(target: Pool, preview: { base: bigint; quote: bigint; lp: bigint }): string | null {
    if (mode === 'withdraw') return preview.lp > walletBalance(target.lpAssetId) ? 'LP' : null
    if (preview.base > walletBalance(target.baseAssetId)) return baseTicker
    if (preview.quote > walletBalance(target.quoteAssetId)) return quoteTicker
    if (depositFundingSats(target.baseAssetId, preview.base) > walletBalance('btc')) return 'BTC (network fee included)'
    return null
  }

  return (
    <div className="app-shell">
      <header>
        <button className="brand" onClick={() => navigate('swap')} aria-label="Inscrib3 app home"><img src="/logo.svg" alt="" /><span>INSCRIB3</span><small>APP</small></button>
        <nav className="desktop-nav">{(['swap', 'launches', 'pools', 'create'] as const).map((item) => <button key={item} className={page === item || (item === 'pools' && page === 'pool') || (item === 'launches' && (page === 'launch' || page === 'launch-create')) ? 'active' : ''} onClick={() => { navigate(item); if (item === 'pools') runWithToast(refreshPools) }}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}{NETWORK === 'mutinynet' && <button className={page === 'faucet' ? 'active' : ''} onClick={() => navigate('faucet')}>Faucet</button>}{(['leaderboard', 'activity'] as const).map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => navigate(item)}>{item[0]!.toUpperCase() + item.slice(1)}</button>)}<a className="nav-docs" href={DOCS_URL} target="_blank" rel="noreferrer">Docs ↗</a></nav>
        <div className="header-actions"><span className="network"><i /> {NETWORK_LABEL}</span>{address && <button className="points-chip" onClick={() => navigate('activity')} title="Your portable points"><span>◆</span>{points ? comma(points.total) : '—'} PTS</button>}{address ? <span className={`wallet-address${walletOnWrongNetwork ? ' wrong-network' : ''}`} title={address}>{short(address, 4)}</span> : <button className="wallet-small" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}</button>}<button className={`menu-toggle${mobileMenuOpen ? ' open' : ''}`} type="button" aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" onClick={() => setMobileMenuOpen((open) => !open)}><span /><span /><span /></button></div>
      </header>

      {mobileMenuOpen && <div className="mobile-menu-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMobileMenuOpen(false) }}>
        <section className="mobile-menu" id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="mobile-menu-head"><div><span>NAVIGATION</span><b>Inscrib3 App</b></div><button type="button" onClick={() => setMobileMenuOpen(false)} aria-label="Close navigation menu">×</button></div>
          <div className="mobile-menu-links">{(['swap', 'launches', 'pools', 'create'] as const).map((item) => <button key={item} className={page === item || (item === 'pools' && page === 'pool') || (item === 'launches' && (page === 'launch' || page === 'launch-create')) ? 'active' : ''} onClick={() => { navigate(item); if (item === 'pools') runWithToast(refreshPools) }}><span>{item[0]!.toUpperCase() + item.slice(1)}</span><i>→</i></button>)}{NETWORK === 'mutinynet' && <button className={page === 'faucet' ? 'active' : ''} onClick={() => navigate('faucet')}><span>Faucet</span><i>→</i></button>}{(['leaderboard', 'activity'] as const).map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => navigate(item)}><span>{item[0]!.toUpperCase() + item.slice(1)}</span><i>→</i></button>)}</div>
          <div className="mobile-menu-foot"><span><i /> {NETWORK_LABEL}</span><a href={DOCS_URL} target="_blank" rel="noreferrer">Documentation ↗</a></div>
        </section>
      </div>}

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
      {popupWallet && !walletIssue && <div className="wallet-banner popup-wallet-banner" role="status">
        <div><b>Connected through Inscrib3 Wallet PWA</b><span>Keep the wallet window open. It provides balances, events, asset lifecycle operations, and explicit approval for every financial request.</span></div>
        <a className="wallet-small" href={WALLET_INSTALL_URL} target="_blank" rel="noreferrer">Install extension</a>
      </div>}

      <main>
        {page === 'swap' ? <SwapPage mode={mode} pool={pool} baseTicker={baseTicker} quoteTicker={quoteTicker} baseDecimals={baseDecimals} quoteDecimals={quoteDecimals} buyDecimals={buyDecimals} lpDecimals={lpDecimals} baseAsset={baseAsset} lpAsset={lpAsset} btcBalance={btcBalance} sellTicker={sellTicker} buyTicker={buyTicker} sellAssetId={sellAssetId} buyAssetId={buyAssetId} tokenDetails={tokenDetails} amount={amount} receiveAmount={receiveAmount} quoteMode={quoteMode} maxSpend={quoteMode === 'output' && swapSellAmount ? `${displayAmount(swapSellAmount, sellDecimals, 8)} ${sellTicker}` : null} quote={quote} balance={balance} slippage={slippage} showSettings={showSettings} swapLocked={swapLocked} liquidityLocked={liquidityLocked} busy={busy} connecting={connecting} walletReady={walletReady} walletActionLabel={walletActionLabel} swapBlocker={swapBlocker} liquidityBlocker={liquidityBlocker} error={error} request={request} liquidityRequest={liquidityRequest} liquidityAmount={liquidityAmount} liquidityPreview={liquidityPreview} controlledPoolAssets={controlledPoolAssets} linkCopied={linkCopied} onFirePool={onFirePool} onFireBase={onFireBase} onFireQuote={onFireQuote} onFireLaunch={onFireLaunch} deployment={deployment} onSwapModeChange={updateSwapMode} onToggleSettings={() => setShowSettings(!showSettings)} onSlippageChange={setSlippage} onMax={setMaxAmount} onAmountChange={(value) => { setQuoteMode('input'); setAmount(value); setReceiveAmount(''); setQuote(null); setRequest(null); setError('') }} onReceiveChange={(value) => { setQuoteMode('output'); setReceiveAmount(value); setAmount(''); setQuote(null); setRequest(null); setError('') }} onOpenPairModal={openPairModal} onReverse={reverse} onSwap={() => void swap()} onSubmitLiquidity={() => void submitLiquidity()} onLiquidityChange={(value) => { setLiquidityAmount(value); setLiquidityRequest(null); setError('') }} onDismissRequest={() => setRequest(null)} onDismissLiquidity={() => setLiquidityRequest(null)} onRetrySwap={() => { if (request) void retryRegistration(`/v1/swaps/${request.id}`, request, setRequest) }} onRetryLiquidity={() => { if (liquidityRequest) void retryRegistration(`/v1/liquidity/${liquidityRequest.id}`, liquidityRequest, setLiquidityRequest) }} onCopyLink={() => void copySwapLink()} onViewPool={openPoolDetail} onSwitchPool={(target) => switchToPool(target)} onViewLaunch={(id) => navigate('launch', id)} /> : page === 'launches' ? <LaunchesPage onOpen={(id) => navigate('launch', id)} onCreate={() => navigate('launch-create')} />
        : page === 'launch' ? <LaunchDetailPage key={launchId} id={launchId} onBack={() => navigate('launches')} tradingEnabled={Boolean(deployment?.launches?.tradingEnabled)}
          walletAddress={address} walletBalance={walletBalance} walletBalancesAvailable={balancesLoaded} popupWallet={popupWallet} refreshWallet={refreshAssets} connectWallet={() => void requireWallet()}
          fundContract={fundLaunchContract} signRefund={signRefund} identityKey={identityKey} referralCode={referralCode} />
        : page === 'launch-create' ? <CreateLaunchPage onBack={() => navigate('launches')} tradingEnabled={Boolean(deployment?.launches?.tradingEnabled)}
          walletAddress={address} popupWallet={popupWallet} connectWallet={() => void requireWallet()} issueAsset={issueLaunchAsset} fundContract={fundLaunchContract}
          onOpened={(id) => navigate('launch', id)} identityKey={identityKey} referralCode={referralCode} />
        : page === 'pools' ? <PoolsPage query={poolSearch} updateQuery={updatePoolSearch} pools={filteredPools} total={poolResultTotal} assets={assets} onView={openPoolDetail} onTrade={(item) => switchToPool(item, 'push')} hasMore={Boolean(poolCursor)} onRefresh={() => runWithToast(refreshPools)} onLoadMore={() => runWithToast(loadMorePools)} /> : page === 'pool' ? <PoolDetailPage pool={pool} onBack={() => navigate('pools')} onTrade={(target) => switchToPool(target, 'push')} tokenDetails={tokenDetails} activity={activity as ActivityEvent[]} hasMore={Boolean(activityCursor)} onRefresh={() => runWithToast(refreshPoolActivity)} onLoadMore={() => runWithToast(loadMoreActivity)} />
        : page === 'faucet' ? <FaucetPage address={address} walletOnWrongNetwork={walletOnWrongNetwork} connecting={connecting} connect={() => void connect()} copyFaucetAddress={copyFaucetAddress} faucetCopied={faucetCopied} /> : page === 'leaderboard' ? <LeaderboardPage entries={globalLeaderboard} total={globalLeaderboardTotal} loading={globalLeaderboardLoading} error={globalLeaderboardError} hasMore={globalLeaderboardOffset !== undefined} query={leaderboardQuery} updateQuery={updateLeaderboardQuery} loadMore={() => void loadMoreLeaderboard()} identityKey={points?.identityKey} /> : page === 'create' ? <CreatePage createMode={createMode} onSelectMode={updateCreateMode} busy={busy} connecting={connecting} walletReady={walletReady} walletActionLabel={walletActionLabel} error={error} assetForm={assetForm} onAssetFormChange={setAssetForm} assetValidation={assetValidation} assetFormBlocker={assetFormBlocker} createAsset={() => void createAsset()} creationStep={creationStep} issuedAsset={issuedAsset} poolForm={poolForm} onPoolFormChange={setPoolForm} updatePoolPair={updatePoolPair} assets={assets} poolValidation={poolValidation} creationBaseDetails={creationBaseDetails} creationQuoteDetails={creationQuoteDetails} creationBaseAmount={creationBaseAmount} creationQuoteAmount={creationQuoteAmount} initialLiquiditySummary={initialLiquiditySummary} deployment={deployment} bootstrapSummary={bootstrapSummary} currentPoolEligibility={currentPoolEligibility} controlledCreationAssets={controlledCreationAssets} poolFormBlocker={poolFormBlocker} poolAssetIssuance={poolAssetIssuance} poolCreation={poolCreation} poolOpeningPending={poolOpeningPending} createPool={() => void createPool()} retryPoolOpening={() => void retryPoolOpening()} refundPoolCreation={() => void refundPoolCreation()} />
        : <ActivityPage address={address} connecting={connecting} connect={() => void connect()} onRefresh={() => runWithToast(() => Promise.all([refreshWalletActivity(), refreshPoints()]))} points={points} leaderboard={leaderboard} onViewLeaderboard={() => navigate('leaderboard')} activity={activity} hasMore={Boolean(activityCursor)} onLoadMore={() => runWithToast(loadMoreActivity)} tokenDetails={tokenDetails} pools={pools} />}
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
