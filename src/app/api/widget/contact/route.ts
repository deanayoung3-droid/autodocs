import { markHandoff, visitorId } from "@/lib/analytics";
import { get } from "@/lib/db";
import { emit } from "@/lib/events";
import { mailerReady, sendMail } from "@/lib/mailer";
import { getWidget } from "@/lib/widgets";

// The widget's contact form. Messages go to the support address set in the widget's Contact
// panel, with Reply-To set to the customer so your team answers them directly.

const recent = new Map<string, number[]>();
/** Five messages per visitor per ten minutes, per server instance. */
function allowed(visitor: string): boolean {
  const now = Date.now();
  const times = (recent.get(visitor) ?? []).filter((t) => now - t < 10 * 60_000);
  if (times.length >= 5) return false;
  recent.set(visitor, [...times, now]);
  if (recent.size > 5000) recent.clear();
  return true;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "");

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send the form as JSON." }, { status: 400 });
  }
  const widget = await getWidget(Number(body.widget));
  if (!widget || widget.settings.contactMethod !== "form" || !widget.settings.contactEmail) {
    return Response.json({ error: "This widget doesn't take messages." }, { status: 404 });
  }
  const name = clean(body.name, 80);
  const email = clean(body.email, 200).toLowerCase();
  const message = clean(body.message, 5000);
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: "Enter your name and a valid email." }, { status: 400 });
  if (message.length < 5) return Response.json({ error: "Tell us a little more." }, { status: 400 });
  if (!allowed(visitorId(req.headers))) return Response.json({ error: "You've sent several messages already. Try again in a few minutes." }, { status: 429 });
  if (!(await mailerReady())) return Response.json({ error: "Messages can't be sent right now. Try again later." }, { status: 503 });

  const conversation = Number(body.conversation) || null;
  const asked = conversation ? await get<{ question: string }>("SELECT question FROM ai_conversations WHERE id = $1", [conversation]) : undefined;
  await sendMail({
    to: widget.settings.contactEmail,
    replyTo: `${name.replace(/[<>"\n]/g, "")} <${email}>`,
    subject: `Help widget: message from ${name}`,
    text: `${message}\n\n—\nFrom ${name} <${email}> through the help widget (${widget.name}).${asked ? `\nThey first asked the AI assistant: "${asked.question}"` : ""}\nReply to this email to answer them.`,
  });
  if (conversation) await markHandoff(conversation);
  emit("contact.submitted", { widget: widget.id, name, email, message, conversation });
  return Response.json({ sent: true });
}
