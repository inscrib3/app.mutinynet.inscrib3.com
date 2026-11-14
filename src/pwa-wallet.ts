export const WALLET_PWA_ORIGIN = 'https://wallet.inscrib3.com'

type WalletPopupReply = {
  type: string
  accounts?: unknown
  txid?: unknown
  error?: unknown
}

export interface PwaArkadeProvider {
  readonly isArkade: true
  readonly isPwa: true
  connect(): Promise<string[]>
  disconnect(): Promise<void>
  getAccounts(): Promise<string[]>
  isConnected(): Promise<boolean>
  getProviderState(): Promise<unknown>
  getAddress(): Promise<string>
  getBoardingAddress(): Promise<string>
  getXOnlyPublicKey(): Promise<string>
  getBalance(): Promise<unknown>
  getNetwork(): Promise<unknown>
  getAssets(): Promise<unknown[]>
  getTransactionHistory(): Promise<unknown[]>
  sendToAddress(address: string, amount: number): Promise<string>
  sendAsset(address: string, assets: Array<{ assetId: string; amount: number }>, bitcoinAmount?: number): Promise<string>
  issueAsset(input: unknown): Promise<unknown>
  reissueAsset(input: { assetId: string; amount: number }): Promise<string>
  burnAsset(input: { assetId: string; amount: number }): Promise<string>
  settle(): Promise<string>
  signMessage(message: string): Promise<unknown>
  switchNetwork(network: string): Promise<boolean>
  on(event: string, callback: (data?: unknown) => void): void
  off(event: string, callback: (data?: unknown) => void): void
}

const POPUP_FEATURES = 'width=380,height=640'

export function reservePwaWalletPopup(): Window {
  const popup = window.open('', 'inscrib3-wallet', POPUP_FEATURES)
  if (!popup) throw new Error('Wallet popup blocked. Allow popups for this app and try again.')
  // The contract address is only known after the App creates its intent. Keep
  // the user-initiated window alive while that request is being prepared.
  try {
    popup.document.title = 'Inscrib3 Wallet'
    popup.document.body.style.cssText = 'margin:0;display:grid;place-items:center;min-height:100vh;color:#a7f3d0;background:#000;font:14px system-ui'
    popup.document.body.textContent = 'Preparing wallet request…'
  } catch { /* A previously opened named wallet window may already be cross-origin. */ }
  return popup
}

function walletPopup(params: Record<string, string>, reservedPopup?: Window): Promise<WalletPopupReply> {
  const url = new URL('/', WALLET_PWA_ORIGIN)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  // The wallet validates document.referrer and replies through window.opener.
  // Do not add noopener or noreferrer to this integration popup.
  const popup = reservedPopup ?? window.open(url, 'inscrib3-wallet', POPUP_FEATURES)
  if (!popup) return Promise.reject(new Error('Wallet popup blocked. Allow popups for this app and try again.'))
  if (reservedPopup) popup.location.href = url.toString()

  return new Promise((resolve, reject) => {
    function cleanup() {
      window.removeEventListener('message', onMessage)
      window.clearInterval(closedPoll)
    }
    function onMessage(event: MessageEvent) {
      if (event.origin !== WALLET_PWA_ORIGIN || event.source !== popup) return
      if (!event.data || typeof event.data !== 'object' || typeof (event.data as { type?: unknown }).type !== 'string') return
      cleanup()
      resolve(event.data as WalletPopupReply)
    }
    const closedPoll = window.setInterval(() => {
      if (!popup.closed) return
      cleanup()
      reject(new Error('Wallet window closed'))
    }, 500)
    window.addEventListener('message', onMessage)
  })
}

export async function connectWithPwaWallet(network: 'bitcoin' | 'mutinynet'): Promise<{ accounts: string[]; provider: PwaArkadeProvider }> {
  const url = new URL('/', WALLET_PWA_ORIGIN)
  url.searchParams.set('arkade_connect_origin', '1')
  url.searchParams.set('arkade_connect_network', network)
  const popup = window.open(url, 'inscrib3-wallet', POPUP_FEATURES)
  if (!popup) throw new Error('Wallet popup blocked. Allow popups for this app and try again.')
  const walletWindow: Window = popup

  return new Promise((resolve, reject) => {
    let connected = false
    let requestId = 0
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (cause: Error) => void }>()
    const listeners = new Map<string, Set<(data?: unknown) => void>>()

    function cleanupBeforeConnect() {
      if (connected) return
      window.removeEventListener('message', onMessage)
      window.clearInterval(closedPoll)
    }

    function request<T>(method: string, params?: unknown): Promise<T> {
      if (walletWindow.closed) return Promise.reject(new Error('Wallet window closed'))
      const id = `pwa-${++requestId}`
      return new Promise<T>((resolveRequest, rejectRequest) => {
        pending.set(id, { resolve: resolveRequest as (value: unknown) => void, reject: rejectRequest })
        walletWindow.postMessage({ type: 'inscrib3:provider_request', request: { id, method, params } }, WALLET_PWA_ORIGIN)
      })
    }

    const provider: PwaArkadeProvider = Object.freeze({
      isArkade: true as const,
      isPwa: true as const,
      connect: () => request<string[]>('arkade_connect'),
      async disconnect() { await request('arkade_disconnect') },
      getAccounts: () => request<string[]>('arkade_getAccounts'),
      isConnected: () => request<boolean>('arkade_isConnected'),
      getProviderState: () => request('arkade_getProviderState'),
      getAddress: () => request<string>('arkade_getAddress'),
      getBoardingAddress: () => request<string>('arkade_getBoardingAddress'),
      getXOnlyPublicKey: () => request<string>('arkade_getXOnlyPublicKey'),
      getBalance: () => request('arkade_getBalance'),
      getNetwork: () => request('arkade_getNetwork'),
      getAssets: () => request<unknown[]>('arkade_getAssets'),
      getTransactionHistory: () => request<unknown[]>('arkade_getTransactionHistory'),
      sendToAddress: (address: string, amount: number) => request<string>('arkade_sendToAddress', { address, amount }),
      sendAsset: (address: string, assets: Array<{ assetId: string; amount: number }>, bitcoinAmount?: number) => request<string>('arkade_sendAsset', { address, assets, bitcoinAmount }),
      issueAsset: (input: unknown) => request('arkade_issueAsset', input),
      reissueAsset: (input: { assetId: string; amount: number }) => request<string>('arkade_reissueAsset', input),
      burnAsset: (input: { assetId: string; amount: number }) => request<string>('arkade_burnAsset', input),
      settle: () => request<string>('arkade_settle'),
      signMessage: (message: string) => request('arkade_signMessage', { message }),
      switchNetwork: (target: string) => request<boolean>('arkade_switchNetwork', { network: target }),
      on(event: string, callback: (data?: unknown) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(callback)
      },
      off(event: string, callback: (data?: unknown) => void) { listeners.get(event)?.delete(callback) },
    })

    function onMessage(event: MessageEvent) {
      if (event.origin !== WALLET_PWA_ORIGIN || event.source !== walletWindow || !event.data || typeof event.data !== 'object') return
      const message = event.data as { type?: unknown; accounts?: unknown; error?: unknown; id?: unknown; result?: unknown; event?: unknown; data?: unknown }
      if (!connected) {
        if (message.type === 'inscrib3:connect_rejected') { cleanupBeforeConnect(); reject(new Error('Connection rejected')); return }
        if (message.type === 'inscrib3:connect_failed') { cleanupBeforeConnect(); reject(new Error(typeof message.error === 'string' && message.error ? message.error : 'Connection failed')); return }
        if (message.type === 'inscrib3:connect') {
          if (!Array.isArray(message.accounts) || message.accounts.length === 0 || !message.accounts.every((account) => typeof account === 'string')) {
            cleanupBeforeConnect(); reject(new Error('Unrecognized wallet response')); return
          }
          connected = true
          resolve({ accounts: message.accounts, provider })
          return
        }
      }
      if (message.type === 'inscrib3:provider_response' && typeof message.id === 'string') {
        const open = pending.get(message.id)
        if (!open) return
        pending.delete(message.id)
        if (typeof message.error === 'string') open.reject(new Error(message.error))
        else open.resolve(message.result)
      } else if (message.type === 'inscrib3:provider_event' && typeof message.event === 'string') {
        listeners.get(message.event)?.forEach((callback) => callback(message.data))
      }
    }

    window.addEventListener('message', onMessage)
    const closedPoll = window.setInterval(() => {
      if (!walletWindow.closed) return
      window.clearInterval(closedPoll)
      window.removeEventListener('message', onMessage)
      const error = new Error('Wallet window closed')
      pending.forEach((open) => open.reject(error)); pending.clear()
      listeners.get('accountsChanged')?.forEach((callback) => callback([]))
      if (!connected) reject(error)
    }, 500)
  })
}

export async function sendBtcWithPwaWallet(address: string, amountSats: number, popup: Window): Promise<string> {
  if (!/^(?:ark|tark)1/i.test(address)) throw new Error('The destination must be an Arkade address')
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('The amount must be a positive integer')
  const reply = await walletPopup({
    arkade_send_origin: '1',
    arkade_send_address: address,
    arkade_send_amount: String(amountSats),
  }, popup)
  if (reply.type === 'inscrib3:send_rejected') throw new Error('Send rejected')
  if (reply.type === 'inscrib3:send_failed') throw new Error(typeof reply.error === 'string' && reply.error ? reply.error : 'Send failed')
  if (reply.type !== 'inscrib3:send' || typeof reply.txid !== 'string' || !reply.txid.trim()) {
    throw new Error('Unrecognized wallet response')
  }
  return reply.txid
}

export async function sendAssetsWithPwaWallet(address: string, assets: Array<{ assetId: string; amount: number }>, bitcoinAmount: number | undefined, popup: Window): Promise<string> {
  if (!/^(?:ark|tark)1/i.test(address)) throw new Error('The destination must be an Arkade address')
  if (assets.length === 0 || assets.length > 16 || assets.some((asset) => !asset.assetId || !Number.isSafeInteger(asset.amount) || asset.amount <= 0)) {
    throw new Error('Assets must contain positive safe-integer raw amounts')
  }
  if (bitcoinAmount !== undefined && (!Number.isSafeInteger(bitcoinAmount) || bitcoinAmount <= 0)) throw new Error('The BTC carrier must be a positive safe integer')
  const reply = await walletPopup({
    arkade_send_asset_origin: '1',
    arkade_send_asset_address: address,
    arkade_send_asset_assets: JSON.stringify(assets),
    ...(bitcoinAmount === undefined ? {} : { arkade_send_asset_bitcoin_amount: String(bitcoinAmount) }),
  }, popup)
  if (reply.type === 'inscrib3:send_asset_rejected') throw new Error('Asset send rejected')
  if (reply.type === 'inscrib3:send_asset_failed') throw new Error(typeof reply.error === 'string' && reply.error ? reply.error : 'Asset send failed')
  if (reply.type !== 'inscrib3:send_asset' || typeof reply.txid !== 'string' || !reply.txid.trim()) throw new Error('Unrecognized wallet response')
  return reply.txid
}
