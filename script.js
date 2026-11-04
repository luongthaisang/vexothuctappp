
"use strict";

// ==========================================
// AURA LUCK - SCRIPT HOÀN CHỈNH
// ÂM THANH MP3 CHO 5 GIÂY CUỐI
// ==========================================

const $ = id => document.getElementById(id);

const fmt = n =>
  new Intl.NumberFormat("vi-VN").format(Number(n) || 0);

const money = n => fmt(n) + " Đồng AURA";

const MODES = {
  "1": { name: "WinGo 1Min", duration: 60000 },
  "3": { name: "WinGo 3Min", duration: 180000 },
  "5": { name: "WinGo 5Min", duration: 300000 }
};

const CHOICES = {
  green: "Xanh",
  red: "Đỏ",
  purple: "Tím",
  big: "Lớn",
  small: "Nhỏ"
};

for (let i = 0; i < 10; i++) {
  CHOICES["n" + i] = "Số " + i;
}

let token = sessionStorage.getItem("aura_token") || "";
let currentUser = null;
let activeMode = "1";
let game = null;
let selectedChoice = null;
let selectedRound = null;
let historyPage = 1;
let registering = false;
let serverOffset = 0;
let refreshBusy = false;
let popupTimer = null;

const HISTORY_PAGE_SIZE = 10;

// ==========================================
// ÂM THANH 5 GIÂY CUỐI
// ==========================================

const countdownAudio = new Audio("/aura_countdown.mp3");

countdownAudio.preload = "auto";
countdownAudio.volume = 1;
countdownAudio.loop = false;

let lastAudioRound = "";
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;

  audioUnlocked = true;

  // Trình duyệt cho phép âm thanh sau
  // khi người chơi tương tác với trang.
  countdownAudio.load();
}

document.addEventListener("pointerdown", unlockAudio, {
  passive: true
});

document.addEventListener("keydown", unlockAudio);

function stopCountdownAudio() {
  countdownAudio.pause();

  try {
    countdownAudio.currentTime = 0;
  } catch {}
}

function playCountdownAudio(roundKey) {
  if (lastAudioRound === roundKey) return;

  lastAudioRound = roundKey;

  stopCountdownAudio();

  countdownAudio.play().catch(error => {
    console.warn("Chưa thể phát âm thanh:", error);
  });
}

countdownAudio.addEventListener("error", () => {
  console.warn(
    "Không tải được /aura_countdown.mp3. Kiểm tra file MP3 và server."
  );
});

// ==========================================
// THÔNG BÁO
// ==========================================

function notify(message) {
  let el = $("toast");

  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }

  el.textContent = message;

  el.style.cssText = `
    position:fixed;
    bottom:25px;
    left:50%;
    transform:translateX(-50%);
    background:#333;
    color:white;
    padding:12px 20px;
    border-radius:12px;
    z-index:20000;
    max-width:90%;
    text-align:center;
    display:block;
  `;

  clearTimeout(el.timer);

  el.timer = setTimeout(() => {
    el.style.display = "none";
  }, 3000);
}

// ==========================================
// KẾT NỐI API
// ==========================================

async function api(url, method = "GET", body) {
  const response = await fetch("/api" + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: body === undefined
      ? undefined
      : JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw Error(data.error || "Lỗi kết nối server.");
  }

  return data;
}

// ==========================================
// CSS BỔ SUNG
// ==========================================

function installStyles() {
  if ($("auraScriptStyles")) return;

  const style = document.createElement("style");
  style.id = "auraScriptStyles";

  style.textContent = `
    .aura-auth-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      background: linear-gradient(140deg,#ff6770,#ffb0a0);
      display: grid;
      place-items: center;
      padding: 18px;
    }

    .aura-auth-card {
      background: white;
      border-radius: 24px;
      padding: 28px;
      width: 100%;
      max-width: 390px;
      box-shadow: 0 15px 50px #0003;
    }

    .aura-auth-card h1 {
      color: #f65b64;
      text-align: center;
    }

    .aura-auth-card p {
      text-align: center;
      color: #8a90a0;
    }

    .aura-auth-card input {
      display: block;
      width: 100%;
      padding: 14px;
      margin: 12px 0;
      border: 1px solid #ddd;
      border-radius: 10px;
      box-sizing: border-box;
    }

    .aura-auth-card button {
      width: 100%;
      padding: 14px;
      border-radius: 10px;
      background: #fa5d61;
      color: white;
      font-weight: bold;
      margin-top: 10px;
      cursor: pointer;
    }

    .aura-auth-card .switch {
      background: #f5f6ff;
      color: #e8505a;
    }

    .aura-account-bar {
      max-width: 590px;
      margin: 0 auto;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .aura-account-bar b {
      margin-right: auto;
    }

    .aura-account-bar button {
      padding: 9px 12px;
      background: white;
      color: #f45b64;
      border-radius: 9px;
      cursor: pointer;
    }

    #changePassword,
    #logoutButton {
      display: none !important;
    }

    .aura-result-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: #000b;
      display: grid;
      place-items: center;
      padding: 20px;
    }

    .aura-result-card {
      width: 100%;
      max-width: 390px;
      text-align: center;
      background: linear-gradient(160deg,#ffa15a,#f45257);
      border-radius: 25px;
      padding: 25px 18px;
      color: white;
    }

    .aura-result-card.lose {
      background: linear-gradient(150deg,#858ba2,#424960);
    }

    .aura-result-bonus {
      background: #fff7ef;
      color: #e24b55;
      border-radius: 13px;
      padding: 25px 12px;
      margin: 18px 0;
    }

    .aura-result-bonus strong {
      font-size: 28px;
      display: block;
    }

    .aura-result-card button {
      background: #ffffff30;
      color: white;
      border: 1px solid #fff8;
      padding: 12px 30px;
      border-radius: 20px;
    }

    .aura-history-pagination {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-top: 15px;
      padding: 5px;
    }

    .aura-history-pagination button {
      background: #fa5d61;
      color: white;
      border-radius: 9px;
      padding: 11px 15px;
      font-weight: bold;
    }

    .aura-history-pagination button:disabled {
      background: #e5e7ee;
      color: #999;
    }

    .aura-confirm-placement {
      margin-top: 14px;
      margin-bottom: 12px;
    }

    .aura-confirm-placement #confirmBet {
      width: 100%;
    }

    .period-tabs {
      display: grid !important;
      grid-template-columns: repeat(3,1fr) !important;
      gap: 0 !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: hidden;
    }

    .period-tabs .period {
      height: 85px !important;
      min-height: 85px !important;
      padding: 8px 4px !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      align-items: center !important;
      gap: 4px !important;
      font-size: 13px !important;
    }

    .period-tabs .period svg {
      width: 23px !important;
      height: 23px !important;
    }

    @media (max-width:600px) {
      .period-tabs .period {
        height: 75px !important;
        min-height: 75px !important;
      }
    }

    /* Đếm ngược chỉ nằm trong khung đặt cược */
    #countdownOverlay.aura-local-countdown {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 8px !important;
      box-sizing: border-box !important;
      z-index: 50 !important;
      background: rgba(0,0,0,.48) !important;
      display: flex !important;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border-radius: inherit;
      overflow: hidden;
    }

    #countdownOverlay.aura-local-countdown.hidden {
      display: none !important;
    }

    #countdownOverlay.aura-local-countdown .countdown-boxes {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 10px;
      width: 100%;
    }

    #countdownOverlay.aura-local-countdown .countdown-digit {
      display: flex;
      align-items: center;
      justify-content: center;
      width: min(28%,90px);
      height: 100px;
      background: #fff;
      color: #fa5d61;
      border-radius: 15px;
      font-size: clamp(44px,12vw,76px);
      font-weight: 800;
      line-height: 1;
    }

    #countdownOverlay.aura-local-countdown .countdown-message {
      color: white;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 2px;
      text-align: center;
    }

    #countdownOverlay.aura-local-countdown .tick {
      animation: auraTick .25s ease-out;
    }

    @keyframes auraTick {
      from { transform: scale(1.12); }
      to { transform: scale(1); }
    }
  `;

  document.head.appendChild(style);
}

// ==========================================
// ĐĂNG NHẬP / ĐĂNG KÝ
// ==========================================

function installAuth() {
  if ($("auraAuth")) return;

  const root = document.createElement("div");

  root.id = "auraAuth";
  root.className = "aura-auth-backdrop hidden";

  root.innerHTML = `
    <div class="aura-auth-card">
      <h1>✦ AURA LUCK</h1>
      <p id="authTitle">Đăng nhập để bắt đầu</p>

      <form id="authForm">
        <input
          id="authUsername"
          autocomplete="username"
          placeholder="Tên đăng nhập"
          required
        >

        <input
          id="authPassword"
          type="password"
          autocomplete="current-password"
          placeholder="Mật khẩu"
          required
        >

        <button id="authSubmit" type="submit">
          Đăng nhập
        </button>
      </form>

      <button class="switch" id="authSwitch">
        Chưa có tài khoản? Đăng ký
      </button>

      <p id="authError"></p>
    </div>
  `;

  document.body.appendChild(root);

  const account = document.createElement("div");
  account.className = "aura-account-bar";

  account.innerHTML = `
    <b id="accountName">Chưa đăng nhập</b>
    <button id="changePassword">Đổi mật khẩu</button>
    <button id="adminLink" class="hidden">Admin</button>
    <button id="logoutButton">Đăng xuất</button>
  `;

  const topbar = document.querySelector(".topbar");

  if (topbar) {
    topbar.after(account);
  } else {
    document.body.prepend(account);
  }

  $("authSwitch").onclick = () => {
    registering = !registering;

    $("authTitle").textContent = registering
      ? "Tạo tài khoản Đồng AURA"
      : "Đăng nhập để bắt đầu";

    $("authSubmit").textContent = registering
      ? "Đăng ký"
      : "Đăng nhập";

    $("authSwitch").textContent = registering
      ? "Đã có tài khoản? Đăng nhập"
      : "Chưa có tài khoản? Đăng ký";

    $("authError").textContent = "";
  };

  $("authForm").onsubmit = async event => {
    event.preventDefault();

    const username = $("authUsername").value.trim();
    const password = $("authPassword").value;

    try {
      if (registering) {
        await api("/register", "POST", {
          username,
          password
        });

        registering = false;

        $("authTitle").textContent =
          "Đăng nhập để bắt đầu";

        $("authSubmit").textContent =
          "Đăng nhập";

        $("authSwitch").textContent =
          "Chưa có tài khoản? Đăng ký";

        $("authError").textContent =
          "Đăng ký thành công. Hãy đăng nhập.";

        return;
      }

      const data = await api("/login", "POST", {
        username,
        password
      });

      token = data.token;
      sessionStorage.setItem("aura_token", token);

      currentUser = data.user;
      $("authPassword").value = "";

      showLoggedIn();
      await refreshGame();

    } catch (error) {
      $("authError").textContent = error.message;
    }
  };

  $("logoutButton").onclick = async () => {
    try {
      await api("/logout", "POST");
    } catch {}

    token = "";
    currentUser = null;
    game = null;

    sessionStorage.removeItem("aura_token");
    $("auraAuth").classList.remove("hidden");
  };

  $("adminLink").onclick = () => {
    location.href = "/admin";
  };

  $("changePassword").onclick = async () => {
    const oldPassword = prompt("Mật khẩu hiện tại:");
    if (oldPassword === null) return;

    const newPassword = prompt("Mật khẩu mới:");
    if (newPassword === null) return;

    try {
      await api("/change-password", "POST", {
        oldPassword,
        newPassword
      });

      alert("Đã đổi mật khẩu. Hãy đăng nhập lại.");
      $("logoutButton").click();

    } catch (error) {
      alert(error.message);
    }
  };
}

function showLoggedIn() {
  $("auraAuth").classList.add("hidden");

  $("accountName").textContent =
    "👤 " + currentUser.username;

  $("adminLink").classList.toggle(
    "hidden",
    currentUser.role !== "admin"
  );

  if ($("balance")) {
    $("balance").textContent = money(currentUser.balance);
  }
}

// ==========================================
// KỲ XỔ VÀ ĐỒNG HỒ
// ==========================================

function periodId(round, mode = activeMode) {
  const date = new Date(round * MODES[mode].duration);
  const p = n => String(n).padStart(2, "0");

  return (
    date.getUTCFullYear() +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    "-" + mode + "M"
  );
}

function remaining() {
  if (!game) return MODES[activeMode].duration;

  const now = Date.now() + serverOffset;
  const duration = MODES[activeMode].duration;

  return duration - now % duration;
}

function secondsLeft() {
  return Math.max(0, Math.ceil(remaining() / 1000));
}

// ==========================================
// ĐẾM NGƯỢC TRONG KHUNG
// ==========================================

function installLocalCountdown() {
  const overlay = $("countdownOverlay");

  const target =
    document.querySelector(".draw-panel") ||
    document.querySelector(".draw-box") ||
    document.querySelector(".draw-card") ||
    document.querySelector(".draw-section") ||
    $("gamePanel");

  if (!overlay || !target) return;

  if (overlay.parentElement !== target) {
    target.appendChild(overlay);
  }

  target.style.position = "relative";
  target.style.isolation = "isolate";

  overlay.classList.add("aura-local-countdown");
  overlay.classList.add("hidden");
}

function updateClock() {
  if (!game) return;

  const seconds = secondsLeft();

  if ($("clock")) {
    $("clock").textContent =
      String(Math.floor(seconds / 60)).padStart(2, "0") +
      ":" +
      String(seconds % 60).padStart(2, "0");
  }

  const round = Math.floor(
    (Date.now() + serverOffset) /
    MODES[activeMode].duration
  );

  if ($("roundId")) {
    $("roundId").textContent = periodId(round);
  }

  const locked = seconds <= 5;
  const overlay = $("countdownOverlay");

  if (overlay) {
    overlay.classList.toggle("hidden", !locked);
  }

  if (locked) {
    const digits = String(seconds).padStart(2, "0");

    if ($("countDigit1")) {
      $("countDigit1").textContent = digits[0];
    }

    if ($("countDigit2")) {
      $("countDigit2").textContent = digits[1];
    }

    // Phát MP3 một lần khi còn đúng 5 giây.
    const roundKey = activeMode + ":" + round;

    if (seconds === 5) {
      playCountdownAudio(roundKey);
    }

  } else {
    // Nếu kỳ đã đổi, không để âm thanh cũ
    // tiếp tục phát sang kỳ mới.
    const roundKey = activeMode + ":" + round;

    if (
      lastAudioRound &&
      lastAudioRound !== roundKey &&
      !countdownAudio.paused
    ) {
      stopCountdownAudio();
    }
  }

  document.querySelectorAll(
    ".color-btn,.number-ball,.size-buttons button,#randomButton"
  ).forEach(button => {
    button.disabled = locked;
  });

  if ($("gameHint")) {
    $("gameHint").textContent = locked
      ? "⏳ Đã khóa dự đoán. Sắp mở thưởng!"
      : "Chọn một phương án để dự đoán bằng Đồng AURA.";
  }

  if (
    $("betModal") &&
    !$("betModal").classList.contains("hidden") &&
    $("confirmBet")
  ) {
    $("confirmBet").disabled =
      locked || !validBetAmount();
  }
}

// ==========================================
// MÀU KẾT QUẢ
// ==========================================

function colorOf(number) {
  if (number === 0 || number === 5) {
    return "purple";
  }

  return number % 2 === 0 ? "red" : "green";
}

function colorsOf(number) {
  if (number === 0) return ["red", "purple"];
  if (number === 5) return ["green", "purple"];

  return [colorOf(number)];
}

// ==========================================
// DÃY 5 KẾT QUẢ GẦN NHẤT
// ==========================================

function drawBalls(result) {
  const root = $("drawBalls");

  if (!root) return;

  root.replaceChildren();

  const digits = String(result || "")
    .slice(0, 5)
    .padEnd(5, "?");

  for (const digit of digits) {
    const ball = document.createElement("span");

    ball.textContent = digit;

    if (/^[0-9]$/.test(digit)) {
      ball.classList.add(colorOf(Number(digit)));
    }

    root.appendChild(ball);
  }
}

function getFiveResults(history) {
  return [...(history || [])]
    .sort((a, b) => Number(b.round) - Number(a.round))
    .slice(0, 5)
    .map(item => String(item.result ?? "").slice(-1))
    .join("")
    .padEnd(5, "?");
}

// ==========================================
// LỊCH SỬ KẾT QUẢ
// ==========================================

function installHistoryPagination() {
  const panel = $("historyPanel");

  if (!panel || $("historyPagination")) return;

  const pagination = document.createElement("div");

  pagination.id = "historyPagination";
  pagination.className = "aura-history-pagination";

  pagination.innerHTML = `
    <button id="historyPrev" type="button">❮ Trước</button>
    <span id="historyPageInfo">Trang 1 / 1</span>
    <button id="historyNext" type="button">Tiếp ❯</button>
  `;

  panel.appendChild(pagination);

  $("historyPrev").onclick = () => {
    if (historyPage > 1) {
      historyPage--;
      renderHistory();
    }
  };

  $("historyNext").onclick = () => {
    if (!game) return;

    const pages = Math.max(
      1,
      Math.ceil((game.history || []).length / HISTORY_PAGE_SIZE)
    );

    if (historyPage < pages) {
      historyPage++;
      renderHistory();
    }
  };
}

function renderHistory() {
  if (!game || !$("historyBody")) return;

  const root = $("historyBody");
  root.replaceChildren();

  const history = [...(game.history || [])]
    .sort((a, b) => Number(b.round) - Number(a.round));

  const totalPages = Math.max(
    1,
    Math.ceil(history.length / HISTORY_PAGE_SIZE)
  );

  historyPage = Math.min(
    Math.max(1, historyPage),
    totalPages
  );

  const start = (historyPage - 1) * HISTORY_PAGE_SIZE;

  for (const item of history.slice(start, start + HISTORY_PAGE_SIZE)) {
    const number = Number(String(item.result).slice(-1));
    const tr = document.createElement("tr");

    const id = document.createElement("td");
    id.textContent = periodId(item.round);

    const digit = document.createElement("td");
    digit.className = "result-digit text-" + colorOf(number);
    digit.textContent = number;

    const size = document.createElement("td");
    size.textContent = number >= 5 ? "Lớn" : "Nhỏ";

    const colors = document.createElement("td");

    for (const color of colorsOf(number)) {
      const dot = document.createElement("span");
      dot.className = "dot " + color;
      colors.appendChild(dot);
    }

    tr.append(id, digit, size, colors);
    root.appendChild(tr);
  }

  if ($("historyPageInfo")) {
    $("historyPageInfo").textContent =
      "Trang " + historyPage + " / " + totalPages;
  }

  if ($("historyPrev")) {
    $("historyPrev").disabled = historyPage <= 1;
  }

  if ($("historyNext")) {
    $("historyNext").disabled = historyPage >= totalPages;
  }
}

// ==========================================
// LỊCH SỬ CƯỢC
// ==========================================

function renderMine() {
  if (!game || !$("myHistory")) return;

  const root = $("myHistory");
  root.replaceChildren();

  const bets = game.bets || [];

  for (const bet of bets) {
    const item = document.createElement("div");
    item.className = "my-bet";

    const title = document.createElement("div");
    title.textContent =
      periodId(bet.round) +
      " • " +
      (CHOICES[bet.choice] || bet.choice);

    const amount = document.createElement("div");
    amount.textContent =
      "Dự đoán " + money(bet.gross) +
      " | Phí " + money(bet.fee);

    const status = document.createElement("div");

    status.className =
      bet.status === "won"
        ? "won"
        : bet.status === "lost"
          ? "lost"
          : "";

    status.textContent =
      bet.status === "won"
        ? "🏆 Thắng • Nhận " + money(bet.reward)
        : bet.status === "lost"
          ? "Không trúng"
          : "⏳ Đang chờ mở thưởng";

    item.append(title, amount, status);
    root.appendChild(item);
  }

  const settled = bets.filter(b => b.status !== "pending");
  const wins = settled.filter(b => b.status === "won");

  if ($("totalBets")) {
    $("totalBets").textContent = fmt(bets.length);
  }

  if ($("totalWins")) {
    $("totalWins").textContent = fmt(wins.length);
  }

  if ($("winRate")) {
    $("winRate").textContent = settled.length
      ? (wins.length / settled.length * 100).toFixed(1) + "%"
      : "0%";
  }
}

// ==========================================
// BIỂU ĐỒ THỐNG KÊ
// ==========================================

function statRow(id, values, circles = false) {
  const root = $(id);
  if (!root) return;

  root.replaceChildren();

  values.forEach(number => {
    const element = document.createElement("span");

    element.className =
      "stat-number" + (circles ? " circle" : "");

    element.textContent = number;
    root.appendChild(element);
  });
}

function renderChart() {
  if (!game) return;

  const history = [...(game.history || [])]
    .sort((a, b) => Number(b.round) - Number(a.round))
    .slice(0, 100);

  const nums = history.map(
    item => Number(String(item.result).slice(-1))
  );

  statRow(
    "statNumbers",
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    true
  );

  const missing = [];
  const average = [];
  const frequency = [];
  const consecutive = [];

  for (let number = 0; number < 10; number++) {
    const positions = [];

    nums.forEach((value, index) => {
      if (value === number) positions.push(index);
    });

    frequency.push(positions.length);
    missing.push(positions.length ? positions[0] : nums.length);

    let gap = 0;

    for (let i = 1; i < positions.length; i++) {
      gap += positions[i] - positions[i - 1];
    }

    average.push(
      positions.length > 1
        ? Math.round(gap / (positions.length - 1))
        : 0
    );

    let streak = 0;
    let max = 0;

    for (const value of nums) {
      streak = value === number ? streak + 1 : 0;
      max = Math.max(max, streak);
    }

    consecutive.push(max);
  }

  statRow("statMissing", missing);
  statRow("statAverage", average);
  statRow("statFrequency", frequency);
  statRow("statConsecutive", consecutive);

  const root = $("trendRows");
  if (!root) return;

  root.replaceChildren();

  history.forEach(item => {
    const number = Number(String(item.result).slice(-1));

    const row = document.createElement("div");
    row.className = "trend-row";

    const period = document.createElement("div");
    period.className = "trend-period";
    period.textContent = periodId(item.round);

    const area = document.createElement("div");
    area.className = "trend-number-area";

    for (let i = 0; i < 10; i++) {
      const circle = document.createElement("span");

      circle.className =
        "trend-number" +
        (i === number ? " hit " + colorOf(number) : "");

      circle.textContent = i;
      area.appendChild(circle);
    }

    const size = document.createElement("span");

    size.className =
      "trend-size " + (number >= 5 ? "big" : "small");

    size.textContent = number >= 5 ? "B" : "S";

    area.appendChild(size);
    row.append(period, area);
    root.appendChild(row);
  });

  requestAnimationFrame(drawLines);
}

function drawLines() {
  const chart = $("trendChart");
  const svg = $("trendLines");

  if (!chart || !svg) return;

  const hits = [
    ...chart.querySelectorAll(".trend-number.hit")
  ];

  svg.replaceChildren();

  const rect = chart.getBoundingClientRect();
  const width = chart.clientWidth;
  const height = chart.scrollHeight;

  if (!width || !height) return;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const points = hits.map(element => {
    const r = element.getBoundingClientRect();

    return {
      x: r.left - rect.left + r.width / 2,
      y: r.top - rect.top + r.height / 2
    };
  });

  for (let i = 0; i < points.length - 1; i++) {
    const line = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );

    line.setAttribute("x1", points[i].x);
    line.setAttribute("y1", points[i].y);
    line.setAttribute("x2", points[i + 1].x);
    line.setAttribute("y2", points[i + 1].y);
    line.setAttribute("stroke", "#fa5d61");
    line.setAttribute("stroke-width", "1.5");

    svg.appendChild(line);
  }
}

// ==========================================
// THÔNG BÁO KẾT QUẢ
// ==========================================

function showResult(item, bets) {
  if (!bets.length) return;

  const totalWon = bets.reduce(
    (sum, bet) => sum + bet.reward,
    0
  );

  const totalStaked = bets.reduce(
    (sum, bet) => sum + bet.gross,
    0
  );

  const wins = bets.filter(
    bet => bet.status === "won"
  ).length;

  const number = Number(String(item.result).slice(-1));
  const won = totalWon > 0;

  const overlay = document.createElement("div");
  overlay.className = "aura-result-backdrop";

  const card = document.createElement("div");
  card.className =
    "aura-result-card" + (won ? "" : " lose");

  const title = document.createElement("h1");
  title.textContent = won
    ? "🏆 CHÚC MỪNG!"
    : "💔 RẤT TIẾC!";

  const info = document.createElement("p");

  info.textContent =
    "Kết quả: " + number +
    " • " + (number >= 5 ? "Lớn" : "Nhỏ");

  const bonus = document.createElement("div");
  bonus.className = "aura-result-bonus";

  const label = document.createElement("p");
  label.textContent = won
    ? "🎁 Tổng thưởng"
    : "Dự đoán không trúng";

  const amount = document.createElement("strong");
  amount.textContent = money(
    won ? totalWon : totalStaked
  );

  const period = document.createElement("p");
  period.textContent = "Kỳ: " + periodId(item.round);

  bonus.append(label, amount, period);

  const detail = document.createElement("p");
  detail.textContent =
    "Trúng " + wins + "/" + bets.length + " lượt";

  const close = document.createElement("button");
  close.textContent = "Đóng";

  close.onclick = () => {
    clearTimeout(popupTimer);
    overlay.remove();
  };

  card.append(title, info, bonus, detail, close);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  popupTimer = setTimeout(() => {
    overlay.remove();
  }, 3000);
}

// ==========================================
// ĐỒNG BỘ SERVER
// ==========================================

async function refreshGame() {
  if (!token || refreshBusy) return;

  refreshBusy = true;

  try {
    const mode = activeMode;
    const data = await api("/game?mode=" + mode);

    if (mode !== activeMode) return;

    const previous = game;

    const previousIds = new Set(
      previous
        ? (previous.history || []).map(item => item.round)
        : []
    );

    serverOffset = data.serverTime - Date.now();
    game = data;

    if (currentUser) {
      currentUser.balance = data.balance;
    }

    if ($("balance")) {
      $("balance").textContent = money(data.balance);
    }

    drawBalls(getFiveResults(data.history));

    renderHistory();
    renderMine();
    renderChart();

    if (previous) {
      const newItems = (data.history || []).filter(
        item => !previousIds.has(item.round)
      );

      for (const item of newItems) {
        const bets = (data.bets || []).filter(
          bet =>
            bet.round === item.round &&
            bet.status !== "pending"
        );

        if (bets.length) {
          showResult(item, bets);
        }
      }
    }

    updateClock();

  } catch (error) {
    console.error("AURA LUCK:", error);
    notify(error.message);

    if (
      /đăng nhập|khóa/i.test(error.message) &&
      $("auraAuth")
    ) {
      $("auraAuth").classList.remove("hidden");
    }

  } finally {
    refreshBusy = false;
  }
}

// ==========================================
// CHUYỂN CHẾ ĐỘ
// ==========================================

function switchMode(mode) {
  if (!MODES[mode]) return;

  stopCountdownAudio();

  activeMode = mode;
  game = null;
  historyPage = 1;

  document.querySelectorAll(
    ".period-tabs .period"
  ).forEach(tab => {
    const selected = tab.dataset.mode === mode;

    tab.classList.toggle("active", selected);
    tab.classList.toggle("inactive", !selected);
  });

  const title = document.querySelector(".draw-left p");

  if (title) {
    title.textContent = MODES[mode].name;
  }

  if ($("betModal")) {
    $("betModal").classList.add("hidden");
  }

  drawBalls("?????");
  refreshGame();
}

// ==========================================
// TIỀN CƯỢC
// ==========================================

function validBetAmount() {
  if (!$("betAmount")) return false;

  const gross = Number($("betAmount").value);

  return (
    Number.isSafeInteger(gross) &&
    gross >= 1 &&
    gross <= 100000000 &&
    gross <= Number(game?.balance ?? 0) &&
    secondsLeft() > 5
  );
}

function openBet(choice) {
  if (!currentUser) {
    $("auraAuth").classList.remove("hidden");
    return;
  }

  if (!game || secondsLeft() <= 5) {
    notify("Đã khóa dự đoán.");
    return;
  }

  selectedChoice = choice;
  selectedRound = game.round;

  $("betAmount").value = "0";

  document.querySelectorAll(
    "[data-amount]"
  ).forEach(button => {
    button.classList.remove("active");
  });

  $("modalBalance").textContent =
    fmt(currentUser.balance);

  $("modalChoice").textContent =
    CHOICES[choice] || choice;

  $("modalRound").textContent =
    periodId(selectedRound);

  $("betModal").classList.remove("hidden");

  calculateBet();
}

function calculateBet() {
  const gross = Number($("betAmount").value) || 0;
  const fee = Math.round(gross * 0.02);
  const net = gross - fee;

  let rate = 2;

  if (selectedChoice === "purple") {
    rate = 4.5;
  }

  if (selectedChoice?.startsWith("n")) {
    rate = 9;
  }

  $("grossAmount").textContent = money(gross);
  $("feeAmount").textContent = money(fee);
  $("netAmount").textContent = money(net);

  $("rewardAmount").textContent =
    money(Math.round(net * rate));

  const balance = Number(
    game?.balance ?? currentUser?.balance ?? 0
  );

  const remainingBalance = balance - gross;

  $("modalBalance").textContent = fmt(balance);

  if ($("remainingBalance")) {
    $("remainingBalance").textContent =
      money(remainingBalance);

    $("remainingBalance").classList.toggle(
      "insufficient",
      remainingBalance < 0
    );
  }

  if ($("insufficientWarning")) {
    $("insufficientWarning").classList.toggle(
      "hidden",
      remainingBalance >= 0
    );
  }

  $("confirmBet").disabled = !validBetAmount();

  return gross;
}

function arrangeBetModal() {
  const confirm = $("confirmBet");
  const amountControl = document.querySelector(
    ".aura-amount-control"
  );

  if (!confirm || !amountControl) return;

  if (confirm.parentElement?.classList.contains(
    "aura-confirm-placement"
  )) {
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "aura-confirm-placement";

  amountControl.after(wrapper);
  wrapper.appendChild(confirm);
}

// ==========================================
// GẮN SỰ KIỆN
// ==========================================

function installEvents() {
  document.querySelectorAll(
    ".period-tabs .period"
  ).forEach((tab, index) => {
    const mode = ["1", "3", "5"][index];

    tab.dataset.mode = mode;
    tab.style.cursor = "pointer";
    tab.onclick = () => switchMode(mode);
  });

  document.querySelectorAll(
    "[data-choice]"
  ).forEach(button => {
    button.onclick = () => {
      openBet(button.dataset.choice);
    };
  });

  const numberGrid = $("numberGrid");

  if (numberGrid) {
    numberGrid.replaceChildren();

    for (let i = 0; i < 10; i++) {
      const button = document.createElement("button");

      button.className = "number-ball " + colorOf(i);
      button.textContent = i;

      button.onclick = () => openBet("n" + i);

      numberGrid.appendChild(button);
    }
  }

  if ($("randomButton")) {
    $("randomButton").onclick = () => {
      const array = new Uint32Array(1);
      crypto.getRandomValues(array);

      openBet("n" + (array[0] % 10));
    };
  }

  document.querySelectorAll(".multi").forEach(button => {
    button.onclick = () => {
      document.querySelectorAll(".multi").forEach(item => {
        item.classList.toggle("active", item === button);
      });
    };
  });

  document.querySelectorAll(
    "[data-amount]"
  ).forEach(button => {
    button.onclick = () => {
      
      const current = Number($("betAmount").value) || 0;

      const balance = Math.max(
        0,
        Math.floor(Number(
          game?.balance ?? currentUser?.balance ?? 0
        ))
      );

      const allIn = button.dataset.amount === "all";
      const addition = Number(button.dataset.amount) || 0;

      // Tất tay lấy toàn bộ số dư hiện tại.
      // Những nút còn lại vẫn cộng dồn.
      $("betAmount").value = allIn
        ? balance
        : current + addition;


      document.querySelectorAll(
        "[data-amount]"
      ).forEach(item => {
        item.classList.toggle("active", item === button);
      });

      calculateBet();
    };
  });

  $("betAmount").oninput = calculateBet;

  if ($("clearAmount")) {
    $("clearAmount").onclick = () => {
      $("betAmount").value = "0";

      document.querySelectorAll(
        "[data-amount]"
      ).forEach(button => {
        button.classList.remove("active");
      });

      calculateBet();
    };
  }

  $("confirmBet").onclick = async () => {
    const gross = calculateBet();

    if ($("confirmBet").disabled) return;

    $("confirmBet").disabled = true;

    try {
      await api("/bet", "POST", {
        mode: activeMode,
        round: selectedRound,
        choice: selectedChoice,
        gross
      });

      $("betModal").classList.add("hidden");

      notify(
        "Đã dự đoán " +
        (CHOICES[selectedChoice] || selectedChoice) +
        " • " +
        money(gross)
      );

      await refreshGame();

    } catch (error) {
      notify(error.message);
      calculateBet();
    }
  };

  if ($("closeModal")) {
    $("closeModal").onclick = () => {
      $("betModal").classList.add("hidden");
    };
  }

  if ($("rulesButton") && $("rulesModal")) {
    $("rulesButton").onclick = () => {
      $("rulesModal").classList.remove("hidden");
    };
  }

  if ($("closeRules") && $("rulesModal")) {
    $("closeRules").onclick = () => {
      $("rulesModal").classList.add("hidden");
    };
  }

  document.querySelectorAll(
    ".history-tab"
  ).forEach(button => {
    button.onclick = () => {
      document.querySelectorAll(
        ".history-tab"
      ).forEach(item => {
        item.classList.toggle("active", item === button);
      });

      ["history", "chart", "mine"].forEach(tab => {
        const panel = $(tab + "Panel");

        if (panel) {
          panel.classList.toggle(
            "hidden",
            tab !== button.dataset.tab
          );
        }
      });

      if (button.dataset.tab === "chart") {
        requestAnimationFrame(drawLines);
      }
    };
  });

  if ($("resetButton")) {
    $("resetButton").style.display = "none";
  }

  if ($("soundButton")) {
    $("soundButton").style.display = "none";
  }
}

// ==========================================
// KHỞI ĐỘNG
// ==========================================

async function start() {
  installStyles();
  installAuth();
  installHistoryPagination();
  arrangeBetModal();
  installLocalCountdown();
  installEvents();

  if (token) {
    try {
      const data = await api("/me");

      currentUser = data.user;
      showLoggedIn();

    } catch {
      token = "";
      sessionStorage.removeItem("aura_token");
    }
  }

  if (!currentUser) {
    $("auraAuth").classList.remove("hidden");
  } else {
    await refreshGame();
  }

  setInterval(updateClock, 200);
  setInterval(refreshGame, 2000);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        refreshGame();
      }
    }
  );

  window.addEventListener("resize", () => {
    requestAnimationFrame(drawLines);
  });
}

start();
