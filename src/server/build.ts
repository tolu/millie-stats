"use server";

/**
 * Does nothing, on purpose: the call is the question. A worker from another
 * build refuses it before it runs, so a rejection with `unknownFunction` means
 * the page is older than the deployment. See lib/staleBuild and the focus
 * check in App.tsx. No query, no binding — it runs every time the phone comes
 * back to the tab.
 */
export async function sameBuild(): Promise<true> {
  return true;
}
