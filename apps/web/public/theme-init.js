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
  // The boot screen in index.html: the shell's frame on `/` and a Program's pages when this
  // browser has shown the shell before (the app mirrors its collapsed sidebar here and removes
  // the value on sign-out) on a desktop-sized window; the brand mark otherwise.
  var collapsed = read('semestra.sidebar-collapsed')
  var shell =
    collapsed !== null &&
    /^\/(p\/|$)/.test(location.pathname) &&
    window.matchMedia('(min-width: 768px)').matches
  root.setAttribute('data-boot', shell ? (collapsed === 'true' ? 'rail' : 'shell') : 'brand')
  var locale = read('PARAGLIDE_LOCALE')
  if (locale === 'en' || locale === 'zh-CN') root.setAttribute('lang', locale)
})()
