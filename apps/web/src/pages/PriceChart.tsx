/**
 * Copyright 2026 Davey Wong <wgwcko@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/**
 * Price chart drawer — TradingView lightweight-charts wrapper.
 *
 * Renders a candlestick chart for a given token address + chain.
 * Data comes from GeckoTerminal OHLCV (primary) with DexScreener
 * spot price fallback for tokens without pool data.
 *
 * Usage: open from Home page by clicking a token row.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, TrendingUp, TrendingDown, Loader2, BarChart3 } from 'lucide-react';
import { createChart, CandlestickSeries, HistogramSeries, type IChartApi } from 'lightweight-charts';
import { fetchOhlcv, fetchDexScreenerSpot, type Candle, type Timeframe } from '@7xcircle/chains';
import { priceAddress } from '@7xcircle/chains';

interface PriceChartProps {
  chainId: string;
  tokenAddress: string;
  tokenSymbol: string;
  isNative: boolean;
  onClose: () => void;
}

const TIMEFRAMES: { label: string; tf: Timeframe; aggregate: number; limit: number }[] = [
  { label: '1H', tf: 'minute', aggregate: 5, limit: 12 },
  { label: '1D', tf: 'minute', aggregate: 15, limit: 96 },
  { label: '1W', tf: 'hour', aggregate: 1, limit: 168 },
  { label: '1M', tf: 'hour', aggregate: 4, limit: 180 },
  { label: '3M', tf: 'day', aggregate: 1, limit: 90 },
];

export function PriceChart({ chainId, tokenAddress, tokenSymbol, isNative, onClose }: PriceChartProps) {
  const { t } = useTranslation();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const [tfIndex, setTfIndex] = useState(2); // default 1W
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [spot, setSpot] = useState<{ priceUsd: number; change24h: number } | null>(null);

  // Resolve the address used for pricing (native → wrapped)
  const lookupAddress = priceAddress(chainId, tokenAddress, isNative) ?? tokenAddress;

  // ── Fetch data when token or timeframe changes ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const tf = TIMEFRAMES[tfIndex];
        const data = await fetchOhlcv(chainId, lookupAddress, tf.tf, tf.aggregate, tf.limit);
        if (cancelled) return;

        setCandles(data);

        // Fallback to DexScreener spot when GeckoTerminal has no data
        if (data.length === 0) {
          const spotData = await fetchDexScreenerSpot(chainId, lookupAddress);
          if (!cancelled) setSpot(spotData);
        } else {
          setSpot(null);
        }
      } catch {
        // Both fetchers degrade internally — this is the last-resort guard so
        // an unexpected rejection can never strand the drawer on "loading".
        if (!cancelled) {
          setCandles([]);
          setSpot(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [chainId, lookupAddress, tfIndex]);

  // ── Render chart when candles arrive ──
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;

    // Clean up previous chart instance
    if (chartApiRef.current) {
      chartApiRef.current.remove();
      chartApiRef.current = null;
    }

    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: 'var(--ow-text-secondary, #8b8b8b)',
      },
      grid: {
        vertLines: { color: 'var(--ow-border-subtle, rgba(255,255,255,0.06))' },
        horzLines: { color: 'var(--ow-border-subtle, rgba(255,255,255,0.06))' },
      },
      width: chartRef.current.clientWidth,
      height: 280,
      crosshair: {
        mode: 0, // normal crosshair
      },
      rightPriceScale: {
        borderColor: 'var(--ow-border-subtle, rgba(255,255,255,0.06))',
      },
      timeScale: {
        borderColor: 'var(--ow-border-subtle, rgba(255,255,255,0.06))',
        timeVisible: true,
      },
    });
    chartApiRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#34c759',
      downColor: '#ff3b30',
      borderUpColor: '#34c759',
      borderDownColor: '#ff3b30',
      wickUpColor: '#34c759',
      wickDownColor: '#ff3b30',
    });
    candleSeries.setData(candles.map(c => ({
      time: c.time as unknown as import('lightweight-charts').UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })));

    // Volume histogram
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(candles.map(c => ({
      time: c.time as unknown as import('lightweight-charts').UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(52,199,89,0.3)' : 'rgba(255,59,48,0.3)',
    })));

    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (chartRef.current) {
        chart.applyOptions({ width: chartRef.current.clientWidth });
      }
    });
    ro.observe(chartRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartApiRef.current = null;
    };
  }, [candles]);

  // ── Price change from first to last candle ──
  const change = candles.length >= 2
    ? ((candles[candles.length - 1].close - candles[0].open) / candles[0].open) * 100
    : spot?.change24h ?? 0;
  const isUp = change >= 0;

  const lastPrice = candles.length > 0
    ? candles[candles.length - 1].close
    : spot?.priceUsd ?? 0;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: '100%',
        maxWidth: 560,
        maxHeight: '80vh',
        backgroundColor: 'var(--ow-bg-primary)',
        borderRadius: '16px 16px 0 0',
        padding: 'var(--ow-space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ow-space-4)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={18} />
              <span style={{ fontSize: 'var(--ow-font-size-lg)', fontWeight: 700 }}>{tokenSymbol}</span>
              <span style={{
                fontSize: 'var(--ow-font-size-xs)',
                color: 'var(--ow-text-tertiary)',
                fontFamily: 'var(--ow-font-mono)',
              }}>
                {lookupAddress.slice(0, 6)}…{lookupAddress.slice(-4)}
              </span>
            </div>
            {lastPrice > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ fontSize: 'var(--ow-font-size-xl)', fontWeight: 700, fontFamily: 'var(--ow-font-mono)' }}>
                  ${lastPrice < 0.01 ? lastPrice.toExponential(2) : lastPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </span>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  fontSize: 'var(--ow-font-size-sm)',
                  fontWeight: 600,
                  color: isUp ? 'var(--ow-positive)' : 'var(--ow-negative)',
                }}>
                  {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {isUp ? '+' : ''}{change.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ow-text-tertiary)',
              padding: 8,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Timeframe selector */}
        <div style={{ display: 'flex', gap: 4, padding: 2, backgroundColor: 'var(--ow-bg-secondary)', borderRadius: 'var(--ow-radius-sm)' }}>
          {TIMEFRAMES.map((tf, i) => (
            <button
              key={tf.label}
              onClick={() => setTfIndex(i)}
              style={{
                flex: 1,
                padding: '6px 0',
                border: 'none',
                borderRadius: 'var(--ow-radius-sm)',
                fontSize: 'var(--ow-font-size-xs)',
                fontWeight: tfIndex === i ? 600 : 400,
                cursor: 'pointer',
                backgroundColor: tfIndex === i ? 'var(--ow-bg-tertiary)' : 'transparent',
                color: tfIndex === i ? 'var(--ow-text-primary)' : 'var(--ow-text-tertiary)',
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Chart area */}
        <div style={{ position: 'relative', minHeight: 280 }}>
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              color: 'var(--ow-text-tertiary)',
              fontSize: 'var(--ow-font-size-sm)',
            }}>
              <Loader2 size={16} style={{ animation: 'ow-spin 1s linear infinite' }} />
              {t('chart.loading')}
            </div>
          )}
          {!loading && candles.length === 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 280,
              color: 'var(--ow-text-tertiary)',
              fontSize: 'var(--ow-font-size-sm)',
            }}>
              {spot ? (
                <>
                  <div>{t('chart.noCandles')}</div>
                  <div style={{ fontFamily: 'var(--ow-font-mono)' }}>
                    ${spot.priceUsd < 0.01 ? spot.priceUsd.toExponential(2) : spot.priceUsd.toLocaleString()}
                    <span style={{ marginLeft: 8, color: spot.change24h >= 0 ? 'var(--ow-positive)' : 'var(--ow-negative)' }}>
                      {spot.change24h >= 0 ? '+' : ''}{spot.change24h.toFixed(2)}% (24h)
                    </span>
                  </div>
                </>
              ) : (
                <div>{t('chart.noData')}</div>
              )}
            </div>
          )}
          <div ref={chartRef} style={{ width: '100%', display: candles.length > 0 ? 'block' : 'none' }} />
        </div>
      </div>
    </div>
  );
}
