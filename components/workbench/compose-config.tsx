'use client';

/**
 * The composer's quick-config entry — the slot right of ✨ on the workbench
 * chat toolbar.
 *
 * Why it exists: two settings decide what a turn actually feels like — which
 * model answers the generation/quiz/session requests, and which voice speaks —
 * but both used to live only behind the settings dialog, so checking "what am
 * I talking to?" cost a page round-trip. This button puts the current model
 * name ON the button (readable without clicking) and both pickers in one
 * popover one click away; ⌘⇧M opens it without moving the hand off the keys.
 *
 * Scope, stated honestly in the UI: the workbench reply model is routed
 * server-side (`MODEL_ROUTES`) and is NOT affected here — this picker drives
 * the client-side `getCurrentModelConfig` consumers (scene generation, chat
 * sessions, quizzes, PBL).
 */
import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Play, SlidersHorizontal, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { isLLMProviderConfigured } from '@/lib/store/settings-validation';
import { findModelById, modelIdsMatch } from '@/lib/ai/model-aliases';
import type { ProviderId } from '@/lib/ai/providers';
import {
  TTS_PROVIDERS,
  getTTSVoices,
  resolveTTSModelForVoice,
} from '@/lib/audio/constants';
import { isCustomTTSProvider } from '@/lib/audio/types';
import { resolveTTSProviderName } from '@/lib/audio/provider-display';
import { VOXCPM_AUTO_VOICE_ID, normalizeVoxCPMBackend, voxCPMBackendSupportsReferenceAudio } from '@/lib/audio/voxcpm';
import {
  getVoxCPMProviderOptions,
  getVoxCPMVoiceOptions,
  toCloneVoiceOptions,
  useAllVoiceProfiles,
} from '@/lib/audio/voxcpm-voices';
import { useTTSPreview } from '@/lib/audio/use-tts-preview';

/** The label shown on the button and in the tooltip: "provider / model". */
function useCurrentModelLabel(): { providerName: string; modelLabel: string } {
  const providerId = useSettingsStore((s) => s.providerId);
  const modelId = useSettingsStore((s) => s.modelId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const providerConfig = providersConfig?.[providerId];
  const model = findModelById(providerId, providerConfig?.models, modelId);
  return {
    providerName: providerConfig?.name || providerId,
    modelLabel: model?.name || modelId,
  };
}

/** Voice names in "ChineseName (English)" form show the English part in en-US. */
function voiceDisplayName(id: string, name: string, locale: string, t: (key: string) => string): string {
  if (id === VOXCPM_AUTO_VOICE_ID) return t('settings.voxcpmAutoVoice');
  if (locale === 'en-US') {
    const match = name.match(/\(([^)]+)\)/);
    return match ? match[1] : name;
  }
  return name;
}

const SECTION_LABEL_CLS = 'flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground';
const SELECT_CLS = 'h-8 min-w-0 flex-1 text-xs';

export function ComposeConfigButton() {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const { previewing, startPreview, stopPreview } = useTTSPreview();

  // ── Model (client-side getCurrentModelConfig consumers) ──
  const providerId = useSettingsStore((s) => s.providerId);
  const modelId = useSettingsStore((s) => s.modelId);
  const providersConfig = useSettingsStore((s) => s.providersConfig);
  const setModel = useSettingsStore((s) => s.setModel);
  const { providerName, modelLabel } = useCurrentModelLabel();

  // ── Voice (shared TTS settings) ──
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const setTTSEnabled = useSettingsStore((s) => s.setTTSEnabled);
  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const setTTSProvider = useSettingsStore((s) => s.setTTSProvider);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);
  const { profiles: voiceProfiles } = useAllVoiceProfiles();
  const voxcpmProfiles = voiceProfiles.filter((p) => p.providerId === 'voxcpm-tts');
  const qwenProfiles = voiceProfiles.filter((p) => p.providerId === 'qwen-tts');
  // ── Clone voice（与设置弹窗同一份全局覆盖状态，这里只是把它搬到快捷配置里）──
  const useMyCloneVoice = useSettingsStore((s) => s.useMyCloneVoice);
  const myCloneVoiceId = useSettingsStore((s) => s.myCloneVoiceId);
  const setMyCloneVoice = useSettingsStore((s) => s.setMyCloneVoice);
  const cloneProfiles = toCloneVoiceOptions(voiceProfiles);
  const voxcpmBackend = normalizeVoxCPMBackend(
    ttsProvidersConfig['voxcpm-tts']?.providerOptions?.backend,
  );

  // ⌘⇧M / Ctrl+Shift+M toggles the popover from anywhere in the workbench —
  // the whole point is changing config without leaving the keyboard.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.key.toLowerCase() !== 'm') return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Only providers with usable credentials/models are offered — a picker full
  // of dead ends is worse than a short one (same rule as the generation
  // toolbar's model popover).
  const configuredProviders = providersConfig
    ? Object.entries(providersConfig)
        .filter(([, config]) => isLLMProviderConfigured(config))
        .map(([id, config]) => ({
          id: id as ProviderId,
          name: config.name,
          models:
            config.isServerConfigured && !config.apiKey && config.serverModels?.length
              ? config.models.filter((model) =>
                  config.serverModels?.some((serverModelId) =>
                    modelIdsMatch(id, model.id, serverModelId),
                  ),
                )
              : config.models,
        }))
    : [];
  const activeProvider = configuredProviders.find((p) => p.id === providerId);
  // If the stored provider is not (or no longer) configured, fall back to the
  // first live one so the selects never render a phantom value.
  const selectProviderId = activeProvider?.id ?? configuredProviders[0]?.id;

  const onProviderChange = (nextProviderId: string) => {
    const next = configuredProviders.find((p) => p.id === nextProviderId);
    const firstModel = next?.models[0];
    // Provider and model are committed together: setModel takes both, and a
    // half-switched pair would point at a model the provider never offered.
    if (next && firstModel) setModel(next.id, firstModel.id);
  };

  const ttsProviderOptions = [
    ...Object.values(TTS_PROVIDERS).map((p) => ({
      id: p.id as string,
      name: resolveTTSProviderName(p.id, t),
    })),
    ...Object.entries(ttsProvidersConfig)
      .filter(([id]) => isCustomTTSProvider(id))
      .map(([id, config]) => ({ id, name: config.customName || id })),
  ];

  const voices =
    isCustomTTSProvider(ttsProviderId)
      ? (ttsProvidersConfig[ttsProviderId]?.customVoices ?? []).map((voice) => ({
          id: voice.id,
          name: voice.name,
          language: 'auto',
          gender: 'neutral' as const,
        }))
      : ttsProviderId === 'voxcpm-tts'
        ? getVoxCPMVoiceOptions(voxcpmProfiles, {
            supportsClone: voxCPMBackendSupportsReferenceAudio(voxcpmBackend),
          })
        : ttsProviderId === 'qwen-tts'
          ? [
              ...getTTSVoices(ttsProviderId),
              ...qwenProfiles.map((profile) => ({
                id: profile.id,
                name: profile.name,
                language: 'auto',
                gender: 'neutral' as const,
              })),
            ]
          : getTTSVoices(ttsProviderId);
  const localizedVoices = voices.map((voice) => ({
    ...voice,
    displayName: voiceDisplayName(voice.id, voice.name, locale, t),
  }));
  // The VoxCPM auto voice has no reference audio to synthesize from — same
  // rule as the settings dialog's preview button.
  const canPreview = ttsProviderId !== 'voxcpm-tts' || ttsVoice !== VOXCPM_AUTO_VOICE_ID;

  const handlePreview = useCallback(async () => {
    if (previewing) {
      stopPreview();
      return;
    }
    if (!canPreview) {
      toast.info(t('settings.voxcpmAutoVoiceNoPreview'));
      return;
    }
    try {
      const providerConfig = ttsProvidersConfig[ttsProviderId];
      const providerOptions =
        ttsProviderId === 'voxcpm-tts'
          ? {
              ...(providerConfig?.providerOptions || {}),
              ...(await getVoxCPMProviderOptions(ttsVoice, { role: 'teacher', locale })),
            }
          : undefined;
      await startPreview({
        text: t('settings.ttsTestTextDefault'),
        providerId: ttsProviderId,
        modelId: resolveTTSModelForVoice(ttsProviderId, ttsVoice, providerConfig?.modelId),
        voice: ttsVoice,
        speed: ttsSpeed,
        apiKey: providerConfig?.apiKey,
        baseUrl: providerConfig?.baseUrl || providerConfig?.customDefaultBaseUrl,
        providerOptions,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t('settings.ttsTestFailed');
      toast.error(message);
    }
  }, [
    previewing,
    canPreview,
    startPreview,
    stopPreview,
    t,
    locale,
    ttsProviderId,
    ttsProvidersConfig,
    ttsSpeed,
    ttsVoice,
  ]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) stopPreview();
      setOpen(nextOpen);
    },
    [stopPreview],
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="workbench-compose-config"
              // Exempt from the mention/slash menus' outside-press close, like
              // the send button: a pointerdown here must not be eaten by the
              // menu's dismissal before this click registers.
              data-mention-keep-open=""
              aria-label={`${t('proMode.config')} · ${providerName} / ${modelLabel}`}
              aria-keyshortcuts="Control+Shift+M Meta+Shift+M"
              className="inline-flex h-8 max-w-[150px] items-center gap-1.5 rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <SlidersHorizontal className="size-4 shrink-0" />
              {/* The model name IS the state indicator — no click needed to
                  know what you are talking to. */}
              <span className="truncate text-xs">{modelLabel}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {`${t('proMode.config')} · ${providerName} / ${modelLabel} (⌘⇧M)`}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="w-[300px] p-0"
      >
        <div className="space-y-3 p-3">
          {/* ── Model ── */}
          <div className="space-y-1.5">
            <div className={SECTION_LABEL_CLS}>
              <Bot className="size-3.5" />
              <span>{t('proMode.configModel')}</span>
            </div>
            {configuredProviders.length === 0 ? (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {t('proMode.configNoModelProvider')}
              </p>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Select value={selectProviderId} onValueChange={onProviderChange}>
                    <SelectTrigger className={SELECT_CLS}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {configuredProviders.map((p) => (
                        <SelectItem key={p.id} value={p.id} className="text-xs">
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={modelId} onValueChange={(next) => setModel(providerId, next)}>
                    <SelectTrigger className={SELECT_CLS}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(activeProvider?.models ?? []).map((model) => (
                        <SelectItem key={model.id} value={model.id} className="text-xs">
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[10px] leading-snug text-muted-foreground/80">
                  {t('proMode.configModelScope')}
                </p>
              </>
            )}
          </div>

          <div className="border-t border-border/50" />

          {/* ── Voice ── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className={SECTION_LABEL_CLS}>
                <Volume2 className="size-3.5" />
                <span>{t('proMode.configVoice')}</span>
              </div>
              <Switch
                checked={ttsEnabled}
                onCheckedChange={setTTSEnabled}
                aria-label={t('toolbar.ttsTitle')}
                className="scale-[0.8] origin-right"
              />
            </div>
            {ttsEnabled && (
              <>
                <Select value={ttsProviderId} onValueChange={setTTSProvider}>
                  <SelectTrigger className={cn(SELECT_CLS, 'w-full')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ttsProviderOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  <Select value={ttsVoice} onValueChange={setTTSVoice}>
                    <SelectTrigger className={SELECT_CLS}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {localizedVoices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id} className="text-xs">
                          {voice.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => void handlePreview()}
                    disabled={!canPreview}
                    aria-label={previewing ? t('toolbar.ttsPreviewing') : t('toolbar.ttsPreview')}
                    className={cn(
                      'inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors',
                      !canPreview
                        ? 'cursor-not-allowed opacity-50'
                        : previewing
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                          : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {previewing ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Play className="size-3" />
                    )}
                    {t('toolbar.ttsPreview')}
                  </button>
                </div>

                {/* Global clone-voice override — the same single switch the
                    settings dialog carries, surfaced here so swapping to one's
                    own voice needs no round-trip out of the conversation. */}
                <div className="space-y-1.5 border-t border-border/40 pt-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {t('proMode.configCloneUse')}
                    </span>
                    <Switch
                      checked={useMyCloneVoice}
                      disabled={cloneProfiles.length === 0}
                      onCheckedChange={(checked) => {
                        setMyCloneVoice({ useMyCloneVoice: checked });
                        // First turn-on with no pick yet: default to the most
                        // recently registered clone (profiles sort newest first).
                        if (checked && !myCloneVoiceId && cloneProfiles[0]) {
                          setMyCloneVoice({
                            myCloneVoiceId: cloneProfiles[0].id,
                            myCloneVoiceProvider: cloneProfiles[0].providerId,
                          });
                        }
                      }}
                      aria-label={t('proMode.configCloneUse')}
                      className="scale-[0.85] origin-right shrink-0"
                    />
                  </div>
                  {useMyCloneVoice && cloneProfiles.length > 0 && (
                    <Select
                      value={myCloneVoiceId || undefined}
                      onValueChange={(voiceId) => {
                        const profile = cloneProfiles.find((p) => p.id === voiceId);
                        if (!profile) return;
                        setMyCloneVoice({
                          myCloneVoiceId: profile.id,
                          myCloneVoiceProvider: profile.providerId,
                        });
                      }}
                    >
                      <SelectTrigger className={cn(SELECT_CLS, 'w-full')}>
                        <SelectValue placeholder={t('proMode.configCloneSelect')} />
                      </SelectTrigger>
                      <SelectContent>
                        {cloneProfiles.map((profile) => (
                          <SelectItem key={profile.id} value={profile.id} className="text-xs">
                            {`${profile.name} (${profile.providerId})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {cloneProfiles.length === 0 && (
                    <p className="text-[10px] leading-snug text-muted-foreground/80">
                      {t('proMode.configCloneEmpty')}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
