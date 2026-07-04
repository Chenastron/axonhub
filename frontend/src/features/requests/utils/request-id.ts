import { buildGUID } from '@/lib/utils';

export function normalizeRequestGUID(requestId: string) {
  return requestId.startsWith('gid://axonhub/') ? requestId : buildGUID('Request', requestId);
}
