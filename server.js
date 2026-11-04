"use strict";

const express = require("express");
const Database = require("better-sqlite3");
const crypto = require("node:crypto");
const path = require("node:path");

const app = express();
const db = new Database(path.join(__dirname, "aura.db"));
const PUBLIC = path.join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);

const MODES = {
  "1": 60000,
  "3": 180000,
  "5": 300000
};

const START_BALANCE = 100000;
const sessions = new Map();

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

// ========================================
// DATABASE
// ========================================

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'player',
  balance INTEGER NOT NULL DEFAULT 100000,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
  mode TEXT NOT NULL,
  round INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(mode, round)
);

CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  round INTEGER NOT NULL,
  choice TEXT NOT NULL,
  gross INTEGER NOT NULL,
  fee INTEGER NOT NULL,
  net INTEGER NOT NULL,
  reward INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS round_controls (
  mode TEXT NOT NULL,
  round INTEGER NOT NULL,
  choice TEXT NOT NULL,
  admin_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(mode, round)
);

CREATE TABLE IF NOT EXISTS control_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  round INTEGER NOT NULL,
  action TEXT NOT NULL,
  choice TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS simulation_results (
  mode TEXT NOT NULL,
  round INTEGER NOT NULL,
  result TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(mode, round)
);
`);

const get = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

// ========================================
// CHẾ ĐỘ VÀ KỲ XỔ
// ========================================

function validMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODES, mode);
}

function currentRound(mode, now = Date.now()) {
  return Math.floor(now / MODES[mode]);
}

function remaining(mode, now = Date.now()) {
  return MODES[mode] - now % MODES[mode];
}

function randomResult() {
  return String(crypto.randomInt(0, 10));
}

function validChoice(choice) {
  return typeof choice === "string" &&
    /^(green|red|purple|big|small|n[0-9])$/.test(choice);
}

function possibleDigits(choice) {
  const groups = {
    green: [1, 3, 7, 9],
    red: [2, 4, 6, 8],
    purple: [0, 5],
    big: [5, 6, 7, 8, 9],
    small: [0, 1, 2, 3, 4]
  };

  if (/^n[0-9]$/.test(choice)) {
    return [Number(choice[1])];
  }

  return groups[choice] || null;
}

function controlledResult(choice) {
  const options = possibleDigits(choice);

  if (!options) {
    throw Error("Lựa chọn không hợp lệ.");
  }

  return String(
    options[crypto.randomInt(0, options.length)]
  );
}

function payoutRate(choice, number) {
  if (choice === "green") {
    return [1, 3, 7, 9].includes(number)
      ? 2
      : number === 5 ? 1.5 : 0;
  }

  if (choice === "red") {
    return [2, 4, 6, 8].includes(number)
      ? 2
      : number === 0 ? 1.5 : 0;
  }

  if (choice === "purple") {
    return [0, 5].includes(number) ? 4.5 : 0;
  }

  if (choice === "big") {
    return number >= 5 ? 2 : 0;
  }

  if (choice === "small") {
    return number <= 4 ? 2 : 0;
  }

  if (/^n[0-9]$/.test(choice)) {
    return Number(choice[1]) === number ? 9 : 0;
  }

  return 0;
}

// ========================================
// TÀI KHOẢN
// ========================================

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64)
    .toString("hex");
}

function validUsername(value) {
  return typeof value === "string" &&
    /^[a-zA-Z0-9_]{3,24}$/.test(value);
}

function validPassword(value) {
  return typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128;
}

function createUser(username, password, role = "player") {
  const salt = crypto.randomBytes(16).toString("hex");

  return run(
    `INSERT INTO users
     (username,password_hash,salt,role,balance,created_at)
     VALUES(?,?,?,?,?,?)`,
    username,
    hashPassword(password, salt),
    salt,
    role,
    START_BALANCE,
    Date.now()
  );
}

const adminName = process.env.ADMIN_USER;
const adminPassword = process.env.ADMIN_PASSWORD;

if (adminName && adminPassword) {
  if (!validUsername(adminName) ||
      !validPassword(adminPassword)) {
    throw Error("ADMIN_USER hoặc ADMIN_PASSWORD không hợp lệ.");
  }

  const existing = get(
    "SELECT id FROM users WHERE username=?",
    adminName
  );

  if (!existing) {
    createUser(adminName, adminPassword, "admin");
    console.log("Đã tạo tài khoản Admin.");
  }
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    balance: user.balance,
    locked: Boolean(user.locked)
  };
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : "";

  const session = sessions.get(token);

  if (!session || session.expires < Date.now()) {
    sessions.delete(token);

    return res.status(401).json({
      error: "Vui lòng đăng nhập."
    });
  }

  const user = get(
    `SELECT id,username,role,balance,locked
     FROM users WHERE id=?`,
    session.userId
  );

  if (!user || user.locked) {
    sessions.delete(token);

    return res.status(403).json({
      error: "Tài khoản đã bị khóa."
    });
  }

  req.user = user;
  req.token = token;
  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      error: "Không có quyền Admin."
    });
  }

  next();
}

// ========================================
// ĐĂNG KÝ
// ========================================

app.post("/api/register", (req, res) => {
  const { username, password } = req.body || {};

  if (!validUsername(username) ||
      !validPassword(password)) {
    return res.status(400).json({
      error: "Tên đăng nhập 3–24 ký tự; mật khẩu ít nhất 8 ký tự."
    });
  }

  try {
    createUser(username, password);

    res.json({
      ok: true,
      message: "Đăng ký thành công."
    });
  } catch {
    res.status(409).json({
      error: "Tên đăng nhập đã tồn tại."
    });
  }
});

// ========================================
// ĐĂNG NHẬP
// ========================================

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};

  const user = typeof username === "string"
    ? get("SELECT * FROM users WHERE username=?", username)
    : null;

  if (!user || !validPassword(password)) {
    return res.status(401).json({
      error: "Sai tài khoản hoặc mật khẩu."
    });
  }

  const actual = Buffer.from(
    hashPassword(password, user.salt),
    "hex"
  );

  const expected = Buffer.from(
    user.password_hash,
    "hex"
  );

  if (actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)) {
    return res.status(401).json({
      error: "Sai tài khoản hoặc mật khẩu."
    });
  }

  if (user.locked) {
    return res.status(403).json({
      error: "Tài khoản đã bị khóa."
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  sessions.set(token, {
    userId: user.id,
    expires: Date.now() + 86400000
  });

  res.json({
    token,
    user: publicUser(user)
  });
});

app.post("/api/logout", auth, (req, res) => {
  sessions.delete(req.token);
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  res.json({
    user: publicUser(req.user)
  });
});

app.post("/api/change-password", auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};

  if (typeof oldPassword !== "string" ||
      !validPassword(newPassword)) {
    return res.status(400).json({
      error: "Mật khẩu không hợp lệ."
    });
  }

  const user = get(
    "SELECT salt,password_hash FROM users WHERE id=?",
    req.user.id
  );

  const actual = Buffer.from(
    hashPassword(oldPassword, user.salt),
    "hex"
  );

  const expected = Buffer.from(
    user.password_hash,
    "hex"
  );

  if (actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)) {
    return res.status(400).json({
      error: "Mật khẩu cũ không đúng."
    });
  }

  const salt = crypto.randomBytes(16).toString("hex");

  run(
    "UPDATE users SET salt=?,password_hash=? WHERE id=?",
    salt,
    hashPassword(newPassword, salt),
    req.user.id
  );

  sessions.delete(req.token);
  res.json({ ok: true });
});

// ========================================
// KẾT QUẢ CHÍNH THỨC (Hàm settle đã chỉnh sửa)
// ========================================

const settle = db.transaction((mode, round) => {
  if (!validMode(mode) || round >= currentRound(mode)) {
    throw Error("Phiên chưa kết thúc.");
  }

  const existing = get(
    "SELECT * FROM rounds WHERE mode=? AND round=?",
    mode,
    round
  );

  if (existing) {
    return existing;
  }

  // Kiểm tra có chỉnh sửa kết quả phiên hiện tại không
  const currentEdit = get(
    `SELECT choice FROM round_controls
     WHERE mode=? AND round=?`,
    mode,
    round
  );

  let result;
  if (currentEdit) {
    result = controlledResult(currentEdit.choice);
  } else {
    result = randomResult();
  }

  run(
    `INSERT INTO rounds
     (mode, round, result, created_at)
     VALUES (?, ?, ?, ?)`,
    mode,
    round,
    result,
    Date.now()
  );

  const number = Number(result);

  const bets = all(
    `SELECT * FROM bets
     WHERE mode=? AND round=? AND status='pending'`,
    mode,
    round
  );

  for (const bet of bets) {
    const rate = payoutRate(bet.choice, number);
    const reward = Math.round(bet.net * rate);

    run(
      "UPDATE bets SET reward=?, status=? WHERE id=?",
      reward,
      rate > 0 ? "won" : "lost",
      bet.id
    );

    if (reward > 0) {
      run(
        "UPDATE users SET balance=balance+? WHERE id=?",
        reward,
        bet.user_id
      );
    }
  }

  return get(
    "SELECT * FROM rounds WHERE mode=? AND round=?",
    mode,
    round
  );
});

// ========================================
// KẾT QUẢ MÔ PHỎNG ADMIN
// ========================================

const settleSimulation = db.transaction((mode, round) => {
  if (!validMode(mode) || round >= currentRound(mode)) {
    throw Error("Phiên mô phỏng chưa kết thúc.");
  }

  const existing = get(
    `SELECT * FROM simulation_results
     WHERE mode=? AND round=?`,
    mode,
    round
  );

  if (existing) {
    return existing;
  }

  const control = get(
    `SELECT choice FROM round_controls
     WHERE mode=? AND round=?`,
    mode,
    round
  );

  const result = control
    ? controlledResult(control.choice)
    : randomResult();

  run(
    `INSERT INTO simulation_results
     (mode,round,result,source,created_at)
     VALUES(?,?,?,?,?)`,
    mode,
    round,
    result,
    control ? "controlled" : "random",
    Date.now()
  );

  return get(
    `SELECT * FROM simulation_results
     WHERE mode=? AND round=?`,
    mode,
    round
  );
});

// ========================================
// ĐỒNG BỘ CÁC KỲ
// ========================================

function synchronize() {
  for (const mode of Object.keys(MODES)) {
    const now = currentRound(mode);

    const pending = all(
      `SELECT DISTINCT round FROM bets
       WHERE mode=? AND round<? AND status='pending'`,
      mode,
      now
    );

    for (const item of pending) {
      settle(mode, item.round);
    }

    settle(mode, now - 1);

    const simulationPending = all(
      `SELECT round FROM round_controls
       WHERE mode=? AND round<?`,
      mode,
      now
    );

    for (const item of simulationPending) {
      settleSimulation(mode, item.round);
    }

    settleSimulation(mode, now - 1);
  }

  run(
    `DELETE FROM round_controls
     WHERE (mode='1' AND round<?)
        OR (mode='3' AND round<?)
        OR (mode='5' AND round<?)`,
    currentRound("1"),
    currentRound("3"),
    currentRound("5")
  );
}

synchronize();
setInterval(synchronize, 1000);

// ========================================
// API TRÒ CHƠI
// ========================================

app.get("/api/game", auth, (req, res) => {
  synchronize();

  const mode = String(req.query.mode || "1");

  if (!validMode(mode)) {
    return res.status(400).json({
      error: "Chế độ không hợp lệ."
    });
  }

  const history = all(
    `SELECT mode,round,result FROM rounds
     WHERE mode=?
     ORDER BY round DESC
     LIMIT 100`,
    mode
  );

  const bets = all(
    `SELECT id,mode,round,choice,gross,fee,net,
     reward,status,created_at
     FROM bets
     WHERE user_id=? AND mode=?
     ORDER BY id DESC
     LIMIT 100`,
    req.user.id,
    mode
  );

  const balance = get(
    "SELECT balance FROM users WHERE id=?",
    req.user.id
  ).balance;

  res.json({
    mode,
    round: currentRound(mode),
    remainingMs: remaining(mode),
    serverTime: Date.now(),
    balance,
    history,
    bets,
    gameNotice: "AURA LUCK sử dụng Đồng AURA ảo."
  });
});

// ========================================
// ĐẶT CƯỢC
// ========================================

const placeBet = db.transaction(
  (userId, mode, round, choice, gross) => {
    if (round !== currentRound(mode) ||
        remaining(mode) <= 5000) {
      throw Error("Kỳ đã khóa dự đoán.");
    }

    const user = get(
      "SELECT balance,locked FROM users WHERE id=?",
      userId
    );

    if (!user || user.locked) {
      throw Error("Tài khoản bị khóa.");
    }

    if (user.balance < gross) {
      throw Error("Không đủ Đồng AURA.");
    }

    const opposite = choice === "big"
      ? "small"
      : choice === "small" ? "big" : null;

    if (opposite) {
      const conflict = get(
        `SELECT id FROM bets
         WHERE user_id=? AND mode=? AND round=? AND choice=?`,
        userId,
        mode,
        round,
        opposite
      );

      if (conflict) {
        throw Error("Không được chọn đồng thời Lớn và Bé.");
      }
    }

    const fee = Math.round(gross * 0.02);
    const net = gross - fee;

    run(
      "UPDATE users SET balance=balance-? WHERE id=?",
      gross,
      userId
    );

    const result = run(
      `INSERT INTO bets
       (user_id,mode,round,choice,gross,fee,net,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      userId,
      mode,
      round,
      choice,
      gross,
      fee,
      net,
      Date.now()
    );

    return {
      id: Number(result.lastInsertRowid),
      gross,
      fee,
      net
    };
  }
);

app.post("/api/bet", auth, (req, res) => {
  const { mode, round, choice, gross } = req.body || {};

  if (!validMode(mode) ||
      !validChoice(choice) ||
      !Number.isSafeInteger(round) ||
      !Number.isSafeInteger(gross) ||
      gross < 1 ||
      gross > 100000000) {
    return res.status(400).json({
      error: "Lượt dự đoán không hợp lệ."
    });
  }

  try {
    const bet = placeBet(
      req.user.id,
      mode,
      round,
      choice,
      gross
    );

    res.json({ ok: true, bet });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

// ========================================
// ADMIN: THỐNG KÊ
// ========================================

app.get("/api/admin/summary", auth, adminOnly, (req, res) => {
  synchronize();

  res.json({
    users: get("SELECT COUNT(*) AS n FROM users").n,
    bets: get("SELECT COUNT(*) AS n FROM bets").n,
    totalStaked: get(
      "SELECT COALESCE(SUM(gross),0) AS n FROM bets"
    ).n,
    totalReward: get(
      "SELECT COALESCE(SUM(reward),0) AS n FROM bets"
    ).n,
    rounds: Object.keys(MODES).map(mode => ({
      mode,
      round: currentRound(mode),
      remainingMs: remaining(mode),
      last: get(
        `SELECT round,result FROM rounds
         WHERE mode=?
         ORDER BY round DESC
         LIMIT 1`,
        mode
      )
    }))
  });
});

// ========================================
// ADMIN: NGƯỜI CHƠI
// ========================================

app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  res.json({
    users: all(
      `SELECT id,username,role,balance,locked,created_at
       FROM users
       ORDER BY id DESC
       LIMIT 500`
    )
  });
});

// ========================================
// ADMIN: LỊCH SỬ CƯỢC
// ========================================

app.get("/api/admin/bets", auth, adminOnly, (req, res) => {
  res.json({
    bets: all(
      `SELECT b.id,u.username,b.mode,b.round,b.choice,
       b.gross,b.fee,b.net,b.reward,b.status,b.created_at
       FROM bets b
       JOIN users u ON u.id=b.user_id
       ORDER BY b.id DESC
       LIMIT 200`
    )
  });
});

// ========================================
// ADMIN: KẾT QUẢ
// ========================================

app.get("/api/admin/results", auth, adminOnly, (req, res) => {
  synchronize();

  res.json({
    results: all(
      `SELECT mode,round,result,created_at,
       'random' AS source
       FROM rounds
       ORDER BY created_at DESC
       LIMIT 100`
    )
  });
});

// ========================================
// ADMIN: KHÓA TÀI KHOẢN
// ========================================

app.post("/api/admin/lock", auth, adminOnly, (req, res) => {
  const { userId, locked } = req.body || {};

  if (!Number.isSafeInteger(userId) ||
      typeof locked !== "boolean" ||
      userId === req.user.id) {
    return res.status(400).json({
      error: "Yêu cầu không hợp lệ."
    });
  }

  const target = get(
    "SELECT role FROM users WHERE id=?",
    userId
  );

  if (!target || target.role === "admin") {
    return res.status(403).json({
      error: "Không được khóa Admin."
    });
  }

  run(
    "UPDATE users SET locked=? WHERE id=?",
    locked ? 1 : 0,
    userId
  );

  res.json({ ok: true });
});

// ========================================
// ADMIN: ĐIỀU CHỈNH SỐ DƯ
// ========================================

const adjustBalance = db.transaction(
  (adminId, userId, amount, reason) => {
    const user = get(
      "SELECT balance,role FROM users WHERE id=?",
      userId
    );

    if (!user || user.role === "admin") {
      throw Error("Không thể điều chỉnh tài khoản này.");
    }

    const nextBalance = user.balance + amount;

    if (nextBalance < 0 ||
        !Number.isSafeInteger(nextBalance)) {
      throw Error("Số dư không hợp lệ.");
    }

    run(
      "UPDATE users SET balance=balance+? WHERE id=?",
      amount,
      userId
    );

    run(
      `INSERT INTO audit
       (admin_id,user_id,amount,reason,created_at)
       VALUES(?,?,?,?,?)`,
      adminId,
      userId,
      amount,
      reason,
      Date.now()
    );
  }
);

app.post("/api/admin/balance", auth, adminOnly, (req, res) => {
  const { userId, amount, reason } = req.body || {};

  if (!Number.isSafeInteger(userId) ||
      !Number.isSafeInteger(amount) ||
      amount === 0 ||
      Math.abs(amount) > 10000000 ||
      typeof reason !== "string" ||
      reason.trim().length < 5 ||
      reason.length > 200) {
    return res.status(400).json({
      error: "Thông tin không hợp lệ."
    });
  }

  try {
    adjustBalance(
      req.user.id,
      userId,
      amount,
      reason.trim()
    );

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      error: error.message
    });
  }
});

app.get("/api/admin/audit", auth, adminOnly, (req, res) => {
  res.json({
    audit: all(
      `SELECT a.*,u.username,adm.username AS admin_name
       FROM audit a
       JOIN users u ON u.id=a.user_id
       JOIN users adm ON adm.id=a.admin_id
       ORDER BY a.id DESC
       LIMIT 100`
    )
  });
});

// ========================================
// ADMIN: KIỂM THỬ KẾT QUẢ
// ========================================

function controlStatus(mode) {
  const round = currentRound(mode);

  const control = get(
    `SELECT c.mode,c.round,c.choice,c.created_at,
     u.username AS admin_name
     FROM round_controls c
     JOIN users u ON u.id=c.admin_id
     WHERE c.mode=? AND c.round=?`,
    mode,
    round
  );

  return {
    mode,
    round,
    remainingMs: remaining(mode),
    control: control || null
  };
}

app.get("/api/admin/control", auth, adminOnly, (req, res) => {
  synchronize();

  res.json({
    modes: Object.keys(MODES).map(controlStatus)
  });
});

// Chỉ định kết quả phiên mô phỏng tiếp theo.
// Không thay đổi kết quả cược chính thức.

app.post("/api/admin/control", auth, adminOnly, (req, res) => {
  const { mode, round, choice } = req.body || {};

  if (!validMode(mode) ||
      !validChoice(choice) ||
      !Number.isSafeInteger(round)) {
    return res.status(400).json({
      error: "Thông tin không hợp lệ."
    });
  }

  const expected = currentRound(mode) + 1;

  if (round !== expected) {
    return res.status(409).json({
      error: "Chỉ được chỉ định kỳ kiểm thử tiếp theo."
    });
  }

  const save = db.transaction(() => {
    const existing = get(
      `SELECT 1 FROM round_controls
       WHERE mode=? AND round=?`,
      mode,
      round
    );

    if (existing) {
      throw Error("Kỳ kiểm thử này đã được chỉ định.");
    }

    run(
      `INSERT INTO round_controls
       (mode,round,choice,admin_id,created_at)
       VALUES(?,?,?,?,?)`,
      mode,
      round,
      choice,
      req.user.id,
      Date.now()
    );

    run(
      `INSERT INTO control_audit
       (admin_id,mode,round,action,choice,created_at)
       VALUES(?,?,?,?,?,?)`,
      req.user.id,
      mode,
      round,
      "set",
      choice,
      Date.now()
    );
  });

  try {
    save();

    res.json({
      ok: true,
      message: "Đã chỉ định kỳ kiểm thử tiếp theo.",
      mode,
      round,
      choice
    });
  } catch (error) {
    res.status(409).json({
      error: error.message
    });
  }
});

// --- API mới cho chỉnh sửa kết quả phiên hiện tại ---

app.post("/api/admin/edit-current-result", auth, adminOnly, (req, res) => {
  const { mode, round, choice } = req.body || {};

  if (!validMode(mode) ||
      !validChoice(choice) ||
      !Number.isSafeInteger(round)) {
    return res.status(400).json({
      error: "Thông tin không hợp lệ."
    });
  }

  const expected = currentRound(mode);
  if (round !== expected) {
    return res.status(409).json({
      error: "Chỉ được chỉnh sửa phiên hiện tại."
    });
  }

  const save = db.transaction(() => {
    const existing = get(
      `SELECT * FROM round_controls WHERE mode=? AND round=?`,
      mode,
      round
    );

    if (existing) {
      run(
        `UPDATE round_controls SET choice=?, admin_id=?, created_at=? WHERE mode=? AND round=?`,
        choice,
        req.user.id,
        Date.now(),
        mode,
        round
      );
    } else {
      run(
        `INSERT INTO round_controls (mode, round, choice, admin_id, created_at) VALUES (?, ?, ?, ?, ?)`,
        mode,
        round,
        choice,
        req.user.id,
        Date.now()
      );
    }

    run(
      `INSERT INTO control_audit (admin_id, mode, round, action, choice, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      req.user.id,
      mode,
      round,
      "edit_current",
      choice,
      Date.now()
    );
  });

  try {
    save();

    res.json({
      ok: true,
      message: `Đã cập nhật kết quả chỉnh sửa phiên hiện tại cho chế độ ${mode}, kỳ ${round}`,
      mode,
      round,
      choice
    });
  } catch (error) {
    res.status(400).json({
      error: error.message || "Lỗi khi lưu chỉnh sửa."
    });
  }
});

// ========================================
// ADMIN: NHẬT KÝ KIỂM THỬ
// ========================================

app.get(
  "/api/admin/control-audit",
  auth,
  adminOnly,
  (req, res) => {
    res.json({
      records: all(
        `SELECT a.*,u.username AS admin_name
         FROM control_audit a
         JOIN users u ON u.id=a.admin_id
         ORDER BY a.id DESC
         LIMIT 100`
      )
    });
  }
);

app.get(
  "/api/admin/simulation-results",
  auth,
  adminOnly,
  (req, res) => {
    synchronize();

    res.json({
      results: all(
        `SELECT mode,round,result,source,created_at
         FROM simulation_results
         ORDER BY created_at DESC
         LIMIT 100`
      )
    });
  }
);

// ========================================
// GIAO DIỆN WEBSITE
// ========================================

app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC, "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(PUBLIC, "admin.html"));
});

const allowedFiles = new Set([
  "index.html",
  "style.css",
  "script.js",
  "admin.html",
  "admin.css",
  "admin.js",
  "aura.png",
  "theme.js",
  "countdown-frame.js",
  "aura_countdown.mp3"
]);

app.get("/:file", (req, res) => {
  const file = req.params.file;

  if (!allowedFiles.has(file)) {
    return res.status(404).send("Not found");
  }

  res.sendFile(path.join(PUBLIC, file));
});

app.use((req, res) => {
  res.status(404).json({
    error: "Không tìm thấy đường dẫn."
  });
});

// ========================================
// KHỞI ĐỘNG SERVER
// ========================================

app.listen(PORT, () => {
  console.log("==================================");
  console.log("       AURA LUCK SERVER");
  console.log("==================================");
  console.log("Trang chơi: http://localhost:" + PORT);
  console.log("Trang Admin: http://localhost:" + PORT + "/admin");
  console.log("==================================");
});
