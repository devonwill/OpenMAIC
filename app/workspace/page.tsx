/**
 * `/workspace` — the Pro workspace home (teacher-only).
 *
 * Pro mode used to be a `useState` on `app/page.tsx`, which meant the global
 * `SiteHeader` could not know about it and stacked a second navigation bar on
 * top of the workspace's own sidebar. As a route it is addressable instead:
 * `AppChrome` suppresses the header by path prefix, a refresh keeps you here,
 * and the workspace can be linked to.
 *
 * The gate is server-side and checks three things:
 *   1. `NEXT_PUBLIC_PRO_WORKBENCH_ENABLED` (build-time, client-visible)
 *   2. the server-only configured runtime truth (`DATABASE_URL` set + runtime
 *      explicitly enabled)
 *   3. the request's authenticated user is a teacher
 * Anonymous and student users are redirected to `/`; the home page hero also
 * hides its Pro badge for non-teachers, so the entry and the destination agree.
 *
 * `force-dynamic` keeps the flags request-scoped instead of baking them into a
 * prerender.
 *
 * The Suspense boundary covers the route seam that reads the initial deep-link
 * snapshot from `useSearchParams`. Once mounted, the workspace owns pane state
 * locally and mirrors it with the History API, so ordinary pane changes do not
 * ask the server route to render again.
 *
 */
import { Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isWorkbenchEntryAllowedForRequest } from '@/lib/workbench/entry-gate';
import { WorkspaceEntry } from '@/components/workbench/WorkspaceEntry';

export const dynamic = 'force-dynamic';

export default async function WorkspacePage() {
  if (!(await isWorkbenchEntryAllowedForRequest(new Request('http://x', { headers: await headers() })))) {
    redirect('/');
  }

  return (
    <Suspense fallback={null}>
      <WorkspaceEntry />
    </Suspense>
  );
}
