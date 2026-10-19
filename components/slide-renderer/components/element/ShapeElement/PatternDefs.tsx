/**
 * 本文件：SVG 图案（纹理平铺）定义组件。
 * 职责：把图片源包装为 objectBoundingBox 单位的 <pattern>，使图案随形状缩放。
 * 关键点：preserveAspectRatio 使用 slice 保持比例并裁切填满。
 */
interface PatternDefsProps {
  id: string;
  src: string;
}

/** 生成按形状边界归一的图案 defs，id 与 useElementFill 的 url 引用对应。 */
export function PatternDefs({ id, src }: PatternDefsProps) {
  return (
    <pattern
      id={id}
      patternContentUnits="objectBoundingBox"
      patternUnits="objectBoundingBox"
      width="1"
      height="1"
    >
      <image href={src} width="1" height="1" preserveAspectRatio="xMidYMid slice" />
    </pattern>
  );
}
