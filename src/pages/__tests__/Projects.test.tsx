import { describe, expect, it } from 'vitest';
import { isProjectVisibleInList } from '../Projects';
import type { FirestoreProject } from '@/types/project';

const baseProject = { projectId: 'p1', projectName: 'Test', clientName: 'Acme', status: 'Ongoing' } as FirestoreProject;

describe('isProjectVisibleInList', () => {
  it('hides an archived project with no support profile', () => {
    expect(isProjectVisibleInList({ ...baseProject, status: 'Archived' })).toBe(false);
  });

  it('shows an archived project that has an active support profile', () => {
    expect(isProjectVisibleInList({ ...baseProject, status: 'Archived', supportProfile: { machines: [] } as never })).toBe(true);
  });

  it('shows a non-archived project regardless of support profile', () => {
    expect(isProjectVisibleInList({ ...baseProject, status: 'Ongoing' })).toBe(true);
  });
});
