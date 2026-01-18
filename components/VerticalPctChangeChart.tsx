"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

export type VerticalDatum = {
  vertical: string;
  pct_change: number;
};

export type AdvertiserDatum = {
  advertiser: string;
  impressions: number;
};

export type Advertiser24Datum = {
  advertiser: string;
  impressions_2h_2024?: number | null;
  impressions_2h_2025?: number | null;
  households_2h_2024?: number | null;
  households_2h_2025?: number | null;
  freq_2h_2024?: number | null;
  freq_2h_2025?: number | null;
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  text: string;
};

type LabelBBox = { x: number; y: number; width: number; height: number } | null;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function fmtInt(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

// For metric table values (MM with commas), e.g., 4,375MM
function fmtMM(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const mm = n / 1_000_000;
  if (!Number.isFinite(mm)) return "—";
  const mmRounded = Math.round(mm);
  return `${new Intl.NumberFormat("en-US").format(mmRounded)}MM`;
}

function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function pctChange(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / a) * 100;
}

function toWidthPx(v: number | null | undefined, max: number, maxPx: number) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 0;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return clamp((v / max) * maxPx, 0, maxPx);
}

export default function VerticalPctChangeChart({
  data,
  advertiserByVertical,
  advertiserDetailsByName,
}: {
  data: VerticalDatum[];
  advertiserByVertical: Record<string, AdvertiserDatum[]>;
  advertiserDetailsByName?: Record<string, Advertiser24Datum>;
}) {
  const vbWidth = 1400;

  // =========================
  // Top layout + chart geometry
  // =========================
  const titleH = 34;
  const verticalChartHeight = 740;
  const verticalTop = titleH;

  const margin = { top: 30, right: 360, bottom: 22, left: 360 };
  const innerW = vbWidth - margin.left - margin.right;
  const innerH = verticalChartHeight - margin.top - margin.bottom;

  const paddingInner = 0.20;
  const paddingOuter = 0.10;

  const maxAbs = useMemo(() => {
    const m = Math.max(...data.map((d) => Math.abs(d.pct_change)));
    return m > 0 ? m : 1;
  }, [data]);

  const domainMult = 1.02;
  const xMin = -maxAbs * domainMult;
  const xMax = maxAbs * domainMult;

  const xScale = (v: number) => {
    const t = (v - xMin) / (xMax - xMin);
    return margin.left + t * innerW;
  };

  const n = data.length;
  const step =
    innerH / (n + paddingOuter * 2 - paddingInner + paddingInner * n);
  const band = step * (1 - paddingInner);
  const startY = verticalTop + margin.top + step * paddingOuter;

  const yTop = (i: number) => startY + i * step;
  const yCenter = (i: number) => yTop(i) + band / 2;

  const gapPx = 3;
  const barCap = 60;
  const barSize = Math.max(14, Math.min(barCap, band - gapPx));

  const opacityFor = (v: number) => {
    const mag = Math.abs(v) / maxAbs;
    return 0.28 + 0.72 * mag;
  };

  const colorFor = (v: number) => (v >= 0 ? "#16a34a" : "#dc2626");

  const tooltipTextFor = (v: number) => {
    const abs = Math.abs(v);
    const dir = v >= 0 ? "increase" : "decrease";
    return `${abs.toFixed(1)}% ${dir} in impressions`;
  };

  const zeroLineY1 = yTop(0);
  const zeroLineY2 = yTop(n - 1) + band;

  // =========================
  // Tighten gap BELOW actual chart content (not reserved height)
  // =========================
  const verticalContentBottom = startY + (n - 1) * step + band;
  const gapBelowVerticalContent = 75; // smaller = tighter
  const detailTextTop = verticalContentBottom + gapBelowVerticalContent;

  // Font sizing adjustments requested
  const detailParaFontPx = 16; // "The following chart contains..." smaller
  const bottomNarrativeFontPx = detailParaFontPx; // match bottom narrative to above paragraph

  const detailTextHeight = 70;

  // Next blocks stack from detailTextTop
  const advertiserChartTop = detailTextTop + detailTextHeight + 6;
  const advertiserChartHeight = 250;

  const advertiserDetailTop = advertiserChartTop + advertiserChartHeight + 18;
  const advertiserDetailHeight = 160;

  const vbHeight = advertiserDetailTop + advertiserDetailHeight + 26;

  // =========================
  // Selection state
  // =========================
  const [selectedVerticalIdx, setSelectedVerticalIdx] = useState<number | null>(
    null
  );
  const selectedVertical =
    selectedVerticalIdx === null
      ? null
      : data[selectedVerticalIdx]?.vertical ?? null;

  const [selectedAdvertiserIdx, setSelectedAdvertiserIdx] = useState<number | null>(
    null
  );

  useEffect(() => {
    setSelectedAdvertiserIdx(null);
  }, [selectedVertical]);

  // =========================
  // Label bbox (for connector start position)
  // =========================
  const labelRefs = useRef<Array<SVGTextElement | null>>([]);
  const [labelBBoxes, setLabelBBoxes] = useState<LabelBBox[]>([]);

  const measureLabelBBoxes = () => {
    const boxes: LabelBBox[] = data.map((_, i) => {
      const el = labelRefs.current[i];
      if (!el) return null;
      try {
        const b = el.getBBox();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      } catch {
        return null;
      }
    });
    setLabelBBoxes(boxes);
  };

  useEffect(() => {
    const t = window.setTimeout(() => measureLabelBBoxes(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    const t = window.setTimeout(() => measureLabelBBoxes(), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVerticalIdx]);

  // =========================
  // Tooltip
  // =========================
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerPx, setContainerPx] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setContainerPx({ w: rect.width, h: rect.height });
    });

    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setContainerPx({ w: rect.width, h: rect.height });

    return () => ro.disconnect();
  }, []);

  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    text: "",
  });

  const onMouseMove = (evt: React.MouseEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setTooltip((t) => ({
      ...t,
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    }));
  };

  const hideTooltip = () => setTooltip((t) => ({ ...t, visible: false }));

  // =========================
  // Connector geometry + animation
  // =========================
  const leftSpineX = 120;
  const rightSpineX = vbWidth - 120;

  const gapFromLabel = 6;
  const dotRadius = 3.2;
  const dotToLineGap = 2;

  // "The following chart contains..." paragraph box
  const detailBoxW = 640;
  const detailBoxLeft = vbWidth / 2 - detailBoxW / 2;
  const detailBoxRight = vbWidth / 2 + detailBoxW / 2;

  // end cap closer to paragraph (but not touching)
  const endGapToParagraph = 10;
  const detailAnchorLeftX = detailBoxLeft - endGapToParagraph;
  const detailAnchorRightX = detailBoxRight + endGapToParagraph;
  const detailAnchorY = detailTextTop + 18;

  const [animNonce, setAnimNonce] = useState(0);

  const connector = useMemo(() => {
    if (selectedVerticalIdx === null) return null;

    const d = data[selectedVerticalIdx];
    const isPos = d.pct_change >= 0;

    const bbox = labelBBoxes[selectedVerticalIdx];
    if (!bbox) return null;

    const textLeft = bbox.x;
    const textRight = bbox.x + bbox.width;

    const startX = isPos
      ? textRight + gapFromLabel + dotRadius
      : textLeft - gapFromLabel - dotRadius;
    const startY = yCenter(selectedVerticalIdx);

    const spineX = isPos ? rightSpineX : leftSpineX;
    const endX = isPos ? detailAnchorRightX : detailAnchorLeftX;
    const endY = detailAnchorY;

    const pathStartX = isPos ? startX + dotToLineGap : startX - dotToLineGap;

    const path = `M ${pathStartX} ${startY}
                  L ${spineX} ${startY}
                  L ${spineX} ${endY}
                  L ${endX} ${endY}`;

    return { path, startX, startY, endX, endY };
  }, [
    selectedVerticalIdx,
    data,
    labelBBoxes,
    detailAnchorLeftX,
    detailAnchorRightX,
    detailAnchorY,
  ]);

  const maskStrokeRef = useRef<SVGPathElement | null>(null);
  const [maskLen, setMaskLen] = useState<number>(0);

  const animMs = 4200;
  const [endCapVisible, setEndCapVisible] = useState(false);

  useEffect(() => {
    if (!connector) return;

    const el = maskStrokeRef.current;
    if (!el) return;

    setEndCapVisible(false);

    try {
      const len = el.getTotalLength();
      setMaskLen(len);

      el.style.transition = "none";
      el.style.strokeDasharray = `${len}`;
      el.style.strokeDashoffset = `${len}`;
      el.getBoundingClientRect();

      requestAnimationFrame(() => {
        el.style.transition = `stroke-dashoffset ${animMs}ms ease`;
        el.style.strokeDashoffset = "0";
      });

      const t = window.setTimeout(() => setEndCapVisible(true), animMs);
      return () => window.clearTimeout(t);
    } catch {
      setMaskLen(0);
    }
  }, [connector?.path, animNonce]);

  const onSelectVertical = (i: number) => {
    setSelectedVerticalIdx(i);
    setAnimNonce((x) => x + 1);
  };

  const maskId = `connectorMask-${animNonce}`;

  // =========================
  // Advertiser chart
  // =========================
  const advertisers: AdvertiserDatum[] = useMemo(() => {
    if (!selectedVertical) return [];
    return advertiserByVertical[selectedVertical] ?? [];
  }, [selectedVertical, advertiserByVertical]);

  const advLeft = margin.left - 20;
  const advRight = margin.left + innerW + 20;
  const advW = advRight - advLeft;

  const advTop = advertiserChartTop + 56;
  const advBottom = advertiserChartTop + advertiserChartHeight - 24;
  const advH = advBottom - advTop;

  const maxImp = useMemo(() => {
    if (advertisers.length === 0) return 1;
    return Math.max(...advertisers.map((d) => d.impressions), 1);
  }, [advertisers]);

  const advN = advertisers.length;
  const advBand = advN > 0 ? advW / advN : advW;

  const advBarGap = 4;
  const advBarW = Math.max(10, Math.min(32, advBand - advBarGap));

  const advX = (i: number) =>
    advLeft + i * advBand + (advBand - advBarW) / 2;
  const advBarH = (imp: number) => (imp / maxImp) * advH;

  const selectedAdvertiser =
    selectedAdvertiserIdx === null ? null : advertisers[selectedAdvertiserIdx] ?? null;

  const advLabelX =
    selectedAdvertiserIdx === null ? 0 : advX(selectedAdvertiserIdx) + advBarW / 2;

  const advBarTopY =
    selectedAdvertiserIdx === null || !selectedAdvertiser
      ? 0
      : advBottom - advBarH(selectedAdvertiser.impressions);

  const labelGapAboveBar = 18;
  const advLabelY = advBarTopY - labelGapAboveBar;

  // =========================
  // Advertiser details + metrics
  // =========================
  const details =
    selectedAdvertiser && advertiserDetailsByName
      ? advertiserDetailsByName[selectedAdvertiser.advertiser] ?? null
      : null;

  const imp24 = details?.impressions_2h_2024 ?? null;
  const imp25 = details?.impressions_2h_2025 ?? (selectedAdvertiser?.impressions ?? null);
  const hh24 = details?.households_2h_2024 ?? null;
  const hh25 = details?.households_2h_2025 ?? null;
  const fq24 = details?.freq_2h_2024 ?? null;
  const fq25 = details?.freq_2h_2025 ?? null;

  const impPct = pctChange(imp24, imp25);
  const hhPct = pctChange(hh24, hh25);
  const fqPct = pctChange(fq24, fq25);

  const impMax = Math.max(imp24 ?? 0, imp25 ?? 0, 1);
  const hhMax = Math.max(hh24 ?? 0, hh25 ?? 0, 1);
  const fqMax = Math.max(fq24 ?? 0, fq25 ?? 0, 1);

  // Metric bar sizing (kept modest to fit + prevent clipping)
  const metricBarMaxPx = 110;
  const metricBarH = 18;

  const axisColor = "#6b7280";
  const barFill = "#d4d4d4";
  const barStroke = "#8a8a8a";

  // Bottom block: keep narrative wider than metrics, but not so wide that metrics clip
  const narrativeFlex = "1 1 60%";
  const metricsFlex = "0 0 60%";

  // Metrics columns: [2024 cell] [pct] [2025 cell]
  const metricGridCols = `${metricBarMaxPx + 108}px 74px ${metricBarMaxPx + 210}px`;

  return (
    <div className="w-full flex justify-center">
      <div ref={containerRef} className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${vbWidth} ${vbHeight}`}
          className="w-full h-auto"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={onMouseMove}
          onMouseLeave={hideTooltip}
          style={{ display: "block" }}
        >
          <text
            x={vbWidth / 2}
            y={24}
            textAnchor="middle"
            fontSize={18}
            fill="#111827"
            style={{ fontWeight: 600 }}
          >
            Percent Change in YOY TV Impressions for 2H, 2025
          </text>

          {/* Vertical chart */}
          {data.map((d, i) => {
            const y = yCenter(i) - barSize / 2;
            const x0 = xScale(0);
            const x1 = xScale(d.pct_change);

            const barX = Math.min(x0, x1);
            const barW = Math.abs(x1 - x0);

            const isPos = d.pct_change >= 0;
            const labelOffset = 12;
            const labelX = isPos ? x1 + labelOffset : x1 - labelOffset;
            const anchor = isPos ? "start" : "end";

            const isSelected = selectedVerticalIdx === i;

            return (
              <g key={d.vertical}>
                <rect
                  x={barX}
                  y={y}
                  width={barW}
                  height={barSize}
                  rx={2}
                  ry={2}
                  fill={colorFor(d.pct_change)}
                  fillOpacity={opacityFor(d.pct_change)}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectVertical(i)}
                  onMouseEnter={() =>
                    setTooltip({
                      visible: true,
                      x: tooltip.x,
                      y: tooltip.y,
                      text: tooltipTextFor(d.pct_change),
                    })
                  }
                  onMouseLeave={hideTooltip}
                />

                <text
                  ref={(el) => {
                    labelRefs.current[i] = el;
                  }}
                  x={labelX}
                  y={yCenter(i)}
                  fontSize={14}
                  fill="#111827"
                  dominantBaseline="middle"
                  textAnchor={anchor as any}
                  style={{ cursor: "pointer", fontWeight: isSelected ? 700 : 400 }}
                  onClick={() => onSelectVertical(i)}
                >
                  {d.vertical}
                </text>
              </g>
            );
          })}

          <line
            x1={xScale(0)}
            x2={xScale(0)}
            y1={zeroLineY1}
            y2={zeroLineY2}
            stroke="black"
            strokeWidth={1.0}
            shapeRendering="crispEdges"
          />

          {/* Connector */}
          {connector && (
            <g>
              <circle cx={connector.startX} cy={connector.startY} r={dotRadius} fill="black" />

              <defs>
                <mask
                  id={maskId}
                  maskUnits="userSpaceOnUse"
                  maskContentUnits="userSpaceOnUse"
                  x={0}
                  y={0}
                  width={vbWidth}
                  height={vbHeight}
                >
                  <rect x={0} y={0} width={vbWidth} height={vbHeight} fill="black" />
                  <path
                    ref={maskStrokeRef}
                    d={connector.path}
                    fill="none"
                    stroke="white"
                    strokeWidth={3.0}
                    strokeLinecap="round"
                    strokeDasharray={maskLen ? `${maskLen}` : undefined}
                    strokeDashoffset={maskLen ? `${maskLen}` : undefined}
                  />
                </mask>
              </defs>

              <path
                d={connector.path}
                fill="none"
                stroke="black"
                strokeWidth={1.4}
                strokeDasharray="2.5 5"
                strokeLinecap="round"
                mask={`url(#${maskId})`}
              />

              {endCapVisible ? <circle cx={connector.endX} cy={connector.endY} r={dotRadius} fill="black" /> : null}
            </g>
          )}

          {/* "The following chart contains..." paragraph */}
          {selectedVertical && (
            <foreignObject
              x={detailBoxLeft}
              y={detailTextTop}
              width={detailBoxW}
              height={detailTextHeight}
            >
              <div
                style={{
                  width: "100%",
                  fontSize: `${detailParaFontPx}px`,
                  lineHeight: "1.35",
                  color: "#111827",
                  textAlign: "center",
                  overflow: "visible",
                }}
              >
                <div>
                  The following chart contains the top 25 advertisers in the{" "}
                  <span style={{ fontWeight: 700 }}>{selectedVertical}</span> vertical based on the number of TV ad
                  impressions served from July through December of 2025. Hover over each bar see the name of each
                  advertiser and select the bar to view more details.
                </div>
              </div>
            </foreignObject>
          )}

          {/* Advertiser bar chart */}
          {selectedVertical && advertisers.length > 0 && (
            <g>
              <line x1={advLeft} x2={advRight} y1={advBottom} y2={advBottom} stroke="black" strokeWidth={0.7} />

              {advertisers.map((a, i) => {
                const h = advBarH(a.impressions);
                const x = advX(i);
                const y = advBottom - h;
                const isSelected = selectedAdvertiserIdx === i;

                return (
                  <rect
                    key={`${a.advertiser}-${i}`}
                    x={x}
                    y={y}
                    width={advBarW}
                    height={h}
                    rx={2}
                    ry={2}
                    fill={isSelected ? "#3b82f6" : "#bdbdbd"}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() =>
                      setTooltip({
                        visible: true,
                        x: tooltip.x,
                        y: tooltip.y,
                        text: a.advertiser,
                      })
                    }
                    onMouseLeave={hideTooltip}
                    onClick={() => setSelectedAdvertiserIdx(i)}
                  />

                );
              })}

              {selectedAdvertiser && selectedAdvertiserIdx !== null && (
                <g>
                  <line
                    x1={advLabelX}
                    x2={advLabelX}
                    y1={advBarTopY}
                    y2={advLabelY + 6}
                    stroke="#3b82f6"
                    strokeWidth={1.2}
                    strokeDasharray="2.5 4"
                  />
                  <circle cx={advLabelX} cy={advLabelY + 6} r={2.8} fill="#3b82f6" />
                  <text
                    x={advLabelX}
                    y={advLabelY}
                    textAnchor="middle"
                    fontSize={13}
                    fill="#3b82f6"
                    style={{ fontWeight: 600 }}
                  >
                    {selectedAdvertiser.advertiser}
                  </text>
                </g>
              )}
            </g>
          )}

          {/* Bottom advertiser detail + metrics
              IMPORTANT: full-width foreignObject to prevent clipping */}
          {selectedAdvertiser && selectedVertical && (
            <foreignObject x={0} y={advertiserDetailTop} width={vbWidth} height={advertiserDetailHeight}>
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  gap: "26px",
                  alignItems: "flex-start",
                  color: "#111827",
                  paddingLeft: "200px",   // extended left; does NOT need to align with chart margin
                  paddingRight: "200px",
                  boxSizing: "border-box",
                }}
              >
                {/* Bottom narrative (match font size to paragraph above) */}
                <div
                  style={{
                    flex: narrativeFlex,
                    fontSize: `${bottomNarrativeFontPx}px`,
                    lineHeight: "1.35",
                    marginTop: "34px",   // aligns top of paragraph with top of "Impressions Served" bar
                  }}
                >     
                  <div style={{ marginBottom: "8px" }}>
                    <span style={{ fontWeight: 700 }}>{selectedAdvertiser.advertiser}</span> served{" "}
                    <span style={{ fontWeight: 700 }}>{fmtInt(imp25)}</span> impressions in 2H, 2025, a{" "}
                    <span style={{ fontWeight: 700 }}>{fmtPct(impPct)}</span>{" "}
                    {impPct !== null && impPct >= 0 ? "increase" : "decrease"} over the same period in 2024. This media
                    activity reached <span style={{ fontWeight: 700 }}>{fmtInt(hh25)}</span> households with an average
                    household frequency of{" "}
                    <span style={{ fontWeight: 700 }}>
                      {fq25 !== null && fq25 !== undefined && Number.isFinite(fq25) ? fq25.toFixed(1) : "—"}
                    </span>{" "}
                    impressions per household.
                  </div>
                </div>

                {/* Right metric block */}
                <div style={{ flex: metricsFlex, fontSize: "13px", minWidth: "420px" }}>
                  {/* Center year headers above bars */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: metricGridCols,
                      alignItems: "end",
                      marginBottom: "10px",
                    }}
                  >
                    <div style={{ textAlign: "center", fontWeight: 700 }}>2H, 2024</div>
                    <div />
                    <div style={{ textAlign: "center", fontWeight: 700 }}>2H, 2025</div>
                  </div>

                  {[
                    {
                      key: "imp",
                      leftVal: imp24,
                      rightVal: imp25,
                      max: impMax,
                      pct: impPct,
                      leftTxt: fmtMM(imp24),
                      rightTxt: fmtMM(imp25),
                      axisLabel: "Impressions Served",
                    },
                    {
                      key: "hh",
                      leftVal: hh24,
                      rightVal: hh25,
                      max: hhMax,
                      pct: hhPct,
                      leftTxt: fmtMM(hh24),
                      rightTxt: fmtMM(hh25),
                      axisLabel: "Households Reached",
                    },
                    {
                      key: "fq",
                      leftVal: fq24,
                      rightVal: fq25,
                      max: fqMax,
                      pct: fqPct,
                      leftTxt: fq24 !== null && fq24 !== undefined && Number.isFinite(fq24) ? fq24.toFixed(1) : "—",
                      rightTxt: fq25 !== null && fq25 !== undefined && Number.isFinite(fq25) ? fq25.toFixed(1) : "—",
                      axisLabel: "Average Frequency",
                    },
                  ].map((row) => {
                    const leftW = toWidthPx(row.leftVal, row.max, metricBarMaxPx);
                    const rightW = toWidthPx(row.rightVal, row.max, metricBarMaxPx);
                    const pctColor = row.pct !== null && row.pct >= 0 ? "#16a34a" : "#dc2626";

                    return (
                      <div
                        key={row.key}
                        style={{
                          display: "grid",
                          gridTemplateColumns: metricGridCols,
                          alignItems: "center",
                          marginBottom: "12px",
                        }}
                      >
                        {/* 2H 2024: number adjacent to bar; bar ends at axis (right) */}
                        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "10px" }}>
                          <div style={{ textAlign: "right", minWidth: "84px" }}>{row.leftTxt}</div>

                          <div style={{ position: "relative", height: `${metricBarH}px`, width: `${metricBarMaxPx}px` }}>
                            <div
                              style={{
                                position: "absolute",
                                top: -4,
                                bottom: -4,
                                right: 0,
                                width: "1px",
                                background: axisColor,
                              }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                right: 0,
                                top: 0,
                                height: `${metricBarH}px`,
                                width: `${leftW}px`,
                                background: barFill,
                                border: `1px solid ${barStroke}`,
                                boxSizing: "border-box",
                              }}
                            />
                          </div>
                        </div>

                        {/* pct */}
                        <div style={{ textAlign: "center", fontWeight: 700, color: pctColor }}>{fmtPct(row.pct)}</div>

                        {/* 2H 2025: bar starts at axis (left); label sits next to the BAR END (dynamic) */}
<div style={{ display: "flex", justifyContent: "flex-start", alignItems: "center" }}>
  <div
    style={{
      position: "relative",
      height: `${metricBarH}px`,
      width: `${metricBarMaxPx}px`,
      overflow: "visible",
    }}
  >
    {/* axis line */}
    <div
      style={{
        position: "absolute",
        top: -4,
        bottom: -4,
        left: 0,
        width: "1px",
        background: axisColor,
      }}
    />

    {/* bar */}
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        height: `${metricBarH}px`,
        width: `${rightW}px`,
        background: barFill,
        border: `1px solid ${barStroke}`,
        boxSizing: "border-box",
      }}
    />

    {/* label pinned to end of the bar */}
    <div
      style={{
        position: "absolute",
        top: "50%",
        transform: "translateY(-50%)",
        left: `${rightW + 12}px`,   // <-- this is what makes it adjacent to the bar end
        whiteSpace: "nowrap",
      }}
    >
      <span>{row.rightTxt}</span>
      <span style={{ fontWeight: 700, marginLeft: "6px" }}>{row.axisLabel}</span>
    </div>
  </div>
</div>

                      </div>
                    );
                  })}
                </div>
              </div>
            </foreignObject>
          )}
        </svg>

        {/* Tooltip */}
        {tooltip.visible && (
          <div
            className="pointer-events-none absolute z-10 rounded-md bg-black/85 px-3 py-2 text-sm text-white shadow"
            style={{
              left: clamp(tooltip.x + 12, 8, Math.max(8, containerPx.w - 260)),
              top: clamp(tooltip.y + 12, 8, Math.max(8, containerPx.h - 40)),
              maxWidth: 420,
            }}
          >
            {tooltip.text}
          </div>
        )}
      </div>
    </div>
  );
}
