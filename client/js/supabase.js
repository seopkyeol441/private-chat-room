// Supabase 브라우저 클라이언트 설정 파일입니다.
// 즉시 실행 함수로 감싸 전역 변수 이름 충돌을 방지합니다.
(() => {
  // Supabase Project URL은 공개되어도 괜찮은 값입니다.
  const SUPABASE_URL = "https://mitziwtnqhojkcxkipfu.supabase.co";

  // 중요:
  // 여기에 server/.env의 SUPABASE_SERVICE_ROLE_KEY를 넣으면 안 됩니다.
  // Supabase Dashboard > Project Settings > API 의 anon/public key만 사용하세요.
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pdHppd3RucWhvamtjeGtpcGZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0ODc1MzAsImV4cCI6MjA5ODA2MzUzMH0.4o-P0aUUyCHeTMQVwji9IpLAih0rIPiQ8VkdayEbPFU";

  // CDN으로 불러온 SDK는 window.supabase.createClient를 제공합니다.
  // 우리가 만든 앱 클라이언트는 window.supabaseClient 이름으로만 공유합니다.
  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );
})();
