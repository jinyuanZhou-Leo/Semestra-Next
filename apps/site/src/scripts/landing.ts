// The page's only runtime script: reveals sections as they scroll in, starts the hero entrance once its
// images are decoded, drifts the layered panels, and drives the grades carousel arrows.

const nav = document.getElementById('nav')
const stage = document.querySelector<HTMLElement>('.stage')
const tilt = document.getElementById('tilt')
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

// Start the entrance only when the hero images are ready, so its first frames are not spent decoding.
// Each lifted piece then waits until most of it is in view: on a short screen the lower ones are
// still below the fold. One that comes in later, by scrolling, lifts at once instead of after the
// staggered delay it has on load.
if (stage) {
  const imgs = [...stage.querySelectorAll('img')].filter((i) => i.offsetParent !== null)
  void Promise.all(imgs.map((i) => i.decode().catch(() => undefined))).then(() => {
    stage.classList.add('go')
    const start = performance.now()
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const piece = e.target as HTMLElement
          if (performance.now() - start > 500)
            (piece.firstElementChild as HTMLElement).style.animationDelay = '0s'
          piece.classList.add('up')
          seen.unobserve(piece)
        }
      },
      { threshold: 0.6 },
    )
    floats.forEach((f) => seen.observe(f))
  })
}

// Browsers without scroll-driven animations get the same lean and depth from here, one transform each.
const tiltByScript = !reduce && tilt !== null && !CSS.supports('animation-timeline: scroll()')

function frame() {
  nav?.classList.toggle('stuck', scrollY > 8)
  if (reduce) return
  const vh = innerHeight
  if (tiltByScript && tilt) {
    const p = clamp(scrollY / (vh * 0.7))
    const [deg, s] = innerWidth < 900 ? [14, 0.94] : [24, 0.9]
    tilt.style.transform = `rotateX(${deg * (1 - p)}deg) scale(${s + (1 - s) * p})`
    for (const f of floats)
      f.style.transform = `translate3d(0, 0, calc(var(--z) * ${1 - 0.55 * p}))`
  }
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
