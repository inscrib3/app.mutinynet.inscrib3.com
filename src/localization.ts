import { useLayoutEffect } from 'react'
import { chineseTranslations } from './chinese-translations'

export type AppLanguage = 'en' | 'zh-CN'

const metadataTranslations: Record<string, string> = {
  'Inscrib3 App — Native Liquidity on Mutinynet': 'Inscrib3 应用 — Mutinynet 原生流动性',
  'Open-source Mutinynet App for native BTC and Arkade swaps, permissionless pools, liquidity, price charts, and portable points.':
    '开源 Mutinynet 应用，提供原生 BTC 与 Arkade 资产兑换、无需许可的流动性池、流动性、价格图表和可携带积分。',
  'Native liquidity. Built on Bitcoin.': '原生流动性，构建于比特币之上。',
  'Open-source native swaps, permissionless pools, liquidity, price charts, and portable points—live on Mutinynet.':
    '开源原生兑换、无需许可的流动性池、流动性、价格图表和可携带积分——现已在 Mutinynet 上线。',
  'Open-source native swaps, permissionless pools, liquidity, charts, and portable points—live on Mutinynet.':
    '开源原生兑换、无需许可的流动性池、流动性、图表和可携带积分——现已在 Mutinynet 上线。',
  'Inscrib3 native Bitcoin liquidity app': 'Inscrib3 比特币原生流动性应用',
}

Object.assign(chineseTranslations, metadataTranslations)

const partialTranslations = Object.entries(chineseTranslations)
  .filter(([source]) => source.length >= 6 && /[A-Za-z]/.test(source))
  .sort(([left], [right]) => right.length - left.length)

export function detectAppLanguage(languages?: readonly string[]): AppLanguage {
  const browserLanguages = languages
    ?? (typeof navigator === 'undefined'
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language])

  return browserLanguages[0]?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function translateDynamicValue(value: string): string {
  const dynamicRules: Array<[RegExp, (...matches: string[]) => string]> = [
    [/^Rank #(\d+) of (\d+)$/, (_match, rank, total) => `第 ${rank} 名，共 ${total} 名`],
    [/^(\d+) of (\d+) pools$/, (_match, shown, total) => `显示 ${shown} 个，共 ${total} 个流动性池`],
    [/^(\d+) of (\d+) launches$/, (_match, shown, total) => `显示 ${shown} 个，共 ${total} 个发行项目`],
    [/^(\d+) (matches|players)$/, (_match, total, kind) => `${total} ${kind === 'matches' ? '个匹配结果' : '名参与者'}`],
    [/^No pools match “(.+)”\.$/, (_match, query) => `没有与“${query}”匹配的流动性池。`],
    [/^No ranked wallet matches “(.+)”\.$/, (_match, query) => `没有与“${query}”匹配的已排名钱包。`],
    [/^Insufficient (.+) balance$/, (_match, ticker) => `${ticker} 余额不足`],
    [/^Balance: (.+)$/, (_match, balance) => `余额：${balance}`],
    [/^(.+) settled (actions|operations|trades) in the last 24 hours$/, (_match, count, kind) =>
      `过去 24 小时内已结算 ${count} 笔${kind === 'trades' ? '交易' : '操作'}`],
    [/^(.+) per (.+)$/, (_match, first, second) => `每 ${second} 对应 ${first}`],
    [/^Switch Inscrib3 Wallet to (.+)$/, (_match, network) => `将 Inscrib3 钱包切换至 ${network}`],
    [/^Your wallet is on (.+)\. This app runs on (.+)\.$/, (_match, current, expected) =>
      `您的钱包当前位于 ${current}。此应用运行在 ${expected}。`],
  ]

  for (const [pattern, replacement] of dynamicRules) {
    const match = value.match(pattern)
    if (match) return replacement(...match)
  }

  let translated = value
  for (const [source, target] of partialTranslations) {
    if (translated.includes(source)) translated = translated.split(source).join(target)
  }
  return translated
}

function translateValue(value: string): string {
  const leading = value.match(/^\s*/)?.[0] ?? ''
  const trailing = value.match(/\s*$/)?.[0] ?? ''
  const normalized = value.trim().replace(/\s+/g, ' ')
  const translated = chineseTranslations[normalized] ?? translateDynamicValue(normalized)
  return translated === normalized ? value : `${leading}${translated}${trailing}`
}

function translateNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE && node.textContent) {
    const translated = translateValue(node.textContent)
    if (translated !== node.textContent) node.textContent = translated
    return
  }
  if (!(node instanceof Element)) return

  for (const attribute of ['aria-label', 'title', 'placeholder']) {
    const value = node.getAttribute(attribute)
    if (!value) continue
    const translated = translateValue(value)
    if (translated !== value) node.setAttribute(attribute, translated)
  }
  node.childNodes.forEach(translateNode)
}

export function applyAppLanguage(root: ParentNode, language: AppLanguage): void {
  if (language !== 'zh-CN') return
  root.childNodes.forEach(translateNode)
}

function translateMetadata(): void {
  document.title = translateValue(document.title)
  document
    .querySelectorAll<HTMLMetaElement>(
      'meta[name="description"], meta[property="og:title"], meta[property="og:description"], meta[property="og:image:alt"], meta[name="twitter:title"], meta[name="twitter:description"], meta[name="twitter:image:alt"]',
    )
    .forEach((meta) => {
      meta.content = translateValue(meta.content)
    })
  document.querySelector<HTMLMetaElement>('meta[property="og:locale"]')?.setAttribute('content', 'zh_CN')
}

export function useAutomaticLanguage(): AppLanguage {
  const language = detectAppLanguage()

  useLayoutEffect(() => {
    document.documentElement.lang = language
    if (language !== 'zh-CN') return

    applyAppLanguage(document.body, language)
    translateMetadata()

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateNode(mutation.target)
        else mutation.addedNodes.forEach(translateNode)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [language])

  return language
}
