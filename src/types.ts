import type { PriceTimeframe } from './format'

export type Page = 'swap' | 'launches' | 'launch' | 'launch-create' | 'pools' | 'pool' | 'create' | 'faucet' | 'leaderboard' | 'activity'

export interface DeploymentInfo {
  ok: boolean
  network: 'mutinynet' | 'mainnet'
  platformTreasuryAddress: string
  poolCreationFeeSats: string
  ammContractGeneration: 'amm-v2'
  maxSwapBatch: number
  launches?: { catalog: boolean; protocol: 'curve-v1'; tradingEnabled: boolean; reason: string }
}

export interface NetworkInfo {
  network: string
  displayName: string
  isTestnet: boolean
  arkServerUrl: string
}

export interface AssetInfo {
  assetId: string
  amount: number
  displayAmount: number
  metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string }
  controlAssetId?: string
}

export interface AssetRisk { assetId: string; controlled: boolean; controlAssetId?: string; supply?: string; metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string } }
export interface CatalogAsset { assetId: string; controlAssetId?: string; supply?: string; metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string } }
export interface PageResult<T> { items: T[]; total: number; nextCursor?: string }
export interface CursorPage<T> { items: T[]; nextCursor?: string }

export interface PricePoint { recordedAt: number; baseReserve: string; quoteReserve: string; txid: string }
export interface PriceHistory { poolId: string; timeframe: PriceTimeframe; baseAssetId: string; quoteAssetId: string; priceUnit: 'raw-reserves'; points: PricePoint[] }

export interface BalanceInfo { available: number; total: number }

export interface Pool {
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

export interface Quote {
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

export interface SwapRequest {
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

export interface LiquidityRequest extends Omit<SwapRequest, 'fundingSats'> {
  kind: 'deposit' | 'withdraw'
  baseAmount: string
  quoteAmount: string
  lpAmount: string
}

export type ActivityEvent = (SwapRequest & { activityType: 'swap' }) | (LiquidityRequest & { activityType: 'deposit' | 'withdraw' })

export interface LaunchActivityRequest { id: string; launchId: string; venue: 'curve' | 'pool'; side: 'buy' | 'sell'; inputAmount: string; rewardPoints: string; fundingTxid?: string; settlementTxid?: string; status: 'pending-funding' | 'funded' | 'settling' | 'settled' | 'refunded' | 'failed'; createdAt: number; activityType: 'launch-trade' }

export type WalletActivityEvent = ActivityEvent | LaunchActivityRequest

export interface PointsSummary { identityKey: string; total: string; poolPoints: string; swapPoints: string; launchPoints: string; launchTradePoints: string; referralPoints: string; referralCode: string; referredUsers: number; rank?: number; participants: number; portableToMainnet: true }

export interface LeaderboardEntry { rank: number; identityKey: string; address: string; total: string; poolPoints: string; swapPoints: string; launchPoints: string; launchTradePoints: string; referralPoints: string }
export interface LeaderboardPage { items: LeaderboardEntry[]; total: number; nextOffset?: number }

export interface IssueAssetResult { arkTxId: string; assetId: string }
export interface IssueAssetInput {
  amount: number
  controlAssetId?: string
  metadata?: { name?: string; ticker?: string; decimals?: number; icon?: string }
}

export interface PoolAssetIssuance {
  key: string
  control: IssueAssetResult
  lp?: IssueAssetResult
  ledger?: IssueAssetResult
}

export interface PoolCreation {
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

export interface PoolEligibility { eligible: boolean; assetId?: string; launchId?: string; phase?: string; reason?: string }

export interface TokenDetails { ticker: string; decimals: number; name: string; controlled: string | undefined }
