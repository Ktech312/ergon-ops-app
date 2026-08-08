# Overnight Work Summary — Aug 8, 2026

Built, verified, and pushed to `main` (commit `6e04c10`) while you were asleep. No migration needed for any of this — it's all app-code.

## What's fixed

**Global search actually works now.** The top-nav "Search parts, POs, projects" box was pure decoration — a `<span>`, not even an input. It's now a real search: type 2+ characters and it shows live matches grouped by Projects, Parts, and Purchase Orders.
- Click a **Project** result → jumps straight into that project's detail page.
- Click a **Part** result → switches to Inventory and filters the list down to that item.
- Click a **PO** result → switches to Reports (Purchasing tab) and filters down to that order, since that's the page that already has real PO filtering.

**Admin alerts for new sign-ups.** Previously, when someone new signed up, nothing notified anyone — an admin only found out by manually checking Admin → Pending Approvals. Now every admin gets a real notification the moment a new pending sign-up lands. This required a small migration (`049_admin_signup_notifications.sql`) — **you'll need to run this one in the Supabase SQL editor**, same as usual.

**Two other dead-wiring bugs found and fixed:**
- Purchasing → Upload Procurement Document defaulted its project dropdown to a hardcoded name, "Straud Medical," that doesn't exist in your data. A document uploaded without first touching the dropdown would've silently been tagged to a project that isn't real. Now it defaults to the first real project.
- Admin → Schedule Templates → Add Phase had a "Role" column in the table and the field was fully wired into the database and into schedule generation, but the *form to actually set it* was missing — every phase silently got no role. Added the missing dropdown.

## What I checked and found working correctly

Personal task alerts, task-overdue alerts, and the catalog price-change approval alerts are all real and correctly wired — not decorative. I also had a subagent do a structural sweep of the whole app (Dashboard, Reports, Admin, Inventory, Sales/Site Builder, Tasks/Gantt, Learning Library, Welcome flow) looking for dead buttons, fake numbers, and no-op handlers. Nothing else turned up — the app is unusually well-instrumented for its size.

## Questions for you — one real gap I did *not* guess at

Your alerts system has **9 configurable event types** in Admin → Notification Rules. Only 4 of them actually fire anything: task assigned, task overdue, and the two catalog price-change events (which I built earlier this week). The other **5 are toggleable in the UI, and one of them ("Submittal responded") is even switched on by default — but none of them are wired to anything. Toggling them does nothing:

1. **Task status changed**
2. **Purchase request status changed**
3. **Build stage changed**
4. **Submittal responded** — e.g., a client approves/rejects a submittal and nobody gets told
5. **Low stock reached**

I didn't wire these up because each one needs a real answer to "who should get this alert?" — and the app doesn't currently store that. For example, a submittal isn't linked to a specific PM/owner today, so "notify the right person when a client responds" requires deciding who that is and possibly adding a column to track it. Guessing wrong here means either spamming people or an admin thinking they're covered when they're not.

For each one, quick answers would let me wire it up properly:

- **Submittal responded** — who should be notified? The person who created the submittal (we'd need to start recording that), everyone with the Projects tab, or a specific role (e.g. PM)?
- **Purchase request status changed** — same question: whoever created the request (not currently tracked), or a role like Purchasing/Manager?
- **Build stage changed** — the person who planned the build, or a role?
- **Low stock reached** — which role(s) should get this — Purchasing, Warehouse, Admin, some combination?
- **Task status changed** — this one's easier since tasks already have an assignee/creator on them. Should the *creator* get notified when their task's status changes, or is this meant for something else (e.g. a manager watching all tasks)?

Also flagging, not fixing: the Sales Quote Builder's "Original Form" box on the quote detail page still says "Placeholder... we'll wire this up next" — it's an old stub with nothing behind it. What should it actually show or link to? (The site-builder intake answers themselves? A specific uploaded document?)

Let me know on any of these whenever you're back — happy to keep going.
