/**
 * Shared constants for agent profile generation.
 *
 * Used by both the client-side agent-profiles API route and the
 * server-side classroom-generation pipeline to keep colors / avatars in sync.
 */

/** Color palette cycled for generated agents.
 *  These are agent IDENTITIES, not brand chrome: the palette must stay
 *  distinguishable from one another so a learner can tell two AI students
 *  apart at a glance, which is why it keeps its violet/purple entries instead
 *  of collapsing onto the product blue. */
export const AGENT_COLOR_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#6366f1',
  '#84cc16',
  '#a855f7',
] as const;

/**
 * Default avatar paths cycled for generated agents.
 *
 * Every entry MUST correspond to a file that exists under `public/avatars/`.
 */
export const AGENT_DEFAULT_AVATARS = [
  '/avatars/teacher.png',
  '/avatars/assist.png',
  '/avatars/curious.png',
  '/avatars/thinker.png',
  '/avatars/note-taker.png',
  '/avatars/teacher-2.png',
  '/avatars/assist-2.png',
  '/avatars/curious-2.png',
  '/avatars/thinker-2.png',
  '/avatars/note-taker-2.png',
  // 新增 32 张卡通头像：学生 24 张 + 教师 8 张
  '/avatars/student4.png',
  '/avatars/student5.png',
  '/avatars/student6.png',
  '/avatars/student7.png',
  '/avatars/student8.png',
  '/avatars/student9.png',
  '/avatars/student10.png',
  '/avatars/student11.png',
  '/avatars/student12.png',
  '/avatars/student13.png',
  '/avatars/student14.png',
  '/avatars/student15.png',
  '/avatars/student16.png',
  '/avatars/student17.png',
  '/avatars/student18.png',
  '/avatars/student19.png',
  '/avatars/student20.png',
  '/avatars/student21.png',
  '/avatars/student22.png',
  '/avatars/student23.png',
  '/avatars/student24.png',
  '/avatars/student25.png',
  '/avatars/student26.png',
  '/avatars/student27.png',
  '/avatars/teacher-3.png',
  '/avatars/teacher-4.png',
  '/avatars/teacher-5.png',
  '/avatars/teacher-6.png',
  '/avatars/teacher-7.png',
  '/avatars/teacher-8.png',
  '/avatars/teacher-9.png',
  '/avatars/teacher-10.png',
] as const;
