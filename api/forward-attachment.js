// Forwards a channel-message/DM attachment to another channel or DM the
// caller can already write to (migration 190,
// PRODUCT_CHANNEL_FILE_FORWARDING_DESIGN.md's own "smallest useful first
// release," §8). Two-step, matching the split this schema already
// established for the ONE existing precedent of copying a file between
// two different parents (migration 064's own header, project_location_images'
// Sales -> Project copy: "the copy itself... happens in application
// code"):
//
//   1. Call the `forward_attachment` RPC with the CALLER's OWN token, so
//      its SECURITY DEFINER body's manually-mirrored source-read/
//      destination-write checks run against the real, current caller --
//      never trusted from the client, never re-implemented here. On
//      success this inserts the new destination row (metadata only,
//      lineage columns set) and hands back BOTH the source storage path
//      (to copy FROM) and a freshly-computed destination-prefixed path
//      (to copy TO) -- see migration 190's own header for exactly why the
//      RPC cannot just reuse the source's raw path.
//   2. Copy the underlying object in the `message-attachments` bucket
//      from that source path to that destination path, via the Storage
//      API with the SERVICE ROLE key -- a plain user token cannot
//      necessarily read across two different parents' storage prefixes
//      in one call the way this copy needs to (the destination's own
//      upload policy only proves it can WRITE under its own prefix, not
//      that it can read an arbitrary object under someone else's), so
//      this one step needs the elevated key, same posture
//      create-notification.js already uses for its own service-role
//      writes.
//
// Failure-handling story (this repo's "no silent partial writes"
// discipline, established all session): if step 2 fails AFTER step 1's
// RPC already inserted the destination row, that row now points at a
// storage path with nothing behind it -- a broken reference no viewer
// could ever open. Rather than leave that around, this route deletes the
// just-inserted row (service role -- the row's own RLS may or may not
// still let the ORIGINAL caller delete it depending on whether this
// schema's message tables even allow author-deletes, so service role is
// the only mechanism guaranteed to always be able to undo it) and reports
// the forward as failed. The caller sees one clean outcome either way:
// forwarded and viewable, or not forwarded at all -- never "forwarded but
// broken."

import { requireAuth } from "./_lib/requireAuth.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

const SOURCE_KINDS = ["channel_message", "direct_message"];
const DESTINATION_KINDS = ["channel", "conversation"];
const MESSAGE_ATTACHMENT_BUCKET = "message-attachments";

const OUTCOME_MESSAGES = {
  source_not_found: "That message could not be found, or you don't have access to it.",
  source_has_no_attachment: "That message has no file to forward.",
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ forwarded: false, error: "Use POST to forward a file." });
    return;
  }
  const user = await requireAuth(req, res);
  if (!user) {
    return;
  }
  if (!(await checkRateLimit(`forward-attachment:${user.id}`, 30, 60_000))) {
    res.status(429).json({ forwarded: false, error: "Too many forwards -- please slow down." });
    return;
  }

  const { sourceKind, sourceId, destinationKind, destinationId, messageBody } = req.body || {};
  if (!SOURCE_KINDS.includes(sourceKind)) {
    res.status(400).json({ forwarded: false, error: `sourceKind must be one of: ${SOURCE_KINDS.join(", ")}` });
    return;
  }
  if (!DESTINATION_KINDS.includes(destinationKind)) {
    res.status(400).json({ forwarded: false, error: `destinationKind must be one of: ${DESTINATION_KINDS.join(", ")}` });
    return;
  }
  if (typeof sourceId !== "string" || !sourceId) {
    res.status(400).json({ forwarded: false, error: "sourceId is required." });
    return;
  }
  if (typeof destinationId !== "string" || !destinationId) {
    res.status(400).json({ forwarded: false, error: "destinationId is required." });
    return;
  }
  if (messageBody !== null && messageBody !== undefined && typeof messageBody !== "string") {
    res.status(400).json({ forwarded: false, error: "messageBody must be a string or null." });
    return;
  }

  const supabaseUrl = (process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    res.status(200).json({ forwarded: false, outcome: "not_configured", error: "Not configured." });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  // Step 1 -- the RPC, as the caller's own token. This is the ONLY place
  // any authorization decision is made; everything below is mechanical.
  let rpcRow;
  try {
    const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/forward_attachment`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${callerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        p_source_kind: sourceKind,
        p_source_id: sourceId,
        p_destination_kind: destinationKind,
        p_destination_id: destinationId,
        p_message_body: messageBody || null,
      }),
    });
    if (!rpcResponse.ok) {
      // A destination-write rejection surfaces as a raised Postgres
      // exception (migration 190's own design, mirroring how a raw RLS
      // denial would behave) -- PostgREST reports that as a non-2xx
      // response, not a soft outcome row. Give the caller a clean,
      // generic message rather than leaking the raw Postgres error text.
      const bodyText = await rpcResponse.text().catch(() => "");
      console.error(`forward-attachment: RPC rejected (${rpcResponse.status}): ${bodyText}`);
      res.status(rpcResponse.status === 404 ? 400 : 403).json({
        forwarded: false,
        outcome: "destination_denied",
        error: "You don't have permission to forward into that destination.",
      });
      return;
    }
    const rows = await rpcResponse.json();
    rpcRow = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    console.error(`forward-attachment: RPC call failed: ${error instanceof Error ? error.message : error}`);
    res.status(502).json({ forwarded: false, outcome: "error", error: "Could not reach the server to forward that file." });
    return;
  }

  if (!rpcRow || rpcRow.outcome !== "forwarded") {
    const outcome = rpcRow?.outcome || "error";
    res.status(200).json({ forwarded: false, outcome, error: OUTCOME_MESSAGES[outcome] || "Could not forward that file." });
    return;
  }

  const { new_id: newId, source_storage_path: sourcePath, destination_storage_path: destinationPath } = rpcRow;

  // Step 2 -- the actual byte-copy, service role (see this file's header
  // for why a plain user token can't necessarily do this one step).
  let copyOk = false;
  try {
    const copyResponse = await fetch(`${supabaseUrl}/storage/v1/object/copy`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        bucketId: MESSAGE_ATTACHMENT_BUCKET,
        sourceKey: sourcePath,
        destinationKey: destinationPath,
      }),
    });
    copyOk = copyResponse.ok;
    if (!copyOk) {
      const bodyText = await copyResponse.text().catch(() => "");
      console.error(`forward-attachment: storage copy failed (${copyResponse.status}): ${bodyText}`);
    }
  } catch (error) {
    console.error(`forward-attachment: storage copy threw: ${error instanceof Error ? error.message : error}`);
  }

  if (!copyOk) {
    // No silent partial writes -- the destination row already points at
    // a path with nothing behind it. Delete it (service role, so this
    // cleanup never itself depends on the destination table's own RLS)
    // and report the whole forward as failed.
    const destinationTable = destinationKind === "channel" ? "channel_messages" : "direct_messages";
    try {
      const cleanupResponse = await fetch(`${supabaseUrl}/rest/v1/${destinationTable}?id=eq.${encodeURIComponent(newId)}`, {
        method: "DELETE",
        headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
      });
      if (!cleanupResponse.ok) {
        const bodyText = await cleanupResponse.text().catch(() => "");
        console.error(`forward-attachment: cleanup delete of ${destinationTable}/${newId} failed (${cleanupResponse.status}): ${bodyText} -- a broken forwarded row may still exist, needs manual cleanup`);
      }
    } catch (error) {
      console.error(`forward-attachment: cleanup delete threw: ${error instanceof Error ? error.message : error} -- a broken forwarded row may still exist for ${destinationTable}/${newId}, needs manual cleanup`);
    }
    res.status(502).json({
      forwarded: false,
      outcome: "storage_copy_failed",
      error: "Could not copy the file -- the forward was undone.",
    });
    return;
  }

  res.status(200).json({ forwarded: true, outcome: "forwarded" });
}
