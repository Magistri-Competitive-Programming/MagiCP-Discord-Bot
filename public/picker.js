let activePicker

export function closePicker() {
  activePicker?.close()
}

document.addEventListener('pointerdown', event => {
  if (activePicker && !activePicker.root.contains(event.target)) closePicker()
})

export function renderPicker(root, choices, selected, { name, multiple = false, placeholder = 'Seleziona…', onChange } = {}) {
  if (activePicker?.root === root) closePicker()
  const selectedIds = new Set(multiple ? selected : [selected])
  const toggle = document.createElement('button')
  const value = document.createElement('span')
  const list = document.createElement('div')
  const inputs = document.createElement('span')
  toggle.type = 'button'
  toggle.className = 'picker-toggle'
  toggle.disabled = !choices.length
  toggle.setAttribute('aria-haspopup', 'listbox')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-controls', `${root.id}-menu`)
  toggle.setAttribute('aria-labelledby', `${root.id}-label ${root.id}-value`)
  value.id = `${root.id}-value`
  toggle.append(value)
  list.id = `${root.id}-menu`
  list.className = 'picker-menu'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-labelledby', `${root.id}-label`)
  if (multiple) list.setAttribute('aria-multiselectable', 'true')
  list.hidden = true

  let prefix = ''
  let lastKey = 0
  const options = choices.map(({ id, name: label }) => {
    const option = document.createElement('button')
    option.type = 'button'
    option.tabIndex = -1
    option.className = 'picker-option'
    option.setAttribute('role', 'option')
    option.textContent = label
    option.addEventListener('click', () => {
      if (!multiple) selectedIds.clear()
      if (selectedIds.has(id)) selectedIds.delete(id)
      else selectedIds.add(id)
      update()
      if (!multiple) close(true)
      onChange?.(id)
    })
    return option
  })

  function update() {
    const chosen = choices.filter(({ id }, index) => {
      const checked = selectedIds.has(id)
      options[index].setAttribute('aria-selected', String(checked))
      return checked
    })
    value.textContent = chosen.length > 1 ? `${chosen.length} selezionati` : chosen[0]?.name ?? placeholder
    value.title = chosen.map(choice => choice.name).join(', ')
    if (name) {
      inputs.replaceChildren(...chosen.map(({ id }) => {
        const input = document.createElement('input')
        input.type = 'hidden'
        input.name = name
        input.value = id
        return input
      }))
    }
  }

  function close(returnFocus = false) {
    activePicker = undefined
    list.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
    if (returnFocus) toggle.focus()
  }

  function open(fromEnd = false) {
    if (toggle.disabled || !list.hidden) return
    closePicker()
    activePicker = { root, close }
    const bounds = toggle.getBoundingClientRect()
    root.classList.toggle('picker-up', bounds.bottom + 225 > innerHeight && bounds.top >= 225)
    list.hidden = false
    toggle.setAttribute('aria-expanded', 'true')
    prefix = ''
    const selectedOption = options.find(option => option.getAttribute('aria-selected') === 'true')
    const first = selectedOption ?? (fromEnd ? options.at(-1) : options[0])
    first.focus()
  }

  toggle.addEventListener('click', () => list.hidden ? open() : close(true))
  toggle.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    open(event.key === 'ArrowUp')
  })
  list.addEventListener('keydown', event => {
    const index = options.indexOf(document.activeElement)
    const navigation = { ArrowUp: Math.max(index - 1, 0), ArrowDown: index + 1, Home: 0, End: options.length - 1 }
    if (Object.hasOwn(navigation, event.key)) {
      event.preventDefault()
      options[Math.min(navigation[event.key], options.length - 1)].focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now()
      prefix = (now - lastKey < 700 ? prefix : '') + event.key.toLowerCase()
      lastKey = now
      options.find(option => option.textContent.toLowerCase().replace(/^#/, '').startsWith(prefix))?.focus()
    }
  })
  root.onfocusout = event => {
    if (activePicker?.root === root && !root.contains(event.relatedTarget)) close()
  }
  list.append(...options)
  update()
  root.replaceChildren(toggle, list, inputs)
}
