export function visibleSegments(history, field, start, end) {
  const segments = []
  let current = null
  let previous = null
  for (const point of history) {
    if (point.t < start) { previous = point; continue }
    if (point.t > end) break
    if (point[field] === null) { current = null; previous = point; continue }
    if (!current) {
      current = []
      segments.push(current)
      if (previous && previous[field] !== null) current.push({ t: start, value: previous[field] })
    }
    current.push({ t: point.t, value: point[field] })
    previous = point
  }
  if (current && previous && previous[field] !== null && previous.t < end) current.push({ t: end, value: previous[field] })
  else if (!segments.length && previous && previous.t < start && previous[field] !== null) {
    segments.push([{ t: start, value: previous[field] }, { t: end, value: previous[field] }])
  }
  return segments
}
