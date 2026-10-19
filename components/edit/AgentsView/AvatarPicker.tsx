/**
 * 本文件：内置智能体头像选择组件。
 * 职责：以网格列出内置头像，点击经 onChange 上抛所选路径。
 * 关键点：受控组件，只上报选择，不直接写入 store。
 */
'use client';

import { cn } from '@/lib/utils/cn';
import { AGENT_DEFAULT_AVATARS } from '@/lib/constants/agent-defaults';

interface AvatarPickerProps {
  readonly value: string;
  readonly onChange: (avatar: string) => void;
}

/**
 * A grid picker that lets the user choose one of the built-in agent avatars.
 * 内置头像网格选择器：高亮当前值，点击即回调。
 */
export function AvatarPicker({ value, onChange }: AvatarPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {AGENT_DEFAULT_AVATARS.map((src) => (
        <button
          key={src}
          type="button"
          aria-label={src}
          onClick={() => onChange(src)}
          className={cn(
            'flex size-12 items-center justify-center overflow-hidden rounded-xl border-2 transition-all',
            value === src
              ? 'border-primary shadow-[0_0_0_3px_rgba(29,78,216,0.18)]'
              : 'border-transparent hover:border-border',
          )}
        >
          {/* Static public path — no image optimizer needed. */}
          <img src={src} alt="" className="size-full object-cover" draggable={false} />
        </button>
      ))}
    </div>
  );
}
