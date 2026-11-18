const MUTINYNET_FAUCET_URL = 'https://faucet.mutinynet.com/'

export function FaucetPage({ address, walletOnWrongNetwork, connecting, connect, copyFaucetAddress, faucetCopied }: {
  address: string; walletOnWrongNetwork: boolean; connecting: boolean; connect: () => void; copyFaucetAddress: () => void; faucetCopied: boolean
}) {
  return <section className="view-page faucet-page">
    <div className="faucet-hero">
      <div className="faucet-orbit" aria-hidden="true"><span>₿</span><i /><i /><i /></div>
      <div className="faucet-hero-copy"><span className="eyebrow"><i /> MUTINYNET TEST FUNDS</span><h1>Fund your wallet.<br /><em>Start building.</em></h1><p>Get free Mutinynet sats from the official faucet and receive them directly at your connected Arkade address.</p></div>
      <a className="primary compact faucet-open" href={MUTINYNET_FAUCET_URL} target="_blank" rel="noreferrer">Open official faucet ↗</a>
    </div>
    <div className="faucet-layout">
      <article className="faucet-address-card">
        <div className="faucet-card-head"><div><span>DESTINATION</span><h2>Your Arkade address</h2></div><span className="faucet-official"><i /> MUTINYNET</span></div>
        {!address ? <div className="faucet-connect"><p>Connect Inscrib3 Wallet to load the correct Mutinynet destination.</p><button className="secondary" onClick={() => void connect()} disabled={connecting}>{connecting ? 'Connecting…' : 'Connect wallet'}</button></div> : walletOnWrongNetwork ? <div className="notice asset-risk"><b>Wrong wallet network</b><span>Switch Inscrib3 Wallet to Mutinynet before requesting test funds.</span></div> : <>
          <code className="faucet-address" title={address}>{address}</code>
          <div className="faucet-address-actions"><button className="secondary" onClick={() => void copyFaucetAddress()}>{faucetCopied ? 'Address copied' : 'Copy address'}</button><a className="primary" href={MUTINYNET_FAUCET_URL} target="_blank" rel="noreferrer">Continue to faucet ↗</a></div>
        </>}
        <small>The faucet sends test sats directly to this address. Inscrib3 never receives your faucet credentials or wallet keys.</small>
      </article>
      <aside className="faucet-steps">
        <span className="panel-label">HOW TO FUND</span>
        <ol><li><b>1</b><div><strong>Copy your address</strong><span>Use the connected <code>tark1…</code> destination shown here.</span></div></li><li><b>2</b><div><strong>Sign in to Mutinynet</strong><span>Authentication is handled by the official faucet through GitHub.</span></div></li><li><b>3</b><div><strong>Select Arkade</strong><span>Paste the address, choose an amount and submit the request.</span></div></li><li><b>4</b><div><strong>Wait for your balance</strong><span>The wallet updates after the Arkade payment settles.</span></div></li></ol>
        <div className="faucet-limit"><span>Official limit</span><b>1,000,000 sats / 24h</b><small>Applied per IP, user and destination by Mutinynet.</small></div>
      </aside>
    </div>
  </section>
}
