// The page's only runtime script: reveals sections as they scroll in, straightens the hero window,
// drifts the layered panels, and drives the grades carousel arrows.

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
  win.style.setProperty('--rx', `${(innerWidth < 900 ? 18 : 30) * (1 - p)}deg`)
  win.style.setProperty('--s', `${0.9 + 0.1 * p}`)
  floats.forEach((f, i) => {
    f.style.setProperty('--fz', `${Number(f.dataset.z) * (1 - p * 0.55)}px`)
    f.style.setProperty('--fy', `${(i ? 60 : 30) * (1 - p) - (i ? 40 : 24) * past}px`)
    f.style.setProperty('--fx', `${(i ? 1 : -1) * 40 * (1 - p)}px`)
  })
  // Layered panels drift at different speeds while they cross the viewport.
  for (const el of layers) {
    const b = el.parentElement!.getBoundingClientRect()
    if (b.bottom < -200 || b.top > vh + 200) continue
    const t = clamp((vh - b.top) / (vh + b.height)) - 0.5
    el.style.transform = `translate3d(0, ${t * Number(el.dataset.depth) * 2}px, 0)`
  }
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
