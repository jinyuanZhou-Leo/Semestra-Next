import { expect, test } from '@playwright/test'
import { onboard, signUp, uniqueEmail } from './helpers'

test('a new user goes through onboarding and sees the term with its course (M02 §9)', async ({
  page,
}) => {
  await signUp(page, uniqueEmail('academics'), 'Ada')
  await onboard(page)

  const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(sidebar.getByRole('link', { name: /APS105H1/ })).toBeVisible()
  await expect(
    page.getByRole('link', { name: /Computer Fundamentals|APS105H1/ }).first(),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch program' })).toContainText(
    'Computer Engineering',
  )
})
