export function safeRequestUrl(url: string | undefined): string | undefined {
  return url?.split('?', 1)[0];
}
