import { describe, expect, it } from 'vitest';
import { getClientDomains, groupContactsForPicker } from '../communicationsBackfill';
import type { Client } from '../settingsFirestore';
import type { DiscoveredContact } from '@/types/communicationsBackfill';

const baseClient: Client = {
  id: 'c1',
  company: 'Client Co',
  email: 'ops@clientco.com',
  phone: '',
  address: '',
  contactPerson: 'Jane',
  contacts: [
    { id: 'ct1', name: 'Jane', email: 'jane@clientco.com', phone: '', role: 'technical', isPrimary: true, isActive: true },
    { id: 'ct2', name: 'Old Bob', email: 'bob@formerdomain.com', phone: '', role: 'commercial', isPrimary: false, isActive: false },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('getClientDomains', () => {
  it('collects domains from the client email and active contacts, deduplicated', () => {
    expect(getClientDomains(baseClient)).toEqual(['clientco.com']);
  });

  it('ignores inactive contacts', () => {
    const domains = getClientDomains({
      ...baseClient,
      email: '',
      contacts: [{ id: 'ct2', name: 'Old Bob', email: 'bob@formerdomain.com', phone: '', role: 'commercial', isPrimary: false, isActive: false }],
    });
    expect(domains).toEqual([]);
  });

  it('returns an empty array for a missing client', () => {
    expect(getClientDomains(null)).toEqual([]);
    expect(getClientDomains(undefined)).toEqual([]);
  });
});

const contact = (email: string, messageCount = 1): DiscoveredContact => ({
  email,
  name: '',
  domain: email.split('@')[1],
  messageCount,
  lastSeenAt: '2026-01-01T00:00:00.000Z',
});

describe('groupContactsForPicker', () => {
  it('splits contacts into client-domain matches and everything else, grouped by domain', () => {
    const contacts = [contact('jane@clientco.com'), contact('bob@vendorco.com'), contact('sam@vendorco.com')];
    const result = groupContactsForPicker(contacts, ['clientco.com']);
    expect(result.matching).toEqual([contact('jane@clientco.com')]);
    expect(result.otherByDomain).toEqual({ 'vendorco.com': [contact('bob@vendorco.com'), contact('sam@vendorco.com')] });
  });

  it('treats every contact as "other" when there are no client domains', () => {
    const contacts = [contact('jane@clientco.com')];
    const result = groupContactsForPicker(contacts, []);
    expect(result.matching).toEqual([]);
    expect(result.otherByDomain).toEqual({ 'clientco.com': [contact('jane@clientco.com')] });
  });

  it('handles an empty contact list', () => {
    expect(groupContactsForPicker([], ['clientco.com'])).toEqual({ matching: [], otherByDomain: {} });
  });
});
