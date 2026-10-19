'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/lib/store/settings';
import { toCloneVoiceOptions, useAllVoiceProfiles } from '@/lib/audio/voxcpm-voices';

/**
 * Applies the default AI-teacher voice: when the global clone-voice switch is
 * on but no voice is selected yet (fresh accounts and v5-migrated stores ship
 * with the switch on and a blank pick), select the most recently registered
 * clone voice — the same option the settings popover auto-selects when the
 * switch is turned on. Without a registered voice there is nothing to pick
 * and callers keep their normal fallback. Renders nothing — purely a
 * side-effect component.
 */
export function CloneVoiceDefaultSync() {
  const { profiles } = useAllVoiceProfiles();
  const useMyCloneVoice = useSettingsStore((s) => s.useMyCloneVoice);
  const myCloneVoiceId = useSettingsStore((s) => s.myCloneVoiceId);
  const setMyCloneVoice = useSettingsStore((s) => s.setMyCloneVoice);

  useEffect(() => {
    if (!useMyCloneVoice || myCloneVoiceId) return;
    // profiles arrive sorted by updatedAt desc, so option [0] is the most
    // recently registered clone voice.
    const defaultClone = toCloneVoiceOptions(profiles)[0];
    if (!defaultClone) return;
    setMyCloneVoice({
      myCloneVoiceId: defaultClone.id,
      myCloneVoiceProvider: defaultClone.providerId,
    });
  }, [profiles, useMyCloneVoice, myCloneVoiceId, setMyCloneVoice]);

  return null;
}
