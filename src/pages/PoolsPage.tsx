import { TokenMark } from '../components'
import { displayAmount, short } from '../format'
import type { AssetInfo, Pool } from '../types'

export function PoolsPage({ query, updateQuery, pools, total, assets, onView, onTrade, hasMore, onRefresh, onLoadMore }: {
  query: string; updateQuery: (value: string) => void; pools: Pool[]; total: number; assets: AssetInfo[]; onView: (pool: Pool) => void; onTrade: (pool: Pool) => void; hasMore: boolean; onRefresh: () => void; onLoadMore: () => void
}) {
  return <section className="view-page">
    <div className="view-heading"><div><span className="eyebrow"><i /> LIVE LIQUIDITY</span><h1>Pools</h1><p>Current covenant reserves and AMM identifiers.</p></div><button className="secondary" onClick={onRefresh}>Refresh</button></div>
    <div className="pool-search-row">
      <label className="search-field"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search by pool, ticker or asset ID" aria-label="Search pools" />{query && <button type="button" onClick={() => updateQuery('')} aria-label="Clear pool search">×</button>}</label>
      <span>{pools.length} of {total} pools</span>
    </div>
    {pools.length === 0 ? <div className="empty-state search-empty">No pools match “{query.trim()}”.</div> : <div className="pool-grid">{pools.map((item) => {
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
        <div className="pool-card-actions"><button className="secondary" onClick={() => onView(item)}>View details</button><button className="secondary" onClick={() => onTrade(item)}>Trade this pool</button></div>
      </article>
    })}</div>}
    {hasMore && <button className="secondary load-more" onClick={onLoadMore}>Load more pools</button>}
  </section>
}
