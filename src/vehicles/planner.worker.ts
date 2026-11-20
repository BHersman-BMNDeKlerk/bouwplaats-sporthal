/// <reference lib="webworker" />
import { plan, type PlanInput } from './planner';
self.onmessage = (e: MessageEvent<PlanInput>) => {
  try { (self as any).postMessage(plan(e.data)); } catch (err) { (self as any).postMessage({ ok: false, reden: String((err as Error).message ?? err), legs: [], poses: [], expansies: 0, lengte: 0, wissels: 0, restAfstand: Infinity }); }
};
