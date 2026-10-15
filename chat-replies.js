export function createReplyAction(onReply) {
  const button = document.createElement("button");
  button.className = "message-reply-button";
  button.type = "button";
  button.textContent = "Reply";
  button.setAttribute("aria-label", "Reply to this message");
  button.addEventListener("click", onReply);
  return button;
}

export function createReplyPreview(message, onCancel) {
  const preview = document.createElement("div");
  preview.className = "reply-compose-preview";
  const copy = document.createElement("span");
  copy.className = "reply-compose-copy";
  const author = document.createElement("strong");
  author.textContent = `Replying to ${message.profiles?.display_name || "member"}`;
  const body = document.createElement("span");
  body.textContent = message.body;
  copy.append(author, body);
  const cancel = document.createElement("button");
  cancel.className = "reply-cancel-button";
  cancel.type = "button";
  cancel.textContent = "×";
  cancel.setAttribute("aria-label", "Cancel reply");
  cancel.addEventListener("click", onCancel);
  preview.append(copy, cancel);
  return preview;
}

export function createReplyQuote(message, onClick) {
  const quote = document.createElement("button");
  quote.className = "message-reply-quote";
  quote.type = "button";
  quote.setAttribute("aria-label", "Jump to the original message");
  const author = document.createElement("strong");
  author.textContent = message.profiles?.display_name || "NEXUS member";
  const body = document.createElement("span");
  body.textContent = message.body || "Original message unavailable";
  quote.append(author, body);
  quote.addEventListener("click", onClick);
  return quote;
}

export async function loadReplyTargets(supabase, table, senderRelation, messages) {
  const ids = [...new Set(messages.map((message) => message.reply_to_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from(table)
    .select(`id,body,sender_id,profiles!${senderRelation}(display_name)`)
    .in("id", ids);
  if (error) throw error;
  return new Map((data || []).map((message) => [message.id, message]));
}
