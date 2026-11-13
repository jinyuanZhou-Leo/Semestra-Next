/**
 * Props for a ring chart's `ChartTooltip` that keep it in one place, just below the chart,
 * instead of following the pointer: a ring is smaller than its tooltip, which would otherwise
 * cover the figure in the ring's middle while hovering.
 */
export function pinnedTooltipBelow(chartHeight: number) {
  return {
    position: { x: 0, y: chartHeight + 8 },
    // Its place never changes; animated, it slides down from the chart's top each time it appears.
    isAnimationActive: false,
    allowEscapeViewBox: { x: true, y: true },
    wrapperStyle: { zIndex: 10 },
  } as const
}
