// 방 화면 전용 스크립트입니다.
// 방 입장 권한 확인, 전체 채팅, 개인 채팅, 개인 메모, Realtime 갱신을 담당합니다.
(() => {
  const supabaseClient = window.supabaseClient;
  const roomTitle = document.querySelector("#room-title");
  const roomCode = document.querySelector("#room-code");
  const roomMessage = document.querySelector("#room-message");
  const adminPageButton = document.querySelector("#admin-page-button");
  const leaveRoomButton = document.querySelector("#leave-room-button");
  const changeNicknameButton = document.querySelector("#change-nickname-button");
  const globalMessageList = document.querySelector("#global-message-list");
  const privateMessageList = document.querySelector("#private-message-list");
  const globalMessageForm = document.querySelector("#global-message-form");
  const globalImagePreview = document.querySelector("#global-image-preview");
  const privateMessageForm = document.querySelector("#private-message-form");
  const privateImagePreview = document.querySelector("#private-image-preview");
  const participantList = document.querySelector("#participant-list");
  const memberList = document.querySelector("#member-list");
  const privateChatDescription = document.querySelector("#private-chat-description");
  const noteBody = document.querySelector("#note-body");
  const noteWindowHeader = document.querySelector("#note-window-header");
  const noteResizeHandle = document.querySelector("#note-resize-handle");
  const toggleNoteButton = document.querySelector("#toggle-note-button");
  const toggleGalleryButton = document.querySelector("#toggle-gallery-button");
  const galleryBody = document.querySelector("#gallery-body");
  const galleryList = document.querySelector("#gallery-list");
  const closeGalleryButton = document.querySelector("#close-gallery-button");
  const closeNoteButton = document.querySelector("#close-note-button");
  const privateNote = document.querySelector("#private-note");
  const saveNoteButton = document.querySelector("#save-note-button");

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId");

  let currentUser = null;
  let currentMember = null;
  let currentRoom = null;
  let roomMembers = [];
  let profileMap = new Map();
  let selectedPrivateUserId = null;
  let noteRowId = null;
  let messagesChannel = null;
  let membersChannel = null;
  let presenceChannel = null;
  let kickChannel = null;
  let chatActionsChannel = null;
  let chatActionsChannelReady = false;
  let onlineUserIds = new Set();
  let noteWindowPosition = null;
  let hasBeenKicked = false;

  function showMessage(message, type = "error") {
    roomMessage.textContent = message;
    roomMessage.className = `auth-message room-message is-${type}`;
  }

  function clearMessage() {
    roomMessage.textContent = "";
    roomMessage.className = "auth-message room-message";
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

    if (message.includes("row-level security")) {
      return "권한이 없습니다. Supabase RLS 정책을 확인해주세요.";
    }

    if (message.includes("duplicate key")) {
      return "이미 저장된 데이터입니다.";
    }

    return message;
  }

  function setButtonLoading(button, isLoading, loadingText = "처리 중...") {
    if (!button.dataset.label) {
      button.dataset.label = button.textContent;
    }

    button.disabled = isLoading;
    button.textContent = isLoading ? loadingText : button.dataset.label;
  }

  function getProfileName(userId) {
    const profile = profileMap.get(userId);
    return profile?.nickname || profile?.username || "알 수 없음";
  }

  async function refreshProfile(userId) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, username, nickname")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    if (data) {
      profileMap.set(data.id, data);
    }
  }

  function isAdmin() {
    return currentMember?.role === "admin";
  }

  function isOnline(userId) {
    return onlineUserIds.has(userId);
  }

  function moveToLogin() {
    window.location.href = "./login.html";
  }

  function moveToLobby() {
    cleanupRealtime();
    window.location.href = "./lobby.html";
  }

  // URL에 roomId가 없으면 어떤 방인지 알 수 없으므로 로비로 돌려보냅니다.
  function requireRoomId() {
    if (!roomId) {
      showMessage("방 정보를 찾을 수 없습니다.");
      window.setTimeout(moveToLobby, 800);
      return false;
    }

    return true;
  }

  // 로그인 세션이 없으면 방 접근을 막습니다.
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

  // 현재 사용자가 room_members에 없으면 방에 들어올 권한이 없으므로 로비로 보냅니다.
  async function requireMembership() {
    const { data, error } = await supabaseClient
      .from("room_members")
      .select("id, room_id, user_id, role")
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

    currentMember = data;
    updateAdminButton();
    return true;
  }

  // 방 생성자는 room_members.role이 admin으로 저장됩니다.
  // 현재 사용자가 admin일 때만 관리자 전용 화면으로 이동하는 버튼을 보여줍니다.
  function updateAdminButton() {
    const shouldShowAdminButton = currentMember?.role === "admin";
    adminPageButton.classList.toggle("is-hidden", !shouldShowAdminButton);
  }

  function moveToAdminPage() {
    window.location.href = `./admin.html?roomId=${encodeURIComponent(roomId)}`;
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

    currentRoom = data;
    roomTitle.textContent = currentRoom.title;
    roomCode.textContent = currentRoom.code;
    return true;
  }

  async function loadProfiles(userIds) {
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];

    if (!uniqueUserIds.length) {
      return;
    }

    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, username, nickname")
      .in("id", uniqueUserIds);

    if (error) {
      console.error("Profile load error:", error);
      showMessage(getFriendlyError(error));
      return;
    }

    // 기존 프로필 맵을 유지하면서 새로 읽은 프로필만 갱신합니다.
    // 메시지 목록을 다시 불러올 때 참가자 닉네임이 사라지지 않도록 하기 위함입니다.
    (data || []).forEach((profile) => {
      profileMap.set(profile.id, profile);
    });

    const missingProfileIds = uniqueUserIds.filter((userId) => !profileMap.has(userId));

    if (missingProfileIds.length) {
      console.warn("Profiles not found or blocked by RLS:", missingProfileIds);
    }
  }

  async function loadMembers() {
    const { data, error } = await supabaseClient
      .from("room_members")
      .select("id, user_id, role")
      .eq("room_id", roomId);

    if (error) {
      showMessage(getFriendlyError(error));
      return false;
    }

    roomMembers = data || [];

    const isStillMember = roomMembers.some((member) => member.user_id === currentUser.id);

    // 관리자가 현재 사용자를 추방하면 room_members에서 행이 삭제됩니다.
    // Realtime으로 그 변화를 감지한 뒤 안내 메시지를 보여주고 로비로 이동시킵니다.
    if (currentMember && !isStillMember) {
      await handleKickedFromRoom();
      return false;
    }

    await loadProfiles(roomMembers.map((member) => member.user_id));
    renderMemberList();
    renderPrivateChatSelector();
    return true;
  }

  async function handleKickedFromRoom(message = "관리자에 의해 방에서 추방되었습니다.") {
    if (hasBeenKicked) return;

    hasBeenKicked = true;
    currentMember = null;

    await loadGlobalMessages();
    showMessage(message);
    sessionStorage.setItem("lobbyFlashMessage", message);
    sessionStorage.setItem("lobbyFlashType", "error");
    globalMessageForm.classList.add("is-disabled");
    privateMessageForm.classList.add("is-disabled");
    leaveRoomButton.disabled = true;

    window.setTimeout(() => {
      window.alert(message);
      moveToLobby();
    }, 50);
  }

  function renderMemberList() {
    if (!roomMembers.length) {
      memberList.innerHTML = '<p class="empty-state">참가자가 없습니다.</p>';
      return;
    }

    memberList.innerHTML = "";

    roomMembers.forEach((member) => {
      const item = document.createElement("div");
      item.className = "member-item";

      const name = document.createElement("strong");
      name.textContent =
        member.user_id === currentUser.id ? `${getProfileName(member.user_id)} (나)` : getProfileName(member.user_id);

      const role = document.createElement("span");
      role.className = isOnline(member.user_id)
        ? "member-status is-online"
        : "member-status is-offline";
      role.textContent = `${member.role === "admin" ? "관리자" : "플레이어"} · ${
        isOnline(member.user_id) ? "접속 중" : "오프라인"
      }`;

      item.append(name, role);
      memberList.append(item);
    });
  }

  function renderPrivateChatSelector() {
    participantList.innerHTML = "";

    if (isAdmin()) {
      const participants = roomMembers.filter(
        (member) => member.user_id !== currentUser.id && member.role !== "admin"
      );

      privateChatDescription.textContent = "참가자를 선택하면 1:1 채팅이 열립니다.";

      if (!participants.length) {
        participantList.innerHTML = '<p class="empty-state">아직 참가자가 없습니다.</p>';
        selectedPrivateUserId = null;
        renderEmptyPrivateMessages("참가자를 선택해주세요.");
        privateMessageForm.classList.add("is-disabled");
        return;
      }

      participants.forEach((member) => {
        const button = document.createElement("button");
        button.className = "participant-button";
        button.type = "button";
        button.dataset.userId = member.user_id;
        button.textContent = `${getProfileName(member.user_id)} · ${
          isOnline(member.user_id) ? "접속 중" : "오프라인"
        }`;
        button.classList.toggle("is-active", member.user_id === selectedPrivateUserId);
        button.addEventListener("click", () => selectPrivateUser(member.user_id));
        participantList.append(button);
      });

      if (!selectedPrivateUserId || !participants.some((member) => member.user_id === selectedPrivateUserId)) {
        selectedPrivateUserId = participants[0].user_id;
      }

      updateActiveParticipant();
      loadPrivateMessages();
      return;
    }

    const admin = roomMembers.find((member) => member.role === "admin");

    if (!admin) {
      selectedPrivateUserId = null;
      privateChatDescription.textContent = "관리자가 아직 없습니다.";
      renderEmptyPrivateMessages("관리자가 없어 개인 채팅을 시작할 수 없습니다.");
      privateMessageForm.classList.add("is-disabled");
      return;
    }

    selectedPrivateUserId = admin.user_id;
    privateChatDescription.textContent = `관리자 ${getProfileName(admin.user_id)}님과의 1:1 채팅입니다.`;
    privateMessageForm.classList.remove("is-disabled");
    loadPrivateMessages();
  }

  function updateActiveParticipant() {
    participantList.querySelectorAll(".participant-button").forEach((button) => {
      button.classList.toggle(
        "is-active",
        button.dataset.userId === selectedPrivateUserId
      );
    });

    privateChatDescription.textContent = `${getProfileName(selectedPrivateUserId)}님과의 1:1 채팅입니다.`;
    privateMessageForm.classList.remove("is-disabled");
  }

  function selectPrivateUser(userId) {
    selectedPrivateUserId = userId;
    updateActiveParticipant();
    loadPrivateMessages();
  }

  function renderEmptyGlobalMessages(message) {
    globalMessageList.innerHTML = `<p class="empty-state">${message}</p>`;
  }

  function renderEmptyPrivateMessages(message) {
    privateMessageList.innerHTML = `<p class="empty-state">${message}</p>`;
  }

  function createMessageElement(message) {
    const item = document.createElement("article");
    const isMine = message.sender_id === currentUser.id;
    item.className = `chat-message${isMine ? " is-mine" : ""}`;
    const parsedMessage = parseMessageContent(message.content);

    const messageHeader = document.createElement("div");
    messageHeader.className = "message-header";

    const author = document.createElement("strong");
    author.textContent = isMine ? "나" : getProfileName(message.sender_id);

    messageHeader.append(author);

    if (isMine) {
      const deleteButton = document.createElement("button");
      deleteButton.className = "message-delete-button";
      deleteButton.type = "button";
      deleteButton.textContent = "×";
      deleteButton.setAttribute("aria-label", "메시지 삭제");
      deleteButton.addEventListener("click", () => deleteMessage(message.id));
      messageHeader.append(deleteButton);
    }

    const content = createMessageContentElement(parsedMessage);

    item.append(messageHeader, content);
    return item;
  }

  function parseMessageContent(content) {
    try {
      const parsed = JSON.parse(content);

      if (parsed?.kind === "image" && parsed.src) {
        return parsed;
      }
    } catch (error) {
      // 기존 텍스트 메시지는 JSON이 아니므로 그대로 표시합니다.
    }

    return { kind: "text", text: content };
  }

  function createMessageContentElement(messageContent) {
    if (messageContent.kind === "image") {
      const wrapper = document.createElement("div");
      wrapper.className = "chat-image-message";

      const image = document.createElement("img");
      image.src = messageContent.src;
      image.alt = messageContent.name || "채팅 이미지";
      image.loading = "lazy";

      wrapper.append(image);

      const actions = document.createElement("div");
      actions.className = "chat-image-actions";

      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.textContent = "보기";
      viewButton.addEventListener("click", () => {
        window.open(messageContent.src, "_blank", "noopener");
      });

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "저장";
      downloadButton.addEventListener("click", () => downloadChatImage(messageContent));

      const keepButton = document.createElement("button");
      keepButton.type = "button";
      keepButton.textContent = "보관";
      keepButton.addEventListener("click", () => saveImageToGallery(messageContent));

      actions.append(viewButton, downloadButton, keepButton);
      wrapper.append(actions);

      if (messageContent.text) {
        const caption = document.createElement("p");
        caption.textContent = messageContent.text;
        wrapper.append(caption);
      }

      return wrapper;
    }

    const content = document.createElement("p");
    content.textContent = messageContent.text;
    return content;
  }

  function downloadChatImage(messageContent) {
    const link = document.createElement("a");
    const fileName = messageContent.name || `chat-image-${Date.now()}.jpg`;

    link.href = messageContent.src;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function getGalleryStorageKey() {
    return `privateChatGallery:${currentUser.id}:${roomId}`;
  }

  function getGalleryItems() {
    try {
      return JSON.parse(localStorage.getItem(getGalleryStorageKey())) || [];
    } catch (error) {
      return [];
    }
  }

  function saveGalleryItems(items) {
    localStorage.setItem(getGalleryStorageKey(), JSON.stringify(items));
  }

  function saveImageToGallery(messageContent) {
    const items = getGalleryItems();
    const alreadySaved = items.some((item) => item.src === messageContent.src);

    if (alreadySaved) {
      showMessage("이미 사진 보관함에 저장된 사진입니다.");
      return;
    }

    items.unshift({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      src: messageContent.src,
      name: messageContent.name || `chat-image-${Date.now()}.jpg`,
      text: messageContent.text || "",
      savedAt: new Date().toISOString(),
    });

    saveGalleryItems(items);
    renderGallery();
    showMessage("사진 보관함에 저장했습니다.", "success");
  }

  function renderGallery() {
    const items = getGalleryItems();

    if (!items.length) {
      galleryList.innerHTML = '<p class="empty-state">보관한 사진이 없습니다.</p>';
      return;
    }

    galleryList.innerHTML = "";

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "gallery-item";

      const image = document.createElement("img");
      image.src = item.src;
      image.alt = item.name || "보관한 사진";
      image.loading = "lazy";

      const actions = document.createElement("div");
      actions.className = "gallery-actions";

      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.textContent = "보기";
      viewButton.addEventListener("click", () => {
        window.open(item.src, "_blank", "noopener");
      });

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "저장";
      downloadButton.addEventListener("click", () => downloadChatImage(item));

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "삭제";
      removeButton.addEventListener("click", () => removeImageFromGallery(item.id));

      actions.append(viewButton, downloadButton, removeButton);
      card.append(image, actions);
      galleryList.append(card);
    });
  }

  function removeImageFromGallery(itemId) {
    const items = getGalleryItems().filter((item) => item.id !== itemId);

    saveGalleryItems(items);
    renderGallery();
  }

  function toggleGallery() {
    const shouldOpen = galleryBody.classList.contains("is-hidden");

    if (shouldOpen) {
      renderGallery();
    }

    galleryBody.classList.toggle("is-hidden", !shouldOpen);
  }

  function closeGallery() {
    galleryBody.classList.add("is-hidden");
  }

  function resizeImageFile(file, maxSize = 900, quality = 0.78) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.addEventListener("error", () => reject(new Error("이미지를 읽지 못했습니다.")));
      reader.addEventListener("load", () => {
        const image = new Image();

        image.addEventListener("error", () => reject(new Error("이미지를 불러오지 못했습니다.")));
        image.addEventListener("load", () => {
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");

          canvas.width = width;
          canvas.height = height;
          context.drawImage(image, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        });

        image.src = reader.result;
      });

      reader.readAsDataURL(file);
    });
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
      renderEmptyGlobalMessages("전체 채팅을 불러오지 못했습니다.");
      return;
    }

    await loadProfiles([
      ...new Set([...(data || []).map((message) => message.sender_id), ...roomMembers.map((member) => member.user_id)]),
    ]);
    renderMessages(globalMessageList, data || [], "아직 전체 메시지가 없습니다.");
  }

  async function loadPrivateMessages() {
    if (!selectedPrivateUserId) {
      renderEmptyPrivateMessages("개인 채팅 상대가 없습니다.");
      return;
    }

    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, sender_id, receiver_id, message_type, content, created_at")
      .eq("room_id", roomId)
      .eq("message_type", "private")
      .or(
        `and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedPrivateUserId}),and(sender_id.eq.${selectedPrivateUserId},receiver_id.eq.${currentUser.id})`
      )
      .order("created_at", { ascending: true });

    if (error) {
      showMessage(getFriendlyError(error));
      renderEmptyPrivateMessages("개인 채팅을 불러오지 못했습니다.");
      return;
    }

    renderMessages(privateMessageList, data || [], "아직 개인 메시지가 없습니다.");
  }

  async function deleteMessage(messageId) {
    clearMessage();

    const { error } = await supabaseClient
      .from("messages")
      .delete()
      .eq("id", messageId)
      .eq("room_id", roomId)
      .eq("sender_id", currentUser.id);

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await sendMessageDeletedBroadcast(messageId);
    await loadGlobalMessages();
    await loadPrivateMessages();
  }

  async function sendMessageDeletedBroadcast(messageId) {
    if (!chatActionsChannel) return;

    if (!chatActionsChannelReady) {
      await waitForChatActionsChannel();
    }

    const response = await chatActionsChannel.send({
      type: "broadcast",
      event: "message-deleted",
      payload: {
        room_id: roomId,
        message_id: messageId,
        deleted_by: currentUser.id,
        deleted_at: new Date().toISOString(),
      },
    });

    console.log("Room message deleted broadcast response:", response);
  }

  async function sendMessageSentBroadcast(messageType = "global") {
    if (!chatActionsChannel) return;

    if (!chatActionsChannelReady) {
      await waitForChatActionsChannel();
    }

    const response = await chatActionsChannel.send({
      type: "broadcast",
      event: "message-sent",
      payload: {
        room_id: roomId,
        message_type: messageType,
        sent_by: currentUser.id,
        sent_at: new Date().toISOString(),
      },
    });

    console.log("Room message sent broadcast response:", response);
  }

  async function waitForChatActionsChannel() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (chatActionsChannelReady) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    console.warn("Room chat actions broadcast channel is not ready yet.");
    return false;
  }

  async function changeNickname() {
    clearMessage();

    const currentNickname = getProfileName(currentUser.id);
    const nickname = window.prompt("새 닉네임을 입력하세요.", currentNickname)?.trim();

    if (!nickname || nickname === currentNickname) return;

    if (nickname.length > 20) {
      showMessage("닉네임은 20자 이하로 입력해주세요.");
      return;
    }

    changeNicknameButton.disabled = true;
    changeNicknameButton.textContent = "변경 중...";

    const { data, error } = await supabaseClient
      .from("profiles")
      .update({ nickname })
      .eq("id", currentUser.id)
      .select("id, username, nickname")
      .maybeSingle();

    changeNicknameButton.disabled = false;
    changeNicknameButton.textContent = "닉네임 변경";

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    if (data) {
      profileMap.set(data.id, data);
    }

    await sendNicknameUpdatedBroadcast(currentUser.id);
    renderMemberList();
    renderPrivateChatSelector();
    await loadGlobalMessages();
    await loadPrivateMessages();
    showMessage("닉네임을 변경했습니다.", "success");
  }

  async function sendNicknameUpdatedBroadcast(userId) {
    if (!chatActionsChannel) return;

    if (!chatActionsChannelReady) {
      await waitForChatActionsChannel();
    }

    const response = await chatActionsChannel.send({
      type: "broadcast",
      event: "nickname-updated",
      payload: {
        room_id: roomId,
        user_id: userId,
        updated_at: new Date().toISOString(),
      },
    });

    console.log("Room nickname updated broadcast response:", response);
  }

  async function sendGlobalMessage(event) {
    event.preventDefault();
    clearMessage();

    const formData = new FormData(globalMessageForm);
    const content = formData.get("content").trim();
    const imageFile = formData.get("image");

    if (!content && (!imageFile || !imageFile.size)) return;

    let messageContent = content;

    if (imageFile && imageFile.size) {
      if (!imageFile.type.startsWith("image/")) {
        showMessage("이미지 파일만 보낼 수 있습니다.");
        return;
      }

      const imageDataUrl = await resizeImageFile(imageFile);
      messageContent = JSON.stringify({
        kind: "image",
        src: imageDataUrl,
        name: imageFile.name,
        text: content,
      });
    }

    const { error } = await supabaseClient.from("messages").insert({
      room_id: roomId,
      sender_id: currentUser.id,
      receiver_id: null,
      message_type: "global",
      content: messageContent,
    });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await sendMessageSentBroadcast("global");
    globalMessageForm.reset();
    clearGlobalImagePreview();
  }

  function getGlobalImageInput() {
    return globalMessageForm.querySelector('input[name="image"]');
  }

  function setGlobalImageFile(file, sourceLabel) {
    if (!file || !file.type.startsWith("image/")) return false;

    const imageInput = getGlobalImageInput();
    const dataTransfer = new DataTransfer();

    dataTransfer.items.add(file);
    imageInput.files = dataTransfer.files;
    renderGlobalImagePreview(file);
    showMessage(`${sourceLabel}한 사진이 선택되었습니다. 전송 버튼을 눌러 보내세요.`, "success");
    return true;
  }

  function renderGlobalImagePreview(file) {
    const previewUrl = URL.createObjectURL(file);

    globalImagePreview.innerHTML = "";
    globalImagePreview.classList.remove("is-hidden");

    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = "전송할 사진 미리보기";
    image.addEventListener("load", () => URL.revokeObjectURL(previewUrl), { once: true });

    const info = document.createElement("span");
    info.textContent = `${file.name || "붙여넣은 사진"} 선택됨`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "제거";
    removeButton.addEventListener("click", clearGlobalImageSelection);

    globalImagePreview.append(image, info, removeButton);
  }

  function clearGlobalImagePreview() {
    globalImagePreview.innerHTML = "";
    globalImagePreview.classList.add("is-hidden");
  }

  function clearGlobalImageSelection() {
    getGlobalImageInput().value = "";
    clearGlobalImagePreview();
  }

  function handleGlobalImageChange(event) {
    const file = event.target.files?.[0];

    if (file) {
      renderGlobalImagePreview(file);
    } else {
      clearGlobalImagePreview();
    }
  }

  function handleGlobalPaste(event) {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));

    if (setGlobalImageFile(file, "붙여넣기")) {
      event.preventDefault();
    }
  }

  function handleGlobalDragOver(event) {
    event.preventDefault();
    globalMessageList.classList.add("is-drag-over");
  }

  function handleGlobalDragLeave() {
    globalMessageList.classList.remove("is-drag-over");
  }

  function handleGlobalDrop(event) {
    event.preventDefault();
    globalMessageList.classList.remove("is-drag-over");

    const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));

    if (!setGlobalImageFile(file, "드래그")) {
      showMessage("이미지 파일만 드래그해서 넣을 수 있습니다.");
    }
  }

  function getPrivateImageInput() {
    return privateMessageForm.querySelector('input[name="image"]');
  }

  function setPrivateImageFile(file, sourceLabel) {
    if (!file || !file.type.startsWith("image/")) return false;

    const imageInput = getPrivateImageInput();
    const dataTransfer = new DataTransfer();

    dataTransfer.items.add(file);
    imageInput.files = dataTransfer.files;
    renderPrivateImagePreview(file);
    showMessage(`${sourceLabel}한 사진이 선택되었습니다. 전송 버튼을 눌러 보내세요.`, "success");
    return true;
  }

  function renderPrivateImagePreview(file) {
    const previewUrl = URL.createObjectURL(file);

    privateImagePreview.innerHTML = "";
    privateImagePreview.classList.remove("is-hidden");

    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = "전송할 사진 미리보기";
    image.addEventListener("load", () => URL.revokeObjectURL(previewUrl), { once: true });

    const info = document.createElement("span");
    info.textContent = `${file.name || "붙여넣은 사진"} 선택됨`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "제거";
    removeButton.addEventListener("click", clearPrivateImageSelection);

    privateImagePreview.append(image, info, removeButton);
  }

  function clearPrivateImagePreview() {
    privateImagePreview.innerHTML = "";
    privateImagePreview.classList.add("is-hidden");
  }

  function clearPrivateImageSelection() {
    getPrivateImageInput().value = "";
    clearPrivateImagePreview();
  }

  function handlePrivateImageChange(event) {
    const file = event.target.files?.[0];

    if (file) {
      renderPrivateImagePreview(file);
    } else {
      clearPrivateImagePreview();
    }
  }

  function handlePrivatePaste(event) {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));

    if (setPrivateImageFile(file, "붙여넣기")) {
      event.preventDefault();
    }
  }

  function handlePrivateDragOver(event) {
    event.preventDefault();
    privateMessageList.classList.add("is-drag-over");
  }

  function handlePrivateDragLeave() {
    privateMessageList.classList.remove("is-drag-over");
  }

  function handlePrivateDrop(event) {
    event.preventDefault();
    privateMessageList.classList.remove("is-drag-over");

    const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));

    if (!setPrivateImageFile(file, "드래그")) {
      showMessage("이미지 파일만 드래그해서 넣을 수 있습니다.");
    }
  }

  async function sendPrivateMessage(event) {
    event.preventDefault();
    clearMessage();

    if (!selectedPrivateUserId) {
      showMessage("개인 채팅 상대를 선택해주세요.");
      return;
    }

    const formData = new FormData(privateMessageForm);
    const content = formData.get("content").trim();
    const imageFile = formData.get("image");

    if (!content && (!imageFile || !imageFile.size)) return;

    let messageContent = content;

    if (imageFile && imageFile.size) {
      if (!imageFile.type.startsWith("image/")) {
        showMessage("이미지 파일만 보낼 수 있습니다.");
        return;
      }

      const imageDataUrl = await resizeImageFile(imageFile);
      messageContent = JSON.stringify({
        kind: "image",
        src: imageDataUrl,
        name: imageFile.name,
        text: content,
      });
    }

    const { error } = await supabaseClient.from("messages").insert({
      room_id: roomId,
      sender_id: currentUser.id,
      receiver_id: selectedPrivateUserId,
      message_type: "private",
      content: messageContent,
    });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await sendMessageSentBroadcast("private");
    privateMessageForm.reset();
    clearPrivateImagePreview();
  }

  async function loadPrivateNote() {
    const { data, error } = await supabaseClient
      .from("private_notes")
      .select("id, content")
      .eq("room_id", roomId)
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    noteRowId = data?.id || null;
    privateNote.value = data?.content || "";
  }

  async function savePrivateNote() {
    clearMessage();
    setButtonLoading(saveNoteButton, true, "저장 중...");

    const payload = {
      room_id: roomId,
      user_id: currentUser.id,
      content: privateNote.value,
    };

    // room_id + user_id 유니크 제약이 있으면 upsert가 가장 깔끔합니다.
    // 제약이 없는 경우를 대비해, 실패하면 기존 행 update 또는 새 insert로 한 번 더 저장합니다.
    const { error: upsertError } = await supabaseClient
      .from("private_notes")
      .upsert(payload, { onConflict: "room_id,user_id" });

    if (!upsertError) {
      setButtonLoading(saveNoteButton, false);
      showMessage("메모를 저장했습니다.", "success");
      await loadPrivateNote();
      return;
    }

    const fallbackQuery = noteRowId
      ? supabaseClient.from("private_notes").update(payload).eq("id", noteRowId)
      : supabaseClient.from("private_notes").insert(payload);

    const { error: fallbackError } = await fallbackQuery;

    setButtonLoading(saveNoteButton, false);

    if (fallbackError) {
      showMessage(getFriendlyError(fallbackError));
      return;
    }

    showMessage("메모를 저장했습니다.", "success");
    await loadPrivateNote();
  }

  function togglePrivateNote() {
    const isOpening = noteBody.classList.contains("is-hidden");

    noteBody.classList.toggle("is-hidden", !isOpening);
    toggleNoteButton.textContent = isOpening ? "닫기" : "메모장";

    if (isOpening) {
      placeNoteWindow();
      privateNote.focus();
    }
  }

  function closePrivateNote() {
    noteBody.classList.add("is-hidden");
    toggleNoteButton.textContent = "메모장";
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function placeNoteWindow() {
    if (noteWindowPosition) return;

    const rect = noteBody.getBoundingClientRect();
    const x = Math.max(16, window.innerWidth - rect.width - 24);
    const y = 82;

    noteWindowPosition = { x, y };
    noteBody.style.left = `${x}px`;
    noteBody.style.top = `${y}px`;
    noteBody.style.right = "auto";
  }

  function keepNoteWindowInViewport() {
    if (!noteWindowPosition || noteBody.classList.contains("is-hidden")) return;

    const rect = noteBody.getBoundingClientRect();
    const x = clamp(rect.left, 8, Math.max(8, window.innerWidth - rect.width - 8));
    const y = clamp(rect.top, 8, Math.max(8, window.innerHeight - rect.height - 8));

    noteWindowPosition = { x, y };
    noteBody.style.left = `${x}px`;
    noteBody.style.top = `${y}px`;
  }

  function startDraggingNote(event) {
    if (event.target.closest("button")) return;

    event.preventDefault();
    placeNoteWindow();

    const startX = event.clientX;
    const startY = event.clientY;
    const rect = noteBody.getBoundingClientRect();

    function moveNote(moveEvent) {
      const nextX = clamp(
        rect.left + moveEvent.clientX - startX,
        8,
        Math.max(8, window.innerWidth - rect.width - 8)
      );
      const nextY = clamp(
        rect.top + moveEvent.clientY - startY,
        8,
        Math.max(8, window.innerHeight - rect.height - 8)
      );

      noteWindowPosition = { x: nextX, y: nextY };
      noteBody.style.left = `${nextX}px`;
      noteBody.style.top = `${nextY}px`;
      noteBody.style.right = "auto";
    }

    function stopDraggingNote() {
      window.removeEventListener("pointermove", moveNote);
      window.removeEventListener("pointerup", stopDraggingNote);
    }

    window.addEventListener("pointermove", moveNote);
    window.addEventListener("pointerup", stopDraggingNote);
  }

  function startResizingNote(event) {
    event.preventDefault();
    event.stopPropagation();
    placeNoteWindow();

    const startX = event.clientX;
    const startY = event.clientY;
    const rect = noteBody.getBoundingClientRect();

    function resizeNote(moveEvent) {
      const nextWidth = clamp(rect.width + moveEvent.clientX - startX, 280, window.innerWidth - rect.left - 8);
      const nextHeight = clamp(rect.height + moveEvent.clientY - startY, 260, window.innerHeight - rect.top - 8);

      noteBody.style.width = `${nextWidth}px`;
      noteBody.style.height = `${nextHeight}px`;
    }

    function stopResizingNote() {
      window.removeEventListener("pointermove", resizeNote);
      window.removeEventListener("pointerup", stopResizingNote);
      keepNoteWindowInViewport();
    }

    window.addEventListener("pointermove", resizeNote);
    window.addEventListener("pointerup", stopResizingNote);
  }

  function subscribeRealtime() {
    messagesChannel = supabaseClient
      .channel(`room-messages-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          console.log("Realtime message changed:", payload);

          // 메시지가 추가/삭제/수정되면 전체 채팅과 현재 선택된 개인 채팅을 모두 다시 불러옵니다.
          await loadGlobalMessages();
          await loadPrivateMessages();
        }
      )
      .subscribe((status, error) => {
        console.log("Messages realtime status:", status);

        if (error) {
          console.error("Messages realtime error:", error);
        }
      });

    membersChannel = supabaseClient
      .channel(`room-members-${roomId}`)
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
        }
      )
      .subscribe((status, error) => {
        console.log("Room members realtime status:", status);

        if (error) {
          console.error("Room members realtime error:", error);
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
      .on("presence", { event: "sync" }, async () => {
        const presenceState = presenceChannel.presenceState();
        onlineUserIds = new Set(Object.keys(presenceState));

        console.log("Room presence online users:", [...onlineUserIds]);
        await loadMembers();
      })
      .on("presence", { event: "join" }, ({ key }) => {
        console.log("Room presence joined:", key);
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        console.log("Room presence left:", key);
      })
      .subscribe(async (status, error) => {
        console.log("Room presence status:", status);

        if (error) {
          console.error("Room presence error:", error);
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
      .on("broadcast", { event: "player-kicked" }, async ({ payload }) => {
        console.log("Room kick broadcast:", payload);

        if (payload?.user_id !== currentUser.id) return;

        await handleKickedFromRoom(payload.message);
      })
      .subscribe((status, error) => {
        console.log("Room kick broadcast status:", status);

        if (error) {
          console.error("Room kick broadcast error:", error);
        }
      });

    chatActionsChannel = supabaseClient
      .channel(`room-chat-actions-${roomId}`)
      .on("broadcast", { event: "global-chat-cleared" }, async ({ payload }) => {
        console.log("Room global chat cleared broadcast:", payload);

        if (payload?.room_id !== roomId) return;

        await loadGlobalMessages();
      })
      .on("broadcast", { event: "message-deleted" }, async ({ payload }) => {
        console.log("Room message deleted broadcast:", payload);

        if (payload?.room_id !== roomId) return;

        await loadGlobalMessages();
        await loadPrivateMessages();
      })
      .on("broadcast", { event: "message-sent" }, async ({ payload }) => {
        console.log("Room message sent broadcast:", payload);

        if (payload?.room_id !== roomId) return;

        await loadGlobalMessages();
        await loadPrivateMessages();
      })
      .on("broadcast", { event: "nickname-updated" }, async ({ payload }) => {
        console.log("Room nickname updated broadcast:", payload);

        if (payload?.room_id !== roomId || !payload.user_id) return;

        await refreshProfile(payload.user_id);
        renderMemberList();
        renderPrivateChatSelector();
        await loadGlobalMessages();
        await loadPrivateMessages();
      })
      .subscribe((status, error) => {
        console.log("Room chat actions broadcast status:", status);

        if (status === "SUBSCRIBED") {
          chatActionsChannelReady = true;
        }

        if (error) {
          console.error("Room chat actions broadcast error:", error);
        }
      });
  }

  function cleanupRealtime() {
    if (messagesChannel) {
      supabaseClient.removeChannel(messagesChannel);
      messagesChannel = null;
      console.log("Messages realtime channel removed");
    }

    if (membersChannel) {
      supabaseClient.removeChannel(membersChannel);
      membersChannel = null;
      console.log("Room members realtime channel removed");
    }

    if (presenceChannel) {
      supabaseClient.removeChannel(presenceChannel);
      presenceChannel = null;
      onlineUserIds = new Set();
      console.log("Room presence channel removed");
    }

    if (kickChannel) {
      supabaseClient.removeChannel(kickChannel);
      kickChannel = null;
      console.log("Room kick broadcast channel removed");
    }

    if (chatActionsChannel) {
      supabaseClient.removeChannel(chatActionsChannel);
      chatActionsChannel = null;
      chatActionsChannelReady = false;
      console.log("Room chat actions broadcast channel removed");
    }
  }

  async function initRoom() {
    if (!supabaseClient) {
      showMessage("Supabase 설정을 불러오지 못했습니다.");
      return;
    }

    if (!requireRoomId()) return;

    const isLoggedIn = await requireLogin();
    if (!isLoggedIn) return;

    const isMember = await requireMembership();
    if (!isMember) return;

    const hasRoom = await loadRoom();
    if (!hasRoom) return;

    await loadMembers();
    await loadGlobalMessages();
    await loadPrivateNote();
    subscribeRealtime();
  }

  globalMessageForm.addEventListener("submit", sendGlobalMessage);
  getGlobalImageInput().addEventListener("change", handleGlobalImageChange);
  globalMessageForm.addEventListener("paste", handleGlobalPaste);
  globalMessageList.addEventListener("dragover", handleGlobalDragOver);
  globalMessageList.addEventListener("dragleave", handleGlobalDragLeave);
  globalMessageList.addEventListener("drop", handleGlobalDrop);
  privateMessageForm.addEventListener("submit", sendPrivateMessage);
  getPrivateImageInput().addEventListener("change", handlePrivateImageChange);
  privateMessageForm.addEventListener("paste", handlePrivatePaste);
  privateMessageList.addEventListener("dragover", handlePrivateDragOver);
  privateMessageList.addEventListener("dragleave", handlePrivateDragLeave);
  privateMessageList.addEventListener("drop", handlePrivateDrop);
  toggleNoteButton.addEventListener("click", togglePrivateNote);
  toggleGalleryButton.addEventListener("click", toggleGallery);
  closeGalleryButton.addEventListener("click", closeGallery);
  changeNicknameButton.addEventListener("click", changeNickname);
  closeNoteButton.addEventListener("click", closePrivateNote);
  noteWindowHeader.addEventListener("pointerdown", startDraggingNote);
  noteResizeHandle.addEventListener("pointerdown", startResizingNote);
  saveNoteButton.addEventListener("click", savePrivateNote);
  adminPageButton.addEventListener("click", moveToAdminPage);
  leaveRoomButton.addEventListener("click", moveToLobby);
  window.addEventListener("beforeunload", cleanupRealtime);
  window.addEventListener("resize", keepNoteWindowInViewport);

  initRoom();
})();
