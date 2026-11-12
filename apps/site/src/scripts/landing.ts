// The page's only runtime script: reveals sections as they scroll in, straightens the hero window and
// turns it toward the pointer, drifts the layered panels, and drives the grades carousel arrows.

const nav = document.getElementById('nav')
const win = document.getElementById('win')
const floats = [...document.querySelectorAll<HTMLElement>('.float')]
const layers = [...document.querySelectorAll<HTMLElement>('[data-depth]')]
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue
      e.target.classList.add('in')
      io.unobserve(e.target)
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
)
document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el))

const track = document.getElementById('track')
const prev = document.getElementById('prev') as HTMLButtonElement | null
const next = document.getElementById('next') as HTMLButtonElement | null
if (track && prev && next) {
  const step = () => (track.querySelector('.card')?.getBoundingClientRect().width ?? 400) + 16
  prev.addEventListener('click', () => track.scrollBy({ left: -step(), behavior: 'smooth' }))
  next.addEventListener('click', () => track.scrollBy({ left: step(), behavior: 'smooth' }))
  const ends = () => {
    prev.disabled = track.scrollLeft < 4
    next.disabled = track.scrollLeft > track.scrollWidth - track.clientWidth - 4
  }
  track.addEventListener('scroll', ends, { passive: true })
  addEventListener('resize', ends)
  ends()
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const ease = (t: number) => 1 - Math.pow(1 - t, 3)

function frame() {
  nav?.classList.toggle('stuck', scrollY > 8)
  if (reduce || !win) return
  const vh = innerHeight
  // The window starts leaning back and is straight by the time its top reaches the upper fifth.
  const r = win.getBoundingClientRect()
  const p = ease(clamp(1 - (r.top - vh * 0.18) / (vh * 0.62)))
  const past = clamp((vh * 0.18 - r.top) / vh)
  win.style.setProperty('--rx', `${(innerWidth < 900 ? 20 : 34) * (1 - p)}deg`)
  win.style.setProperty('--s', `${0.86 + 0.14 * p}`)
  // Each piece hangs at its own depth; the nearer ones move more as the window straightens.
  floats.forEach((f) => {
    const z = Number(f.dataset.z)
    const side = f.classList.contains('a') ? -1 : 1
    f.style.setProperty('--z', `${z}`)
    f.style.setProperty('--fz', `${z * (1 - p * 0.55)}px`)
    f.style.setProperty('--fy', `${(z / 4) * (1 - p) - (z / 5) * past}px`)
    f.style.setProperty('--fx', `${side * (z / 5) * (1 - p)}px`)
  })
  // Layered panels drift at different speeds while they cross the viewport.
  for (const el of layers) {
    const b = el.parentElement!.getBoundingClientRect()
    if (b.bottom < -200 || b.top > vh + 200) continue
    const t = clamp((vh - b.top) / (vh + b.height)) - 0.5
    el.style.transform = `translate3d(0, ${t * Number(el.dataset.depth) * 2}px, 0)`
  }
}

// The pointer turns the hero a few degrees toward it, eased so the window follows rather than snaps.
const stage = document.querySelector<HTMLElement>('.stage')
const hero = document.querySelector<HTMLElement>('.hero')
let aim = { x: 0, y: 0 }
const at = { x: 0, y: 0 }
let following = false
const follow = () => {
  at.x += (aim.x - at.x) * 0.08
  at.y += (aim.y - at.y) * 0.08
  stage?.style.setProperty('--px', at.x.toFixed(4))
  stage?.style.setProperty('--py', at.y.toFixed(4))
  following = Math.abs(aim.x - at.x) + Math.abs(aim.y - at.y) > 0.001
  if (following) requestAnimationFrame(follow)
}
if (!reduce && hero && stage && matchMedia('(hover: hover)').matches) {
  hero.addEventListener('pointermove', (e) => {
    aim = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 }
    if (!following) requestAnimationFrame(follow)
    following = true
  })
  hero.addEventListener('pointerleave', () => {
    aim = { x: 0, y: 0 }
    if (!following) requestAnimationFrame(follow)
    following = true
  })
}

let queued = false
const tick = () => {
  if (queued) return
  queued = true
  requestAnimationFrame(() => {
    queued = false
    frame()
  })
}
addEventListener('scroll', tick, { passive: true })
addEventListener('resize', tick)
frame()
