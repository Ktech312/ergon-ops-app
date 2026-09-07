// Shared by api/send-push.js and api/create-notification.js -- both need
// to independently verify a real direct_messages row and derive its
// recipient the same way (the caller is the message's own recorded
// sender, checked with the caller's OWN token so direct_messages' RLS --
// migration 094 -- does the real work: a non-participant simply can't
// read the row at all). Extracted 2026-09-08 so this verification logic
// exists in exactly one place instead of being duplicated per route.
//
// Returns { ok: true, recipientId, senderEmail, body, attachmentFileName,
// conversationId } on success, or { ok: false, status, error } on any
// failure -- the caller decides how to respond, this never touches `res`
// itself.
export async function resolveDirectMessage(req, user, directMessageId, supabaseUrl, anonKey) {
  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const headers = { apikey: anonKey, authorization: `Bearer ${callerToken}` };
  const base = supabaseUrl.replace(/\/$/, "");

  const messageResponse = await fetch(
    `${base}/rest/v1/direct_messages?id=eq.${encodeURIComponent(directMessageId)}&select=id,conversation_id,sender_id,body,attachment_file_name`,
    { headers },
  );
  if (!messageResponse.ok) {
    return { ok: false, status: 502, error: "Could not look up that message." };
  }
  const messageRows = await messageResponse.json();
  const message = messageRows[0];
  if (!message) {
    // Either it doesn't exist, or RLS hid it because the caller isn't a
    // participant -- either way, nothing to notify from.
    return { ok: false, status: 404, error: "That message doesn't exist." };
  }
  if (message.sender_id !== user.id) {
    return { ok: false, status: 403, error: "You can only act on a message you sent." };
  }

  const conversationResponse = await fetch(
    `${base}/rest/v1/conversations?id=eq.${encodeURIComponent(message.conversation_id)}&select=participant_a_id,participant_b_id`,
    { headers },
  );
  if (!conversationResponse.ok) {
    return { ok: false, status: 502, error: "Could not look up that conversation." };
  }
  const conversationRows = await conversationResponse.json();
  const conversation = conversationRows[0];
  if (!conversation) {
    return { ok: false, status: 404, error: "That conversation doesn't exist." };
  }
  const recipientId = conversation.participant_a_id === user.id ? conversation.participant_b_id : conversation.participant_a_id;

  return {
    ok: true,
    recipientId,
    senderEmail: user.email || "a teammate",
    body: message.body || "",
    attachmentFileName: message.attachment_file_name || null,
    conversationId: message.conversation_id,
  };
}
