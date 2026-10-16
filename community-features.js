import { createReplyAction, createReplyPreview, createReplyQuote, loadReplyTargets } from "./chat-replies.js";

export function addReactionControls(container, {
  supabase, messageId, kind, reactions, userId, refresh, showToast
}) {
  const group = document.createElement("div");
  group.className = "message-feature-actions";
  const counts = new Map();
  for (const reaction of reactions) {
    const entry = counts.get(reaction.emoji) || { count: 0, mine: false };
    entry.count += 1;
    entry.mine ||= reaction.user_id === userId;
    counts.set(reaction.emoji, entry);
  }

  for (const [emoji, info] of counts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `reaction-chip${info.mine ? " selected" : ""}`;
    button.setAttribute("aria-pressed", String(info.mine));
    button.setAttribute("aria-label", `${emoji}, ${info.count} reaction${info.count === 1 ? "" : "s"}`);
    button.textContent = `${emoji} ${info.count}`;
    button.addEventListener("click", () => toggleReaction(emoji, info.mine));
    group.append(button);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.className = "reaction-add";
  add.textContent = "+ React";
  add.setAttribute("aria-label", "Add an emoji reaction");
  const entry = document.createElement("form");
  entry.className = "reaction-entry";
  entry.hidden = true;
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 16;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Emoji reaction");
  input.placeholder = "Type or paste an emoji";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Add";
  entry.append(input, submit);
  add.addEventListener("click", () => {
    entry.hidden = !entry.hidden;
    if (!entry.hidden) input.focus();
  });
  entry.addEventListener("submit", async (event) => {
    event.preventDefault();
    const emoji = input.value.trim();
    if (!isOneGrapheme(emoji)) {
      showToast("Add one emoji at a time.");
      input.focus();
      return;
    }
    submit.disabled = true;
    try {
      await saveReaction(emoji);
      input.value = "";
      entry.hidden = true;
      await refresh();
    } catch (error) {
      console.error("Could not add a NEXUS-09 reaction.", error);
      showToast("Reaction could not be saved. Check your access and try again.");
    } finally {
      submit.disabled = false;
    }
  });
  group.append(add, entry);
  container.append(group);

  async function toggleReaction(emoji, selected) {
    try {
      if (selected) {
        let query = supabase.from("message_reactions").delete().eq("user_id", userId).eq("emoji", emoji);
        query = kind === "group"
          ? query.eq("group_message_id", messageId)
          : query.eq("direct_message_id", messageId);
        const { error } = await query;
        if (error) throw error;
      } else {
        await saveReaction(emoji);
      }
      await refresh();
    } catch (error) {
      console.error("Could not update a NEXUS-09 reaction.", error);
      showToast("Reaction could not be updated. Check your access and try again.");
    }
  }

  async function saveReaction(emoji) {
    const values = {
      user_id: userId,
      emoji,
      group_message_id: kind === "group" ? messageId : null,
      direct_message_id: kind === "direct" ? messageId : null
    };
    const { error } = await supabase.from("message_reactions").insert(values);
    if (error?.code === "23505") return;
    if (error) throw error;
  }
}

export function addReportButton(container, { kind, messageId, body, openReport }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-report-button";
  button.textContent = "Report";
  button.setAttribute("aria-label", "Report this message to the owner team");
  button.addEventListener("click", () => openReport({ kind, messageId, body }));
  container.append(button);
}

export function addDeleteMessageButton(container, {
  supabase, table, messageId, own, canModerate, refresh, showToast
}) {
  if (!own && !canModerate) return;
  const actions = document.createElement("div");
  actions.className = "message-feature-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "feature-action-button message-delete-button";
  button.textContent = "Delete";
  button.setAttribute("aria-label", "Delete this message for everyone");
  button.addEventListener("click", async () => {
    if (!window.confirm("Delete this message for everyone? This cannot be undone.")) return;
    button.disabled = true;
    try {
      const { data, error } = await supabase.from(table).delete().eq("id", messageId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("The message was not deleted. It may already be gone or you may not have permission.");
      await refresh();
      showToast("Message deleted for everyone.");
    } catch (error) {
      console.error("Could not delete a NEXUS-09 message.", error);
      showToast(error.message || "Message could not be deleted. Check your access and try again.");
    } finally {
      button.disabled = false;
    }
  });
  actions.append(button);
  container.append(actions);
}

function isOneGrapheme(value) {
  if (!value || Array.from(value).length > 16) return false;
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(value)].length === 1;
  }
  return Array.from(value).length <= 8;
}

export function initCommunityFeatures({
  supabase, getCurrentProfile, getMembers, showToast, openDialog, refreshMembers, updateCurrentProfile
}) {
  let initializedFor;
  let activeDirectConversation;
  let initializedRole;
  let directChannel;
  let directInboxChannel;
  let announcementsChannel;
  let reportsChannel;
  let reportTarget;
  let reportReturnDialog;
  let pendingDirectReply;
  let isBound = false;

  const announcementList = document.querySelector("#announcementsList");
  const dmList = document.querySelector("#dmConversationList");
  const dmThread = document.querySelector("#dmThread");
  const reportList = document.querySelector("#moderationReports");

  function bindEvents() {
    if (isBound) return;
    isBound = true;

    document.querySelector("#dmNav").addEventListener("click", openDirectMessages);
    document.querySelector("#moderationNav").addEventListener("click", openModeration);
    document.querySelector("#ownershipNav").addEventListener("click", openOwnership);
    document.querySelector("#newAnnouncementButton").addEventListener("click", () => {
      document.querySelector("#announcementForm").reset();
      document.querySelector("#announcementError").textContent = "";
      openDialog(document.querySelector("#announcementDialog"));
    });
    document.querySelector("#announcementForm").addEventListener("submit", publishAnnouncement);
    document.querySelector("#memberDmButton").addEventListener("click", () => {
      const memberId = document.querySelector("#memberDmButton").dataset.memberId;
      if (memberId) void startDirectMessage(memberId);
    });
    document.querySelector("#dmForm").addEventListener("submit", sendDirectMessage);
    document.querySelector("#reportForm").addEventListener("submit", submitReport);
    document.querySelector("#subOwnerForm").addEventListener("submit", appointSubOwner);
    document.querySelector("#powerRoomSecretForm").addEventListener("submit", savePowerRoomSecret);
    document.querySelector("#transferSecretForm").addEventListener("submit", saveTransferSecret);
    document.querySelector("#ownershipTransferForm").addEventListener("submit", transferOwnership);
    document.querySelector("#reportDialog").addEventListener("close", () => {
      reportTarget = null;
      document.querySelector("#reportReason").value = "";
      const returnDialog = reportReturnDialog;
      reportReturnDialog = null;
      if (returnDialog && getCurrentProfile()) openDialog(returnDialog);
    });
  }

  async function initialize(profile) {
    bindEvents();
    document.querySelector("#newAnnouncementButton").hidden =
      !["owner", "sub_owner"].includes(profile?.role);
    document.querySelector("#moderationNav").hidden =
      !["owner", "sub_owner"].includes(profile?.role);
    document.querySelector("#ownershipNav").hidden = profile?.role !== "owner";
    if (!profile) return;
    if (initializedFor === profile.id) {
      if (initializedRole === profile.role) return;
      initializedRole = profile.role;
      await loadAnnouncements();
      if (["owner", "sub_owner"].includes(profile.role)) {
        await loadReports();
        subscribeReports();
      } else if (reportsChannel) {
        const channel = reportsChannel;
        reportsChannel = null;
        const status = await supabase.removeChannel(channel);
        if (status !== "ok") console.error("Could not close the NEXUS-09 moderation channel.", status);
        reportList.replaceChildren(featureMessage("Reports are available to the owner team."));
      }
      return;
    }
    initializedFor = profile.id;
    initializedRole = profile.role;
    await loadAnnouncements();
    subscribeAnnouncements();
    subscribeDirectInbox(profile);
    if (["owner", "sub_owner"].includes(profile.role)) {
      await loadReports();
      subscribeReports();
    }
  }

  function populateOwnershipSelects() {
    const profile = getCurrentProfile();
    const members = getMembers().filter((member) => member.id !== profile?.id);
    const subOwnerSelect = document.querySelector("#subOwnerSelect");
    const transferOwnerSelect = document.querySelector("#transferOwnerSelect");
    const currentSubOwner = members.find((member) => member.role === "sub_owner");
    subOwnerSelect.replaceChildren(new Option("No sub-owner", ""));
    transferOwnerSelect.replaceChildren(new Option("Choose a member", ""));
    for (const member of members) {
      const label = `${member.display_name} · ${member.handle}${member.role === "sub_owner" ? " · CURRENT SUB-OWNER" : ""}`;
      const subOwnerOption = new Option(label, member.id);
      subOwnerOption.selected = member.role === "sub_owner";
      subOwnerSelect.add(subOwnerOption);
      transferOwnerSelect.add(new Option(label, member.id));
    }
    document.querySelector("#currentSubOwnerStatus").textContent = currentSubOwner
      ? `Current sub-owner: ${currentSubOwner.display_name} (@${currentSubOwner.handle})`
      : "No sub-owner is appointed.";
  }

  async function openOwnership() {
    if (getCurrentProfile()?.role !== "owner") return;
    populateOwnershipSelects();
    document.querySelector("#subOwnerError").textContent = "";
    document.querySelector("#powerRoomSecretError").textContent = "";
    document.querySelector("#transferSecretError").textContent = "";
    document.querySelector("#ownershipTransferError").textContent = "";
    openDialog(document.querySelector("#ownershipDialog"));
    try {
      await loadPowerRoomSecretStatus();
    } catch (error) {
      console.error("Could not load the Power Room code status.", error);
      document.querySelector("#powerRoomSecretStatus").textContent =
        error.message || "Power Room code status could not be loaded.";
    }
  }

  async function callOwnershipFunction(payload) {
    const { data, error } = await supabase.functions.invoke("manage-ownership", { body: payload });
    if (error || data?.error) {
      let message = data?.error;
      if (!message && error?.context instanceof Response) {
        try {
          const response = await error.context.clone().json();
          if (typeof response?.error === "string") message = response.error;
        } catch (parseError) {
          console.error("Could not read the ownership function response.", parseError);
        }
      }
      throw new Error(message || error?.message || "Ownership settings could not be updated.");
    }
    return data;
  }

  async function appointSubOwner(event) {
    event.preventDefault();
    const errorBox = document.querySelector("#subOwnerError");
    const button = event.currentTarget.querySelector('button[type="submit"]');
    errorBox.textContent = "";
    button.disabled = true;
    try {
      await callOwnershipFunction({
        action: "appoint_subowner",
        memberId: document.querySelector("#subOwnerSelect").value
      });
      await refreshMembers();
      populateOwnershipSelects();
      showToast("Sub-owner appointment updated.");
    } catch (error) {
      console.error("Could not update the NEXUS-09 sub-owner.", error);
      errorBox.textContent = error.message || "The sub-owner could not be updated.";
    } finally {
      button.disabled = false;
    }
  }

  async function loadPowerRoomSecretStatus() {
    const { data, error } = await supabase.functions.invoke("manage-power-room", {
      body: { action: "get_code_status" }
    });
    if (error || data?.error) {
      let message = data?.error;
      if (!message && error?.context instanceof Response) {
        try {
          const response = await error.context.clone().json();
          if (typeof response?.error === "string") message = response.error;
        } catch (parseError) {
          console.error("Could not read the Power Room code status response.", parseError);
        }
      }
      throw new Error(message || error?.message || "Power Room code status could not be loaded.");
    }
    if (typeof data?.configured !== "boolean") {
      throw new Error("Power Room code status returned an invalid response.");
    }
    document.querySelector("#powerRoomSecretStatus").textContent = data.configured
      ? "A shared code is set. Changing it requires the current code. Only its SHA-256 hash is stored."
      : "No code is set yet. Set a private shared code for the Main Owner and Sub-owner. Only its SHA-256 hash is stored.";
    const currentCodeInput = document.querySelector("#currentPowerRoomSecret");
    currentCodeInput.required = data.configured;
    currentCodeInput.disabled = !data.configured;
  }

  async function savePowerRoomSecret(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#powerRoomSecretError");
    const button = form.querySelector('button[type="submit"]');
    errorBox.textContent = "";
    const newSecret = document.querySelector("#newPowerRoomSecret").value;
    if (newSecret !== document.querySelector("#confirmPowerRoomSecret").value) {
      errorBox.textContent = "The new Power Room codes do not match.";
      return;
    }
    button.disabled = true;
    try {
      const { data, error } = await supabase.functions.invoke("manage-power-room", {
        body: {
          action: "set_code",
          currentSecret: document.querySelector("#currentPowerRoomSecret").value || undefined,
          newSecret,
          confirmSecret: document.querySelector("#confirmPowerRoomSecret").value
        }
      });
      if (error || data?.error) {
        let message = data?.error;
        if (!message && error?.context instanceof Response) {
          try {
            const response = await error.context.clone().json();
            if (typeof response?.error === "string") message = response.error;
          } catch (parseError) {
            console.error("Could not read the Power Room code update response.", parseError);
          }
        }
        throw new Error(message || error?.message || "The Power Room code could not be saved.");
      }
      form.reset();
      await loadPowerRoomSecretStatus();
      showToast("Power Room shared code saved.");
    } catch (error) {
      console.error("Could not save the Power Room code.", error);
      errorBox.textContent = error.message || "The Power Room code could not be saved.";
    } finally {
      button.disabled = false;
    }
  }

  async function saveTransferSecret(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#transferSecretError");
    const button = form.querySelector('button[type="submit"]');
    errorBox.textContent = "";
    button.disabled = true;
    try {
      await callOwnershipFunction({
        action: "set_transfer_secret",
        newSecret: document.querySelector("#newTransferSecret").value,
        confirmSecret: document.querySelector("#confirmTransferSecret").value,
        currentSecret: document.querySelector("#currentTransferSecret").value || undefined
      });
      form.reset();
      showToast("Ownership transfer secret saved.");
    } catch (error) {
      console.error("Could not save the ownership transfer secret.", error);
      errorBox.textContent = error.message || "The transfer secret could not be saved.";
    } finally {
      button.disabled = false;
    }
  }

  async function transferOwnership(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = document.querySelector("#ownershipTransferError");
    const button = form.querySelector('button[type="submit"]');
    errorBox.textContent = "";
    if (document.querySelector("#confirmTransferText").value !== "TRANSFER") {
      errorBox.textContent = 'Type "TRANSFER" to confirm this permanent ownership change.';
      return;
    }
    if (!window.confirm("Transfer main ownership now? You will become the sub-owner.")) return;
    button.disabled = true;
    try {
      await callOwnershipFunction({
        action: "transfer_ownership",
        memberId: document.querySelector("#transferOwnerSelect").value,
        transferSecret: document.querySelector("#ownershipTransferSecret").value
      });
      form.reset();
      const updatedProfile = { ...getCurrentProfile(), role: "sub_owner" };
      updateCurrentProfile(updatedProfile);
      await refreshMembers();
      await initialize(updatedProfile);
      document.querySelector("#ownershipDialog").close();
      showToast("Ownership transferred. You are now the sub-owner.");
    } catch (error) {
      console.error("Could not complete the NEXUS-09 ownership transfer.", error);
      errorBox.textContent = error.message || "Ownership could not be transferred.";
    } finally {
      button.disabled = false;
    }
  }

  async function loadAnnouncements() {
    const { data, error } = await supabase
      .from("announcements")
      .select("id,author_id,title,body,pinned,created_at")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      console.error("Could not load NEXUS-09 announcements.", error);
      announcementList.replaceChildren(featureMessage("Announcements could not be loaded."));
      return;
    }
    const profile = getCurrentProfile();
    if (!data?.length) {
      announcementList.replaceChildren(featureMessage("No announcements yet."));
      return;
    }
    announcementList.replaceChildren(...data.map((announcement) => {
      const article = document.createElement("article");
      article.className = `announcement-card${announcement.pinned ? " pinned" : ""}`;
      const header = document.createElement("div");
      header.className = "announcement-card-heading";
      const title = document.createElement("h3");
      title.textContent = announcement.title;
      const time = document.createElement("time");
      time.dateTime = announcement.created_at;
      time.textContent = new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(announcement.created_at));
      header.append(title, time);
      const body = document.createElement("p");
      body.textContent = announcement.body;
      article.append(header, body);
      if (["owner", "sub_owner"].includes(profile?.role)) {
        const actions = document.createElement("div");
        actions.className = "announcement-actions";
        const pin = featureButton(announcement.pinned ? "Unpin" : "Pin", async () => {
          const { error: updateError } = await supabase
            .from("announcements")
            .update({ pinned: !announcement.pinned })
            .eq("id", announcement.id);
          if (updateError) throw updateError;
          await loadAnnouncements();
        }, showToast);
        const remove = featureButton("Delete", async () => {
          if (!window.confirm("Delete this announcement for all members?")) return;
          const { error: deleteError } = await supabase.from("announcements").delete().eq("id", announcement.id);
          if (deleteError) throw deleteError;
          await loadAnnouncements();
        }, showToast);
        actions.append(pin, remove);
        article.append(actions);
      }
      return article;
    }));
  }

  function subscribeAnnouncements() {
    if (announcementsChannel) return;
    announcementsChannel = supabase
      .channel("nexus09-announcements", { config: { private: true } })
      .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, () => {
        void loadAnnouncements();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("NEXUS-09 announcement channel failed.", status);
        }
      });
  }

  function subscribeDirectInbox(profile) {
    if (directInboxChannel) return;
    directInboxChannel = supabase
      .channel(`nexus09-dm-inbox-${profile.id}`, { config: { private: true } })
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "direct_conversations"
      }, () => {
        void loadConversations();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("NEXUS-09 private inbox channel failed.", status);
        }
      });
  }

  async function publishAnnouncement(event) {
    event.preventDefault();
    const profile = getCurrentProfile();
    if (!["owner", "sub_owner"].includes(profile?.role)) return;
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const errorBox = document.querySelector("#announcementError");
    errorBox.textContent = "";
    button.disabled = true;
    try {
      const { error } = await supabase.from("announcements").insert({
        author_id: profile.id,
        title: document.querySelector("#announcementTitleInput").value.trim(),
        body: document.querySelector("#announcementBodyInput").value.trim(),
        pinned: document.querySelector("#announcementPinnedInput").checked
      });
      if (error) throw error;
      document.querySelector("#announcementDialog").close();
      form.reset();
      await loadAnnouncements();
      showToast("Announcement shared with NEXUS-09 members.");
    } catch (error) {
      console.error("Could not publish a NEXUS-09 announcement.", error);
      errorBox.textContent = "Announcement could not be published. Check the title and message, then try again.";
    } finally {
      button.disabled = false;
    }
  }

  async function openDirectMessages() {
    const profile = getCurrentProfile();
    if (!profile) return;
    await loadConversations();
    openDialog(document.querySelector("#directMessagesDialog"));
  }

  async function loadConversations() {
    const profile = getCurrentProfile();
    if (!profile) return;
    const { data, error } = await supabase
      .from("direct_conversations")
      .select("id,member_low,member_high,created_at")
      .or(`member_low.eq.${profile.id},member_high.eq.${profile.id}`)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Could not load NEXUS-09 direct conversations.", error);
      dmList.replaceChildren(featureMessage("Private conversations could not be loaded."));
      return;
    }
    if (!data?.length) {
      dmList.replaceChildren(featureMessage("No private conversations yet. Choose a member ID card to start one."));
      return;
    }
    const members = getMembers();
    dmList.replaceChildren(...data.map((conversation) => {
      const otherId = conversation.member_low === profile.id ? conversation.member_high : conversation.member_low;
      const other = members.find((member) => member.id === otherId);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `dm-conversation-button${conversation.id === activeDirectConversation ? " active" : ""}`;
      button.textContent = other?.display_name || "NEXUS member";
      button.addEventListener("click", () => void selectConversation(conversation.id, other));
      return button;
    }));
  }

  async function startDirectMessage(otherId) {
    if (!getCurrentProfile() || otherId === getCurrentProfile().id) return;
    const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
      p_other_user_id: otherId
    });
    if (error || typeof data !== "string") {
      console.error("Could not open a NEXUS-09 private conversation.", error);
      showToast("Private conversation could not be opened. Confirm both accounts are active members.");
      return;
    }
    const other = getMembers().find((member) => member.id === otherId);
    await loadConversations();
    openDialog(document.querySelector("#directMessagesDialog"));
    await selectConversation(data, other);
    document.querySelector("#memberDialog").close();
  }

  async function selectConversation(conversationId, other) {
    if (activeDirectConversation !== conversationId) setDirectReply(null);
    activeDirectConversation = conversationId;
    document.querySelector("#dmConversationTitle").textContent = other?.display_name
      ? `Private conversation with ${other.display_name}`
      : "Private conversation";
    document.querySelector("#dmInput").disabled = false;
    document.querySelector("#dmForm button").disabled = false;
    await closeDirectChannel();
    await loadDirectMessages();
    directChannel = supabase
      .channel(`nexus09-dm-${conversationId}`, { config: { private: true } })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "direct_messages",
        filter: `conversation_id=eq.${conversationId}`
      }, () => {
        void loadDirectMessages();
      })
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "message_reactions",
        filter: `direct_message_id=not.is.null`
      }, () => {
        void loadDirectMessages();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("NEXUS-09 direct message channel failed.", status);
          showToast("Private chat disconnected. Check your connection.");
        }
      });
    await loadConversations();
  }

  async function loadDirectMessages() {
    const profile = getCurrentProfile();
    if (!activeDirectConversation || !profile) return;
    const { data, error } = await supabase
      .from("direct_messages")
      .select("id,conversation_id,sender_id,body,created_at,reply_to_id,profiles!direct_messages_sender_id_fkey(display_name,handle,role)")
      .eq("conversation_id", activeDirectConversation)
      .order("id", { ascending: false })
      .limit(100);
    if (error) {
      console.error("Could not load a NEXUS-09 private conversation.", error);
      dmThread.replaceChildren(featureMessage("Private messages could not be loaded."));
      return;
    }
    const messages = (data || []).reverse();
    const replyTargets = await loadReplyTargets(supabase, "direct_messages", "direct_messages_sender_id_fkey", messages);
    for (const message of messages) message.replyTo = replyTargets.get(message.reply_to_id) || null;
    const ids = messages.map((message) => message.id);
    let reactions = [];
    if (ids.length) {
      const result = await supabase
        .from("message_reactions")
        .select("id,user_id,direct_message_id,emoji")
        .in("direct_message_id", ids);
      if (result.error) {
        console.error("Could not load private message reactions.", result.error);
        showToast("Private chat reactions could not be loaded.");
      } else {
        reactions = result.data || [];
      }
    }
    if (!messages.length) {
      dmThread.replaceChildren(featureMessage("Say hello to start this private conversation."));
      return;
    }
    dmThread.replaceChildren(...messages.map((message) => {
      const item = createMessageElement(message, profile);
      const messageReactions = reactions.filter((reaction) => reaction.direct_message_id === message.id);
      addReactionControls(item.querySelector(".chat-message-copy"), {
        supabase, messageId: message.id, kind: "direct", reactions: messageReactions,
        userId: profile.id, refresh: loadDirectMessages, showToast
      });
      addReportButton(item.querySelector(".chat-message-heading"), {
        kind: "direct", messageId: message.id, body: message.body, openReport
      });
      addDeleteMessageButton(item.querySelector(".chat-message-copy"), {
        supabase,
        table: "direct_messages",
        messageId: message.id,
        own: message.sender_id === profile.id,
        canModerate: ["owner", "sub_owner"].includes(profile.role),
        refresh: loadDirectMessages,
        showToast
      });
      item.querySelector(".chat-message-copy").append(createReplyAction(() => setDirectReply(message)));
      return item;
    }));
    dmThread.scrollTop = dmThread.scrollHeight;
  }

  async function sendDirectMessage(event) {
    event.preventDefault();
    const profile = getCurrentProfile();
    const input = document.querySelector("#dmInput");
    const body = input.value.trim();
    if (!profile || !activeDirectConversation || !body) return;
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const { error } = await supabase.from("direct_messages").insert({
        conversation_id: activeDirectConversation,
        sender_id: profile.id,
        body,
        reply_to_id: pendingDirectReply?.id ?? null
      });
      if (error) throw error;
      input.value = "";
      setDirectReply(null);
      await loadDirectMessages();
    } catch (error) {
      console.error("Could not send a NEXUS-09 private message.", error);
      showToast("Private message could not be sent. You may be temporarily muted.");
    } finally {
      button.disabled = false;
    }

  }

  function setDirectReply(message) {
    pendingDirectReply = message;
    const container = document.querySelector("#dmReplyPreview");
    container.replaceChildren();
    container.hidden = !message;
    if (message) {
      container.append(createReplyPreview(message, () => setDirectReply(null)));
      document.querySelector("#dmInput").focus();
    }
  }

  async function closeDirectChannel() {
    const channel = directChannel;
    directChannel = null;
    if (!channel) return;
    const status = await supabase.removeChannel(channel);
    if (status !== "ok") console.error("Could not close the NEXUS-09 private channel.", status);
  }

  function openReport(target) {
    reportTarget = target;
    reportReturnDialog = document.querySelector(
      target.kind === "group" ? "#chatDialog" : "#directMessagesDialog"
    );
    document.querySelector("#reportMessagePreview").textContent = target.body;
    document.querySelector("#reportReason").value = "";
    document.querySelector("#reportError").textContent = "";
    openDialog(document.querySelector("#reportDialog"));
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!reportTarget || !getCurrentProfile()) return;
    const button = event.currentTarget.querySelector("button[type=submit]");
    const errorBox = document.querySelector("#reportError");
    button.disabled = true;
    errorBox.textContent = "";
    try {
      const { error } = await supabase.rpc("submit_message_report", {
        p_report_kind: reportTarget.kind,
        p_message_id: reportTarget.messageId,
        p_reason: document.querySelector("#reportReason").value.trim()
      });
      if (error) throw error;
      document.querySelector("#reportDialog").close();
      showToast("Report sent privately to the owner team.");
    } catch (error) {
      console.error("Could not submit a NEXUS-09 message report.", error);
      errorBox.textContent = "Report could not be sent. Check your room access and try again.";
    } finally {
      button.disabled = false;
    }
  }

  async function openModeration() {
    if (!["owner", "sub_owner"].includes(getCurrentProfile()?.role)) return;
    await loadReports();
    openDialog(document.querySelector("#moderationDialog"));
  }

  function subscribeReports() {
    if (reportsChannel) return;
    reportsChannel = supabase
      .channel("nexus09-moderation-reports", { config: { private: true } })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reports" }, () => {
        void loadReports();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("NEXUS-09 moderation channel failed.", status);
        }
      });
  }

  async function loadReports() {
    if (!["owner", "sub_owner"].includes(getCurrentProfile()?.role)) return;
    const { data, error } = await supabase
      .from("message_reports")
      .select("id,reporter_id,report_kind,group_message_id,direct_message_id,reported_sender_id,reported_body,reason,status,created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("Could not load NEXUS-09 message reports.", error);
      reportList.replaceChildren(featureMessage("Reports could not be loaded."));
      return;
    }
    if (!data?.length) {
      reportList.replaceChildren(featureMessage("No reports have been submitted."));
      return;
    }
    const members = getMembers();
    reportList.replaceChildren(...data.map((report) => renderReport(report, members)));
  }

  function renderReport(report, members) {
    const card = document.createElement("article");
    card.className = `moderation-report status-${report.status}`;
    const reporter = members.find((member) => member.id === report.reporter_id)?.display_name || "Member";
    const sender = members.find((member) => member.id === report.reported_sender_id)?.display_name || "Former member";
    const heading = document.createElement("div");
    heading.className = "moderation-report-heading";
    const title = document.createElement("strong");
    title.textContent = `${report.report_kind === "group" ? "Group chat" : "Private message"} · ${report.status.toUpperCase()}`;
    const time = document.createElement("time");
    time.dateTime = report.created_at;
    time.textContent = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.created_at));
    heading.append(title, time);
    const meta = document.createElement("p");
    meta.textContent = `Reported by ${reporter} · Message from ${sender}`;
    const body = document.createElement("blockquote");
    body.textContent = report.reported_body;
    const reason = document.createElement("p");
    reason.className = "report-reason";
    reason.textContent = `Reason: ${report.reason}`;
    card.append(heading, meta, body, reason);
    if (report.status === "pending") {
      const actions = document.createElement("div");
      actions.className = "moderation-actions";
      actions.append(
        featureButton("Dismiss report", () => reviewReport(report, "dismissed"), showToast),
        featureButton("Mark reviewed", () => reviewReport(report, "reviewed"), showToast)
      );
      if (report.group_message_id || report.direct_message_id) {
        actions.append(featureButton("Delete message", () => deleteReportedMessage(report), showToast));
      }
      const reportedMember = members.find((member) => member.id === report.reported_sender_id);
      if (reportedMember?.role === "member" && report.reported_sender_id !== getCurrentProfile()?.id) {
        for (const [label, seconds] of [["Mute 1h", 3600], ["Mute 24h", 86400], ["Mute 7d", 604800]]) {
          actions.append(featureButton(label, () => muteReportedMember(report, seconds), showToast));
        }
      }
      card.append(actions);
    }
    return card;
  }

  async function reviewReport(report, status) {
    const { data, error } = await supabase.from("message_reports").update({
      status, reviewed_by: getCurrentProfile().id, reviewed_at: new Date().toISOString()
    }).eq("id", report.id).select("id").maybeSingle();
    if (error || !data) {
      console.error("Could not update a NEXUS-09 report.", error);
      showToast("Report status could not be updated.");
      return false;
    }
    await loadReports();
    return true;
  }

  async function deleteReportedMessage(report) {
    if (!window.confirm("Delete this message for its participants? The report keeps a private copy for review.")) return;
    const table = report.report_kind === "group" ? "messages" : "direct_messages";
    const id = report.report_kind === "group" ? report.group_message_id : report.direct_message_id;
    const { data, error } = await supabase.from(table).delete().eq("id", id).select("id").maybeSingle();
    if (error || !data) {
      console.error("Could not remove a reported NEXUS-09 message.", error);
      showToast("Message could not be deleted.");
      return;
    }
    if (!await reviewReport(report, "reviewed")) return;
    showToast("Message removed; the report remains available to the owner team.");
  }

  async function muteReportedMember(report, durationSeconds) {
    const sender = getMembers().find((member) => member.id === report.reported_sender_id);
    if (!sender || ["owner", "sub_owner"].includes(sender.role)) return;
    const { error } = await supabase.rpc("mute_facility_member", {
      p_member_id: sender.id,
      p_duration_seconds: durationSeconds,
      p_reason: report.reason
    });
    if (error) {
      console.error("Could not mute a reported NEXUS-09 member.", error);
      showToast("Member could not be muted.");
      return;
    }
    if (!await reviewReport(report, "reviewed")) return;
    showToast(`${sender.display_name} was muted temporarily.`);
  }

  async function dispose() {
    initializedFor = null;
    initializedRole = null;
    activeDirectConversation = null;
    setDirectReply(null);
    const channels = [directChannel, directInboxChannel, announcementsChannel, reportsChannel].filter(Boolean);
    directChannel = null;
    directInboxChannel = null;
    announcementsChannel = null;
    reportsChannel = null;
    document.querySelector("#newAnnouncementButton").hidden = true;
    document.querySelector("#moderationNav").hidden = true;
    document.querySelector("#ownershipNav").hidden = true;
    document.querySelector("#dmInput").disabled = true;
    document.querySelector("#dmForm button").disabled = true;
    for (const channel of channels) {
      const status = await supabase.removeChannel(channel);
      if (status !== "ok") console.error("Could not close a NEXUS-09 community channel.", status);
    }
  }

  return {
    initialize,
    loadAnnouncements,
    loadConversations,
    loadDirectMessages,
    loadReports,
    openReport,
    openOwnership,
    dispose
  };
}

function createMessageElement(message, currentProfile) {
  const profile = message.profiles || {};
  const own = message.sender_id === currentProfile.id;
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
  item.id = `direct-message-${message.id}`;
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
    const quote = createReplyQuote(message.replyTo, () => {
      document.getElementById(`direct-message-${message.replyTo.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      dmThread.focus({ preventScroll: true });
    });
    copy.append(quote);
  }
  copy.append(body);
  item.append(avatar, copy);
  return item;
}

function featureMessage(text) {
  const message = document.createElement("p");
  message.className = "feature-empty";
  message.textContent = text;
  return message;
}

function featureButton(label, action, showToast) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "feature-action-button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
    } catch (error) {
      console.error(`NEXUS-09 action failed: ${label}.`, error);
      showToast(`${label} could not be completed.`);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}
