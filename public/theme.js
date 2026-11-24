{
  const system = matchMedia('(prefers-color-scheme: dark)')
  let preference
  try { preference = localStorage.getItem('magicp-theme') } catch { /* Storage can be disabled. */ }

  function applyTheme() {
    const dark = preference ? preference === 'dark' : system.matches
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    const toggle = document.getElementById('theme')
    if (!toggle) return
    toggle.title = dark ? 'Attiva tema chiaro' : 'Attiva tema scuro'
    toggle.setAttribute('aria-label', toggle.title)
    document.getElementById('theme-glyph').setAttribute('href', dark ? '/icons.svg#sun' : '/icons.svg#moon')
  }

  applyTheme()
  system.addEventListener('change', applyTheme)
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme()
    document.getElementById('theme').addEventListener('click', () => {
      preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      try { localStorage.setItem('magicp-theme', preference) } catch { /* Keep this tab's preference. */ }
      applyTheme()
    })
  })
}
