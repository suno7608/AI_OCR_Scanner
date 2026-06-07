import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// PWA(매니페스트/서비스워커)는 public/ 의 정적 파일로 직접 제공한다.
// (workbox 계열 무거운 의존성을 피하고 빌드를 단순/안정적으로 유지)
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
