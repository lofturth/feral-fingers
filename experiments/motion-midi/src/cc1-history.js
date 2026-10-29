// Null values end a trace: a disconnect must not extend the last known output.
export function traceSegments(events, start, end) {
  const segments = []
  let value = null
  let segment = null
  for (const event of events) {
    if (event.t <= start) value = event.value
    else break
  }
  if (value !== null) { segment = [{ t: start, value }]; segments.push(segment) }
  for (const event of events) {
    if (event.t <= start) continue
    if (event.t > end) break
    if (segment) segment.push({ t: event.t, value })
    if (event.value === null) { segment = null; value = null; continue }
    if (!segment) { segment = []; segments.push(segment) }
    value = event.value
    segment.push({ t: event.t, value })
  }
  if (segment) segment.push({ t: end, value })
  return segments
}
