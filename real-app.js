import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { addReactionControls, addReportButton, initCommunityFeatures } from "./community-features.js";
import { createReplyAction, createReplyPreview, createReplyQuote, loadReplyTargets } from "./chat-replies.js";

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
let activeRoom = null;
let pendingRoom = null;
let pinnedPowerRoomMessageId = null;
let roomExpiryTimer;
let presenceChannel;
let messagesChannel;
let powerRoomChannel;
let inviteCreated = false;
let pendingDestination = null;
let toastTimer;
let memberInitializing = false;
let profilesCache = [];
let communityFeatures;
let qrCodeModulePromise;
let pendingGroupReply = null;
let pendingPowerRoomReply = null;

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
document.querySelector("#switchRoomButton").hidden = false;
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
document.querySelector("#vipOpenPowerRoom").addEventListener("click", () => {
  if (["owner", "sub_owner"].includes(currentProfile?.role)) {
    void openPowerRoom();
    return;
  }
  showToast("Only the owner team can access the power room.");
});

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
    document.querySelector("#profileButton small").textContent =
      `ID ${profile.handle.toUpperCase()} · ${profile.role.replace("_", " ").toUpperCase()}`;
    const profileAvatar = document.querySelector("#profileButton .avatar");
    profileAvatar.classList.toggle("avatar-main-owner", profile.role === "owner");
    profileAvatar.classList.toggle("avatar-sub-owner", profile.role === "sub_owner");
    profileAvatar.textContent = profile.role === "owner"
      ? "👑"
      : profile.role === "sub_owner"
        ? "♛"
        : profile.display_name.trim().charAt(0).toUpperCase();
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
    openScannedMemberProfile();
    if (!communityFeatures) {
      communityFeatures = initCommunityFeatures({
        supabase,
        getCurrentProfile: () => currentProfile,
        getMembers: () => profilesCache,
        showToast,
        openDialog,
        refreshMembers: loadRoster,
        updateCurrentProfile: (updatedProfile) => {
          currentProfile = updatedProfile;
          document.querySelector("#profileButton small").textContent =
            `ID ${updatedProfile.handle.toUpperCase()} · ${updatedProfile.role.replace("_", " ").toUpperCase()}`;
        }
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
  const updatedCurrentProfile = roster.find((profile) => profile.id === currentProfile?.id);
  if (updatedCurrentProfile && updatedCurrentProfile.role !== currentProfile.role) {
    currentProfile = updatedCurrentProfile;
    document.querySelector("#profileButton small").textContent =
      `ID ${currentProfile.handle.toUpperCase()} · ${currentProfile.role.replace("_", " ").toUpperCase()}`;
    if (!["owner", "sub_owner"].includes(currentProfile.role)) {
      document.querySelector("#powerRoomDialog").close();
      void removePowerRoomChannel();
    }
    if (communityFeatures) await communityFeatures.initialize(currentProfile);
  }
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
  if (["owner", "sub_owner"].includes(currentProfile?.role)) {
    refreshPowerRoomUnreadCount().catch((error) => {
      console.error("Could not load Power Room unread count.", error);
      showToast("Power Room unread messages could not be checked.");
    });
  } else {
    setPowerRoomUnreadCount(0);
  }
  if (communityFeatures) {
    await communityFeatures.loadConversations();
    if (["owner", "sub_owner"].includes(currentProfile?.role)) await communityFeatures.loadReports();
  }
}

function toMember(profile) {
  const colors = ["cyan", "violet", "amber", "rose", "blue", "green"];
  const joinedAt = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" })
    .format(new Date(profile.created_at));
  return {
    id: profile.handle,
    userId: profile.id,
    name: profile.display_name,
    accountRole: profile.role,
    role: profile.role === "owner"
      ? "Main owner"
      : profile.role === "sub_owner"
        ? "Sub-owner"
        : "NEXUS-09 member",
    tier: profile.role === "owner"
      ? "MAIN OWNER"
      : profile.role === "sub_owner"
        ? "SUB-OWNER"
        : "MEMBER",
    joinedAt,
    bio: `NEXUS-09 member since ${joinedAt}.`,
    initials: profile.display_name.trim().charAt(0).toUpperCase(),
    color: profile.role === "owner"
      ? "main-owner"
      : profile.role === "sub_owner"
        ? "sub-owner"
        : colors[Array.from(profile.handle).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length],
    roleClass: profile.role === "owner" ? "is-main-owner" : profile.role === "sub_owner" ? "is-sub-owner" : "",
    badge: profile.role === "owner" ? "✦ MAIN OWNER" : profile.role === "sub_owner" ? "◆ SUB-OWNER" : "",
    online: profile.id === currentProfile?.id
  };
}

function renderRoster(profiles) {
  const members = profiles.map(toMember);
  const strip = document.querySelector("#memberStrip");
  strip.replaceChildren(...members.slice(0, 8).map((member) => {
    const button = document.createElement("button");
    button.className = `member-mini ${member.roleClass}`;
    button.type = "button";
    button.setAttribute("aria-label", `View ID card for ${member.name}`);
    const avatar = document.createElement("span");
    avatar.className = `avatar avatar-${member.color}`;
    avatar.textContent = member.accountRole === "owner"
      ? "👑"
      : member.accountRole === "sub_owner"
        ? "♛"
        : member.initials;
    const name = document.createElement("span");
    name.textContent = member.name;
    button.append(avatar, name);
    if (member.badge) {
      const badge = document.createElement("small");
      badge.className = "member-role-badge";
      badge.textContent = member.badge;
      button.append(badge);
    }
    button.addEventListener("click", () => showMember(member));
    return button;
  }));
  const grid = document.querySelector("#rosterGrid");
  grid.replaceChildren(...members.map((member) => {
    const button = document.createElement("button");
    button.className = `roster-card ${member.roleClass}`;
    button.type = "button";
    const avatar = document.createElement("span");
    avatar.className = `avatar avatar-${member.color}`;
    avatar.textContent = member.accountRole === "owner"
      ? "👑"
      : member.accountRole === "sub_owner"
        ? "♛"
        : member.initials;
    const details = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = member.name;
    const id = document.createElement("small");
    id.textContent = `ID ${member.id}`;
    const status = document.createElement("small");
    status.className = "online-tag";
    status.textContent = member.role === "Main owner"
      ? "MAIN OWNER"
      : member.role === "Sub-owner"
        ? "SUB-OWNER"
        : "CLEARED MEMBER";
    details.append(name, id, status);
    if (member.badge) {
      const badge = document.createElement("small");
      badge.className = "member-role-badge";
      badge.textContent = member.badge;
      details.append(badge);
    }
    button.append(avatar, details);
    button.addEventListener("click", () => showMember(member));
    return button;
  }));
  document.querySelector("#allMembersButton").disabled = members.length === 0;
  renderVipSpotlight();
}

function renderVipSpotlight() {
  const vipPanel = document.querySelector("#vipPanel");
  const isOwnerTeam = ["owner", "sub_owner"].includes(currentProfile?.role);
  vipPanel.hidden = !isOwnerTeam;
  if (!isOwnerTeam) return;
  const owner = profilesCache.find((profile) => profile.role === "owner");
  const subOwner = profilesCache.find((profile) => profile.role === "sub_owner");
  const ownerName = document.querySelector("#vipOwnerName");
  const ownerMeta = document.querySelector("#vipOwnerMeta");
  const ownerQuote = document.querySelector("#vipOwnerQuote");
  const subOwnerName = document.querySelector("#vipSubOwnerName");
  const subOwnerMeta = document.querySelector("#vipSubOwnerMeta");
  const subOwnerQuote = document.querySelector("#vipSubOwnerQuote");

  if (owner) {
    ownerName.textContent = owner.display_name;
    ownerMeta.textContent = `ID ${owner.handle.toUpperCase()} · MAIN OWNER`;
    ownerQuote.textContent = "Leadership access is secure, and the room remains protected for the inner team.";
  } else {
    ownerName.textContent = "Main owner";
    ownerMeta.textContent = "No owner assigned yet";
    ownerQuote.textContent = "Leadership access secured for the inner facility.";
  }

  function setPowerRoomUnreadCount(count) {
    const badge = document.querySelector("#powerRoomUnreadBadge");
    if (!badge) return;
    badge.hidden = count < 1;
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.setAttribute("aria-label", `${count} unread Power Room message${count === 1 ? "" : "s"}`);
    document.querySelector("#vipOpenPowerRoom").setAttribute(
      "aria-label",
      count ? `Open Power Room, ${count} unread message${count === 1 ? "" : "s"}` : "Open Power Room"
    );
  }

  if (subOwner) {
    subOwnerName.textContent = subOwner.display_name;
    subOwnerMeta.textContent = `ID ${subOwner.handle.toUpperCase()} · SUB-OWNER`;
    subOwnerQuote.textContent = "Operations and access routing are live for the VIP room.";
  } else {
    subOwnerName.textContent = "Sub-owner";
    subOwnerMeta.textContent = "No sub-owner assigned yet";
    subOwnerQuote.textContent = "Strategic access remains in standby until confirmed.";
  }

}

function showMember(member) {
  document.querySelector("#largeIdCard").replaceChildren();
  const avatar = document.createElement("span");
  avatar.className = `large-id-avatar avatar-${member.color}`;
  avatar.textContent = member.accountRole === "owner"
    ? "👑"
    : member.accountRole === "sub_owner"
      ? "♛"
      : member.initials;
  const copy = document.createElement("span");
  copy.className = "large-id-copy";
  const card = document.querySelector("#largeIdCard");
  card.classList.toggle("is-main-owner", member.accountRole === "owner");
  card.classList.toggle("is-sub-owner", member.accountRole === "sub_owner");
  card.classList.toggle("is-member-card", member.accountRole === "member");
  if (member.accountRole === "member") {
    const stamp = document.createElement("span");
    stamp.className = "member-id-stamp";
    stamp.textContent = "✓ LEE GON · NEXUS-09";
    copy.append(stamp);
  }
  const name = document.createElement("strong");
  name.textContent = member.name.toUpperCase();
  const role = document.createElement("span");
  role.textContent = member.role.toUpperCase();
  if (member.badge) {
    const badge = document.createElement("span");
    badge.className = "member-role-badge";
    badge.textContent = member.badge;
    copy.append(name, role, badge);
  } else {
    copy.append(name, role);
  }
  const id = document.createElement("small");
  id.textContent = `NEXUS-09 · ID ${member.id.toUpperCase()}`;
  copy.append(id);
  if (member.accountRole === "member") {
    const joined = document.createElement("small");
    joined.className = "member-since";
    joined.textContent = `MEMBER SINCE · ${member.joinedAt.toUpperCase()}`;
    copy.append(joined);
  }
  document.querySelector("#largeIdCard").append(avatar, copy);
  if (member.accountRole === "member") {
    const qrButton = document.createElement("button");
    qrButton.className = "member-card-qr-button";
    qrButton.type = "button";
    qrButton.setAttribute("aria-label", `Enlarge QR code for ${member.name}'s member profile`);
    const qr = document.createElement("canvas");
    qr.className = "member-card-qr";
    qr.width = 96;
    qr.height = 96;
    qrButton.append(qr);
    document.querySelector("#largeIdCard").append(qrButton);
    renderMemberQr(qr, member.id, 96).catch((error) => {
      console.error("Could not create the member ID card QR code.", error);
      showToast("This member ID card's QR code could not be loaded.");
    });
    qrButton.addEventListener("click", () => openMemberPass(member.id));
  }
  document.querySelector("#memberName").textContent = member.name;
  document.querySelector("#memberBio").textContent = member.bio;
  document.querySelector("#memberTier").textContent = member.tier;
  const messageButton = document.querySelector("#memberDmButton");
  messageButton.dataset.memberId = member.userId || "";
  messageButton.hidden = !member.userId || member.userId === currentProfile?.id;
  document.querySelector("#memberPassButton").hidden =
    member.accountRole !== "member" || member.userId !== currentProfile?.id;
  openDialog(document.querySelector("#memberDialog"));
}

async function getQrCodeModule() {
  if (!qrCodeModulePromise) {
    qrCodeModulePromise = import("https://esm.sh/qrcode@1.5.4")
      .then((module) => module.default)
      .catch((error) => {
        qrCodeModulePromise = null;
        throw error;
      });
  }
  return qrCodeModulePromise;
}

async function renderMemberQr(canvas, handle, width) {
  const qrCode = await getQrCodeModule();
  await qrCode.toCanvas(canvas, memberProfileUrl(handle), {
    width,
    margin: 2,
    color: { dark: "#10232a", light: "#f2fbf8" },
    errorCorrectionLevel: "M"
  });
}

async function openMemberPass(handle) {
  const errorBox = document.querySelector("#memberPassError");
  errorBox.textContent = "";
  try {
    await renderMemberQr(document.querySelector("#memberPassQr"), handle, 240);
    const passUrl = memberProfileUrl(handle);
    document.querySelector("#memberPassId").textContent = `NEXUS-09 · ID ${handle.toUpperCase()}`;
    document.querySelector("#memberPassCopyButton").dataset.profileUrl = passUrl;
    document.querySelector("#memberDialog").close();
    openDialog(document.querySelector("#memberPassDialog"));
  } catch (error) {
    console.error("Could not create the NEXUS-09 member pass QR code.", error);
    errorBox.textContent = "The pass could not be created. Check your connection and try again.";
    showToast("The member QR pass could not be generated. Check your connection and try again.");
  }
}

function memberProfileUrl(handle) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("member", handle);
  return url.href;
}

document.querySelector("#memberPassButton").addEventListener("click", async () => {
  const button = document.querySelector("#memberPassButton");
  button.disabled = true;
  try {
    await openMemberPass(currentProfile.handle);
  } catch (error) {
    console.error("Could not open the NEXUS-09 member pass.", error);
    showToast("The member pass could not be opened. Please try again.");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#memberPassCopyButton").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const errorBox = document.querySelector("#memberPassError");
  errorBox.textContent = "";
  try {
    await navigator.clipboard.writeText(button.dataset.profileUrl);
    showToast("Member profile link copied.");
  } catch (error) {
    console.error("Could not copy the NEXUS-09 member profile link.", error);
    errorBox.textContent = "The link could not be copied. You can scan the QR code instead.";
  }
});

function openScannedMemberProfile() {
  const url = new URL(location.href);
  const handle = url.searchParams.get("member");
  if (!handle) return;
  url.searchParams.delete("member");
  history.replaceState(null, "", url);
  const profile = profilesCache.find((member) => member.handle.toLowerCase() === handle.toLowerCase());
  if (!profile) {
    showToast("That member profile could not be found in the NEXUS-09 roster.");
    return;
  }
  showMember(toMember(profile));
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
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
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
  const channels = [presenceChannel, messagesChannel, powerRoomChannel].filter(Boolean);
  presenceChannel = null;
  messagesChannel = null;
  powerRoomChannel = null;
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

function roomStatusMessage(text) {
  const message = document.createElement("p");
  message.className = "feature-empty";
  message.textContent = text;
  return message;
}

function requestDestination(destination) {
  if (activeRoom && roomUnlockedUntil > Date.now()) {
    showDestination(destination);
    return;
  }
  pendingDestination = destination;
  void openRoomPicker();
}

function showDestination(destination) {
  if (destination === "inner") openDialog(document.querySelector("#innerDialog"));
  if (destination === "chat") openChat();
  if (destination === "invite") openInvite();
}

async function loadRooms() {
  const { data, error } = await supabase
    .from("rooms")
    .select("id,name,is_default,is_active,created_at")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function openRoomPicker() {
  const list = document.querySelector("#roomList");
  list.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "feature-empty";
  loading.textContent = "Loading available rooms…";
  list.append(loading);
  document.querySelector("#manageRoomsButton").hidden =
    !["owner", "sub_owner"].includes(currentProfile?.role);
  openDialog(document.querySelector("#roomsDialog"));
  try {
    const rooms = (await loadRooms()).filter((room) => room.is_active);
    if (!rooms.length) {
      list.replaceChildren(roomStatusMessage("No active rooms are available."));
      return;
    }
    list.replaceChildren(...rooms.map((room) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `room-choice${room.is_default ? " is-default-room" : ""}`;
      const name = document.createElement("strong");
      name.textContent = room.name;
      const note = document.createElement("small");
      note.textContent = `${room.is_default ? "MAIN ROOM" : "PRIVATE ROOM"} · CODE REQUIRED`;
      button.append(name, note);
      button.addEventListener("click", () => requestRoomAccess(room));
      return button;
    }));
  } catch (error) {
    console.error("Could not load NEXUS-09 rooms.", error);
    list.replaceChildren(roomStatusMessage("Rooms could not be loaded. Check your connection and try again."));
  }
}

function requestRoomAccess(room) {
  pendingRoom = room;
  document.querySelector("#accessTitle").textContent = `Enter ${room.name}.`;
  document.querySelector("#accessCopy").textContent =
    "Enter this room's private access code. Access expires after 30 minutes.";
  document.querySelector("#accessDialog .dialog-form label").textContent = "ROOM ACCESS CODE";
  document.querySelector("#accessDialog .demo-code-hint").textContent = "ROOM CODE PROVIDED BY THE OWNER TEAM.";
  document.querySelector("#accessCode").value = "";
  document.querySelector("#accessError").textContent = "";
  openDialog(document.querySelector("#accessDialog"));
  window.setTimeout(() => document.querySelector("#accessCode").focus(), 30);
}

async function unlockRoom(roomId, roomCode) {
  const { data, error } = await supabase.functions.invoke("unlock-room", { body: { roomId, roomCode } });
  if (error) throw new Error(await edgeFunctionError(error, data, "Room code could not be checked."));
  if (data?.error) throw new Error(data.error);
  if (!data?.unlocked || !data.expiresAt || data.roomId !== roomId) {
    throw new Error("Room access was not confirmed by the server.");
  }
  const expiresAt = Date.parse(data.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("The server returned an invalid room-access expiry. Try again.");
  }
  if (messagesChannel) {
    const previousChannel = messagesChannel;
    messagesChannel = null;
    const status = await supabase.removeChannel(previousChannel);
    if (status !== "ok") console.error("Could not close the previous NEXUS-09 room channel.", status);
  }
  if (activeRoom?.id !== pendingRoom.id) setReplyDraft("group", null);
  activeRoom = pendingRoom;
  pendingRoom = null;
  roomUnlockedUntil = expiresAt;
  document.querySelector("#activeRoomName").textContent = `#${activeRoom.name.toUpperCase()}`;
  window.clearTimeout(roomExpiryTimer);
  roomExpiryTimer = window.setTimeout(() => {
    roomUnlockedUntil = 0;
    activeRoom = null;
    setReplyDraft("group", null);
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
    showToast("Room access expired. Choose a room and enter its code again.");
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
    if (!pendingRoom) throw new Error("Choose a room before entering its access code.");
    await unlockRoom(pendingRoom.id, document.querySelector("#accessCode").value);
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

document.querySelector("#manageRoomsButton").addEventListener("click", () => {
  if (!["owner", "sub_owner"].includes(currentProfile?.role)) return;
  document.querySelector("#createRoomForm").reset();
  document.querySelector("#manageRoomsError").textContent = "";
  openDialog(document.querySelector("#manageRoomsDialog"));
  void loadManagedRooms();
});

async function loadManagedRooms() {
  const list = document.querySelector("#managedRoomList");
  try {
    const rooms = await loadRooms();
    list.replaceChildren(...rooms.map((room) => {
      const row = document.createElement("div");
      row.className = "managed-room-row";
      const name = document.createElement("span");
      name.textContent = `${room.name}${room.is_default ? " · DEFAULT" : ""}`;
      const status = document.createElement("small");
      status.textContent = room.is_active ? "ACTIVE" : "ARCHIVED";
      row.append(name, status);
      if (room.is_active && !room.is_default) {
        const archive = document.createElement("button");
        archive.type = "button";
        archive.className = "feature-action-button";
        archive.textContent = "ARCHIVE";
        archive.addEventListener("click", () => void archiveRoom(room.id));
        row.append(archive);
      }
      return row;
    }));
  } catch (error) {
    console.error("Could not load NEXUS-09 room settings.", error);
    list.replaceChildren(roomStatusMessage("Room settings could not be loaded."));
  }
}

async function archiveRoom(roomId) {
  try {
    const { data, error } = await supabase.functions.invoke("manage-rooms", {
      body: { action: "archive", roomId }
    });
    if (error) throw new Error(await edgeFunctionError(error, data, "Room could not be archived."));
    if (data?.error) throw new Error(data.error);
    if (activeRoom?.id === roomId) {
      roomUnlockedUntil = 0;
      activeRoom = null;
      setReplyDraft("group", null);
      if (messagesChannel) {
        const channel = messagesChannel;
        messagesChannel = null;
        const status = await supabase.removeChannel(channel);
        if (status !== "ok") console.error("Could not close the archived room channel.", status);
      }
      document.querySelector("#chatDialog").close();
    }
    await loadManagedRooms();
    showToast("Room archived. Its saved messages have been kept.");
  } catch (error) {
    console.error("Could not archive a NEXUS-09 room.", error);
    document.querySelector("#manageRoomsError").textContent =
      friendlyError(error, "The room could not be archived. Try again.");
  }
}

document.querySelector("#createRoomForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!["owner", "sub_owner"].includes(currentProfile?.role)) return;
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const errorBox = document.querySelector("#manageRoomsError");
  errorBox.textContent = "";
  button.disabled = true;
  try {
    const { data, error } = await supabase.functions.invoke("manage-rooms", {
      body: {
        action: "create",
        name: document.querySelector("#newRoomName").value,
        roomCode: document.querySelector("#newRoomCode").value
      }
    });
    if (error) throw new Error(await edgeFunctionError(error, data, "Room could not be created."));
    if (data?.error) throw new Error(data.error);
    form.reset();
    await loadManagedRooms();
    showToast("Private room created. Share its code only with intended members.");
  } catch (error) {
    console.error("Could not create a NEXUS-09 room.", error);
    errorBox.textContent = friendlyError(error, "Room could not be created. Check its name and code.");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#switchRoomButton").addEventListener("click", () => {
  pendingDestination = "chat";
  void openRoomPicker();
});

function messageElement(message, reactions = []) {
  const profile = message.profiles || {};
  const own = message.sender_id === currentProfile?.id;
  const role = profile.role || "member";
  const roleClass = role === "owner" ? "is-main-owner" : role === "sub_owner" ? "is-sub-owner" : "";
  const color = role === "owner"
    ? "main-owner"
    : role === "sub_owner"
      ? "sub-owner"
      : own
        ? "cyan"
        : ["violet", "amber", "rose", "blue", "green"][Array.from(profile.handle || "").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5];
  const item = document.createElement("article");
  item.className = `chat-message${own ? " is-you" : ""}${roleClass ? ` ${roleClass}` : ""}`;
  item.id = `group-message-${message.id}`;
  const avatar = document.createElement("span");
  avatar.className = `avatar avatar-${color}`;
  avatar.textContent = role === "owner"
    ? "👑"
    : role === "sub_owner"
      ? "♛"
      : (profile.display_name || "M").trim().charAt(0).toUpperCase();
  const copy = document.createElement("div");
  copy.className = "chat-message-copy";
  const heading = document.createElement("div");
  heading.className = "chat-message-heading";
  const name = document.createElement("strong");
  name.textContent = profile.display_name || "NEXUS member";
  if (roleClass) {
    const badge = document.createElement("span");
    badge.className = "chat-role-badge";
    badge.textContent = role === "owner" ? "✦ MAIN OWNER" : "◆ SUB-OWNER";
    heading.append(name, badge);
  } else {
    heading.append(name);
  }
  const time = document.createElement("time");
  const date = new Date(message.created_at);
  time.dateTime = date.toISOString();
  time.textContent = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(date);
  const body = document.createElement("p");
  body.textContent = message.body;
  heading.append(time);
  copy.append(heading);
  if (message.replyTo) {
    copy.append(createReplyQuote(message.replyTo, () => scrollToMessage("chatThread", "group-message", message.replyTo.id)));
  }
  copy.append(body);
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
  copy.append(createReplyAction(() => setReplyDraft("group", message)));
  item.append(avatar, copy);
  return item;
}

function scrollToMessage(threadId, messagePrefix, messageId) {
  document.getElementById(`${messagePrefix}-${messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById(threadId)?.focus({ preventScroll: true });
}

function setReplyDraft(kind, message) {
  const isPowerRoom = kind === "power";
  const container = document.querySelector(isPowerRoom ? "#powerRoomReplyPreview" : "#groupReplyPreview");
  const input = document.querySelector(isPowerRoom ? "#powerRoomInput" : "#chatInput");
  if (isPowerRoom) pendingPowerRoomReply = message;
  else pendingGroupReply = message;
  container.replaceChildren();
  container.hidden = !message;
  if (message) {
    container.append(createReplyPreview(message, () => setReplyDraft(kind, null)));
    input.focus();
  }
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
  if (!activeRoom || roomUnlockedUntil <= Date.now()) throw new Error("Room access expired. Choose a room and enter its code again.");
  const { data, error } = await supabase
    .from("messages")
    .select("id,body,created_at,sender_id,reply_to_id,profiles!messages_sender_id_fkey(display_name,handle,role)")
    .eq("room_id", activeRoom.id)
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw error;
  const messages = (data || []).reverse();
  const replyTargets = await loadReplyTargets(supabase, "messages", "messages_sender_id_fkey", messages);
  for (const message of messages) message.replyTo = replyTargets.get(message.reply_to_id) || null;
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
  if (messagesChannel || !activeRoom || roomUnlockedUntil <= Date.now()) return;
  const roomId = activeRoom.id;
  messagesChannel = supabase
    .channel(`nexus09-room-${roomId}`, { config: { private: true } })
    .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` }, async () => {
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
    if (!activeRoom || roomUnlockedUntil <= Date.now()) throw new Error("Choose a room and enter its code first.");
    await loadMessages();
    openDialog(document.querySelector("#chatDialog"));
    window.setTimeout(() => document.querySelector("#chatInput").focus(), 30);
  } catch (error) {
    console.error("Could not load NEXUS-09 messages.", error);
    showToast(friendlyError(error, "The group channel could not be loaded."));
  }
}

function powerRoomMessageElement(message) {
  const profile = message.profiles || {};
  const role = profile.role || "member";
  const own = message.sender_id === currentProfile?.id;
  const item = document.createElement("article");
  item.id = `power-message-${message.id}`;
  const pinned = message.id === pinnedPowerRoomMessageId;
  item.className = `power-room-message${role === "owner" ? " is-main-owner" : " is-sub-owner"}${own ? " is-you" : ""}${pinned ? " is-pinned" : ""}`;

  const avatar = document.createElement("span");
  avatar.className = `avatar ${role === "owner" ? "avatar-main-owner" : "avatar-sub-owner"}`;
  avatar.textContent = role === "owner" ? "👑" : "♛";

  const copy = document.createElement("div");
  copy.className = "power-room-message-copy";
  const heading = document.createElement("div");
  heading.className = "power-room-message-heading";
  const name = document.createElement("strong");
  name.textContent = profile.display_name || "Owner team";
  const badge = document.createElement("small");
  badge.textContent = role === "owner" ? "✦ MAIN OWNER" : "◆ SUB-OWNER";
  const time = document.createElement("time");
  const date = new Date(message.created_at);
  time.dateTime = date.toISOString();
  time.textContent = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
  heading.append(name, badge, time);
  const body = document.createElement("p");
  body.textContent = message.body;
  const replyQuote = message.replyTo
    ? createReplyQuote(message.replyTo, () => scrollToMessage("powerRoomThread", "power-message", message.replyTo.id))
    : null;
  const pinButton = document.createElement("button");
  pinButton.className = "power-room-pin-action";
  pinButton.type = "button";
  pinButton.textContent = pinned ? "◆ UNPIN MESSAGE" : "◇ PIN IMPORTANT MESSAGE";
  pinButton.setAttribute("aria-label", pinned ? "Unpin this Power Room message" : "Pin this Power Room message");
  pinButton.addEventListener("click", () => {
    pinButton.disabled = true;
    setPowerRoomPinnedMessage(pinned ? null : message.id).catch((error) => {
      console.error("Could not update the Power Room pinned message.", error);
      showToast("Power Room message could not be pinned. Try again.");
    }).finally(() => {
      pinButton.disabled = false;
    });
  });
  copy.append(heading);
  if (replyQuote) copy.append(replyQuote);
  copy.append(body, createReplyAction(() => setReplyDraft("power", message)), pinButton);
  item.append(avatar, copy);
  return item;
}

async function loadPowerRoomMessages() {
  if (!["owner", "sub_owner"].includes(currentProfile?.role)) {
    throw new Error("Power Room is available only to the Main Owner and Sub-owner.");
  }
  const { data, error } = await supabase
    .from("power_room_messages")
    .select("id,body,created_at,sender_id,reply_to_id,profiles!power_room_messages_sender_id_fkey(display_name,handle,role)")
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw error;
  let messages = (data || []).reverse();
  const { data: pin, error: pinError } = await supabase
    .from("power_room_pins")
    .select("message_id,pinned_by,pinned_at")
    .eq("singleton", true)
    .maybeSingle();
  if (pinError) throw pinError;
  pinnedPowerRoomMessageId = pin?.message_id ?? null;
  let pinnedMessage = messages.find((message) => message.id === pinnedPowerRoomMessageId);
  if (pin && !pinnedMessage) {
    const result = await supabase
      .from("power_room_messages")
      .select("id,body,created_at,sender_id,reply_to_id,profiles!power_room_messages_sender_id_fkey(display_name,handle,role)")
      .eq("id", pin.message_id)
      .maybeSingle();
    if (result.error) throw result.error;
    pinnedMessage = result.data || null;
    if (pinnedMessage) messages = [...messages, pinnedMessage].sort((a, b) => a.id - b.id);
  }
  const replyTargets = await loadReplyTargets(supabase, "power_room_messages", "power_room_messages_sender_id_fkey", messages);
  for (const message of messages) message.replyTo = replyTargets.get(message.reply_to_id) || null;
  renderPowerRoomPin(pinnedMessage, pin);
  const thread = document.querySelector("#powerRoomThread");
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "real-chat-empty";
    empty.textContent = "No Power Room messages yet. Start a private conversation.";
    thread.replaceChildren(empty);
    return;
  }
  thread.replaceChildren(...messages.map(powerRoomMessageElement));
  thread.scrollTop = thread.scrollHeight;
}

function renderPowerRoomPin(message, pin) {
  const container = document.querySelector("#powerRoomPin");
  if (!message || !pin) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  const label = document.createElement("span");
  label.className = "power-room-pin-label";
  label.textContent = "◆ PINNED FOR THE OWNER TEAM";
  const text = document.createElement("p");
  text.textContent = message.body;
  const detail = document.createElement("small");
  const author = message.profiles?.display_name || "Owner team";
  detail.textContent = `Pinned by ${pin.pinned_by === currentProfile?.id ? "you" : author} · ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(pin.pinned_at))}`;
  container.replaceChildren(label, text, detail);
  container.hidden = false;
}

async function setPowerRoomPinnedMessage(messageId) {
  if (!["owner", "sub_owner"].includes(currentProfile?.role)) {
    throw new Error("Only the owner team can pin Power Room messages.");
  }
  if (messageId === null) {
    const { error } = await supabase
      .from("power_room_pins")
      .delete()
      .eq("singleton", true);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("power_room_pins")
      .upsert({
        singleton: true,
        message_id: messageId,
        pinned_by: currentProfile.id,
        pinned_at: new Date().toISOString()
      }, { onConflict: "singleton" });
    if (error) throw error;
  }
  await loadPowerRoomMessages();
}

async function refreshPowerRoomUnreadCount() {
  if (!["owner", "sub_owner"].includes(currentProfile?.role)) {
    setPowerRoomUnreadCount(0);
    return;
  }
  const { data: cursor, error: cursorError } = await supabase
    .from("power_room_reads")
    .select("last_read_message_id")
    .eq("user_id", currentProfile.id)
    .maybeSingle();
  if (cursorError) throw cursorError;
  const { count, error } = await supabase
    .from("power_room_messages")
    .select("id", { count: "exact", head: true })
    .gt("id", cursor?.last_read_message_id ?? 0)
    .neq("sender_id", currentProfile.id);
  if (error) throw error;
  setPowerRoomUnreadCount(count ?? 0);
}

async function markPowerRoomRead() {
  if (!["owner", "sub_owner"].includes(currentProfile?.role)) return;
  const { data: latest, error: latestError } = await supabase
    .from("power_room_messages")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (!latest) {
    setPowerRoomUnreadCount(0);
    return;
  }
  const { error } = await supabase
    .from("power_room_reads")
    .upsert({
      user_id: currentProfile.id,
      last_read_message_id: latest.id,
      updated_at: new Date().toISOString()
    }, { onConflict: "user_id" });
  if (error) throw error;
  setPowerRoomUnreadCount(0);
}

function subscribeToPowerRoom() {
  if (powerRoomChannel || !["owner", "sub_owner"].includes(currentProfile?.role)) return;
  powerRoomChannel = supabase
    .channel("nexus09-power-room", { config: { private: true } })
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "power_room_messages"
    }, () => {
      const update = document.querySelector("#powerRoomDialog").open
        ? loadPowerRoomMessages().then(markPowerRoomRead)
        : refreshPowerRoomUnreadCount();
      update.catch((error) => {
        console.error("Could not refresh Power Room activity.", error);
        showToast("Power Room activity could not be refreshed.");
      });
    })
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "power_room_pins"
    }, () => {
      if (!document.querySelector("#powerRoomDialog").open) return;
      loadPowerRoomMessages().catch((error) => {
        console.error("Could not refresh the Power Room pinned message.", error);
        showToast("Power Room pinned message could not be refreshed.");
      });
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.error("NEXUS-09 Power Room channel failed.", status);
        showToast("Power Room live chat disconnected. Check your connection.");
      }
    });
}

async function removePowerRoomChannel() {
  if (!powerRoomChannel) return;
  const channel = powerRoomChannel;
  powerRoomChannel = null;
  const status = await supabase.removeChannel(channel);
  if (status !== "ok") console.error("Could not close the Power Room realtime channel.", status);
}

async function openPowerRoom() {
  if (!["owner", "sub_owner"].includes(currentProfile?.role)) {
    showToast("Only the Main Owner and Sub-owner can open Power Room.");
    return;
  }
  try {
    await loadPowerRoomMessages();
    openDialog(document.querySelector("#powerRoomDialog"));
    await markPowerRoomRead();
    subscribeToPowerRoom();
    await refreshPowerRoomUnreadCount();
    window.setTimeout(() => document.querySelector("#powerRoomInput").focus(), 30);
  } catch (error) {
    console.error("Could not load Power Room messages.", error);
    showToast(friendlyError(error, "Power Room could not be opened."));
  }
}

document.querySelector("#powerRoomDialog").addEventListener("close", () => {
  void removePowerRoomChannel();
});

document.querySelector("#powerRoomForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.querySelector("#powerRoomInput");
  const text = input.value.trim();
  if (!text || !currentProfile || !["owner", "sub_owner"].includes(currentProfile.role)) return;
  const send = event.currentTarget.querySelector("button");
  send.disabled = true;
  try {
    const { error } = await supabase.from("power_room_messages").insert({
      sender_id: currentProfile.id,
      body: text,
      reply_to_id: pendingPowerRoomReply?.id ?? null
    });
    if (error) throw error;
    input.value = "";
    setReplyDraft("power", null);
    await loadPowerRoomMessages();
    await markPowerRoomRead();
  } catch (error) {
    console.error("Could not send a Power Room message.", error);
    showToast(friendlyError(error, "Power Room message could not be sent."));
  } finally {
    send.disabled = false;
  }
});

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
    if (!activeRoom || roomUnlockedUntil <= Date.now()) throw new Error("Room access expired. Choose a room and enter its code again.");
    const { error } = await supabase.from("messages").insert({
      sender_id: currentProfile.id,
      room_id: activeRoom.id,
      body: text,
      reply_to_id: pendingGroupReply?.id ?? null
    });
    if (error) throw error;
    input.value = "";
    setReplyDraft("group", null);
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
  setPowerRoomUnreadCount(0);
  roomUnlockedUntil = 0;
  activeRoom = null;
  pendingRoom = null;
  setReplyDraft("group", null);
  setReplyDraft("power", null);
  pendingDestination = null;
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
      activeRoom = null;
      pendingRoom = null;
      setReplyDraft("group", null);
      setReplyDraft("power", null);
      pendingDestination = null;
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
