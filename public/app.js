const byId = id => document.getElementById(id)
const loginForm = byId('login-form')
const settingsForm = byId('settings-form')
const fields = byId('settings-fields')
const nav = [...document.querySelectorAll('[data-view]')]
const dark = matchMedia('(prefers-color-scheme: dark)')
const day = new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium' })
let state
let authenticated = false
let viewVersion = 0

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
  byId('request-list').replaceChildren()
  byId('guild-name').textContent = 'Discord'
  for (const select of settingsForm.querySelectorAll('select')) select.replaceChildren()
  byId('approval-roles').replaceChildren()
  byId('reviewer-roles').replaceChildren()
  byId('panel-link').removeAttribute('href')
  byId('verification-action').removeAttribute('href')
  byId('loading').hidden = true
  byId('workspace').hidden = true
  byId('login-page').hidden = false
  loginForm.reset()
}

async function api(path, body) {
  const method = body === undefined ? 'GET' : 'POST'
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

function renderOverview() {
  const { counts, recent, errors, panel, bot } = state
  byId('guild-name').textContent = bot.guildName ?? 'Discord'
  byId('connection-label').textContent = bot.ready ? 'Discord connesso' : 'Discord scollegato'
  byId('connection-dot').classList.toggle('online', bot.ready)
  byId('count-pending').textContent = (counts.pending ?? 0) + (counts.processing ?? 0)
  for (const status of ['accepted', 'external', 'rejected']) {
    byId(`count-${status}`).textContent = counts[status] ?? 0
  }
  message('queue-error', errors ? 'Alcune operazioni Discord sono in attesa di un nuovo tentativo. Controlla i dettagli nelle richieste.' : '')
  byId('request-list').replaceChildren(...recent.map(request => {
    const row = element('tr')
    const date = day.format(request.createdAt)
    const candidate = element('td', request.name)
    candidate.append(element('small', `${request.profile} · ${date}`, 'request-meta'))
    const status = element('td')
    status.append(element('span', request.label, `status ${request.status}`))
    if (request.error) status.append(element('small', request.error))
    const action = element('td')
    if (request.url) {
      const link = element('a', '↗', 'request-link')
      link.href = request.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.setAttribute('aria-label', `Apri la richiesta di ${request.name} su Discord`)
      link.title = 'Apri su Discord'
      action.append(link)
    }
    row.append(candidate, element('td', request.profile, 'request-profile'), status,
      element('td', date, 'request-date'), action)
    return row
  }))
  byId('table-wrap').hidden = !recent.length
  byId('empty').hidden = Boolean(recent.length)
  byId('empty-description').textContent = panel ? 'Le candidature inviate su Discord compariranno qui.' :
    'Le candidature arriveranno qui dopo la pubblicazione del messaggio di verifica.'
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
  byId('verification-state').textContent = discordUrl
    ? 'Il pulsante è pubblicato nel canale Discord.'
    : 'Il pulsante di verifica è ancora da pubblicare.'
}

function renderOptions({ channels, roles }) {
  const { settings } = state
  const assignable = roles.filter(role => role.assignable)
  const setChoices = (name, choices, prefix = '') => {
    const select = settingsForm.elements[name]
    select.replaceChildren(new Option('Seleziona…', ''),
      ...choices.map(choice => new Option(prefix + choice.name, choice.id)))
    select.value = choices.some(choice => choice.id === settings[name]) ? settings[name] : ''
  }
  const setChecks = (id, name, choices) => {
    const list = byId(id)
    list.replaceChildren(...choices.map(role => {
      const label = element('label')
      const check = element('input')
      check.type = 'checkbox'
      check.name = name
      check.value = role.id
      check.checked = settings[name].includes(role.id)
      label.append(check, document.createTextNode(role.name))
      return label
    }))
    if (!choices.length) list.append(element('p', 'Nessun ruolo disponibile.', 'muted'))
  }
  setChoices('verificationChannel', channels, '#')
  setChoices('reviewChannel', channels, '#')
  setChoices('externalRole', assignable)
  setChecks('approval-roles', 'approvalRoles', assignable)
  setChecks('reviewer-roles', 'reviewerRoles', roles)
  fields.disabled = false
}

async function loadView() {
  if (!authenticated) return
  const version = ++viewVersion
  const settings = location.hash === '#configurazione'
  byId('overview').hidden = settings
  byId('settings').hidden = !settings
  byId('page-title').textContent = settings ? 'Configurazione' : 'Panoramica'
  for (const link of nav) {
    if (link.dataset.view === (settings ? 'configurazione' : 'panoramica')) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  fields.disabled = true
  byId('refresh').disabled = true
  byId('publish').disabled = true
  message('app-error')
  message('settings-message')
  try {
    const overview = await api('overview')
    if (version !== viewVersion) return
    state = overview
    renderOverview()
    if (settings && !state.bot.ready) {
      message('settings-message', 'Collega il bot al server Discord per caricare canali e ruoli.')
    } else if (settings) {
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
  const data = new FormData(settingsForm)
  const version = viewVersion
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
