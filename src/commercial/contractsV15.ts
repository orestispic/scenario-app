export const COMMERCIAL_CONTRACT_VERSION_V15 = '2026-09-v15' as const;

export interface ContactView {
  profileId: string;
  displayName: string;
  email: string;
  since: string;
}

export interface ContactRequestView {
  id: string;
  profileId: string;
  displayName: string;
  email: string;
  createdAt: string;
}

export interface ContactListResponse {
  contractVersion: typeof COMMERCIAL_CONTRACT_VERSION_V15;
  contacts: ContactView[];
  receivedRequests: ContactRequestView[];
  sentRequests: ContactRequestView[];
  request_id: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validPerson(value: unknown, request = false): value is ContactView | ContactRequestView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return uuid.test(String(item.profileId)) && typeof item.displayName === 'string' && item.displayName.length > 0 &&
    typeof item.email === 'string' && item.email.includes('@') &&
    typeof item[request ? 'createdAt' : 'since'] === 'string' &&
    (!request || uuid.test(String(item.id)));
}

export function parseContacts(value: unknown): ContactListResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse des contacts invalide.');
  const data = value as Record<string, unknown>;
  if (data.contractVersion !== COMMERCIAL_CONTRACT_VERSION_V15 || typeof data.request_id !== 'string' ||
      !Array.isArray(data.contacts) || data.contacts.some((item) => !validPerson(item)) ||
      !Array.isArray(data.receivedRequests) || data.receivedRequests.some((item) => !validPerson(item, true)) ||
      !Array.isArray(data.sentRequests) || data.sentRequests.some((item) => !validPerson(item, true)))
    throw new Error('Réponse des contacts invalide.');
  return data as unknown as ContactListResponse;
}

export function parseContactMutation(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse des contacts invalide.');
  const data = value as Record<string, unknown>;
  if (data.contractVersion !== COMMERCIAL_CONTRACT_VERSION_V15 || data.updated !== true || typeof data.request_id !== 'string')
    throw new Error('Réponse des contacts invalide.');
}
