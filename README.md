# 🤖 AutoReport AI — Mobile & Web Daily Work Automation

A lightweight, cloud-deployable, mobile-responsive Web App and API that enhances daily work logs and developer commits using AI (`gpt-4o-mini`) and schedules them for delivery via WhatsApp or Telegram with real-time **START / STOP** controls.

---

## 🌟 Key Features

- 📱 **Mobile & Laptop Responsive Dashboard**: Modern, glassmorphism UI built with Tailwind CSS, touch-friendly inputs, live countdowns, and dark mode aesthetics.
- ⚡ **Master Toggle Switch (START / STOP)**: Instantly pause or resume automation dispatches with 1 click. If set to STOP, scheduled jobs exit gracefully without sending.
- 🧠 **AI Text Enhancement Engine (OpenAI `gpt-4o-mini`)**:
  - Transforms raw bullet points, Hinglish/English notes, or Git commits into an executive progress report.
  - Formats into: 🚀 *Key Accomplishments*, 📊 *Progress & Metrics*, ⏩ *Next Steps*, and ⚠️ *Blockers & Dependencies*.
  - Strict length constraint (< 200 words) with real-time word counter.
- ⏰ **Dynamic Task Scheduler (`node-cron`)**: Configure daily dispatch times (e.g. 06:00 PM) and frequencies (Weekdays Mon-Fri, Every Day). Changes take effect instantly without restarting the server.
- 📬 **Dual Dispatcher (WhatsApp + Cloud Telegram)**:
  - **WhatsApp**: Uses `whatsapp-web.js` with local session persistence (`.wwebjs_auth`).
  - **Telegram Bot API**: 100% cloud-native, 0MB extra RAM, requires no browser, works seamlessly on Render/Railway free tiers!
  - **Console Mock**: For testing without sending real messages.
- 💾 **Persistent State**: Scheduler state, toggle status, and dispatch history survive server reboots (`data/app_state.json`).
- 🚀 **Cloud Deployment Ready**: Includes production `Dockerfile` and `render.yaml` for 1-click deployment on Render, Railway, Fly.io, or VPS.

---

## 📂 Project Architecture

```
automationtool/
├── public/               # Mobile & Laptop Web Dashboard
│   ├── index.html        # Responsive frontend UI
│   ├── app.js            # Reactive state, API triggers & toasts
│   └── styles.css        # Glassmorphism, animations & scrollbars
├── data/                 # Persistent state & execution history (auto-created)
│   └── app_state.json
├── server.js             # Express REST API & dynamic scheduler
├── dispatcher.js         # Master switch checker & multi-channel routing (WhatsApp/Telegram)
├── analyzer.js           # OpenAI GPT-4o-mini executive report generator
├── logger.js             # Work log ingestion (Markdown + Git commits)
├── whatsapp.js           # WhatsApp Web driver & QR code engine
├── store.js              # Persistent state management
├── index.js              # Application entrypoint & HTTP server
├── work_log.md           # Sample local markdown work notes
├── Dockerfile            # Container definition with Chromium
├── render.yaml           # 1-Click Render configuration
├── package.json          # Dependencies & scripts
└── .env.example          # Environment template
```

---

## 🛠️ REST API Specification

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Returns current state, active schedule, channel, and logs |
| `POST` | `/api/toggle` | Toggle Master switch (`{ isEnabled: true/false }`) |
| `POST` | `/api/preview` | Real-time AI enhancement of `{ rawText }` |
| `POST` | `/api/schedule` | Update dispatch time, days, recipient, and channel |
| `POST` | `/api/send-now` | Instantly dispatch report draft to recipient |
| `POST` | `/api/work-log/load` | Load today's `work_log.md` notes and Git commits |
| `GET` | `/api/logs` | Retrieve recent dispatch history |

---

## 🚀 Quick Start (Local Setup)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your credentials:
```env
PORT=3000
OPENAI_API_KEY=sk-proj-your-api-key-here
OPENAI_MODEL=gpt-4o-mini

# Dispatch Options
DEFAULT_DISPATCH_CHANNEL=whatsapp
TARGET_PHONE_NUMBER=919876543210

# Telegram Bot (Optional - for cloud deployment)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
TELEGRAM_CHAT_ID=123456789
```

### 3. Launch Dashboard & Server
```bash
npm start
```
Open **`http://localhost:3000`** on your laptop or mobile browser (using your laptop's local IP, e.g. `http://192.168.1.x:3000`).

---

## ☁️ Cloud Deployment (Render / Railway / Replit)

### Option A: Telegram Mode on Render / Railway (Recommended for Free Tiers)
Free cloud tiers offer 512MB RAM, which is ideal for the **Telegram Bot** driver (0 extra RAM overhead):
1. Push this repository to GitHub.
2. In Render / Railway, create a new **Web Service** from your repository.
3. Set environment variables:
   - `OPENAI_API_KEY`: Your OpenAI key
   - `DEFAULT_DISPATCH_CHANNEL`: `telegram`
   - `ENABLE_WHATSAPP`: `false`
   - `TELEGRAM_BOT_TOKEN`: Token from [@BotFather](https://t.me/botfather)
   - `TELEGRAM_CHAT_ID`: Your chat ID from [@userinfobot](https://t.me/userinfobot)
4. Your dashboard will be live at `https://your-app.onrender.com`!

### Option B: Docker Deployment with WhatsApp Web
If you wish to use WhatsApp Web in cloud containers:
```bash
docker build -t autoreport-ai .
docker run -p 3000:3000 --env-file .env autoreport-ai
```

---

## 📱 Mobile Dashboard Walkthrough

1. **Top Bar**: Shows live status (`ACTIVE` vs `PAUSED`) and instant Master Toggle button.
2. **Step 1 (Input)**: Click **"Load File / Git"** or type raw work notes. Pick time (e.g. `18:00`), frequency, and recipient.
3. **Step 2 (AI Enhance)**: Tap **"Enhance with AI"** to see real-time output preview formatted in crisp WhatsApp/Telegram markdown under 200 words.
4. **Step 3 (Dispatch / Schedule)**:
   - Click **"Save & Schedule"** to lock in the automatic daily dispatch.
   - Click **"Send Test Now"** to verify delivery immediately.
