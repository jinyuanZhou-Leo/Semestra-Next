/** The sound when a phase ends (M14 §3); the notification goes through M18 (`showLocal`). */

let audio: AudioContext | undefined

function audioContext(): AudioContext | undefined {
  if (audio && audio.state !== 'closed') return audio
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  audio = Ctx ? new Ctx() : undefined
  return audio
}

/**
 * Call from a click handler (Start): browsers only let an AudioContext make sound once it was
 * created or resumed during a user gesture, and the chime plays later from a timer callback.
 */
export function unlockAudio(): void {
  try {
    void audioContext()?.resume()
  } catch {
    // No audio device: stay silent.
  }
}

export function playChime(): void {
  try {
    const ctx = audioContext()
    if (!ctx) return
    void ctx.resume()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2)
    for (const [offset, frequency] of [
      [0, 784],
      [0.25, 1047],
    ] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = frequency
      osc.connect(gain)
      osc.start(ctx.currentTime + offset)
      osc.stop(ctx.currentTime + offset + 0.5)
    }
  } catch {
    // No audio device, or the browser blocked it before any interaction: stay silent.
  }
}
