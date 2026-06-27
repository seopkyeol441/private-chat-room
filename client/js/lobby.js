// 로비 화면 전용 스크립트입니다.
// 로그인 확인, 프로필 표시, 방 생성, 방 목록 조회, 방 입장을 처리합니다.
(() => {
  const supabaseClient = window.supabaseClient;
  const nicknameElement = document.querySelector("#nickname");
  const lobbyMessage = document.querySelector("#lobby-message");
  const createRoomForm = document.querySelector("#create-room-form");
  const roomList = document.querySelector("#room-list");
  const refreshButton = document.querySelector("#refresh-button");
  const logoutButton = document.querySelector("#logout-button");

  let currentUser = null;
  let currentProfile = null;

  function showMessage(message, type = "error") {
    lobbyMessage.textContent = message;
    lobbyMessage.className = `auth-message lobby-message is-${type}`;
  }

  function clearMessage() {
    lobbyMessage.textContent = "";
    lobbyMessage.className = "auth-message lobby-message";
  }

  function setButtonLoading(button, isLoading, loadingText = "처리 중...") {
    if (!button.dataset.label) {
      button.dataset.label = button.textContent;
    }

    button.disabled = isLoading;
    button.textContent = isLoading ? loadingText : button.dataset.label;
  }

  function getFriendlyError(error) {
    if (!error) return "알 수 없는 오류가 발생했습니다.";

    const message = error.message || String(error);

    if (error.code || error.details || error.hint) {
      console.error("Supabase error:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
    }

    if (message.includes("Internal Server Error")) {
      return "Supabase 서버 오류가 발생했습니다. 테이블 컬럼 또는 RLS 정책을 확인해주세요.";
    }

    if (message.includes("duplicate key")) {
      return "이미 처리된 요청입니다. 다시 시도해주세요.";
    }

    if (message.includes("row-level security")) {
      return "권한이 없습니다. Supabase RLS 정책을 확인해주세요.";
    }

    return message;
  }

  // 방 코드는 사용자가 읽고 공유하기 쉬운 대문자/숫자 6자리로 만듭니다.
  function createRoomCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";

    for (let index = 0; index < 6; index += 1) {
      const randomIndex = Math.floor(Math.random() * alphabet.length);
      code += alphabet[randomIndex];
    }

    return code;
  }

  function moveToRoom(roomId) {
    window.location.href = `./room.html?roomId=${encodeURIComponent(roomId)}`;
  }

  // lobby.html은 로그인 사용자만 접근할 수 있으므로 세션이 없으면 로그인 화면으로 보냅니다.
  async function requireLogin() {
    const {
      data: { session },
      error,
    } = await supabaseClient.auth.getSession();

    if (error || !session) {
      window.location.href = "./login.html";
      return false;
    }

    currentUser = session.user;
    return true;
  }

  // profiles 테이블에서 현재 사용자의 닉네임을 가져와 헤더에 표시합니다.
  async function loadProfile() {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("username, nickname")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      showMessage(getFriendlyError(error));
      return false;
    }

    if (!data) {
      showMessage("프로필이 없습니다. 다시 회원가입해주세요.");

      // 세션은 있지만 프로필이 없는 깨진 상태이므로 다시 가입/로그인하도록 돌려보냅니다.
      await supabaseClient.auth.signOut();
      window.setTimeout(() => {
        window.location.href = "./login.html";
      }, 1600);

      return false;
    }

    currentProfile = data;
    nicknameElement.textContent = currentProfile.nickname || currentProfile.username;
    return true;
  }

  function renderEmptyRooms(message) {
    roomList.innerHTML = `<p class="empty-state">${message}</p>`;
  }

  function renderRooms(rooms) {
    if (!rooms.length) {
      renderEmptyRooms("아직 생성된 방이 없습니다.");
      return;
    }

    roomList.innerHTML = "";

    rooms.forEach((room) => {
      const item = document.createElement("article");
      item.className = "room-item";

      const info = document.createElement("div");
      info.className = "room-info";

      const title = document.createElement("h3");
      title.textContent = room.title;

      const code = document.createElement("p");
      code.textContent = `코드 ${room.code}`;

      const enterButton = document.createElement("button");
      enterButton.className = "primary-button room-enter-button";
      enterButton.type = "button";
      enterButton.textContent = "입장";
      enterButton.addEventListener("click", () => enterRoom(room.id, enterButton));

      info.append(title, code);
      item.append(info, enterButton);
      roomList.append(item);
    });
  }

  // rooms 테이블에서 방 목록을 가져옵니다.
  async function loadRooms() {
    renderEmptyRooms("방 목록을 불러오는 중입니다.");

    const { data, error } = await supabaseClient
      .from("rooms")
      .select("id, title, code");

    if (error) {
      showMessage(getFriendlyError(error));
      renderEmptyRooms("방 목록을 불러오지 못했습니다.");
      return;
    }

    renderRooms(data || []);
  }

  // 방 생성 후 만든 사용자를 room_members에 admin으로 추가하고 바로 방으로 이동합니다.
  async function createRoom(event) {
    event.preventDefault();
    clearMessage();

    const submitButton = createRoomForm.querySelector('button[type="submit"]');
    const formData = new FormData(createRoomForm);
    const title = formData.get("title").trim();

    if (!title) {
      showMessage("방 제목을 입력해주세요.");
      return;
    }

    setButtonLoading(submitButton, true, "생성 중...");

    const { data: room, error: roomError } = await supabaseClient
      .from("rooms")
      .insert({
        title,
        code: createRoomCode(),
        created_by: currentUser.id,
      })
      .select("id")
      .single();

    if (roomError) {
      setButtonLoading(submitButton, false);
      showMessage(getFriendlyError(roomError));
      return;
    }

    const { error: memberError } = await supabaseClient
      .from("room_members")
      .insert({
        room_id: room.id,
        user_id: currentUser.id,
        role: "admin",
      });

    setButtonLoading(submitButton, false);

    if (memberError) {
      showMessage(getFriendlyError(memberError));
      return;
    }

    moveToRoom(room.id);
  }

  // 이미 참여한 방인지 먼저 확인합니다. 참여 중이면 중복 insert 없이 바로 이동합니다.
  async function getExistingMembership(roomId) {
    const { data, error } = await supabaseClient
      .from("room_members")
      .select("id")
      .eq("room_id", roomId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  async function getMemberCount(roomId) {
    const { count, error } = await supabaseClient
      .from("room_members")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId);

    if (error) {
      throw error;
    }

    return count || 0;
  }

  // 방 정원이 8명인지 확인한 뒤, 새 사용자는 player 역할로 room_members에 추가합니다.
  async function enterRoom(roomId, button) {
    clearMessage();
    setButtonLoading(button, true, "입장 중...");

    try {
      const existingMembership = await getExistingMembership(roomId);

      if (existingMembership) {
        moveToRoom(roomId);
        return;
      }

      const memberCount = await getMemberCount(roomId);

      if (memberCount >= 8) {
        showMessage("이 방은 정원이 가득 찼습니다.");
        setButtonLoading(button, false);
        return;
      }

      const { error } = await supabaseClient.from("room_members").insert({
        room_id: roomId,
        user_id: currentUser.id,
        role: "player",
      });

      if (error) {
        throw error;
      }

      moveToRoom(roomId);
    } catch (error) {
      showMessage(getFriendlyError(error));
      setButtonLoading(button, false);
    }
  }

  async function logout() {
    clearMessage();
    setButtonLoading(logoutButton, true, "로그아웃 중...");

    const { error } = await supabaseClient.auth.signOut();

    setButtonLoading(logoutButton, false);

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    window.location.href = "./login.html";
  }

  function showFlashMessage() {
    const message = sessionStorage.getItem("lobbyFlashMessage");
    const type = sessionStorage.getItem("lobbyFlashType") || "error";

    if (!message) return;

    sessionStorage.removeItem("lobbyFlashMessage");
    sessionStorage.removeItem("lobbyFlashType");
    showMessage(message, type);
  }

  async function initLobby() {
    if (!supabaseClient) {
      showMessage("Supabase 설정을 불러오지 못했습니다.");
      return;
    }

    const isLoggedIn = await requireLogin();

    if (!isLoggedIn) return;

    const hasProfile = await loadProfile();

    if (!hasProfile) return;

    showFlashMessage();
    await loadRooms();
  }

  createRoomForm.addEventListener("submit", createRoom);
  refreshButton.addEventListener("click", loadRooms);
  logoutButton.addEventListener("click", logout);

  initLobby();
})();
