import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

export function PwaStatus() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  useEffect(() => {
    if (!offlineReady) return
    const timer = window.setTimeout(() => setOfflineReady(false), 5_000)
    return () => window.clearTimeout(timer)
  }, [offlineReady, setOfflineReady])

  if (!offlineReady && !needRefresh) return null
  return <aside className="pwa-status" aria-live="polite">
    <div><b>{needRefresh ? 'Update available' : 'App ready offline'}</b><span>{needRefresh ? 'Refresh when you are not approving a wallet transaction.' : 'The app shell can now open without a connection.'}</span></div>
    {needRefresh && <button className="pwa-refresh" type="button" onClick={() => void updateServiceWorker(true)}>Refresh</button>}
    <button className="pwa-dismiss" type="button" aria-label="Dismiss notification" onClick={() => { setOfflineReady(false); setNeedRefresh(false) }}>×</button>
  </aside>
}
