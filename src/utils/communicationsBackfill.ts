import type { Client } from './settingsFirestore';
import type { DiscoveredContact } from '@/types/communicationsBackfill';

const domainOf = (email: string): string => email.toLowerCase().split('@')[1] || '';

/** Every distinct domain associated with a client: its own email plus every active CRM contact's email. */
export function getClientDomains(client: Client | null | undefined): string[] {
  if (!client) return [];
  const domains = new Set<string>();
  if (client.email) {
    const domain = domainOf(client.email);
    if (domain) domains.add(domain);
  }
  for (const contact of client.contacts || []) {
    if (contact.isActive === false || !contact.email) continue;
    const domain = domainOf(contact.email);
    if (domain) domains.add(domain);
  }
  return [...domains];
}

/** Split discovered contacts into ones matching the client's domain(s) and everything else, grouped by domain. */
export function groupContactsForPicker(
  contacts: DiscoveredContact[],
  clientDomains: string[]
): { matching: DiscoveredContact[]; otherByDomain: Record<string, DiscoveredContact[]> } {
  const clientDomainSet = new Set(clientDomains.map((d) => d.toLowerCase()));
  const matching: DiscoveredContact[] = [];
  const otherByDomain: Record<string, DiscoveredContact[]> = {};

  for (const contact of contacts) {
    if (clientDomainSet.has(contact.domain.toLowerCase())) {
      matching.push(contact);
    } else {
      (otherByDomain[contact.domain] ||= []).push(contact);
    }
  }

  return { matching, otherByDomain };
}
