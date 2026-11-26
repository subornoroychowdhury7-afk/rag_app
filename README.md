# DocQ&A — Your Honest Reading Buddy 📚✨

Imagine you have a giant pile of papers, homework, receipts, or PDFs, and you wish a smart friend could read them all in two seconds and answer your questions **without ever making things up**.

**That is DocQ&A!**

You give DocQ&A a file, ask a question in plain English (or with your microphone!), and it reads **only your files** to give you an answer — and shows you the **exact paragraphs** where it found the answer. If your answer is *not* in your files, DocQ&A honestly says:
> *"I cannot answer this based on the uploaded documents."*

No account, no sign-up, and no guessing.

---

## 🌐 Try It Right Now (No Install Needed!)

| What it is | Link |
|---|---|
| **The Website (Frontend)** | https://rag-app-three-tau.vercel.app/ |
| **The Brain Behind the Scenes (Backend)** | https://rag-app-1-rqg6.onrender.com |
| **Interactive API Menu** | https://rag-app-1-rqg6.onrender.com/docs |

> **Small note:** Because the backend sleeps on a free server when nobody visits for a while, your very first click might take ~30 seconds to wake it up. After that, it is fast!

---

## 🧩 How DocQ&A Works (In 4 Simple Steps)

Think of DocQ&A like a careful librarian helping you with an open-book quiz:

1. **You hand over a file** (PDF, `.txt`, or `.md`, up to 20 MB).
2. **The librarian cuts it into bite-sized sticky notes** (about 1,800 letters each, with a little overlap so no sentence gets sliced in half) and puts them in a smart filing cabinet (**ChromaDB**). Even if your PDF is a scanned photo of a paper, **Tesseract OCR** reads the words off the picture!
3. **You ask a question.** DocQ&A looks through the sticky notes, grabs the top 12 best matches, and checks if they actually match closely enough.
4. **You get a neat, honest answer** with:
   - The **step-by-step thinking** (`Thinking Process & Verification`)
   - **Pretty math equations** (fractions, roots, formulas)
   - **Proof cards** showing the exact quote and match score (%)
   - **Follow-up ideas** you can click next
   - **Voice tools**: speak into your mic, or click to hear the answer read out loud!

---

## 🛠️ What We Recently Upgraded (Making It Production-Ready!)

We reorganized and upgraded DocQ&A using top-company software engineering practices so it is **safer, cleaner, harder to break, and much nicer to use**. Here is every single change explained simply:

### 1. Cleaned Up a Messy Room Into Neat Drawers (Clean Architecture)
- **Before:** Almost all the backend brain lived inside one huge 899-line file (`backend/main.py`). Finding or fixing one piece was like digging through a single giant toy box.
- **Now:** Everything has its own neat labeled drawer inside `backend/app/`:
  - `config.py` — **The Settings Notebook:** keeps all knobs and rules in one tidy place.
  - `schemas.py` — **The Forms:** checks that every question and reply has the exact right shape.
  - `services/document_processor.py` — **The Paper Shredder & Scanner:** checks files, reads PDFs/scans, and makes sticky notes.
  - `services/vector_store.py` — **The Filing Cabinet:** saves, searches, lists, and deletes sticky notes in ChromaDB.
  - `services/llm_client.py` — **The Phone Line to Gemini AI:** talks to Google Gemini and politely retries if the line is busy.
  - `services/rag_service.py` — **The Librarian Brain:** connects your follow-up questions, picks matching notes, checks honesty, and writes summaries.
  - `main.py` — **The Front Desk:** greets visitors and hands each request to the right helper.

### 2. Built Stronger Locks & Bouncers (Security & Safety)
- **Checking IDs at the door (Real File Check):** Before, someone could rename a fake text or junk file to `homework.pdf` and sneak it in. Now DocQ&A peeks inside the file for a real `%PDF-` stamp (and blocks hidden binary junk inside `.txt`/`.md` files).
- **Speed limit for crowds (Rate Limiter):** Added a fair waiting rule (`60` heavy requests per minute per visitor) in `middleware.py` so nobody can spam the server and drain the AI budget. If someone asks too fast, it politely says *"Please wait"* (`429`) and tells them when to try again.
- **Safety shields on every reply:** Every message sent back includes web security shields (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) and fixes cross-site sharing rules (`CORS`) properly.
- **Safer Docker shipping box:** The backend container in `backend/Dockerfile` no longer runs as the all-powerful `root` user—it runs as a regular locked-down helper (`appuser`) and checks its own pulse (`HEALTHCHECK`).

### 3. Better Health Checks & Tracking Stamps (Observability)
- **Receipt stamps on every request:** Every request gets a unique tracking number (`X-Request-ID`) and a stopwatch timer (`X-Process-Time-Ms`) so engineers can trace any problem in seconds.
- **Real heartbeat check:** `/health` now actually knocks on the filing cabinet (ChromaDB) to make sure it is awake (`vector_store_ready`), and `/ready` checks that both the filing cabinet AND the AI key are ready to serve.

### 4. Made the Website Harder to Break & Nicer to Use (Frontend Upgrades)
- **Remembers your chat (`localStorage`):** Refreshing the browser tab used to erase your conversation. Now your chat stays saved on your device until you press **Clear**.
- **Added a "Stop" button & timeouts:** Before, a stuck request could spin forever. Now every request has a safety timer (`AbortController`), and while DocQ&A is thinking, you can click **Stop** anytime—or close a summary window without wasted background work.
- **Friendly warnings instead of scary pop-ups:** Replaced harsh browser `alert()` pop-ups (for mic/speaker support) with a soft, dismissible banner right above the typing box.
- **Warning note on super long summaries:** Summaries read up to the first 40,000 letters of a file. If your file is bigger than that, `SummaryModal` now shows a clear yellow note telling you!
- **Safety net screen (`error.tsx`):** If anything unexpected crashes the screen, you get a clean **Try Again / Reload App** card instead of a blank white page.
- **Clean house:** Removed unused hidden upload code in `page.tsx` and updated the landing page's proof badges so they point to the real new backend folders.

### 5. Robot Inspectors Before Opening the Shop (Tests & CI/CD Gates)
- **Before:** Pushing new code immediately updated the live website without running tests first!
- **Now:**
  - We expanded backend tests from **12 to 25 automated checks** (`backend/test_api.py` + `backend/test_services.py`) testing fake PDFs, rate limits, security shields, full upload-ask-summarize-delete flows, and strict *"I don't know"* honesty.
  - Added `.github/workflows/ci.yml` for pull requests and updated `.github/workflows/deploy.yml` so **nothing deploys to GitHub Pages, Docker/GHCR, Render, or Vercel unless all 25 backend tests, TypeScript checks, ESLint, and Next.js builds pass 100%**.
- Also added [ENGINEERING_ROADMAP.md](ENGINEERING_ROADMAP.md) showing what we finished and future upgrades (live word-by-word streaming, background workers, multi-user accounts, and accuracy scoreboards).

---

## ✨ Everyday Features at a Glance

- **4 Ways to Ask:** Switch between **Detailed**, **Concise**, **Academic**, and **Step-by-Step** answers.
- **Single-File Focus:** Click any uploaded document in the left sidebar to make DocQ&A search *only* inside that one file.
- **1-Click Executive Summary:** Click **Summary** next to any document for an instant 4-part briefing (Overview, Highlights, Takeaways, Next Questions) you can copy or download as `.md`.
- **Voice Support:** Tap the microphone button to speak your question, or tap the speaker icon to listen to an answer.
- **Save Your Chat:** Click **Export Chat** to download the whole conversation, thinking logs, and quotes into a neat file.
- **Light & Dark Mode:** Easy on the eyes day or night.

---

## 🗺️ Folder Map (Where Everything Lives)

```text
rag-app/
├── ENGINEERING_ROADMAP.md        # Full engineering plan (completed + future phases)
├── README.md                     # This plain-English guide
├── render.yaml                   # Instructions for hosting the backend on Render
├── .github/workflows/
│   ├── ci.yml                    # Runs safety tests on pull requests
│   └── deploy.yml                # Runs all tests first, then deploys live sites
├── backend/                      # The Python brain (FastAPI + Gemini + ChromaDB)
│   ├── main.py                   # Front desk & route connections
│   ├── app/
│   │   ├── config.py             # Central settings & limits
│   │   ├── schemas.py            # Input/output data shapes
│   │   ├── middleware.py         # Request IDs, security headers, rate limiter
│   │   └── services/
│   │       ├── document_processor.py  # File validation, PDF/OCR reading, chunking
│   │       ├── vector_store.py        # ChromaDB storage & search
│   │       ├── llm_client.py          # Gemini AI client with retries & fallback
│   │       └── rag_service.py         # Question rewriting, matching, summaries
│   ├── test_api.py               # API & end-to-end tests
│   ├── test_services.py          # Unit tests for services & security controls
│   ├── Dockerfile                # Locked-down non-root container + healthcheck
│   ├── requirements.txt          # Python libraries list
│   └── .env.example              # Sample secret/settings template
└── frontend/                     # The Website (Next.js 16 + React 19 + Tailwind)
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx          # Main app shell (Landing ↔ Workspace)
    │   │   ├── error.tsx         # Friendly crash recovery screen
    │   │   └── layout.tsx        # Page title, icons, and math styles
    │   ├── components/
    │   │   ├── LandingView.tsx   # Welcome page & interactive feature demos
    │   │   ├── Header.tsx        # Top bar & Light/Dark switch
    │   │   ├── Sidebar.tsx       # Upload box & document list
    │   │   ├── Chat.tsx          # Conversation screen, Stop button & voice tools
    │   │   ├── SummaryModal.tsx  # Pop-up executive summary viewer
    │   │   └── MarkdownRenderer.tsx # Formats headings, tables, code & math
    │   └── lib/
    │       └── api.ts            # Talks to the backend with safety timeouts
    ├── next.config.ts            # Build settings (supports Vercel & GitHub Pages)
    └── package.json              # Website libraries list
```

---

## 💻 How to Run It on Your Own Computer (For Developers)

You will need **Python 3.12**, **Node.js 20+**, and a free [Google Gemini API key](https://ai.google.dev/gemini-api/docs/api-key). *(Optional: install Tesseract OCR if you want it to read scanned image PDFs locally.)*

### 1. Start the Backend (The Brain)

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env    # Open .env and paste your real GEMINI_API_KEY
uvicorn main:app --reload
```

Backend runs at `http://localhost:8000` (interactive docs at `http://localhost:8000/docs`).

### 2. Start the Frontend (The Website)

Open a second terminal:

```powershell
cd frontend
npm install
```

Create a file called `frontend/.env.local` with:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Then start the site:

```powershell
npm run dev
```

Open `http://localhost:3000` in your browser!

---

## ⚙️ Settings You Can Adjust (`backend/.env`)

| Setting | Default | Plain-English Meaning |
|---|---|---|
| `GEMINI_API_KEY` | *(required)* | Your secret key to use Google Gemini AI |
| `EMBEDDING_MODEL` | `models/gemini-embedding-2` | Model that turns text into searchable numbers (768 dimensions) |
| `GENERATION_MODEL` | `gemini-3.8-flash` | Smart model that writes answers and summaries |
| `CHUNK_SIZE` | `1800` | How many letters go on each sticky note |
| `CHUNK_OVERLAP` | `300` | Shared letters between notes so sentences stay connected |
| `MAX_DISTANCE` | `0.78` | How strict the match check is before refusing to guess |
| `TOP_K` | `12` | Maximum matching passages sent to the AI per question |
| `MAX_UPLOAD_MB` | `20` | Biggest file size allowed (in megabytes) |
| `ALLOWED_ORIGINS` | `*` | Which website addresses are allowed to talk to the backend |
| `RATE_LIMIT_ENABLED` | `true` | Turn the anti-spam speed limit on or off |
| `RATE_LIMIT_REQUESTS` | `60` | Max heavy requests allowed per time window |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Length of the rate-limit time window (in seconds) |
| `CHROMA_PATH` | `./chroma_db` | Folder where your local filing cabinet is saved |
| `CHROMA_API_KEY` | *(optional)* | Set along with `CHROMA_TENANT` & `CHROMA_DATABASE` to use Chroma Cloud |

---

## 🔌 Backend Doors (API Endpoints)

| Door | Address | What It Does |
|---|---|---|
| `GET` | `/health` | Checks if the server and ChromaDB filing cabinet are awake |
| `GET` | `/ready` | Strict check: confirms both ChromaDB and Gemini key are configured |
| `GET` | `/documents` | Lists all uploaded files and how many chunks each has |
| `POST` | `/upload` | Checks a PDF/TXT/MD file, reads it, slices it, and stores it |
| `POST` | `/chat` | Answers a question using your files (with citations & follow-ups) |
| `POST` | `/documents/{filename}/summarize` | Writes a 4-part executive summary of a file |
| `DELETE` | `/documents/{filename}` | Erases a file and all its chunks from memory |

---

## 🧪 Running the Safety Tests Yourself

**Backend (25 tests):**
```powershell
cd backend
.\venv\Scripts\pytest -v
```

**Frontend checks:**
```powershell
cd frontend
npx tsc --noEmit
npm run lint
npm run build
```

---

> **Golden Rule:** Never upload or share your real `GEMINI_API_KEY`, `.env` files, or private `chroma_db/` folder to GitHub.
