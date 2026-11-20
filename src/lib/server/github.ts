import { secret } from "./env";

/** Slowfall-pipeline runs every render, upload and sync (GitHub Actions). Token: fine-grained PAT, Actions read/write on that repo only. */
const REPO = "RafalSkwara/Slowfall-pipeline";

async function gh(path: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secret("GH_PIPELINE_TOKEN")}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "side-hustle-assistant",
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
  });
}

export async function dispatch(workflow: "job.yml" | "sync.yml", inputs?: Record<string, string>): Promise<void> {
  const res = await gh(`/actions/workflows/${workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", ...(inputs ? { inputs } : {}) }) });
  if (res.status !== 204) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** 409 = the run already finished, which is fine for a cancel */
export async function cancelRun(runId: number): Promise<void> {
  const res = await gh(`/actions/runs/${runId}/cancel`, { method: "POST" });
  if (res.status !== 202 && res.status !== 409) throw new Error(`GitHub ${res.status}`);
}

export const runUrl = (runId: number) => `https://github.com/${REPO}/actions/runs/${runId}`;
