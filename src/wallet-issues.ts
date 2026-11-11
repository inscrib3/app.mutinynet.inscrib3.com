export const WALLET_INSTALL_URL = 'https://chromewebstore.google.com/detail/hafphignbjdmblopkophkohgnphalclg'

export type WalletIssueKind = 'missing' | 'locked' | 'rejected' | 'changed-during-approval' | 'unreachable' | 'unknown'

export interface WalletIssue {
  kind: WalletIssueKind
  title: string
  detail: string
}

export const MISSING_WALLET: WalletIssue = {
  kind: 'missing',
  title: 'Inscrib3 Wallet not found',
  detail: 'Install the Inscrib3 Wallet browser extension, then reload this page.',
}

export const LOCKED_WALLET: WalletIssue = {
  kind: 'locked',
  title: 'Unlock Inscrib3 Wallet to continue',
  detail: 'Click the Inscrib3 icon in your browser toolbar and enter your password. The connection continues automatically.',
}

// The wallet only returns plain error strings, so its known messages are matched by text.
export function describeWalletError(cause: unknown): WalletIssue {
  const message = errorMessage(cause)
  if (/locked/i.test(message)) return LOCKED_WALLET
  if (/rejected/i.test(message)) {
    return { kind: 'rejected', title: 'Connection rejected', detail: 'The request was declined in Inscrib3 Wallet. Click Connect wallet to try again.' }
  }
  if (/changed while this request was open/i.test(message)) {
    return { kind: 'changed-during-approval', title: 'Wallet changed during approval', detail: 'The account or network changed while the request was open. Click Connect wallet to try again.' }
  }
  if (/failed to fetch|network ?error|couldn't be reached|timed? ?out/i.test(message)) {
    return { kind: 'unreachable', title: 'Wallet server unreachable', detail: `Inscrib3 Wallet could not reach its Arkade server. Check your connection and try again. (${message})` }
  }
  return { kind: 'unknown', title: 'Wallet connection failed', detail: message }
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
