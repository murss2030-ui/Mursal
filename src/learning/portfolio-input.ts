import type { PortfolioCase } from '../domain/learning';
import type { Store } from '../store/store';

/** Every case's items, tasks and learning records, for the portfolio. */
export async function portfolioCases(store: Store, rotationId?: string): Promise<PortfolioCase[]> {
  const cases = (await store.listCases()).filter((c) => !rotationId || c.rotationId === rotationId);
  return Promise.all(
    cases.map(async (c) => ({
      caseId: c.id,
      rotationId: c.rotationId,
      items: await store.listItems(c.id),
      tasks: await store.listTasks(c.id),
      learning: await store.listLearning(c.id),
    })),
  );
}
