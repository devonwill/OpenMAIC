/**
 * 本文件：SVG 渐变定义组件（<defs> 内的 linearGradient/radialGradient）。
 * 职责：按渐变类型与色标生成渐变定义，供形状 fill 引用。
 * 关键点：id 必须与 useElementFill 拼出的 url(#...) 完全一致。
 */
import type { GradientColor, GradientType } from '@openmaic/dsl';

interface GradientDefsProps {
  id: string;
  type: GradientType;
  colors: GradientColor[];
  rotate?: number;
}

/** 生成线性/径向渐变 defs；rotate 仅对线性渐变生效（绕 0.5,0.5 旋转）。 */
export function GradientDefs({ id, type, colors, rotate = 0 }: GradientDefsProps) {
  if (type === 'linear') {
    return (
      <linearGradient
        id={id}
        x1="0%"
        y1="0%"
        x2="100%"
        y2="0%"
        gradientTransform={`rotate(${rotate},0.5,0.5)`}
      >
        {colors.map((item, index) => (
          <stop key={index} offset={`${item.pos}%`} stopColor={item.color} />
        ))}
      </linearGradient>
    );
  }

  return (
    <radialGradient id={id}>
      {colors.map((item, index) => (
        <stop key={index} offset={`${item.pos}%`} stopColor={item.color} />
      ))}
    </radialGradient>
  );
}
