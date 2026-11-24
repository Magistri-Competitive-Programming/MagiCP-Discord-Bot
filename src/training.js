import { randomInt } from 'node:crypto'
import { load } from 'cheerio/slim'

const origin = 'https://training.olinfo.it'
const pageCache = new Map()
const cacheDuration = 5 * 60_000
const statLabels = ['Punti', 'Problemi risolti', 'Sottoposizioni', 'Tempo di esecuzione']

export const profileUrl = username => `${origin}/user/${encodeURIComponent(username)}`
export const taskUrl = slug => `${origin}/task/${slug}`

async function readPage(url) {
  const response = await fetch(url, {
    headers: { 'Accept-Language': 'it-IT' },
    redirect: 'error',
    signal: AbortSignal.timeout(8_000)
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Training Olinfo HTTP ${response.status}`)
  return load(await response.text())
}

export async function getProfile(username) {
  const $ = await readPage(profileUrl(username))
  if (!$) return null

  const profile = $('meta[property="profile:username"]').attr('content')
  const stats = new Map($('.stat').map((_, stat) => [[
    $(stat).find('.stat-title').text().trim(), $(stat).find('.stat-value').text().trim()
  ]]).get())
  const scoreCard = $('h2').filter((_, heading) => $(heading).text().trim() === 'Problemi risolti').parent()
  const complete = scoreCard.find('a.bg-green-400[href^="/task/"]')
  if (!profile || statLabels.some(label => !stats.get(label)) || scoreCard.length !== 1 ||
      complete.length !== Number(stats.get('Problemi risolti'))) {
    throw new Error('Formato del profilo Training Olinfo inatteso')
  }

  // Il badge verde indica il punteggio pieno, mentre il numero mostrato è arrotondato.
  const solved = new Set(complete.map((_, link) => $(link).attr('href').match(/^\/task\/([^/?#]+)$/)?.[1]).get())
  return { username: profile, stats: statLabels.map(label => [label, stats.get(label)]), solved }
}

async function readTaskPage(difficulty, page) {
  const url = new URL(`/tasks/${page}`, origin)
  url.searchParams.set('minDiff', difficulty - 1)
  // Il limite superiore del filtro è esclusivo, mentre le stelle includono il valore di soglia.
  url.searchParams.set('maxDiff', Math.min(difficulty + 1e-9, 10))
  const $ = await readPage(url)
  if (!$) throw new Error('Pagina dei problemi Training Olinfo non trovata')

  const tasks = $('ul.menu > li > a[href^="/task/"]').map((_, element) => {
    const link = $(element)
    const slug = link.attr('href').match(/^\/task\/([^/?#]+)$/)?.[1]
    const title = link.text().trim()
    const stars = link.find('.mask-star-2')
    if (!slug || !title || stars.length !== 10) throw new Error('Formato del problema Training Olinfo inatteso')
    const filled = stars.filter((_, star) => !$(star).hasClass('forced-colors:bg-transparent')).length
    return { slug, title, difficulty: filled }
  }).get()
  if (!tasks.length && !$('ul.menu > li').toArray().some(item => $(item).text().trim() === 'Nessun problema trovato')) {
    throw new Error('Formato della lista problemi Training Olinfo inatteso')
  }

  const pages = $('a.join-item[href^="/tasks/"]').map((_, link) =>
    Number($(link).attr('href').match(/^\/tasks\/(\d+)\?/)?.[1] ?? 0)
  ).get()
  return { tasks, pageCount: Math.max(page, ...pages) }
}

export async function randomTask(difficulty, solved = new Set()) {
  if (!(pageCache.get(difficulty)?.expiresAt > Date.now())) {
    pageCache.set(difficulty, { expiresAt: Date.now() + cacheDuration, pages: new Map() })
  }
  const { pages } = pageCache.get(difficulty)
  function getPage(page) {
    if (!pages.has(page)) {
      pages.set(page, readTaskPage(difficulty, page).catch(error => {
        pages.delete(page)
        throw error
      }))
    }
    return pages.get(page)
  }

  const first = await getPage(1)
  const pageSize = first.tasks.length
  const slots = Array.from({ length: first.pageCount * pageSize }, (_, index) => index)
  // Estrai gli indici senza ripetizioni e carica solo le pagine necessarie.
  while (slots.length) {
    const pick = randomInt(slots.length)
    const slot = slots[pick]
    slots[pick] = slots.at(-1)
    slots.pop()
    const { tasks } = await getPage(Math.floor(slot / pageSize) + 1)
    const task = tasks[slot % pageSize]
    if (task?.difficulty === difficulty && !solved.has(task.slug)) return task
  }
  return null
}
