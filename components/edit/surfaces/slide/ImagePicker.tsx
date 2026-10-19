/**
 * 本文件：图片来源选择器（本地文件 / 拖放 / 网络 URL）。
 * 职责：把三种来源统一成一个图片 src 字符串回调 onPick，
 * 本地文件经 FileReader 转 Data URL 后上抛。
 * 关键点：非 image/* 类型文件直接忽略；读取失败仅 console.error 不打断交互；
 * URL 输入为空或全空白时插入按钮保持禁用。
 */
'use client';

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/hooks/use-i18n';

interface ImagePickerProps {
  readonly onPick: (src: string) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ImagePicker({ onPick }: ImagePickerProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      onPick(await fileToDataUrl(file));
    } catch (err) {
      console.error('ImagePicker: failed to read image file', err);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFiles(e.dataTransfer.files);
        }}
        className="rounded-lg border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400"
      >
        {t('edit.insert.imageDrop')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <div className="text-center text-xs text-zinc-400">{t('edit.insert.imageOr')}</div>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('edit.insert.imageUrlPlaceholder')}
        />
        <Button type="button" disabled={!url.trim()} onClick={() => onPick(url.trim())}>
          {t('edit.insert.imageInsert')}
        </Button>
      </div>
    </div>
  );
}
