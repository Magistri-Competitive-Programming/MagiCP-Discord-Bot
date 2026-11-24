export function svgNode(tag, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
  return node
}

export function icon(name) {
  const svg = svgNode('svg', { class: 'icon', 'aria-hidden': 'true', focusable: 'false' })
  svg.append(svgNode('use', { href: '/icons.svg#' + name }))
  return svg
}
