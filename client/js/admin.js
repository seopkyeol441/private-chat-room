// 관리자 화면 전용 스크립트입니다.
// admin 역할 확인, 전체 채팅, 참가자별 1:1 채팅, Realtime 갱신을 처리합니다.
(() => {
  const supabaseClient = window.supabaseClient;
  const roomTitle = document.querySelector("#admin-room-title");
  const roomCode = document.querySelector("#admin-room-code");
  const adminMessage = document.querySelector("#admin-message");
  const leaveButton = document.querySelector("#leave-admin-room-button");
  const globalMessageList = document.querySelector("#admin-global-message-list");
  const privateMessageList = document.querySelector("#admin-private-message-list");
  const globalMessageForm = document.querySelector("#admin-global-message-form");
  const privateMessageForm = document.querySelector("#admin-private-message-form");
  const memberList = document.querySelector("#admin-member-list");
  const privateDescription = document.querySelector("#admin-private-description");

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId");

  let currentUser = null;
  let currentMember = null;
  let roomMembers = [];
  let profileMap = new Map();
  let selectedUserId = null;
  let messagesChannel = null;
  let membersChannel = null;
  let presenceChannel = null;
  let kickChannel = null;
  let kickChannelReady = false;
  let onlineUserIds = new Set();

  function showMessage(message, type = "error") {
    adminMessage.textContent = message;
    adminMessage.className = `auth-message room-message is-${type}`;
  }

  function clearMessage() {
    adminMessage.textContent = "";
    adminMessage.className = "auth-message room-message";
  }

  function getFriendlyError(error) {
    if (!error) return "알 수 없는 오류가 발생했습니다.";

    if (error.code || error.details || error.hint) {
      console.error("Supabase error:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
    }

    const message = error.message || String(error);

    if (message.includes("row-level security")) {
      return "권한이 없습니다. Supabase RLS 정책을 확인해주세요.";
    }

    return message;
  }

  function getProfileName(userId) {
    const profile = profileMap.get(userId);
    return profile?.nickname || profile?.username || "알 수 없음";
  }

  function getMemberName(member) {
    return getProfileName(member.user_id);
  }

  function isOnline(userId) {
    return onlineUserIds.has(userId);
  }

  function moveToLogin() {
    window.location.href = "./login.html";
  }

  function moveToRoom() {
    cleanupRealtime();
    window.location.href = roomId ? `./room.html?roomId=${encodeURIComponent(roomId)}` : "./lobby.html";
  }

  function moveToLobby() {
    cleanupRealtime();
    window.location.href = "./lobby.html";
  }

  function requireRoomId() {
    if (!roomId) {
      showMessage("방 정보를 찾을 수 없습니다.");
      window.setTimeout(moveToLobby, 800);
      return false;
    }

    return true;
  }

  async function requireLogin() {
    const {
      data: { session },
      error,
    } = await supabaseClient.auth.getSession();

    if (error || !session) {
      moveToLogin();
      return false;
    }

    currentUser = session.user;
    return true;
  }

  // 현재 방에서 admin 역할인지 확인합니다.
  async function requireAdmin() {
    const { data, error } = await supabaseClient
      .from("room_members")
      .select("id, user_id, role")
      .eq("room_id", roomId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (error) {
      showMessage(getFriendlyError(error));
      return false;
    }

    if (!data) {
      showMessage("이 방의 참가자가 아닙니다.");
      window.setTimeout(moveToLobby, 900);
      return false;
    }

    if (data.role !== "admin") {
      showMessage("관리자만 접근할 수 있습니다.");
      window.setTimeout(moveToRoom, 900);
      return false;
    }

    currentMember = data;
    return true;
  }

  async function loadRoom() {
    const { data, error } = await supabaseClient
      .from("rooms")
      .select("id, title, code")
      .eq("id", roomId)
      .maybeSingle();

    if (error) {
      showMessage(getFriendlyError(error));
      return false;
    }

    if (!data) {
      showMessage("방을 찾을 수 없습니다.");
      window.setTimeout(moveToLobby, 900);
      return false;
    }

    roomTitle.textContent = data.title;
    roomCode.textContent = data.code;
    return true;
  }

  async function loadProfiles(userIds) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

    if (!uniqueUserIds.length) return;

    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, username, nickname")
      .in("id", uniqueUserIds);

    if (error) {
      console.error("Profile load error:", error);
      showMessage(getFriendlyError(error));
      return;
    }

    (data || []).forEach((profile) => {
      profileMap.set(profile.id, profile);
    });
  }

  async function loadMembers() {
    const { data, error } = await supabaseClient
      .from("room_members")
      .select("id, user_id, role")
      .eq("room_id", roomId);

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    roomMembers = data || [];
    await loadProfiles(roomMembers.map((member) => member.user_id));
    renderMembers();
  }

  function renderMembers() {
    const participants = roomMembers.filter((member) => member.user_id !== currentUser.id);

    if (!participants.length) {
      selectedUserId = null;
      memberList.innerHTML = '<p class="empty-state">아직 참가자가 없습니다.</p>';
      privateDescription.textContent = "참가자가 들어오면 1:1 채팅을 시작할 수 있습니다.";
      privateMessageList.innerHTML = '<p class="empty-state">참가자를 선택해주세요.</p>';
      privateMessageForm.classList.add("is-disabled");
      return;
    }

    if (!selectedUserId || !participants.some((member) => member.user_id === selectedUserId)) {
      selectedUserId = participants[0].user_id;
    }

    memberList.innerHTML = "";

    participants.forEach((member) => {
      const item = document.createElement("div");
      item.className = "member-item member-row";

      const button = document.createElement("button");
      button.className = "member-select-button";
      button.type = "button";
      button.dataset.userId = member.user_id;

      const name = document.createElement("strong");
      name.textContent = getMemberName(member);

      const role = document.createElement("span");
      role.className = isOnline(member.user_id)
        ? "member-status is-online"
        : "member-status is-offline";
      role.textContent = `${member.role === "admin" ? "관리자" : "플레이어"} · ${
        isOnline(member.user_id) ? "접속 중" : "오프라인"
      }`;

      button.append(name, role);
      button.classList.toggle("is-active", member.user_id === selectedUserId);
      button.addEventListener("click", () => selectParticipant(member.user_id));

      const kickButton = document.createElement("button");
      kickButton.className = "kick-button";
      kickButton.type = "button";
      kickButton.textContent = "추방";
      kickButton.addEventListener("click", () => kickParticipant(member));

      item.append(button, kickButton);
      memberList.append(item);
    });

    updateSelectedParticipant();
  }

  function updateSelectedParticipant() {
    memberList.querySelectorAll(".member-select-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.userId === selectedUserId);
    });

    privateDescription.textContent = `${getProfileName(selectedUserId)}님과의 1:1 채팅입니다.`;
    privateMessageForm.classList.remove("is-disabled");
  }

  function selectParticipant(userId) {
    selectedUserId = userId;
    updateSelectedParticipant();
    loadPrivateMessages();
  }

  async function kickParticipant(member) {
    clearMessage();

    if (!member || !member.id) {
      showMessage("추방할 참가자 정보를 찾을 수 없습니다.");
      return;
    }

    if (member.role === "admin") {
      showMessage("관리자는 추방할 수 없습니다.");
      return;
    }

    const memberName = getMemberName(member);

    const kickMessage = `${memberName}님이 관리자에 의해 추방되었습니다.`;

    // 버튼을 누른 즉시 플레이어 화면에 추방 신호를 보냅니다.
    // DB 삭제 완료를 기다리지 않아야 플레이어가 바로 로비로 이동합니다.
    const kickBroadcastPromise = sendKickBroadcast(member.user_id, kickMessage);

    const { data: deletedMember, error: deleteError } = await supabaseClient
      .from("room_members")
      .delete()
      .eq("id", member.id)
      .eq("room_id", roomId)
      .eq("role", "player")
      .select("id")
      .maybeSingle();

    if (deleteError) {
      showMessage(getFriendlyError(deleteError));
      return;
    }

    if (!deletedMember) {
      showMessage("추방 처리에 실패했습니다. Supabase RLS에서 관리자의 room_members 삭제 권한을 확인해주세요.");
      return;
    }

    await kickBroadcastPromise;

    const { error: messageError } = await supabaseClient.from("messages").insert({
      room_id: roomId,
      sender_id: currentUser.id,
      receiver_id: null,
      message_type: "global",
      content: kickMessage,
    });

    if (messageError) {
      showMessage(getFriendlyError(messageError));
      return;
    }

    if (selectedUserId === member.user_id) {
      selectedUserId = null;
    }

    showMessage(`${memberName}님을 추방했습니다.`, "success");
    await loadMembers();
    await loadPrivateMessages();
  }

  async function sendKickBroadcast(userId, message) {
    if (!kickChannel) return;

    if (!kickChannelReady) {
      await waitForKickChannel();
    }

    const response = await kickChannel.send({
      type: "broadcast",
      event: "player-kicked",
      payload: {
        room_id: roomId,
        user_id: userId,
        message: `${message} 잠시 후 로비로 이동합니다.`,
      },
    });

    console.log("Admin kick broadcast response:", response);
  }

  async function waitForKickChannel() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (kickChannelReady) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    console.warn("Kick broadcast channel is not ready yet.");
    return false;
  }

  function createMessageElement(message) {
    const item = document.createElement("article");
    const isMine = message.sender_id === currentUser.id;
    item.className = `chat-message${isMine ? " is-mine" : ""}`;

    const author = document.createElement("strong");
    author.textContent = isMine ? "나" : getProfileName(message.sender_id);

    const content = document.createElement("p");
    content.textContent = message.content;

    item.append(author, content);
    return item;
  }

  function renderMessages(container, messages, emptyMessage) {
    if (!messages.length) {
      container.innerHTML = `<p class="empty-state">${emptyMessage}</p>`;
      return;
    }

    container.innerHTML = "";
    messages.forEach((message) => {
      container.append(createMessageElement(message));
    });
    container.scrollTop = container.scrollHeight;
  }

  async function loadGlobalMessages() {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, sender_id, receiver_id, message_type, content, created_at")
      .eq("room_id", roomId)
      .eq("message_type", "global")
      .order("created_at", { ascending: true });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await loadProfiles((data || []).map((message) => message.sender_id));
    renderMessages(globalMessageList, data || [], "아직 전체 메시지가 없습니다.");
  }

  async function loadPrivateMessages() {
    if (!selectedUserId) {
      privateMessageList.innerHTML = '<p class="empty-state">참가자를 선택해주세요.</p>';
      return;
    }

    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, sender_id, receiver_id, message_type, content, created_at")
      .eq("room_id", roomId)
      .eq("message_type", "private")
      .or(
        `and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${currentUser.id})`
      )
      .order("created_at", { ascending: true });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await loadProfiles((data || []).map((message) => message.sender_id));
    renderMessages(privateMessageList, data || [], "아직 개인 메시지가 없습니다.");
  }

  async function sendGlobalMessage(event) {
    event.preventDefault();
    clearMessage();

    const formData = new FormData(globalMessageForm);
    const content = formData.get("content").trim();

    if (!content) return;

    const { error } = await supabaseClient.from("messages").insert({
      room_id: roomId,
      sender_id: currentUser.id,
      receiver_id: null,
      message_type: "global",
      content,
    });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    globalMessageForm.reset();
  }

  async function sendPrivateMessage(event) {
    event.preventDefault();
    clearMessage();

    if (!selectedUserId) {
      showMessage("개인 메시지를 보낼 참가자를 선택해주세요.");
      return;
    }

    const formData = new FormData(privateMessageForm);
    const content = formData.get("content").trim();

    if (!content) return;

    const { error } = await supabaseClient.from("messages").insert({
      room_id: roomId,
      sender_id: currentUser.id,
      receiver_id: selectedUserId,
      message_type: "private",
      content,
    });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    privateMessageForm.reset();
  }

  function subscribeRealtime() {
    messagesChannel = supabaseClient
      .channel(`admin-messages-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          console.log("Admin realtime message INSERT:", payload.new);
          await loadGlobalMessages();
          await loadPrivateMessages();
        }
      )
      .subscribe((status, error) => {
        console.log("Admin messages realtime status:", status);

        if (error) {
          console.error("Admin messages realtime error:", error);
        }
      });

    membersChannel = supabaseClient
      .channel(`admin-members-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_members",
          filter: `room_id=eq.${roomId}`,
        },
        async () => {
          await loadMembers();
          await loadPrivateMessages();
        }
      )
      .subscribe((status, error) => {
        console.log("Admin members realtime status:", status);

        if (error) {
          console.error("Admin members realtime error:", error);
        }
      });

    presenceChannel = supabaseClient
      .channel(`room-presence-${roomId}`, {
        config: {
          presence: {
            key: currentUser.id,
          },
        },
      })
      .on("presence", { event: "sync" }, () => {
        const presenceState = presenceChannel.presenceState();
        onlineUserIds = new Set(Object.keys(presenceState));

        console.log("Admin presence online users:", [...onlineUserIds]);
        renderMembers();
      })
      .on("presence", { event: "join" }, ({ key }) => {
        console.log("Admin presence joined:", key);
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        console.log("Admin presence left:", key);
      })
      .subscribe(async (status, error) => {
        console.log("Admin presence status:", status);

        if (error) {
          console.error("Admin presence error:", error);
        }

        if (status === "SUBSCRIBED") {
          await presenceChannel.track({
            user_id: currentUser.id,
            room_id: roomId,
            online_at: new Date().toISOString(),
          });
        }
      });

    kickChannel = supabaseClient
      .channel(`room-kicks-${roomId}`)
      .subscribe((status, error) => {
        console.log("Admin kick broadcast status:", status);

        if (status === "SUBSCRIBED") {
          kickChannelReady = true;
        }

        if (error) {
          console.error("Admin kick broadcast error:", error);
        }
      });
  }

  function cleanupRealtime() {
    if (messagesChannel) {
      supabaseClient.removeChannel(messagesChannel);
      messagesChannel = null;
    }

    if (membersChannel) {
      supabaseClient.removeChannel(membersChannel);
      membersChannel = null;
    }

    if (presenceChannel) {
      supabaseClient.removeChannel(presenceChannel);
      presenceChannel = null;
      onlineUserIds = new Set();
    }

    if (kickChannel) {
      supabaseClient.removeChannel(kickChannel);
      kickChannel = null;
      kickChannelReady = false;
    }
  }

  async function initAdmin() {
    if (!supabaseClient) {
      showMessage("Supabase 설정을 불러오지 못했습니다.");
      return;
    }

    if (!requireRoomId()) return;

    const isLoggedIn = await requireLogin();
    if (!isLoggedIn) return;

    const isAdmin = await requireAdmin();
    if (!isAdmin) return;

    const hasRoom = await loadRoom();
    if (!hasRoom) return;

    await loadMembers();
    await loadGlobalMessages();
    await loadPrivateMessages();
    subscribeRealtime();
  }

  globalMessageForm.addEventListener("submit", sendGlobalMessage);
  privateMessageForm.addEventListener("submit", sendPrivateMessage);
  leaveButton.addEventListener("click", moveToLobby);
  window.addEventListener("beforeunload", cleanupRealtime);

  initAdmin();
})();
