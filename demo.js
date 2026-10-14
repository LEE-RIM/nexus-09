const members = [
  { id: "007", name: "Faiz", role: "Founder · Systems lead", tier: "ALPHA", bio: "Keeps the lights on, asks too many questions, and always knows where the spare key is.", initials: "F", color: "cyan", online: true },
  { id: "014", name: "Mira", role: "Quantum researcher", tier: "GAMMA", bio: "Collects impossible questions and turns them into very interesting experiments.", initials: "M", color: "violet", online: true },
  { id: "021", name: "Arjun", role: "Field operations", tier: "BETA", bio: "Knows every corridor in the facility. Insists there are three extra ones.", initials: "A", color: "amber", online: true },
  { id: "008", name: "Zoya", role: "Signal analyst", tier: "GAMMA", bio: "Can find a pattern in static and a song in the ventilation system.", initials: "Z", color: "rose", online: true },
  { id: "019", name: "Dev", role: "Hardware engineer", tier: "BETA", bio: "Builds tiny machines that do big things. Labels every wire. Mostly.", initials: "D", color: "blue", online: true },
  { id: "003", name: "Nia", role: "Security architect", tier: "ALPHA", bio: "Designs puzzles that are fun to solve and difficult to accidentally break.", initials: "N", color: "green", online: true },
  { id: "016", name: "Kabir", role: "Archive curator", tier: "GAMMA", bio: "Keeps a record of every discovery and a secret snack drawer in the archive.", initials: "K", color: "amber", online: true },
  { id: "011", name: "Isha", role: "Bio-lab specialist", tier: "BETA", bio: "The plants in the east wing are thriving. She says it is not a competition.", initials: "I", color: "rose", online: false },
  { id: "024", name: "Rohan", role: "Robotics", tier: "GAMMA", bio: "Teaches helpful robots to hold doors and unhelpful ones to stop moving chairs.", initials: "R", color: "blue", online: false },
  { id: "005", name: "Tara", role: "Atmospherics", tier: "BETA", bio: "Makes the lab breathable, comfortable, and faintly scented like rain.", initials: "T", color: "violet", online: true },
  { id: "018", name: "Neel", role: "Power systems", tier: "GAMMA", bio: "Knows exactly how much power the portal uses. Won't tell the portal.", initials: "N", color: "green", online: false },
  { id: "012", name: "Aanya", role: "Medical officer", tier: "BETA", bio: "First aid certified. Also first to notice if you skipped lunch.", initials: "A", color: "rose", online: true },
  { id: "002", name: "Rehan", role: "Navigation", tier: "ALPHA", bio: "Maps places that do not appear on any map. Draws beautifully, too.", initials: "R", color: "amber", online: false },
  { id: "022", name: "Sana", role: "Comms operator", tier: "GAMMA", bio: "Keeps the channels clear and the team connected, even on strange days.", initials: "S", color: "violet", online: true },
  { id: "009", name: "Ibrahim", role: "Materials science", tier: "BETA", bio: "Tests what things are made of, especially the things that say 'do not touch'.", initials: "I", color: "blue", online: false },
  { id: "015", name: "Kiara", role: "Light & optics", tier: "GAMMA", bio: "Rearranges light for a living. Her desk is impossible to photograph.", initials: "K", color: "rose", online: true },
  { id: "006", name: "Yusuf", role: "Logistics", tier: "BETA", bio: "Can get any part delivered to a place that technically does not exist.", initials: "Y", color: "green", online: false },
  { id: "020", name: "Anaya", role: "Dream researcher", tier: "GAMMA", bio: "Studies the ideas people wake up with before the ideas disappear.", initials: "A", color: "violet", online: false },
  { id: "010", name: "Pari", role: "Data cartographer", tier: "BETA", bio: "Turns oceans of numbers into maps you can get wonderfully lost in.", initials: "P", color: "amber", online: true },
  { id: "023", name: "Aarav", role: "Prototype testing", tier: "GAMMA", bio: "The first to try every new invention. The reason we have the big warning labels.", initials: "A", color: "blue", online: false },
  { id: "004", name: "Meher", role: "Botanist", tier: "ALPHA", bio: "Grows plants from places nobody has visited yet. They seem to like jazz.", initials: "M", color: "green", online: false },
  { id: "017", name: "Veer", role: "Acoustic systems", tier: "GAMMA", bio: "Can hear a loose screw from two rooms away. Never loses at hide-and-seek.", initials: "V", color: "rose", online: true },
  { id: "013", name: "Riya", role: "Research coordinator", tier: "BETA", bio: "Gets brilliant people and complicated schedules to cooperate.", initials: "R", color: "violet", online: false },
  { id: "001", name: "Samir", role: "Lab director", tier: "ALPHA", bio: "Believes the best discovery is the one the whole team gets to make together.", initials: "S", color: "amber", online: true }
];

const sampleMessages = [
  { memberId: "021", text: "The corridor lights blinked in sequence again. Three short, one long.", time: "09:14" },
  { memberId: "014", text: "That matches the signal from last Thursday. I added it to the board.", time: "09:16" },
  { memberId: "008", text: "Listening to the recording now. It almost sounds like a reply.", time: "09:18" },
  { memberId: "003", text: "Reminder: no one opens the east access door alone. Buddy system, please.", time: "09:22" }
];
const colors = { cyan: "#7be4e3", violet: "#c5a4ff", amber: "#ffbd76", rose: "#ff9fa9", blue: "#91c9ff", green: "#9ae3b2" };
const dialogs = [...document.querySelectorAll(".app-dialog")];
let chatMessages = loadChat();
let inviteCount = 0;
let toastTimer;
let labUnlocked = false;
let roomUnlocked = false;
let pendingDestination = null;
document.querySelector(".announcements-panel").hidden = true;
document.querySelector("#dmNav").hidden = true;
document.querySelector("#moderationNav").hidden = true;
document.querySelector("#memberDmButton").hidden = true;

function loadChat() {
  try {
    const saved = JSON.parse(localStorage.getItem("obsidian-lab-demo-chat-v1") || "null");
    if (Array.isArray(saved) && saved.length <= 100) {
      return [...sampleMessages, ...saved.filter((message) =>
        message && message.memberId === "007" && typeof message.text === "string" && message.text.length <= 500 && typeof message.time === "string"
      )];
    }
  } catch (error) {
    console.error("Could not read demo chat history.", error);
  }
  return [...sampleMessages];
}

function saveChat() {
  try {
    const userMessages = chatMessages.filter((message) => message.memberId === "007").slice(-100);
    localStorage.setItem("obsidian-lab-demo-chat-v1", JSON.stringify(userMessages));
  } catch (error) {
    console.error("Could not save demo chat message.", error);
    showToast("This browser could not save the demo message.");
  }
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2800);
}

function openDialog(dialog) {
  for (const openDialog of dialogs) {
    if (openDialog.open && openDialog !== dialog) openDialog.close();
  }
  if (!dialog.open) dialog.showModal();
}

function renderMembers() {
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
    status.className = member.online ? "online-tag" : "";
    status.textContent = member.online ? "● ONLINE" : "○ AWAY";
    details.append(name, id, status);
    button.append(avatar, details);
    button.addEventListener("click", () => showMember(member));
    return button;
  }));
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
  id.textContent = `NEXUS-09 · ID ${member.id}`;
  copy.append(name, role, id);
  document.querySelector("#largeIdCard").append(avatar, copy);
  document.querySelector("#memberName").textContent = member.name;
  document.querySelector("#memberBio").textContent = member.bio;
  document.querySelector("#memberTier").textContent = member.tier;
  openDialog(document.querySelector("#memberDialog"));
}

function renderChat() {
  const thread = document.querySelector("#chatThread");
  thread.replaceChildren(...chatMessages.map((message) => {
    const member = members.find((person) => person.id === message.memberId) || members[0];
    const item = document.createElement("article");
    item.className = `chat-message${member.id === "007" ? " is-you" : ""}`;
    const avatar = document.createElement("span");
    avatar.className = `avatar avatar-${member.color}`;
    avatar.textContent = member.initials;
    const copy = document.createElement("div");
    copy.className = "chat-message-copy";
    const heading = document.createElement("div");
    heading.className = "chat-message-heading";
    const name = document.createElement("strong");
    name.textContent = member.name;
    const time = document.createElement("time");
    time.textContent = message.time;
    const text = document.createElement("p");
    text.textContent = message.text;
    heading.append(name, time);
    copy.append(heading, text);
    item.append(avatar, copy);
    return item;
  }));
  thread.scrollTop = thread.scrollHeight;
}

function openChat() {
  renderChat();
  openDialog(document.querySelector("#chatDialog"));
  window.setTimeout(() => document.querySelector("#chatInput").focus(), 30);
}

function inviteCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(6));
  return `OBS-${Array.from(values, (value) => alphabet[value % alphabet.length]).join("")}`;
}

function openInvite() {
  document.querySelector("#generatedInvite").hidden = true;
  document.querySelector("#inviteError").textContent = "";
  document.querySelector("#availableSeats").textContent = String(Math.max(0, 30 - members.length - inviteCount)).padStart(2, "0");
  openDialog(document.querySelector("#inviteDialog"));
}

function showDestination(destination) {
  if (destination === "inner") {
    openDialog(document.querySelector("#innerDialog"));
  } else if (destination === "chat") {
    openChat();
  } else if (destination === "invite") {
    openInvite();
  }
}

function requestDestination(destination) {
  if (roomUnlocked) {
    showDestination(destination);
    return;
  }
  pendingDestination = destination;
  if (labUnlocked) {
    document.querySelector("#accessCode").value = "";
    document.querySelector("#accessError").textContent = "";
    openDialog(document.querySelector("#accessDialog"));
  } else {
    document.querySelector("#labAccessCode").value = "";
    document.querySelector("#labAccessError").textContent = "";
    openDialog(document.querySelector("#labAccessDialog"));
  }
}

document.querySelector("#enterRoomButton").addEventListener("click", () => {
  requestDestination("inner");
});

document.querySelector("#labAccessForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = document.querySelector("#labAccessCode").value.trim().toUpperCase();
  if (value === "LAB-0427") {
    labUnlocked = true;
    document.querySelector("#labDoor").classList.add("door-open");
    document.querySelector("#labAccessDialog").close();
    window.setTimeout(() => {
      document.querySelector("#accessCode").value = "";
      document.querySelector("#accessError").textContent = "";
      openDialog(document.querySelector("#accessDialog"));
      document.querySelector("#accessCode").focus();
    }, 420);
  } else {
    document.querySelector("#labAccessError").textContent = "ACCESS DENIED — CHECK THE FACILITY DEMO CODE.";
  }
});

document.querySelector("#enterRoomButton").setAttribute("aria-label", "Enter the secret lab");

document.querySelector("#accessDialog").querySelector(".dialog-copy").textContent = "A second code reveals the hidden room. This is a visual demo, not real authentication.";
document.querySelector("#accessTitle").textContent = "Unlock the hidden room.";
document.querySelector("#accessDialog").querySelector(".dialog-form label").textContent = "HIDDEN ROOM CODE";
document.querySelector("#accessDialog").querySelector(".primary-button").textContent = "VERIFY ROOM ACCESS →";
document.querySelector("#accessDialog .demo-code-hint code").textContent = "ROOM-091";

document.querySelector("#accessForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const value = document.querySelector("#accessCode").value.trim().toUpperCase();
  if (value === "ROOM-091") {
    roomUnlocked = true;
    document.querySelector("#labDoor").classList.add("door-open");
    document.querySelector("#accessDialog").close();
    window.setTimeout(() => {
      const destination = pendingDestination || "inner";
      pendingDestination = null;
      showDestination(destination);
    }, 250);
  } else {
    document.querySelector("#accessError").textContent = "ACCESS DENIED — CHECK THE DEMO CODE AND TRY AGAIN.";
  }
});

document.querySelector("#innerChatButton").addEventListener("click", openChat);
document.querySelector("#openChatLink").addEventListener("click", () => requestDestination("chat"));
document.querySelector("#chatNav").addEventListener("click", () => requestDestination("chat"));
document.querySelector("#innerRosterButton").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));
document.querySelector("#viewMembersButton").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));
document.querySelector("#allMembersButton").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));
document.querySelector("#membersNav").addEventListener("click", () => openDialog(document.querySelector("#rosterDialog")));
document.querySelector("#profileButton").addEventListener("click", () => showMember(members[0]));
document.querySelector("#inviteButton").addEventListener("click", () => requestDestination("invite"));
document.querySelector("#inviteRail").addEventListener("click", () => requestDestination("invite"));
document.querySelector("#rosterInviteButton").addEventListener("click", () => requestDestination("invite"));

document.querySelector("#generateInviteButton").addEventListener("click", () => {
  if (members.length + inviteCount >= 30) {
    document.querySelector("#inviteError").textContent = "THE FACILITY IS AT ITS 30-MEMBER DEMO LIMIT.";
    return;
  }
  inviteCount += 1;
  document.querySelector("#inviteCode").textContent = inviteCode();
  document.querySelector("#generatedInvite").hidden = false;
  document.querySelector("#availableSeats").textContent = String(Math.max(0, 30 - members.length - inviteCount)).padStart(2, "0");
});

document.querySelector("#copyInviteButton").addEventListener("click", async () => {
  const code = document.querySelector("#inviteCode").textContent;
  try {
    await navigator.clipboard.writeText(code);
    showToast("Demo invite code copied. It will not add a real member.");
  } catch (error) {
    console.error("Could not copy demo invite code.", error);
    showToast("Copy was blocked by this browser. Select the code to copy it.");
  }
});

document.querySelector("#chatForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.querySelector("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  const now = new Date();
  chatMessages.push({
    memberId: "007",
    text,
    time: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now)
  });
  chatMessages = chatMessages.slice(-100);
  saveChat();
  renderChat();
  input.value = "";
});

for (const dialog of dialogs) {
  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

function updateClock() {
  document.querySelector("#clock").textContent = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date());
}
updateClock();
window.setInterval(updateClock, 1000);
renderMembers();
