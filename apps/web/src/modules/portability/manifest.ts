import {
  coreStorageGetOptions,
  filesUsageBreakdownOptions,
  portabilityDataCountGetOptions,
  portabilityExportListOptions,
  portabilityImportGetOptions,
} from '@semestra/api-client/react-query'
import { DatabaseBackup, Download, HardDrive, Trash2, Upload } from 'lucide-react'
import { defineModule, preloadable } from '@/app/extensions'
import { readUiPref } from '@/app/ui-pref'
import { m } from '@/paraglide/messages'
import { RESTORE_KEY } from './keys'

const sections = () => import('./sections')

/** M13 数据导出导入与账户删除: the "Data" group of the account settings. */
export default defineModule({
  id: 'portability',
  kind: 'core',
  name: m.portability_name,
  description: m.portability_description,
  icon: DatabaseBackup,
  settingsSections: [
    {
      id: 'storage',
      level: 'account',
      group: 'data',
      title: m.portability_storage_title,
      description: m.portability_storage_desc,
      icon: HardDrive,
      order: 5,
      component: preloadable(() => sections().then((s) => ({ default: s.StorageSection }))),
      prefetch: (_scope, queryClient) =>
        Promise.all([
          queryClient.ensureQueryData(coreStorageGetOptions()),
          queryClient.ensureQueryData(filesUsageBreakdownOptions()),
          queryClient.ensureQueryData(portabilityDataCountGetOptions()),
        ]),
    },
    {
      id: 'export',
      level: 'account',
      group: 'data',
      title: m.portability_export_title,
      description: m.portability_export_desc,
      icon: Download,
      order: 10,
      component: preloadable(() => sections().then((s) => ({ default: s.ExportSection }))),
      prefetch: (_scope, queryClient) =>
        Promise.all([
          queryClient.ensureQueryData(coreStorageGetOptions()),
          queryClient.ensureQueryData(portabilityExportListOptions()),
        ]),
    },
    {
      id: 'restore',
      level: 'account',
      group: 'data',
      title: m.portability_restore_title,
      description: m.portability_restore_desc,
      icon: Upload,
      order: 20,
      component: preloadable(() => sections().then((s) => ({ default: s.RestoreSection }))),
      prefetch: async (_scope, queryClient) => {
        // A backup uploaded earlier is still waiting to be restored.
        const id = await readUiPref<string | null>(queryClient, RESTORE_KEY)
        if (id) {
          await queryClient.ensureQueryData({
            ...portabilityImportGetOptions({ path: { id } }),
            retry: false,
          })
        }
      },
    },
    {
      id: 'delete-account',
      level: 'account',
      group: 'data',
      title: m.settings_danger_zone,
      danger: true,
      icon: Trash2,
      order: 900,
      component: preloadable(() => sections().then((s) => ({ default: s.DeleteAccountSection }))),
    },
  ],
  jobKinds: [
    { kind: 'portability.export', title: m.portability_job_export },
    { kind: 'portability.import', title: m.portability_job_import },
    { kind: 'portability.account_delete', title: m.portability_job_account_delete },
  ],
  uiPrefPrefixes: ['portability.'],
})
