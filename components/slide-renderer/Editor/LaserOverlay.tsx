/**
 * 本文件：激光笔指针特效覆盖层。
 * 职责：以百分比坐标（0-100）把光点飞入到目标元素中心，
 *       渲染呼吸光环与亮核，动画分层由 laserV1 描述符驱动。
 * 关键点：left/top 需补 '%' 单位；key 含中心坐标以在移动时
 *       触发重新入场动画。
 */
'use client';

import { motion } from 'motion/react';
import { laserV1 } from '@/lib/choreography';
import type { PercentageGeometry } from '@/lib/types/action';
import { resolveMotionLayer } from './motion-descriptor-adapter';

interface LaserOverlayProps {
  geometry: PercentageGeometry;
  color?: string;
  duration?: number;
}

/**
 * Laser pointer overlay component
 *
 * Features:
 * - Smoothly flies in from the nearest corner to the element center
 * - Elegant light dot with soft breathing glow
 * - Uses percentage positioning (0-100)
 * 中文：光点从最近角飞入元素中心，百分比定位，带光环与呼吸光效。
 */
export function LaserOverlay({ geometry, color, duration: _duration = 3000 }: LaserOverlayProps) {
  const { centerX, centerY } = geometry;
  const layerOptions = {
    geometry,
    units: { left: '%', top: '%' },
    ...(color !== undefined ? { params: { color } } : {}),
  };
  const dot = resolveMotionLayer(laserV1, 'dot', layerOptions);
  const ring = resolveMotionLayer(laserV1, 'ring', layerOptions);
  const core = resolveMotionLayer(laserV1, 'core', layerOptions);

  return (
    <motion.div
      key={`laser-${centerX}-${centerY}`}
      initial={dot.initial}
      animate={dot.animate}
      exit={dot.exit}
      transition={dot.transition}
      className="absolute pointer-events-none"
      style={{ zIndex: laserV1.zIndex }}
    >
      <div className="relative" style={dot.staticProps}>
        {/* Ring pulse */}
        <motion.div
          initial={ring.initial}
          animate={ring.animate}
          transition={ring.transition}
          style={ring.staticProps}
        />

        {/* Light core */}
        <div style={core.staticProps} />
      </div>
    </motion.div>
  );
}
