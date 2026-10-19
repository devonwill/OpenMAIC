/**
 * 本文件：智能体头像组件。
 * 职责：在对话消息中展示智能体的头像与名称，支持 URL 图片、emoji 或首字母回退。
 * 关键点：avatar 字符串以 http / / 、data: 开头才当图片，否则渲染为字符。
 */

/**
 * Agent Avatar Component
 * Displays agent avatar and name in chat messages
 */

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

interface AgentAvatarProps {
  avatar: string; // Image URL or emoji
  color: string; // Theme color (hex)
  name: string; // Agent display name
  size?: 'sm' | 'md' | 'lg';
}

// 头像来源判定：图片 URL / 本地路径 / data URI 走 AvatarImage，其余当字符展示。
function isUrl(str: string): boolean {
  return str.startsWith('http') || str.startsWith('/') || str.startsWith('data:');
}

// 主组件：头像与名称横排，边框和文字用智能体主题色。
export default function AgentAvatar({ avatar, color, name, size = 'md' }: AgentAvatarProps) {
  const sizeClasses = {
    sm: 'size-6',
    md: 'size-8',
    lg: 'size-10',
  };

  return (
    <div className="flex items-center gap-2 mb-2">
      <Avatar className={sizeClasses[size]} style={{ borderColor: color, borderWidth: 2 }}>
        {isUrl(avatar) ? (
          <>
            <AvatarImage src={avatar} alt={name} />
            <AvatarFallback style={{ backgroundColor: `${color}20`, color }}>
              {name.charAt(0)}
            </AvatarFallback>
          </>
        ) : (
          <AvatarFallback style={{ backgroundColor: `${color}20`, color }}>
            {avatar || name.charAt(0)}
          </AvatarFallback>
        )}
      </Avatar>
      <span className="text-sm font-semibold" style={{ color }}>
        {name}
      </span>
    </div>
  );
}
