import { createFileRoute } from '@tanstack/react-router'
import { AccountSettings } from '@/modules/auth/settings/AccountSettings'

export const Route = createFileRoute('/_authed/settings/account')({ component: AccountSettings })
