export const WALLET_PWA_ORIGIN = 'https://wallet.inscrib3.com'

type WalletPopupReply = {
  type: string
  accounts?: unknown
  txid?: unknown
  error?: unknown
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

export async function connectWithPwaWallet(): Promise<string[]> {
  const reply = await walletPopup({ arkade_connect_origin: '1' })
  if (reply.type === 'inscrib3:connect_rejected') throw new Error('Connection rejected')
  if (reply.type !== 'inscrib3:connect' || !Array.isArray(reply.accounts) || !reply.accounts.every((account) => typeof account === 'string')) {
    throw new Error('Unrecognized wallet response')
  }
  if (reply.accounts.length === 0) throw new Error('Wallet returned no active account')
  return reply.accounts
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
