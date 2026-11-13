import { FileClock, FileSearch, FolderOpen, Star } from 'lucide-react'
import {
  defineModule,
  type InvalidationTarget,
  preloadable,
  type QueryKeyPrefix,
  type QueryMatch,
} from '@/app/extensions'
import { m } from '@/paraglide/messages'
import { prefetchFilesPage } from './queries'

const PAGES = ['filesDocumentRead', 'filesDocumentOutline'] as const

type Data = Readonly<Record<string, unknown>>

/** The list of the event's course (every course's when the event has none). */
const courseList = (data: Data): (QueryKeyPrefix | QueryMatch)[] =>
  typeof data.course_id === 'string'
    ? [{ _id: 'filesItemList', path: { course_id: data.course_id } }]
    : ['filesItemList']

/** These queries of the event's file only. */
const ofItem =
  (operations: readonly QueryKeyPrefix[]) =>
  (data: Data): (QueryKeyPrefix | QueryMatch)[] =>
    typeof data.item_id === 'string'
      ? operations.map((_id) => ({ _id, path: { item_id: data.item_id } }))
      : [...operations]

/**
 * What each event can change, narrowed by its payload to one course's list and one file's
 * queries: uploading to one course does not refetch the others. Search shows names and files
 * still being processed; a document's pages only change when it is switched or goes away.
 * Deleting a folder or a course takes files whose ids the event does not list.
 */
const INVALIDATIONS = {
  'files.item.created': [
    courseList,
    'filesItemListProgram',
    'filesUsageGet',
    'filesDocumentSearch',
  ],
  'files.item.updated': [
    courseList,
    'filesItemListProgram',
    ofItem(['filesItemGet']),
    'filesDocumentSearch',
  ],
  'files.item.deleted': [
    courseList,
    'filesItemListProgram',
    ofItem(['filesItemGet', ...PAGES]),
    'filesUsageGet',
    'filesDocumentSearch',
  ],
  'files.document.ready': [courseList, ofItem(['filesItemGet', ...PAGES]), 'filesDocumentSearch'],
  'files.document.failed': [courseList, ofItem(['filesItemGet']), 'filesDocumentSearch'],
  'files.folder.created': [courseList],
  'files.folder.updated': [courseList],
  'files.folder.deleted': [
    courseList,
    'filesItemListProgram',
    'filesItemGet',
    'filesUsageGet',
    'filesDocumentSearch',
    ...PAGES,
  ],
  'academics.course.deleted': [
    courseList,
    'filesItemListProgram',
    'filesItemGet',
    'filesUsageGet',
    'filesDocumentSearch',
    ...PAGES,
  ],
} satisfies Record<string, readonly InvalidationTarget[]>

/**
 * M07 文件与文档管线: course files and links, previews, and the document pipeline that makes them
 * searchable. Other modules show sources with `<Citation>` (`./components/Citation`).
 */
export default defineModule({
  id: 'files',
  kind: 'core',
  name: m.files_name_module,
  description: m.files_description,
  icon: FolderOpen,
  pages: [
    {
      id: 'files',
      scopes: ['course', 'term'],
      title: m.files_nav,
      icon: FolderOpen,
      component: preloadable(() => import('./pages/FilesPage')),
      prefetch: prefetchFilesPage,
      order: 30,
    },
  ],
  cards: [
    {
      id: 'files.quickOpen',
      scopes: ['term', 'course'],
      title: m.files_card_quick_open,
      description: m.files_card_quick_open_description,
      icon: Star,
      sizes: ['s', 'm', 'l'],
      defaultSize: 's',
      component: preloadable(() => import('./cards/QuickOpenCard')),
      keepTitleWhenSmall: true,
      multiple: true,
      settings: () => import('./cards/quick-open'),
    },
    {
      id: 'files.recent',
      scopes: ['course'],
      title: m.files_card_recent,
      description: m.files_card_recent_description,
      icon: FileClock,
      sizes: ['m'],
      defaultSize: 'm',
      component: preloadable(() => import('./cards/RecentCard')),
      multiple: false,
    },
  ],
  settingsSections: [
    {
      id: 'files',
      level: 'program',
      group: 'files',
      title: m.files_settings_title,
      icon: FileSearch,
      order: 10,
      namespace: 'files',
    },
    {
      id: 'course-files',
      level: 'course',
      group: 'files',
      title: m.files_settings_title,
      icon: FileSearch,
      order: 10,
      namespace: 'files',
    },
  ],
  jobKinds: [
    { kind: 'files.process', title: m.files_job_process },
    { kind: 'files.reindex_vectors', title: m.files_job_reindex },
  ],
  uiPrefPrefixes: ['files.'],
  realtimeInvalidations: INVALIDATIONS,
})
