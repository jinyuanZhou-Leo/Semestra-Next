import type { WebAuthnOptions } from '@semestra/api-client'

// The browser side of passkeys (M01 §4.9). @simplewebauthn/browser turns the server's JSON
// options into `navigator.credentials` calls and the answers back into JSON; it is loaded only
// when a passkey is actually used, so the sign-in page does not carry it.

type Answer = Record<string, unknown>

/**
 * Passkeys need a secure context (HTTPS or localhost) and a browser with WebAuthn. Where they
 * are missing (e.g. a self-hosted server opened over plain HTTP), passkey entry points hide.
 */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === 'function'
  )
}

/** Whether the browser can offer passkeys in the email field's autofill. */
export async function passkeyAutofillAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false
  return (await PublicKeyCredential.isConditionalMediationAvailable?.()) ?? false
}

/** The user closed the browser's prompt or another one replaced it: nothing to report. */
export function passkeyCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as { code?: string }).code
  return (
    error.name === 'NotAllowedError' ||
    error.name === 'AbortError' ||
    code === 'ERROR_CEREMONY_ABORTED' ||
    code === 'ERROR_PASSKEY_AUTOFILL_ABORTED'
  )
}

/** Asks for an existing passkey; `autofill` waits for the user to pick one in the email field. */
export async function getPasskey(options: WebAuthnOptions, autofill = false): Promise<Answer> {
  const { startAuthentication } = await import('@simplewebauthn/browser')
  const answer = await startAuthentication({
    optionsJSON: options.options as unknown as Parameters<
      typeof startAuthentication
    >[0]['optionsJSON'],
    useBrowserAutofill: autofill,
  })
  return answer as unknown as Answer
}

/** Creates a passkey for the signed-in account. */
export async function createPasskey(options: WebAuthnOptions): Promise<Answer> {
  const { startRegistration } = await import('@simplewebauthn/browser')
  const answer = await startRegistration({
    optionsJSON: options.options as unknown as Parameters<
      typeof startRegistration
    >[0]['optionsJSON'],
  })
  return answer as unknown as Answer
}

/** Stops a waiting autofill request, e.g. when the sign-in form goes away. */
export async function cancelPasskeyRequest(): Promise<void> {
  const { WebAuthnAbortService } = await import('@simplewebauthn/browser')
  WebAuthnAbortService.cancelCeremony()
}
