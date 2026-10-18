/** Sound and browser notification when a phase ends (M14 §3). Both degrade to nothing. */

export function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const audio = new Ctx()
    const gain = audio.createGain()
    gain.connect(audio.destination)
    gain.gain.setValueAtTime(0.0001, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 1.2)
    for (const [offset, frequency] of [
      [0, 784],
      [0.25, 1047],
    ] as const) {
      const osc = audio.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = frequency
      osc.connect(gain)
      osc.start(audio.currentTime + offset)
      osc.stop(audio.currentTime + offset + 0.5)
    }
    window.setTimeout(() => void audio.close(), 1800)
  } catch {
    // No audio device, or the browser blocked it before any interaction: stay silent.
  }
}

/** Asks once, the first time a timer starts with notifications on. */
export function askNotificationPermission(): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  } catch {
    // Some browsers throw instead of returning a promise.
  }
}

export function showNotification(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  } catch {
    // Not allowed here (some mobile browsers only allow service-worker notifications).
  }
}
