// 与 access-token-shared.ts 同款纯函数校验：Node 与 Edge 两个验签器共用，
// 保证“Edge 放行的 token Node 一定也认”。
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

export function isSessionIdValid(sessionId: string): boolean {
  return UUID_V4.test(sessionId);
}

export function isSignatureFormatValid(signature: string): boolean {
  return LOWER_HEX_64.test(signature);
}
