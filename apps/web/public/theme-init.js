// Runs before the app loads (a blocking <script src>, allowed by the CSP) so the first paint
// already has the user's theme, accent color and motion setting. Keep it in sync with
// `applyAppearance` in src/app/appearance.ts; the values come from localStorage, which the app
// updates whenever the preference changes (M11 §5.3).
;(function () {
  var root = document.documentElement
  function read(key) {
    try {
      return localStorage.getItem(key)
    } catch (e) {
      return null
    }
  }
  var theme = read('semestra.theme')
  var dark =
    theme === 'dark' ||
    (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.toggle('dark', dark)
  var accent = read('semestra.accent')
  if (accent && /^[a-z]+$/.test(accent)) root.setAttribute('data-accent', accent)
  var motion = read('semestra.reduce-motion')
  if (motion === 'on' || motion === 'off') root.setAttribute('data-reduce-motion', motion)
  // The boot screen in index.html: the shell's frame on a Program's pages (on a desktop-sized
  // window; the app asks for a larger screen otherwise), the brand mark on every other page.
  // AppShell mirrors the collapsed sidebar here, as it is a UI preference loaded with the app.
  var shell = /^\/p\//.test(location.pathname) && window.matchMedia('(min-width: 768px)').matches
  var rail = read('semestra.sidebar-collapsed') === 'true'
  root.setAttribute('data-boot', shell ? (rail ? 'rail' : 'shell') : 'brand')
  var locale = read('PARAGLIDE_LOCALE')
  if (locale === 'en' || locale === 'zh-CN') root.setAttribute('lang', locale)
})()
