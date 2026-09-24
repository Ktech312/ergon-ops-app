// Shared by api/send-notification.js and api/create-notification.js -- both need
// to independently verify a real direct_messages row and derive its
// recipients the same way (the caller is the message's own recorded
// sender, checked with the caller's OWN token so direct_messages' RLS --
// migration 094, extended by 187/203 -- does the real work: a non-member
// simply can't read the row at all). Extracted 2026-09-08 so this
// verification logic exists in exactly one place instead of being
// duplicated per route.
//
// recipientIds (migration 203, multi-person direct conversations): every
// OTHER member of the conversation, not just "the other participant" --
// a 1:1 conversation still resolves via its own participant_a_id/
// participant_b_id columns (always populated, unchanged), while a group
// conversation (participant columns null) resolves via conversation_members
// instead. Every consumer already looped over an array before this change
// (api/create-notification.js's recipientIds), or is updated alongside
// this file (api/send-notification.js's push path) to loop instead of
// assuming exactly one.
//
// Returns { ok: true, recipientIds, senderEmail, body, attachmentFileName,
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
    `${base}/rest/v1/conversations?id=eq.${encodeURIComponent(message.conversation_id)}&select=participant_a_id,participant_b_id,is_group`,
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

  let recipientIds;
  if (conversation.is_group) {
    const membersResponse = await fetch(
      `${base}/rest/v1/conversation_members?conversation_id=eq.${encodeURIComponent(message.conversation_id)}&select=user_id`,
      { headers },
    );
    if (!membersResponse.ok) {
      return { ok: false, status: 502, error: "Could not look up that conversation's members." };
    }
    const memberRows = await membersResponse.json();
    recipientIds = memberRows.map((row) => row.user_id).filter((id) => id !== user.id);
  } else {
    const otherId = conversation.participant_a_id === user.id ? conversation.participant_b_id : conversation.participant_a_id;
    recipientIds = otherId ? [otherId] : [];
  }

  return {
    ok: true,
    recipientIds,
    senderEmail: user.email || "a teammate",
    body: message.body || "",
    attachmentFileName: message.attachment_file_name || null,
    conversationId: message.conversation_id,
  };
}
