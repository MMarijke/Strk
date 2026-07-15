import { Reaction } from '@/api/entities';

const DAILY_LIMIT = 3;

function getTodayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function getReactionsSentToday(userEmail) {
  try {
    const today = getTodayKey();
    const reactions = await Reaction.filter({
      sender_email: userEmail, 
    }, "-created_date");
    return reactions.filter(r => r.created_date && r.created_date.startsWith(today)).length;
  } catch {
    return 0;
  }
}

export async function canSendReaction(userEmail) {
  const sent = await getReactionsSentToday(userEmail);
  return sent < DAILY_LIMIT;
}

export async function reactionsRemainingToday(userEmail) {
  const sent = await getReactionsSentToday(userEmail);
  return Math.max(DAILY_LIMIT - sent, 0);
}

export async function sendReaction({
  senderEmail, 
  senderName,
  recipientEmail,
  recipientName,
  emoji,
  groupId,
}) {
  // Check limit before sending
  const allowed = await canSendReaction(senderEmail);
  if (!allowed) {
    throw new Error('Daily reaction limit reached');
  }

  // Save to database
  await Reaction.create({
    sender_email: senderEmail,
    sender_name: senderName,
    recipient_email: recipientEmail,
    recipient_name: recipientName,
    emoji,
    group_id: groupId,
    read: false,
  });

  // Fire browser notification if permission granted
  sendReactionNotification(senderName, emoji, recipientName);
}

export function sendReactionNotification(senderName, emoji, recipientName) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(`${senderName} sent you a ${emoji}`, {
      body: "Keep your streak alive!",
      icon: "/favicon.ico",
    });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        new Notification(`${senderName} sent you a ${emoji}`, {
          body: "Keep your streak alive!",
          icon: "/favicon.ico",
        });
      }
    });
  }
}