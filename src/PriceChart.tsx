import { useEffect, useRef, useState } from 'react'
import { btc, comma, formatChartTime, formatChartTooltipTime, formatPrice, PRICE_TIMEFRAMES, type PriceTimeframe } from './format'

export interface ChartPoint {
  recordedAt: number
  price: number
  venue?: 'curve' | 'pool'
  btcReserve?: string
  tokenReserve?: string
}

interface PriceChartProps {
  gradientId: string
  // The unit label when not in sub-satoshi mode: 'BTC' for launches, the base ticker for pools.
  unitTicker: string
  // The ticker the price is quoted against: the quote ticker for pools, the launch ticker for launches.
  perTicker: string
  // 'always' for launches (always quoted in BTC) and 'btc' for pools (only when the base is BTC).
  satsMode: 'btc' | 'always'
  footerNormal: string
  footerSats: string
  emptyMessage: (timeframe: PriceTimeframe) => string
  showGraduation: boolean
  tokenTicker?: string
  ariaLabel: string
  load: (timeframe: PriceTimeframe, signal: AbortSignal) => Promise<ChartPoint[]>
}

export function PriceChart({ gradientId, unitTicker, perTicker, satsMode, footerNormal, footerSats, emptyMessage, showGraduation, tokenTicker, ariaLabel, load }: PriceChartProps) {
  const [timeframe, setTimeframe] = useState<PriceTimeframe>('4h')
  const [points, setPoints] = useState<ChartPoint[]>([])
  const [chartError, setChartError] = useState('')
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const loadRef = useRef(load)
  useEffect(() => { loadRef.current = load })

  useEffect(() => {
    const controller = new AbortController()
    const run = () => loadRef.current(timeframe, controller.signal)
      .then((next) => { setPoints(Array.isArray(next) ? next : []); setChartError('') })
      .catch((cause: unknown) => { if ((cause as Error).name !== 'AbortError') setChartError(cause instanceof Error ? cause.message : String(cause)) })
    void run()
    const refresh = window.setInterval(() => void run(), 15_000)
    return () => { controller.abort(); window.clearInterval(refresh) }
  }, [timeframe])

  const series = points.filter((point) => Number.isFinite(point.price))
  const prices = series.map((point) => point.price)
  const latest = prices.at(-1)
  const first = prices[0]
  const change = first && latest !== undefined ? ((latest - first) / first) * 100 : 0
  const min = prices.length ? Math.min(...prices) : 0
  const max = prices.length ? Math.max(...prices) : 0
  const spread = max - min || Math.max(Math.abs(max) * 0.02, 1e-12)
  const firstTime = series[0]?.recordedAt ?? 0
  const lastTime = series.at(-1)?.recordedAt ?? firstTime
  const coordinates = series.map((point) => {
    const x = firstTime === lastTime ? 300 : 18 + ((point.recordedAt - firstTime) / (lastTime - firstTime)) * 564
    const y = 162 - ((point.price - (min - spread * 0.08)) / (spread * 1.16)) * 144
    return { x, y }
  })
  const chartPoints = coordinates.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const lastCoordinate = coordinates.at(-1)
  const hoveredCoordinate = hoveredIndex === null ? undefined : coordinates[hoveredIndex]
  const hoveredPoint = hoveredIndex === null ? undefined : series[hoveredIndex]
  const displayInSats = (satsMode === 'always' || (satsMode === 'btc' && unitTicker === 'BTC')) && latest !== undefined && latest > 0 && latest < 0.00000001
  const displayUnit = displayInSats ? 'sats' : unitTicker
  const displayPrice = (value: number) => formatPrice(value * (displayInSats ? 100_000_000 : 1))
  const graduationIndex = showGraduation ? series.findIndex((point, index) => point.venue === 'pool' && series.slice(0, index).some((earlier) => earlier.venue === 'curve')) : -1
  const graduationCoordinate = graduationIndex >= 0 ? coordinates[graduationIndex] : undefined

  return <section className="price-chart">
    <div className="price-chart-head">
      <div><span>{showGraduation ? 'CONTINUOUS PRICE · CURVE → PERMANENT POOL' : 'DISPLAY PRICE · DECIMALS APPLIED'}</span><div><h3>{displayUnit} per {perTicker}</h3>{latest !== undefined && <b>{displayPrice(latest)}</b>}<em className={change >= 0 ? 'positive' : 'negative'}>{change >= 0 ? '+' : ''}{change.toFixed(2)}%</em></div></div>
      <div className="price-timeframes">{PRICE_TIMEFRAMES.map((value) => <button key={value} className={timeframe === value ? 'active' : ''} onClick={() => setTimeframe(value)}>{value.toUpperCase()}</button>)}</div>
    </div>
    <div className="price-chart-canvas" onPointerMove={(event) => {
      if (!coordinates.length) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const contentWidth = Math.max(bounds.width - 28, 1)
      const chartX = Math.min(600, Math.max(0, ((event.clientX - bounds.left - 14) / contentWidth) * 600))
      let nearest = 0
      for (let index = 1; index < coordinates.length; index += 1) {
        if (Math.abs(coordinates[index]!.x - chartX) < Math.abs(coordinates[nearest]!.x - chartX)) nearest = index
      }
      setHoveredIndex(nearest)
    }} onPointerLeave={() => setHoveredIndex(null)}>
      {prices.length ? <svg viewBox="0 0 600 180" role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#34d399" stopOpacity=".24" /><stop offset="1" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
        {[36, 72, 108, 144].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} className="chart-grid" />)}
        {prices.length > 1 && <polygon points={`18,180 ${chartPoints} 582,180`} fill={`url(#${gradientId})`} />}
        <polyline points={chartPoints} className="chart-line" />
      </svg> : <div className="chart-empty">{chartError || emptyMessage(timeframe)}</div>}
      {prices.length > 0 && <div className="chart-overlay" aria-hidden="true">
        {graduationCoordinate && <><span className="launch-graduation-line" style={{ left: `${graduationCoordinate.x / 6}%` }} /><span className="launch-graduation-label" style={{ left: `${graduationCoordinate.x / 6}%` }}>GRADUATED</span></>}
        {lastCoordinate && <span className="chart-marker chart-last" style={{ left: `${lastCoordinate.x / 6}%`, top: `${lastCoordinate.y / 1.8}%` }} />}
        {hoveredCoordinate && hoveredPoint && <>
          <span className="chart-hover-guide" style={{ left: `${hoveredCoordinate.x / 6}%` }} />
          <span className="chart-marker chart-hover-marker" style={{ left: `${hoveredCoordinate.x / 6}%`, top: `${hoveredCoordinate.y / 1.8}%` }} />
          <div className="chart-tooltip" style={{
            left: `${hoveredCoordinate.x / 6}%`, top: `${hoveredCoordinate.y / 1.8}%`,
            transform: hoveredCoordinate.x > 450
              ? hoveredCoordinate.y < 60 ? 'translate(calc(-100% - 12px), 12px)' : 'translate(calc(-100% - 12px), calc(-100% - 10px))'
              : hoveredCoordinate.y < 60 ? 'translate(12px, 12px)' : 'translate(12px, calc(-100% - 10px))',
          }}>
            <span>{hoveredPoint.venue === 'curve' ? 'Bonding curve' : hoveredPoint.venue === 'pool' ? 'Permanent pool' : `${displayUnit} per ${perTicker}`}</span>
            <b>{displayPrice(hoveredPoint.price)}</b>
            <small>{formatChartTooltipTime(hoveredPoint.recordedAt)}</small>
            {hoveredPoint.btcReserve && hoveredPoint.tokenReserve && tokenTicker && <small>{btc(hoveredPoint.btcReserve)} · {comma(hoveredPoint.tokenReserve)} {tokenTicker}</small>}
          </div>
        </>}
      </div>}
    </div>
    <div className="price-chart-foot"><span>{series[0] ? formatChartTime(series[0].recordedAt, timeframe) : '—'}</span><span>{displayInSats ? footerSats : footerNormal}</span><span>{series.at(-1) ? formatChartTime(series.at(-1)!.recordedAt, timeframe) : '—'}</span></div>
  </section>
}
