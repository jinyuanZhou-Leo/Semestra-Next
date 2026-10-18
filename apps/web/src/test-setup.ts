import '@testing-library/jest-dom/vitest'
import { FakeEventSource } from './test-event-source'

// jsdom gaps used by input-otp and Base UI.
document.elementFromPoint ??= () => null
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList
globalThis.EventSource ??= FakeEventSource as unknown as typeof EventSource
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Vitest runs with `globals: false`, so Testing Library cannot register its own cleanup.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
afterEach(() => cleanup())
