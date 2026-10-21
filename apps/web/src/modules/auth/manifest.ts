import { KeyRound, MonitorSmartphone, ShieldCheck, UserRound } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { m } from '@/paraglide/messages'

/** M01 认证与账户: its sections live in the "Account" group of the settings pages (M11). */
export default defineModule({
  id: 'auth',
  kind: 'core',
  name: m.auth_name,
  description: m.auth_description,
  icon: UserRound,
  settingsSections: [
    {
      id: 'profile',
      level: 'account',
      group: 'account',
      title: m.auth_account_profile_title,
      description: m.auth_account_profile_desc,
      icon: UserRound,
      order: 10,
      component: preloadable(() =>
        import('./settings/sections').then((s) => ({ default: s.ProfileSettings })),
      ),
    },
    {
      id: 'sign-in',
      level: 'account',
      group: 'account',
      title: m.auth_account_signin_title,
      description: m.auth_account_signin_desc,
      icon: ShieldCheck,
      order: 20,
      component: preloadable(() =>
        import('./settings/sections').then((s) => ({ default: s.SignInMethodsSettings })),
      ),
    },
    {
      id: 'sessions',
      level: 'account',
      group: 'security',
      title: m.auth_account_sessions_title,
      description: m.auth_account_sessions_desc,
      icon: MonitorSmartphone,
      order: 30,
      component: preloadable(() =>
        import('./settings/sections').then((s) => ({ default: s.SessionsSettings })),
      ),
    },
    {
      id: 'tokens',
      level: 'account',
      group: 'security',
      title: m.auth_account_tokens_title,
      description: m.auth_account_tokens_desc,
      icon: KeyRound,
      order: 40,
      component: preloadable(() =>
        import('./settings/sections').then((s) => ({ default: s.TokensSettings })),
      ),
    },
  ],
})
