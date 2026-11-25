# Demo video script (about 3 minutes)

## Before you record (5 minutes)

1. Close other apps and browser tabs. Use one browser window, set to 1280x720 if you can (smaller means a smaller, lighter recording).
2. Use the demo calendar so the data is the same every time: `USE_MOCK=true` in `backend/.env`, then run backend and frontend.
3. Open http://localhost:3000, click **Reset demo**, and make sure the **Briefing** tab is open.
4. Clear the recent-request chip so the bottom bar looks clean: browser console, `localStorage.removeItem("tenx.recents")`, then refresh.
5. Do one dry run of the whole script. The first run is always slower.
6. Recording: Windows Game Bar (Win+G), 720p, 30 fps or lower. Record in 3 or 4 short clips, one per section, and join them in Clipchamp if needed.

## Script (say the quoted lines; they are written to be read out loud)

### 1. The idea (0:00 - 0:20)
*Screen: the Briefing tab and the calendar.*
> "A manager's week fills up with other people's invites. tenxcalender is a calendar you talk to. The AI plans the change and shows it on the calendar, and nothing is written until I approve it."

### 2. Say what you need (0:20 - 1:05)
*Click into the bottom bar.*
- Type: **Find 45 min with Priya and Sam this week, not mornings** and press Enter.
> "I just state the intent. The AI checks everyone's availability and proposes a slot."
- Point at the dashed ghost event on the calendar, the reason on the card, and **Other options**. Click one to swap it.
> "The new meeting is a dashed ghost. It is not on my calendar yet."
- Open **How I got this**.
> "I can see what it looked at. The maths of finding a free slot is done by code, not guessed by the model."
- Click **Apply 1 change**.
> "Now it is real."

### 3. It watches my week (1:05 - 2:00)
*Open the Briefing tab.*
> "The app also acts on its own. It reads my week and flags problems."
- Point at the heavy Wednesday bar and the summary.
- On the "Partner check-in lands on your focus time" card, click **Decline "Partner check-in"**.
> "A new invite landed on my protected focus time. One click loads a fix, and again it is only a preview."
- Show the struck-through event, then click **Apply**.
- On the double-booking card, click **Shorten** and show the hatched tail. Apply.

### 4. Asking when it is unsure (2:00 - 2:25)
- Type: **book a meeting with ujjawal on Saturday**.
> "If something is unclear, it asks instead of guessing, and I can answer with one click."
- Click one of the suggested replies. Show the new plan.

### 5. Undo and rules (2:25 - 2:50)
- Open **History**. 
> "Everything I approved is listed, and the newest change can be undone."
- Click **Undo**, confirm, and show the calendar changing back.
- Open **Rules**.
> "These are my standing preferences, like working hours, lunch and focus time. The planner follows them."

### 6. Close (2:50 - 3:10)
> "The model only proposes. Code does the scheduling maths, and the server checks every change before it is applied. Next I would add meeting prep and team scheduling. Thank you."

## If something goes wrong while recording
- The planner says the API key is missing: check `ANTHROPIC_API_KEY` in `backend/.env`, then restart the backend.
- The calendar looks different from this script: click **Reset demo** and start the section again. Clips can be joined later.
- Do not apologise on camera. Stop, reset, and re-record that clip.

## Backup prompts
- "Protect 2 hours of focus time every day this week" (or use the **Protect focus time this week** button)
- "Create a 30 minute meeting this Friday afternoon with a Meet link" (Google mode)
- After a plan appears: "make it Thursday"
