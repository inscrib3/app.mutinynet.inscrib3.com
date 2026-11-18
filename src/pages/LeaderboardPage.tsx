import { Spinner } from '../components'
import { comma, short } from '../format'
import type { LeaderboardEntry } from '../types'

export function LeaderboardPage({ entries, total, loading, error, hasMore, query, updateQuery, loadMore, identityKey }: {
  entries: LeaderboardEntry[]; total: number; loading: boolean; error: string; hasMore: boolean; query: string; updateQuery: (value: string) => void; loadMore: () => void; identityKey?: string
}) {
  return <section className="view-page leaderboard-page">
    <div className="view-heading"><div><span className="eyebrow"><i /> GLOBAL POINTS</span><h1>Leaderboard</h1><p>Every ranked wallet across pools, swaps, launches and referrals.</p></div><span className="leaderboard-count">{total} {query.trim() ? 'matches' : 'players'}</span></div>
    <div className="leaderboard-toolbar">
      <label className="search-field"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => updateQuery(event.target.value)} placeholder="Search wallet address or identity key" aria-label="Search leaderboard wallets" autoComplete="off" />{query && <button type="button" onClick={() => updateQuery('')} aria-label="Clear wallet search">×</button>}</label>
      <span>Ranks remain global in search results</span>
    </div>
    <div className="global-leaderboard">
      <div className="global-leaderboard-head"><span>Rank</span><span>Wallet</span><span>Pool</span><span>Swap</span><span>Launch</span><span>Referral</span><span>Total</span></div>
      {entries.map((item) => <div className={`global-leaderboard-row${item.identityKey === identityKey ? ' current' : ''}`} key={item.identityKey}>
        <b className="leaderboard-rank">#{item.rank}</b><code title={item.address}>{short(item.address, 8)}</code>
        <span data-label="Pool">{comma(item.poolPoints)}</span><span data-label="Swap">{comma(item.swapPoints)}</span>
        <span data-label="Launch">{comma((BigInt(item.launchPoints) + BigInt(item.launchTradePoints)).toString())}</span><span data-label="Referral">{comma(item.referralPoints)}</span>
        <b className="leaderboard-total">{comma(item.total)} PTS</b>
      </div>)}
      {!loading && !error && entries.length === 0 && <div className="empty-state">{query.trim() ? `No ranked wallet matches “${query.trim()}”.` : 'No scores yet.'}</div>}
      {loading && entries.length === 0 && <div className="empty-state"><Spinner /> Loading leaderboard…</div>}
      {error && <div className="notice error"><b>Leaderboard unavailable</b><span>{error}</span></div>}
    </div>
    {hasMore && <button className="secondary load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading…' : 'Load more players'}</button>}
  </section>
}
