/**
 * 本文件：输入区课程引用胶囊。
 * 职责：展示本条消息所点名的课程（@ 提及），可单个移除，随消息发送。
 * 关键点：与元素引用胶囊共用 composer-pill 词汇；区别于输入框下方
 * 常驻且不随消息发送的会话课程条。
 */
'use client';

/**
 * Course reference pills — the classrooms named for THIS message.
 *
 * The sibling of `ElementRefPills`, and deliberately in the same pill vocabulary
 * (`composer-pill`): both rows say "this is attached to the sentence you are
 * writing and goes away when you send it". The tone differs — a course ref has
 * no canvas pin to echo, so it takes the neutral skin rather than the element
 * pin's violet.
 *
 * NOT to be confused with the session course strip below the box, which is
 * permanent and is not sent anywhere.
 */
import { BookOpen } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { CourseRef } from '@/lib/workbench/course-refs';
import { ComposerPill, ComposerPillRow } from './composer-pill';

// 无引用时整行不渲染；inline 决定复用调用方已有的胶囊行而非自开一行。
export function CourseRefPills({
  refs,
  onRemove,
  className,
  testId = 'course-ref-pills',
  inline = false,
}: {
  readonly refs: readonly CourseRef[];
  readonly onRemove?: (stageId: string) => void;
  readonly className?: string;
  readonly testId?: string;
  /** Share the caller's pill row instead of opening one (see `ComposerPillRow`). */
  readonly inline?: boolean;
}) {
  const { t } = useI18n();
  if (refs.length === 0) return null;
  return (
    <ComposerPillRow className={inline ? undefined : className} contents={inline} testId={testId}>
      {refs.map((courseRef) => (
        <ComposerPill
          key={courseRef.stageId}
          tone="accent"
          testId="course-ref-pill"
          icon={<BookOpen size={10} />}
          label={courseRef.title}
          title={t('workspace.courseMention.pillHint', { name: courseRef.title })}
          onRemove={onRemove ? () => onRemove(courseRef.stageId) : undefined}
          removeLabel={t('workspace.courseMention.remove', { name: courseRef.title })}
        />
      ))}
    </ComposerPillRow>
  );
}
