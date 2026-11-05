/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Kakao Maps JavaScript key (public, restricted to registered domains). Empty = simple fallback map. */
  readonly VITE_KAKAO_JS_KEY?: string
  /** '1' when the APK build had the Firebase file (phone push on). */
  readonly VITE_PUSH?: string
}
