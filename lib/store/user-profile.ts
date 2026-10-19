/**
 * User Profile Store
 *
 * Persists avatar, nickname & bio through the `@openmaic/storage` KVStore in
 * the `account` scope: this is the learner's own identity, exactly the data a
 * server-backed deployment is expected to carry across their devices.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { createKVPersistStorage, purgeLegacyPersistKey } from '@/lib/store/kv-persist';

/**
 * Bound after the store exists; see `onWriteRefused` for why it is not inlined.
 * The explicit annotation is what breaks the type cycle — inferring this from
 * the store would put the store back in its own definition.
 */
const recovery: { rehydrate?: () => void | Promise<void> } = {};

/** Predefined avatar options */
export const AVATAR_OPTIONS = [
  '/avatars/user.png',
  '/avatars/teacher-2.png',
  '/avatars/assist-2.png',
  '/avatars/clown-2.png',
  '/avatars/curious-2.png',
  '/avatars/note-taker-2.png',
  '/avatars/thinker-2.png',
  '/avatars/学生01_男生.svg',
  '/avatars/学生02_女生.svg',
  '/avatars/学生03_男生.svg',
  '/avatars/学生04_女生.svg',
  '/avatars/学生05_男生.svg',
  '/avatars/学生06_女生.svg',
  '/avatars/学生07_男生.svg',
  '/avatars/学生08_女生.svg',
  '/avatars/学生09_男生.svg',
  '/avatars/学生10_女生.svg',
  '/avatars/学生11_男生.svg',
  '/avatars/学生12_女生.svg',
  '/avatars/教师01_男教师.svg',
  '/avatars/教师02_女教师.svg',
  '/avatars/教师03_男教师.svg',
  '/avatars/教师04_女教师.svg',
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

export interface UserProfileState {
  /** Local avatar path or data-URL (for custom uploads) */
  avatar: string;
  nickname: string;
  bio: string;
  setAvatar: (avatar: string) => void;
  setNickname: (nickname: string) => void;
  setBio: (bio: string) => void;
}

export const useUserProfileStore = create<UserProfileState>()(
  persist(
    (set) => ({
      avatar: AVATAR_OPTIONS[0],
      nickname: '',
      bio: '',
      setAvatar: (avatar) => set({ avatar }),
      setNickname: (nickname) => set({ nickname }),
      setBio: (bio) => set({ bio }),
    }),
    {
      name: 'user-profile-storage',
      storage: createKVPersistStorage<UserProfileState>('account', {
        // One recovery attempt when a write is refused because hydration never
        // succeeded — the backend may have come back since. Routed through a
        // variable assigned below rather than naming the store directly: a
        // self-reference here would make the store's own type circular and
        // silently widen every selector to `any`.
        onWriteRefused: () => recovery.rehydrate?.(),
      }),
    },
  ),
);

// Bound after the store exists so the `onWriteRefused` hook above stays free of
// a self-reference (see the comment there).
recovery.rehydrate = () => useUserProfileStore.persist.rehydrate();

// Best-effort, fire-and-forget: drop the pre-cutover raw `localStorage` blob.
// It is never read (this store does not migrate legacy data), so a leftover is
// only garbage. No correctness depends on it.
purgeLegacyPersistKey('user-profile-storage');
