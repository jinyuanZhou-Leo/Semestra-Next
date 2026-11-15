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
  scrub()
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

// Clips in a `.scrub` block play as the block scrolls past: the frame follows how far the pinned
// content has travelled. With reduced motion they rest on their last frame.
const clips = [...document.querySelectorAll<HTMLVideoElement>('[data-scrub-video]')].map(
  (video) => ({
    video,
    block: video.closest<HTMLElement>('.scrub'),
    camera: video.dataset.camera ? (JSON.parse(video.dataset.camera) as Focus[]) : null,
  }),
)
// Words that go with a stretch of a clip: `data-beat="from,to"` (fractions of the block's scroll)
// marks them `.on` while the clip is in that stretch.
const beats = [...document.querySelectorAll<HTMLElement>('[data-beat]')].map((el) => {
  const [from, to] = el.dataset.beat!.split(',').map(Number)
  return { el, from: from!, to: to!, block: el.closest<HTMLElement>('.scrub') }
})
const stages = [...document.querySelectorAll<HTMLElement>('.sem-stage')]
// How far a `.scrub` block's pinned content has travelled, from 0 to 1.
function progress(block: HTMLElement) {
  const b = block.getBoundingClientRect()
  return clamp(-b.top / Math.max(1, b.height - innerHeight))
}
function scrub() {
  const vh = innerHeight
  for (const { video, block, camera } of clips) {
    if (!block || !video.duration) continue
    const b = block.getBoundingClientRect()
    if (b.bottom < 0 || b.top > vh) continue
    const t = progress(block) * (video.duration - 0.05)
    if (Math.abs(video.currentTime - t) > 1 / 60) video.currentTime = t
    // The camera follows the frame on screen, which lands when the seek is done (see below).
    if (camera) aim(video, camera, video.currentTime)
  }
  // A stage grows into place while its block scrolls in.
  for (const stage of stages) {
    const top = stage.closest<HTMLElement>('.scrub')!.getBoundingClientRect().top
    if (top > vh || top < -vh) continue
    stage.style.setProperty('--grow', String(0.86 + 0.14 * ease(clamp(1 - top / vh))))
  }
  for (const { el, from, to, block } of beats) {
    if (!block) continue
    const p = progress(block)
    el.classList.toggle('on', p >= from && p < to)
  }
}

// The camera of a clip with focus boxes: [time in s, x, y, width, height], the box as fractions of
// the clip. The view holds on a box until the next one's time, then moves to it over `MOVE` seconds
// (less when the box after it comes sooner), framing the box with a margin and never zooming past `ZOOM`.
type Focus = [number, number, number, number, number]
const MOVE = 0.7
const ZOOM = 2.2
const MARGIN = 0.06
function region(focus: Focus, aspect: number, ratio: number) {
  // In units of the clip's width; the clip is `ratio` tall.
  const [, fx, fy, fw, fh] = focus
  let w = Math.max(fw + MARGIN * 2, (fh * ratio + MARGIN * 2) * aspect)
  w = Math.min(Math.max(w, 1 / ZOOM), 1, ratio * aspect)
  const h = w / aspect
  const cx = fx + fw / 2
  const cy = (fy + fh / 2) * ratio
  return {
    x: Math.min(Math.max(cx - w / 2, 0), 1 - w),
    y: Math.min(Math.max(cy - h / 2, 0), ratio - h),
    w,
  }
}
const ease = (x: number) => x * x * (3 - 2 * x)
function aim(video: HTMLVideoElement, camera: Focus[], t: number) {
  const frame = video.parentElement!
  const aspect = frame.clientWidth / Math.max(1, frame.clientHeight)
  const ratio = video.videoHeight / Math.max(1, video.videoWidth)
  let i = 0
  while (i + 1 < camera.length && camera[i + 1]![0] <= t) i++
  let view = region(camera[i]!, aspect, ratio)
  if (i > 0) {
    const prev = region(camera[i - 1]!, aspect, ratio)
    // Arrive before the next box takes over.
    const gap = (camera[i + 1]?.[0] ?? Infinity) - camera[i]![0]
    const k = ease(clamp((t - camera[i]![0]) / Math.min(MOVE, gap * 0.8)))
    view = {
      x: prev.x + (view.x - prev.x) * k,
      y: prev.y + (view.y - prev.y) * k,
      w: prev.w + (view.w - prev.w) * k,
    }
  } else if (t < camera[0]![0]) view = region(camera[0]!, aspect, ratio)
  const scale = 1 / view.w
  const px = frame.clientWidth
  video.style.transform = `scale(${scale}) translate(${-view.x * px}px, ${-view.y * px}px)`
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
for (const { video, camera } of clips) {
  const ready = () => {
    if (reduce) video.currentTime = Math.max(0, video.duration - 0.05)
    tick()
  }
  if (camera) video.addEventListener('seeked', () => aim(video, camera, video.currentTime))
  if (video.readyState >= 1) ready()
  else video.addEventListener('loadedmetadata', ready, { once: true })
}
