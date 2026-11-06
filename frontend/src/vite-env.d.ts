/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Kakao Maps JavaScript key (public, restricted to registered domains). Empty = simple fallback map. */
  readonly VITE_KAKAO_JS_KEY?: string
  /** '1' when the APK build had the Firebase file (phone push on). */
  readonly VITE_PUSH?: string
  /** APK builds: app version, GitHub run number and the short commit hash (shown at the bottom of 설정). */
  readonly VITE_APP_VERSION?: string
  readonly VITE_BUILD_NUMBER?: string
  readonly VITE_COMMIT?: string
}
