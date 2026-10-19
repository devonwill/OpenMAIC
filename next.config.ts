import type { NextConfig } from 'next';

const isVercelBuild = Boolean(process.env.VERCEL);

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  outputFileTracingIncludes: {
    '/*': [
      'lib/server/agent-runtime/import-pptx-worker.mjs',
      'skills/openmaic/**',
      'data/knowledge/*.json',
      'skills/agent-runtime/**',
      // Loaded through a runtime-only `import('undici')` (see the LLM
      // dispatcher in lib/ai/providers.ts and the Google proxy transport), so
      // the output tracer never sees it and standalone builds ship without it.
      'node_modules/undici/**',
      // neo4j-driver 是通过 new Function('s','return import(s)') 动态加载的
      // （目的是未安装时优雅降级到 JSON），standalone trace 无法追踪到，
      // 生产镜像会缺失该包及其 .pnpm 下的传递依赖，导致 Aura 云端图谱连接降级为 JSON。
      // 这里只声明顶层入口；.pnpm 下的真实目录由 Dockerfile 在 next build 之后
      // 显式 copy 进 .next/standalone/node_modules —— 用 outputFileTracingIncludes
      // 写 `node_modules/.pnpm/*@*/**` 这类 glob 会把同级目录（如 buffer/）也匹配
      // 成"文件"，Turbopack 追踪时直接报 Failed to read file。
      'node_modules/neo4j-driver/**',
      // sharp's native libvips libraries are loaded via dlopen and are not
      // statically analyzable, so Next.js standalone tracing omits them. Two
      // sharp versions resolve in the tree (0.34.5 transitive -> libvips
      // 1.2.4, 0.35.4 direct -> libvips 1.3.3); tracing picked the wrong one
      // and the runtime dlopen of sharp 0.35.4 failed with
      // "libvips-cpp.so.8.18.6: No such file or directory" on self-hosted
      // Docker (Alpine/musl) deployments. Force-include every sharp-libvips
      // native lib dir for standalone builds. Vercel packages its runtime
      // dependencies itself; including every native variant there bloats each
      // traced function and can push Hobby deployments past 12 bundles.
      ...(!isVercelBuild
        ? ['node_modules/.pnpm/@img+sharp-libvips-*/node_modules/@img/sharp-libvips-*/lib/**']
        : []),
    ],
  },
  typescript: {
    tsconfigPath: process.env.NODE_ENV === 'production' ? 'tsconfig.build.json' : 'tsconfig.json',
    // 构建期跳过 in-build 类型检查：目标部署机仅 2 核 / 3.6G 内存，`next build`
    // 的 TypeScript 检查会在 swap 抖动约 60 分钟后被 OOM 杀死（无任何 TS 报错）。
    // 类型正确性由本地 `npx tsc --noEmit -p tsconfig.build.json` 作为闸门保证，
    // 该检查已通过（0 错误），此处跳过的是构建机上无法完成的重复检查。
    ignoreBuildErrors: true,
  },
  transpilePackages: ['mathml2omml', 'pptxgenjs', '@openmaic/importer'],
  // These agent packages do a runtime `import(specifier)` with a computed
  // specifier (to lazily load node:fs/os/path without breaking browser/Vite
  // builds). webpack can't statically analyze that and bundling it throws
  // "Cannot find module as expression is too dynamic" at runtime on the server
  // (the "Edit with AI" Pro-mode path), which broke the #619 keep-alive e2e.
  // Mark them server-external so Next loads them natively and the dynamic
  // import resolves as a real Node call.
  serverExternalPackages: [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@openmaic/generation',
    // Optional peers of @openmaic/storage, reached through deliberately
    // untraced dynamic imports. Externalizing keeps them out of the bundle,
    // and the static anchor in lib/persistence/asset-byte-store.ts gets them
    // traced into the standalone image -- without it, S3 mode and redirect
    // egress cannot resolve their SDK in the shipped deployment.
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
  // 关掉 Next.js 15+ 默认在 `next dev` 注入的 Dev Tools 浮窗（左下角 "N" 按钮，
  // 含 Preferences / Route Info 等菜单）。它只在开发模式出现，生产构建不受影响；
  // 设为 false 后 `next dev` 也会隐藏该浮窗，避免与右上角系统设置重复。
  devIndicators: false,
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async headers() {
    const extraAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim();
    const frameAncestors = extraAncestors ? `'self' ${extraAncestors}` : "'self'";

    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
