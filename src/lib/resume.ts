const PREFIX = 'alexandria-resume:';

export type ResumePos = {
  pos: number;
  sectionId?: string;
  scrollY?: number;
};

export function loadResume(address: string): ResumePos | null {
  try {
    const raw = localStorage.getItem(PREFIX + address);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumePos;
    if (!Number.isFinite(parsed.pos)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveResume(address: string, pos: ResumePos): void {
  localStorage.setItem(PREFIX + address, JSON.stringify(pos));
}
