export const publicPages = [
  { path: "/", label: "Home", title: "BillionTalks | Free Online Meetings for Teams and Startups", description: "Connect your team with BillionTalks. Create a free account, schedule online meetings, share links and collaborate in one simple workspace.", heading: "Meet Your Team for Free.", intro: "Big ideas begin with conversations. BillionTalks makes it easier for individuals and growing teams to plan meetings, bring people together and connect." },
  { path: "/about", label: "About", title: "About BillionTalks | Connecting People, Building Better Conversations", description: "Discover the vision behind BillionTalks and our commitment to making meaningful online conversations accessible to growing teams worldwide.", heading: "Connecting People. Building Better Conversations.", intro: "Every idea, partnership and opportunity begins when people connect. We believe technology should bring people closer to the conversation, not get in the way." },
  { path: "/how-it-works", label: "How It Works", title: "How BillionTalks Works | Start and Schedule Online Meetings", description: "Learn how to create an account, start or schedule a meeting, share a meeting link and collaborate with BillionTalks.", heading: "How BillionTalks Works.", intro: "Bringing people together should feel simple. Here's how to get started." },
  { path: "/features", label: "Features", title: "BillionTalks Features | Meetings, Scheduling and Collaboration", description: "Explore BillionTalks online meetings, scheduling, meeting links, host approval, participant controls, in-meeting chat and screen sharing.", heading: "Everything You Need for Better Meetings.", intro: "Spend less time getting ready and more time connecting with people." },
  { path: "/solutions", label: "Solutions", title: "Free Online Meetings for Startups and Small Businesses | BillionTalks", description: "Explore ways startups, small businesses, entrepreneurs, freelancers, professionals and individuals can connect with BillionTalks.", heading: "Built for Teams of All Sizes.", intro: "Different people meet for different reasons. BillionTalks provides an approachable place to bring them together." },
  { path: "/contact", label: "Contact", title: "Contact BillionTalks | Support, Feedback and Suggestions", description: "Contact BillionTalks with questions, product feedback, technical issues, feature suggestions or business enquiries.", heading: "Your Voice Matters. Every Conversation Counts.", intro: "Questions, ideas, feedback, or support requests - choose a topic and send us the details." },
] as const;

export type PublicPage = typeof publicPages[number];

export const homeCards = [
  ["video", "Meet face to face", "Connect using online audio and video on supported browsers and devices."],
  ["calendar", "Make time to connect", "Schedule a conversation when it works for your team."],
  ["people", "Bring people together", "Share meeting links and manage who joins."],
  ["chat", "Stay in the conversation", "Exchange messages through in-meeting chat."],
  ["shield", "Stay in control", "Use meeting access and participant controls as a host."],
] as const;

export const steps = [
  ["Create your free account.", "Register and sign in to your BillionTalks workspace."],
  ["Start now or schedule ahead.", "Create a meeting when you're ready or schedule one for later."],
  ["Bring people together.", "Share a meeting link and welcome participants according to access settings."],
  ["Meet and collaborate.", "Use online meeting, chat and available host controls to connect."],
] as const;

export const features = [
  ["video", "Online audio and video", "Connect through a meeting room using supported devices and browsers. Experience depends on network and device conditions."],
  ["calendar", "Schedule your meeting", "Plan conversations ahead and start them from your workspace."],
  ["link", "Share meeting links", "Make it straightforward for others to reach the right meeting."],
  ["shield", "Host controls", "Manage participant admission and meeting access."],
  ["chat", "Meeting chat", "Share messages during the meeting."],
  ["screen", "Screen sharing", "Present what you're working on when supported by the browser and device."],
] as const;

export const audiences = [
  ["spark", "Startups", "Bring early teams together to exchange ideas, align and plan."],
  ["people", "Small businesses", "Organize check-ins, planning sessions and everyday team conversations."],
  ["bulb", "Entrepreneurs", "Turn ideas into action through clear conversations and easy meeting access."],
  ["headset", "Freelancers", "Connect with clients and collaborators through online meetings."],
  ["briefcase", "Professionals", "Schedule discussions and share meeting links."],
  ["person", "Individuals", "Gather around shared interests, projects and meaningful moments."],
] as const;
