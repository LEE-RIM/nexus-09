# NEXUS-09

NEXUS-09 is a private member-community website with a CSS-rendered, 3D-style lab, member ID cards, one-time invitations, private rooms with separate access codes, and room-specific group chats.

The app has two modes:

- **Demo:** fictional members and browser-only sample chat. It is selected by default until Supabase is configured.
- **Live:** Supabase Auth, database-backed invitations and profiles, server-verified room access, and Realtime chat.

## Run the demo

Open `index.html` in a modern browser, or run a local static server from this folder:

```powershell
python -m http.server 8767 --bind 127.0.0.1
```

Visit `http://127.0.0.1:8767/?demo=1`. Demo codes are `LAB-0427` and `ROOM-091`. Demo members and messages are fictional and local to the browser.

## Set up the live backend

You need a Supabase project and the Supabase CLI. Keep the service-role key and the owner bootstrap code private; neither belongs in `config.js`.

1. Create a Supabase project and open its **SQL Editor**.
2. Run the complete [`supabase/schema.sql`](./supabase/schema.sql). It creates the tables, security-definer access helpers, Row Level Security policies for data and private Realtime channels, and Realtime publication entries.
3. In **Authentication → Sign In / Providers**, enable the Email/password provider. Disable public sign-ups if the project setting allows it; the app creates users through its server-side Admin API functions, not public Auth sign-up.
4. Install/sign in to the Supabase CLI, then link this folder to the project:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   ```

5. Generate a random owner bootstrap code of at least 24 characters and add it as the `NEXUS_BOOTSTRAP_CODE` Edge Function secret in the Supabase dashboard's project secrets settings. Use a password manager to store it; do not put it in a browser file or paste it into a command that may be saved in shell history.

6. Deploy the Edge Functions:

   ```powershell
   supabase functions deploy bootstrap-owner
   supabase functions deploy join-with-invite
   supabase functions deploy create-invite
   supabase functions deploy unlock-room
   supabase functions deploy manage-rooms
   supabase functions deploy manage-ownership
   ```

   Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed Edge Functions. Do not copy the service-role key into the website.

7. In the Supabase dashboard, open **Project Settings → API**. Put the project URL and the public `anon` key in `config.js`:

   ```js
   window.NEXUS_CONFIG = {
     supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
     supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY"
   };
   ```

   The anon key is intended for browser use. Database safety depends on the supplied RLS policies remaining enabled. Do not add a service-role key here.

8. Host the static files over HTTPS. Open the site and select **FIRST SETUP**. Enter the bootstrap code, create the first owner member ID and secret code, and choose a room code. The bootstrap code is one-use because the database refuses a second owner initialization. After setup, remove `NEXUS_BOOTSTRAP_CODE` from Edge Function secrets; this disables further owner-setup attempts.
9. Sign in as the owner. Generate a one-time invite and share it privately. The invited person opens the link, chooses their own member ID and secret code, and signs in. Any current member can create an invite. Invites expire after 72 hours and can only be redeemed once.
10. Share the room code privately with members. Entering it grants that signed-in member server-checked room access for 30 minutes; chat history and sending are denied by database policies when the session expires.

## Community feature upgrade

To add owner announcements, member-selected emoji reactions, private direct messages, message reports, temporary mutes, and the Main Owner/Sub-owner roles to an existing deployment:

1. Run [`supabase/migrations/20261014_community_features.sql`](./supabase/migrations/20261014_community_features.sql) in the project's Supabase SQL Editor.
2. Run [`supabase/migrations/20261014_ownership_roles.sql`](./supabase/migrations/20261014_ownership_roles.sql) after the community migration. It preserves existing members and messages, adds the Sub-owner role, and installs server-side ownership controls.
3. Deploy the new `manage-ownership` Edge Function: `supabase functions deploy manage-ownership`.
4. Run [`supabase/migrations/20261014_ownership_roles_multi_room_chat.sql`](./supabase/migrations/20261014_ownership_roles_multi_room_chat.sql) after the community and ownership migrations. It preserves the existing inner-circle room and its messages, then enables separate room-code sessions and room-scoped chat access.
5. Deploy the updated `unlock-room` and new `manage-rooms` Edge Functions:

   ```powershell
   supabase functions deploy unlock-room
   supabase functions deploy manage-rooms
   ```

6. Run [`supabase/migrations/20261015_owner_power_room.sql`](./supabase/migrations/20261015_owner_power_room.sql) in the SQL Editor. This creates a separate owner-team chat whose history does not expire with ordinary room access; RLS and private Realtime policies restrict it to the Main Owner and Sub-owner.
7. Run [`supabase/migrations/20261015_power_room_unread.sql`](./supabase/migrations/20261015_power_room_unread.sql) to enable per-account unread tracking for the Power Room.
8. Upload the updated website files to the repository root: `index.html`, `styles.css`, `app.js`, `config.js`, `real-app.js`, `demo.js`, and `community-features.js`.
9. Wait for GitHub Pages to finish deploying, then sign in again or refresh the live website.
10. The Main Owner can appoint one Sub-owner. Both can post, pin, and delete announcements; review reports; delete reported messages; and mute members for 1 hour, 24 hours, or 7 days. Members can start DMs from a member ID card without room unlock. Only the owner team sees the Power Room entry; its separate chat has no 30-minute room-access expiry, keeps its history until an administrator removes it, and initially displays the latest 100 messages. Role-based database and private Realtime policies enforce access. The Power Room unread badge is per-account, counts messages from the other owner-team member, and clears when opened.
11. The Main Owner/Sub-owner can create rooms with unique private access codes and archive non-default rooms. Room names are visible to members, but chat history and sending require that room's code. Five incorrect attempts for one room lock access to that room for 15 minutes; successful access lasts 30 minutes. Archiving retains messages but immediately revokes active room sessions.
12. In Ownership settings, the Main Owner must set a separate, unique transfer secret (minimum 16 characters; a random password-manager secret is recommended). Only its SHA-256 hash is stored. Replacing it requires the current secret; five failed secret checks lock transfers for 15 minutes. Keep the secret separate from the owner login. If it is lost, a trusted backend administrator can reset the hash with `update public.ownership_transfer_secrets set secret_hash = null, updated_at = now() where singleton = true; delete from public.ownership_transfer_attempts;`, then the Main Owner can set a new secret. A successful transfer makes the selected member Main Owner and the former Main Owner Sub-owner; a previous Sub-owner is demoted to member if another person receives ownership.
13. Keep all supplied RLS policies enabled. Ownership, room access, and role changes are performed by server-side Edge Functions, never by directly updating protected records from the browser.

## Verify before inviting people

Use two separate browsers/devices and confirm all of the following:

- Owner setup works once, and cannot initialize another owner.
- A valid invite creates a member; an invalid, expired, or already-used invite does not.
- The 30-member limit holds, including when two people try to use the last place at once.
- A signed-in member can invite another member, and only a member can create invites.
- The correct room code unlocks only its matching room; an incorrect code does not.
- Messages, reactions, and private Realtime updates never cross room boundaries.
- Messages and new roster entries appear in the other member's session.
- Five incorrect room-code attempts lock that member out for 15 minutes; chat reads and writes fail after the 30-minute room session expires.
- No service-role key or owner bootstrap secret appears in browser files, browser network responses, or the deployed website.

The NEXUS-09 Supabase project is connected, all four Edge Functions are deployed, Email/password authentication is enabled, direct public sign-ups are disabled, and the owner account is initialized. The one-time `NEXUS_BOOTSTRAP_CODE` secret was removed after owner setup. Apply the community-feature migration before uploading its matching website files. Verify invitations, room-code lockout and expiry, DMs, reactions, moderation, and multi-device Realtime before treating the site as production-ready.

## Account recovery and safety

There is no email-based password recovery or in-app reset feature. If a member loses their secret code, an administrator must reset the password using a trusted backend with Supabase's Auth Admin API; never put the service-role key in the browser. Deleting a profile also deletes that member's messages due to the database foreign key.

Member IDs are backed by synthetic addresses ending in the reserved `.invalid` domain so Supabase Auth can authenticate without collecting email. Verify that account creation and password sign-in work with the selected Supabase Auth version before inviting members. These aliases cannot receive email.

The lab art is CSS, not a downloadable 3D model. Do not reuse demo codes or demo member data for real access.
