import { closePicker, renderPicker } from './picker.js'

const byId = id => document.getElementById(id)
const loginForm = byId('login-form')
const settingsForm = byId('settings-form')
const fields = byId('settings-fields')
const nav = [...document.querySelectorAll('[data-view]')]
const dark = matchMedia('(prefers-color-scheme: dark)')
const day = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeZone: 'Europe/Rome' })
const chartDay = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const numbers = new Intl.NumberFormat('it-IT')
const titles = { panoramica: 'Panoramica', candidature: 'Candidature', configurazione: 'Configurazione' }
const filters = [
  { id: '', name: 'Tutti gli stati' },
  { id: 'pending', name: 'In attesa' },
  { id: 'processing', name: 'In elaborazione' },
  { id: 'accepted', name: 'Accettata' },
  { id: 'external', name: 'Accettata come esterno' },
  { id: 'rejected', name: 'Rifiutata' }
]
const deleteDialog = byId('delete-dialog')
let state
let authenticated = false
let viewVersion = 0
let listingVersion = 0
let applicationStatus = ''
let applicationPage = 1
let applicationQuery = ''
let deleteTarget

function currentTheme() {
  return localStorage.getItem('magicp-theme') ?? (dark.matches ? 'dark' : 'light')
}

function renderTheme() {
  const isDark = currentTheme() === 'dark'
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
  byId('theme').textContent = isDark ? '☀' : '☾'
  byId('theme').title = isDark ? 'Attiva tema chiaro' : 'Attiva tema scuro'
  byId('theme').setAttribute('aria-label', byId('theme').title)
}

function message(id, value = '', success = false) {
  const element = byId(id)
  element.textContent = value
  element.classList.toggle('success', success)
  element.hidden = !value
}

function showLogin() {
  authenticated = false
  state = undefined
  viewVersion++
  closePicker()
  if (deleteDialog.open) deleteDialog.close()
  byId('request-list').replaceChildren()
  byId('application-rows').replaceChildren()
  byId('application-search').reset()
  applicationStatus = ''
  applicationPage = 1
  applicationQuery = ''
  renderStatusPicker()
  byId('guild-name').textContent = 'Discord'
  for (const picker of settingsForm.querySelectorAll('.picker')) picker.replaceChildren()
  byId('panel-link').removeAttribute('href')
  byId('verification-action').removeAttribute('href')
  byId('loading').hidden = true
  byId('workspace').hidden = true
  byId('login-page').hidden = false
  loginForm.reset()
}

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify(body) : undefined
  })
  if (response.status === 204) return
  const data = await response.json()
  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      showLogin()
      message('login-error', 'Sessione scaduta. Accedi di nuovo.')
    }
    throw new Error(data.error || 'Impossibile contattare il pannello.')
  }
  return data
}

function element(tag, text, className) {
  const node = document.createElement(tag)
  if (text) node.textContent = text
  if (className) node.className = className
  return node
}

function requestRow(request, allowDelete = false) {
  const row = element('tr')
  const date = day.format(request.createdAt)
  const candidate = element('td', request.name)
  candidate.append(element('small', `${request.profile} · ${date}`, 'request-meta'))
  const status = element('td')
  status.append(element('span', request.label, `status ${request.status}`))
  if (request.error) status.append(element('small', request.error))
  const action = element('td')
  const actions = element('div', '', 'row-actions')
  if (request.url) {
    const link = element('a', '↗', 'request-link')
    link.href = request.url
    link.target = '_blank'
    link.rel = 'noopener'
    link.setAttribute('aria-label', `Apri la candidatura di ${request.name} su Discord`)
    link.title = 'Apri su Discord'
    actions.append(link)
  }
  if (allowDelete && request.canDelete) {
    const remove = element('button', '', 'request-link delete-action')
    remove.type = 'button'
    remove.append(element('span', '', 'trash-icon'))
    remove.setAttribute('aria-label', `Elimina la candidatura di ${request.name}`)
    remove.title = 'Elimina candidatura'
    remove.addEventListener('click', () => {
      deleteTarget = request
      byId('delete-description').textContent = request.url
        ? `Verranno eliminati i dati della candidatura di ${request.name} e il messaggio nel canale Discord dello staff.`
        : `Verranno eliminati i dati della candidatura di ${request.name}.`
      message('delete-error')
      deleteDialog.showModal()
    })
    actions.append(remove)
  }
  action.append(actions)
  row.append(candidate, element('td', request.profile, 'request-profile'), status,
    element('td', date, 'request-date'), action)
  return row
}

function renderActivity(activity) {
  const levels = 8
  const peak = Math.max(levels, ...activity.map(point => point.total))
  byId('activity-total').textContent = numbers.format(activity.reduce((total, point) => total + point.total, 0))
  byId('activity-chart').replaceChildren(...activity.map(({ day: date, total }) => {
    const column = element('div', '', 'chart-day')
    const label = chartDay.format(new Date(date))
    const count = Math.ceil(total / peak * levels)
    const detail = `${label} · ${total} ${total === 1 ? 'candidatura' : 'candidature'}`
    column.tabIndex = 0
    const cells = element('div', '', 'chart-cells')
    cells.setAttribute('aria-hidden', 'true')
    cells.append(...Array.from({ length: levels }, (_, index) =>
      element('span', '', index >= levels - count ? 'chart-cell filled' : 'chart-cell')))
    const caption = element('span', label, 'chart-date')
    const tip = element('span', detail, 'chart-tip')
    caption.setAttribute('aria-hidden', 'true')
    tip.setAttribute('aria-hidden', 'true')
    column.append(cells, element('span', detail, 'sr-only'), caption, tip)
    return column
  }))
}

function renderOverview() {
  const { counts, recent, errors, bot, activity } = state
  byId('guild-name').textContent = bot.guildName ?? 'Discord'
  byId('connection-label').textContent = bot.ready ? 'Discord connesso' : 'Discord scollegato'
  byId('connection-dot').classList.toggle('online', bot.ready)
  const statuses = [
    ['pending', 'Da valutare', (counts.pending ?? 0) + (counts.processing ?? 0)],
    ['accepted', 'Accettate', counts.accepted ?? 0],
    ['external', 'Esterni', counts.external ?? 0],
    ['rejected', 'Rifiutate', counts.rejected ?? 0]
  ]
  const total = statuses.reduce((sum, [, , count]) => sum + count, 0)
  byId('breakdown').replaceChildren(...statuses.map(([status, label, count]) => {
    byId(`count-${status}`).textContent = numbers.format(count)
    const row = element('li', '', status)
    const bar = element('progress')
    bar.max = total || 1
    bar.value = count
    bar.setAttribute('aria-label', label)
    row.append(element('span', label), element('strong', numbers.format(count)), bar)
    return row
  }))
  renderActivity(activity)
  message('queue-error', errors ? 'Alcune operazioni Discord sono in attesa di un nuovo tentativo. Controlla i dettagli nelle candidature.' : '')
  byId('request-list').replaceChildren(...recent.map(request => requestRow(request)))
  byId('recent-table').hidden = !recent.length
  byId('recent-empty').hidden = Boolean(recent.length)
  renderPublish()
}

function renderPublish() {
  const { settings, panel, bot, guildId } = state
  const hasCurrentPanel = panel && panel.channel === settings.verificationChannel
  byId('publish').disabled = !bot.ready || !settings.verificationChannel
  byId('publish').textContent = hasCurrentPanel ? 'Aggiorna messaggio' : 'Pubblica messaggio'
  byId('publish-description').textContent = hasCurrentPanel ? 'Il pulsante di verifica è pubblicato su Discord.' :
    settings.verificationChannel ? 'Pubblica il pulsante nel canale di verifica configurato.' :
      'Salva la configurazione per pubblicare il pulsante su Discord.'
  byId('panel-link').hidden = !hasCurrentPanel
  const discordUrl = hasCurrentPanel ? `https://discord.com/channels/${guildId}/${panel.channel}/${panel.message}` : null
  if (discordUrl) byId('panel-link').href = discordUrl
  const action = byId('verification-action')
  const arrow = element('span', '↗')
  arrow.setAttribute('aria-hidden', 'true')
  action.replaceChildren(discordUrl ? 'Apri su Discord' : 'Configura la verifica', arrow)
  action.href = discordUrl ?? '#configurazione'
  action.target = discordUrl ? '_blank' : ''
  action.rel = discordUrl ? 'noopener' : ''
}

function renderOptions({ channels, roles }) {
  const { settings } = state
  const assignable = roles.filter(role => role.assignable)
  const channelChoices = channels.map(({ id, name }) => ({ id, name: `#${name}` }))
  for (const name of ['verificationChannel', 'reviewChannel']) {
    renderPicker(byId(name), channelChoices, settings[name], { name })
  }
  renderPicker(byId('externalRole'), assignable, settings.externalRole, { name: 'externalRole' })
  renderPicker(byId('approvalRoles'), assignable, settings.approvalRoles, {
    name: 'approvalRoles', multiple: true, placeholder: 'Seleziona ruoli…'
  })
  renderPicker(byId('reviewerRoles'), roles, settings.reviewerRoles, {
    name: 'reviewerRoles', multiple: true, placeholder: 'Solo amministratori'
  })
  fields.disabled = false
}

function renderStatusPicker() {
  renderPicker(byId('status-picker'), filters, applicationStatus, {
    onChange(status) {
      applicationStatus = status
      applicationPage = 1
      message('application-message')
      void loadApplications()
    }
  })
}

async function loadApplications() {
  const view = viewVersion
  const version = ++listingVersion
  const params = new URLSearchParams({ status: applicationStatus, query: applicationQuery, page: applicationPage })
  byId('applications').setAttribute('aria-busy', 'true')
  try {
    const { items, total, pages, page } = await api(`applications?${params}`)
    if (view !== viewVersion || version !== listingVersion) return
    applicationPage = page
    byId('application-rows').replaceChildren(...items.map(request => requestRow(request, true)))
    byId('applications-table').hidden = !items.length
    byId('applications-empty').hidden = Boolean(items.length)
    byId('application-count').textContent = `${numbers.format(total)} ${total === 1 ? 'candidatura' : 'candidature'}`
    byId('pager').hidden = pages < 2
    byId('page-number').textContent = `Pagina ${page} di ${pages}`
    byId('previous-page').disabled = page <= 1
    byId('next-page').disabled = page >= pages
  } catch (error) {
    if (view === viewVersion && version === listingVersion) message('application-message', error.message)
  } finally {
    if (version === listingVersion) byId('applications').removeAttribute('aria-busy')
  }
}

async function loadView() {
  if (!authenticated) return
  const version = ++viewVersion
  closePicker()
  if (deleteDialog.open) deleteDialog.close()
  const hash = location.hash.slice(1)
  const view = Object.hasOwn(titles, hash) ? hash : 'panoramica'
  byId('overview').hidden = view !== 'panoramica'
  byId('overview-actions').hidden = view !== 'panoramica'
  byId('applications').hidden = view !== 'candidature'
  byId('settings').hidden = view !== 'configurazione'
  byId('page-title').textContent = titles[view]
  byId('breadcrumb').textContent = titles[view]
  for (const link of nav) {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  fields.disabled = true
  byId('refresh').disabled = true
  byId('publish').disabled = true
  message('app-error')
  message('settings-message')
  message('application-message')
  try {
    const overview = await api('overview')
    if (version !== viewVersion) return
    state = overview
    renderOverview()
    if (view === 'candidature') await loadApplications()
    if (view === 'configurazione' && !state.bot.ready) {
      message('settings-message', 'Collega il bot al server Discord per caricare canali e ruoli.')
    } else if (view === 'configurazione') {
      const options = await api('options')
      if (version === viewVersion) renderOptions(options)
    }
  } catch (error) {
    if (version === viewVersion) message('app-error', error.message)
  } finally {
    if (version === viewVersion) byId('refresh').disabled = false
  }
}

async function showWorkspace() {
  authenticated = true
  byId('loading').hidden = true
  byId('login-page').hidden = true
  byId('workspace').hidden = false
  await loadView()
}

byId('theme').addEventListener('click', () => {
  localStorage.setItem('magicp-theme', currentTheme() === 'dark' ? 'light' : 'dark')
  renderTheme()
})
dark.addEventListener('change', renderTheme)
renderTheme()
window.addEventListener('hashchange', loadView)
byId('refresh').addEventListener('click', loadView)

renderStatusPicker()
byId('application-search').addEventListener('submit', event => {
  event.preventDefault()
  applicationQuery = byId('query').value.trim()
  applicationPage = 1
  message('application-message')
  void loadApplications()
})
byId('previous-page').addEventListener('click', () => {
  applicationPage--
  void loadApplications()
})
byId('next-page').addEventListener('click', () => {
  applicationPage++
  void loadApplications()
})

const deleteButton = byId('confirm-delete')
const cancelDelete = byId('cancel-delete')
cancelDelete.addEventListener('click', () => deleteDialog.close())
deleteDialog.addEventListener('cancel', event => {
  if (deleteButton.disabled) event.preventDefault()
})
deleteDialog.addEventListener('close', () => {
  deleteTarget = undefined
  byId('delete-description').textContent = ''
})
byId('delete-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (!deleteTarget || deleteButton.disabled) return
  const { id } = deleteTarget
  const version = viewVersion
  deleteButton.disabled = cancelDelete.disabled = true
  message('delete-error')
  try {
    await api(`applications/${encodeURIComponent(id)}`, undefined, 'DELETE')
    if (version !== viewVersion) return
    deleteDialog.close()
    message('application-message', 'Candidatura eliminata.', true)
    await loadApplications()
    if (version === viewVersion) byId('query').focus({ preventScroll: true })
  } catch (error) {
    if (version === viewVersion) message('delete-error', error.message)
  } finally {
    deleteButton.disabled = cancelDelete.disabled = false
  }
})

loginForm.addEventListener('submit', async event => {
  event.preventDefault()
  const button = loginForm.querySelector('button')
  const body = Object.fromEntries(new FormData(loginForm))
  button.disabled = true
  message('login-error')
  try {
    await api('login', body)
    loginForm.reset()
    await showWorkspace()
  } catch (error) {
    message('login-error', error.message)
  } finally {
    button.disabled = false
  }
})

byId('logout').addEventListener('click', async () => {
  try {
    await api('logout', {})
    showLogin()
  } catch (error) {
    if (authenticated) message('app-error', error.message)
  }
})

settingsForm.addEventListener('submit', async event => {
  event.preventDefault()
  closePicker()
  const data = new FormData(settingsForm)
  const version = viewVersion
  if (!data.get('verificationChannel') || !data.get('reviewChannel') || !data.get('externalRole') ||
      !data.getAll('approvalRoles').length) {
    message('settings-message', 'Seleziona entrambi i canali, il ruolo esterno e almeno un ruolo di approvazione.')
    return
  }
  fields.disabled = true
  byId('publish').disabled = true
  message('settings-message')
  try {
    const settings = await api('settings', {
      verificationChannel: data.get('verificationChannel'),
      reviewChannel: data.get('reviewChannel'),
      externalRole: data.get('externalRole'),
      approvalRoles: data.getAll('approvalRoles'),
      reviewerRoles: data.getAll('reviewerRoles')
    })
    if (version === viewVersion) {
      state.settings = settings
      message('settings-message', 'Configurazione salvata.', true)
    }
  } catch (error) {
    if (version === viewVersion) message('settings-message', error.message)
  } finally {
    if (version === viewVersion) {
      fields.disabled = false
      renderPublish()
    }
  }
})

byId('publish').addEventListener('click', async () => {
  const version = viewVersion
  byId('publish').disabled = true
  message('settings-message')
  try {
    const panel = await api('publish', {})
    if (version === viewVersion) {
      state.panel = panel
      message('settings-message', 'Messaggio di verifica pubblicato.', true)
    }
  } catch (error) {
    if (version === viewVersion) message('settings-message', error.message)
  } finally {
    if (version === viewVersion) renderPublish()
  }
})

api('session').then(({ authenticated: active }) => active ? showWorkspace() : showLogin())
  .catch(() => { byId('loading').textContent = 'Pannello non disponibile. Ricarica la pagina.' })
