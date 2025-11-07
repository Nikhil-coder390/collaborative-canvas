# 🎨 Real-Time Collaborative Drawing Canvas

## 📋 Overview
A **multi-user real-time drawing application** built using **vanilla JavaScript** (no frameworks) and **Node.js with WebSockets (Socket.io)**.

Multiple users can draw on the same shared canvas simultaneously, see each other’s drawings and cursors in real time, and perform global undo operations.

---

## ⚙️ Tech Stack

- **Frontend:** HTML5 Canvas + Vanilla JavaScript + CSS  
- **Backend:** Node.js + Express + Socket.io  
- **Communication:** WebSocket (bidirectional real-time events)

---

## 🚀 Setup Instructions

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/collaborative-canvas.git
cd collaborative-canvas

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

---

### Then open your browser at:
👉 http://localhost:3000

---

## 🧠 How to Test with Multiple Users

1. Run ```npm start```.
   
2. Open ```http://localhost:3000``` in two or more browser tabs (or devices).
   
3. Enter different names and colors.
   
4. Start drawing on one tab — strokes appear in real time on all others.
   
5. Use the Eraser tool to erase parts of the canvas.
   
6. Use the Undo button ```(or Ctrl + Z)``` to remove the last global stroke (LIFO — affects all users).
   
7. Observe live cursor positions and the online user list update as users join/leave.
   
8. Open a new tab — it loads the full drawing history automatically.

---

## 🧩 Features

- ✏️ Brush & Eraser Tools

- 🎨 Color Picker & Stroke Width Control

- ⚡ Real-Time Drawing Synchronization

- 👥 Online User List & Live Cursors

- 🔄 Global Undo (LIFO) — synchronized across all clients

- 📜 Automatic History Sync for late joiners

- 🧰 Local Prediction + Batching for smooth performance

---

## 🪲 Known Limitations / Bugs

- No database persistence (canvas resets if server restarts).

- Only global undo implemented (redo optional).

- Local “Clear” triggers many undos (demo-only behavior).

- No authentication (open access demo).

- Favicon missing → browser may log favicon.ico 404 (safe to ignore).

---

## 📦 Folder Structure

```bash
collaborative-canvas/
├── client/
│   ├── index.html        # Canvas UI
│   ├── style.css         # Styling
│   └── main.js           # Core frontend logic
├── server/
│   ├── index.js          # Express + Socket.io backend
│   └── rooms.js          # Room & operation manager
├── package.json
├── README.md
└── ARCHITECTURE.md
```

---

**End of README.md**  
*Prepared by:* **Nikhil Venkata Satya Sai Sundaraneedi**  
Final Year B.Tech CSE | Full Stack Developer | AWS Certified Cloud Practitioner