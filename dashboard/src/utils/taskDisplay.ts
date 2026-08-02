export function buildDisplayTaskId(type?: string | null, externalTaskId?: string | null): string | null {
  if (!externalTaskId) return null;
  const label = String(type ?? '').toUpperCase() === 'POST' ? 'Post' : 'Comment';
  return `${label} #${externalTaskId}`;
}

export function displayTaskId(id: string, type?: string | null, externalTaskId?: string | null): string {
  return buildDisplayTaskId(type, externalTaskId) ?? id;
}
