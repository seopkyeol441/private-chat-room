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
  const deleteAccountButton = document.querySelector("#delete-account-button");

  const MAX_PLAYER_COUNT = 8;

  let currentUser = null;
  let currentProfile = null;
  let roomsChannel = null;
  let roomMembersChannel = null;

  function createInternalEmail(username) {
    return `${username}@chat.local`;
  }

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

  function moveToAdmin(roomId) {
    window.location.href = `./admin.html?roomId=${encodeURIComponent(roomId)}`;
  }

  async function getPlayerCountByRoomIds(roomIds) {
    const countMap = new Map(roomIds.map((roomId) => [roomId, 0]));

    if (!roomIds.length) {
      return countMap;
    }

    const { data, error } = await supabaseClient
      .from("room_members")
      .select("room_id")
      .in("room_id", roomIds)
      .eq("role", "player");

    if (error) {
      throw error;
    }

    (data || []).forEach((member) => {
      countMap.set(member.room_id, (countMap.get(member.room_id) || 0) + 1);
    });

    return countMap;
  }

  async function getMyMembershipRoleByRoomIds(roomIds) {
    const roleMap = new Map();

    if (!roomIds.length) {
      return roleMap;
    }

    const { data, error } = await supabaseClient
      .from("room_members")
      .select("room_id, role")
      .in("room_id", roomIds)
      .eq("user_id", currentUser.id);

    if (error) {
      throw error;
    }

    (data || []).forEach((member) => {
      roleMap.set(member.room_id, member.role);
    });

    return roleMap;
  }

  async function addRoomEventMessage(roomId, message) {
    const { error } = await supabaseClient.from("messages").insert({
      room_id: roomId,
      sender_id: currentUser.id,
      receiver_id: null,
      message_type: "global",
      content: JSON.stringify({
        kind: "system",
        text: message,
      }),
    });

    if (error) {
      console.warn("Room event message failed:", error);
    }
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

      const playerCount = Number(room.player_count || 0);
      const isFull = playerCount >= MAX_PLAYER_COUNT;
      const isAlreadyMember = Boolean(room.my_role);

      const code = document.createElement("p");
      code.textContent = `코드 ${room.code}`;

      const count = document.createElement("p");
      count.className = isFull ? "room-player-count is-full" : "room-player-count";
      count.textContent = `플레이어 ${playerCount}/${MAX_PLAYER_COUNT}`;

      const enterButton = document.createElement("button");
      enterButton.className = "primary-button room-enter-button";
      enterButton.type = "button";
      enterButton.textContent = isFull && !isAlreadyMember ? "가득 참" : "입장";
      enterButton.disabled = isFull && !isAlreadyMember;
      enterButton.addEventListener("click", () => enterRoom(room.id, enterButton));

      info.append(title, code, count);
      item.append(info, enterButton);
      roomList.append(item);
    });
  }

  // rooms 테이블에서 방 목록을 가져옵니다.
  async function loadRooms() {
    renderEmptyRooms("방 목록을 불러오는 중입니다.");

    const { data, error } = await supabaseClient.from("rooms").select("id, title, code");

    if (error) {
      showMessage(getFriendlyError(error));
      renderEmptyRooms("방 목록을 불러오지 못했습니다.");
      return;
    }

    try {
      const rooms = data || [];
      const playerCountMap = await getPlayerCountByRoomIds(rooms.map((room) => room.id));
      const myRoleMap = await getMyMembershipRoleByRoomIds(rooms.map((room) => room.id));
      const roomsWithCounts = rooms.map((room) => ({
        ...room,
        player_count: playerCountMap.get(room.id) || 0,
        my_role: myRoleMap.get(room.id) || null,
      }));

      renderRooms(roomsWithCounts);
    } catch (countError) {
      showMessage(getFriendlyError(countError));
      renderRooms((data || []).map((room) => ({ ...room, player_count: 0 })));
    }
  }

  function subscribeRoomsRealtime() {
    if (roomsChannel || roomMembersChannel) return;

    roomsChannel = supabaseClient
      .channel("lobby-rooms")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
        },
        async (payload) => {
          console.log("Lobby rooms realtime changed:", payload);
          await loadRooms();
        }
      )
      .subscribe((status, error) => {
        console.log("Lobby rooms realtime status:", status);

        if (error) {
          console.error("Lobby rooms realtime error:", error);
        }
      });

    roomMembersChannel = supabaseClient
      .channel("lobby-room-members")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
        },
        async (payload) => {
          console.log("Lobby room members realtime changed:", payload);
          await loadRooms();
        }
      )
      .subscribe((status, error) => {
        console.log("Lobby room members realtime status:", status);

        if (error) {
          console.error("Lobby room members realtime error:", error);
        }
      });
  }

  function cleanupRealtime() {
    if (roomsChannel) {
      supabaseClient.removeChannel(roomsChannel);
      roomsChannel = null;
    }

    if (roomMembersChannel) {
      supabaseClient.removeChannel(roomMembersChannel);
      roomMembersChannel = null;
    }
  }

  // 방 생성 후 만든 사용자를 room_members에 admin으로 추가하고 바로 관리자 화면으로 이동합니다.
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

    const { error: memberError } = await supabaseClient.from("room_members").insert({
      room_id: room.id,
      user_id: currentUser.id,
      role: "admin",
    });

    setButtonLoading(submitButton, false);

    if (memberError) {
      showMessage(getFriendlyError(memberError));
      return;
    }

    await addRoomEventMessage(room.id, `${currentProfile.nickname || currentProfile.username}님이 관리자로 방에 들어왔습니다.`);
    moveToAdmin(room.id);
  }

  // 이미 참여한 방인지 먼저 확인합니다. 참여 중이면 중복 insert 없이 바로 이동합니다.
  async function getExistingMembership(roomId) {
    const { data, error } = await supabaseClient
      .from("room_members")
      .select("id, role")
      .eq("room_id", roomId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  }

  async function getPlayerCount(roomId) {
    const { count, error } = await supabaseClient
      .from("room_members")
      .select("id", { count: "exact", head: true })
      .eq("room_id", roomId)
      .eq("role", "player");

    if (error) {
      throw error;
    }

    return count || 0;
  }

  // 관리자를 제외하고 플레이어가 8명인지 확인한 뒤 입장시킵니다.
  async function enterRoom(roomId, button) {
    clearMessage();
    setButtonLoading(button, true, "입장 중...");

    try {
      const existingMembership = await getExistingMembership(roomId);

      if (existingMembership) {
        if (existingMembership.role === "admin") {
          await addRoomEventMessage(roomId, `${currentProfile.nickname || currentProfile.username}님이 관리자로 방에 들어왔습니다.`);
          moveToAdmin(roomId);
        } else {
          await addRoomEventMessage(roomId, `${currentProfile.nickname || currentProfile.username}님이 방에 들어왔습니다.`);
          moveToRoom(roomId);
        }

        return;
      }

      const playerCount = await getPlayerCount(roomId);

      if (playerCount >= MAX_PLAYER_COUNT) {
        showMessage("방이 가득 찼습니다. 플레이어는 최대 8명까지만 입장할 수 있습니다.");
        setButtonLoading(button, false);
        await loadRooms();
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

      await addRoomEventMessage(roomId, `${currentProfile.nickname || currentProfile.username}님이 방에 들어왔습니다.`);
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

  function clearMyLocalGalleryItems() {
    if (!currentUser) return;

    Object.keys(localStorage)
      .filter((key) => key.startsWith(`privateChatGallery:${currentUser.id}:`))
      .forEach((key) => localStorage.removeItem(key));
  }

  async function deleteAccount() {
    clearMessage();

    if (!currentProfile?.username) {
      showMessage("프로필 정보를 찾을 수 없어 회원 탈퇴를 진행할 수 없습니다.");
      return;
    }

    const confirmed = window.confirm(
      "정말로 회원 탈퇴하시겠습니까?\n계정, 프로필, 채팅 기록, 메모, 방 정보가 삭제됩니다."
    );

    if (!confirmed) return;

    const password = window.prompt("회원 탈퇴를 진행하려면 비밀번호를 입력해주세요.");

    if (!password) {
      showMessage("비밀번호를 입력해야 회원 탈퇴를 진행할 수 있습니다.");
      return;
    }

    setButtonLoading(deleteAccountButton, true, "탈퇴 중...");

    const { error: passwordError } = await supabaseClient.auth.signInWithPassword({
      email: createInternalEmail(currentProfile.username),
      password,
    });

    if (passwordError) {
      setButtonLoading(deleteAccountButton, false);
      showMessage("비밀번호가 올바르지 않습니다.");
      return;
    }

    const { error } = await supabaseClient.functions.invoke("delete-user-account", {
      body: { confirm: true },
    });

    if (error) {
      setButtonLoading(deleteAccountButton, false);
      showMessage(
        "회원 탈퇴 서버 함수(delete-user-account)가 필요합니다. Supabase Edge Function 배포 상태를 확인해주세요."
      );
      console.error("Delete account function error:", error);
      return;
    }

    clearMyLocalGalleryItems();
    await supabaseClient.auth.signOut();
    sessionStorage.setItem("lobbyFlashMessage", "");
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
    subscribeRoomsRealtime();
  }

  createRoomForm.addEventListener("submit", createRoom);
  refreshButton.addEventListener("click", loadRooms);
  logoutButton.addEventListener("click", logout);
  deleteAccountButton?.addEventListener("click", deleteAccount);
  window.addEventListener("beforeunload", cleanupRealtime);

  initLobby();
})();
