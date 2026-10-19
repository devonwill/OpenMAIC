import type { ViewportStyles } from '@openmaic/renderer';
import type { Guide } from '../core/snapping';

interface AlignmentGuidesProps {
  guides: readonly Guide[];
  viewportStyles: Pick<ViewportStyles, 'left' | 'top'>;
  canvasScale: number;
}

export function AlignmentGuides({ guides, viewportStyles, canvasScale }: AlignmentGuidesProps) {
  return guides.map((guide, index) => {
    const vertical = guide.type === 'vertical';
    return (
      <div
        key={`${guide.type}-${guide.axis.x}-${guide.axis.y}-${index}`}
        data-alignment-guide={guide.type}
        style={{
          position: 'absolute',
          zIndex: 42,
          left: viewportStyles.left + guide.axis.x * canvasScale,
          top: viewportStyles.top + guide.axis.y * canvasScale,
          width: vertical ? 0 : guide.length * canvasScale,
          height: vertical ? guide.length * canvasScale : 0,
          // 吸附参考线属于编辑器 chrome，用品牌蓝（与全局 --primary 同色），
          // 不用元素自身的填充色——否则拖动时会和被拖对象的选中框混在一起。
          borderLeft: vertical ? '1px dashed #044192' : undefined,
          borderTop: vertical ? undefined : '1px dashed #044192',
          transform: vertical ? 'translateX(-0.5px)' : 'translateY(-0.5px)',
          pointerEvents: 'none',
        }}
      />
    );
  });
}
