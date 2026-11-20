import { PoolPriceChart, RequestNotice, Spinner, TokenMark } from '../components'
import { comma, displayAmount, short } from '../format'
import { numericText } from '../form-validation'
import type { Launch } from '../launches'
import { minimumSwapOutput, type LiquidityPreview } from '../math'
import type { AssetInfo, AssetRisk, DeploymentInfo, LiquidityRequest, Pool, Quote, SwapRequest, TokenDetails } from '../types'

export function SwapPage(props: {
  mode: 'swap' | 'deposit' | 'withdraw'
  pool: Pool | undefined
  baseTicker: string
  quoteTicker: string
  baseDecimals: number
  quoteDecimals: number
  buyDecimals: number
  lpDecimals: number
  baseAsset: AssetInfo | undefined
  lpAsset: AssetInfo | undefined
  btcBalance: number
  sellTicker: string
  buyTicker: string
  sellAssetId: string
  buyAssetId: string
  tokenDetails: (assetId: string) => TokenDetails
  amount: string
  receiveAmount: string
  quoteMode: 'input' | 'output'
  maxSpend: string | null
  quote: Quote | null
  balance: string
  slippage: number
  showSettings: boolean
  swapLocked: boolean
  liquidityLocked: boolean
  busy: boolean
  connecting: boolean
  walletReady: boolean
  walletActionLabel: string | null
  swapBlocker: string | null
  liquidityBlocker: string | null
  error: string
  request: SwapRequest | null
  liquidityRequest: LiquidityRequest | null
  liquidityAmount: string
  liquidityPreview: LiquidityPreview | null
  controlledPoolAssets: AssetRisk[]
  linkCopied: boolean
  onFirePool: Pool | undefined
  onFireBase: TokenDetails | undefined
  onFireQuote: TokenDetails | undefined
  onFireLaunch: Launch | null
  deployment: DeploymentInfo | null
  onSwapModeChange: (mode: 'swap' | 'deposit' | 'withdraw') => void
  onToggleSettings: () => void
  onSlippageChange: (value: number) => void
  onMax: () => void
  onAmountChange: (value: string) => void
  onReceiveChange: (value: string) => void
  onOpenPairModal: () => void
  onReverse: () => void
  onSwap: () => void
  onSubmitLiquidity: () => void
  onLiquidityChange: (value: string) => void
  onDismissRequest: () => void
  onDismissLiquidity: () => void
  onRetrySwap: () => void
  onRetryLiquidity: () => void
  onCopyLink: () => void
  onViewPool: (pool: Pool) => void
  onSwitchPool: (pool: Pool) => void
  onViewLaunch: (id: string) => void
}) {
  const { mode, pool, baseTicker, quoteTicker, baseDecimals, quoteDecimals, buyDecimals, lpDecimals, baseAsset, lpAsset, btcBalance, sellTicker, buyTicker, sellAssetId, buyAssetId, tokenDetails, amount, receiveAmount, quoteMode, maxSpend, quote, balance, slippage, showSettings, swapLocked, liquidityLocked, busy, connecting, walletReady, walletActionLabel, swapBlocker, liquidityBlocker, error, request, liquidityRequest, liquidityAmount, liquidityPreview, controlledPoolAssets, linkCopied, onFirePool, onFireBase, onFireQuote, onFireLaunch, deployment, onSwapModeChange, onToggleSettings, onSlippageChange, onMax, onAmountChange, onReceiveChange, onOpenPairModal, onReverse, onSwap, onSubmitLiquidity, onLiquidityChange, onDismissRequest, onDismissLiquidity, onRetrySwap, onRetryLiquidity, onCopyLink, onViewPool, onSwitchPool, onViewLaunch } = props

  return <>
    <section className="intro">
      <span className="eyebrow"><i /> PROGRAMMABLE BITCOIN / AMM</span>
      <h1>Native liquidity.<br /><em>Built on Bitcoin.</em></h1>
      <p>Swap BTC and Arkade assets through covenant-enforced liquidity. No bridges, no wrapped Bitcoin, no custody.</p>
    </section>

    {(onFirePool && onFireBase && onFireQuote || onFireLaunch) && <div className="fire-route-grid">
      {onFirePool && onFireBase && onFireQuote && <section className="fire-route-banner">
        <div className="fire-route-icon" aria-hidden="true">🔥</div>
        <div className="marks"><TokenMark label={onFireBase.ticker} /><TokenMark label={onFireQuote.ticker} warm /></div>
        <div className="fire-route-copy"><span>ON FIRE · TRENDING POOL</span><h2>{onFireBase.ticker} / {onFireQuote.ticker}</h2><p>{onFirePool.activity24h ?? 0} settled actions in the last 24 hours · {onFirePool.feeBps / 100}% total fee</p></div>
        <button className="secondary" disabled={pool?.id === onFirePool.id && mode === 'swap'} onClick={() => onSwitchPool(onFirePool)}>{pool?.id === onFirePool.id && mode === 'swap' ? 'Active pair' : 'Switch pool'}</button>
      </section>}
      {onFireLaunch && <section className="fire-route-banner launch-fire-route">
        <div className="fire-route-icon" aria-hidden="true">🔥</div>
        <div className="marks"><TokenMark label={onFireLaunch.ticker} warm /></div>
        <div className="fire-route-copy"><span>ON FIRE · TRENDING LAUNCH</span><h2>{onFireLaunch.name} · ${onFireLaunch.ticker}</h2><p>{onFireLaunch.trades24h} settled trades · {displayAmount(onFireLaunch.volumeBtc24h, 8, 8)} BTC volume in 24h</p></div>
        <button className="secondary" onClick={() => onViewLaunch(onFireLaunch.id)}>View launch</button>
      </section>}
    </div>}

    {pool?.available && <PoolPriceChart key={`swap-${pool.id}`} pool={pool} baseTicker={baseTicker} quoteTicker={quoteTicker} baseDecimals={baseDecimals} quoteDecimals={quoteDecimals} />}

    <section className="workspace" id="swap">
      <div className="swap-card">
        <div className="card-head"><div><h2>{mode === 'swap' ? 'Swap assets' : mode === 'deposit' ? 'Add liquidity' : 'Remove liquidity'}</h2><span>Covenant-enforced constant-product pool</span></div>{mode === 'swap' && <button className="icon-button" onClick={onToggleSettings} aria-label="Swap settings">⚙</button>}</div>
        <div className="mode-tabs">{(['swap', 'deposit', 'withdraw'] as const).map((item) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => onSwapModeChange(item)}>{item === 'swap' ? 'Swap' : item === 'deposit' ? 'Add' : 'Remove'}</button>)}</div>
        {mode === 'swap' && <>
          {showSettings && <div className="settings"><span>Max slippage</span><div>{[10, 50, 100].map((v) => <button className={slippage === v ? 'selected' : ''} key={v} onClick={() => onSlippageChange(v)}>{v / 100}%</button>)}</div></div>}
          <div className="asset-box">
          <div className="asset-top"><label>You pay</label><button className="balance" onClick={onMax} disabled={swapLocked}>Balance: {balance} <b>MAX</b></button></div>
          <div className="asset-main">
            <input value={amount} onChange={(event) => onAmountChange(numericText(event.target.value, true))} placeholder="0" inputMode="decimal" aria-label="Amount to sell" disabled={swapLocked} />
            <button className="token-select" onClick={onOpenPairModal}><TokenMark label={sellTicker} /><span>{sellTicker}</span><small>⌄</small></button>
          </div>
          <div className="asset-foot"><span>{sellAssetId ? tokenDetails(sellAssetId).name : 'Select a pool'}</span><span>{maxSpend ? `Max spent: ${maxSpend}` : 'Arkade asset'}</span></div>
          </div>

          <div className="switch-row"><span /><button onClick={onReverse} disabled={swapLocked} aria-label="Reverse swap direction">↓</button><span /></div>

          <div className="asset-box receive">
          <div className="asset-top"><label>You receive</label><span>{quoteMode === 'output' ? 'Exact output' : 'Estimated'}</span></div>
          <div className="asset-main"><input value={receiveAmount} onChange={(event) => onReceiveChange(numericText(event.target.value, true))} placeholder="0" inputMode="decimal" aria-label="Amount to receive" disabled={swapLocked} /><button className="token-select" onClick={onOpenPairModal}><TokenMark label={buyTicker} warm /><span>{buyTicker}</span><small>⌄</small></button></div>
          <div className="asset-foot"><span>{buyAssetId ? tokenDetails(buyAssetId).name : '—'}</span><span>{quoteMode === 'output' ? `Quoted output: ${quote ? displayAmount(quote.outputAmount, buyDecimals) : '—'}` : `Minimum: ${quote ? displayAmount(minimumSwapOutput(BigInt(quote.outputAmount), slippage), buyDecimals) : '—'}`}</span></div>
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

          <button className="primary" onClick={() => void onSwap()} disabled={busy || connecting || (walletReady && swapBlocker !== null)}>{busy && <Spinner />}{walletActionLabel ?? swapBlocker ?? 'Review & swap'}</button>
        </>}

        {mode !== 'swap' && <>
          <div className="asset-box">
            <div className="asset-top"><label>{mode === 'deposit' ? 'Base amount to add' : 'LP tokens to burn'}</label><span>Raw-unit exact</span></div>
            <div className="asset-main">
              <input value={liquidityAmount} onChange={(event) => onLiquidityChange(numericText(event.target.value, true))} placeholder="0" inputMode="decimal" aria-label="Liquidity amount" disabled={liquidityLocked} />
              <div className="token-select static"><TokenMark label={mode === 'deposit' ? baseTicker : 'LP'} /><span>{mode === 'deposit' ? baseTicker : 'LP'}</span></div>
            </div>
            <div className="asset-foot"><span>{mode === 'deposit' ? `Balance: ${pool?.baseAssetId === 'btc' ? displayAmount(BigInt(btcBalance), 8, 8) : baseAsset ? displayAmount(BigInt(baseAsset.amount), baseDecimals) : '0'}` : `Balance: ${lpAsset ? displayAmount(BigInt(lpAsset.amount), lpDecimals) : '0'}`}</span><span>{mode === 'deposit' ? 'Pool ratio is fixed at funding' : 'Pro-rata redemption'}</span></div>
          </div>
          <div className="liquidity-preview">
            <div><span>{mode === 'deposit' ? 'Required quote' : 'Base received'}</span><b>{liquidityPreview ? displayAmount(mode === 'deposit' ? liquidityPreview.quote : liquidityPreview.base, mode === 'deposit' ? quoteDecimals : baseDecimals) : '—'} {mode === 'deposit' ? quoteTicker : baseTicker}</b></div>
            <div><span>{mode === 'deposit' ? 'LP received' : 'Quote received'}</span><b>{liquidityPreview ? displayAmount(mode === 'deposit' ? liquidityPreview.lp : liquidityPreview.quote, mode === 'deposit' ? lpDecimals : quoteDecimals) : '—'} {mode === 'deposit' ? 'LP' : quoteTicker}</b></div>
          </div>
          <button className="primary" onClick={() => void onSubmitLiquidity()} disabled={busy || connecting || (walletReady && liquidityBlocker !== null)}>{busy && <Spinner />}{walletActionLabel ?? liquidityBlocker ?? (mode === 'deposit' ? 'Fund liquidity deposit' : 'Fund LP withdrawal')}</button>
        </>}
        {error && <div className="notice error"><b>Transaction unavailable</b><span>{error}</span></div>}
        {mode === 'swap' && request && <RequestNotice noun="Swap" request={request} busy={busy} onDismiss={onDismissRequest} onRetryRegistration={onRetrySwap} />}
        {mode !== 'swap' && liquidityRequest && <RequestNotice noun="Liquidity request" request={liquidityRequest} busy={busy} onDismiss={onDismissLiquidity} onRetryRegistration={onRetryLiquidity} />}
        {controlledPoolAssets.length > 0 && <div className="notice asset-risk"><b>Controlled asset supply</b><span>{controlledPoolAssets.map((info) => `${info.assetId === pool?.baseAssetId ? baseTicker : quoteTicker}: ${short(info.controlAssetId ?? '', 8)}`).join(' · ')}. Holders of these control assets may authorize additional issuance, which can affect pool value.</span></div>}
        <p className="security"><span>◇</span> Your wallet funds a covenant-bound request. The coordinator cannot redirect your payout.</p>
      </div>

      <aside>
        <div className="panel pool-panel" id="pools">
          <div className="panel-head"><span>AUTOMATIC ROUTE</span><div className="panel-actions"><button className="share-link" onClick={() => void onCopyLink()}>{linkCopied ? 'Copied' : 'Copy link'}</button><button className="change-pair" onClick={onOpenPairModal}>Change pair</button></div></div>
           <div className="pair"><div className="marks"><TokenMark label={sellTicker} /><TokenMark label={buyTicker} warm /></div><div><div className="pair-title-row"><h3>{pool?.name ?? 'No pool configured'}</h3>{pool?.lifecycle === 'withdraw-only' && <span className="fire-badge">Legacy · withdraw only</span>}{pool?.onFire && <span className="fire-badge" title={`${pool.activity24h ?? 0} settled operations in the last 24 hours`}>🔥 On fire</span>}</div><p><i className={pool?.available ? 'online' : ''} /> {pool?.available ? 'Pool readable' : 'Unavailable'} · {pool?.feeBps ?? 0} bps{pool?.onFire ? ` · ${pool.activity24h} actions / 24h` : ''}</p></div></div>
          <div className="pool-stats"><div><span>Base reserve</span><b>{pool?.baseReserve ? comma(pool.baseReserve) : '—'}</b></div><div><span>Quote reserve</span><b>{pool?.quoteReserve ? comma(pool.quoteReserve) : '—'}</b></div><div><span>LP supply</span><b>{pool?.lpSupply ? comma(pool.lpSupply) : '—'}</b></div></div>
          <div className="pool-foot"><span>{pool?.protocolFeeBps ? 'Covenant fee vault active' : 'LP fees only'}</span>{pool ? <button className="pool-detail-link" onClick={() => onViewPool(pool)}>Pool details →</button> : <span>Up to {deployment?.maxSwapBatch ?? 3} swaps / sweep</span>}</div>
        </div>

        <div className="panel how-panel">
          <span className="panel-label">HOW IT WORKS</span>
          <ol><li><b>1</b><div><strong>Fund a standing swap</strong><span>Your assets enter a payout-bound contract.</span></div></li><li><b>2</b><div><strong>Requests are batched</strong><span>Up to {deployment?.maxSwapBatch ?? 3} swaps update the pool atomically.</span></div></li><li><b>3</b><div><strong>Receive automatically</strong><span>The bought asset lands directly in your wallet.</span></div></li></ol>
          <a className="panel-doc-link" href="https://docs.inscrib3.com/app/swaps" target="_blank" rel="noreferrer">Read the swap guide ↗</a>
        </div>
      </aside>
    </section>
  </>
}
