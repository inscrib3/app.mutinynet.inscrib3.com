import { TxLink } from '../components'
import { comma, displayAmount, short } from '../format'
import type { LeaderboardEntry, PointsSummary, Pool, TokenDetails, WalletActivityEvent } from '../types'

export function ActivityPage({ address, connecting, connect, onRefresh, points, leaderboard, onViewLeaderboard, activity, hasMore, onLoadMore, tokenDetails, pools }: {
  address: string; connecting: boolean; connect: () => void; onRefresh: () => void; points: PointsSummary | null; leaderboard: LeaderboardEntry[]; onViewLeaderboard: () => void; activity: WalletActivityEvent[]; hasMore: boolean; onLoadMore: () => void; tokenDetails: (assetId: string) => TokenDetails; pools: Pool[]
}) {
  return <section className="view-page">
    <div className="view-heading"><div><span className="eyebrow"><i /> WALLET HISTORY</span><h1>My activity</h1><p>Your portable score and wallet-signed pool and launch activity.</p></div>{address && <button className="secondary" onClick={onRefresh}>Refresh</button>}</div>
    {!address ? <div className="empty-state activity-connect-state"><div className="activity-connect-icon">◇</div><h2>Connect your wallet</h2><p>Connect Inscrib3 Wallet to view your score and activity across pools and launches.</p><button className="secondary" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}</button></div> : <>
    <div className="points-dashboard">
      <section className="points-score-card"><span>YOUR SCORE</span><div><b>{points ? comma(points.total) : '—'}</b><em>PTS</em></div><p>{points?.rank ? `Rank #${points.rank} of ${points.participants}` : 'Complete an eligible action to enter the ranking'}</p><small>Mutinynet points will migrate to Mainnet with the same wallet identity.</small><a href="https://docs.inscrib3.com/app/points" target="_blank" rel="noreferrer">Migration details ↗</a></section>
      <section className="points-breakdown"><div><span>POOL CREATION</span><b>{points ? comma(points.poolPoints) : '—'}</b><small>10 points per opened pool</small></div><div><span>SWAPS</span><b>{points ? comma(points.swapPoints) : '—'}</b><small>Minimum 1 · protocol fee sats</small></div><div><span>LAUNCH CREATION</span><b>{points ? comma(points.launchPoints) : '—'}</b><small>10 points per opened launch</small></div><div><span>LAUNCH TRADES</span><b>{points ? comma(points.launchTradePoints) : '—'}</b><small>Minimum 1 · protocol fee sats</small></div></section>
      <section className="referral-card"><div><span>REFERRALS</span><b>{points ? comma(points.referralPoints) : '—'} PTS</b><small>{points?.referredUsers ?? 0} referred wallets · +1 per opened pool, launch, or settled trade</small></div>{points && <><code>{`${window.location.origin}/?ref=${points.referralCode}`}</code><div><button onClick={() => window.open(`https://x.com/intent/post?text=${encodeURIComponent(`Try Inscrib3 App on Mutinynet and earn portable points: ${window.location.origin}/?ref=${points.referralCode}`)}`, '_blank', 'noopener,noreferrer')}>Share on X</button><button onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}/?ref=${points.referralCode}`); window.open('https://discord.com/channels/@me', '_blank', 'noopener,noreferrer') }}>Copy for Discord</button></div></>}</section>
      <section className="points-leaderboard"><div className="points-board-head"><span>TOP PLAYERS</span><button onClick={onViewLeaderboard}>View all →</button></div>{leaderboard.length ? leaderboard.map((item) => <div className={item.identityKey === points?.identityKey ? 'current' : ''} key={item.identityKey}><i>#{item.rank}</i><code>{short(item.address, 5)}</code><b>{comma(item.total)} PTS</b></div>) : <p>No scores yet.</p>}</section>
    </div>
    <div className="activity-panel">
      <div className="activity-head"><span>Type</span><span>Amount</span><span>Status</span><span>Transaction</span></div>
      {activity.length === 0 ? <div className="empty-state">No activity for this wallet yet.</div> : activity.map((item) => {
        if (item.activityType === 'launch-trade') return <div className="activity-row" key={`launch-trade-${item.id}`}>
          <div><span className="activity-icon launch-trade">↗</span><div><b>{item.side === 'buy' ? 'Launch buy' : 'Launch sell'}</b><small>{item.launchId} · {item.venue} · {new Date(item.createdAt).toLocaleString()} · +{comma(item.rewardPoints)} PTS</small></div></div>
          <code>{comma(item.inputAmount)} {item.side === 'buy' ? 'sats' : 'raw units'}</code><span className={`status-pill ${item.status}`}>{item.status.replace('-', ' ')}</span>
          <TxLink txid={item.settlementTxid || item.fundingTxid} edge={7} />
        </div>
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
          <TxLink txid={item.settlementTxid || item.fundingTxid} edge={7} />
        </div>
      })}
    </div></>}
    {hasMore && <button className="secondary load-more" onClick={onLoadMore}>Load more activity</button>}
  </section>
}
