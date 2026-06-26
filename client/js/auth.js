// 로그인/회원가입 화면 전용 스크립트입니다.
// Supabase Auth로 계정을 만들고 로그인한 뒤 lobby.html로 이동합니다.
(() => {
  const authMessage = document.querySelector("#auth-message");
  const authTabs = document.querySelectorAll("[data-auth-tab]");
  const authForms = document.querySelectorAll("[data-auth-form]");
  const loginForm = document.querySelector("#login-form");
  const signupForm = document.querySelector("#signup-form");
  const USERNAME_PATTERN = /^[a-z0-9_]+$/;

  // supabase.js에서 만든 클라이언트를 가져옵니다.
  // 변수명을 supabase로 만들면 CDN 전역 객체와 충돌할 수 있어 supabaseClient를 사용합니다.
  const supabaseClient = window.supabaseClient;

  if (!supabaseClient) {
    showMessage("Supabase 설정을 불러오지 못했습니다.");
    return;
  }

  // 오류/성공 메시지를 한 곳에서 처리하면 로그인과 회원가입 로직을 깔끔하게 유지할 수 있습니다.
  function showMessage(message, type = "error") {
    authMessage.textContent = message;
    authMessage.className = `auth-message is-${type}`;
  }

  function clearMessage() {
    authMessage.textContent = "";
    authMessage.className = "auth-message";
  }

  // 요청 중에는 버튼을 비활성화해 중복 클릭으로 같은 요청이 여러 번 가는 일을 막습니다.
  function setFormLoading(form, isLoading) {
    const submitButton = form.querySelector('button[type="submit"]');

    submitButton.disabled = isLoading;
    submitButton.textContent = isLoading
      ? "처리 중..."
      : submitButton.dataset.label;
  }

  // 서버에서 받은 오류 문구를 그대로 보여주되, 자주 만나는 메시지는 한국어로 다듬습니다.
  function getFriendlyError(error) {
    if (!error) return "알 수 없는 오류가 발생했습니다.";

    const message = error.message || String(error);

    if (message.includes("Invalid login credentials")) {
      return "아이디 또는 비밀번호가 올바르지 않습니다.";
    }

    if (message.includes("User already registered")) {
      return "이미 사용 중인 아이디입니다.";
    }

    if (message.includes("Email not confirmed")) {
      return "계정 인증이 아직 완료되지 않았습니다.";
    }

    return message;
  }

  // 사용자가 입력한 아이디를 Supabase Auth에서 요구하는 이메일 형태로 변환합니다.
  // 실제 메일 주소로 쓰지 않고, 앱 내부 로그인 식별자로만 사용합니다.
  function createInternalEmail(username) {
    return `${username}@chat.local`;
  }

  // Auth 계정 생성 직후 앱에서 사용할 프로필을 저장합니다.
  async function upsertProfile(user, username, nickname, role = "player") {
    return supabaseClient.from("profiles").upsert(
      {
        id: user.id,
        username,
        nickname,
        role,
      },
      { onConflict: "id" }
    );
  }

  // username 규칙은 클라이언트에서 먼저 검사해 불필요한 Supabase 요청을 줄입니다.
  function validateUsername(username) {
    if (!username) {
      return "아이디를 입력해주세요.";
    }

    if (username.length < 3 || username.length > 20) {
      return "아이디는 3자 이상 20자 이하로 입력해주세요.";
    }

    if (!USERNAME_PATTERN.test(username)) {
      return "아이디는 영어 소문자, 숫자, 언더바만 사용할 수 있습니다.";
    }

    return "";
  }

  // 로그인/회원가입 탭 전환 처리입니다.
  authTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const selectedMode = tab.dataset.authTab;

      clearMessage();

      authTabs.forEach((item) => {
        const isSelected = item.dataset.authTab === selectedMode;
        item.classList.toggle("is-active", isSelected);
        item.setAttribute("aria-selected", String(isSelected));
      });

      authForms.forEach((form) => {
        form.classList.toggle(
          "is-hidden",
          form.dataset.authForm !== selectedMode
        );
      });
    });
  });

  // 버튼 원래 문구를 보관해 두면 로딩이 끝난 뒤 정확히 되돌릴 수 있습니다.
  authForms.forEach((form) => {
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.dataset.label = submitButton.textContent;
  });

  // 이미 로그인된 사용자가 login.html에 들어오면 바로 로비로 보냅니다.
  async function redirectIfLoggedIn() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (session) {
      window.location.href = "./lobby.html";
    }
  }

  // Supabase Auth는 이메일 로그인을 사용하므로 username을 내부 이메일로 바꿔 로그인합니다.
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const formData = new FormData(loginForm);
    const username = formData.get("username").trim();
    const password = formData.get("password");
    const usernameError = validateUsername(username);

    if (usernameError) {
      showMessage(usernameError);
      return;
    }

    setFormLoading(loginForm, true);

    const { error } = await supabaseClient.auth.signInWithPassword({
      email: createInternalEmail(username),
      password,
    });

    setFormLoading(loginForm, false);

    if (error) {
      showMessage(getFriendlyError(error));
      return;
    }

    window.location.href = "./lobby.html";
  });

  // 회원가입 후 profiles 테이블에 앱에서 사용할 닉네임과 기본 역할을 저장합니다.
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearMessage();

    const formData = new FormData(signupForm);
    const username = formData.get("username").trim();
    const nickname = formData.get("nickname").trim();
    const password = formData.get("password");
    const usernameError = validateUsername(username);

    if (usernameError) {
      showMessage(usernameError);
      return;
    }

    setFormLoading(signupForm, true);

    const { data, error: signUpError } = await supabaseClient.auth.signUp({
      email: createInternalEmail(username),
      password,
      options: {
        // Auth 사용자 메타데이터에도 아이디와 닉네임을 남겨두면 나중에 화면 표시용으로 활용하기 좋습니다.
        data: {
          username,
          nickname,
        },
      },
    });

    if (signUpError) {
      setFormLoading(signupForm, false);
      showMessage(getFriendlyError(signUpError));
      return;
    }

    const user = data.user;

    if (!user) {
      setFormLoading(signupForm, false);
      showMessage("회원가입은 완료됐지만 사용자 정보를 확인할 수 없습니다.");
      return;
    }

    // Auth 계정 생성 직후 앱에서 사용할 프로필을 반드시 저장합니다.
    // 같은 id의 프로필이 이미 있어도 회원가입 흐름이 깨지지 않도록 upsert를 사용합니다.
    const { error: profileError } = await upsertProfile(
      user,
      username,
      nickname,
      "player"
    );

    setFormLoading(signupForm, false);

    if (profileError) {
      showMessage(getFriendlyError(profileError));
      return;
    }

    // 이메일 인증이 꺼져 있으면 세션이 즉시 생성되고, 켜져 있으면 인증 안내를 보여줍니다.
    if (data.session) {
      window.location.href = "./lobby.html";
      return;
    }

    showMessage("회원가입이 완료되었습니다. 로그인해주세요.", "success");
    signupForm.reset();
  });

  redirectIfLoggedIn();
})();
