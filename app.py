import os
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, jsonify, request, session
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash

from ai_provider import answer_question

load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "development-only-change-me")
CORS(app, supports_credentials=True, origins=os.getenv("FRONTEND_ORIGIN", "http://localhost:5173"))

DB_PATH = os.getenv("DATABASE_PATH", "iraq_study.db")
OWNER_USERNAME = os.getenv("OWNER_USERNAME", "owner").strip()
OWNER_PASSWORD = os.getenv("OWNER_PASSWORD", "")

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as con:
        con.execute("""CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            premium_until TEXT
        )""")
        con.execute("""CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )""")
        # Ensure the configured owner exists and can log in. Password is never stored in plaintext.
        if OWNER_PASSWORD:
            row = con.execute("SELECT id FROM users WHERE username=?", (OWNER_USERNAME,)).fetchone()
            if row:
                con.execute("UPDATE users SET password_hash=?, role='owner' WHERE username=?",
                            (generate_password_hash(OWNER_PASSWORD), OWNER_USERNAME))
            else:
                con.execute("INSERT INTO users(username,password_hash,role) VALUES(?,?, 'owner')",
                            (OWNER_USERNAME, generate_password_hash(OWNER_PASSWORD)))

def now_utc():
    return datetime.now(timezone.utc)

def log_action(username, action, details=""):
    with db() as con:
        con.execute("INSERT INTO activity(username,action,details,created_at) VALUES(?,?,?,?)",
                    (username, action, details, now_utc().isoformat()))

def user_payload(row):
    until = row["premium_until"]
    active = False
    if until:
        try:
            active = datetime.fromisoformat(until) > now_utc()
        except ValueError:
            active = False
    return {"username": row["username"], "role": row["role"],
            "premium": active, "premium_until": until}

def current_user():
    username = session.get("username")
    if not username:
        return None
    with db() as con:
        return con.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()

def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"error": "سجّل الدخول أولاً"}), 401
        return fn(*args, **kwargs)
    return wrapper

def owner_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user or user["role"] != "owner":
            return jsonify({"error": "هذه الميزة للمالك فقط"}), 403
        return fn(*args, **kwargs)
    return wrapper

@app.get("/api/health")
def health():
    return jsonify({"ok": True, "app": "iraq study .ai"})

@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    if len(username) < 3 or len(username) > 32:
        return jsonify({"error": "اسم المستخدم يجب أن يكون من 3 إلى 32 حرفاً"}), 400
    if len(password) < 8:
        return jsonify({"error": "كلمة المرور يجب أن تكون 8 أحرف على الأقل"}), 400
    if username.lower() == OWNER_USERNAME.lower():
        return jsonify({"error": "اسم المستخدم محجوز"}), 409
    try:
        with db() as con:
            con.execute("INSERT INTO users(username,password_hash,role) VALUES(?,?, 'user')",
                        (username, generate_password_hash(password)))
    except sqlite3.IntegrityError:
        return jsonify({"error": "اسم المستخدم مستخدم مسبقاً"}), 409
    log_action(username, "register")
    return jsonify({"ok": True, "message": "تم إنشاء الحساب"})

@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    with db() as con:
        row = con.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"error": "اسم المستخدم أو كلمة المرور غير صحيحة"}), 401
    session.clear()
    session["username"] = row["username"]
    log_action(username, "login")
    return jsonify({"ok": True, "user": user_payload(row)})

@app.post("/api/logout")
def logout():
    username = session.get("username", "unknown")
    session.clear()
    log_action(username, "logout")
    return jsonify({"ok": True})

@app.get("/api/me")
@login_required
def me():
    row = current_user()
    return jsonify({"user": user_payload(row)})

@app.post("/api/ask")
@login_required
def ask():
    data = request.get_json(silent=True) or {}
    question = str(data.get("question", "")).strip()
    grade = str(data.get("grade", "")).strip()
    subject = str(data.get("subject", "")).strip()
    if not question:
        return jsonify({"error": "اكتب السؤال أولاً"}), 400
    if len(question) > 12000:
        return jsonify({"error": "السؤال طويل جداً"}), 400
    result = answer_question(question, grade, subject)
    log_action(session["username"], "ask", f"subject={subject}; grade={grade}")
    return jsonify(result)

@app.post("/api/premium/image-question")
@login_required
def image_question():
    row = current_user()
    payload = user_payload(row)
    if not payload["premium"]:
        return jsonify({"error": "ميزة تصوير الأسئلة متاحة لأعضاء Premium فقط"}), 403
    # Upload/image parsing is intentionally not implemented until an image-capable provider is chosen.
    return jsonify({"error": "تم تفعيل صلاحية Premium، لكن ربط تحليل الصور يحتاج إعداد مزود الذكاء الاصطناعي."}), 501

@app.get("/api/owner/users")
@login_required
@owner_required
def owner_users():
    with db() as con:
        rows = con.execute("SELECT username,role,premium_until FROM users ORDER BY id DESC").fetchall()
    users = []
    for row in rows:
        item = dict(row)
        item["premium"] = user_payload(row)["premium"]
        users.append(item)
    return jsonify({"users": users})

@app.post("/api/owner/premium")
@login_required
@owner_required
def set_premium():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    action = data.get("action", "grant")
    if not username or username == OWNER_USERNAME:
        return jsonify({"error": "حدد حساب مستخدم صالحاً"}), 400
    with db() as con:
        target = con.execute("SELECT username FROM users WHERE username=?", (username,)).fetchone()
        if not target:
            return jsonify({"error": "الحساب غير موجود"}), 404
        if action == "revoke":
            con.execute("UPDATE users SET premium_until=NULL WHERE username=?", (username,))
            log_action(session["username"], "premium_revoke", username)
            return jsonify({"ok": True, "message": "تم سحب Premium"})
        try:
            days = int(data.get("days", 30))
        except (TypeError, ValueError):
            return jsonify({"error": "عدد الأيام غير صحيح"}), 400
        if days < 1 or days > 3650:
            return jsonify({"error": "المدة يجب أن تكون بين يوم و3650 يوماً"}), 400
        until = (now_utc() + timedelta(days=days)).isoformat()
        con.execute("UPDATE users SET premium_until=? WHERE username=?", (until, username))
    log_action(session["username"], "premium_grant", f"{username}; days={days}")
    return jsonify({"ok": True, "message": f"تم منح Premium لمدة {days} يوم", "premium_until": until})

@app.get("/api/owner/activity")
@login_required
@owner_required
def owner_activity():
    with db() as con:
        rows = con.execute("SELECT username,action,details,created_at FROM activity ORDER BY id DESC LIMIT 200").fetchall()
    return jsonify({"activity": [dict(r) for r in rows]})

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
