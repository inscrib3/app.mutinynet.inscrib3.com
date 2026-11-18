import { FieldError, Spinner } from '../components'
import { comma, poolAssetTickers, short } from '../format'
import { MIN_PROTOCOL_FEE_BPS, type AssetFormInput, type FormErrors, type PoolFormInput, type ValidAsset, type ValidPool } from '../form-validation'
import type { AssetInfo, DeploymentInfo, IssueAssetResult, PoolAssetIssuance, PoolCreation, PoolEligibility, TokenDetails } from '../types'

type PoolForm = PoolFormInput & { id: string; name: string }

export function CreatePage(props: {
  createMode: 'asset' | 'pool'
  onSelectMode: (mode: 'asset' | 'pool') => void
  busy: boolean
  connecting: boolean
  walletReady: boolean
  walletActionLabel: string | null
  error: string
  assetForm: AssetFormInput
  onAssetFormChange: (form: AssetFormInput) => void
  assetValidation: { errors: FormErrors<AssetFormInput>; valid?: ValidAsset }
  assetFormBlocker: string | null
  createAsset: () => void
  creationStep: string
  issuedAsset: IssueAssetResult | null
  poolForm: PoolForm
  onPoolFormChange: (form: PoolForm) => void
  updatePoolPair: (base: string, quote: string) => void
  assets: AssetInfo[]
  poolValidation: { errors: FormErrors<PoolFormInput>; valid?: ValidPool }
  creationBaseDetails?: TokenDetails
  creationQuoteDetails?: TokenDetails
  creationBaseAmount: bigint | null
  creationQuoteAmount: bigint | null
  initialLiquiditySummary: string
  deployment: DeploymentInfo | null
  bootstrapSummary: { bootstrapSats: bigint; carrierSats: bigint; total: string } | null
  currentPoolEligibility: PoolEligibility | null
  controlledCreationAssets: AssetInfo[]
  poolFormBlocker: string | null
  poolAssetIssuance: PoolAssetIssuance | null
  poolCreation: PoolCreation | null
  poolOpeningPending: boolean
  createPool: () => void
  retryPoolOpening: () => void
}) {
  const { createMode, onSelectMode, busy, connecting, walletReady, walletActionLabel, error, assetForm, onAssetFormChange, assetValidation, assetFormBlocker, createAsset, creationStep, issuedAsset, poolForm, onPoolFormChange, updatePoolPair, assets, poolValidation, creationBaseDetails, creationQuoteDetails, creationBaseAmount, creationQuoteAmount, initialLiquiditySummary, deployment, bootstrapSummary, currentPoolEligibility, controlledCreationAssets, poolFormBlocker, poolAssetIssuance, poolCreation, poolOpeningPending, createPool, retryPoolOpening } = props
  const poolTickers = poolForm.name ? poolAssetTickers(poolForm.name) : null

  return <section className="view-page create-page">
    <div className="view-heading"><div><span className="eyebrow"><i /> PERMISSIONLESS ASSETS</span><h1>Create</h1><p>Issue an Arkade asset or open a covenant-enforced liquidity pool from your own wallet.</p></div></div>
    <div className="create-tabs"><button className={createMode === 'asset' ? 'active' : ''} onClick={() => onSelectMode('asset')}>Create asset</button><button className={createMode === 'pool' ? 'active' : ''} onClick={() => onSelectMode('pool')}>Create pool</button></div>
    {createMode === 'asset' ? <div className="create-layout">
      <article className="create-card">
        <div className="card-head"><div><h2>Issue a new asset</h2><span>Non-custodial issuance through Inscrib3 Wallet</span></div></div>
        <div className="form-grid">
          <label><span>Name</span><input value={assetForm.name} onChange={(e) => onAssetFormChange({ ...assetForm, name: e.target.value })} placeholder="My Arkade Asset" /><FieldError message={assetValidation.errors.name} value={assetForm.name} /></label>
          <label><span>Ticker</span><input value={assetForm.ticker} onChange={(e) => onAssetFormChange({ ...assetForm, ticker: e.target.value.toUpperCase() })} placeholder="ASSET" maxLength={16} /><FieldError message={assetValidation.errors.ticker} value={assetForm.ticker} /></label>
          <label><span>Initial supply</span><input value={assetForm.supply} onChange={(e) => onAssetFormChange({ ...assetForm, supply: e.target.value })} placeholder="1000000" inputMode="decimal" /><FieldError message={assetValidation.errors.supply} value={assetForm.supply} /></label>
          <label><span>Decimals</span><input value={assetForm.decimals} onChange={(e) => onAssetFormChange({ ...assetForm, decimals: e.target.value })} placeholder="0" inputMode="numeric" /><FieldError message={assetValidation.errors.decimals} value={assetForm.decimals} /></label>
          <label className="wide"><span>Icon URL <small>optional</small></span><input value={assetForm.icon} onChange={(e) => onAssetFormChange({ ...assetForm, icon: e.target.value })} placeholder="https://…" /><FieldError message={assetValidation.errors.icon} value={assetForm.icon} /></label>
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
          <label><span>Base asset</span><select value={poolForm.baseAssetId} onChange={(e) => updatePoolPair(e.target.value, poolForm.quoteAssetId)}><option value="btc">BTC · native</option>{assets.map((item) => <option key={item.assetId} value={item.assetId}>{item.metadata?.ticker ?? short(item.assetId)}</option>)}</select></label>
          <label><span>Quote asset</span><select value={poolForm.quoteAssetId} onChange={(e) => updatePoolPair(poolForm.baseAssetId, e.target.value)}><option value="">Select asset</option>{assets.filter((item) => item.assetId !== poolForm.baseAssetId).map((item) => <option key={item.assetId} value={item.assetId}>{item.metadata?.ticker ?? short(item.assetId)}</option>)}</select><FieldError message={poolValidation.errors.quoteAssetId} value={poolForm.quoteAssetId} /></label>
          <label><span>Initial base reserve <small>{creationBaseDetails ? `${creationBaseDetails.ticker} display units · ${creationBaseDetails.decimals} decimals` : 'select an asset'}</small></span><input value={poolForm.baseAmount} onChange={(e) => onPoolFormChange({ ...poolForm, baseAmount: e.target.value })} placeholder={poolForm.baseAssetId === 'btc' ? '0.002' : '100'} inputMode="decimal" /><FieldError message={poolValidation.errors.baseAmount} value={poolForm.baseAmount} /></label>
          <label><span>Initial quote reserve <small>{creationQuoteDetails ? `${creationQuoteDetails.ticker} display units · ${creationQuoteDetails.decimals} decimals` : 'select an asset'}</small></span><input value={poolForm.quoteAmount} onChange={(e) => onPoolFormChange({ ...poolForm, quoteAmount: e.target.value })} placeholder="100" inputMode="decimal" /><FieldError message={poolValidation.errors.quoteAmount} value={poolForm.quoteAmount} /></label>
          <label><span>Total fee · bps</span><input value={poolForm.feeBps} onChange={(e) => onPoolFormChange({ ...poolForm, feeBps: e.target.value })} inputMode="numeric" /><FieldError message={poolValidation.errors.feeBps} value={poolForm.feeBps} /></label>
          <label><span>Protocol fee · min {MIN_PROTOCOL_FEE_BPS} bps</span><input value={poolForm.protocolFeeBps} onChange={(e) => onPoolFormChange({ ...poolForm, protocolFeeBps: e.target.value })} inputMode="numeric" /><FieldError message={poolValidation.errors.protocolFeeBps} value={poolForm.protocolFeeBps} /></label>
        </div>
        <div className="fee-summary">
          <div><span>Pool · named after the asset tickers</span><b>{poolForm.name || 'Select both assets'}</b></div>
          <div><span>Pool ID</span><code>{poolForm.id || '—'}</code></div>
          <div><span>Pool asset tickers · permanent</span><b title={poolTickers ? `${poolTickers.lp}, ${poolTickers.control}, ${poolTickers.ledger}` : undefined}>{poolTickers ? `${poolTickers.lp} · ${poolTickers.control} · ${poolTickers.ledger}` : '—'}</b></div>
          <div><span>Initial liquidity</span><b title={initialLiquiditySummary}>{initialLiquiditySummary}</b></div>
          <div><span>Raw amounts sent to API</span><b title={creationBaseAmount && creationQuoteAmount ? `${creationBaseAmount} / ${creationQuoteAmount}` : undefined}>{creationBaseAmount && creationQuoteAmount ? `${comma(creationBaseAmount)} / ${comma(creationQuoteAmount)}` : 'Converted automatically'}</b></div>
          <div><span>Creation fee · included</span><b>{deployment ? `${comma(deployment.poolCreationFeeSats)} sats` : 'Unavailable'}</b></div>
          <div><span>Technical carriers</span><b>{bootstrapSummary ? `${comma(bootstrapSummary.carrierSats)} sats` : 'Calculated by API'}</b></div>
          <div><span>Total bootstrap funding</span><b title={bootstrapSummary?.total}>{bootstrapSummary?.total ?? 'Returned before payment'}</b></div>
          <div><span>Stable Treasury Vault</span><code title={deployment?.platformTreasuryAddress}>{deployment ? short(deployment.platformTreasuryAddress, 8) : 'Unavailable'}</code></div>
        </div>
        {currentPoolEligibility && !currentPoolEligibility.eligible && <div className="notice launch-pool-block"><b>Launch asset · generic pool blocked</b><span>{currentPoolEligibility.reason}. Launch assets trade only through their bonding curve and canonical permanent pool in Inscrib3.</span></div>}
        {controlledCreationAssets.length > 0 && <div className="notice asset-risk"><b>Reissuable asset warning</b><span>{controlledCreationAssets.map((asset) => `${asset.metadata?.ticker ?? short(asset.assetId)} · control ${short(asset.controlAssetId!, 8)}`).join(' · ')}. Additional supply may be issued by the control holder.</span></div>}
        <button className="primary" disabled={busy || connecting || (walletReady && poolFormBlocker !== null)} onClick={() => void createPool()}>{busy && <Spinner />}{walletActionLabel ?? poolFormBlocker ?? (poolAssetIssuance ? 'Resume pool creation' : 'Issue pool assets & open pool')}</button>
        {creationStep && <div className="creation-progress"><i className={poolCreation?.status === 'opened' ? 'done' : ''} /><span>{creationStep}</span></div>}
        {poolOpeningPending && <button className="secondary" disabled={busy} onClick={() => void retryPoolOpening()}>Retry opening</button>}
        {poolCreation && <div className="result-box"><span>Status</span><b>{poolCreation.status}</b>{poolCreation.status === 'opened' && <><span>Points earned</span><b className="points-earned">+10 PTS</b></>}<span>Bootstrap covenant</span><code>{poolCreation.bootstrapAddress}</code>{poolCreation.openingTxid && <><span>Opening transaction</span><code>{poolCreation.openingTxid}</code></>}</div>}
      </article>
      <aside className="create-info"><span className="panel-label">ONE ATOMIC FUNDING</span><h3>Permissionless, not custodial</h3><p>Inscrib3 issues the control, LP, and ledger assets, then funds liquidity, technical carriers, and the fixed creation fee in one bootstrap payment. The contract opens and distributes everything atomically.</p><ul><li>BTC remains native and unwrapped</li><li>The creation fee reaches the stable Treasury Vault</li><li>Protocol fee is at least 0.30% and below the total fee</li></ul><a className="panel-doc-link" href="https://docs.inscrib3.com/app/pools-liquidity" target="_blank" rel="noreferrer">Pool and liquidity guide ↗</a></aside>
    </div>}
    {error && <div className="notice error create-error"><b>Creation unavailable</b><span>{error}</span></div>}
  </section>
}
