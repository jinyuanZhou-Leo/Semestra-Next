import { expect, test } from '@playwright/test'
import { signUp, uniqueEmail } from './helpers'

test('sign up with an email code, set a password, sign out, sign back in with it', async ({
  page,
}) => {
  const email = uniqueEmail('auth')
  await signUp(page, email, 'Eve')

  // The session survives a reload (HttpOnly cookie + /account/me).
  await page.reload()
  await expect(page.getByTestId('signed-in-as')).toContainText('Eve')

  // The settings dialog is one URL away, even before there is a Program.
  await page.goto('/onboarding?settings=account/account')
  await page.getByRole('button', { name: 'Set password' }).click()
  await page.getByLabel('New password').fill('a long enough passphrase')
  await page.getByRole('button', { name: 'Save', exact: true }).last().click()
  await expect(page.getByText('Set', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out', exact: true }).first().click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)

  await page.getByRole('button', { name: 'Sign in with a password' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('a long enough passphrase')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByTestId('signed-in-as')).toContainText('Eve')
})
