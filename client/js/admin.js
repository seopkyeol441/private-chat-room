// 愿由ъ옄 ?붾㈃ ?꾩슜 ?ㅽ겕由쏀듃?낅땲??
// admin ??븷 ?뺤씤, ?꾩껜 梨꾪똿, 李멸??먮퀎 1:1 梨꾪똿, Realtime 媛깆떊??泥섎━?⑸땲??
(() => {
  const supabaseClient = window.supabaseClient;
  const roomTitle = document.querySelector("#admin-room-title");
  const roomCode = document.querySelector("#admin-room-code");
  const adminMessage = document.querySelector("#admin-message");
  const leaveButton = document.querySelector("#leave-admin-room-button");
  const globalMessageList = document.querySelector("#admin-global-message-list");
  const privateChatGrid = document.querySelector("#admin-private-chat-grid");
  const globalMessageForm = document.querySelector("#admin-global-message-form");
  const globalImagePreview = document.querySelector("#admin-global-image-preview");
  const clearGlobalChatButton = document.querySelector("#clear-global-chat-button");
  const changeNicknameButton = document.querySelector("#admin-change-nickname-button");
  const deleteRoomButton = document.querySelector("#delete-room-button");
  const toggleMembersButton = document.querySelector("#toggle-admin-members-button");
  const membersPopover = document.querySelector("#admin-member-popover");
  const closeMembersButton = document.querySelector("#close-admin-members-button");
  const membersPopoverHeader = document.querySelector(".admin-member-popover-header");
  const memberList = document.querySelector("#admin-member-list");
  const privateDescription = document.querySelector("#admin-private-description");
  const imageViewer = document.querySelector("#admin-image-viewer");
  const imageViewerImg = document.querySelector("#admin-image-viewer-img");
  const imageViewerClose = document.querySelector("#admin-image-viewer-close");

  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("roomId");

  let currentUser = null;
  let currentMember = null;
  let roomMembers = [];
  let profileMap = new Map();
  let selectedUserIds = [];
  let lockedPrivateUserIds = new Set();
  let messagesChannel = null;
  let membersChannel = null;
  let presenceChannel = null;
  let kickChannel = null;
  let chatActionsChannel = null;
  let kickChannelReady = false;
  let chatActionsChannelReady = false;
  let onlineUserIds = new Set();
  let membersPopoverPosition = null;

  function showMessage(message, type = "error") {
    adminMessage.textContent = message;
    adminMessage.className = `auth-message room-message is-${type}`;
  }

  function clearMessage() {
    adminMessage.textContent = "";
    adminMessage.className = "auth-message room-message";
  }

  function submitFormOnEnter(event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
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

  async function addRoomEventMessage(message) {
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
      console.warn("Admin room event message failed:", error);
    }
  }

  async function leaveRoomWithMessage() {
    await addRoomEventMessage(`관리자 ${getProfileName(currentUser.id)}님이 방에서 나갔습니다.`);
    await sendMessageSentBroadcast("global");
    moveToLobby();
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

  // ?꾩옱 諛⑹뿉??admin ??븷?몄? ?뺤씤?⑸땲??
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

    selectedUserIds = participants.map((member) => member.user_id);

    if (!participants.length) {
      memberList.innerHTML = '<p class="empty-state">아직 참가자가 없습니다.</p>';
      privateDescription.textContent = "참가자가 들어오면 개인 채팅을 시작할 수 있습니다.";
      renderPrivateChatPanels();
      return;
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
      button.addEventListener("click", () => selectParticipant(member.user_id));

      const kickButton = document.createElement("button");
      kickButton.className = "kick-button";
      kickButton.type = "button";
      kickButton.textContent = "×";
      kickButton.title = `${getMemberName(member)}님 추방`;
      kickButton.setAttribute("aria-label", `${getMemberName(member)}님 추방`);
      kickButton.addEventListener("click", () => kickParticipant(member));

      item.append(button, kickButton);
      memberList.append(item);
    });

    updateSelectedParticipant();
  }

  function updateSelectedParticipant() {
    memberList.querySelectorAll(".member-select-button").forEach((button) => {
      button.classList.toggle("is-active", false);
    });

    if (!selectedUserIds.length) {
      privateDescription.textContent = "참가자가 들어오면 개인 채팅을 시작할 수 있습니다.";
    } else {
      privateDescription.textContent = `${selectedUserIds.length}명과 개인 채팅을 한 번에 관리하고 있습니다.`;
    }

    renderPrivateChatPanels();
  }

  function selectParticipant(userId) {
    const panel = getPrivateChatPanel(userId);

    if (panel) {
      closeMembersPopover();
      panel.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
      panel.classList.add("is-highlighted");
      window.setTimeout(() => {
        panel.classList.remove("is-highlighted");
      }, 900);
    }
  }

  function toggleMembersPopover() {
    const shouldOpen = membersPopover.classList.contains("is-hidden");
    membersPopover.classList.toggle("is-hidden", !shouldOpen);

    if (shouldOpen) {
      positionMembersPopover();
    }
  }

  function closeMembersPopover() {
    membersPopover.classList.add("is-hidden");
  }

  function positionMembersPopover() {
    const rect = membersPopover.getBoundingClientRect();
    const width = Math.min(rect.width || 420, window.innerWidth - 16);
    const height = Math.min(rect.height || 520, window.innerHeight - 16);
    const buttonRect = toggleMembersButton.getBoundingClientRect();
    const x = membersPopoverPosition
      ? Math.min(Math.max(8, membersPopoverPosition.x), Math.max(8, window.innerWidth - width - 8))
      : Math.min(Math.max(8, buttonRect.right - width), Math.max(8, window.innerWidth - width - 8));
    const y = membersPopoverPosition
      ? Math.min(Math.max(8, membersPopoverPosition.y), Math.max(8, window.innerHeight - height - 8))
      : Math.min(buttonRect.bottom + 8, Math.max(8, window.innerHeight - height - 8));

    membersPopoverPosition = { x, y };
    membersPopover.style.left = `${x}px`;
    membersPopover.style.top = `${y}px`;
  }

  function startDraggingMembersPopover(event) {
    if (event.button !== 0) return;

    const rect = membersPopover.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = rect.left;
    const originY = rect.top;

    event.preventDefault();
    membersPopoverHeader.setPointerCapture?.(event.pointerId);

    function moveMembersPopover(moveEvent) {
      const nextX = Math.min(
        Math.max(8, originX + moveEvent.clientX - startX),
        Math.max(8, window.innerWidth - rect.width - 8)
      );
      const nextY = Math.min(
        Math.max(8, originY + moveEvent.clientY - startY),
        Math.max(8, window.innerHeight - rect.height - 8)
      );

      membersPopoverPosition = { x: nextX, y: nextY };
      membersPopover.style.left = `${nextX}px`;
      membersPopover.style.top = `${nextY}px`;
    }

    function stopDraggingMembersPopover() {
      window.removeEventListener("pointermove", moveMembersPopover);
      window.removeEventListener("pointerup", stopDraggingMembersPopover);
    }

    window.addEventListener("pointermove", moveMembersPopover);
    window.addEventListener("pointerup", stopDraggingMembersPopover);
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

    // 踰꾪듉???꾨Ⅸ 利됱떆 ?뚮젅?댁뼱 ?붾㈃??異붾갑 ?좏샇瑜?蹂대깄?덈떎.
    // DB ??젣 ?꾨즺瑜?湲곕떎由ъ? ?딆븘???뚮젅?댁뼱媛 諛붾줈 濡쒕퉬濡??대룞?⑸땲??
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
      content: JSON.stringify({
        kind: "system",
        text: kickMessage,
      }),
    });

    if (messageError) {
      showMessage(getFriendlyError(messageError));
      return;
    }

    if (selectedUserIds.includes(member.user_id)) {
      selectedUserIds = selectedUserIds.filter((userId) => userId !== member.user_id);
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
        message,
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

  async function waitForChatActionsChannel() {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (chatActionsChannelReady) return true;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }

    console.warn("Chat actions broadcast channel is not ready yet.");
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
    renderMembers();
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

    console.log("Admin nickname updated broadcast response:", response);
  }

  function createMessageElement(message) {
    const item = document.createElement("article");
    const isMine = message.sender_id === currentUser.id;
    const parsedMessage = parseMessageContent(message.content);

    if (parsedMessage.kind === "system") {
      item.className = "chat-message is-system";
      item.append(createMessageContentElement(parsedMessage));
      return item;
    }

    item.className = `chat-message${isMine ? " is-mine" : ""}`;

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

      if (parsed?.kind === "system" && parsed.text) {
        return parsed;
      }
    } catch (error) {
      // 湲곗〈 ?띿뒪??硫붿떆吏??JSON???꾨땲誘濡?洹몃?濡??쒖떆?⑸땲??
    }

    return { kind: "text", text: content };
  }

  function createMessageContentElement(messageContent) {
    if (messageContent.kind === "system") {
      const content = document.createElement("p");
      content.className = "system-message-text";
      content.textContent = messageContent.text;
      return content;
    }

    if (messageContent.kind === "image") {
      const wrapper = document.createElement("div");
      wrapper.className = "chat-image-message";

      const image = document.createElement("img");
      image.src = messageContent.src;
      image.alt = messageContent.name || "梨꾪똿 ?대?吏";
      image.loading = "lazy";

      wrapper.append(image);

      const actions = document.createElement("div");
      actions.className = "chat-image-actions";

      const viewButton = document.createElement("button");
      viewButton.type = "button";
      viewButton.textContent = "보기";
      viewButton.addEventListener("click", () => openImageViewer(messageContent));

      const downloadButton = document.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "저장";
      downloadButton.addEventListener("click", () => downloadChatImage(messageContent));

      actions.append(viewButton, downloadButton);
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

  function openImageViewer(imageContent) {
    imageViewerImg.src = imageContent.src;
    imageViewerImg.alt = imageContent.name || "확대된 사진";
    imageViewer.classList.remove("is-hidden");
  }

  function closeImageViewer() {
    imageViewer.classList.add("is-hidden");
    imageViewerImg.removeAttribute("src");
  }

  function resizeImageFile(file, maxSize = 1500, quality = 0.9) {
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
      return;
    }

    await loadProfiles((data || []).map((message) => message.sender_id));
    renderMessages(globalMessageList, data || [], "아직 전체 메시지가 없습니다.");
  }

  function renderPrivateChatPanels() {
    if (!selectedUserIds.length) {
      privateChatGrid.innerHTML = '<p class="empty-state">개인 채팅을 선택해주세요.</p>';
      return;
    }

    privateChatGrid.innerHTML = "";

    selectedUserIds.forEach((userId) => {
      const panel = document.createElement("section");
      panel.className = "private-chat-slot";
      panel.dataset.userId = userId;

      const header = document.createElement("div");
      header.className = "private-chat-slot-header";

      const title = document.createElement("strong");
      title.textContent = getProfileName(userId);

      const lockButton = document.createElement("button");
      lockButton.className = "private-lock-button";
      lockButton.type = "button";
      lockButton.textContent = lockedPrivateUserIds.has(userId) ? "잠금 해제" : "잠금";
      lockButton.classList.toggle("is-locked", lockedPrivateUserIds.has(userId));
      lockButton.addEventListener("click", () => togglePrivateChatLock(userId));

      header.append(title, lockButton);

      const messageList = document.createElement("div");
      messageList.className = "message-list private-message-list private-slot-message-list";
      messageList.innerHTML = '<p class="empty-state">개인 채팅을 불러오는 중입니다.</p>';

      const form = document.createElement("form");
      form.className = "message-form private-slot-form";

      const textarea = document.createElement("textarea");
      textarea.className = "chat-textarea";
      textarea.name = "content";
      textarea.placeholder = "개인 메시지 입력";
      textarea.maxLength = 500;
      textarea.rows = 2;
      textarea.addEventListener("keydown", submitFormOnEnter);

      const imageButton = document.createElement("label");
      imageButton.className = "image-upload-button";
      imageButton.textContent = "사진";

      const imageInput = document.createElement("input");
      imageInput.type = "file";
      imageInput.name = "image";
      imageInput.accept = "image/*";
      imageInput.addEventListener("change", (event) => handlePrivateImageChange(event, userId));

      imageButton.append(imageInput);

      const sendButton = document.createElement("button");
      sendButton.className = "primary-button";
      sendButton.type = "submit";
      sendButton.textContent = "전송";

      const preview = document.createElement("div");
      preview.className = "image-preview is-hidden";
      preview.dataset.userId = userId;

      form.append(textarea, imageButton, sendButton, preview);
      form.addEventListener("submit", (event) => sendPrivateMessage(event, userId));
      form.addEventListener("paste", (event) => handlePrivatePaste(event, userId));
      messageList.addEventListener("dragover", handlePrivateDragOver);
      messageList.addEventListener("dragleave", handlePrivateDragLeave);
      messageList.addEventListener("drop", (event) => handlePrivateDrop(event, userId));

      panel.append(header, messageList, form);
      privateChatGrid.append(panel);

      loadPrivateMessagesForUser(userId, messageList);
    });
  }

  function closePrivateChat(userId) {
    selectedUserIds = selectedUserIds.filter((selectedId) => selectedId !== userId);
    updateSelectedParticipant();
  }

  async function togglePrivateChatLock(userId) {
    if (!userId) return;

    const shouldLock = !lockedPrivateUserIds.has(userId);

    if (shouldLock) {
      lockedPrivateUserIds.add(userId);
    } else {
      lockedPrivateUserIds.delete(userId);
    }

    renderPrivateChatPanels();
    await sendPrivateChatLockBroadcast(userId, shouldLock);
    showMessage(`${getProfileName(userId)}님의 개인 채팅을 ${shouldLock ? "잠금" : "잠금 해제"}했습니다.`, "success");
  }

  function getPrivateChatPanel(userId) {
    return privateChatGrid.querySelector(`.private-chat-slot[data-user-id="${userId}"]`);
  }

  function getPrivateImageInput(userId) {
    return getPrivateChatPanel(userId)?.querySelector('input[name="image"]');
  }

  function getPrivateImagePreview(userId) {
    return getPrivateChatPanel(userId)?.querySelector(".image-preview");
  }

  function setPrivateImageFile(file, userId, sourceLabel) {
    if (!file || !file.type.startsWith("image/")) return false;

    const imageInput = getPrivateImageInput(userId);
    const dataTransfer = new DataTransfer();

    dataTransfer.items.add(file);
    imageInput.files = dataTransfer.files;
    renderPrivateImagePreview(file, userId);
    showMessage(`${sourceLabel}한 사진이 선택되었습니다. 전송 버튼을 눌러 보내세요.`, "success");
    return true;
  }

  function renderPrivateImagePreview(file, userId) {
    const preview = getPrivateImagePreview(userId);
    const previewUrl = URL.createObjectURL(file);

    preview.innerHTML = "";
    preview.classList.remove("is-hidden");

    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = "전송할 사진 미리보기";
    image.addEventListener("load", () => URL.revokeObjectURL(previewUrl), { once: true });

    const info = document.createElement("span");
    info.textContent = `${file.name || "붙여넣은 사진"} 선택됨`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "제거";
    removeButton.addEventListener("click", () => clearPrivateImageSelection(userId));

    preview.append(image, info, removeButton);
  }

  function clearPrivateImagePreview(userId) {
    const preview = getPrivateImagePreview(userId);

    if (!preview) return;

    preview.innerHTML = "";
    preview.classList.add("is-hidden");
  }

  function clearPrivateImageSelection(userId) {
    const imageInput = getPrivateImageInput(userId);

    if (imageInput) {
      imageInput.value = "";
    }

    clearPrivateImagePreview(userId);
  }

  function handlePrivateImageChange(event, userId) {
    const file = event.target.files?.[0];

    if (file) {
      renderPrivateImagePreview(file, userId);
    } else {
      clearPrivateImagePreview(userId);
    }
  }

  function handlePrivatePaste(event, userId) {
    const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/"));

    if (setPrivateImageFile(file, userId, "붙여넣기")) {
      event.preventDefault();
    }
  }

  function handlePrivateDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add("is-drag-over");
  }

  function handlePrivateDragLeave(event) {
    event.currentTarget.classList.remove("is-drag-over");
  }

  function handlePrivateDrop(event, userId) {
    event.preventDefault();
    event.currentTarget.classList.remove("is-drag-over");

    const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith("image/"));

    if (!setPrivateImageFile(file, userId, "드래그")) {
      showMessage("이미지 파일만 드래그해서 넣을 수 있습니다.");
    }
  }

  async function loadPrivateMessages() {
    if (!selectedUserIds.length) {
      renderPrivateChatPanels();
      return;
    }

    await Promise.all(
      selectedUserIds.map(async (userId) => {
        const panel = privateChatGrid.querySelector(`.private-chat-slot[data-user-id="${userId}"]`);
        const messageList = panel?.querySelector(".private-slot-message-list");

        if (messageList) {
          await loadPrivateMessagesForUser(userId, messageList);
        }
      })
    );
  }

  async function loadPrivateMessagesForUser(userId, messageList) {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("id, sender_id, receiver_id, message_type, content, created_at")
      .eq("room_id", roomId)
      .eq("message_type", "private")
      .or(
        `and(sender_id.eq.${currentUser.id},receiver_id.eq.${userId}),and(sender_id.eq.${userId},receiver_id.eq.${currentUser.id})`
      )
      .order("created_at", { ascending: true });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await loadProfiles((data || []).map((message) => message.sender_id));
    renderMessages(messageList, data || [], "아직 개인 메시지가 없습니다.");
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

    console.log("Admin message deleted broadcast response:", response);
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

    console.log("Admin message sent broadcast response:", response);
  }

  async function sendPrivateChatLockBroadcast(userId, isLocked) {
    if (!chatActionsChannel) return;

    if (!chatActionsChannelReady) {
      await waitForChatActionsChannel();
    }

    const response = await chatActionsChannel.send({
      type: "broadcast",
      event: "private-chat-lock-changed",
      payload: {
        room_id: roomId,
        user_id: userId,
        is_locked: isLocked,
        changed_by: currentUser.id,
        changed_at: new Date().toISOString(),
      },
    });

    console.log("Admin private chat lock broadcast response:", response);
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

  async function clearGlobalChat() {
    clearMessage();

    const ok = window.confirm("전체 채팅을 모두 삭제할까요?");

    if (!ok) return;

    clearGlobalChatButton.disabled = true;
    clearGlobalChatButton.textContent = "삭제 중...";

    const { error } = await supabaseClient
      .from("messages")
      .delete()
      .eq("room_id", roomId)
      .eq("message_type", "global");

    clearGlobalChatButton.disabled = false;
    clearGlobalChatButton.textContent = "전체 채팅 삭제";

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await sendChatClearedBroadcast();
    globalMessageList.innerHTML = '<p class="empty-state">아직 전체 메시지가 없습니다.</p>';
    showMessage("전체 채팅을 삭제했습니다.", "success");
  }

  async function sendChatClearedBroadcast() {
    if (!chatActionsChannel) return;

    if (!chatActionsChannelReady) {
      await waitForChatActionsChannel();
    }

    const response = await chatActionsChannel.send({
      type: "broadcast",
      event: "global-chat-cleared",
      payload: {
        room_id: roomId,
        cleared_by: currentUser.id,
        cleared_at: new Date().toISOString(),
      },
    });

    console.log("Admin global chat cleared broadcast response:", response);
  }

  async function sendRoomDeletedBroadcast() {
    if (!chatActionsChannel) return;

    if (!chatActionsChannelReady) {
      await waitForChatActionsChannel();
    }

    const response = await chatActionsChannel.send({
      type: "broadcast",
      event: "room-deleted",
      payload: {
        room_id: roomId,
        deleted_by: currentUser.id,
        deleted_at: new Date().toISOString(),
      },
    });

    console.log("Admin room deleted broadcast response:", response);
  }

  async function deleteRoom() {
    clearMessage();

    const confirmed = window.confirm(
      "방을 제거하면 전체 채팅, 개인 채팅, 메모장 내용, 접속 중인 플레이어의 사진 보관함이 삭제됩니다. 계속할까요?"
    );

    if (!confirmed) return;

    deleteRoomButton.disabled = true;
    deleteRoomButton.textContent = "제거 중...";

    await sendRoomDeletedBroadcast();
    await new Promise((resolve) => window.setTimeout(resolve, 400));

    const deleteSteps = [
      () => supabaseClient.from("private_notes").delete().eq("room_id", roomId),
      () => supabaseClient.from("messages").delete().eq("room_id", roomId),
      () => supabaseClient.from("room_members").delete().eq("room_id", roomId).eq("role", "player"),
    ];

    for (const step of deleteSteps) {
      const { error } = await step();

      if (error) {
        deleteRoomButton.disabled = false;
        deleteRoomButton.textContent = "방 제거";
        showMessage(getFriendlyError(error));
        return;
      }
    }

    const { data: deletedRoom, error: roomDeleteError } = await supabaseClient
      .from("rooms")
      .delete()
      .eq("id", roomId)
      .select("id")
      .maybeSingle();

    if (roomDeleteError) {
      deleteRoomButton.disabled = false;
      deleteRoomButton.textContent = "방 제거";
      showMessage(getFriendlyError(roomDeleteError));
      return;
    }

    if (!deletedRoom) {
      deleteRoomButton.disabled = false;
      deleteRoomButton.textContent = "방 제거";
      showMessage("방 삭제에 실패했습니다. Supabase에서 rooms 삭제 정책이 방 관리자에게 허용되어 있는지 확인해주세요.");
      return;
    }

    await supabaseClient.from("room_members").delete().eq("room_id", roomId);

    sessionStorage.setItem("lobbyFlashMessage", "방이 제거되었습니다.");
    sessionStorage.setItem("lobbyFlashType", "success");
    moveToLobby();
  }

  async function sendPrivateMessage(event, receiverId) {
    event.preventDefault();
    clearMessage();

    if (!receiverId) {
      showMessage("개인 메시지를 보낼 참가자를 선택해주세요.");
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
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
      receiver_id: receiverId,
      message_type: "private",
      content: messageContent,
    });

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    await sendMessageSentBroadcast("private");
    form.reset();
    clearPrivateImagePreview(receiverId);
  }

  function subscribeRealtime() {
    messagesChannel = supabaseClient
      .channel(`admin-messages-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${roomId}`,
        },
        async (payload) => {
          console.log("Admin realtime message changed:", payload);
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
      .on("presence", { event: "sync" }, async () => {
        const presenceState = presenceChannel.presenceState();
        onlineUserIds = new Set(Object.keys(presenceState));

        console.log("Admin presence online users:", [...onlineUserIds]);
        await loadMembers();
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

    chatActionsChannel = supabaseClient
      .channel(`room-chat-actions-${roomId}`)
      .on("broadcast", { event: "global-chat-cleared" }, async ({ payload }) => {
        console.log("Admin global chat cleared broadcast:", payload);

        if (payload?.room_id !== roomId) return;

        await loadGlobalMessages();
      })
      .on("broadcast", { event: "message-deleted" }, async ({ payload }) => {
        console.log("Admin message deleted broadcast:", payload);

        if (payload?.room_id !== roomId) return;

        await loadGlobalMessages();
        await loadPrivateMessages();
      })
      .on("broadcast", { event: "message-sent" }, async ({ payload }) => {
        console.log("Admin message sent broadcast:", payload);

        if (payload?.room_id !== roomId) return;

        await loadGlobalMessages();
        await loadPrivateMessages();
      })
      .on("broadcast", { event: "nickname-updated" }, async ({ payload }) => {
        console.log("Admin nickname updated broadcast:", payload);

        if (payload?.room_id !== roomId || !payload.user_id) return;

        await refreshProfile(payload.user_id);
        renderMembers();
        await loadGlobalMessages();
        await loadPrivateMessages();
      })
      .subscribe((status, error) => {
        console.log("Admin chat actions broadcast status:", status);

        if (status === "SUBSCRIBED") {
          chatActionsChannelReady = true;
        }

        if (error) {
          console.error("Admin chat actions broadcast error:", error);
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

    if (chatActionsChannel) {
      supabaseClient.removeChannel(chatActionsChannel);
      chatActionsChannel = null;
      chatActionsChannelReady = false;
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
  globalMessageForm.querySelector('textarea[name="content"]').addEventListener("keydown", submitFormOnEnter);
  getGlobalImageInput().addEventListener("change", handleGlobalImageChange);
  globalMessageForm.addEventListener("paste", handleGlobalPaste);
  globalMessageList.addEventListener("dragover", handleGlobalDragOver);
  globalMessageList.addEventListener("dragleave", handleGlobalDragLeave);
  globalMessageList.addEventListener("drop", handleGlobalDrop);
  clearGlobalChatButton.addEventListener("click", clearGlobalChat);
  changeNicknameButton.addEventListener("click", changeNickname);
  deleteRoomButton.addEventListener("click", deleteRoom);
  toggleMembersButton.addEventListener("click", toggleMembersPopover);
  closeMembersButton.addEventListener("click", closeMembersPopover);
  membersPopoverHeader.addEventListener("pointerdown", startDraggingMembersPopover);
  leaveButton.addEventListener("click", leaveRoomWithMessage);
  imageViewerClose.addEventListener("click", closeImageViewer);
  imageViewer.addEventListener("click", (event) => {
    if (event.target === imageViewer) {
      closeImageViewer();
    }
  });
  window.addEventListener("beforeunload", cleanupRealtime);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !imageViewer.classList.contains("is-hidden")) {
      closeImageViewer();
    }
  });

  initAdmin();
})();
