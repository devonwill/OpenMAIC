/**
 * 本文件：幻灯片背景选择器（纯色 / 图片两个 Tab）。
 * 职责：读取当前背景作为初值，通过 updateSlideBackground 以
 * slide.update {background} 级别写回，而非元素级操作。
 * 关键点：未设置背景时默认落在纯色 Tab（白色）；有图片背景时初始选中图片 Tab。
 */
'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/hooks/use-i18n';
import { ColorPicker } from './ColorPicker';
import { ImagePicker } from './ImagePicker';
import { updateSlideBackground, useResolvedSlideContent } from './use-slide-surface';

/**
 * Slide-background picker — solid color / image tabs. Slide-level, so it
 * dispatches `slide.update {background}` rather than an element op. Seeded from
 * the current background; defaults to the Solid tab (white) when none is set.
 *
 * 中文要点：纯色与图片的 onChange/onCommit 都直接落到同一个 slide 背景写入函数，
 * 属幻灯片级修改，不进元素操作历史。
 */
export function BackgroundControl() {
  const { t } = useI18n();
  const bg = useResolvedSlideContent().canvas.background;
  const color = bg?.type === 'solid' && bg.color ? bg.color : '#ffffff';
  return (
    <Tabs defaultValue={bg?.type === 'image' ? 'image' : 'solid'} className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="solid" className="flex-1">
          {t('edit.background.solid')}
        </TabsTrigger>
        <TabsTrigger value="image" className="flex-1">
          {t('edit.background.image')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="solid" className="pt-3">
        <ColorPicker
          className="w-full"
          value={color}
          onChange={(c) => updateSlideBackground({ type: 'solid', color: c })}
          onCommit={(c) => updateSlideBackground({ type: 'solid', color: c })}
        />
      </TabsContent>
      <TabsContent value="image" className="pt-3">
        <ImagePicker
          onPick={(src) => updateSlideBackground({ type: 'image', image: { src, size: 'cover' } })}
        />
      </TabsContent>
    </Tabs>
  );
}
