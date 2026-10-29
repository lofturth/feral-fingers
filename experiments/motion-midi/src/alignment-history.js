// Connect measured samples linearly. Null events break the trace; never extend it
// beyond the latest measured orientation.
export function alignmentSegments(events, start, end) {
  const segments = []
  let previous = null
  let segment = null
  for (const event of events) {
    if (event.t < start) { previous = event; continue }
    if (event.t > end) break
    if (event.value === null) { segment = null; previous = event; continue }
    if (!segment) {
      segment = []
      segments.push(segment)
      if (previous && previous.value !== null && previous.t < start && event.t > previous.t) {
        const fraction = (start - previous.t) / (event.t - previous.t)
        segment.push({ t: start, value: previous.value + fraction * (event.value - previous.value) })
      }
    }
    segment.push({ t: event.t, value: event.value })
    previous = event
  }
  return segments
}
