// Extracted from main.tsx so the Sales Quote -> Project conversion flow's
// sequencing and status-message wording are testable without rendering the
// whole app.
import type { ProjectConversionOutcome } from "./persistence";

// Migration 127's create_project_from_quote() RPC requires the database's
// own quote status to already be 'closed_won' -- the old handleStatusChange
// fired onUpdateStatus() without awaiting it, then immediately prompted for
// and attempted the conversion, racing the status write and offering to
// convert even if that write had failed outright (handleUpdateSalesQuoteStatus
// catches its own errors and never told the caller). This makes the
// sequencing explicit: the status update must resolve, and report true,
// before the prompt or the conversion ever runs.
export async function runClosedWonConversionFlow(params: {
  nextStatus: string;
  updateStatus: () => Promise<boolean>;
  confirmCreateProject: () => boolean;
  createProject: () => Promise<void>;
}): Promise<void> {
  const updated = await params.updateStatus();
  if (!updated) {
    // Failure is already surfaced to the user by updateStatus() itself
    // (main.tsx's handleUpdateSalesQuoteStatus sets a status message on
    // catch) -- nothing more to do here except not proceed.
    return;
  }
  if (params.nextStatus !== "closed_won") {
    return;
  }
  if (!params.confirmCreateProject()) {
    return;
  }
  await params.createProject();
}

export type ProjectConversionMessage = {
  // Always shown in the inline status line under the Create Project button.
  status: string;
  // Also shown via window.alert() when non-null -- used for anything the
  // user must not be able to miss (a failure, or an unverified-structure
  // warning); null for a clean, fully-verified success with every photo
  // copied, where the inline status line alone is enough.
  alert: string | null;
};

// Pure by design (no DOM/window access, no React state) specifically so the
// exact wording and branching -- especially "never claim an unverified
// project is complete" and "never leak a raw server message" -- has real
// test coverage instead of living only in main.tsx where it can't be
// exercised directly.
export function buildProjectConversionStatusMessage(result: ProjectConversionOutcome): ProjectConversionMessage {
  if (!result.ok) {
    // result.message is either one of the RPC's own specific, known-safe
    // messages (wrong role, wrong workspace, not Closed - Won, a colliding
    // project name, a concurrent conversion, unavailable workspace access)
    // or the same generic fallback this app has always shown for a true
    // network/unknown failure -- never raw internal error text.
    return { status: result.message, alert: result.message };
  }

  const photoSummary = result.totalPhotos > 0 ? ` -- ${result.copiedPhotos + result.alreadyCopiedPhotos} of ${result.totalPhotos} photos copied` : "";

  if (!result.structureVerified) {
    // This project already existed but wasn't created (or re-verified) by
    // migration 127's atomic conversion -- most likely made by the pre-127
    // code, which could silently skip BOM lines/locations/items. Never
    // claim it's complete, and never auto-repair it here -- that's a
    // separate, separately reviewed decision.
    const unverifiedMessage = `Found an existing Project "${result.project.name}" (${result.project.ref || "no ref yet"}) linked to this quote, but it predates this reliability fix -- its BOM, scope of work, and locations are not verified complete. Review it manually on the Projects page before continuing.${photoSummary}`;
    return { status: unverifiedMessage, alert: unverifiedMessage };
  }

  // The project itself, its scope of work, every BOM line, and every
  // location + location item are guaranteed complete here -- the
  // server-side conversion (migration 127) is one atomic transaction, so a
  // fresh conversion either fully succeeds (structureVerified true) or
  // fully fails (result.ok false above). Only photo copying happens
  // afterward and can partially fail -- surfaced here instead of the old
  // always-identical success message that couldn't tell "everything
  // copied" from "almost nothing copied".
  //
  // Named counts (not just photos) so the PM can tell exactly what
  // transferred without opening the project and counting by hand -- these
  // numbers are a true, guaranteed-accurate report of what this call just
  // atomically wrote (unlike the unverified-project branch above, where a
  // count would falsely imply a guarantee that doesn't exist there).
  const verb = result.alreadyExisted ? "Found existing Project" : "Created Project";
  const structureSummary = ` -- ${result.bomLineCount} BOM line${result.bomLineCount === 1 ? "" : "s"}, ${result.locationCount} location${result.locationCount === 1 ? "" : "s"}, ${result.locationItemCount} location item${result.locationItemCount === 1 ? "" : "s"}`;
  const baseMessage = `${verb} "${result.project.name}" (${result.project.ref || "no ref yet"})${structureSummary}${photoSummary} -- find it on the Projects page.`;
  if (result.failedPhotos.length === 0) {
    return { status: baseMessage, alert: null };
  }

  const failureList = result.failedPhotos.map((failure) => `${failure.locationName}: ${failure.fileName} (${failure.reason})`).join("\n");
  const failureMessage = `${baseMessage} ${result.failedPhotos.length} photo${result.failedPhotos.length === 1 ? "" : "s"} did not copy. The project, BOM, scope of work, and locations are complete -- only the listed photos are missing. Click "Create Project" again to retry just the missing photos, or upload them directly on the project's Locations tab.\n\n${failureList}`;
  return {
    status: `${baseMessage} ${result.failedPhotos.length} photo${result.failedPhotos.length === 1 ? "" : "s"} did not copy -- see alert for details, or click Create Project again to retry.`,
    alert: failureMessage,
  };
}
