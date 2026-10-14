import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { addReactionControls, addReportButton, initCommunityFeatures } from "./community-features.js";

const settings = window.NEXUS_CONFIG;
const supabase = createClient(settings.supabaseUrl, settings.supabaseAnonKey, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});

const authScreen = document.querySelector("#authScreen");
const appShell = document.querySelector(".app-shell");
const authError = document.querySelector("#authError");
const chatThread = document.querySelector("#chatThread");
let currentProfile = null;
let roomUnlockedUntil = 0;
let roomExpiryTimer;
let presenceChannel;
let messagesChannel;
let inviteCreated = false;
let pendingDestination = null;
let toastTimer;
let memberInitializing = false;
let profilesCache = [];
let communityFeatures;

document.body.classList.add("real-mode");
const demoBanner = document.querySelector(".demo-banner");
demoBanner.querySelector("span").textContent = "PRIVATE MEMBER AREA";
demoBanner.lastChild.textContent = " Sign in with your member ID. Only invited members can enter the facility.";
const topbarStatus = document.querySelector(".topbar-status");
const statusLight = document.createElement("span");
statusLight.className = "status-light";
topbarStatus.replaceChildren(statusLight, document.createTextNode(" PRIVATE MEMBER NETWORK"));
authScreen.hidden = false;
appShell.hidden = true;
document.querySelector("#profileButton").hidden = true;
document.querySelector("#authSetupNote").hidden = true;
document.querySelector("#authSetupNote").textContent = "";
document.querySelector("#accessDialog .dialog-copy").textContent =
  "Enter the secret room code given to you by the facility owner. Chat access expires after 30 minutes.";
document.querySelector("#accessDialog .demo-code-hint").textContent = "THE ROOM CODE IS PRIVATE — ASK YOUR FACILITY OWNER.";
document.querySelector("#accessDialog .dialog-form label").textContent = "SECRET ROOM CODE";
document.querySelector("#accessDialog .primary-button").textContent = "UNLOCK ROOM →";
document.querySelector("#chatDialog .channel-live").textContent = "LIVE";
document.querySelector("#chatDialog .chat-aside > span:nth-child(3)").textContent =
  "Messages are shared live with authenticated NEXUS-09 members who have unlocked the room.";
document.querySelector("#chatDialog .chat-demo-note").textContent =
  "MEMBER MESSAGES SYNC LIVE WHILE ROOM ACCESS IS ACTIVE.";
const chatStatus = document.querySelector("#chatDialog .chat-aside-status");
const chatStatusLight = document.createElement("i");
chatStatus.replaceChildren(chatStatusLight, document.createTextNode(" PRIVATE ROOM"));
document.querySelector("#innerDialog .dialog-copy").textContent =
  "Your room access is verified by the NEXUS-09 server and remains active for 30 minutes. The roster and group chat are shared with other members.";
document.querySelector(".heading-row h1 em").textContent = "Member.";
document.querySelector(".intro-copy").textContent =
  "Your NEXUS-09 member access is active. Enter the room code to unlock the private channel.";
document.querySelector(".scene-lock-panel small").textContent = "ROOM CODE REQUIRED FOR INNER ROOM";
document.querySelector(".scene-footer > span:first-child").textContent = "MEMBER ACCESS: VERIFIED";
document.querySelector(".scene-footer > span:nth-child(2)").textContent = "ENTER THE ROOM CODE TO CONTINUE";
document.querySelector(".briefing-copy").textContent =
  "A private channel for NEXUS-09 members. Share ideas and keep the good secrets among friends.";
const briefingStats = document.querySelectorAll(".briefing-stats > div");
briefingStats[1].querySelector("strong").textContent = "01";
briefingStats[1].querySelector("span").textContent = "PRIVATE ROOM";
briefingStats[2].querySelector("strong").textContent = "30";
briefingStats[2].querySelector("span").textContent = "MIN ACCESS";
document.querySelector(".roster-foot > span").lastChild.textContent = " MEMBERS";
document.querySelector("#inviteDialog .dialog-copy").textContent =
  "Each invite works once and expires after 72 hours. The recipient chooses their own member ID and secret code.";
document.querySelector("#inviteDialog .generated-invite > span").textContent =
  "ONE-TIME INVITE · EXPIRES IN 72 HOURS";
document.querySelector("#inviteDialog #generateInviteButton").textContent = "CREATE ONE-TIME INVITE →";
document.querySelector("#rosterDialog .dialog-copy").textContent =
  "NEXUS-09 member IDs are unique. Select a card to view that member's profile.";
document.querySelector("#rosterDialog .roster-limit").textContent = "0 / 30";
document.querySelector("#chatDialog .chat-aside > span:nth-child(2)").textContent = "Loading member count…";

const inviteFromUrl = new URLSearchParams(location.search).get("invite");
if (inviteFromUrl) {
  setAuthTab("join");
  document.querySelector("#joinInvite").value = inviteFromUrl.trim().toUpperCase();
}

function setAuthTab(tab) {
  const tabs = {
    login: [document.querySelector("#loginTab"), document.querySelector("#loginForm")],
    join: [document.querySelector("#joinTab"), document.querySelector("#joinForm")],
    owner: [document.querySelector("#ownerTab"), document.querySelector("#ownerForm")]
  };
  for (const [name, [button, form]] of Object.entries(tabs)) {
    const active = name === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    form.hidden = !active;
  }
  authError.textContent = "";
}

document.querySelector("#loginTab").addEventListener("click", () => setAuthTab("login"));
document.querySelector("#joinTab").addEventListener("click", () => setAuthTab("join"));
document.querySelector("#ownerTab").addEventListener("click", () => setAuthTab("owner"));

function showAuthError(message) {
  authError.textContent = message;
}

function friendlyError(error, fallback) {
  return error?.message || fallback;
}

async function edgeFunctionError(error, data, fallback) {
  if (typeof data?.error === "string") return data.error;
  if (error?.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.error === "string") return body.error;
    } catch (parseError) {
      console.error("Could not read an Edge Function error response.", parseError);
    }
  }
  return friendlyError(error, fallback);
}

function setFormBusy(form, busy, buttonLabel) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = "PLEASE WAIT…";
  } else {
    button.textContent = buttonLabel || button.dataset.originalLabel || "CONTINUE";
  }
}

async function signIn(handle, secretCode) {
  const normalizedHandle = handle.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(normalizedHandle)) throw new Error("Member IDs use 3–20 letters, numbers, or underscores.");
  if (secretCode.length < 12) throw new Error("Your secret code must contain at least 12 characters.");
  const { error } = await supabase.auth.signInWithPassword({
    email: `${normalizedHandle}@members.nexus09.invalid`,
    password: secretCode
  });
  if (error) throw new Error("Member ID or secret code was not accepted.");
}

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  showAuthError("");
  setFormBusy(form, true);
  try {
    await signIn(document.querySelector("#loginHandle").value, document.querySelector("#loginSecret").value);
  } catch (error) {
    showAuthError(friendlyError(error, "Sign-in failed. Check your member ID and secret code."));
  } finally {
    setFormBusy(form, false, "SIGN IN →");
  }
});

document.querySelector("#joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  showAuthError("");
  setFormBusy(form, true);
  const handle = document.querySelector("#joinHandle").value.trim().toLowerCase();
  const secretCode = document.querySelector("#joinSecret").value;
  try {
    const { data, error } = await supabase.functions.invoke("join-with-invite", {
      body: {
        inviteCode: document.querySelector("#joinInvite").value.trim().toUpperCase(),
        displayName: document.querySelector("#joinName").value.trim(),
        handle,
        secretCode
      }
    });
    if (error) throw new Error(await edgeFunctionError(error, data, "Could not use this invite."));
    if (data?.error) throw new Error(data.error);
    await signIn(handle, secretCode);
  } catch (error) {
    showAuthError(friendlyError(error, "Could not join. Check the invite and your details."));
  } finally {
    setFormBusy(form, false, "CREATE MEMBER ID →");
  }
});

document.querySelector("#ownerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  showAuthError("");
  setFormBusy(form, true);
  const handle = document.querySelector("#ownerHandle").value.trim().toLowerCase();
  const secretCode = document.querySelector("#ownerSecret").value;
  try {
    const { data, error } = await supabase.functions.invoke("bootstrap-owner", {
      body: {
        bootstrapCode: document.querySelector("#bootstrapCode").value,
        roomCode: document.querySelector("#ownerRoomCode").value,
        displayName: document.querySelector("#ownerName").value.trim(),
        handle,
        secretCode
      }
    });
    if (error) throw new Error(await edgeFunctionError(error, data, "Owner setup failed."));
    if (data?.error) throw new Error(data.error);
    setAuthTab("login");
    document.querySelector("#loginHandle").value = handle;
    document.querySelector("#loginSecret").value = secretCode;
    await signIn(handle, secretCode);
  } catch (error) {
    showAuthError(friendlyError(error, "Owner setup failed. Check the one-time setup code."));
  } finally {
    setFormBusy(form, false, "INITIALIZE NEXUS-09 →");
  }
});

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3500);
}

async function initializeMember(user) {
  if (currentProfile || memberInitializing) return;
  memberInitializing = true;
  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id,handle,display_name,role,created_at")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile) throw new Error("This account is not on the NEXUS-09 roster. Ask a member for a valid invite.");
    currentProfile = profile;
    authScreen.hidden = true;
    appShell.hidden = false;
    document.querySelector("#profileButton").hidden = false;
    document.querySelector(".heading-row h1 em").textContent = profile.display_name + ".";
    document.querySelector("#profileButton strong").textContent = profile.display_name.toUpperCase();
    document.querySelector("#profileButton small").textContent = `ID ${profile.handle.toUpperCase()} · ${profile.role.toUpperCase()}`;
    document.querySelector("#profileButton .avatar").textContent = profile.display_name.trim().charAt(0).toUpperCase();
    document.querySelector("#profileButton").setAttribute("aria-label", "Account options for " + profile.display_name);
    const topbar = document.querySelector(".topbar");
    if (!document.querySelector("#signOutButton")) {
      const signOut = document.createElement("button");
      signOut.className = "sign-out";
      signOut.id = "signOutButton";
      signOut.type = "button";
      signOut.textContent = "SIGN OUT";
      signOut.addEventListener("click", signOutMember);
      topbar.append(signOut);
    }
    document.querySelector("#onlineCount").textContent = "01";
    document.querySelector("#labAccessCode").value = "";
    await loadRoster();
    if (!communityFeatures) {
      communityFeatures = initCommunityFeatures({
        supabase,
        getCurrentProfile: () => currentProfile,
        getMembers: () => profilesCache,
        showToast,
        openDialog
      });
    }
    await communityFeatures.initialize(profile);
    subscribePresence();
  } finally {
    memberInitializing = false;
  }
}

async function loadRoster() {
  const { data, error, count } = await supabase
    .from("profiles")
    .select("id,handle,display_name,role,created_at", { count: "exact" })
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) {
    console.error("Could not load the NEXUS-09 roster.", error);
    showToast("Member roster could not be loaded. Check your connection and try again.");
    return;
  }
  const roster = data || [];
  profilesCache = roster;
  const total = count ?? roster.length;
  document.querySelector("#memberCount").textContent = String(total).padStart(2, "0");
  document.querySelector("#rosterCount").textContent = String(total);
  document.querySelector("#membersNav i").textContent = String(total);
  document.querySelector(".roster-limit").textContent = `${total} / 30`;
  document.querySelector(".roster-foot > span").textContent = `${total} MEMBER${total === 1 ? "" : "S"}`;
  document.querySelector("#chatDialog .chat-aside > span:nth-child(2)").textContent = `${total} members`;
  document.querySelector("#chatDialog .chat-aside > span:nth-child(3)").textContent =
    "Messages are shared live with authenticated NEXUS-09 members who have unlocked the room.";
  renderRoster(roster);
  if (communityFeatures) {
    await communityFeatures.loadConversations();
    if (currentProfile?.role === "owner") await communityFeatures.loadReports();
  }
}

function toMember(profile) {
  const colors = ["cyan", "violet", "amber", "rose", "blue", "green"];
  return {
    id: profile.handle,
    userId: profile.id,
    name: profile.display_name,
    role: profile.role === "owner" ? "Facility owner" : "NEXUS-09 member",
    tier: profile.role === "owner" ? "OWNER" : "MEMBER",
    bio: `NEXUS-09 member since ${new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(profile.created_at))}.`,
    initials: profile.display_name.trim().charAt(0).toUpperCase(),
    color: colors[Array.from(profile.handle).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length],
    online: profile.id === currentProfile?.id
  };
}

function renderRoster(profiles) {
  const members = profiles.map(toMember);
  const strip = document.querySelector("#memberStrip");
  strip.replaceChildren(...members.slice(0, 8).map((member) => {
    const button = document.createElement("button");
    button.className = "member-mini";
    button.type = "button";
    button.setAttribute("aria-label", `View ID card for ${member.name}`);
    const avatar = document.createElement("span");
    avatar.className = `avatar avatar-${member.color}`;
    avatar.textContent = member.initials;
    const name = document.createElement("span");
    name.textContent = member.name;
    button.append(avatar, name);
    button.addEventListener("click", () => showMember(member));
    return button;
  }));
  const grid = document.querySelector("#rosterGrid");
  grid.replaceChildren(...members.map((member) => {
    const button = document.createElement("button");
    button.className = "roster-card";
    button.type = "button";
    const avatar = document.createElement("span");
    avatar.className = `avatar avatar-${member.color}`;
    avatar.textContent = member.initials;
    const details = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = member.name;
    const id = document.createElement("small");
    id.textContent = `ID ${member.id}`;
    const status = document.createElement("small");
    status.className = "online-tag";
    status.textContent = member.role === "Facility owner" ? "FACILITY OWNER" : "CLEARED MEMBER";
    details.append(name, id, status);
    button.append(avatar, details);
    button.addEventListener("click", () => showMember(member));
    return button;
  }));
  document.querySelector("#allMembersButton").disabled = members.length === 0;
}

function showMember(member) {
  document.querySelector("#largeIdCard").replaceChildren();
  const avatar = document.createElement("span");
  avatar.className = `large-id-avatar avatar-${member.color}`;
  avatar.textContent = member.initials;
  const copy = document.createElement("span");
  copy.className = "large-id-copy";
  const name = document.createElement("strong");
  name.textContent = member.name.toUpperCase();
  const role = document.createElement("span");
  role.textContent = member.role.toUpperCase();
  const id = document.createElement("small");
  id.textContent = `NEXUS-09 · ID ${member.id.toUpperCase()}`;
  copy.append(name, role, id);
  document.querySelector("#largeIdCard").append(avatar, copy);
  document.querySelector("#memberName").textContent = member.name;
  document.querySelector("#memberBio").textContent = member.bio;
  document.querySelector("#memberTier").textContent = member.tier;
  const messageButton = document.querySelector("#memberDmButton");
  messageButton.dataset.memberId = member.userId || "";
  messageButton.hidden = !member.userId || member.userId === currentProfile?.id;
  openDialog(document.querySelector("#memberDialog"));
}

function subscribePresence() {
  if (presenceChannel || !currentProfile) return;
  presenceChannel = supabase.channel("nexus09-presence", {
    config: { private: true, presence: { key: currentProfile.id } }
  });
  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const online = Object.keys(presenceChannel.presenceState()).length;
      document.querySelector("#onlineCount").textContent = String(online).padStart(2, "0");
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, () => {
      loadRoster().catch((error) => {
        console.error("Could not refresh the NEXUS-09 member roster.", error);
        showToast("A new member joined, but the roster could not refresh.");
      });
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        const { error } = await presenceChannel.track({ handle: currentProfile.handle });
        if (error) {
          console.error("Could not publish online presence.", error);
          showToast("Live online status is unavailable right now.");
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("NEXUS-09 presence channel failed.", status);
        showToast("Live online status disconnected. Check your connection.");
      }
    });
}

async function removeRealtimeChannels() {
  const channels = [presenceChannel, messagesChannel].filter(Boolean);
  presenceChannel = null;
  messagesChannel = null;
  for (const channel of channels) {
    const status = await supabase.removeChannel(channel);
    if (status !== "ok") console.error("Could not close a NEXUS-09 realtime channel.", status);
  }
}

function openDialog(dialog) {
  for (const item of document.querySelectorAll(".app-dialog")) {
    if (item.open && item !== dialog) item.close();
  }
  if (!dialog.open) dialog.showModal();
}

function requestDestination(destination) {
  if (roomUnlockedUntil > Date.now()) {
    showDestination(destination);
    return;
  }
  pendingDestination = destination;
  document.querySelector("#accessCode").value = "";
  document.querySelector("#accessError").textContent = "";
  openDialog(document.querySelector("#accessDialog"));
  window.setTimeout(() => document.querySelector("#accessCode").focus(), 30);
}

function showDestination(destination) {
  if (destination === "inner") openDialog(document.querySelector("#innerDialog"));
  if (destination === "chat") openChat();
  if (destination === "invite") openInvite();
}

async function unlockRoom(roomCode) {
  const { data, error } = await supabase.functions.invoke("unlock-room", { body: { roomCode } });
  if (error) throw new Error(await edgeFunctionError(error, data, "Room code could not be checked."));
  if (data?.error) throw new Error(data.error);
  if (!data?.unlocked || !data.expiresAt) throw new Error("Room access was not confirmed by the server.");
  const expiresAt = Date.parse(data.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("The server returned an invalid room-access expiry. Try again.");
  }
  roomUnlockedUntil = expiresAt;
  window.clearTimeout(roomExpiryTimer);
  roomExpiryTimer = window.setTimeout(() => {
    roomUnlockedUntil = 0;
    const channel = messagesChannel;
    messagesChannel = null;
    if (channel) {
      void supabase.removeChannel(channel).then((status) => {
        if (status !== "ok") console.error("Could not close the NEXUS-09 chat channel.", status);
      });
    }
    if (document.querySelector("#chatDialog").open || document.querySelector("#innerDialog").open) {
      document.querySelector("#chatDialog").close();
      document.querySelector("#innerDialog").close();
    }
    showToast("Secret-room access expired. Enter the room code again to continue.");
  }, Math.max(0, roomUnlockedUntil - Date.now()));
  subscribeToMessages();
}

document.querySelector("#enterRoomButton").addEventListener("click", () => requestDestination("inner"));
document.querySelector("#openChatLink").addEventListener("click", () => requestDestination("chat"));
document.querySelector("#chatNav").addEventListener("click", () => requestDestination("chat"));
document.querySelector("#membersNav").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));
document.querySelector("#viewMembersButton").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));
document.querySelector("#allMembersButton").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));
document.querySelector("#profileButton").addEventListener("click", () => currentProfile && showMember(toMember(currentProfile)));

document.querySelector("#accessForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const errorBox = document.querySelector("#accessError");
  errorBox.textContent = "";
  button.disabled = true;
  button.textContent = "VERIFYING WITH SERVER…";
  try {
    await unlockRoom(document.querySelector("#accessCode").value);
    document.querySelector("#accessDialog").close();
    const destination = pendingDestination || "inner";
    pendingDestination = null;
    showDestination(destination);
  } catch (error) {
    errorBox.textContent = friendlyError(error, "The room code was not accepted.");
  } finally {
    button.disabled = false;
    button.textContent = "UNLOCK ROOM →";
  }
});

function messageElement(message, reactions = []) {
  const profile = message.profiles || {};
  const own = message.sender_id === currentProfile?.id;
  const color = own ? "cyan" : ["violet", "amber", "rose", "blue", "green"][Array.from(profile.handle || "").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5];
  const item = document.createElement("article");
  item.className = `chat-message${own ? " is-you" : ""}`;
  const avatar = document.createElement("span");
  avatar.className = `avatar avatar-${color}`;
  avatar.textContent = (profile.display_name || "M").trim().charAt(0).toUpperCase();
  const copy = document.createElement("div");
  copy.className = "chat-message-copy";
  const heading = document.createElement("div");
  heading.className = "chat-message-heading";
  const name = document.createElement("strong");
  name.textContent = profile.display_name || "NEXUS member";
  const time = document.createElement("time");
  const date = new Date(message.created_at);
  time.dateTime = date.toISOString();
  time.textContent = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(date);
  const body = document.createElement("p");
  body.textContent = message.body;
  heading.append(name, time);
  copy.append(heading, body);
  addReactionControls(copy, {
    supabase,
    messageId: message.id,
    kind: "group",
    reactions,
    userId: currentProfile.id,
    refresh: loadMessages,
    showToast
  });
  if (!own && communityFeatures) {
    addReportButton(heading, {
      kind: "group",
      messageId: message.id,
      body: message.body,
      openReport: communityFeatures.openReport
    });
  }
  item.append(avatar, copy);
  return item;
}

function renderMessages(messages) {
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "real-chat-empty";
    empty.textContent = "No messages yet. Start the conversation.";
    chatThread.replaceChildren(empty);
    return;
  }
  chatThread.replaceChildren(...messages);
  chatThread.scrollTop = chatThread.scrollHeight;
}

async function loadMessages() {
  if (roomUnlockedUntil <= Date.now()) throw new Error("Room access expired. Enter the code again.");
  const { data, error } = await supabase
    .from("messages")
    .select("id,body,created_at,sender_id,profiles!messages_sender_id_fkey(display_name,handle)")
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw error;
  const messages = (data || []).reverse();
  const ids = messages.map((message) => message.id);
  let reactions = [];
  if (ids.length) {
    const result = await supabase
      .from("message_reactions")
      .select("id,user_id,group_message_id,emoji")
      .in("group_message_id", ids);
    if (result.error) throw result.error;
    reactions = result.data || [];
  }
  renderMessages(messages.map((message) => messageElement(
    message,
    reactions.filter((reaction) => reaction.group_message_id === message.id)
  )));
}

function subscribeToMessages() {
  if (messagesChannel || roomUnlockedUntil <= Date.now()) return;
  messagesChannel = supabase
    .channel("nexus09-room-messages", { config: { private: true } })
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, async () => {
      try {
        await loadMessages();
      } catch (error) {
        console.error("Could not refresh NEXUS-09 messages.", error);
        showToast("A new message arrived but the channel could not refresh.");
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, async () => {
      try {
        await loadMessages();
      } catch (error) {
        console.error("Could not refresh NEXUS-09 message reactions.", error);
        showToast("Message reactions could not be refreshed.");
      }
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("NEXUS-09 message channel failed.", status);
        showToast("Live chat disconnected. Check your connection.");
      }
    });
}

async function openChat() {
  try {
    await loadMessages();
    openDialog(document.querySelector("#chatDialog"));
    window.setTimeout(() => document.querySelector("#chatInput").focus(), 30);
  } catch (error) {
    console.error("Could not load NEXUS-09 messages.", error);
    showToast(friendlyError(error, "The group channel could not be loaded."));
  }
}

document.querySelector("#innerChatButton").addEventListener("click", openChat);
document.querySelector("#innerRosterButton").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));

document.querySelector("#chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#chatInput");
  const text = input.value.trim();
  if (!text || !currentProfile) return;
  const send = event.currentTarget.querySelector("button");
  send.disabled = true;
  try {
    const { error } = await supabase.from("messages").insert({ sender_id: currentProfile.id, body: text });
    if (error) throw error;
    input.value = "";
    await loadMessages();
  } catch (error) {
    console.error("Could not send NEXUS-09 message.", error);
    showToast(friendlyError(error, "Message could not be sent. Check that room access is still active."));
  } finally {
    send.disabled = false;
  }
});

async function openInvite() {
  inviteCreated = false;
  document.querySelector("#generatedInvite").hidden = true;
  document.querySelector("#inviteError").textContent = "";
  const { count, error } = await supabase.from("profiles").select("id", { count: "exact", head: true });
  if (error) {
    console.error("Could not check member capacity before inviting.", error);
    document.querySelector("#inviteError").textContent = "Member capacity could not be checked.";
    return;
  }
  document.querySelector("#availableSeats").textContent = String(Math.max(0, 30 - (count ?? 0))).padStart(2, "0");
  openDialog(document.querySelector("#inviteDialog"));
}

document.querySelector("#inviteButton").addEventListener("click", () => openInvite());
document.querySelector("#inviteRail").addEventListener("click", () => openInvite());
document.querySelector("#rosterInviteButton").addEventListener("click", () => openInvite());

document.querySelector("#generateInviteButton").addEventListener("click", async () => {
  if (inviteCreated) return;
  const button = document.querySelector("#generateInviteButton");
  const errorBox = document.querySelector("#inviteError");
  button.disabled = true;
  errorBox.textContent = "";
  try {
    const { data, error } = await supabase.functions.invoke("create-invite", { body: {} });
    if (error) throw new Error(await edgeFunctionError(error, data, "Invite could not be created."));
    if (data?.error || typeof data?.inviteCode !== "string") throw new Error(data?.error || "Server did not return an invite code.");
    document.querySelector("#inviteCode").textContent = data.inviteCode;
    document.querySelector("#generatedInvite").hidden = false;
    const joinUrl = new URL(location.href);
    joinUrl.searchParams.set("invite", data.inviteCode);
    document.querySelector("#inviteDialog .generated-invite").dataset.inviteUrl = joinUrl.toString();
    const remaining = Number.parseInt(document.querySelector("#availableSeats").textContent, 10) || 0;
    document.querySelector("#availableSeats").textContent = String(Math.max(0, remaining - 1)).padStart(2, "0");
    inviteCreated = true;
  } catch (error) {
    console.error("Could not create NEXUS-09 invite.", error);
    errorBox.textContent = friendlyError(error, "Invite could not be created.");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#copyInviteButton").addEventListener("click", async () => {
  const code = document.querySelector("#inviteCode").textContent;
  const url = document.querySelector("#inviteDialog .generated-invite").dataset.inviteUrl || code;
  try {
    await navigator.clipboard.writeText(url);
    showToast("One-time member invite copied. It expires in 72 hours.");
  } catch (error) {
    console.error("Could not copy NEXUS-09 invite.", error);
    showToast("Copy was blocked. Select and copy the invite code manually.");
  }
});

for (const dialog of document.querySelectorAll(".app-dialog")) {
  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function signOutMember() {
  roomUnlockedUntil = 0;
  window.clearTimeout(roomExpiryTimer);
  await removeRealtimeChannels();
  await communityFeatures?.dispose();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Could not sign out of NEXUS-09.", error);
    showToast("Sign-out failed. Try again.");
    return;
  }
  currentProfile = null;
  appShell.hidden = true;
  authScreen.hidden = false;
  setAuthTab("login");
  document.querySelector("#loginSecret").value = "";
}

document.querySelector("#signOutButton")?.addEventListener("click", signOutMember);
async function start() {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session?.user && !currentProfile) {
      window.setTimeout(() => initializeMember(session.user).catch((profileError) => {
        console.error("Could not load signed-in NEXUS-09 member.", profileError);
        showAuthError(friendlyError(profileError, "This account could not be loaded."));
      }), 0);
    }
    if (event === "SIGNED_OUT" && currentProfile) {
      currentProfile = null;
      roomUnlockedUntil = 0;
      window.clearTimeout(roomExpiryTimer);
      void removeRealtimeChannels();
      void communityFeatures?.dispose();
      appShell.hidden = true;
      authScreen.hidden = false;
      document.querySelector("#profileButton").hidden = true;
    }
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error("Could not restore NEXUS-09 session.", error);
    showAuthError("Your session could not be restored. Sign in again.");
  } else if (data.session) {
    try {
      await initializeMember(data.session.user);
    } catch (profileError) {
      console.error("Could not initialize NEXUS-09 member session.", profileError);
      showAuthError(friendlyError(profileError, "This account could not be loaded."));
      await supabase.auth.signOut();
    }
  }
}

start().catch((error) => {
  console.error("Could not start NEXUS-09.", error);
  showAuthError("NEXUS-09 could not connect to its backend. Check the project settings and connection.");
});
