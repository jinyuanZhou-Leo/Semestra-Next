/** jsdom has no EventSource. Tests drive this one: `FakeEventSource.last().emit({type, data})`. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  static last(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1)
    if (!source) throw new Error('no EventSource was opened')
    return source
  }

  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this)
  }

  open() {
    this.onopen?.(new Event('open'))
  }

  emit(message: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  close() {
    this.closed = true
  }
}
