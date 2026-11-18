import { defaultParseSearch } from '@tanstack/react-router'
import { expect, test } from 'vitest'
import { pageSearch } from '@/lib/page-search'
import { courseFilesPath } from './location'
import { organizeLink } from './organizing'

const searchOf = (href: string) => pageSearch(defaultParseSearch(new URL(href, 'http://x').search))

test('a link to a folder, a file or organizing reaches the page as written', () => {
  expect(searchOf(courseFilesPath('p1', 'c1', { folderId: 'f-1', itemId: 'i-1' }))).toEqual({
    folder: 'f-1',
    file: 'i-1',
  })
  // The router reads values as JSON: the page still gets them, as text.
  expect(searchOf(organizeLink({ program_id: 'p1', course_id: 'c1' }) ?? '')).toEqual({
    organize: 'true',
  })
})
