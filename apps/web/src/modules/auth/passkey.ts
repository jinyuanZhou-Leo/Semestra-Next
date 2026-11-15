import type { PasskeyList, WebAuthnOptions } from '@semestra/api-client'
import { ApiError } from '@/app/api'

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

/** The user closed the browser's prompt, or another request replaced this one. */
export class PasskeyCancelled extends Error {
  override name = 'PasskeyCancelled'
}

export function passkeyCancelled(error: unknown): boolean {
  return error instanceof PasskeyCancelled
}

/**
 * The browser's errors as the app's error codes, shared by signing in, confirming it's you and
 * adding a passkey: a key the password manager already holds for this account is
 * `auth.passkey_exists`, an address the passkey cannot belong to is `auth.passkey_unavailable`.
 */
function fromBrowser(error: unknown): Error {
  if (!(error instanceof Error)) return new ApiError('auth.passkey_failed', {}, 0)
  const code = (error as { code?: string }).code
  if (
    error.name === 'NotAllowedError' ||
    error.name === 'AbortError' ||
    code === 'ERROR_CEREMONY_ABORTED' ||
    code === 'ERROR_PASSKEY_AUTOFILL_ABORTED'
  ) {
    return new PasskeyCancelled()
  }
  if (error.name === 'InvalidStateError') return new ApiError('auth.passkey_exists', {}, 0)
  if (error.name === 'SecurityError') return new ApiError('auth.passkey_unavailable', {}, 0)
  return new ApiError('auth.passkey_failed', {}, 0)
}

/**
 * Asks for an existing passkey. `autofill` waits for the user to pick one in the email field.
 * `current` says whether the caller still wants it: starting a request cancels any other one
 * in the page, so one that has been replaced while it was loading must not start.
 */
export async function getPasskey(
  options: WebAuthnOptions,
  { autofill = false, current = () => true }: { autofill?: boolean; current?: () => boolean } = {},
): Promise<Answer> {
  const { startAuthentication } = await import('@simplewebauthn/browser')
  if (!current()) throw new PasskeyCancelled()
  try {
    const answer = await startAuthentication({
      optionsJSON: options.options as unknown as Parameters<
        typeof startAuthentication
      >[0]['optionsJSON'],
      useBrowserAutofill: autofill,
    })
    return answer as unknown as Answer
  } catch (error) {
    throw fromBrowser(error)
  }
}

/** Creates a passkey for the signed-in account. */
export async function createPasskey(options: WebAuthnOptions): Promise<Answer> {
  const { startRegistration } = await import('@simplewebauthn/browser')
  try {
    const answer = await startRegistration({
      optionsJSON: options.options as unknown as Parameters<
        typeof startRegistration
      >[0]['optionsJSON'],
    })
    return answer as unknown as Answer
  } catch (error) {
    throw fromBrowser(error)
  }
}

/** Stops a waiting request, e.g. when the sign-in form goes away. */
export async function cancelPasskeyRequest(): Promise<void> {
  const { WebAuthnAbortService } = await import('@simplewebauthn/browser')
  WebAuthnAbortService.cancelCeremony()
}

/**
 * Tells the password manager that a passkey no longer works here (it was removed in settings),
 * so it stops offering it. Best effort: browsers without these signals simply keep it.
 */
export async function forgetUnknownPasskey(rpId: string, credentialId: string): Promise<void> {
  const { sendSignal } = await import('@simplewebauthn/browser')
  await sendSignal({
    signalName: 'unknownCredential',
    rpID: rpId,
    credentialID: credentialId,
  }).catch(() => {})
}

/** Tells the password manager which of the account's passkeys still work here. */
export async function syncAcceptedPasskeys(list: PasskeyList): Promise<void> {
  const { sendSignal } = await import('@simplewebauthn/browser')
  await sendSignal({
    signalName: 'allAcceptedCredentials',
    rpID: list.rp_id,
    userID: list.user_handle,
    allAcceptedCredentialIDs: list.items.map((p) => p.credential_id),
  }).catch(() => {})
}
