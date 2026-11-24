import { svgNode } from './graphics.js'

const numbers = new Intl.NumberFormat('it-IT')
const chartDay = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })

function part(tag, className, content) {
  const node = document.createElement(tag)
  node.className = className
  if (content !== undefined) node.textContent = content
  return node
}

function axisStep(peak) {
  const rough = Math.max(1, peak / 3)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  return [1, 2, 5, 10].find(unit => unit * magnitude >= rough) * magnitude
}

export function renderActivity(activity) {
  const chart = document.getElementById('activity-chart')
  const total = activity.reduce((sum, point) => sum + point.total, 0)
  document.getElementById('activity-total').textContent = numbers.format(total)
  document.getElementById('activity-caption').textContent = total === 1 ? 'ricevuta nel periodo' : 'ricevute nel periodo'
  chart.replaceChildren()
  if (!activity.length) return

  const width = 800
  const height = 138
  const step = axisStep(Math.max(...activity.map(point => point.total)))
  const top = step * 3
  const axis = part('div', 'chart-axis')
  axis.setAttribute('aria-hidden', 'true')
  for (const tick of [top, step * 2, step, 0]) axis.append(part('span', '', numbers.format(tick)))

  const plot = part('div', 'plot')
  const svg = svgNode('svg', { viewBox: '0 0 800 138', preserveAspectRatio: 'none', 'aria-hidden': 'true' })
  const defs = svgNode('defs')
  const gradient = svgNode('linearGradient', { id: 'activity-fill', x2: 0, y2: 1, gradientUnits: 'objectBoundingBox' })
  gradient.append(svgNode('stop', { offset: 0, 'stop-color': 'currentColor', 'stop-opacity': '.26' }),
    svgNode('stop', { offset: 1, 'stop-color': 'currentColor', 'stop-opacity': '.025' }))
  defs.append(gradient)
  svg.append(defs)
  for (const fraction of [0, 1/3, 2/3, 1]) {
    svg.append(svgNode('line', { class: 'grid-line', x1: 0, x2: width, y1: height * fraction, y2: height * fraction }))
  }

  const columnWidth = width / activity.length
  const points = activity.map(({ total }, i) => ({
    x: columnWidth * (i + .5), y: height * (1 - total / top)
  }))
  const first = points[0]
  // Horizontal tangents at extrema keep the curve within the measured daily totals.
  const deltas = points.slice(1).map((point, i) => point.y - points[i].y)
  const tangent = i => {
    if (i === 0) return deltas[0]
    if (i === deltas.length) return deltas.at(-1)
    const before = deltas[i - 1]
    const after = deltas[i]
    return before * after > 0 ? 2 * before * after / (before + after) : 0
  }
  let line = 'M ' + first.x + ' ' + first.y
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]
    const current = points[i]
    const start = [previous.x + columnWidth / 3, previous.y + tangent(i - 1) / 3]
    const end = [current.x - columnWidth / 3, current.y - tangent(i) / 3]
    line += ` C ${start} ${end} ${current.x},${current.y}`
  }
  const last = points.at(-1)
  svg.append(svgNode('path', { d: line + ' V ' + height + ' H ' + first.x + ' Z', fill: 'url(#activity-fill)' }),
    svgNode('path', { class: 'trend-line', d: line }))
  const cursor = svgNode('line', { class: 'cursor-line', y1: 0, y2: height, visibility: 'hidden' })
  const point = svgNode('path', { class: 'point', visibility: 'hidden' })
  svg.append(cursor, point)

  const days = part('div', 'chart-days')
  const dates = part('div', 'chart-dates')
  dates.setAttribute('aria-hidden', 'true')
  const tip = part('div', 'chart-tip')
  tip.setAttribute('aria-hidden', 'true')
  tip.hidden = true
  let focused = -1
  let hovered = -1
  let shown = -1
  function showDay() {
    const index = hovered >= 0 ? hovered : focused
    if (index === shown) return
    shown = index
    point.setAttribute('visibility', index < 0 ? 'hidden' : 'visible')
    if (index < 0) {
      tip.hidden = true
      cursor.setAttribute('visibility', 'hidden')
      return
    }
    const { x, y } = points[index]
    point.setAttribute('d', 'M ' + x + ' ' + y + ' h .01')
    cursor.setAttribute('x1', x)
    cursor.setAttribute('x2', x)
    cursor.setAttribute('visibility', 'visible')
    tip.textContent = days.children[index].getAttribute('aria-label')
    days.children[index].append(tip)
    tip.hidden = false
  }
  activity.forEach(({ day, total }, index) => {
    const date = chartDay.format(new Date(day))
    const target = part('button', 'chart-day')
    target.type = 'button'
    target.tabIndex = index === 0 ? 0 : -1
    target.setAttribute('aria-label', date + ' · ' + numbers.format(total) + (total === 1 ? ' candidatura' : ' candidature'))
    target.addEventListener('pointerenter', () => { hovered = index; showDay() })
    target.addEventListener('pointerleave', () => { hovered = -1; showDay() })
    target.addEventListener('focus', () => {
      focused = index
      for (const button of days.children) button.tabIndex = button === target ? 0 : -1
      showDay()
    })
    target.addEventListener('blur', () => { focused = -1; showDay() })
    target.addEventListener('click', () => target.focus())
    target.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        hovered = focused = -1
        showDay()
        return
      }
      const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: activity.length - 1 }[event.key]
      if (next === undefined) return
      event.preventDefault()
      hovered = -1
      days.children[Math.max(0, Math.min(next, activity.length - 1))].focus()
    })
    days.append(target)
    const caption = part('span', 'chart-date', date)
    dates.append(caption)
  })
  plot.append(svg, days)
  chart.append(axis, plot, dates)
}

export function renderDistribution(counts) {
  const states = [
    ['pending', 'Da valutare', (counts.pending ?? 0) + (counts.processing ?? 0)],
    ['accepted', 'Accettate', counts.accepted ?? 0],
    ['external', 'Esterni', counts.external ?? 0],
    ['rejected', 'Rifiutate', counts.rejected ?? 0]
  ]
  const total = states.reduce((sum, [, , count]) => sum + count, 0)
  const ring = document.getElementById('state-ring')
  const track = ring.querySelector('.track')
  ring.replaceChildren(track)
  let offset = 0
  const rows = states.map(([status, label, count]) => {
    if (count) {
      const fraction = count / total * 100
      const gap = count === total ? 0 : Math.min(1.2, fraction / 3)
      ring.append(svgNode('circle', {
        class: 'segment ' + status, cx: 60, cy: 60, r: 51, pathLength: 100,
        'stroke-dasharray': (fraction - gap) + ' ' + (100 - fraction + gap),
        'stroke-dashoffset': -(offset + gap / 2)
      }))
      offset += fraction
    }
    const row = part('li', status)
    row.append(part('span', 'swatch'), part('span', 'legend-label', label), part('strong', '', numbers.format(count)))
    return row
  })
  const value = document.getElementById('state-total')
  value.textContent = numbers.format(total)
  value.classList.toggle('long-total', value.textContent.length > 5)
  document.getElementById('breakdown').replaceChildren(...rows)
}
