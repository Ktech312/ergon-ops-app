// The trusted notification-creation dispatch table (HANDOFF Questions/
// Decisions #9, closed 2026-09-08). Each handler independently derives
// WHO gets notified and WHAT they see from real stored data -- a caller
// supplies only an eventType and a real entity id, never a recipient,
// title, body, or url. See api/create-notification.js for the HTTP
// handler that calls into this table.
//
// Design notes (why each event's authorization looks the way it does):
// most of these entities (tasks, purchase requests, builds, catalog
// price requests) already have real RLS write-policies that decide who
// could perform the underlying action -- where that RLS is a real role
// gate (purchasing/warehouse/manager), this dispatch table re-checks the
// SAME role, so notification-authorization never diverges from actual
// write-authorization. Where the underlying RLS is genuinely open to any
// authenticated user (tasks, channel_canvas), the notification is
// authorized the same way -- this file does not invent new restrictions
// beyond what the data model already enforces; it only stops content and
// recipients from being independently fabricated.

const TASK_STATUS_LABELS = {
  to_do: "To Do",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  done: "Done",
  blocked: "Blocked",
};

const ROLE_LABELS = {
  warehouse: "Warehouse",
  purchasing: "Procurement",
  pm: "PM",
  manager: "Manager",
  sales: "Sales",
  engineering: "Engineering",
  product_development: "Product Development",
  implementation: "Implementation",
  support: "Support",
  marketing: "Marketing",
};

const BUILD_STAGE_LABELS = {
  planned: "Planned",
  kitting: "Kitting",
  assembled: "Assembled",
  tested: "Tested",
  complete: "Complete",
};

function err(status, message) {
  return { error: { status, message } };
}

async function restGet(ctx, path, useServiceRole) {
  const key = useServiceRole ? ctx.serviceRoleKey : ctx.anonKey;
  const token = useServiceRole ? ctx.serviceRoleKey : ctx.callerToken;
  const response = await fetch(`${ctx.supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: key, authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

// Reads one row by id. Service-role by default (most of these tables'
// own read RLS is already open to any authenticated user, so this isn't
// granting extra visibility -- it just avoids a second round trip to
// check that first). Pass useServiceRole:false for tables where the
// caller's OWN token is the actual security boundary (channel messages,
// canvas, anything gated by real membership/participancy RLS).
async function fetchOne(ctx, table, id, select, useServiceRole = true) {
  const rows = await restGet(ctx, `${table}?id=eq.${encodeURIComponent(id)}&select=${select}`, useServiceRole);
  return rows && rows[0] ? rows[0] : null;
}

async function roleEmails(ctx, roleKey) {
  try {
    const response = await fetch(`${ctx.supabaseUrl}/rest/v1/rpc/get_users_by_role`, {
      method: "POST",
      headers: { apikey: ctx.serviceRoleKey, authorization: `Bearer ${ctx.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({ target_role: roleKey }),
    });
    if (!response.ok) {
      return [];
    }
    const rows = await response.json();
    return rows.map((row) => row.email).filter(Boolean);
  } catch {
    return [];
  }
}

async function adminEmails(ctx) {
  try {
    const response = await fetch(`${ctx.supabaseUrl}/rest/v1/rpc/get_admin_emails`, {
      method: "POST",
      headers: { apikey: ctx.serviceRoleKey, authorization: `Bearer ${ctx.serviceRoleKey}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      return [];
    }
    const rows = await response.json();
    return rows.map((row) => row.email).filter(Boolean);
  } catch {
    return [];
  }
}

async function isInRole(ctx, roleKey) {
  const emails = await roleEmails(ctx, roleKey);
  const own = (ctx.user.email || "").toLowerCase();
  return emails.some((email) => email.toLowerCase() === own);
}

async function isAdmin(ctx) {
  const emails = await adminEmails(ctx);
  const own = (ctx.user.email || "").toLowerCase();
  return emails.some((email) => email.toLowerCase() === own);
}

function excludingSelf(ctx, emails) {
  const own = (ctx.user.email || "").toLowerCase();
  return [...new Set(emails.filter(Boolean))].filter((email) => email.toLowerCase() !== own);
}

// Mirrors resolveMentionEmails()/notifyMentions() in main.tsx exactly:
// @Token where Token is [A-Za-z][A-Za-z0-9_]*, resolved first against a
// role label (whitespace stripped, case-insensitive), else against a
// team member's first name (case-insensitive). Unmatched tokens are
// silently dropped -- same as the client-side behavior it replaces.
async function resolveMentions(ctx, text) {
  const tokens = [...new Set([...text.matchAll(/@([A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1].toLowerCase()))];
  if (tokens.length === 0) {
    return [];
  }
  const teamMembers = (await restGet(ctx, "team_members?select=full_name,email", true)) || [];
  const emails = new Set();
  for (const token of tokens) {
    const roleEntry = Object.entries(ROLE_LABELS).find(([, label]) => label.replace(/\s+/g, "").toLowerCase() === token);
    if (roleEntry) {
      for (const email of await roleEmails(ctx, roleEntry[0])) {
        emails.add(email);
      }
      continue;
    }
    const member = teamMembers.find((m) => (m.full_name || "").split(/\s+/)[0]?.toLowerCase() === token);
    if (member?.email) {
      emails.add(member.email);
    }
  }
  return excludingSelf(ctx, [...emails]);
}

const HANDLERS = {
  async task_assigned(ctx) {
    const task = await fetchOne(ctx, "tasks", ctx.relatedEntityId, "id,title,assignee_email,assigned_role_key,deleted_at");
    if (!task || task.deleted_at) {
      return err(404, "Task not found.");
    }
    const recipients = task.assignee_email
      ? [task.assignee_email]
      : task.assigned_role_key
        ? await roleEmails(ctx, task.assigned_role_key)
        : [];
    return {
      relatedEntityType: "task",
      title: "New task assigned",
      body: `"${task.title}" was assigned to you.`,
      recipients: excludingSelf(ctx, recipients),
    };
  },

  async task_status_changed(ctx) {
    const task = await fetchOne(ctx, "tasks", ctx.relatedEntityId, "id,title,status,assignee_email,assigned_role_key,created_by_email,deleted_at");
    if (!task || task.deleted_at) {
      return err(404, "Task not found.");
    }
    const recipients = new Set();
    for (const email of task.assignee_email ? [task.assignee_email] : task.assigned_role_key ? await roleEmails(ctx, task.assigned_role_key) : []) {
      recipients.add(email);
    }
    if (task.created_by_email) {
      recipients.add(task.created_by_email);
    }
    return {
      relatedEntityType: "task",
      title: "Task status changed",
      body: `"${task.title}" moved to ${TASK_STATUS_LABELS[task.status] || task.status}.`,
      recipients: excludingSelf(ctx, [...recipients]),
      // Server's own clock, not a client-supplied date -- lets a genuine
      // repeat transition on a later day still notify, without letting a
      // caller manufacture an arbitrary dedupe scope.
      dedupeExtra: `${task.status}:${new Date().toISOString().slice(0, 10)}`,
    };
  },

  async purchase_request_status_changed(ctx) {
    // Real gate: only purchasing/admin can actually write purchase_requests
    // (migration 023) -- re-check the same role here.
    if (!(await isInRole(ctx, "purchasing")) && !(await isAdmin(ctx))) {
      return err(403, "Only Purchasing/Admin can report a purchase request status change.");
    }
    const request = await fetchOne(ctx, "purchase_requests", ctx.relatedEntityId, "id,request_number,item_name_snapshot,status,requested_by_email");
    if (!request) {
      return err(404, "Purchase request not found.");
    }
    const recipients = new Set(await roleEmails(ctx, "purchasing"));
    if (request.requested_by_email) {
      recipients.add(request.requested_by_email);
    }
    return {
      relatedEntityType: "purchase_request",
      title: "Purchase request updated",
      body: `${request.request_number} (${request.item_name_snapshot}) is now ${request.status}.`,
      recipients: excludingSelf(ctx, [...recipients]),
      dedupeExtra: request.status,
    };
  },

  async build_stage_changed(ctx) {
    // Real gate: only warehouse/admin can write build_transactions
    // (migration 023).
    if (!(await isInRole(ctx, "warehouse")) && !(await isAdmin(ctx))) {
      return err(403, "Only Warehouse/Admin can report a build stage change.");
    }
    // build_transactions has no `stage` column (that's tracked in the
    // app's own planned-builds client state, not a persisted relational
    // field yet -- see HANDOFF for this specific limitation) -- what IS
    // verifiable here is that a real build row with this id exists, so
    // this can't be fabricated for a build that was never posted.
    const build = await fetchOne(ctx, "build_transactions", ctx.relatedEntityId, "id,build_number");
    if (!build) {
      return err(404, "Build not found.");
    }
    const stage = BUILD_STAGE_LABELS[ctx.stage] ? ctx.stage : null;
    if (!stage) {
      return err(400, "Unrecognized build stage.");
    }
    return {
      relatedEntityType: "build_transaction",
      title: "Build stage updated",
      body: `Build ${build.build_number} is now ${BUILD_STAGE_LABELS[stage]}.`,
      recipients: excludingSelf(ctx, await roleEmails(ctx, "warehouse")),
      dedupeExtra: stage,
    };
  },

  async low_stock_reached(ctx) {
    // relatedEntityId here is the item's SKU, not its uuid -- matches
    // this event's historical related_entity_id (the client only ever
    // had `part.ref`, which persistence.ts maps from `inventory_items.sku`,
    // readily on hand; the real uuid isn't part of the client-side Part
    // type at all).
    const rows = (await restGet(ctx, `inventory_items?sku=eq.${encodeURIComponent(ctx.relatedEntityId)}&select=id,sku,item_name,reorder_point,track_reorder`, true)) || [];
    const item = rows[0];
    if (!item || !item.track_reorder) {
      return err(404, "Inventory item not found, or reorder tracking isn't enabled for it.");
    }
    const balances = (await restGet(ctx, `inventory_balances?inventory_item_id=eq.${encodeURIComponent(item.id)}&select=quantity_on_hand,quantity_allocated`, true)) || [];
    const available = balances.reduce((sum, row) => sum + (Number(row.quantity_on_hand) || 0) - (Number(row.quantity_allocated) || 0), 0);
    // Re-derived server-side, not trusted from the client -- a caller
    // can't manufacture a "you're out of stock" scare for an item that
    // genuinely still has plenty on hand.
    if (available > Number(item.reorder_point)) {
      return err(409, "That item isn't actually at or below its reorder point.");
    }
    const recipients = new Set([...(await roleEmails(ctx, "purchasing")), ...(await roleEmails(ctx, "warehouse")), ...(await adminEmails(ctx))]);
    return {
      relatedEntityType: "inventory_item",
      title: "Low stock",
      body: `${item.item_name} (${item.sku}) is at ${available}, at or below its reorder point of ${item.reorder_point}.`,
      recipients: excludingSelf(ctx, [...recipients]),
      dedupeExtra: new Date().toISOString().slice(0, 10),
    };
  },

  async catalog_price_change_requested(ctx) {
    const request = await fetchOne(
      ctx,
      "catalog_price_change_requests",
      ctx.relatedEntityId,
      "id,catalog_item_id,requested_by_email,field_changed,previous_value,requested_value,reason,status",
    );
    if (!request) {
      return err(404, "Price change request not found.");
    }
    // Real gate on the underlying insert: catalog_price_change_requests'
    // own RLS only lets a caller create a row with their OWN email as
    // requested_by_email (migration 046) -- re-check that here instead
    // of trusting the client's claim that this is "their" request.
    if ((request.requested_by_email || "").toLowerCase() !== (ctx.user.email || "").toLowerCase()) {
      return err(403, "You can only report a price change request you actually submitted.");
    }
    const catalogItem = await fetchOne(ctx, "product_catalog", request.catalog_item_id, "id,product_name");
    return {
      relatedEntityType: "catalog_price_change_request",
      title: "Catalog price change requested",
      body: `${ctx.user.email} proposed changing ${request.field_changed} on "${catalogItem?.product_name || "a catalog item"}" from ${request.previous_value} to ${request.requested_value}.${request.reason ? ` Reason: ${request.reason}` : ""}`,
      recipients: excludingSelf(ctx, await roleEmails(ctx, "manager")),
    };
  },

  async catalog_price_change_reviewed(ctx) {
    // Real gate: only manager/admin can update catalog_price_change_requests
    // (migration 046) and write product_catalog (migration 033).
    if (!(await isInRole(ctx, "manager")) && !(await isAdmin(ctx))) {
      return err(403, "Only Manager/Admin can review a price change request.");
    }
    const request = await fetchOne(
      ctx,
      "catalog_price_change_requests",
      ctx.relatedEntityId,
      "id,catalog_item_id,requested_by_email,field_changed,requested_value,status",
    );
    if (!request || request.status === "pending") {
      return err(404, "Reviewed price change request not found.");
    }
    if (!request.requested_by_email) {
      return err(404, "That request has no requester to notify.");
    }
    return {
      relatedEntityType: "catalog_price_change_request",
      title: `Price change ${request.status}`,
      body: `Your request to change ${request.field_changed} to ${request.requested_value} was ${request.status} by ${ctx.user.email}.`,
      recipients: [request.requested_by_email],
      dedupeExtra: request.status,
    };
  },

  async user_signup_pending(ctx) {
    // Self-report only: a brand-new user has no elevated privilege at
    // all, so the only thing worth verifying is that they're reporting
    // their OWN real pending-approval row, not someone else's.
    if (ctx.relatedEntityId !== ctx.user.id) {
      return err(403, "You can only report your own sign-up.");
    }
    const status = await fetchOne(ctx, "app_user_status", ctx.user.id, "user_id,approval_status", true);
    if (!status || status.approval_status !== "pending") {
      return err(409, "No real pending-approval record found for this account.");
    }
    return {
      relatedEntityType: "app_user_status",
      title: "New sign-up needs approval",
      body: `${ctx.user.email || "A new user"} just signed up and is waiting for approval in Admin -> Pending Approvals.`,
      recipients: await adminEmails(ctx),
    };
  },

  async mentioned(ctx) {
    if (ctx.relatedEntityType === "task") {
      const task = await fetchOne(ctx, "tasks", ctx.relatedEntityId, "id,title,description,deleted_at");
      if (!task || task.deleted_at) {
        return err(404, "Task not found.");
      }
      const recipients = await resolveMentions(ctx, task.description || "");
      return {
        relatedEntityType: "task",
        title: `You were mentioned in the task "${task.title}"`,
        body: `${ctx.user.email}: ${(task.description || "").slice(0, 200)}`,
        recipients,
      };
    }
    if (ctx.relatedEntityType === "channel_message") {
      // Caller's OWN token -- channel_messages' real RLS (migration 105)
      // only lets a member of that channel read this row at all, so a
      // non-member can't even discover this message exists, let alone
      // trigger a mention notification from it.
      const message = await fetchOne(ctx, "channel_messages", ctx.relatedEntityId, "id,channel_id,body", false);
      if (!message) {
        return err(404, "Message not found, or you don't have access to it.");
      }
      const channel = await fetchOne(ctx, "channels", message.channel_id, "id,name");
      const recipients = await resolveMentions(ctx, message.body || "");
      return {
        relatedEntityType: "channel_message",
        title: `You were mentioned in #${channel?.name || "a channel"}`,
        body: `${ctx.user.email}: ${(message.body || "").slice(0, 200)}`,
        recipients,
      };
    }
    if (ctx.relatedEntityType === "canvas") {
      // channel_canvas read/write is genuinely open to any authenticated
      // user regardless of channel membership today (migration 104's own
      // comment: a shared team doc) -- matched here, not tightened
      // beyond what the data model already allows.
      const canvas = await fetchOne(ctx, "channel_canvas", ctx.relatedEntityId, "channel_id,content", true);
      if (!canvas) {
        return err(404, "Canvas not found.");
      }
      const channel = await fetchOne(ctx, "channels", canvas.channel_id, "id,name");
      const recipients = await resolveMentions(ctx, canvas.content || "");
      return {
        relatedEntityType: "canvas",
        title: `You were mentioned in the #${channel?.name || "channel"} canvas`,
        body: `${ctx.user.email}: ${(canvas.content || "").slice(0, 200)}`,
        recipients,
      };
    }
    return err(400, "Unsupported mention source.");
  },
};

export const SUPPORTED_EVENT_TYPES = Object.freeze(Object.keys(HANDLERS));

export async function runNotificationEvent(eventType, ctx) {
  const handler = HANDLERS[eventType];
  if (!handler) {
    return err(400, `Unsupported event type: ${eventType}`);
  }
  return handler(ctx);
}
