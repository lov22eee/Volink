export type Motion = { scenes: { cat: string; name: string }[]; play(v: boolean): void; go(i: number): void; seek(i: number, local: number): void; destroy(): void }
export function mountMotion(svg: SVGSVGElement, opts?: { start?: number; playing?: boolean; animate?: boolean; onScene?: (i: number) => void; onProgress?: (i: number, p: number) => void }): Motion
