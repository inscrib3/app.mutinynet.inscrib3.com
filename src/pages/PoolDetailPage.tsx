import { PoolPriceChart, TokenMark } from '../components'
import { displayAmount, ratio, short } from '../format'
import type { ActivityEvent, Pool, TokenDetails } from '../types'

export function PoolDetailPage({ pool, onBack, onTrade, tokenDetails, activity, hasMore, onRefresh, onLoadMore }: {
  pool: Pool | undefined; onBack: () => void; onTrade: (pool: Pool) => void; tokenDetails: (assetId: string) => TokenDetails; activity: ActivityEvent[]; hasMore: boolean; onRefresh: () => void; onLoadMore: () => void
}) {
  if (!pool) return <section className="view-page"><div className="empty-state">Pool not found.</div></section>
  const base = tokenDetails(pool.baseAssetId)
  const quoteToken = tokenDetails(pool.quoteAssetId)
  const baseReserve = BigInt(pool.baseReserve ?? '0')
  const quoteReserve = BigInt(pool.quoteReserve ?? '0')
  const quotePerBase = ratio(quoteReserve * 10n ** BigInt(base.decimals), baseReserve * 10n ** BigInt(quoteToken.decimals))
  const inverseNumerator = baseReserve * 10n ** BigInt(quoteToken.decimals)
  const inverseInSats = pool.baseAssetId === 'btc' && inverseNumerator < quoteReserve
  const basePerQuote = ratio(inverseNumerator, quoteReserve * (inverseInSats ? 1n : 10n ** BigInt(base.decimals)))

  return <section className="view-page pool-detail-page">
    <div className="pool-detail-hero">
      <button className="back-link" onClick={onBack}>← All pools</button>
      <div className="pool-detail-title"><div className="marks"><TokenMark label={base.ticker} /><TokenMark label={quoteToken.ticker} warm /></div><div><span className="eyebrow"><i /> POOL DETAIL</span><div className="pool-title-row"><h1>{pool.name}</h1>{pool.lifecycle === 'withdraw-only' && <span className="fire-badge">Legacy · withdraw only</span>}{pool.onFire && <span className="fire-badge" title={`${pool.activity24h ?? 0} settled operations in the last 24 hours`}>🔥 On fire</span>}</div><p><span className={pool.available ? 'live-dot' : 'offline-dot'} /> {pool.available ? pool.lifecycle : 'Pool unavailable'} · {pool.contractGeneration} · {pool.feeBps} bps total fee</p></div></div>
      <button className="primary compact" onClick={() => onTrade(pool)}>{pool.swapEnabled ? 'Trade this pool' : 'Manage withdrawal'}</button>
    </div>

    <div className="metric-grid">
      <div><span>{quoteToken.ticker} per {base.ticker}</span><b>{quotePerBase}</b><small>Spot price from current reserves</small></div>
      <div><span>{inverseInSats ? 'sats' : base.ticker} per {quoteToken.ticker}</span><b>{basePerQuote}</b><small>{inverseInSats ? 'Marginal spot · settlement uses whole sats' : 'Inverse spot price'}</small></div>
      <div><span>24h activity</span><b>{pool.activity24h ?? 0}</b><small>{pool.swaps24h ?? 0} swaps · {pool.liquidityEvents24h ?? 0} liquidity</small></div>
      <div><span>LP supply</span><b>{displayAmount(pool.lpSupply ?? '0', base.decimals, 8)}</b><small>{pool.lpAssetId ? short(pool.lpAssetId, 8) : '—'}</small></div>
    </div>

    <PoolPriceChart key={`detail-${pool.id}`} pool={pool} baseTicker={base.ticker} quoteTicker={quoteToken.ticker} baseDecimals={base.decimals} quoteDecimals={quoteToken.decimals} />

    <div className="detail-columns">
      {([{ assetId: pool.baseAssetId, details: base, info: pool.baseAssetInfo, reserve: pool.baseReserve, warm: false }, { assetId: pool.quoteAssetId, details: quoteToken, info: pool.quoteAssetInfo, reserve: pool.quoteReserve, warm: true }] as const).map((token) => <article className="token-detail-card" key={token.assetId}>
        <div className="token-detail-head"><TokenMark label={token.details.ticker} warm={token.warm} /><div><h2>{token.details.name}</h2><span>{token.details.ticker}</span></div></div>
        <dl><div><dt>Pool reserve</dt><dd>{displayAmount(token.reserve ?? '0', token.details.decimals, 8)} {token.details.ticker}</dd></div>{(token.assetId === 'btc' || token.info?.supply) && <div><dt>Total supply</dt><dd>{token.assetId === 'btc' ? '21,000,000 BTC max' : displayAmount(token.info!.supply!, token.details.decimals, 8)}</dd></div>}<div><dt>Issuance</dt><dd>{token.info?.controlled ? 'Controlled / reissuable' : token.assetId === 'btc' ? 'Native Bitcoin' : 'No control asset'}</dd></div><div><dt>Asset ID</dt><dd><code title={token.assetId}>{short(token.assetId, 10)}</code></dd></div></dl>
      </article>)}
    </div>

    <div className="activity-section-heading"><div><span className="eyebrow"><i /> LIVE FEED</span><h2>Pool activity</h2><p>Swap, liquidity additions and removals for this pool.</p></div><button className="secondary" onClick={onRefresh}>Refresh</button></div>
    <div className="activity-panel">
      <div className="activity-head"><span>Type</span><span>Amount</span><span>Status</span><span>Transaction</span></div>
      {activity.length === 0 ? <div className="empty-state">No activity for this pool yet.</div> : activity.map((item) => {
        const isSwap = item.activityType === 'swap'
        const sold = isSwap && item.sellAssetId ? tokenDetails(item.sellAssetId) : undefined
        const amountText = isSwap ? `${displayAmount(item.sellAmount ?? '0', sold?.decimals ?? 0)} ${sold?.ticker ?? 'ASSET'}` : item.activityType === 'deposit' ? `${displayAmount(item.baseAmount, base.decimals)} ${base.ticker} + ${displayAmount(item.quoteAmount, quoteToken.decimals)} ${quoteToken.ticker}` : `${displayAmount(item.lpAmount, base.decimals)} LP`
        return <div className="activity-row" key={`${item.activityType}-${item.id}`}><div><span className={`activity-icon ${item.activityType}`}>{isSwap ? '↔' : item.activityType === 'deposit' ? '+' : '−'}</span><div><b>{isSwap ? 'Swap' : item.activityType === 'deposit' ? 'Add liquidity' : 'Remove liquidity'}</b><small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : short(item.id)}</small></div></div><code>{amountText}</code><span className={`status-pill ${item.status}`}>{item.status.replace('-', ' ')}</span><code title={item.settlementTxid ?? item.fundingTxid ?? ''}>{item.settlementTxid || item.fundingTxid ? short(item.settlementTxid ?? item.fundingTxid!, 7) : '—'}</code></div>
      })}
    </div>
    {hasMore && <button className="secondary load-more" onClick={onLoadMore}>Load more activity</button>}
  </section>
}
