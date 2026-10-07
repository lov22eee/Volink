export type Place = { id: number; name: string; area: string; addressNote: string; coordinateStatus: string }
export type Persona = { code: string; displayName: string; role: 'ORGANIZER' | 'PARTICIPANT' | 'ADMIN' }
export type Activity = { id: number; title: string; description: string; category: string; placeId: number; placeName: string; startTime: string; durationMinutes: number; capacity: number; confirmed: number }
export type Catalog = { demo: boolean; baseDate: string; places: Place[]; personas: Persona[]; activities: Activity[]; notice: string }
export type DisplayCatalog = { demo: boolean; baseDate: string; places: Pick<Place, 'id' | 'name' | 'area'>[]; activities: Activity[] }

declare global {
  interface Window {
    __VOLINK_UI_DEMO__?: { catalog: DisplayCatalog }
  }
}
